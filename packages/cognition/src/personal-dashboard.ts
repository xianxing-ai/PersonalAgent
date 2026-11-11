/** Local personal-data rollup. Plans a ScheduleInput for the existing Scheduler
 * and never creates a scheduler, task store, or network call. */

export const PERSONAL_DASHBOARD_PERIODS = ['daily', 'weekly', 'monthly'] as const;
export type PersonalDashboardPeriod = typeof PERSONAL_DASHBOARD_PERIODS[number];

export interface DashboardWindow {
  fromUtc: string;
  toUtc: string;
}

export interface TimeSample {
  startUtc: string;
  endUtc: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
}

export interface MailSample {
  occurredAt: string;
  direction: 'in' | 'out';
}

export interface SpendSample {
  occurredAt: string;
  amountMinor: number;
  currency: string;
}

export interface CountSample {
  occurredAt: string;
  count: number;
}

export type DisconnectedSource = {connected: false};
export type ConnectedSource<T> = {connected: true; samples: readonly T[]; coverage?: 'inbound' | 'both'; truncated?: boolean};
export type SourceReading<T> = DisconnectedSource | ConnectedSource<T>;

export interface PersonalDashboardReadings {
  time: SourceReading<TimeSample>;
  mail: SourceReading<MailSample>;
  spend: SourceReading<SpendSample>;
  briefing: SourceReading<CountSample>;
}

export interface DashboardCard {
  id: 'time' | 'mail' | 'spend' | 'briefing';
  title: string;
  value: string;
  unit: string;
  delta: string;
  series: number[];
  caption?: string;
}

export interface PersonalDashboardSummary {
  period: PersonalDashboardPeriod;
  generatedAt: string;
  range: DashboardWindow;
  cards: DashboardCard[];
  headline: string;
}

export interface DashboardScheduleInput {
  scheduleId: string;
  goal: string;
  conversationId: string;
  runAt: string;
  timeZone: string;
  missedRunPolicy: 'run_once';
  taskIdempotencyKey: string;
}

const WEEKDAYS = {Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6} as const;

export function personalDashboardConversationId(namespace: string): string {
  requireToken(namespace, 'namespace');
  return `personal-dashboard:${namespace}`;
}

export function nextDashboardBoundary(period: PersonalDashboardPeriod, nowMs: number, timeZone: string): number {
  assertPeriod(period);
  assertZone(timeZone);
  if (!Number.isFinite(nowMs)) throw new Error('汇总时刻无效');
  return nextBoundary(period, nowMs, timeZone);
}

/** Soonest local boundary strictly after `nowMs - 1ms`, so an exact boundary stays due. */
export function dueDashboardBoundary(period: PersonalDashboardPeriod, nowMs: number, timeZone: string): number {
  return nextDashboardBoundary(period, nowMs - 1, timeZone);
}

export function dashboardScheduleInput(options: {
  namespace: string;
  period: PersonalDashboardPeriod;
  runAtMs: number;
  timeZone: string;
}): DashboardScheduleInput {
  const runAt = new Date(options.runAtMs).toISOString();
  const conversationId = personalDashboardConversationId(options.namespace);
  const scheduleId = `${conversationId}:${options.period}:${runAt}`;
  return {
    scheduleId,
    goal: `汇总个人数据 ${options.period} ${runAt}`,
    conversationId,
    runAt,
    timeZone: options.timeZone,
    missedRunPolicy: 'run_once',
    taskIdempotencyKey: scheduleId,
  };
}

export function dashboardReadWindow(period: PersonalDashboardPeriod, runAtMs: number, timeZone: string): DashboardWindow {
  const buckets = dashboardBuckets(period, runAtMs, timeZone);
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (!first || !last) throw new Error('汇总窗口无效');
  return {fromUtc: new Date(first.start).toISOString(), toUtc: new Date(last.end).toISOString()};
}

