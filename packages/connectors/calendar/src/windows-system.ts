import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ProtocolError } from '@personal-agent/contracts';
import { assertReadActive } from './read-context.js';
import type {
  CalendarEventRecord,
  CalendarEventUpdateInput,
  CalendarEventWriteInput,
  CalendarEventWrites,
  CalendarFetchPage,
  CalendarProvider,
  CalendarReadContext,
  CalendarRespondInput,
  CalendarRespondResult,
  CalendarSummary,
  CalendarWindow,
} from './provider.js';

export interface WindowsSystemCalendarSummary {
  readonly id: string;
  readonly name: string;
  readonly canWrite: boolean;
}

export interface WindowsAppointmentRaw {
  readonly localId: string;
  readonly roamingId?: string;
  readonly calendarId: string;
  readonly subject: string;
  readonly startUtc: string;
  readonly endUtc: string;
  readonly location?: string;
  readonly details?: string;
  readonly changeNumber: number;
  readonly cancelled?: boolean;
  readonly organizer?: string;
  readonly inviteeCount?: number;
  readonly canWrite?: boolean;
}

export type WindowsCalendarRequest =
  | { readonly op: 'listCalendars' }
  | { readonly op: 'fetchWindow'; readonly fromUtc: string; readonly toUtc: string }
  | { readonly op: 'getEvent'; readonly externalId: string }
  | {
    readonly op: 'createEvent';
    readonly targetCalendarName: string;
    readonly summary: string;
    readonly startUtc: string;
    readonly endUtc: string;
    readonly location?: string;
    readonly notes?: string;
    readonly uid?: string;
  }
  | {
    readonly op: 'updateEvent';
    readonly targetCalendarName?: string;
    readonly uid: string;
    readonly summary?: string;
    readonly startUtc?: string;
    readonly endUtc?: string;
    readonly location?: string;
    readonly notes?: string;
    readonly expectedSequence?: number;
    readonly ifMatch?: string;
  }
  | { readonly op: 'cancelEvent'; readonly uid: string; readonly targetCalendarName?: string };

export interface WindowsCalendarTransport {
  run(request: WindowsCalendarRequest, context?: CalendarReadContext): Promise<unknown>;
}

export interface WindowsSystemCalendarOptions {
  /** Calendar display name in the Windows store used when creating new PersonalAgent events. */
  readonly calendarName?: string;
  /** Optional local IANA timezone override (defaults to system Intl resolved timezone). */
  readonly timeZone?: string;
  /** Single bridge call timeout in milliseconds (default 30_000). */
  readonly requestTimeoutMs?: number;
  /** Injectable Windows appointment transport for deterministic offline tests. */
  readonly transport?: WindowsCalendarTransport;
  /** Optional clock source shared with CalendarService. */
  readonly now?: () => number;
}

const DEFAULT_CALENDAR_NAME = 'PersonalAgent';
const DEFAULT_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;

const BRIDGE_SCRIPT_PATH = fileURLToPath(new URL('../scripts/windows-calendar-bridge.ps1', import.meta.url));

