export function conflictDecisionMarkup(task,escape,workspace=false) {
  const id=task?.reconciliationStatus?.conflictId;
  if(!['waiting_reconciliation','failed'].includes(task?.state)||typeof id!=='string'||!/^[a-f0-9]{64}$/u.test(id))return '';
  const notice=task.state==='failed'?`<p class="notice">${escape(task.reconciliationStatus.notice)}</p>`:'';
  if(task.reconciliationStatus.conflictSkipped)return notice;
  return notice+`<button type="button" class="turn-action" ${workspace?`data-skip-conflict="${escape(task.taskId)}"`:`data-action="task.reconcile.skip" data-id="${escape(task.taskId)}"`}>跳过此冲突的后续执行（不代表成功）</button>`;
}
export function conflictDecisionPayload(task) {
  if(!['waiting_reconciliation','failed'].includes(task?.state)||!Number.isSafeInteger(task.revision)||task.reconciliationStatus?.conflictSkipped
    ||!/^[a-f0-9]{64}$/u.test(task.reconciliationStatus?.conflictId??''))throw Error('这次冲突已变化，请刷新');
  return {taskId:task.taskId,conflictId:task.reconciliationStatus.conflictId,expectedRevision:task.revision};
}
