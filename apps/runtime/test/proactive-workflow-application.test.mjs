import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createRuntimeApplication} from '../dist/application/runtime-application.js';
import {createRuntimeProactiveConnectorHost} from '../dist/application/proactive-connector-host.js';
import {RUNTIME_PROACTIVE_TOOLS, RUNTIME_PROACTIVE_TOOL_VERSION} from '../dist/application/proactive-workflow-application.js';
import {createRuntimeAtomicStatePort} from '../dist/index.js';
import {ProactiveWorkflowEngine} from '@personal-agent/agentarts';
import {createProactiveHostProofs} from '@personal-agent/agentarts-runtime/proactive-controller';
import {ConnectorHost} from '@personal-agent/connector-host';
import {FakeModelProvider, ModelGateway} from '@personal-agent/models';
import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeSubagentDispatchTool, SUBAGENT_DISPATCH_TOOL_NAME, SUBAGENT_DISPATCH_TOOL_VERSION} from '../dist/application/subagent-host.js';

// Actual Runtime/SQLite/Policy/ToolGateway/Scheduler and public application entrypoints.
// Account, source text, image HMAC authority and decision/model outputs are explicit offline fixtures.
// This is not real account/device/cloud-persistent-host or model-quality acceptance.
mkdirSync(join(process.cwd(), '.cache'), {recursive: true});
const secret = 'offline-runtime-proactive-application-secret-32';
const descriptor = (name, effect = 'read') => ({name, version: '1.0.0', inputSchema: {type: 'object'}, outputSchema: {type: 'object'},
  sideEffect: effect, requiredScopes: ['fixture:' + name], idempotencySupport: true, recoverySupport: true, requiresPresence: false});

