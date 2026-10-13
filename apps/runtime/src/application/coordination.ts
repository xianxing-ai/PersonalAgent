import {ProtocolError} from '@personal-agent/contracts';
import type {TaskSnapshot} from '@personal-agent/contracts';
import {AgentArtsResultUnknownError, parseCoordinationResult, parseCoordinationContinuation, type CoordinationContinuation, type CoordinationPort,
  type CoordinationResult, type CoordinationToolProposalResult, type AgentArtsUnknownReceipt} from '@personal-agent/coordination';
import type {AgentToolPort, ToolInvocationResult} from '@personal-agent/agents';
import type {TaskRuntime, WorkerContext, WorkerResult} from '../index.js';
import {isDeepStrictEqual} from 'node:util';
import type {CompetitionAvailableTool, RuntimeCompetitionToolCatalog} from './tool-catalog.js';

const DEFAULT_COMPETITION_STEPS = 4;

function sameCloudInvocation(left: AgentArtsUnknownReceipt | undefined | null,
  right: AgentArtsUnknownReceipt | undefined | null): boolean {
  return !!left && !!right && left.sessionId === right.sessionId && left.requestId === right.requestId
    && left.idempotencyKey === right.idempotencyKey && left.payloadDigest === right.payloadDigest;
}

function markCompetitionCloudUnknown(runtime: TaskRuntime, taskId: string,
  receipt?: AgentArtsUnknownReceipt): boolean {
  const inflight = runtime.loadCheckpoint(taskId, 'competition-cloud-inflight') as AgentArtsUnknownReceipt | undefined;
  if (!inflight) return false;
  const received = runtime.loadCheckpoint(taskId, 'competition-cloud-received') as AgentArtsUnknownReceipt | undefined;
  const unknown = receipt ?? (sameCloudInvocation(inflight, received) ? received : inflight);
  if (!sameCloudInvocation(inflight, unknown)) return false;
  runtime.saveCheckpoint(taskId, 'competition-cloud-unknown', {...unknown});
  const state = runtime.getTask(taskId).state;
  if (state === 'running' || state === 'cancelling') {
    runtime.transitionTask(taskId, 'waiting_reconciliation', {error: {code: 'RESULT_UNKNOWN',
      message: 'Cloud invocation delivery or result is unknown; reconcile before sending again', retryable: false}});
  }
  return true;
}

/** A transport receipt is not proof that the application consumed its result. */
export function recordCompetitionCloudReceipt(runtime: TaskRuntime, taskId: string,
  receipt: AgentArtsUnknownReceipt): void {
  const inflight = runtime.loadCheckpoint(taskId, 'competition-cloud-inflight') as AgentArtsUnknownReceipt | undefined | null;
  if (!sameCloudInvocation(inflight, receipt)) {
    throw new ProtocolError('RESULT_UNKNOWN', 'Cloud receipt is not bound to the original send intent');
  }
  // Correlation metadata only. Inflight survives application parsing, host hooks
  // and the crash window before the Runtime-owned result/checkpoint commit.
  runtime.saveCheckpoint(taskId, 'competition-cloud-received', {...receipt});
}

/** Persist the server admission so cancellation preserves the strongest known receipt. */
export function recordCompetitionCloudAcceptance(runtime: TaskRuntime, taskId: string,
  receipt: AgentArtsUnknownReceipt): void {
  const inflight = runtime.loadCheckpoint(taskId, 'competition-cloud-inflight') as AgentArtsUnknownReceipt | undefined | null;
  if (receipt.accepted !== true || !sameCloudInvocation(inflight, receipt)) {
    throw new ProtocolError('RESULT_UNKNOWN', 'Cloud acceptance is not bound to the original send intent');
  }
  runtime.saveCheckpoint(taskId, 'competition-cloud-inflight', {...receipt});
}

