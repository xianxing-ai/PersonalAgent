/**
 * Optional IMAGE28 graph hosts and trusted workflow entry bindings that Desktop
 * registers only when trusted ports exist. Missing providers stay absent; never Fake success.
 */
const WORKFLOW_ID = /^F(?:0[1-9]|1[0-9]|2[0-8])$/;
const TOOL_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const TOOL_VERSION = /^[A-Za-z0-9._-]{1,64}$/;

export const DEFAULT_WORKFLOW_ENTRY_BINDINGS = Object.freeze({
  F15: Object.freeze({name: 'coding.repair.workflow', version: '1.0.0'}),
});

/** Validate and freeze a trusted map of workflowId -> {name, version}. Invalid items are dropped. */
export function normalizeWorkflowEntryBindings(raw) {
  const result = {};
  const entries = raw instanceof Map
    ? [...raw.entries()]
    : raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.entries(raw)
      : [];
  for (const [workflowId, binding] of entries) {
    if (!WORKFLOW_ID.test(workflowId)) continue;
    const name = typeof binding === 'string' ? binding : binding?.name;
    const version = typeof binding === 'string' ? '1.0.0' : (binding?.version ?? '1.0.0');
    if (typeof name !== 'string' || !TOOL_NAME.test(name) || typeof version !== 'string' || !TOOL_VERSION.test(version)) continue;
    result[workflowId] = Object.freeze({name, version});
  }
  return Object.freeze(result);
}