function fixture(extra = {}) {
  let clock = Date.now(), localAvailable = true, imageCalls = 0, actionCalls = 0, modelCalls = 0, sourceReads = 0;
  let app;
  const deadline = new Date(clock + 120_000).toISOString(), signal = new AbortController().signal;
  const path = extra.path ?? join(mkdtempSync(join(process.cwd(), '.cache', 'proactive-application-')), 'runtime.sqlite');
  const contract = {id: 'offline-responsibility', version: '1', qualifiedForMain: false, batchIndependent: true,
    criteria: 'Read original user quote and public context; preserve important unsubscribed changes', candidates: [
      {id: 'act', description: 'Continue the already assigned work', action: extra.action ?? 'continue'},
      {id: 'defer', description: 'Defer without claiming a completed operation', action: 'defer'}]};
  const proofs = createProactiveHostProofs(secret);
  const engine = new ProactiveWorkflowEngine({checkpointSecret: secret, decisionContracts: [contract], now: () => clock,
    verifyEvent: async (value, binding) => proofs.verify('event', value, binding),
    verifyResponsibility: async (value, binding) => proofs.verify('responsibility', value, binding),
    verifyReceipt: async (value, _proposal, binding) => proofs.verify('receipt', value, binding),
    verifyControl: async (value, binding) => proofs.verify('control', value, binding)});
  const selectionTool = kind => ({descriptor: descriptor('fixture.' + kind), execute: async args => {
    modelCalls++;
    return {selections: args.independentQuestions.map(question => ({itemId: question.itemId, candidateId: 'act',
      decisionRef: 'fixture:' + kind + ':' + question.itemId, decidedBy: kind === 'laya' ? 'laya' : 'deepseek', uncertain: false,
      complex: false, importance: 'important', authorityRequired: false}))};
  }});
  const action = {descriptor: descriptor('fixture.action', 'local_write'), execute: async () => {
    actionCalls++;
    if (extra.unknownWrite) throw new ProtocolError('RESULT_UNKNOWN', 'Original write result is unknown');
    return {status: 'changed', resultRef: 'fixture:readback:' + actionCalls, ...(extra.wake ? {nextWake: {
      runAt: new Date(clock + 1000).toISOString(), timeZone: 'UTC', missedRunPolicy: 'run_once', reason: 'Known source follow-up'}} : {})};
  }};
  const model = new ModelGateway(new FakeModelProvider([() => ({kind: 'final', text: 'Explicit fixture child model report'})]));
  const dispatch = createRuntimeSubagentDispatchTool({getRuntime: () => app.runtime, getModelGateway: () => model});
  const toolValues = [selectionTool('laya'), selectionTool('teacher'), action, ...(extra.action === 'delegate' ? [dispatch] : [])];
  app = createRuntimeApplication({path, profile: 'huawei_ict_agentarts', hostUserNamespace: 'proactive-application-fixture', proactiveWorkflows: true,
    now: () => new Date(clock), tools: toolValues,
    automaticTools: [
      ...toolValues.filter(tool => extra.approval ? tool.descriptor.sideEffect === 'read' : true).map(tool => ({toolName: tool.descriptor.name, toolVersion: tool.descriptor.version})),
      ...Object.entries(RUNTIME_PROACTIVE_TOOLS).filter(([kind]) => kind !== 'notify').map(([, toolName]) => ({toolName, toolVersion: RUNTIME_PROACTIVE_TOOL_VERSION})),
    ]});
  const task = app.runtime.submitTask({goal: 'Continuously track this original public responsibility', conversationId: 'fixture-conversation', idempotencyKey: 'original-proactive-task'});
  const source = app.runtime.submitTask({goal: 'Original user words: keep the tracked source current and report changes', conversationId: 'fixture-conversation', idempotencyKey: 'original-user-instruction'});
  const goalStore = app.runtime.provisionCoordinationStore('proactive-public-goal');
  if (goalStore.read().revision === 0) goalStore.append(0, {id: 'goal-public', kind: 'goal', summary: 'Track the original public source', sourceRef: 'fixture:goal',
    validFrom: new Date(clock - 60_000).toISOString(), validUntil: deadline, sensitivity: 'public', state: 'active', reason: 'Explicit fixture goal', dependencies: []});
  const fact = {ref: {id: 'public-memory', revision: 1}, summary: 'Public prior observation', sourceRef: 'fixture:fact', observedAt: new Date(clock).toISOString(),
    validFrom: new Date(clock - 60_000).toISOString(), validUntil: deadline, sensitivity: 'public', state: 'active', confirmation: 'external_observation'};
  const options = {taskId: task.taskId, sessionId: 'fixture-proactive-session', taskDeadline: deadline, contractRef: contract.id,
    advancePort: async input => {imageCalls++; return proofs.sign('advance_result', {requestId: input.requestId, ...await engine.advance(input)}, input);},
    verifyAdvance: async (result, input) => result.requestId === input.requestId && proofs.verify('advance_result', result, input),
    sign: (kind, value, binding) => proofs.sign(kind, value, binding), localDeviceAvailable: () => localAvailable,
    context: {publicMemory: {listCurrent: async () => ({snapshot: 'fixture', facts: [fact, {...fact, ref: {id: 'private-memory', revision: 1}, summary: 'MUST STAY PRIVATE', sensitivity: 'private'}]}),
      listHistory: async () => ({snapshot: 'fixture', facts: []}), getVersion: async () => fact}, publicKnowledge: {search: async () => ({hits: [
        {source: {vaultId: 'public-vault', path: 'source.md', line: 1, revision: 'public-revision'}, excerpt: 'Public source excerpt'}], truncated: false})},
      goals: goalStore, limit: 10},
    verifyControlCommand: async (_command, actual) => actual.conversationId === 'fixture-conversation',
    bindings: [{kind: 'local_decision_batch', toolName: 'fixture.laya', toolVersion: '1.0.0', location: 'local_device', effect: 'read'},
      {kind: 'teacher_decision', toolName: 'fixture.teacher', toolVersion: '1.0.0', location: 'local_device', effect: 'read'},
      extra.action === 'delegate' ? {kind: 'delegate', toolName: SUBAGENT_DISPATCH_TOOL_NAME, toolVersion: SUBAGENT_DISPATCH_TOOL_VERSION,
        location: 'local_device', effect: 'write', arguments: () => ({subtasks: [{subtaskId: 'child-one', role: 'researcher', goal: 'Read only the assigned public material'}]})}
        : {kind: extra.action ?? 'continue', toolName: 'fixture.action', toolVersion: '1.0.0', location: 'local_device', effect: 'write'}],
    ...(extra.options ?? {})};
  const host = app.createProactiveWorkflowHost(options);
  let sequence = 0;
  const context = {deadline, signal};
  const next = () => host.advance({...context, requestId: 'request-' + ++sequence});
  const connector = new ConnectorHost({read: () => undefined});
  const manifest = {id: 'fixture-source', version: '1.0.0', accountTypes: ['fixture'], capabilities: ['fetchChanges'], configSchema: {type: 'object'},
    authentication: 'none', requiresPresence: false, syncStrategy: 'incremental', verification: 'mock'};
  connector.register({manifest, create: () => ({manifest, connect: () => ({sessionRef: 'fixture-session', interactionRequired: false}),
    disconnect: () => ({disconnected: true, cleanupState: 'complete'}), health: () => ({state: 'ready'}), getCapabilities: () => manifest.capabilities,
    fetchChanges: async () => {sourceReads++; return {items: [{source: manifest.id, accountRef: 'fixture-account', externalId: 'one', dedupeKey: 'source-one',
      occurredAt: new Date(clock).toISOString(), fetchedAt: new Date(clock).toISOString(), contentRef: 'fixture:public-source', sensitivity: 'public'}], nextCursor: 'source-cursor-1', hasMore: false};},
    search: () => [], getItem: () => {throw Error('unused');}, performAction: () => {throw Error('No real account writes');}})},
    {proactive: [{sourceId: 'fixture-source', accountRef: 'fixture-account', kind: 'feeds', mode: 'poll-only', configurationRevision: 'fixture-1'}]});
  const connectorRunner = createRuntimeProactiveConnectorHost({host: connector, atomicState: createRuntimeAtomicStatePort(app.runtime, 'proactive-fixture-source'),
    authorize: async () => true, events: host.eventSink, now: () => clock});
  return {app, host, options, task, source, deadline, context, path, next, connectorRunner,
    advanceClock: ms => {clock += ms;}, offline: () => {localAvailable = false;}, online: () => {localAvailable = true;},
    calls: () => ({imageCalls, actionCalls, modelCalls, sourceReads}), run: async callback => app.runtime.runTask(task.taskId, callback,
      {deadline, sideEffect: 'local_write', ...(app.runtime.getTask(task.taskId).state === 'waiting_approval' ? {resume: true} : {})}),
    close: async () => {await connectorRunner.dispose(); app.close();}};
}

