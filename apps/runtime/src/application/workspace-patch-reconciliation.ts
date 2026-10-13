import {ProtocolError} from '@personal-agent/contracts';
import type {TaskSnapshot} from '@personal-agent/contracts';
import type {TaskRuntime, ToolExecutionRecord} from '../index.js';
import {isDeepStrictEqual} from 'node:util';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {CoordinationToolProposalResult} from '@personal-agent/coordination';

export const WORKSPACE_PATCH_APPLY_TOOL_NAME = 'workspace.apply_text_patch';
export const WORKSPACE_PATCH_APPLY_TOOL_VERSION = '1.0.0';

export type WorkspacePatchReconciliationResult =
  | {path: string; state: 'clear'}
  | {path: string; state: 'in_progress'; runId: string; argumentsDigest: string; pid: number; beforeSha256: string; afterSha256: string}
  | {path: string; state: 'reconciled'; runId: string; argumentsDigest: string;
    outcome: 'applied' | 'not_applied' | 'unknown'; beforeSha256: string; afterSha256: string; currentSha256: string;
    byteLength?: number};

/**
 * Trusted Desktop composition owns the roots, ACL checks and process identity
 * query. Runtime receives only the original relative source path from the
 * persisted host intent; it cannot receive a PID or a recovery directory.
 */
export interface WorkspacePatchReconciliationPort {
  readonly bindingId: string;
  reconcile(input: {relativePath: string; expectedRunId: string; expectedArgumentsDigest: string;
    expectedBeforeSha256: string; retainMarker?: boolean}): Promise<WorkspacePatchReconciliationResult>;
}

export interface WorkspacePatchReconciliationReadback {
  taskId: string;
  runId: string;
  result: WorkspacePatchReconciliationResult;
  task: TaskSnapshot;
  evidence: import('@personal-agent/contracts').ProtocolContracts['evidence'][];
}

interface HostToolIntent {
  namespace: string;
  commandId: string;
  toolName: string;
  toolVersion: string;
  arguments: Record<string, unknown> & {path: string; expectedSha256: string};
  deadline: string;
  argumentsDigest: string;
  workspaceBindingId: string;
}

const COMPETITION_PATCH_RUN = 'competition-workspace-patch-run';
const competitionIntentKey = (runId: string): string => 'competition-workspace-patch:' + runId;
const competitionAcknowledgementKey = (runId: string): string => 'competition-workspace-patch-ack:' + runId;
interface CompetitionPatchIntent {
  taskId: string;
  runId: string;
  namespace: string;
  workspaceBindingId: string;
  argumentsDigest: string;
  configurationRef: string;
  step: number;
  proposalRevision: number;
  proposal: CoordinationToolProposalResult;
}
interface PatchIntent extends HostToolIntent {runId: string; competition?: CompetitionPatchIntent}
interface CompetitionLoop {
  step: number;
  pending?: CoordinationToolProposalResult;
  pendingRevision?: number;
  receipts?: {proposal: CoordinationToolProposalResult; runId?: string}[];
}

function validArguments(value: unknown): value is HostToolIntent['arguments'] {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).path === 'string'
    && isHash((value as Record<string, unknown>).expectedSha256);
}

