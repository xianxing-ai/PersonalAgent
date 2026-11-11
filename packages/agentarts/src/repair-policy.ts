import {ProtocolError} from '@personal-agent/contracts';

/**
 * 失败后的自愈决策。本模块不调用工具、不签发授权、不写外部状态。
 * 它只分类失败、选出下一次策略，并把每次尝试记入可回放的 trace。
 * 父 agent 的重新规划由调用方（crew 父）执行；高风险重试必须带着已有批准进来。
 */
export const REPAIR_TRACE_VERSION = 1 as const;
export const DEFAULT_REPAIR_MAX_ATTEMPTS = 4;
export const DEFAULT_REPAIR_BASE_DELAY_MS = 200;
export const DEFAULT_REPAIR_MAX_DELAY_MS = 8_000;
export const DEFAULT_REPAIR_MAX_ELAPSED_MS = 60_000;

export type FailureClass = 'transient' | 'correctable' | 'unrecoverable';
export type RepairEffect = 'read' | 'write' | 'none';
export type RepairRisk = 'ordinary' | 'high';
export type RepairStrategy =
  | 'backoff_retry'
  | 'change_arguments'
  | 'change_tool'
  | 'degrade_readonly'
  | 'request_parent_replan'
  | 'reconcile_status'
  | 'stop';
export type RepairAttemptResult = 'selected' | 'awaiting_approval' | 'held_for_backoff' | 'stopped' | 'reconcile';
export type WriteStatus = 'applied' | 'not_applied' | 'unknown';

export interface FailureSignal {
  readonly code?: string;
  readonly message?: string;
  readonly httpStatus?: number;
  readonly retryable?: boolean;
  readonly parameterError?: boolean;
  readonly selectorMiss?: boolean;
  readonly permissionInsufficient?: boolean;
}

export interface RepairWriteFacts {
  readonly idempotent?: boolean;
  readonly idempotencyKey?: string;
  readonly compensationRef?: string;
  readonly status?: WriteStatus;
}

export interface RepairAlternatives {
  readonly arguments?: readonly {readonly digest: string; readonly label?: string}[];
  readonly tools?: readonly {readonly name: string; readonly version?: string}[];
  readonly readOnlyFallback?: {readonly toolName: string; readonly argumentsDigest: string};
}

export interface RepairObservation {
  readonly effect: RepairEffect;
  readonly outcome: 'failed' | 'unknown';
  readonly risk?: RepairRisk;
  /** 宿主已经批准这一次重试。本模块不会自己签发批准。 */
  readonly approvalGranted?: boolean;
  readonly signal?: FailureSignal;
  /** 只读失败可以被重新考虑的宿主证明。单独出现不等于重试决定。 */
  readonly retrySafe?: boolean;
  readonly write?: RepairWriteFacts;
  readonly alternatives?: RepairAlternatives;
  readonly parentCanReplan?: boolean;
  readonly evidenceRefs?: readonly string[];
  readonly stepsUsed?: number;
  readonly tokensUsed?: number;
}

export interface RepairPolicyOptions {
  readonly now?: () => number;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly maxElapsedMs?: number;
  readonly maxSteps?: number;
  readonly maxTokens?: number;
  readonly parentCanReplan?: boolean;
}

export interface RepairAttempt {
  readonly attempt: number;
  readonly observedAt: string;
  readonly classification: FailureClass;
  readonly strategy: RepairStrategy;
  readonly reason: string;
  readonly effect: RepairEffect;
  readonly risk: RepairRisk;
  readonly requiresApproval: boolean;
  readonly executable: boolean;
  readonly delayMs: number;
  readonly result: RepairAttemptResult;
  readonly terminal: boolean;
  readonly budgetExhausted: boolean;
  readonly sideEffectsEmitted: 0;
  readonly fingerprint: string;
  readonly evidenceRefs: readonly string[];
  readonly writeRetrySafe: boolean;
  readonly retryNotBefore?: string;
  readonly toolName?: string;
  readonly alternateDigest?: string;
}

export interface RepairTrace {
  readonly version: typeof REPAIR_TRACE_VERSION;
  readonly attempts: readonly RepairAttempt[];
}

