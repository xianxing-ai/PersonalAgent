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
      if (receipt.event === 'workflow_candidates') {
        if (receipt.stage !== 'candidate_response' || !['fast','plan'].includes(receipt.role)
          || !['completed','failed'].includes(receipt.status)) return;
        // Keep candidate diagnostics distinct from model-call receipts, with only safe metadata.
        const output = {event:'workflow_candidates',stage:'candidate_response',
          role:receipt.role,status:receipt.status,
          requestId:safeLabel(receipt.requestId,256) ? receipt.requestId : 'unknown',
          promptVersion:safeLabel(receipt.promptVersion,64) ? receipt.promptVersion : 'unknown',
          deploymentVersion:version,deploymentVersionSource:source};
        if (typeof receipt.nodeId === 'string' && /^F(?:0[1-9]|1[0-9]|2[0-8])_N\d{2}$/.test(receipt.nodeId)) output.nodeId = receipt.nodeId;
        if (receipt.candidatePreparation === 'model_gateway' || receipt.candidatePreparation === 'deterministic_binding')
          output.candidatePreparation = receipt.candidatePreparation;
        if (Number.isSafeInteger(receipt.candidateCount) && receipt.candidateCount >= 0)
          output.candidateCount = receipt.candidateCount;
        if (typeof receipt.candidateArrayDigest === 'string' && /^[0-9a-f]{64}$/.test(receipt.candidateArrayDigest))
          output.candidateArrayDigest = receipt.candidateArrayDigest;
        if (receipt.errorCode === 'UNSUPPORTED_CAPABILITY' || receipt.errorCode === 'EXTERNAL_FAILURE')
          output.errorCode = receipt.errorCode;
        void Promise.resolve(write(JSON.stringify(output)+'\n')).catch(() => {});
        return;
      }
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