test('responsibility lifecycle requires trusted original decision, preserves old records and enforces expiry and source binding', async () => {
  let authorized = true;
  const f = fixture({options: {verifyResponsibilityLifecycle: async () => authorized,
    assertResponsibilityLifecycleCurrent: () => {if (!authorized) throw Error('fixture revoked');}}});
  try {
    const id = 'fixture-lifecycle';
    f.host.registerResponsibility({id, revision: 1, sourceTaskIds: [f.source.taskId], goalRefs: [], authority: 'explicit_instruction', scopeRefs: []}, f.context);
    const ref = {responsibilityId: id, responsibilityRevision: 1};
    assert.deepEqual(f.host.readResponsibilityLifecycle(ref, f.context), {state: 'unavailable', reason: 'lifecycle_not_recorded'});
    const foreign = f.app.runtime.submitTask({goal: 'Foreign instruction', conversationId: 'foreign-conversation', idempotencyKey: 'foreign-lifecycle'});
    const command = {commandId: 'activate-one', ...ref, expectedLifecycleRevision: null, action: 'activate', sourceTaskId: f.source.taskId,
      validUntil: new Date(Date.parse(f.deadline) - 119_000).toISOString()};
    await assert.rejects(f.host.recordResponsibilityLifecycle({...command, sourceTaskId: foreign.taskId}, f.context), {code: 'UNAUTHORIZED'});
    authorized = false;
    await assert.rejects(f.host.recordResponsibilityLifecycle(command, f.context), {code: 'UNAUTHORIZED'});
    authorized = true;
    assert.deepEqual(await f.host.recordResponsibilityLifecycle(command, f.context), {state: 'recorded', revision: 1});
    assert.equal(f.host.readResponsibilityLifecycle(ref, f.context).state, 'current');
    f.advanceClock(1001);
    assert.deepEqual(f.host.readResponsibilityLifecycle(ref, f.context), {state: 'unavailable', reason: 'responsibility_expired'});
  } finally {await f.close();}
});

test('responsibility revocation is atomic, checks the execution gate and does not repeat a command', async () => {
  let gate = true;
  const f = fixture({options: {verifyResponsibilityLifecycle: async () => true,
    assertResponsibilityLifecycleCurrent: () => {if (!gate) throw Error('fixture authorization revoked');}}});
  try {
    const id = 'fixture-revoke', ref = {responsibilityId: id, responsibilityRevision: 1};
    f.host.registerResponsibility({id, revision: 1, sourceTaskIds: [f.source.taskId], goalRefs: [], authority: 'explicit_instruction', scopeRefs: []}, f.context);
    const activation = {commandId: 'activate', ...ref, expectedLifecycleRevision: null, action: 'activate', sourceTaskId: f.source.taskId, validUntil: f.deadline};
    gate = false;
    await assert.rejects(f.host.recordResponsibilityLifecycle(activation, f.context), {code: 'RESULT_UNKNOWN'});
    assert.equal(f.host.readResponsibilityLifecycle(ref, f.context).reason, 'lifecycle_not_recorded');
    gate = true;
    assert.deepEqual(await f.host.recordResponsibilityLifecycle(activation, f.context), {state: 'recorded', revision: 1});
    assert.deepEqual(await f.host.recordResponsibilityLifecycle(activation, f.context), {state: 'recorded', revision: 1});
    const revoke = {commandId: 'revoke-one', ...ref, expectedLifecycleRevision: 1, action: 'revoke', sourceTaskId: f.source.taskId};
    const outcomes = await Promise.allSettled([f.host.recordResponsibilityLifecycle(revoke, f.context),
      f.host.recordResponsibilityLifecycle({...revoke, commandId: 'revoke-two'}, f.context)]);
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find(outcome => outcome.status === 'rejected').reason.code, 'REVISION_CONFLICT');
    assert.deepEqual(f.host.readResponsibilityLifecycle(ref, f.context), {state: 'unavailable', reason: 'responsibility_revoked'});
    f.host.registerResponsibility({id, revision: 2, sourceTaskIds: [f.source.taskId], goalRefs: [], authority: 'explicit_instruction', scopeRefs: []}, f.context);
    assert.equal(f.host.readResponsibilityLifecycle({...ref, responsibilityRevision: 2}, f.context).reason, 'responsibility_revision_changed');
  } finally {await f.close();}
});

test('real application consumes durable connector and original user quote, public context, original Scheduler and immutable wake', async () => {
  const f = fixture({wake: true});
  try {
    f.host.ingestUserInstruction({sourceTaskId: f.source.taskId, goalRefs: ['goal-public']}, f.context);
    await f.connectorRunner.start('fixture-source', f.context);
    assert.equal((await f.connectorRunner.tick('fixture-source', {...f.context, limit: 1})).state, 'changed');
    const durable = f.host.inspect().application.state;
    assert.equal(Object.values(durable.batches).length, 1);
    assert.equal((await f.connectorRunner.status('fixture-source')).checkpoint.cursor, 'source-cursor-1');
    assert.equal(Object.values(durable.entries).filter(entry => entry.event.entry === 'connector')[0].event.priority, 'unknown', 'no subscription filter drops an unknown/important event');
    let last;
    const completed = await f.run(async worker => {
      for (let i = 0; i < 7; i++) {
        last = await f.next();
        for (const proposal of last.proposals) {
          const receipt = await f.host.executeProposal(proposal, {signal: worker.signal, deadline: worker.deadline});
          assert.equal(receipt.state, 'confirmed'); assert.equal(receipt.evidenceRefs.length, 1);
        }
        if (Object.values(last.items).every(item => item.stage === 'done')) break;
      }
      assert.equal(Object.values(last.items).every(item => item.state === 'done'), true);
      assert.equal(f.app.runtime.listTasks({limit: 100}).items.filter(task => task.goal.startsWith('Host tool ')).length, 0, 'all operations execute on the original task');
      const context = f.host.readContext(Object.values(last.items)[0].context.contextRef);
      assert.equal(context.sourceTexts[0].text, f.source.goal);
      assert.equal(context.facts[0].summary, 'Public prior observation');
      assert.equal(context.goals[0].id, 'goal-public');
      assert.equal(context.knowledge[0].excerpt, 'Public source excerpt');
      assert.equal(JSON.stringify(context).includes('MUST STAY PRIVATE'), false);
      const schedule = f.app.runtime.listSchedules('fixture-conversation')[0];
      assert.equal(schedule.status, 'pending');
      assert.throws(() => f.host.ingestWake(schedule.scheduleId, f.context), {code: 'UNAUTHORIZED'});
      f.advanceClock(1001); f.app.runtime.dispatchDueSchedules('fixture-conversation');
      const wake = f.host.ingestWake(schedule.scheduleId, f.context);
      assert.equal(f.host.ingestWake(schedule.scheduleId, f.context), wake);
      assert.equal(f.host.inspect().application.state.entries[wake].event.entry, 'wake');
      assert.equal(f.host.binding.taskDeadline, f.deadline);
      return {resultSummary: 'The original Runtime worker verified its finite fixture frontier', evidenceRefs: f.app.runtime.readToolExecutions(worker.taskId).map(record => record.evidenceId)};
    });
    assert.equal(completed.state, 'succeeded', completed.error?.message);
    assert.equal(f.calls().modelCalls, 2, 'the independent entries share one Laya batch and one teacher batch; unqualified Laya does not bypass teacher');
    assert.equal(f.calls().actionCalls, 2);
  } finally {await f.close();}
});

