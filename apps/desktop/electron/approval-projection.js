/** Private Desktop projection; the frozen approval.list response remains unchanged. */
export function projectDesktopApproval(item, runtime) {
  let stored;
  try { stored = runtime?.getApproval(item.approvalId); } catch {}
  const systemExpired = item.state === 'denied' && stored?.state === 'denied'
    && stored.taskId === item.taskId && stored.revision === item.revision
    && stored.resolution?.actor === 'system' && stored.resolution.reason === 'expired';
  const systemInvalidated=item.state==='denied'&&stored?.state==='denied'&&stored.taskId===item.taskId
    &&stored.revision===item.revision&&stored.resolution?.actor==='system'
    &&['stale','cancelled'].includes(stored.resolution.reason);
  return {...item, ...(systemExpired ? {systemExpired: true} : {}),
    ...(systemInvalidated?{systemInvalidated:stored.resolution.reason}:{})};
}