function invalid(message: string): never {
  throw new ProtocolError('REVISION_CONFLICT', message);
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function validateResult(value: unknown): WorkspacePatchReconciliationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch reconciliation returned an invalid result');
  }
  const result = value as Record<string, unknown>;
  if (typeof result.path !== 'string' || result.path.length < 1 || result.path.length > 1024
    || result.path.includes('\\') || result.path.startsWith('/') || result.path.includes('\0')) {
    throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch reconciliation returned an invalid path');
  }
  if (result.state === 'clear') return {path: result.path, state: 'clear'};
  if (result.state === 'in_progress') {
    if (typeof result.runId !== 'string' || !result.runId.trim() || !isHash(result.argumentsDigest)
      || !Number.isSafeInteger(result.pid) || (result.pid as number) < 1
      || !isHash(result.beforeSha256) || !isHash(result.afterSha256)) {
      throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch process identity is invalid');
    }
    return {path: result.path, state: 'in_progress', runId: result.runId as string,
      argumentsDigest: result.argumentsDigest as string, pid: result.pid as number,
      beforeSha256: result.beforeSha256, afterSha256: result.afterSha256};
  }
  if (result.state === 'reconciled' && ['applied', 'not_applied', 'unknown'].includes(String(result.outcome))
    && typeof result.runId === 'string' && !!result.runId.trim() && isHash(result.argumentsDigest)
    && isHash(result.beforeSha256) && isHash(result.afterSha256) && isHash(result.currentSha256)) {
    if (result.byteLength !== undefined && (!Number.isSafeInteger(result.byteLength) || (result.byteLength as number) < 0)) {
      throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch readback length is invalid');
    }
    return {path: result.path, state: 'reconciled', runId: result.runId,
      argumentsDigest: result.argumentsDigest, outcome: result.outcome as 'applied' | 'not_applied' | 'unknown',
      beforeSha256: result.beforeSha256, afterSha256: result.afterSha256, currentSha256: result.currentSha256,
      ...(result.byteLength === undefined ? {} : {byteLength: result.byteLength as number})};
  }
  throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch reconciliation returned an invalid state');
}

function readIntent(runtime: TaskRuntime, taskId: string, expectedNamespace: string | undefined,
  expectedBindingId: string, expectedRunId?: string, expectedConfigurationRef?: string): PatchIntent {
  const value = runtime.loadCheckpoint(taskId, 'host-tool-intent');
  if (value === undefined) return readCompetitionIntent(runtime, taskId, expectedNamespace, expectedBindingId, expectedRunId, expectedConfigurationRef);
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Workspace patch host intent is missing');
  const intent = value as HostToolIntent;
  if ((expectedNamespace !== undefined && intent.namespace !== expectedNamespace)
    || intent.workspaceBindingId !== expectedBindingId || !isHash(intent.workspaceBindingId)
    || !isHash(intent.argumentsDigest) || !validArguments(intent.arguments)
    || intent.toolName !== WORKSPACE_PATCH_APPLY_TOOL_NAME
    || intent.toolVersion !== WORKSPACE_PATCH_APPLY_TOOL_VERSION
    || !intent.arguments || typeof intent.arguments !== 'object' || Array.isArray(intent.arguments)
    || typeof intent.arguments.path !== 'string') {
    invalid('Task is not a workspace patch apply task at the supported version');
  }
  return {...intent, runId: `host-tool-${taskId}`};
}

function readCompetitionIntent(runtime: TaskRuntime, taskId: string, namespace: string | undefined,
  bindingId: string, expectedRunId?: string, expectedConfigurationRef?: string): PatchIntent {
  const loop = runtime.loadCheckpoint(taskId, 'competition-loop') as CompetitionLoop | undefined;
  const runId = expectedRunId ?? (loop?.pending?.toolName === WORKSPACE_PATCH_APPLY_TOOL_NAME
    ? `competition-tool-${taskId}-${loop.step}` : runtime.loadCheckpoint(taskId, COMPETITION_PATCH_RUN));
  if (typeof runId !== 'string') invalid('Original Competition patch binding is missing');
  const intent = runtime.loadCheckpoint(taskId, competitionIntentKey(runId)) as CompetitionPatchIntent | undefined;
  if (!intent || !loop || runtime.loadCheckpoint(taskId, 'application-profile') !== 'huawei_ict_agentarts'
    || intent.taskId !== taskId || intent.runId !== runId || intent.namespace !== (namespace ?? '')
    || intent.workspaceBindingId !== bindingId || !isHash(bindingId)
    || intent.configurationRef !== expectedConfigurationRef
    || !Number.isSafeInteger(intent.step) || intent.step < 1 || runId !== `competition-tool-${taskId}-${intent.step}`
    || !Number.isSafeInteger(intent.proposalRevision) || intent.proposalRevision < 1
    || intent.proposal?.kind !== 'tool_proposal' || intent.proposal.toolName !== WORKSPACE_PATCH_APPLY_TOOL_NAME
    || intent.proposal.toolVersion !== WORKSPACE_PATCH_APPLY_TOOL_VERSION || !validArguments(intent.proposal.arguments)
    || intent.argumentsDigest !== toolArgumentsDigest(intent.proposal.arguments)) {
    invalid('Competition patch binding changed or was not recorded before execution');
  }
  const pendingMatches = loop.step === intent.step && loop.pendingRevision === intent.proposalRevision
    && isDeepStrictEqual(loop.pending, intent.proposal);
  const receiptMatches = Array.isArray(loop.receipts) && loop.receipts.some(receipt => receipt.runId === runId
    && isDeepStrictEqual(receipt.proposal, intent.proposal));
  if (!pendingMatches && !receiptMatches) invalid('Competition patch proposal no longer matches its original revision');
  return {namespace: intent.namespace, commandId: intent.proposal.proposalId, toolName: intent.proposal.toolName,
    toolVersion: intent.proposal.toolVersion, arguments: intent.proposal.arguments,
    deadline: '', argumentsDigest: intent.argumentsDigest, workspaceBindingId: intent.workspaceBindingId,
    runId, competition: intent};
}

