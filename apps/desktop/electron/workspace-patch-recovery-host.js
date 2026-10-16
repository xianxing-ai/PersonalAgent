const pendingByApplication = new WeakMap();
const states = new Set(['created','planning','running','waiting_approval','waiting_external','waiting_reconciliation','verifying','cancelling','cancelled','failed','succeeded']);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(value);

/** Trusted management window only. Runtime owns applicability, original identity and recovery. */
export function createWorkspacePatchRecoveryHost({application, isAuthorized}) {
  return {async reconcile(input) {
    try {
      if (!isAuthorized() || typeof application?.reconcileWorkspacePatchTask !== 'function'
        || !input || Object.keys(input).length !== 2 || !id(input.taskId)
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw Error();
      const original = application.runtime.getTask(input.taskId);
      if (original.revision !== input.expectedRevision) throw Error();
      let pending = pendingByApplication.get(application);
      if (!pending) pendingByApplication.set(application, pending = new Map());
      let work = pending.get(input.taskId);
      if (!work) {
        work = Promise.resolve().then(() => application.reconcileWorkspacePatchTask(input.taskId));
        pending.set(input.taskId, work);
        void work.finally(() => { if (pending.get(input.taskId) === work) pending.delete(input.taskId); }).catch(() => {});
      }
      const readback = await work;
      if (!isAuthorized()) throw Error();
      const task = application.runtime.getTask(input.taskId);
      if (readback.taskId !== input.taskId || !id(readback.runId) || task.taskId !== input.taskId
        || !states.has(task.state) || !Number.isSafeInteger(task.revision) || task.revision < original.revision) throw Error();
      const result = readback.result;
      const outcome = result?.state === 'in_progress' ? 'in_progress'
        : result?.state === 'reconciled' && ['applied','not_applied','unknown'].includes(result.outcome) ? result.outcome : undefined;
      if (!outcome) throw Error();
      return {taskId: task.taskId, runId: readback.runId, revision: task.revision, taskState: task.state, outcome};
    } catch {
      // Provider and Runtime errors may contain local paths or raw execution data.
      throw Error('无法核实原补丁任务；请刷新任务状态后重试。不支持、仍在执行或绑定已变化的任务会被拒绝。');
    }
  }};
}
