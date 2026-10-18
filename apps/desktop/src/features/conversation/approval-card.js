const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const expiryMillis=item=>typeof item?.expiresAt==='string'?Date.parse(item.expiresAt):Number.NaN;

export function nextApprovalExpiry(tasks, approvals = [], now = Date.now()) {
  const waitingTasks=new Set(tasks.filter(task=>task.state==='waiting_approval').map(task=>task.taskId));
  let next;
  for(const approval of approvals) {
    if(approval.state!=='pending'||!waitingTasks.has(approval.taskId))continue;
    const expiry=expiryMillis(approval);
    if(Number.isFinite(expiry)&&expiry>now&&(next===undefined||expiry<next))next=expiry;
  }
  return next;
}

export function approvalCards(task, approvals = [], now = Date.now()) {
  if (task.state !== 'waiting_approval') return '';
  return approvals.filter(item=>item.taskId===task.taskId && item.state==='pending').map(item=>{
    const expiresAt=expiryMillis(item),validExpiry=Number.isFinite(expiresAt);
    const inactive=!validExpiry || expiresAt<=now;
    const buttons=inactive?(validExpiry?'<p>此授权已过期，请停止任务后重新发起。</p>':'<p>授权期限无效，请查看最新任务状态。</p>'):
      `<div class="turn-actions"><button type="button" class="turn-action" data-approval-decision="allow_once" data-approval-id="${escape(item.approvalId)}">批准并继续</button><button type="button" class="turn-action" data-approval-decision="deny" data-approval-id="${escape(item.approvalId)}">拒绝</button></div>`;
    const action=typeof item.action==='string' && item.action.trim()?item.action:'Runtime 未公开工具';
    return `<section class="approval-card" role="group" aria-label="操作授权"><strong>需要你确认这次操作</strong><p>${escape(action)}</p><p>权限：${escape(item.scopes.join('、'))}</p>${buttons}${inactive?'':'<p>批准后继续当前任务，无需再发一条消息。</p>'}</section>`;
  }).join('');
}

export function approvalResponse(id, decision, tasks, approvals, now = Date.now()) {
  const approval=approvals.find(item=>item.approvalId===id && item.state==='pending');
  const task=approval && tasks.find(item=>item.taskId===approval.taskId);
  const expiresAt=expiryMillis(approval);
  if (!approval || task?.state!=='waiting_approval' || !Number.isFinite(expiresAt) || expiresAt<=now
    || !['allow_once','deny'].includes(decision)) throw Error('授权已变化，请查看最新任务状态');
  return {approvalId:id,decision,expectedRevision:approval.revision,taskId:approval.taskId};
}