export function createDesktopWorkflowGraphComposition({
  runtimeModule, getApplication, feedsHost, todoHost, mailHost, notificationApplicationHost, systemObserveTool,
  verifyMailOperationScope, invokeSystemObserve, resolveSystemProbeOutcome,
  codingWorkspace, graphProviders = [], workflowEntries,
  now = () => new Date(),
} = {}) {
  if (!runtimeModule || typeof getApplication !== 'function') {
    return {
      tools: [],
      unavailable: ['composition_ports_unavailable'],
      f09WorkerPorts: undefined,
      workflowEntries: Object.freeze({}),
      competitionToolAvailability: [],
      competitionToolExports: [],
      close() {},
    };
  }
  const unavailable = [];
  const tools = [];
  const competitionToolAvailability = [];
  const competitionToolExports = [];
  const disposers = [];
  const declaredEntries = {...DEFAULT_WORKFLOW_ENTRY_BINDINGS, ...normalizeWorkflowEntryBindings(workflowEntries)};
  const assertCurrent = scope => {
    const runtime = getApplication()?.runtime;
    if (!runtime) throw Error('Workflow Runtime unavailable');
    for (const id of [scope.parentTaskId, scope.localTaskId]) {
      const task = runtime.getTask(id);
      if (task.cancelRequested || !['running', 'waiting_approval'].includes(task.state)) {
        throw Error('Original workflow task is no longer current');
      }
    }
  };

  if (mailHost?.tools?.length && typeof verifyMailOperationScope === 'function'
    && typeof runtimeModule.createRuntimeF08OperationScopeHost === 'function') {
    const host = runtimeModule.createRuntimeF08OperationScopeHost({
      getApplication, requiredScopes: ['mail:read'], assertCurrent, now,
      verifyOperationScope: verifyMailOperationScope,
    });
    if (host.tools?.length) tools.push(...host.tools);
    else if (host.unavailable) unavailable.push(host.unavailable);
    if (typeof host.close === 'function') disposers.push(() => host.close());
  } else unavailable.push('f08_operation_scope_mail_host_unavailable');

  if (notificationApplicationHost && typeof runtimeModule.createRuntimeF12QuietHoursHost === 'function') {
    const quiet = runtimeModule.createRuntimeF12QuietHoursHost({
      getApplication, requiredScopes: ['notifications:read'],
      notificationHost: notificationApplicationHost,
      resolveScope: () => ({kind: 'connector', connectorId: 'productivity'}),
      assertCurrent, now,
    });
    if (quiet.tools?.length) tools.push(...quiet.tools);
    else if (quiet.unavailable) unavailable.push(quiet.unavailable);
    if (typeof quiet.close === 'function') disposers.push(() => quiet.close());
  } else unavailable.push('f12_quiet_hours_notification_host_unavailable');

  const observeName = runtimeModule.SYSTEM_OBSERVATION_TOOL_NAME ?? 'computer.system.observe';
  if (systemObserveTool?.descriptor?.name === observeName && typeof invokeSystemObserve === 'function'
    && typeof resolveSystemProbeOutcome === 'function' && typeof runtimeModule.createRuntimeF13SystemProbeHost === 'function') {
    const probe = runtimeModule.createRuntimeF13SystemProbeHost({
      getApplication, systemObserve: systemObserveTool,
      requiredScopes: [...(systemObserveTool.descriptor.requiredScopes ?? [])],
      invokeSystemObserve,
      resolveProbeOutcome: resolveSystemProbeOutcome,
      assertCurrent, now,
    });
    if (probe.tools?.length) tools.push(...probe.tools);
    else if (probe.unavailable) unavailable.push(probe.unavailable);
    if (typeof probe.close === 'function') disposers.push(() => probe.close());
  } else unavailable.push('f13_system_probe_observation_unavailable');

  if (Array.isArray(graphProviders)) {
    for (const provider of graphProviders) {
      if (!provider || typeof provider.compose !== 'function' || !WORKFLOW_ID.test(provider.workflowId ?? '')) {
        unavailable.push(provider?.unavailableReason || 'invalid_workflow_graph_provider');
        continue;
      }
      if (typeof provider.available === 'function' && provider.available() !== true) {
        unavailable.push(provider.unavailableReason || `${provider.workflowId.toLowerCase()}_provider_unavailable`);
        continue;
      }
      const composed = provider.compose({runtimeModule, getApplication, assertCurrent, now});
      if (!composed || typeof composed !== 'object') {
        unavailable.push(provider.unavailableReason || `${provider.workflowId.toLowerCase()}_provider_unavailable`);
        continue;
      }
      if (Array.isArray(composed.unavailable)) unavailable.push(...composed.unavailable.filter(item => typeof item === 'string' && item));
      else if (typeof composed.unavailable === 'string' && composed.unavailable) unavailable.push(composed.unavailable);
      const composedTools = Array.isArray(composed.tools) ? composed.tools : [];
      if (composedTools.length) tools.push(...composedTools);
      if (Array.isArray(composed.competitionToolAvailability)) competitionToolAvailability.push(...composed.competitionToolAvailability);
      if (Array.isArray(composed.competitionToolExports)) competitionToolExports.push(...composed.competitionToolExports);
      if (typeof composed.close === 'function') disposers.push(() => composed.close());
      else if (typeof composed.dispose === 'function') disposers.push(() => composed.dispose());

      // Register a workflow entry only when the provider actually produced that exact tool descriptor.
      const normalizedEntry = composed.entry
        ? normalizeWorkflowEntryBindings({[provider.workflowId]: composed.entry})[provider.workflowId]
        : undefined;
      if (normalizedEntry && composedTools.some(tool =>
        tool?.descriptor?.name === normalizedEntry.name && tool?.descriptor?.version === normalizedEntry.version)) {
        declaredEntries[provider.workflowId] = normalizedEntry;
      }
    }
  }

  void codingWorkspace; void todoHost; void feedsHost;
  const frozenEntries = normalizeWorkflowEntryBindings(declaredEntries);
  let closed = false;
  return {
    tools,
    unavailable,
    f09WorkerPorts: undefined,
    workflowEntries: frozenEntries,
    competitionToolAvailability,
    competitionToolExports,
    close() {
      if (closed) return;
      closed = true;
      for (const dispose of disposers) {
        try { dispose(); } catch { /* Cleanup of one graph provider must not skip the rest. */ }
      }
    },
  };
}
