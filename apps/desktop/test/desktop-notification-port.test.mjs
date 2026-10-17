import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDesktopNotificationPort} from '../electron/desktop-notification-port.js';

function fakeNotifier({supported = true, showThrows = false, autoShow = true} = {}) {
  const shown = [];
  return {
    shown,
    async isSupported() { return supported; },
    async show(input, callbacks) {
      if (showThrows) throw Error('OS rejected');
      shown.push(input);
      if (autoShow) callbacks.onShow();
      return {close: () => {}};
    },
  };
}

test('delivery separates persist, system receipt and acknowledgement', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pa-notify-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const notifier = fakeNotifier();
  let clock = 1_000_000;
  const port = createDesktopNotificationPort({storageDir: dir, notifier, now: () => clock});

  const first = await port.sendAdvisoryNotification({id: 'n-1', title: '高负荷', body: 'CPU 92%', source: 'p5-device'});
  assert.equal(first.delivered, true, 'fake notifier fires show synchronously');
  assert.equal(notifier.shown.length, 1);
  const [record] = port.list();
  assert.equal(record.state, 'delivered');
  assert.equal(record.source, 'p5-device');
  assert.ok(record.deliveredAt);

  clock += 5_000;
  assert.deepEqual(port.acknowledge('n-1'), {acknowledged: true});
  assert.equal(port.list()[0].state, 'acknowledged');
  assert.ok(port.list()[0].acknowledgedAt);
  // 已读通知不能重复弹：同 id 再投递幂等返回。
  const retry = await port.sendAdvisoryNotification({id: 'n-1', title: '高负荷', body: 'CPU 92%'});
  assert.equal(retry.delivered, true);
  assert.equal(notifier.shown.length, 1, 'no duplicate system toast');
});

test('an unsupported environment is refused honestly instead of faking success', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pa-notify-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const notifier = fakeNotifier({supported: false});
  const port = createDesktopNotificationPort({storageDir: dir, notifier});
  const result = await port.sendAdvisoryNotification({id: 'n-2', title: '提醒', body: '到期'});
  assert.equal(result.delivered, false);
  assert.match(result.error, /系统通知在此环境不可用/);
  assert.equal(port.list()[0].state, 'failed');
  assert.equal(notifier.shown.length, 0);
});

test('a persisted-but-unconfirmed notification is never resent; only reconcile settles it', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pa-notify-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  // autoShow=false：show 事件不触发，模拟「落盘后、系统回执前」中断。
  const notifier = fakeNotifier({autoShow: false});
  let port = createDesktopNotificationPort({storageDir: dir, notifier});
  const pending = await port.sendAdvisoryNotification({id: 'n-3', title: '待确认', body: '中断前'});
  assert.equal(pending.delivered, false);
  assert.match(pending.error, /系统回执未确认/);
  assert.equal(port.list()[0].state, 'persisted');

  // 重启后同 id 重试：不重发、明确等待核实。
  const notifier2 = fakeNotifier();
  port = createDesktopNotificationPort({storageDir: dir, notifier: notifier2});
  const retry = await port.sendAdvisoryNotification({id: 'n-3', title: '待确认', body: '中断前'});
  assert.equal(retry.delivered, false);
  assert.match(retry.error, /persisted/);
  assert.equal(notifier2.shown.length, 0, 'unknown must not resend');

  // 只有受信宿主 reconcile 能收敛；用户不能把未确认通知标已读。
  assert.deepEqual(port.acknowledge('n-3'), {acknowledged: false});
  port.reconcile('n-3', true);
  assert.equal(port.list()[0].state, 'delivered');
  assert.deepEqual(port.acknowledge('n-3'), {acknowledged: true});

  // 反向核实：未投递 → failed，同样不重发。
  const notifier3 = fakeNotifier({autoShow: false});
  port = createDesktopNotificationPort({storageDir: dir, notifier: notifier3});
  await port.sendAdvisoryNotification({id: 'n-4', title: '另一条', body: '同样中断'});
  port.reconcile('n-4', false);
  assert.equal(port.list().find(record => record.id === 'n-4').state, 'failed');
  assert.match((await port.sendAdvisoryNotification({id: 'n-4', title: '另一条', body: '同样中断'})).error, /failed/);
});

test('bounded history never evicts an unresolved delivery', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pa-notify-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const notifier = fakeNotifier({autoShow: false});
  const port = createDesktopNotificationPort({storageDir: dir, notifier, maxRecords: 1});

  const first = await port.sendAdvisoryNotification({id: 'n-pending', title: '待核实', body: '不重发'});
  assert.equal(first.delivered, false);
  assert.equal(port.list()[0].state, 'persisted');

  const blocked = await port.sendAdvisoryNotification({id: 'n-next', title: '新通知', body: '等待容量'});
  assert.equal(blocked.delivered, false);
  assert.match(blocked.error, /落盘失败/);
  assert.deepEqual(port.list().map(record => record.id), ['n-pending']);
  assert.equal(notifier.shown.length, 1, 'full unresolved store must refuse before system delivery');

  const retry = await port.sendAdvisoryNotification({id: 'n-pending', title: '待核实', body: '不重发'});
  assert.match(retry.error, /persisted/);
  assert.equal(notifier.shown.length, 1);

  port.reconcile('n-pending', true);
  const admitted = await port.sendAdvisoryNotification({id: 'n-next', title: '新通知', body: '已腾出容量'});
  assert.equal(admitted.delivered, false);
  assert.deepEqual(port.list().map(record => record.id), ['n-next']);
  assert.equal(notifier.shown.length, 2);
});

test('a persistence failure or an OS rejection never reports delivery', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'pa-notify-'));
  t.after(() => rm(base, {recursive: true, force: true}));
  const noStorage = createDesktopNotificationPort({notifier: fakeNotifier()});
  const unpersisted = await noStorage.sendAdvisoryNotification({id: 'n-5', title: '无盘', body: '必须拒绝'});
  assert.equal(unpersisted.delivered, false);
  assert.match(unpersisted.error, /落盘失败/);

  const dir = path.join(base, 'store');
  await mkdir(dir, {recursive: true});
  const rejecting = createDesktopNotificationPort({storageDir: dir, notifier: fakeNotifier({showThrows: true})});
  const rejected = await rejecting.sendAdvisoryNotification({id: 'n-6', title: '系统拒绝', body: 'x'});
  assert.equal(rejected.delivered, false);
  assert.match(rejected.error, /系统通知展示失败/);
  assert.equal(rejecting.list()[0].state, 'persisted');
  assert.equal(rejecting.readDeliveryOutcome(rejecting.list()[0].id).deliveryState, 'unknown');
});
