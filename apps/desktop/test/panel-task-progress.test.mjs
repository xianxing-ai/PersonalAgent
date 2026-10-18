import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {Client, EventCursor} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';

const source = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declaration = name => {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name);
  return node.getText(ast);
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-task-progress-'));
  const app = createRuntimeApplication({path: join(directory, 'runtime.sqlite'), tools: []});
  const jobs = [];
  t.after(async () => {
    for (const {taskId, job} of jobs) { app.runtime.requestCancel(taskId); await job; }
    app.close();
    await rm(directory, {recursive: true, force: true});
  });
  const publicClient = new Client(app, Date.now);
  await publicClient.connect();
  const calls = [], tasks = new Map(), approvals = new Map(), published = [];
  const client = {call(name, payload) { calls.push({name, payload}); return publicClient.call(name, payload); }};
  const eventCursor = new EventCursor('tasks');
  const context = vm.createContext({tasks, approvals, client, runtimeError: '',
    terminalTaskStates: new Set(['succeeded', 'failed', 'cancelled']), notifications: new Map(), structuredClone,
    eventBusy: false, eventCursor, runtimeConnection: {readEvents: after => app.readEvents(after)}, runtimeApplication: app,
    knowledgeWatchHost: undefined, p5DeviceTelemetrySubscription: undefined, syntheticRepairHost: undefined,
    publish: () => published.push([...tasks.values()].map(task => ({...task}))), Error});
  for (const name of ['clearInactiveTaskExitWarning', 'refresh', 'applyEvent', 'pumpEvents', 'dispatchKnowledgeFeedCheckTask']) {
    vm.runInContext(declaration(name), context);
  }
  let taskNumber = 0;
  const createTask = () => app.runtime.submitTask({goal: 'Local read-only progress fixture', conversationId: 'desktop-panel', idempotencyKey: `progress-${++taskNumber}`});
  const start = task => {
    let worker;
    const job = app.runtime.runTask(task.taskId, context => new Promise((resolve, reject) => {
      worker = context;
      context.signal.addEventListener('abort', () => reject(new Error('read-only fixture cancelled')), {once: true});
    }), {deadline: new Date(Date.now() + 60_000).toISOString(), sideEffect: 'read'});
    jobs.push({taskId: task.taskId, job});
    assert.ok(worker);
    return {worker, job};
  };
  return {app, publicClient, client, calls, tasks, approvals, published, context, eventCursor,
    createTask, start, pump: context.pumpEvents, refresh: context.refresh};
}

test('the original pump reads persisted progress once per task and replay never issues another task.get', async t => {
  const f = await fixture(t), task = f.createTask(), {worker} = f.start(task);
  await f.pump();
  const previous = f.tasks.get(task.taskId);
  worker.reportProgress({stepId: 'read-status', label: 'First authoritative label', completedUnits: 1, totalUnits: 2});
  const latest = worker.reportProgress({stepId: 'read-status', label: 'Latest authoritative label', completedUnits: 2, totalUnits: 2});
  const events = f.app.readEvents(f.eventCursor.afterSequence);
  assert.equal(events.length, 2);
  assert.ok(events.every(event => event.type === 'task.progress' && !('revision' in event.payload)));
  await f.pump();
  const current = f.tasks.get(task.taskId);
  assert.ok(current.revision > previous.revision);
  assert.deepEqual(current, latest);
  assert.equal(current.steps[0].state, 'completed');
  assert.equal(current.steps[0].label, 'Latest authoritative label');
  assert.equal('completedUnits' in current.steps[0], false);
  assert.equal(f.calls.filter(call => call.name === 'task.get').length, 1);
  const count = f.published.length;
  f.context.runtimeConnection = {readEvents: () => f.app.readEvents()};
  await f.pump();
  assert.equal(f.calls.filter(call => call.name === 'task.get').length, 1);
  assert.equal(f.published.length, count);
  assert.equal(f.eventCursor.afterSequence, events.at(-1).sequence);
});