test('trusted unattended/pause/return/cancel controls use actual original commands and revision, no deadline extension or replay', async () => {
  const f = fixture();
  try {
    f.host.ingestUserInstruction({sourceTaskId: f.source.taskId}, f.context);
    const first = await f.next();
    const command = (commandId, action) => ({commandId, action, expectedControlRevision: f.host.binding.controlRevision, sourceTaskId: f.source.taskId});
    const unattended = await f.host.control(command('leave', 'enter_unattended'), f.context);
    assert.equal(unattended.mode, 'unattended');
    const paused = await f.host.control(command('pause', 'pause'), f.context);
    assert.equal(paused.mode, 'paused'); assert.equal(paused.proposals.length, 0);
    assert.throws(() => f.app.createProactiveWorkflowHost({...f.options, taskDeadline: new Date(Date.parse(f.deadline) + 1).toISOString()}), {code: 'REVISION_CONFLICT'});
    const returnedCommand = command('return', 'return');
    const returned = await f.host.control(returnedCommand, f.context);
    assert.equal(returned.returnSummary.replayedNotifications, 0);
    assert.equal(returned.proposals.length, 0);
    assert.deepEqual(await f.host.control(returnedCommand, f.context), returned);
    assert.equal(f.calls().actionCalls, 0);
    assert.equal(f.host.binding.taskDeadline, f.deadline);
    await assert.rejects(f.host.executeProposal(first.proposals[0], f.context), {code: 'REVISION_CONFLICT'});
    const foreign = f.app.runtime.submitTask({goal: 'pause', conversationId: 'another-conversation', idempotencyKey: 'foreign-control'});
    await assert.rejects(f.host.control({...command('bad-control', 'pause'), sourceTaskId: foreign.taskId}, f.context), {code: 'UNAUTHORIZED'});
    const cancelled = await f.host.control(command('cancel', 'cancel'), f.context);
    assert.ok(['cancel_requested', 'cancelled'].includes(cancelled.mode));
    assert.equal(f.app.runtime.getTask(f.task.taskId).cancelRequested, true);
    await assert.rejects(f.next(), {code: 'CANCELLED'});
  } finally {await f.close();}
});

test('offline local device without an actual persistent host stays waiting_device; optional notification service is never invented', async () => {
  const f = fixture();
  try {
    f.host.ingestUserInstruction({sourceTaskId: f.source.taskId}, f.context); f.offline();
    const result = await f.next();
    assert.equal(Object.values(result.items)[0].state, 'waiting_device');
    assert.equal(result.proposals.length, 0); assert.equal(f.calls().modelCalls, 0);
    assert.equal(f.host.inspect().application.state.requests['request-1'].input.hostAvailability.cloudPersistentHost, false);
    assert.equal(f.host.inspect().application.state.requests['request-1'].input.availableCapabilities.some(cap => cap.kind === 'notify'), false);
    await assert.rejects(f.host.advance({...f.context, requestId: 'request-extended', deadline: new Date(Date.parse(f.deadline) + 1).toISOString()}), {code: 'INVALID_ARGUMENT'});
    assert.throws(() => f.host.registerResponsibility({id: 'inferred', revision: 1, sourceTaskIds: [], goalRefs: [], authority: 'inferred_interest', scopeRefs: ['write']}, f.context), {code: 'INVALID_ARGUMENT'});
  } finally {await f.close();}
});

test('original pending approval resumes only the never-started run, through the same Policy/ToolGateway operation', async () => {
  const f = fixture({approval: true});
  try {
    f.host.ingestUserInstruction({sourceTaskId: f.source.taskId}, f.context);
    let pending;
    const first = await f.run(async worker => {
      for (let i = 0; i < 4; i++) {
        const frontier = await f.next();
        for (const proposal of frontier.proposals) {
          const receipt = await f.host.executeProposal(proposal, {deadline: worker.deadline, signal: worker.signal});
          if (receipt.state === 'pending') {pending = proposal; return {resultSummary: 'Waiting for the original approval'};}
        }
      }
      throw Error('Expected original approval');
    });
    assert.equal(first.state, 'waiting_approval'); assert.equal(f.calls().actionCalls, 0);
    assert.equal(f.app.runtime.readToolExecutions(f.task.taskId).some(record => record.evidenceId === pending.operationId), false);
    const approval = f.app.runtime.getApproval(pending.operationId);
    const response = await f.app.runtime.send({kind: 'request', protocolVersion: '1.0.0', requestId: 'approve-original', operation: 'authorization.respond',
      deadline: f.deadline, payload: {approvalId: approval.approvalId, expectedRevision: approval.revision, decision: 'allow_once'}}, f.context.signal);
    assert.equal(response.outcome, 'ok');
    const resumed = await f.run(async worker => {
      const receipt = await f.host.executeProposal(pending, {deadline: worker.deadline, signal: worker.signal});
      assert.equal(receipt.state, 'confirmed');
      assert.equal((await f.host.executeProposal(pending, {deadline: worker.deadline, signal: worker.signal})).state, 'confirmed');
      return {resultSummary: 'Original approved operation confirmed', evidenceRefs: receipt.evidenceRefs};
    });
    assert.equal(resumed.state, 'succeeded'); assert.equal(f.calls().actionCalls, 1);
  } finally {await f.close();}
});

