import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {FakeCoordinationStoreHost} from '@personal-agent/goals/store';
import {
  MeetingRescheduleCoordinator,
  createStoreExecutionPort,
  createPolicyGuardedExecutionPort,
  InMemoryMeetingDecisionReceiptStore,
  FileMeetingDecisionReceiptStore,
  CognitionError,
  LayaActionChoiceService,
} from '../dist/index.js';

const guardedEvent = extra => ({eventId: 'guarded-meeting', source: 'calendar:work',
  meetingFactId: 'meeting-sync-1', originalSummary: '周四下午 15:00 项目架构同步会',
  newSummary: '周四下午 17:00 项目架构同步会', sourceRevision: 'rev-guarded',
  detectedAt: '2026-09-29T11:00:00.000Z', deadline: new Date(Date.now() + 60_000).toISOString(),
  signal: new AbortController().signal, ...extra});

test('queued meeting events preserve submitted content and source revision while receipts await', async () => {
  const {store}=createMeetingFixture(),receipts=new InMemoryMeetingDecisionReceiptStore();
  let release,entered;
  const loading=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  const coordinator=new MeetingRescheduleCoordinator({store,namespace:'test-user-namespace',
    chooser:new LayaActionChoiceService(createMockLaya()),executionPort:createStoreExecutionPort(store),
    receiptStore:{async loadReceipt(query){entered();await loading;return receipts.loadReceipt(query);},
      saveReceipt:record=>receipts.saveReceipt(record)}});
  const event=guardedEvent(),submitted={...event};
  const pending=coordinator.processEvent(event);await started;
  event.newSummary='Changed after submission';event.sourceRevision='changed-revision';release();
  assert.equal((await pending).status,'applied');
  assert.equal(store.read().history.findLast(node=>node.id===submitted.meetingFactId).summary,submitted.newSummary);
  assert.equal(receipts.listReceipts()[0].sourceRevision,submitted.sourceRevision);
});

test('queued approved proposals retain query and execution options while keeping original port hooks live', async () => {
  const {store}=createMeetingFixture(),receipts=new InMemoryMeetingDecisionReceiptStore();
  let release,entered,blocking=false,executed,replacedCalls=0;
  const loading=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  const coordinator=new MeetingRescheduleCoordinator({store,namespace:'test-user-namespace',
    chooser:new LayaActionChoiceService(createMockLaya()),receiptStore:{async loadReceipt(query){
      if(blocking){entered();await loading;}return receipts.loadReceipt(query);
    },saveReceipt:record=>receipts.saveReceipt(record)}});
  const event=guardedEvent();assert.equal((await coordinator.processEvent(event)).status,'proposal');
  const executionPort={executeBatch:request=>createStoreExecutionPort(store).executeBatch(request)};
  const options={executionPort,deadline:event.deadline,signal:event.signal};
  const query={eventId:event.eventId,source:event.source,namespace:'test-user-namespace'};
  blocking=true;const pending=coordinator.applyApprovedProposal(query,options);await started;
  query.eventId='replaced-event';query.source='replaced-source';
  options.deadline=new Date(Date.now()-1000).toISOString();options.signal=new AbortController().signal;
  options.executionPort={executeBatch:async()=>{replacedCalls++;return {applied:false,snapshot:store.read()};}};
  executionPort.executeBatch=request=>{executed=request;return createStoreExecutionPort(store).executeBatch(request);};
  release();assert.equal((await pending).status,'applied');
  assert.equal(replacedCalls,0);assert.equal(executed.eventId,event.eventId);assert.equal(executed.source,event.source);
  assert.equal(executed.deadline,event.deadline);assert.equal(executed.signal,event.signal);
  assert.equal(store.read().history.findLast(node=>node.id===event.meetingFactId).summary,event.newSummary);
});

test('approved proposal cancellation and original deadline expiry during receipt load prevent execution', async () => {
  for (const mode of ['cancelled', 'expired']) {
    const {store} = createMeetingFixture(), receipts = new InMemoryMeetingDecisionReceiptStore();
    let release, entered, blocking = false, executions = 0, clock = Date.now();
    const loading = new Promise(resolve => {release = resolve;});
    const started = new Promise(resolve => {entered = resolve;});
    const coordinator = new MeetingRescheduleCoordinator({store, namespace: 'test-user-namespace',
      inference: createMockLaya(), now: () => clock, receiptStore: {async loadReceipt(query) {
        if (blocking) {entered(); await loading;}
        return receipts.loadReceipt(query);
      }, saveReceipt: record => receipts.saveReceipt(record)}});
    const event = guardedEvent(), proposal = await coordinator.processEvent(event);
    assert.equal(proposal.status, 'proposal');
    const before = store.read(), originalRecords = receipts.listReceipts(), controller = new AbortController();
    const options = {signal: controller.signal, deadline: event.deadline,
      executionPort: {executeBatch: request => {executions++; return createStoreExecutionPort(store).executeBatch(request);}}};
    blocking = true;
    const pending = coordinator.applyApprovedProposal({eventId: event.eventId, source: event.source}, options);
    await started;
    if (mode === 'cancelled') {controller.abort(); options.signal = new AbortController().signal;}
    else {clock = Date.parse(event.deadline); options.deadline = new Date(clock + 60_000).toISOString();}
    release();
    await assert.rejects(pending, error => error.code === 'INVALID_ARGUMENT', mode);
    assert.equal(executions, 0, mode);
    assert.deepEqual(store.read(), before, mode);
    assert.deepEqual(receipts.listReceipts(), originalRecords, mode);
  }
});

test('approved proposals reject invalid deadlines while completed receipts retain replay behavior', async () => {
  const {store} = createMeetingFixture(), receipts = new InMemoryMeetingDecisionReceiptStore();
  let blocking = false, entered, release, executions = 0;
  const loading = new Promise(resolve => {release = resolve;});
  const started = new Promise(resolve => {entered = resolve;});
  const coordinator = new MeetingRescheduleCoordinator({store, namespace: 'test-user-namespace',
    inference: createMockLaya(), receiptStore: {async loadReceipt(query) {
      if (blocking) {entered(); await loading;}
      return receipts.loadReceipt(query);
    }, saveReceipt: record => receipts.saveReceipt(record)}});
  const event = guardedEvent(), query = {eventId: event.eventId, source: event.source};
  assert.equal((await coordinator.processEvent(event)).status, 'proposal');
  const executionPort = {executeBatch: request => {executions++; return createStoreExecutionPort(store).executeBatch(request);}};
  await assert.rejects(coordinator.applyApprovedProposal(query, {executionPort, deadline: 'invalid-date'}),
    error => error.code === 'INVALID_ARGUMENT');
  assert.equal(executions, 0);
  const applied = await coordinator.applyApprovedProposal(query, {executionPort, deadline: event.deadline});
  assert.equal(applied.status, 'applied');
  const before = store.read(), controller = new AbortController();
  blocking = true;
  const pending = coordinator.applyApprovedProposal(query, {executionPort, signal: controller.signal, deadline: event.deadline});
  await started;
  controller.abort(); release();
  assert.deepEqual(await pending, applied);
  assert.equal(executions, 1);
  assert.deepEqual(store.read(), before);
});

