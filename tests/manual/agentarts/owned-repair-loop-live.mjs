// Explicit synthetic acceptance only. Importing this module does not open a store or call the cloud.
import assert from 'node:assert/strict';
import {STATUS_CODES} from 'node:http';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {currentNodes} from '@personal-agent/goals';
import {analyzeImpact} from '@personal-agent/cognition';
import {createAgentArtsRuntimeApplication, createRuntimeApplication} from '@personal-agent/runtime/application';
import {createSyntheticRepairHost} from '../../../apps/desktop/electron/competition-repair-host.js';
import {createSyntheticMeetingToolset} from '../../../apps/desktop/electron/competition-synthetic-workspace.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/mvp-meeting/', import.meta.url));
const defaultOutputRoot = fileURLToPath(new URL('../../../.cache/owned-repair-loop-live/', import.meta.url));
const fail = code => { throw new ProtocolError(code, 'Owned synthetic repair acceptance failed'); };
const safeCodes = new Set(['INVALID_ARGUMENT', 'UNAUTHORIZED', 'UNSUPPORTED_CAPABILITY', 'EXTERNAL_FAILURE',
  'TIMEOUT', 'CANCELLED', 'RESULT_UNKNOWN', 'REVISION_CONFLICT', 'RATE_LIMITED']);
const safeCode = error => safeCodes.has(error?.code) ? error.code : 'ACCEPTANCE_FAILED';
const diagnosticStages = new Set(['authorization', 'catalog_guard', 'export_guard', 'transport',
  'http_response', 'response_body', 'response_schema', 'application_schema']);
const diagnosticCodes = new Set(['INVALID_ARGUMENT', 'UNSUPPORTED_CAPABILITY', 'UNAUTHORIZED',
  'EXTERNAL_FAILURE', 'CANCELLED', 'TIMEOUT', 'RATE_LIMITED']);
const schemaCategories = new Set(['body_limit', 'body_shape', 'utf8', 'content_type', 'event_order',
  'event_shape', 'provider_failure', 'no_text', 'json_shape', 'application_json', 'application_contract', 'other']);
const httpStatuses = new Set(Object.keys(STATUS_CODES).map(Number));
const localUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only fixed diagnostic vocabulary and the adapter's local request UUID leave this boundary. */
export function sanitizeRepairDiagnostic(value) {
  const field = key => {
    try {const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && 'value' in descriptor ? descriptor.value : undefined;}
    catch {return undefined;}
  };
  const stage = field('stage'), code = field('code');
  if (!diagnosticStages.has(stage) || !diagnosticCodes.has(code)) return undefined;
  const result = {stage, code};
  const schemaCategory = field('schemaCategory'), httpStatus = field('httpStatus'), requestId = field('requestId');
  if (schemaCategories.has(schemaCategory)) result.schemaCategory = schemaCategory;
  if (typeof httpStatus === 'number' && httpStatuses.has(httpStatus)) result.httpStatus = httpStatus;
  if (typeof requestId === 'string' && localUuid.test(requestId)) result.requestId = requestId;
  return result;
}
const terminal = ['succeeded', 'failed', 'cancelled', 'waiting_reconciliation'];
const sourceGoal = '请使用已公布的 workspace.read_text 读取 meeting-update.json。读取确认后，依据返回的 repairContext，'
  + '给出三个受影响节点的 repair_candidate，严格采用宿主 requestedSummary 和 requestedDependencies；保留无关计划。不要声称已写入图谱。';

export function validateRepairConfiguration(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).length !== 4
    || !['gatewayUrl', 'runtimeName', 'inboundAuthorization', 'wssToken'].every(key => Object.hasOwn(config, key))) fail('INVALID_ARGUMENT');
  let url;
  try {url = new URL(config.gatewayUrl);} catch {fail('INVALID_ARGUMENT');}
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.huaweicloud-agentarts.com')
    || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash
    || typeof config.runtimeName !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(config.runtimeName)
    || typeof config.inboundAuthorization !== 'string' || !/^Bearer [\x21-\x7e]{1,4096}$/.test(config.inboundAuthorization)
    || typeof config.wssToken !== 'string' || !/^[\x21-\x7e]{32,4096}$/.test(config.wssToken)) fail('INVALID_ARGUMENT');
  return {...config, gatewayUrl: url.origin};
}

