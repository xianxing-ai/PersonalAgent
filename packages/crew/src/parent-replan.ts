import {CrewError} from './errors.js';
import {CREW_PARENT_AGENT_ID} from './store.js';

/**
 * 父 agent 消费子任务失败后的自愈决定。
 *
 * 决定本身由 @personal-agent/agentarts 的 repair policy 产生（本包不依赖该包，
 * 避免把云编排拉进 crew）。这里只做父边界上的安全复核：
 * 未知写入不派重试，非幂等写入不盲重试，高风险重试没有批准就不派新任务。
 * 本函数不调用工具、不触碰子 agent 驱动。
 */
export type CrewReplanClass = 'transient' | 'correctable' | 'unrecoverable';
export type CrewReplanStrategy =
  | 'backoff_retry'
  | 'change_arguments'
  | 'change_tool'
  | 'degrade_readonly'
  | 'request_parent_replan'
  | 'reconcile_status'
  | 'stop';
export type CrewReplanEffect = 'read' | 'write' | 'none';
export type CrewReplanRisk = 'ordinary' | 'high';
export type CrewWriteStatus = 'applied' | 'not_applied' | 'unknown';

export interface CrewParentReplanDecision {
  readonly version: 1;
  readonly childTaskId: string;
  readonly classification: CrewReplanClass;
  readonly strategy: CrewReplanStrategy;
  readonly reason: string;
  readonly effect: CrewReplanEffect;
  readonly executable: boolean;
  readonly requiresApproval: boolean;
  readonly risk: CrewReplanRisk;
  readonly approved?: boolean;
  readonly writeStatus?: CrewWriteStatus;
  readonly writeRetrySafe?: boolean;
}

export type CrewParentReplanIntent =
  | {readonly action: 'dispatch'; readonly parentTaskId: string; readonly goal: string; readonly sideEffectsEmitted: 0}
  | {readonly action: 'await_approval'; readonly reason: string; readonly sideEffectsEmitted: 0}
  | {readonly action: 'reconcile'; readonly reason: string; readonly sideEffectsEmitted: 0}
  | {readonly action: 'stop'; readonly reason: string; readonly sideEffectsEmitted: 0};

