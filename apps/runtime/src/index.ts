import {createHash, randomUUID} from 'node:crypto';
import type {DatabaseSync, SQLInputValue} from 'node:sqlite';
import {parseEvent, parseRequest, parseResponse, PROTOCOL_VERSION, ProtocolError, validateContract} from '@personal-agent/contracts';
import type {Event, Operation, Request, Response, Result, TaskSnapshot, ToolDescriptor} from '@personal-agent/contracts';
import {openStorage} from '@personal-agent/storage';
import type {Migration} from '@personal-agent/storage';
import {AuthorizationPolicy} from '@personal-agent/policy';
import {SqliteAuthorizationStore} from './authorization-store.js';
import {bindCoordinationStore} from './coordination-store.js';
import type {AtomicCoordinationStorePort} from '@personal-agent/goals/store';
import {bindFactProjectionStore} from './fact-projection-store.js';
import type {FactProjectionStore} from './fact-projection-store.js';
import {bindHostStateStore} from './host-state-store.js';
export type {TrustedHostStateStore} from './host-state-store.js';
export {createRuntimeAtomicStatePort} from './atomic-host-state.js';
export type {RuntimeAtomicStatePort} from './atomic-host-state.js';

export {FactProjectionError} from './fact-projection-store.js';
export type {
  CompleteFactImpactRequest,
  FactProjectionLink,
  FactProjectionReceipt,
  FactProjectionRequest,
  FactProjectionStore,
  PendingFactImpact,
  StagedFactProjection
} from './fact-projection-store.js';

type TaskState = TaskSnapshot['state'];
type TaskError = NonNullable<TaskSnapshot['error']>;
type SideEffect = 'read' | 'local_write' | 'external_write';

export interface ToolExecutionRecord {
  protocolVersion: string;
  policyDecision: 'not_evaluated' | 'allow' | 'deny';
  executionStarted: boolean;
  inputDigest: string;
  evidenceId: string;
  requestId: string;
  taskId: string;
  toolName: string;
  toolVersion: string;
  startedAt: string;
  finishedAt?: string;
  state: 'started' | 'confirmed' | 'failed' | 'unknown';
  errorCode?: string;
  /** A trusted host may persist a tri-state reconciliation classification without creating a new run. */
  reconciliationOutcome?: 'applied' | 'not_applied' | 'unknown';
}

export type ToolExecutionReconciliationOutcome = NonNullable<ToolExecutionRecord['reconciliationOutcome']>;

export interface SubmitTaskInput {
  goal: string;
  conversationId: string;
  attachmentRefs?: readonly string[];
  idempotencyKey: string;
}

export interface ConversationTurn {
  taskId: string;
  goal: string;
  resultSummary: string;
}

export interface ProgressInput {
  stepId: string;
  label: string;
  completedUnits?: number;
  totalUnits?: number;
}

export interface TransitionPatch {
  resultSummary?: string;
  evidenceRefs?: readonly string[];
  error?: TaskError | null;
  cancelRequested?: boolean;
}

export interface RunOptions {
  deadline: string;
  sideEffect: SideEffect;
  resume?: boolean;
}

export interface ToolApproval {
  argumentsDigest: string;
  approvalId: string;
  taskId: string;
  toolName: string;
  scopes: string[];
  expiresAt: string;
  revision: number;
  state: 'pending' | 'allowed' | 'denied';
}

export interface WorkerContext {
  taskId: string;
  deadline: string;
  signal: AbortSignal;
  saveCheckpoint(key: string, value: unknown): void;
  loadCheckpoint(key: string): unknown;
  reportProgress(progress: ProgressInput): TaskSnapshot;
}

export interface WorkerResult {
  resultSummary: string;
  evidenceRefs?: readonly string[];
}

export interface ScheduleInput {
  scheduleId: string;
  goal: string;
  conversationId: string;
  runAt: string;
  timeZone: string;
  missedRunPolicy: 'run_once' | 'skip';
  taskIdempotencyKey: string;
}

export interface ScheduleSnapshot extends ScheduleInput {
  status: 'pending' | 'fired' | 'skipped' | 'cancelled';
  taskId?: string;
}

export interface ScheduleDispatch {
  scheduleId: string;
  status: 'fired' | 'skipped';
  task?: TaskSnapshot;
}

export interface RuntimeToolInvocation {
  onAuthorized?: () => void;
  toolName: string;
  toolVersion: string;
  arguments: unknown;
  taskId: string;
  runId: string;
  authorizationRef: string;
  deadline: string;
  signal: AbortSignal;
  userPresent?: boolean;
}

export interface RuntimeToolGateway {
  list(): ToolDescriptor[];
  invoke(invocation: RuntimeToolInvocation): Promise<unknown>;
}

export interface RuntimeOptions {
  now?: () => Date;
  idFactory?: () => string;
  toolGateway?: RuntimeToolGateway;
  createToolGateway?: (policy: AuthorizationPolicy) => RuntimeToolGateway;
}

export interface TaskPort {
  submitTask(input: SubmitTaskInput): TaskSnapshot;
  getTask(taskId: string): TaskSnapshot;
  transitionTask(taskId: string, state: TaskState, patch?: TransitionPatch): TaskSnapshot;
  requestCancel(taskId: string, reason?: string): {taskId: string; state: TaskState; cancelAccepted: boolean};
  saveCheckpoint(taskId: string, key: string, value: unknown): void;
  saveCheckpointOnce(taskId: string, key: string, value: unknown): boolean;
  loadCheckpoint(taskId: string, key: string): unknown;
}

export interface EventPort {
  readEvents(afterSequence?: number): Event[];
}

export interface SchedulerPort {
  createSchedule(input: ScheduleInput): ScheduleSnapshot;
  getSchedule(scheduleId: string): ScheduleSnapshot;
  listSchedules(conversationId: string): ScheduleSnapshot[];
  /** Exclusive trusted owner supplies its complete desired set before dispatch/recovery. */
  reconcileSchedules(conversationId: string, desired: readonly ScheduleInput[]): ScheduleSnapshot[];
  dispatchDueSchedules(conversationId?: string): ScheduleDispatch[];
  recoverMissedSchedules(conversationId?: string): ScheduleDispatch[];
}

interface TaskRow {
  task_id: string;
  goal: string;
  conversation_id: string;
  attachment_refs_json: string;
  state: TaskState;
  revision: number;
  updated_at: string;
  steps_json: string;
  evidence_refs_json: string;
  result_summary: string | null;
  error_json: string | null;
  cancel_requested: number;
}

interface EventRow {
  sequence: number;
  event_id: string;
  stream_id: string;
  task_id: string | null;
  type: Event['type'];
  occurred_at: string;
  payload_json: string;
}

interface ScheduleRow {
  schedule_id: string;
  goal: string;
  conversation_id: string;
  run_at: string;
  time_zone: string;
  missed_run_policy: 'run_once' | 'skip';
  task_idempotency_key: string;
  status: 'pending' | 'fired' | 'skipped' | 'cancelled';
  task_id: string | null;
}

const terminal = new Set<TaskState>(['succeeded', 'failed', 'cancelled']);
const baseCapabilities: Operation[] = ['system.handshake', 'task.submit', 'task.get', 'task.list', 'conversation.list', 'approval.list', 'task.cancel', 'event.subscribe'];
const interrupted = ['planning', 'running', 'waiting_external', 'verifying', 'cancelling'] as const;
const allowed: Record<TaskState, readonly TaskState[]> = {
  created: ['planning', 'cancelling', 'failed'],
  planning: ['running', 'waiting_approval', 'waiting_external', 'waiting_reconciliation', 'cancelling', 'failed'],
  running: ['waiting_approval', 'waiting_external', 'waiting_reconciliation', 'verifying', 'cancelling', 'failed'],
  waiting_approval: ['running', 'cancelling', 'cancelled', 'failed'],
  waiting_external: ['running', 'waiting_reconciliation', 'cancelling', 'failed'],
  waiting_reconciliation: ['running', 'verifying', 'cancelling', 'cancelled', 'failed'],
  verifying: ['succeeded', 'waiting_reconciliation', 'cancelling', 'failed'],
  cancelling: ['cancelled', 'waiting_reconciliation', 'failed'],
  succeeded: [],
  failed: [],
  cancelled: []
};

export const RUNTIME_MIGRATIONS: readonly Migration[] = [{
  version: 1,
  sql: [
    "CREATE TABLE tasks (task_id TEXT PRIMARY KEY, goal TEXT NOT NULL, conversation_id TEXT NOT NULL, attachment_refs_json TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, steps_json TEXT NOT NULL, evidence_refs_json TEXT NOT NULL, result_summary TEXT, error_json TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1))) STRICT;",
    "CREATE TABLE task_idempotency (idempotency_key TEXT PRIMARY KEY, input_json TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES tasks(task_id)) STRICT;",
    "CREATE TABLE task_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, stream_id TEXT NOT NULL, task_id TEXT REFERENCES tasks(task_id), type TEXT NOT NULL, occurred_at TEXT NOT NULL, payload_json TEXT NOT NULL) STRICT;",
    "CREATE INDEX task_events_stream_sequence ON task_events(stream_id, sequence);",
    "CREATE TABLE task_checkpoints (task_id TEXT NOT NULL REFERENCES tasks(task_id), checkpoint_key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (task_id, checkpoint_key)) STRICT;",
    "CREATE TABLE task_schedules (schedule_id TEXT PRIMARY KEY, goal TEXT NOT NULL, conversation_id TEXT NOT NULL, run_at TEXT NOT NULL, time_zone TEXT NOT NULL, missed_run_policy TEXT NOT NULL CHECK (missed_run_policy IN ('run_once', 'skip')), task_idempotency_key TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'fired', 'skipped')), task_id TEXT REFERENCES tasks(task_id)) STRICT;",
    "CREATE INDEX task_schedules_due ON task_schedules(status, run_at);"
  ].join('\n')
}, {
  version: 2,
  sql: 'CREATE TABLE authorization_grants (authorization_ref TEXT PRIMARY KEY, value_json TEXT NOT NULL) STRICT;'
}, {
  version: 3,
  sql: 'CREATE TABLE tool_execution_records (evidence_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(task_id), record_json TEXT NOT NULL) STRICT; CREATE INDEX tool_execution_task ON tool_execution_records(task_id);'
}, {
  version: 4,
  sql: 'CREATE TABLE tool_approvals (approval_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(task_id), value_json TEXT NOT NULL) STRICT;'
}, {
  version: 5,
  sql: 'CREATE TABLE coordination_graphs (namespace TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL) STRICT;'
}, {
  version: 6,
  sql: [
    'CREATE TABLE coordination_fact_projections (graph_namespace TEXT NOT NULL, memory_namespace TEXT NOT NULL, fact_id TEXT NOT NULL, fact_revision INTEGER NOT NULL CHECK (fact_revision > 0), event_id TEXT NOT NULL, content_hash TEXT NOT NULL, node_id TEXT NOT NULL, node_revision INTEGER NOT NULL CHECK (node_revision > 0), graph_revision INTEGER NOT NULL CHECK (graph_revision > 0), PRIMARY KEY (graph_namespace, memory_namespace, fact_id, fact_revision), UNIQUE (graph_namespace, memory_namespace, event_id)) STRICT;',
    'CREATE TABLE coordination_projection_receipts (graph_namespace TEXT NOT NULL, memory_namespace TEXT NOT NULL, consumer_key TEXT NOT NULL, batch_token TEXT NOT NULL, base_checkpoint TEXT NOT NULL, watermark TEXT NOT NULL, handled_key TEXT NOT NULL, graph_revision INTEGER NOT NULL CHECK (graph_revision >= 0), links_json TEXT NOT NULL, committed_at TEXT NOT NULL, PRIMARY KEY (graph_namespace, memory_namespace, consumer_key, batch_token)) STRICT;',
    'CREATE TABLE coordination_pending_impacts (graph_namespace TEXT NOT NULL, memory_namespace TEXT NOT NULL, consumer_key TEXT NOT NULL, batch_token TEXT NOT NULL, graph_revision INTEGER NOT NULL CHECK (graph_revision > 0), links_json TEXT NOT NULL, created_at TEXT NOT NULL, handled_at TEXT, report_json TEXT, PRIMARY KEY (graph_namespace, memory_namespace, consumer_key, batch_token)) STRICT;'
  ].join('\n')
}, {
  version: 7,
  sql: 'CREATE TABLE coordination_projection_staging (graph_namespace TEXT NOT NULL, memory_namespace TEXT NOT NULL, consumer_key TEXT NOT NULL, batch_token TEXT NOT NULL, handled_key TEXT NOT NULL, payload_json TEXT NOT NULL, staged_at TEXT NOT NULL, PRIMARY KEY (graph_namespace, memory_namespace, consumer_key, batch_token)) STRICT;'
}, {
  version: 8,
  sql: [
    'ALTER TABLE task_schedules RENAME TO task_schedules_before_cancellation;',
    "CREATE TABLE task_schedules (schedule_id TEXT PRIMARY KEY, goal TEXT NOT NULL, conversation_id TEXT NOT NULL, run_at TEXT NOT NULL, time_zone TEXT NOT NULL, missed_run_policy TEXT NOT NULL CHECK (missed_run_policy IN ('run_once', 'skip')), task_idempotency_key TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'fired', 'skipped', 'cancelled')), task_id TEXT REFERENCES tasks(task_id)) STRICT;",
    'INSERT INTO task_schedules SELECT * FROM task_schedules_before_cancellation;',
    'DROP TABLE task_schedules_before_cancellation;',
    'CREATE INDEX task_schedules_due ON task_schedules(status, run_at);',
    'CREATE INDEX task_schedules_conversation ON task_schedules(conversation_id);'
  ].join('\n')
}, {
  version: 9,
  sql: 'CREATE TABLE coordination_fact_erasure_receipts (graph_namespace TEXT NOT NULL, memory_namespace TEXT NOT NULL, fact_id TEXT NOT NULL, operation_id TEXT NOT NULL, expected_graph_revision INTEGER NOT NULL CHECK (expected_graph_revision >= 0), committed_at TEXT NOT NULL, PRIMARY KEY (graph_namespace, memory_namespace, fact_id), UNIQUE (graph_namespace, operation_id)) STRICT;'
}, {
  version:10,
  sql:'CREATE TABLE trusted_host_state (namespace TEXT NOT NULL,state_key TEXT NOT NULL,value_json TEXT NOT NULL,PRIMARY KEY(namespace,state_key)) STRICT;'
}];

