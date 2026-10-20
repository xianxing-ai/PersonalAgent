import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createRuntimeApplication} from '../dist/application/runtime-application.js';
import {RUNTIME_PROACTIVE_TOOLS, RUNTIME_PROACTIVE_TOOL_VERSION} from '../dist/application/proactive-workflow-application.js';
import {ProactiveWorkflowEngine} from '@personal-agent/agentarts';
import {createProactiveHostProofs} from '@personal-agent/agentarts-runtime/proactive-controller';
import {RuntimeToolInvoker} from '@personal-agent/agents';
import {ProtocolError} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';

// Actual Runtime worker, SQLite state, Policy and ToolGateway; signed pure frontier is an explicit offline image fixture.
// Only this test's observation helper polls. Production worker waits on host events and the original Runtime abort signal.
mkdirSync(join(process.cwd(), '.cache'), {recursive: true});
const until = async predicate => {
  for (let i = 0; i < 1000; i++) {if (predicate()) return; await delay(2);}
  assert.fail('Actual Runtime worker did not reach the expected observed state');
};
function fixture(extra = {}) {
  let clock = Date.now(), local = extra.local ?? false, imageCalls = 0, toolCalls = 0;
  const path = join(mkdtempSync(join(process.cwd(), '.cache', 'proactive-lifecycle-')), 'runtime.sqlite');
  const deadline = new Date(clock + 120_000).toISOString(), proofs = createProactiveHostProofs('explicit-offline-lifecycle-proof-secret-32');
  const engine = new ProactiveWorkflowEngine({checkpointSecret: 'explicit-offline-lifecycle-state-secret-32', decisionContracts: [{id: 'fixture', version: '1',
    qualifiedForMain: false, batchIndependent: true, criteria: 'No production decision provider configured', candidates: [
      {id: 'continue', action: 'continue', description: 'Continue the actual assigned responsibility'}, {id: 'defer', action: 'defer', description: 'Wait'}]}],
    now: () => clock, verifyEvent: async (value, binding) => proofs.verify('event', value, binding),
    verifyResponsibility: async (value, binding) => proofs.verify('responsibility', value, binding),
    verifyReceipt: async (value, _proposal, binding) => proofs.verify('receipt', value, binding), verifyControl: async (value, binding) => proofs.verify('control', value, binding)});
  const unknownTool = {descriptor: {name: 'fixture.unknown_write', version: '1.0.0', inputSchema: {type: 'object'}, outputSchema: {type: 'object'},
    sideEffect: 'local_write', requiredScopes: ['fixture:write'], idempotencySupport: true, recoverySupport: true, requiresPresence: false},
    execute: async () => {toolCalls++; throw new ProtocolError('RESULT_UNKNOWN', 'Original fixture write needs independent readback');}};
  const applicationOptions = {path, profile: 'huawei_ict_agentarts', hostUserNamespace: 'proactive-lifecycle-fixture', proactiveWorkflows: true,
    now: () => new Date(clock), tools: [unknownTool, ...(extra.tools ?? [])], automaticTools: extra.approval ? [] : [
      {toolName: RUNTIME_PROACTIVE_TOOLS.retrieve_context, toolVersion: RUNTIME_PROACTIVE_TOOL_VERSION}, ...(extra.automaticTools ?? [])]};
  const app = createRuntimeApplication(applicationOptions);
  const task = app.runtime.submitTask({goal: 'Original ongoing responsibility', conversationId: 'lifecycle-conversation', idempotencyKey: 'original'});
  const source = app.runtime.submitTask({goal: 'Original user instruction to watch the approved source', conversationId: 'lifecycle-conversation', idempotencyKey: 'source'});
  const options = {taskId: task.taskId, sessionId: 'lifecycle-session', taskDeadline: deadline, contractRef: 'fixture',
    advancePort: async input => {imageCalls++; return proofs.sign('advance_result', {requestId: input.requestId, ...await engine.advance(input)}, input);},
    verifyAdvance: (result, input) => result.requestId === input.requestId && proofs.verify('advance_result', result, input),
    sign: (kind, value, binding) => proofs.sign(kind, value, binding), localDeviceAvailable: () => local,
    verifyControlCommand: async () => true, pureAdvance: {kind: 'signed_frontier_no_effects'}, ...(extra.hostOptions ?? {})};
  const host = app.createProactiveWorkflowHost(options), context = {signal: new AbortController().signal, deadline};
  host.ingestUserInstruction({sourceTaskId: source.taskId}, context);
  return {app, host, task, source, options, applicationOptions, context, deadline, path,
    setLocal: value => {local = value; host.notifyAvailabilityChanged();}, advanceClock: value => {clock += value;}, calls: () => ({imageCalls, toolCalls})};
}
async function stop(app, taskId, worker) {
  app.runtime.requestCancel(taskId, 'Explicit fixture shutdown');
  if (worker) await worker.catch(() => {});
  app.close();
}
async function interrupt(f) {
  const worker = f.app.runProactiveTask(f.task.taskId);
  await until(() => f.host.inspect().application.state.lastResult !== undefined && f.app.runtime.getTask(f.task.taskId).state === 'running');
  const recovered = f.app.runtime.recoverInterruptedTasks();
  assert.equal(recovered.some(task => task.taskId === f.task.taskId), false, 'startup recovery must not classify a live worker as interrupted');
  assert.equal(f.app.runtime.getTask(f.task.taskId).state, 'running');
  // Explicit crash-state fixture: the live worker cannot be reclaimed by startup
  // recovery. Model the persisted interruption separately, then let that worker
  // observe it and settle before reopening the same SQLite session below.
  f.app.runtime.transitionTask(f.task.taskId, 'waiting_reconciliation', {
    error: {code: 'RESULT_UNKNOWN', message: 'Explicit fixture process-loss state; original receipts retained', retryable: false},
  });
  assert.throws(() => f.app.runtime.prepareVerifiedContinuation(f.task.taskId, f.app.runtime.getTask(f.task.taskId).revision), {code: 'REVISION_CONFLICT'}, 'an active original worker cannot be reopened');
  f.host.notifyAvailabilityChanged();
  assert.equal((await worker).state, 'waiting_reconciliation');
  f.app.close();
}