test('meeting revision excludes unrelated stale dependencies from selected repair', async () => {
  const {store} = createMeetingFixture();
  const fields = {sourceRef: 'unrelated-source', sensitivity: 'private', state: 'active',
    validFrom: '2026-09-29T10:00:00.000Z', validUntil: '2026-09-30T00:00:00.000Z', reason: 'unrelated fixture'};
  store.append(store.read().revision, {...fields, id: 'unrelated-fact', kind: 'fact', summary: 'old unrelated value', dependencies: []});
  store.append(store.read().revision, {...fields, id: 'unrelated-plan', kind: 'plan', summary: 'Unrelated plan must remain unchanged',
    dependencies: [{id: 'unrelated-fact', revision: 1}]});
  store.append(store.read().revision, {...fields, id: 'unrelated-fact', kind: 'fact', summary: 'new unrelated value', dependencies: []});
  const before = store.read();
  // Explicit test double selects the legal adjust option; this proves scope, not real Laya inference.
  const coordinator = new MeetingRescheduleCoordinator({store, inference: createMockLaya()});
  const receipt = await coordinator.processEvent(guardedEvent());
  assert.equal(receipt.status, 'proposal');
  assert.ok(receipt.proposedModifications.length > 1);
  assert.equal(receipt.proposedModifications.some(node => node.id.startsWith('unrelated-')), false);
  assert.deepEqual(store.read(), before, 'Proposal preparation cannot mutate the graph');
});

test('meeting changes require the exact current source, original content and requested baseline', async () => {
  for (const extra of [{source: 'calendar:foreign'}, {originalSummary: 'old unrelated meeting'},
    {expectedBaseRevision: 'missing-baseline'}]) {
    const {store} = createMeetingFixture();
    const inference = createMockLaya();
    const coordinator = new MeetingRescheduleCoordinator({store, inference,
      executionPort: createStoreExecutionPort(store)});
    const before = store.read();
    const receipt = await coordinator.processEvent(guardedEvent(extra));
    assert.equal(receipt.status, 'conflict');
    assert.deepEqual(store.read(), before);
    assert.equal(inference.getCallCount(), 0);
  }
});

test('concurrent delivery of the same meeting event infers and commits once', async () => {
  const {store} = createMeetingFixture();
  const inference = createMockLaya();
  const coordinator = new MeetingRescheduleCoordinator({store, inference,
    executionPort: createStoreExecutionPort(store)});
  const event = guardedEvent();
  const receipts = await Promise.all([coordinator.processEvent(event), coordinator.processEvent(event)]);
  assert.deepEqual(receipts.map(receipt => receipt.status), ['applied', 'already_processed']);
  assert.equal(inference.getCallCount(), 1);
});

test('selected-but-ineligible meeting candidate cannot execute or cross coordinator namespace', async () => {
  const {store} = createMeetingFixture();
  const chooser = new LayaActionChoiceService(createMockLaya());
  const coordinator = new MeetingRescheduleCoordinator({store,
    chooser: {choose: async request => ({...await chooser.choose(request), eligibleForRuntime: false})},
    executionPort: createStoreExecutionPort(store)});
  const before = store.read();
  assert.equal((await coordinator.processEvent(guardedEvent())).status, 'requires_review');
  assert.deepEqual(store.read(), before);
  await assert.rejects(coordinator.applyApprovedProposal({eventId: 'guarded-meeting',
    source: 'calendar:work', namespace: 'foreign'}), error => error.code === 'INVALID_ARGUMENT');
});

test('transient inference receipts recover after coordinator restart, without replaying execution or leaking errors', async t => {
  const root = fileURLToPath(new URL('../../../.cache/meeting-retry-test/', import.meta.url));
  mkdirSync(root, {recursive: true});
  const storageDir = mkdtempSync(path.join(root, 'receipt-'));
  t.after(() => rmSync(storageDir, {recursive: true, force: true}));
  for (const failure of ['thrown', 'unavailable', 'invalid_response']) {
    const {store} = createMeetingFixture();
    const receipts = new FileMeetingDecisionReceiptStore({storageDir});
    const event = guardedEvent({eventId: `recover-${failure}`});
    const choice = new LayaActionChoiceService(createMockLaya());
    const first = new MeetingRescheduleCoordinator({store, receiptStore: receipts,
      executionPort: createStoreExecutionPort(store), chooser: {choose: async request => {
        if (failure === 'thrown') throw Error('private mail contents and credential path');
        return {...await choice.choose(request), state: 'abstain', eligibleForRuntime: false,
          selected: undefined, reason: failure};
      }}});
    const before = store.read();
    assert.equal((await first.processEvent(event)).status, 'requires_review');
    assert.deepEqual(store.read(), before);
    assert.equal(JSON.stringify(await first.getReceipt(event.eventId, event.source)).includes('private mail'), false);
    const inference = createMockLaya();
    const restarted = new MeetingRescheduleCoordinator({store,
      receiptStore: new FileMeetingDecisionReceiptStore({storageDir}),
      inference, executionPort: createStoreExecutionPort(store)});
    assert.equal((await restarted.processEvent({...event, deadline: new Date(Date.now() + 60_000).toISOString()})).status, 'applied');
    const applied = store.read();
    assert.equal((await restarted.processEvent(event)).status, 'already_processed');
    assert.deepEqual(store.read(), applied);
    assert.equal(inference.getCallCount(), 1);
  }
});

test('unknown execution and unmarked legacy inference receipts cannot opt into automatic replay', async () => {
  for (const kind of ['execution_unknown', 'legacy_fallback']) {
    const {store} = createMeetingFixture();
    const receipts = new InMemoryMeetingDecisionReceiptStore();
    const event = guardedEvent({eventId: kind});
    const first = new MeetingRescheduleCoordinator({store, receiptStore: receipts,
      inference: kind === 'legacy_fallback' ? {infer: () => {throw Error('unavailable');}} : createMockLaya(),
      ...(kind === 'execution_unknown' ? {executionPort: {executeBatch: async () => ({applied: false,
        snapshot: store.read(), error: 'unknown execution outcome'})}} : {})});
    const original = await first.processEvent(event);
    assert.equal(original.status, 'requires_review');
    if (kind === 'legacy_fallback') {
      const saved = receipts.loadReceipt(event.eventId);
      const {retryableInference, ...legacy} = saved.receipt;
      receipts.saveReceipt({...saved, receipt: legacy});
    } else assert.equal(original.retryableInference, undefined);
    const before = store.read();
    let executions = 0;
    const inference = createMockLaya();
    const restarted = new MeetingRescheduleCoordinator({store, receiptStore: receipts, inference,
      executionPort: {executeBatch: () => {executions++; throw Error('must not execute');}}});
    assert.equal((await restarted.processEvent(event)).status, 'requires_review');
    assert.equal(inference.getCallCount(), 0);
    assert.equal(executions, 0);
    assert.deepEqual(store.read(), before);
  }
});