test('a failed progress get preserves same-batch terminal events and cancellation approval cleanup', async t => {
  const f = await fixture(t), task = f.createTask(), {worker, job} = f.start(task);
  const approvedTask = f.createTask();
  f.app.runtime.transitionTask(approvedTask.taskId, 'planning');
  f.app.runtime.transitionTask(approvedTask.taskId, 'running');
  f.app.runtime.requestToolApproval('progress-read-approval', approvedTask.taskId, {
    name: 'fixture.read', version: '1.0.0', inputSchema: {}, outputSchema: {}, sideEffect: 'read',
    requiredScopes: ['fixture:read'], idempotencySupport: true, recoverySupport: true, requiresPresence: false,
  }, new Date(Date.now() + 60_000).toISOString(), 'a'.repeat(64));
  await f.pump();
  assert.equal(f.approvals.size, 1);
  worker.reportProgress({stepId: 'read-status', label: 'Read-only progress before cancel'});
  await f.client.call('task.cancel', {taskId: task.taskId});
  await job;
  await f.client.call('task.cancel', {taskId: approvedTask.taskId});
  f.context.client = {call(name, payload) {
    if (name === 'task.get' && payload.taskId === task.taskId) {
      f.calls.push({name, payload});
      return Promise.reject(new Error('Explicit Fake public progress read failure'));
    }
    return f.client.call(name, payload);
  }};
  await f.pump();
  assert.equal(f.tasks.get(task.taskId).state, 'cancelled');
  assert.equal(f.tasks.get(approvedTask.taskId).state, 'cancelled');
  assert.equal(f.approvals.size, 0);
  assert.equal(f.context.runtimeError, 'Explicit Fake public progress read failure');
  assert.equal(f.context.eventBusy, false);
  assert.equal(f.eventCursor.afterSequence, f.app.readEvents().at(-1).sequence);
  const readCount = f.calls.filter(call => call.name === 'task.get').length;
  f.context.runtimeConnection = {readEvents: () => f.app.readEvents()};
  await f.pump();
  assert.equal(f.calls.filter(call => call.name === 'task.get').length, readCount);
  assert.equal(f.approvals.size, 0);
});

test('one failed public progress read does not prevent another task from receiving its authoritative step', async t => {
  const f = await fixture(t), first = f.createTask(), second = f.createTask();
  const firstWorker = f.start(first).worker, secondWorker = f.start(second).worker;
  await f.pump();
  firstWorker.reportProgress({stepId: 'first-status', label: 'First real progress'});
  const latest = secondWorker.reportProgress({stepId: 'second-status', label: 'Second real progress'});
  f.context.client = {call(name, payload) {
    if (name === 'task.get' && payload.taskId === first.taskId) {
      f.calls.push({name, payload});
      return Promise.reject(new Error('Explicit Fake first progress read failure'));
    }
    return f.client.call(name, payload);
  }};
  await f.pump();
  assert.deepEqual(f.tasks.get(second.taskId), latest);
  assert.equal(f.tasks.get(second.taskId).steps[0].label, 'Second real progress');
  assert.equal(f.calls.filter(call => call.name === 'task.get' && call.payload.taskId === first.taskId).length, 1);
  assert.equal(f.calls.filter(call => call.name === 'task.get' && call.payload.taskId === second.taskId).length, 1);
  assert.equal(f.context.runtimeError, 'Explicit Fake first progress read failure');
  assert.equal(f.eventCursor.afterSequence, f.app.readEvents().at(-1).sequence);
});

test('an older progress task.get cannot replace a terminal readback arriving while that get is delayed', async t => {
  const f = await fixture(t), task = f.createTask(), {worker, job} = f.start(task);
  await f.pump();
  worker.reportProgress({stepId: 'read-status', label: 'Actual step captured before cancel'});
  let release, captured;
  const entered = new Promise(done => {
    f.context.client = {async call(name, payload) {
      const result = await f.client.call(name, payload);
      if (name === 'task.get' && !captured) {
        captured = result;
        done();
        return new Promise(resolve => { release = () => resolve(result); });
      }
      return result;
    }};
  });
  const earlierPump = f.pump();
  await entered;
  assert.equal(captured.state, 'running');
  await f.client.call('task.cancel', {taskId: task.taskId});
  await job;
  const current = await f.refresh(task.taskId);
  assert.equal(current.state, 'cancelled');
  release();
  await earlierPump;
  assert.equal(f.tasks.get(task.taskId), current);
  assert.ok(current.revision > captured.revision);
  assert.equal(f.app.runtime.getTask(task.taskId).state, 'cancelled');
});
