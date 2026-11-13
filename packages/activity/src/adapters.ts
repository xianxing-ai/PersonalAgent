import {ProtocolError} from '@personal-agent/contracts';
import type {ActivityDraft} from './ledger.js';

const FORBIDDEN_KEYS = new Set([
  'arguments', 'args', 'body', 'message', 'messages', 'parameters', 'params',
  'content', 'prompt', 'text', 'payload', 'subject', 'excerpt', 'description', 'summary',
]);
const SAFE_TEXT = /^[^\r\n{}]{1,140}$/u;
const REASON_CODE = /^[A-Za-z0-9_:. -]{1,120}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/;

const PROACTIVE_KINDS = {
  'calendar.created': '日历新增',
  'calendar.rescheduled': '日历改期',
  'calendar.starting_soon': '日历即将开始',
  'mail.arrived': '新邮件',
  'file.changed': '目录变化',
} as const;
const PROACTIVE_SOURCES = {calendar: '日历', mail: '邮件', file: '目录'} as const;
const PROACTIVE_STATUSES = [
  'submitted', 'waiting_approval', 'review', 'deferred', 'quiet', 'rate_limited', 'stale',
  'unmatched', 'unauthorized', 'baseline', 'abstained', 'denied', 'unavailable', 'source_failed',
] as const;
const REPAIR_STRATEGIES = {
  backoff_retry: '指数退避重试',
  change_arguments: '更换参数',
  change_tool: '更换工具',
  degrade_readonly: '降为只读',
  request_parent_replan: '交给父代理重规划',
  reconcile_status: '先核对状态',
  stop: '停止重试',
} as const;
const PLUGIN_ACTIONS = {
  install: '安装插件',
  enable: '启用插件',
  disable: '停用插件',
  uninstall: '卸载插件',
} as const;
const PLUGIN_BASIS = {
  install: '目录安装后默认停用',
  enable: '按目录风险启用',
  disable: '停用已安装插件',
  uninstall: '移除已安装快照',
} as const;

export interface AutonomyActivityInput {
  at?: string;
  auditId: string;
  toolName: string;
  tier: 'low' | 'medium' | 'high';
  irreversible?: boolean;
  disposition: 'execute' | 'execute_and_notify';
  compensatable: boolean;
  rollback: 'unavailable' | 'available' | 'requested';
  reason: string;
  compensationToolName?: string;
  result?: 'succeeded' | 'failed';
}

export interface ProactiveActivityInput {
  at?: string;
  eventId: string;
  source: keyof typeof PROACTIVE_SOURCES;
  kind?: keyof typeof PROACTIVE_KINDS;
  status: (typeof PROACTIVE_STATUSES)[number];
  ruleId?: string;
  risk: 'low' | 'high';
  compensationRef?: string;
}

export interface RepairActivityInput {
  at?: string;
  fingerprint: string;
  strategy: keyof typeof REPAIR_STRATEGIES;
  classification: 'transient' | 'correctable' | 'unrecoverable';
  risk: 'ordinary' | 'high';
  attemptResult: 'selected' | 'awaiting_approval' | 'held_for_backoff' | 'stopped' | 'reconcile';
  reason: string;
  toolName?: string;
  compensationRef?: string;
}

export interface PluginActivityInput {
  at?: string;
  pluginId: string;
  action: keyof typeof PLUGIN_ACTIONS;
  risk: 'low' | 'medium' | 'high';
  result: 'succeeded' | 'failed';
  generation?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProtocolError('INVALID_ARGUMENT', '活动记录无效');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key)) throw new ProtocolError('INVALID_ARGUMENT', '活动记录不能包含正文或参数');
  }
  return record;
}

function only(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  const record = asRecord(value);
  const permitted = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!permitted.has(key)) throw new ProtocolError('INVALID_ARGUMENT', '活动记录包含未声明字段');
  }
  return record;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value !== value.trim() || !SAFE_TEXT.test(value)) {
    throw new ProtocolError('INVALID_ARGUMENT', `${label}无效`);
  }
  return value;
}

function reasonCode(value: unknown): string {
  if (typeof value !== 'string' || !REASON_CODE.test(value)) {
    throw new ProtocolError('INVALID_ARGUMENT', '决策依据无效');
  }
  return value;
}

