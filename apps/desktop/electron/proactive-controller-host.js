/**
 * Production controller consumer for proactive child reports.
 * Persists receipts on the parent task; does not invent Fake when unused.
 * Teacher/model advice never expands authorization here.
 */
export function createDesktopProactiveControllerHost({getRuntime, now = Date.now} = {}) {
  if (typeof getRuntime !== 'function') throw Error('proactive controller requires getRuntime');
  const key = eventId => 'desktop-proactive-controller:' + eventId;
  return {
    async consume(report, _context) {
      if (!report?.eventId || !report?.parentTaskId) throw Error('child report missing binding');
      const runtime = getRuntime();
      if (!runtime) throw Error('runtime unavailable for controller consume');
      const action = report.state === 'failed' ? 'request_controller' : 'continue';
      const receipt = {
        action,
        receiptRef: 'desktop:controller:' + report.eventId,
        recordedAt: new Date(now()).toISOString(),
        childTaskId: report.childTaskId,
        childRevision: report.childRevision,
      };
      const previous = runtime.loadCheckpoint(report.parentTaskId, key(report.eventId));
      if (previous && JSON.stringify(previous) !== JSON.stringify(receipt)) {
        throw Object.assign(Error('controller receipt conflict'), {code: 'REVISION_CONFLICT'});
      }
      runtime.saveCheckpointOnce(report.parentTaskId, key(report.eventId), receipt);
      return {action: receipt.action, receiptRef: receipt.receiptRef};
    },
    async readReceipt(eventId, context) {
      const runtime = getRuntime();
      const parentTaskId = context?.parentTaskId ?? context?.taskId;
      if (!runtime || !parentTaskId || !eventId) return undefined;
      const stored = runtime.loadCheckpoint(parentTaskId, key(eventId));
      if (!stored?.action || !stored?.receiptRef) return undefined;
      return {action: stored.action, receiptRef: stored.receiptRef};
    },
  };
}
