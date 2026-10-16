import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspacePatchRecoveryAction} from '../electron/workspace-patch-recovery-action.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function fixture() {
  let live = {taskId:'task-1', state:'waiting_reconciliation', revision:4};
  let cached = {...live}, currentApplication, currentAdmin, enabled = true, destroyed = false;
  let reconcileCalls = 0, getCalls = 0, cacheWrites = 0;
  const publications = [], entered = deferred(), response = deferred();
  const application = {
    runtime:{getTask(id) { assert.equal(id, 'task-1'); return {...live}; }},
    async reconcileWorkspacePatchTask(id) {
      assert.equal(id, 'task-1');
      reconcileCalls++;
      live = {...live, state:'cancelled', revision:5};
      return {taskId:id, runId:'original-run', result:{state:'reconciled', outcome:'applied'}};
    },
  };
  const webContents = {mainFrame:{}};
  const admin = {webContents, isDestroyed:() => destroyed};
  currentApplication = application; currentAdmin = admin;
  const refresh = async (id, isCurrent = () => true) => {
    if (!isCurrent()) throw Error('Task refresh session changed');
    assert.equal(id, 'task-1');
    getCalls++; entered.resolve();
    const task = await response.promise;
    if (!isCurrent()) throw Error('Task refresh session changed');
    if (cached.taskId === task.taskId && cached.revision > task.revision) return cached;
    cached = {...task}; cacheWrites++;
    publications.push({...cached});
    return cached;
  };
  const action = createWorkspacePatchRecoveryAction({
    getApplication:() => currentApplication, getAdmin:() => currentAdmin,
    isEnabled:() => enabled, refresh,
  });
  return {
    run:() => action({sender:webContents, senderFrame:webContents.mainFrame},
      {taskId:'task-1', expectedRevision:4}),
    entered:entered.promise, resolve:response.resolve, reject:response.reject,
    setCached(value) { cached = {...value}; },
    revoke(kind) {
      if (kind === 'disabled') enabled = false;
      if (kind === 'replaced admin') currentAdmin = {webContents, isDestroyed:() => false};
      if (kind === 'destroyed admin') destroyed = true;
      if (kind === 'replaced application') currentApplication = {};
    },
    state:() => ({cached, live, publications, reconcileCalls, getCalls, cacheWrites}),
  };
}

const refreshed = {taskId:'task-1', state:'cancelled', revision:5};

test('recovery refreshes the task before its only publication', async () => {
  const f = fixture(), pending = f.run();
  await f.entered; f.resolve(refreshed);
  assert.deepEqual(await pending, {taskId:'task-1', runId:'original-run',
    revision:5, taskState:'cancelled', outcome:'applied'});
  const state = f.state();
  assert.deepEqual(state.cached, refreshed);
  assert.deepEqual(state.publications, [refreshed]);
  assert.equal(state.cacheWrites, 1);
  assert.equal(state.reconcileCalls, 1);
  assert.equal(state.getCalls, 1);
});

test('a newer cached event is not overwritten by an older task.get response', async () => {
  const f = fixture();
  f.setCached({...refreshed, revision:6});
  const pending = f.run();
  await f.entered; f.resolve(refreshed);
  await pending;
  assert.equal(f.state().cached.revision, 6);
  assert.equal(f.state().cacheWrites, 0);
  assert.deepEqual(f.state().publications, []);
});

test('session changes during task.get suppress publication after reconciliation', async t => {
  for (const kind of ['disabled', 'replaced admin', 'destroyed admin', 'replaced application']) {
    await t.test(kind, async () => {
      const f = fixture(), pending = f.run();
      const rejected = assert.rejects(pending, /核实会话已失效/);
      await f.entered; f.revoke(kind); f.resolve(refreshed);
      await rejected;
      const state = f.state();
      assert.equal(state.cached.revision, 4);
      assert.equal(state.live.revision, 5);
      assert.equal(state.cacheWrites, 0);
      assert.deepEqual(state.publications, []);
      assert.equal(state.reconcileCalls, 1);
      assert.equal(state.getCalls, 1);
    });
  }
});

test('failed refresh reports a fixed error without replay or stale publication', async () => {
  const f = fixture(), pending = f.run();
  const rejected = assert.rejects(pending, error => {
    assert.equal(error.message,
      '核实可能已完成，但无法刷新任务状态；请重新打开原任务核对，不要重复执行补丁。');
    return true;
  });
  await f.entered; f.reject(Error('PRIVATE_PATH credential detail'));
  await rejected;
  const state = f.state();
  assert.equal(state.live.revision, 5);
  assert.equal(state.cached.revision, 4);
  assert.equal(state.cacheWrites, 0);
  assert.deepEqual(state.publications, []);
  assert.equal(state.reconcileCalls, 1);
  assert.equal(state.getCalls, 1);
});
