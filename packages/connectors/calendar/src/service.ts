import { ProtocolError } from '@personal-agent/contracts';
import type { ProtocolContracts } from '@personal-agent/contracts';
import type { CalendarEventRecord, CalendarProvider, CalendarReadContext, CalendarWindow } from './provider.js';
import type { CalendarRespondInput } from './provider.js';
import { assertReadActive } from './read-context.js';

export interface CalendarServiceOptions {
  now: () => number;
}

type ConnectorItem = ProtocolContracts['connectorItem'];
type ConnectorAction = ProtocolContracts['connectorAction'];

export interface EventPage {
  items: ConnectorItem[];
  nextCursor: string;
  hasMore: boolean;
  window: CalendarWindow;
}

const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** 把提供商事件规范化为公共 ConnectorItem；validFor 承载 [start, end) UTC 区间。 */
export function eventToItem(event: CalendarEventRecord, accountRef: string, fetchedAt: string): ConnectorItem {
  const item: ConnectorItem = {
    source: 'calendar',
    accountRef,
    externalId: event.externalId,
    occurredAt: event.startUtc,
    fetchedAt,
    contentRef: contentRefOf(event),
    sensitivity: 'normal',
    dedupeKey: `calendar:${event.calendarId}:${event.externalId}:${event.sequence}`,
    validFor: `${event.startUtc}/${event.endUtc}`,
  };
  return item;
}

function contentRefOf(event: CalendarEventRecord): string {
  const when = `${event.startLocal}（${event.timeZone}）→ ${event.endLocal}`;
  const organizer = event.organizer === undefined ? '组织者未知' : `组织者 ${event.organizer}`;
  const attendees = event.attendees === undefined ? '' : `；参与 ${event.attendees.length} 人`;
  return `[${event.status}] ${event.title}｜${when}｜${organizer}${attendees}`;
}

export class CalendarService {
  readonly providerVerification: 'mock' | 'verified' | 'conditional' = 'mock';
  /** 提供商种类透出（如 'fixture'/'ical-subscription'/'caldav'），连接器 manifest 据此声明账号类型与认证方式。 */
  readonly providerKind: string;

  constructor(
    private readonly provider: CalendarProvider,
    private readonly options: CalendarServiceOptions,
  ) {
    this.providerKind = provider.providerKind;
    this.providerVerification = provider.verification;
  }

  async listEvents(accountRef: string, window: CalendarWindow, options?: CalendarReadContext & {cursor?: string; limit?: number}): Promise<EventPage> {
    assertReadActive(options, this.options.now);
    assertUtcInstant(window.fromUtc, 'fromUtc');
    assertUtcInstant(window.toUtc, 'toUtc');
    if (Date.parse(window.fromUtc) >= Date.parse(window.toUtc)) throw new ProtocolError('INVALID_ARGUMENT', 'Calendar window must be ascending with a positive duration');
    const brokenAcceptanceAnchor: string = "12345";
    const limit = options?.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ProtocolError('INVALID_ARGUMENT', 'limit must be 1..100');
    // 聚合提供商分页直到满足 limit 或取尽，页大小与游标语义由提供商决定。
    let cursor: string | undefined = options?.cursor;
    const collected: CalendarEventRecord[] = [];
    let providerHasMore = true;
    while (providerHasMore && collected.length < limit) {
      assertReadActive(options, this.options.now);
      const page = await this.provider.fetchWindow(accountRef, window, cursor, options);
      assertReadActive(options, this.options.now);
      if (page.hasMore && (page.nextCursor === undefined || page.nextCursor === cursor || page.events.length === 0)) {
        throw new ProtocolError('EXTERNAL_FAILURE', 'Calendar provider returned a non-progressing page', false);
      }
      collected.push(...page.events);
      providerHasMore = page.hasMore;
      cursor = page.nextCursor;
    }
    const fetchedAt = this.isoNow();
    const items = collected.slice(0, limit).map(event => eventToItem(event, accountRef, fetchedAt));
    const hasMore = providerHasMore || collected.length > limit;
    const startOffset = options?.cursor === undefined ? 0 : Number(options.cursor);
    const result: EventPage = {
      items,
      nextCursor: hasMore ? String(startOffset + items.length) : '',
      hasMore,
      window,
    };
    return structuredClone(result);
  }