export class RuntimeError extends Error {
  constructor(public readonly code: TaskError['code'], message: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}

class DeadlineExceeded extends Error {}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
}

function toolInputDigest(taskId: string, payload: {
  toolName: string; toolVersion: string; arguments: Record<string, unknown>; scopeRef: string;
}): string {
  return createHash('sha256').update(canonical({taskId, payload})).digest('hex');
}

function requireText(value: string, name: string): string {
  if (!value.trim()) throw new RuntimeError('INVALID_ARGUMENT', name + ' must not be empty');
  return value;
}

function parseTime(value: string, name: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new RuntimeError('INVALID_ARGUMENT', name + ' must be an ISO 8601 time');
  return result;
}

function taskFromRow(row: TaskRow): TaskSnapshot {
  const snapshot: TaskSnapshot = {
    taskId: row.task_id,
    state: row.state,
    revision: row.revision,
    updatedAt: row.updated_at,
    steps: JSON.parse(row.steps_json) as TaskSnapshot['steps'],
    evidenceRefs: JSON.parse(row.evidence_refs_json) as string[],
    goal: row.goal,
    conversationId: row.conversation_id,
    attachmentRefs: JSON.parse(row.attachment_refs_json) as string[]
  };
  if (row.result_summary !== null) snapshot.resultSummary = row.result_summary;
  if (row.error_json !== null) snapshot.error = JSON.parse(row.error_json) as TaskError;
  if (row.cancel_requested === 1) snapshot.cancelRequested = true;
  validateContract('snapshot', snapshot);
  return snapshot;
}

function scheduleFromRow(row: ScheduleRow): ScheduleSnapshot {
  const schedule: ScheduleSnapshot = {
    scheduleId: row.schedule_id,
    goal: row.goal,
    conversationId: row.conversation_id,
    runAt: row.run_at,
    timeZone: row.time_zone,
    missedRunPolicy: row.missed_run_policy,
    taskIdempotencyKey: row.task_idempotency_key,
    status: row.status
  };
  if (row.task_id !== null) schedule.taskId = row.task_id;
  return schedule;
}

export class TaskRuntime implements TaskPort, EventPort, SchedulerPort {
  /** Host metadata shares this SQLite; this port is never registered as a wire operation. */
  bindTrustedHostState(namespace:string) {return bindHostStateStore(this.db,namespace);}
  readonly policy: AuthorizationPolicy;
  private readonly db: DatabaseSync;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly toolGateway: RuntimeToolGateway | undefined;
  private readonly sessionRef = 'runtime-' + randomUUID();
  private readonly active = new Map<string, AbortController>();
  private readonly activeToolExecutions = new Map<string,string>();

  /** Trusted host handoff observation only; Policy remains the authorization source. */
  isToolExecutionActive(record:Pick<ToolExecutionRecord,'taskId'|'evidenceId'|'inputDigest'>):boolean {
    const current=this.activeToolExecutions.get(JSON.stringify([record.taskId,record.evidenceId]));
    return current!==undefined && current===record.inputDigest;
  }

  constructor(path: string, options: RuntimeOptions = {}) {
    this.db = openStorage(path, RUNTIME_MIGRATIONS);
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.policy = new AuthorizationPolicy(new SqliteAuthorizationStore(this.db));
    this.toolGateway = options.createToolGateway?.(this.policy) ?? options.toolGateway;
  }

  /** Trusted host only; provisioning never clears an existing graph. */
  provisionCoordinationStore(namespace: string): AtomicCoordinationStorePort {
    return bindCoordinationStore(this.db, namespace, true);
  }

  /** Does not provision: missing graphs report NOT_FOUND when used. */
  bindCoordinationStore(namespace: string): AtomicCoordinationStorePort {
    return bindCoordinationStore(this.db, namespace, false);
  }

  /** Trusted host only; provisions the graph without publishing a Runtime capability. */
  provisionFactProjectionStore(namespace: string): FactProjectionStore {
    bindCoordinationStore(this.db, namespace, true);
    return bindFactProjectionStore(this.db, namespace);
  }

  /** Does not provision: projection or pending reads report NOT_FOUND for a missing graph. */
  bindFactProjectionStore(namespace: string): FactProjectionStore {
    return bindFactProjectionStore(this.db, namespace);
  }

