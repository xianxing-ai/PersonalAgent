// Manual real Runtime + Edge acceptance. Run only during an exclusive device-input slot.
// Uses a new isolated profile, synthetic localhost page and explicit real-driver/allowed-origin test seams.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as playwright from 'playwright';
import {AuthorizationPolicy} from '@personal-agent/policy';
import {TaskRuntime} from '@personal-agent/runtime';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {assertPublicBrowserUrl, createBrowserControlHost} from '../electron/browser-control-host.js';
import {createComputerControlLease} from '../electron/computer-control-lease.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const directory = path.join(root, '.cache', 'browser-control-runtime', randomUUID());
const database = path.join(directory, 'runtime.sqlite');
const deadline = new Date(Date.now() + 90_000).toISOString();
const expectedText = 'Synthetic browser Runtime note ' + randomUUID();
const checks = [], approvals = [], permissions = [], invocations = [];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const admissionReached = deferred(), releaseAdmission = deferred();
let server, application, host, lease, actualContext, origin, taskId, actualPage, screenshot, launchOptions;
let stage = 'preflight', failure, finalTask, records, evidence, savedAttempts, contextClosed = false;
let pauseType = false, admissionPaused = false, launchedProfile, browserClosedByTool = false, leaseAfterClose;
const mark = name => checks.push({name, status: 'passed'});