/** The offline mode requires an explicit Fake CoordinationPort; there is no implicit fallback. */
export async function runOwnedRepairLoop({mode, configuration, coordination, deadline, signal,
  approveSyntheticFixture, outputRoot = defaultOutputRoot} = {}) {
  if (!['live', 'fake'].includes(mode) || approveSyntheticFixture !== true
    || !(signal instanceof AbortSignal) || typeof deadline !== 'string' || !Number.isFinite(Date.parse(deadline))) fail('INVALID_ARGUMENT');
  deadline = new Date(deadline).toISOString();
  const config = mode === 'live' ? validateRepairConfiguration(configuration) : undefined;
  if ((mode === 'live' && coordination !== undefined) || (mode === 'fake'
    && (configuration !== undefined || !(coordination instanceof FakeCoordinationPort)))) fail('INVALID_ARGUMENT');
  if (mode === 'live' && process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('INVALID_ARGUMENT');
  const active = () => {if (signal.aborted) fail('CANCELLED'); if (Date.now() >= Date.parse(deadline)) fail('TIMEOUT');};
  active();
  await mkdir(outputRoot, {recursive: true});
  const directory = await mkdtemp(path.join(path.resolve(outputRoot), 'case-'));
  const receipt = {version: '1.0', profile: 'huawei_ict_agentarts', mode, status: 'running',
    verification: mode === 'fake' ? 'mock' : 'unverified', startedAt: new Date().toISOString(),
    approvalActor: 'authorized-synthetic-acceptance-harness', sourceTaskId: null, repairTaskId: null,
    sourcePendingWithoutRead: false, repairPendingWithoutWrite: false, candidateReceived: false,
    sourceExecutions: 0, repairExecutions: 0, sourceEvidence: 0, repairEvidence: 0,
    graphRevisionBefore: null, graphRevisionAfter: null, unchangedPlanPreserved: false,
    persistedReadbackVerified: false, noReplayAfterRestart: false, httpsApplicationRequests: 0,
    hostCleanupVerified: false, stage: 'initialize', cloudDiagnostics: []};
  const save = () => writeFile(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  let app, host, client;
  let sourceId, repairId;
  let restarted = false;
  let restartNetworkAttempts = 0;
  const callOptions = () => {active(); return {timeoutMs: Math.min(2_147_483_647, Date.parse(deadline) - Date.now()), signal};};
  const wait = async predicate => {
    while (!predicate()) {active(); await new Promise(resolve => setTimeout(resolve, 10));}
    active();
  };
  const waitState = async (taskId, states) => {
    await wait(() => states.includes(app.runtime.getTask(taskId).state));
    return app.runtime.getTask(taskId);
  };
  const open = async () => {
    host = createSyntheticRepairHost(path.join(directory, 'memory.sqlite'));
    const toolset = createSyntheticMeetingToolset(fixtureRoot, input => host.projectConfirmed(input));
    const options = {path: path.join(directory, 'runtime.sqlite'), repairCandidateVersion: '1.0',
      localRepair: host.localRepair, ...toolset};
    if (mode === 'fake') {
      app = createRuntimeApplication({...options, profile: 'huawei_ict_agentarts', coordination: restarted
        ? {execute() {restartNetworkAttempts++; fail('EXTERNAL_FAILURE');}} : coordination});
    } else {
      const credential = async value => {if (restarted) {restartNetworkAttempts++; fail('EXTERNAL_FAILURE');} return value;};
      app = createAgentArtsRuntimeApplication({...options, gatewayUrl: config.gatewayUrl, runtimeName: config.runtimeName,
        transport: 'wss', websocketUrl: `${config.gatewayUrl.replace(/^https:/, 'wss:')}/runtimes/${config.runtimeName}/invocations/ws`,
        responseMode: 'tool-proposal-json', initialRequestMode: 'goal-with-tools-json', allowHttpsFallback: false,
        competitionToolAvailability: [{toolName: 'workspace.read_text', toolVersion: '1.0.0', available: () => true}],
        authorizationProvider: {read: () => credential(config.inboundAuthorization)},
        websocketAuthorizationProvider: {read: () => credential(`Bearer ${config.wssToken}`)},
        onDiagnostic: value => {const diagnostic = sanitizeRepairDiagnostic(value); if (diagnostic) receipt.cloudDiagnostics.push(diagnostic);},
        fetchImpl: async () => {receipt.httpsApplicationRequests++; fail('EXTERNAL_FAILURE');}});
    }
    await host.initialize(app.runtime);
    client = new Client(app);
    await client.connect();
  };
  const approve = async taskId => {
    const approvals = (await client.call('approval.list', {taskId}, callOptions())).items;
    assert.equal(approvals.length, 1);
    const approval = approvals[0];
    await client.call('authorization.respond', {approvalId: approval.approvalId,
      expectedRevision: approval.revision, decision: 'allow_once'}, callOptions());
  };
  const close = async () => {
    if (app) {
      if (app.activeTaskCount !== 0) await wait(() => app.activeTaskCount === 0);
      app.close(); app = undefined;
    }
    host?.close(); host = undefined;
  };
  try {
    await open();
    const initial = host.readGraph();
    assert.equal(initial.revision, 5);
    receipt.stage = 'source_approval'; await save();
    const source = await client.call('task.submit', {goal: sourceGoal, conversationId: 'owned-synthetic-repair'},
      {...callOptions(), idempotencyKey: 'owned-synthetic-source'});
    sourceId = source.taskId; receipt.sourceTaskId = sourceId;
    assert.equal((await waitState(sourceId, ['waiting_approval', ...terminal])).state, 'waiting_approval');
    assert.equal(app.runtime.readToolExecutions(sourceId).filter(record => record.executionStarted).length, 0);
    assert.deepEqual(host.readGraph(), initial);
    receipt.sourcePendingWithoutRead = true; await save();
    await approve(sourceId);
    receipt.stage = 'source_candidate'; await save();
    const sourceFinished = await waitState(sourceId, terminal);
    receipt.sourceState = sourceFinished.state;
    if (sourceFinished.error) receipt.sourceErrorCode = safeCode(sourceFinished.error);
    assert.equal(sourceFinished.state, 'succeeded');
    const candidate = app.readRepairCandidate(sourceId);
    assert.equal(candidate?.kind, 'repair_candidate');
    assert.equal(candidate.candidateVersion, '1.0');
    // The existing fixture host checks every exact target, new summary and dependency.
    const binding = host.readBinding(sourceId);
    assert.ok(binding?.evidenceId);
    const sourceExecutions = app.runtime.readToolExecutions(sourceId);
    assert.equal(sourceExecutions.length, 1);
    assert.equal(sourceExecutions[0].state, 'confirmed');
    assert.equal(sourceExecutions[0].policyDecision, 'allow');
    assert.equal(sourceExecutions[0].executionStarted, true);
    assert.equal(sourceExecutions[0].toolName, 'workspace.read_text');
    receipt.sourceExecutions = 1; receipt.sourceEvidence = app.runtime.readEvidence(sourceId).length;
    assert.equal(receipt.sourceEvidence, 1); receipt.candidateReceived = true;
    const before = host.readGraph();
    assert.equal(before.revision, 6);
    const beforeImpact = analyzeImpact(before, new Date().toISOString());
    assert.deepEqual(beforeImpact.items.filter(item => item.action === 'RECHECK').map(item => item.node.id),
      ['attend', 'prepare', 'preparation']);
    const unchanged = currentNodes(before).find(node => node.id === 'unrelated');
    receipt.graphRevisionBefore = before.revision;
    receipt.stage = 'repair_approval'; await save();
    const request = {sourceTaskId: sourceId, evidenceId: binding.evidenceId,
      idempotencyKey: 'owned-synthetic-repair-once', deadline};
    const repair = app.submitLocalRepair(request);
    repairId = repair.taskId; receipt.repairTaskId = repairId;
    assert.equal((await waitState(repairId, ['waiting_approval', ...terminal])).state, 'waiting_approval');
    assert.deepEqual(host.readGraph(), before);
    assert.equal(app.runtime.readToolExecutions(repairId).filter(record => record.executionStarted).length, 0);
    receipt.repairPendingWithoutWrite = true; await save();
    await approve(repairId);
    receipt.stage = 'repair_readback'; await save();
    assert.equal((await waitState(repairId, terminal)).state, 'succeeded');
    const after = host.readGraph();
    assert.equal(after.revision, before.revision + 3);
    const executions = app.runtime.readToolExecutions(repairId);
    assert.equal(executions.length, 1);
    assert.equal(executions[0].toolName, 'cognition.commit_repair');
    assert.equal(executions[0].state, 'confirmed');
    assert.equal(executions[0].policyDecision, 'allow');
    assert.equal(executions[0].executionStarted, true);
    const current = currentNodes(after);
    assert.equal(current.find(node => node.id === 'preparation').summary, 'Prepare at 16:00');
    assert.deepEqual(current.find(node => node.id === 'unrelated'), unchanged);
    assert.ok(analyzeImpact(after, new Date().toISOString()).items.every(item => item.action === 'KEEP'));
    receipt.repairExecutions = 1; receipt.repairEvidence = app.runtime.readEvidence(repairId).length;
    assert.equal(receipt.repairEvidence, 1);
    receipt.graphRevisionAfter = after.revision; receipt.unchangedPlanPreserved = true;
    receipt.stage = 'persistent_readback'; await save();
    await close(); restarted = true;
    await open();
    assert.equal(app.runtime.getTask(sourceId).state, 'succeeded');
    assert.equal(app.runtime.getTask(repairId).state, 'succeeded');
    assert.deepEqual(host.readGraph(), after);
    assert.deepEqual(app.runtime.readToolExecutions(repairId), executions);
    assert.deepEqual(app.runtime.readToolExecutions(sourceId), sourceExecutions);
    assert.equal(app.runtime.readEvidence(sourceId).length, 1);
    assert.equal(app.runtime.readEvidence(repairId).length, 1);
    receipt.persistedReadbackVerified = true;
    const duplicate = app.submitLocalRepair(request);
    assert.equal(duplicate.taskId, repairId);
    assert.equal(duplicate.state, 'succeeded');
    assert.deepEqual(host.readGraph(), after);
    assert.equal(app.activeTaskCount, 0);
    assert.equal(restartNetworkAttempts, 0);
    assert.equal(receipt.httpsApplicationRequests, 0);
    receipt.noReplayAfterRestart = true;
    await close();
    receipt.hostCleanupVerified = true; receipt.stage = 'complete'; receipt.status = 'passed';
    receipt.verification = mode === 'fake' ? 'mock' : 'verified-fixed-synthetic-repair-loop';
  } catch (error) {
    receipt.status = 'failed'; receipt.errorCode = safeCode(error);
  } finally {
    // Cancel only this runner's own unfinished tasks; never resubmit or replay an unknown result.
    if (app) {
      for (const taskId of [sourceId, repairId].filter(Boolean)) {
        try {
          const state = app.runtime.getTask(taskId).state;
          if (!terminal.includes(state)) await client.call('task.cancel', {taskId, reason: 'Synthetic acceptance stopped'});
        } catch {receipt.cleanupErrorCode = 'CANCEL_NOT_CONFIRMED';}
      }
      // Preserve confirmed/unknown work even when the next cloud exchange or
      // candidate validation failed; a failed acceptance is not a zero-write claim.
      for (const [prefix, taskId] of [['source', sourceId], ['repair', repairId]]) {
        if (!taskId) continue;
        try {
          const task = app.runtime.getTask(taskId);
          receipt[`${prefix}State`] = task.state;
          if (task.error) receipt[`${prefix}ErrorCode`] = safeCode(task.error);
          receipt[`${prefix}Executions`] = app.runtime.readToolExecutions(taskId).filter(record => record.executionStarted).length;
          receipt[`${prefix}Evidence`] = app.runtime.readEvidence(taskId).length;
        } catch {receipt.cleanupErrorCode = 'FINAL_READBACK_NOT_CONFIRMED';}
      }
      try {receipt.currentGraphRevision = host.readGraph().revision;} catch { /* Initialization may have failed. */ }
      try {
        // Give cancellation's already-scheduled continuation a chance to release its worker.
        await new Promise(resolve => setImmediate(resolve));
        await close(); receipt.hostCleanupVerified = true;
      } catch {receipt.cleanupErrorCode = 'CLEANUP_NOT_CONFIRMED';}
    } else {host?.close(); host = undefined;}
    receipt.finishedAt = new Date().toISOString();
    try {await save();}
    catch {
      receipt.status = 'failed';
      receipt.verification = mode === 'fake' ? 'mock' : 'unverified';
      receipt.receiptWriteErrorCode = 'RECEIPT_WRITE_NOT_CONFIRMED';
    }
  }
  return {receipt, directory};
}

export async function main(args = process.argv.slice(2), input = process.stdin) {
  if (args.length !== 4 || args[0] !== '--live' || args[1] !== '--approve-synthetic-fixture'
    || args[2] !== '--deadline') fail('INVALID_ARGUMENT');
  const chunks = []; let length = 0;
  for await (const chunk of input) {
    length += Buffer.byteLength(chunk); if (length > 16_384) fail('INVALID_ARGUMENT'); chunks.push(Buffer.from(chunk));
  }
  let configuration;
  try {configuration = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {fail('INVALID_ARGUMENT');}
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const {receipt, directory} = await runOwnedRepairLoop({mode: 'live', configuration,
      deadline: args[3], signal: controller.signal, approveSyntheticFixture: true});
    process.stdout.write(JSON.stringify({receiptPath: receipt.receiptWriteErrorCode ? null : path.join(directory, 'receipt.json'), ...receipt}, null, 2) + '\n');
    process.exitCode = receipt.status === 'passed' ? 0 : 1;
  } finally {process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);}
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {process.stderr.write(JSON.stringify({status: 'failed', errorCode: safeCode(error)}) + '\n'); process.exitCode = 1;});
}