test('bound child reports and task.progress reach the original controller, stale/foreign child revisions are rejected', async () => {
  let consumed = 0;
  const f = fixture({action: 'delegate', options: {controller: {consume: async report => {consumed++; return {action: 'request_controller', receiptRef: 'fixture:controller:' + report.eventId};},
    readReceipt: async () => undefined}}});
  try {
    f.host.ingestUserInstruction({sourceTaskId: f.source.taskId}, f.context);
    const final = await f.run(async worker => {
      for (let i = 0; i < 4; i++) {
        const result = await f.next();
        for (const proposal of result.proposals) assert.equal((await f.host.executeProposal(proposal, {deadline: worker.deadline, signal: worker.signal})).state, 'confirmed');
      }
      const child = f.app.runtime.findTaskByIdempotencyKey('subagent-dispatch-' + f.task.taskId + '-child-one');
      assert.equal(child.state, 'succeeded'); assert.match(child.resultSummary, /fixture child model report/);
      await assert.rejects(f.host.ingestSubtaskFeedback({childTaskId: child.taskId, expectedRevision: child.revision - 1}, f.context), {code: 'REVISION_CONFLICT'});
      const report = await f.host.ingestSubtaskFeedback({childTaskId: child.taskId, expectedRevision: child.revision}, f.context);
      assert.equal(report.state, 'confirmed'); assert.equal(report.receipt.action, 'request_controller');
      assert.equal(report.report.parentTaskId, f.task.taskId); assert.equal(report.report.childRevision, child.revision);
      assert.ok(report.report.evidenceRefs.length);
      assert.deepEqual(await f.host.ingestSubtaskFeedback({childTaskId: child.taskId, expectedRevision: child.revision}, f.context), report);
      assert.equal(consumed, 1);
      assert.equal(f.app.runtime.readEvents().some(event => event.taskId === f.task.taskId && event.type === 'task.progress' && event.payload.stepId === report.report.eventId), true);
      const frontier = await f.next();
      assert.ok(Object.values(frontier.items).some(item => item.sourceId === 'runtime:subtasks'));
      return {resultSummary: 'Original controller consumed the bound child report'};
    });
    assert.equal(final.state, 'succeeded', final.error?.message);
  } finally {await f.close();}
});

test('one Runtime notification factory returns the same actual service and rejects a second configuration', async () => {
  const f = fixture();
  try {
    const options = {policy: {}, settingsScopes: ['notifications:settings'], verifyUserCommand: async () => false};
    const host = f.app.createNotificationHost(options);
    assert.equal(f.app.createNotificationHost({...options}), host);
    assert.throws(() => f.app.createNotificationHost({...options, settingsScopes: ['different']}), {code: 'REVISION_CONFLICT'});
    assert.throws(() => f.app.createProactiveWorkflowHost({...f.options, notificationHost: {...host}}), {code: 'UNAUTHORIZED'});
  } finally {await f.close();}
});

test('pause withdraws a never-started committed proposal with actual Runtime control evidence; resume retrieves only at the new revision', async () => {
  const f = fixture();
  try {
    f.host.ingestUserInstruction({sourceTaskId: f.source.taskId}, f.context);
    const final = await f.run(async worker => {
      const first = await f.next(), old = first.proposals[0];
      assert.equal(f.host.inspect().session.state.operations[old.operationId], undefined);
      const paused = await f.host.control({commandId: 'pause-unstarted', action: 'pause', expectedControlRevision: 0, sourceTaskId: f.source.taskId}, f.context);
      assert.equal(paused.mode, 'paused'); assert.equal(paused.proposals.length, 0);
      const withdrawal = f.host.inspect().application.state.receipts[old.operationId];
      assert.equal(withdrawal.state, 'failed'); assert.equal(withdrawal.result.kind, 'not_performed');
      assert.ok(withdrawal.evidenceRefs.every(ref => f.app.runtime.readEvents().some(event => event.eventId === ref && event.type === 'task.progress')));
      const resumed = await f.host.control({commandId: 'resume-unstarted', action: 'resume', expectedControlRevision: 1, sourceTaskId: f.source.taskId}, f.context);
      assert.equal(resumed.proposals.length, 1);
      const fresh = resumed.proposals[0]; assert.equal(fresh.stage, 'retrieve'); assert.equal(fresh.originControlRevision, 2);
      assert.notEqual(fresh.operationId, old.operationId);
      await assert.rejects(f.host.executeProposal(old, {deadline: worker.deadline, signal: worker.signal}), {code: 'UNAUTHORIZED'});
      assert.equal((await f.host.executeProposal(fresh, {deadline: worker.deadline, signal: worker.signal})).state, 'confirmed');
      assert.equal(f.app.runtime.readToolExecutions(worker.taskId).some(record => record.evidenceId === old.operationId), false);
      assert.equal(f.app.runtime.readToolExecutions(worker.taskId).filter(record => record.evidenceId === fresh.operationId).length, 1);
      return {resultSummary: 'Only the new control revision executed its retrieved operation'};
    });
    assert.equal(final.state, 'succeeded', final.error?.message);
  } finally {await f.close();}
});

