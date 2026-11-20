import { ProtocolError } from '@personal-agent/contracts';
import { CALENDAR_CERT_CODES, isTransportTimeout, transportErrorCode } from './read-context.js';
import type {
  CalendarEventRecord,
  CalendarFetchPage,
  CalendarProvider,
  CalendarRespondInput,
  CalendarRespondResult,
  CalendarSummary,
  CalendarWindow,
} from './provider.js';

export interface ICalSubscriptionOptions {
  /** 订阅 iCal 2.0 只读源地址（如 https://www.officeholidays.com/ics/china）。 */
  url: string;
  /** 日历展示名（从 X-WR-CALNAME 读回，亦可显式指定）。 */
  calendarName?: string;
  fetchImpl?: FetchLike;
}

export type FetchLike = (url: string, init: {signal: AbortSignal; headers: Record<string, string>; redirect: 'error'}) => Promise<FetchResponseLike>;

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

const USER_AGENT = 'personal-agent-calendar/0.1.0-alpha.1';
/** 一个只读订阅日历没有邀约可回应；respond 在端口层语义明确拒绝。 */
const READ_ONLY_REASON = 'Subscribed iCal feed is read-only; no invitation to respond to';
const ICAL_PAGE_SIZE = 100;

/** 折叠行展开：iCal 规定续行以空格/制表符开头。 */
export function unfoldLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .reduce<string[]>((lines, line) => {
      if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
        lines[lines.length - 1] += line.slice(1);
      } else {
        lines.push(line);
      }
      return lines;
    }, []);
}

/** iCal 文本转义还原（\\n \\, \\; \\\\）。 */
export function unescapeIcalText(value: string): string {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/** DATE 或 DATE-TIME（UTC Z）→ 毫秒；非法返回 undefined。 */
function utcInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number | undefined {
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31
    || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return undefined;
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    return undefined;
  }
  return date.getTime();
}

/** DATE or UTC DATE-TIME to milliseconds; invalid calendar values return undefined. */
export function parseIcalDate(value: string): number | undefined {
  const input = value.trim();
  const dateOnly = /^(?:\d{8}|\d{4}-\d{2}-\d{2})$/u.test(input);
  const dateTime = /^(?:\d{8}|\d{4}-\d{2}-\d{2})T(?:\d{6}|\d{2}:\d{2}:\d{2})Z$/iu.test(input);
  if (!dateOnly && !dateTime) return undefined;
  const compact = input.replace(/[-:]/g, '');
  const parts = dateTime
    ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/iu.exec(compact)
    : /^(\d{4})(\d{2})(\d{2})$/u.exec(compact);
  if (!parts) return undefined;
  return utcInstant(
    Number(parts[1]), Number(parts[2]), Number(parts[3]),
    dateTime ? Number(parts[4]) : 0,
    dateTime ? Number(parts[5]) : 0,
    dateTime ? Number(parts[6]) : 0,
  );
}

