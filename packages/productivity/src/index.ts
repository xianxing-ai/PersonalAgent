import { ProtocolError } from '@personal-agent/contracts';
import type { RegisteredTool, StoragePort, ToolDescriptor, ToolHost } from '@personal-agent/contracts';
import { TodoService } from './service.js';
import type { TodoCreateInput, TodoUpdateInput } from './service.js';
import { buildReminderTrigger } from './triggers.js';
import type { ReminderTrigger } from './triggers.js';
import type { TodoItem, TodoStatus } from './item.js';
import { resolveWhen, toIsoUtc } from './time.js';
import type { WhenInput } from './time.js';

export { TodoService } from './service.js';
export type { TodoCreateInput, TodoServiceOptions, TodoUpdateInput } from './service.js';
export { applyReminderDispatches, buildReminderTrigger, reminderScheduleId, reminderTriggers } from './triggers.js';
export type { ReminderDispatch, ReminderTrigger } from './triggers.js';
export type { MissedRunPolicy, ReminderState, TodoItem, TodoReminder, TodoStatus } from './item.js';
export { localToUtc, resolveWhen } from './time.js';
export type { TodoWhen, WhenInput } from './time.js';

export const PRODUCTIVITY_MODULE_VERSION = '0.1.0-alpha.1';

const PROTOCOL_ID = 'https://personalagent.local/protocol/1.0.0';
const UTC_PATTERN_STRING = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$';

const whenSchema: object = {
  type: 'object',
  required: ['utc', 'timeZone', 'localDateTime'],
  additionalProperties: false,
  properties: {
    utc: {type: 'string', pattern: UTC_PATTERN_STRING},
    timeZone: {type: 'string', minLength: 1},
    localDateTime: {type: 'string', minLength: 1},
  },
};

const reminderSchema: object = {
  type: 'object',
  required: ['remindAt', 'missedPolicy', 'state'],
  additionalProperties: false,
  properties: {
    remindAt: whenSchema,
    missedPolicy: {enum: ['run_once', 'skip']},
    state: {enum: ['scheduled', 'delivered', 'missed']},
  },
};

const todoItemSchema: object = {
  type: 'object',
  required: ['id', 'title', 'status', 'createdAt', 'updatedAt', 'revision'],
  additionalProperties: false,
  properties: {
    id: {type: 'string', minLength: 1},
    title: {type: 'string', minLength: 1},
    notes: {type: 'string', minLength: 1},
    status: {enum: ['open', 'done', 'cancelled']},
    due: whenSchema,
    reminder: reminderSchema,
    createdAt: {type: 'string', pattern: UTC_PATTERN_STRING},
    updatedAt: {type: 'string', pattern: UTC_PATTERN_STRING},
    revision: {type: 'integer', minimum: 1},
  },
};

const reminderTriggerSchema: object = {
  type: ['object', 'null'],
  required: ['scheduleId', 'goal', 'conversationId', 'runAt', 'timeZone', 'missedRunPolicy', 'taskIdempotencyKey'],
  additionalProperties: false,
  properties: {
    scheduleId: {type: 'string', minLength: 1},
    goal: {type: 'string', minLength: 1},
    conversationId: {type: 'string', minLength: 1},
    runAt: {type: 'string', pattern: UTC_PATTERN_STRING},
    timeZone: {type: 'string', minLength: 1},
    missedRunPolicy: {enum: ['run_once', 'skip']},
    taskIdempotencyKey: {type: 'string', minLength: 1},
  },
};



const whenInputProperties: Record<string, object> = {
  utc: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?(Z|[+-]\\d{2}:\\d{2})$', description: 'UTC 瞬间（ISO-8601，Z 或数值偏移结尾；偏移会被规范化存储）。'},
  localDateTime: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}(:\\d{2})?$', description: '目标时区的本地墙上时间（空格分隔与秒省略会被规范化）。'},
  timeZone: {type: 'string', minLength: 1, description: 'IANA 时区，与 localDateTime 搭配；DST 边界按 README 策略解析。'},
};
const remindInMinutesProperty: object = {type: 'integer', minimum: 1, maximum: 525600,
  description: '相对提醒：距当前时刻 N 分钟触发，由本地执行时解析（无时钟漂移）；与 remindUtc/remindLocal 互斥。'};

export interface ProductivityModuleOptions {
  storage: StoragePort;
  conversationId: string;
  now?: () => number;
  idFactory?: () => string;
}