/** Call only after the corresponding parsed loop state or task success is durable. */
function consumeCompetitionCloudReceipt(runtime: TaskRuntime, taskId: string): void {
  const inflight = runtime.loadCheckpoint(taskId, 'competition-cloud-inflight') as AgentArtsUnknownReceipt | undefined | null;
  const received = runtime.loadCheckpoint(taskId, 'competition-cloud-received') as AgentArtsUnknownReceipt | undefined | null;
  if (runtime.loadCheckpoint(taskId, 'competition-cloud-unknown') || !sameCloudInvocation(inflight, received)) return;
  // The consumer checkpoint is committed first. A crash before this clear keeps
  // reconciliation mandatory; a crash after it cannot replay the old result.
  runtime.saveCheckpoint(taskId, 'competition-cloud-inflight', null);
  runtime.saveCheckpoint(taskId, 'competition-cloud-received', null);
}

/** Trusted composition only. This permits result export, never tool execution. */
export interface CompetitionToolExport {
  readonly toolName: string;
  readonly toolVersion: string;
  /** Must change whenever the host narrows or changes the projection policy. */
  readonly exportPolicyVersion: string;
  /** Restrict to the explicitly selected synthetic data before local approval. */
  accepts(input: {taskId: string; proposalId: string; arguments: Record<string, unknown>;
    phase?:'preflight'|'final';projection?:unknown;signal?:AbortSignal}): boolean;
  /** Return only the permitted projection; raw results and Evidence stay local. */
  project(input: {taskId: string; proposalId: string; result: unknown; signal: AbortSignal}): unknown | Promise<unknown>;
}

interface CompetitionCheckpoint {
  step: number;
  continuation?: CoordinationContinuation;
  pending?: CoordinationToolProposalResult;
  pendingRevision?:number;
  evidenceRefs: string[];
  receipts?: {proposal: CoordinationToolProposalResult; continuation: CoordinationContinuation; exportPolicyVersion?: string;
    workerSelection?:unknown;workerRevision?:number;runId?:string}[];
}

export interface CoordinationWorkerCapabilityPort {
  accepts(proposal:CoordinationToolProposalResult):boolean;
  dispatch(proposal:CoordinationToolProposalResult,context:WorkerContext & {revision:number}):Promise<
    {state:'pending'|'unknown'|'confirmed';result:unknown;evidenceRefs:readonly string[];selection:unknown}>;
  assertReceiptAllowed(proposal:CoordinationToolProposalResult,selection:unknown,receipt:unknown,context:WorkerContext & {revision:number}):void;
}
export type PrepareCompetitionToolExport=(input:{phase:'preflight'|'projection';taskId:string;
  proposal:CoordinationToolProposalResult;deadline:string;signal:AbortSignal})=>Promise<void>;

/** Keep the original confirmed read resumable when fresh export permission is denied. */
function withholdConfirmedExport(runtime:TaskRuntime,taskId:string):void {
  if(runtime.getTask(taskId).state!=='running')return;
  runtime.saveCheckpoint(taskId,'competition-export-withheld',{withheld:true});
  runtime.transitionTask(taskId,'waiting_reconciliation',{error:{code:'UNAUTHORIZED',
    message:'Confirmed local result export withheld; revalidate the original receipt',retryable:false}});
}

function summary(text: string, verification: 'mock' | 'unverified'): string {
  return `${text}\n[profile=huawei_ict_agentarts; verification=${verification}]`;
}

function requireExportBinding(
  proposal: CoordinationToolProposalResult,
  taskId: string,
  tools: AgentToolPort | undefined,
  bindings: readonly CompetitionToolExport[] | undefined,
  permitWrite = false,
  phase:'preflight'|'final'='final',projection?:unknown,signal?:AbortSignal,
): CompetitionToolExport | undefined {
  if (proposal.verification === 'mock') return undefined;
  const binding = bindings?.find(item => item.toolName === proposal.toolName && item.toolVersion === proposal.toolVersion);
  if (!binding || !tools?.list().some(tool => tool.name === proposal.toolName
    && tool.version === proposal.toolVersion && !tool.requiresPresence
    && (tool.sideEffect === 'read' || permitWrite))) {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Real Competition tool result export is unavailable');
  }
  let accepted = false;
  try {
    accepted = binding.accepts({taskId, proposalId: proposal.proposalId,
      arguments: structuredClone(proposal.arguments),phase,...(signal?{signal}:{}),...(phase==='final'?{projection:structuredClone(projection)}:{})}) === true;
  } catch { /* Host errors may include private data. */ }
  if (!accepted) throw new ProtocolError('UNAUTHORIZED', 'Competition result export scope denied');
  return binding;
}