function token(value: unknown, label: string): string {
  if (typeof value !== 'string' || !TOKEN.test(value)) throw new ProtocolError('INVALID_ARGUMENT', `${label}无效`);
  return value;
}

function optionalToken(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return token(value, label);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ProtocolError('INVALID_ARGUMENT', `${label}无效`);
  }
  return value as T;
}

function at(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new ProtocolError('INVALID_ARGUMENT', '时间无效');
  return new Date(value).toISOString();
}

function withTime(draft: ActivityDraft, value: unknown): ActivityDraft {
  const when = at(value);
  return when === undefined ? draft : {...draft, at: when};
}

/** #630 `AutonomyAuditRecord` 合入后的对接入口。只接收分类结论，不接收参数或补偿正文。 */
export function fromAutonomyAudit(input: AutonomyActivityInput): ActivityDraft {
  const record = only(input, [
    'at', 'auditId', 'toolName', 'tier', 'irreversible', 'disposition', 'compensatable',
    'rollback', 'reason', 'compensationToolName', 'result',
  ]);
  const auditId = token(record.auditId, '审计标识');
  const toolName = token(record.toolName, '工具名');
  const tier = oneOf(record.tier, ['low', 'medium', 'high'] as const, '风险');
  const irreversible = record.irreversible === true;
  if (record.irreversible !== undefined && record.irreversible !== true && record.irreversible !== false) {
    throw new ProtocolError('INVALID_ARGUMENT', '不可逆标记无效');
  }
  const disposition = oneOf(record.disposition, ['execute', 'execute_and_notify'] as const, '处置');
  if (typeof record.compensatable !== 'boolean') throw new ProtocolError('INVALID_ARGUMENT', '补偿标记无效');
  const rollback = oneOf(record.rollback, ['unavailable', 'available', 'requested'] as const, '回滚状态');
  const reason = text(record.reason, '依据');
  const compensationToolName = optionalToken(record.compensationToolName, '补偿动作');
  const result = record.result === undefined ? 'succeeded' : oneOf(record.result, ['succeeded', 'failed'] as const, '结果');
  const undoable = !irreversible && record.compensatable && rollback === 'available' && compensationToolName !== undefined && result === 'succeeded';
  const basis = compensationToolName ? `${reason}；补偿 ${compensationToolName}` : reason;
  if (basis.length > 140) throw new ProtocolError('INVALID_ARGUMENT', '依据无效');
  const draft: ActivityDraft = {
    source: 'autonomy',
    summary: `自动执行 ${toolName}`,
    risk: irreversible ? 'irreversible' : tier,
    result,
    why: {
      trigger: disposition === 'execute' ? '低风险，按自主档直接执行' : '中风险，执行后通知',
      basis,
    },
    dedupeKey: `autonomy:${auditId}`,
    ...(undoable ? {compensation: {action: 'revert' as const, ref: auditId}} : {}),
  };
  return withTime(draft, record.at);
}

/** #631 `TriggerOutcome` 合入后的对接入口。不接收来源摘要，避免邮件标题或正文进入时间线。 */
export function fromProactiveOutcome(input: ProactiveActivityInput): ActivityDraft {
  const record = only(input, ['at', 'eventId', 'source', 'kind', 'status', 'ruleId', 'risk', 'compensationRef']);
  const eventId = token(record.eventId, '事件标识');
  const source = oneOf(record.source, ['calendar', 'mail', 'file'] as const, '来源');
  const kind = record.kind === undefined ? undefined : oneOf(record.kind, Object.keys(PROACTIVE_KINDS) as (keyof typeof PROACTIVE_KINDS)[], '变化类型');
  const status = oneOf(record.status, PROACTIVE_STATUSES, '状态');
  const ruleId = optionalToken(record.ruleId, '规则');
  const risk = oneOf(record.risk, ['low', 'high'] as const, '风险');
  const compensationRef = optionalToken(record.compensationRef, '补偿引用');
  const result = status === 'submitted' ? 'succeeded'
    : status === 'waiting_approval' || status === 'review' || status === 'deferred' ? 'asked'
      : status === 'source_failed' ? 'failed' : 'skipped';
  const draft: ActivityDraft = {
    source: 'proactive',
    summary: kind ? `主动触发：${PROACTIVE_KINDS[kind]}` : `主动触发：${PROACTIVE_SOURCES[source]}`,
    risk,
    result,
    why: {
      trigger: kind ? `${PROACTIVE_SOURCES[source]} · ${kind}` : `来源 ${PROACTIVE_SOURCES[source]}`,
      basis: ruleId ? `规则 ${ruleId}，风险 ${risk}，状态 ${status}` : `状态 ${status}，未匹配规则`,
    },
    dedupeKey: `proactive:${eventId}:${status}`,
    ...(result === 'succeeded' && compensationRef ? {compensation: {action: 'revert' as const, ref: compensationRef}} : {}),
  };
  return withTime(draft, record.at);
}