function iso(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}.000Z`;
}

function localWall(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const f = new Map(parts.map(part => [part.type, part.value]));
  const hour = Number(f.get('hour') ?? 0) % 24;
  return `${f.get('year')}-${f.get('month')}-${f.get('day')}T${String(hour).padStart(2, '0')}:${f.get('minute')}:${f.get('second')}`;
}

export interface ParsedIcalEvent {
  uid: string;
  summary: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  sequence: number;
  lastModifiedMs: number | undefined;
  url?: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
}

/** 解析 VEVENT 块集合；CANCELLED/无 UID/无起止的条目按规范剔除或标注。 */
export function parseIcalEvents(raw: string): ParsedIcalEvent[] {
  const lines = unfoldLines(raw);
  const events: ParsedIcalEvent[] = [];
  let current: Record<string, string> | undefined;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (current) {
        const parsed = readEvent(current);
        if (parsed) events.push(parsed);
      }
      current = undefined;
      continue;
    }
    if (current === undefined) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const keyRaw = left.split(';')[0] ?? '';
    const key = keyRaw.toUpperCase();
    const params = left.slice(key.length + 1);
    current[`${key}${params ? `;${params}` : ''}`] = value;
    current[key] = value;
  }
  return events;
}

function readEvent(props: Record<string, string>): ParsedIcalEvent | undefined {
  const uid = props.UID ?? '';
  const summary = unescapeIcalText(props.SUMMARY ?? '(无标题)');
  const startRaw = props.DTSTART ?? '';
  const endRaw = props.DTEND ?? '';
  if (!uid || !startRaw || !endRaw) return undefined;
  const startMs = parseIcalDate(startRaw.split(';')[0] ?? '');
  let endMs = parseIcalDate(endRaw.split(';')[0] ?? '');
  if (startMs === undefined || endMs === undefined) return undefined;
  // 全天事件 DTEND 为排他日界：零长度时后移一天保住 [start, end) 语义。
  const allDay = /^(?:\d{8}|\d{4}-\d{2}-\d{2})$/u.test(startRaw);
  if (endMs === startMs && allDay) endMs = startMs + 86_400_000;
  if (endMs <= startMs) return undefined;
  const sequence = Number(props.SEQUENCE ?? '0');
  const statusRaw = (props.STATUS ?? 'CONFIRMED').toUpperCase();
  const status: 'confirmed' | 'tentative' | 'cancelled' = statusRaw === 'CANCELLED' ? 'cancelled'
    : statusRaw === 'TENTATIVE' ? 'tentative' : 'confirmed';
  const lastModifiedRaw = props['LAST-MODIFIED'];
  const lastModifiedMs = lastModifiedRaw === undefined ? undefined : parseIcalDate(lastModifiedRaw);
  const event: ParsedIcalEvent = {
    uid, summary, startMs, endMs, allDay, sequence,
    lastModifiedMs, status,
  };
  if (props.URL !== undefined) event.url = props.URL;
  return event;
}

/** 只读订阅日历：manifest 标记 read-only，respond 明确拒绝。 */
export class ICalSubscriptionProvider implements CalendarProvider {
  readonly providerKind = 'ical-subscription';
  readonly verification = 'conditional' as const;
  private readonly url: string;
  private readonly calendarName: string | undefined;
  private readonly fetchImpl: FetchLike;
  private cache: {body: string; fetchedAtMs: number} | undefined;

  constructor(options: ICalSubscriptionOptions) {
    if (typeof options.url !== 'string' || !/^https:\/\//.test(options.url)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'iCal subscription url must be HTTPS');
    }
    this.url = options.url;
    this.calendarName = options.calendarName;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  listCalendars(): CalendarSummary[] {
    return [{id: 'subscription', name: this.calendarName ?? '订阅日历', timeZone: 'UTC'}];
  }

  /** 每次调用都重新拉取订阅源（缓存 5 分钟由调用方窗口决定）；成功后缓存原文。 */
  async fetchWindow(_accountRef: string, window: CalendarWindow, cursor?: string): Promise<CalendarFetchPage> {
    const offset = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid cursor');
    const body = await this.fetchFeed();
    const matching = parseIcalEvents(body)
      .filter(event => event.status !== 'cancelled' && event.startMs < Date.parse(window.toUtc) && event.endMs > Date.parse(window.fromUtc))
      .sort((left, right) => left.startMs - right.startMs || left.uid.localeCompare(right.uid));
    const events = matching.slice(offset, offset + ICAL_PAGE_SIZE).map(event => this.toRecord(event));
    const nextOffset = offset + events.length;
    const hasMore = nextOffset < matching.length;
    return {events, hasMore, ...(hasMore ? {nextCursor: String(nextOffset)} : {})};
  }

  async getEvent(_accountRef: string, externalId: string): Promise<CalendarEventRecord | undefined> {
    const event = parseIcalEvents(await this.fetchFeed()).find(item => item.uid === externalId);
    return event === undefined ? undefined : this.toRecord(event);
  }

  /** 只读源无邀约语义：显式 UNSUPPORTED 而非假成功。 */
  respond(_input: CalendarRespondInput): CalendarRespondResult {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', READ_ONLY_REASON);
  }

  async fetchFeed(signal?: AbortSignal): Promise<string> {
    if (this.cache && Date.now() - this.cache.fetchedAtMs < 300_000) return this.cache.body;
    let response: FetchResponseLike;
    try {
      response = await this.fetchImpl(this.url, {signal: signal ?? new AbortController().signal,
        headers: {'user-agent': USER_AGENT, accept: 'text/calendar, text/plain'}, redirect: 'error'});
    } catch (error) {
      if (signalAborted(signal)) throw new ProtocolError('CANCELLED', 'Calendar fetch cancelled', false);
      const code = transportErrorCode(error);
      if (isTransportTimeout(error, code)) throw new ProtocolError('TIMEOUT', 'iCal 订阅抓取超时', true);
      if (code !== null && CALENDAR_CERT_CODES.has(code)) {
        throw new ProtocolError('EXTERNAL_FAILURE', 'iCal 订阅 TLS 证书校验失败', false);
      }
      throw new ProtocolError('EXTERNAL_FAILURE', 'iCal 订阅抓取失败', true);
    }
    if (response.status === 408) throw new ProtocolError('TIMEOUT', 'iCal 订阅源请求超时（HTTP 408）', true);
    if (response.status === 429) throw new ProtocolError('RATE_LIMITED', 'iCal 订阅源限流', true, 60_000);
    if (!response.ok) {
      throw new ProtocolError('EXTERNAL_FAILURE', `iCal 订阅源返回异常（HTTP ${response.status}）`, response.status >= 500);
    }
    let body: string;
    try { body = await response.text(); }
    catch {
      if (signalAborted(signal)) throw new ProtocolError('CANCELLED', 'Calendar fetch cancelled', false);
      throw new ProtocolError('EXTERNAL_FAILURE', 'iCal 订阅响应读取失败', true);
    }
    if (signalAborted(signal)) throw new ProtocolError('CANCELLED', 'Calendar fetch cancelled', false);
    const calendar = body.replace(/^\uFEFF/u, '').trimStart();
    if (!calendar.startsWith('BEGIN:VCALENDAR')) {
      throw new ProtocolError('EXTERNAL_FAILURE', `iCal 订阅源返回异常（HTTP ${response.status}）`, false);
    }
    this.cache = {body: calendar, fetchedAtMs: Date.now()};
    return calendar;
  }

  private toRecord(event: ParsedIcalEvent): CalendarEventRecord {
    const timeZone = 'UTC';
    return {
      externalId: event.uid,
      calendarId: 'subscription',
      title: event.summary,
      startUtc: iso(event.startMs),
      endUtc: iso(event.endMs),
      timeZone,
      startLocal: localWall(event.startMs, timeZone),
      endLocal: localWall(event.endMs, timeZone),
      status: event.status,
      sequence: event.sequence,
      updatedUtc: event.lastModifiedMs === undefined ? iso(event.startMs) : iso(event.lastModifiedMs),
    };
  }
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