/** Final trusted check for real adapter I/O, after asynchronous credential reads. */
export function assertCompetitionExportAllowed(
  runtime: TaskRuntime,
  tools: AgentToolPort | undefined,
  bindings: readonly CompetitionToolExport[],
  request: {taskId: string; deadline: string; signal: AbortSignal; continuation?: CoordinationContinuation},
  permitWrite = false,
): void {
  if (!request.continuation) return;
  const checkpoint = runtime.loadCheckpoint(request.taskId, 'competition-loop') as CompetitionCheckpoint | undefined;
  const receipt = checkpoint?.receipts?.find(item => item.proposal.proposalId === request.continuation?.proposalId);
  if (runtime.getTask(request.taskId).state !== 'running'
    || runtime.loadCheckpoint(request.taskId, 'application-profile') !== 'huawei_ict_agentarts'
    || runtime.loadCheckpoint(request.taskId, 'application-deadline') !== request.deadline
    || !receipt || receipt.proposal.verification === 'mock'
    || !isDeepStrictEqual(receipt.continuation, request.continuation)) {
    throw new ProtocolError('UNAUTHORIZED', 'Competition export is not bound to this task');
  }
  const binding = requireExportBinding(receipt.proposal, request.taskId, tools, bindings, permitWrite,'final',request.continuation.result,request.signal);
  if (!binding || !receipt.exportPolicyVersion || binding.exportPolicyVersion !== receipt.exportPolicyVersion) {
    throw new ProtocolError('UNAUTHORIZED', 'Competition result export policy changed');
  }
  if (request.signal.aborted) throw new ProtocolError('CANCELLED', 'Competition result export cancelled');
  if (Date.now() >= Date.parse(request.deadline)) throw new ProtocolError('TIMEOUT', 'Competition result export expired');
}

async function projectResult(binding: CompetitionToolExport, input: Parameters<CompetitionToolExport['project']>[0]): Promise<unknown> {
  let onAbort = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new ProtocolError('CANCELLED', 'Competition result export cancelled'));
    input.signal.addEventListener('abort', onAbort, {once: true});
    if (input.signal.aborted) onAbort();
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      if (input.signal.aborted) throw Error();
      return binding.project(input);
    }), cancelled]);
  } finally {
    input.signal.removeEventListener('abort', onAbort);
  }
}