test('transient retry rechecks source baseline; uncertain decisions and proposals remain stable', async () => {
  const {store} = createMeetingFixture();
  const receipts = new InMemoryMeetingDecisionReceiptStore();
  const event = guardedEvent({eventId: 'retry-stale-source'});
  const first = new MeetingRescheduleCoordinator({store, receiptStore: receipts,
    chooser: {choose: () => {throw Error('model stopped');}}});
  await first.processEvent(event);
  const current = store.read().history.findLast(node => node.id === event.meetingFactId);
  const {revision, graphRevision, ...input} = current;
  store.append(store.read().revision, {...input, summary: 'newer calendar source'});
  const inference = createMockLaya();
  const restarted = new MeetingRescheduleCoordinator({store, receiptStore: receipts,
    inference, executionPort: createStoreExecutionPort(store)});
  assert.equal((await restarted.processEvent(event)).status, 'conflict');
  assert.equal(inference.getCallCount(), 0);
  for (const confidence of [0.5, 0.95]) {
    const {store: stableStore} = createMeetingFixture();
    const stableInference = createMockLaya(0, confidence);
    const stable = new MeetingRescheduleCoordinator({store: stableStore, inference: stableInference});
    const receipt = await stable.processEvent(event);
    assert.equal(receipt.status, confidence === 0.5 ? 'requires_review' : 'proposal');
    assert.deepEqual(await stable.processEvent(event), receipt);
    assert.equal(stableInference.getCallCount(), 1);
  }
});

function createMeetingFixture() {
  const storeHost = new FakeCoordinationStoreHost();
  const store = storeHost.provision('test-user-namespace');

  // Seed graph with meeting, attendance goal, departure decision, and reminder plan
  const t0 = '2026-09-29T10:00:00.000Z';
  const tEnd = '2026-09-30T00:00:00.000Z';

  store.append(0, {
    id: 'meeting-sync-1',
    kind: 'fact',
    summary: '周四下午 15:00 项目架构同步会',
    sourceRef: 'calendar:work',
    sensitivity: 'private',
    state: 'active',
    validFrom: t0,
    validUntil: tEnd,
    reason: '会议邀请接入',
    dependencies: [],
  });

  store.append(1, {
    id: 'goal-attend-sync',
    kind: 'goal',
    summary: '准时参加项目架构同步会',
    sourceRef: 'user:goal',
    sensitivity: 'private',
    state: 'active',
    validFrom: t0,
    validUntil: tEnd,
    reason: '重点关注架构依赖',
    dependencies: [{id: 'meeting-sync-1', revision: 1}],
  });

  store.append(2, {
    id: 'decide-depart-sync',
    kind: 'decision',
    summary: '14:30 从工位出发前往 302 会议室',
    sourceRef: 'agent:schedule',
    sensitivity: 'private',
    state: 'active',
    validFrom: t0,
    validUntil: tEnd,
    reason: '预留 30 分钟准备与通勤',
    dependencies: [{id: 'goal-attend-sync', revision: 1}],
  });

  store.append(3, {
    id: 'plan-remind-sync',
    kind: 'plan',
    summary: '14:15 弹出准备材料与出发提醒',
    sourceRef: 'agent:schedule',
    sensitivity: 'private',
    state: 'active',
    validFrom: t0,
    validUntil: tEnd,
    reason: '提前 15 分钟准备笔记本与投屏',
    dependencies: [{id: 'decide-depart-sync', revision: 1}],
  });

  // Add an unrelated branch node with independent dependencies to verify preservation
  store.append(4, {
    id: 'plan-unrelated-work',
    kind: 'plan',
    summary: '16:00 独立代码评审',
    sourceRef: 'agent:schedule',
    sensitivity: 'private',
    state: 'active',
    validFrom: t0,
    validUntil: tEnd,
    reason: '独立任务',
    dependencies: [],
  });

  return {store};
}

/** Mock inference port producing valid Laya choices according to LayaActionChoiceService contract. */
function createMockLaya(chosenIndex = 0, confidence = 0.95) {
  let callCount = 0;
  let lastPayload = null;
  const inference = {
    getCallCount: () => callCount,
    getLastPayload: () => lastPayload,
    infer: async (payload, signal) => {
      if (signal.aborted) throw new Error('cancelled');
      callCount++;
      lastPayload = payload;
      const questionKey = Object.keys(payload.questions)[0];
      const criteriaKeys = Object.keys(payload.questions[questionKey].criteria);
      const chosenKey = criteriaKeys[chosenIndex] ?? 'candidate_0';
      const remainingProb = (1.0 - confidence) / (criteriaKeys.length - 1);
      const probabilities = {};
      for (const k of criteriaKeys) {
        probabilities[k] = k === chosenKey ? confidence : remainingProb;
      }
      const answer = {
        choice: chosenKey,
        probabilities,
        answer_confidence: confidence,
        confidence: 0.92,
      };
      return {
        answers: {
          [questionKey]: answer,
        },
      };
    },
  };
  return inference;
}

test('MeetingRescheduleCoordinator: with executionPort, atomically applies full batch and preserves unrelated branches', async () => {
  const {store} = createMeetingFixture();
  const mockLaya = createMockLaya(0, 0.95);
  const executionPort = createStoreExecutionPort(store);
  const receiptStore = new InMemoryMeetingDecisionReceiptStore();

  const coordinator = new MeetingRescheduleCoordinator({
    store,
    inference: mockLaya,
    executionPort,
    receiptStore,
  });

  const event = {
    eventId: 'evt-reschedule-101',
    source: 'calendar:work',
    meetingFactId: 'meeting-sync-1',
    originalSummary: '周四下午 15:00 项目架构同步会',
    newSummary: '周四下午 17:00 项目架构同步会 (推迟2小时)',
    sourceRevision: 'rev-2',
    detectedAt: '2026-09-29T11:00:00.000Z',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  };

  const receipt = await coordinator.processEvent(event);
  assert.equal(receipt.status, 'applied');
  assert.equal(receipt.selectedCandidateId, 'cand-adjust-schedule');
  assert.equal(receipt.actionId, 'adjust_schedule');
  assert.equal(receipt.graphRevisionBefore, 5);
  // Initial 5 + 1 fact + 3 dependent nodes (goal, decision, plan) = 9
  assert.equal(receipt.graphRevisionAfter, 9);
  assert.equal(mockLaya.getCallCount(), 1);

  // Read back and verify final graph nodes and dependencies
  const finalGraph = store.read();
  const currentMeeting = finalGraph.history.findLast(n => n.id === 'meeting-sync-1');
  const currentGoal = finalGraph.history.findLast(n => n.id === 'goal-attend-sync');
  const currentDecision = finalGraph.history.findLast(n => n.id === 'decide-depart-sync');
  const currentPlan = finalGraph.history.findLast(n => n.id === 'plan-remind-sync');
  const unrelatedPlan = finalGraph.history.findLast(n => n.id === 'plan-unrelated-work');

  assert.equal(currentMeeting.revision, 2);
  assert.match(currentMeeting.summary, /17:00/);

  assert.equal(currentGoal.revision, 2);
  assert.deepEqual(currentGoal.dependencies, [{id: 'meeting-sync-1', revision: 2}]);

  assert.equal(currentDecision.revision, 2);
  assert.deepEqual(currentDecision.dependencies, [{id: 'goal-attend-sync', revision: 2}]);

  assert.equal(currentPlan.revision, 2);
  assert.deepEqual(currentPlan.dependencies, [{id: 'decide-depart-sync', revision: 2}]);

  // Unrelated plan is completely unaffected
  assert.equal(unrelatedPlan.revision, 1);

  // Restart coordinator with new instance sharing the durable receipt store -> deduplicated without model re-run
  const newCoordinator = new MeetingRescheduleCoordinator({
    store,
    inference: mockLaya,
    executionPort,
    receiptStore,
  });
  const replayReceipt = await newCoordinator.processEvent(event);
  assert.equal(replayReceipt.status, 'already_processed');
  assert.equal(mockLaya.getCallCount(), 1); // No new model call
});

