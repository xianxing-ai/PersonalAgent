import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {Client, EventCursor} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {requestTaskCancellation} from '../electron/runtime.js';

const source = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declaration = name => {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name);
  return node.getText(ast);
};
let cancelRoute;
function visit(node) {
  if (ts.isIfStatement(node) && node.expression.getText(ast) === "name === 'task.cancel'") cancelRoute = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(cancelRoute);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-event-readback-'));
  const app = createRuntimeApplication({path: join(directory, 'runtime.sqlite'), tools: []});
  const jobs = [];
  t.after(async () => {
    for (const {taskId, job} of jobs) { app.runtime.requestCancel(taskId); await job; }
    app.close();
    await rm(directory, {recursive: true, force: true});
  });
  const publicClient = new Client(app, Date.now);
  await publicClient.connect();
  const calls = [];
  const client = {call(name, payload) { calls.push({name, payload}); return publicClient.call(name, payload); }};
  const task = app.runtime.submitTask({goal: 'Local read-only event fixture', conversationId: 'desktop-panel', idempotencyKey: 'event-readback'});
  const tasks = new Map(), approvals = new Map(), published = [], panel = {};
  const eventCursor = new EventCursor('tasks');
  const context = vm.createContext({tasks, approvals, panel, workspace: {}, admin: {}, client, requestTaskCancellation,
    conversations: undefined, runtimeError: '', terminalTaskStates: new Set(['succeeded', 'failed', 'cancelled']),
    notifications: new Map(), structuredClone, eventBusy: false, eventCursor,
    runtimeConnection: {readEvents: after => app.readEvents(after)}, runtimeApplication: app,
    knowledgeWatchHost: undefined, p5DeviceTelemetrySubscription: undefined, syntheticRepairHost: undefined,
    publish: () => published.push([...tasks.values()].map(task => ({...task}))), Error});
  for (const name of ['taskSurface', 'clearInactiveTaskExitWarning', 'refresh', 'applyEvent', 'pumpEvents', 'dispatchKnowledgeFeedCheckTask']) {
    vm.runInContext(declaration(name), context);
  }
  const cancel = vm.runInContext(`(async function(sender,name,payload){${cancelRoute}})`, context);
  return {app, task, tasks, approvals, eventCursor, published, calls, context, jobs,
    refresh: context.refresh, pump: context.pumpEvents, cancel: taskId => cancel(panel, 'task.cancel', taskId)};
}

test('a delayed public event batch cannot replace a cancellation readback, and the cursor keeps advancing', async t => {
  const f = await fixture(t);
  const job = f.app.runtime.runTask(f.task.taskId, context => new Promise((resolve, reject) => {
    context.signal.addEventListener('abort', () => reject(new Error('read-only fixture cancelled')), {once: true});
  }), {deadline: new Date(Date.now() + 60_000).toISOString(), sideEffect: 'read'});
  f.jobs.push({taskId: f.task.taskId, job});
  await f.refresh(f.task.taskId);
  let release, captured;
  const entered = new Promise(done => {
    f.context.runtimeConnection = {readEvents(after) {
      captured = f.app.readEvents(after);
      done();
      return new Promise(resolve => { release = () => resolve(captured); });
    }};
  });
  const earlierPump = f.pump();
  await entered;
  assert.equal(captured.at(-1).payload.state, 'running');
  assert.equal((await f.cancel(f.task.taskId)).cancelAccepted, true);
  await job;
  const current = await f.refresh(f.task.taskId), count = f.published.length;
  assert.equal(current.state, 'cancelled');
  release();
  await earlierPump;
  assert.equal(f.tasks.get(f.task.taskId), current);
  assert.equal(f.eventCursor.afterSequence, captured.at(-1).sequence);
  assert.ok(f.published.slice(count).every(tasks => tasks[0].revision === current.revision));
  f.context.runtimeConnection = {readEvents: after => f.app.readEvents(after)};
  await f.pump();
  assert.equal(f.tasks.get(f.task.taskId).state, 'cancelled');
  assert.equal(f.tasks.get(f.task.taskId).revision, current.revision);
  assert.equal(f.eventCursor.afterSequence, f.app.readEvents().at(-1).sequence);
  const settledCount = f.published.length;
  f.context.runtimeConnection = {readEvents: () => f.app.readEvents()};
  await f.pump();
  assert.equal(f.published.length, settledCount);
  assert.equal(f.app.runtime.getTask(f.task.taskId).state, 'cancelled');
});

test('the actual pump accepts ordinary forward and equal task snapshots and ignores repeated public events', async t => {
  const f = await fixture(t);
  await f.pump();
  const initial = f.tasks.get(f.task.taskId);
  assert.equal(initial.state, 'created');
  const job = f.app.runtime.runTask(f.task.taskId, async () => ({resultSummary: 'read-only fixture complete'}),
    {deadline: new Date(Date.now() + 60_000).toISOString(), sideEffect: 'read'});
  await job;
  const events = f.app.readEvents(f.eventCursor.afterSequence);
  const completed = events.find(event => event.type === 'task.completed');
  assert.equal(events.findLast(event => event.type === 'task.state_changed').payload.revision, completed.payload.revision);
  await f.pump();
  const newer = f.tasks.get(f.task.taskId);
  assert.equal(newer.state, 'succeeded');
  assert.ok(newer.revision > initial.revision);
  assert.equal(newer.revision, completed.payload.revision);
  assert.equal(f.published.length, 2);
  // The terminal event carries the same revision as state_changed and still follows the original projection path.
  f.context.applyEvent(completed);
  assert.notEqual(f.tasks.get(f.task.taskId), newer);
  assert.equal(f.tasks.get(f.task.taskId).revision, newer.revision);
  f.context.runtimeConnection = {readEvents: () => f.app.readEvents()};
  await f.pump();
  assert.equal(f.published.length, 2);
});

test('a fresh cancellation readback does not prevent the original pump from clearing pending approvals', async t => {
  const f = await fixture(t);
  f.app.runtime.transitionTask(f.task.taskId, 'planning');
  f.app.runtime.transitionTask(f.task.taskId, 'running');
  f.app.runtime.requestToolApproval('read-only-approval', f.task.taskId, {
    name: 'fixture.read', version: '1.0.0', inputSchema: {}, outputSchema: {}, sideEffect: 'read',
    requiredScopes: ['fixture:read'], idempotencySupport: true, recoverySupport: true, requiresPresence: false,
  }, new Date(Date.now() + 60_000).toISOString(), 'a'.repeat(64));
  await f.pump();
  assert.equal(f.approvals.get('read-only-approval').state, 'pending');
  await f.cancel(f.task.taskId);
  assert.equal(f.tasks.get(f.task.taskId).state, 'cancelled');
  assert.equal(f.approvals.size, 1);
  await f.pump();
  assert.equal(f.approvals.size, 0);
  assert.equal(f.tasks.get(f.task.taskId).state, 'cancelled');
  assert.equal(f.eventCursor.afterSequence, f.app.readEvents().at(-1).sequence);
  assert.ok(f.calls.every(call => ['event.subscribe', 'approval.list', 'task.get', 'task.cancel'].includes(call.name)));
});