export interface RepairDecision {
  readonly record: boolean;
  readonly observedAt: string;
  readonly classification: FailureClass;
  readonly strategy: RepairStrategy;
  readonly reason: string;
  readonly effect: RepairEffect;
  readonly risk: RepairRisk;
  readonly requiresApproval: boolean;
  readonly executable: boolean;
  readonly delayMs: number;
  readonly result: RepairAttemptResult;
  readonly terminal: boolean;
  readonly budgetExhausted: boolean;
  readonly sideEffectsEmitted: 0;
  readonly fingerprint: string;
  readonly evidenceRefs: readonly string[];
  readonly writeRetrySafe: boolean;
  readonly retryNotBefore?: string;
  readonly toolName?: string;
  readonly alternateDigest?: string;
}

export interface RepairFailureSummary {
  readonly classification: FailureClass | null;
  readonly attemptCount: number;
  readonly strategies: readonly RepairStrategy[];
  readonly terminalReason: string | null;
  readonly lastStrategy: RepairStrategy | null;
  readonly lastResult: RepairAttemptResult | null;
  readonly lastReason: string | null;
  readonly requiresParentReplan: boolean;
  readonly awaitingApproval: boolean;
  readonly unknownWriteBlindRetry: false;
  readonly budgetExhausted: boolean;
  readonly sideEffectsEmitted: 0;
}

export interface RepairReplay {
  readonly version: typeof REPAIR_TRACE_VERSION;
  readonly timeline: readonly (RepairAttempt & {readonly executedDuringReplay: false})[];
  readonly actualToolCalls: 0;
  readonly actualWrites: 0;
  readonly actualModelCalls: 0;
  readonly authority: 'data_only_decision_replay';
  readonly sideEffectsReplayed: false;
  readonly summary: RepairFailureSummary;
}

interface ResolvedPolicy {
  readonly now: () => number;
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxElapsedMs: number;
  readonly maxSteps?: number;
  readonly maxTokens?: number;
}

interface Choice {
  readonly strategy: RepairStrategy;
  readonly reason: string;
  readonly delayMs: number;
  readonly result: RepairAttemptResult;
  readonly terminal: boolean;
  readonly executable: boolean;
  readonly budgetExhausted: boolean;
  readonly retryNotBefore?: string;
  readonly toolName?: string;
  readonly alternateDigest?: string;
}

const TRANSIENT_CODES = new Set([
  'TIMEOUT', 'RATE_LIMITED', 'RATE_LIMIT', 'NETWORK', 'NETWORK_ERROR', 'ECONNRESET', 'ETIMEDOUT',
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE', 'SOCKET_HANG_UP', 'TEMPORARILY_UNAVAILABLE',
]);
const HARD_UNRECOVERABLE = new Set([
  'CANCELLED', 'UNAUTHORIZED', 'NOT_FOUND', 'CONFLICT', 'REVISION_CONFLICT', 'UNSUPPORTED_CAPABILITY',
]);
const CORRECTABLE_CODES = new Set([
  'INVALID_ARGUMENT', 'INVALID_PARAMETER', 'VALIDATION_ERROR', 'BAD_SELECTOR', 'SELECTOR_NOT_FOUND',
  'SELECTOR_STALE', 'PERMISSION_INSUFFICIENT', 'INSUFFICIENT_SCOPE',
]);
const CLASSES = new Set<FailureClass>(['transient', 'correctable', 'unrecoverable']);
const STRATEGIES = new Set<RepairStrategy>([
  'backoff_retry', 'change_arguments', 'change_tool', 'degrade_readonly', 'request_parent_replan', 'reconcile_status', 'stop',
]);
const RESULTS = new Set<RepairAttemptResult>(['selected', 'awaiting_approval', 'held_for_backoff', 'stopped', 'reconcile']);
const EFFECTS = new Set<RepairEffect>(['read', 'write', 'none']);
const RISKS = new Set<RepairRisk>(['ordinary', 'high']);

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = (message: string): never => {
  throw new ProtocolError('INVALID_ARGUMENT', message);
};
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function boundedInt(value: number, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(`Invalid repair ${name}`);
  return value;
}