test('MeetingRescheduleCoordinator: without executionPort, emits proposal without mutating store', async () => {
  const {store} = createMeetingFixture();
  const mockLaya = createMockLaya(0, 0.95);

  const coordinator = new MeetingRescheduleCoordinator({
    store,
    inference: mockLaya,
    // NO executionPort passed!
  });

  const event = {
    eventId: 'evt-reschedule-proposal-1',
    source: 'calendar:work',
    meetingFactId: 'meeting-sync-1',
    originalSummary: '周四下午 15:00 项目架构同步会',
    newSummary: '周四下午 17:00 项目架构同步会 (推迟2小时)',
    sourceRevision: 'rev-2',
    detectedAt: '2026-09-29T11:00:00.000Z',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  };

  const receipt = await coordinator.processEvent(event);
  assert.equal(receipt.status, 'proposal');
  assert.equal(receipt.graphRevisionAfter, 5); // Store NOT mutated!
  assert.equal(store.read().revision, 5); // Graph untouched
  assert.ok(receipt.proposedModifications && receipt.proposedModifications.length > 0);
});

test('MeetingRescheduleCoordinator: detects conflict on same eventId with mutated input', async () => {
  const {store} = createMeetingFixture();
  const mockLaya = createMockLaya(0, 0.95);
  const receiptStore = new InMemoryMeetingDecisionReceiptStore();

  const coordinator = new MeetingRescheduleCoordinator({
    store,
    inference: mockLaya,
    receiptStore,
  });

  const event1 = {
    eventId: 'evt-shared-id-1',
    source: 'calendar:work',
    meetingFactId: 'meeting-sync-1',
    originalSummary: '周四下午 15:00 项目架构同步会',
    newSummary: '周四下午 17:00 项目架构同步会',
    sourceRevision: 'rev-1',
    detectedAt: '2026-09-29T11:00:00.000Z',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  };
  await coordinator.processEvent(event1);

  // Same eventId with conflicting newSummary
  const event2 = {
    ...event1,
    newSummary: '周四下午 18:00 项目架构同步会 (冲突改动)',
  };
  const conflictReceipt = await coordinator.processEvent(event2);
  assert.equal(conflictReceipt.status, 'conflict');
  assert.match(conflictReceipt.reason, /冲突/);
});

test('MeetingRescheduleCoordinator: high-risk escalate_conflict holds for review without mutating plan', async () => {
  const {store} = createMeetingFixture();
  const mockLaya = createMockLaya(2, 0.90);
  const coordinator = new MeetingRescheduleCoordinator({
    store,
    inference: mockLaya,
  });

  const event = {
    eventId: 'evt-reschedule-conflict-102',
    source: 'calendar:work',
    meetingFactId: 'meeting-sync-1',
    originalSummary: '周四下午 15:00 项目架构同步会',
    newSummary: '周四下午 20:00 项目架构同步会 (严重冲突)',
    sourceRevision: 'rev-3',
    detectedAt: '2026-09-29T11:00:00.000Z',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  };

  const receipt = await coordinator.processEvent(event);
  assert.equal(receipt.status, 'requires_review');
  assert.equal(receipt.selectedCandidateId, 'cand-escalate-conflict');
  assert.equal(store.read().revision, 5); // Graph untouched
});

test('MeetingRescheduleCoordinator: defer_and_verify defers without mutating store', async () => {
  const {store} = createMeetingFixture();
  const mockLaya = createMockLaya(1, 0.92);
  const coordinator = new MeetingRescheduleCoordinator({
    store,
    inference: mockLaya,
  });

  const event = {
    eventId: 'evt-reschedule-defer-103',
    source: 'calendar:work',
    meetingFactId: 'meeting-sync-1',
    originalSummary: '周四下午 15:00 项目架构同步会',
    newSummary: '周四下午 16:30 项目架构同步会',
    sourceRevision: 'rev-4',
    detectedAt: '2026-09-29T11:00:00.000Z',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  };

  const receipt = await coordinator.processEvent(event);
  assert.equal(receipt.status, 'deferred');
  assert.equal(store.read().revision, 5);
});

const syntheticReceiptRecord = (namespace, source, eventId = 'synthetic-event') => ({
  namespace, source, eventId, sourceRevision: 'rev-1', inputDigest: 'synthetic-digest', status: 'proposal',
  receipt: {eventId, source, sourceRevision: 'rev-1', meetingFactId: 'meeting-1',
    selectedCandidateId: 'cand-adjust-schedule', actionId: 'adjust_schedule', status: 'proposal',
    confidence: 0.9, reason: 'synthetic', graphRevisionBefore: 1, graphRevisionAfter: 1,
    evaluatedAt: '2026-09-29T10:00:00.000Z'}, updatedAt: '2026-09-29T10:00:00.000Z',
});

test('meeting receipt stores keep delimiter-containing identities distinct', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'receipt-delimiter-test-'));
  try {
    for (const store of [new InMemoryMeetingDecisionReceiptStore(),
      new FileMeetingDecisionReceiptStore({storageDir: tmpDir})]) {
      const first = syntheticReceiptRecord('synthetic::group', 'calendar');
      const second = syntheticReceiptRecord('synthetic', 'group::calendar');
      store.saveReceipt(first);
      assert.equal(store.loadReceipt(second), undefined);
      store.saveReceipt(second);
      assert.deepEqual(store.loadReceipt(first), first);
      assert.deepEqual(store.loadReceipt(second), second);
      assert.equal(store.listReceipts().length, 2);
      const third = syntheticReceiptRecord('event-boundary', 'calendar::group', 'event-2');
      const fourth = syntheticReceiptRecord('event-boundary', 'calendar', 'group::event-2');
      store.saveReceipt(third);
      assert.equal(store.loadReceipt(fourth), undefined);
      store.saveReceipt(fourth);
      assert.deepEqual(store.loadReceipt(third), third);
      assert.deepEqual(store.loadReceipt(fourth), fourth);
      assert.equal(store.listReceipts().length, 4);
    }
    const restarted = new FileMeetingDecisionReceiptStore({storageDir: tmpDir});
    assert.equal(restarted.listReceipts().length, 4);
  } finally { rmSync(tmpDir, {recursive: true, force: true}); }
});

