/**
 * Optional F23 workflowShadowRelease injection.
 * Without complete trusted ports, returns undefined so tools stay unregistered.
 * Never invents Fake production ports.
 */
function completeConfigurationPort(port) {
  return !!port
    && typeof port.read === 'function'
    && typeof port.readOperation === 'function'
    && typeof port.compareAndSet === 'function';
}

function completeAcceptance(acceptance) {
  return !!acceptance
    && typeof acceptance.policyId === 'string'
    && Number.isSafeInteger(acceptance.revision)
    && typeof acceptance.configurationId === 'string'
    && typeof acceptance.taskClass === 'string'
    && typeof acceptance.validFrom === 'string'
    && typeof acceptance.expiresAt === 'string'
    && acceptance.baseline
    && acceptance.candidate
    && typeof acceptance.conditionsDigest === 'string'
    && typeof acceptance.qualityMetricId === 'string'
    && Array.isArray(acceptance.metricRules)
    && Array.isArray(acceptance.requiredChecks);
}

export function readDesktopWorkflowShadowRelease(options) {
  if (!options || typeof options !== 'object') return undefined;
  if (!['local_write', 'external_write'].includes(options.sideEffect)) return undefined;
  if (!Array.isArray(options.requiredScopes) || options.requiredScopes.length === 0) return undefined;
  if (!completeConfigurationPort(options.configurationPort)) return undefined;
  if (!completeAcceptance(options.acceptance)) return undefined;
  if (typeof options.verifyBranch !== 'function'
    || typeof options.verifyComparable !== 'function'
    || typeof options.verifyTestEvidence !== 'function') {
    return undefined;
  }
  return options;
}

/** Alias used by Desktop main composition. */
export function resolveDesktopWorkflowShadowRelease(options) {
  return readDesktopWorkflowShadowRelease(options);
}
