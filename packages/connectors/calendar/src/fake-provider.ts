import { ProtocolError } from '@personal-agent/contracts';
import type {
  CalendarEventRecord,
  CalendarFetchPage,
  CalendarProvider,
  CalendarRespondInput,
  CalendarRespondResult,
  CalendarSummary,
  CalendarWindow,
} from './provider.js';
import type {CalendarEventUpdateInput, CalendarEventWriteInput} from './provider.js';

/**
 * Fake 日历提供商（测试专用）。夹具以 UTC 瞬间给定，本地表示在构造时按
 * 各事件时区用 Intl 推导，保证 start/end 的时区语义与真实提供商一致。
 */
export const defaultCalendarFixtures: CalendarEventRecord[] = [
  {
    externalId: 'evt-standup',
    calendarId: 'cal-work',
    title: '每日站会',
    startUtc: '2026-09-07T01:30:00.000Z',
    endUtc: '2026-09-07T01:45:00.000Z',
    timeZone: 'Asia/Shanghai',
    startLocal: '2026-09-07T09:30:00',
    endLocal: '2026-09-07T09:45:00',
    status: 'confirmed',
    organizer: 'lead@example.com',
    attendees: ['lead@example.com', 'me@example.com'],
    sequence: 1,
    updatedUtc: '2026-09-05T08:00:00.000Z',
  },
  {
    externalId: 'evt-review',
    calendarId: 'cal-work',
    title: '架构评审',
    startUtc: '2026-09-08T09:00:00.000Z',
    endUtc: '2026-09-08T10:30:00.000Z',
    timeZone: 'Asia/Shanghai',
    startLocal: '2026-09-08T17:00:00',
    endLocal: '2026-09-08T18:30:00',
    status: 'tentative',
    organizer: 'arch@example.com',
    attendees: ['arch@example.com', 'me@example.com'],
    sequence: 2,
    updatedUtc: '2026-09-06T12:00:00.000Z',
  },
  {
    // 跨 DST 回拨夜的事件：纽约 2026-11-01 01:30（EDT=UTC-4）= 05:30Z，
    // 结束 03:00 已在 EST（UTC-5）= 08:00Z。同一个事件的起止落在不同偏移上。
    externalId: 'evt-dst-night',
    calendarId: 'cal-work',
    title: '夜班交接（跨 DST）',
    startUtc: '2026-11-01T05:30:00.000Z',
    endUtc: '2026-11-01T08:00:00.000Z',
    timeZone: 'America/New_York',
    startLocal: '2026-11-01T01:30:00',
    endLocal: '2026-11-01T03:00:00',
    status: 'confirmed',
    organizer: 'ops@example.com',
    sequence: 1,
    updatedUtc: '2026-10-20T00:00:00.000Z',
  },
  {
    externalId: 'evt-cancelled',
    calendarId: 'cal-work',
    title: '已取消的会议',
    startUtc: '2026-09-09T02:00:00.000Z',
    endUtc: '2026-09-09T03:00:00.000Z',
    timeZone: 'Asia/Shanghai',
    startLocal: '2026-09-09T10:00:00',
    endLocal: '2026-09-09T11:00:00',
    status: 'cancelled',
    organizer: 'someone@example.com',
    sequence: 3,
    updatedUtc: '2026-09-06T18:00:00.000Z',
  },
];

export interface FakeCalendarProviderOptions {
  pageSize?: number;
  now?: () => number;
}

export class FakeCalendarProvider implements CalendarProvider {
  readonly providerKind = 'fixture';
  readonly verification = 'mock';
  private readonly events = new Map<string, CalendarEventRecord>();
  private readonly responses = new Map<string, CalendarRespondInput>();
  private nextEventId = 0;

  constructor(
    fixtures: CalendarEventRecord[] = defaultCalendarFixtures,
    private readonly options: FakeCalendarProviderOptions = {},
  ) {
    for (const event of structuredClone(fixtures)) this.events.set(event.externalId, event);
  }

  listCalendars(): CalendarSummary[] {
    const calendars = new Map<string, string>();
    for (const event of this.events.values()) calendars.set(event.calendarId, event.timeZone);
    return [...calendars.entries()].map(([id, timeZone]) => ({id, name: id, timeZone}));
  }