test('legacy meeting files require exact identity and remain intact when upgraded', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'receipt-legacy-test-'));
  try {
    const original = syntheticReceiptRecord('synthetic::group', 'calendar');
    const collision = syntheticReceiptRecord('synthetic', 'group::calendar');
    const legacyKey = createHash('sha256').update(`${original.namespace}::${original.source}::${original.eventId}`).digest('hex');
    const legacyPath = path.join(tmpDir, `receipt-${legacyKey}.json`);
    const legacyBytes = JSON.stringify(original);
    writeFileSync(legacyPath, legacyBytes, 'utf8');
    const store = new FileMeetingDecisionReceiptStore({storageDir: tmpDir});
    assert.deepEqual(store.loadReceipt(original), original);
    assert.equal(store.loadReceipt(collision), undefined);
    store.saveReceipt(collision);
    assert.deepEqual(store.loadReceipt(original), original);
    const updated = {...original, status: 'applied', receipt: {...original.receipt, status: 'applied'}};
    store.saveReceipt(updated);
    const restarted = new FileMeetingDecisionReceiptStore({storageDir: tmpDir});
    assert.deepEqual(restarted.loadReceipt(original), updated);
    assert.deepEqual(restarted.loadReceipt(collision), collision);
    assert.deepEqual(restarted.loadReceipt({eventId: original.eventId, namespace: original.namespace}), updated);
    assert.deepEqual(restarted.listReceipts({namespace: original.namespace}), [updated]);
    assert.deepEqual(restarted.listReceipts({namespace: original.namespace, status: 'proposal'}), []);
    assert.equal(restarted.listReceipts().length, 2);
    assert.equal(readFileSync(legacyPath, 'utf8'), legacyBytes);
  } finally { rmSync(tmpDir, {recursive: true, force: true}); }
});

test('FileMeetingDecisionReceiptStore: persists atomically and isolates by namespace, source, eventId', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'receipt-store-test-'));
  try {
    const store1 = new FileMeetingDecisionReceiptStore({storageDir: tmpDir});
    const record1 = {
      eventId: 'evt-file-1',
      namespace: 'user-ns-a',
      source: 'calendar:work',
      sourceRevision: 'rev-1',
      inputDigest: 'digest-1',
      status: 'applied',
      receipt: {
        eventId: 'evt-file-1',
        source: 'calendar:work',
        sourceRevision: 'rev-1',
        meetingFactId: 'meeting-1',
        selectedCandidateId: 'cand-adjust-schedule',
        actionId: 'adjust_schedule',
        status: 'applied',
        confidence: 0.9,
        reason: 'test',
        graphRevisionBefore: 1,
        graphRevisionAfter: 2,
        evaluatedAt: '2026-09-29T10:00:00.000Z',
      },
      updatedAt: '2026-09-29T10:00:00.000Z',
    };
    store1.saveReceipt(record1);

    // Record from different source with same eventId
    const record2 = {
      ...record1,
      source: 'calendar:personal',
      status: 'proposal',
      receipt: {...record1.receipt, source: 'calendar:personal', status: 'proposal'},
    };
    store1.saveReceipt(record2);

    // Read back in a brand new store instance on same dir
    const store2 = new FileMeetingDecisionReceiptStore({storageDir: tmpDir});
    const loaded1 = store2.loadReceipt({namespace: 'user-ns-a', source: 'calendar:work', eventId: 'evt-file-1'});
    assert.ok(loaded1);
    assert.equal(loaded1.status, 'applied');
    assert.equal(loaded1.source, 'calendar:work');

    const loaded2 = store2.loadReceipt({namespace: 'user-ns-a', source: 'calendar:personal', eventId: 'evt-file-1'});
    assert.ok(loaded2);
    assert.equal(loaded2.status, 'proposal');
    assert.equal(loaded2.source, 'calendar:personal');

    // Query non-existent
    assert.equal(store2.loadReceipt({namespace: 'user-ns-a', source: 'calendar:work', eventId: 'non-existent'}), undefined);
  } finally {
    rmSync(tmpDir, {recursive: true, force: true});
  }
});

test('MeetingRescheduleCoordinator: recovers from prior crash window after graph commit without duplicate apply', async () => {
  const {store} = createMeetingFixture();
  const mockLaya = createMockLaya(0, 0.95);

  // Simulate crash window: Graph was already updated with [eventId: evt-crash-recovery-1]
  const currentSnapshot = store.read();
  store.append(currentSnapshot.revision, {
    id: 'meeting-sync-1',
    kind: 'fact',
    summary: '周四下午 17:00 项目架构同步会 (已提交未写收据)',
    sourceRef: 'calendar:work',
    sensitivity: 'private',
    state: 'active',
    validFrom: '2026-09-29T10:00:00.000Z',
    validUntil: '2026-09-30T00:00:00.000Z',
    reason: '外部会议改期通知 [eventId: evt-crash-recovery-1] [sourceRevision: rev-crash-1]',
    dependencies: [],
  });

  const revAfterPreCommit = store.read().revision; // 6
  const receiptStore = new InMemoryMeetingDecisionReceiptStore(); // No receipt in store!

  const coordinator = new MeetingRescheduleCoordinator({
    store,
    inference: mockLaya,
    receiptStore,
  });

  const event = {
    eventId: 'evt-crash-recovery-1',
    source: 'calendar:work',
    meetingFactId: 'meeting-sync-1',
    originalSummary: '周四下午 15:00 项目架构同步会',
    newSummary: '周四下午 17:00 项目架构同步会 (已提交未写收据)',
    sourceRevision: 'rev-crash-1',
    detectedAt: '2026-09-29T11:00:00.000Z',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  };

  const receipt = await coordinator.processEvent(event);
  assert.equal(receipt.status, 'already_processed');
  assert.match(receipt.reason, /崩溃恢复去重保护/);
  assert.equal(store.read().revision, revAfterPreCommit); // Did NOT append another duplicate node!

  // Receipt was recovered into receiptStore
  const saved = await receiptStore.loadReceipt({namespace: 'default', source: 'calendar:work', eventId: 'evt-crash-recovery-1'});
  assert.ok(saved);
  assert.equal(saved.status, 'already_processed');
});

