import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {access, mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AuthorizationPolicy} from '@personal-agent/policy';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {TaskRuntime} from '@personal-agent/runtime';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createWindowsNativeDesktopControlHost} from '@personal-agent/windows-client';
import {createDesktopWindowsControlHost} from '../../../desktop/electron/windows-control-host.js';

// Requires the repository/package build and the two native builds to have finished.
// Deliberately separate from node --test: this script operates only its own visible WPF fixture.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const directory = path.join(root, '.cache', 'desktop-native-runtime', randomUUID());
const database = path.join(directory, 'runtime.sqlite');
const artifacts = path.join(directory, 'artifacts');
const executable = path.join(root, 'apps/windows-host/desktop/bin/Release/net8.0-windows/WindowsHost.Desktop.exe');
const fixtureExecutable = path.join(root, 'apps/windows-host/desktop/fixture/bin/Release/net8.0-windows/WindowsHost.DesktopFixture.exe');
const fixtureTitle = 'PersonalAgent synthetic desktop fixture';
const fixtureProcess = 'WindowsHost.DesktopFixture';
const expectedText = 'Synthetic Runtime exact-authorization native readback ' + randomUUID();
const deadline = new Date(Date.now() + 90_000).toISOString();
const checks = [], invocations = [], approved = [], attempts = [];
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
let application, desktop, fixture, taskId, stage = 'preflight', failure, stopSnapshot, finalTask, records, evidence;
let fixtureSpawnError, fixtureClosed = false, fixtureForcedCleanup = false, catalogFiltered = false;

function ownSnapshot(snapshot) {
  assert.equal(snapshot.window.processName, fixtureProcess);
  assert.equal(snapshot.window.title, fixtureTitle);
  assert.equal(snapshot.truncated, false);
  return snapshot;
}
const editor = snapshot => snapshot.controls.find(control => control.name === 'Synthetic editor' && control.patterns.includes('value'));
async function fixtureState() {return JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));}
async function waitForFixture(predicate) {
  const until = Math.min(Date.now() + 8000, Date.parse(deadline));
  while (Date.now() < until) {
    if (fixtureSpawnError) throw new Error('Synthetic fixture could not start');
    try {const value = await fixtureState(); if (value.pid === fixture.pid && predicate(value)) return value;} catch {}
    await sleep(40);
  }
  throw new Error('Synthetic fixture did not reach the expected state');
}
async function command(action) {
  const id = randomUUID(), temporary = path.join(directory, 'command.tmp');
  await writeFile(temporary, JSON.stringify({id, action}));
  await rename(temporary, path.join(directory, 'command.json'));
  return waitForFixture(state => state.commandId === id);
}
function mark(name) {checks.push({name, status: 'passed'});}

