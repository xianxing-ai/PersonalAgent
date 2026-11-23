import {randomUUID} from 'node:crypto';
import * as notifications from '@personal-agent/notifications';
import {
  dashboardReadWindow, dashboardScheduleInput, dueDashboardBoundary, nextDashboardBoundary,
  personalDashboardConversationId, summarizePersonalDashboard,
} from '@personal-agent/cognition';
import {createEncryptedModuleStorage} from './encrypted-module-storage.js';
import {createDesktopDashboardSources} from './personal-dashboard-sources.js';

const PERIODS = ['daily', 'weekly', 'monthly'];
const SETTINGS = 'personal-dashboard-settings';
const LATEST = 'personal-dashboard-latest';
const RECEIPTS = 'personal-dashboard-receipts';

/** Registers the rollup on the existing Scheduler and stores only encrypted aggregates. */
export function createPersonalDashboardHost({
  userData, safeStorage, namespace, runtime, dispatchTask, now = Date.now, timeZone,
  onUpdate = () => {}, onNotification = () => {}, sources, calendarConfig, meetingSnapshot, mailConfig,
} = {}) {
  if (!runtime || typeof dispatchTask !== 'function') throw new Error('个人数据看板需要既有 Scheduler');
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const storage = createEncryptedModuleStorage({userData, safeStorage, filename: 'personal-dashboard.json'});
  const conversationId = personalDashboardConversationId(namespace);
  const readers = sources ?? createDesktopDashboardSources({calendarConfig, meetingSnapshot, mailConfig, now});
  const notificationService = new notifications.NotificationService(storage, {}, {now, idFactory: randomUUID});
  let recovered = false;
  let busy = false;
  let lastTick = -Infinity;
  const settings = () => {
    const saved = storage.get(SETTINGS);
    const period = PERIODS.includes(saved?.period) ? saved.period : 'weekly';
    return {period};
  };
  const receipts = () => storage.get(RECEIPTS) ?? {};
  function remember(scheduleId, summary) {
    storage.set(LATEST, summary);
    storage.set(RECEIPTS, {...receipts(), [scheduleId]: {generatedAt: summary.generatedAt, headline: summary.headline}});
  }
  function notify(scheduleId, headline) {
    const at = new Date(now()).toISOString();
    const ingested = notificationService.ingest([{
      source: 'personal-dashboard', accountRef: 'local', externalId: scheduleId, occurredAt: at, fetchedAt: at,
      contentRef: headline, sensitivity: 'private', dedupeKey: scheduleId,
    }], {scope: {kind: 'connector', connectorId: 'personal-dashboard'}});
    if (ingested.accepted !== 1) return;
    for (const batch of notificationService.drain().batches) notificationService.acknowledge(batch.id);
    try { onNotification({title: '个人数据已汇总', body: headline}); } catch { /* The board already has the summary. */ }
  }
  async function rollup(schedule, signal) {
    const known = receipts()[schedule.scheduleId];
    if (known) return known.headline;
    const runAtMs = Date.parse(schedule.runAt);
    const period = periodOf(schedule);
    const window = dashboardReadWindow(period, runAtMs, zone);
    const readings = {
      time: await readers.readTime(window, signal),
      mail: await readers.readMail(window, signal),
      spend: await readers.readSpend(window, signal),
      briefing: await readers.readBriefing(window, signal),
    };
    const summary = summarizePersonalDashboard({
      period, runAtMs, timeZone: zone, generatedAt: new Date(now()).toISOString(), readings,
    });
    remember(schedule.scheduleId, summary);
    notify(schedule.scheduleId, summary.headline);
    return summary.headline;
  }
  function desired(period, afterFire) {
    const pending = runtime.listSchedules(conversationId).filter(item => item.status === 'pending');
    const inputs = [];
    for (const item of pending) {
      if (Date.parse(item.runAt) <= now()) inputs.push(scheduleOf(item));
    }
    const boundary = afterFire ? nextDashboardBoundary(period, now(), zone) : dueDashboardBoundary(period, now(), zone);
    const candidate = dashboardScheduleInput({namespace, period, runAtMs: boundary, timeZone: zone});
    if (!inputs.some(item => item.scheduleId === candidate.scheduleId)) inputs.push(candidate);
    return inputs;
  }
  async function runFired() {
    for (const schedule of runtime.listSchedules(conversationId)) {
      if (schedule.status !== 'fired' || !schedule.taskId || receipts()[schedule.scheduleId]) continue;
      const task = runtime.getTask(schedule.taskId);
      if (task.state !== 'created') continue;
      await dispatchTask(runtime, task.taskId, signal => rollup(schedule, signal).then(resultSummary => ({resultSummary})));
    }
  }
  async function tick(force = false) {
    if (busy || (!force && now() - lastTick < 1000)) return snapshot();
    busy = true;
    lastTick = now();
    try {
      const period = settings().period;
      runtime.reconcileSchedules(conversationId, desired(period, false));
      if (recovered) runtime.dispatchDueSchedules(conversationId);
      else { runtime.recoverMissedSchedules(conversationId); recovered = true; }
      await runFired();
      runtime.reconcileSchedules(conversationId, desired(period, true));
      onUpdate();
    } finally { busy = false; }
    return snapshot();
  }
  function snapshot() {
    const latest = storage.get(LATEST);
    const period = settings().period;
    const upcoming = runtime.listSchedules(conversationId).find(item => item.status === 'pending');
    return {
      available: true,
      period,
      summaryPeriod: latest?.period ?? null,
      generatedAt: latest?.generatedAt ?? null,
      cards: latest?.cards ?? [],
      nextRunAt: upcoming?.runAt ?? null,
      reason: latest ? '' : '已排期。到点后只汇总已授权的数据源',
    };
  }
  return {
    start: () => tick(true),
    tick,
    snapshot,
    setPeriod(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => key !== 'period')
        || !PERIODS.includes(payload.period)) throw new Error('汇总周期无效');
      storage.set(SETTINGS, {period: payload.period});
      runtime.reconcileSchedules(conversationId, desired(payload.period, true));
      onUpdate();
      return snapshot();
    },
  };
}

function periodOf(schedule) {
  const match = /:(daily|weekly|monthly):\d{4}-\d{2}-\d{2}T/.exec(schedule.scheduleId);
  if (!match) throw new Error('汇总周期无效');
  return match[1];
}

function scheduleOf(snapshot) {
  return {
    scheduleId: snapshot.scheduleId, goal: snapshot.goal, conversationId: snapshot.conversationId,
    runAt: snapshot.runAt, timeZone: snapshot.timeZone, missedRunPolicy: snapshot.missedRunPolicy,
    taskIdempotencyKey: snapshot.taskIdempotencyKey,
  };
}
