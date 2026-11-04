import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRuntimeF22ShadowObservationHost,
  createF22TraceReplayWorkflowPorts,
  createRuntimeF26DeploymentReadbackHost,
  createF26WorkflowWorkerPorts,
  createRuntimeF28NativeConfigHost,
  createRuntimeF28NativeConfigGuard,
  createF28ModelCandidateWorkflowPorts
} from '@personal-agent/runtime/application';
import {createDesktopF22WorkflowWorkerPorts} from '../electron/f22-trace-replay-host.js';
import {createConfiguredDesktopF26WorkflowPorts} from '../electron/f26-workflow-worker-ports.js';
import {createF28ModelGraphPorts} from '../electron/f28-model-graph-ports.js';
import {createDesktopF28WorkflowWorkerPorts} from '../electron/f28-model-workflow-ports.js';
import {correlateOwnedImageControlPlane, planOwnedImageBuild} from '@personal-agent/agentarts';

function createHostFixture(workflowId, nodeId, toolName, args = {}) {
  const now = Date.now();
  const deadline = new Date(now + 60_000).toISOString();
  const signal = new AbortController().signal;
  const map = new Map();
  const put = (id, key, value) => map.set(id + '|' + key, value);

  put('child', 'coding-repair:parent', {taskId: 'parent', operationId: 'operation'});
  put('child', 'host-tool-intent', {commandId: 'operation', toolName, arguments: args, deadline});
  put('parent', 'owned-workflow:intent:operation', {
    taskId: 'parent',
    workflowId,
    sessionId: 'session',
    deadline,
    proposal: {nodeId, operationId: 'operation', toolName, arguments: args}
  });

  const runtime = {
    loadCheckpoint: (id, key) => map.get(id + '|' + key),
    saveCheckpointOnce: (id, key, value) => {
      const slot = id + '|' + key;
      if (map.has(slot)) return false;
      map.set(slot, value);
      return true;
    },
    getTask: () => ({state: 'running', cancelRequested: false})
  };

  const context = {
    taskId: 'child',
    runId: 'host-tool-child',
    authorizationRef: 'grant',
    scopes: ['fixture:read', 'workflow:trace_replay', 'workflow:deployment', 'workflow:models'],
    deadline,
    signal
  };

  let gate = true;
  let exportAllowed = true;
  const ports = {
    application: {runtime},
    requiredScopes: ['fixture:read'],
    assertCurrent: () => {if (!gate) throw new Error('gate');},
    authorizeExport: async () => exportAllowed,
    now: () => new Date(now),
    context,
    gateOff: () => {gate = false;},
    denyExport: () => {exportAllowed = false;}
  };

  return {...ports, put};
}

