import { ProtocolError } from '@personal-agent/contracts';
import type { RegisteredTool, ToolDescriptor, ToolHost } from '@personal-agent/contracts';
import { CalendarConnector, CALENDAR_CONNECTOR_VERSION } from './connector.js';
import { CalendarService, eventToItem } from './service.js';
import type { CalendarReadContext, CalendarWindow } from './provider.js';
import type { CalendarProvider } from './provider.js';

export { CalendarConnector, CALENDAR_CONNECTOR_VERSION } from './connector.js';
export { ICalSubscriptionProvider, parseIcalEvents, unfoldLines, unescapeIcalText, parseIcalDate } from './ical-subscription.js';
export type { FetchLike, FetchResponseLike, ICalSubscriptionOptions } from './ical-subscription.js';
export { CalDavProvider, parseCalDavEvents, zonedWallToUtc } from './caldav.js';
export type { CalDavFetchLike, CalDavFetchResponseLike, CalDavReadProviderOptions, CalDavChangeSnapshot } from './caldav.js';
export { CalendarService, eventToItem } from './service.js';
export { FakeCalendarProvider, defaultCalendarFixtures } from './fake-provider.js';
export type { CalendarEventRecord, CalendarFetchPage, CalendarProvider, CalendarReadContext, CalendarRespondInput, CalendarRespondResult, CalendarSummary, CalendarWindow } from './provider.js';
export type { CalendarServiceOptions, EventPage } from './service.js';

const PROTOCOL_ID = 'https://personalagent.local/protocol/1.0.0';
const UTC_PATTERN_STRING = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$';

const eventsInputSchema: ToolDescriptor['inputSchema'] = {
  type: 'object',
  description: '按时间窗读取日历事件。缺省窗口为当前时刻起的 defaultWindowDays 天（默认 7）。窗口以 UTC 瞬间给出；返回条目的 validFor 承载 [start, end) UTC 区间，contentRef 含目标时区的本地墙上时间。',
  properties: {
    fromUtc: {type: 'string', pattern: UTC_PATTERN_STRING, description: '窗口起点（含）。缺省为当前时刻。'},
    toUtc: {type: 'string', pattern: UTC_PATTERN_STRING, description: '窗口终点（不含）。缺省为起点 + defaultWindowDays 天。'},
    limit: {type: 'integer', minimum: 1, maximum: 100, description: '单页条数上限，默认 20。'},
    cursor: {type: 'string', minLength: 1, description: '上一页返回的 nextCursor；空字符串表示没有更多页。'},
  },
  additionalProperties: false,
};

const eventsOutputSchema: ToolDescriptor['outputSchema'] = {
  type: 'object',
  required: ['items', 'window', 'hasMore', 'nextCursor'],
  additionalProperties: false,
  properties: {
    items: {type: 'array', items: {$ref: `${PROTOCOL_ID}#/definitions/ConnectorItem`}},
    window: {
      type: 'object',
      required: ['fromUtc', 'toUtc'],
      additionalProperties: false,
      properties: {
        fromUtc: {type: 'string', pattern: UTC_PATTERN_STRING},
        toUtc: {type: 'string', pattern: UTC_PATTERN_STRING},
      },
    },
    hasMore: {type: 'boolean'},
    nextCursor: {type: 'string'},
  },
};

const createEventInputSchema: ToolDescriptor['inputSchema'] = {
  type: 'object',
  description: '创建日历事件（external_write，经授权执行）。start/end 为严格 UTC 瞬间；写入后读回核对再返回记录。uid 可选：给 uid 时同 UID 重放幂等；缺省时按事件内容确定性派生 UID——同内容重复提交命中同一资源（幂等），不同内容自然产生不同事件。',
  required: ['summary', 'startUtc', 'endUtc'],
  additionalProperties: false,
  properties: {
    summary: {type: 'string', minLength: 1, maxLength: 512},
    startUtc: {type: 'string', pattern: UTC_PATTERN_STRING},
    endUtc: {type: 'string', pattern: UTC_PATTERN_STRING},
    location: {type: 'string', maxLength: 512},
    notes: {type: 'string', maxLength: 4096},
    uid: {type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9@][A-Za-z0-9@._-]*$', description: '可选：显式资源 UID（重放/迁移场景）；缺省按事件内容确定性派生（同输入重放幂等，不再随机生成）。'},
  },
};

