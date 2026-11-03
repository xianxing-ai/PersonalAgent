import type {DatabaseSync} from 'node:sqlite';
import {openStorage, type Migration} from '@personal-agent/storage';
import {CrewError} from './errors.js';
import {parseCrewReceipt, isPureAcknowledgement, type CrewReceipt} from './receipts.js';

/** 主 agent（父）的保留身份。crew 中所有任务根都由父发起；该 id 不可注册。 */
export const CREW_PARENT_AGENT_ID = 'parent';
/** 每个根请求最多自动派 8 次，第 9 次派单直接拒绝。 */
export const MAX_AUTO_DISPATCHES_PER_ROOT_REQUEST = 8;
/** 单个 agent 同时最多 2 个运行中任务，第 3 个并发任务留在队列。 */
export const MAX_CONCURRENT_TASKS_PER_AGENT = 2;
/** 消息转发深度上限，与派单上限共用同一预算，防止无限转发。 */
export const MAX_MESSAGE_HOP = MAX_AUTO_DISPATCHES_PER_ROOT_REQUEST;

export type CrewDriverId = 'codex' | 'claude' | 'opencode' | 'grok' | 'gemini' | 'acp-generic';
export type CrewTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled';
export type CrewMessageKind = 'task' | 'message' | 'interrupt';

const DRIVERS: readonly CrewDriverId[] = ['codex', 'claude', 'opencode', 'grok', 'gemini', 'acp-generic'];

export interface CrewAgentSpec {
  readonly agentId: string;
  readonly displayName: string;
  readonly driver: CrewDriverId;
  readonly instructions: string;
  readonly workspacePath: string;
  /** 1..2；P0 系统上限为 2。 */
  readonly concurrencyLimit?: number;
}

export interface CrewAgentRecord {
  readonly agentId: string;
  readonly displayName: string;
  readonly driver: CrewDriverId;
  readonly instructions: string;
  readonly workspacePath: string;
  readonly concurrencyLimit: number;
  readonly createdAt: string;
}

export interface CrewDispatchInput {
  /** 调用方生成的任务 id，将来映射为 Runtime 子任务 id。 */
  readonly taskId: string;
  /** 根请求 id：8 次派单预算按它计数。 */
  readonly rootRequestId: string;
  readonly assignedAgentId: string;
  readonly goal: string;
  /** 可选超时（毫秒，自派单时刻起算）；超时的未完成任务由恢复流程标记失败并通知父。 */
  readonly timeoutMs?: number;
}

export interface CrewTaskRecord {
  readonly taskId: string;
  readonly rootRequestId: string;
  readonly assignedAgentId: string;
  readonly goal: string;
  readonly status: CrewTaskStatus;
  readonly receipt?: CrewReceipt;
  readonly cancelReason?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly deadlineAt?: string;
}

/** 发送方登记一条文件交接（内核已从真实字节算好 size 与 sha256）。 */
export interface CrewHandoffRegistration {
  readonly handoffId: string;
  /** 共享交接目录内的规范化相对路径。 */
  readonly filePath: string;
  readonly sizeBytes: number;
  /** 小写十六进制 SHA-256（64 位）。 */
  readonly sha256: string;
  readonly fromAgentId: string;
  readonly taskId?: string;
  readonly rootRequestId?: string;
}

export interface CrewHandoffRecord {
  readonly handoffId: string;
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly fromAgentId: string;
  readonly taskId?: string;
  readonly rootRequestId?: string;
  readonly createdAt: string;
}

/** 写入父信箱的系统通知（当前只有任务超时），回执使用固定四段格式。 */
export interface CrewParentNotificationRecord {
  readonly notificationId: number;
  readonly taskId: string;
  readonly rootRequestId: string;
  readonly assignedAgentId: string;
  readonly receipt: CrewReceipt;
  readonly createdAt: string;
  readonly dequeuedAt?: string;
}

export interface CrewMessageInput {
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly text: string;
  /** 触发这条消息的请求链 id（例如所在任务的根请求）。 */
  readonly parentRequestId?: string;
  readonly rootRequestId?: string;
  readonly taskId?: string;
  readonly expectsReply?: boolean;
  readonly attachmentRefs?: readonly string[];
  /** 转发深度，由可信宿主提供；0 表示直接来自父派发链。 */
  readonly hop?: number;
}

export interface CrewMessageRecord {
  readonly messageId: number;
  readonly mailboxAgentId: string;
  readonly senderAgentId: string;
  readonly kind: CrewMessageKind;
  readonly parentRequestId?: string;
  readonly rootRequestId?: string;
  readonly taskId?: string;
  readonly text: string;
  readonly attachmentRefs: readonly string[];
  readonly expectsReply: boolean;
  readonly hop: number;
  readonly pureAck: boolean;
  readonly enqueuedAt: string;
  readonly dequeuedAt?: string;
}

