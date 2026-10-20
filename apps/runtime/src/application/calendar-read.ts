import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext} from '@personal-agent/contracts';
import {CalDavProvider, CalendarService} from '@personal-agent/calendar';
import type {CalDavFetchLike} from '@personal-agent/calendar';

export const CALENDAR_EVENT_READ_TOOL = 'calendar.read_event';
export const CALENDAR_EVENT_READ_VERSION = '0.1.0-alpha.1';

/** Trusted composition input, not a wire DTO or a credential container. */
export interface CalendarReadBinding {
  readonly configurationId: string;
  readonly accountRef: string;
  readonly calendarUrl: string;
  readonly calendarName?: string;
}
export interface CalendarEventReadOptions {
  readonly getBinding: () => CalendarReadBinding | undefined;
  readonly readAuthorization: (binding: CalendarReadBinding) => string | Promise<string>;
  readonly fetchImpl?: CalDavFetchLike;
  readonly now?: () => number;
}

/** Registered read only: Runtime Policy/ToolGateway authorizes each invocation.
 * No connector write, implicit permission, cloud export or background polling.
 */
export function createCalendarEventReadTool(options: CalendarEventReadOptions): RegisteredTool {
  if (typeof options?.getBinding !== 'function' || typeof options.readAuthorization !== 'function') {
    throw new ProtocolError('INVALID_ARGUMENT', 'Trusted calendar binding and credentials ports are required');
  }
  const now = options.now ?? Date.now;
  const request = options.fetchImpl ?? ((url, init) => fetch(url, init));
  return {
    descriptor: {
      name: CALENDAR_EVENT_READ_TOOL, version: CALENDAR_EVENT_READ_VERSION,
      sideEffect: 'read', requiredScopes: ['calendar:read'], requiresPresence: false,
      idempotencySupport: true, recoverySupport: true,
      inputSchema: {type: 'object', required: ['configurationId', 'externalId'], additionalProperties: false,
        properties: {configurationId: {type: 'string', pattern: '^[a-f0-9]{64}$'},
          externalId: {type: 'string', minLength: 1, maxLength: 512, pattern: '^[^\\u0000-\\u001f\\u007f]+$'}}},
      outputSchema: {$ref: 'https://personalagent.local/protocol/1.0.0#/definitions/ConnectorItem'},
    },
    async execute(raw: unknown, context: ToolContext) {
      const input = raw as {configurationId?: unknown; externalId?: unknown};
      if (!input || Object.keys(input).sort().join(',') !== 'configurationId,externalId'
        || typeof input.configurationId !== 'string' || !/^[a-f0-9]{64}$/.test(input.configurationId)
        || typeof input.externalId !== 'string' || !input.externalId.trim() || input.externalId.length > 512
        || /[\u0000-\u001f\u007f]/.test(input.externalId)) {
        throw new ProtocolError('INVALID_ARGUMENT', 'Calendar read arguments are invalid');
      }
      const externalId = input.externalId;
      const remaining = Date.parse(context.deadline) - now();
      if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Calendar read was cancelled');
      if (!Number.isFinite(remaining) || remaining <= 0) throw new ProtocolError('TIMEOUT', 'Calendar read deadline has expired');
      const live = options.getBinding();
      if (!live || live.configurationId !== input.configurationId || !live.accountRef) {
        throw new ProtocolError('UNAUTHORIZED', 'Calendar configuration changed or was revoked');
      }
      const binding = structuredClone(live);
      const controller = new AbortController();
      const signal = AbortSignal.any([context.signal, controller.signal]);
      const timer = setTimeout(() => controller.abort(), Math.min(remaining, 120_000));
      const stopped = () => {
        if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Calendar read was cancelled');
        if (signal.aborted || now() >= Date.parse(context.deadline)) throw new ProtocolError('TIMEOUT', 'Calendar read deadline has expired');
        if (!isDeepStrictEqual(options.getBinding(), binding)) throw new ProtocolError('UNAUTHORIZED', 'Calendar configuration changed or was revoked');
      };
      async function bounded<T>(operation: Promise<T>): Promise<T> {
        let rejectAbort: (() => void) | undefined;
        try {
          return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
            rejectAbort = () => reject(new ProtocolError(context.signal.aborted ? 'CANCELLED' : 'TIMEOUT', 'Calendar read stopped'));
            signal.addEventListener('abort', rejectAbort, {once: true});
            if (signal.aborted) rejectAbort();
          })]);
        } finally {if (rejectAbort) signal.removeEventListener('abort', rejectAbort);}
      }
      try {
        stopped();
        const authorization = await bounded(Promise.resolve(options.readAuthorization(binding)));
        stopped();
        if (typeof authorization !== 'string' || !authorization || /[\r\n]/.test(authorization)) {
          throw new ProtocolError('UNAUTHORIZED', 'Calendar credentials are unavailable');
        }
        const provider = new CalDavProvider({calendarUrl: binding.calendarUrl, authorization,
          // allowLoopbackHttp 与 provider/桌面 collectionUrl 语义对齐：否决非回环明文，仅回环 HTTP 放行。
          allowLoopbackHttp: /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/u.test(binding.calendarUrl),
          ...(binding.calendarName === undefined ? {} : {calendarName: binding.calendarName}),
          requestTimeoutMs: Math.max(1, Math.min(120_000, Date.parse(context.deadline) - now())),
          fetchImpl: (url, init) => {
            stopped();
            return request(url, {...init, signal: AbortSignal.any([init.signal, signal])});
          }});
        const item = await bounded(new CalendarService(provider, {now}).getEventItem(binding.accountRef, externalId));
        stopped();
        return item;
      } catch (cause) {
        stopped();
        throw cause;
      } finally {clearTimeout(timer);}
    },
  };
}