async function exchange(
  runtime: TaskRuntime,
  port: CoordinationPort,
  taskId: string,
  goal: string,
  context: {deadline: string; signal: AbortSignal},
  continuation?: CoordinationContinuation,
  beforeInvoke?: () => void,
  availableTools?: readonly CompetitionAvailableTool[],
  onInvokeRevision?: (revision: number) => void,
): Promise<CoordinationResult> {
  if (runtime.loadCheckpoint(taskId, 'competition-cloud-unknown') || runtime.loadCheckpoint(taskId, 'competition-cloud-inflight')) {
    throw new ProtocolError('RESULT_UNKNOWN', 'Original cloud invocation requires reconciliation before another send');
  }
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(markCompetitionCloudUnknown(runtime, taskId)
      ? new ProtocolError('RESULT_UNKNOWN', 'Original cloud invocation requires reconciliation')
      : new ProtocolError('CANCELLED', 'Coordination request cancelled'));
    context.signal.addEventListener('abort', onAbort, {once: true});
    if (context.signal.aborted) onAbort();
  });
  try {
    return parseCoordinationResult(await Promise.race([
      Promise.resolve().then(async () => {
        if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Coordination request cancelled');
        // Recheck dynamic export scope at the actual adapter handoff, after
        // tool execution/projection and on every replay of a saved result.
        beforeInvoke?.();
        const revision = runtime.getTask(taskId).revision;
        onInvokeRevision?.(revision);
        try {
          return await port.execute(Object.freeze({
          taskId,
          goal,
          revision,
          deadline: context.deadline,
          signal: context.signal,
          ...(continuation === undefined ? {} : {continuation}),
          ...(availableTools === undefined ? {} : {availableTools: structuredClone(availableTools)}),
          }));
        } catch (error) {
          if (error instanceof AgentArtsResultUnknownError) {
            // Identity/digest only: never persist a cloud payload, credential or
            // model response. The same loop cannot automatically resend it.
            markCompetitionCloudUnknown(runtime, taskId, error.receipt);
            throw new ProtocolError('RESULT_UNKNOWN', 'Original cloud invocation requires reconciliation');
          }
          // Adapter errors may contain credentials or private response bodies.
          throw new ProtocolError('EXTERNAL_FAILURE', 'Coordination adapter failed');
        }
      }),
      cancelled,
    ]));
  } finally {
    context.signal.removeEventListener('abort', onAbort);
  }
}

/** Runtime-owned Competition loop. Cloud proposals are untrusted and tools remain locally authorized. */
export function startCoordinationTask(
  runtime: TaskRuntime,
  port: CoordinationPort | undefined,
  tools: AgentToolPort | undefined,
  taskId: string,
  goal: string,
  deadline: string,
  options: {resume?: boolean; toolExports?: readonly CompetitionToolExport[]; toolCatalog?: RuntimeCompetitionToolCatalog; repairCandidateVersion?: '1.0';workerCapabilities?:CoordinationWorkerCapabilityPort;prepareCompetitionToolExport?:PrepareCompetitionToolExport} = {},
): Promise<TaskSnapshot> {
  const execution = runtime.runTask(taskId, context => runCoordinationWorker(runtime,port,tools,taskId,goal,context,options),
    {deadline,sideEffect:options.toolCatalog?.sideEffect??'read',...(options.resume?{resume:true}:{})});
  // No adapter can dispatch an intent when the port is unavailable. Preserve
  // that existing immediate-failure lifecycle without a consumption callback.
  if (!port) return execution;
  return execution.then(task => {
      // Final text is consumed only by TaskRuntime's durable terminal commit.
      // Waiting, failure, cancellation and an interrupted child retain the hold.
      if (task.state === 'succeeded' && runtime.getTask(taskId).state === 'succeeded') {
        consumeCompetitionCloudReceipt(runtime, taskId);
      }
      return task;
    });
}

