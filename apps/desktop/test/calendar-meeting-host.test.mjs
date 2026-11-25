import assert from 'node:assert/strict';
import test from 'node:test';
import {createDesktopCalendarMeetingHost, calendarMeetingSourceRef} from '../electron/calendar-meeting-host.js';

// Explicit Fake ports: no provider, network, SQLite migration or graph writes.
function fixture() {
  const clock = Date.parse('2026-09-30T08:00:00.000Z');
  let account = {providerKind: 'caldav', accountRef: 'account-1', secretRef: 'secret-1',
    revision: 1, calendarUrl: 'https://example.test/calendar/', calendarName: 'Test'};
  const config = {binding: () => account && structuredClone(account),
    snapshot: () => ({configured: Boolean(account), readAvailable: false,
      reason: 'controlled_read_unavailable'})};
  const checkpoints = new Map(), reads = new Map(), facts = [];
  const revoked = [], cancelled = [], calls = [];
  const runtime = {
    loadCheckpoint: (id, key) => structuredClone(checkpoints.get(`${id}:${key}`)),
    saveCheckpointOnce(id, key, value) {
      const address = `${id}:${key}`;
      if (checkpoints.has(address)) return false;
      checkpoints.set(address, structuredClone(value)); return true;
    },
    saveCheckpointOnceForCreatedTask(id, key, value, revision) {
      assert.equal(reads.get(id).task.state, 'created'); assert.equal(revision, 1);
      return runtime.saveCheckpointOnce(id, key, value);
    },
    bindCoordinationStore: () => ({read: () => ({history: structuredClone(facts)})}),
    listTasks: () => ({items: [...reads.values()].map(value => value.task), snapshotSequence: 1}),
    policy: {revoke: id => revoked.push(id)},
    requestCancel: id => cancelled.push(id),
  };
  const tool = {descriptor: {name: 'fixture.calendar.read', version: '1.0.0',
    sideEffect: 'read', requiredScopes: ['calendar:read'], requiresPresence: false}, execute() {throw Error('not called');}};
  const application = {runtime,
    prepareHostToolTask(input) {
      calls.push(['prepare', input]);
      const id = `task-${reads.size + 1}`;
      reads.set(id, {task: {taskId: id, revision: 1, state: 'created'},
        toolName: input.toolName, toolVersion: input.toolVersion});
      return structuredClone(reads.get(id).task);
    },
    finalizeHostToolTask(input) {
      assert.ok(runtime.loadCheckpoint(input.taskId, 'desktop-calendar-read-v1'));
      calls.push(['finalize', input]);
      reads.get(input.taskId).task.state = 'waiting_approval';
    },
    cancelPreparedHostToolTask: id => cancelled.push(id),
    readHostToolTask: id => structuredClone(reads.get(id)),
  };
  const options = {config, namespace: 'test-namespace', readTool: tool,
    readArguments: (binding, externalId) => ({accountRef: binding.accountRef, externalId}), now: () => clock};
  const host = createDesktopCalendarMeetingHost(options); host.bindApplication(application);
  function complete(id, sequence = 1, externalId = 'uid:1') {
    const result = {source: 'calendar', accountRef: account.accountRef, externalId,
      dedupeKey: `calendar:caldav:${externalId}:${sequence}`, contentRef: `[confirmed] meeting ${sequence}`,
      occurredAt: '2026-10-01T08:00:00.000Z', validFor: '2026-10-01T08:00:00.000Z/2026-10-01T09:00:00.000Z',
      fetchedAt: '2026-09-30T08:00:00.000Z', sensitivity: 'normal'};
    reads.get(id).task.state = 'succeeded';
    reads.get(id).confirmed = {runId: `host-tool-${id}`, result, evidenceRefs: [`host-tool-${id}`]};
    return result;
  }
  function fact(item) {
    facts.push({id: 'meeting-1', kind: 'fact', revision: 1, state: 'active',
      summary: item.contentRef, sourceRef: calendarMeetingSourceRef(account.accountRef, item.externalId),
      validFrom: '2026-09-30T00:00:00.000Z', validUntil: '2026-10-02T00:00:00.000Z', reason: '[sourceRevision: 1]'});
  }
  return {options, host, application, config, runtime, checkpoints, reads, facts, calls,
    cancelled, revoked, complete, fact, changeAccount: () => {account = {...account, revision: 2, secretRef: 'secret-2'};}};
}

