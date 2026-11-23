import {ProtocolError} from '@personal-agent/contracts';

/** 用户覆盖的单位。不可逆类别不能被调成自动执行。 */
export const TOOL_CATEGORIES = [
  'read',
  'local_reversible_write',
  'local_write',
  'message_send',
  'payment',
  'delete',
  'external_submit',
  'presence',
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export type RiskTier = 'low' | 'medium' | 'high';
export type ToolSideEffect = 'read' | 'local_write' | 'external_write';

export const IRREVERSIBLE_CATEGORIES = ['message_send', 'payment', 'delete', 'external_submit'] as const;
export type IrreversibleCategory = (typeof IRREVERSIBLE_CATEGORIES)[number];

export interface CompensationAction {
  action: string;
  summary: string;
}

export interface RiskTableEntry {
  toolName: string;
  category: ToolCategory;
  tier: RiskTier;
  irreversible: boolean;
  compensation?: CompensationAction;
}

/**
 * 已知工具的默认分类。描述符只能把结果收紧，不能把不可逆或外部写降成自动。
 * 未列出的工具按名称、action 和 sideEffect 归类。
 */
export const RISK_CLASSIFICATION_TABLE: readonly RiskTableEntry[] = [
  {toolName: 'weather.forecast', category: 'read', tier: 'low', irreversible: false},
  {toolName: 'research.search', category: 'read', tier: 'low', irreversible: false},
  {toolName: 'mail.inbox', category: 'read', tier: 'low', irreversible: false},
  {toolName: 'mail.accounts', category: 'read', tier: 'low', irreversible: false},
  {toolName: 'mail.reconcile_send', category: 'read', tier: 'low', irreversible: false},
  {toolName: 'calendar.events', category: 'read', tier: 'low', irreversible: false},
  {toolName: 'todo.list', category: 'read', tier: 'low', irreversible: false},
  {toolName: 'feeds.collect', category: 'read', tier: 'low', irreversible: false},
  {toolName: 'feeds.subscriptions', category: 'read', tier: 'low', irreversible: false},
  {toolName: 'workspace.read_text', category: 'read', tier: 'low', irreversible: false},
  {toolName: 'workspace.list_entries', category: 'read', tier: 'low', irreversible: false},
  {toolName: 'workspace.preview_text_patch', category: 'read', tier: 'low', irreversible: false},
  {toolName: 'computer.system.observe', category: 'read', tier: 'low', irreversible: false},
  {toolName: 'mcp.workspace.read_text', category: 'read', tier: 'low', irreversible: false},
  {toolName: 'todo.create', category: 'local_reversible_write', tier: 'medium', irreversible: false,
    compensation: {action: 'todo.update', summary: '将新建待办标为 cancelled'}},
  {toolName: 'todo.update', category: 'local_reversible_write', tier: 'medium', irreversible: false,
    compensation: {action: 'todo.update', summary: '写回变更前的待办字段'}},
  {toolName: 'mail.send', category: 'message_send', tier: 'high', irreversible: true},
  {toolName: 'messages.send', category: 'message_send', tier: 'high', irreversible: true},
  {toolName: 'chat.send', category: 'message_send', tier: 'high', irreversible: true},
  {toolName: 'social.post', category: 'message_send', tier: 'high', irreversible: true},
  {toolName: 'mail.save_draft', category: 'external_submit', tier: 'high', irreversible: true},
  {toolName: 'mail.mark_seen', category: 'external_submit', tier: 'high', irreversible: true},
  {toolName: 'calendar.create', category: 'external_submit', tier: 'high', irreversible: true},
  {toolName: 'calendar.update', category: 'external_submit', tier: 'high', irreversible: true},
  {toolName: 'calendar.cancel', category: 'external_submit', tier: 'high', irreversible: true},
  {toolName: 'payment.pay', category: 'payment', tier: 'high', irreversible: true},
  {toolName: 'payment.transfer', category: 'payment', tier: 'high', irreversible: true},
  {toolName: 'github.pr.merge', category: 'external_submit', tier: 'high', irreversible: true},
  {toolName: 'git.push', category: 'external_submit', tier: 'high', irreversible: true},
  {toolName: 'git.push.force', category: 'external_submit', tier: 'high', irreversible: true},
];

const TABLE = new Map(RISK_CLASSIFICATION_TABLE.map(entry => [entry.toolName, entry]));

const MESSAGE_ACTIONS = new Set(['send_message', 'external_message']);
const PAYMENT_ACTIONS = new Set(['pay', 'payment', 'purchase', 'checkout']);
const DELETE_ACTIONS = new Set(['delete', 'remove', 'destroy', 'purge']);
const SUBMIT_ACTIONS = new Set(['external_submit', 'merge', 'force_push', 'release', 'publish', 'submit']);

export interface ClassifiedToolInput {
  toolName: string;
  action?: string;
  sideEffect?: ToolSideEffect;
  recoverySupport?: boolean;
  requiresPresence?: boolean;
}

export interface RiskClassification {
  toolName: string;
  category: ToolCategory;
  tier: RiskTier;
  irreversible: boolean;
  compensatable: boolean;
  compensation?: CompensationAction;
  /** 该分类在任何档位下都不能自动执行。 */
  floorAsk: boolean;
  /** 名称在默认分类表中。未列入的工具继续走原 automaticTools。 */
  catalogued: boolean;
}

const requiredName = (value: string, field: string): string => {
  const result = value.trim();
  if (!result || result.length > 120) throw new ProtocolError('INVALID_ARGUMENT', `${field} is invalid`);
  return result;
};

const segments = (toolName: string): readonly string[] => toolName.toLowerCase().split(/[._/-]+/).filter(part => part.length > 0);

const irreversibleFromAction = (action: string | undefined): IrreversibleCategory | undefined => {
  if (action === undefined) return undefined;
  if (MESSAGE_ACTIONS.has(action)) return 'message_send';
  if (PAYMENT_ACTIONS.has(action)) return 'payment';
  if (DELETE_ACTIONS.has(action)) return 'delete';
  if (SUBMIT_ACTIONS.has(action)) return 'external_submit';
  return undefined;
};

const irreversibleFromName = (toolName: string): IrreversibleCategory | undefined => {
  const parts = segments(toolName);
  const has = (token: string): boolean => parts.includes(token);
  if (has('pay') || has('payment') || has('purchase') || has('checkout')) return 'payment';
  if (has('delete') || has('remove') || has('destroy') || has('purge') || has('drop')) return 'delete';
  if ((has('send') && !has('reconcile')) || toolName.toLowerCase() === 'social.post') return 'message_send';
  if (has('submit') || has('publish') || has('merge') || has('push') || (has('force') && has('push'))) return 'external_submit';
  return undefined;
};

const irreversibleClassification = (toolName: string, category: IrreversibleCategory): RiskClassification => ({
  toolName,
  category,
  tier: 'high',
  irreversible: true,
  compensatable: false,
  floorAsk: true,
  catalogued: false,
});

const copyCompensation = (compensation: CompensationAction | undefined): CompensationAction | undefined =>
  compensation ? {action: compensation.action, summary: compensation.summary} : undefined;

const fromEntry = (entry: RiskTableEntry): RiskClassification => {
  const compensation = copyCompensation(entry.compensation);
  const compensatable = entry.tier === 'medium' && compensation !== undefined && !entry.irreversible;
  const tier: RiskTier = entry.irreversible || (entry.tier !== 'low' && !compensatable) ? 'high' : compensatable ? 'medium' : 'low';
  return {
    toolName: entry.toolName,
    category: entry.category,
    tier,
    irreversible: entry.irreversible,
    compensatable,
    floorAsk: entry.irreversible || (!compensatable && tier !== 'low'),
    catalogued: true,
    ...(compensation && compensatable ? {compensation} : {}),
  };
};

export function classifyTool(input: ClassifiedToolInput): RiskClassification {
  const toolName = requiredName(input.toolName, 'toolName');
  const action = input.action === undefined ? undefined : requiredName(input.action, 'action').toLowerCase();
  const listed = TABLE.get(toolName);
  const patterned = irreversibleFromAction(action) ?? (!listed || listed.irreversible ? irreversibleFromName(toolName) : undefined);
  let classification: RiskClassification;
  if (listed?.irreversible) classification = fromEntry(listed);
  else if (patterned) classification = irreversibleClassification(toolName, patterned);
  else if (listed) classification = fromEntry(listed);
  else if (input.sideEffect === 'external_write') classification = irreversibleClassification(toolName, 'external_submit');
  else if (input.requiresPresence === true) {
    classification = {toolName, category: 'presence', tier: 'high', irreversible: false, compensatable: false, floorAsk: true, catalogued: false};
  } else if (input.sideEffect === 'read') {
    classification = {toolName, category: 'read', tier: 'low', irreversible: false, compensatable: false, floorAsk: false, catalogued: false};
  } else if (input.sideEffect === 'local_write' && input.recoverySupport === true) {
    classification = {
      toolName,
      category: 'local_reversible_write',
      tier: 'medium',
      irreversible: false,
      compensatable: true,
      floorAsk: false,
      catalogued: false,
      compensation: {action: `restore:${toolName}`, summary: '按执行前快照回放'},
    };
  } else if (input.sideEffect === 'local_write' || input.sideEffect === undefined) {
    classification = {toolName, category: 'local_write', tier: 'high', irreversible: false, compensatable: false, floorAsk: true, catalogued: false};
  } else {
    classification = irreversibleClassification(toolName, 'external_submit');
  }

  if (input.sideEffect === 'external_write' && !classification.irreversible) {
    classification = irreversibleClassification(toolName, 'external_submit');
  }
  if (input.requiresPresence === true && !classification.irreversible) {
    classification = {toolName, category: 'presence', tier: 'high', irreversible: false, compensatable: false, floorAsk: true, catalogued: false};
  }
  if (input.sideEffect === 'read' && !classification.irreversible && classification.category !== 'presence') {
    classification = {toolName, category: 'read', tier: 'low', irreversible: false, compensatable: false, floorAsk: false, catalogued: classification.catalogued};
  }
  return {...classification, catalogued: Boolean(listed)};
}

export function isToolCategory(value: string): value is ToolCategory {
  return (TOOL_CATEGORIES as readonly string[]).includes(value);
}