/** Shared worker for the original Runtime-owned parent and child task lifecycle. */
export async function runCoordinationWorker(
  runtime: TaskRuntime, port: CoordinationPort | undefined, tools: AgentToolPort | undefined,
  taskId: string, goal: string, context: WorkerContext,
  options: {toolExports?: readonly CompetitionToolExport[]; toolCatalog?: RuntimeCompetitionToolCatalog; repairCandidateVersion?: '1.0';workerCapabilities?:CoordinationWorkerCapabilityPort;prepareCompetitionToolExport?:PrepareCompetitionToolExport} = {},
): Promise<WorkerResult> {
    if (!port) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Competition coordination is unavailable');
    // Persisted by trusted Runtime composition at submission, never by the model.
    // Legacy tasks keep their original four-round budget when resumed.
    const maxSteps = context.loadCheckpoint('competition-max-steps') ?? DEFAULT_COMPETITION_STEPS;
    if (typeof maxSteps !== 'number' || !Number.isSafeInteger(maxSteps) || maxSteps < 1) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Invalid persisted Competition step budget');
    }
    const saved = context.loadCheckpoint('competition-loop') as CompetitionCheckpoint | undefined;
    let evidenceRefs = saved?.evidenceRefs ?? [];
    let continuation = saved?.continuation;
    let pending = saved?.pending;
    const receipts = saved?.receipts ?? [];

    for (let step = saved?.step ?? 1; step <= maxSteps; step++) {
      context.reportProgress({
        stepId: `competition-${step}`,
        label: pending ? `awaiting approval for ${pending.toolName}` : 'cloud coordination',
        completedUnits: step - 1,
        totalUnits: maxSteps,
      });
      const availableTools = !pending && continuation === undefined && options.toolCatalog
        ? await options.toolCatalog.prepare({taskId, deadline: context.deadline, signal: context.signal}) : undefined;
      if (availableTools && availableTools.length === 0) {
        throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'No Competition tools are available for this task');
      }
      let proposalRevision = runtime.getTask(taskId).revision;
      const result = pending ?? await exchange(runtime, port, taskId, goal, context, continuation, () => {
        const prior = receipts.find(item => item.proposal.proposalId === continuation?.proposalId);
        if (prior) {
          if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Competition result export cancelled');
          if (Date.now() >= Date.parse(context.deadline)) throw new ProtocolError('TIMEOUT', 'Competition result export expired');
          try {
            if(options.workerCapabilities?.accepts(prior.proposal)) {
              options.workerCapabilities.assertReceiptAllowed(prior.proposal,prior.workerSelection,prior.continuation.result,
                {...context,revision:prior.workerRevision!});return;
            }
            const current = requireExportBinding(prior.proposal, taskId, tools, options.toolExports,
              options.toolCatalog !== undefined,'final',prior.continuation.result,context.signal);
            if (current && (!prior.exportPolicyVersion || current.exportPolicyVersion !== prior.exportPolicyVersion)) {
              throw new ProtocolError('UNAUTHORIZED', 'Competition result export policy changed');
            }
          } catch(error) {withholdConfirmedExport(runtime,taskId);throw error;}
        }
      }, availableTools, revision => { proposalRevision = revision; });
      if (result.kind === 'text') {
        return {resultSummary: summary(result.text, result.verification), evidenceRefs};
      }
      if (result.kind === 'repair_candidate') {
        if (options.repairCandidateVersion !== '1.0') {
          throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Repair candidates are not enabled');
        }
        context.saveCheckpoint('competition-repair-candidate', result);
        return {resultSummary: summary('Plan repair candidate is ready for local preview; no plan changes committed', 'unverified'), evidenceRefs};
      }
      if (result.verification !== 'mock' && options.toolCatalog) {
        await options.toolCatalog.assertProposal({taskId, toolName: result.toolName,
          toolVersion: result.toolVersion, arguments: result.arguments,
          deadline: context.deadline, signal: context.signal, revision: proposalRevision,
          firstCloudRequest: pending === undefined && continuation === undefined});
      }
      if (!tools) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Competition tool execution is unavailable');

      const receipt = receipts.find(item => item.proposal.proposalId === result.proposalId);
      if (receipt) {
        if (!isDeepStrictEqual(receipt.proposal, result)) {
          throw new ProtocolError('REVISION_CONFLICT', 'Competition proposal identity conflict');
        }
        continuation = receipt.continuation;
        pending = undefined;
        context.saveCheckpoint('competition-loop', {step: step + 1, continuation, evidenceRefs, receipts});
        consumeCompetitionCloudReceipt(runtime, taskId);
        continue;
      }

      // A new execution needs one further exchange to deliver its result. Do
      // not consume approval or perform a tool action that cannot be continued.
      if (step >= maxSteps) {
        throw new ProtocolError('TIMEOUT', 'Competition has no remaining tool continuation step');
      }

      const runId = `competition-tool-${taskId}-${step}`;
      const inputRevision=pending===undefined?proposalRevision:saved?.pendingRevision??proposalRevision;
      // This is a parsed proposal, not a receipt or permission. Trusted host
      // preflight readers must be able to verify it before any grant/execution.
      context.saveCheckpoint('competition-loop', {step, continuation, pending: result,pendingRevision:inputRevision,evidenceRefs, receipts});
      consumeCompetitionCloudReceipt(runtime, taskId);
      const worker=options.workerCapabilities?.accepts(result)?options.workerCapabilities:undefined;
      if(result.verification!=='mock') {
        try {await options.prepareCompetitionToolExport?.({phase:'preflight',taskId,proposal:structuredClone(result),deadline:context.deadline,signal:context.signal});}
        catch {
          if(context.signal.aborted)throw new ProtocolError('CANCELLED','Export preflight cancelled');
          if(Date.now()>=Date.parse(context.deadline))throw new ProtocolError('TIMEOUT','Export preflight expired');
          throw new ProtocolError('UNAUTHORIZED','Native export preflight denied');
        }
      }
      if(context.signal.aborted || runtime.getTask(taskId).cancelRequested)throw new ProtocolError('CANCELLED','Export preflight cancelled');
      if(Date.now()>=Date.parse(context.deadline))throw new ProtocolError('TIMEOUT','Export preflight expired');
      const exportBinding=worker?undefined:requireExportBinding(result,taskId,tools,options.toolExports,
        options.toolCatalog!==undefined,'preflight',undefined,context.signal);
      const workerResult=worker?await worker.dispatch(result,{...context,revision:inputRevision}):undefined;
      const toolResult: ToolInvocationResult = workerResult??await tools.invoke({
        toolName: result.toolName,
        toolVersion: result.toolVersion,
        arguments: result.arguments,
        taskId,
        runId,
        authorizationRef: runId,
        deadline: context.deadline,
        signal: context.signal,
      });
      evidenceRefs = [...new Set([...evidenceRefs, ...toolResult.evidenceRefs])];
      if (toolResult.state === 'pending') {
        return {resultSummary: 'Competition tool is awaiting local approval', evidenceRefs};
      }
      if (toolResult.state === 'unknown') {
        return {resultSummary: 'Competition tool result requires reconciliation', evidenceRefs};
      }
      let exportedResult: unknown = toolResult.result ?? null;
      if (result.verification !== 'mock' && !workerResult) {
        if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Competition result export cancelled');
        try {
          await options.prepareCompetitionToolExport?.({phase:'projection',taskId,proposal:structuredClone(result),deadline:context.deadline,signal:context.signal});
          exportedResult = await projectResult(exportBinding!, {taskId, proposalId: result.proposalId,
            result: structuredClone(exportedResult), signal: context.signal});
          // Use the existing strict JSON validator: getters, cycles, unsupported
          // values and oversized projections must never reach the cloud adapter.
          const projected = parseCoordinationContinuation({proposalId: result.proposalId,
            state: 'confirmed', result: exportedResult});
          exportedResult = projected.result;
        } catch {
          withholdConfirmedExport(runtime,taskId);
          throw new ProtocolError('UNAUTHORIZED', 'Competition result export denied');
        }
        if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Competition result export cancelled');
      }
      if(workerResult) {
        try {worker!.assertReceiptAllowed(result,workerResult.selection,workerResult.result,{...context,revision:inputRevision});}
        catch(error) {withholdConfirmedExport(runtime,taskId);throw error;}
      }
      continuation = {
        proposalId: result.proposalId,
        state: 'confirmed',
        result: exportedResult,
      };
      receipts.push({proposal: result, continuation,
        runId,...(workerResult?{workerSelection:workerResult.selection,workerRevision:inputRevision}:{}),
        ...(exportBinding ? {exportPolicyVersion: exportBinding.exportPolicyVersion} : {})});
      pending = undefined;
      context.saveCheckpoint('competition-loop', {step: step + 1, continuation, evidenceRefs, receipts});
    }
    throw new ProtocolError('TIMEOUT', `Competition coordination reached maxSteps=${maxSteps}`);
}
