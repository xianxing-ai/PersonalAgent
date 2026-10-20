import { ProtocolError } from '@personal-agent/contracts';
import {randomUUID} from 'node:crypto';
import { unfoldLines, unescapeIcalText, parseIcalDate } from './ical-subscription.js';
import { assertReadActive } from './read-context.js';
import type {
  CalendarEventRecord,
  CalendarFetchPage,
  CalendarProvider,
  CalendarReadContext,
  CalendarRespondInput,
  CalendarRespondResult,
  CalendarSummary,
  CalendarWindow,
} from './provider.js';

/** CalDAV 传输端口：读（PROPFIND/REPORT）与写（PUT/GET/DELETE）共用宿主注入的 fetch 实现即可离线测试。 */
export type CalDavFetchLike = (url: string, init: {
  readonly method: 'PROPFIND' | 'REPORT' | 'PUT' | 'GET' | 'DELETE';
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly signal: AbortSignal;
  readonly redirect: 'error';
}) => Promise<CalDavFetchResponseLike>;

export interface CalDavFetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface CalDavReadProviderOptions {
  /** 日历集合完整 URL（RFC 4791 collection，以 / 结尾），如 https://server/calendars/user/default/。 */
  readonly calendarUrl: string;
  /** 完整 Authorization 头值（如 `Basic …`），由受信宿主按账号注入；本连接器不保存凭据本体。 */
  readonly authorization?: string;
  /** 日历展示名（缺省用 URL 尾段）。 */
  readonly calendarName?: string;
  readonly fetchImpl?: CalDavFetchLike;
  /** 单次 HTTP 请求超时；默认 30 秒。 */
  readonly requestTimeoutMs?: number;
  /** 允许本机回环（localhost/127.0.0.1/[::1]）的明文 http://，仅供本地验收服务器（如 Radicale）；默认关闭。 */
  readonly allowLoopbackHttp?: boolean;
}

/** 一次廉价轮询的快照：集合 ctag 与全部子资源 etag（href → etag）。 */
export interface CalDavChangeSnapshot {
  readonly ctag: string | undefined;
  readonly etags: Readonly<Record<string, string>>;
}

const USER_AGENT = 'personal-agent-calendar/0.1.0-alpha.1';
const CALDAV_PAGE_SIZE = 100;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** RFC 4791 要求服务器支持 Depth:1 PROPFIND；集合自身返回 ctag，子资源返回 etag。 */
const PROP_BOTH = '<?xml version="1.0" encoding="utf-8"?>'
  + '<D:propfind xmlns:D="DAV:"><D:prop><D:getctag xmlns="urn:ietf:params:xml:ns:caldav"/>'
  + '<D:getetag/></D:prop></D:propfind>';

/** XML 实体还原（calendar-data 里整段 iCal 文本被转义）。 */
function xmlText(value: string): string {
  return value.replace(/&(lt|gt|quot|apos|#x27|amp);/g, (_, entity: string) => {
    switch (entity) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos':
      case '#x27': return "'";
      default: return '&';
    }
  });
}

interface ResponseBlock {
  readonly href: string;
  readonly ctag: string | undefined;
  readonly etag: string | undefined;
  readonly calendarData: string | undefined;
}

/** 宽容解析 multistatus：命名空间前缀随服务器（D:/d:/cal:/c:），按本地名匹配。 */
function parseMultistatus(body: string): ResponseBlock[] {
  const responses: ResponseBlock[] = [];
  const blockPattern = /<(?:[A-Za-z][\w.-]*:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z][\w.-]*:)?response>/g;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(body)) !== null) {
    const block = match[1] ?? '';
    const pick = (name: string): string | undefined => {
      const found = new RegExp(`<(?:[A-Za-z][\\w.-]*:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z][\\w.-]*:)?${name}>`, 'i').exec(block);
      return found === null ? undefined : xmlText(found[1] ?? '').trim();
    };
    const href = pick('href');
    if (href === undefined) continue;
    responses.push({href, ctag: pick('getctag'), etag: pick('getetag'), calendarData: pick('calendar-data')});
  }
  if (responses.length === 0 && !/<(?:[A-Za-z][\w.-]*:)?multistatus[\s>]/i.test(body)) {
    throw new ProtocolError('EXTERNAL_FAILURE', 'CalDAV 响应不是合法的 multistatus', false);
  }
  return responses;
}

function basicInstant(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number | undefined {
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31
    || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return undefined;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    return undefined;
  }
  return date.getTime();
}