function resolvePolicy(options: RepairPolicyOptions | undefined): ResolvedPolicy {
  const maxAttempts = boundedInt(options?.maxAttempts ?? DEFAULT_REPAIR_MAX_ATTEMPTS, 0, 32, 'maxAttempts');
  const baseDelayMs = boundedInt(options?.baseDelayMs ?? DEFAULT_REPAIR_BASE_DELAY_MS, 0, 60_000, 'baseDelayMs');
  const maxDelayMs = boundedInt(options?.maxDelayMs ?? DEFAULT_REPAIR_MAX_DELAY_MS, 0, 3_600_000, 'maxDelayMs');
  if (maxDelayMs < baseDelayMs) invalid('Invalid repair maxDelayMs');
  const maxElapsedMs = boundedInt(options?.maxElapsedMs ?? DEFAULT_REPAIR_MAX_ELAPSED_MS, 0, 86_400_000, 'maxElapsedMs');
  const maxSteps = options?.maxSteps;
  const maxTokens = options?.maxTokens;
  if (maxSteps !== undefined) boundedInt(maxSteps, 0, 1_000_000, 'maxSteps');
  if (maxTokens !== undefined) boundedInt(maxTokens, 0, 100_000_000, 'maxTokens');
  const now = options?.now ?? Date.now;
  if (typeof now !== 'function') invalid('Invalid repair clock');
  return {
    now, maxAttempts, baseDelayMs, maxDelayMs, maxElapsedMs,
    ...(maxSteps === undefined ? {} : {maxSteps}),
    ...(maxTokens === undefined ? {} : {maxTokens}),
  };
}

function clock(policy: ResolvedPolicy): number {
  const now = policy.now();
  if (!Number.isFinite(now)) invalid('Invalid repair clock');
  return now;
}