function competitionToolResult(result: WorkspacePatchReconciliationResult): Record<string, unknown> {
  if (result.state !== 'reconciled' || result.outcome !== 'applied' || result.currentSha256 !== result.afterSha256
    || result.byteLength === undefined) throw new ProtocolError('RESULT_UNKNOWN', 'Complete patch readback is required for continuation');
  return {path: result.path, beforeSha256: result.beforeSha256, afterSha256: result.afterSha256,
    byteLength: result.byteLength, changed: result.beforeSha256 !== result.afterSha256, applied: true};
}

function readRecord(runtime: TaskRuntime, taskId: string, runId: string): ToolExecutionRecord {
  const record = runtime.readToolExecutions(taskId).find(item => item.evidenceId === runId);
  if (!record || record.taskId !== taskId || record.toolName !== WORKSPACE_PATCH_APPLY_TOOL_NAME
    || record.toolVersion !== WORKSPACE_PATCH_APPLY_TOOL_VERSION) {
    invalid('Workspace patch execution record is missing or mismatched');
  }
  if (record.policyDecision !== 'allow' || record.executionStarted !== true) {
    throw new ProtocolError('UNAUTHORIZED', 'Workspace patch execution was not authorized by Runtime');
  }
  return record;
}

function assertBoundResult(result: WorkspacePatchReconciliationResult, intent: HostToolIntent,
  runId: string): void {
  if (result.path !== intent.arguments.path || (result.state !== 'clear' && (result.runId !== runId
    || result.argumentsDigest !== intent.argumentsDigest
    || result.beforeSha256 !== intent.arguments.expectedSha256))) {
    throw new ProtocolError('REVISION_CONFLICT', 'Workspace patch marker does not match the original workspace, run, input and source hash');
  }
}

function sameReconciledResult(left: WorkspacePatchReconciliationResult,
  right: WorkspacePatchReconciliationResult): boolean {
  return left.state === 'reconciled' && right.state === 'reconciled'
    && left.path === right.path && left.runId === right.runId
    && left.argumentsDigest === right.argumentsDigest && left.outcome === right.outcome
    && left.beforeSha256 === right.beforeSha256 && left.afterSha256 === right.afterSha256
    && left.currentSha256 === right.currentSha256 && left.byteLength === right.byteLength;
}

function savedResult(runtime: TaskRuntime, taskId: string, runId: string,
  intent: HostToolIntent, record: ToolExecutionRecord): WorkspacePatchReconciliationResult | undefined {
  if (!record.reconciliationOutcome) return undefined;
  const checkpoint = runtime.loadCheckpoint(taskId, 'tool-reconciliation-' + runId) as {result?: unknown} | undefined;
  if (!checkpoint || checkpoint.result === undefined) {
    throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch reconciliation checkpoint is missing');
  }
  const result = validateResult(checkpoint.result);
  assertBoundResult(result, intent, runId);
  if (result.state !== 'reconciled' || result.outcome !== record.reconciliationOutcome) {
    throw new ProtocolError('REVISION_CONFLICT', 'Workspace patch reconciliation checkpoint is mismatched');
  }
  return result;
}

