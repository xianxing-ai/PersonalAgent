import {createHash} from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const context = () => ({deadline: new Date(Date.now() + 180_000).toISOString(), signal: new AbortController().signal});
const active = scope => {
  if (!scope.signal || scope.signal.aborted || !Number.isFinite(Date.parse(scope.deadline))
    || Date.parse(scope.deadline) <= Date.now()) throw Error('私人副本删除已取消或过期');
};

/** Coordinates original Memory erasure markers with original Runtime/history redaction. Never retries tools. */
export function createPrivateMemoryErasureHost({privateMemory, consumptionHost, listBindings,
  cancelTask, eraseTaskCopies, readCopyErasureReceipt, backups}) {
  const available = [listBindings, cancelTask, eraseTaskCopies, readCopyErasureReceipt]
    .every(value => typeof value === 'function') && Boolean(privateMemory && consumptionHost);
  const inventory = () => {
    if (!available) throw Error('私人任务副本清除未接通');
    const copies = [];
    let afterTaskId;
    for (;;) {
      const page = listBindings({limit: 100, ...(afterTaskId === undefined ? {} : {afterTaskId})});
      if (!page || !Array.isArray(page.items) || page.items.length > 100) throw Error('私人任务副本清单不完整');
      for (const item of page.items) {
        const binding = structuredClone(item.binding);
        if (typeof item.taskId !== 'string' || !item.taskId || binding?.taskId !== item.taskId
          || binding.destination !== 'agentarts' || typeof binding.fact?.ref?.id !== 'string'
          || !Number.isSafeInteger(binding.fact.ref.revision) || binding.fact.ref.revision < 1
          || !/^[a-f0-9]{64}$/.test(binding.fact.summaryDigest)
          || !/^[a-f0-9]{64}$/.test(binding.fact.sourceDigest)
          || (afterTaskId !== undefined && item.taskId <= afterTaskId)
          || (copies.length && item.taskId <= copies.at(-1).taskId)) throw Error('私人任务副本绑定无效');
        copies.push({kind: 'private_memory_task', taskId: item.taskId, factId: binding.fact.ref.id,
          bindingDigest: hash(JSON.stringify(binding))});
      }
      if (page.nextAfterTaskId === undefined) return copies;
      if (page.items.length === 0 || page.nextAfterTaskId !== page.items.at(-1).taskId) {
        throw Error('私人任务副本分页无效');
      }
      afterTaskId = page.nextAfterTaskId;
    }
  };
  const markerFor = (factId, scope) => {
    let afterFactId;
    for (;;) {
      active(scope);
      const page = privateMemory.listErasureMarkers({limit: 100, ...scope,
        ...(afterFactId === undefined ? {} : {afterFactId})});
      const marker = page.find(item => item.factId === factId);
      if (marker) return marker;
      if (page.length < 100) return null;
      afterFactId = page.at(-1).factId;
    }
  };
  const clean = async (factId, scope) => {
    const pending = [];
    for (const copy of inventory().filter(item => item.factId === factId)) {
      active(scope);
      const expected = {taskId: copy.taskId, factId, bindingDigest: copy.bindingDigest, state: 'purged'};
      const matches = () => {
        const receipt = readCopyErasureReceipt(copy.taskId);
        return receipt && Object.keys(receipt).sort().join(',') === 'bindingDigest,factId,state,taskId'
          && Object.keys(expected).every(key => receipt[key] === expected[key]);
      };
      try {
        if (!matches()) {
          consumptionHost.releaseTask(copy.taskId);
          // Cancellation is only acceptance; a failure leaves this committed erasure pending.
          cancelTask(copy.taskId);
          await eraseTaskCopies({...copy, ...scope});
        }
        active(scope);
        if (!matches()) pending.push(copy.taskId);
      } catch { pending.push(copy.taskId); }
    }
    return pending;
  };
  return Object.freeze({
    inventory,
    assertReady(externalCopies = []) {
      if (!Array.isArray(externalCopies)) throw Error('其他应用管理副本清除未接通');
      if (backups) backups.assertReady(externalCopies);
      else if (externalCopies.length !== 0) throw Error('其他应用管理副本清除未接通');
      inventory();
      backups?.inventory();
      return privateMemory.prepareWrite();
    },
    async withdraw(ref, scope = context()) {
      active(scope);
      const result = await privateMemory.withdraw(structuredClone(ref));
      if (result.state !== 'withdrawn') return result;
      for (const copy of inventory().filter(item => item.factId === ref.id)) {
        active(scope); consumptionHost.releaseTask(copy.taskId); cancelTask(copy.taskId);
      }
      return result;
    },
    async erase(ref, scope = context()) {
      active(scope);
      const target = structuredClone(ref);
      // Check coverage before native consent; no task is cancelled before exact source deletion commits.
      inventory();
      backups?.inventory();
      let maintenancePending = false;
      try {
        const result = await privateMemory.delete(target);
        if (result.state !== 'deleted') return result;
      } catch (error) {
        const marker = markerFor(target.id, scope);
        if (marker?.phase !== 'completed' || marker.expectedRevision !== target.revision) throw error;
        maintenancePending = true;
      }
      const marker = markerFor(target.id, scope);
      if (marker?.phase !== 'completed' || marker.expectedRevision !== target.revision) throw Error('私人删除未持久接受');
      const pendingTaskIds = await clean(target.id, scope);
      const {pendingBackupIds = []} = backups ? await backups.reconcile(scope) : {};
      if (maintenancePending || pendingTaskIds.length || pendingBackupIds.length) return {state: 'pending', phase: 'private_copy_erasure',
        pendingTaskIds, pendingBackupIds, maintenancePending};
      return {state: 'deleted', coverage: backups ? 'active_private_database_bound_tasks_and_managed_sqlite_backups'
        : 'active_private_database_and_bound_task_copies'};
    },
    async reconcile(scope = context()) {
      active(scope);
      inventory();
      privateMemory.prepareWrite();
      const pendingTaskIds = [];
      let erased = false;
      let afterFactId;
      for (;;) {
        const markers = privateMemory.listErasureMarkers({limit: 100, ...scope,
          ...(afterFactId === undefined ? {} : {afterFactId})});
        for (const marker of markers) {
          active(scope);
          if (marker.phase === 'completed') { erased = true; pendingTaskIds.push(...await clean(marker.factId, scope)); }
        }
        if (markers.length < 100) {
          const {pendingBackupIds = []} = erased && backups ? await backups.reconcile(scope) : {};
          return {state: pendingTaskIds.length || pendingBackupIds.length ? 'pending' : 'reconciled', pendingTaskIds, pendingBackupIds};
        }
        afterFactId = markers.at(-1).factId;
      }
    },
  });
}