test('missing controlled read factory remains unavailable and creates no task', () => {
  const f = fixture();
  const host = createDesktopCalendarMeetingHost({config: f.config, namespace: 'test-namespace'});
  host.bindApplication(f.application);
  assert.equal(host.snapshot().readAvailable, false);
  assert.equal(host.snapshot().sessionAllowed, false);
  assert.deepEqual(host.tools, []);
  assert.throws(() => host.read({externalId: 'uid:1'}), {code: 'UNSUPPORTED_CAPABILITY'});
  assert.equal(f.calls.length, 0);
});

test('freeze configuration before approval; only confirmed result and matching existing Fact can bind', () => {
  const f = fixture(), request = f.host.read({externalId: 'uid:1'});
  assert.equal(request.state, 'waiting_approval');
  assert.equal(f.calls[1][0], 'finalize');
  assert.throws(() => f.host.bindMeeting({taskId: request.taskId, meetingFactId: 'meeting-1'}), {code: 'UNAUTHORIZED'});
  assert.throws(() => f.host.bindMeeting({taskId: request.taskId, meetingFactId: 'meeting-1', baseline: {}}), {code: 'INVALID_ARGUMENT'});
  const item = f.complete(request.taskId);
  assert.throws(() => f.host.bindMeeting({taskId: request.taskId, meetingFactId: 'meeting-1'}), {code: 'REVISION_CONFLICT'});
  f.fact(item);
  const before = structuredClone(f.facts);
  assert.equal(f.host.bindMeeting({taskId: request.taskId, meetingFactId: 'meeting-1'}).bound, true);
  assert.deepEqual(f.facts, before, 'binding never creates or writes a Fact');
  assert.equal(f.runtime.loadCheckpoint(request.taskId, 'desktop-calendar-meeting-v1').baseline.contentRef, item.contentRef);
  const restored = createDesktopCalendarMeetingHost(f.options); restored.bindApplication(f.application);
  assert.equal(restored.bindMeeting({taskId: request.taskId, meetingFactId: 'meeting-1'}).bound, true);
  assert.equal(JSON.stringify(restored.readTask(request.taskId)).includes('secret-1'), false);
  f.facts[0].revision = 2;
  assert.throws(() => restored.bindMeeting({taskId: request.taskId, meetingFactId: 'meeting-1'}), {code: 'REVISION_CONFLICT'});
});

test('configuration replacement, wrong source and unknown execution cannot supply an old item', () => {
  const f = fixture(), pending = f.host.read({externalId: 'uid:1'});
  f.reads.get(pending.taskId).task.state = 'waiting_reconciliation';
  assert.throws(() => f.host.bindMeeting({taskId: pending.taskId, meetingFactId: 'meeting-1'}), {code: 'UNAUTHORIZED'});
  f.host.invalidate();
  assert.deepEqual(f.cancelled, [pending.taskId]);
  assert.deepEqual(f.revoked, [`host-tool-${pending.taskId}`]);
  f.complete(pending.taskId, 1, 'other-uid');
  assert.throws(() => f.host.readTask(pending.taskId), {code: 'EXTERNAL_FAILURE'});
  f.complete(pending.taskId); f.changeAccount();
  assert.throws(() => f.host.readTask(pending.taskId), {code: 'UNAUTHORIZED'});
});

test('refresh consumes exact confirmed pair and restored checkpoint; unrelated or withdrawn Fact is rejected', async () => {
  const f = fixture(), baseline = f.host.read({externalId: 'uid:1'});
  f.fact(f.complete(baseline.taskId));
  f.host.bindMeeting({taskId: baseline.taskId, meetingFactId: 'meeting-1'});
  const current = f.host.read({externalId: 'uid:1'}); f.complete(current.taskId, 2);
  const restored = createDesktopCalendarMeetingHost(f.options); restored.bindApplication(f.application);
  let calls = 0;
  const refresh = async (binding, context) => {
    calls++;
    assert.equal(context.signal.aborted, false);
    assert.equal(restored.calendarReadPort.readBaseline(binding).dedupeKey, 'calendar:caldav:uid:1:1');
    assert.equal(restored.calendarReadPort.readCurrent(binding).dedupeKey, 'calendar:caldav:uid:1:2');
    assert.throws(() => restored.calendarReadPort.readCurrent({...binding, externalId: 'foreign'}), {code: 'UNAUTHORIZED'});
    return {status: 'requires_review', calendarWriteVerified: false};
  };
  assert.equal((await restored.refreshMeeting({baselineTaskId: baseline.taskId, currentTaskId: current.taskId}, refresh)).status, 'requires_review');
  const other = restored.read({externalId: 'foreign'}); f.complete(other.taskId, 2, 'foreign');
  await assert.rejects(restored.refreshMeeting({baselineTaskId: baseline.taskId, currentTaskId: other.taskId}, refresh), {code: 'UNAUTHORIZED'});
  f.facts[0].state = 'withdrawn';
  await assert.rejects(restored.refreshMeeting({baselineTaskId: baseline.taskId, currentTaskId: current.taskId}, refresh), {code: 'REVISION_CONFLICT'});
  assert.equal(calls, 1);
  restored.close();
  assert.equal(restored.snapshot().readAvailable, false);
});