try {
  assert.equal(process.platform, 'win32', 'This acceptance requires real Windows Edge');
  assert(['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].some(existsSync),
    'An installed Edge is required; this test never downloads a browser');
  await mkdir(directory, {recursive: true});
  server = createServer((request, response) => {
    if (request.url !== '/') {response.writeHead(204); response.end(); return;}
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
    response.end('<!doctype html><html><head><meta charset="utf-8"><title>Synthetic Runtime browser fixture</title></head><body>'
      + '<h1>Synthetic Runtime fixture</h1><label>Synthetic note <input id="note" aria-label="Synthetic note" type="text"></label>'
      + '<button id="save">Save synthetic note</button><p id="result" data-saves="0">No synthetic save</p>'
      + '<script>document.querySelector("#save").onclick=()=>{const output=document.querySelector("#result");'
      + 'output.dataset.saves=String(Number(output.dataset.saves)+1);output.textContent="Saved synthetic: "+document.querySelector("#note").value}</script>'
      + '</body></html>');
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  origin = 'http://127.0.0.1:' + server.address().port;

  stage = 'explicit-test-origin-and-real-driver';
  await assert.rejects(assertPublicBrowserUrl(origin), {code: 'UNAUTHORIZED'});
  assert.throws(() => createBrowserControlHost({userDataPath: directory, authorizePresence: async () => true,
    testOnlyAllowedOrigins: [origin]}), {code: 'INVALID_ARGUMENT'});
  assert.equal((await assertPublicBrowserUrl(origin, {testOnlyAllowedOrigins: [origin]})).origin, origin);
  await assert.rejects(assertPublicBrowserUrl('http://127.0.0.1:1/', {testOnlyAllowedOrigins: [origin]}), {code: 'UNAUTHORIZED'});
  const realDriver = {chromium: {async launchPersistentContext(profile, options) {
    launchedProfile = profile; launchOptions = options;
    assert.equal(path.relative(directory, profile).startsWith('..'), false);
    assert.equal(options.headless, false); assert.equal(options.acceptDownloads, false);
    // Explicit injection forces installed Edge even if bundled Chromium happens to exist.
    actualContext = await playwright.chromium.launchPersistentContext(profile, {...options, channel: 'msedge'});
    actualContext.once('close', () => {contextClosed = true;});
    return actualContext;
  }}};
  host = createBrowserControlHost({userDataPath: directory, playwright: realDriver, testOnlyAllowedOrigins: [origin],
    isFullAccess: () => true,
    async authorizePresence(scope) {
      const runtime = application?.runtime;
      const run = runtime?.readToolExecutions(scope.taskId).find(record => record.evidenceId === scope.runId);
      const allowed = scope.taskId === taskId && runtime?.getTask(taskId).state === 'running'
        && runtime.loadCheckpoint(taskId, 'application-deadline') === scope.deadline
        && scope.deadline === deadline && !scope.signal.aborted && Date.now() < Date.parse(deadline)
        && (scope.origin === undefined || scope.origin === origin)
        && run?.policyDecision === 'allow' && run.executionStarted
        && (run.state === 'started' || scope.phase === 'export' && run.state === 'confirmed')
        && runtime.matchesToolExecutionInput(run, {arguments: scope.arguments, scopeRef: scope.authorizationRef});
      permissions.push({toolName: scope.toolName, phase: scope.phase, allowed, originMatches: scope.origin === undefined || scope.origin === origin});
      if (allowed && pauseType && !admissionPaused && scope.toolName === 'browser.type' && scope.phase === 'access') {
        admissionPaused = true;
        assert.equal(lease.snapshot().state, 'active');
        admissionReached.resolve();
        await releaseAdmission.promise;
      }
      return allowed;
    },
  });
  lease = createComputerControlLease({getRuntime: () => application?.runtime});
  // Production composition creates actual SQLite Policy and Gateway; no fake Runtime/Gateway/attempt store.
  application = createRuntimeApplication({path: database, profile: 'huawei_ict_agentarts',
    hostUserNamespace: 'synthetic-browser-runtime-acceptance', tools: lease.wrapTools(host.tools)});
  host.bind(application);
  const runtime = application.runtime;
  assert(runtime instanceof TaskRuntime); assert(runtime.policy instanceof AuthorizationPolicy);
  const task = runtime.submitTask({goal: 'Synthetic Edge exact authorization and shared input lease acceptance',
    conversationId: 'synthetic-browser-runtime', idempotencyKey: 'synthetic-' + randomUUID()});
  taskId = task.taskId;
  runtime.saveCheckpoint(taskId, 'application-deadline', deadline);
  const descriptors = new Map(runtime.readToolDescriptors().map(descriptor => [descriptor.name, descriptor]));
  mark('localhost-is-denied-without-explicit-driver-and-exact-test-origin');

  async function wire(operation, payload, signal, extra = {}) {
    return runtime.send({kind: 'request', protocolVersion: '1.0.0', requestId: randomUUID(), taskId, deadline,
      operation, payload, ...extra}, signal);
  }
  async function approve(name, arguments_, signal) {
    const toolName = 'browser.' + name, descriptor = descriptors.get(toolName), approvalId = randomUUID();
    const digest = toolArgumentsDigest(arguments_);
    const pending = runtime.requestToolApproval(approvalId, taskId, descriptor, deadline, digest);
    assert.equal(runtime.getTask(taskId).state, 'waiting_approval'); assert.equal(runtime.policy.get(approvalId), undefined);
    const response = await wire('authorization.respond', {approvalId, expectedRevision: pending.revision, decision: 'allow_once'}, signal);
    assert.equal(response.outcome, 'ok');
    const grant = runtime.policy.get(approvalId);
    assert.equal(grant.taskId, taskId); assert.equal(grant.toolName, toolName);
    assert.equal(grant.argumentsDigest, digest); assert.equal(grant.usesRemaining, 1);
    assert.deepEqual(grant.scopes, ['browser:control']);
    runtime.transitionTask(taskId, 'running');
    approvals.push({approvalId, toolName, argumentsDigest: digest});
    return approvalId;
  }
  async function invoke(name, arguments_, authorizationRef, signal, runId = randomUUID()) {
    const toolName = 'browser.' + name;
    const response = await wire('tool.invoke', {toolName, toolVersion: descriptors.get(toolName).version,
      arguments: arguments_, scopeRef: authorizationRef}, signal, {idempotencyKey: runId});
    const record = runtime.readToolExecutions(taskId).find(value => value.evidenceId === runId);
    assert(record); assert.equal(record.toolName, toolName);
    assert(runtime.matchesToolExecutionInput(record, {arguments: arguments_, scopeRef: authorizationRef}));
    invocations.push({runId, toolName, authorizationRef, outcome: response.outcome});
    return {response, record, runId, authorizationRef, result: response.data?.result};
  }
  function isConfirmed(result) {
    assert.equal(result.response.outcome, 'ok', 'Real Runtime invocation must succeed');
    assert.equal(result.response.data.state, 'confirmed'); assert.equal(result.record.state, 'confirmed');
    assert.equal(result.record.policyDecision, 'allow'); assert.equal(result.record.executionStarted, true);
    assert.equal(runtime.policy.get(result.authorizationRef).usesRemaining, 0);
    assert.deepEqual(runtime.loadCheckpoint(taskId, 'tool-result-' + result.runId).result, result.result);
    assert.equal(lease.snapshot().state, 'idle'); assert.equal(lease.snapshot().writeBlocked, false);
    return result;
  }
  async function confirmed(name, arguments_, signal) {
    return isConfirmed(await invoke(name, arguments_, await approve(name, arguments_, signal), signal));
  }
  function assertAttempt(result, arguments_) {
    const saved = runtime.loadCheckpoint(taskId, 'browser-control-attempt:' + result.runId);
    assert.deepEqual(saved, {taskId, runId: result.runId, toolName: result.record.toolName, toolVersion: '1.0.0',
      authorizationRef: result.authorizationRef, argumentsDigest: toolArgumentsDigest(arguments_),
      ...(arguments_.targetRef ? {targetRef: arguments_.targetRef} : {})});
  }
  const attemptKeys = () => runtime.listCheckpointKeys(taskId).filter(key => key.startsWith('browser-control-attempt:'));
  async function domReadback() {
    return actualPage.evaluate(() => ({text: document.querySelector('#note').value,
      saved: document.querySelector('#result').textContent, saves: Number(document.querySelector('#result').dataset.saves)}));
  }

  finalTask = await runtime.runTask(taskId, async context => {
    context.declareRuntimeToolTracking();
    stage = 'unapproved-open';
    const unapproved = await invoke('open', {url: origin}, 'synthetic-missing-grant', context.signal);
    assert.equal(unapproved.response.outcome, 'error'); assert.equal(unapproved.record.executionStarted, false);
    assert.equal(unapproved.record.policyDecision, 'deny'); assert.equal(actualContext, undefined);
    mark('real-gateway-rejects-unapproved-open-before-browser-launch');

    stage = 'open-observe';
    const openArguments = {url: origin};
    const opened = await confirmed('open', openArguments, context.signal); assertAttempt(opened, openArguments);
    assert.equal(opened.result.url, origin + '/'); assert.equal(opened.result.goalVerified, false);
    actualPage = actualContext.pages().find(page => page.url().startsWith(origin + '/')); assert(actualPage);
    assert.equal((await domReadback()).saves, 0);
    const observed = await confirmed('observe', {}, context.signal);
    const note = observed.result.controls.find(control => control.name === 'Synthetic note'); assert(note);
    mark('real-Edge-own-profile-open-observe-with-original-runtime-attempt');

    stage = 'exact-arguments';
    const typeArguments = {targetRef: observed.result.targetRef, ref: note.ref, text: expectedText};
    const typeGrant = await approve('type', typeArguments, context.signal);
    const replaced = await invoke('type', {...typeArguments, text: 'Synthetic unauthorized substitution'}, typeGrant, context.signal);
    assert.equal(replaced.response.outcome, 'error'); assert.equal(replaced.response.error.code, 'SCOPE_DENIED');
    assert.equal(replaced.record.executionStarted, false); assert.equal(runtime.policy.get(typeGrant).usesRemaining, 1);
    assert.equal((await domReadback()).text, ''); assert.equal(attemptKeys().length, 1);
    mark('real-policy-argument-substitution-refused-without-consuming-original-grant');

    stage = 'shared-lease';
    pauseType = true;
    const typing = invoke('type', typeArguments, typeGrant, context.signal);
    try {
      await Promise.race([admissionReached.promise, typing.then(() => {throw new Error('Expected admission barrier was not reached');})]);
      assert.equal(lease.snapshot().state, 'active'); assert.equal(host.snapshot().busy, true);
      const concurrent = await invoke('observe', {}, await approve('observe', {}, context.signal), context.signal);
      assert.equal(concurrent.response.outcome, 'error'); assert.equal(concurrent.response.error.code, 'REVISION_CONFLICT');
      assert.equal(concurrent.record.state, 'failed'); assert.equal(concurrent.record.policyDecision, 'allow');
      // Gateway authorized this read, but the shared lease refused before the browser provider observed anything.
      assert.equal(concurrent.record.executionStarted, true); assert.equal(attemptKeys().length, 1);
      assert.equal((await domReadback()).text, ''); assert.equal(lease.snapshot().state, 'active');
      const concurrentSave = observed.result.controls.find(control => control.name === 'Save synthetic note'); assert(concurrentSave);
      const competingArguments = {targetRef: observed.result.targetRef, ref: concurrentSave.ref};
      const competingWrite = await invoke('click', competingArguments, await approve('click', competingArguments, context.signal), context.signal);
      assert.equal(competingWrite.response.outcome, 'error'); assert.equal(competingWrite.response.error.code, 'REVISION_CONFLICT');
      assert.equal(competingWrite.record.state, 'failed'); assert.equal(competingWrite.record.executionStarted, false);
      assert.equal(competingWrite.record.policyDecision, 'deny'); assert.equal(runtime.getTask(taskId).state, 'running');
      assert.equal(runtime.loadCheckpoint(taskId, 'browser-control-attempt:' + competingWrite.runId), undefined);
      assert.equal((await domReadback()).saves, 0); assert.equal(lease.snapshot().state, 'active');
    } finally {releaseAdmission.resolve();}
    const typed = isConfirmed(await typing); assertAttempt(typed, typeArguments);
    assert.equal((await domReadback()).text, expectedText); assert.equal(typed.result.goalVerified, false);
    mark('shared-real-input-lease-excludes-concurrent-read-and-write-without-unknown-and-releases-after-runtime-commit');

    stage = 'original-run-cache';
    const beforeReplay = runtime.readToolExecutions(taskId).length;
    const replay = await invoke('type', typeArguments, typeGrant, context.signal, typed.runId);
    assert.equal(replay.response.outcome, 'ok'); assert.deepEqual(replay.result, typed.result);
    assert.equal(runtime.readToolExecutions(taskId).length, beforeReplay); assert.equal(attemptKeys().length, 2);
    assert.equal((await domReadback()).text, expectedText);
    mark('confirmed-original-run-replay-uses-runtime-cache-without-second-browser-attempt');

    stage = 'click-readback';
    const save = typed.result.controls.find(control => control.name === 'Save synthetic note'); assert(save);
    const clickArguments = {targetRef: typed.result.targetRef, ref: save.ref};
    const clicked = await confirmed('click', clickArguments, context.signal); assertAttempt(clicked, clickArguments);
    const dom = await domReadback(); assert.equal(dom.saves, 1); assert.equal(dom.saved, 'Saved synthetic: ' + expectedText);
    assert(clicked.result.text.includes('Saved synthetic: ' + expectedText)); assert.equal(clicked.result.goalVerified, false);
    mark('authorized-real-click-and-independent-synthetic-DOM-readback');

    stage = 'screenshot';
    const captured = await confirmed('screenshot', {targetRef: clicked.result.targetRef}, context.signal);
    screenshot = captured.result.artifact; assert.equal(screenshot.imageDeliveredToModel, false);
    assert.deepEqual(Object.keys(screenshot).sort(), ['artifactId', 'byteLength', 'imageDeliveredToModel', 'mimeType', 'sha256']);
    const image = await host.readScreenshotArtifact({artifactId: screenshot.artifactId, taskId, signal: context.signal, deadline});
    assert.equal(image.bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.equal(sha256(image.bytes), screenshot.sha256);
    assert.equal((await readFile(path.join(directory, 'controlled-browser-artifacts', screenshot.artifactId + '.png'))).length, screenshot.byteLength);
    mark('real-runtime-screenshot-keeps-bytes-local-with-authenticated-artifact-read');

    stage = 'authorized-close';
    const closed = await confirmed('close', {}, context.signal); assertAttempt(closed, {});
    assert.equal(closed.result.state, 'closed'); assert.equal(host.snapshot().connected, false);
    assert.equal(contextClosed, true); browserClosedByTool = true; leaseAfterClose = lease.snapshot();
    assert.equal(leaseAfterClose.state, 'idle'); assert.equal(attemptKeys().length, 4);
    mark('original-approved-close-releases-only-owned-Edge-and-shared-lease');

    stage = 'records-evidence';
    records = runtime.readToolExecutions(taskId); evidence = runtime.readEvidence(taskId);
    savedAttempts = attemptKeys().map(key => ({key, value: runtime.loadCheckpoint(taskId, key)}));
    assert(records.every(record => ['confirmed', 'failed'].includes(record.state)));
    assert.equal(evidence.length, records.length);
    for (const run of records) {
      const item = evidence.find(entry => entry.evidenceId === run.evidenceId);
      assert.equal(item.sourceRef, run.toolName); assert.equal(item.kind, 'execution'); assert.equal(item.verification, 'conditional');
    }
    mark('real-runtime-original-runs-attempts-and-conditional-evidence-retained');
    return {resultSummary: 'Synthetic Edge Runtime exact authorization, shared lease, DOM readback and close passed.',
      evidenceRefs: records.map(record => record.evidenceId)};
  }, {deadline, sideEffect: 'external_write'});
  if (finalTask.state !== 'succeeded') {
    failure = {stage, code: finalTask.error?.code ?? 'TASK_NOT_SUCCEEDED'};
    records = runtime.readToolExecutions(taskId); evidence = runtime.readEvidence(taskId);
  }
} catch (error) {
  failure ??= {stage, code: typeof error?.code === 'string' ? error.code : error?.name ?? 'EXTERNAL_FAILURE'};
} finally {
  releaseAdmission.resolve();
  if (host) {try {await host.close();} catch {failure ??= {stage: 'owned-browser-cleanup', code: 'EXTERNAL_FAILURE'};}}
  lease?.close();
  application?.close();
  if (server?.listening) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
}

if (!failure && taskId) {
  stage = 'durable-readback';
  const reopened = new TaskRuntime(database);
  try {
    assert.equal(reopened.getTask(taskId).state, 'succeeded');
    assert.deepEqual(reopened.readToolExecutions(taskId), records); assert.deepEqual(reopened.readEvidence(taskId), evidence);
    for (const saved of savedAttempts) assert.deepEqual(reopened.loadCheckpoint(taskId, saved.key), saved.value);
    mark('original-sqlite-task-policy-run-attempt-and-evidence-reopen-readback');
  } catch (error) {failure = {stage, code: error?.name ?? 'EXTERNAL_FAILURE'};} finally {reopened.close();}
}
await mkdir(directory, {recursive: true});
const receipt = {recordedAt: new Date().toISOString(), status: failure ? 'failed' : 'passed',
  scope: 'real-TaskRuntime-SQLite-AuthorizationPolicy-ToolGateway-shared-ComputerControlLease-real-Edge-synthetic-local-page',
  profile: 'huawei_ict_agentarts', taskId, taskState: finalTask?.state, checks, approvals, invocations,
  toolExecutionRecords: records, evidence, nativeBrowserAttempts: savedAttempts, permissionChecks: permissions,
  testOnlyAllowedOrigins: origin ? [origin] : [], explicitDriver: 'real Playwright chromium.launchPersistentContext channel=msedge',
  visibleBrowser: launchOptions?.headless === false, isolatedProfile: launchedProfile ? path.relative(directory, launchedProfile) : undefined,
  browserClosedByTool, ownedContextClosed: contextClosed, sharedLeaseAfterClose: leaseAfterClose,
  modelCalls: 0, cloudCalls: 0, accountCalls: 0, artifact: screenshot,
  limitations: ['Deterministic synthetic trusted approvals and authorization barrier test seam; no user account, model, AgentArts or Electron renderer acceptance.',
    'localhost admission requires both explicit exact testOnlyAllowedOrigins and injected real Edge driver; production public-network admission remains unchanged.',
    'Independent DOM readback is test-only on the owned page. Browser results never claim goalVerified; generic Runtime Evidence stays conditional.',
    'A concurrent read is Policy-authorized but rejected by the shared lease before provider dispatch; its Runtime executionStarted remains true under current generic read semantics.'],
  ...(failure ? {failure} : {})};
await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({status: receipt.status, directory, checks: checks.length, taskId, ...(failure ? {failure} : {})}));
if (failure) process.exitCode = 1;