  close(): void {
    if (this.active.size) throw new RuntimeError('REVISION_CONFLICT', 'Cannot close runtime while workers are active');
    this.db.close();
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private transaction<T>(work: () => T): T {
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

  private taskRow(taskId: string): TaskRow {
    const row = this.db.prepare('SELECT task_id, goal, conversation_id, attachment_refs_json, state, revision, updated_at, steps_json, evidence_refs_json, result_summary, error_json, cancel_requested FROM tasks WHERE task_id = ?').get(taskId) as unknown as TaskRow | undefined;
    if (!row) throw new RuntimeError('NOT_FOUND', 'Task not found');
    return row;
  }

  getTask(taskId: string): TaskSnapshot {
    return this.publicTask(taskFromRow(this.taskRow(requireText(taskId, 'taskId'))));
  }

  private publicTask(task:TaskSnapshot):TaskSnapshot {
    if(this.loadCheckpoint(task.taskId,'private-copy-erasure')!==undefined) {
      const masked={...task,goal:'[private-derived body withheld]',steps:[],attachmentRefs:[]};
      delete masked.resultSummary;delete masked.error;
      return structuredClone(masked);
    }
    return structuredClone(task);
  }

  private snapshotSequence(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM task_events').get() as {sequence: number};
    return row.sequence;
  }

  listTasks(input: {conversationId?: string; states?: TaskState[]; beforeSequence?: number; snapshotSequence?: number; limit?: number}): Result<'task.list'> {
    const limit = input.limit ?? 50;
    const latestSequence = this.snapshotSequence();
    const snapshotSequence = input.snapshotSequence ?? latestSequence;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RuntimeError('INVALID_ARGUMENT', 'limit must be between 1 and 100');
    if (!Number.isSafeInteger(snapshotSequence) || snapshotSequence < 0 || snapshotSequence > latestSequence) throw new RuntimeError('INVALID_ARGUMENT', 'Invalid snapshot sequence');
    const clauses = ["e.type = 'task.created'", 'e.sequence <= ?'];
    const params: SQLInputValue[] = [snapshotSequence];
    if (input.beforeSequence !== undefined) { clauses.push('e.sequence < ?'); params.push(input.beforeSequence); }
    if (input.conversationId !== undefined) { clauses.push('t.conversation_id = ?'); params.push(requireText(input.conversationId, 'conversationId')); }
    if (input.states?.length) { clauses.push(`t.state IN (${input.states.map(() => '?').join(', ')})`); params.push(...input.states); }
    const rows = this.db.prepare(`SELECT t.task_id, t.goal, t.conversation_id, t.attachment_refs_json, t.state, t.revision, t.updated_at, t.steps_json, t.evidence_refs_json, t.result_summary, t.error_json, t.cancel_requested, e.sequence AS created_sequence FROM tasks t JOIN task_events e ON e.task_id = t.task_id WHERE ${clauses.join(' AND ')} ORDER BY e.sequence DESC LIMIT ?`).all(...params, limit + 1) as unknown as Array<TaskRow & {created_sequence: number}>;
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return {items: page.map(row=>this.publicTask(taskFromRow(row))), snapshotSequence, ...(more ? {nextBeforeSequence: page.at(-1)!.created_sequence} : {})};
  }

  listConversations(input: {conversationId?: string; beforeSequence?: number; snapshotSequence?: number; limit?: number}): Result<'conversation.list'> {
    const limit = input.limit ?? 20;
    const latestSequence = this.snapshotSequence();
    const snapshotSequence = input.snapshotSequence ?? latestSequence;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RuntimeError('INVALID_ARGUMENT', 'limit must be between 1 and 100');
    if (!Number.isSafeInteger(snapshotSequence) || snapshotSequence < 0 || snapshotSequence > latestSequence) throw new RuntimeError('INVALID_ARGUMENT', 'Invalid snapshot sequence');
    const rows = this.db.prepare(`SELECT t.task_id, t.goal, t.conversation_id, t.attachment_refs_json, t.state, t.revision, t.updated_at, t.steps_json, t.evidence_refs_json, t.result_summary, t.error_json, t.cancel_requested, e.sequence AS created_sequence FROM tasks t JOIN task_events e ON e.task_id = t.task_id AND e.type = 'task.created' WHERE e.sequence <= ? ORDER BY e.sequence DESC`).all(snapshotSequence) as unknown as Array<TaskRow & {created_sequence: number}>;
    const grouped = new Map<string, {sequence: number; tasks: TaskSnapshot[]}>();
    const conversationId = input.conversationId === undefined ? undefined : requireText(input.conversationId, 'conversationId');
    for (const row of rows) {
      if (conversationId !== undefined && row.conversation_id !== conversationId) continue;
      const current = grouped.get(row.conversation_id) ?? {sequence: row.created_sequence, tasks: []};
      current.tasks.push(this.publicTask(taskFromRow(row))); grouped.set(row.conversation_id, current);
    }
    const conversations = [...grouped.entries()].filter(([, value]) => input.beforeSequence === undefined || value.sequence < input.beforeSequence).sort((a, b) => b[1].sequence - a[1].sequence);
    const more = conversations.length > limit;
    const page = conversations.slice(0, limit);
    return {items: page.map(([id, value]) => ({conversationId: id, updatedAt: value.tasks.reduce((latest, task) => task.updatedAt > latest ? task.updatedAt : latest, value.tasks[0]!.updatedAt), taskCount: value.tasks.length, tasks: value.tasks.reverse()})), snapshotSequence, ...(more ? {nextBeforeSequence: page.at(-1)![1].sequence} : {})};
  }

  listApprovals(input: {approvalId?: string; taskId?: string; state?: 'pending' | 'allowed' | 'denied'; beforeRowId?: number; limit?: number}): Result<'approval.list'> {
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RuntimeError('INVALID_ARGUMENT', 'limit must be between 1 and 100');
    const clauses: string[] = []; const params: SQLInputValue[] = [];
    if (input.approvalId !== undefined) { clauses.push('approval_id = ?'); params.push(requireText(input.approvalId, 'approvalId')); }
    if (input.taskId !== undefined) { clauses.push('task_id = ?'); params.push(requireText(input.taskId, 'taskId')); }
    if (input.state !== undefined) { clauses.push("json_extract(value_json, '$.state') = ?"); params.push(input.state); }
    if (input.beforeRowId !== undefined) { clauses.push('rowid < ?'); params.push(input.beforeRowId); }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    const rows = this.db.prepare(`SELECT rowid, value_json FROM tool_approvals${where} ORDER BY rowid DESC LIMIT ?`).all(...params, limit + 1) as Array<{rowid: number; value_json: string}>;
    const approvals = rows.map(row => ({rowId: row.rowid, value: JSON.parse(row.value_json) as ToolApproval}));
    const more = approvals.length > limit; const page = approvals.slice(0, limit);
    return {items: page.map(({value}) => ({approvalId: value.approvalId, taskId: value.taskId, revision: value.revision, action: value.toolName, scopes: [...value.scopes], expiresAt: value.expiresAt, state: value.state, argumentsDigest: value.argumentsDigest, argumentSummary: 'redacted' as const})), snapshotSequence: this.snapshotSequence(), ...(more ? {nextBeforeRowId: page.at(-1)!.rowId} : {})};
  }

  readConversationHistory(conversationId: string, beforeTaskId: string | undefined, limit = 20): ConversationTurn[] {
    const normalizedConversationId = requireText(conversationId, 'conversationId');
    const normalizedTaskId = beforeTaskId === undefined ? undefined : requireText(beforeTaskId, 'beforeTaskId');
    if (!Number.isInteger(limit) || limit <= 0) throw new Error('limit must be a positive integer');

    if(normalizedTaskId)this.getTask(normalizedTaskId);
    const currentEvent = normalizedTaskId ? this.db.prepare(
      `SELECT sequence FROM task_events
       WHERE task_id = ? AND type = 'task.created'
       ORDER BY sequence ASC LIMIT 1`,
    ).get(normalizedTaskId) as {sequence?: number} | undefined : {sequence:this.snapshotSequence()+1};
    if (!currentEvent || typeof currentEvent.sequence !== 'number') return [];

    const rows = this.db.prepare(
      `SELECT t.task_id AS taskId, t.goal, t.result_summary AS resultSummary
       FROM tasks t
       JOIN task_events e ON e.task_id = t.task_id AND e.type = 'task.created'
       WHERE t.conversation_id = ?
         AND t.state = 'succeeded'
         AND t.result_summary IS NOT NULL
         AND e.sequence < ?
       ORDER BY e.sequence DESC LIMIT ?`,
    ).all(normalizedConversationId, currentEvent.sequence, limit) as unknown as ConversationTurn[];

    return rows.reverse().filter(row=>!['private-copy-erasure','private-memory:consumption:v1','private-derived-output','knowledge-recheck-result']
      .some(key=>this.loadCheckpoint(row.taskId,key)!==undefined)).map(row => ({
      taskId: row.taskId,
      goal: row.goal,
      resultSummary: row.resultSummary,
    }));
  }

  /** Host-only metadata inventory. Descendants are copies, never inherited consumption licenses. */
  listBindings(input:{limit?:number;afterTaskId?:string}={}):{items:{taskId:string;binding:Record<string,unknown>}[];nextAfterTaskId?:string} {
    const limit=input.limit??100;
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new RuntimeError('INVALID_ARGUMENT','Invalid binding page size');
    const rows=this.db.prepare("SELECT task_id, checkpoint_key, value_json FROM task_checkpoints WHERE checkpoint_key IN ('private-memory:consumption:v1','subtask-parent') ORDER BY task_id")
      .all() as {task_id:string;checkpoint_key:string;value_json:string}[];
    const bindings=new Map<string,Record<string,unknown>>();
    const parents=new Map<string,string>();
    for(const row of rows) {
      const value=JSON.parse(row.value_json) as Record<string,unknown>;
      if(row.checkpoint_key==='subtask-parent' && typeof value.parentTaskId==='string')parents.set(row.task_id,value.parentTaskId);
      else if(row.checkpoint_key==='private-memory:consumption:v1') {
        if(value.taskId!==row.task_id || value.destination!=='agentarts')throw new RuntimeError('REVISION_CONFLICT','Invalid private copy binding');
        bindings.set(row.task_id,value);
      }
    }
    for(const [child,parent] of parents) {
      if(bindings.has(child))continue;
      let ancestor:string|undefined=parent;
      const seen=new Set([child]);
      while(ancestor && !seen.has(ancestor)) {
        seen.add(ancestor);
        const binding=bindings.get(ancestor);
        if(binding) {bindings.set(child,{...binding,taskId:child,derivedFromTaskId:ancestor,copyOnly:true});break;}
        ancestor=parents.get(ancestor);
      }
    }
    const entries=[...bindings].sort(([a],[b])=>a<b?-1:a>b?1:0)
      .filter(([id])=>input.afterTaskId===undefined||id>input.afterTaskId);
    const items=entries.slice(0,limit).map(([taskId,binding])=>({taskId,binding:structuredClone(binding)}));
    return {items,...(entries.length>limit?{nextAfterTaskId:items.at(-1)!.taskId}:{})};
  }

  readCopyErasureReceipt(taskId:string):{taskId:string;factId:string;bindingDigest:string;state:'purged'}|undefined {
    const marker=this.loadCheckpoint(taskId,'private-copy-erasure') as {taskId:string;factId:string;bindingDigest:string;state:string}|undefined;
    if(!marker || marker.state!=='purged')return undefined;
    const current=this.privateCopyIdentity(taskId);
    if(marker.taskId!==taskId || marker.factId!==current.factId || marker.bindingDigest!==current.bindingDigest)return undefined;
    return {taskId,factId:marker.factId,bindingDigest:marker.bindingDigest,state:'purged'};
  }

  private privateCopyIdentity(taskId:string):{factId:string;bindingDigest:string} {
    let afterTaskId:string|undefined;
    for(;;) {
      const page=this.listBindings({limit:100,...(afterTaskId?{afterTaskId}:{})});
      const item=page.items.find(item=>item.taskId===taskId);
      if(item) {
        const fact=item.binding.fact as {ref?:{id?:unknown}}|undefined;
        if(typeof fact?.ref?.id!=='string')throw new RuntimeError('REVISION_CONFLICT','Invalid private fact identity');
        return {factId:fact.ref.id,bindingDigest:createHash('sha256').update(JSON.stringify(item.binding)).digest('hex')};
      }
      if(!page.nextAfterTaskId)throw new RuntimeError('NOT_FOUND','Private copy binding not found');
      afterTaskId=page.nextAfterTaskId;
    }
  }

  /** Redacts bodies in the original database, retaining authorization/execution/Evidence metadata. */
  eraseTaskCopies(input:{taskId:string;factId:string;bindingDigest:string;deadline:string;signal:AbortSignal;externalCopiesPurged?:boolean}):{state:'withheld'|'purged'} {
    if(input.signal.aborted || !Number.isFinite(Date.parse(input.deadline)) || this.now().getTime()>=Date.parse(input.deadline)) {
      throw new RuntimeError('CANCELLED','Copy erasure cancelled or expired');
    }
    const identity=this.privateCopyIdentity(input.taskId);
    if(identity.factId!==input.factId||identity.bindingDigest!==input.bindingDigest)throw new RuntimeError('REVISION_CONFLICT','Copy binding changed');
    return this.transaction(()=> {
      const task=this.getTask(input.taskId);
      const pending=!['succeeded','failed','cancelled'].includes(task.state)
        || input.externalCopiesPurged===false
        || this.readToolExecutions(input.taskId).some(record=>record.state==='started'||record.state==='unknown');
      const state=pending?'withheld':'purged';
      this.saveCheckpoint(input.taskId,'private-copy-erasure',{taskId:input.taskId,...identity,state});
      if(pending)return {state};
      // Metadata-only allowlist: unknown checkpoint bodies are conservatively removed.
      const rows=this.db.prepare('SELECT checkpoint_key,value_json FROM task_checkpoints WHERE task_id=?').all(input.taskId) as {checkpoint_key:string;value_json:string}[];
      const preserved=/^(private-memory:consumption:v1|private-copy-erasure|application-profile|application-deadline|subtask-execution-binding|subtask-coordination-binding|windows-host-attempt:|trusted-readback-evidence:)/u;
      for(const row of rows) {
        if(preserved.test(row.checkpoint_key))continue;
        if(row.checkpoint_key==='subtask-parent') {
          const {parentTaskId,subtaskId}=JSON.parse(row.value_json) as {parentTaskId:string;subtaskId:string};
          this.db.prepare('UPDATE task_checkpoints SET value_json=? WHERE task_id=? AND checkpoint_key=?')
            .run(JSON.stringify({parentTaskId,subtaskId,redacted:true}),input.taskId,row.checkpoint_key);
          continue;
        }
        this.db.prepare('UPDATE task_checkpoints SET value_json=? WHERE task_id=? AND checkpoint_key=?')
          .run(JSON.stringify({redacted:true,bodyDigest:createHash('sha256').update(row.value_json).digest('hex')}),input.taskId,row.checkpoint_key);
      }
      this.db.prepare('UPDATE tasks SET goal=?,result_summary=NULL,error_json=NULL,steps_json=? WHERE task_id=?')
        .run('[private-derived body erased]','[]',input.taskId);
      const events=this.db.prepare('SELECT sequence,type,payload_json FROM task_events WHERE task_id=?').all(input.taskId) as {sequence:number;type:Event['type'];payload_json:string}[];
      for(const event of events)this.db.prepare('UPDATE task_events SET payload_json=? WHERE sequence=?')
        .run(JSON.stringify(this.redactEventBody(event.type,JSON.parse(event.payload_json))),event.sequence);
      this.db.prepare('UPDATE task_idempotency SET input_json=? WHERE task_id=?')
        .run(JSON.stringify({redacted:true,taskId:input.taskId}),input.taskId);
      return {state};
    });
  }

  private redactEventBody(type:Event['type'],body:unknown):unknown {
    if(['task.created','task.state_changed','task.completed','task.failed','task.cancelled'].includes(type)) {
      const task=body as TaskSnapshot;
      const redacted={...task,goal:'[private-derived body withheld]',steps:[],attachmentRefs:[]};
      delete redacted.resultSummary;delete redacted.error;
      return redacted;
    }
    if(type==='task.progress')return {...body as object,label:'[private-derived progress withheld]'};
    // Other events contain ids, counts and states, never arbitrary tool result bodies.
    return body;
  }

  readToolExecutions(taskId: string): ToolExecutionRecord[] {
    this.getTask(taskId);
    return this.db.prepare('SELECT record_json FROM tool_execution_records WHERE task_id = ? ORDER BY rowid').all(taskId).map(row => JSON.parse(row.record_json as string) as ToolExecutionRecord);
  }

  readEvidence(taskId: string): import('@personal-agent/contracts').ProtocolContracts['evidence'][] {
    const execution=this.readToolExecutions(taskId).map(record => {
      const evidence: import('@personal-agent/contracts').ProtocolContracts['evidence'] = {
        evidenceId: record.evidenceId, kind: 'execution', sourceRef: record.toolName,
        capturedAt: record.finishedAt ?? record.startedAt,
        summary: 'Tool execution ' + record.state + '; policy=' + record.policyDecision
          + (record.reconciliationOutcome ? '; reconciliation=' + record.reconciliationOutcome : ''),
        verification: 'conditional', sensitivity: 'internal',
      };
      validateContract('evidence', evidence);
      return evidence;
    });
    const readback=this.db.prepare("SELECT value_json FROM task_checkpoints WHERE task_id = ? AND checkpoint_key LIKE 'trusted-readback-evidence:%' ORDER BY checkpoint_key")
      .all(taskId).map(row=>{
        const evidence=JSON.parse(row.value_json as string) as import('@personal-agent/contracts').ProtocolContracts['evidence'];
        validateContract('evidence',evidence);return evidence;
      });
    return [...execution,...readback];
  }

  getApproval(approvalId: string): ToolApproval {
    const row = this.db.prepare('SELECT value_json FROM tool_approvals WHERE approval_id = ?').get(approvalId);
    if (!row) throw new RuntimeError('NOT_FOUND', 'Approval not found');
    return JSON.parse(row.value_json as string) as ToolApproval;
  }

  requestToolApproval(approvalId: string, taskId: string, tool: ToolDescriptor, expiresAt: string, argumentsDigest: string): ToolApproval {
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT value_json FROM tool_approvals WHERE approval_id = ?').get(approvalId);
      if (existing) {
        const approval = JSON.parse(existing.value_json as string) as ToolApproval;
        if (approval.taskId !== taskId || approval.toolName !== tool.name || approval.argumentsDigest !== argumentsDigest) throw new RuntimeError('REVISION_CONFLICT', 'Approval identity conflict');
        return approval;
      }
      if (this.getTask(taskId).state !== 'running') throw new RuntimeError('REVISION_CONFLICT', 'Task is not running');
      const approval: ToolApproval = {approvalId, taskId, toolName: tool.name, scopes: [...tool.requiredScopes], expiresAt, revision: 1, state: 'pending', argumentsDigest};
      this.db.prepare('INSERT INTO tool_approvals (approval_id, task_id, value_json) VALUES (?, ?, ?)').run(approvalId, taskId, JSON.stringify(approval));
      this.updateTask(taskId, 'waiting_approval', {}, true);
      this.emit('approval.requested', {approvalId, taskId, revision: 1, action: tool.name}, taskId);
      return approval;
    });
  }

