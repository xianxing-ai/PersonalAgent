// Manual LIVE model/image/native joint acceptance. Writing/checking this script does not run it.
// Use only after explicit model/network authorization and an exclusive Windows input slot.
// The released Linux ARM64 image's original replies are forwarded unchanged; no model answer is fabricated.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {access, mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@personal-agent/client';
import {AuthorizationPolicy} from '@personal-agent/policy';
import {TaskRuntime} from '@personal-agent/runtime';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {deriveOwnedWorkflowKeys} from '@personal-agent/agentarts';
import {createWindowsNativeDesktopControlHost} from '@personal-agent/windows-client';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createDesktopWindowsControlHost} from '../../../apps/desktop/electron/windows-control-host.js';
import {createComputerControlLease} from '../../../apps/desktop/electron/computer-control-lease.js';
import {createToolPresenceHost} from '../../../apps/desktop/electron/tool-presence-host.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runId = randomUUID(), directory = path.join(root, '.cache', 'computer-control-native-joint', runId);
const database = path.join(directory, 'runtime.sqlite'), artifactDirectory = path.join(directory, 'artifacts');
const executable = path.join(root, 'apps/windows-host/desktop/bin/Release/net8.0-windows/WindowsHost.Desktop.exe');
const fixtureExecutable = path.join(root, 'apps/windows-host/desktop/fixture/bin/Release/net8.0-windows/WindowsHost.DesktopFixture.exe');
const fixtureTitle = 'PersonalAgent synthetic desktop fixture', fixtureProcess = 'WindowsHost.DesktopFixture';
const expectedText = 'Synthetic joint native model readback ' + runId;
const lifetime = new Date(Date.now() + 1_800_000).toISOString();
const controller = new AbortController(), requests = [], approvals = [], progress = [], scopeChecks = [];
const requiredNames = ['computer.request_access', 'computer.desktop.list_windows', 'computer.desktop.activate',
  'computer.desktop.observe', 'computer.desktop.set_value', 'computer.desktop.screenshot'];
const allowedNames = new Set(requiredNames);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const sha256 = value => createHash('sha256').update(value).digest('hex');
let app, desktop, presence, lease, fixture, fixtureSpawnError, taskId, finalTask, imageUrl, token;
let stage = 'preflight', catalogFiltered = false, fixtureClosed = false, fixtureForcedCleanup = false;
let runs, evidence, originalAttempts, artifact, leaseAfterTask, runtimeClosed = false;
const report = {recordedAt: new Date().toISOString(), profile: 'huawei_ict_agentarts', status: 'not_run',
  image: process.env.PA_JOINT_IMAGE_REFERENCE, sourceOverlay: false, imageExecution: 'local_linux_arm64_released_image',
  modelRoute: process.env.PA_JOINT_MODEL_ROUTE, modelDeployment: process.env.PA_JOINT_MODEL_DEPLOYMENT,
  newImagePlatformDeployment: 'not_run', remoteInferenceEvidence: 'separate_actual_model_proxy_receipt_required',
  realRuntimePolicyGateway: false, nativeProvider: 'personal-agent-desktop/1', fixture: 'owned_synthetic_WPF',
  hostFullAccessDecision: {value: true, source: 'explicit_synthetic_acceptance_host_decision', grantsToolAuthorization: false},
  presence: 'production_createToolPresenceHost_full_access_original_task_conversation_binding',
  capabilityContext: 'production_Runtime_environment_opt_in_as_used_by_Desktop_Main_with_synthetic_environment_only',
  decisions: 'synthetic_allow_once_through_original_Runtime_exact_approvals',
  screenshotsSentToModel: false, modelVision: 'unavailable_in_current_text_port',
  testPrivacyFilter: {method: 'computer.desktop.list_windows', kind: 'test_only_output_filter',
    retains: 'exact fixture processName/title', preserves: ['original windowRef', 'original OS facts', 'original native methods']},
  syntheticScopeGuard: 'Only the six requested tools; proposal arguments and projected results must remain on the selected fixture.',
  limitations: ['An existing AgentArts test ModelPort route is recorded explicitly; local released-image execution is not a new platform deployment.',
    'Only synthetic fixture text/controls and screenshot metadata may leave this process. No screenshot pixels are sent to the text model.',
    'Generic original Runtime execution Evidence remains conditional; UIA verified value is checked independently against the fixture state file.',
    'The native list output privacy filter does not replace unmodified protocol/native-device acceptance.']};