test('Application owns the ongoing original worker; idle/device wait/pause wake on events and never become succeeded; cancel releases close', async () => {
  const f = fixture(); let worker;
  try {
    assert.equal(f.app.startProactiveTask(f.task.taskId), f.host);
    worker = f.app.runProactiveTask(f.task.taskId);
    await until(() => Object.values(f.host.inspect().application.state.lastResult?.items ?? {}).some(item => item.state === 'waiting_device'));
    assert.equal(f.app.runtime.getTask(f.task.taskId).state, 'running'); assert.equal(f.app.activeTaskCount, 1);
    const count = f.calls().imageCalls; await delay(25); assert.equal(f.calls().imageCalls, count, 'production worker does not poll an idle frontier');
    assert.throws(() => f.app.close(), {code: 'REVISION_CONFLICT'});
    await f.host.control({commandId: 'pause', action: 'pause', expectedControlRevision: 0, sourceTaskId: f.source.taskId}, f.context);
    await until(() => f.host.inspect().application.state.lastResult?.mode === 'paused');
    assert.equal(f.app.runtime.getTask(f.task.taskId).state, 'running');
    await f.host.control({commandId: 'resume', action: 'resume', expectedControlRevision: 1, sourceTaskId: f.source.taskId}, f.context);
    await until(() => f.host.inspect().application.state.lastResult?.mode === 'attended');
    assert.equal(f.app.runtime.getTask(f.task.taskId).state, 'running');
    f.app.runtime.requestCancel(f.task.taskId, 'Actual user stop');
    assert.equal((await worker).state, 'cancelled'); assert.equal(f.app.activeTaskCount, 0);
    f.app.close(); worker = undefined;
  } finally {if (worker) await stop(f.app, f.task.taskId, worker);}
});