function createDefaultWindowsTransport(timeoutMs: number): WindowsCalendarTransport {
  return {
    run(request: WindowsCalendarRequest, context?: CalendarReadContext): Promise<unknown> {
      if (process.platform !== 'win32') {
        throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Windows system calendar requires win32', false);
      }
      if (context?.signal?.aborted) {
        throw new ProtocolError('CANCELLED', 'Windows system calendar request cancelled', false);
      }
      const deadlineRemaining = context?.deadline ? Date.parse(context.deadline) - Date.now() : timeoutMs;
      const effectiveMs = Math.max(1, Math.min(timeoutMs, Number.isFinite(deadlineRemaining) ? deadlineRemaining : timeoutMs));
      return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          BRIDGE_SCRIPT_PATH,
        ], {
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          context?.signal?.removeEventListener('abort', onAbort);
          fn();
        };
        const onAbort = () => {
          try { child.kill('SIGKILL'); } catch { /* noop */ }
          finish(() => reject(new ProtocolError('CANCELLED', 'Windows system calendar request cancelled', false)));
        };
        context?.signal?.addEventListener('abort', onAbort, {once: true});
        const timer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* noop */ }
          finish(() => reject(new ProtocolError('TIMEOUT', 'Windows system calendar bridge timed out', true)));
        }, effectiveMs);
        child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
        child.on('error', () => {
          finish(() => reject(new ProtocolError('UNSUPPORTED_CAPABILITY', 'Windows PowerShell host could not start', false)));
        });
        child.on('close', code => {
          finish(() => {
            const stdout = Buffer.concat(out).toString('utf8').trim();
            const stderr = Buffer.concat(err).toString('utf8').trim();
            if (code !== 0) {
              if (/READ_ONLY_SYSTEM_CALENDAR/.test(stderr)) {
                reject(new ProtocolError('UNAUTHORIZED', '系统外部只读日历中的事件不允许修改或删除', false));
                return;
              }
              if (/EVENT_NOT_FOUND/.test(stderr)) {
                reject(new ProtocolError('NOT_FOUND', 'Windows 系统日历中不存在指定事件', false));
                return;
              }
              if (/SEQUENCE_MISMATCH|ETAG_MISMATCH/.test(stderr)) {
                reject(new ProtocolError('REVISION_CONFLICT', '系统日历事件版本已变化，请刷新后重试', false));
                return;
              }
              if (/INVALID_WINDOW/.test(stderr)) {
                reject(new ProtocolError('INVALID_ARGUMENT', 'Event endUtc must be strictly after startUtc', false));
                return;
              }
              if (/Access is denied|UnauthorizedAccessException/i.test(stderr)) {
                reject(new ProtocolError('UNAUTHORIZED', '未获得系统日历访问权限', false));
                return;
              }
              reject(new ProtocolError('EXTERNAL_FAILURE', `Windows system calendar error: ${stderr || `exit ${code}`}`, true));
              return;
            }
            try {
              const lastLine = stdout.split(/\r?\n/u).filter(Boolean).at(-1) ?? '';
              resolve(JSON.parse(lastLine));
            } catch {
              reject(new ProtocolError('EXTERNAL_FAILURE', 'Windows system calendar returned invalid JSON', false));
            }
          });
        });
        child.stdin.end(JSON.stringify(request), 'utf8');
      });
    },
  };
}

function formatWallTime(utcMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const pick = (type: string): string => parts.find(p => p.type === type)?.value ?? '00';
  const hour = pick('hour') === '24' ? '00' : pick('hour');
  return `${pick('year')}-${pick('month')}-${pick('day')}T${hour}:${pick('minute')}:${pick('second')}`;
}

function normalizeUtcIso(raw: string): string {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    throw new ProtocolError('EXTERNAL_FAILURE', `Invalid timestamp from Windows calendar: ${raw}`, false);
  }
  return new Date(ms).toISOString();
}

function safeCalendarSegment(calendarId: string): string {
  const trimmed = calendarId.trim().replace(/:/gu, '_');
  return trimmed.length > 0 ? trimmed : 'windows-system';
}

function toRecord(raw: WindowsAppointmentRaw, timeZone: string, updatedFallbackIso: string): CalendarEventRecord {
  const startUtc = normalizeUtcIso(raw.startUtc);
  const endUtc = normalizeUtcIso(raw.endUtc);
  const externalId = typeof raw.roamingId === 'string' && raw.roamingId.trim() ? raw.roamingId.trim() : raw.localId;
  return {
    externalId,
    calendarId: safeCalendarSegment(raw.calendarId || 'windows-system'),
    title: typeof raw.subject === 'string' && raw.subject.length > 0 ? raw.subject : '(无标题)',
    startUtc,
    endUtc,
    timeZone,
    startLocal: formatWallTime(Date.parse(startUtc), timeZone),
    endLocal: formatWallTime(Date.parse(endUtc), timeZone),
    status: raw.cancelled ? 'cancelled' : 'confirmed',
    ...(typeof raw.organizer === 'string' && raw.organizer.length > 0 ? {organizer: raw.organizer} : {}),
    ...(typeof raw.location === 'string' && raw.location.length > 0 ? {location: raw.location} : {}),
    ...(typeof raw.details === 'string' && raw.details.length > 0 ? {notes: raw.details} : {}),
    ...(typeof raw.inviteeCount === 'number' && raw.inviteeCount > 0 ? {attendees: Array.from({length: raw.inviteeCount}, (_, i) => `attendee-${i + 1}`)} : {}),
    sequence: Number.isSafeInteger(raw.changeNumber) && raw.changeNumber >= 0 ? raw.changeNumber : 0,
    updatedUtc: updatedFallbackIso,
  };
}

