import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {Client} from '@personal-agent/client';
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
  const directory = await mkdtemp(join(tmpdir(), 'desktop-task-refresh-'));
  const app = createRuntimeApplication({path: join(directory, 'runtime.sqlite'), tools: []});
  const jobs = [];
  t.after(async () => {
    for (const {taskId, job} of jobs) { app.runtime.requestCancel(taskId); await job; }
    app.close();
    await rm(directory, {recursive: true, force: true});
  });
  const client = new Client(app, Date.now);
  await client.connect();
  const task = app.runtime.submitTask({goal: 'Local read-only cancellation fixture', conversationId: 'desktop-panel', idempotencyKey: 'refresh-order'});
  const tasks = new Map(), published = [], panel = {};
  const context = vm.createContext({tasks, panel, workspace: {}, admin: {}, client, requestTaskCancellation,
    conversations: undefined, runtimeError: '', terminalTaskStates: new Set(['succeeded', 'failed', 'cancelled']),
    approvals: new Map(), notifications: new Map(), structuredClone,
    publish: () => published.push([...tasks.values()].map(task => ({...task}))), Error});
  for (const name of ['taskSurface', 'clearInactiveTaskExitWarning', 'refresh', 'applyEvent']) vm.runInContext(declaration(name), context);
  const cancel = vm.runInContext(`(async function(sender,name,payload){${cancelRoute}})`, context);
  return {app, client, task, tasks, published, context, jobs, refresh: context.refresh, cancel: taskId => cancel(panel, 'task.cancel', taskId)};
}

test('a delayed public task.get cannot revive a task cancelled through the actual panel route', async t => {
  const f = await fixture(t);
  const job = f.app.runtime.runTask(f.task.taskId, context => new Promise((resolve, reject) => {
    context.signal.addEventListener('abort', () => reject(new Error('read-only fixture cancelled')), {once: true});
  }), {deadline: new Date(Date.now() + 60_000).toISOString(), sideEffect: 'read'});
  f.jobs.push({taskId: f.task.taskId, job});
  await f.refresh(f.task.taskId);
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
  const earlier = f.refresh(f.task.taskId);
  await entered;
  assert.equal(captured.state, 'running');
  const cancellation = await f.cancel(f.task.taskId);
  assert.equal(cancellation.cancelAccepted, true);
  await job;
  const event = f.app.readEvents().findLast(event => event.taskId === f.task.taskId && event.type === 'task.cancelled');
  assert.ok(event);
  f.context.applyEvent(event);
  const current = f.tasks.get(f.task.taskId), count = f.published.length;
  assert.equal(current.state, 'cancelled');
  assert.ok(current.revision > captured.revision);
  release();
  assert.equal(await earlier, current);
  assert.equal(f.tasks.get(f.task.taskId), current);
  assert.equal(f.published.length, count);
  assert.equal(f.app.runtime.getTask(f.task.taskId).state, 'cancelled');
});

test('the actual refresh still accepts initial, newer and equal public task revisions', async t => {
  const f = await fixture(t);
  const initial = await f.refresh(f.task.taskId);
  assert.equal(initial.state, 'created');
  const job = f.app.runtime.runTask(f.task.taskId, async () => ({resultSummary: 'read-only fixture complete'}),
    {deadline: new Date(Date.now() + 60_000).toISOString(), sideEffect: 'read'});
  await job;
  const newer = await f.refresh(f.task.taskId);
  assert.equal(newer.state, 'succeeded');
  assert.ok(newer.revision > initial.revision);
  const equal = await f.refresh(f.task.taskId);
  assert.equal(equal.revision, newer.revision);
  assert.equal(f.tasks.get(f.task.taskId), equal);
  assert.equal(f.published.length, 3);
});
