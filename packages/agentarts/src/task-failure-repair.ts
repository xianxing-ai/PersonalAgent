import {
  appendRepairAttempt, decideRepair, emptyRepairTrace, recordOperatorDecision, summarizeRepairFailure,
} from './repair-policy.js';
import type {RepairFailureSummary, RepairTrace} from './repair-policy.js';

/** Checkpoint key stored by the Runtime failure hook. Not a new wire operation. */
export const TASK_FAILURE_REPAIR_CHECKPOINT = 'repair-decision:v1';

export type TaskFailureEffect = 'read' | 'write' | 'none';
export type HostRecoveryState = 'recovered' | 'needs_reconcile' | 'refused' | 'awaiting_approval';

export interface RuntimeTaskFailureNotice {
  readonly taskId: string;
  readonly errorCode?: string;
  readonly httpStatus?: number;
  readonly effect: TaskFailureEffect;
  readonly outcome: 'failed' | 'unknown';
  readonly risk?: 'ordinary' | 'high';
  readonly approvalGranted?: boolean;
  readonly reconciliationOutcome?: 'applied' | 'not_applied' | 'unknown';
  readonly evidenceRefs?: readonly string[];
  readonly occurredAt: string;
  readonly idempotent?: boolean;
  readonly idempotencyKey?: string;
  readonly compensationRef?: string;
}