try {
  assert.equal(process.platform, 'win32', 'Real native acceptance requires Windows');
  await Promise.all([access(executable), access(fixtureExecutable)]);
  await mkdir(directory, {recursive: true});
  fixture = spawn(fixtureExecutable, ['--directory', directory], {windowsHide: false, stdio: 'ignore'});
  fixture.once('error', error => {fixtureSpawnError = error;});
  await waitForFixture(state => state.hwnd !== '0' && state.rendered);
  await sleep(100);

  desktop = createDesktopWindowsControlHost({
    isFullAccess: () => true, // Explicit synthetic-test host policy; still requires each real exact Policy grant below.
    allowObservationExport: false, // No model/AgentArts export is configured or invoked by this script.
    createControlHost(options) {
      const native = createWindowsNativeDesktopControlHost({...options, executable, artifactDirectory: artifacts});
      // Privacy-only test decorator. Real native list/refs/OS facts are unchanged; other users' titles
      // are discarded before Runtime persists the result. All subsequent methods are the original tools.
      const tools = native.tools.map(tool => tool.descriptor.name !== 'computer.desktop.list_windows' ? tool : {
        ...tool,
        async execute(input, context) {
          const result = await tool.execute(input, context);
          catalogFiltered = true;
          return {...result, windows: result.windows.filter(window => window.processName === fixtureProcess && window.title === fixtureTitle)};
        },
      });
      return {...native, tools};
    },
  });
  // This production factory creates the actual TaskRuntime, SQLite AuthorizationPolicy and ToolGateway.
  // No toolGateway/createToolGateway/policy/attempts/transport substitutes are injected here.
  application = createRuntimeApplication({path: database, profile: 'huawei_ict_agentarts',
    hostUserNamespace: 'synthetic-native-runtime-acceptance', tools: desktop.tools,
    isUserPresent: id => desktop.hasPresence(id)});
  desktop.bind(application);
  assert(application.runtime instanceof TaskRuntime);
  assert(application.runtime.policy instanceof AuthorizationPolicy);
  const start = await desktop.start({signal: new AbortController().signal, deadline});
  assert.equal(start.available, true);
  assert.equal(desktop.snapshot().provider.source, 'windows-native');
  const runtime = application.runtime;
  const task = runtime.submitTask({goal: 'Synthetic desktop exact authorization and native readback acceptance',
    conversationId: 'synthetic-native-runtime', idempotencyKey: 'synthetic-' + randomUUID()});
  taskId = task.taskId;
  runtime.saveCheckpoint(taskId, 'application-deadline', deadline);
  const descriptors = new Map(runtime.readToolDescriptors().map(descriptor => [descriptor.name, descriptor]));
  const scopeName = name => name === 'request_access' ? 'computer.request_access' : 'computer.desktop.' + name;

  async function wire(operation, payload, signal, extra = {}) {
    return runtime.send({kind: 'request', protocolVersion: '1.0.0', requestId: randomUUID(), taskId, deadline,
      operation, payload, ...extra}, signal);
  }
  async function approve(name, arguments_, signal) {
    const toolName = scopeName(name), descriptor = descriptors.get(toolName);
    assert(descriptor, 'Actual Runtime descriptor must exist');
    const approvalId = randomUUID(), argumentsDigest = toolArgumentsDigest(arguments_);
    const approval = runtime.requestToolApproval(approvalId, taskId, descriptor, deadline, argumentsDigest);
    assert.equal(runtime.getTask(taskId).state, 'waiting_approval');
    assert.equal(runtime.policy.get(approvalId), undefined);
    const response = await wire('authorization.respond', {approvalId, expectedRevision: approval.revision, decision: 'allow_once'}, signal);
    assert.equal(response.outcome, 'ok');
    const grant = runtime.policy.get(approvalId);
    assert.equal(grant.taskId, taskId); assert.equal(grant.toolName, toolName);
    assert.equal(grant.argumentsDigest, argumentsDigest); assert.equal(grant.usesRemaining, 1);
    assert.deepEqual(grant.scopes, descriptor.requiredScopes);
    runtime.transitionTask(taskId, 'running');
    approved.push({approvalId, toolName, argumentsDigest, revision: runtime.getApproval(approvalId).revision});
    return approvalId;
  }
  async function invoke(name, arguments_, authorizationRef, signal, runId = randomUUID()) {
    const toolName = scopeName(name), descriptor = descriptors.get(toolName);
    const response = await wire('tool.invoke', {toolName, toolVersion: descriptor.version,
      arguments: arguments_, scopeRef: authorizationRef}, signal, {idempotencyKey: runId});
    const record = runtime.readToolExecutions(taskId).find(value => value.evidenceId === runId);
    assert(record); assert.equal(record.taskId, taskId); assert.equal(record.toolName, toolName);
    assert(runtime.matchesToolExecutionInput(record, {arguments: arguments_, scopeRef: authorizationRef}));
    invocations.push({runId, toolName, authorizationRef, outcome: response.outcome});
    return {response, record, runId, authorizationRef};
  }
  async function confirmed(name, arguments_, signal) {
    const authorizationRef = await approve(name, arguments_, signal);
    const invocation = await invoke(name, arguments_, authorizationRef, signal);
    assert.equal(invocation.response.outcome, 'ok', 'Actual tool.invoke must succeed');
    assert.equal(invocation.response.data.state, 'confirmed');
    assert.equal(invocation.record.policyDecision, 'allow');
    assert.equal(invocation.record.executionStarted, true);
    assert.equal(invocation.record.state, 'confirmed');
    assert.equal(runtime.policy.get(authorizationRef).usesRemaining, 0);
    const cached = runtime.loadCheckpoint(taskId, 'tool-result-' + invocation.runId);
    assert.deepEqual(cached.result, invocation.response.data.result);
    return {...invocation, result: invocation.response.data.result};
  }
  function assertAttempt(invocation, arguments_) {
    const saved = runtime.loadCheckpoint(taskId, 'windows-desktop-attempt:' + invocation.runId);
    assert(saved, 'The real Desktop attempts port must persist the original Runtime identity');
    assert.deepEqual({...saved, observationDigest: undefined}, {taskId, runId: invocation.runId,
      toolName: invocation.record.toolName, toolVersion: invocation.record.toolVersion,
      authorizationRef: invocation.authorizationRef, argumentsDigest: toolArgumentsDigest(arguments_),
      targetRef: arguments_.targetRef ?? arguments_.windowRef, observationDigest: undefined});
    assert.match(saved.observationDigest, /^[a-f0-9]{64}$/);
    attempts.push(saved);
  }

  finalTask = await runtime.runTask(taskId, async context => {
    context.declareRuntimeToolTracking();
    stage = 'unapproved-presence-refusal';
    const unapproved = await invoke('observe', {}, 'synthetic-no-grant', context.signal);
    assert.equal(unapproved.response.outcome, 'error'); assert.equal(unapproved.response.error.code, 'UNAUTHORIZED');
    assert.equal(unapproved.record.executionStarted, false); assert.equal(unapproved.record.policyDecision, 'deny');
    mark('real-gateway-refuses-unapproved-presence-with-nondispatched-runtime-record');

    stage = 'request-access';
    const presence = await confirmed('request_access', {}, context.signal);
    assert.equal(presence.result.state, 'policy_allowed');
    assert.equal(presence.result.authorizationGranted, false);
    assert.equal(desktop.hasPresence(taskId), true);
    mark('real-task-approval-establishes-host-presence-without-self-granting-control');

    stage = 'list-and-activate';
    const listed = await confirmed('list_windows', {}, context.signal);
    assert.equal(catalogFiltered, true); assert.equal(listed.result.windows.length, 1);
    const windowRef = listed.result.windows[0].windowRef;
    const activateArguments = {windowRef};
    const activated = await confirmed('activate', activateArguments, context.signal);
    assert.equal(activated.result.verification.kind, 'foreground');
    ownSnapshot(activated.result.snapshot); assertAttempt(activated, activateArguments);
    mark('real-native-list-activate-original-runtime-attempt');

    stage = 'observe';
    const observed = await confirmed('observe', {windowRef}, context.signal);
    const snapshot = ownSnapshot(observed.result.snapshot); assert(editor(snapshot));
    assert.equal(editor(snapshot).value, 'synthetic-before');
    mark('real-native-task-bound-observation');

    stage = 'changed-arguments-refusal';
    const writeArguments = {targetRef: snapshot.targetRef, controlRef: editor(snapshot).ref, text: expectedText};
    const writeApproval = await approve('set_value', writeArguments, context.signal);
    const altered = await invoke('set_value', {...writeArguments, text: 'Synthetic substitution must never be written'}, writeApproval, context.signal);
    assert.equal(altered.response.outcome, 'error'); assert.equal(altered.response.error.code, 'SCOPE_DENIED');
    assert.equal(altered.record.executionStarted, false); assert.equal(altered.record.policyDecision, 'deny');
    assert.equal(runtime.policy.get(writeApproval).usesRemaining, 1);
    assert.equal((await fixtureState()).text, 'synthetic-before');
    assert.equal(runtime.loadCheckpoint(taskId, 'windows-desktop-attempt:' + altered.runId), undefined);
    mark('real-policy-argument-substitution-refused-before-device-dispatch');

    stage = 'set-value-readback';
    const written = await invoke('set_value', writeArguments, writeApproval, context.signal);
    assert.equal(written.response.outcome, 'ok'); assert.equal(written.response.data.state, 'confirmed');
    assert.equal(written.record.policyDecision, 'allow'); assert.equal(written.record.executionStarted, true);
    assert.equal(runtime.policy.get(writeApproval).usesRemaining, 0);
    const writeResult = written.response.data.result;
    assert.equal(writeResult.verification.state, 'verified'); assert.equal(writeResult.verification.kind, 'value');
    assert.equal(writeResult.verification.actual, expectedText);
    ownSnapshot(writeResult.snapshot); assert.equal(editor(writeResult.snapshot).value, expectedText);
    await waitForFixture(state => state.text === expectedText);
    assertAttempt(written, writeArguments);
    mark('real-authorized-native-set-value-UIA-and-independent-fixture-readback');

    stage = 'original-run-replay';
    const count = runtime.readToolExecutions(taskId).length;
    const replay = await invoke('set_value', writeArguments, writeApproval, context.signal, written.runId);
    assert.equal(replay.response.outcome, 'ok'); assert.deepEqual(replay.response.data.result, writeResult);
    assert.equal(runtime.readToolExecutions(taskId).length, count);
    assert.equal(runtime.listCheckpointKeys(taskId).filter(key => key.startsWith('windows-desktop-attempt:')).length, 2);
    assert.equal((await fixtureState()).text, expectedText);
    mark('original-confirmed-run-replays-cached-result-without-second-attempt');

    stage = 'screenshot';
    const image = await confirmed('screenshot', {targetRef: writeResult.snapshot.targetRef}, context.signal);
    assert.equal(image.result.state, 'screenshot'); assert.equal(image.result.artifact.modelVisionAvailable, false);
    assert.deepEqual(Object.keys(image.result.artifact).sort(), ['artifactId', 'height', 'mimeType', 'modelVisionAvailable', 'sha256', 'width']);
    const png = await readFile(path.join(artifacts, image.result.artifact.artifactId + '.png'));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(sha256(png), image.result.artifact.sha256);
    mark('real-runtime-screenshot-keeps-pixels-local-and-records-only-artifact-metadata');

    stage = 'stop';
    const beforeStop = runtime.readToolExecutions(taskId).length;
    stopSnapshot = await desktop.stop();
    assert.equal(stopSnapshot.state, 'stopped'); assert.equal(stopSnapshot.available, false);
    assert.equal(desktop.hasPresence(taskId), false);
    assert.equal(runtime.readToolExecutions(taskId).length, beforeStop, 'Lifecycle stop must not invent a tool run');
    const afterStopGrant = await approve('observe', {windowRef}, context.signal);
    const afterStop = await invoke('observe', {windowRef}, afterStopGrant, context.signal);
    assert.equal(afterStop.response.outcome, 'error'); assert.equal(afterStop.record.executionStarted, false);
    assert.equal(afterStop.record.policyDecision, 'deny');
    mark('real-native-stop-revokes-presence-and-gateway-refuses-further-observation');

    stage = 'runtime-evidence';
    records = runtime.readToolExecutions(taskId); evidence = runtime.readEvidence(taskId);
    assert(records.every(record => ['confirmed', 'failed'].includes(record.state)));
    assert.equal(evidence.length, records.length);
    for (const record of records) {
      const item = evidence.find(value => value.evidenceId === record.evidenceId);
      assert.equal(item.kind, 'execution'); assert.equal(item.sourceRef, record.toolName);
      assert.equal(item.verification, 'conditional', 'Generic Runtime execution Evidence must not be upgraded to UIA goal verification');
    }
    const listCache = runtime.loadCheckpoint(taskId, 'tool-result-' + listed.runId).result;
    assert.equal(listCache.windows.length, 1); assert.equal(listCache.windows[0].title, fixtureTitle);
    mark('real-original-run-records-and-conditional-evidence-match-without-second-task-store');
    return {resultSummary: 'Synthetic native Runtime authorization, UIA readback, local screenshot and stop checks passed.',
      evidenceRefs: records.map(record => record.evidenceId)};
  }, {deadline, sideEffect: 'external_write'});
  assert.equal(finalTask.state, 'succeeded', 'The actual TaskRuntime worker must finish all assertions');
} catch (error) {
  failure = {stage, code: typeof error?.code === 'string' ? error.code : error?.name ?? 'EXTERNAL_FAILURE'};
} finally {
  if (desktop) {try {await desktop.close();} catch {failure ??= {stage: 'native-cleanup', code: 'EXTERNAL_FAILURE'};}}
  if (fixture && !fixtureSpawnError) {
    try {await command('close');} catch {}
    for (let index = 0; index < 25 && fixture.exitCode === null; index++) await sleep(40);
    if (fixture.exitCode === null) {fixtureForcedCleanup = true; fixture.kill();}
    fixtureClosed = fixture.exitCode !== null || fixture.killed;
  }
  if (application) application.close();
}