export interface CrewStoreOptions {
  readonly now?: () => number;
}

const MAX_ID = 128;
const MAX_TEXT = 8192;
const MAX_REF = 256;
const MAX_REFS = 32;
const MAX_RECEIVED = 100;

/**
 * 版本 2（crew P3）：任务超时列、文件交接 SHA-256 清单、父信箱。
 * 只做加列与建表，不修改版本 1 已发布迁移的含义。
 */
const MIGRATION_V2 = `
    ALTER TABLE crew_tasks ADD COLUMN deadline_at TEXT;
    CREATE INDEX crew_tasks_deadline_idx ON crew_tasks(deadline_at);
    CREATE TABLE crew_handoff (
      handoff_id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
      from_agent_id TEXT NOT NULL REFERENCES crew_agents(agent_id),
      task_id TEXT,
      root_request_id TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE crew_parent_inbox (
      notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES crew_tasks(task_id),
      root_request_id TEXT NOT NULL,
      assigned_agent_id TEXT NOT NULL REFERENCES crew_agents(agent_id),
      receipt_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      dequeued_at TEXT
    ) STRICT;
  `;

const MIGRATIONS: readonly Migration[] = [{
  version: 1,
  sql: `
    CREATE TABLE crew_agents (
      agent_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      driver TEXT NOT NULL CHECK (driver IN ('codex', 'claude', 'opencode', 'grok', 'gemini', 'acp-generic')),
      instructions TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      concurrency_limit INTEGER NOT NULL CHECK (concurrency_limit BETWEEN 1 AND 2),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE crew_tasks (
      task_id TEXT PRIMARY KEY,
      root_request_id TEXT NOT NULL,
      assigned_agent_id TEXT NOT NULL REFERENCES crew_agents(agent_id),
      goal TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled')),
      receipt_json TEXT,
      cancel_reason TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    ) STRICT;
    CREATE INDEX crew_tasks_root_idx ON crew_tasks(root_request_id);
    CREATE INDEX crew_tasks_claim_idx ON crew_tasks(assigned_agent_id, status);
    CREATE TABLE crew_messages (
      message_id INTEGER PRIMARY KEY AUTOINCREMENT,
      mailbox_agent_id TEXT NOT NULL REFERENCES crew_agents(agent_id),
      sender_agent_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('task', 'message', 'interrupt')),
      parent_request_id TEXT,
      root_request_id TEXT,
      task_id TEXT,
      text TEXT NOT NULL,
      attachment_refs_json TEXT NOT NULL,
      expects_reply INTEGER NOT NULL CHECK (expects_reply IN (0, 1)),
      hop INTEGER NOT NULL CHECK (hop BETWEEN 0 AND 8),
      pure_ack INTEGER NOT NULL CHECK (pure_ack IN (0, 1)),
      enqueued_at TEXT NOT NULL,
      dequeued_at TEXT
    ) STRICT;
    CREATE INDEX crew_messages_mailbox_idx ON crew_messages(mailbox_agent_id, message_id);
    CREATE INDEX crew_messages_pair_idx ON crew_messages(sender_agent_id, mailbox_agent_id, message_id DESC);
  `,
}, {
  version: 2,
  sql: MIGRATION_V2,
}];

