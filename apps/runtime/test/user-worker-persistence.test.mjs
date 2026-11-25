import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRuntimeApplication} from '../dist/application.js';

test('user workers persist across runtime reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'user-worker-'));
  const path = join(directory, 'runtime.sqlite');
  let workerId;
  {
    const app = createRuntimeApplication({path, profile: 'huawei_ict_agentarts'});
    try {
      const created = app.createWorker({
        displayName: '我的编码工人',
        instructions: '只改本仓库允许的文件并跑检查',
        role: 'coder',
        preferredDriver: 'codex',
      });
      assert.equal(created.kind, 'user');
      assert.match(created.workerId, /^user-worker-/);
      workerId = created.workerId;
      assert.ok(app.listWorkers().some(item => item.workerId === workerId));
      assert.equal(app.resolveWorker({workerId}).action, 'reuse');
      app.renameWorker(workerId, {displayName: '仓库编码工人', instructions: '改名后仍只做编码'});
    } finally {
      app.close();
    }
  }
  {
    const app = createRuntimeApplication({path, profile: 'huawei_ict_agentarts'});
    try {
      const again = app.getWorker(workerId);
      assert.equal(again.displayName, '仓库编码工人');
      assert.equal(again.instructions, '改名后仍只做编码');
      assert.equal(again.kind, 'user');
      assert.ok(app.listWorkers().some(item => item.kind === 'builtin'));
      app.deleteWorker(workerId);
      assert.throws(() => app.getWorker(workerId), /Worker is not registered|找不到这个工人|NOT_FOUND/);
    } finally {
      app.close();
      await rm(directory, {recursive: true, force: true});
    }
  }
});

test('builtin workers cannot be deleted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'builtin-worker-'));
  const app = createRuntimeApplication({
    path: join(directory, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts',
  });
  try {
    assert.throws(() => app.deleteWorker('worker-coder'), /内置工人|INVALID_ARGUMENT/);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});