// ---------------------------------------------------------------------------
// F22: Shadow Observation & Trace Replay Gates
// ---------------------------------------------------------------------------
test('F22 shadow observation host stays unavailable when unconfigured and fails closed on malformed read or denied export', async () => {
  // 1. Missing options
  const unconfigured = createRuntimeF22ShadowObservationHost();
  assert.equal(unconfigured.tools.length, 0);
  assert.equal(unconfigured.unavailable, 'f22_shadow_observation_trusted_ports_unavailable');

  // Missing required callbacks
  assert.equal(createRuntimeF22ShadowObservationHost({application: {runtime: {}}}).tools.length, 0);

  const f = createHostFixture('F22', 'F22_N01', 'workflow.host.f22_n01');

  // 2. Port throws error -> UNSUPPORTED_CAPABILITY
  const throwHost = createRuntimeF22ShadowObservationHost({
    ...f,
    readVersionedSnapshot: async () => {throw new Error('remote unavailable');}
  });
  await assert.rejects(throwHost.tools[0].execute({}, f.context), {code: 'UNSUPPORTED_CAPABILITY'});

  // 3. Port returns malformed data (null, non-object, array, missing frozenComparisonInput) -> UNSUPPORTED_CAPABILITY
  for (const bad of [null, undefined, 'string', {frozenComparisonInput: 'not-an-object'}, {frozenComparisonInput: []}, {}]) {
    const malformedHost = createRuntimeF22ShadowObservationHost({
      ...f,
      readVersionedSnapshot: async () => bad
    });
    await assert.rejects(malformedHost.tools[0].execute({}, f.context), {code: 'UNSUPPORTED_CAPABILITY'});
  }

  // 4. Export denied by policy/user -> UNAUTHORIZED
  f.denyExport();
  const deniedHost = createRuntimeF22ShadowObservationHost({
    ...f,
    readVersionedSnapshot: async () => ({frozenComparisonInput: {key: 'val'}})
  });
  await assert.rejects(deniedHost.tools[0].execute({}, f.context), {code: 'UNAUTHORIZED'});

  // 5. Revision drift between reads -> REVISION_CONFLICT
  let readCount = 0;
  const driftingHost = createRuntimeF22ShadowObservationHost({
    ...f,
    authorizeExport: async () => true,
    readVersionedSnapshot: async () => {
      readCount++;
      return {frozenComparisonInput: {version: readCount}};
    }
  });
  await assert.rejects(driftingHost.tools[0].execute({}, f.context), {code: 'REVISION_CONFLICT'});

  // 6. Valid fixture passes without inventing success
  const validHost = createRuntimeF22ShadowObservationHost({
    ...f,
    authorizeExport: async () => true,
    readVersionedSnapshot: async () => ({frozenComparisonInput: {mode: 'shadow_v1', diff: 'none'}})
  });
  const result = await validHost.tools[0].execute({}, f.context);
  assert.deepEqual(result, {frozenComparisonInput: {mode: 'shadow_v1', diff: 'none'}});
});

test('F22 trace replay ports stay unavailable without options and reject disabled/unauthorized admissions', async () => {
  // 1. Missing options
  const unconfigured = createF22TraceReplayWorkflowPorts();
  assert.equal(unconfigured.tools.length, 0);
  assert.equal(unconfigured.configuredWorkflowWorkerPorts.length, 0);
  assert.equal(unconfigured.unavailable, 'f22_original_trace_ports_unavailable');

  // 2. Desktop wrapper missing options
  const desktopUnconfigured = createDesktopF22WorkflowWorkerPorts();
  assert.equal(desktopUnconfigured.tools.length, 0);
  assert.equal(desktopUnconfigured.unavailable, 'f22_desktop_trace_ports_unavailable');

  // 3. Admission disabled -> worker available returns false
  const fakeApp = {runtime: {getTask: () => ({state: 'running', cancelRequested: false}), loadCheckpoint: () => 'dead'}, readDelegatedUserTaskParent: () => ({taskId: 'parent', deadline: 'dead'})};
  const ports = createF22TraceReplayWorkflowPorts({
    application: fakeApp,
    hostUserNamespace: 'user-ns',
    getToolDescriptor: () => undefined,
    readAdmission: () => ({revision: 1, advancedEnabled: false, shadowAllowed: false, mainPriorityAvailable: false}),
    authorizeExport: async () => false
  });
  assert.equal(ports.unavailable, null);
  const worker = ports.configuredWorkflowWorkerPorts[0];
  assert.equal(worker.available({taskId: 'task', deadline: new Date(Date.now() + 10000).toISOString(), signal: new AbortController().signal}), false);
});

