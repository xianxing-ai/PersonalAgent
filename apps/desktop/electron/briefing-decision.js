import {openTaskConversation} from './subagent-activity.js';

let focusSequence = 0;

/** Allow briefing decision jumps only from the trusted main frame of panel, workspace, or admin. */
export function isTrustedBriefingDecisionSender(sender, senderFrame, allowedWindows = []) {
  if (!sender || !senderFrame) return false;
  if (!allowedWindows.some(win => Boolean(win) && win === sender)) return false;
  return sender.webContents?.mainFrame === senderFrame;
}

/** Verify the requested approval jump belongs to the current daily briefing snapshot. */
export function isBriefingDecisionAllowed(decisions, payload) {
  if (!Array.isArray(decisions) || !payload || typeof payload.taskId !== 'string' || !payload.taskId) return false;
  if (payload.approvalId !== undefined && (typeof payload.approvalId !== 'string' || !payload.approvalId)) return false;
  return decisions.some(item => item?.taskId === payload.taskId
    && (payload.approvalId === undefined || item?.approvalId === payload.approvalId));
}

/** Open the conversation that owns the pending approval, then ask that window to focus its card. */
export async function presentBriefingDecision({taskId, approvalId, tasks, conversations, sourceSurface, openPanel, openWorkspace, publish, rememberFocus}) {
  if (typeof taskId !== 'string' || !taskId || (approvalId !== undefined && typeof approvalId !== 'string')) throw Error('审批定位参数无效');
  const opened = await openTaskConversation({payload: {taskId}, tasks, conversations, sourceSurface, openPanel, openWorkspace, publish});
  focusSequence += 1;
  rememberFocus({taskId, ...(approvalId ? {approvalId} : {}), focusId: focusSequence});
  publish();
  return opened;
}