  fetchWindow(_accountRef: string, window: CalendarWindow, cursor?: string): CalendarFetchPage {
    const from = Date.parse(window.fromUtc);
    const to = Date.parse(window.toUtc);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Window must be a valid ascending UTC interval');
    }
    const pageSize = this.options.pageSize ?? 2;
    const offset = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid cursor');
    const scoped = [...this.events.values()]
      .filter(event => Date.parse(event.startUtc) < to && Date.parse(event.endUtc) > from)
      .sort((left, right) => left.startUtc.localeCompare(right.startUtc) || left.externalId.localeCompare(right.externalId));
    const events = scoped.slice(offset, offset + pageSize);
    return {
      events: structuredClone(events),
      nextCursor: `${offset + events.length}`,
      hasMore: offset + events.length < scoped.length,
    };
  }

  getEvent(_accountRef: string, externalId: string): CalendarEventRecord | undefined {
    const event = this.events.get(externalId);
    return event === undefined ? undefined : structuredClone(event);
  }

  readonly writes = {
    createEvent: (input: CalendarEventWriteInput): Promise<CalendarEventRecord> => {
      const summary = typeof input?.summary === 'string' ? input.summary.trim() : '';
      if (!summary || summary.length > 512) throw new ProtocolError('INVALID_ARGUMENT', 'Calendar event summary is required (1..512 chars)');
      const startUtc = assertFakeUtc(input?.startUtc, 'startUtc');
      const endUtc = assertFakeUtc(input?.endUtc, 'endUtc');
      if (Date.parse(endUtc) <= Date.parse(startUtc)) throw new ProtocolError('INVALID_ARGUMENT', 'Calendar event endUtc must be after startUtc');
      const uid = input.uid === undefined ? `evt-fake-${++this.nextEventId}` : assertFakeUid(input.uid);
      if (this.events.has(uid)) throw new ProtocolError('INVALID_ARGUMENT', 'Calendar event UID already exists');
      const record: CalendarEventRecord = {
        externalId: uid, calendarId: 'cal-fake', title: summary,
        startUtc, endUtc, timeZone: 'UTC',
        startLocal: startUtc.slice(0, 19), endLocal: endUtc.slice(0, 19),
        status: 'confirmed', sequence: 0, updatedUtc: new Date(this.options.now?.() ?? Date.now()).toISOString(),
        ...(input.location === undefined ? {} : {location: input.location.trim()}),
        ...(input.notes === undefined ? {} : {notes: input.notes.trim()}),
      };
      this.events.set(uid, record);
      return Promise.resolve(structuredClone(record));
    },
    updateEvent: (input: CalendarEventUpdateInput): Promise<CalendarEventRecord> => {
      const existing = this.events.get(input?.uid ?? '');
      if (existing === undefined) throw new ProtocolError('NOT_FOUND', `Calendar event ${input?.uid} not found`);
      const merged: CalendarEventRecord = {...existing};
      if (typeof input.summary === 'string' && input.summary.trim()) merged.title = input.summary.trim();
      if (input.startUtc !== undefined) merged.startUtc = assertFakeUtc(input.startUtc, 'startUtc');
      if (input.endUtc !== undefined) merged.endUtc = assertFakeUtc(input.endUtc, 'endUtc');
      if (Date.parse(merged.endUtc) <= Date.parse(merged.startUtc)) throw new ProtocolError('INVALID_ARGUMENT', 'Calendar event endUtc must be after startUtc');
      if (input.location !== undefined) merged.location = input.location.trim();
      if (input.notes !== undefined) merged.notes = input.notes.trim();
      merged.sequence = existing.sequence + 1;
      merged.updatedUtc = new Date(this.options.now?.() ?? Date.now()).toISOString();
      this.events.set(merged.externalId, merged);
      return Promise.resolve(structuredClone(merged));
    },
    cancelEvent: (uid: string): Promise<{uid: string; state: 'cancelled' | 'already_absent'}> => {
      // 与真实 CalDAV DELETE 语义一致：资源整体移除（读窗口不再出现），而非标记状态。
      return Promise.resolve(this.events.delete(uid ?? '') ? {uid, state: 'cancelled'} : {uid, state: 'already_absent'});
    },
  };

  respond(input: CalendarRespondInput): CalendarRespondResult {
    if (!input || typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length === 0) {
      throw new ProtocolError('INVALID_ARGUMENT', 'idempotencyKey is required');
    }
    if (input.response !== 'accepted' && input.response !== 'declined' && input.response !== 'tentative') {
      throw new ProtocolError('INVALID_ARGUMENT', 'response must be accepted, declined or tentative');
    }
    if (!this.events.has(input.externalId)) throw new ProtocolError('NOT_FOUND', `Event ${input.externalId} not found`);
    const prior = this.responses.get(input.idempotencyKey);
    if (prior !== undefined) {
      if (prior.externalId !== input.externalId || prior.response !== input.response) {
        throw new ProtocolError('INVALID_ARGUMENT', 'idempotencyKey reused with different input');
      }
      return {externalId: prior.externalId, response: prior.response};
    }
    this.responses.set(input.idempotencyKey, {...input});
    return {externalId: input.externalId, response: input.response};
  }

  /** 测试辅助：变更一个事件（模拟提供商侧改期，sequence 递增）。 */
  mutateEvent(externalId: string, patch: Partial<Pick<CalendarEventRecord, 'startUtc' | 'endUtc' | 'status' | 'title'>>): void {
    const event = this.events.get(externalId);
    if (!event) throw new Error(`No fixture ${externalId}`);
    Object.assign(event, patch, {sequence: event.sequence + 1, updatedUtc: '2026-09-07T00:00:00.000Z'});
  }
}


function assertFakeUtc(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/u.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new ProtocolError('INVALID_ARGUMENT', `Calendar ${field} must be an ISO-8601 UTC instant`);
  }
  return `${value.slice(0, 19)}.${(value.match(/\.(\d{3})Z$/u) ?? ['', '000'])[1]}Z`;
}

function assertFakeUid(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9@][A-Za-z0-9@._-]{0,127}$/u.test(value) || value.includes('..')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Calendar event UID is malformed');
  }
  return value;
}