function compactInstant(digits: string): number | undefined {
  return basicInstant(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8)),
    Number(digits.slice(9, 11)), Number(digits.slice(11, 13)), Number(digits.slice(13, 15)));
}

/** 某时刻某 IANA 时区的 UTC 偏移（分钟，东为正）；非法时区名返回 undefined。 */
function zoneOffsetMinutes(ts: number, timeZone: string): number | undefined {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {timeZone, hour12: false, year: 'numeric',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'})
      .formatToParts(new Date(ts));
  } catch {
    return undefined;
  }
  const value = new Map(parts.map(part => [part.type, part.value]));
  const hour = Number(value.get('hour')) % 24;
  return (Date.UTC(Number(value.get('year')), Number(value.get('month')) - 1, Number(value.get('day')),
    hour, Number(value.get('minute')), Number(value.get('second'))) - ts) / 60000;
}

/**
 * 带时区墙上时间 → UTC 瞬间。定点迭代收敛（DST 边界最多两次）。
 * 秋季回拨产生的歧义时刻收敛到较早的一次（RFC 5545 建议），春季空洞收敛到偏移切换后的等价瞬间。
 */
export function zonedWallToUtc(digits: string, timeZone: string): number | undefined {
  const naive = compactInstant(digits);
  if (naive === undefined) return undefined;
  let ts = naive;
  for (let round = 0; round < 3; round += 1) {
    const offset = zoneOffsetMinutes(ts, timeZone);
    if (offset === undefined || !Number.isFinite(offset)) return undefined;
    const next = naive - offset * 60_000;
    if (next === ts) return ts;
    ts = next;
  }
  const final = zoneOffsetMinutes(ts, timeZone);
  return final === undefined ? undefined : ts;
}

interface ParsedCalDavEvent {
  uid: string;
  summary: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  timeZone: string;
  sequence: number;
  lastModifiedMs: number | undefined;
  status: 'confirmed' | 'tentative' | 'cancelled';
  location?: string;
  notes?: string;
}

/** 读取属性值与其参数串：parseIcalEvents 会同时存 `KEY` 与 `KEY;params` 两个键。 */
function propertyWithParams(props: Record<string, string>, name: string): {value: string; params: string} | undefined {
  for (const key of Object.keys(props)) {
    if (key === name || key.startsWith(`${name};`)) {
      return {value: props[key] ?? '', params: key === name ? '' : key.slice(name.length + 1)};
    }
  }
  return undefined;
}

function parseZonedValue(value: string, params: string): number | undefined {
  const input = value.trim();
  if (/^\d{8}$/u.test(input)) return basicInstant(Number(input.slice(0, 4)), Number(input.slice(4, 6)), Number(input.slice(6, 8)));
  if (/^\d{8}T\d{6}Z?$/u.test(input)) {
    const digits = input.slice(0, 15).replace(/[-:]/g, '');
    if (input.endsWith('Z')) return compactInstant(digits);
    const tzid = /TZID="?([^";]+)"?/i.exec(params);
    return tzid === null ? compactInstant(digits) : zonedWallToUtc(digits, tzid[1] ?? '');
  }
  return undefined;
}

function readEvent(props: Record<string, string>): ParsedCalDavEvent | undefined {
  if (props['RECURRENCE-ID'] !== undefined) {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'CalDAV recurrence instances require an instance-aware projection; no UID collapse is applied');
  }
  const uid = props.UID ?? '';
  const summary = unescapeIcalText(props.SUMMARY ?? '(无标题)');
  const start = propertyWithParams(props, 'DTSTART');
  const end = propertyWithParams(props, 'DTEND');
  if (!uid || start === undefined || end === undefined) return undefined;
  const startMs = parseZonedValue(start.value, start.params);
  let endMs = parseZonedValue(end.value, end.params);
  if (startMs === undefined || endMs === undefined) return undefined;
  const allDay = /^\d{8}$/u.test(start.value.trim());
  const timeZone = allDay || start.value.trim().endsWith('Z')
    ? 'UTC' : /TZID="?([^";]+)"?/i.exec(start.params)?.[1] ?? 'UTC';
  if (endMs === startMs && allDay) endMs = startMs + 86_400_000;
  if (endMs <= startMs) return undefined;
  const sequence = Number(props.SEQUENCE ?? '0');
  if (!Number.isSafeInteger(sequence) || sequence < 0) return undefined;
  const statusRaw = (props.STATUS ?? 'CONFIRMED').toUpperCase();
  const status: ParsedCalDavEvent['status'] = statusRaw === 'CANCELLED' ? 'cancelled'
    : statusRaw === 'TENTATIVE' ? 'tentative' : 'confirmed';
  const lastModifiedRaw = props['LAST-MODIFIED'];
  return {
    uid, summary, startMs, endMs, allDay, timeZone, sequence,
    lastModifiedMs: lastModifiedRaw === undefined ? undefined : parseIcalDate(lastModifiedRaw.split(';')[0] ?? ''),
    status,
    ...(props.LOCATION === undefined ? {} : {location: unescapeIcalText(props.LOCATION)}),
    ...(props.DESCRIPTION === undefined ? {} : {notes: unescapeIcalText(props.DESCRIPTION)}),
  };
}