// ---------------------------------------------------------------------------
// F26: Deployment Readback & Release Gate
// ---------------------------------------------------------------------------
test('F26 deployment readback host stays unavailable when unconfigured and fails closed on probe omission or transport failure', async () => {
  // 1. Missing options
  const unconfigured = createRuntimeF26DeploymentReadbackHost();
  assert.equal(unconfigured.tools.length, 0);
  assert.equal(unconfigured.unavailable, 'f26_deployment_readback_trusted_ports_unavailable');

  const f = createHostFixture('F26', 'F26_N03', 'workflow.host.f26_n03');

  // 2. readDeploymentRuntime throws -> UNSUPPORTED_CAPABILITY
  const throwHost = createRuntimeF26DeploymentReadbackHost({
    ...f,
    readDeploymentRuntime: async () => {throw new Error('API 500');}
  });
  await assert.rejects(throwHost.tools[0].execute({}, f.context), {code: 'UNSUPPORTED_CAPABILITY'});

  // 3. Returning non-boolean podRunning or readinessProbe -> UNSUPPORTED_CAPABILITY (never assumes READY = running)
  for (const bad of [
    null,
    undefined,
    {podRunning: 'true', readinessProbe: true},
    {podRunning: true, readinessProbe: 'unverified'},
    {podRunning: true},
    {readinessProbe: true}
  ]) {
    const malformedHost = createRuntimeF26DeploymentReadbackHost({
      ...f,
      readDeploymentRuntime: async () => bad
    });
    await assert.rejects(malformedHost.tools[0].execute({}, f.context), {code: 'UNSUPPORTED_CAPABILITY'});
  }

  // 4. Export denied -> UNAUTHORIZED
  f.denyExport();
  const deniedHost = createRuntimeF26DeploymentReadbackHost({
    ...f,
    readDeploymentRuntime: async () => ({podRunning: true, readinessProbe: true})
  });
  await assert.rejects(deniedHost.tools[0].execute({}, f.context), {code: 'UNAUTHORIZED'});

  // 5. Revision drift between reads -> REVISION_CONFLICT
  let count = 0;
  const driftHost = createRuntimeF26DeploymentReadbackHost({
    ...f,
    authorizeExport: async () => true,
    readDeploymentRuntime: async () => {
      count++;
      return {podRunning: count === 1, readinessProbe: true};
    }
  });
  await assert.rejects(driftHost.tools[0].execute({}, f.context), {code: 'REVISION_CONFLICT'});

  // 6. Valid fixture passes
  const validHost = createRuntimeF26DeploymentReadbackHost({
    ...f,
    authorizeExport: async () => true,
    readDeploymentRuntime: async () => ({podRunning: true, readinessProbe: true})
  });
  const res = await validHost.tools[0].execute({}, f.context);
  assert.deepEqual(res, {podRunning: true, readinessProbe: true});
});

test('F26 release worker stays unavailable when unconfigured and Desktop wrapper refuses to export release command on unavailable ports', async () => {
  // 1. Runtime createF26WorkflowWorkerPorts unconfigured
  const unconfiguredRuntime = createF26WorkflowWorkerPorts();
  assert.equal(unconfiguredRuntime.tools.length, 0);
  assert.equal(unconfiguredRuntime.configuredWorkflowWorkerPorts.length, 0);
  assert.equal(unconfiguredRuntime.unavailable, 'f26_workflow_worker_ports_unavailable');
  assert.throws(() => unconfiguredRuntime.readBuildBinding({}), {code: 'UNAUTHORIZED'});

  // 2. Desktop wrapper unconfigured
  const unconfiguredDesktop = createConfiguredDesktopF26WorkflowPorts();
  assert.equal(unconfiguredDesktop.tools.length, 0);
  assert.equal(unconfiguredDesktop.configuredWorkflowWorkerPorts.length, 0);
  assert.equal(unconfiguredDesktop.unavailable, 'f26_original_release_sources_unavailable');

  // 3. Desktop wrapper when runtimeModule returns unavailable: tools MUST be [] (must NOT export workspace.f26_release)
  const fakeRuntimeModule = {
    createF26WorkflowWorkerPorts: () => ({
      tools: [],
      configuredWorkflowWorkerPorts: [],
      unavailable: 'f26_underlying_ports_missing',
      readBuildBinding: () => {throw new Error();}
    })
  };
  const portsWithUnavailableRuntime = createConfiguredDesktopF26WorkflowPorts({
    runtimeModule: fakeRuntimeModule,
    codingModule: {createWorkspaceCommandTool: () => ({})},
    getApplication: () => ({}),
    agentArtsConfig: {readReleaseBinding: () => ({}), snapshot: () => ({configured: true})},
    getAgentArtsModels: () => ({snapshot: () => ({catalog: {revision: '1'}}), readExecutionModel: () => ({catalogRevision: '1'})}),
    nativeExecutionHost: {createCommandTool: () => ({}), readOriginalF26Release: () => ({})},
    repositoryRoot: process.cwd(),
    nodeExecutable: process.execPath,
    powerShellPath: process.execPath,
    dockerPath: process.execPath,
    gitPath: process.execPath,
    npmCli: process.execPath,
    authorizeDeployment: async () => true,
    toolExports: [],
    prepareCompetitionToolExport: async () => {},
    authorizeExport: async () => true
  });
  // Must be unavailable and tools MUST be empty!
  assert.equal(portsWithUnavailableRuntime.unavailable, 'f26_underlying_ports_missing');
  assert.equal(portsWithUnavailableRuntime.tools.length, 0);
  assert.equal(portsWithUnavailableRuntime.configuredWorkflowWorkerPorts.length, 0);
});