/** #633 `RepairDecision` 合入后的对接入口。依据只接受决策码，不接受失败消息。 */
export function fromRepairDecision(input: RepairActivityInput): ActivityDraft {
  const record = only(input, [
    'at', 'fingerprint', 'strategy', 'classification', 'risk', 'attemptResult', 'reason', 'toolName', 'compensationRef',
  ]);
  const fingerprint = token(record.fingerprint, '决策指纹');
  const strategy = oneOf(record.strategy, Object.keys(REPAIR_STRATEGIES) as (keyof typeof REPAIR_STRATEGIES)[], '策略');
  const classification = oneOf(record.classification, ['transient', 'correctable', 'unrecoverable'] as const, '失败类型');
  const risk = oneOf(record.risk, ['ordinary', 'high'] as const, '风险');
  const attemptResult = oneOf(record.attemptResult, ['selected', 'awaiting_approval', 'held_for_backoff', 'stopped', 'reconcile'] as const, '结果');
  const reason = reasonCode(record.reason);
  const toolName = optionalToken(record.toolName, '工具名');
  const compensationRef = optionalToken(record.compensationRef, '补偿引用');
  const result = attemptResult === 'selected' ? 'succeeded'
    : attemptResult === 'awaiting_approval' ? 'asked' : 'skipped';
  const undoable = strategy !== 'stop' && result === 'succeeded' && compensationRef !== undefined;
  const draft: ActivityDraft = {
    source: 'repair',
    summary: toolName ? `失败自愈：${REPAIR_STRATEGIES[strategy]} · ${toolName}` : `失败自愈：${REPAIR_STRATEGIES[strategy]}`,
    risk: risk === 'high' ? 'high' : 'medium',
    result,
    why: {trigger: `失败类型 ${classification}`, basis: reason},
    dedupeKey: `repair:${fingerprint}`,
    ...(undoable && compensationRef ? {compensation: {action: 'stop_retry' as const, ref: compensationRef}} : {}),
  };
  return withTime(draft, record.at);
}

/** 已在 main 的插件目录。摘要只含动作和插件 id。 */
export function fromPluginAction(input: PluginActivityInput): ActivityDraft {
  const record = only(input, ['at', 'pluginId', 'action', 'risk', 'result', 'generation']);
  const pluginId = token(record.pluginId, '插件');
  const action = oneOf(record.action, ['install', 'enable', 'disable', 'uninstall'] as const, '动作');
  const risk = oneOf(record.risk, ['low', 'medium', 'high'] as const, '风险');
  const result = oneOf(record.result, ['succeeded', 'failed'] as const, '结果');
  const generation = record.generation;
  if (result === 'succeeded' && (!Number.isSafeInteger(generation) || (generation as number) < 1)) {
    throw new ProtocolError('INVALID_ARGUMENT', '插件代次无效');
  }
  if (result === 'failed' && generation !== undefined) throw new ProtocolError('INVALID_ARGUMENT', '失败记录不带代次');
  const draft: ActivityDraft = {
    source: 'plugin',
    summary: `${PLUGIN_ACTIONS[action]} ${pluginId}`,
    risk,
    result,
    why: {
      trigger: `插件目录 · ${action}`,
      basis: result === 'failed' ? '操作没有完成' : PLUGIN_BASIS[action],
    },
    ...(result === 'succeeded' ? {dedupeKey: `plugin:${action}:${pluginId}:${generation as number}`} : {}),
    ...((action === 'install' || action === 'enable') && result === 'succeeded'
      ? {compensation: {action: action === 'install' ? 'uninstall' as const : 'disable' as const, ref: pluginId}}
      : {}),
  };
  return withTime(draft, record.at);
}