export function register(host: ToolHost, options: ProductivityModuleOptions): () => void {
  if (!options?.storage) throw new ProtocolError('INVALID_ARGUMENT', 'Todo storage must be explicitly provided; use the host StoragePort, this module owns no scheduler and no private task store');
  if (typeof options.conversationId !== 'string' || options.conversationId.length === 0) {
    throw new ProtocolError('INVALID_ARGUMENT', 'conversationId is required to scope reminder triggers');
  }
  const now = options.now ?? Date.now;
  const service = new TodoService(options.storage, {
    now,
    idFactory: options.idFactory ?? defaultIdFactory,
  });
  const conversationId = options.conversationId;

  const listTool: RegisteredTool = {
    descriptor: {
      name: 'todo.list',
      version: PRODUCTIVITY_MODULE_VERSION,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {status: {enum: ['open', 'done', 'cancelled']}},
      },
      outputSchema: {
        type: 'object',
        required: ['items'],
        additionalProperties: false,
        properties: {items: {type: 'array', items: todoItemSchema}},
      },
      sideEffect: 'read',
      requiredScopes: ['todo:read'],
      idempotencySupport: true,
      recoverySupport: true,
      requiresPresence: false,
    },
    execute: async (input: unknown) => {
      const raw = input as {status?: string};
      const filter: {status?: TodoStatus} = {};
      if (raw.status === 'open' || raw.status === 'done' || raw.status === 'cancelled') filter.status = raw.status;
      return {items: service.list(filter)};
    },
  };

  const createTool: RegisteredTool = {
    descriptor: {
      name: 'todo.create',
      version: PRODUCTIVITY_MODULE_VERSION,
      inputSchema: {
        type: 'object',
        required: ['title'],
        additionalProperties: false,
        properties: {
          title: {type: 'string', minLength: 1, maxLength: 200},
          notes: {type: 'string', maxLength: 2000},
          dueUtc: whenInputProperties.utc,
          dueLocal: whenInputProperties.localDateTime,
          dueTimeZone: whenInputProperties.timeZone,
          remindUtc: {...whenInputProperties.utc, description: '提醒时刻的 UTC 瞬间；与 remindLocal/remindTimeZone/remindInMinutes 互斥。'},
          remindLocal: {...whenInputProperties.localDateTime, description: '提醒时刻的本地墙上时间。'},
          remindTimeZone: whenInputProperties.timeZone,
          remindInMinutes: remindInMinutesProperty,
          missedPolicy: {enum: ['run_once', 'skip'], description: '休眠恢复策略：run_once 补跑一次，skip 标记错过。默认 run_once。'},
        },
      },
      outputSchema: {
        type: 'object',
        required: ['item', 'reminderTrigger'],
        additionalProperties: false,
        properties: {item: todoItemSchema, reminderTrigger: reminderTriggerSchema},
      },
      sideEffect: 'local_write',
      requiredScopes: ['todo:write'],
      idempotencySupport: false,
      recoverySupport: false,
      requiresPresence: false,
    },
    execute: async (input: unknown) => {
      const raw = input as Record<string, string>;
      if (typeof raw.title !== 'string') throw new ProtocolError('INVALID_ARGUMENT', 'title is required');
      const create: TodoCreateInput = {title: raw.title};
      if (raw.notes !== undefined) create.notes = raw.notes;
      const due = pickWhen(raw, 'due');
      if (due !== undefined) create.due = due;
      const remindAt = pickWhen(raw, 'remind');
      if (remindAt !== undefined && raw.remindInMinutes !== undefined) {
        throw new ProtocolError('INVALID_ARGUMENT', 'remindInMinutes is mutually exclusive with remindUtc/remindLocal');
      }
      if (remindAt !== undefined) {
        create.reminder = {remindAt};
        if (raw.missedPolicy === 'run_once' || raw.missedPolicy === 'skip') create.reminder.missedPolicy = raw.missedPolicy;
      } else if (raw.remindInMinutes !== undefined) {
        const minutes = raw.remindInMinutes as unknown;
        if (!Number.isSafeInteger(minutes) || (minutes as number) < 1 || (minutes as number) > 525600) {
          throw new ProtocolError('INVALID_ARGUMENT', 'remindInMinutes must be an integer between 1 and 525600');
        }
        create.reminder = {remindAt: {utc: toIsoUtc(now() + (minutes as number) * 60_000)}};
        if (raw.missedPolicy === 'run_once' || raw.missedPolicy === 'skip') create.reminder.missedPolicy = raw.missedPolicy;
      }
      const item = service.create(create);
      return {item, reminderTrigger: buildReminderTrigger(item, conversationId)};
    },
  };

  const updateTool: RegisteredTool = {
    descriptor: {
      name: 'todo.update',
      version: PRODUCTIVITY_MODULE_VERSION,
      inputSchema: {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: {
          id: {type: 'string', minLength: 1},
          title: {type: 'string', minLength: 1, maxLength: 200},
          notes: {type: 'string', maxLength: 2000},
          status: {enum: ['open', 'done', 'cancelled'], description: 'open→done/cancelled 单向；终态不可再改。'},
          dueUtc: whenInputProperties.utc,
          dueLocal: whenInputProperties.localDateTime,
          dueTimeZone: whenInputProperties.timeZone,
          remindUtc: whenInputProperties.remindUtc ?? whenInputProperties.utc,
          remindLocal: whenInputProperties.localDateTime,
          remindTimeZone: whenInputProperties.timeZone,
          remindInMinutes: remindInMinutesProperty,
          missedPolicy: {enum: ['run_once', 'skip']},
          clearDue: {type: 'boolean'},
          clearReminder: {type: 'boolean', description: '撤销提醒：装配方应同时移除对应 schedule（scheduleId 见返回的 reminderTrigger）。'},
        },
      },
      outputSchema: {
        type: 'object',
        required: ['item', 'reminderTrigger'],
        additionalProperties: false,
        properties: {item: todoItemSchema, reminderTrigger: reminderTriggerSchema},
      },
      sideEffect: 'local_write',
      requiredScopes: ['todo:write'],
      idempotencySupport: true,
      recoverySupport: true,
      requiresPresence: false,
    },
    execute: async (input: unknown) => {
      const raw = input as Record<string, unknown>;
      const patch: TodoUpdateInput = {};
      if (typeof raw.id !== 'string' || raw.id.length === 0) throw new ProtocolError('INVALID_ARGUMENT', 'id is required');
      if (typeof raw.title === 'string') patch.title = raw.title;
      if (typeof raw.notes === 'string') patch.notes = raw.notes;
      if (raw.status === 'open' || raw.status === 'done' || raw.status === 'cancelled') patch.status = raw.status;
      if (raw.clearDue === true) patch.clearDue = true;
      if (raw.clearReminder === true) patch.clearReminder = true;
      const due = pickWhen(raw, 'due');
      if (due !== undefined) patch.due = due;
      const remindAt = pickWhen(raw, 'remind');
      if (remindAt !== undefined && raw.remindInMinutes !== undefined) {
        throw new ProtocolError('INVALID_ARGUMENT', 'remindInMinutes is mutually exclusive with remindUtc/remindLocal');
      }
      if (remindAt !== undefined) {
        patch.reminder = {remindAt};
        if (raw.missedPolicy === 'run_once' || raw.missedPolicy === 'skip') patch.reminder.missedPolicy = raw.missedPolicy;
      } else if (raw.remindInMinutes !== undefined) {
        const minutes = raw.remindInMinutes as unknown;
        if (!Number.isSafeInteger(minutes) || (minutes as number) < 1 || (minutes as number) > 525600) {
          throw new ProtocolError('INVALID_ARGUMENT', 'remindInMinutes must be an integer between 1 and 525600');
        }
        patch.reminder = {remindAt: {utc: toIsoUtc(now() + (minutes as number) * 60_000)}};
        if (raw.missedPolicy === 'run_once' || raw.missedPolicy === 'skip') patch.reminder.missedPolicy = raw.missedPolicy;
      }
      const item = service.update(raw.id, patch);
      return {item, reminderTrigger: buildReminderTrigger(item, conversationId)};
    },
  };

  const listUnregister = host.register(listTool);
  const createUnregister = host.register(createTool);
  const updateUnregister = host.register(updateTool);
  return () => {
    listUnregister();
    createUnregister();
    updateUnregister();
  };
}

function pickWhen(raw: Record<string, unknown>, field: 'due' | 'remind'): WhenInput | undefined {
  const utc = raw[`${field}Utc`];
  const local = raw[`${field}Local`];
  const timeZone = raw[`${field}TimeZone`];
  if (utc === undefined && local === undefined) return undefined;
  const input: WhenInput = {};
  if (typeof utc === 'string') input.utc = utc;
  if (typeof local === 'string') input.localDateTime = local;
  if (typeof timeZone === 'string') input.timeZone = timeZone;
  return input;
}

let counter = 0;
function defaultIdFactory(): string {
  counter += 1;
  return `todo_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export type {ToolDescriptor};
