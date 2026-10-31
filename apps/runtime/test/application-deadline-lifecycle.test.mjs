import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRuntimeApplication} from '../dist/application.js';
import {TaskRuntime} from '../dist/index.js';

const nextTurn = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await nextTurn();
  }
  assert.fail('Application lifecycle did not settle');
}

test('production application deadline settles a noncooperative worker, preserves its terminal snapshot and releases close', async t => {
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
  const directory = await mkdtemp(join(tmpdir(), 'application-deadline-'));
  const path = join(directory, 'runtime.sqlite');
  let release, workerSignal;
  const app = createRuntimeApplication({path, profile: 'huawei_ict_agentarts',
    coordination: {execute: async request => {
      workerSignal = request.signal;
      return new Promise(resolve => { release = resolve; });
    }}});
  let closed = false;
  try {
    const deadline = new Date(Date.now() + 250).toISOString();
    const response = await app.send({kind: 'request', protocolVersion: '1.0.0', requestId: 'deadline-lifecycle',
      operation: 'task.submit', deadline, idempotencyKey: 'deadline-lifecycle',
      payload: {goal: 'Synthetic noncooperative model', conversationId: 'deadline-lifecycle'}}, new AbortController().signal);
    assert.equal(response.outcome, 'ok');
    const id = response.data.taskId;
    await until(() => Boolean(release));
    assert.equal(app.runtime.getTask(id).state, 'running');
    assert.equal(workerSignal.aborted, false);
    assert.equal(app.runtime.loadCheckpoint(id, 'application-deadline'), deadline);
    assert.throws(() => app.close(), {code: 'REVISION_CONFLICT'});
    t.mock.timers.tick(250);
    await until(() => app.activeTaskCount === 0);
    const snapshot = app.runtime.getTask(id);
    assert.equal(snapshot.state, 'failed');
    assert.equal(snapshot.error.code, 'TIMEOUT');
    assert.equal(workerSignal.aborted, true);
    assert.deepEqual(app.runtime.readToolExecutions(id), []);
    release({kind: 'text', text: 'Late synthetic answer', verification: 'mock'});
    await nextTurn();
    assert.deepEqual(app.runtime.getTask(id), snapshot);
    app.close(); closed = true;
    const reopened = new TaskRuntime(path);
    try { assert.deepEqual(reopened.getTask(id), snapshot); }
    finally { reopened.close(); }
  } finally {
    if (!closed) app.close();
    await rm(directory, {recursive: true, force: true});
  }
});