if (!failure && taskId) {
  stage = 'durable-readback';
  const reopened = new TaskRuntime(database);
  try {
    assert.equal(reopened.getTask(taskId).state, 'succeeded');
    assert.deepEqual(reopened.readToolExecutions(taskId), records);
    assert.deepEqual(reopened.readEvidence(taskId), evidence);
    for (const attempt of attempts) assert.deepEqual(reopened.loadCheckpoint(taskId, 'windows-desktop-attempt:' + attempt.runId), attempt);
    mark('original-sqlite-task-run-evidence-and-attempts-survive-read-only-reopen');
  } catch (error) {failure = {stage, code: error?.name ?? 'EXTERNAL_FAILURE'};} finally {reopened.close();}
}
await mkdir(directory, {recursive: true});
const receipt = {recordedAt: new Date().toISOString(), status: failure ? 'failed' : 'passed',
  scope: 'real-TaskRuntime-SQLite-AuthorizationPolicy-ToolGateway-Desktop-wrapper-native-WPF-synthetic-device',
  protocol: 'personal-agent-desktop/1', profile: 'huawei_ict_agentarts', modelCalls: 0, cloudCalls: 0, accountCalls: 0,
  taskId, taskState: finalTask?.state, checks, approvals: approved, invocations, nativeAttempts: attempts,
  toolExecutionRecords: records, evidence, stopState: stopSnapshot?.state, fixtureClosed, fixtureForcedCleanup,
  testDecorator: {method: 'list_windows', kind: 'privacy-only-output-filter', retains: 'exact synthetic fixture processName/title',
    preserves: ['native windowRef', 'native OS facts', 'original native activation/observation/write/screenshot', 'original Runtime Policy/Gateway/attempts/Evidence']},
  limitations: ['Deterministic trusted test worker and explicit synthetic approvals; no model, Electron renderer, AgentArts, cloud or installer acceptance.',
    'The catalog privacy decorator is test-only and does not replace the separate unmodified native protocol/device acceptance.',
    'Generic Runtime execution Evidence remains conditional; verified value is the native UIA readback plus independent synthetic fixture state.',
    'Lifecycle stop has no fabricated tool execution record; its real acknowledgement and post-stop Gateway refusal are asserted.'],
  ...(failure ? {failure} : {})};
await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({status: receipt.status, directory, checks: checks.length, taskId, ...(failure ? {failure} : {})}));
if (failure) process.exitCode = 1;