export function parseCalDavEvents(raw: string): ParsedCalDavEvent[] {
  const lines = unfoldLines(raw);
  const events: ParsedCalDavEvent[] = [];
  let current: Record<string, string> | undefined;
  let nestedDepth = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {}; nestedDepth = 0; continue; }
    if (line === 'END:VEVENT') {
      if (current) {
        const parsed = readEvent(current);
        if (parsed) events.push(parsed);
      }
      current = undefined;
      continue;
    }
    if (current === undefined) continue;
    if (line.startsWith('BEGIN:')) {nestedDepth++;continue;}
    if (line.startsWith('END:')) {nestedDepth = Math.max(0, nestedDepth - 1);continue;}
    if (nestedDepth > 0) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const keyRaw = left.split(';')[0] ?? '';
    const key = keyRaw.toUpperCase();
    const params = left.slice(key.length + 1);
    current[`${key}${params ? `;${params}` : ''}`] = value;
    if (!(key in current) || params === '') current[key] = value;
  }
  return events;
}

function iso(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}.000Z`;
}

function localWall(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const value = new Map(parts.map(part => [part.type, part.value]));
  const hour = Number(value.get('hour')) % 24;
  return `${value.get('year')}-${value.get('month')}-${value.get('day')}T${String(hour).padStart(2, '0')}:${value.get('minute')}:${value.get('second')}`;
}

function calendarQueryXml(window: CalendarWindow | undefined): string {
  const stamp = (instant: string): string => `${instant.replaceAll(/[-:]/g, '').slice(0, 15)}Z`;
  const range = window === undefined ? '' : `<C:time-range start="${stamp(window.fromUtc)}"
      end="${stamp(window.toUtc)}"/>`;
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
    + '<D:prop><D:getetag/><C:calendar-data/></D:prop>'
    + '<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">'
    + range
    + '</C:comp-filter></C:comp-filter></C:filter></C:calendar-query>';
}

/**
 * 只读 CalDAV 提供商：ctag/etag 廉价轮询 + calendar-query 时间窗。
 * 变更检测 = ctag 或 etag 变化；取消读回走 getEvent（fetchWindow 与订阅源一致会滤掉 cancelled）。
 */
export class CalDavProvider implements CalendarProvider {
  readonly providerKind = 'caldav';
  readonly verification = 'conditional' as const;
  readonly writes = {
    createEvent: (input: Parameters<CalDavProvider['createEvent']>[0], context?: CalendarReadContext) => this.createEvent(input, context),
    updateEvent: (input: Parameters<CalDavProvider['updateEvent']>[0], context?: CalendarReadContext) => this.updateEvent(input, context),
    cancelEvent: (uid: string, context?: CalendarReadContext) => this.cancelEvent(uid, context),
  };
  private readonly calendarUrl: string;
  private readonly authorization: string | undefined;
  private readonly calendarName: string | undefined;
  private readonly fetchImpl: CalDavFetchLike;
  private readonly requestTimeoutMs: number;

  constructor(options: CalDavReadProviderOptions) {
    // 默认仅 HTTPS；allowLoopbackHttp 仅放行本机回环的 http://（本地 Radicale 等验收服务器），
    // 凭据仍走宿主注入的 Authorization 头——回环明文只在本机可见，非回环明文一律拒绝。
    const loopbackHttp = options.allowLoopbackHttp === true
      && /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/u.test(options.calendarUrl);
    if (typeof options.calendarUrl !== 'string'
      || (!loopbackHttp && !/^https:\/\//u.test(options.calendarUrl))) {
      throw new ProtocolError('INVALID_ARGUMENT',
        'CalDAV calendar url must be HTTPS (loopback HTTP only with allowLoopbackHttp)');
    }
    this.calendarUrl = options.calendarUrl.endsWith('/') ? options.calendarUrl : `${options.calendarUrl}/`;
    this.authorization = options.authorization;
    this.calendarName = options.calendarName;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 1 || this.requestTimeoutMs > 120_000) {
      throw new ProtocolError('INVALID_ARGUMENT', 'CalDAV request timeout must be 1..120000 ms');
    }
  }

  listCalendars(): CalendarSummary[] {
    const fallback = decodeURIComponent(this.calendarUrl.split('/').filter(Boolean).pop() ?? 'caldav');
    return [{id: 'caldav', name: this.calendarName ?? fallback, timeZone: 'UTC'}];
  }

  private async request(method: 'PROPFIND' | 'REPORT', body: string, depth: '0' | '1', context?: CalendarReadContext): Promise<string> {
    assertReadActive(context);
    const headers: Record<string, string> = {
      'user-agent': USER_AGENT,
      'content-type': 'application/xml; charset=utf-8',
      accept: 'application/xml, text/xml',
      depth,
    };
    if (this.authorization !== undefined) headers.authorization = this.authorization;
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    context?.signal?.addEventListener('abort', abort, {once: true});
    const startedAt = Date.now();
    const remainingMs = context?.deadline === undefined ? this.requestTimeoutMs : Date.parse(context.deadline) - startedAt;
    const timeoutAt = startedAt + Math.min(this.requestTimeoutMs, remainingMs);
    const expire = (): void => {
      const remaining = timeoutAt - Date.now();
      if (remaining > 0) {timeout = setTimeout(expire, remaining); return;}
      abort();
    };
    let timeout = setTimeout(expire, Math.max(0, timeoutAt - Date.now()));
    const interrupted = (): ProtocolError => {
      assertReadActive(context);
      return new ProtocolError('EXTERNAL_FAILURE', 'CalDAV 请求超时', true);
    };
    // Bound both fetch and body reads even when an injected transport ignores abort.
    const read = async <T>(operation: () => Promise<T>): Promise<T> => {
      if (controller.signal.aborted) throw interrupted();
      let onAbort: () => void = () => {};
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => {
          try { reject(interrupted()); } catch (error) { reject(error); }
        };
        controller.signal.addEventListener('abort', onAbort, {once: true});
      });
      try { return await Promise.race([operation(), cancelled]); }
      finally { controller.signal.removeEventListener('abort', onAbort); }
    };
    try {
      let response: CalDavFetchResponseLike;
      try {
        response = await read(() => this.fetchImpl(this.calendarUrl, {method, headers, body,
          signal: controller.signal, redirect: 'error'}));
      } catch (error) {
        assertReadActive(context);
        if (error instanceof ProtocolError) throw error;
        throw new ProtocolError('EXTERNAL_FAILURE', controller.signal.aborted ? 'CalDAV 请求超时' : 'CalDAV 请求失败', true);
      }
      if (response.status === 429) throw new ProtocolError('RATE_LIMITED', 'CalDAV 服务器限流', true, 60_000);
      if (response.status === 401 || response.status === 403) {
        throw new ProtocolError('UNAUTHORIZED', `CalDAV 认证被拒绝（HTTP ${response.status}）`);
      }
      // PROPFIND/REPORT 的成功状态是 207 Multi-Status（fetch 的 ok 不含 207）。
      if (response.status !== 207 && !(response.status >= 200 && response.status < 300)) {
        throw new ProtocolError('EXTERNAL_FAILURE', `CalDAV 服务器返回异常（HTTP ${response.status}）`, response.status >= 500);
      }
      let text: string;
      try { text = await read(() => response.text()); }
      catch (error) {
        assertReadActive(context);
        if (error instanceof ProtocolError) throw error;
        throw new ProtocolError('EXTERNAL_FAILURE', controller.signal.aborted ? 'CalDAV 响应读取超时' : 'CalDAV 响应读取失败', true);
      }
      if (text.trim().length === 0) throw new ProtocolError('EXTERNAL_FAILURE', 'CalDAV 响应为空', false);
      assertReadActive(context);
      return text;
    } finally {
      clearTimeout(timeout);
      context?.signal?.removeEventListener('abort', abort);
    }
  }

  /** 廉价变更轮询：一次 Depth:1 PROPFIND 同时取 ctag 与全部子资源 etag。 */
  async pollChanges(context?: CalendarReadContext): Promise<CalDavChangeSnapshot> {
    const body = await this.request('PROPFIND', PROP_BOTH, '1', context);
    const responses = parseMultistatus(body);
    // href 可能是绝对 URL 也可能只有路径（Radicale 只给路径），按解析后的 pathname 归一化比较。
    const collectionPath = new URL(this.calendarUrl).pathname.replace(/\/+$/, '');
    const etags: Record<string, string> = {};
    let ctag: string | undefined;
    for (const item of responses) {
      let itemPath = item.href;
      try { itemPath = new URL(item.href, this.calendarUrl).pathname; } catch { /* keep raw */ }
      const isCollection = itemPath.replace(/\/+$/, '') === collectionPath;
      // ctag 是 Apple 扩展，Radicale 等服务器不支持（propstat 404、解析为缺失）——
      // 此时子资源 etag 表（或集合自身 etag）就是变更信号，ctag 保持可选。
      if (item.ctag !== undefined || isCollection) {
        if (item.ctag !== undefined) ctag = item.ctag;
        continue;
      }
      if (item.etag !== undefined) etags[item.href] = item.etag;
    }
    return {ctag, etags};
  }

  private async queryEvents(window: CalendarWindow | undefined, context?: CalendarReadContext): Promise<ParsedCalDavEvent[]> {
    const body = await this.request('REPORT', calendarQueryXml(window), '1', context);
    const events: ParsedCalDavEvent[] = [];
    for (const item of parseMultistatus(body)) {
      if (item.calendarData === undefined) continue;
      for (const event of parseCalDavEvents(item.calendarData)) {
        events.push(event);
      }
    }
    return this.selectLatest(events);
  }

  private selectLatest(events: ParsedCalDavEvent[]): ParsedCalDavEvent[] {
    const latest = new Map<string, ParsedCalDavEvent>();
    const ordered = events.sort((a, b) => b.sequence - a.sequence
      || (b.lastModifiedMs ?? 0) - (a.lastModifiedMs ?? 0));
    for (const event of ordered) {
      const prior = latest.get(event.uid);
      if (prior === undefined || event.sequence > prior.sequence
        || (event.sequence === prior.sequence && (event.lastModifiedMs ?? 0) > (prior.lastModifiedMs ?? 0))) {
        latest.set(event.uid, event);
      } else if (event.sequence === prior.sequence && (event.lastModifiedMs ?? 0) === (prior.lastModifiedMs ?? 0)
        && JSON.stringify(event) !== JSON.stringify(prior)) {
        throw new ProtocolError('EXTERNAL_FAILURE', 'CalDAV returned conflicting versions for one UID', false);
      }
    }
    return [...latest.values()];
  }

  async fetchWindow(_accountRef: string, window: CalendarWindow, cursor?: string, context?: CalendarReadContext): Promise<CalendarFetchPage> {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/u.test(window?.fromUtc ?? '')
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/u.test(window?.toUtc ?? '')) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Calendar window must be ISO-8601 UTC instants');
    }
    const offset = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid cursor');
    const candidates = await this.queryEvents(window, context);
    // A server time-range hides a newer revision moved out of this window.
    // Reuse the unwindowed getEvent read path once, then match each candidate's
    // exact UID against the current collection before applying client filters.
    const currentByUid = new Map((candidates.length === 0 ? [] : await this.queryEvents(undefined, context))
      .map(event => [event.uid, event]));
    const confirmed = candidates.map(candidate => {
      const current = currentByUid.get(candidate.uid);
      if (current === undefined || current.sequence < candidate.sequence
        || (current.sequence === candidate.sequence && (current.lastModifiedMs ?? 0) < (candidate.lastModifiedMs ?? 0))) {
        throw new ProtocolError('EXTERNAL_FAILURE', 'CalDAV could not confirm the current candidate UID revision', false);
      }
      // Equal versions with differing content are conflicts across the two reads too.
      this.selectLatest([candidate, current]);
      return current;
    });
    assertReadActive(context);
    const matching = confirmed
      .filter(event => event.status !== 'cancelled'
        && event.startMs < Date.parse(window.toUtc) && event.endMs > Date.parse(window.fromUtc))
      .sort((left, right) => left.startMs - right.startMs || left.uid.localeCompare(right.uid));
    const events = matching.slice(offset, offset + CALDAV_PAGE_SIZE).map(event => this.toRecord(event));
    const nextOffset = offset + events.length;
    const hasMore = nextOffset < matching.length;
    return {events, hasMore, ...(hasMore ? {nextCursor: String(nextOffset)} : {})};
  }

  async getEvent(_accountRef: string, externalId: string, context?: CalendarReadContext): Promise<CalendarEventRecord | undefined> {
    if (typeof externalId !== 'string' || externalId.length === 0) {
      throw new ProtocolError('INVALID_ARGUMENT', 'externalId must be a non-empty string');
    }
    const event = (await this.queryEvents(undefined, context)).find(item => item.uid === externalId);
    return event === undefined ? undefined : this.toRecord(event);
  }

  /** 创建事件：PUT 固定 UID 资源（同 UID 同内容重放幂等），写后 GET 读回核对再返回记录。 */
  async createEvent(input: {summary: string; startUtc: string; endUtc: string;
    location?: string; notes?: string; uid?: string}, context?: CalendarReadContext): Promise<CalendarEventRecord> {
    const summary = typeof input?.summary === 'string' ? input.summary.trim() : '';
    if (!summary || summary.length > 512) throw new ProtocolError('INVALID_ARGUMENT', 'Calendar event summary is required (1..512 chars)');
    const startUtc = assertWriteUtc(input?.startUtc, 'startUtc');
    const endUtc = assertWriteUtc(input?.endUtc, 'endUtc');
    if (Date.parse(endUtc) <= Date.parse(startUtc)) throw new ProtocolError('INVALID_ARGUMENT', 'Calendar event endUtc must be after startUtc');
    const uid = input.uid === undefined ? randomUUID() : assertWriteUid(input.uid);
    const ics = buildIcs({uid, summary, startUtc, endUtc,
      ...(input.location === undefined ? {} : {location: String(input.location)}),
      ...(input.notes === undefined ? {} : {notes: String(input.notes)})}, stamp(Date.now()));
    await this.writeRequest('PUT', this.resourceUrl(uid), ics, 'text/calendar; charset=utf-8', context, [200, 201, 204]);
    return this.readBack({uid, summary, startUtc, endUtc,
      location: input.location?.trim() ?? '', notes: input.notes?.trim() ?? ''}, context);
  }

  /** 更新事件：GET 现值合并（SEQUENCE 递增）后 PUT，写后读回核对。 */
  async updateEvent(input: {uid: string; summary?: string; startUtc?: string; endUtc?: string;
    location?: string; notes?: string}, context?: CalendarReadContext): Promise<CalendarEventRecord> {
    const uid = assertWriteUid(input?.uid);
    const resourceUrl = this.resourceUrl(uid);
    const current = await this.writeRequest('GET', resourceUrl, undefined, undefined, context, [200]);
    const parsed = parseCalDavEvents(current).find(event => event.uid === uid);
    if (parsed === undefined) throw new ProtocolError('EXTERNAL_FAILURE', 'Calendar event is unreadable after fetch', false);
    const merged = {
      uid,
      summary: typeof input.summary === 'string' && input.summary.trim() ? input.summary.trim() : parsed.summary,
      startUtc: input.startUtc === undefined ? iso(parsed.startMs) : assertWriteUtc(input.startUtc, 'startUtc'),
      endUtc: input.endUtc === undefined ? iso(parsed.endMs) : assertWriteUtc(input.endUtc, 'endUtc'),
      location: input.location === undefined ? parsed.location ?? '' : String(input.location).trim(),
      notes: input.notes === undefined ? parsed.notes ?? '' : String(input.notes).trim(),
    };
    if (Date.parse(merged.endUtc) <= Date.parse(merged.startUtc)) throw new ProtocolError('INVALID_ARGUMENT', 'Calendar event endUtc must be after startUtc');
    const originalLines = unfoldLines(current);
    if (originalLines.filter(line => line === 'BEGIN:VEVENT').length !== 1
      || originalLines.some(line => /^(?:RRULE|RDATE|EXDATE|RECURRENCE-ID)(?:;|:)/u.test(line)))
      throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Recurring or multi-event resources require their original calendar editor');
    const updated = unfoldLines(buildIcs(merged, stamp(Date.now()), parsed.sequence + 1));
    const replacements = updated.slice(updated.indexOf('BEGIN:VEVENT') + 1, updated.indexOf('END:VEVENT'));
    const keys = new Set(['UID','DTSTAMP','DTSTART','DTEND','SUMMARY','LOCATION','DESCRIPTION','SEQUENCE']);
    // Preserve unrelated attendee, organizer, alarm and calendar properties rather than rebuilding the resource.
    let depth = 0;
    const preserved = originalLines.filter(line => {
      if (line === 'BEGIN:VEVENT') {depth = 1;return true;}
      if (depth && line.startsWith('BEGIN:')) {depth++;return true;}
      if (depth && line.startsWith('END:')) {depth--;return true;}
      return depth !== 1 || !keys.has(line.split(/[:;]/u)[0] ?? '');
    });
    preserved.splice(preserved.indexOf('END:VEVENT'), 0, ...replacements);
    const ics = preserved.map(foldIcalLine).join('\r\n') + '\r\n';
    await this.writeRequest('PUT', resourceUrl, ics, 'text/calendar; charset=utf-8', context, [200, 201, 204]);
    return this.readBack(merged, context);
  }

  /** 取消事件：DELETE 资源。404 视为已不存在（幂等），状态如实返回。 */
  async cancelEvent(uid: string, context?: CalendarReadContext): Promise<{uid: string; state: 'cancelled' | 'already_absent'}> {
    const resourceUrl = this.resourceUrl(assertWriteUid(uid));
    const {status} = await this.writeExchange('DELETE', resourceUrl, undefined, undefined, context);
    if (status === 404) return {uid, state: 'already_absent'};
    if (status !== 200 && status !== 204) {
      if (status === 401 || status === 403) throw new ProtocolError('UNAUTHORIZED', `CalDAV 认证被拒绝（HTTP ${status}）`);
      throw new ProtocolError('EXTERNAL_FAILURE', `CalDAV 服务器返回异常（HTTP ${status}）`, status >= 500);
    }
    return {uid, state: 'cancelled'};
  }

  private resourceUrl(uid: string): string {
    return `${this.calendarUrl}${encodeURIComponent(uid)}.ics`;
  }

  private async readBack(expected: {uid: string; summary: string; startUtc: string; endUtc: string; location: string; notes: string},
    context?: CalendarReadContext): Promise<CalendarEventRecord> {
    const text = await this.writeRequest('GET', this.resourceUrl(expected.uid), undefined, undefined, context, [200]);
    const parsed = parseCalDavEvents(text).find(event => event.uid === expected.uid);
    if (parsed === undefined || parsed.summary !== expected.summary || parsed.startMs !== Date.parse(expected.startUtc)
      || parsed.endMs !== Date.parse(expected.endUtc) || (parsed.location ?? '') !== expected.location || (parsed.notes ?? '') !== expected.notes)
      throw new ProtocolError('EXTERNAL_FAILURE', 'Calendar write read-back differs from the requested event; do not retry an unknown write', false);
    return this.toRecord(parsed);
  }

  /** 写请求：与读请求同一超时/中止纪律；状态不在白名单时抛错并返回响应体文本。 */
  private async writeRequest(method: 'PUT' | 'GET' | 'DELETE', url: string, body: string | undefined,
    contentType: string | undefined, context: CalendarReadContext | undefined, okStatuses: readonly number[]): Promise<string> {
    const {status, text} = await this.writeExchange(method, url, body, contentType, context);
    if (!okStatuses.includes(status)) {
      if (status === 401 || status === 403) throw new ProtocolError('UNAUTHORIZED', `CalDAV 认证被拒绝（HTTP ${status}）`);
      if (status === 404 && method === 'GET') throw new ProtocolError('NOT_FOUND', 'Calendar event resource is missing');
      throw new ProtocolError('EXTERNAL_FAILURE', `CalDAV 服务器返回异常（HTTP ${status}）`, status >= 500);
    }
    return text;
  }

  private async writeExchange(method: 'PUT' | 'GET' | 'DELETE', url: string, body: string | undefined,
    contentType: string | undefined, context?: CalendarReadContext): Promise<{status: number; text: string}> {
    assertReadActive(context);
    const headers: Record<string, string> = {'user-agent': USER_AGENT};
    if (contentType !== undefined) headers['content-type'] = contentType;
    if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body, 'utf8'));
    if (this.authorization !== undefined) headers.authorization = this.authorization;
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    context?.signal?.addEventListener('abort', abort, {once: true});
    const startedAt = Date.now();
    const remainingMs = context?.deadline === undefined ? this.requestTimeoutMs : Date.parse(context.deadline) - startedAt;
    const timeoutAt = startedAt + Math.min(this.requestTimeoutMs, remainingMs);
    let timeout = setTimeout((): void => controller.abort(), Math.max(0, timeoutAt - Date.now()));
    const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
      const interrupted = (): never => {assertReadActive(context);throw new ProtocolError('EXTERNAL_FAILURE', 'CalDAV 写入结果未确认，请先核实原资源', false);};
      if (controller.signal.aborted) interrupted();
      let onAbort: () => void = () => {};
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => {try {interrupted();} catch (error) {reject(error);}};
        controller.signal.addEventListener('abort', onAbort, {once: true});
      });
      try {return await Promise.race([operation(), cancelled]);}
      finally {controller.signal.removeEventListener('abort', onAbort);}
    };
    try {
      let response: CalDavFetchResponseLike;
      try {
        response = await bounded(() => this.fetchImpl(url, {method, headers, ...(body === undefined ? {} : {body}),
          signal: controller.signal, redirect: 'error'}));
      } catch (error) {
        assertReadActive(context);
        if (error instanceof ProtocolError) throw error;
        throw new ProtocolError('EXTERNAL_FAILURE', controller.signal.aborted ? 'CalDAV 请求超时' : 'CalDAV 请求失败', true);
      }
      if (response.status === 429) throw new ProtocolError('RATE_LIMITED', 'CalDAV 服务器限流', true, 60_000);
      const text = await bounded(() => response.text());
      assertReadActive(context);
      return {status: response.status, text};
    } catch (error) {
      assertReadActive(context);
      throw error;
    } finally {
      clearTimeout(timeout);
      context?.signal?.removeEventListener('abort', abort);
    }
  }

  /** 只读首片：/respond（与会者应答）留待独立工作包；事件写路径已由 create/update/cancel 提供。 */
  respond(_input: CalendarRespondInput): CalendarRespondResult {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'CalDAV provider does not implement attendee responses');
  }

  private toRecord(event: ParsedCalDavEvent): CalendarEventRecord {
    return {
      externalId: event.uid,
      calendarId: 'caldav',
      title: event.summary,
      startUtc: iso(event.startMs),
      endUtc: iso(event.endMs),
      timeZone: event.timeZone,
      startLocal: localWall(event.startMs, event.timeZone),
      endLocal: localWall(event.endMs, event.timeZone),
      status: event.status,
      ...(event.location === undefined ? {} : {location: event.location}),
      ...(event.notes === undefined ? {} : {notes: event.notes}),
      sequence: event.sequence,
      updatedUtc: event.lastModifiedMs === undefined ? iso(event.startMs) : iso(event.lastModifiedMs),
    };
  }
}


const WRITE_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/u;
const WRITE_UID_PATTERN = /^[A-Za-z0-9@][A-Za-z0-9@._-]{0,127}$/u;

function assertWriteUtc(value: unknown, field: string): string {
  if (typeof value !== 'string' || !WRITE_UTC_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ProtocolError('INVALID_ARGUMENT', `Calendar ${field} must be an ISO-8601 UTC instant`);
  }
  return `${value.slice(0, 19)}.${(value.match(/\.(\d{3})Z$/u) ?? ['', '000'])[1]}Z`;
}

function assertWriteUid(value: unknown): string {
  if (typeof value !== 'string' || !WRITE_UID_PATTERN.test(value) || value.includes('..')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Calendar event UID is malformed');
  }
  return value;
}

function stamp(instant: number): string {
  return `${new Date(instant).toISOString().slice(0, 19).replace(/[-:]/gu, '')}Z`;
}

function escapeIcal(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/;/gu, '\\;').replace(/,/gu, '\\,').replace(/\r?\n/gu, '\\n');
}

function buildIcs(input: {uid: string; summary: string; startUtc: string; endUtc: string;
  location?: string; notes?: string}, dtstamp: string, sequence?: number): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//personal-agent//calendar 0.1.0-alpha.1//CN',
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${input.startUtc.slice(0, 19).replace(/[-:]/gu, '')}Z`,
    `DTEND:${input.endUtc.slice(0, 19).replace(/[-:]/gu, '')}Z`,
    `SUMMARY:${escapeIcal(input.summary)}`,
  ];
  if (input.location !== undefined && input.location.trim()) lines.push(`LOCATION:${escapeIcal(input.location.trim())}`);
  if (input.notes !== undefined && input.notes.trim()) lines.push(`DESCRIPTION:${escapeIcal(input.notes.trim())}`);
  if (sequence !== undefined) lines.push(`SEQUENCE:${sequence}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(foldIcalLine).join('\r\n')}\r\n`;
}

/** RFC 5545: fold at 75 octets without splitting a UTF-8 code point. */
function foldIcalLine(line: string): string {
  let result = '', current = '', bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > 75) {result += current + '\r\n';current = ' ';bytes = 1;}
    current += character;bytes += size;
  }
  return result + current;
}