/** 把失败信号分成瞬时、可修正或不可恢复。retrySafe 证明不参与分类。 */
export function classifyFailure(signal: FailureSignal | undefined): FailureClass {
  const code = signal?.code?.trim().toUpperCase();
  if (code && HARD_UNRECOVERABLE.has(code)) return 'unrecoverable';
  if ((code === 'FORBIDDEN' || code === 'PERMISSION_DENIED') && signal?.permissionInsufficient !== true) return 'unrecoverable';
  if (signal?.parameterError === true || signal?.selectorMiss === true || signal?.permissionInsufficient === true) return 'correctable';
  if (code && TRANSIENT_CODES.has(code)) return 'transient';
  const status = signal?.httpStatus;
  if (status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return 'transient';
  if (code && CORRECTABLE_CODES.has(code)) return 'correctable';
  if (status === 400 || status === 422) return 'correctable';
  if (status === 401 || status === 403 || status === 404 || status === 409) return 'unrecoverable';
  const message = signal?.message?.toLowerCase() ?? '';
  if (!code && status === undefined && message) {
    if (/timeout|timed out|rate limit|too many requests|econnreset|etimedout|enotfound|eai_again|socket hang up|network unreachable|temporarily unavailable/.test(message))
      return 'transient';
    if (/invalid argument|invalid parameter|selector|element not found|insufficient permission|insufficient scope|permission denied/.test(message))
      return 'correctable';
  }
  if (signal?.retryable === true) return 'transient';
  return 'unrecoverable';
}

function fingerprint(observation: RepairObservation, classification: FailureClass): string {
  return [
    classification,
    observation.effect,
    observation.outcome,
    observation.signal?.code?.trim().toUpperCase() ?? '',
    String(observation.signal?.httpStatus ?? ''),
    observation.write?.status ?? '',
    observation.risk ?? 'ordinary',
    observation.approvalGranted === true ? 'approved' : 'unapproved',
    writeRetryAllowed(observation) ? 'write-safe' : 'write-unsafe',
    String(observation.alternatives?.arguments?.length ?? 0),
    String(observation.alternatives?.tools?.length ?? 0),
    observation.alternatives?.readOnlyFallback ? 'fallback' : '',
  ].join('|');
}

/** 已知失败的写入只有在幂等、带幂等键或有补偿时才允许再试。未知结果一律不算安全。 */
export function writeRetryAllowed(observation: RepairObservation): boolean {
  if (observation.effect !== 'write' || observation.outcome === 'unknown') return false;
  const write = observation.write;
  if (!write || write.status === 'applied' || write.status === 'unknown') return false;
  return write.idempotent === true || text(write.idempotencyKey) || text(write.compensationRef);
}

function evidenceRefs(observation: RepairObservation): readonly string[] {
  return (observation.evidenceRefs ?? []).filter(ref => text(ref) && ref.length <= 128).slice(0, 8);
}

function countChosen(trace: RepairTrace, strategy: RepairStrategy): number {
  return trace.attempts.filter(attempt => attempt.strategy === strategy
    && attempt.result !== 'awaiting_approval' && attempt.result !== 'held_for_backoff').length;
}

function budgetExhausted(trace: RepairTrace, observation: RepairObservation, policy: ResolvedPolicy, now: number): boolean {
  if (trace.attempts.length >= policy.maxAttempts) return true;
  const first = trace.attempts[0];
  if (first && now - Date.parse(first.observedAt) >= policy.maxElapsedMs) return true;
  if (policy.maxSteps !== undefined && (observation.stepsUsed ?? 0) >= policy.maxSteps) return true;
  if (policy.maxTokens !== undefined && (observation.tokensUsed ?? 0) >= policy.maxTokens) return true;
  return false;
}

function choice(partial: Choice): Choice {
  return partial;
}

function stop(reason: string, budget: boolean): Choice {
  return choice({strategy: 'stop', reason, delayMs: 0, result: 'stopped', terminal: true, executable: false, budgetExhausted: budget});
}

function parentReplan(reason: string, budget: boolean): Choice {
  return choice({
    strategy: 'request_parent_replan', reason, delayMs: 0, result: 'selected', terminal: true, executable: false, budgetExhausted: budget,
  });
}

function reconcile(): Choice {
  return choice({
    strategy: 'reconcile_status', reason: 'write_unknown: reconcile status before any retry', delayMs: 0,
    result: 'reconcile', terminal: false, executable: false, budgetExhausted: false,
  });
}

function backoff(observation: RepairObservation, trace: RepairTrace, policy: ResolvedPolicy, now: number): Choice {
  const exponent = Math.min(countChosen(trace, 'backoff_retry'), 16);
  const delayMs = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** exponent));
  return choice({
    strategy: 'backoff_retry',
    reason: observation.effect === 'write'
      ? 'transient: exponential backoff before retrying an idempotent write'
      : 'transient: exponential backoff before retrying the same read',
    delayMs,
    retryNotBefore: new Date(now + delayMs).toISOString(),
    result: 'selected',
    terminal: false,
    executable: true,
    budgetExhausted: false,
  });
}

function selectStrategy(observation: RepairObservation, trace: RepairTrace, policy: ResolvedPolicy, now: number, classification: FailureClass): Choice {
  const safeWrite = writeRetryAllowed(observation);
  const parentOk = observation.parentCanReplan !== false;
  if (observation.effect === 'write' && observation.write?.status === 'applied') {
    return stop('write_already_applied: original write retained', false);
  }
  if (observation.effect === 'write' && observation.outcome === 'unknown' && observation.write?.status === 'unknown') {
    return stop('write_unknown: status still unknown; blind retry refused', false);
  }
  if (observation.effect === 'write' && observation.outcome === 'unknown' && observation.write?.status !== 'not_applied') {
    return reconcile();
  }
  if (budgetExhausted(trace, observation, policy, now)) {
    if (parentOk && countChosen(trace, 'request_parent_replan') === 0 && classification !== 'unrecoverable') {
      return parentReplan('budget_exhausted: request parent replan; original failed operation retained', true);
    }
    return stop('budget_exhausted: original failed operation retained', true);
  }
  if (classification === 'unrecoverable') {
    return stop('unrecoverable: attestation is not a retry; original failed operation retained', false);
  }
  if (classification === 'transient') {
    if (observation.effect === 'read' || safeWrite) return backoff(observation, trace, policy, now);
    if (parentOk && countChosen(trace, 'request_parent_replan') === 0) {
      return parentReplan('write_not_idempotent: request parent replan; blind retry refused', false);
    }
    return stop('write_not_idempotent: blind retry refused; original write retained', false);
  }
  const argument = observation.alternatives?.arguments?.[countChosen(trace, 'change_arguments')];
  if (argument && (observation.effect !== 'write' || safeWrite)) {
    return choice({
      strategy: 'change_arguments', reason: 'correctable: change arguments', delayMs: 0, result: 'selected',
      terminal: false, executable: true, budgetExhausted: false, alternateDigest: argument.digest,
    });
  }
  const tool = observation.alternatives?.tools?.[countChosen(trace, 'change_tool')];
  if (tool && (observation.effect !== 'write' || safeWrite)) {
    return choice({
      strategy: 'change_tool', reason: 'correctable: change tool', delayMs: 0, result: 'selected',
      terminal: false, executable: true, budgetExhausted: false, toolName: tool.name,
    });
  }
  const fallback = observation.alternatives?.readOnlyFallback;
  if (fallback && countChosen(trace, 'degrade_readonly') === 0) {
    return choice({
      strategy: 'degrade_readonly', reason: 'correctable: degrade to a read-only path', delayMs: 0, result: 'selected',
      terminal: false, executable: true, budgetExhausted: false, toolName: fallback.toolName, alternateDigest: fallback.argumentsDigest,
    });
  }
  if (parentOk && countChosen(trace, 'request_parent_replan') === 0) {
    return parentReplan('correctable: request parent replan; original failed operation retained', false);
  }
  return stop('strategies_exhausted: original failed operation retained', false);
}