  respondApproval(approvalId: string, decision: 'allow_once' | 'deny', expectedRevision: number): {accepted: boolean; approvalState: 'allowed' | 'denied'} {
    return this.transaction(() => {
      const approval = this.getApproval(approvalId);
      const state = decision === 'allow_once' ? 'allowed' : 'denied';
      if (approval.state !== 'pending') {
        if (approval.state !== state || expectedRevision !== approval.revision - 1) throw new RuntimeError('REVISION_CONFLICT', 'Approval was already resolved');
        return {accepted: true, approvalState: state};
      }
      if (approval.revision !== expectedRevision) throw new RuntimeError('REVISION_CONFLICT', 'Approval revision mismatch');
      if (this.getTask(approval.taskId).state !== 'waiting_approval') throw new RuntimeError('REVISION_CONFLICT', 'Task is not awaiting approval');
      if (Date.parse(approval.expiresAt) <= this.now().getTime()) throw new RuntimeError('TIMEOUT', 'Approval expired');
      approval.state = state;
      approval.revision++;
      if (state === 'allowed') this.policy.grant({authorizationRef: approvalId, taskId: approval.taskId, toolName: approval.toolName, scopes: approval.scopes, expiresAt: approval.expiresAt, maxUses: 1, argumentsDigest: approval.argumentsDigest});
      this.db.prepare('UPDATE tool_approvals SET value_json = ? WHERE approval_id = ?').run(JSON.stringify(approval), approvalId);
      if (state === 'denied') {
        const evidenceId = approvalId + '-decision';
        const record: ToolExecutionRecord = {evidenceId, inputDigest: createHash('sha256').update(approvalId).digest('hex'), protocolVersion: PROTOCOL_VERSION,
          requestId: approvalId, taskId: approval.taskId, toolName: approval.toolName, toolVersion: 'approval',
          startedAt: this.timestamp(), finishedAt: this.timestamp(), state: 'failed', errorCode: 'SCOPE_DENIED', policyDecision: 'deny', executionStarted: false};
        this.db.prepare('INSERT INTO tool_execution_records (evidence_id, task_id, record_json) VALUES (?, ?, ?)').run(evidenceId, approval.taskId, JSON.stringify(record));
        this.updateTask(approval.taskId, 'cancelled', {evidenceRefs: [...this.getTask(approval.taskId).evidenceRefs, evidenceId]}, true);
      }
      return {accepted: true, approvalState: state};
    });
  }

  private saveToolExecution(record: ToolExecutionRecord, result?: unknown): void {
    this.transaction(() => {
      if (record.state === 'confirmed') this.saveCheckpoint(record.taskId, 'tool-result-' + record.evidenceId, {result: result ?? null});
      this.db.prepare('INSERT INTO tool_execution_records (evidence_id, task_id, record_json) VALUES (?, ?, ?) ON CONFLICT(evidence_id) DO UPDATE SET record_json = excluded.record_json').run(record.evidenceId, record.taskId, JSON.stringify(record));
      const task = taskFromRow(this.taskRow(record.taskId));
      if (!task.evidenceRefs.includes(record.evidenceId)) task.evidenceRefs.push(record.evidenceId);
      task.revision++;
      task.updatedAt = this.timestamp();
      this.writeSnapshot(task);
    });
  }

  async send(input: Request, signal: AbortSignal): Promise<Response> {
    const request = parseRequest(structuredClone(input));
    try {
      if (signal.aborted) throw new RuntimeError('CANCELLED', 'Call was aborted');
      if (Date.parse(request.deadline) <= this.now().getTime()) throw new RuntimeError('TIMEOUT', 'Request deadline expired');
      let data: unknown;
      switch (request.operation) {
        case 'system.handshake':
          if (request.payload.supportedMajor !== 1) throw new RuntimeError('PROTOCOL_MISMATCH', 'Unsupported protocol major');
          data = {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: this.toolGateway ? [...baseCapabilities, 'capability.list', 'tool.invoke', 'authorization.respond'] : baseCapabilities,
            sessionRef: this.sessionRef
          };
          break;
        case 'task.submit': {
          const task = this.submitTask({
            goal: request.payload.goal,
            conversationId: request.payload.conversationId,
            attachmentRefs: request.payload.attachmentRefs ?? [],
            idempotencyKey: request.idempotencyKey
          });
          data = {taskId: task.taskId, state: task.state, revision: task.revision};
          break;
        }
        case 'task.get':
          data = this.getTask(request.payload.taskId);
          break;
        case 'task.list':
          data = this.listTasks(request.payload);
          break;
        case 'conversation.list':
          data = this.listConversations(request.payload);
          break;
        case 'approval.list':
          data = this.listApprovals(request.payload);
          break;
        case 'task.cancel':
          data = this.requestCancel(request.payload.taskId, request.payload.reason);
          break;
        case 'authorization.respond':
          data = this.respondApproval(request.payload.approvalId, request.payload.decision, request.payload.expectedRevision);
          break;
        case 'event.subscribe': {
          if (request.payload.streamId !== 'tasks') throw new RuntimeError('NOT_FOUND', 'Event stream not found');
          const afterSequence = request.payload.afterSequence ?? 0;
          this.readEvents(afterSequence);
          data = {subscriptionId: 'subscription-' + randomUUID(), replayFrom: afterSequence + 1};
          break;
        }
        case 'capability.list': {
          if (!this.toolGateway) throw new RuntimeError('UNSUPPORTED_CAPABILITY', 'Tool gateway is not configured');
          const manifests = request.payload.kind === undefined || request.payload.kind === 'tool'
            ? this.toolGateway.list()
            : [];
          data = {
            manifests,
            health: manifests.map(manifest => ({id: manifest.name, state: 'ready' as const}))
          };
          break;
        }
        case 'tool.invoke': {
          if (!this.toolGateway) throw new RuntimeError('UNSUPPORTED_CAPABILITY', 'Tool gateway is not configured');
          if (!request.taskId) throw new RuntimeError('INVALID_ARGUMENT', 'tool.invoke requires a taskId');
          const task = this.getTask(request.taskId);
          if (task.state !== 'running') {
            throw new RuntimeError('REVISION_CONFLICT', 'Tools can only be invoked for a running task');
          }
          const runId = request.idempotencyKey ?? this.idFactory();
          const inputDigest = toolInputDigest(request.taskId, request.payload);
          const previousRow = this.db.prepare('SELECT record_json FROM tool_execution_records WHERE evidence_id = ?').get(runId);
          if (previousRow) {
            const previous = JSON.parse(previousRow.record_json as string) as ToolExecutionRecord;
            if (previous.inputDigest !== inputDigest) throw new RuntimeError('REVISION_CONFLICT', 'Tool run ID was reused with different input');
            if (previous.state === 'confirmed') {
              const saved = this.loadCheckpoint(request.taskId, 'tool-result-' + runId) as {result: unknown};
              data = {runId, state: 'confirmed', result: saved.result, evidenceRefs: [runId]};
            } else if (previous.state === 'failed') {
              throw new RuntimeError('EXTERNAL_FAILURE', 'Previous tool attempt failed; it will not be repeated automatically');
            } else {
              this.transitionTask(request.taskId, 'waiting_reconciliation');
              data = {runId, state: 'unknown', evidenceRefs: [runId]};
            }
            break;
          }
          const record: ToolExecutionRecord = {
            protocolVersion: PROTOCOL_VERSION, policyDecision: 'not_evaluated', executionStarted: false,
            inputDigest,
            evidenceId: runId, requestId: request.requestId, taskId: request.taskId,
            toolName: request.payload.toolName, toolVersion: request.payload.toolVersion,
            startedAt: this.timestamp(), state: 'started',
          };
          this.saveToolExecution(record);
          const activeIdentity=JSON.stringify([request.taskId,runId]);
          this.activeToolExecutions.set(activeIdentity,inputDigest);
          try {
            const result = await this.toolGateway.invoke({
              toolName: request.payload.toolName,
              toolVersion: request.payload.toolVersion,
              arguments: request.payload.arguments,
              taskId: request.taskId,
              runId,
              authorizationRef: request.payload.scopeRef,
              deadline: request.deadline,
              signal,
              onAuthorized: () => { record.policyDecision = 'allow'; record.executionStarted = true; this.saveToolExecution(record); },
            });
            this.saveToolExecution({...record, state: 'confirmed', finishedAt: this.timestamp()}, result);
            data = {runId, state: 'confirmed', result, evidenceRefs: [runId]};
            this.emit('tool.completed', {runId, state: 'confirmed', evidenceRefs: [runId]}, request.taskId);
          } catch (error) {
            const errorCode = error instanceof ProtocolError ? error.code : 'EXTERNAL_FAILURE';
            if (!record.executionStarted) record.policyDecision = 'deny';
            this.saveToolExecution({...record, state: errorCode === 'RESULT_UNKNOWN' ? 'unknown' : 'failed', errorCode, finishedAt: this.timestamp()});
            if (error instanceof ProtocolError && error.code === 'RESULT_UNKNOWN') {
              this.transitionTask(request.taskId, 'waiting_reconciliation', {
                error: {code: 'RESULT_UNKNOWN', message: error.message, retryable: false}
              });
              data = {runId, state: 'unknown', evidenceRefs: [runId]};
              this.emit('tool.completed', {runId, state: 'unknown', evidenceRefs: [runId]}, request.taskId);
              break;
            }
            throw error;
          } finally {
            this.activeToolExecutions.delete(activeIdentity);
          }
          break;
        }
        default:
          throw new RuntimeError('UNSUPPORTED_CAPABILITY', 'Operation is not configured in this Runtime');
      }
      const response = {
        kind: 'response',
        protocolVersion: PROTOCOL_VERSION,
        requestId: request.requestId,
        outcome: 'ok',
        data,
        evidenceRefs: []
      } as Response;
      return structuredClone(parseResponse(response, request.operation, request.requestId));
    } catch (error) {
      const response = {
        kind: 'response',
        protocolVersion: PROTOCOL_VERSION,
        requestId: request.requestId,
        outcome: 'error',
        error: {
          code: error instanceof RuntimeError || error instanceof ProtocolError ? error.code : 'EXTERNAL_FAILURE',
          message: error instanceof Error ? error.message : 'Runtime request failed',
          retryable: error instanceof ProtocolError ? error.retryable : false,
          ...(error instanceof ProtocolError && error.retryAfterMs !== undefined ? {retryAfterMs: error.retryAfterMs} : {})
        },
        evidenceRefs: []
      } as Response;
      return structuredClone(parseResponse(response, request.operation, request.requestId));
    }
  }