test('F26 control plane correlation refuses to treat READY as container probe and handles missing readback as unavailable', () => {
  const plan = planOwnedImageBuild({
    sourceRevision: 'a'.repeat(40),
    sourceDigest: 'b'.repeat(64),
    scriptDigest: 'c'.repeat(64),
    recipeId: 'f26-owned-image-release',
    imageTag: 'personal_agent_f26_v1',
    registryRepository: 'swr.cn-southwest-2.myhuaweicloud.com/pa/repo',
    architecture: 'arm64'
  });

  const expectedPin = {
    runtimeId: 'rt-1',
    runtimeName: 'runtime-1',
    endpointId: 'ep-1',
    endpointName: 'v1.0.0',
    version: 'v1.0.0',
    imageDigest: 'sha256:' + 'e'.repeat(64)
  };

  // 1. Missing readback -> state: unavailable, reason: control_plane_reader_missing
  const missingReadback = correlateOwnedImageControlPlane(plan, expectedPin, undefined);
  assert.equal(missingReadback.state, 'unavailable');
  assert.equal(missingReadback.reason, 'control_plane_reader_missing');
  assert.equal(missingReadback.containerExecution, 'unverified');
  assert.equal(missingReadback.readinessProbe, 'unverified');

  // 2. Mismatched pin identity -> state: rejected
  const mismatched = correlateOwnedImageControlPlane(plan, expectedPin, {
    ...expectedPin,
    version: 'v2.0.0',
    imageTag: plan.imageTag,
    architecture: 'arm64',
    runtimeReady: true
  });
  assert.equal(mismatched.state, 'rejected');

  // 3. Matched identity with runtimeReady: true -> containerExecution and readinessProbe remain 'unverified'
  const matched = correlateOwnedImageControlPlane(plan, expectedPin, {
    ...expectedPin,
    imageTag: plan.imageTag,
    architecture: 'arm64',
    runtimeReady: true
  });
  assert.equal(matched.state, 'control_plane_matched');
  assert.equal(matched.runtimeReady, true);
  assert.equal(matched.containerExecution, 'unverified');
  assert.equal(matched.readinessProbe, 'unverified');
});