function requiredId(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new CrewError('INVALID_INPUT', `${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new CrewError('INVALID_INPUT', `${field} must not be empty`);
  if (trimmed.length > MAX_ID) throw new CrewError('INVALID_INPUT', `${field} exceeds ${MAX_ID} characters`);
  return trimmed;
}

function requiredText(value: unknown, field: string, max: number = MAX_TEXT): string {
  if (typeof value !== 'string') throw new CrewError('INVALID_INPUT', `${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new CrewError('INVALID_INPUT', `${field} must not be empty`);
  if (trimmed.length > max) throw new CrewError('INVALID_INPUT', `${field} exceeds ${max} characters`);
  return trimmed;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredId(value, field);
}

function requiredRefs(value: unknown, field: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CrewError('INVALID_INPUT', `${field} must be an array`);
  if (value.length > MAX_REFS) throw new CrewError('INVALID_INPUT', `${field} exceeds ${MAX_REFS} entries`);
  return value.map(ref => {
    if (typeof ref !== 'string') throw new CrewError('INVALID_INPUT', `${field} entries must be strings`);
    const trimmed = ref.trim();
    if (!trimmed) throw new CrewError('INVALID_INPUT', `${field} entries must not be empty`);
    if (trimmed.length > MAX_REF) throw new CrewError('INVALID_INPUT', `${field} entries exceed ${MAX_REF} characters`);
    return trimmed;
  });
}

interface AgentRow {
  agent_id: string;
  display_name: string;
  driver: string;
  instructions: string;
  workspace_path: string;
  concurrency_limit: number;
  created_at: string;
}

interface TaskRow {
  task_id: string;
  root_request_id: string;
  assigned_agent_id: string;
  goal: string;
  status: string;
  receipt_json: string | null;
  cancel_reason: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  deadline_at: string | null;
}

interface MessageRow {
  message_id: number;
  mailbox_agent_id: string;
  sender_agent_id: string;
  kind: string;
  parent_request_id: string | null;
  root_request_id: string | null;
  task_id: string | null;
  text: string;
  attachment_refs_json: string;
  expects_reply: number;
  hop: number;
  pure_ack: number;
  enqueued_at: string;
  dequeued_at: string | null;
}

function agentRecord(row: AgentRow): CrewAgentRecord {
  return {
    agentId: row.agent_id,
    displayName: row.display_name,
    driver: row.driver as CrewDriverId,
    instructions: row.instructions,
    workspacePath: row.workspace_path,
    concurrencyLimit: row.concurrency_limit,
    createdAt: row.created_at,
  };
}

function taskRecord(row: TaskRow): CrewTaskRecord {
  return {
    taskId: row.task_id,
    rootRequestId: row.root_request_id,
    assignedAgentId: row.assigned_agent_id,
    goal: row.goal,
    status: row.status as CrewTaskStatus,
    ...(row.receipt_json === null ? {} : {receipt: parseCrewReceipt(JSON.parse(row.receipt_json) as unknown)}),
    ...(row.cancel_reason === null ? {} : {cancelReason: row.cancel_reason}),
    createdAt: row.created_at,
    ...(row.started_at === null ? {} : {startedAt: row.started_at}),
    ...(row.finished_at === null ? {} : {finishedAt: row.finished_at}),
    ...(row.deadline_at === null ? {} : {deadlineAt: row.deadline_at}),
  };
}

function messageRecord(row: MessageRow): CrewMessageRecord {
  return {
    messageId: row.message_id,
    mailboxAgentId: row.mailbox_agent_id,
    senderAgentId: row.sender_agent_id,
    kind: row.kind as CrewMessageKind,
    ...(row.parent_request_id === null ? {} : {parentRequestId: row.parent_request_id}),
    ...(row.root_request_id === null ? {} : {rootRequestId: row.root_request_id}),
    ...(row.task_id === null ? {} : {taskId: row.task_id}),
    text: row.text,
    attachmentRefs: JSON.parse(row.attachment_refs_json) as string[],
    expectsReply: row.expects_reply === 1,
    hop: row.hop,
    pureAck: row.pure_ack === 1,
    enqueuedAt: row.enqueued_at,
    ...(row.dequeued_at === null ? {} : {dequeuedAt: row.dequeued_at}),
  };
}

interface HandoffRow {
  handoff_id: string;
  file_path: string;
  size_bytes: number;
  sha256: string;
  from_agent_id: string;
  task_id: string | null;
  root_request_id: string | null;
  created_at: string;
}

function handoffRecord(row: HandoffRow): CrewHandoffRecord {
  return {
    handoffId: row.handoff_id,
    filePath: row.file_path,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    fromAgentId: row.from_agent_id,
    ...(row.task_id === null ? {} : {taskId: row.task_id}),
    ...(row.root_request_id === null ? {} : {rootRequestId: row.root_request_id}),
    createdAt: row.created_at,
  };
}

interface ParentNotificationRow {
  notification_id: number;
  task_id: string;
  root_request_id: string;
  assigned_agent_id: string;
  receipt_json: string;
  created_at: string;
  dequeued_at: string | null;
}

function parentNotificationRecord(row: ParentNotificationRow): CrewParentNotificationRecord {
  return {
    notificationId: row.notification_id,
    taskId: row.task_id,
    rootRequestId: row.root_request_id,
    assignedAgentId: row.assigned_agent_id,
    receipt: parseCrewReceipt(JSON.parse(row.receipt_json) as unknown),
    createdAt: row.created_at,
    ...(row.dequeued_at === null ? {} : {dequeuedAt: row.dequeued_at}),
  };
}

/**
 * crew 独立 SQLite 存储：命名 agent 注册表、任务表与每 agent 持久 FIFO 信箱。
 * 与 Runtime 主库分离；任务根只由父发起，回执使用固定四段格式。
 */
export class CrewStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  private constructor(db: DatabaseSync, options: CrewStoreOptions) {
    this.db = db;
    this.now = options.now ?? Date.now;
  }

  /**
   * 打开（必要时创建）独立的 crew 数据库文件；重复打开已迁移文件是幂等的。
   * 打开即执行一次超时恢复：进程重启后，已过期限的未完成任务被标记失败
   * 并写入父信箱（固定回执格式）；未超时任务与信箱原样从 SQLite 续上。
   */
  static open(path: string, options: CrewStoreOptions = {}): CrewStore {
    const db = openStorage(path, MIGRATIONS);
    const store = new CrewStore(db, options);
    store.recoverExpiredTasks();
    return store;
  }

  close(): void {
    this.db.close();
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private inTransaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private getAgentRow(agentId: string): AgentRow {
    const row = this.db.prepare('SELECT agent_id, display_name, driver, instructions, workspace_path, concurrency_limit, created_at FROM crew_agents WHERE agent_id = ?').get(agentId) as AgentRow | undefined;
    if (!row) throw new CrewError('UNKNOWN_AGENT', `agent ${agentId} is not registered`);
    return row;
  }

  registerAgent(spec: CrewAgentSpec): CrewAgentRecord {
    const agentId = requiredId(spec.agentId, 'agentId');
    if (agentId === CREW_PARENT_AGENT_ID) {
      throw new CrewError('INVALID_INPUT', `${CREW_PARENT_AGENT_ID} is reserved for the parent agent`);
    }
    const displayName = requiredText(spec.displayName, 'displayName', MAX_ID);
    if (!DRIVERS.includes(spec.driver)) {
      throw new CrewError('INVALID_INPUT', `driver must be one of ${DRIVERS.join(', ')}`);
    }
    const instructions = requiredText(spec.instructions, 'instructions', 16384);
    const workspacePath = requiredText(spec.workspacePath, 'workspacePath');
    const concurrencyLimit = spec.concurrencyLimit ?? MAX_CONCURRENT_TASKS_PER_AGENT;
    if (!Number.isInteger(concurrencyLimit) || concurrencyLimit < 1 || concurrencyLimit > MAX_CONCURRENT_TASKS_PER_AGENT) {
      throw new CrewError('INVALID_INPUT', `concurrencyLimit must be an integer between 1 and ${MAX_CONCURRENT_TASKS_PER_AGENT}`);
    }
    const createdAt = this.iso();
    const duplicate = this.db.prepare('SELECT agent_id FROM crew_agents WHERE agent_id = ?').get(agentId);
    if (duplicate) throw new CrewError('CONFLICT', `agent ${agentId} is already registered`);
    this.db.prepare('INSERT INTO crew_agents (agent_id, display_name, driver, instructions, workspace_path, concurrency_limit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(agentId, displayName, spec.driver, instructions, workspacePath, concurrencyLimit, createdAt);
    return {agentId, displayName, driver: spec.driver, instructions, workspacePath, concurrencyLimit, createdAt};
  }

  listAgents(): CrewAgentRecord[] {
    const rows = this.db.prepare('SELECT agent_id, display_name, driver, instructions, workspace_path, concurrency_limit, created_at FROM crew_agents ORDER BY agent_id').all() as unknown as AgentRow[];
    return rows.map(agentRecord);
  }

  getAgent(agentId: string): CrewAgentRecord | undefined {
    const id = requiredId(agentId, 'agentId');
    const row = this.db.prepare('SELECT agent_id, display_name, driver, instructions, workspace_path, concurrency_limit, created_at FROM crew_agents WHERE agent_id = ?').get(id) as AgentRow | undefined;
    return row ? agentRecord(row) : undefined;
  }

  /**
   * 父发起一个任务根：写入任务表并投递到目标 agent 的 FIFO 信箱。
   * 每个根请求最多 8 次派发；子 agent 不能创建任务根，因此不存在回派路径。
   */
  dispatchTask(input: CrewDispatchInput): CrewTaskRecord {
    const taskId = requiredId(input.taskId, 'taskId');
    const rootRequestId = requiredId(input.rootRequestId, 'rootRequestId');
    const assignedAgentId = requiredId(input.assignedAgentId, 'assignedAgentId');
    const goal = requiredText(input.goal, 'goal');
    let deadlineAt: string | undefined;
    if (input.timeoutMs !== undefined) {
      if (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0) {
        throw new CrewError('INVALID_INPUT', 'timeoutMs must be a positive integer of milliseconds');
      }
      deadlineAt = new Date(this.now() + input.timeoutMs).toISOString();
    }
    return this.inTransaction(() => {
      this.getAgentRow(assignedAgentId);
      const dispatched = this.db.prepare('SELECT count(*) AS n FROM crew_tasks WHERE root_request_id = ?').get(rootRequestId) as {n: number};
      if (dispatched.n >= MAX_AUTO_DISPATCHES_PER_ROOT_REQUEST) {
        throw new CrewError('DISPATCH_LIMIT_EXCEEDED', `root request ${rootRequestId} already used ${dispatched.n} of ${MAX_AUTO_DISPATCHES_PER_ROOT_REQUEST} dispatches`);
      }
      const duplicate = this.db.prepare('SELECT task_id FROM crew_tasks WHERE task_id = ?').get(taskId);
      if (duplicate) throw new CrewError('CONFLICT', `task ${taskId} already exists`);
      const createdAt = this.iso();
      this.db.prepare('INSERT INTO crew_tasks (task_id, root_request_id, assigned_agent_id, goal, status, receipt_json, cancel_reason, created_at, started_at, finished_at, deadline_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?)')
        .run(taskId, rootRequestId, assignedAgentId, goal, 'queued', createdAt, deadlineAt ?? null);
      this.insertMessage({
        mailboxAgentId: assignedAgentId,
        senderAgentId: CREW_PARENT_AGENT_ID,
        kind: 'task',
        parentRequestId: rootRequestId,
        rootRequestId,
        taskId,
        text: goal,
        attachmentRefs: [],
        expectsReply: true,
        hop: 0,
        pureAck: false,
        enqueuedAt: createdAt,
      });
      return {
        taskId,
        rootRequestId,
        assignedAgentId,
        goal,
        status: 'queued' as CrewTaskStatus,
        createdAt,
        ...(deadlineAt === undefined ? {} : {deadlineAt}),
      };
    });
  }

  /**
   * 按 FIFO 取出该 agent 最老的排队任务并置为 running。
   * 运行中任务达到上限（系统 2、注册时不超过 2）时返回 undefined，任务保持排队。
   */
  claimNextTask(agentId: string): CrewTaskRecord | undefined {
    const id = requiredId(agentId, 'agentId');
    return this.inTransaction(() => {
      const agent = this.getAgentRow(id);
      const running = this.db.prepare("SELECT count(*) AS n FROM crew_tasks WHERE assigned_agent_id = ? AND status = 'running'").get(id) as {n: number};
      if (running.n >= Math.min(agent.concurrency_limit, MAX_CONCURRENT_TASKS_PER_AGENT)) return undefined;
      const row = this.db.prepare("SELECT task_id, root_request_id, assigned_agent_id, goal, status, receipt_json, cancel_reason, created_at, started_at, finished_at, deadline_at FROM crew_tasks WHERE assigned_agent_id = ? AND status = 'queued' ORDER BY created_at, rowid LIMIT 1").get(id) as TaskRow | undefined;
      if (!row) return undefined;
      const startedAt = this.iso();
      this.db.prepare("UPDATE crew_tasks SET status = 'running', started_at = ? WHERE task_id = ?").run(startedAt, row.task_id);
      return taskRecord({...row, status: 'running', started_at: startedAt});
    });
  }

  getTask(taskId: string): CrewTaskRecord | undefined {
    const id = requiredId(taskId, 'taskId');
    const row = this.db.prepare('SELECT task_id, root_request_id, assigned_agent_id, goal, status, receipt_json, cancel_reason, created_at, started_at, finished_at, deadline_at FROM crew_tasks WHERE task_id = ?').get(id) as TaskRow | undefined;
    return row ? taskRecord(row) : undefined;
  }

  listTasks(filter: {rootRequestId?: string; assignedAgentId?: string} = {}): CrewTaskRecord[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.rootRequestId !== undefined) {
      clauses.push('root_request_id = ?');
      params.push(requiredId(filter.rootRequestId, 'rootRequestId'));
    }
    if (filter.assignedAgentId !== undefined) {
      clauses.push('assigned_agent_id = ?');
      params.push(requiredId(filter.assignedAgentId, 'assignedAgentId'));
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT task_id, root_request_id, assigned_agent_id, goal, status, receipt_json, cancel_reason, created_at, started_at, finished_at, deadline_at FROM crew_tasks${where} ORDER BY created_at, rowid`).all(...params) as unknown as TaskRow[];
    return rows.map(taskRecord);
  }

  /** 记录回执并把任务置为终态。回执先经固定格式校验，失败不产生任何写入。 */
  completeTask(taskId: string, receipt: unknown): CrewTaskRecord {
    const id = requiredId(taskId, 'taskId');
    const parsed = parseCrewReceipt(receipt);
    return this.inTransaction(() => {
      const row = this.db.prepare('SELECT task_id, root_request_id, assigned_agent_id, goal, status, receipt_json, cancel_reason, created_at, started_at, finished_at, deadline_at FROM crew_tasks WHERE task_id = ?').get(id) as TaskRow | undefined;
      if (!row) throw new CrewError('NOT_FOUND', `task ${id} does not exist`);
      if (row.status !== 'running') {
        throw new CrewError('CONFLICT', `task ${id} is ${row.status}; only running tasks can be completed`);
      }
      const finishedAt = this.iso();
      this.db.prepare('UPDATE crew_tasks SET status = ?, receipt_json = ?, finished_at = ? WHERE task_id = ?')
        .run(parsed.status, JSON.stringify(parsed), finishedAt, id);
      return taskRecord({
        ...row,
        status: parsed.status,
        receipt_json: JSON.stringify(parsed),
        finished_at: finishedAt,
      });
    });
  }

  /** 父打断（取消）一个未完成任务，并向执行 agent 的信箱投递 interrupt 消息。 */
  cancelTask(taskId: string, reason: string): CrewTaskRecord {
    const id = requiredId(taskId, 'taskId');
    const cancelReason = requiredText(reason, 'reason');
    return this.inTransaction(() => {
      const row = this.db.prepare('SELECT task_id, root_request_id, assigned_agent_id, goal, status, receipt_json, cancel_reason, created_at, started_at, finished_at, deadline_at FROM crew_tasks WHERE task_id = ?').get(id) as TaskRow | undefined;
      if (!row) throw new CrewError('NOT_FOUND', `task ${id} does not exist`);
      if (row.status !== 'queued' && row.status !== 'running') {
        throw new CrewError('CONFLICT', `task ${id} is already ${row.status}`);
      }
      const finishedAt = this.iso();
      this.db.prepare("UPDATE crew_tasks SET status = 'cancelled', cancel_reason = ?, finished_at = ? WHERE task_id = ?")
        .run(cancelReason, finishedAt, id);
      this.insertMessage({
        mailboxAgentId: row.assigned_agent_id,
        senderAgentId: CREW_PARENT_AGENT_ID,
        kind: 'interrupt',
        parentRequestId: row.root_request_id,
        rootRequestId: row.root_request_id,
        taskId: row.task_id,
        text: cancelReason,
        attachmentRefs: [],
        expectsReply: false,
        hop: 0,
        pureAck: false,
        enqueuedAt: finishedAt,
      });
      return taskRecord({...row, status: 'cancelled', cancel_reason: cancelReason, finished_at: finishedAt});
    });
  }

  /**
   * agent 间消息投递到收件方的 FIFO 信箱（父也可以用保留身份 'parent' 发送）。
   * 防确认死循环：对同一发送→收件方向，连续第二条纯确认消息直接丢弃，
   * 返回 undefined；信箱内容不变。
   */
  sendMessage(input: CrewMessageInput): CrewMessageRecord | undefined {
    const fromAgentId = requiredId(input.fromAgentId, 'fromAgentId');
    const toAgentId = requiredId(input.toAgentId, 'toAgentId');
    const text = requiredText(input.text, 'text');
    if (fromAgentId !== CREW_PARENT_AGENT_ID) this.getAgentRow(fromAgentId);
    this.getAgentRow(toAgentId);
    if (fromAgentId === toAgentId) throw new CrewError('INVALID_INPUT', 'sender and recipient must differ');
    const parentRequestId = optionalText(input.parentRequestId, 'parentRequestId');
    const rootRequestId = optionalText(input.rootRequestId, 'rootRequestId');
    const taskId = optionalText(input.taskId, 'taskId');
    const attachmentRefs = requiredRefs(input.attachmentRefs, 'attachmentRefs');
    const hop = input.hop ?? 0;
    if (!Number.isInteger(hop) || hop < 0 || hop > MAX_MESSAGE_HOP) {
      throw new CrewError('INVALID_INPUT', `hop must be an integer between 0 and ${MAX_MESSAGE_HOP}`);
    }
    const expectsReply = input.expectsReply ?? false;
    if (typeof expectsReply !== 'boolean') throw new CrewError('INVALID_INPUT', 'expectsReply must be a boolean');
    const pureAck = isPureAcknowledgement(text);
    return this.inTransaction(() => {
      if (pureAck) {
        const last = this.db.prepare("SELECT pure_ack FROM crew_messages WHERE sender_agent_id = ? AND mailbox_agent_id = ? ORDER BY message_id DESC LIMIT 1").get(fromAgentId, toAgentId) as {pure_ack: number} | undefined;
        if (last?.pure_ack === 1) return undefined;
      }
      const enqueuedAt = this.iso();
      const messageId = this.insertMessage({
        mailboxAgentId: toAgentId,
        senderAgentId: fromAgentId,
        kind: 'message',
        ...(parentRequestId === undefined ? {} : {parentRequestId}),
        ...(rootRequestId === undefined ? {} : {rootRequestId}),
        ...(taskId === undefined ? {} : {taskId}),
        text,
        attachmentRefs,
        expectsReply,
        hop,
        pureAck,
        enqueuedAt,
      });
      return {
        messageId,
        mailboxAgentId: toAgentId,
        senderAgentId: fromAgentId,
        kind: 'message' as CrewMessageKind,
        ...(parentRequestId === undefined ? {} : {parentRequestId}),
        ...(rootRequestId === undefined ? {} : {rootRequestId}),
        ...(taskId === undefined ? {} : {taskId}),
        text,
        attachmentRefs,
        expectsReply,
        hop,
        pureAck,
        enqueuedAt,
      };
    });
  }

  /** 按消息 id 读取单条消息（含已消费的）；不存在时返回 undefined。供可信宿主与内核做回复路由。 */
  getMessage(messageId: number): CrewMessageRecord | undefined {
    if (!Number.isInteger(messageId) || messageId < 1) {
      throw new CrewError('INVALID_INPUT', 'messageId must be a positive integer');
    }
    const row = this.db.prepare('SELECT message_id, mailbox_agent_id, sender_agent_id, kind, parent_request_id, root_request_id, task_id, text, attachment_refs_json, expects_reply, hop, pure_ack, enqueued_at, dequeued_at FROM crew_messages WHERE message_id = ?').get(messageId) as MessageRow | undefined;
    return row ? messageRecord(row) : undefined;
  }

  /**
   * 按 FIFO 读取信箱中未消费的消息；dequeue 为 true 时在读取的同一事务内
   * 标记已消费（保留行与 dequeued_at 供审计）。未消费消息跨重启保留。
   */
  receiveMessages(agentId: string, options: {limit?: number; dequeue?: boolean} = {}): CrewMessageRecord[] {
    const id = requiredId(agentId, 'agentId');
    const limit = options.limit ?? 32;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECEIVED) {
      throw new CrewError('INVALID_INPUT', `limit must be an integer between 1 and ${MAX_RECEIVED}`);
    }
    const dequeue = options.dequeue ?? false;
    return this.inTransaction(() => {
      this.getAgentRow(id);
      const rows = this.db.prepare('SELECT message_id, mailbox_agent_id, sender_agent_id, kind, parent_request_id, root_request_id, task_id, text, attachment_refs_json, expects_reply, hop, pure_ack, enqueued_at, dequeued_at FROM crew_messages WHERE mailbox_agent_id = ? AND dequeued_at IS NULL ORDER BY message_id LIMIT ?').all(id, limit) as unknown as MessageRow[];
      if (dequeue && rows.length) {
        const now = this.iso();
        const mark = this.db.prepare('UPDATE crew_messages SET dequeued_at = ? WHERE message_id = ? AND dequeued_at IS NULL');
        for (const row of rows) mark.run(now, row.message_id);
        return rows.map(row => messageRecord({...row, dequeued_at: now}));
      }
      return rows.map(messageRecord);
    });
  }

  /**
   * 超时恢复：把已过 `deadline_at` 的未完成任务（排队或运行中）标记为 failed，
   * 回执使用固定四段格式，并在同一事务内写入父信箱。
   * 打开数据库时自动执行一次（模拟进程重启后的恢复）；宿主也可周期性调用。
   * 幂等：已是终态的任务不会重复处理。
   */
  recoverExpiredTasks(): CrewTaskRecord[] {
    return this.inTransaction(() => {
      const nowIso = this.iso();
      const rows = this.db.prepare("SELECT task_id, root_request_id, assigned_agent_id, goal, status, receipt_json, cancel_reason, created_at, started_at, finished_at, deadline_at FROM crew_tasks WHERE status IN ('queued', 'running') AND deadline_at IS NOT NULL AND deadline_at < ?").all(nowIso) as unknown as TaskRow[];
      const recovered: CrewTaskRecord[] = [];
      for (const row of rows) {
        if (row.deadline_at === null) continue;
        const finishedAt = this.iso();
        const receipt: CrewReceipt = {
          status: 'failed',
          result: `任务超时：未在期限 ${row.deadline_at} 前完成，恢复流程已标记失败`,
          evidenceRefs: [],
          unblock: '',
        };
        const receiptJson = JSON.stringify(receipt);
        this.db.prepare("UPDATE crew_tasks SET status = 'failed', receipt_json = ?, finished_at = ? WHERE task_id = ? AND status IN ('queued', 'running')")
          .run(receiptJson, finishedAt, row.task_id);
        this.db.prepare('INSERT INTO crew_parent_inbox (task_id, root_request_id, assigned_agent_id, receipt_json, created_at, dequeued_at) VALUES (?, ?, ?, ?, ?, NULL)')
          .run(row.task_id, row.root_request_id, row.assigned_agent_id, receiptJson, finishedAt);
        recovered.push(taskRecord({...row, status: 'failed', receipt_json: receiptJson, finished_at: finishedAt}));
      }
      return recovered;
    });
  }

  /**
   * 父信箱：按 FIFO 读取系统通知（当前只有任务超时），回执为固定四段格式。
   * dequeue 为 true 时在读取的同一事务内标记已消费；通知随 SQLite 持久，重启不丢。
   */
  receiveParentNotifications(options: {limit?: number; dequeue?: boolean} = {}): CrewParentNotificationRecord[] {
    const limit = options.limit ?? 32;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECEIVED) {
      throw new CrewError('INVALID_INPUT', `limit must be an integer between 1 and ${MAX_RECEIVED}`);
    }
    const dequeue = options.dequeue ?? false;
    return this.inTransaction(() => {
      const rows = this.db.prepare('SELECT notification_id, task_id, root_request_id, assigned_agent_id, receipt_json, created_at, dequeued_at FROM crew_parent_inbox WHERE dequeued_at IS NULL ORDER BY notification_id LIMIT ?').all(limit) as unknown as ParentNotificationRow[];
      if (dequeue && rows.length) {
        const now = this.iso();
        const mark = this.db.prepare('UPDATE crew_parent_inbox SET dequeued_at = ? WHERE notification_id = ? AND dequeued_at IS NULL');
        for (const row of rows) mark.run(now, row.notification_id);
        return rows.map(row => parentNotificationRecord({...row, dequeued_at: now}));
      }
      return rows.map(parentNotificationRecord);
    });
  }

  /**
   * 登记一条文件交接清单（发送方）。`sizeBytes` 与 `sha256` 必须来自对真实字节的
   * 计算（内核在 publish 时完成），不接收模型自报值；同一 handoffId 或同一
   * file_path 的重复登记都明确拒绝。
   */
  registerHandoff(registration: CrewHandoffRegistration): CrewHandoffRecord {
    const handoffId = requiredId(registration.handoffId, 'handoffId');
    const filePath = requiredId(registration.filePath, 'filePath');
    if (!Number.isSafeInteger(registration.sizeBytes) || registration.sizeBytes < 0) {
      throw new CrewError('INVALID_INPUT', 'sizeBytes must be a non-negative safe integer');
    }
    if (typeof registration.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(registration.sha256)) {
      throw new CrewError('INVALID_INPUT', 'sha256 must be a lowercase 64-character hex digest');
    }
    const fromAgentId = requiredId(registration.fromAgentId, 'fromAgentId');
    const taskId = optionalText(registration.taskId, 'taskId');
    const rootRequestId = optionalText(registration.rootRequestId, 'rootRequestId');
    return this.inTransaction(() => {
      this.getAgentRow(fromAgentId);
      const duplicateId = this.db.prepare('SELECT handoff_id FROM crew_handoff WHERE handoff_id = ?').get(handoffId);
      if (duplicateId) throw new CrewError('CONFLICT', `handoff ${handoffId} is already registered`);
      const duplicatePath = this.db.prepare('SELECT handoff_id FROM crew_handoff WHERE file_path = ?').get(filePath);
      if (duplicatePath) throw new CrewError('CONFLICT', `handoff file path ${filePath} is already registered`);
      const createdAt = this.iso();
      this.db.prepare('INSERT INTO crew_handoff (handoff_id, file_path, size_bytes, sha256, from_agent_id, task_id, root_request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(handoffId, filePath, registration.sizeBytes, registration.sha256, fromAgentId, taskId ?? null, rootRequestId ?? null, createdAt);
      return {
        handoffId,
        filePath,
        sizeBytes: registration.sizeBytes,
        sha256: registration.sha256,
        fromAgentId,
        ...(taskId === undefined ? {} : {taskId}),
        ...(rootRequestId === undefined ? {} : {rootRequestId}),
        createdAt,
      };
    });
  }

  /** 按 id 读取交接清单（纯清单读取，不做文件校验；接收校验在内核 receiveHandoff）。 */
  getHandoff(handoffId: string): CrewHandoffRecord | undefined {
    const id = requiredId(handoffId, 'handoffId');
    const row = this.db.prepare('SELECT handoff_id, file_path, size_bytes, sha256, from_agent_id, task_id, root_request_id, created_at FROM crew_handoff WHERE handoff_id = ?').get(id) as HandoffRow | undefined;
    return row ? handoffRecord(row) : undefined;
  }

  private insertMessage(input: {
    mailboxAgentId: string;
    senderAgentId: string;
    kind: CrewMessageKind;
    parentRequestId?: string;
    rootRequestId?: string;
    taskId?: string;
    text: string;
    attachmentRefs: readonly string[];
    expectsReply: boolean;
    hop: number;
    pureAck: boolean;
    enqueuedAt: string;
  }): number {
    const result = this.db.prepare('INSERT INTO crew_messages (mailbox_agent_id, sender_agent_id, kind, parent_request_id, root_request_id, task_id, text, attachment_refs_json, expects_reply, hop, pure_ack, enqueued_at, dequeued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .run(
        input.mailboxAgentId,
        input.senderAgentId,
        input.kind,
        input.parentRequestId ?? null,
        input.rootRequestId ?? null,
        input.taskId ?? null,
        input.text,
        JSON.stringify(input.attachmentRefs),
        input.expectsReply ? 1 : 0,
        input.hop,
        input.pureAck ? 1 : 0,
        input.enqueuedAt,
      );
    return Number(result.lastInsertRowid);
  }
}

export function openCrewStore(path: string, options: CrewStoreOptions = {}): CrewStore {
  return CrewStore.open(path, options);
}

export type {CrewReceipt, CrewReceiptStatus} from './receipts.js';
export {parseCrewReceipt, isPureAcknowledgement} from './receipts.js';
export {CrewError, type CrewErrorCode} from './errors.js';