test('original approval response re-enters the Runtime driver and confirms the same never-started operation', async () => {
  const f = fixture({local: true, approval: true}); let resumed;
  try {
    const first = f.app.runProactiveTask(f.task.taskId);
    assert.equal((await first).state, 'waiting_approval');
    const proposal = f.host.inspect().application.state.lastResult.proposals[0], approval = f.app.runtime.getApproval(proposal.operationId);
    const response = await f.app.send({kind: 'request', protocolVersion: '1.0.0', requestId: 'original-lifecycle-approval', deadline: f.deadline,
      operation: 'authorization.respond', payload: {approvalId: approval.approvalId, expectedRevision: approval.revision, decision: 'allow_once'}}, f.context.signal);
    assert.equal(response.outcome, 'ok');
    resumed = f.app.runProactiveTask(f.task.taskId);
    await until(() => f.app.runtime.readToolExecutions(f.task.taskId).some(record => record.evidenceId === proposal.operationId && record.state === 'confirmed'));
    await until(() => Object.values(f.host.inspect().application.state.lastResult.items).some(item => item.state === 'blocked'));
    assert.equal(f.app.runtime.getTask(f.task.taskId).state, 'running');
    assert.equal(f.app.runtime.readToolExecutions(f.task.taskId).length, 1);
    assert.equal(f.host.binding.taskDeadline, f.deadline);
  } finally {await stop(f.app, f.task.taskId, resumed);}
});

test('zero-tool device wait recovers the same signed session after SQLite restart without a new task/deadline/grant', async () => {
  const f = fixture(); await interrupt(f);
  const app = createRuntimeApplication(f.applicationOptions); let worker;
  try {
    const host = app.createProactiveWorkflowHost(f.options);
    assert.equal(app.runtime.getTask(f.task.taskId).state, 'waiting_reconciliation');
    worker = app.runProactiveTask(f.task.taskId);
    await until(() => app.runtime.getTask(f.task.taskId).state === 'running' && host.inspect().application.state.lastResult?.mode === 'attended');
    assert.equal(app.runtime.readToolExecutions(f.task.taskId).length, 0);
    assert.equal(host.binding.taskDeadline, f.deadline); assert.equal(host.binding.sessionId, f.options.sessionId);
    assert.equal(app.runtime.listTasks({conversationId: 'lifecycle-conversation', limit: 100}).items.length, 2);
  } finally {await stop(app, f.task.taskId, worker);}
});

test('confirmed original tool results survive restart and continue without another invocation or grant', async () => {
  const f = fixture({local: true});
  let worker = f.app.runProactiveTask(f.task.taskId);
  await until(() => Object.values(f.host.inspect().application.state.lastResult?.items ?? {}).some(item => item.state === 'blocked'));
  const records = f.app.runtime.readToolExecutions(f.task.taskId); assert.equal(records.length, 1); assert.equal(records[0].state, 'confirmed');
  assert.equal(f.app.runtime.recoverInterruptedTasks().length, 0, 'startup recovery cannot reclaim this live worker');
  // Model process loss explicitly, as interrupt() does; recovery correctly ignores active workers.
  f.app.runtime.transitionTask(f.task.taskId, 'waiting_reconciliation', {
    error: {code: 'RESULT_UNKNOWN', message: 'Explicit fixture process-loss state; original receipts retained', retryable: false},
  });
  f.host.notifyAvailabilityChanged(); assert.equal((await worker).state, 'waiting_reconciliation'); f.app.close();
  const app = createRuntimeApplication(f.applicationOptions);
  try {
    app.createProactiveWorkflowHost(f.options); worker = app.runProactiveTask(f.task.taskId);
    await until(() => app.runtime.getTask(f.task.taskId).state === 'running');
    assert.deepEqual(app.runtime.readToolExecutions(f.task.taskId), records);
  } finally {await stop(app, f.task.taskId, worker);}
});