export function summarizePersonalDashboard(input: {
  period: PersonalDashboardPeriod;
  runAtMs: number;
  timeZone: string;
  generatedAt: string;
  readings: PersonalDashboardReadings;
}): PersonalDashboardSummary {
  assertPeriod(input.period);
  assertZone(input.timeZone);
  const buckets = dashboardBuckets(input.period, input.runAtMs, input.timeZone);
  const cards: DashboardCard[] = [];
  const time = input.readings.time;
  const mail = input.readings.mail;
  const spend = input.readings.spend;
  const briefing = input.readings.briefing;
  if (time.connected) {
    const series = buckets.map(bucket => round1(occupiedMs(time.samples, bucket.start, bucket.end) / 3_600_000));
    cards.push(metricCard('time', '时间', series, 1, '小时'));
  }
  if (mail.connected) {
    const series = buckets.map(bucket => countMail(mail.samples, bucket.start, bucket.end));
    const caption = [mail.coverage === 'inbound' ? '只统计已授权的收件' : '', mail.truncated ? '邮箱未读完，数字不完整' : ''].filter(Boolean).join('；');
    cards.push({...metricCard('mail', '邮件', series, 0, '封'), ...(caption ? {caption} : {})});
  }
  if (spend.connected) cards.push(...spendCards(spend.samples, buckets));
  if (briefing.connected) {
    const series = buckets.map(bucket => countBriefings(briefing.samples, bucket.start, bucket.end));
    cards.push(metricCard('briefing', '简报', series, 0, '次'));
  }
  const headline = cards.length
    ? `个人数据已汇总：${cards.map(card => `${card.title} ${card.value}${card.unit}`).join('，')}`
    : '个人数据已汇总：没有已授权的数据源';
  const range = dashboardReadWindow(input.period, input.runAtMs, input.timeZone);
  return {period: input.period, generatedAt: input.generatedAt, range, cards, headline};
}

function metricCard(id: DashboardCard['id'], title: string, series: number[], digits: number, unit: string): DashboardCard {
  const current = series.at(-1) ?? 0;
  const previous = series.at(-2) ?? 0;
  return {id, title, value: current.toFixed(digits), unit, delta: signed(current - previous, digits), series};
}

function spendCards(samples: readonly SpendSample[], buckets: readonly {start: number; end: number}[]): DashboardCard[] {
  const currencies = [...new Set(samples.map(sample => {
    if (!/^[A-Z]{3}$/.test(sample.currency) || !Number.isSafeInteger(sample.amountMinor)) throw new Error('花销记录无效');
    assertInstant(sample.occurredAt);
    return sample.currency;
  }))].sort();
  if (!currencies.length) return [metricCard('spend', '花销', buckets.map(() => 0), 2, '')];
  return currencies.map(currency => {
    const series = buckets.map(bucket => round2(samples
      .filter(sample => sample.currency === currency && inBucket(sample.occurredAt, bucket.start, bucket.end))
      .reduce((sum, sample) => sum + sample.amountMinor, 0) / 100));
    return {...metricCard('spend', currencies.length === 1 ? '花销' : `花销 ${currency}`, series, 2, currency), id: 'spend' as const};
  });
}

function occupiedMs(samples: readonly TimeSample[], from: number, to: number): number {
  const intervals: [number, number][] = [];
  for (const sample of samples) {
    assertInstant(sample.startUtc);
    assertInstant(sample.endUtc);
    if (sample.status === 'cancelled') continue;
    const start = Math.max(Date.parse(sample.startUtc), from);
    const end = Math.min(Date.parse(sample.endUtc), to);
    if (end > start) intervals.push([start, end]);
  }
  intervals.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let total = 0;
  let cursor = -Infinity;
  for (const [start, end] of intervals) {
    const fromCursor = Math.max(start, cursor);
    if (end > fromCursor) total += end - fromCursor;
    cursor = Math.max(cursor, end);
  }
  return total;
}

function countMail(samples: readonly MailSample[], from: number, to: number): number {
  return samples.filter(sample => {
    if (sample.direction !== 'in' && sample.direction !== 'out') throw new Error('邮件方向无效');
    assertInstant(sample.occurredAt);
    return inBucket(sample.occurredAt, from, to);
  }).length;
}

