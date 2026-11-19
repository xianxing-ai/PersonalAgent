import {AsyncLocalStorage} from 'node:async_hooks';
import {createUsageBudgetHost} from './usage-budget-host.js';

export const PROACTIVE_SOURCE_TASK_CHECKPOINT = 'desktop-proactive-source-v1';

export function isAutonomousConversationId(conversationId) {
  return typeof conversationId === 'string'
    && (conversationId.startsWith('desktop-proactive') || conversationId.startsWith('proactive-source:'));
}

export function isAutonomousRuntimeTask(runtime, taskId) {
  if (!runtime || typeof taskId !== 'string' || !taskId) return false;
  const isDirectAutonomous = id => {
    try {
      const task = runtime.getTask(id);
      if (isAutonomousConversationId(task?.conversationId)) return true;
    } catch {
      return false;
    }
    return runtime.loadCheckpoint(id, 'desktop-proactive-workflow-v1') != null
      || runtime.loadCheckpoint(id, PROACTIVE_SOURCE_TASK_CHECKPOINT) != null;
  };
  if (isDirectAutonomous(taskId)) return true;
  let cursorTaskId = taskId;
  const visited = new Set([cursorTaskId]);
  while (visited.size < 16) {
    const parent = runtime.loadCheckpoint(cursorTaskId, 'subtask-parent');
    const parentId = typeof parent?.parentTaskId === 'string' ? parent.parentTaskId : '';
    if (!parentId || visited.has(parentId)) break;
    visited.add(parentId);
    cursorTaskId = parentId;
    if (isDirectAutonomous(parentId)) return true;
  }
  return false;
}

/**
 * Desktop startup adapter. main.js constructs this once and passes the same
 * hooks into model calls, cloud transport, proactive admission and IPC.
 */
export function createUsageBudgetProduct({userData, safeStorage, now, timeZone, onUpdate, candidates, Notification}) {
  const sent = new Set();
  const originStore = new AsyncLocalStorage();
  const currentOrigin = () => originStore.getStore() === 'autonomous' ? 'autonomous' : 'user';
  let readRuntime;
  let notifier = async notice => {
    if (Notification?.isSupported?.()) new Notification({title: 'PersonalAgent 用量', body: notice.body}).show();
  };
  const budget = createUsageBudgetHost({
    userData, safeStorage, now, timeZone,
    onNotice: notice => { void emit(notice); },
  });
  async function emit(notice) {
    if (!notice?.id || sent.has(notice.id)) return;
    sent.add(notice.id);
    try { await notifier(notice); onUpdate?.(); }
    catch { sent.delete(notice.id); }
  }
  function changed() { try { onUpdate?.(); } catch { /* UI refresh must not affect the ledger. */ } }
  return {
    snapshot() {
      try { return budget.snapshot(); }
      catch (error) { return {dailyLimitYuan: null, monthlyLimitYuan: null, action: 'degrade', usageLine: error?.message || '用量账本需要恢复'}; }
    },
    bindNotifier(port) {
      if (!port || typeof port.sendAdvisoryNotification !== 'function') throw Error('用量通知端口无效');
      notifier = async notice => {
        await port.sendAdvisoryNotification({id: notice.id, title: 'PersonalAgent 用量', body: notice.body, source: 'usage-budget'});
      };
    },
    decide(input) { return budget.decide({...input, candidates: input.candidates ?? candidates?.() ?? []}); },
    beforeLocalCall(info) {
      const origin = currentOrigin();
      const decision = budget.decide({origin, modelId: info.modelId, candidates: info.models ?? []});
      if (!decision.allowed) throw Error(decision.prompt || '已超过用量上限');
      if (decision.prompt) void emit(budget.exceededNotice());
      return decision;
    },
    recordLocal(info) {
      const usage = info?.usage ?? {};
      const tokens = Number.isSafeInteger(usage.totalTokens) ? usage.totalTokens
        : (Number.isSafeInteger(usage.promptTokens) ? usage.promptTokens : 0) + (Number.isSafeInteger(usage.completionTokens) ? usage.completionTokens : 0);
      budget.recordModel({modelId: info.modelId, tokens, origin: currentOrigin()});
      changed();
    },
    degradeSelection(selection, resolve) {
      if (!selection?.modelId || typeof resolve !== 'function') return selection;
      const decision = budget.decide({origin: currentOrigin(), modelId: selection.modelId, candidates: candidates?.() ?? []});
      if (!decision.modelId || decision.modelId === selection.modelId) return selection;
      try { return resolve({modelId: decision.modelId, ...(selection.reasoningEffort ? {reasoningEffort: selection.reasoningEffort} : {})}); }
      catch {
        if (selection.reasoningEffort) {
          try { return resolve({modelId: decision.modelId}); } catch {}
        }
        return selection;
      }
    },
    beforeCloudSend({userInitiated, modelId}) {
      const decision = budget.decide({origin: userInitiated ? 'user' : 'autonomous', modelId, candidates: candidates?.() ?? []});
      if (!decision.allowed) throw Error(decision.prompt || '已超过用量上限');
      if (userInitiated && decision.prompt) void emit(budget.exceededNotice());
    },
    bindRuntime(getter) {
      if (getter !== undefined && typeof getter !== 'function') throw Error('用量运行时读取器无效');
      readRuntime = getter;
    },
    recordCloud(info) {
      if (!info || !Number.isSafeInteger(info.durationMs) || info.durationMs < 0) return;
      const origin = info.origin === 'autonomous' || info.origin === 'user'
        ? info.origin
        : (info.taskId && isAutonomousRuntimeTask(readRuntime?.(), info.taskId) ? 'autonomous' : currentOrigin());
      budget.recordCloud({durationMs: info.durationMs, origin});
      changed();
    },
    noteUserSubmit() {
      const notice = budget.exceededNotice();
      if (notice) void emit(notice);
    },
    async withOrigin(next, fn) {
      const normalized = next === 'autonomous' ? 'autonomous' : 'user';
      return originStore.run(normalized, fn);
    },
    handleAction(name, payload) {
      if (name === 'usageBudget.state') {
        if (payload !== undefined) throw Error('用量状态不接受参数');
        return this.snapshot();
      }
      if (name === 'usageBudget.configure') {
        const result = budget.configure(payload);
        changed();
        return result;
      }
      throw Error('不支持的用量操作');
    },
  };
}

/** Shared by the startup model gateway and the integration test. Not a test double. */
export function modelApiUsageHooks(product) {
  return {
    beforeCall: info => product.beforeLocalCall(info),
    onModelUsage: info => product.recordLocal(info),
  };
}
