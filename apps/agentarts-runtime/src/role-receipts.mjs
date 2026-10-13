const roles = new Set(['fast','world','plan','review']);
const statuses = new Set(['started','completed','failed']);
const safeLabel = (value, max) => typeof value === 'string' && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
const isoTime = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** The host asserts a version label; this never claims independent platform verification. */
export function createRoleReceiptWriter({deploymentVersion, write = line => process.stdout.write(line)} = {}) {
  if (deploymentVersion !== undefined && (!safeLabel(deploymentVersion,128)
    || /(?:^|[._-])(?:latest|default|stable|current|unknown)(?:$|[._-])/i.test(deploymentVersion))) {
    throw new Error('Invalid trusted deployment version configuration');
  }
  const version = deploymentVersion ?? 'unknown';
  const source = deploymentVersion === undefined ? 'unknown' : 'host_configuration';
  return receipt => {
    try {
      if (!receipt || !roles.has(receipt.role) || !statuses.has(receipt.status)) return;
      // Deliberate field allowlist: never serialize arbitrary callback properties or errors.
      const output = {event:'owned_role',receiptVersion:'1.0',scope:'model_call',
        role:receipt.role,status:receipt.status,
        requestId:safeLabel(receipt.requestId,256) ? receipt.requestId : 'unknown',
        promptVersion:safeLabel(receipt.promptVersion,64) ? receipt.promptVersion : 'unknown',
        deploymentVersion:version,deploymentVersionSource:source};
      if (typeof receipt.spanId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(receipt.spanId)) output.spanId = receipt.spanId;
      if (isoTime(receipt.startedAt)) output.startedAt = receipt.startedAt;
      if (receipt.status !== 'started') {
        if (isoTime(receipt.endedAt)) output.endedAt = receipt.endedAt;
        if (Number.isFinite(receipt.durationMs) && receipt.durationMs >= 0) output.durationMs = receipt.durationMs;
      }
      if (receipt.status === 'completed' && Number.isSafeInteger(receipt.totalTokens) && receipt.totalTokens >= 0) output.totalTokens = receipt.totalTokens;
      void Promise.resolve(write(JSON.stringify(output)+'\n')).catch(() => {});
    } catch { /* A failed observability sink cannot change model orchestration. */ }
  };
}
