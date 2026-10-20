/** 日历提供商端口：实现方负责真实 API 或 Fake 夹具，本包只做规范化。 */
export interface CalendarSummary {
  id: string;
  name: string;
  timeZone: string;
}

export type CalendarEventStatus = 'confirmed' | 'tentative' | 'cancelled';
export type CalendarResponse = 'accepted' | 'declined' | 'tentative';

/** 提供商侧事件：UTC 瞬间与原始时区/本地墙上时间成对出现，时区正确性在源头保证。 */
export interface CalendarEventRecord {
  externalId: string;
  calendarId: string;
  title: string;
  startUtc: string;
  endUtc: string;
  timeZone: string;
  startLocal: string;
  endLocal: string;
  status: CalendarEventStatus;
  organizer?: string;
  location?: string;
  notes?: string;
  attendees?: string[];
  /** 提供商修订号：变更后递增，参与 dedupeKey。 */
  sequence: number;
  updatedUtc: string;
}

export interface CalendarWindow {
  fromUtc: string;
  toUtc: string;
}

/** Optional trusted-host read lifetime; deadline is an absolute ISO UTC instant. */
export interface CalendarReadContext {
  readonly signal?: AbortSignal;
  readonly deadline?: string;
}

export interface CalendarFetchPage {
  events: CalendarEventRecord[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface CalendarRespondInput {
  accountRef: string;
  externalId: string;
  response: CalendarResponse;
  idempotencyKey: string;
}

export interface CalendarRespondResult {
  externalId: string;
  response: CalendarResponse;
}

/** 事件写输入：全部字段为规范 UTC 瞬间；UID 缺省由提供商生成。 */
export interface CalendarEventWriteInput {
  summary: string;
  startUtc: string;
  endUtc: string;
  location?: string;
  notes?: string;
  /** 指定 UID 时创建重放幂等（同 UID 同内容 PUT）；缺省由提供商生成。 */
  uid?: string;
}

export interface CalendarEventUpdateInput {
  uid: string;
  summary?: string;
  startUtc?: string;
  endUtc?: string;
  location?: string;
  notes?: string;
}

/** 可选事件写能力：提供商声明后，register() 才公布 calendar.create/update/cancel 工具。 */
export interface CalendarEventWrites {
  createEvent(input: CalendarEventWriteInput, context?: CalendarReadContext): Promise<CalendarEventRecord>;
  updateEvent(input: CalendarEventUpdateInput, context?: CalendarReadContext): Promise<CalendarEventRecord>;
  cancelEvent(uid: string, context?: CalendarReadContext): Promise<{uid: string; state: 'cancelled' | 'already_absent'}>;
}

export interface CalendarProvider {
  /** 账号类型（进 manifest.accountTypes），Fake 为 'fixture'。 */
  readonly providerKind: string;
  /** 提供商验证等级（透传到连接器 manifest.verification）：Fake 为 'mock'，网络型真实源为 'conditional'。 */
  readonly verification: 'mock' | 'verified' | 'conditional';
  listCalendars(accountRef: string): CalendarSummary[] | Promise<CalendarSummary[]>;
  fetchWindow(accountRef: string, window: CalendarWindow, cursor?: string, context?: CalendarReadContext): CalendarFetchPage | Promise<CalendarFetchPage>;
  getEvent(accountRef: string, externalId: string, context?: CalendarReadContext): CalendarEventRecord | undefined | Promise<CalendarEventRecord | undefined>;
  respond(input: CalendarRespondInput): CalendarRespondResult | Promise<CalendarRespondResult>;
  /** 可选事件写能力；缺省（未声明）时本包不注册 calendar.create/update/cancel。 */
  readonly writes?: CalendarEventWrites;
}
