import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {
  createDesktopNotificationPort,
  nativeNotificationTag,
  parseNotificationActivationTag,
} from '../electron/desktop-notification-port.js';
import {createEncryptedAutonomyStore, createRiskAutonomyHost} from '../electron/risk-autonomy-host.js';

function fakeNotifier({autoShow = true} = {}) {
  const shown = [];
  const callbacks = new Map();
  return {
    shown,
    callbacks,
    async isSupported() { return true; },
    async show(input, events) {
      shown.push(input);
      callbacks.set(input.id, events);
      if (autoShow) events.onShow();
      return {close() {}};
    },
  };
}

test('nativeNotificationTag is alphanumeric and stable for logical ids with punctuation', () => {
  const tag = nativeNotificationTag('risk-autonomy:audit-1');
  assert.match(tag, /^[a-f0-9]{32}$/u);
  assert.equal(tag, nativeNotificationTag('risk-autonomy:audit-1'));
  assert.notEqual(tag, nativeNotificationTag('risk-autonomy:audit-2'));
});

test('parseNotificationActivationTag reads Electron toast launch arguments', () => {
  assert.equal(parseNotificationActivationTag('type=click&tag=abc123'), 'abc123');
  assert.equal(parseNotificationActivationTag('type=action&action=0&tag=deadbeef'), 'deadbeef');
  assert.equal(parseNotificationActivationTag(''), undefined);
  assert.equal(parseNotificationActivationTag('type=click'), undefined);
});

test('activateById after live handle disposal still acknowledges and fires callbacks', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pa-notify-cold-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const notifier = fakeNotifier();
  const clicks = [];
  const navigations = [];
  const port = createDesktopNotificationPort({
    storageDir: dir,
    notifier,
    onClick: record => clicks.push(record.id),
    onNavigate: record => navigations.push(record.navigation),
  });
  await port.sendAdvisoryNotification({
    id: 'risk-autonomy:undo-1',
    title: '已自动完成',
    body: '点击撤销',
    navigation: {kind: 'briefing'},
  });
  const record = port.list()[0];
  assert.equal(record.state, 'delivered');
  assert.equal(record.nativeTag, nativeNotificationTag('risk-autonomy:undo-1'));
  assert.equal(notifier.shown[0].nativeTag, record.nativeTag);

  port.dispose();
  // 释放内存 Notification 后，冷激活仍按落盘 Tag/id 复现点击。
  const restored = createDesktopNotificationPort({
    storageDir: dir,
    notifier: fakeNotifier(),
    onClick: record => clicks.push(record.id),
    onNavigate: record => navigations.push(record.navigation),
  });
  const byTag = restored.activateByNativeTag(record.nativeTag);
  assert.equal(byTag.activated, true);
  assert.equal(restored.list()[0].state, 'acknowledged');
  assert.deepEqual(clicks, ['risk-autonomy:undo-1']);
  assert.deepEqual(navigations, [{kind: 'briefing'}]);

  const again = restored.activateById('risk-autonomy:undo-1');
  assert.equal(again.activated, true);
  assert.equal(again.reason, 'already');
  assert.equal(clicks.length, 1, 'already-acknowledged must not re-fire compensate callbacks');
});

test('risk autonomy compensate runs from activateById without a live OS notification', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pa-notify-risk-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const digest = 'c'.repeat(64);
  const values = new Map();
  const storage = {
    get: key => values.has(key) ? structuredClone(values.get(key)) : undefined,
    set(key, value) { values.set(key, structuredClone(value)); },
  };
  const calls = [];
  const notifier = fakeNotifier();
  let host;
  const port = createDesktopNotificationPort({
    storageDir: dir,
    notifier,
    onClick: record => { host.compensate(record.id); },
  });
  host = createRiskAutonomyHost({
    store: createEncryptedAutonomyStore(storage),
    channel: port,
    getApplication: () => ({
      submitHostToolTask(request) {
        calls.push(request);
        return {task: {taskId: 'undo-task', state: 'waiting_approval'}, approval: {approvalId: 'approval-1', revision: 1, state: 'pending'}};
      },
      runtime: {respondApproval(id, decision, revision) { calls.push({id, decision, revision}); }},
      resumeHostToolTask(taskId) { calls.push({resume: taskId}); },
    }),
  });
  host.setStance('autonomous');
  host.gate.recordGranted({
    taskId: 'task-1', runId: 'run-1', toolName: 'todo.update', toolVersion: '1.0.0',
    sideEffect: 'local_write', recoverySupport: true, requiresPresence: false, argumentsDigest: digest,
    disposition: 'execute_and_notify',
  });
  host.gate.rememberCompensation({runId: 'run-1', toolName: 'notes.restore', toolVersion: '1.0.0', arguments: {note: 'back'}});
  await host.gate.notifyGranted({runId: 'run-1'});
  const notice = port.list().find(item => item.source === 'risk-autonomy');
  assert.ok(notice);
  assert.equal(notice.state, 'delivered');

  const cold = createDesktopNotificationPort({
    storageDir: dir,
    notifier: fakeNotifier(),
    onClick: record => { host.compensate(record.id); },
  });
  const result = cold.activateByNativeTag(notice.nativeTag);
  assert.equal(result.activated, true);
  assert.equal(calls[0].toolName, 'notes.restore');
  assert.deepEqual(calls[1], {id: 'approval-1', decision: 'allow_once', revision: 1});
  assert.deepEqual(calls[2], {resume: 'undo-task'});
});

test('main wires Windows handleActivation, crew replan, locate open, and briefing.openDecision', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(main, /Notification\.handleActivation/);
  assert.match(main, /parseNotificationActivationTag/);
  assert.match(main, /activateByNativeTag/);
  assert.match(main, /sender !== admin && sender !== panel && sender !== workspace/);
  assert.match(main, /name === 'briefing\.openDecision'/);
  assert.match(main, /createCrewReplanDispatcher/);
  assert.match(main, /dispatchParentReplan/);
  assert.match(main, /name === 'task\.locate\.open'/);
  assert.match(main, /createLocateOpenHost/);
});