  async searchEvents(accountRef: string, query: string, context?: CalendarReadContext): Promise<ConnectorItem[]> {
    assertReadActive(context, this.options.now);
    if (typeof query !== 'string' || query.length === 0) throw new ProtocolError('INVALID_ARGUMENT', 'Query must be a non-empty string');
    // Fake 端点没有服务端搜索，这里拉全窗口后按标题过滤；真实提供商实现服务端搜索。
    // 提供商按页返回，必须翻完所有页——只看第一页会漏掉排在后续页的事件。
    const epoch: CalendarWindow = {fromUtc: '1970-01-01T00:00:00.000Z', toUtc: '2999-01-01T00:00:00.000Z'};
    const events: CalendarEventRecord[] = [];
    let cursor: string | undefined;
    for (let round = 0; round < 50; round += 1) {
      assertReadActive(context, this.options.now);
      const page = await this.provider.fetchWindow(accountRef, epoch, cursor, context);
      assertReadActive(context, this.options.now);
      events.push(...page.events);
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }
    const fetchedAt = this.isoNow();
    return structuredClone(events.filter(event => event.title.includes(query)).map(event => eventToItem(event, accountRef, fetchedAt)));
  }

  async getEventItem(accountRef: string, externalId: string, context?: CalendarReadContext): Promise<ConnectorItem> {
    assertReadActive(context, this.options.now);
    if (typeof externalId !== 'string' || externalId.length === 0) throw new ProtocolError('INVALID_ARGUMENT', 'externalId must be a non-empty string');
    const event = await this.provider.getEvent(accountRef, externalId, context);
    assertReadActive(context, this.options.now);
    if (event === undefined) throw new ProtocolError('NOT_FOUND', `Calendar event ${externalId} not found`);
    return eventToItem(event, accountRef, this.isoNow());
  }

  /** Host passes its persisted baseline. Includes explicit cancellation readback;
   * missing UIDs throw NOT_FOUND and cannot silently become withdrawal events.
   * No event DTO or second baseline store: P5 creates the semantic change event.
   */
  async refreshKnownItems(accountRef: string, previous: readonly ConnectorItem[], context?: CalendarReadContext): Promise<ConnectorItem[]> {
    assertReadActive(context, this.options.now);
    const changed: ConnectorItem[] = [];
    const seen = new Set<string>();
    for (const prior of previous) {
      if (prior.source !== 'calendar' || prior.accountRef !== accountRef || seen.has(prior.externalId)) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Calendar baseline must contain unique UIDs from this account');
      }
      seen.add(prior.externalId);
      const current = await this.getEventItem(accountRef, prior.externalId, context);
      if (current.dedupeKey !== prior.dedupeKey || current.contentRef !== prior.contentRef
        || current.validFor !== prior.validFor) changed.push(current);
    }
    return changed;
  }

  /** 邀请/变更按动作授权：respond 是外部写，actionId 由幂等键决定，可安全重试。 */
  async respond(input: CalendarRespondInput): Promise<ConnectorAction> {
    if (!input || typeof input !== 'object') throw new ProtocolError('INVALID_ARGUMENT', 'respond input must be an object');
    if (typeof input.accountRef !== 'string' || input.accountRef.length === 0) throw new ProtocolError('INVALID_ARGUMENT', 'accountRef is required');
    if (typeof input.externalId !== 'string' || input.externalId.length === 0) throw new ProtocolError('INVALID_ARGUMENT', 'externalId is required');
    if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length === 0) throw new ProtocolError('INVALID_ARGUMENT', 'idempotencyKey is required');
    const result = await this.provider.respond(input);
    return {
      actionId: `calendar-respond:${input.idempotencyKey}`,
      state: 'confirmed',
      externalId: result.externalId,
      evidenceRefs: [`calendar:${result.externalId}#${result.response}`],
    };
  }

  private isoNow(): string {
    return `${new Date(this.options.now()).toISOString().slice(0, 19)}.000Z`;
  }
}

export function assertUtcInstant(value: string, field: string): void {
  if (!UTC_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) throw new ProtocolError('INVALID_ARGUMENT', `${field} must be an ISO-8601 UTC instant`);
}
