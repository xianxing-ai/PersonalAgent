import {openTaskConversation} from './subagent-activity.js';

/** Open the conversation that owns the pending approval, then ask that window to focus its card. */
export async function presentBriefingDecision({taskId, approvalId, tasks, conversations, sourceSurface, openPanel, openWorkspace, publish, rememberFocus}) {
  if (typeof taskId !== 'string' || !taskId || (approvalId !== undefined && typeof approvalId !== 'string')) throw Error('审批定位参数无效');
  const opened = await openTaskConversation({payload: {taskId}, tasks, conversations, sourceSurface, openPanel, openWorkspace, publish});
  rememberFocus({taskId, ...(approvalId ? {approvalId} : {})});
  publish();
  return opened;
}