const updateEventInputSchema: ToolDescriptor['inputSchema'] = {
  type: 'object',
  description: '更新既有日历事件的字段（缺省字段保持原值）；SEQUENCE 递增后写回并读回核对。',
  required: ['uid'],
  additionalProperties: false,
  properties: {
    uid: {type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9@][A-Za-z0-9@._-]*$'},
    summary: {type: 'string', minLength: 1, maxLength: 512},
    startUtc: {type: 'string', pattern: UTC_PATTERN_STRING},
    endUtc: {type: 'string', pattern: UTC_PATTERN_STRING},
    location: {type: 'string', maxLength: 512},
    notes: {type: 'string', maxLength: 4096},
  },
};

const cancelEventInputSchema: ToolDescriptor['inputSchema'] = {
  type: 'object',
  description: '取消（删除）日历事件。资源不存在视为已取消（幂等），状态如实返回。',
  required: ['uid'],
  additionalProperties: false,
  properties: {uid: {type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9@][A-Za-z0-9@._-]*$'}},
};

const writeOutputSchema: ToolDescriptor['outputSchema'] = {
  type: 'object',
  required: ['state'],
  additionalProperties: false,
  properties: {
    item: {$ref: `${PROTOCOL_ID}#/definitions/ConnectorItem`, description: 'create/update 与 cancel 命中资源时返回的读回记录。'},
    uid: {type: 'string', description: '仅 cancel 且资源不存在时返回。'},
    state: {type: 'string', enum: ['created', 'updated', 'cancelled', 'already_absent']},
  },
};

export interface CalendarModuleOptions {
  provider: CalendarProvider;
  accountRef?: string;
  now?: () => number;
  defaultWindowDays?: number;
}

export function register(host: ToolHost, options: CalendarModuleOptions): () => void {
  if (!options?.provider) throw new ProtocolError('INVALID_ARGUMENT', 'Calendar provider must be explicitly configured; fake providers are test-only');
  const accountRef = options.accountRef ?? 'local';
  const service = new CalendarService(options.provider, {now: options.now ?? Date.now});
  const connectorOptions: {defaultWindowDays?: number} = {};
  if (options.defaultWindowDays !== undefined) connectorOptions.defaultWindowDays = options.defaultWindowDays;
  const connector = new CalendarConnector(service, CALENDAR_CONNECTOR_VERSION, connectorOptions);
  connector.connect();

  const tool: RegisteredTool = {
    descriptor: {
      name: 'calendar.events',
      version: CALENDAR_CONNECTOR_VERSION,
      inputSchema: eventsInputSchema,
      outputSchema: eventsOutputSchema,
      sideEffect: 'read',
      requiredScopes: ['calendar:read'],
      idempotencySupport: true,
      recoverySupport: true,
      requiresPresence: false,
    },
    execute: async (input: unknown, context) => {
      const raw = input as {fromUtc?: string; toUtc?: string; limit?: number; cursor?: string};
      const window = resolveWindow(raw, options.defaultWindowDays ?? 7, options.now ?? Date.now);
      const listArgs: CalendarReadContext & {cursor?: string; limit?: number} = {signal: context.signal, deadline: context.deadline};
      if (typeof raw.cursor === 'string' && raw.cursor.length > 0) listArgs.cursor = cursorToOffset(raw.cursor);
      if (raw.limit !== undefined) listArgs.limit = raw.limit;
      const page = await service.listEvents(accountRef, window, listArgs);
      return {
        items: page.items,
        window: page.window,
        hasMore: page.hasMore,
        nextCursor: page.hasMore ? encodePageCursor(page.window.fromUtc, page.window.toUtc, Number(page.nextCursor)) : '',
      };
    },
  };

  const writes = options.provider.writes;
  const writeUnregisters: (() => void)[] = [];
  if (writes !== undefined && typeof writes.createEvent === 'function'
    && typeof writes.updateEvent === 'function' && typeof writes.cancelEvent === 'function') {
    const writeDescriptorBase = {
      version: CALENDAR_CONNECTOR_VERSION,
      sideEffect: 'external_write' as const,
      requiredScopes: ['calendar:write'],
      requiresPresence: false,
    };
    const createTool: RegisteredTool = {
      descriptor: {...writeDescriptorBase, name: 'calendar.create',
        inputSchema: createEventInputSchema, outputSchema: writeOutputSchema,
        idempotencySupport: false, recoverySupport: false},
      execute: async (input: unknown, context) => {
        const raw = input as {summary: string; startUtc: string; endUtc: string; location?: string; notes?: string; uid?: string};
        const record = await writes.createEvent({
          summary: raw.summary, startUtc: raw.startUtc, endUtc: raw.endUtc,
          ...(raw.location === undefined ? {} : {location: raw.location}),
          ...(raw.notes === undefined ? {} : {notes: raw.notes}),
          ...(raw.uid === undefined ? {} : {uid: raw.uid})},
          {signal: context.signal, deadline: context.deadline});
        return {item: eventToItem(record, accountRef, new Date().toISOString()), state: 'created'};
      },
    };
    const updateTool: RegisteredTool = {
      descriptor: {...writeDescriptorBase, name: 'calendar.update',
        inputSchema: updateEventInputSchema, outputSchema: writeOutputSchema,
        idempotencySupport: true, recoverySupport: true},
      execute: async (input: unknown, context) => {
        const raw = input as {uid: string; summary?: string; startUtc?: string; endUtc?: string; location?: string; notes?: string};
        const record = await writes.updateEvent({
          uid: raw.uid,
          ...(raw.summary === undefined ? {} : {summary: raw.summary}),
          ...(raw.startUtc === undefined ? {} : {startUtc: raw.startUtc}),
          ...(raw.endUtc === undefined ? {} : {endUtc: raw.endUtc}),
          ...(raw.location === undefined ? {} : {location: raw.location}),
          ...(raw.notes === undefined ? {} : {notes: raw.notes})},
          {signal: context.signal, deadline: context.deadline});
        return {item: eventToItem(record, accountRef, new Date().toISOString()), state: 'updated'};
      },
    };
    const cancelTool: RegisteredTool = {
      descriptor: {...writeDescriptorBase, name: 'calendar.cancel',
        inputSchema: cancelEventInputSchema, outputSchema: writeOutputSchema,
        idempotencySupport: true, recoverySupport: true},
      execute: async (input: unknown, context) => {
        const raw = input as {uid: string};
        const result = await writes.cancelEvent(raw.uid, {signal: context.signal, deadline: context.deadline});
        // DELETE 后资源已移除，多数服务器读不回条目；能读回（如状态标记式实现）才附带 item。
        const item = result.state === 'cancelled'
          ? await service.getEventItem(accountRef, raw.uid, {signal: context.signal, deadline: context.deadline}).catch(() => undefined)
          : undefined;
        return item === undefined
          ? {uid: raw.uid, state: result.state}
          : {item, state: result.state};
      },
    };
    writeUnregisters.push(host.register(createTool), host.register(updateTool), host.register(cancelTool));
  }
  const unregister = host.register(tool);
  return () => {
    unregister();
    for (const dispose of writeUnregisters) dispose();
    connector.disconnect();
  };
}

function resolveWindow(raw: {fromUtc?: string; toUtc?: string}, defaultWindowDays: number, now: () => number): CalendarWindow {
  const fromMs = raw.fromUtc === undefined ? now() : Date.parse(raw.fromUtc);
  const toMs = raw.toUtc === undefined ? fromMs + defaultWindowDays * 24 * 60 * 60 * 1000 : Date.parse(raw.toUtc);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Window must be a valid ascending UTC interval');
  }
  return {fromUtc: `${new Date(fromMs).toISOString().slice(0, 19)}.000Z`, toUtc: `${new Date(toMs).toISOString().slice(0, 19)}.000Z`};
}

interface PageCursor {
  fromUtc: string;
  toUtc: string;
  offset: number;
}

function encodePageCursor(fromUtc: string, toUtc: string, offset: number): string {
  return Buffer.from(JSON.stringify({fromUtc, toUtc, offset} satisfies PageCursor), 'utf8').toString('base64url');
}

function cursorToOffset(cursor: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new ProtocolError('INVALID_ARGUMENT', 'cursor is malformed');
  }
  const record = parsed as {offset?: unknown};
  if (parsed === null || typeof parsed !== 'object' || !Number.isSafeInteger(record.offset) || (record.offset as number) < 0) {
    throw new ProtocolError('INVALID_ARGUMENT', 'cursor is malformed');
  }
  return String(record.offset);
}

export type {ToolDescriptor};