function applyApproval(observation: RepairObservation, selected: Choice): Choice {
  const gated = observation.risk === 'high' && observation.approvalGranted !== true
    && selected.strategy !== 'stop' && selected.strategy !== 'reconcile_status';
  if (!gated) return selected;
  return {
    ...selected,
    result: 'awaiting_approval',
    executable: false,
    terminal: false,
    reason: `high_risk: retry waits for approval; ${selected.reason}`,
  };
}

function decisionFrom(observation: RepairObservation, classification: FailureClass, selected: Choice, now: number, record: boolean): RepairDecision {
  if (selected.strategy === 'backoff_retry' && observation.effect === 'write' && !writeRetryAllowed(observation)) {
    invalid('Refusing a blind write retry');
  }
  return {
    record,
    observedAt: new Date(now).toISOString(),
    classification,
    strategy: selected.strategy,
    reason: selected.reason,
    effect: observation.effect,
    risk: observation.risk ?? 'ordinary',
    requiresApproval: observation.risk === 'high' && selected.strategy !== 'stop' && selected.strategy !== 'reconcile_status',
    executable: selected.executable,
    delayMs: selected.delayMs,
    result: selected.result,
    terminal: selected.terminal,
    budgetExhausted: selected.budgetExhausted,
    sideEffectsEmitted: 0,
    fingerprint: fingerprint(observation, classification),
    evidenceRefs: evidenceRefs(observation),
    writeRetrySafe: writeRetryAllowed(observation),
    ...(selected.retryNotBefore ? {retryNotBefore: selected.retryNotBefore} : {}),
    ...(selected.toolName ? {toolName: selected.toolName} : {}),
    ...(selected.alternateDigest ? {alternateDigest: selected.alternateDigest} : {}),
  };
}

function decisionFromAttempt(attempt: RepairAttempt, result: RepairAttemptResult, record: boolean): RepairDecision {
  return {
    record,
    observedAt: attempt.observedAt,
    classification: attempt.classification,
    strategy: attempt.strategy,
    reason: attempt.reason,
    effect: attempt.effect,
    risk: attempt.risk,
    requiresApproval: attempt.requiresApproval,
    executable: result === 'held_for_backoff' ? false : attempt.executable,
    delayMs: attempt.delayMs,
    result,
    terminal: result === 'held_for_backoff' ? false : attempt.terminal,
    budgetExhausted: attempt.budgetExhausted,
    sideEffectsEmitted: 0,
    fingerprint: attempt.fingerprint,
    evidenceRefs: attempt.evidenceRefs,
    writeRetrySafe: attempt.writeRetrySafe,
    ...(attempt.retryNotBefore ? {retryNotBefore: attempt.retryNotBefore} : {}),
    ...(attempt.toolName ? {toolName: attempt.toolName} : {}),
    ...(attempt.alternateDigest ? {alternateDigest: attempt.alternateDigest} : {}),
  };
}

