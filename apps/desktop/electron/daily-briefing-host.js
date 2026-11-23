import {existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildDailyBriefing, briefingNotification, planDailyBriefingSchedule} from '@personal-agent/cognition';

const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const FILE_NAME = 'daily-briefing.json';
const TASK_STATES = ['succeeded', 'failed', 'waiting_reconciliation', 'waiting_external', 'cancelling', 'waiting_approval'];

function emptyState() {
  return {version: 1, enabled: true, localTime: '08:00', briefings: []};
}

function validState(value) {
  return value && value.version === 1 && typeof value.enabled === 'boolean' && LOCAL_TIME.test(value.localTime)
    && Array.isArray(value.briefings);
}

/**
 * Registers one daily schedule on the existing Scheduler and, when it fires,
 * stores a redacted briefing and asks the existing notification port to show it.
 * Settings changes apply immediately; there is no separate save action.
 */
export function createDailyBriefingHost({userData, namespace, createDeliveryHost, getRuntime, notify, onOpen = () => {},
  onUpdate = () => {}, now = Date.now, timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone, adapters = {}}) {
  if (!userData || !namespace || typeof createDeliveryHost !== 'function' || typeof getRuntime !== 'function' || typeof notify !== 'function') {
    throw Error('每日简报宿主缺少调度或通知端口');
  }
  const proactive = adapters.proactive ?? {listCompletedSince() { return 'unavailable'; }};
  const risk = adapters.risk ?? {grade() { return 'unavailable'; }};
  const recovery = adapters.recovery ?? {outcome() { return 'unavailable'; }};
  const filePath = path.join(userData, FILE_NAME);
  const conversationId = `daily-briefing:${namespace}`;
  let delivery, busy = false, pending = false, failure = '', published = '';

  function read() {
    if (!existsSync(filePath)) return emptyState();
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!validState(parsed)) throw Error('daily briefing store is invalid');
    return parsed;
  }
  function write(state) {
    mkdirSync(userData, {recursive: true});
    const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      writeFileSync(temporary, JSON.stringify(state), {encoding: 'utf8', flag: 'wx'});
      renameSync(temporary, filePath);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* best effort */ }
      throw error;
    }
  }

  function zone() {
    const value = timeZone();
    new Intl.DateTimeFormat('en', {timeZone: value}).format(0);
    return value;
  }

  function pages(load) {
    const items = [];
    let before, snapshot;
    for (let page = 0; page < 3; page += 1) {
      const result = load(before, snapshot);
      items.push(...result.items);
      snapshot = result.snapshotSequence;
      const next = result.nextBeforeSequence ?? result.nextBeforeRowId;
      if (next === undefined) break;
      before = next;
    }
    return items;
  }

  function sources(runtime) {
    const tasks = TASK_STATES.flatMap(state => pages((before, snapshot) => runtime.listTasks({
      states: [state], limit: 100,
      ...(before === undefined ? {} : {beforeSequence: before, snapshotSequence: snapshot}),
    }))).map(task => ({taskId: task.taskId, conversationId: task.conversationId, state: task.state, goal: task.goal, updatedAt: task.updatedAt}));
    const approvals = pages((before) => runtime.listApprovals({
      state: 'pending', limit: 100, ...(before === undefined ? {} : {beforeRowId: before}),
    })).map(item => ({approvalId: item.approvalId, taskId: item.taskId, action: item.action, state: item.state}));
    const current = new Date(now()).toISOString();
    const start = new Date(Date.parse(current) - 36 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.parse(current) + 36 * 60 * 60 * 1000).toISOString();
    const schedules = (typeof runtime.listScheduleWindow === 'function' ? runtime.listScheduleWindow({from: start, to: end, limit: 100}) : [])
      .map(item => ({scheduleId: item.scheduleId, conversationId: item.conversationId, goal: item.goal, runAt: item.runAt, status: item.status, timeZone: item.timeZone}));
    return {tasks, approvals, schedules};
  }

  function desired(state) {
    if (!state.enabled) return [];
    return [planDailyBriefingSchedule({
      conversationId, localTime: state.localTime, timeZone: zone(), now: new Date(now()).toISOString(),
      briefedDates: state.briefings.map(item => item.document?.localDate).filter(Boolean),
    })];
  }

  function enqueue(schedule) {
    const state = read();
    if (state.briefings.some(item => item.scheduleId === schedule.scheduleId || item.document?.localDate && schedule.scheduleId.includes(item.document.localDate))) return;
    const runtime = getRuntime();
    if (!runtime) throw Error('Runtime 尚未就绪');
    const loaded = sources(runtime);
    const document = buildDailyBriefing({
      now: new Date(now()).toISOString(), timeZone: zone(), ...loaded,
      excludeConversationPrefix: 'daily-briefing:',
      proactive, risk, recovery,
    });
    state.briefings = [...state.briefings, {scheduleId: schedule.scheduleId, noticeAttempted: false, document}].slice(-14);
    write(state);
  }
  function readReceipt(scheduleId) {
    const state = read();
    return state.briefings.some(item => item.scheduleId === scheduleId || item.document?.localDate && scheduleId.includes(item.document.localDate));
  }

  function ensure(runtime) {
    delivery ??= createDeliveryHost({runtime, conversationId, enqueue, readReceipt, now});
  }

  function snapshot() {
    let state;
    try { state = read(); }
    catch { return {available: false, enabled: true, localTime: '08:00', briefing: null, reason: '简报记录无法读取'}; }
    const latest = state.briefings.at(-1)?.document ?? null;
    return {available: true, enabled: state.enabled, localTime: state.localTime, briefing: latest, ...(failure ? {reason: failure} : {})};
  }

  async function tick() {
    if (busy) { pending = true; return; }
    busy = true;
    try {
      do {
        pending = false;
        const runtime = getRuntime();
        if (!runtime) return;
        ensure(runtime);
        const state = read();
        await delivery.tick(desired(state));
        const saved = read();
        const record = saved.briefings.at(-1);
        if (record && !record.noticeAttempted) {
          record.noticeAttempted = true;
          write(saved);
          const notice = briefingNotification(record.document);
          await notify({id: notice.id, title: notice.title, body: notice.body, source: 'daily-briefing'});
        }
        failure = '';
      } while (pending);
    } catch {
      failure = '简报调度暂未完成，已保存的简报仍可查看';
    } finally {
      busy = false;
      const next = JSON.stringify(snapshot());
      if (next !== published) { published = next; onUpdate(); }
    }
  }

  return {
    snapshot,
    tick,
    update(input) {
      if (typeof input?.enabled !== 'boolean' || !LOCAL_TIME.test(input.localTime ?? '')) throw Error('每日简报设置无效');
      const state = read();
      state.enabled = input.enabled;
      state.localTime = input.localTime;
      write(state);
      void tick();
      return snapshot();
    },
    noteOutcome(outcome) {
      if (!outcome || typeof outcome.id !== 'string' || !outcome.id.startsWith('daily-briefing-notice:') || !outcome.clickedAt) return;
      onOpen();
    },
    async close() { await delivery?.close?.(); },
  };
}
