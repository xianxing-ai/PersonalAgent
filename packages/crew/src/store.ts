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
/** 订阅登录方式：本机已登录官方 CLI，或用户自己的 API key。 */
export type CrewConsentLoginKind = 'local-login' | 'api-key';

/** 全部合法驱动 id（注册表、同意记录共用同一枚举）。 */
export const CREW_DRIVER_IDS: readonly CrewDriverId[] = ['codex', 'claude', 'opencode', 'grok', 'gemini', 'acp-generic'];

const DRIVERS = CREW_DRIVER_IDS;

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

/**
 * 一家订阅来源（驱动）的用户同意记录。首次启用某家订阅前必须由用户明确同意；
 * 同意可随时撤销，撤销后驱动不得再启动。记录只存合规元数据（登录方式、条款要点），
 * 不存储任何凭据。
 */
export interface CrewConsentRecord {
  readonly driverId: CrewDriverId;
  readonly granted: boolean;
  readonly loginKind: CrewConsentLoginKind;
  /** 同意时向用户展示的条款要点摘要（厂商条款、额度来源）。 */
  readonly termsSummary: string;
  /** 同意者标识（例如 'user'）。 */
  readonly grantedBy: string;
  readonly grantedAt: string;
  readonly revokedAt?: string;
  readonly revokeReason?: string;
  readonly updatedAt: string;
}

export interface CrewConsentGrantRecordInput {
  readonly driverId: CrewDriverId;
  readonly loginKind: CrewConsentLoginKind;
  readonly termsSummary: string;
  readonly grantedBy: string;
}

export interface CrewConsentRevokeRecordInput {
  readonly driverId: CrewDriverId;
  readonly reason: string;
}

export interface CrewStoreOptions {
  readonly now?: () => number;
}

const MAX_ID = 128;
const MAX_TEXT = 8192;
const MAX_REF = 256;
const MAX_REFS = 32;
const MAX_RECEIVED = 100;

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
  // P2（#crew-p2）：订阅使用同意记录。每家驱动最多一条记录（upsert），
  // 撤销后 granted=0 并保留撤销审计字段；不存任何凭据内容。
  version: 2,
  sql: `
    CREATE TABLE crew_consents (
      driver_id TEXT PRIMARY KEY CHECK (driver_id IN ('codex', 'claude', 'opencode', 'grok', 'gemini', 'acp-generic')),
      granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
      login_kind TEXT NOT NULL CHECK (login_kind IN ('local-login', 'api-key')),
      terms_summary TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      granted_at TEXT NOT NULL,
      revoked_at TEXT,
      revoke_reason TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;
  `,
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

