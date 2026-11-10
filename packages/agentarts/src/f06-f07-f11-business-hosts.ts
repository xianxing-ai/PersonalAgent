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
  readonly operation?: 'todo.create' | 'todo.update';
  readonly id?: string;
  readonly title: string;
  readonly notes?: string;
  readonly dueUtc?: string;
  readonly remindUtc?: string;
  readonly status?: 'open' | 'done' | 'cancelled';
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
  const idempotencyLedger = new Map<string, {fingerprint: string; receipt: Record<string, unknown>}>();
  return {
    capabilities: ['todo.registered_write'],
    async read(context: WorkflowNodeContext) {
      const writeInput = options.resolveWrite(context);
      if (!writeInput || !text(writeInput.title) || !text(writeInput.idempotencyKey)) {
        return fail('unavailable', 'todo_write_input_unavailable');
      }
      const op = writeInput.operation ?? (text(writeInput.id) ? 'todo.update' : 'todo.create');
      if (op === 'todo.update' && !text(writeInput.id)) {
        return fail('unavailable', 'todo_update_id_unavailable');
      }
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            op,
            id: writeInput.id ?? null,
            title: writeInput.title,
            notes: writeInput.notes ?? null,
            dueUtc: writeInput.dueUtc ?? null,
            remindUtc: writeInput.remindUtc ?? null,
            status: writeInput.status ?? null,
            listId: writeInput.listId ?? null,
          }),
        )
        .digest('hex');

      const existing = idempotencyLedger.get(writeInput.idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          return fail('failed', 'todo_idempotency_conflict', {idempotencyKey: writeInput.idempotencyKey});
        }
        return {
          state: 'completed' as const,
          value: {
            receipt: existing.receipt,
            idempotencyKey: writeInput.idempotencyKey,
            replayed: true,
            writtenAt: new Date().toISOString(),
            source: 'todo_write_receipt',
          },
        };
      }

      try {
        // 对齐 packages/productivity 的 todo.create / todo.update 输入 schema（additionalProperties: false）
        const toolPayload: Record<string, unknown> = {
          ...(op === 'todo.update' && text(writeInput.id) ? {id: writeInput.id} : {}),
          title: writeInput.title,
          ...(text(writeInput.notes) ? {notes: writeInput.notes} : {}),
          ...(text(writeInput.dueUtc) ? {dueUtc: writeInput.dueUtc} : {}),
          ...(text(writeInput.remindUtc) ? {remindUtc: writeInput.remindUtc} : {}),
          ...(op === 'todo.update' && text(writeInput.status) ? {status: writeInput.status} : {}),
        };
        const result = await options.write.execute(op, toolPayload, context);
        if (!isPlainObject(result)) return fail('failed', 'todo_write_malformed');
        idempotencyLedger.set(writeInput.idempotencyKey, {fingerprint, receipt: result});
        return {
          state: 'completed' as const,
          value: {
            receipt: result,
            idempotencyKey: writeInput.idempotencyKey,
            replayed: false,
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
        if (!Number.isFinite(clockMs) || !Number.isFinite(dueMs)) {
          return fail('failed', 'reminder_due_utc_invalid', {
            dueUtc: reminder.dueUtc,
            clockUtc: nowUtc,
          });
        }
        const isDue = clockMs >= dueMs;
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
  execute(operation: 'calendar.events', input: Record<string, unknown>, context: WorkflowNodeContext): Promise<unknown>;
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
        const window = target.window ?? {
          fromUtc: new Date().toISOString(),
          toUtc: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        };
        const page = await options.calendarPort.execute('calendar.events', {
          accountRef: target.accountRef,
          fromUtc: window.fromUtc,
          toUtc: window.toUtc,
          ...(text(target.externalId) ? {externalId: target.externalId} : {}),
        }, context);

        if (text(target.externalId)) {
          let event: Record<string, unknown> | undefined;
          if (isPlainObject(page) && Array.isArray(page.items)) {
            const matched = page.items.find(
              (item: unknown) =>
                isPlainObject(item) &&
                (item.externalId === target.externalId || item.uid === target.externalId || item.id === target.externalId),
            );
            if (isPlainObject(matched)) event = matched;
          } else if (isPlainObject(page) && (page.externalId === target.externalId || page.uid === target.externalId)) {
            event = page;
          }
          if (!event) return fail('failed', 'calendar_event_not_found');
          if (typeof event.sequence !== 'number' || !Number.isFinite(event.sequence)) {
            return fail('unknown', 'calendar_sequence_unavailable', {
              accountRef: target.accountRef,
              externalId: target.externalId,
            });
          }
          const currentSequence = event.sequence;
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
  readonly operation?: 'calendar.create' | 'calendar.update';
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
      if (
        !writeInput ||
        !text(writeInput.accountRef) ||
        !text(writeInput.summary) ||
        !text(writeInput.startUtc) ||
        !text(writeInput.endUtc)
      ) {
        return fail('unavailable', 'calendar_write_input_unavailable');
      }
      const op = writeInput.operation ?? 'calendar.create';
      if (op === 'calendar.update' && !text(writeInput.externalId)) {
        return fail('unavailable', 'calendar_update_external_id_unavailable');
      }
      try {
        const result = await options.calendarPort.execute(op, {
          accountRef: writeInput.accountRef,
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
            accountRef: writeInput.accountRef,
            operation: op,
            externalId: writeInput.externalId ?? (typeof result.externalId === 'string' ? result.externalId : undefined),
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
      if (!input || !text(input.accountRef) || !text(input.externalId) || !text(input.reminderId)) {
        return fail('unavailable', 'calendar_update_invalidate_input_unavailable');
      }
      try {
        // 1. 更新日程属性并递增 SEQUENCE（透传 accountRef 与 expectedSequence）
        const updateResult = await options.calendarPort.execute('calendar.update', {
          accountRef: input.accountRef,
          externalId: input.externalId,
          ...(typeof input.previousSequence === 'number' ? {expectedSequence: input.previousSequence} : {}),
          ...(input.summary ? {summary: input.summary} : {}),
          ...(input.startUtc ? {startUtc: input.startUtc} : {}),
          ...(input.endUtc ? {endUtc: input.endUtc} : {}),
          ...(input.location ? {location: input.location} : {}),
          ...(input.notes ? {notes: input.notes} : {}),
        }, context);
        if (!isPlainObject(updateResult)) return fail('failed', 'calendar_update_malformed');
        if (
          typeof input.previousSequence === 'number' &&
          typeof updateResult.sequence === 'number' &&
          updateResult.sequence <= input.previousSequence
        ) {
          return fail('failed', 'calendar_sequence_not_incremented', {
            previousSequence: input.previousSequence,
            currentSequence: updateResult.sequence,
          });
        }

        // 2. 作废旧出行提醒（若日历已更新成功但作废提醒失败/未确认，返回 unknown 并携带 calendarReceipt 供对账）
        try {
          const invalidation = await options.invalidationPort.invalidateReminder(
            input.reminderId,
            `Superseded by calendar event ${input.externalId} update`,
            context
          );
          if (!isPlainObject(invalidation) || !invalidation.invalidated) {
            return fail('unknown', 'reminder_invalidation_failed', {
              calendarReceipt: updateResult,
              reminderId: input.reminderId,
              externalId: input.externalId,
            });
          }
        } catch (invalidationError) {
          if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw invalidationError;
          return fail('unknown', 'reminder_invalidation_failed', {
            calendarReceipt: updateResult,
            reminderId: input.reminderId,
            externalId: input.externalId,
          });
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
