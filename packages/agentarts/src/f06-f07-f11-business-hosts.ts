// F06/F07/F11 业务工作流 host 端口实现（Potatos 分区）
// F06_N03 todo.registered_write
// F06_N04 reminder.current_clock_and_revision
// F07_N04 calendar.freshness_check
// F07_N05 calendar.registered_write
// F11_N05 calendar.update_and_invalidate_reminder
import {createHash} from 'node:crypto';
import type {WorkflowHostPort, WorkflowNodeContext} from './owned-workflows.js';

const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function fail(state: 'unavailable' | 'failed' | 'unknown', reason: string, extra?: Record<string, unknown>) {
  return {state, value: {reason, ...(extra ?? {})}};
}

// ---------------------------------------------------------------------------
// F06_N03: todo.registered_write
// ---------------------------------------------------------------------------
export interface TodoWriteInput {
  readonly title: string;
  readonly dueUtc?: string;
  readonly idempotencyKey: string;
  readonly listId?: string;
}

export interface TodoWorkflowWritePort {
  execute(operation: 'todo.create' | 'todo.update', input: Record<string, unknown>, context: WorkflowNodeContext): Promise<unknown>;
}

export interface TodoRegisteredWriteOptions {
  readonly write: TodoWorkflowWritePort;
  resolveWrite(context: WorkflowNodeContext): TodoWriteInput | undefined;
}