  private emit(type: Event['type'], payload: unknown, taskId?: string): Event {
    const eventId = this.idFactory();
    const occurredAt = this.timestamp();
    const result = this.db.prepare('INSERT INTO task_events (event_id, stream_id, task_id, type, occurred_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)').run(
      eventId,
      'tasks',
      taskId ?? null,
      type,
      occurredAt,
      JSON.stringify(payload)
    );
    const event = parseEvent({
      kind: 'event',
      protocolVersion: '1.0.0',
      eventId,
      streamId: 'tasks',
      sequence: Number(result.lastInsertRowid),
      ...(taskId ? {taskId} : {}),
      type,
      occurredAt,
      payload
    });
    return event;
  }

  private submitInTransaction(input: SubmitTaskInput): TaskSnapshot {
    const normalized = {
      goal: requireText(input.goal, 'goal'),
      conversationId: requireText(input.conversationId, 'conversationId'),
      attachmentRefs: [...(input.attachmentRefs ?? [])]
    };
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey');
    const inputJson = canonical(normalized);
    const previous = this.db.prepare('SELECT input_json, task_id FROM task_idempotency WHERE idempotency_key = ?').get(idempotencyKey) as unknown as {input_json: string; task_id: string} | undefined;
    if (previous) {
      if (previous.input_json !== inputJson) throw new RuntimeError('REVISION_CONFLICT', 'Idempotency key was reused with different input');
      return taskFromRow(this.taskRow(previous.task_id));
    }
    const taskId = this.idFactory();
    const updatedAt = this.timestamp();
    this.db.prepare('INSERT INTO tasks (task_id, goal, conversation_id, attachment_refs_json, state, revision, updated_at, steps_json, evidence_refs_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      taskId,
      normalized.goal,
      normalized.conversationId,
      JSON.stringify(normalized.attachmentRefs),
      'created',
      1,
      updatedAt,
      '[]',
      '[]'
    );
    this.db.prepare('INSERT INTO task_idempotency (idempotency_key, input_json, task_id) VALUES (?, ?, ?)').run(idempotencyKey, inputJson, taskId);
    const task = taskFromRow(this.taskRow(taskId));
    this.emit('task.created', task, taskId);
    return task;
  }

  submitTask(input: SubmitTaskInput): TaskSnapshot {
    return structuredClone(this.transaction(() => this.submitInTransaction(input)));
  }

  /** Trusted host operation: task/idempotency and its launch intent commit together. */
  submitTaskWithCheckpoint(input: SubmitTaskInput, checkpointKey: string, value: unknown): TaskSnapshot {
    const key = requireText(checkpointKey, 'checkpoint key');
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new RuntimeError('INVALID_ARGUMENT', 'Checkpoint must be JSON serializable');
    return structuredClone(this.transaction(() => {
      const task = this.submitInTransaction(input);
      const existing = this.loadCheckpoint(task.taskId, key);
      if (existing !== undefined) {
        if (canonical(existing) !== canonical(JSON.parse(encoded))) {
          throw new RuntimeError('REVISION_CONFLICT', 'Task checkpoint identity conflict');
        }
        return task;
      }
      if (task.state !== 'created') {
        throw new RuntimeError('REVISION_CONFLICT', 'Task checkpoint is missing after execution started');
      }
      this.saveCheckpoint(task.taskId, key, JSON.parse(encoded));
      return task;
    }));
  }

  /** Trusted host read for binding an existing task before checking mutable state. */
  findTaskByIdempotencyKey(idempotencyKey: string): TaskSnapshot | undefined {
    const row = this.db.prepare('SELECT task_id FROM task_idempotency WHERE idempotency_key = ?')
      .get(requireText(idempotencyKey, 'idempotencyKey')) as {task_id: string} | undefined;
    return row ? this.getTask(row.task_id) : undefined;
  }

  /** Compare the persisted request with the exact trusted source invocation. */
  matchesToolExecutionInput(record: ToolExecutionRecord, input: {
    arguments: Record<string, unknown>; scopeRef: string;
  }): boolean {
    return record.inputDigest === toolInputDigest(record.taskId, {
      toolName: record.toolName, toolVersion: record.toolVersion,
      arguments: input.arguments, scopeRef: input.scopeRef,
    });
  }

  /**
   * Atomically projects a trusted host reconciliation into the original run,
   * its Evidence record and the existing task recovery state. This method never
   * creates a second run or changes the authorization/idempotency identity.
   */
  reconcileToolExecution(taskId: string, evidenceId: string,
    outcome: ToolExecutionReconciliationOutcome, result?: unknown, readbackEvidenceRefs:readonly string[]=[],
    options: {deferTaskCompletion?: boolean} = {}): TaskSnapshot {
    requireText(taskId, 'taskId');
    requireText(evidenceId, 'evidenceId');
    if (!['applied', 'not_applied', 'unknown'].includes(outcome)) {
      throw new RuntimeError('INVALID_ARGUMENT', 'Invalid tool reconciliation outcome');
    }
    if (options.deferTaskCompletion && outcome !== 'applied') {
      throw new RuntimeError('INVALID_ARGUMENT', 'Only an applied tool result can resume its worker');
    }
    let encodedResult: string | undefined;
    try { encodedResult = result === undefined ? undefined : JSON.stringify(result); }
    catch { throw new RuntimeError('INVALID_ARGUMENT', 'Tool reconciliation result must be JSON serializable'); }
    if (result !== undefined && encodedResult === undefined) {
      throw new RuntimeError('INVALID_ARGUMENT', 'Tool reconciliation result must be JSON serializable');
    }
    return structuredClone(this.transaction(() => {
      const task = taskFromRow(this.taskRow(taskId));
      const row = this.db.prepare('SELECT record_json FROM tool_execution_records WHERE evidence_id = ? AND task_id = ?')
        .get(evidenceId, taskId) as {record_json?: string} | undefined;
      if (!row?.record_json) throw new RuntimeError('NOT_FOUND', 'Tool execution record not found');
      const record = JSON.parse(row.record_json) as ToolExecutionRecord;
      if (record.taskId !== taskId || record.evidenceId !== evidenceId) {
        throw new RuntimeError('REVISION_CONFLICT', 'Tool execution identity mismatch');
      }
      if (record.reconciliationOutcome !== undefined && record.reconciliationOutcome!=='unknown') {
        if (record.reconciliationOutcome !== outcome) {
          throw new RuntimeError('REVISION_CONFLICT', 'Tool execution was reconciled with a different outcome');
        }
        const previous=this.loadCheckpoint(taskId,'tool-reconciliation-'+evidenceId) as {result?:unknown}|undefined;
        if(result!==undefined && (!previous || canonical(previous.result)!==canonical(result))) {
          throw new RuntimeError('REVISION_CONFLICT','Reconciliation result differs from the original receipt');
        }
        return task;
      }
      if (task.state !== 'waiting_reconciliation') {
        throw new RuntimeError('REVISION_CONFLICT', 'Task is not waiting for reconciliation');
      }
      if (record.state !== 'started' && record.state !== 'unknown') {
        throw new RuntimeError('REVISION_CONFLICT', 'Tool execution is not recoverable');
      }
      // A poll saying unknown is an observation, not an immutable outcome.
      // Keep the original run available for a later verified host readback.
      if (outcome === 'unknown') return task;
      if (!record.executionStarted || record.policyDecision !== 'allow') {
        throw new RuntimeError('UNAUTHORIZED', 'Execution was not authorized');
      }
      const observed=this.readEvidence(taskId);
      if(readbackEvidenceRefs.some(ref=>!observed.some(item=>item.evidenceId===ref && item.kind==='observation' && item.verification==='verified'))) {
        throw new RuntimeError('UNAUTHORIZED','Reconciliation readback Evidence is not bound to this task');
      }
      const reconciledEvidenceRefs=[...new Set([...task.evidenceRefs,evidenceId,...readbackEvidenceRefs])];
      const finishedAt = this.timestamp();
      const nextRecord: ToolExecutionRecord = {
        ...record,
        finishedAt,
        reconciliationOutcome: outcome,
        state: outcome === 'applied' ? 'confirmed' : outcome === 'not_applied' ? 'failed' : 'unknown',
      };
      if (outcome === 'applied') delete nextRecord.errorCode;
      else nextRecord.errorCode = outcome === 'not_applied' ? 'NOT_APPLIED' : 'RESULT_UNKNOWN';
      if (encodedResult !== undefined) {
        this.db.prepare('INSERT INTO task_checkpoints (task_id, checkpoint_key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(task_id, checkpoint_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at').run(
          taskId, 'tool-reconciliation-' + evidenceId, JSON.stringify({result}), finishedAt);
        if (outcome === 'applied') {
          this.db.prepare('INSERT INTO task_checkpoints (task_id, checkpoint_key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(task_id, checkpoint_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at').run(
            taskId, 'tool-result-' + evidenceId, JSON.stringify({result}), finishedAt);
        }
      }
      this.db.prepare('UPDATE tool_execution_records SET record_json = ? WHERE evidence_id = ? AND task_id = ?')
        .run(JSON.stringify(nextRecord), evidenceId, taskId);
      if (outcome === 'applied') {
        if (options.deferTaskCompletion) {
          // The workflow owner must finish result/marker persistence before either
          // continuing or confirming cancellation. A tool write is not task success.
          return this.updateTask(taskId, 'waiting_reconciliation', {
            resultSummary: record.toolName + ' reconciliation confirmed; workflow continuation is pending',
            error: null,
            evidenceRefs: reconciledEvidenceRefs,
          }, false);
        }
        this.updateTask(taskId, 'verifying', {
          resultSummary: record.toolName + ' reconciliation confirmed the original execution',
          error: null,
          evidenceRefs: reconciledEvidenceRefs,
        }, true);
        return this.updateTask(taskId, 'succeeded', {
          resultSummary: record.toolName + ' reconciliation confirmed the original execution',
          error: null,
          evidenceRefs: reconciledEvidenceRefs,
        }, true);
      }
      if (outcome === 'not_applied') {
        if (task.cancelRequested) {
          return this.updateTask(taskId, 'cancelled', {
            error: null,
            evidenceRefs: reconciledEvidenceRefs,
            cancelRequested: true,
          }, true);
        }
        return this.updateTask(taskId, 'failed', {
          error: {code: 'EXTERNAL_FAILURE', message: record.toolName + ' reconciliation found no applied result', retryable: false},
          evidenceRefs: reconciledEvidenceRefs,
        }, true);
      }
      return this.updateTask(taskId, 'waiting_reconciliation', {
        error: {code: 'RESULT_UNKNOWN', message: 'Workspace patch reconciliation could not confirm the result', retryable: false},
        evidenceRefs: task.evidenceRefs.includes(evidenceId) ? task.evidenceRefs : [...task.evidenceRefs, evidenceId],
      }, false);
    }));
  }