interface ConsentRow {
  driver_id: string;
  granted: number;
  login_kind: string;
  terms_summary: string;
  granted_by: string;
  granted_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  updated_at: string;
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

function consentRecord(row: ConsentRow): CrewConsentRecord {
  return {
    driverId: row.driver_id as CrewDriverId,
    granted: row.granted === 1,
    loginKind: row.login_kind as CrewConsentLoginKind,
    termsSummary: row.terms_summary,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
    ...(row.revoked_at === null ? {} : {revokedAt: row.revoked_at}),
    ...(row.revoke_reason === null ? {} : {revokeReason: row.revoke_reason}),
    updatedAt: row.updated_at,
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

  /** 打开（必要时创建）独立的 crew 数据库文件；重复打开已迁移文件是幂等的。 */
  static open(path: string, options: CrewStoreOptions = {}): CrewStore {
    const db = openStorage(path, MIGRATIONS);
    return new CrewStore(db, options);
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
    return this.inTransaction(() => {
      this.getAgentRow(assignedAgentId);
      const dispatched = this.db.prepare('SELECT count(*) AS n FROM crew_tasks WHERE root_request_id = ?').get(rootRequestId) as {n: number};
      if (dispatched.n >= MAX_AUTO_DISPATCHES_PER_ROOT_REQUEST) {
        throw new CrewError('DISPATCH_LIMIT_EXCEEDED', `root request ${rootRequestId} already used ${dispatched.n} of ${MAX_AUTO_DISPATCHES_PER_ROOT_REQUEST} dispatches`);
      }
      const duplicate = this.db.prepare('SELECT task_id FROM crew_tasks WHERE task_id = ?').get(taskId);
      if (duplicate) throw new CrewError('CONFLICT', `task ${taskId} already exists`);
      const createdAt = this.iso();
      this.db.prepare('INSERT INTO crew_tasks (task_id, root_request_id, assigned_agent_id, goal, status, receipt_json, cancel_reason, created_at, started_at, finished_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL)')
        .run(taskId, rootRequestId, assignedAgentId, goal, 'queued', createdAt);
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
      const row = this.db.prepare("SELECT task_id, root_request_id, assigned_agent_id, goal, status, receipt_json, cancel_reason, created_at, started_at, finished_at FROM crew_tasks WHERE assigned_agent_id = ? AND status = 'queued' ORDER BY created_at, rowid LIMIT 1").get(id) as TaskRow | undefined;
      if (!row) return undefined;
      const startedAt = this.iso();
      this.db.prepare("UPDATE crew_tasks SET status = 'running', started_at = ? WHERE task_id = ?").run(startedAt, row.task_id);
      return taskRecord({...row, status: 'running', started_at: startedAt});
    });
  }

  getTask(taskId: string): CrewTaskRecord | undefined {
    const id = requiredId(taskId, 'taskId');
    const row = this.db.prepare('SELECT task_id, root_request_id, assigned_agent_id, goal, status, receipt_json, cancel_reason, created_at, started_at, finished_at FROM crew_tasks WHERE task_id = ?').get(id) as TaskRow | undefined;
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
    const rows = this.db.prepare(`SELECT task_id, root_request_id, assigned_agent_id, goal, status, receipt_json, cancel_reason, created_at, started_at, finished_at FROM crew_tasks${where} ORDER BY created_at, rowid`).all(...params) as unknown as TaskRow[];
    return rows.map(taskRecord);
  }

  /** 记录回执并把任务置为终态。回执先经固定格式校验，失败不产生任何写入。 */
  completeTask(taskId: string, receipt: unknown): CrewTaskRecord {
    const id = requiredId(taskId, 'taskId');
    const parsed = parseCrewReceipt(receipt);
    return this.inTransaction(() => {
      const row = this.db.prepare('SELECT task_id, root_request_id, assigned_agent_id, goal, status, receipt_json, cancel_reason, created_at, started_at, finished_at FROM crew_tasks WHERE task_id = ?').get(id) as TaskRow | undefined;
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
      const row = this.db.prepare('SELECT task_id, root_request_id, assigned_agent_id, goal, status, receipt_json, cancel_reason, created_at, started_at, finished_at FROM crew_tasks WHERE task_id = ?').get(id) as TaskRow | undefined;
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
   * 消费某 agent 信箱中对应指定任务的最老一条未消费 task 消息（保留行供审计）。
   * 驱动运行时代码领取任务后用它把"派单通知"从信箱里消费掉；
   * interrupt 等其他消息不走这里，留给 MCP 工具层按 P1 语义消费。
   */
  dequeueTaskMessage(agentId: string, taskId: string): CrewMessageRecord | undefined {
    const id = requiredId(agentId, 'agentId');
    const tid = requiredId(taskId, 'taskId');
    return this.inTransaction(() => {
      this.getAgentRow(id);
      const row = this.db.prepare("SELECT message_id, mailbox_agent_id, sender_agent_id, kind, parent_request_id, root_request_id, task_id, text, attachment_refs_json, expects_reply, hop, pure_ack, enqueued_at, dequeued_at FROM crew_messages WHERE mailbox_agent_id = ? AND task_id = ? AND kind = 'task' AND dequeued_at IS NULL ORDER BY message_id LIMIT 1").get(id, tid) as MessageRow | undefined;
      if (!row) return undefined;
      const now = this.iso();
      this.db.prepare('UPDATE crew_messages SET dequeued_at = ? WHERE message_id = ? AND dequeued_at IS NULL').run(now, row.message_id);
      return messageRecord({...row, dequeued_at: now});
    });
  }

  /** 读取一家驱动的同意记录；从未登记时返回 undefined。 */
  getConsentRecord(driverId: string): CrewConsentRecord | undefined {
    const id = requiredId(driverId, 'driverId');
    const row = this.db.prepare('SELECT driver_id, granted, login_kind, terms_summary, granted_by, granted_at, revoked_at, revoke_reason, updated_at FROM crew_consents WHERE driver_id = ?').get(id) as unknown as ConsentRow | undefined;
    return row ? consentRecord(row) : undefined;
  }

  /** 写入/覆盖一家驱动的同意记录（重新同意会清掉上一次撤销的审计字段）。 */
  saveConsentGrant(input: CrewConsentGrantRecordInput): CrewConsentRecord {
    if (!DRIVERS.includes(input.driverId)) {
      throw new CrewError('INVALID_INPUT', `driverId must be one of ${DRIVERS.join(', ')}`);
    }
    const loginKinds: readonly CrewConsentLoginKind[] = ['local-login', 'api-key'];
    if (!loginKinds.includes(input.loginKind)) {
      throw new CrewError('INVALID_INPUT', `loginKind must be one of ${loginKinds.join(', ')}`);
    }
    const termsSummary = requiredText(input.termsSummary, 'termsSummary', 4096);
    const grantedBy = requiredId(input.grantedBy, 'grantedBy');
    return this.inTransaction(() => {
      const now = this.iso();
      this.db.prepare(`
        INSERT INTO crew_consents (driver_id, granted, login_kind, terms_summary, granted_by, granted_at, revoked_at, revoke_reason, updated_at)
        VALUES (?, 1, ?, ?, ?, ?, NULL, NULL, ?)
        ON CONFLICT(driver_id) DO UPDATE SET
          granted = 1, login_kind = excluded.login_kind, terms_summary = excluded.terms_summary,
          granted_by = excluded.granted_by, granted_at = excluded.granted_at,
          revoked_at = NULL, revoke_reason = NULL, updated_at = excluded.updated_at
      `).run(input.driverId, input.loginKind, termsSummary, grantedBy, now, now);
      return consentRecord(this.db.prepare('SELECT driver_id, granted, login_kind, terms_summary, granted_by, granted_at, revoked_at, revoke_reason, updated_at FROM crew_consents WHERE driver_id = ?').get(input.driverId) as unknown as ConsentRow);
    });
  }

  /** 撤销一家驱动的同意记录：granted=0 并记录撤销时间与原因；从未登记或已撤销时报错。 */
  saveConsentRevoke(input: CrewConsentRevokeRecordInput): CrewConsentRecord {
    const driverId = requiredId(input.driverId, 'driverId');
    if (!DRIVERS.includes(driverId as CrewDriverId)) {
      throw new CrewError('INVALID_INPUT', `driverId must be one of ${DRIVERS.join(', ')}`);
    }
    const reason = requiredText(input.reason, 'reason', 4096);
    return this.inTransaction(() => {
      const row = this.db.prepare('SELECT driver_id, granted, login_kind, terms_summary, granted_by, granted_at, revoked_at, revoke_reason, updated_at FROM crew_consents WHERE driver_id = ?').get(driverId) as unknown as ConsentRow | undefined;
      if (!row) throw new CrewError('NOT_FOUND', `driver ${driverId} has no consent record`);
      if (row.granted !== 1) throw new CrewError('CONFLICT', `consent for driver ${driverId} is already revoked`);
      const now = this.iso();
      this.db.prepare('UPDATE crew_consents SET granted = 0, revoked_at = ?, revoke_reason = ?, updated_at = ? WHERE driver_id = ?')
        .run(now, reason, now, driverId);
      return consentRecord(this.db.prepare('SELECT driver_id, granted, login_kind, terms_summary, granted_by, granted_at, revoked_at, revoke_reason, updated_at FROM crew_consents WHERE driver_id = ?').get(driverId) as unknown as ConsentRow);
    });
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