test('unknown original execution refuses both Runtime gate and Application restart; no tool or task is retried', async () => {
  const f = fixture();
  try {
    await f.host.advance({...f.context, requestId: 'known-signed-before-unknown'});
    const invoker = new RuntimeToolInvoker(f.app.runtime), runId = 'original-unknown-run';
    f.app.runtime.policy.grant({authorizationRef: runId, taskId: f.task.taskId, toolName: 'fixture.unknown_write', scopes: ['fixture:write'],
      expiresAt: f.deadline, argumentsDigest: toolArgumentsDigest({}), maxUses: 1});
    const task = await f.app.runtime.runTask(f.task.taskId, async worker => {
      await invoker.invoke({toolName: 'fixture.unknown_write', toolVersion: '1.0.0', arguments: {}, taskId: worker.taskId,
        runId, authorizationRef: runId, deadline: worker.deadline, signal: worker.signal});
      return {resultSummary: 'Cannot claim success'};
    }, {deadline: f.deadline, sideEffect: 'local_write'});
    assert.equal(task.state, 'waiting_reconciliation'); assert.equal(f.calls().toolCalls, 1);
    assert.throws(() => f.app.runtime.prepareVerifiedContinuation(task.taskId, task.revision), {code: 'UNAUTHORIZED'});
    await assert.rejects(f.app.runProactiveTask(task.taskId), {code: 'UNAUTHORIZED'});
    assert.equal(f.calls().toolCalls, 1); assert.equal(f.app.runtime.getTask(task.taskId).state, 'waiting_reconciliation');
  } finally {f.app.close();}
});

test('verified continuation rejects stale revisions, cancellation, expiration, missing original result and terminal reopen', async () => {
  const f = fixture({local: true}); let worker = f.app.runProactiveTask(f.task.taskId);
  await until(() => Object.values(f.host.inspect().application.state.lastResult?.items ?? {}).some(item => item.state === 'blocked'));
  assert.equal(f.app.runtime.recoverInterruptedTasks().length, 0, 'startup recovery cannot reclaim this live worker');
  f.app.runtime.transitionTask(f.task.taskId, 'waiting_reconciliation', {
    error: {code: 'RESULT_UNKNOWN', message: 'Explicit fixture process-loss state; original receipts retained', retryable: false},
  });
  f.host.notifyAvailabilityChanged(); assert.equal((await worker).state, 'waiting_reconciliation');
  try {
    const task = f.app.runtime.getTask(f.task.taskId), original = f.app.runtime.readToolExecutions(task.taskId)[0];
    assert.throws(() => f.app.runtime.prepareVerifiedContinuation(task.taskId, task.revision - 1), {code: 'REVISION_CONFLICT'});
    const saved = f.app.runtime.loadCheckpoint(task.taskId, 'tool-result-' + original.evidenceId);
    f.app.runtime.saveCheckpoint(task.taskId, 'tool-result-' + original.evidenceId, {});
    assert.throws(() => f.app.runtime.prepareVerifiedContinuation(task.taskId, task.revision), {code: 'UNAUTHORIZED'});
    f.app.runtime.saveCheckpoint(task.taskId, 'tool-result-' + original.evidenceId, saved);
    f.advanceClock(121_000);
    assert.throws(() => f.app.runtime.prepareVerifiedContinuation(task.taskId, task.revision), {code: 'TIMEOUT'});
    await assert.rejects(f.app.runProactiveTask(task.taskId), {code: 'TIMEOUT'});
    f.app.runtime.requestCancel(task.taskId, 'Actual cancellation');
    assert.throws(() => f.app.runtime.prepareVerifiedContinuation(task.taskId, f.app.runtime.getTask(task.taskId).revision), {code: 'UNAUTHORIZED'});
    f.app.runtime.confirmCancellation(task.taskId);
    await assert.rejects(f.app.runProactiveTask(task.taskId), {code: 'TIMEOUT'});
  } finally {f.app.close();}
});