  private writeSnapshot(snapshot: TaskSnapshot): void {
    this.db.prepare('UPDATE tasks SET state = ?, revision = ?, updated_at = ?, steps_json = ?, evidence_refs_json = ?, result_summary = ?, error_json = ?, cancel_requested = ? WHERE task_id = ?').run(
      snapshot.state,
      snapshot.revision,
      snapshot.updatedAt,
      JSON.stringify(snapshot.steps),
      JSON.stringify(snapshot.evidenceRefs),
      snapshot.resultSummary ?? null,
      snapshot.error ? JSON.stringify(snapshot.error) : null,
      snapshot.cancelRequested ? 1 : 0,
      snapshot.taskId
    );
  }

  private updateTask(taskId: string, state: TaskState, patch: TransitionPatch, requireTransition: boolean): TaskSnapshot {
    const current = taskFromRow(this.taskRow(taskId));
    if (requireTransition && !allowed[current.state].includes(state)) {
      throw new RuntimeError('REVISION_CONFLICT', 'Illegal task transition from ' + current.state + ' to ' + state);
    }
    const next = structuredClone(current);
    next.state = state;
    next.revision++;
    next.updatedAt = this.timestamp();
    if (patch.resultSummary !== undefined) next.resultSummary = patch.resultSummary;
    if (patch.evidenceRefs !== undefined) next.evidenceRefs = [...patch.evidenceRefs];
    if (patch.error !== undefined) {
      if (patch.error === null) delete next.error;
      else next.error = structuredClone(patch.error);
    }
    if (patch.cancelRequested !== undefined) next.cancelRequested = patch.cancelRequested;
    validateContract('snapshot', next);
    this.writeSnapshot(next);
    this.emit('task.state_changed', next, taskId);
    const terminalType = state === 'succeeded' ? 'task.completed' : state === 'failed' ? 'task.failed' : state === 'cancelled' ? 'task.cancelled' : undefined;
    if (terminalType) this.emit(terminalType, next, taskId);
    return next;
  }

  transitionTask(taskId: string, state: TaskState, patch: TransitionPatch = {}): TaskSnapshot {
    return structuredClone(this.transaction(() => this.updateTask(requireText(taskId, 'taskId'), state, patch, true)));
  }
  /** Read-only exact binding of a durable local failure and its received transport identity. */
  readReceivedCloudFailureBinding(taskId:string,allowHistorical=false):string|undefined {
    const task=this.getTask(taskId),inflight=this.loadCheckpoint(taskId,'competition-cloud-inflight'),received=this.loadCheckpoint(taskId,'competition-cloud-received');
    if(task.state!=='failed' || !task.error || this.active.has(taskId) || this.loadCheckpoint(taskId,'competition-cloud-unknown')
      || !inflight || !received || typeof inflight!=='object' || typeof received!=='object')return undefined;
    const left=inflight as Record<string,unknown>,right=received as Record<string,unknown>;
    const fields=['sessionId','requestId','idempotencyKey','payloadDigest','accepted','serverInstanceId'];
    if(fields.some(key=>left[key]!==right[key]) || Object.keys(left).some(key=>!fields.includes(key)) || Object.keys(right).some(key=>!fields.includes(key))
      || ['sessionId','requestId','idempotencyKey'].some(key=>typeof left[key]!=='string' || !(left[key] as string).length)
      || typeof left.payloadDigest!=='string' || !/^[a-f0-9]{64}$/.test(left.payloadDigest)
      || typeof left.accepted!=='boolean' || (left.serverInstanceId!==undefined && (typeof left.serverInstanceId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(left.serverInstanceId))))return undefined;
    const loop=this.loadCheckpoint(taskId,'competition-loop') as {pending?:unknown}|undefined;
    const marker=this.loadCheckpoint(taskId,'competition-cloud-terminal-error') as {version?:string;kind?:string;receipt?:unknown}|undefined;
    const matchedTerminalMarker=marker?.version==='1.0' && marker.kind==='wss_terminal_error'
      && JSON.stringify(marker.receipt)===JSON.stringify(received);
    if(marker!==undefined && !matchedTerminalMarker || !allowHistorical && !matchedTerminalMarker)return undefined;
    if(loop?.pending!==undefined)return undefined;
    const records=this.readToolExecutions(taskId),caches=records.map(record=>this.loadCheckpoint(taskId,'tool-result-'+record.evidenceId));
    if(records.some((record,index)=>record.state!=='confirmed' || !record.executionStarted || record.policyDecision!=='allow'
      || !caches[index] || typeof caches[index]!=='object' || !Object.hasOwn(caches[index] as object,'result')))return undefined;
    return JSON.stringify({taskRevision:task.revision,error:task.error,inflight,received,loop,records,caches,marker,
      classification:matchedTerminalMarker?'transport_terminal_error':'historical_durable_local_failure'});
  }
  private consumeReceivedCloudFailure(taskId:string,binding:string,allowHistorical=false):void {
    if(this.readReceivedCloudFailureBinding(taskId,allowHistorical)!==binding)throw new RuntimeError('REVISION_CONFLICT','Original received failure binding changed');
    const original=JSON.parse(binding) as {taskRevision:number;error:{code:string};received:unknown;classification:string};
    this.saveCheckpoint(taskId,'competition-cloud-received-failure',{version:'1.0',consumedAs:'durable_local_failure',
      taskRevision:original.taskRevision,errorCode:original.error.code,receipt:original.received,
      classification:original.classification,
      cloudBusinessSuccess:false,cloudResent:false,consumedAt:this.timestamp()});
    this.saveCheckpoint(taskId,'competition-cloud-inflight',null);
    this.saveCheckpoint(taskId,'competition-cloud-received',null);
  }
  /** Trusted host final commit after strict local receipt projection; never resumes work. */
  finishConfirmedSubagentTermination(taskId:string,expectedRevision:number,input:{runId:string;cacheJson:string;recordsJson:string;loopJson:string;
    failureReceipts:{taskId:string;binding:string}[];
    toolSnapshots:{taskId:string;recordsJson:string;caches:{key:string;valueJson:string}[]}[];
    children:{taskId:string;revision:number}[];projectionDigest:string;deadline:string}):TaskSnapshot {
    return structuredClone(this.transaction(()=>{
      const task=this.getTask(taskId),now=this.now().getTime();
      const childIds=this.listTasks({conversationId:`desktop-subtask:${taskId}`,limit:100}).items.map(child=>child.taskId).sort();
      if(task.revision!==expectedRevision || task.state!=='waiting_reconciliation'
        || JSON.stringify(childIds)!==JSON.stringify(input.children.map(child=>child.taskId).sort())
        || this.active.has(taskId)
        || !this.loadCheckpoint(taskId,'competition-export-withheld')
        || this.loadCheckpoint(taskId,'competition-cloud-inflight') || this.loadCheckpoint(taskId,'competition-cloud-unknown')
        || JSON.stringify(this.loadCheckpoint(taskId,'tool-result-'+input.runId))!==input.cacheJson
        || JSON.stringify(this.readToolExecutions(taskId))!==input.recordsJson
        || JSON.stringify(this.loadCheckpoint(taskId,'competition-loop'))!==input.loopJson
        || input.toolSnapshots.some(snapshot=>this.active.has(snapshot.taskId)
          || (this.loadCheckpoint(snapshot.taskId,'competition-cloud-inflight') && !input.failureReceipts.some(item=>item.taskId===snapshot.taskId))
          || this.loadCheckpoint(snapshot.taskId,'competition-cloud-unknown')
          || JSON.stringify(this.readToolExecutions(snapshot.taskId))!==snapshot.recordsJson
          || snapshot.caches.some(cache=>JSON.stringify(this.loadCheckpoint(snapshot.taskId,cache.key))!==cache.valueJson))
        || this.loadCheckpoint(taskId,'application-deadline')!==input.deadline
        || (!task.cancelRequested && now<Date.parse(input.deadline))
        || input.children.some(child=>{const current=this.getTask(child.taskId);return this.active.has(child.taskId) || current.revision!==child.revision
          || !['succeeded','failed','cancelled'].includes(current.state);}))
        throw new RuntimeError('REVISION_CONFLICT','Original confirmed termination binding changed');
      if(input.failureReceipts.some(item=>!input.children.some(child=>child.taskId===item.taskId)
        || this.readReceivedCloudFailureBinding(item.taskId,true)!==item.binding))throw new RuntimeError('REVISION_CONFLICT','Original child received failure changed');
      for(const item of input.failureReceipts)this.consumeReceivedCloudFailure(item.taskId,item.binding,true);
      const cancelled=task.cancelRequested===true;
      this.saveCheckpoint(taskId,'subagent-terminal-reconciliation',{version:'1.0',runId:input.runId,
        projectionDigest:input.projectionDigest,childTaskIds:input.children.map(child=>child.taskId),
        scope:'local_confirmed_receipt_projection',cloudResent:false,toolReexecuted:false,
        terminal:cancelled?'cancelled':'failed',reconciledAt:new Date(now).toISOString()});
      return this.updateTask(taskId,cancelled?'cancelled':'failed',cancelled?{error:null,cancelRequested:true}:
        {error:{code:'TIMEOUT',message:'Original task deadline expired after confirmed subagent receipt reconciliation',retryable:false}},true);
    }));
  }

