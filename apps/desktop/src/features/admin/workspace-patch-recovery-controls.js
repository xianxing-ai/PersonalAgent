const outcomes = {applied:'已写入',not_applied:'未写入',unknown:'结果未知',in_progress:'执行仍在进行'};
const taskStates = new Set(['created','planning','running','waiting_approval','waiting_external','waiting_reconciliation','verifying','cancelling','cancelled','failed','succeeded']);
export function workspacePatchRecoveryHtml(task, entry, escape) {
  const message = entry?.result
    ? `补丁：${outcomes[entry.result.outcome]}。${entry.result.taskState === 'cancelled' && entry.result.outcome === 'applied' ? '任务已取消，但此前修改已写入。' : '补丁结果与任务是否完成分别记录。'}`
    : entry?.error ? '未取得核实结果，请刷新任务状态后重试。' : '仅核实原补丁任务；不支持的任务会被拒绝。';
  return `<button class="btn btn-sm" data-patch-reconcile="${escape(task.taskId)}" ${entry?.pending ? 'disabled' : ''}>${entry?.pending ? '正在核实…' : '核实补丁结果'}</button><p role="status" data-patch-status="${escape(task.taskId)}">${message}</p>`;
}
export function createWorkspacePatchRecoveryControls({invoke, changed}) {
  const entries = new Map(), pending = new Set();
  let tasks = new Map(), visible = false, generation = 0, closed = false, page;
  return {entries,
    sync(next, shown, pageKey = shown) {
      if (page !== pageKey) generation++;
      page = pageKey;
      visible = shown; tasks = new Map(next.map(task => [task.taskId, task]));
      for (const [key, entry] of entries) {
        if (!tasks.has(key) || entry.result && entry.result.revision < tasks.get(key).revision) entries.delete(key);
      }
    },
    close() { closed = true; generation++; entries.clear(); },
    async reconcile(taskId) {
      const task = tasks.get(taskId);
      if (closed || !visible || !task || pending.has(taskId)) return;
      const captured = generation;
      pending.add(taskId); entries.set(taskId, {pending:true}); changed();
      try {
        const result = await invoke('coding.reconcile', {taskId, expectedRevision:task.revision});
        if (closed || generation !== captured || !visible || !tasks.has(taskId)) return;
        if (result?.taskId !== taskId || typeof result.runId !== 'string' || !taskStates.has(result.taskState)
          || !Object.hasOwn(outcomes, result.outcome) || !Number.isSafeInteger(result.revision)
          || result.revision < Math.max(task.revision, tasks.get(taskId).revision)) throw Error();
        entries.set(taskId, {result:{taskId, runId:result.runId, revision:result.revision,
          taskState:result.taskState, outcome:result.outcome}});
      } catch {
        if (!closed && generation === captured && visible && tasks.has(taskId)) entries.set(taskId, {error:true});
      } finally {
        pending.delete(taskId);
        if (entries.get(taskId)?.pending) entries.delete(taskId);
        if (!closed && visible) changed();
      }
    }
  };
}