function assertValidUtcWindow(startUtc: string, endUtc: string): void {
  const startMs = Date.parse(startUtc);
  const endMs = Date.parse(endUtc);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Calendar event window requires valid UTC instants with startUtc < endUtc', false);
  }
}

/**
 * Windows System Calendar provider backed by WinRT `Windows.ApplicationModel.Appointments.AppointmentManager`.
 * Reads all local/synced system calendars (`AllCalendarsReadOnly`) and writes PersonalAgent-managed events
 * cleanly to an app-scoped system calendar (`AppCalendarsReadWrite`) without external credentials or servers.
 */
export class WindowsSystemCalendarProvider implements CalendarProvider {
  readonly providerKind = 'windows-system';
  readonly verification = 'conditional' as const;
  private readonly calendarName: string;
  private readonly timeZone: string;
  private readonly transport: WindowsCalendarTransport;
  private readonly now: () => number;
  readonly writes: CalendarEventWrites;

  constructor(options: WindowsSystemCalendarOptions = {}) {
    const tz = options.timeZone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    try { new Intl.DateTimeFormat('en-US', {timeZone: tz}); }
    catch { throw new ProtocolError('INVALID_ARGUMENT', `Unsupported timezone: ${tz}`); }
    this.timeZone = tz;
    this.calendarName = typeof options.calendarName === 'string' && options.calendarName.trim()
      ? options.calendarName.trim()
      : DEFAULT_CALENDAR_NAME;
    this.now = options.now ?? Date.now;
    const timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new ProtocolError('INVALID_ARGUMENT', 'requestTimeoutMs must be 1..120000');
    }
    this.transport = options.transport ?? createDefaultWindowsTransport(timeoutMs);
    this.writes = {
      createEvent: (input, context) => this.createEvent(input, context),
      updateEvent: (input, context) => this.updateEvent(input, context),
      cancelEvent: (uid, context) => this.cancelEvent(uid, context),
    };
  }

  async listCalendars(_accountRef: string): Promise<CalendarSummary[]> {
    const res = await this.transport.run({op: 'listCalendars'}) as {calendars?: WindowsSystemCalendarSummary[]};
    const list = Array.isArray(res?.calendars) ? res.calendars : [];
    return list.map(cal => ({
      id: safeCalendarSegment(cal.id),
      name: cal.name || this.calendarName,
      timeZone: this.timeZone,
    }));
  }

  async fetchWindow(_accountRef: string, window: CalendarWindow, cursor?: string, context?: CalendarReadContext): Promise<CalendarFetchPage> {
    assertReadActive(context, this.now);
    assertValidUtcWindow(window.fromUtc, window.toUtc);
    let offset = 0;
    if (cursor !== undefined) {
      if (!/^(?:0|[1-9]\d*)$/u.test(cursor)) {
        throw new ProtocolError('CURSOR_EXPIRED', 'Invalid Windows system calendar cursor', false);
      }
      offset = Number(cursor);
    }
    const res = await this.transport.run({
      op: 'fetchWindow',
      fromUtc: window.fromUtc,
      toUtc: window.toUtc,
    }, context) as {events?: WindowsAppointmentRaw[]};
    assertReadActive(context, this.now);
    const nowIso = new Date(this.now()).toISOString();
    const fromMs = Date.parse(window.fromUtc);
    const toMs = Date.parse(window.toUtc);
    const all = (Array.isArray(res?.events) ? res.events : [])
      .map(raw => toRecord(raw, this.timeZone, nowIso))
      .filter(evt => Date.parse(evt.endUtc) > fromMs && Date.parse(evt.startUtc) < toMs)
      .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc) || a.externalId.localeCompare(b.externalId));
    const slice = all.slice(offset, offset + PAGE_SIZE);
    const next = offset + slice.length;
    const hasMore = next < all.length;
    return {
      events: slice,
      ...(hasMore ? {nextCursor: String(next)} : {}),
      hasMore,
    };
  }

  async getEvent(_accountRef: string, externalId: string, context?: CalendarReadContext): Promise<CalendarEventRecord | undefined> {
    assertReadActive(context, this.now);
    if (typeof externalId !== 'string' || !externalId.trim()) {
      throw new ProtocolError('INVALID_ARGUMENT', 'externalId must be non-empty');
    }
    const res = await this.transport.run({op: 'getEvent', externalId}, context) as {event?: WindowsAppointmentRaw | null};
    assertReadActive(context, this.now);
    if (!res?.event) return undefined;
    return toRecord(res.event, this.timeZone, new Date(this.now()).toISOString());
  }

  respond(_input: CalendarRespondInput): CalendarRespondResult {
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Windows system calendar does not support RSVP respond', false);
  }

  private async createEvent(input: CalendarEventWriteInput, context?: CalendarReadContext): Promise<CalendarEventRecord> {
    assertReadActive(context, this.now);
    if (typeof input?.summary !== 'string' || !input.summary.trim()) {
      throw new ProtocolError('INVALID_ARGUMENT', 'summary is required');
    }
    assertValidUtcWindow(input.startUtc, input.endUtc);
    const res = await this.transport.run({
      op: 'createEvent',
      targetCalendarName: this.calendarName,
      summary: input.summary,
      startUtc: input.startUtc,
      endUtc: input.endUtc,
      ...(input.location !== undefined ? {location: input.location} : {}),
      ...(input.notes !== undefined ? {notes: input.notes} : {}),
      ...(input.uid !== undefined ? {uid: input.uid} : {}),
    }, context) as {conflictCheck?: boolean; event?: WindowsAppointmentRaw};
    if (!res?.event) {
      throw new ProtocolError('EXTERNAL_FAILURE', 'Windows system calendar did not return created event readback', false);
    }
    if (res.conflictCheck) {
      const same = res.event.subject === input.summary
        && Date.parse(res.event.startUtc) === Date.parse(input.startUtc)
        && Date.parse(res.event.endUtc) === Date.parse(input.endUtc)
        && (res.event.location ?? undefined) === (input.location || undefined)
        && (res.event.details ?? undefined) === (input.notes || undefined);
      if (!same) {
        throw new ProtocolError('REVISION_CONFLICT', 'Existing event with same UID has different content', false);
      }
    }
    return toRecord(res.event, this.timeZone, new Date(this.now()).toISOString());
  }

  private async updateEvent(input: CalendarEventUpdateInput, context?: CalendarReadContext): Promise<CalendarEventRecord> {
    assertReadActive(context, this.now);
    if (typeof input?.uid !== 'string' || !input.uid.trim()) {
      throw new ProtocolError('INVALID_ARGUMENT', 'uid is required');
    }
    if (input.startUtc !== undefined && input.endUtc !== undefined) {
      assertValidUtcWindow(input.startUtc, input.endUtc);
    }
    const res = await this.transport.run({
      op: 'updateEvent',
      targetCalendarName: this.calendarName,
      uid: input.uid,
      ...(input.summary !== undefined ? {summary: input.summary} : {}),
      ...(input.startUtc !== undefined ? {startUtc: input.startUtc} : {}),
      ...(input.endUtc !== undefined ? {endUtc: input.endUtc} : {}),
      ...(input.location !== undefined ? {location: input.location} : {}),
      ...(input.notes !== undefined ? {notes: input.notes} : {}),
      ...(input.expectedSequence !== undefined ? {expectedSequence: input.expectedSequence} : {}),
      ...(input.ifMatch !== undefined ? {ifMatch: input.ifMatch} : {}),
    }, context) as {event?: WindowsAppointmentRaw};
    if (!res?.event) {
      throw new ProtocolError('EXTERNAL_FAILURE', 'Windows system calendar did not return updated event readback', false);
    }
    return toRecord(res.event, this.timeZone, new Date(this.now()).toISOString());
  }

  private async cancelEvent(uid: string, context?: CalendarReadContext): Promise<{uid: string; state: 'cancelled' | 'already_absent'}> {
    assertReadActive(context, this.now);
    if (typeof uid !== 'string' || !uid.trim()) {
      throw new ProtocolError('INVALID_ARGUMENT', 'uid is required');
    }
    const res = await this.transport.run({op: 'cancelEvent', targetCalendarName: this.calendarName, uid}, context) as {state?: 'cancelled' | 'already_absent'};
    return {
      uid,
      state: res?.state === 'already_absent' ? 'already_absent' : 'cancelled',
    };
  }
}