test('a proven stale public reference before any intent waits on the original Runtime worker until explicit control retrieves current context', async () => {
  let choiceCalls = 0;
  const choice = {descriptor: {name: 'fixture.current_choice', version: '1.0.0', inputSchema: {type: 'object'}, outputSchema: {type: 'object'},
    sideEffect: 'read', requiredScopes: ['fixture:choice'], idempotencySupport: true, recoverySupport: true, requiresPresence: false}, execute: async input => {
      choiceCalls++; return {selections: input.independentQuestions.map(question => ({itemId: question.itemId, candidateId: 'continue',
        decisionRef: 'fixture:current-choice', decidedBy: 'laya', uncertain: true, complex: false, importance: 'important', authorityRequired: false}))};
    }};
  const f = fixture({local: true, tools: [choice], automaticTools: [{toolName: choice.descriptor.name, toolVersion: choice.descriptor.version}],
    hostOptions: {bindings: [{kind: 'local_decision_batch', toolName: choice.descriptor.name, toolVersion: choice.descriptor.version, location: 'local_device', effect: 'read'}]}});
  const facts = f.app.createCompetitionFactHost({memoryPath: f.path + '.memory.sqlite', memoryNamespace: 'driver-public',
    graphNamespace: 'driver-public-graph', consumerKey: 'driver-public-consumer'});
  const source = {vaultId: 'fixture-vault', path: 'source.md', factId: 'driver-public-fact', sourceRevision: 'a'.repeat(64),
    line: 1, summary: 'Actual original public fact', observedAt: new Date().toISOString(), validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2027-01-01T00:00:00.000Z', expectedFactRevision: null};
  facts.recordPublicSource(source, f.context);
  let exactReads = 0, worker;
  f.options.context = {limit: 10, publicMemory: {...facts.publicMemory, listCurrent: async request => {
    if (request.factId === source.factId && ++exactReads === 2)
      facts.recordPublicSource({...source, sourceRevision: 'b'.repeat(64), summary: 'Actual corrected public fact', expectedFactRevision: 1}, f.context);
    return facts.publicMemory.listCurrent(request);
  }}};
  try {
    worker = f.app.runProactiveTask(f.task.taskId);
    await until(() => Object.keys(f.host.inspect().application.state.contextValidity ?? {}).length === 1);
    const stale = f.host.inspect(), proposal = stale.application.state.lastResult.proposals[0];
    assert.equal(proposal.stage, 'laya'); assert.equal(choiceCalls, 0);
    assert.equal(stale.session.state.operations[proposal.operationId], undefined);
    assert.equal(f.app.runtime.readToolExecutions(f.task.taskId).some(record => record.evidenceId === proposal.operationId), false);
    assert.equal(f.app.runtime.getTask(f.task.taskId).state, 'running');
    const imageCalls = f.calls().imageCalls; await delay(25);
    assert.equal(f.calls().imageCalls, imageCalls, 'stale context wait does not poll a new image frontier');
    f.host.notifyAvailabilityChanged(); await delay(25);
    assert.equal(choiceCalls, 0); assert.equal(f.calls().imageCalls, imageCalls);
    await f.host.control({commandId: 'current-context-pause', action: 'pause', expectedControlRevision: 0, sourceTaskId: f.source.taskId}, f.context);
    await f.host.control({commandId: 'current-context-resume', action: 'resume', expectedControlRevision: 1, sourceTaskId: f.source.taskId}, f.context);
    await until(() => choiceCalls === 1 && Object.values(f.host.inspect().application.state.lastResult?.items ?? {}).some(item => item.state === 'blocked'));
    assert.equal(f.app.runtime.getTask(f.task.taskId).state, 'running');
    assert.equal(f.host.binding.taskDeadline, f.deadline);
    assert.equal(f.app.runtime.readToolExecutions(f.task.taskId).some(record => record.evidenceId === proposal.operationId), false);
    const contexts = Object.values(f.host.inspect().application.state.contexts);
    assert.equal(contexts.length, 2); assert.equal(contexts[1].facts[0].ref.revision, 2);
    f.app.runtime.requestCancel(f.task.taskId, 'Explicit original-task cancellation releases the stale-context worker');
    assert.equal((await worker).state, 'cancelled'); assert.equal(f.app.activeTaskCount, 0);
  } finally {await stop(f.app, f.task.taskId, worker); facts.close();}
});

test('a settled Laya read failure followed by teacher takeover survives a later lost frontier response on the original task without repeating either model', async () => {
  let localCalls = 0, teacherCalls = 0, lost = false, lostRequestId;
  const descriptor = name => ({name, version: '1.0.0', inputSchema: {type: 'object'}, outputSchema: {type: 'object'}, sideEffect: 'read',
    requiredScopes: ['fixture:decision'], idempotencySupport: true, recoverySupport: true, requiresPresence: false});
  const local = {descriptor: descriptor('fixture.failed_laya'), execute: async () => {localCalls++; throw new ProtocolError('EXTERNAL_FAILURE', 'Explicit fixture Laya read ended without a choice');}};
  const teacher = {descriptor: descriptor('fixture.takeover_teacher'), execute: async input => {
    teacherCalls++; return {selections: input.independentQuestions.map(question => ({itemId: question.itemId, candidateId: 'continue',
      decisionRef: 'fixture:original-teacher-takeover', decidedBy: 'deepseek', uncertain: false, complex: false, importance: 'important', authorityRequired: false}))};
  }};
  const f = fixture({local: true, tools: [local, teacher], automaticTools: [local, teacher].map(tool => ({toolName: tool.descriptor.name, toolVersion: tool.descriptor.version})),
    hostOptions: {bindings: [{kind: 'local_decision_batch', toolName: local.descriptor.name, toolVersion: local.descriptor.version, location: 'local_device', effect: 'read'},
      {kind: 'teacher_decision', toolName: teacher.descriptor.name, toolVersion: teacher.descriptor.version, location: 'local_device', effect: 'read'}]}});
  const advance = f.options.advancePort, requests = [];
  f.options.advancePort = async input => {
    requests.push(input.requestId); const result = await advance(input);
    if (!lost && teacherCalls === 1) {lost = true; lostRequestId = input.requestId; throw new ProtocolError('RESULT_UNKNOWN', 'Signed pure frontier response was lost after teacher takeover');}
    return result;
  };
  let application = f.app, resumed;
  try {
    const stopped = await application.runProactiveTask(f.task.taskId);
    assert.equal(stopped.state, 'waiting_reconciliation'); assert.equal(localCalls, 1); assert.equal(teacherCalls, 1);
    const before = f.host.inspect(), records = application.runtime.readToolExecutions(f.task.taskId);
    const localRecord = records.find(record => record.toolName === local.descriptor.name);
    assert.equal(localRecord.state, 'failed'); assert.equal(localRecord.policyDecision, 'allow'); assert.equal(localRecord.executionStarted, true);
    assert.ok(localRecord.finishedAt); assert.equal(application.runtime.loadCheckpoint(f.task.taskId, 'tool-result-' + localRecord.evidenceId), undefined);
    assert.equal((await f.host.reconcileOperation(localRecord.evidenceId, f.context)).state, 'failed', 'original Runtime failure readback stays failed');
    assert.equal(before.session.state.requests[lostRequestId].state, 'pending');
    const savedRequest = before.session.state.requests[lostRequestId].input;
    const grants = Object.fromEntries(records.map(record => [record.evidenceId, application.runtime.policy.get(record.evidenceId) ?? null]));
    application.close(); application = undefined;
    application = createRuntimeApplication(f.applicationOptions);
    const host = application.createProactiveWorkflowHost(f.options), requestCount = requests.length;
    resumed = application.runProactiveTask(f.task.taskId);
    await until(() => application.runtime.getTask(f.task.taskId).state === 'running'
      && host.inspect().session.state.requests[lostRequestId]?.state === 'committed'
      && Object.values(host.inspect().application.state.lastResult?.items ?? {}).some(item => item.state === 'blocked'));
    assert.equal(requests[requestCount], lostRequestId, 'only the exact pending signed pure frontier is recovered first');
    assert.deepEqual(host.inspect().session.state.requests[lostRequestId].input, savedRequest);
    assert.deepEqual(application.runtime.readToolExecutions(f.task.taskId), records);
    assert.equal(application.runtime.loadCheckpoint(f.task.taskId, 'tool-result-' + localRecord.evidenceId), undefined);
    assert.deepEqual(Object.fromEntries(records.map(record => [record.evidenceId, application.runtime.policy.get(record.evidenceId) ?? null])), grants);
    assert.equal(localCalls, 1); assert.equal(teacherCalls, 1); assert.equal(host.binding.taskDeadline, f.deadline);
    assert.equal(application.runtime.listTasks({conversationId: 'lifecycle-conversation', limit: 100}).items.length, 2);
    assert.equal(application.runtime.getTask(f.task.taskId).state, 'running');
  } finally {if (application) await stop(application, f.task.taskId, resumed);}
});