test('concurrent execute/control never labels a durable original operation as never performed or invokes a second run', async () => {
  const f = fixture();
  try {
    f.host.ingestUserInstruction({sourceTaskId: f.source.taskId}, f.context);
    const final = await f.run(async worker => {
      const frontier = await f.next(), proposal = frontier.proposals[0];
      const outcomes = await Promise.allSettled([
        f.host.executeProposal(proposal, {deadline: worker.deadline, signal: worker.signal}),
        f.host.control({commandId: 'concurrent-pause', action: 'pause', expectedControlRevision: 0, sourceTaskId: f.source.taskId}, f.context),
      ]);
      assert.equal(outcomes.some(outcome => outcome.status === 'fulfilled'), true);
      const original = f.host.inspect().session.state.operations[proposal.operationId];
      const executions = f.app.runtime.readToolExecutions(worker.taskId).filter(record => record.evidenceId === proposal.operationId);
      assert.ok(executions.length <= 1);
      if (original || executions.length) assert.notEqual(f.host.inspect().application.state.receipts[proposal.operationId]?.result?.kind, 'not_performed');
      return {resultSummary: 'Original operation remained distinct from independent never-started control evidence'};
    });
    assert.equal(final.state, 'succeeded', final.error?.message);
  } finally {await f.close();}
});

test('unknown write remains on its original operation after control cancellation and original expiry; historical readback never invokes it', async () => {
  const f = fixture({unknownWrite: true});
  try {
    f.host.ingestUserInstruction({sourceTaskId: f.source.taskId}, f.context);
    let originalOperation;
    const task = await f.run(async worker => {
      for (let i = 0; i < 4; i++) {
        const result = await f.next();
        for (const proposal of result.proposals) {
          const receipt = await f.host.executeProposal(proposal, {deadline: worker.deadline, signal: worker.signal});
          if (receipt.state === 'unknown') {originalOperation = proposal; return {resultSummary: 'Original write is waiting for independent readback'};}
        }
      }
      throw Error('Unknown original write was not reached');
    });
    assert.equal(task.state, 'waiting_reconciliation'); assert.equal(f.calls().actionCalls, 1);
    await f.host.control({commandId: 'cancel-unknown', action: 'cancel', expectedControlRevision: f.host.binding.controlRevision, sourceTaskId: f.source.taskId}, f.context);
    f.advanceClock(121_000);
    const read = await f.host.reconcileOperation(originalOperation.operationId, {signal: f.context.signal, deadline: new Date(Date.parse(f.deadline) + 60_000).toISOString()});
    assert.equal(read.state, 'unknown'); assert.deepEqual(read.evidenceRefs, [originalOperation.operationId]);
    assert.equal(f.calls().actionCalls, 1); assert.equal(f.host.binding.taskDeadline, f.deadline);
  } finally {await f.close();}
});

test('application inbox, original quotes, committed image requests and return summary survive SQLite restart without another image advance', async () => {
  const f = fixture();
  f.host.ingestUserInstruction({sourceTaskId: f.source.taskId}, f.context);
  const leave = {commandId: 'persisted-leave', action: 'enter_unattended', expectedControlRevision: 0, sourceTaskId: f.source.taskId};
  await f.host.control(leave, f.context);
  const back = {commandId: 'persisted-return', action: 'return', expectedControlRevision: 1, sourceTaskId: f.source.taskId};
  const summary = await f.host.control(back, f.context), calls = f.calls().imageCalls;
  const before = f.host.inspect().application.state;
  await f.close();
  const app = createRuntimeApplication({path: f.path, profile: 'huawei_ict_agentarts', hostUserNamespace: 'proactive-application-fixture', proactiveWorkflows: true});
  try {
    const resumed = app.createProactiveWorkflowHost(f.options);
    assert.deepEqual(resumed.inspect().application.state.entries, before.entries);
    assert.deepEqual(await resumed.control(back, f.context), summary);
    assert.equal(f.calls().imageCalls, calls);
    assert.equal(resumed.binding.taskDeadline, f.deadline);
    assert.equal(summary.returnSummary.replayedNotifications, 0);
  } finally {app.close();}
});

