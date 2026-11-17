/** Daily result briefing. Callers supply already-loaded task, approval and schedule
 * snapshots. This module does not read mail, copy result text, or own a scheduler. */

export const DAILY_BRIEFING_GOAL = '生成每日结果简报';
const ITEM_LIMIT = 8;
const SECRET = /(?:^|\s)(?:from|to|subject|正文|password|passwd|token|secret|api[_-]?key)\b|@[a-z0-9.-]+\.[a-z]{2,}|https?:\/\//iu;
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export type DailyBriefingRisk = 'low' | 'medium' | 'high';

/** CW-03 / #631. Safe titles only. Return 'unavailable' until that work is wired. */
export interface DailyBriefingProactiveSource {
  listCompletedSince(sinceIso: string): readonly {id: string; title: string; completedAt: string}[] | 'unavailable';
}

/** #630. Return 'unavailable' until risk grades are wired. */
export interface DailyBriefingRiskSource {
  grade(ref: {kind: 'task' | 'approval' | 'schedule'; id: string}): DailyBriefingRisk | 'unavailable';
}

/** #633. Return 'unavailable' until failure recovery is wired. */
export interface DailyBriefingRecoverySource {
  outcome(taskId: string): 'healed' | 'still_failed' | 'unavailable';
}

export interface DailyBriefingTaskRef {
  taskId: string;
  conversationId: string;
  state: string;
  goal?: string;
  updatedAt: string;
}

export interface DailyBriefingApprovalRef {
  approvalId: string;
  taskId: string;
  action?: string;
  state: string;
}

export interface DailyBriefingScheduleRef {
  scheduleId: string;
  conversationId: string;
  goal?: string;
  runAt: string;
  status: string;
  timeZone?: string;
}

export interface DailyBriefingInput {
  now: string;
  timeZone: string;
  tasks: readonly DailyBriefingTaskRef[];
  approvals: readonly DailyBriefingApprovalRef[];
  schedules: readonly DailyBriefingScheduleRef[];
  /** Conversations owned by the briefing wake itself. */
  excludeConversationPrefix?: string;
  proactive?: DailyBriefingProactiveSource;
  risk?: DailyBriefingRiskSource;
  recovery?: DailyBriefingRecoverySource;
}

export interface DailyBriefingItem {
  id: string;
  title: string;
  riskLabel?: '低' | '中' | '高';
}

export interface DailyBriefingDecision extends DailyBriefingItem {
  taskId: string;
  approvalId: string;
}

export interface DailyBriefingScheduleHighlight extends DailyBriefingItem {
  displayTime: string;
}

export interface DailyBriefingDocument {
  localDate: string;
  generatedAt: string;
  timeZone: string;
  since: string;
  completed: DailyBriefingItem[];
  completedOmitted: number;
  failed: DailyBriefingItem[];
  failedOmitted: number;
  decisions: DailyBriefingDecision[];
  decisionsOmitted: number;
  schedule: DailyBriefingScheduleHighlight[];
  scheduleOmitted: number;
  adapters: {proactive: 'unavailable' | 'connected'; risk: 'unavailable' | 'connected'; recovery: 'unavailable' | 'connected'};
}

export interface DailyBriefingSchedulePlan {
  scheduleId: string;
  goal: string;
  conversationId: string;
  runAt: string;
  timeZone: string;
  missedRunPolicy: 'run_once';
  taskIdempotencyKey: string;
}

const RISK_LABEL: Record<DailyBriefingRisk, '低' | '中' | '高'> = {low: '低', medium: '中', high: '高'};
const STUCK = new Set(['waiting_reconciliation', 'waiting_external', 'cancelling']);
const STATE_LABEL: Record<string, string> = {
  failed: '失败',
  waiting_reconciliation: '待核实',
  waiting_external: '等待外部',
  cancelling: '取消未完成',
};

function assertZone(timeZone: string): void {
  try { new Intl.DateTimeFormat('en', {timeZone}).format(0); }
  catch { throw new Error('invalid time zone'); }
}