function assertObservation(observation: RepairObservation): void {
  if (!EFFECTS.has(observation.effect) || (observation.outcome !== 'failed' && observation.outcome !== 'unknown')) {
    invalid('Invalid repair observation');
  }
  if (observation.risk !== undefined && !RISKS.has(observation.risk)) invalid('Invalid repair risk');
  const status = observation.signal?.httpStatus;
  if (status !== undefined && (!Number.isInteger(status) || status < 100 || status > 599)) invalid('Invalid repair http status');
}

export function emptyRepairTrace(): RepairTrace {
  return {version: REPAIR_TRACE_VERSION, attempts: []};
}

/** 根据当前失败和已有尝试选出下一步。不执行该步骤。 */
export function decideRepair(observation: RepairObservation, trace: RepairTrace, options?: RepairPolicyOptions): RepairDecision {
  assertObservation(observation);
  assertTrace(trace);
  const policy = resolvePolicy(options);
  const now = clock(policy);
  const classification = classifyFailure(observation.signal);
  const mark = fingerprint(observation, classification);
  const last = trace.attempts[trace.attempts.length - 1];
  if (last && last.fingerprint === mark) {
    const retryAt = last.retryNotBefore ? Date.parse(last.retryNotBefore) : Number.NaN;
    if (last.strategy === 'backoff_retry' && last.result === 'selected' && Number.isFinite(retryAt) && now < retryAt) {
      return decisionFromAttempt(last, 'held_for_backoff', false);
    }
    if (last.terminal || last.result === 'awaiting_approval' || last.result === 'reconcile') {
      return decisionFromAttempt(last, last.result, false);
    }
  }
  const selected = applyApproval(observation, selectStrategy(observation, trace, policy, now, classification));
  return decisionFrom(observation, classification, selected, now, true);
}

function toAttempt(decision: RepairDecision, attempt: number): RepairAttempt {
  return {
    attempt,
    observedAt: decision.observedAt,
    classification: decision.classification,
    strategy: decision.strategy,
    reason: decision.reason,
    effect: decision.effect,
    risk: decision.risk,
    requiresApproval: decision.requiresApproval,
    executable: decision.executable,
    delayMs: decision.delayMs,
    result: decision.result,
    terminal: decision.terminal,
    budgetExhausted: decision.budgetExhausted,
    sideEffectsEmitted: 0,
    fingerprint: decision.fingerprint,
    evidenceRefs: [...decision.evidenceRefs],
    writeRetrySafe: decision.writeRetrySafe,
    ...(decision.retryNotBefore ? {retryNotBefore: decision.retryNotBefore} : {}),
    ...(decision.toolName ? {toolName: decision.toolName} : {}),
    ...(decision.alternateDigest ? {alternateDigest: decision.alternateDigest} : {}),
  };
}

/** 把一次新决策追加进 trace。重复的等待或终态决定不新增记录，也不产生副作用。 */
export function appendRepairAttempt(trace: RepairTrace, decision: RepairDecision): RepairTrace {
  assertTrace(trace);
  if (decision.sideEffectsEmitted !== 0) invalid('Repair decisions cannot emit side effects');
  if (!decision.record) return trace;
  const next = {version: REPAIR_TRACE_VERSION, attempts: [...trace.attempts, toAttempt(decision, trace.attempts.length + 1)]};
  assertTrace(next);
  return next;
}