function bindPublicFactHost(f) {
  const host = f.app.createCompetitionFactHost({memoryPath: f.path + '.memory.sqlite', memoryNamespace: 'current-public-context',
    graphNamespace: 'current-public-context-graph', consumerKey: 'current-public-context-consumer'});
  const source = {vaultId: 'fixture-vault', path: 'source.md', factId: 'current-public-fact', sourceRevision: 'a'.repeat(64),
    line: 1, summary: 'Actual SQLite public fact', observedAt: new Date().toISOString(), validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2027-01-01T00:00:00.000Z', expectedFactRevision: null};
  host.recordPublicSource(source, f.context);
  f.options.context.publicMemory = host.publicMemory;
  return {host, source};
}
async function retrieveOriginalContext(f, worker, goalRefs = ['goal-public']) {
  f.host.ingestUserInstruction({sourceTaskId: f.source.taskId, goalRefs}, f.context);
  const proposal = (await f.next()).proposals[0];
  assert.equal(proposal.stage, 'retrieve');
  const receipt = await f.host.executeProposal(proposal, {deadline: worker.deadline, signal: worker.signal});
  assert.equal(receipt.state, 'confirmed');
  return receipt.result.contextRef;
}

for (const change of ['correct', 'withdraw']) test('current public Fact ' + change + ' blocks a new decision before any model/run, while retaining its original context', async () => {
  const f = fixture(), facts = bindPublicFactHost(f);
  try {
    const completed = await f.run(async worker => {
      const contextRef = await retrieveOriginalContext(f, worker), proposal = (await f.next()).proposals[0];
      assert.equal(proposal.stage, 'laya');
      if (change === 'correct') facts.host.recordPublicSource({...facts.source, sourceRevision: 'b'.repeat(64),
        summary: 'Actual corrected public source', expectedFactRevision: 1}, f.context);
      else facts.host.withdrawPublicSource({vaultId: facts.source.vaultId, path: facts.source.path, factId: facts.source.factId,
        withdrawalId: 'current-context-withdraw', expectedFactRevision: 1, observedAt: new Date().toISOString()}, f.context);
      await assert.rejects(f.host.executeProposal(proposal, {deadline: worker.deadline, signal: worker.signal}), error =>
        error.code === 'REVISION_CONFLICT' && /needs_refresh.*retrieve_context/.test(error.message));
      assert.equal(f.host.inspect().application.state.contextValidity[contextRef].reason, 'fact_head_changed_or_withdrawn');
      assert.equal(f.host.readContext(contextRef).facts[0].ref.revision, 1, 'historical inspection does not claim current validity');
      assert.equal(f.calls().modelCalls, 0);
      assert.equal(f.host.inspect().session.state.operations[proposal.operationId], undefined);
      assert.equal(f.app.runtime.readToolExecutions(worker.taskId).some(record => record.evidenceId === proposal.operationId), false);
      return {resultSummary: 'Stale public reference explicitly requires a new retrieve; no decision was invoked'};
    });
    assert.equal(completed.state, 'succeeded', completed.error?.message);
  } finally {facts.host.close(); await f.close();}
});

test('current Knowledge source revision is read through the original query and blocks a not-started action', async () => {
  const f = fixture(); let revision = 'public-revision'; const queries = [];
  f.options.context.publicKnowledge.search = async request => {queries.push(request.query); return {hits: [
    {source: {vaultId: 'public-vault', path: 'source.md', line: 1, revision}, excerpt: 'Public source excerpt'}], truncated: false};};
  try {
    const completed = await f.run(async worker => {
      const contextRef = await retrieveOriginalContext(f, worker);
      for (let i = 0; i < 2; i++) for (const proposal of (await f.next()).proposals)
        assert.equal((await f.host.executeProposal(proposal, {deadline: worker.deadline, signal: worker.signal})).state, 'confirmed');
      const action = (await f.next()).proposals[0]; assert.equal(action.stage, 'action');
      revision = 'independently-read-new-revision';
      await assert.rejects(f.host.executeProposal(action, {deadline: worker.deadline, signal: worker.signal}), {code: 'REVISION_CONFLICT'});
      assert.equal(f.host.inspect().application.state.contextValidity[contextRef].reason, 'knowledge_source_revision_changed');
      assert.deepEqual([...new Set(queries)], [f.source.goal]);
      assert.equal(f.calls().actionCalls, 0);
      assert.equal(f.app.runtime.readToolExecutions(worker.taskId).some(record => record.evidenceId === action.operationId), false);
      return {resultSummary: 'Changed public Knowledge citation prevented a new action'};
    });
    assert.equal(completed.state, 'succeeded', completed.error?.message);
  } finally {await f.close();}
});

test('unrelated public changes preserve current context; changing the referenced Goal head invalidates it', async () => {
  const f = fixture(), facts = bindPublicFactHost(f);
  let hits = (await f.options.context.publicKnowledge.search(f.context)).hits;
  f.options.context.publicKnowledge.search = async () => ({hits, truncated: false});
  try {
    const completed = await f.run(async worker => {
      const contextRef = await retrieveOriginalContext(f, worker), store = f.options.context.goals;
      const goal = store.read().history.findLast(value => value.id === 'goal-public'), {revision, graphRevision, ...goalInput} = goal;
      store.append(store.read().revision, {...goalInput, id: 'unrelated-goal', summary: 'Unrelated current goal'});
      facts.host.recordPublicSource({...facts.source, factId: 'unrelated-fact', path: 'unrelated.md'}, f.context);
      hits = [...hits, {source: {vaultId: 'public-vault', path: 'unrelated.md', line: 1, revision: 'unrelated-revision'}, excerpt: 'Unrelated public hit'}];
      assert.equal((await f.host.readCurrentContext(contextRef, f.context)).goals[0].revision, revision);
      assert.equal((await f.host.executeProposal((await f.next()).proposals[0], {deadline: worker.deadline, signal: worker.signal})).state, 'confirmed');
      store.append(store.read().revision, {...goalInput, summary: 'Corrected original goal'});
      await assert.rejects(f.host.readCurrentContext(contextRef, f.context), {code: 'REVISION_CONFLICT'});
      assert.equal(f.host.inspect().application.state.contextValidity[contextRef].reason, 'goal_head_changed_or_unavailable');
      return {resultSummary: 'Only actual referenced source changes require a fresh context'};
    });
    assert.equal(completed.state, 'succeeded', completed.error?.message);
  } finally {facts.host.close(); await f.close();}
});

for (const change of ['withdrawn', 'expired']) test('current public Goal ' + change + ' cannot be consumed as an active context', async () => {
  const f = fixture();
  try {
    const completed = await f.run(async worker => {
      const store = f.options.context.goals, goal = store.read().history[0], {revision, graphRevision, ...input} = goal;
      store.append(store.read().revision, {...input, validUntil: new Date(Date.parse(f.deadline) - 115_000).toISOString()});
      const contextRef = await retrieveOriginalContext(f, worker);
      if (change === 'withdrawn') store.append(store.read().revision, {...input, state: 'withdrawn'});
      else f.advanceClock(5001);
      await assert.rejects(f.host.readCurrentContext(contextRef, f.context), {code: 'REVISION_CONFLICT'});
      assert.equal(f.host.inspect().application.state.contextValidity[contextRef].state, 'needs_refresh');
      assert.equal(f.calls().modelCalls, 0);
      return {resultSummary: 'A withdrawn or expired original goal requires a new context'};
    });
    assert.equal(completed.state, 'succeeded', completed.error?.message);
  } finally {await f.close();}
});

test('context recheck observes cancellation after an awaited public search and never invokes the model', async () => {
  const f = fixture(); let release, entered;
  const search = f.options.context.publicKnowledge.search;
  try {
    const completed = await f.run(async worker => {
      const contextRef = await retrieveOriginalContext(f, worker), controller = new AbortController();
      const started = new Promise(resolve => {entered = resolve;});
      f.options.context.publicKnowledge.search = async request => {entered(); await new Promise(resolve => {release = resolve;}); return search(request);};
      const pending = f.host.readCurrentContext(contextRef, {deadline: f.deadline, signal: controller.signal});
      await started; controller.abort(); release();
      await assert.rejects(pending, {code: 'CANCELLED'});
      assert.equal(f.host.inspect().application.state.contextValidity?.[contextRef], undefined, 'cancellation is not a source-change receipt');
      assert.equal(f.calls().modelCalls, 0);
      return {resultSummary: 'No model/action followed the cancelled public context read'};
    });
    assert.equal(completed.state, 'succeeded', completed.error?.message);
  } finally {release?.(); await f.close();}
});

test('a restored public source requires a real new retrieval and never revives the invalid old context reference', async () => {
  const f = fixture(); let allowed = true;
  const originalSearch = f.options.context.publicKnowledge.search;
  f.options.context.publicKnowledge.search = async request => {
    if (!allowed) throw new ProtocolError('SCOPE_DENIED', 'Explicit fixture public query permission is unavailable');
    return originalSearch(request);
  };
  try {
    const completed = await f.run(async worker => {
      const oldRef = await retrieveOriginalContext(f, worker); await f.next();
      allowed = false;
      await assert.rejects(f.host.readCurrentContext(oldRef, f.context), {code: 'REVISION_CONFLICT'});
      allowed = true;
      await assert.rejects(f.host.readCurrentContext(oldRef, f.context), {code: 'REVISION_CONFLICT'});
      await f.host.control({commandId: 'refresh-pause', action: 'pause', expectedControlRevision: 0, sourceTaskId: f.source.taskId}, f.context);
      const resumed = await f.host.control({commandId: 'refresh-resume', action: 'resume', expectedControlRevision: 1, sourceTaskId: f.source.taskId}, f.context);
      assert.equal(resumed.proposals[0].stage, 'retrieve');
      const readback = await f.host.executeProposal(resumed.proposals[0], {deadline: worker.deadline, signal: worker.signal});
      assert.equal(readback.state, 'confirmed');
      const newRef = readback.result.contextRef;
      assert.notEqual(newRef, oldRef, 'new original retrieve operation changes the reference even with identical public content');
      assert.deepEqual((await f.host.readCurrentContext(newRef, f.context)).knowledge, f.host.readContext(oldRef).knowledge);
      assert.equal(f.host.inspect().application.state.contextValidity[oldRef].state, 'needs_refresh');
      assert.equal(f.host.inspect().application.state.contextValidity[newRef], undefined);
      return {resultSummary: 'Only a new independently read context replaced the revoked citation'};
    });
    assert.equal(completed.state, 'succeeded', completed.error?.message);
  } finally {await f.close();}
});

test('a corrected public fact prevents a never-started approved action, while an already-unknown write is only read back', async () => {
  for (const unknownWrite of [false, true]) {
    const f = fixture({approval: !unknownWrite, unknownWrite}), facts = bindPublicFactHost(f);
    try {
      f.host.ingestUserInstruction({sourceTaskId: f.source.taskId, goalRefs: ['goal-public']}, f.context);
      let operation;
      const first = await f.run(async worker => {
        for (let i = 0; i < 4; i++) for (const proposal of (await f.next()).proposals) {
          const receipt = await f.host.executeProposal(proposal, {deadline: worker.deadline, signal: worker.signal});
          if (['pending', 'unknown'].includes(receipt.state)) {operation = proposal; return {resultSummary: 'Original operation awaits its bound continuation'};}
        }
        throw Error('Expected original action');
      });
      assert.equal(first.state, unknownWrite ? 'waiting_reconciliation' : 'waiting_approval');
      facts.host.recordPublicSource({...facts.source, sourceRevision: 'b'.repeat(64), summary: 'Actual corrected source', expectedFactRevision: 1}, f.context);
      if (unknownWrite) {
        assert.equal((await f.host.reconcileOperation(operation.operationId, f.context)).state, 'unknown');
        assert.equal(f.calls().actionCalls, 1);
      } else {
        const approval = f.app.runtime.getApproval(operation.operationId);
        const response = await f.app.runtime.send({kind: 'request', protocolVersion: '1.0.0', requestId: 'approve-stale-original', operation: 'authorization.respond',
          deadline: f.deadline, payload: {approvalId: approval.approvalId, expectedRevision: approval.revision, decision: 'allow_once'}}, f.context.signal);
        assert.equal(response.outcome, 'ok');
        const resumed = await f.run(async worker => {
          await assert.rejects(f.host.executeProposal(operation, {deadline: worker.deadline, signal: worker.signal}), {code: 'REVISION_CONFLICT'});
          assert.equal(f.app.runtime.readToolExecutions(worker.taskId).some(record => record.evidenceId === operation.operationId), false);
          return {resultSummary: 'A stale original context did not start its approved action'};
        });
        assert.equal(resumed.state, 'succeeded', resumed.error?.message); assert.equal(f.calls().actionCalls, 0);
      }
    } finally {facts.host.close(); await f.close();}
  }
});