export class WorkspacePatchReconciliationAdapter {
  private readonly active = new Map<string, Promise<WorkspacePatchReconciliationReadback>>();

  constructor(private readonly runtime: TaskRuntime, private readonly port: WorkspacePatchReconciliationPort,
    private readonly namespace?: string, private readonly configurationRef = 'runtime-configured-coordination') {}

  get bindingId(): string { return this.port.bindingId; }
  get activeCount(): number { return this.active.size; }
  isReconciling(taskId: string): boolean { return this.active.has(taskId); }

  private readIntent(taskId: string, runId?: string): PatchIntent {
    return readIntent(this.runtime, taskId, this.namespace, this.port.bindingId, runId, this.configurationRef);
  }

  /** Called by the trusted tool wrapper before approval or the first execution. */
  bindCompetitionInvocation(input: {taskId: string; runId: string; toolVersion: string; arguments: Record<string, unknown>}): void {
    const loop = this.runtime.loadCheckpoint(input.taskId, 'competition-loop') as CompetitionLoop | undefined;
    if (!loop || !Number.isSafeInteger(loop.step) || loop.step < 1
      || !Number.isSafeInteger(loop.pendingRevision) || loop.pendingRevision! < 1
      || input.runId !== `competition-tool-${input.taskId}-${loop.step}`
      || loop.pending?.toolName !== WORKSPACE_PATCH_APPLY_TOOL_NAME || loop.pending.toolVersion !== input.toolVersion
      || !isDeepStrictEqual(loop.pending.arguments, input.arguments) || !validArguments(input.arguments)) {
      invalid('Workspace patch execution is not bound to the original Competition proposal');
    }
    const intent: CompetitionPatchIntent = {taskId: input.taskId, runId: input.runId, namespace: this.namespace ?? '',
      workspaceBindingId: this.port.bindingId, configurationRef: this.configurationRef, argumentsDigest: toolArgumentsDigest(input.arguments),
      step: loop.step, proposalRevision: loop.pendingRevision!, proposal: structuredClone(loop.pending)};
    const prior = this.runtime.loadCheckpoint(input.taskId, competitionIntentKey(input.runId));
    if (prior !== undefined) {
      if (!isDeepStrictEqual(prior, intent)) invalid('Original Competition workspace or proposal binding changed');
    } else {
      if (this.runtime.readToolExecutions(input.taskId).some(record => record.evidenceId === input.runId)) {
        invalid('Cannot reconstruct a missing workspace binding after execution');
      }
      this.runtime.saveCheckpoint(input.taskId, competitionIntentKey(input.runId), intent);
    }
    this.runtime.saveCheckpoint(input.taskId, COMPETITION_PATCH_RUN, input.runId);
    this.readIntent(input.taskId, input.runId);
    const record = this.runtime.readToolExecutions(input.taskId).find(item => item.evidenceId === input.runId);
    if (record?.reconciliationOutcome === 'applied') this.assertConfirmedCompetitionResult(input.taskId, input.runId);
  }

  /** A crash between raw reconciliation and ordinary result persistence must not resume the cloud loop. */
  assertConfirmedCompetitionResult(taskId: string, runId: string, requireAcknowledgement = true): void {
    const intent = this.readIntent(taskId, runId);
    const record = readRecord(this.runtime, taskId, runId);
    if (!intent.competition || record.reconciliationOutcome !== 'applied') return;
    const result = savedResult(this.runtime, taskId, runId, intent, record);
    const cached = this.runtime.loadCheckpoint(taskId, 'tool-result-' + runId) as {result?: unknown} | undefined;
    if (!result || !isDeepStrictEqual(cached?.result, competitionToolResult(result))) {
      throw new ProtocolError('RESULT_UNKNOWN', 'Original patch result persistence is incomplete');
    }
    if (requireAcknowledgement && !isDeepStrictEqual(
      this.runtime.loadCheckpoint(taskId, competitionAcknowledgementKey(runId)), {inputDigest: record.inputDigest, result})) {
      throw new ProtocolError('RESULT_UNKNOWN', 'Original patch marker acknowledgement is incomplete');
    }
  }