test('windows-system binding accepts non-caldav calendarId segment in dedupeKey when binding meeting facts', () => {
  const clock = Date.parse('2026-09-30T08:00:00.000Z');
  const account = {providerKind: 'windows-system', accountRef: 'account-win', secretRef: 'secret-win', revision: 1, calendarName: 'Windows 系统日历'};
  const checkpoints = new Map(), reads = new Map(), facts = [];
  const runtime = {
    loadCheckpoint: (id, key) => structuredClone(checkpoints.get(`${id}:${key}`)),
    saveCheckpointOnce(id, key, value) {
      const address = `${id}:${key}`;
      if (checkpoints.has(address)) return false;
      checkpoints.set(address, structuredClone(value)); return true;
    },
    saveCheckpointOnceForCreatedTask: (id, key, value) => runtime.saveCheckpointOnce(id, key, value),
    bindCoordinationStore: () => ({read: () => ({history: structuredClone(facts)})}),
    listTasks: () => ({items: [], snapshotSequence: 1}),
    policy: {revoke: () => {}},
    requestCancel: () => {},
  };
  const host = createDesktopCalendarMeetingHost({
    config: {binding: () => structuredClone(account), snapshot: () => ({configured: true, providerKind: 'windows-system'})},
    namespace: 'desktop',
    readTool: {descriptor: {name: 'fixture.calendar.read', version: '1.0.0', sideEffect: 'read', requiresPresence: false, requiredScopes: ['calendar:read']}, async execute() {}},
    readArguments: (b, externalId) => ({providerKind: b.providerKind, externalId}),
    now: () => clock,
  });
  host.bindApplication({
    runtime,
    prepareHostToolTask: ({commandId}) => {
      const task = {taskId: `t-${commandId}`, state: 'created', revision: 1};
      reads.set(task.taskId, {toolName: 'fixture.calendar.read', toolVersion: '1.0.0', task});
      return task;
    },
    finalizeHostToolTask: () => {},
    readHostToolTask: id => reads.get(id),
  });
  const pending = host.read({externalId: 'win-evt-1'});
  const rec = reads.get(pending.taskId);
  rec.task.state = 'succeeded';
  rec.confirmed = {
    runId: `host-tool-${pending.taskId}`,
    evidenceRefs: ['ev-1'],
    result: {
      source: 'calendar',
      accountRef: 'account-win',
      externalId: 'win-evt-1',
      dedupeKey: 'calendar:b,5,13:win-evt-1:5',
      contentRef: '[confirmed] 系统会议',
      validFor: '2026-10-01T08:00:00.000Z/2026-10-01T09:00:00.000Z',
      occurredAt: '2026-10-01T08:00:00.000Z',
      fetchedAt: new Date(clock).toISOString(),
    },
  };
  facts.push({id: 'meeting-win', kind: 'fact', revision: 1, state: 'active',
    validFrom: '2026-09-29T00:00:00.000Z', validUntil: '2026-10-10T00:00:00.000Z',
    sourceRef: calendarMeetingSourceRef('account-win', 'win-evt-1'),
    summary: '[confirmed] 系统会议', reason: '[sourceRevision: 5]'});
  const bound = host.bindMeeting({taskId: pending.taskId, meetingFactId: 'meeting-win'});
  assert.equal(bound.bound, true);
  assert.equal(runtime.loadCheckpoint(pending.taskId, 'desktop-calendar-meeting-v1').binding.calendarId, 'b,5,13');
});
