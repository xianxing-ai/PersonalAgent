/** Long-lived assistant identities. Turns are still Runtime tasks; this roster is only the durable name, role and mailbox. */

export interface AssistantRecord {
  assistantId: string;
  displayName: string;
  role: string;
  instructions: string;
  conversationId: string;
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

export function assistantFromRow(row: Record<string, unknown>): AssistantRecord {
  return {
    assistantId: String(row.assistant_id),
    displayName: String(row.display_name),
    role: String(row.role),
    instructions: String(row.instructions),
    conversationId: String(row.conversation_id),
    status: row.status as AssistantRecord['status'],
    ...(row.active_task_id ? {activeTaskId: String(row.active_task_id)} : {}),
    unreadCount: Number(row.unread_count),
    ...(row.last_summary ? {lastSummary: String(row.last_summary)} : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