/** 操作者明确放弃、交给父 agent，或重试一次只读。不能把写入标成可执行。 */
export function recordOperatorDecision(trace: RepairTrace, input: {
  strategy: 'stop' | 'request_parent_replan' | 'backoff_retry';
  reason: string;
  effect: RepairEffect;
  classification: FailureClass;
  observedAt: string;
  risk?: RepairRisk;
  requiresApproval?: boolean;
  executable?: boolean;
  evidenceRefs?: readonly string[];
}): RepairTrace {
  if (!text(input.reason) || !text(input.observedAt) || !Number.isFinite(Date.parse(input.observedAt))) invalid('Invalid operator repair decision');
  if (input.executable === true && input.effect !== 'read') invalid('Operator retry cannot execute a write');
  if (input.strategy === 'backoff_retry' && input.effect !== 'read') invalid('Operator retry cannot execute a write');
  const waiting = input.requiresApproval === true && input.strategy !== 'stop';
  const decision: RepairDecision = {
    record: true,
    observedAt: input.observedAt,
    classification: input.classification,
    strategy: input.strategy,
    reason: input.reason,
    effect: input.effect,
    risk: input.risk ?? 'ordinary',
    requiresApproval: input.requiresApproval === true,
    executable: waiting ? false : input.executable === true,
    delayMs: 0,
    result: waiting ? 'awaiting_approval' : input.strategy === 'stop' ? 'stopped' : 'selected',
    terminal: !waiting && input.strategy !== 'backoff_retry',
    budgetExhausted: false,
    sideEffectsEmitted: 0,
    fingerprint: `operator|${input.strategy}|${input.observedAt}|${input.effect}`,
    evidenceRefs: (input.evidenceRefs ?? []).filter(ref => text(ref) && ref.length <= 128).slice(0, 8),
    writeRetrySafe: false,
  };
  return appendRepairAttempt(trace, decision);
}

export function summarizeRepairFailure(trace: RepairTrace): RepairFailureSummary {
  assertTrace(trace);
  const last = trace.attempts[trace.attempts.length - 1];
  const strategies: RepairStrategy[] = [];
  for (const attempt of trace.attempts) {
    if (!strategies.includes(attempt.strategy)) strategies.push(attempt.strategy);
  }
  return {
    classification: last?.classification ?? null,
    attemptCount: trace.attempts.length,
    strategies,
    terminalReason: last?.terminal ? last.reason : null,
    lastStrategy: last?.strategy ?? null,
    lastResult: last?.result ?? null,
    lastReason: last?.reason ?? null,
    requiresParentReplan: trace.attempts.some(attempt => attempt.strategy === 'request_parent_replan'),
    awaitingApproval: last?.result === 'awaiting_approval',
    unknownWriteBlindRetry: false,
    budgetExhausted: trace.attempts.some(attempt => attempt.budgetExhausted),
    sideEffectsEmitted: 0,
  };
}

function active(signal: AbortSignal, deadline: string): void {
  if (!(signal instanceof AbortSignal)) invalid('Replay cancellation signal required');
  if (signal.aborted) throw new ProtocolError('CANCELLED', 'Repair trace replay cancelled');
  if (!text(deadline) || !Number.isFinite(Date.parse(deadline)) || Date.now() >= Date.parse(deadline)) {
    throw new ProtocolError('TIMEOUT', 'Repair trace replay deadline expired');
  }
}

/**
 * 只读回放决策过程。没有工具端口、模型端口或写入路径；
 * 即使记录里曾经选择过可执行策略，这里也不会把它们再跑一遍。
 */
export function replayRepairTrace(trace: RepairTrace, context: {signal: AbortSignal; deadline: string}): RepairReplay {
  active(context.signal, context.deadline);
  const cloned = (() => {
    try { return structuredClone(trace); }
    catch { return invalid('Repair trace must be plain data'); }
  })();
  assertTrace(cloned);
  active(context.signal, context.deadline);
  const summary = summarizeRepairFailure(cloned);
  return {
    version: REPAIR_TRACE_VERSION,
    timeline: cloned.attempts.map(attempt => ({...attempt, evidenceRefs: [...attempt.evidenceRefs], executedDuringReplay: false as const})),
    actualToolCalls: 0,
    actualWrites: 0,
    actualModelCalls: 0,
    authority: 'data_only_decision_replay',
    sideEffectsReplayed: false,
    summary,
  };
}