test('historical meeting recovery matches deterministic content and retains differently sourced Plans', async () => {
  const {store} = createMeetingFixture();
  const event = guardedEvent({eventId: 'event-shared', sourceRevision: 'rev-shared'});
  const beforeRevision = store.read().revision;
  const original = new MeetingRescheduleCoordinator({store, inference: createMockLaya(),
    executionPort: createStoreExecutionPort(store), receiptStore: {loadReceipt: () => undefined,
      saveReceipt() {throw Error('Synthetic receipt failure after actual commit');}}});
  await assert.rejects(original.processEvent(event), /Synthetic receipt failure/);
  const originalHistory = store.read();
  const expectedRefs = originalHistory.history.filter(node => node.graphRevision > beforeRevision)
    .map(node => ({id: node.id, revision: node.revision}));
  assert.equal(expectedRefs.length, 4, 'generated Fact, Goal, Decision and differently sourced Plan');
  store.append(originalHistory.revision, {id: 'meeting-other', kind: 'fact', sourceRef: 'calendar:other',
    summary: 'Independent meeting', sensitivity: 'private', state: 'active',
    validFrom: '2026-09-29T10:00:00.000Z', validUntil: '2026-09-30T00:00:00.000Z', dependencies: [],
    reason: 'Other event [eventId: event-shared] [sourceRevision: rev-shared]'});
  let models = 0;
  const coordinator = new MeetingRescheduleCoordinator({store, receiptStore: new InMemoryMeetingDecisionReceiptStore(),
    chooser: {async choose() {models++; throw Error('Recovery must not infer');}}});
  const before = store.read(), receipt = await coordinator.processEvent(event);
  assert.equal(receipt.status, 'already_processed');
  assert.deepEqual(receipt.appliedNodeRevisions, expectedRefs);
  assert.equal(receipt.graphRevisionBefore, beforeRevision);
  assert.equal(receipt.graphRevisionAfter, originalHistory.revision);
  assert.match(receipt.reason, /不代表审批或执行已验证/);
  assert.equal(models, 0);
  assert.deepEqual(store.read(), before, 'recovery must not write or replay');
  assert.deepEqual((await coordinator.getReceipt(event.eventId, event.source)).appliedNodeRevisions, expectedRefs);
});

test('unmatched historical repair content recovers only the exact Fact without claiming other revisions', async () => {
  const {store} = createMeetingFixture(), event = guardedEvent({eventId: 'event-shared', sourceRevision: 'rev-shared'});
  const previous = store.read().history.findLast(node => node.id === event.meetingFactId);
  const {revision: _revision, graphRevision: _graphRevision, ...input} = previous;
  store.append(store.read().revision, {...input, summary: event.newSummary,
    reason: 'Fact update [eventId: event-shared] [sourceRevision: rev-shared]'});
  const factRevision = store.read().revision;
  store.append(factRevision, {id: 'meeting-other', kind: 'fact', sourceRef: 'calendar:other', summary: 'Independent',
    sensitivity: 'public', state: 'active', validFrom: input.validFrom, validUntil: input.validUntil,
    reason: 'Other event [eventId: event-shared] [sourceRevision: rev-shared]', dependencies: []});
  const before = store.read();
  const coordinator = new MeetingRescheduleCoordinator({store,
    chooser: {async choose() {throw Error('Recovery must not infer');}}});
  const receipt = await coordinator.processEvent(event);
  assert.equal(receipt.status, 'already_processed');
  assert.deepEqual(receipt.appliedNodeRevisions, [{id: event.meetingFactId, revision: previous.revision + 1}]);
  assert.equal(receipt.graphRevisionBefore, factRevision - 1);
  assert.equal(receipt.graphRevisionAfter, factRevision);
  assert.match(receipt.reason, /其它修订未核验/);
  assert.deepEqual(store.read(), before);
});

test('MeetingRescheduleCoordinator: proposal can be subsequently executed via applyApprovedProposal', async () => {
  const {store} = createMeetingFixture();
  const mockLaya = createMockLaya(0, 0.95);
  const receiptStore = new InMemoryMeetingDecisionReceiptStore();

  // Run without executionPort -> generates proposal
  const coordinator = new MeetingRescheduleCoordinator({
    store,
    inference: mockLaya,
    receiptStore,
  });

  const event = {
    eventId: 'evt-proposal-approve-1',
    source: 'calendar:work',
    meetingFactId: 'meeting-sync-1',
    originalSummary: '周四下午 15:00 项目架构同步会',
    newSummary: '周四下午 16:00 项目架构同步会',
    sourceRevision: 'rev-prop-1',
    detectedAt: '2026-09-29T11:00:00.000Z',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  };

  const proposalReceipt = await coordinator.processEvent(event);
  assert.equal(proposalReceipt.status, 'proposal');
  assert.equal(store.read().revision, 5); // Untouched

  // Now user / runtime approves the proposal -> call applyApprovedProposal
  const executionPort = createStoreExecutionPort(store);
  const appliedReceipt = await coordinator.applyApprovedProposal(
    {eventId: 'evt-proposal-approve-1', source: 'calendar:work'},
    {executionPort}
  );

  assert.equal(appliedReceipt.status, 'applied');
  assert.match(appliedReceipt.reason, /方案获批/);
  assert.equal(store.read().revision, 9); // Atomically applied all 4 nodes!

  // Verify updated in receipt store
  const saved = await receiptStore.loadReceipt({namespace: 'default', source: 'calendar:work', eventId: 'evt-proposal-approve-1'});
  assert.ok(saved);
  assert.equal(saved.status, 'applied');
});

test('MeetingRescheduleCoordinator: rejects stale approved proposal after graph changes', async () => {
  const {store} = createMeetingFixture();
  const mockLaya = createMockLaya(0, 0.95);
  const receiptStore = new InMemoryMeetingDecisionReceiptStore();
  const coordinator = new MeetingRescheduleCoordinator({store, inference: mockLaya, receiptStore});
  const event = {
    eventId: 'evt-stale-proposal-1',
    source: 'calendar:work',
    meetingFactId: 'meeting-sync-1',
    originalSummary: '周四下午 15:00 项目架构同步会',
    newSummary: '周四下午 16:00 项目架构同步会',
    sourceRevision: 'rev-stale-1',
    detectedAt: '2026-09-29T11:00:00.000Z',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  };

  const proposal = await coordinator.processEvent(event);
  assert.equal(proposal.status, 'proposal');
  const changedRevision = store.read().revision;
  store.append(changedRevision, {
    id: 'meeting-sync-1',
    kind: 'fact',
    summary: '周四下午 18:00 用户确认的新时间',
    sourceRef: 'calendar:work',
    sensitivity: 'private',
    state: 'active',
    validFrom: '2026-09-29T11:30:00.000Z',
    validUntil: '2026-09-30T00:00:00.000Z',
    reason: '用户在审批等待期间修改会议时间',
    dependencies: [],
  });

  let executionCalled = false;
  const baseExecutionPort = createStoreExecutionPort(store);
  const executionPort = {
    executeBatch(request) {
      executionCalled = true;
      return baseExecutionPort.executeBatch(request);
    },
  };
  const beforeApply = store.read();
  const result = await coordinator.applyApprovedProposal(
    {eventId: event.eventId, source: event.source},
    {executionPort},
  );

  assert.equal(result.status, 'conflict');
  assert.match(result.reason, /需要重新评估/);
  assert.equal(executionCalled, false);
  const afterApply = store.read();
  assert.equal(afterApply.revision, beforeApply.revision);
  assert.equal(afterApply.history.findLast(n => n.id === 'meeting-sync-1').summary, '周四下午 18:00 用户确认的新时间');
  assert.equal((await receiptStore.loadReceipt({namespace: 'default', source: event.source, eventId: event.eventId})).status, 'conflict');
});