// ---------------------------------------------------------------------------
// F28: Model Capability Gate
// ---------------------------------------------------------------------------
test('F28 native config host & guard fail closed on missing boolean roles or invalid guard states', async () => {
  // 1. Host unconfigured
  const unconfiguredHost = createRuntimeF28NativeConfigHost();
  assert.equal(unconfiguredHost.tools.length, 0);
  assert.equal(unconfiguredHost.unavailable, 'f28_native_config_trusted_ports_unavailable');

  // 2. Guard unconfigured
  const unconfiguredGuard = createRuntimeF28NativeConfigGuard();
  assert.equal(unconfiguredGuard.tools.length, 0);
  assert.equal(unconfiguredGuard.unavailable, 'f28_native_config_guard_trusted_ports_unavailable');

  const f = createHostFixture('F28', 'F28_N03', 'workflow.host.f28_n03', {check: 'roles'});

  // 3. Host readNativeConfig throws -> UNSUPPORTED_CAPABILITY
  const throwHost = createRuntimeF28NativeConfigHost({
    ...f,
    readNativeConfig: async () => {throw new Error('gateway failed');}
  });
  await assert.rejects(throwHost.tools[0].execute({check: 'roles'}, f.context), {code: 'UNSUPPORTED_CAPABILITY'});
  // 3b. Cancellation / unknown result keep their original code (not masked as unavailable)
  for (const code of ['CANCELLED', 'TIMEOUT', 'RESULT_UNKNOWN']) {
    const coded = createRuntimeF28NativeConfigHost({
      ...f,
      readNativeConfig: async () => {throw Object.assign(new Error(code), {code});}
    });
    await assert.rejects(coded.tools[0].execute({check: 'roles'}, f.context), {code});
  }

  // 4. Host readNativeConfig missing boolean role (e.g. only budget/thinking numbers) -> UNSUPPORTED_CAPABILITY
  for (const bad of [
    null,
    {check: 'roles', research: 'yes', analysis: true, coder: true},
    {check: 'roles', research: true, analysis: 1, coder: true},
    {check: 'roles', research: true, analysis: true, coder: null},
    {check: 'mismatched-check', research: true, analysis: true, coder: true}
  ]) {
    const badHost = createRuntimeF28NativeConfigHost({
      ...f,
      readNativeConfig: async () => bad
    });
    await assert.rejects(badHost.tools[0].execute({check: 'roles'}, f.context), {code: 'UNSUPPORTED_CAPABILITY'});
  }

  // 5. Host authorizeExport denied -> UNAUTHORIZED
  f.denyExport();
  const deniedHost = createRuntimeF28NativeConfigHost({
    ...f,
    readNativeConfig: async () => ({check: 'roles', research: true, analysis: true, coder: true})
  });
  const res = await deniedHost.tools[0].execute({check: 'roles'}, f.context);
  assert.deepEqual(res, {check: 'roles', research: true, analysis: true, coder: true});
  await assert.rejects(deniedHost.authorizeReceipt({context: f.context, result: res}), {code: 'UNAUTHORIZED'});

  // 6. Guard invalid state returned -> UNSUPPORTED_CAPABILITY
  const guardInput = {
    workflowId: 'F28',
    nodeId: 'F28_N03',
    input: {check: 'roles'},
    predecessorOutputs: {},
    predecessorStates: {}
  };
  const gf = createHostFixture('F28', 'F28_N03', 'workflow.guard.f28_n03', guardInput);
  const badGuard = createRuntimeF28NativeConfigGuard({
    ...gf,
    resolveGuardState: async () => 'active_promoted' // not in ['selected', 'skipped', 'unknown']
  });
  await assert.rejects(badGuard.tools[0].execute(guardInput, gf.context), {code: 'UNSUPPORTED_CAPABILITY'});
});

