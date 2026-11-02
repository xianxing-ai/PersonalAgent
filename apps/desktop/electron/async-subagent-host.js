import {createHash} from 'node:crypto';

/** Post the one completion into the conversation recorded at spawn. */
export function deliverSubagentReport(conversations, report) {
  let conversationId = typeof report.conversationId === 'string' ? report.conversationId : undefined;
  let relocated = false;
  if (conversationId) {
    try { conversations.session(conversationId, 'panel'); }
    catch { conversationId = undefined; }
  }
  if (!conversationId) {
    conversationId = conversations.activeConversationId('panel');
    relocated = true;
  }
  const session = conversations.session(conversationId, 'panel');
  const text = `${String(report.summary || '后台子任务已结束')}${relocated ? '\n（原父会话已不存在，这条回报改送到当前主对话）' : ''}`;
  return conversations.addLiveMessage({id: report.messageId, sessionId: session.id, role: 'assistant', text,
    createdAt: new Date().toISOString(), surface: 'panel', conversationId});
}

/** Desktop adapter. Admission and remote dispatch stay in Runtime. */
export function createAsyncSubagentHost({runtimeModule, getRuntime, subagentOptions, getGrantedTools, getRemoteSubmit, deliverReport}) {
  const controller = runtimeModule.createDesktopAsyncSubagentTools({...subagentOptions, getGrantedTools,
    verifyUnknownWrite: async taskId => {
      const runtime = (getRuntime ?? subagentOptions?.getRuntime)?.();
      const records = runtime?.readToolExecutions?.(taskId) ?? [];
      if (records.some(record => record.state === 'unknown' || record.reconciliationOutcome === 'unknown')) return 'unknown';
      return 'not_applied';
    },
    startChild: runtimeModule.createRemoteAwareSubagentStarter({host: subagentOptions, getRemote: getRemoteSubmit}),
    onReport: report => deliver(report)});
  function deliver(report) {
    deliverReport?.({...report, messageId: `async-report:${createHash('sha256').update(`${report.parentTaskId}:${report.subtaskId}:${report.revision}`).digest('hex').slice(0, 40)}`});
  }
  function deliverReported() {
    for (const item of controller.list()) {
      if (item.reported && item.summary) deliver({parentTaskId: item.parentTaskId, subtaskId: item.subtaskId, taskId: item.taskId, revision: item.revision, state: item.state, summary: item.summary, ...(item.conversationId ? {conversationId: item.conversationId} : {})});
    }
  }
  let timer;
  return {
    tools: controller.tools,
    start() {
      if (timer) return;
      timer = setInterval(() => {void controller.pump().then(deliverReported).catch(() => {});}, 1000);
      timer.unref?.();
      void controller.recover().then(deliverReported).catch(() => {});
    },
    stop() { if (timer) clearInterval(timer); timer = undefined; },
    pump() { return controller.pump().then(result => {deliverReported(); return result;}); },
    list() { return {items: controller.list()}; },
    instruct(payload) {
      return controller.instruct(payload?.parentTaskId, payload?.subtaskId, payload?.instruction, payload?.expectedControlRevision);
    },
    stopChild(payload) { return controller.stop(payload?.parentTaskId, payload?.subtaskId); },
  };
}
