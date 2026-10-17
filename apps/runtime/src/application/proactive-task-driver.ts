import {ProtocolError} from '@personal-agent/contracts';
import {createHash} from 'node:crypto';
import type {TaskSnapshot} from '@personal-agent/contracts';
import type {TaskRuntime, WorkerContext, WorkerResult} from '../index.js';
import type {RuntimeProactiveWorkflowHost} from './proactive-workflow-application.js';

export interface RuntimeProactiveTaskDriver {
  run(): Promise<TaskSnapshot>;
  readonly active: boolean;
}
const fail = (code: string, message: string): never => {throw new ProtocolError(code, message);};

/** One application worker in the original TaskRuntime. Waiting is event-driven, never a scheduler or polling loop. */
export function createRuntimeProactiveTaskDriver(runtime: TaskRuntime, host: RuntimeProactiveWorkflowHost,
  now: () => number = Date.now): RuntimeProactiveTaskDriver {
  let active: Promise<TaskSnapshot> | undefined;
  function needsNewContextBeforeIntent(proposal: Parameters<RuntimeProactiveWorkflowHost['executeProposal']>[0], error: unknown): boolean {
    if (!(error instanceof ProtocolError) || error.code !== 'REVISION_CONFLICT'
      || proposal.originControlRevision !== host.binding.controlRevision) return false;
    const snapshot = host.inspect();
    if (snapshot.session.state.operations[proposal.operationId]
      || runtime.readToolExecutions(host.taskId).some(record => record.evidenceId === proposal.operationId)) return false;
    const refs = proposal.stage === 'laya' || proposal.stage === 'teacher'
      ? (Array.isArray(proposal.arguments.independentQuestions) ? proposal.arguments.independentQuestions.map(value =>
        value && typeof value === 'object' ? (value as {contextRef?: unknown}).contextRef : undefined) : [])
      : [proposal.arguments.contextRef];
    return refs.some(ref => typeof ref === 'string' && snapshot.application.state.contextValidity?.[ref]?.state === 'needs_refresh');
  }
  async function prepare(): Promise<void> {
    const task = runtime.getTask(host.taskId), binding = host.binding;
    if (Date.parse(binding.taskDeadline) <= now()) fail('TIMEOUT', 'Original proactive task deadline expired');
    if (task.cancelRequested || ['succeeded', 'failed', 'cancelled', 'cancelling'].includes(task.state)) fail('CANCELLED', 'Original proactive task cannot be reopened');
    if (task.state !== 'waiting_reconciliation') return;
    const context = {signal: new AbortController().signal, deadline: binding.taskDeadline};
    // A committed-but-unacknowledged response can be consumed from its exact original request.
    // A lost pure-frontier response may be recomputed only with the explicit trusted capability.
    const snapshot = host.inspect();
    for (const [id, request] of Object.entries(snapshot.application.state.requests)) {
      if (request.acknowledged) continue;
      const original = snapshot.session.state.requests[id];
      if (original?.state === 'committed') await host.advance({...context, requestId: id, deadline: request.input.deadline});
      else await host.recoverPendingRequest(id, {signal: context.signal});
    }
    let inspected = host.inspect();
    if (!inspected.session.state.checkpoint || Object.values(inspected.session.state.requests).some(request => request.state !== 'committed')
      || Object.values(inspected.application.state.requests).some(request => !request.acknowledged)) fail('RESULT_UNKNOWN', 'Original signed proactive frontier is not confirmed');
    for (const [operationId, operation] of Object.entries(inspected.session.state.operations)) {
      if (operation.state === 'settled') continue;
      const result = await host.reconcileOperation(operationId, context);
      if (result.state === 'confirmed' || result.state === 'failed') continue;
      // The only non-executed continuation permitted here is an original approval intent.
      // A durable Runtime run always precedes an actual tool call; absence is checked independently.
      let originalApproval = false;
      if (result.state === 'pending' && !result.evidenceRefs.length
        && !runtime.readToolExecutions(host.taskId).some(record => record.evidenceId === operation.invocation.runId)) {
        try {const approval = runtime.getApproval(operation.invocation.authorizationRef);
          originalApproval = approval.taskId === host.taskId && ['pending', 'allowed'].includes(approval.state);
        } catch {/* No original approval is not permission to execute. */}
      }
      if (!originalApproval) fail('RESULT_UNKNOWN', 'Original proactive operation still requires independent readback');
    }
    inspected = host.inspect();
    if (Date.parse(inspected.application.state.binding.taskDeadline) <= now()) fail('TIMEOUT', 'Original proactive task deadline expired during readback');
    const current = runtime.getTask(host.taskId);
    runtime.prepareVerifiedContinuation(host.taskId, current.revision);
  }
  async function worker(context: WorkerContext): Promise<WorkerResult> {
    let generation = 0, wake: (() => void) | undefined;
    const unsubscribe = host.subscribe(() => {generation++; wake?.();});
    const wait = async (observed: number) => {
      if (generation !== observed || context.signal.aborted) return;
      await new Promise<void>(resolve => {
        const finish = () => {wake = undefined; context.signal.removeEventListener('abort', finish); resolve();};
        wake = finish; context.signal.addEventListener('abort', finish, {once: true});
        if (generation !== observed || context.signal.aborted) finish();
      });
    };
    try {
      frontiers: while (!context.signal.aborted && runtime.getTask(host.taskId).state === 'running') {
        const observed = generation;
        let state = host.inspect();
        if (state.application.state.lastResult?.mode !== 'paused') {
          // Resume the exact committed proposal after an original approval; never allocate a new run.
          const proposals = Object.values(state.session.state.proposals).filter(proposal => proposal.originControlRevision === host.binding.controlRevision
            && state.session.state.operations[proposal.operationId]?.state !== 'settled');
          for (const saved of proposals) {
            const proposal = saved as Parameters<RuntimeProactiveWorkflowHost['executeProposal']>[0];
            let result;
            try {result = await host.executeProposal(proposal, {deadline: context.deadline, signal: context.signal});}
            catch (error) {
              if (!context.signal.aborted && runtime.getTask(host.taskId).state === 'running' && needsNewContextBeforeIntent(proposal, error)) {
                // A proven stale reference cannot terminate the ongoing responsibility or create a replacement operation.
                // Wait for an actual source/host event or explicit native control; no automatic repair/retrieval algorithm.
                await wait(observed); continue frontiers;
              }
              if (proposal.originControlRevision >= host.binding.controlRevision) throw error;
              // A native control can revoke execution between frontier delivery and its guarded invocation.
              // If an operation already exists, independently read it; never turn an unknown write into a withdrawal.
              const original = host.inspect().session.state.operations[proposal.operationId];
              if (!original) continue;
              result = await host.reconcileOperation(proposal.operationId, {deadline: context.deadline, signal: context.signal});
            }
            if (result.state === 'unknown' || result.state === 'pending') {
              // Actual ToolGateway normally already selected its original wait state.
              if (runtime.getTask(host.taskId).state === 'running') runtime.transitionTask(host.taskId, 'waiting_reconciliation');
              return {resultSummary: result.state === 'unknown' ? 'Original proactive operation requires readback' : 'Original proactive operation is pending'};
            }
            if (runtime.getTask(host.taskId).state !== 'running') return {resultSummary: 'Original proactive worker is awaiting its bound continuation'};
          }
        }
        state = host.inspect();
        const requestId = 'runtime-proactive-' + createHash('sha256').update(JSON.stringify([host.taskId, host.sessionId,
          host.binding.controlRevision, Object.keys(state.application.state.requests).length + 1])).digest('hex');
        const frontier = await host.advance({requestId, deadline: context.deadline, signal: context.signal});
        if (frontier.proposals.length) continue;
        // Idle, blocked, paused, waiting_user and waiting_device are workflow states, never task success.
        await wait(observed);
      }
      return {resultSummary: 'Original proactive worker stopped through TaskRuntime'};
    } catch (error) {
      if (!context.signal.aborted && runtime.getTask(host.taskId).state === 'running') {
        const state = host.inspect();
        if (Object.values(state.session.state.requests).some(request => request.state === 'pending')
          || Object.values(state.session.state.operations).some(operation => operation.state === 'pending')) {
          runtime.transitionTask(host.taskId, 'waiting_reconciliation');
          return {resultSummary: 'Original proactive request or operation requires readback'};
        }
      }
      throw error;
    } finally {unsubscribe(); wake?.();}
  }
  return {get active() {return active !== undefined;}, run() {
    if (active) return active;
    const execution = (async () => {
      await prepare();
      const task = runtime.getTask(host.taskId);
      if (!['created', 'waiting_approval'].includes(task.state)) fail('REVISION_CONFLICT', 'Original proactive task is not ready to run');
      return runtime.runTask(host.taskId, worker, {deadline: host.binding.taskDeadline, sideEffect: 'local_write', ...(task.state === 'waiting_approval' ? {resume: true} : {})});
    })();
    const tracked = execution.finally(() => {if (active === tracked) active = undefined;});
    active = tracked; return tracked;
  }};
}