function requiredEnvironment(name) {
  const value = process.env[name];
  assert.equal(typeof value, 'string', 'Required joint-acceptance environment is missing');
  assert(value.length > 0 && value.length <= 2048 && !/[\r\n]/.test(value), 'Joint-acceptance metadata is invalid');
  return value;
}
async function fixtureState() {return JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));}
async function waitForFixture(predicate, timeout = 8000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (fixtureSpawnError) throw new Error('Synthetic fixture launch failed');
    try {const state = await fixtureState(); if (state.pid === fixture.pid && predicate(state)) return state;} catch {}
    await sleep(50);
  }
  throw new Error('Synthetic fixture did not reach the expected state');
}
async function fixtureCommand(action) {
  const id = randomUUID(), temporary = path.join(directory, 'command.tmp');
  await writeFile(temporary, JSON.stringify({id, action})); await rename(temporary, path.join(directory, 'command.json'));
  return waitForFixture(state => state.commandId === id);
}
function ownSnapshot(snapshot) {
  assert(snapshot && snapshot.window, 'The native result must contain an actual window snapshot');
  assert.equal(snapshot.window.title, fixtureTitle); assert.equal(snapshot.window.processName, fixtureProcess);
  assert.equal(snapshot.truncated, false);
  return snapshot;
}
const editor = snapshot => snapshot.controls.find(control => control.name === 'Synthetic editor' && control.patterns.includes('value'));
function safeResult(name, result) {
  assert(result && typeof result === 'object');
  if (name === 'computer.request_access') {
    assert.equal(result.state, 'policy_allowed'); assert.equal(result.authorizationGranted, false); return;
  }
  if (name === 'computer.desktop.list_windows') {
    assert.equal(result.windows.length, 1);
    assert.equal(result.windows[0].title, fixtureTitle); assert.equal(result.windows[0].processName, fixtureProcess); return;
  }
  if (name === 'computer.desktop.screenshot') {
    assert.equal(result.state, 'screenshot'); assert.equal(result.artifact.modelVisionAvailable, false);
    assert.deepEqual(Object.keys(result.artifact).sort(), ['artifactId', 'height', 'mimeType', 'modelVisionAvailable', 'sha256', 'width']);
    return;
  }
  ownSnapshot(result.snapshot);
}
function originalState(id) {
  const confirmed = app.runtime.readToolExecutions(id).filter(run => run.state === 'confirmed');
  const windows = new Set(); let snapshot;
  for (const run of confirmed) {
    const result = app.runtime.loadCheckpoint(id, 'tool-result-' + run.evidenceId)?.result;
    safeResult(run.toolName, result);
    if (result.windows) for (const window of result.windows) windows.add(window.windowRef);
    if (result.snapshot) {snapshot = ownSnapshot(result.snapshot); windows.add(snapshot.windowRef);}
  }
  return {confirmed, windows, snapshot};
}
function assertSyntheticProposal(input) {
  const {toolName, arguments: arguments_} = input.proposal;
  assert(allowedNames.has(toolName), 'Only the explicitly selected synthetic capability set is admitted');
  assert.equal(input.taskId, taskId, 'The model proposal must belong to the original accepted task');
  const state = originalState(input.taskId);
  if (toolName === 'computer.desktop.activate' || toolName === 'computer.desktop.observe') {
    // A default observe could read another foreground application. Require the actual listed fixture ref.
    assert.equal(typeof arguments_.windowRef, 'string'); assert(state.windows.has(arguments_.windowRef));
  }
  if (toolName === 'computer.desktop.set_value' || toolName === 'computer.desktop.screenshot') {
    assert(state.snapshot); assert.equal(arguments_.targetRef, state.snapshot.targetRef);
  }
  if (toolName === 'computer.desktop.set_value') {
    assert.equal(arguments_.text, expectedText); assert.equal(arguments_.controlRef, editor(state.snapshot)?.ref);
  }
  scopeChecks.push({phase: input.phase, taskId: input.taskId, toolName, allowed: true});
}