test('F28 Desktop model graph ports refuse to invent role capabilities from thinking flags or budgets', async () => {
  // 1. Missing options
  const unconfigured = createF28ModelGraphPorts();
  assert.equal(unconfigured.unavailable, 'f28_native_config_desktop_ports_unavailable');
  assert.equal(unconfigured.ports, undefined);

  // 2. readHarnessConfiguration returning non-object
  const portsWithNullConfig = createF28ModelGraphPorts({
    getApplication: () => ({runtime: {getTask: () => ({state: 'running'})}}),
    modelApiHost: {readHarnessConfiguration: () => null},
    authorizeExport: async () => true
  });
  assert.equal(portsWithNullConfig.unavailable, null);
  await assert.rejects(
    portsWithNullConfig.ports.readNativeConfig({taskId: 'task'}, {check: 'roles'}),
    {code: 'UNSUPPORTED_CAPABILITY'}
  );

  // 3. Harness configuration without boolean roles (e.g. only budget/thinking/tokens)
  const portsWithNoRoles = createF28ModelGraphPorts({
    getApplication: () => ({runtime: {getTask: () => ({state: 'running'})}}),
    modelApiHost: {readHarnessConfiguration: () => ({maxTokens: 4096, nativeReasoning: true})},
    authorizeExport: async () => true
  });
  await assert.rejects(
    portsWithNoRoles.ports.readNativeConfig({taskId: 'task'}, {check: 'roles'}),
    {code: 'UNSUPPORTED_CAPABILITY'}
  );

  // 4. Harness configuration with string/non-boolean roles
  const portsWithInvalidRoles = createF28ModelGraphPorts({
    getApplication: () => ({runtime: {getTask: () => ({state: 'running'})}}),
    modelApiHost: {readHarnessConfiguration: () => ({roles: {research: true, analysis: 'true', coder: false}})},
    authorizeExport: async () => true
  });
  await assert.rejects(
    portsWithInvalidRoles.ports.readNativeConfig({taskId: 'task'}, {check: 'roles'}),
    {code: 'UNSUPPORTED_CAPABILITY'}
  );

  // 5. Without resolveOriginalDispatchState, guard state stays 'unknown' (never pretends selected)
  const portsWithoutDispatch = createF28ModelGraphPorts({
    getApplication: () => ({runtime: {getTask: () => ({state: 'running'})}}),
    modelApiHost: {readHarnessConfiguration: () => ({roles: {research: true, analysis: true, coder: true}})},
    authorizeExport: async () => true
  });
  assert.equal(await portsWithoutDispatch.ports.resolveGuardState({taskId: 'task'}, {}), 'unknown');
});

test('F28 candidate ports stay unavailable when unconfigured and fail closed when text capability is missing', () => {
  // 1. Runtime unconfigured
  const unconfiguredRuntime = createF28ModelCandidateWorkflowPorts();
  assert.equal(unconfiguredRuntime.tools.length, 0);
  assert.equal(unconfiguredRuntime.configuredWorkflowWorkerPorts.length, 0);
  assert.equal(unconfiguredRuntime.unavailable, 'f28_original_model_ports_unavailable');

  // 2. Desktop unconfigured
  const unconfiguredDesktop = createDesktopF28WorkflowWorkerPorts();
  assert.equal(unconfiguredDesktop.tools.length, 0);
  assert.equal(unconfiguredDesktop.configuredWorkflowWorkerPorts.length, 0);
  assert.equal(unconfiguredDesktop.unavailable, 'f28_desktop_model_ports_unavailable');

  // 3. Missing text capability -> worker available is false
  const fakeApp = {
    runtime: {getTask: () => ({state: 'running', cancelRequested: false, goal: 'goal'}), loadCheckpoint: () => 'dead'},
    readDelegatedUserTaskParent: () => ({taskId: 'parent', deadline: 'dead'}),
    readAuthorizationQuestionDestination: () => 'dest'
  };
  const portsMissingText = createF28ModelCandidateWorkflowPorts({
    application: fakeApp,
    readModels: () => ({
      research: {id: 'm1', configurationRef: 'c1', destination: {}, deployment: {capabilities: {text: false}}},
      analysis: {id: 'm2', configurationRef: 'c2', destination: {}, deployment: {capabilities: {text: true}}},
      coder: {id: 'm3', configurationRef: 'c3', destination: {}, deployment: {capabilities: {text: true}}}
    }),
    complete: async () => ({}),
    confirmModelExport: async () => true,
    authorizeExport: async () => true
  });
  assert.equal(portsMissingText.unavailable, null);
  const worker = portsMissingText.configuredWorkflowWorkerPorts[0];
  assert.equal(worker.available({taskId: 't', deadline: 'dead', signal: new AbortController().signal}), false);
});