  recordProgress(taskId: string, progress: ProgressInput): TaskSnapshot {
    requireText(progress.stepId, 'stepId');
    requireText(progress.label, 'label');
    if (progress.completedUnits !== undefined && (!Number.isFinite(progress.completedUnits) || progress.completedUnits < 0)) {
      throw new RuntimeError('INVALID_ARGUMENT', 'completedUnits must be non-negative');
    }
    if (progress.totalUnits !== undefined && (!Number.isFinite(progress.totalUnits) || progress.totalUnits < 0)) {
      throw new RuntimeError('INVALID_ARGUMENT', 'totalUnits must be non-negative');
    }
    return structuredClone(this.transaction(() => {
      const task = taskFromRow(this.taskRow(taskId));
      if (terminal.has(task.state)) throw new RuntimeError('REVISION_CONFLICT', 'Terminal task cannot report progress');
      const step = task.steps.find(item => item.stepId === progress.stepId);
      const state = progress.totalUnits !== undefined && progress.completedUnits === progress.totalUnits ? 'completed' : 'running';
      if (step) {
        step.label = progress.label;
        step.state = state;
      } else {
        task.steps.push({stepId: progress.stepId, label: progress.label, state});
      }
      task.revision++;
      task.updatedAt = this.timestamp();
      this.writeSnapshot(task);
      const payload: ProgressInput = {stepId: progress.stepId, label: progress.label};
      if (progress.completedUnits !== undefined) payload.completedUnits = progress.completedUnits;
      if (progress.totalUnits !== undefined) payload.totalUnits = progress.totalUnits;
      this.emit('task.progress', payload, taskId);
      return task;
    }));
  }

  saveCheckpoint(taskId: string, key: string, value: unknown): void {
    requireText(key, 'checkpoint key');
    this.getTask(taskId);
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new RuntimeError('INVALID_ARGUMENT', 'Checkpoint must be JSON serializable');
    this.db.prepare('INSERT INTO task_checkpoints (task_id, checkpoint_key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(task_id, checkpoint_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at').run(
      taskId,
      key,
      encoded,
      this.timestamp()
    );
  }

  /** Atomic create-only checkpoint for irreversible host attempts. Never replaces a run identity. */
  saveCheckpointOnce(taskId: string, key: string, value: unknown): boolean {
    requireText(key, 'checkpoint key');
    this.getTask(taskId);
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new RuntimeError('INVALID_ARGUMENT', 'Checkpoint must be JSON serializable');
    const result = this.db.prepare('INSERT INTO task_checkpoints (task_id, checkpoint_key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(task_id, checkpoint_key) DO NOTHING').run(
      taskId, key, encoded, this.timestamp()
    );
    return result.changes === 1;
  }

