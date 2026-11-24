/** Persisted worker identities. Builtins stay in @personal-agent/agentarts; user rows live in TaskRuntime SQLite. */

import type {WorkerDriverPreference, WorkerRole, WorkerView} from '@personal-agent/agentarts';
import {DEFAULT_WORKERS} from '@personal-agent/agentarts';

export const WORKER_NAME_REQUIRED = '请填写工人名字';
export const WORKER_INSTRUCTIONS_REQUIRED = '请填写这个工人负责什么';
export const WORKER_ROLE_INVALID = '工人角色无效';
export const WORKER_DRIVER_INVALID = '工人驱动无效';
export const WORKER_LIMIT_REACHED = '自定义工人已经达到上限';
export const WORKER_BUILTIN_LOCKED = '内置工人不能改名或删除';
export const WORKER_BUSY = '这个工人还在工作，先停止再删除';
export const WORKER_NOT_FOUND = '找不到这个工人';
export const MAX_USER_WORKERS = 24;

const ROLES = new Set<WorkerRole>(['researcher', 'coder', 'reviewer', 'planner', 'coordinator']);
const DRIVERS = new Set<WorkerDriverPreference>([
  'agentarts', 'codex', 'claude', 'opencode', 'grok', 'gemini', 'acp-generic',
]);

export interface WorkerRecord {
  workerId: string;
  displayName: string;
  role: WorkerRole;
  instructions: string;
  preferredDriver: WorkerDriverPreference;
  kind: 'builtin' | 'user';
  status: 'idle' | 'working' | 'waiting_approval';
  activeTaskId?: string;
  lastSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export function workerDisplayName(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 40) throw new Error(WORKER_NAME_REQUIRED);
  return text;
}

export function workerInstructions(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 500) throw new Error(WORKER_INSTRUCTIONS_REQUIRED);
  return text;
}

export function workerRole(value: unknown): WorkerRole {
  if (typeof value !== 'string' || !ROLES.has(value as WorkerRole)) throw new Error(WORKER_ROLE_INVALID);
  return value as WorkerRole;
}

export function workerDriver(value: unknown): WorkerDriverPreference {
  if (value === undefined || value === null || value === '') return 'agentarts';
  if (typeof value !== 'string' || !DRIVERS.has(value as WorkerDriverPreference)) throw new Error(WORKER_DRIVER_INVALID);
  return value as WorkerDriverPreference;
}

export function workerFromRow(row: Record<string, unknown>): WorkerRecord {
  return {
    workerId: String(row.worker_id),
    displayName: String(row.display_name),
    role: String(row.role) as WorkerRole,
    instructions: String(row.instructions),
    preferredDriver: String(row.preferred_driver) as WorkerDriverPreference,
    kind: row.kind === 'user' ? 'user' : 'builtin',
    status: row.status as WorkerRecord['status'],
    ...(row.active_task_id ? {activeTaskId: String(row.active_task_id)} : {}),
    ...(row.last_summary ? {lastSummary: String(row.last_summary)} : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function workerRecordToView(record: WorkerRecord, live?: Partial<Pick<WorkerView, 'status' | 'activeTaskId' | 'parentTaskId' | 'lastSummary' | 'updatedAt'>>): WorkerView {
  return {
    workerId: record.workerId,
    displayName: record.displayName,
    role: record.role,
    kind: record.kind,
    preferredDriver: record.preferredDriver,
    instructions: record.instructions,
    status: live?.status ?? record.status,
    ...(live?.activeTaskId ?? record.activeTaskId ? {activeTaskId: live?.activeTaskId ?? record.activeTaskId} : {}),
    ...(live?.parentTaskId ? {parentTaskId: live.parentTaskId} : {}),
    ...(live?.lastSummary ?? record.lastSummary ? {lastSummary: live?.lastSummary ?? record.lastSummary} : {}),
    updatedAt: live?.updatedAt ?? record.updatedAt,
  };
}

/** Seed builtin rows once; never overwrite user customizations on the same id. */
export function builtinWorkerSeedRows(now: string): readonly Omit<WorkerRecord, 'status' | 'activeTaskId' | 'lastSummary'>[] {
  return DEFAULT_WORKERS.map(worker => ({
    workerId: worker.workerId,
    displayName: worker.displayName,
    role: worker.role,
    instructions: worker.instructions,
    preferredDriver: worker.preferredDriver,
    kind: 'builtin' as const,
    createdAt: now,
    updatedAt: now,
  }));
}
