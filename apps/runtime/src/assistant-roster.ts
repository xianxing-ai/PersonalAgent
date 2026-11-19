/** Long-lived assistant identities. Turns are still Runtime tasks; this roster is only the durable name, role and mailbox. */

export interface AssistantRecord {
  assistantId: string;
  displayName: string;
  role: string;
  instructions: string;
  conversationId: string;
  origin: 'builtin' | 'user';
  modelId?: string;
  status: 'idle' | 'working' | 'waiting_approval';
  activeTaskId?: string;
  unreadCount: number;
  lastSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantMail {
  mailId: string;
  fromAssistantId: string;
  toAssistantId: string;
  body: string;
  hop: number;
  createdAt: string;
  consumedTaskId?: string;
}

export const DEFAULT_ASSISTANTS: readonly {assistantId: string; displayName: string; role: string; instructions: string}[] = [
  {assistantId: 'researcher', displayName: '资料助手', role: 'researcher', instructions: '负责检索、核对和整理资料。回答要给出依据，不编造来源。'},
  {assistantId: 'coder', displayName: '编码助手', role: 'coder', instructions: '负责阅读和修改代码、运行允许的检查，并说明改了什么。'},
  {assistantId: 'reviewer', displayName: '审查助手', role: 'reviewer', instructions: '负责审查正确性、风险和遗漏，先指出问题再给结论。'},
  {assistantId: 'planner', displayName: '规划助手', role: 'planner', instructions: '负责把目标拆成可执行步骤，并标出依赖和风险。'},
  {assistantId: 'coordinator', displayName: '协作助手', role: 'coordinator', instructions: '负责在几个助手之间传递任务和汇总结论，自己不代替他们做专业判断。'},
];

export const assistantConversationId = (assistantId: string): string => `desktop-assistant:${assistantId}`;

export const ASSISTANT_NAME_REQUIRED = '请填写助手名字';
export const ASSISTANT_INSTRUCTIONS_REQUIRED = '请填写这个助手负责什么';
export const ASSISTANT_MODEL_INVALID = '模型标识无效';
export const ASSISTANT_LIMIT_REACHED = '自定义助手已经达到上限';
export const ASSISTANT_BUILTIN_LOCKED = '内置助手不能改名或删除';
export const ASSISTANT_BUSY = '这个助手还在工作，先停止再删除';
export const ASSISTANT_MODEL_UNAVAILABLE = '所选模型不在当前目录里';
export const MAX_USER_ASSISTANTS = 24;
const ASSISTANT_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;

export function assistantDisplayName(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 40) throw new Error(ASSISTANT_NAME_REQUIRED);
  return text;
}

export function assistantInstructions(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 500) throw new Error(ASSISTANT_INSTRUCTIONS_REQUIRED);
  return text;
}

export function optionalAssistantModelId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!ASSISTANT_MODEL_ID.test(text)) throw new Error(ASSISTANT_MODEL_INVALID);
  return text;
}

export function assistantFromRow(row: Record<string, unknown>): AssistantRecord {
  return {
    assistantId: String(row.assistant_id),
    displayName: String(row.display_name),
    role: String(row.role),
    instructions: String(row.instructions),
    conversationId: String(row.conversation_id),
    origin: row.origin === 'user' ? 'user' : 'builtin',
    ...(row.model_id ? {modelId: String(row.model_id)} : {}),
    status: row.status as AssistantRecord['status'],
    ...(row.active_task_id ? {activeTaskId: String(row.active_task_id)} : {}),
    unreadCount: Number(row.unread_count),
    ...(row.last_summary ? {lastSummary: String(row.last_summary)} : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
