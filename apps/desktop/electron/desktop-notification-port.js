import {existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

/**
 * 桌面系统通知端口（P2 专属组件，MOD-23 消费面）：把「排队 → 落盘 → 系统投递 → 用户已读」
 * 四层状态分开，并对齐既有语义——
 * - 投递意图先落盘，落盘失败不算 delivered；
 * - `delivered` 只按系统回执（Electron Notification 的 show 事件），不用「调用过 show」冒充；
 * - 落盘后、系统回执前中断 → 状态停在 `persisted`（= unknown）：**不自动重发**，
 *   只能由受信宿主经 `reconcile(id, delivered)` 核实后收敛；
 * - 同 id 重试幂等：返回既有状态，不重复弹系统通知；
 * - 系统通知不可用（非 Electron 环境 / isSupported()=false）→ `delivered:false` + 原因，不假成功。
 *
 * 系统通知器接缝（notifier）可注入：生产实现懒加载 Electron（动态 import，纯 Node 单测下
 * 不可用并如实返回 false），测试注入 Fake。
 */

const RECORDS_FILE = 'desktop-notifications.json';
const MAX_RECORDS = 200;

const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function validInput(input) {
  if (typeof input !== 'object' || input === null) return false;
  return text(input.id, 256) && text(input.title, 200) && text(input.body, 2000)
    && (input.source === undefined || text(input.source, 80));
}

/** 默认系统通知器：Electron Notification，懒加载。 */
function defaultNotifier() {
  let electronModule;
  const load = async () => {
    electronModule ??= await import('electron').catch(() => undefined);
    return electronModule;
  };
  return {
    async isSupported() {
      const electron = await load();
      return Boolean(electron?.Notification?.isSupported?.());
    },
    async show(input, callbacks) {
      const electron = await load();
      if (!electron?.Notification) throw Error('electron Notification unavailable');
      const notification = new electron.Notification({title: input.title, body: input.body});
      notification.on('show', callbacks.onShow);
      notification.on('click', callbacks.onClick);
      notification.on('failed', callbacks.onFailed);
      notification.show();
      return {close: () => notification.close()};
    },
  };
}

export function createDesktopNotificationPort(options = {}) {
  const notifier = options.notifier ?? defaultNotifier();
  const now = options.now ?? Date.now;
  const maxRecords = options.maxRecords ?? MAX_RECORDS;
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) throw Error('maxRecords must be a positive safe integer');
  const filePath = options.storageDir === undefined
    ? undefined : path.join(options.storageDir, RECORDS_FILE);

  let records = [];
  if (filePath !== undefined && existsSync(filePath)) {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.records)) {
      throw Error('desktop notification store is invalid');
    }
    records = parsed.records;
  }
  const openHandles = new Map();

  function persist(next) {
    if (filePath === undefined) throw Error('notification persistence is unavailable');
    const bounded = [...next];
    while (bounded.length > maxRecords) {
      const oldestTerminal = bounded.findIndex(record =>
        ['delivered', 'acknowledged', 'failed'].includes(record.state));
      if (oldestTerminal < 0) throw Error('unresolved notifications fill the store');
      bounded.splice(oldestTerminal, 1);
    }
    mkdirSync(path.dirname(filePath), {recursive: true});
    const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      writeFileSync(temporary, JSON.stringify({version: 1, records: bounded}, null, 2), {encoding: 'utf8', flag: 'wx'});
      renameSync(temporary, filePath);
      records = bounded;
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* best effort */ }
      throw error;
    }
  }

  function persistState(id, patch) {
    const index = records.findIndex(record => record.id === id);
    if (index < 0) return;
    const next = [...records];
    next[index] = {...next[index], ...patch};
    persist(next);
  }

  function readDeliveryOutcome(id) {
    const record = records.find(item => item.id === id);
    if (!record) return undefined;
    const delivered = ['delivered', 'acknowledged'].includes(record.state);
    return {id, deliveryState: delivered ? 'delivered' : record.state === 'failed' ? 'failed' : 'unknown',
      deliveredAt: record.deliveredAt, userRead: record.state === 'acknowledged',
      evidenceRefs: delivered ? [`desktop-notification:${id}:show`] : []};
  }
  const publishOutcome = id => {try {options.onOutcome?.(readDeliveryOutcome(id));} catch {}};

  return Object.freeze({
    /** P5 设备通知端口兼容入口：落盘意图 → 系统投递，delivered 只认系统回执。 */
    async sendAdvisoryNotification(input) {
      if (!validInput(input)) return {delivered: false, error: '通知输入无效'};
      const existing = records.find(record => record.id === input.id);
      if (existing) {
        // 幂等重试：不重复弹系统通知；persisted（= unknown）也绝不重发，交 reconcile。
        return existing.state === 'delivered' || existing.state === 'acknowledged'
          ? {delivered: true}
          : {delivered: false, error: `通知已处于 ${existing.state} 状态，等待受信宿主核实`};
      }
      const queuedAt = new Date(now()).toISOString();
      const record = {
        id: input.id, title: input.title, body: input.body,
        source: input.source ?? 'desktop', state: 'persisted', queuedAt,
      };
      try {
        persist([...records, record]);
      } catch {
        return {delivered: false, error: '通知投递意图落盘失败'};
      }
      let supported;
      try {
        supported = await notifier.isSupported();
      } catch {
        supported = false;
      }
      if (!supported) {
        persistState(record.id, {state: 'failed', error: '系统通知在此环境不可用'});
        return {delivered: false, error: '系统通知在此环境不可用'};
      }
      let settled = false;
      try {
        const handle = await notifier.show(
          {id: record.id, title: record.title, body: record.body},
          {
            onShow: () => {
              if (settled) return;
              settled = true;
              try {
                persistState(record.id, {state: 'delivered', deliveredAt: new Date(now()).toISOString()});
                publishOutcome(record.id);
              } catch { /* 回执落盘失败保持 persisted，交 reconcile */ }
            },
            onClick: () => {
              settled = true;
              const current = records.find(item => item.id === record.id);
              persistState(record.id, {
                state: 'acknowledged', acknowledgedAt: new Date(now()).toISOString(),
                ...(current?.deliveredAt === undefined ? {deliveredAt: new Date(now()).toISOString()} : {}),
              });
              publishOutcome(record.id);
            },
            onFailed: () => {
              if (settled) return;
              settled = true;
              try {persistState(record.id, {state: 'failed', error: '系统通知失败回执'}); publishOutcome(record.id);} catch {}
            },
          },
        );
        openHandles.set(record.id, handle);
      } catch (error) {
        // show may throw after the OS accepted the notification. The original
        // persisted intent is unknown until an independent receipt/readback.
        return {delivered: false, error: '系统通知展示失败'};
      }
      // show 事件异步到达：本轮按 pending 返回未投递；状态落为 delivered 后同 id 重试得 true。
      const after = records.find(item => item.id === record.id);
      return after?.state === 'delivered' ? {delivered: true} : {delivered: false, error: '系统回执未确认（pending）'};
    },

    /** 用户已读（面板点击等）；未投递/未确认的通知不标记已读。 */
    acknowledge(id) {
      const record = records.find(item => item.id === id);
      if (record === undefined || record.state === 'failed' || record.state === 'persisted') {
        return {acknowledged: false};
      }
      persistState(id, {state: 'acknowledged', acknowledgedAt: new Date(now()).toISOString()});
      publishOutcome(id);
      openHandles.get(id)?.close();
      openHandles.delete(id);
      return {acknowledged: true};
    },

    /** 只有受信宿主可核实中断投递的真实结果；unknown 不重发，核实后才收敛。 */
    reconcile(id, delivered) {
      const record = records.find(item => item.id === id);
      if (record === undefined || record.state !== 'persisted') return;
      persistState(id, delivered
        ? {state: 'delivered', deliveredAt: new Date(now()).toISOString()}
        : {state: 'failed', error: '受信宿主确认未投递'});
      publishOutcome(id);
    },

    readDeliveryOutcome,

    list() {
      return records.map(record => ({...record}));
    },

    dispose() {
      for (const handle of openHandles.values()) {
        try { handle.close(); } catch { /* best effort */ }
      }
      openHandles.clear();
    },
  });
}
