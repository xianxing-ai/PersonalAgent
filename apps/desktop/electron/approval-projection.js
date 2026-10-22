/** Private Desktop projection; the frozen approval.list response remains unchanged. */
export function projectDesktopApproval(item, runtime) {
  let stored;
  try { stored = runtime?.getApproval(item.approvalId); } catch {}
  // Timer expiry is a Runtime fact even when the UI's request event cache is old.
  if(stored?.approvalId===item.approvalId&&stored.taskId===item.taskId&&Number.isSafeInteger(stored.revision)
    &&stored.revision>item.revision&&['pending','allowed','denied'].includes(stored.state)){
    item={...item,state:stored.state,revision:stored.revision};
  }
  const systemExpired = item.state === 'denied' && stored?.state === 'denied'
    && stored.taskId === item.taskId && stored.revision === item.revision
    && stored.resolution?.actor === 'system' && stored.resolution.reason === 'expired';
  const systemInvalidated=item.state==='denied'&&stored?.state==='denied'&&stored.taskId===item.taskId
    &&stored.revision===item.revision&&stored.resolution?.actor==='system'
    &&['stale','cancelled'].includes(stored.resolution.reason);
  return {...item, ...(systemExpired ? {systemExpired: true} : {}),
    ...(systemInvalidated?{systemInvalidated:stored.resolution.reason}:{})};
}
