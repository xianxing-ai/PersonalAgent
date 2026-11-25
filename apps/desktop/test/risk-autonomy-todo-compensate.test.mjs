import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FakeStorage, FakeToolHost} from '@personal-agent/testkit';
import {PRODUCTIVITY_MODULE_VERSION, register, TodoService} from '@personal-agent/productivity';
import {
  createDesktopNotificationPort,
} from '../electron/desktop-notification-port.js';
import {createEncryptedAutonomyStore, createRiskAutonomyHost} from '../electron/risk-autonomy-host.js';

function fakeNotifier() {
  return {
    async isSupported() { return true; },
    async show(_input, events) {
      events.onShow();
      return {close() {}};
    },
  };
}

test('toast cold activate compensates todo.create via executable recovery and storage readback', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pa-todo-compensate-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const storage = new FakeStorage().namespace('todo');
  const service = new TodoService(storage, {
    now: () => Date.parse('2026-11-20T00:00:00.000Z'),
    idFactory: () => 'todo_compensate_1',
  });
  const toolHost = new FakeToolHost(() => Date.parse('2026-11-20T00:00:00.000Z'));
  register(toolHost, {
    storage,
    conversationId: 'risk-undo',
    now: () => Date.parse('2026-11-20T00:00:00.000Z'),
    idFactory: () => 'todo_compensate_1',
  });
  const created = await toolHost.invoke('todo.create', {title: '自动创建待撤销'}, {
    taskId: 'create-task',
    runId: 'create-run',
    signal: new AbortController().signal,
    deadline: '2026-11-20T01:00:00.000Z',
    authorizationRef: 'create-auth',
    scopes: ['todo:write'],
  });
  assert.equal(created.item.status, 'open');
  assert.deepEqual(created.recovery, {
    toolName: 'todo.update',
    toolVersion: PRODUCTIVITY_MODULE_VERSION,
    arguments: {id: created.item.id, status: 'cancelled', expectedRevision: created.item.revision},
  });

  const values = new Map();
  const autonomyStore = {
    get: key => values.has(key) ? structuredClone(values.get(key)) : undefined,
    set(key, value) { values.set(key, structuredClone(value)); },
  };
  let host;
  const port = createDesktopNotificationPort({
    storageDir: dir,
    notifier: fakeNotifier(),
    onClick: record => { host.compensate(record.id); },
  });
  const executed = [];
  host = createRiskAutonomyHost({
    store: createEncryptedAutonomyStore(autonomyStore),
    channel: port,
    getApplication: () => ({
      submitHostToolTask(request) {
        executed.push(structuredClone(request));
        const item = service.update(request.arguments.id, {
          status: request.arguments.status,
          expectedRevision: request.arguments.expectedRevision,
        });
        return {task: {taskId: 'undo-task', state: 'succeeded', result: {item}}, approval: undefined};
      },
      runtime: {respondApproval() { throw new Error('should not need approval for fixture'); }},
    }),
  });
  host.setStance('autonomous');
  host.gate.recordGranted({
    taskId: 'create-task', runId: 'create-run', toolName: 'todo.create', toolVersion: PRODUCTIVITY_MODULE_VERSION,
    sideEffect: 'local_write', recoverySupport: true, requiresPresence: false, argumentsDigest: 'a'.repeat(64),
    disposition: 'execute_and_notify',
  });
  host.gate.rememberCompensation({
    runId: 'create-run',
    toolName: created.recovery.toolName,
    toolVersion: created.recovery.toolVersion,
    arguments: created.recovery.arguments,
  });
  await host.gate.notifyGranted({runId: 'create-run'});
  const notice = port.list().find(item => item.source === 'risk-autonomy');
  assert.ok(notice);

  // Dispose live handles, then cold-activate like Windows Action Center.
  port.dispose();
  const cold = createDesktopNotificationPort({
    storageDir: dir,
    notifier: fakeNotifier(),
    onClick: record => { host.compensate(record.id); },
  });
  const activation = cold.activateByNativeTag(notice.nativeTag);
  assert.equal(activation.activated, true);
  assert.equal(executed[0].toolName, 'todo.update');
  assert.deepEqual(executed[0].arguments, created.recovery.arguments);

  const undone = service.list().find(item => item.id === created.item.id);
  assert.equal(undone.status, 'cancelled');
  assert.equal(undone.revision, created.item.revision + 1);
});