test('MeetingRescheduleCoordinator: rejects baseline revision mismatch with conflict', async () => {
  const {store} = createMeetingFixture();
  const mockLaya = createMockLaya(0, 0.95);

  // Set recorded revision on meeting fact
  store.append(store.read().revision, {
    id: 'meeting-sync-1',
    kind: 'fact',
    summary: '周四下午 15:00 项目架构同步会',
    sourceRef: 'calendar:work',
    sensitivity: 'private',
    state: 'active',
    validFrom: '2026-09-29T10:00:00.000Z',
    validUntil: '2026-09-30T00:00:00.000Z',
    reason: '外部会议改期通知 [eventId: evt-base-1] [sourceRevision: etag-v2]',
    dependencies: [],
  });

  const coordinator = new MeetingRescheduleCoordinator({
    store,
    inference: mockLaya,
  });

  const event = {
    eventId: 'evt-base-mismatch-2',
    source: 'calendar:work',
    meetingFactId: 'meeting-sync-1',
    originalSummary: '周四下午 15:00 项目架构同步会',
    newSummary: '周四下午 16:00 项目架构同步会',
    sourceRevision: 'etag-v3',
    expectedBaseRevision: 'etag-v1', // Mismatch! Graph has etag-v2
    detectedAt: '2026-09-29T11:00:00.000Z',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  };

  const receipt = await coordinator.processEvent(event);
  assert.equal(receipt.status, 'conflict');
  assert.match(receipt.reason, /源事实基线版本不匹配/);
});

test('guarded execution commits only the captured input and store after asynchronous policy review', async () => {
  const host=new FakeCoordinationStoreHost(),approved=host.provision('approved'),other=host.provision('other');
  const input={id:'approved-fact',kind:'fact',summary:'approved summary',sourceRef:'calendar:synthetic',
    sensitivity:'public',state:'active',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z',
    reason:'synthetic',dependencies:[]};
  let release,entered,policyInput,commits=0,notified=0,replacedCalls=0;
  const reviewing=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  const store={read:revision=>approved.read(revision),appendBatch:(revision,inputs)=>approved.appendBatch(revision,inputs)};
  const policy={evaluateExecution:async()=>{throw Error('original method should be replaced on the same port');}};
  const options={store,policy,namespace:'approved',onExecuted:()=>{notified++;}};
  const port=createPolicyGuardedExecutionPort(options);
  policy.evaluateExecution=async request=>{policyInput=request;entered();await reviewing;return {allowed:true};};
  const request={expectedRevision:0,inputs:[structuredClone(input)],eventId:'approved-event',source:'calendar:synthetic',sourceRevision:'r1'};
  const pending=port.executeBatch(request);
  await started;
  assert.equal(policyInput.inputs[0].summary,input.summary);
  request.inputs[0].summary='caller replacement';
  request.inputs.push({...input,id:'unapproved-extra'});
  policyInput.inputs[0].summary='policy replacement';
  policyInput.inputs[0].dependencies.push({id:'missing',revision:1});
  options.store=other;options.namespace='other';
  options.policy={evaluateExecution(){replacedCalls++;return {allowed:false};}};
  options.onExecuted=()=>{replacedCalls++;};
  store.appendBatch=(revision,inputs)=>{commits++;return approved.appendBatch(revision,inputs);};
  release();
  const result=await pending;
  assert.equal(result.applied,true);assert.equal(commits,1);assert.equal(notified,1);assert.equal(replacedCalls,0);
  assert.deepEqual(approved.read().history,[{...input,revision:1,graphRevision:1}]);
  assert.deepEqual(result.snapshot,approved.read());assert.equal(other.read().revision,0);
});