function assertTrace(trace: RepairTrace): void {
  if (!plain(trace) || trace.version !== REPAIR_TRACE_VERSION || !Array.isArray(trace.attempts)) invalid('Invalid repair trace');
  let previous = 0;
  for (const attempt of trace.attempts) {
    if (!plain(attempt)) invalid('Invalid repair attempt');
    const keys = Object.keys(attempt);
    const required = ['attempt', 'observedAt', 'classification', 'strategy', 'reason', 'effect', 'risk', 'requiresApproval',
      'executable', 'delayMs', 'result', 'terminal', 'budgetExhausted', 'sideEffectsEmitted', 'fingerprint', 'evidenceRefs', 'writeRetrySafe'];
    if (required.some(key => !Object.hasOwn(attempt, key))) invalid('Repair attempt is missing a required field');
    if (keys.some(key => !required.includes(key) && !['retryNotBefore', 'toolName', 'alternateDigest'].includes(key))) {
      invalid('Repair attempt has an unknown field');
    }
    if (attempt.attempt !== previous + 1 || !text(attempt.observedAt) || !Number.isFinite(Date.parse(attempt.observedAt))) invalid('Invalid repair attempt identity');
    if (!CLASSES.has(attempt.classification) || !STRATEGIES.has(attempt.strategy) || !EFFECTS.has(attempt.effect) || !RISKS.has(attempt.risk)) {
      invalid('Invalid repair attempt classification');
    }
    if (!RESULTS.has(attempt.result) || typeof attempt.terminal !== 'boolean' || typeof attempt.executable !== 'boolean'
      || typeof attempt.requiresApproval !== 'boolean' || typeof attempt.budgetExhausted !== 'boolean' || typeof attempt.writeRetrySafe !== 'boolean'
      || !text(attempt.reason) || !text(attempt.fingerprint) || !Number.isSafeInteger(attempt.delayMs) || attempt.delayMs < 0
      || attempt.sideEffectsEmitted !== 0 || !Array.isArray(attempt.evidenceRefs) || attempt.evidenceRefs.some(ref => !text(ref))) {
      invalid('Invalid repair attempt result');
    }
    if (attempt.strategy === 'backoff_retry' && attempt.effect === 'write' && attempt.executable && !attempt.writeRetrySafe) {
      invalid('Repair trace contains a blind write retry');
    }
    previous = attempt.attempt;
  }
}

function boolField(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

/** 从宿主失败回执抽出观察。retrySafe 只原样保留，不升级成重试决定。 */
export function observationFromHostFailure(value: unknown, facts: {
  effect: 'read' | 'write';
  retrySafe?: boolean;
  evidenceRefs?: readonly string[];
  parentCanReplan?: boolean;
}): RepairObservation {
  const root = plain(value) ? value : undefined;
  const failure = root && plain(root.failure) ? root.failure : undefined;
  const error = failure && plain(failure.error) ? failure.error : undefined;
  const code = error && typeof error.code === 'string' ? error.code.slice(0, 80) : undefined;
  const message = error && typeof error.message === 'string' ? error.message.slice(0, 300) : undefined;
  const retryable = boolField(error, 'retryable');
  const httpStatus = error && typeof error.httpStatus === 'number' && Number.isInteger(error.httpStatus)
    && error.httpStatus >= 100 && error.httpStatus <= 599 ? error.httpStatus : undefined;
  const parameterError = boolField(error, 'parameterError');
  const selectorMiss = boolField(error, 'selectorMiss');
  const permissionInsufficient = boolField(error, 'permissionInsufficient');
  const signal = {
    ...(code ? {code} : {}),
    ...(message ? {message} : {}),
    ...(retryable === undefined ? {} : {retryable}),
    ...(httpStatus === undefined ? {} : {httpStatus}),
    ...(parameterError === undefined ? {} : {parameterError}),
    ...(selectorMiss === undefined ? {} : {selectorMiss}),
    ...(permissionInsufficient === undefined ? {} : {permissionInsufficient}),
  };
  const risk = error?.risk === 'high' || failure?.risk === 'high' ? 'high'
    : error?.risk === 'ordinary' || failure?.risk === 'ordinary' ? 'ordinary' : undefined;
  const approvalGranted = boolField(error, 'approvalGranted') === true || boolField(failure, 'approvalGranted') === true;
  return {
    effect: facts.effect,
    outcome: 'failed',
    ...(risk ? {risk} : {}),
    ...(approvalGranted ? {approvalGranted: true} : {}),
    ...(facts.retrySafe === true ? {retrySafe: true} : {}),
    ...(Object.keys(signal).length ? {signal} : {}),
    ...(facts.evidenceRefs ? {evidenceRefs: facts.evidenceRefs} : {}),
    parentCanReplan: facts.parentCanReplan !== false,
  };
}