const CLASSES = new Set<CrewReplanClass>(['transient', 'correctable', 'unrecoverable']);
const STRATEGIES = new Set<CrewReplanStrategy>([
  'backoff_retry', 'change_arguments', 'change_tool', 'degrade_readonly', 'request_parent_replan', 'reconcile_status', 'stop',
]);
const EFFECTS = new Set<CrewReplanEffect>(['read', 'write', 'none']);
const RISKS = new Set<CrewReplanRisk>(['ordinary', 'high']);
const WRITE_STATUS = new Set<CrewWriteStatus>(['applied', 'not_applied', 'unknown']);
const KEYS = new Set([
  'version', 'childTaskId', 'classification', 'strategy', 'reason', 'effect', 'executable',
  'requiresApproval', 'risk', 'approved', 'writeStatus', 'writeRetrySafe',
]);

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new CrewError('INVALID_INPUT', `${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new CrewError('INVALID_INPUT', `${field} must not be empty`);
  if (trimmed.length > max) throw new CrewError('INVALID_INPUT', `${field} exceeds ${max} characters`);
  return trimmed;
}

/** 校验不可信的自愈决定。未知字段拒绝，避免把模型自报的额外许可混进来。 */
export function parseParentReplanDecision(input: unknown): CrewParentReplanDecision {
  if (!plain(input)) throw new CrewError('INVALID_INPUT', 'replan decision must be an object');
  for (const key of Object.keys(input)) {
    if (!KEYS.has(key)) throw new CrewError('INVALID_INPUT', `replan decision has unknown field ${key}`);
  }
  if (input.version !== 1) throw new CrewError('INVALID_INPUT', 'replan decision version must be 1');
  const childTaskId = requiredText(input.childTaskId, 'childTaskId', 128);
  const classification = input.classification;
  const strategy = input.strategy;
  const effect = input.effect;
  const risk = input.risk;
  if (typeof classification !== 'string' || !CLASSES.has(classification as CrewReplanClass)) {
    throw new CrewError('INVALID_INPUT', 'replan classification is invalid');
  }
  if (typeof strategy !== 'string' || !STRATEGIES.has(strategy as CrewReplanStrategy)) {
    throw new CrewError('INVALID_INPUT', 'replan strategy is invalid');
  }
  if (typeof effect !== 'string' || !EFFECTS.has(effect as CrewReplanEffect)) {
    throw new CrewError('INVALID_INPUT', 'replan effect is invalid');
  }
  if (typeof risk !== 'string' || !RISKS.has(risk as CrewReplanRisk)) {
    throw new CrewError('INVALID_INPUT', 'replan risk is invalid');
  }
  if (typeof input.executable !== 'boolean' || typeof input.requiresApproval !== 'boolean') {
    throw new CrewError('INVALID_INPUT', 'replan executable and requiresApproval must be boolean');
  }
  const reason = requiredText(input.reason, 'reason', 500);
  if (input.approved !== undefined && typeof input.approved !== 'boolean') {
    throw new CrewError('INVALID_INPUT', 'replan approved must be boolean');
  }
  if (input.writeRetrySafe !== undefined && typeof input.writeRetrySafe !== 'boolean') {
    throw new CrewError('INVALID_INPUT', 'replan writeRetrySafe must be boolean');
  }
  if (input.writeStatus !== undefined && (typeof input.writeStatus !== 'string' || !WRITE_STATUS.has(input.writeStatus as CrewWriteStatus))) {
    throw new CrewError('INVALID_INPUT', 'replan writeStatus is invalid');
  }
  return {
    version: 1,
    childTaskId,
    classification: classification as CrewReplanClass,
    strategy: strategy as CrewReplanStrategy,
    reason,
    effect: effect as CrewReplanEffect,
    executable: input.executable,
    requiresApproval: input.requiresApproval,
    risk: risk as CrewReplanRisk,
    ...(input.approved === undefined ? {} : {approved: input.approved}),
    ...(input.writeStatus === undefined ? {} : {writeStatus: input.writeStatus as CrewWriteStatus}),
    ...(input.writeRetrySafe === undefined ? {} : {writeRetrySafe: input.writeRetrySafe}),
  };
}

function goal(decision: CrewParentReplanDecision, instruction: string): string {
  return `父 agent 重新规划子任务 ${decision.childTaskId}（${decision.classification}/${decision.strategy}）：${instruction} 原因：${decision.reason}。不要重放未知写入；高风险动作仍走原审批。`;
}

/**
 * 把自愈决定变成父的下一步意图。返回值本身没有副作用；
 * 只有内核在 action 为 dispatch 时才会按意图派一个新任务。
 */
export function parentReplanIntent(actorId: string, input: unknown): CrewParentReplanIntent {
  if (actorId !== CREW_PARENT_AGENT_ID) {
    throw new CrewError('NOT_PERMITTED', `only the parent agent (${CREW_PARENT_AGENT_ID}) can replan a child task`);
  }
  const decision = parseParentReplanDecision(input);
  if (decision.requiresApproval && decision.approved !== true && decision.strategy !== 'stop' && decision.strategy !== 'reconcile_status') {
    return {action: 'await_approval', reason: 'high_risk: retry waits for approval', sideEffectsEmitted: 0};
  }
  if (decision.effect === 'write' && decision.writeStatus === 'applied') {
    return {action: 'stop', reason: 'write_already_applied: original write retained', sideEffectsEmitted: 0};
  }
  if (decision.effect === 'write' && (decision.writeStatus === undefined || decision.writeStatus === 'unknown')
    && decision.strategy !== 'stop') {
    return {action: 'reconcile', reason: 'write_unknown: reconcile status before any retry', sideEffectsEmitted: 0};
  }
  if (decision.strategy === 'reconcile_status') {
    return {action: 'reconcile', reason: decision.reason, sideEffectsEmitted: 0};
  }
  if (decision.strategy === 'stop' || decision.classification === 'unrecoverable') {
    return {action: 'stop', reason: decision.reason, sideEffectsEmitted: 0};
  }
  if (decision.effect === 'write' && decision.strategy === 'backoff_retry' && decision.writeRetrySafe !== true) {
    return {action: 'stop', reason: 'write_not_idempotent: blind retry refused; original write retained', sideEffectsEmitted: 0};
  }
  const dispatchable = decision.strategy === 'request_parent_replan'
    || decision.strategy === 'change_tool'
    || decision.strategy === 'change_arguments'
    || decision.strategy === 'degrade_readonly'
    || (decision.strategy === 'backoff_retry' && decision.effect === 'read')
    || (decision.strategy === 'backoff_retry' && decision.effect === 'write' && decision.writeRetrySafe === true && decision.writeStatus === 'not_applied');
  if (!dispatchable) return {action: 'stop', reason: decision.reason, sideEffectsEmitted: 0};
  const instruction = decision.strategy === 'degrade_readonly'
    ? '改走只读降级路径，不要重复原来的写入。'
    : decision.strategy === 'change_tool'
      ? '换一个已公布的工具，不要沿用失败的那次调用。'
      : decision.strategy === 'change_arguments'
        ? '更换参数后重试；写入必须仍是幂等的或带原幂等键。'
        : decision.strategy === 'backoff_retry' && decision.effect === 'write'
          ? '仅在原幂等键不变时重试该写入；没有幂等键就停止。'
          : decision.strategy === 'backoff_retry'
            ? '按已记录的退避时间后重试同一次只读。'
            : '由父重新规划下一步，子任务不要自行改派。';
  return {action: 'dispatch', parentTaskId: decision.childTaskId, goal: goal(decision, instruction), sideEffectsEmitted: 0};
}