test('guarded execution cannot replace the captured cancellation signal during policy review', async () => {
  const store=new FakeCoordinationStoreHost().provision('approved'),controller=new AbortController();
  let release,entered;
  const reviewing=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  const port=createPolicyGuardedExecutionPort({store,policy:{async evaluateExecution(){entered();await reviewing;return {allowed:true};}}});
  const request={expectedRevision:0,eventId:'approved-event',source:'calendar:synthetic',sourceRevision:'r1',
    signal:controller.signal,deadline:new Date(Date.now()+5000).toISOString(),inputs:[{id:'fact',kind:'fact',summary:'approved',
      sourceRef:'calendar:synthetic',sensitivity:'public',state:'active',reason:'synthetic',dependencies:[],
      validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z'}]};
  const pending=port.executeBatch(request);await started;
  controller.abort();request.signal=new AbortController().signal;release();
  const result=await pending;
  assert.equal(result.applied,false);assert.match(result.error,/异步授权后中止/);assert.equal(store.read().revision,0);
});

test('guarded recovery verifies the exact committed input and receipt boundaries against graph history', async () => {
  const store=new FakeCoordinationStoreHost().provision('synthetic-recovery'),receipts=new InMemoryMeetingDecisionReceiptStore();
  const input={id:'recovered-fact',kind:'fact',summary:'approved summary',sourceRef:'calendar:synthetic',
    sensitivity:'public',state:'active',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z',
    reason:'synthetic',dependencies:[]};
  store.appendBatch(0,[input]);
  const record=syntheticReceiptRecord('synthetic-recovery','calendar:synthetic','recovered-event');
  record.status='applied';record.receipt={...record.receipt,status:'applied',graphRevisionBefore:0,graphRevisionAfter:1,
    appliedNodeRevisions:[{id:input.id,revision:1}]};
  receipts.saveReceipt(record);
  const request={expectedRevision:0,inputs:[input],eventId:record.eventId,source:record.source,sourceRevision:record.sourceRevision};
  const port=createPolicyGuardedExecutionPort({store,receiptStore:receipts,namespace:record.namespace,
    policy:{evaluateExecution:()=>({allowed:true})}});
  assert.equal((await port.executeBatch(request)).applied,true);
  store.appendBatch(1,[{...input,id:'unrelated-fact',summary:'unrelated append'}]);
  const recovered=await port.executeBatch(request);
  assert.equal(recovered.applied,true);assert.equal(recovered.snapshot.revision,2);
  const before=store.read();
  assert.equal((await port.executeBatch({...request,inputs:[{...input,summary:'unexecuted replacement'}]})).applied,false);
  for(const mutation of [
    value=>{value.namespace='other-namespace';},value=>{value.source='other-source';},
    value=>{value.eventId='other-event';},value=>{value.receipt.sourceRevision='other-revision';},
    value=>{value.receipt.source='other-source';},value=>{value.receipt.eventId='other-event';},
    value=>{value.receipt.graphRevisionBefore=1;},value=>{value.receipt.graphRevisionAfter=2;},
  ]) {
    const forged=structuredClone(record);mutation(forged);
    const mismatched=createPolicyGuardedExecutionPort({store,namespace:record.namespace,
      receiptStore:{loadReceipt:()=>forged,saveReceipt(){}},policy:{evaluateExecution:()=>({allowed:true})}});
    assert.equal((await mismatched.executeBatch(request)).applied,false);
  }
  const unavailable=createPolicyGuardedExecutionPort({store:{appendBatch:(...args)=>store.appendBatch(...args),
    read:revision=>{if(revision!==undefined)throw Error('history unavailable');return store.read();}},
    namespace:record.namespace,receiptStore:receipts,policy:{evaluateExecution:()=>({allowed:true})}});
  assert.equal((await unavailable.executeBatch(request)).applied,false);
  assert.deepEqual(store.read(),before,'recovery neither retries nor changes persisted history');
});

test('MeetingRescheduleCoordinator: createPolicyGuardedExecutionPort evaluates policy before commit', async () => {
  const {store} = createMeetingFixture();
  const mockLaya = createMockLaya(0, 0.95);

  let policyAllow = false;
  const policyEvaluations = [];
  const policy = {
    evaluateExecution(req) {
      policyEvaluations.push(req);
      return {allowed: policyAllow, reason: policyAllow ? 'allowed' : '用户未开启自动日程调整策略'};
    },
  };

  const executionPort = createPolicyGuardedExecutionPort({store, policy});

  const coordinator = new MeetingRescheduleCoordinator({
    store,
    inference: mockLaya,
    executionPort,
  });

  const event = {
    eventId: 'evt-policy-test-1',
    source: 'calendar:work',
    meetingFactId: 'meeting-sync-1',
    originalSummary: '周四下午 15:00 项目架构同步会',
    newSummary: '周四下午 16:00 项目架构同步会',
    sourceRevision: 'rev-pol-1',
    detectedAt: '2026-09-29T11:00:00.000Z',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  };

  // Case 1: Policy denies
  const receipt1 = await coordinator.processEvent(event);
  assert.equal(receipt1.status, 'requires_review');
  assert.match(receipt1.reason, /Policy 拒绝执行/);
  assert.equal(store.read().revision, 5); // Graph untouched

  // Case 2: Policy allows
  policyAllow = true;
  const event2 = {
    ...event,
    eventId: 'evt-policy-test-2',
  };
  const receipt2 = await coordinator.processEvent(event2);
  assert.equal(receipt2.status, 'applied');
  assert.equal(store.read().revision, 9); // Committed
});

test('MeetingRescheduleCoordinator: createPolicyGuardedExecutionPort requires policy and validates deadline & cancellation', async () => {
  const {store} = createMeetingFixture();

  // 1. Missing policy throws INVALID_ARGUMENT
  assert.throws(() => {
    createPolicyGuardedExecutionPort({store});
  }, (err) => err instanceof CognitionError && err.code === 'INVALID_ARGUMENT');

  // 2. Invalid deadline string rejected
  const policy = { evaluateExecution: () => ({allowed: true}) };
  const port = createPolicyGuardedExecutionPort({store, policy});
  const resInvalidDeadline = await port.executeBatch({
    expectedRevision: store.read().revision,
    inputs: [],
    eventId: 'evt-bad-deadline',
    source: 'calendar:work',
    sourceRevision: 'v-1',
    deadline: 'not-a-date',
  });
  assert.equal(resInvalidDeadline.applied, false);
  assert.equal(resInvalidDeadline.error, '非法截止时间');

  // 3. Cancelled during async policy evaluation
  let abortController;
  const slowPolicy = {
    async evaluateExecution() {
      // Simulate aborting signal during policy evaluation
      abortController.abort();
      return {allowed: true};
    },
  };
  const slowPort = createPolicyGuardedExecutionPort({store, policy: slowPolicy});
  abortController = new AbortController();
  const resAbortedDuring = await slowPort.executeBatch({
    expectedRevision: store.read().revision,
    inputs: [],
    eventId: 'evt-abort-during',
    source: 'calendar:work',
    sourceRevision: 'v-1',
    signal: abortController.signal,
  });
  assert.equal(resAbortedDuring.applied, false);
  assert.match(resAbortedDuring.error, /异步授权后中止/);

  // 4. onExecuted throwing does NOT cause applied batch to be marked as failed
  let notifyCalled = false;
  const throwingPort = createPolicyGuardedExecutionPort({
    store,
    policy,
    onExecuted: () => {
      notifyCalled = true;
      throw new Error('desktop notification crashed');
    },
  });
  const resNotifyError = await throwingPort.executeBatch({
    expectedRevision: store.read().revision,
    inputs: [{
      id: 'test-node-exec',
      kind: 'fact',
      summary: '测试写入',
      sourceRef: 'test',
      sensitivity: 'public',
      state: 'active',
      validFrom: '2026-09-29T10:00:00.000Z',
      validUntil: '2026-09-30T00:00:00.000Z',
      reason: '测试',
      dependencies: [],
    }],
    eventId: 'evt-notify-fail',
    source: 'calendar:work',
    sourceRevision: 'v-1',
  });
  assert.equal(resNotifyError.applied, true); // Still applied!
  assert.equal(notifyCalled, true);
  assert.match(resNotifyError.notificationError, /desktop notification crashed/);
});

test('FileMeetingDecisionReceiptStore: throws error on corrupted receipt file', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'receipt-corrupt-test-'));
  try {
    const store = new FileMeetingDecisionReceiptStore({storageDir: tmpDir});
    // Create a corrupted JSON file
    writeFileSync(path.join(tmpDir, 'receipt-bad.json'), 'CORRUPTED_JSON_NOT_VALID{', 'utf8');

    // Scanning directory should detect corrupt file and throw, NOT swallow as undefined
    assert.throws(() => {
      store.loadReceipt('any-event-id');
    }, /Corrupted receipt file detected/);
  } finally {
    rmSync(tmpDir, {recursive: true, force: true});
  }
});

test('MeetingRescheduleCoordinator: crash recovery does not match node with different sourceRef or summary', async () => {
  const {store} = createMeetingFixture();
  const mockLaya = createMockLaya(0, 0.95);

  // Append a fact node that has eventId in reason, but sourceRef is calendar:personal (not calendar:work)
  store.append(store.read().revision, {
    id: 'meeting-sync-1',
    kind: 'fact',
    summary: '周四下午 15:00 别的会议',
    sourceRef: 'calendar:personal',
    sensitivity: 'private',
    state: 'active',
    validFrom: '2026-09-29T10:00:00.000Z',
    validUntil: '2026-09-30T00:00:00.000Z',
    reason: '外部会议改期通知 [eventId: evt-foreign-1] [sourceRevision: v-1]',
    dependencies: [],
  });

  const coordinator = new MeetingRescheduleCoordinator({
    store,
    inference: mockLaya,
  });

  const event = {
    eventId: 'evt-foreign-1',
    source: 'calendar:work', // different source!
    meetingFactId: 'meeting-sync-1',
    originalSummary: '周四下午 15:00 项目架构同步会',
    newSummary: '周四下午 16:00 项目架构同步会',
    sourceRevision: 'v-1',
    detectedAt: '2026-09-29T11:00:00.000Z',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
  };

  const receipt = await coordinator.processEvent(event);
  // Must NOT be already_processed because source and summary did not match!
  assert.notEqual(receipt.status, 'already_processed');
});