function countBriefings(samples: readonly CountSample[], from: number, to: number): number {
  return samples.filter(sample => {
    if (!Number.isSafeInteger(sample.count) || sample.count < 0) throw new Error('简报计数无效');
    assertInstant(sample.occurredAt);
    return inBucket(sample.occurredAt, from, to);
  }).reduce((sum, sample) => sum + sample.count, 0);
}

function inBucket(instant: string, from: number, to: number): boolean {
  const at = Date.parse(instant);
  return at >= from && at < to;
}

function dashboardBuckets(period: PersonalDashboardPeriod, runAtMs: number, timeZone: string): {start: number; end: number}[] {
  const count = period === 'daily' ? 7 : period === 'weekly' ? 4 : 6;
  const buckets: {start: number; end: number}[] = [];
  let end = runAtMs;
  for (let index = 0; index < count; index += 1) {
    const start = period === 'monthly' ? addMonths(end, -1, timeZone) : addDays(end, period === 'weekly' ? -7 : -1, timeZone);
    buckets.push({start, end});
    end = start;
  }
  return buckets.reverse();
}

function nextBoundary(period: PersonalDashboardPeriod, nowMs: number, timeZone: string): number {
  if (period === 'daily') {
    let start = startOfLocalDay(nowMs, timeZone);
    if (start <= nowMs) start = addDays(start, 1, timeZone);
    return start;
  }
  if (period === 'weekly') {
    const parts = zonedParts(nowMs, timeZone);
    const sinceMonday = (WEEKDAYS[parts.weekday] + 6) % 7;
    let monday = addDays(startOfLocalDay(nowMs, timeZone), -sinceMonday, timeZone);
    if (monday <= nowMs) monday = addDays(monday, 7, timeZone);
    return monday;
  }
  const parts = zonedParts(nowMs, timeZone);
  let month = zonedTimeToUtc(parts.year, parts.month, 1, 0, 0, timeZone);
  if (month <= nowMs) {
    const next = new Date(Date.UTC(parts.year, parts.month, 1));
    month = zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, 1, 0, 0, timeZone);
  }
  return month;
}

function startOfLocalDay(ms: number, timeZone: string): number {
  const parts = zonedParts(ms, timeZone);
  return zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, timeZone);
}

function addDays(utcMs: number, days: number, timeZone: string): number {
  const parts = zonedParts(utcMs, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return zonedTimeToUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), parts.hour, parts.minute, timeZone);
}

function addMonths(utcMs: number, delta: number, timeZone: string): number {
  const parts = zonedParts(utcMs, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1 + delta, 1));
  return zonedTimeToUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1, 0, 0, timeZone);
}

function zonedParts(ms: number, timeZone: string): {year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: keyof typeof WEEKDAYS} {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  }).formatToParts(new Date(ms));
  const bag: Record<string, string> = {};
  for (const part of formatted) bag[part.type] = part.value;
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  const weekday = bag.weekday as keyof typeof WEEKDAYS;
  if (WEEKDAYS[weekday] === undefined) throw new Error('无法解析本地星期');
  return {year: Number(bag.year), month: Number(bag.month), day: Number(bag.day), hour, minute: Number(bag.minute), second: Number(bag.second), weekday};
}

function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(utc, timeZone);
    if (parts.year === year && parts.month === month && parts.day === day && parts.hour === hour && parts.minute === minute && parts.second === 0) return utc;
    const observed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const next = utc + (desired - observed);
    if (next === utc) break;
    utc = next;
  }
  throw new Error('无法换算本地时间');
}

function assertPeriod(period: string): asserts period is PersonalDashboardPeriod {
  if (!PERSONAL_DASHBOARD_PERIODS.includes(period as PersonalDashboardPeriod)) throw new Error('汇总周期无效');
}

function assertZone(timeZone: string): void {
  try { new Intl.DateTimeFormat('en-US', {timeZone}).format(0); }
  catch { throw new Error('时区无效'); }
}

function assertInstant(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('时间无效');
}

function requireToken(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim() || value.includes(':')) throw new Error(`${name}无效`);
}

function signed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

function round1(value: number): number { return Math.round(value * 10) / 10; }
function round2(value: number): number { return Math.round(value * 100) / 100; }