try {
  assert.equal(process.platform, 'win32', 'Live native joint acceptance requires Windows');
  imageUrl = new URL(requiredEnvironment('PA_JOINT_IMAGE_URL'));
  assert.equal(imageUrl.protocol, 'http:'); assert.equal(imageUrl.hostname, '127.0.0.1');
  assert.equal(imageUrl.username, ''); assert.equal(imageUrl.password, ''); assert.equal(imageUrl.search, ''); assert.equal(imageUrl.hash, '');
  token = requiredEnvironment('PA_JOINT_IMAGE_TOKEN'); assert(token.length >= 32);
  for (const name of ['PA_JOINT_IMAGE_REFERENCE', 'PA_JOINT_MODEL_ROUTE', 'PA_JOINT_MODEL_DEPLOYMENT']) requiredEnvironment(name);
  await Promise.all([access(executable), access(fixtureExecutable)]);
  await mkdir(directory, {recursive: true});
  fixture = spawn(fixtureExecutable, ['--directory', directory], {windowsHide: false, stdio: 'ignore'});
  fixture.once('error', error => {fixtureSpawnError = error;});
  await waitForFixture(state => state.hwnd !== '0' && state.rendered); await sleep(100);

  const readPolicyBinding = () => 'synthetic-full-access-policy-v1';
  const readTaskBinding = current => app?.runtime.getTask(current).conversationId;
  presence = createToolPresenceHost({registerNativeShortcut: () => {throw Error('Synthetic full-access must not request a native gesture');},
    isTaskCurrent: current => !!app && ['pending', 'running', 'waiting_approval'].includes(app.runtime.getTask(current).state)
      && !controller.signal.aborted,
    readTaskBinding, isFullAccess: () => true, readPolicyBinding, onPrompt: () => {}});
  desktop = createDesktopWindowsControlHost({isFullAccess: () => true, allowObservationExport: true,
    presenceHost: presence, readPolicyBinding, readTaskBinding,
    createControlHost(options) {
      const native = createWindowsNativeDesktopControlHost({...options, executable, artifactDirectory});
      const tools = native.tools.map(tool => tool.descriptor.name !== 'computer.desktop.list_windows' ? tool : {
        ...tool, async execute(input, context) {
          const result = await tool.execute(input, context); catalogFiltered = true;
          return {...result, windows: result.windows.filter(window => window.title === fixtureTitle && window.processName === fixtureProcess)};
        },
      });
      return {...native, tools};
    }});
  lease = createComputerControlLease({getRuntime: () => app?.runtime});
  const selectedTools = desktop.tools.filter(tool => allowedNames.has(tool.descriptor.name));
  assert.equal(selectedTools.length, requiredNames.length);
  app = createAgentArtsRuntimeApplication({path: database,
    gatewayUrl: 'https://local-joint-native-image.invalid', runtimeName: 'released-joint-native-image',
    responseMode: 'tool-proposal-json', initialRequestMode: 'goal-with-tools-json', continuationContext: 'goal', competitionMaxSteps: 32,
    tools: lease.wrapTools(selectedTools),
    // Desktop Main opts into fresh host environment context on each model send.
    // Use the same Runtime path; tool success semantics come from production,
    // never from a test-specific hint added to the original goal.
    coordinationInput: {beforeCoordinationSend() {}, readRequestContext: () => JSON.stringify({syntheticAcceptanceEnvironment: true})},
    competitionToolAvailability: desktop.competitionToolAvailability.filter(item => allowedNames.has(item.toolName)),
    competitionToolExports: desktop.competitionToolExports.filter(item => allowedNames.has(item.toolName)),
    isUserPresent: id => desktop.hasPresence(id),
    prepareCompetitionToolExport: async input => {
      if (input.phase === 'preflight') {
        assertSyntheticProposal(input);
        if (input.proposal.toolName !== 'computer.request_access') await desktop.prepareToolPresence(input);
      }
      else {
        assert.equal(input.taskId, taskId);
        const result = app.runtime.loadCheckpoint(input.taskId, 'tool-result-' + input.runId)?.result;
        safeResult(input.proposal.toolName, result);
        scopeChecks.push({phase: input.phase, taskId: input.taskId, toolName: input.proposal.toolName, allowed: true});
      }
    },
    authorizationProvider: {read: async () => 'Bearer ' + token}, fetchHandlesHostAuthorization: true,
    readOwnedWorkflowReceiptSecret: async () => deriveOwnedWorkflowKeys({transportToken: token}).receiptSecret,
    fetchImpl: async (input, init) => {
      const source = new URL(String(input)); assert.equal(source.hostname, 'local-joint-native-image.invalid');
      assert.match(source.pathname, /\/invocations$/);
      const body = typeof init.body === 'string' ? init.body : String(init.body ?? '');
      assert(!body.includes(token), 'Transport credentials must not enter model request bodies');
      assert(!/data:image\/|iVBORw0KGgo/.test(body), 'Only screenshot metadata may enter the text ModelPort');
      assert(body.includes('Do not request access again solely because authorizationGranted is false'),
        'The original production Runtime computer success semantics must reach every model request');
      const headers = new Headers(init.headers); headers.set('x-pa-agent-token', 'Bearer ' + token);
      const started = Date.now(), requestId = headers.get('x-request-id');
      // Forward the original request and actual released-image response, including its receipt, unchanged.
      const response = await fetch(new URL('/invocations', imageUrl), {...init, headers, redirect: 'error'});
      requests.push({requestId, status: response.status, wallMs: Date.now() - started});
      console.log(JSON.stringify({stage: 'released-native-image-response', requestId, status: response.status}));
      return response;
    }});
  assert(app.runtime instanceof TaskRuntime); assert(app.runtime.policy instanceof AuthorizationPolicy);
  desktop.bind(app); report.realRuntimePolicyGateway = true;
  const started = await desktop.start({signal: controller.signal, deadline: lifetime});
  assert.equal(started.available, true); assert.equal(desktop.snapshot().provider.source, 'windows-native');
  report.realNativeStarted = true;
  const client = new Client(app); await client.connect(); report.status = 'running'; stage = 'actual-model-task';
  const submitted = await client.call('task.submit', {
    goal: '请实际调用电脑工具完成这个合成 Windows WPF 任务，只操作标题为“' + fixtureTitle + '”、进程名为“' + fixtureProcess + '”的自有窗口。'
      + '必须依次实际使用以下六个工具：computer.request_access、computer.desktop.list_windows、computer.desktop.activate、'
      + 'computer.desktop.observe、computer.desktop.set_value、computer.desktop.screenshot。'
      + '先请求访问，再从真实目录取得该唯一合成窗口的 windowRef，用它激活；随后必须显式 observe，传同一个真实 windowRef，不能省略 windowRef。'
      + '本次验收需要激活后的独立 observe 工具执行回执；activate 附带的 snapshot 不算这一回执。即使 activate 已返回控件，也必须先单独调用 observe，再做 set_value。'
      + '在最近观察里寻找 name 为 Synthetic editor 且 patterns 含 value 的普通编辑控件，只用该观察的 controlRef 和 targetRef，'
      + '调用 set_value 将完整文本替换为“' + expectedText + '”。读取工具真实返回的 verification.actual 和新 snapshot 中该编辑控件 value，确认二者完全相同。'
      + '然后用 set_value 返回的新 targetRef 请求 screenshot，将图像仅保存本机；返回只包含产物元数据，你没有图像视觉输入。'
      + '这些引用与访问租约最长30秒；若尚未写入且过期，重新请求访问并获取新的 list/activate/observe 引用，不猜引用，不自动重放未知写入。'
      + '不要调用其他能力，不要操作其他窗口、用户账号或真实数据。所有操作都必须经原 Runtime 授权。'
      + '最后只根据真实工具读回报告已写入的完整文本和本机截图产物ID，不描述未执行的动作。',
    conversationId: 'native-new-image-joint-synthetic'}, {idempotencyKey: 'native-joint-' + runId, timeoutMs: 1_800_000});
  taskId = submitted.taskId; report.taskId = taskId;
  const handled = new Set(); let lastState;
  while (Date.now() < Date.parse(lifetime)) {
    const task = app.runtime.getTask(taskId);
    if (task.state !== lastState) {
      lastState = task.state; progress.push({state: task.state, at: new Date().toISOString()});
      console.log(JSON.stringify({stage: 'original-native-runtime', taskId, state: task.state}));
    }
    if (['succeeded', 'failed', 'cancelled', 'waiting_reconciliation'].includes(task.state)) {finalTask = task; break;}
    for (const approval of (await client.call('approval.list', {taskId})).items) {
      if (approval.state !== 'pending' || handled.has(approval.approvalId)) continue;
      assert.equal(approval.taskId, taskId); assert(allowedNames.has(approval.action));
      const original = app.runtime.loadCheckpoint(taskId, 'application-tool-invocation:' + approval.approvalId);
      assert(original); assert.equal(original.toolName, approval.action);
      assertSyntheticProposal({phase: 'preflight', taskId, proposal: {toolName: approval.action, arguments: original.arguments}});
      const stored = app.runtime.getApproval(approval.approvalId);
      assert.equal(stored.argumentsDigest, toolArgumentsDigest(original.arguments));
      handled.add(approval.approvalId);
      approvals.push({approvalId: approval.approvalId, toolName: approval.action, revision: approval.revision, argumentsDigest: stored.argumentsDigest});
      await client.call('authorization.respond', {approvalId: approval.approvalId, expectedRevision: approval.revision, decision: 'allow_once'});
    }
    await sleep(100);
  }
  assert(finalTask, 'The original task must settle under its actual deadline');
  report.taskState = finalTask.state; report.taskErrorCode = finalTask.error?.code;
  assert.equal(finalTask.state, 'succeeded'); stage = 'independent-native-readback';
  const independent = await waitForFixture(state => state.text === expectedText);
  assert.equal(independent.text, expectedText); assert.equal(independent.pid, fixture.pid);
  assert(finalTask.resultSummary.includes(expectedText), 'Actual model final output must report the independently read-back text');
  report.independentReadback = independent.text;
  runs = app.runtime.readToolExecutions(taskId); evidence = app.runtime.readEvidence(taskId);
  const names = runs.filter(run => run.state === 'confirmed').map(run => run.toolName);
  stage = 'required-public-tool-receipts';
  report.missingRequiredTools = requiredNames.filter(name => !names.includes(name));
  for (const name of requiredNames) assert(names.includes(name), 'Missing original confirmed required native tool');
  assert(runs.every(run => run.policyDecision === 'allow' && run.state === 'confirmed' && run.executionStarted));
  assert(approvals.length >= requiredNames.length);
  for (const name of requiredNames) assert(approvals.some(approval => approval.toolName === name));
  assert.equal(catalogFiltered, true); assert.equal(evidence.length, runs.length);
  assert(evidence.every(item => item.kind === 'execution' && item.verification === 'conditional'));
  const valueRun = runs.findLast(run => run.toolName === 'computer.desktop.set_value');
  const valueResult = app.runtime.loadCheckpoint(taskId, 'tool-result-' + valueRun.evidenceId).result;
  assert.equal(valueResult.verification.state, 'verified'); assert.equal(valueResult.verification.kind, 'value');
  assert.equal(valueResult.verification.actual, expectedText); assert.equal(editor(ownSnapshot(valueResult.snapshot)).value, expectedText);
  originalAttempts = app.runtime.listCheckpointKeys(taskId).filter(key => key.startsWith('windows-desktop-attempt:'))
    .map(key => ({key, value: app.runtime.loadCheckpoint(taskId, key)}));
  for (const run of runs.filter(run => ['computer.desktop.activate', 'computer.desktop.set_value'].includes(run.toolName))) {
    const saved = originalAttempts.find(item => item.value.runId === run.evidenceId)?.value; assert(saved);
    const approval = approvals.find(item => item.approvalId === saved.authorizationRef); assert(approval);
    const original = app.runtime.loadCheckpoint(taskId, 'application-tool-invocation:' + saved.authorizationRef);
    assert.equal(saved.argumentsDigest, approval.argumentsDigest); assert.equal(saved.toolName, run.toolName);
    assert(app.runtime.matchesToolExecutionInput(run, {arguments: original.arguments, scopeRef: saved.authorizationRef}));
  }
  const screenshotRun = runs.findLast(run => run.toolName === 'computer.desktop.screenshot');
  artifact = app.runtime.loadCheckpoint(taskId, 'tool-result-' + screenshotRun.evidenceId).result.artifact;
  assert.match(artifact.artifactId, /^[a-f0-9-]{36}$/); assert.equal(artifact.modelVisionAvailable, false);
  const png = await readFile(path.join(artifactDirectory, artifact.artifactId + '.png'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.equal(sha256(png), artifact.sha256);
  leaseAfterTask = lease.snapshot(); assert.equal(leaseAfterTask.state, 'idle'); assert.equal(leaseAfterTask.writeBlocked, false);
  assert(requests.length > 0); report.status = 'passed';
  report.independentReadback = independent.text; report.nativeUIAReadback = valueResult.verification;
  report.artifact = artifact;
  report.checks = {actualReleasedImageRepliesUnmodified: true, modelSelectedAllSixActualNativeTools: true,
    exactOriginalRuntimeApprovals: true, syntheticWindowOnly: true, independentFixtureStateReadback: true,
    nativeUIAExactReadback: true, localPNGValidated: true, screenshotMetadataOnlyToModel: true,
    originalRunsAndAttemptsRetained: true, conditionalEvidence: true, sharedLeaseReleased: true};
} catch (error) {
  report.status = 'failed'; report.failure = {stage, code: typeof error?.code === 'string' ? error.code : error?.name ?? 'ACCEPTANCE_FAILURE'};
  console.error(JSON.stringify({stage: 'native-joint-acceptance', status: 'failed', ...report.failure})); process.exitCode = 1;
} finally {
  if (app && taskId) {
    if (!['succeeded', 'failed', 'cancelled', 'waiting_reconciliation'].includes(app.runtime.getTask(taskId).state)) {
      await app.send({kind: 'request', protocolVersion: '1.0.0', requestId: randomUUID(), operation: 'task.cancel',
        deadline: new Date(Date.now() + 5000).toISOString(), payload: {taskId, reason: 'Synthetic native joint acceptance cleanup'}},
      new AbortController().signal).catch(() => {});
    }
    runs ??= app.runtime.readToolExecutions(taskId); evidence ??= app.runtime.readEvidence(taskId);
  }
  if (fixture && !fixtureSpawnError) {
    try {
      const observed = await fixtureState();
      report.fixtureReadbackBeforeCleanup = {sameProcess: observed.pid === fixture.pid,
        textMatchesExpected: observed.text === expectedText, textSha256: sha256(String(observed.text ?? ''))};
    } catch { report.fixtureReadbackBeforeCleanup = {state: 'unavailable'}; }
  }
  if (desktop) {
    try {report.nativeStopState = (await desktop.stop()).state;}
    catch {report.cleanupError = 'NATIVE_STOP_UNCONFIRMED'; report.status = 'failed'; process.exitCode = 1;}
    try {await desktop.close(); report.nativeClosed = true;}
    catch {report.nativeClosed = false; report.cleanupError = 'NATIVE_RELEASE_UNCONFIRMED'; report.status = 'failed'; process.exitCode = 1;}
  }
  if (fixture && !fixtureSpawnError) {
    try {await fixtureCommand('close');} catch {}
    for (let tries = 0; tries < 25 && fixture.exitCode === null; tries++) await sleep(40);
    if (fixture.exitCode === null) {fixtureForcedCleanup = true; fixture.kill();}
    fixtureClosed = fixture.exitCode !== null || fixture.killed;
  }
  controller.abort(); presence?.close(); lease?.close();
  if (app) {
    for (let tries = 0; app.activeTaskCount && tries < 100; tries++) await sleep(50);
    try {app.close(); runtimeClosed = true;} catch {report.cleanupError = 'RUNTIME_RELEASE_UNCONFIRMED'; report.status = 'failed'; process.exitCode = 1;}
  }
  if (report.status === 'passed' && runtimeClosed) {
    const reopened = new TaskRuntime(database);
    try {
      assert.equal(reopened.getTask(taskId).state, 'succeeded');
      assert.deepEqual(reopened.readToolExecutions(taskId), runs); assert.deepEqual(reopened.readEvidence(taskId), evidence);
      for (const attempt of originalAttempts) assert.deepEqual(reopened.loadCheckpoint(taskId, attempt.key), attempt.value);
      report.checks.originalSQLiteDurableReadback = true;
    } catch {report.status = 'failed'; report.failure = {stage: 'durable-readback', code: 'READBACK_MISMATCH'}; process.exitCode = 1;}
    finally {reopened.close();}
  }
  report.requests = requests; report.approvals = approvals; report.progress = progress; report.scopeChecks = scopeChecks;
  report.runs = runs; report.evidence = evidence; report.originalNativeAttempts = originalAttempts;
  report.sharedLeaseAfterTask = leaseAfterTask; report.fixtureClosed = fixtureClosed; report.fixtureForcedCleanup = fixtureForcedCleanup;
  report.runtimeClosed = runtimeClosed; report.finishedAt = new Date().toISOString();
  await mkdir(directory, {recursive: true}); const receiptPath = path.join(directory, 'receipt.json');
  await writeFile(receiptPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({stage: 'native-joint-acceptance', status: report.status, receiptPath, taskId,
    taskState: report.taskState, requests: requests.length, approvals: approvals.length,
    nativeClosed: report.nativeClosed, fixtureClosed, runtimeClosed}));
}