  isPatchTask(taskId: string): boolean {
    try { return this.readIntent(taskId).toolName === WORKSPACE_PATCH_APPLY_TOOL_NAME; }
    catch { return false; }
  }

  reconcile(taskId: string): Promise<WorkspacePatchReconciliationReadback> {
    const prior = this.active.get(taskId);
    if (prior) return prior;
    const execution = Promise.resolve().then(async () => {
      const task = this.runtime.getTask(taskId);
      const intent = this.readIntent(taskId);
      const runId = intent.runId;
      const record = readRecord(this.runtime, taskId, runId);
      if (!this.runtime.matchesToolExecutionInput(record, {arguments: intent.arguments, scopeRef: runId})) {
        invalid('Workspace patch intent changed after execution');
      }
      const priorResult = savedResult(this.runtime, taskId, runId, intent, record);
      if (priorResult) {
        this.persistCompetitionResult(taskId, intent, priorResult);
        await this.acknowledge(intent, runId, priorResult);
        return {taskId, runId, result: priorResult, task: this.runtime.getTask(taskId),
          evidence: this.runtime.readEvidence(taskId)};
      }
      if (task.state !== 'waiting_reconciliation') {
        throw new ProtocolError('REVISION_CONFLICT', 'Workspace patch task is not waiting for reconciliation');
      }
      if (record.state !== 'started' && record.state !== 'unknown') {
        throw new ProtocolError('REVISION_CONFLICT', 'Workspace patch execution is not recoverable');
      }
      if (!this.runtime.matchesToolExecutionInput(record, {arguments: intent.arguments, scopeRef: runId})) {
        throw new ProtocolError('REVISION_CONFLICT', 'Workspace patch intent changed after execution');
      }
      const reconciliationInput = {relativePath: intent.arguments.path, expectedRunId: runId,
        expectedArgumentsDigest: intent.argumentsDigest, expectedBeforeSha256: intent.arguments.expectedSha256};
      let result: WorkspacePatchReconciliationResult;
      try {
        result = validateResult(await this.port.reconcile({...reconciliationInput, retainMarker: true}));
        assertBoundResult(result, intent, runId);
        if (this.runtime.getTask(taskId).revision !== task.revision
          || !isDeepStrictEqual(this.readIntent(taskId, runId), intent)
          || !isDeepStrictEqual(readRecord(this.runtime, taskId, runId), record)) {
          invalid('Workspace patch task, proposal or execution changed during readback');
        }
      } catch (error) {
        const concurrent = this.runtime.readToolExecutions(taskId).find(item => item.evidenceId === runId);
        const concurrentResult = concurrent && savedResult(this.runtime, taskId, runId, intent, concurrent);
        if (concurrentResult) {
          this.readIntent(taskId, runId);
          this.persistCompetitionResult(taskId, intent, concurrentResult);
          await this.acknowledge(intent, runId, concurrentResult);
          return {taskId, runId, result: concurrentResult, task: this.runtime.getTask(taskId),
            evidence: this.runtime.readEvidence(taskId)};
        }
        throw error;
      }
      if (result.state === 'clear') {
        throw new ProtocolError('REVISION_CONFLICT', 'Workspace patch marker is absent; result remains unreconciled');
      }
      if (result.state === 'in_progress') {
        return {taskId, runId, result, task: this.runtime.getTask(taskId), evidence: this.runtime.readEvidence(taskId)};
      }
      if (result.state === 'reconciled' && result.outcome === 'unknown') {
        // An unknown poll is an observation, not an outcome: Runtime persists nothing and
        // the task keeps waiting for a later verified host readback.
        return {taskId, runId, result, task: this.runtime.getTask(taskId), evidence: this.runtime.readEvidence(taskId)};
      }
      if (intent.competition) {
        if (result.currentSha256 !== (result.outcome === 'applied' ? result.afterSha256 : result.beforeSha256)) {
          throw new ProtocolError('RESULT_UNKNOWN', 'Patch outcome does not match the independently read source hash');
        }
        if (result.outcome === 'applied' && (task.cancelRequested || result.byteLength === undefined)) {
          // The core completion API cannot project a cancelled applied workflow without
          // completing it. Keep the marker and original task until that can be proved safely.
          return {taskId, runId, result, task: this.runtime.getTask(taskId), evidence: this.runtime.readEvidence(taskId)};
        }
      }
      const nextTask = this.runtime.reconcileToolExecution(taskId, runId, result.outcome, result, [],
        intent.competition && result.outcome === 'applied' ? {deferTaskCompletion: true} : {});
      const persistedRecord = this.runtime.readToolExecutions(taskId).find(item => item.evidenceId === runId);
      const persisted = persistedRecord && savedResult(this.runtime, taskId, runId, intent, persistedRecord);
      if (!persisted || !sameReconciledResult(result, persisted)) {
        throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch reconciliation persistence could not be read back');
      }
      this.persistCompetitionResult(taskId, intent, persisted);
      await this.acknowledge(intent, runId, persisted);
      return {taskId, runId, result: persisted, task: nextTask, evidence: this.runtime.readEvidence(taskId)};
    }).finally(() => this.active.delete(taskId));
    this.active.set(taskId, execution);
    return execution;
  }