  /** Freeze a trusted host intent only while its prepared task is still at the observed revision. */
  saveCheckpointOnceForCreatedTask(taskId: string, key: string, value: unknown,
    expectedRevision: number): boolean {
    requireText(key, 'checkpoint key');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new RuntimeError('INVALID_ARGUMENT', 'Invalid expected task revision');
    }
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new RuntimeError('INVALID_ARGUMENT', 'Checkpoint must be JSON serializable');
    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (task.state !== 'created' || task.revision !== expectedRevision) {
        throw new RuntimeError('REVISION_CONFLICT', 'Prepared host task changed before finalization');
      }
      const result = this.db.prepare('INSERT INTO task_checkpoints (task_id, checkpoint_key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(task_id, checkpoint_key) DO NOTHING').run(
        taskId, key, encoded, this.timestamp()
      );
      return result.changes === 1;
    });
  }

  /** Cancel a prepared task only if no intent was frozen at the observed revision. */
  cancelCreatedTaskWithoutCheckpoint(taskId: string, absentKey: string,
    expectedRevision: number): TaskSnapshot {
    requireText(absentKey, 'checkpoint key');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new RuntimeError('INVALID_ARGUMENT', 'Invalid expected task revision');
    }
    return structuredClone(this.transaction(() => {
      const task = this.getTask(taskId);
      if (this.loadCheckpoint(taskId, absentKey) !== undefined) {
        throw new RuntimeError('REVISION_CONFLICT', 'Prepared host task intent was already finalized');
      }
      if (task.state === 'cancelled') return task;
      if (task.state !== 'created' || task.revision !== expectedRevision) {
        throw new RuntimeError('REVISION_CONFLICT', 'Prepared host task changed before cancellation');
      }
      this.updateTask(taskId, 'cancelling', {cancelRequested: true}, true);
      return this.updateTask(taskId, 'cancelled', {cancelRequested: true}, true);
    }));
  }

  loadCheckpoint(taskId: string, key: string): unknown {
    const row = this.db.prepare('SELECT value_json FROM task_checkpoints WHERE task_id = ? AND checkpoint_key = ?').get(taskId, requireText(key, 'checkpoint key')) as unknown as {value_json: string} | undefined;
    return row ? structuredClone(JSON.parse(row.value_json)) : undefined;
  }

  requestCancel(taskId: string, _reason?: string): {taskId: string; state: TaskState; cancelAccepted: boolean} {
    const wasWaitingApproval = this.getTask(taskId).state === 'waiting_approval';
    const result = this.transaction(() => {
      const task = taskFromRow(this.taskRow(taskId));
      if (terminal.has(task.state)) return {taskId, state: task.state, cancelAccepted: false};
      if (task.cancelRequested) return {taskId, state: task.state, cancelAccepted: true};
      const next = task.state === 'waiting_reconciliation'
        ? this.updateTask(taskId, task.state, {cancelRequested: true}, false)
        : this.updateTask(taskId, 'cancelling', {cancelRequested: true}, true);
      return {taskId, state: next.state, cancelAccepted: true};
    });
    this.active.get(taskId)?.abort();
    if (wasWaitingApproval && !this.active.has(taskId) && result.state === 'cancelling') {
      return {taskId, state: this.confirmCancellation(taskId).state, cancelAccepted: true};
    }
    return result;
  }

  confirmCancellation(taskId: string): TaskSnapshot {
    return this.transitionTask(taskId, 'cancelled', {cancelRequested: true});
  }

  async runTask(taskId: string, worker: (context: WorkerContext) => Promise<WorkerResult>, options: RunOptions): Promise<TaskSnapshot> {
    const deadlineMs = parseTime(options.deadline, 'deadline');
    const initial = this.getTask(taskId);
    if ((initial.state !== 'created' && !(options.resume && initial.state === 'waiting_approval')) || this.active.has(taskId)) {
      throw new RuntimeError('REVISION_CONFLICT', 'Task is not ready to start');
    }
    const controller = new AbortController();
    this.active.set(taskId, controller);
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    try {
      if (initial.state === 'created') this.transitionTask(taskId, 'planning');
      this.transitionTask(taskId, 'running');
      const remaining = deadlineMs - this.now().getTime();
      if (remaining <= 0) {
        timedOut = true;
        controller.abort();
        throw new DeadlineExceeded();
      }
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new DeadlineExceeded());
        }, remaining);
      });
      const result = await Promise.race([
        worker({
          taskId,
          deadline: options.deadline,
          signal: controller.signal,
          saveCheckpoint: (key, value) => this.saveCheckpoint(taskId, key, value),
          loadCheckpoint: key => this.loadCheckpoint(taskId, key),
          reportProgress: progress => this.recordProgress(taskId, progress)
        }),
        timeout
      ]);
      const current = this.getTask(taskId);
      if (current.state === 'cancelling') return this.confirmCancellation(taskId);
      if (current.state === 'waiting_reconciliation' || current.state === 'waiting_approval' || terminal.has(current.state)) return current;
      this.transitionTask(taskId, 'verifying');
      return this.transitionTask(taskId, 'succeeded', {
        resultSummary: result.resultSummary,
        evidenceRefs: [...new Set([...current.evidenceRefs, ...(result.evidenceRefs ?? [])])]
      });
    } catch (error) {
      const current = this.getTask(taskId);
      if (terminal.has(current.state)) return current;
      if (current.state === 'waiting_reconciliation') return current;
      if (timedOut) {
        if (options.sideEffect !== 'read') {
          return this.transitionTask(taskId, 'waiting_reconciliation', {
            error: {code: 'RESULT_UNKNOWN', message: `${options.sideEffect === 'local_write' ? 'Local' : 'External'} write exceeded its deadline; verify before retrying`, retryable: false}
          });
        }
        return this.transitionTask(taskId, 'failed', {
          error: {code: 'TIMEOUT', message: 'Task exceeded its deadline', retryable: false}
        });
      }
      if (controller.signal.aborted && current.state === 'cancelling') return this.confirmCancellation(taskId);
      const failure: TaskError = {
        code: error instanceof RuntimeError || error instanceof ProtocolError ? error.code as TaskError['code'] : 'EXTERNAL_FAILURE',
        message: error instanceof Error && error.message ? error.message : 'Task worker failed',
        retryable: false
      };
      // Module errors may use internal codes absent from the public task contract.
      // Validate before transitioning so a rejected error code cannot strand the task.
      try { validateContract('snapshot', {...current, error: failure}); }
      catch { failure.code = 'EXTERNAL_FAILURE'; }
      return this.transitionTask(taskId, 'failed', {
        error: failure
      });
    } finally {
      if (timer) clearTimeout(timer);
      this.active.delete(taskId);
      // A durable local failure consumes a matched received response as failure,
      // never as cloud business success. Unknown/unconfirmed writes retain holds.
      try {
        const binding=this.readReceivedCloudFailureBinding(taskId);
        if(binding!==undefined)this.transaction(()=>this.consumeReceivedCloudFailure(taskId,binding));
      } catch { /* Failure to prove consumption must preserve the original hold. */ }
    }
  }

  recoverInterruptedTasks(): TaskSnapshot[] {
    const placeholders = interrupted.map(() => '?').join(', ');
    const rows = this.db.prepare('SELECT task_id FROM tasks WHERE state IN (' + placeholders + ') ORDER BY task_id').all(...interrupted) as unknown as {task_id: string}[];
    return rows.map(row => this.transitionTask(row.task_id, 'waiting_reconciliation', {
      error: {code: 'RESULT_UNKNOWN', message: 'Runtime stopped before the task result was confirmed', retryable: false}
    }));
  }

  reconcileTask(taskId: string, outcome: 'confirmed' | 'not_performed'): TaskSnapshot {
    const task = this.getTask(taskId);
    if (task.state !== 'waiting_reconciliation') throw new RuntimeError('REVISION_CONFLICT', 'Task is not waiting for reconciliation');
    if (outcome === 'confirmed') {
      const records=this.readToolExecutions(taskId);
      if(!records.length || records.some(record=>record.state!=='confirmed' || !record.executionStarted || record.policyDecision!=='allow'
        || this.loadCheckpoint(taskId,'tool-result-'+record.evidenceId)===undefined)) {
        throw new RuntimeError('UNAUTHORIZED','Recovery requires the original confirmed execution Evidence');
      }
      this.transitionTask(taskId, 'verifying');
      return this.transitionTask(taskId, 'succeeded', {resultSummary: 'Reconciliation confirmed the original execution',evidenceRefs:records.map(record=>record.evidenceId)});
    }
    if(this.readToolExecutions(taskId).some(record=>record.state==='started'||record.state==='unknown')) {
      throw new RuntimeError('UNAUTHORIZED','Unknown execution requires a bound host readback');
    }
    if (task.cancelRequested) return this.transitionTask(taskId, 'cancelled', {cancelRequested: true});
    return this.transitionTask(taskId, 'failed', {
      error: {code: 'EXTERNAL_FAILURE', message: 'Reconciliation found no completed result', retryable: false}
    });
  }

  /** Reopen only a verified original continuation, including settled failed reads. No execution or grant. */
  prepareVerifiedContinuation(taskId: string, expectedRevision: number): TaskSnapshot {
    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (!Number.isSafeInteger(expectedRevision) || task.revision !== expectedRevision || task.state !== 'waiting_reconciliation'
        || this.active.has(taskId)) throw new RuntimeError('REVISION_CONFLICT', 'Original task continuation revision or active worker differs');
      if (task.cancelRequested || this.loadCheckpoint(taskId, 'private-copy-erasure')) throw new RuntimeError('UNAUTHORIZED', 'Cancelled or withheld task cannot resume');
      const deadline = this.loadCheckpoint(taskId, 'application-deadline');
      if (typeof deadline !== 'string' || !Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= this.now().getTime())
        throw new RuntimeError('TIMEOUT', 'Original task deadline cannot be extended for continuation');
      const descriptors = this.toolGateway?.list() ?? [];
      const unsettled = this.readToolExecutions(taskId).some(record => {
        if (!record.executionStarted || record.policyDecision !== 'allow' || record.reconciliationOutcome === 'unknown') return true;
        if (record.state === 'confirmed') return !Object.hasOwn(this.loadCheckpoint(taskId, 'tool-result-' + record.evidenceId) as object ?? {}, 'result');
        if (record.state !== 'failed' || !record.finishedAt || !record.errorCode
          || ['TIMEOUT', 'CANCELLED', 'RESULT_UNKNOWN', 'NOT_CONFIRMED'].includes(record.errorCode.toUpperCase())
          || !Number.isFinite(Date.parse(record.startedAt)) || !Number.isFinite(Date.parse(record.finishedAt))
          || Date.parse(record.finishedAt) < Date.parse(record.startedAt) || Date.parse(record.finishedAt) > this.now().getTime()) return true;
        // Historical records have no independent sideEffect field. Require the trusted current exact-version
        // read descriptor; absence or drift cannot turn a failed/uncertain write into a resumable read.
        return !descriptors.some(descriptor => descriptor.name === record.toolName && descriptor.version === record.toolVersion
          && descriptor.sideEffect === 'read');
      });
      if (this.loadCheckpoint(taskId, 'competition-cloud-unknown') || this.loadCheckpoint(taskId, 'competition-cloud-inflight') || unsettled)
        throw new RuntimeError('UNAUTHORIZED', 'Continuation requires original confirmed execution Evidence or a settled authorized read failure');
      return this.updateTask(taskId, 'waiting_approval', {error: null}, false);
    });
  }

  prepareConfirmedReplay(taskId:string,input:{runId:string;toolName:string;toolVersion:string;arguments:Record<string,unknown>}):TaskSnapshot {
    return this.transaction(()=> {
      const task=this.getTask(taskId),record=this.readToolExecutions(taskId).find(item=>item.evidenceId===input.runId);
      if(task.state!=='waiting_reconciliation' || task.cancelRequested || this.loadCheckpoint(taskId,'private-copy-erasure')
        || !record || record.state!=='confirmed' || !record.executionStarted || record.policyDecision!=='allow'
        || record.toolName!==input.toolName || record.toolVersion!==input.toolVersion
        || !this.matchesToolExecutionInput(record,{arguments:input.arguments,scopeRef:input.runId})
        || this.loadCheckpoint(taskId,'tool-result-'+input.runId)===undefined
        || this.readToolExecutions(taskId).some(item=>item.state==='started'||item.state==='unknown')) {
        throw new RuntimeError('UNAUTHORIZED','Only an original confirmed receipt can resume its worker');
      }
      this.saveCheckpoint(taskId,'competition-confirmed-replay',{runId:record.evidenceId,inputDigest:record.inputDigest});
      return this.updateTask(taskId,'waiting_approval',{error:null},false);
    });
  }

  readEvents(afterSequence = 0): Event[] {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new RuntimeError('INVALID_ARGUMENT', 'Invalid event cursor');
    const last = this.db.prepare('SELECT max(sequence) AS value FROM task_events').get() as unknown as {value: number | null};
    if (afterSequence > (last.value ?? 0)) throw new RuntimeError('INVALID_ARGUMENT', 'Event cursor is ahead of the stream');
    const rows = this.db.prepare('SELECT sequence, event_id, stream_id, task_id, type, occurred_at, payload_json FROM task_events WHERE stream_id = ? AND sequence > ? ORDER BY sequence').all('tasks', afterSequence) as unknown as EventRow[];
    return rows.map(row => parseEvent({
      kind: 'event',
      protocolVersion: '1.0.0',
      eventId: row.event_id,
      streamId: row.stream_id,
      sequence: row.sequence,
      ...(row.task_id ? {taskId: row.task_id} : {}),
      type: row.type,
      occurredAt: row.occurred_at,
      payload: row.task_id && this.loadCheckpoint(row.task_id,'private-copy-erasure')!==undefined
        ?this.redactEventBody(row.type,JSON.parse(row.payload_json)):JSON.parse(row.payload_json)
    }));
  }

  private validateScheduleInput(input: ScheduleInput): void {
    requireText(input.scheduleId, 'scheduleId');
    requireText(input.goal, 'goal');
    requireText(input.conversationId, 'conversationId');
    requireText(input.taskIdempotencyKey, 'taskIdempotencyKey');
    parseTime(input.runAt, 'runAt');
    try {
      new Intl.DateTimeFormat('en', {timeZone: input.timeZone}).format(this.now());
    } catch {
      throw new RuntimeError('INVALID_ARGUMENT', 'timeZone must be a supported IANA zone');
    }
    if (!['run_once', 'skip'].includes(input.missedRunPolicy)) {
      throw new RuntimeError('INVALID_ARGUMENT', 'Unknown missed run policy');
    }
  }

  createSchedule(input: ScheduleInput): ScheduleSnapshot {
    this.validateScheduleInput(input);
    const previous = this.db.prepare('SELECT schedule_id, goal, conversation_id, run_at, time_zone, missed_run_policy, task_idempotency_key, status, task_id FROM task_schedules WHERE schedule_id = ?').get(input.scheduleId) as unknown as ScheduleRow | undefined;
    if (previous) {
      const current = scheduleFromRow(previous);
      const comparable: ScheduleInput = {
        scheduleId: current.scheduleId,
        goal: current.goal,
        conversationId: current.conversationId,
        runAt: current.runAt,
        timeZone: current.timeZone,
        missedRunPolicy: current.missedRunPolicy,
        taskIdempotencyKey: current.taskIdempotencyKey
      };
      if (canonical(comparable) !== canonical(input)) throw new RuntimeError('REVISION_CONFLICT', 'Schedule ID was reused with different input');
      return structuredClone(current);
    }
    this.db.prepare('INSERT INTO task_schedules (schedule_id, goal, conversation_id, run_at, time_zone, missed_run_policy, task_idempotency_key, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      input.scheduleId,
      input.goal,
      input.conversationId,
      input.runAt,
      input.timeZone,
      input.missedRunPolicy,
      input.taskIdempotencyKey,
      'pending'
    );
    return this.getSchedule(input.scheduleId);
  }

  getSchedule(scheduleId: string): ScheduleSnapshot {
    const row = this.db.prepare('SELECT schedule_id, goal, conversation_id, run_at, time_zone, missed_run_policy, task_idempotency_key, status, task_id FROM task_schedules WHERE schedule_id = ?').get(requireText(scheduleId, 'scheduleId')) as unknown as ScheduleRow | undefined;
    if (!row) throw new RuntimeError('NOT_FOUND', 'Schedule not found');
    return structuredClone(scheduleFromRow(row));
  }

  listSchedules(conversationId: string): ScheduleSnapshot[] {
    const rows = this.db.prepare('SELECT schedule_id, goal, conversation_id, run_at, time_zone, missed_run_policy, task_idempotency_key, status, task_id FROM task_schedules WHERE conversation_id = ? ORDER BY run_at, schedule_id')
      .all(requireText(conversationId, 'conversationId')) as unknown as ScheduleRow[];
    return rows.map(scheduleFromRow);
  }

  /** Reconcile an exclusively owned reminder conversation, not arbitrary user tasks.
   * Called after the authorized source mutation and before any scheduling tick. A restart
   * must reconstruct this set from that source before recovering overdue reminders. */
  reconcileSchedules(conversationId: string, desired: readonly ScheduleInput[]): ScheduleSnapshot[] {
    requireText(conversationId, 'conversationId');
    const inputs = new Map<string, ScheduleInput>();
    for (const input of desired) {
      this.validateScheduleInput(input);
      if (input.conversationId !== conversationId || inputs.has(input.scheduleId)) {
        throw new RuntimeError('INVALID_ARGUMENT', 'Reminder conversation or schedule identity is inconsistent');
      }
      inputs.set(input.scheduleId, structuredClone(input));
    }
    return this.transaction(() => {
      const previous = this.listSchedules(conversationId);
      for (const input of inputs.values()) {
        const row = this.db.prepare('SELECT schedule_id, goal, conversation_id, run_at, time_zone, missed_run_policy, task_idempotency_key, status, task_id FROM task_schedules WHERE schedule_id = ?')
          .get(input.scheduleId) as unknown as ScheduleRow | undefined;
        if (!row) { this.createSchedule(input); continue; }
        if (row.conversation_id !== conversationId || row.task_idempotency_key !== input.taskIdempotencyKey) {
          throw new RuntimeError('REVISION_CONFLICT', 'Schedule identity belongs to a different source');
        }
        // An already dispatched reminder is immutable and must never be fired again.
        if (row.status === 'fired' || row.status === 'skipped') continue;
        this.db.prepare('UPDATE task_schedules SET goal = ?, run_at = ?, time_zone = ?, missed_run_policy = ?, status = ? WHERE schedule_id = ?')
          .run(input.goal, input.runAt, input.timeZone, input.missedRunPolicy, 'pending', input.scheduleId);
      }
      for (const row of previous) {
        if (row.status === 'pending' && !inputs.has(row.scheduleId)) {
          this.db.prepare('UPDATE task_schedules SET status = ? WHERE schedule_id = ?').run('cancelled', row.scheduleId);
        }
      }
      return this.listSchedules(conversationId);
    });
  }

  private processDue(recovery: boolean, conversationId?: string): ScheduleDispatch[] {
    const now = this.timestamp();
    if (conversationId !== undefined) requireText(conversationId, 'conversationId');
    const rows = (conversationId === undefined
      ? this.db.prepare('SELECT schedule_id FROM task_schedules WHERE status = ? AND run_at <= ? ORDER BY run_at, schedule_id').all('pending', now)
      : this.db.prepare('SELECT schedule_id FROM task_schedules WHERE status = ? AND run_at <= ? AND conversation_id = ? ORDER BY run_at, schedule_id').all('pending', now, conversationId)) as unknown as {schedule_id: string}[];
    const dispatches = rows.map(({schedule_id}) => this.transaction(() => {
      const schedule = this.getSchedule(schedule_id);
      if (schedule.status !== 'pending' || Date.parse(schedule.runAt) > Date.parse(now)) return undefined;
      if (recovery && schedule.missedRunPolicy === 'skip') {
        this.db.prepare('UPDATE task_schedules SET status = ? WHERE schedule_id = ?').run('skipped', schedule.scheduleId);
        return {scheduleId: schedule.scheduleId, status: 'skipped'} as const;
      }
      const task = this.submitInTransaction({
        goal: schedule.goal,
        conversationId: schedule.conversationId,
        idempotencyKey: schedule.taskIdempotencyKey
      });
      this.db.prepare('UPDATE task_schedules SET status = ?, task_id = ? WHERE schedule_id = ?').run('fired', task.taskId, schedule.scheduleId);
      return {scheduleId: schedule.scheduleId, status: 'fired', task} as const;
    }));
    return dispatches.filter(dispatch => dispatch !== undefined);
  }

  dispatchDueSchedules(conversationId?: string): ScheduleDispatch[] {
    return structuredClone(this.processDue(false, conversationId));
  }

  recoverMissedSchedules(conversationId?: string): ScheduleDispatch[] {
    return structuredClone(this.processDue(true, conversationId));
  }
}