function localDate(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(ms));
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  const year = get('year'), month = get('month'), day = get('day');
  if (!year || !month || !day) throw new Error('invalid local date');
  return `${year}-${month}-${day}`;
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) throw new Error('invalid local date');
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function zonedInstant(date: string, localTime: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = localTime.split(':').map(Number);
  if (!year || !month || !day || hour === undefined || minute === undefined) throw new Error('invalid local time');
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}).formatToParts(new Date(utc));
    const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
    const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const target = Date.UTC(year, month - 1, day, hour, minute, 0);
    if (shown === target) break;
    utc += target - shown;
  }
  return new Date(utc).toISOString();
}

function localClock(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(iso));
  const hour = parts.find(part => part.type === 'hour')?.value ?? '00';
  const minute = parts.find(part => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

function safeTitle(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const line = value.split(/\r?\n/u, 1)[0]?.trim() ?? '';
  if (!line || line.length > 80 || SECRET.test(line)) return fallback;
  return line;
}

function take<T>(items: readonly T[]): {items: T[]; omitted: number} {
  return {items: items.slice(0, ITEM_LIMIT), omitted: Math.max(0, items.length - ITEM_LIMIT)};
}

function riskLabel(source: DailyBriefingRiskSource | undefined, ref: {kind: 'task' | 'approval' | 'schedule'; id: string}, connected: {value: boolean}): '低' | '中' | '高' | undefined {
  if (!source) return undefined;
  try {
    const grade = source.grade(ref);
    if (grade === 'unavailable') return undefined;
    connected.value = true;
    return RISK_LABEL[grade];
  } catch { return undefined; }
}

function withRisk<T extends DailyBriefingItem>(item: T, label: '低' | '中' | '高' | undefined): T {
  return label ? {...item, riskLabel: label} : item;
}

export function buildDailyBriefing(input: DailyBriefingInput): DailyBriefingDocument {
  assertZone(input.timeZone);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new Error('invalid now');
  const today = localDate(nowMs, input.timeZone);
  const since = zonedInstant(shiftDate(today, -1), '00:00', input.timeZone);
  const sinceMs = Date.parse(since);
  const prefix = input.excludeConversationPrefix ?? 'daily-briefing:';
  const own = (conversationId: string) => conversationId.startsWith(prefix);
  const tasks = input.tasks.filter(task => task.taskId && !own(task.conversationId) && task.goal !== DAILY_BRIEFING_GOAL);
  const known = new Map(tasks.map(task => [task.taskId, task]));
  const riskConnected = {value: false};
  const recoveryConnected = {value: false};
  const completed: DailyBriefingItem[] = [];
  const failed: DailyBriefingItem[] = [];
  for (const task of tasks) {
    const updated = Date.parse(task.updatedAt);
    const recent = Number.isFinite(updated) && updated >= sinceMs;
    const title = safeTitle(task.goal, `任务 ${task.taskId.slice(0, 8)}`);
    if (task.state === 'succeeded' && recent) {
      completed.push(withRisk({id: task.taskId, title}, riskLabel(input.risk, {kind: 'task', id: task.taskId}, riskConnected)));
      continue;
    }
    if (task.state === 'failed' && recent || STUCK.has(task.state)) {
      let healed = false;
      if (input.recovery && task.state === 'failed') {
        try {
          const outcome = input.recovery.outcome(task.taskId);
          if (outcome === 'healed') {healed = true; recoveryConnected.value = true;}
          else if (outcome === 'still_failed') recoveryConnected.value = true;
        } catch { /* leave the failure visible */ }
      }
      const item = withRisk({id: task.taskId, title: healed ? `${title}（已恢复）` : title}, riskLabel(input.risk, {kind: 'task', id: task.taskId}, riskConnected));
      if (healed) completed.push(item);
      else failed.push({...item, title: `${item.title} · ${STATE_LABEL[task.state] ?? '未完成'}`});
    }
  }
  let proactive: 'unavailable' | 'connected' = 'unavailable';
  if (input.proactive) {
    try {
      const listed = input.proactive.listCompletedSince(since);
      if (listed !== 'unavailable' && Array.isArray(listed)) {
        proactive = 'connected';
        for (const item of listed) {
          if (!item || typeof item.id !== 'string' || !item.id) continue;
          completed.push(withRisk({id: item.id, title: safeTitle(item.title, '主动任务')}, riskLabel(input.risk, {kind: 'task', id: item.id}, riskConnected)));
        }
      }
    } catch { proactive = 'unavailable'; }
  }
  const decisions = input.approvals.filter(item => item.state === 'pending' && item.approvalId && item.taskId
    && (!known.has(item.taskId) || known.get(item.taskId)?.state === 'waiting_approval')).map(item => withRisk({
    id: item.approvalId,
    approvalId: item.approvalId,
    taskId: item.taskId,
    title: safeTitle(item.action, '待审批'),
  }, riskLabel(input.risk, {kind: 'approval', id: item.approvalId}, riskConnected)));
  const dayEnd = zonedInstant(shiftDate(today, 1), '00:00', input.timeZone);
  const highlights = input.schedules.filter(item => !own(item.conversationId) && (item.status === 'pending' || item.status === 'fired')
    && Date.parse(item.runAt) >= Date.parse(zonedInstant(today, '00:00', input.timeZone))
    && Date.parse(item.runAt) < Date.parse(dayEnd)).sort((left, right) => left.runAt.localeCompare(right.runAt)).map(item => withRisk({
    id: item.scheduleId,
    title: safeTitle(item.goal, '日程'),
    displayTime: localClock(item.runAt, input.timeZone),
  }, riskLabel(input.risk, {kind: 'schedule', id: item.scheduleId}, riskConnected)));
  const completedPage = take(completed);
  const failedPage = take(failed);
  const decisionPage = take(decisions);
  const schedulePage = take(highlights);
  return {
    localDate: today,
    generatedAt: new Date(nowMs).toISOString(),
    timeZone: input.timeZone,
    since,
    completed: completedPage.items,
    completedOmitted: completedPage.omitted,
    failed: failedPage.items,
    failedOmitted: failedPage.omitted,
    decisions: decisionPage.items,
    decisionsOmitted: decisionPage.omitted,
    schedule: schedulePage.items,
    scheduleOmitted: schedulePage.omitted,
    adapters: {proactive, risk: riskConnected.value ? 'connected' : 'unavailable', recovery: recoveryConnected.value ? 'connected' : 'unavailable'},
  };
}

export function briefingNotification(document: DailyBriefingDocument): {id: string; title: string; body: string} {
  const completed = document.completed.length + document.completedOmitted;
  const failed = document.failed.length + document.failedOmitted;
  const decisions = document.decisions.length + document.decisionsOmitted;
  const body = completed + failed + decisions === 0
    ? '昨天以来没有新的完成、失败或待拍板事项。点开查看全文。'
    : `完成 ${completed} 项，失败或卡住 ${failed} 项，待拍板 ${decisions} 项。点开查看全文。`;
  return {id: `daily-briefing-notice:${document.localDate}`, title: '每日结果简报', body};
}

/** Structurally compatible with Runtime ScheduleInput. The existing Scheduler registers it. */
export function planDailyBriefingSchedule(input: {
  conversationId: string;
  localTime: string;
  timeZone: string;
  now: string;
  briefedDates: readonly string[];
}): DailyBriefingSchedulePlan {
  if (!LOCAL_TIME.test(input.localTime)) throw new Error('invalid local time');
  if (!input.conversationId.trim()) throw new Error('conversation required');
  assertZone(input.timeZone);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new Error('invalid now');
  const today = localDate(nowMs, input.timeZone);
  const targetDate = input.briefedDates.includes(today) ? shiftDate(today, 1) : today;
  const scheduleId = `daily-briefing:${targetDate}:${input.localTime}`;
  return {
    scheduleId,
    goal: DAILY_BRIEFING_GOAL,
    conversationId: input.conversationId,
    runAt: zonedInstant(targetDate, input.localTime, input.timeZone),
    timeZone: input.timeZone,
    missedRunPolicy: 'run_once',
    taskIdempotencyKey: scheduleId,
  };
}