export function createTodoRegisteredWriteHostPort(options: TodoRegisteredWriteOptions): WorkflowHostPort {
  if (typeof options?.write?.execute !== 'function' || typeof options?.resolveWrite !== 'function') {
    throw new TypeError('createTodoRegisteredWriteHostPort 需要 write 端口与 resolveWrite');
  }
  return {
    capabilities: ['todo.registered_write'],
    async read(context: WorkflowNodeContext) {
      const writeInput = options.resolveWrite(context);
      if (!writeInput || !text(writeInput.title) || !text(writeInput.idempotencyKey)) {
        return fail('unavailable', 'todo_write_input_unavailable');
      }
      try {
        const result = await options.write.execute('todo.create', {
          title: writeInput.title,
          ...(writeInput.dueUtc ? {dueUtc: writeInput.dueUtc} : {}),
          ...(writeInput.listId ? {listId: writeInput.listId} : {}),
          idempotencyKey: writeInput.idempotencyKey,
        }, context);
        if (!isPlainObject(result)) return fail('failed', 'todo_write_malformed');
        return {
          state: 'completed' as const,
          value: {
            receipt: result,
            idempotencyKey: writeInput.idempotencyKey,
            writtenAt: new Date().toISOString(),
            source: 'todo_write_receipt',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw error;
        return fail('failed', 'todo_write_failed');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// F06_N04: reminder.current_clock_and_revision
// ---------------------------------------------------------------------------
export interface ReminderTarget {
  readonly reminderId: string;
  readonly expectedRevision?: number;
}

export interface ReminderWorkflowClockPort {
  getReminder(reminderId: string, context: WorkflowNodeContext):
    Promise<{reminderId: string; revision: number; dueUtc: string; state: 'active' | 'triggered' | 'cancelled'} | undefined>;
  nowUtc?(): string;
}

export interface ReminderClockHostOptions {
  readonly reminderPort: ReminderWorkflowClockPort;
  resolveTarget(context: WorkflowNodeContext): ReminderTarget | undefined;
}

export function createReminderClockRevisionHostPort(options: ReminderClockHostOptions): WorkflowHostPort {
  if (typeof options?.reminderPort?.getReminder !== 'function' || typeof options?.resolveTarget !== 'function') {
    throw new TypeError('createReminderClockRevisionHostPort 需要 reminderPort 与 resolveTarget');
  }
  return {
    capabilities: ['reminder.current_clock_and_revision'],
    async read(context: WorkflowNodeContext) {
      const target = options.resolveTarget(context);
      if (!target || !text(target.reminderId)) {
        return fail('unavailable', 'reminder_target_unavailable');
      }
      try {
        const reminder = await options.reminderPort.getReminder(target.reminderId, context);
        if (!reminder) return fail('failed', 'reminder_not_found');
        const nowUtc = options.reminderPort.nowUtc ? options.reminderPort.nowUtc() : new Date().toISOString();
        const clockMs = Date.parse(nowUtc);
        const dueMs = Date.parse(reminder.dueUtc);
        const isDue = Number.isFinite(clockMs) && Number.isFinite(dueMs) && clockMs >= dueMs;
        const revisionMatch = target.expectedRevision === undefined || reminder.revision === target.expectedRevision;
        return {
          state: 'completed' as const,
          value: {
            reminderId: reminder.reminderId,
            revision: reminder.revision,
            dueUtc: reminder.dueUtc,
            clockUtc: nowUtc,
            isDue,
            revisionMatch,
            state: reminder.state,
            source: 'reminder_clock_readback',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw error;
        return fail('failed', 'reminder_readback_failed');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// F07_N04: calendar.freshness_check
// ---------------------------------------------------------------------------
export interface CalendarFreshnessTarget {
  readonly accountRef: string;
  readonly externalId?: string;
  readonly expectedSequence?: number;
  readonly window?: {fromUtc: string; toUtc: string};
}

export interface CalendarWorkflowReadPort {
  execute(operation: 'calendar.events' | 'calendar.get', input: Record<string, unknown>, context: WorkflowNodeContext): Promise<unknown>;
}

export interface CalendarFreshnessHostOptions {
  readonly calendarPort: CalendarWorkflowReadPort;
  resolveTarget(context: WorkflowNodeContext): CalendarFreshnessTarget | undefined;
}

export function createCalendarFreshnessCheckHostPort(options: CalendarFreshnessHostOptions): WorkflowHostPort {
  if (typeof options?.calendarPort?.execute !== 'function' || typeof options?.resolveTarget !== 'function') {
    throw new TypeError('createCalendarFreshnessCheckHostPort 需要 calendarPort 与 resolveTarget');
  }
  return {
    capabilities: ['calendar.freshness_check'],
    async read(context: WorkflowNodeContext) {
      const target = options.resolveTarget(context);
      if (!target || !text(target.accountRef)) {
        return fail('unavailable', 'calendar_target_unavailable');
      }
      try {
        if (text(target.externalId)) {
          const event = await options.calendarPort.execute('calendar.get', {
            accountRef: target.accountRef,
            externalId: target.externalId,
          }, context);
          if (!isPlainObject(event)) return fail('failed', 'calendar_event_not_found');
          const currentSequence = typeof event.sequence === 'number' ? event.sequence : 0;
          const fresh = target.expectedSequence === undefined || currentSequence === target.expectedSequence;
          return {
            state: 'completed' as const,
            value: {
              accountRef: target.accountRef,
              externalId: target.externalId,
              currentSequence,
              fresh,
              eventDigest: createHash('sha256').update(JSON.stringify(event)).digest('hex'),
              readbackAt: new Date().toISOString(),
              source: 'calendar_readback',
            },
          };
        }
        // 时间窗级新鲜度读回
        const window = target.window ?? {
          fromUtc: new Date().toISOString(),
          toUtc: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        };
        const page = await options.calendarPort.execute('calendar.events', {
          accountRef: target.accountRef,
          fromUtc: window.fromUtc,
          toUtc: window.toUtc,
        }, context);
        if (!isPlainObject(page) || !Array.isArray(page.items)) {
          return fail('failed', 'calendar_window_read_malformed');
        }
        return {
          state: 'completed' as const,
          value: {
            accountRef: target.accountRef,
            window,
            itemCount: page.items.length,
            windowDigest: createHash('sha256').update(JSON.stringify(page.items)).digest('hex'),
            readbackAt: new Date().toISOString(),
            source: 'calendar_readback',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw error;
        return fail('failed', 'calendar_readback_failed');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// F07_N05: calendar.registered_write
// ---------------------------------------------------------------------------
export interface CalendarWriteInput {
  readonly accountRef: string;
  readonly summary: string;
  readonly startUtc: string;
  readonly endUtc: string;
  readonly externalId?: string;
  readonly location?: string;
  readonly notes?: string;
}

export interface CalendarWorkflowWritePort {
  execute(operation: 'calendar.create' | 'calendar.update', input: Record<string, unknown>, context: WorkflowNodeContext): Promise<unknown>;
}

export interface CalendarRegisteredWriteOptions {
  readonly calendarPort: CalendarWorkflowWritePort;
  resolveWrite(context: WorkflowNodeContext): CalendarWriteInput | undefined;
}

export function createCalendarRegisteredWriteHostPort(options: CalendarRegisteredWriteOptions): WorkflowHostPort {
  if (typeof options?.calendarPort?.execute !== 'function' || typeof options?.resolveWrite !== 'function') {
    throw new TypeError('createCalendarRegisteredWriteHostPort 需要 calendarPort 与 resolveWrite');
  }
  return {
    capabilities: ['calendar.registered_write'],
    async read(context: WorkflowNodeContext) {
      const writeInput = options.resolveWrite(context);
      if (!writeInput || !text(writeInput.summary) || !text(writeInput.startUtc) || !text(writeInput.endUtc)) {
        return fail('unavailable', 'calendar_write_input_unavailable');
      }
      try {
        const op = 'calendar.create';
        const result = await options.calendarPort.execute(op, {
          summary: writeInput.summary,
          startUtc: writeInput.startUtc,
          endUtc: writeInput.endUtc,
          ...(writeInput.externalId ? {externalId: writeInput.externalId} : {}),
          ...(writeInput.location ? {location: writeInput.location} : {}),
          ...(writeInput.notes ? {notes: writeInput.notes} : {}),
        }, context);
        if (!isPlainObject(result)) return fail('failed', 'calendar_write_malformed');
        return {
          state: 'completed' as const,
          value: {
            receipt: result,
            externalId: writeInput.externalId,
            writtenAt: new Date().toISOString(),
            source: 'calendar_write_receipt',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw error;
        return fail('failed', 'calendar_write_failed');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// F11_N05: calendar.update_and_invalidate_reminder
// ---------------------------------------------------------------------------
export interface CalendarUpdateAndInvalidateInput {
  readonly accountRef: string;
  readonly externalId: string;
  readonly summary?: string;
  readonly startUtc?: string;
  readonly endUtc?: string;
  readonly location?: string;
  readonly notes?: string;
  readonly reminderId: string;
  readonly previousSequence?: number;
}

export interface ReminderWorkflowInvalidationPort {
  invalidateReminder(reminderId: string, reason: string, context: WorkflowNodeContext):
    Promise<{reminderId: string; invalidated: boolean; state: string}>;
}

export interface CalendarUpdateAndInvalidateReminderOptions {
  readonly calendarPort: CalendarWorkflowWritePort;
  readonly invalidationPort: ReminderWorkflowInvalidationPort;
  resolveInput(context: WorkflowNodeContext): CalendarUpdateAndInvalidateInput | undefined;
}

export function createCalendarUpdateAndInvalidateReminderHostPort(options: CalendarUpdateAndInvalidateReminderOptions): WorkflowHostPort {
  if (typeof options?.calendarPort?.execute !== 'function' || typeof options?.invalidationPort?.invalidateReminder !== 'function'
    || typeof options?.resolveInput !== 'function') {
    throw new TypeError('createCalendarUpdateAndInvalidateReminderHostPort 需要 calendarPort, invalidationPort 与 resolveInput');
  }
  return {
    capabilities: ['calendar.update_and_invalidate_reminder'],
    async read(context: WorkflowNodeContext) {
      const input = options.resolveInput(context);
      if (!input || !text(input.externalId) || !text(input.reminderId)) {
        return fail('unavailable', 'calendar_update_invalidate_input_unavailable');
      }
      try {
        // 1. 更新日程属性并递增 SEQUENCE
        const updateResult = await options.calendarPort.execute('calendar.update', {
          externalId: input.externalId,
          ...(input.summary ? {summary: input.summary} : {}),
          ...(input.startUtc ? {startUtc: input.startUtc} : {}),
          ...(input.endUtc ? {endUtc: input.endUtc} : {}),
          ...(input.location ? {location: input.location} : {}),
          ...(input.notes ? {notes: input.notes} : {}),
        }, context);
        if (!isPlainObject(updateResult)) return fail('failed', 'calendar_update_malformed');

        // 2. 作废旧出行提醒
        const invalidation = await options.invalidationPort.invalidateReminder(
          input.reminderId,
          `Superseded by calendar event ${input.externalId} update`,
          context
        );
        if (!isPlainObject(invalidation) || !invalidation.invalidated) {
          return fail('failed', 'reminder_invalidation_failed');
        }

        return {
          state: 'completed' as const,
          value: {
            calendarReceipt: updateResult,
            invalidationReceipt: {
              reminderId: input.reminderId,
              supersededByEvent: input.externalId,
              state: 'invalidated',
              invalidatedAt: new Date().toISOString(),
            },
            source: 'calendar_reminder_sync',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw error;
        return fail('failed', 'calendar_update_invalidate_failed');
      }
    },
  };
}