  private persistCompetitionResult(taskId: string, intent: PatchIntent, result: WorkspacePatchReconciliationResult): void {
    if (!intent.competition || result.state !== 'reconciled' || result.outcome !== 'applied') return;
    const output = competitionToolResult(result);
    const cached = this.runtime.loadCheckpoint(taskId, 'tool-result-' + intent.runId) as {result?: unknown} | undefined;
    if (!isDeepStrictEqual(cached?.result, output)) this.runtime.saveCheckpoint(taskId, 'tool-result-' + intent.runId, {result: output});
    this.assertConfirmedCompetitionResult(taskId, intent.runId, false);
  }

  private async acknowledge(intent: PatchIntent, runId: string,
    expected: WorkspacePatchReconciliationResult): Promise<void> {
    if (intent.competition) {
      const taskId = intent.competition.taskId;
      const record = readRecord(this.runtime, taskId, runId);
      if (isDeepStrictEqual(this.runtime.loadCheckpoint(taskId, competitionAcknowledgementKey(runId)),
        {inputDigest: record.inputDigest, result: expected})) return;
    }
    const result = validateResult(await this.port.reconcile({relativePath: intent.arguments.path,
      expectedRunId: runId, expectedArgumentsDigest: intent.argumentsDigest,
      expectedBeforeSha256: intent.arguments.expectedSha256}));
    assertBoundResult(result, intent, runId);
    if (result.state !== 'clear' && !sameReconciledResult(result, expected)) {
      throw new ProtocolError('REVISION_CONFLICT', 'Workspace patch marker changed after Runtime persisted its outcome');
    }
    if (intent.competition) {
      const taskId = intent.competition.taskId;
      if (!isDeepStrictEqual(this.readIntent(taskId, runId), intent)) invalid('Original patch binding changed during acknowledgement');
      const record = readRecord(this.runtime, taskId, runId);
      if (!this.runtime.matchesToolExecutionInput(record, {arguments: intent.arguments, scopeRef: runId})
        || !isDeepStrictEqual(savedResult(this.runtime, taskId, runId, intent, record), expected)) {
        invalid('Original patch record changed during acknowledgement');
      }
      this.runtime.saveCheckpoint(taskId, competitionAcknowledgementKey(runId), {inputDigest: record.inputDigest, result: expected});
    }
  }
}