export interface HostRecoveryReceipt {
  readonly state: HostRecoveryState;
  readonly lockReleased: boolean;
  /** 失败终态不能重开。恢复只表示宿主已经确认效果，不表示原任务继续执行。 */
  readonly taskResumed: false;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export interface TaskFailureRepairRecord {
  readonly version: 1;
  readonly effect: TaskFailureEffect;
  readonly risk: 'ordinary' | 'high';
  readonly trace: RepairTrace;
  readonly recovery: HostRecoveryReceipt;
}

export interface RepairOperatorResult {
  readonly record: TaskFailureRepairRecord;
  readonly accepted: boolean;
  readonly enqueueRead: boolean;
  readonly reason: string;
}

export interface RepairReplayAttachment {
  readonly kind: 'repair_decision';
  readonly attempt: number;
  readonly observedAt: string;
  readonly strategy: string;
  readonly reason: string;
  readonly result: string;
  readonly executedDuringReplay: false;
}

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function evidence(refs: readonly string[] | undefined): readonly string[] {
  return (refs ?? []).filter(ref => typeof ref === 'string' && ref.trim() && ref.length <= 128).slice(0, 8);
}

function priorTrace(value: unknown): RepairTrace {
  if (!plain(value) || value.version !== 1) return emptyRepairTrace();
  const trace = value.trace;
  if (!plain(trace) || trace.version !== 1 || !Array.isArray(trace.attempts)) return emptyRepairTrace();
  try { summarizeRepairFailure(trace as unknown as RepairTrace); return trace as unknown as RepairTrace; }
  catch { return emptyRepairTrace(); }
}

/** F13_N04：只有宿主读回能确认恢复。没有证据、结果未知，都不算锁已释放，也不重开任务。 */
export function confirmF13HostRecovery(input: {
  evidenceRefs?: readonly string[];
  effect: TaskFailureEffect;
  outcome: 'applied' | 'not_applied' | 'unknown' | 'absent';
}, trace: RepairTrace): HostRecoveryReceipt & {readonly trace: RepairTrace} {
  const refs = evidence(input.evidenceRefs);
  if (input.effect === 'read' && input.outcome !== 'unknown') {
    return {state: 'refused', lockReleased: false, taskResumed: false, trace, evidenceRefs: refs, reason: '只读失败，没有需要释放的写入'};
  }
  const known = input.outcome === 'applied' || input.outcome === 'not_applied';
  if (!known || refs.length === 0) {
    return {
      state: 'needs_reconcile', lockReleased: false, taskResumed: false, trace,
      evidenceRefs: refs,
      reason: '宿主还没有确认效果；先查状态，不恢复',
    };
  }
  return {
    state: 'recovered', lockReleased: true, taskResumed: false, trace, evidenceRefs: refs,
    reason: input.outcome === 'applied' ? '宿主确认写入已经生效，不重复执行' : '宿主确认没有写上，可以另作规划',
  };
}

/** 把 Runtime 失败通知变成一条自愈记录。不调用工具，不改任务终态。 */
export function planRuntimeTaskFailure(notice: RuntimeTaskFailureNotice, prior?: unknown): TaskFailureRepairRecord {
  const occurredAt = Number.isFinite(Date.parse(notice.occurredAt)) ? notice.occurredAt : new Date().toISOString();
  const status: 'applied' | 'not_applied' | 'unknown' | undefined = notice.reconciliationOutcome === 'applied' || notice.reconciliationOutcome === 'not_applied'
    ? notice.reconciliationOutcome : notice.outcome === 'unknown' || notice.reconciliationOutcome === 'unknown' ? 'unknown' : undefined;
  const observation = {
    effect: notice.effect,
    outcome: notice.outcome,
    ...(notice.risk ? {risk: notice.risk} : {}),
    ...(notice.approvalGranted === true ? {approvalGranted: true} : {}),
    signal: {
      ...(notice.errorCode ? {code: notice.errorCode} : {}),
      ...(notice.httpStatus === undefined ? {} : {httpStatus: notice.httpStatus}),
    },
    ...(notice.effect === 'write' ? {write: {
      ...(notice.idempotent === undefined ? {} : {idempotent: notice.idempotent}),
      ...(notice.idempotencyKey ? {idempotencyKey: notice.idempotencyKey} : {}),
      ...(notice.compensationRef ? {compensationRef: notice.compensationRef} : {}),
      ...(status ? {status} : {}),
    }} : {}),
    evidenceRefs: evidence(notice.evidenceRefs),
    parentCanReplan: true,
  };
  const trace = appendRepairAttempt(priorTrace(prior), decideRepair(observation, priorTrace(prior), {
    now: () => Date.parse(occurredAt), parentCanReplan: true,
  }));
  const hostOutcome = notice.outcome === 'unknown' || notice.reconciliationOutcome === 'unknown' ? 'unknown'
    : notice.effect === 'read' ? 'not_applied' : status ?? 'absent';
  const recovery = confirmF13HostRecovery({evidenceRefs: observation.evidenceRefs, effect: notice.effect, outcome: hostOutcome}, trace);
  return {version: 1, effect: notice.effect, risk: notice.risk ?? 'ordinary', trace: recovery.trace, recovery};
}

function asRecord(value: unknown): TaskFailureRepairRecord | undefined {
  if (!plain(value) || value.version !== 1) return undefined;
  if (value.effect !== 'read' && value.effect !== 'write' && value.effect !== 'none') return undefined;
  if (value.risk !== 'ordinary' && value.risk !== 'high') return undefined;
  const trace = priorTrace(value);
  if (!plain(value.recovery) || typeof value.recovery.reason !== 'string' || value.recovery.taskResumed !== false) return undefined;
  const state = value.recovery.state;
  if (state !== 'recovered' && state !== 'needs_reconcile' && state !== 'refused' && state !== 'awaiting_approval') return undefined;
  return {
    version: 1,
    effect: value.effect,
    risk: value.risk,
    trace,
    recovery: {
      state, lockReleased: value.recovery.lockReleased === true, taskResumed: false,
      reason: value.recovery.reason, evidenceRefs: evidence(Array.isArray(value.recovery.evidenceRefs) ? value.recovery.evidenceRefs as string[] : []),
    },
  };
}

/** 手动重试、放弃或交给父 agent。高风险没有批准时不产生新的只读任务。 */
export function applyRepairOperatorChoice(stored: unknown, choice: {readonly action: 'retry' | 'abandon' | 'replan'; readonly approved?: boolean}, observedAt: string): RepairOperatorResult {
  const record = asRecord(stored);
  if (!record) {
    const empty = planRuntimeTaskFailure({taskId: 'unknown', effect: 'none', outcome: 'failed', occurredAt: observedAt});
    return {record: empty, accepted: false, enqueueRead: false, reason: '没有可处理的失败记录'};
  }
  const summary = summarizeRepairFailure(record.trace);
  const blocked = record.risk === 'high' && choice.approved !== true && choice.action !== 'abandon';
  if (blocked) {
    const trace = recordOperatorDecision(record.trace, {
      strategy: choice.action === 'replan' ? 'request_parent_replan' : 'backoff_retry',
      reason: '高风险动作需要原有授权通过后才能继续',
      effect: record.effect, classification: summary.classification ?? 'unrecoverable', observedAt,
      risk: 'high', requiresApproval: true, evidenceRefs: record.recovery.evidenceRefs,
    });
    return {
      record: {...record, trace, recovery: {...record.recovery, state: 'awaiting_approval', reason: '高风险动作需要原有授权通过后才能继续'}},
      accepted: false, enqueueRead: false, reason: '高风险动作需要原有授权通过后才能继续',
    };
  }
  if (choice.action === 'abandon') {
    const trace = recordOperatorDecision(record.trace, {
      strategy: 'stop', reason: '操作者放弃', effect: record.effect,
      classification: summary.classification ?? 'unrecoverable', observedAt, risk: record.risk,
      evidenceRefs: record.recovery.evidenceRefs,
    });
    return {record: {...record, trace, recovery: {...record.recovery, state: 'refused', reason: '操作者放弃'}}, accepted: true, enqueueRead: false, reason: '已放弃'};
  }
  if (choice.action === 'replan') {
    const trace = recordOperatorDecision(record.trace, {
      strategy: 'request_parent_replan', reason: '操作者交给父 agent 重新规划', effect: record.effect,
      classification: summary.classification ?? 'correctable', observedAt, risk: record.risk,
      evidenceRefs: record.recovery.evidenceRefs,
    });
    return {record: {...record, trace}, accepted: true, enqueueRead: false, reason: '已交给父 agent 重新规划'};
  }
  if (record.effect !== 'read' || record.recovery.state === 'needs_reconcile') {
    return {record, accepted: false, enqueueRead: false, reason: record.effect === 'write' ? '写入不在这里重试' : '宿主还没有确认效果；先查状态，不恢复'};
  }
  const trace = recordOperatorDecision(record.trace, {
    strategy: 'backoff_retry', reason: '操作者重试只读', effect: 'read',
    classification: summary.classification ?? 'transient', observedAt, risk: record.risk, executable: true,
    evidenceRefs: record.recovery.evidenceRefs,
  });
  return {record: {...record, trace}, accepted: true, enqueueRead: true, reason: '将重新提交一次只读'};
}

export interface RepairCardView {
  readonly classification: RepairFailureSummary['classification'];
  readonly effect: TaskFailureEffect;
  readonly risk: 'ordinary' | 'high';
  readonly awaitingApproval: boolean;
  readonly abandoned: boolean;
  readonly canRetryRead: boolean;
  readonly canReplan: boolean;
  readonly canAbandon: boolean;
  readonly recovery: HostRecoveryReceipt;
  readonly attempts: readonly {readonly attempt: number; readonly observedAt: string; readonly strategy: string; readonly reason: string; readonly result: string}[];
  readonly replay: {readonly executedDuringReplay: false; readonly actualToolCalls: 0; readonly actualWrites: 0};
}

/** 给界面的最小投影。没有预算、统计或原始参数。 */
export function repairCardView(stored: unknown): RepairCardView | undefined {
  const record = asRecord(stored);
  if (!record) return undefined;
  const summary = summarizeRepairFailure(record.trace);
  const awaitingApproval = summary.awaitingApproval || record.recovery.state === 'awaiting_approval' || record.risk === 'high';
  const abandoned = summary.lastStrategy === 'stop';
  return {
    classification: summary.classification,
    effect: record.effect,
    risk: record.risk,
    awaitingApproval,
    abandoned,
    canRetryRead: record.effect === 'read' && !awaitingApproval && !abandoned && record.recovery.state !== 'needs_reconcile',
    canReplan: !awaitingApproval && !abandoned,
    canAbandon: !abandoned,
    recovery: record.recovery,
    attempts: record.trace.attempts.map(attempt => ({
      attempt: attempt.attempt, observedAt: attempt.observedAt, strategy: attempt.strategy, reason: attempt.reason, result: attempt.result,
    })),
    replay: {executedDuringReplay: false, actualToolCalls: 0, actualWrites: 0},
  };
}

/** 把自愈记录附在既有 trace replay 后面。不增加工具、模型或写入次数。 */
export function attachRepairTraceToReplay<T extends {readonly timeline: readonly unknown[]; readonly actualToolCalls: number; readonly actualWrites?: number}>(
  replay: T, repairTrace: RepairTrace,
): T & {readonly timeline: readonly unknown[]; readonly repairSummary: RepairFailureSummary; readonly repairTimeline: readonly RepairReplayAttachment[]} {
  const summary = summarizeRepairFailure(repairTrace);
  const repairTimeline = repairTrace.attempts.map(attempt => ({
    kind: 'repair_decision' as const,
    attempt: attempt.attempt,
    observedAt: attempt.observedAt,
    strategy: attempt.strategy,
    reason: attempt.reason,
    result: attempt.result,
    executedDuringReplay: false as const,
  }));
  return {...replay, timeline: [...replay.timeline, ...repairTimeline], repairSummary: summary, repairTimeline,
    actualToolCalls: replay.actualToolCalls, ...(replay.actualWrites === undefined ? {} : {actualWrites: replay.actualWrites})};
}
