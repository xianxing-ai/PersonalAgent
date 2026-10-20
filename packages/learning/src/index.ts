import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {openStorage, type Migration} from '@personal-agent/storage';
export * from './evidence-validator.js';
export * from './developer-experience.js';

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MIGRATIONS: readonly Migration[] = [{version: 1, sql: `
  CREATE TABLE learning_versions (
    namespace TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    operation_id TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL,
    candidate_json TEXT NOT NULL,
    validation TEXT NOT NULL CHECK (validation IN ('candidate', 'passed', 'failed')),
    evidence_ref TEXT,
    PRIMARY KEY (namespace, workflow_id, revision)
  ) STRICT;
  CREATE TABLE learning_activations (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    namespace TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    operation_id TEXT NOT NULL UNIQUE,
    from_revision INTEGER,
    to_revision INTEGER NOT NULL,
    activated_at TEXT NOT NULL,
    FOREIGN KEY (namespace, workflow_id, to_revision)
      REFERENCES learning_versions(namespace, workflow_id, revision)
  ) STRICT;
  CREATE INDEX learning_activations_current_idx
    ON learning_activations(namespace, workflow_id, sequence DESC);
`}, {version: 2, sql: `
  CREATE TABLE learning_erasures (
    namespace TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    operation_id TEXT NOT NULL UNIQUE,
    expected_revision INTEGER NOT NULL CHECK (expected_revision >= 1),
    PRIMARY KEY (namespace, workflow_id)
  ) STRICT;
`}, {version: 3, sql: `
  CREATE TABLE learning_stops (
    namespace TEXT NOT NULL, workflow_id TEXT NOT NULL,
    operation_id TEXT NOT NULL UNIQUE, expected_revision INTEGER,
    through_sequence INTEGER NOT NULL, stopped_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX learning_stops_current_idx ON learning_stops(namespace, workflow_id, through_sequence DESC);
  CREATE TABLE learning_invalidated_sources (
    namespace TEXT NOT NULL, source_ref TEXT NOT NULL,
    operation_id TEXT NOT NULL UNIQUE, invalidated_at TEXT NOT NULL,
    PRIMARY KEY (namespace, source_ref)
  ) STRICT;
`}];

export type LearningErrorCode = 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'REVISION_CONFLICT'
  | 'NOT_VALIDATED' | 'STORAGE_UNAVAILABLE' | 'TIMEOUT' | 'CANCELLED';

export class LearningError extends Error {
  constructor(readonly code: LearningErrorCode) {
    super(`Learning operation failed: ${code}`);
    this.name = 'LearningError';
  }
}

export interface LearningContext {
  readonly deadline: string;
  readonly signal: AbortSignal;
}

export interface WorkflowCandidate {
  readonly namespace: string;
  readonly workflowId: string;
  readonly revision: number;
  readonly summary: string;
  readonly steps: readonly string[];
  readonly sourceRef: string;
  readonly createdAt: string;
}

export interface WorkflowVersion extends WorkflowCandidate {
  readonly validation: 'candidate' | 'passed' | 'failed';
  readonly evidenceRef?: string;
}

export interface ProposeWorkflowRequest extends LearningContext {
  readonly namespace: string;
  readonly workflowId: string;
  readonly expectedRevision: number | null;
  readonly operationId: string;
  readonly summary: string;
  readonly steps: readonly string[];
  readonly sourceRef: string;
  readonly createdAt: string;
}

export interface ValidationResult {
  readonly passed: boolean;
  readonly evidenceRef: string;
}

export interface WorkflowValidatorPort {
  validate(candidate: WorkflowCandidate, context: LearningContext): Promise<ValidationResult>;
}

export interface ActivationReceipt {
  readonly sequence: number;
  readonly operationId: string;
  readonly fromRevision: number | null;
  readonly toRevision: number;
  readonly activatedAt: string;
}

export interface ActivateWorkflowRequest extends LearningContext {
  readonly namespace: string;
  readonly workflowId: string;
  readonly revision: number;
  readonly expectedActiveRevision: number | null;
  readonly operationId: string;
  readonly activatedAt: string;
}

export interface EraseWorkflowRequest extends LearningContext {
  readonly namespace: string;
  readonly workflowId: string;
  readonly expectedRevision: number;
  readonly operationId: string;
}

export interface StopWorkflowRequest extends LearningContext {
  readonly namespace: string;
  readonly workflowId: string;
  readonly expectedActiveRevision: number | null;
  readonly operationId: string;
  readonly stoppedAt: string;
}

export interface InvalidateWorkflowSourceRequest extends LearningContext {
  readonly namespace: string;
  /** Exact source binding used by propose; never a model-generated removal instruction. */
  readonly sourceRef: string;
  readonly operationId: string;
  readonly invalidatedAt: string;
}

type Row = Record<string, unknown>;

function fail(code: LearningErrorCode): never { throw new LearningError(code); }

function label(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return fail('INVALID_ARGUMENT');
  return value;
}

function time(value: unknown): string {
  if (typeof value !== 'string' || !UTC.test(value)
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) return fail('INVALID_ARGUMENT');
  return value;
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return fail('INVALID_ARGUMENT');
  }
  return value;
}

function operation(value: unknown): string {
  const id = label(value);
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) return fail('INVALID_ARGUMENT');
  return id;
}

function active(context: LearningContext): void {
  if (context === null || typeof context !== 'object'
    || typeof context.signal?.aborted !== 'boolean') return fail('INVALID_ARGUMENT');
  if (context.signal.aborted) return fail('CANCELLED');
  if (Date.parse(time(context.deadline)) <= Date.now()) return fail('TIMEOUT');
}

function candidate(request: ProposeWorkflowRequest, nextRevision: number): WorkflowCandidate {
  if (!Array.isArray(request.steps) || request.steps.length < 1 || request.steps.length > 16) {
    return fail('INVALID_ARGUMENT');
  }
  const steps = request.steps.map(step => label(step, 256));
  return {namespace: label(request.namespace), workflowId: label(request.workflowId),
    revision: nextRevision, summary: label(request.summary, 1024), steps,
    sourceRef: label(request.sourceRef, 1024), createdAt: time(request.createdAt)};
}

function inTransaction<T>(db: DatabaseSync, context: LearningContext, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    active(context);
    const result = action();
    active(context);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function storedVersion(row: Row): WorkflowVersion {
  const value = JSON.parse(row.candidate_json as string) as WorkflowCandidate;
  return {...value, validation: row.validation as WorkflowVersion['validation'],
    ...(row.evidence_ref === null ? {} : {evidenceRef: row.evidence_ref as string})};
}

function receipt(row: Row): ActivationReceipt {
  return {sequence: row.sequence as number, operationId: row.operation_id as string,
    fromRevision: row.from_revision as number | null, toRevision: row.to_revision as number,
    activatedAt: row.activated_at as string};
}

/** Trusted host only. Stored proposals are descriptive and never execute tools. */
export class SqliteLearningHost {
  constructor(private readonly db: DatabaseSync) {}

  close(): void { this.db.close(); }

  private sourceAvailable(namespace: string, sourceRef: string): void {
    if (this.db.prepare(`SELECT 1 FROM learning_invalidated_sources
      WHERE namespace = ? AND source_ref = ?`).get(namespace, sourceRef)) return fail('NOT_FOUND');
  }

  /** Read-only trusted-host fence for dispatch/resume; never restores an invalidated source. */
  assertSourceAvailable(namespace: string, sourceRef: string): void {
    this.sourceAvailable(label(namespace), label(sourceRef, 1024));
  }

  /** Content-free readback distinguishes accepted deletion from a rejected head. */
  readErasureReceipt(namespaceValue: string, workflowIdValue: string): {
    readonly operationId: string; readonly expectedRevision: number;
  } | null {
    const row = this.db.prepare(`SELECT operation_id, expected_revision FROM learning_erasures
      WHERE namespace = ? AND workflow_id = ?`)
      .get(label(namespaceValue), label(workflowIdValue)) as Row | undefined;
    return row ? {operationId: row.operation_id as string, expectedRevision: row.expected_revision as number} : null;
  }

  /** Retry only post-commit maintenance, never propose/validate/execute on startup. */
  resumeErasureMaintenance(namespaceValue: string): void {
    const namespace = label(namespaceValue);
    const marker = this.db.prepare('SELECT 1 FROM learning_erasures WHERE namespace = ? LIMIT 1').get(namespace);
    if (!marker) return;
    const surviving = this.db.prepare(`SELECT 1 FROM learning_erasures e WHERE e.namespace = ? AND (
      EXISTS (SELECT 1 FROM learning_versions v WHERE v.namespace = e.namespace AND v.workflow_id = e.workflow_id)
      OR EXISTS (SELECT 1 FROM learning_activations a WHERE a.namespace = e.namespace AND a.workflow_id = e.workflow_id)
    ) LIMIT 1`).get(namespace);
    if (surviving) return fail('STORAGE_UNAVAILABLE');
    this.checkpointErasureWal();
  }

  private ensureNotErased(namespace: string, workflowId: string): void {
    if (this.db.prepare(`SELECT 1 FROM learning_erasures
      WHERE namespace = ? AND workflow_id = ?`).get(namespace, workflowId) !== undefined) {
      return fail('NOT_FOUND');
    }
  }

  private checkpointErasureWal(): void {
    try {
      const mode = this.db.prepare('PRAGMA journal_mode').get() as {journal_mode?: string} | undefined;
      const result = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
        {busy?: number; log?: number; checkpointed?: number} | undefined;
      if (mode?.journal_mode !== 'wal' || result?.busy !== 0
        || result.log !== 0 || result.checkpointed !== 0) return fail('STORAGE_UNAVAILABLE');
    } catch {
      return fail('STORAGE_UNAVAILABLE');
    }
  }

  propose(request: ProposeWorkflowRequest): WorkflowVersion {
    active(request);
    const expected = request.expectedRevision === null ? 0 : revision(request.expectedRevision);
    if (expected >= Number.MAX_SAFE_INTEGER) return fail('INVALID_ARGUMENT');
    const op = operation(request.operationId);
    const value = candidate(request, expected + 1);
    const fingerprint = createHash('sha256').update(JSON.stringify(value)).digest('hex');
    return inTransaction(this.db, request, () => {
      this.ensureNotErased(value.namespace, value.workflowId);
      this.sourceAvailable(value.namespace, value.sourceRef);
      const previous = this.db.prepare(`SELECT * FROM learning_versions WHERE operation_id = ?`)
        .get(op) as Row | undefined;
      if (previous !== undefined) {
        if (previous.namespace !== value.namespace || previous.workflow_id !== value.workflowId
          || previous.revision !== value.revision || previous.fingerprint !== fingerprint) {
          return fail('REVISION_CONFLICT');
        }
        return storedVersion(previous);
      }
      const head = this.db.prepare(`SELECT MAX(revision) AS revision FROM learning_versions
        WHERE namespace = ? AND workflow_id = ?`).get(value.namespace, value.workflowId) as Row;
      if ((head.revision ?? 0) !== expected) return fail('REVISION_CONFLICT');
      this.db.prepare(`INSERT INTO learning_versions(namespace, workflow_id, revision,
        operation_id, fingerprint, candidate_json, validation, evidence_ref)
        VALUES (?, ?, ?, ?, ?, ?, 'candidate', NULL)`)
        .run(value.namespace, value.workflowId, value.revision, op, fingerprint,
          JSON.stringify(value));
      return {...value, validation: 'candidate'};
    });
  }

  readVersion(namespace: string, workflowId: string, version: number): WorkflowVersion {
    const row = this.db.prepare(`SELECT * FROM learning_versions
      WHERE namespace = ? AND workflow_id = ? AND revision = ?`)
      .get(label(namespace), label(workflowId), revision(version)) as Row | undefined;
    if (row === undefined) return fail('NOT_FOUND');
    return storedVersion(row);
  }

  async validate(namespace: string, workflowId: string, version: number,
    validator: WorkflowValidatorPort, context: LearningContext): Promise<WorkflowVersion> {
    active(context);
    const existing = this.readVersion(namespace, workflowId, version);
    this.sourceAvailable(namespace, existing.sourceRef);
    if (existing.validation !== 'candidate') return existing;
    const {validation: _validation, evidenceRef: _evidenceRef, ...proposal} = existing;
    const outcome = await validator.validate(structuredClone(proposal), context);
    active(context);
    if (outcome === null || typeof outcome !== 'object' || typeof outcome.passed !== 'boolean') {
      return fail('INVALID_ARGUMENT');
    }
    const evidenceRef = label(outcome.evidenceRef, 512);
    return inTransaction(this.db, context, () => {
      const current = this.readVersion(namespace, workflowId, version);
      this.sourceAvailable(namespace, current.sourceRef);
      if (current.validation !== 'candidate') return current;
      const validation = outcome.passed ? 'passed' : 'failed';
      this.db.prepare(`UPDATE learning_versions SET validation = ?, evidence_ref = ?
        WHERE namespace = ? AND workflow_id = ? AND revision = ?`)
        .run(validation, evidenceRef, namespace, workflowId, version);
      return {...proposal, validation, evidenceRef};
    });
  }

  readActive(namespace: string, workflowId: string): WorkflowVersion | null {
    return this.readActiveSelection(namespace, workflowId)?.version ?? null;
  }

  /** One coherent selection identity: stop/reactivation of the same version invalidates old leases. */
  readActiveSelection(namespace: string, workflowId: string): {version: WorkflowVersion; sequence: number} | null {
    const row = this.db.prepare(`SELECT v.*, a.sequence FROM learning_activations a
      JOIN learning_versions v ON v.namespace = a.namespace
        AND v.workflow_id = a.workflow_id AND v.revision = a.to_revision
      WHERE a.namespace = ? AND a.workflow_id = ?
        AND a.sequence > COALESCE((SELECT MAX(s.through_sequence) FROM learning_stops s
          WHERE s.namespace = a.namespace AND s.workflow_id = a.workflow_id), 0)
        AND NOT EXISTS (SELECT 1 FROM learning_invalidated_sources i
          WHERE i.namespace = v.namespace AND i.source_ref = json_extract(v.candidate_json, '$.sourceRef'))
        AND a.sequence = (SELECT MAX(latest.sequence) FROM learning_activations latest
          WHERE latest.namespace = a.namespace AND latest.workflow_id = a.workflow_id)
      ORDER BY a.sequence DESC LIMIT 1`)
      .get(label(namespace), label(workflowId)) as Row | undefined;
    return row === undefined ? null : {version: storedVersion(row), sequence: row.sequence as number};
  }

  activateVersion(request: ActivateWorkflowRequest): ActivationReceipt {
    active(request);
    const namespace = label(request.namespace);
    const workflowId = label(request.workflowId);
    const target = revision(request.revision);
    const expected = request.expectedActiveRevision === null
      ? null : revision(request.expectedActiveRevision);
    const op = operation(request.operationId);
    const at = time(request.activatedAt);
    return inTransaction(this.db, request, () => {
      this.ensureNotErased(namespace, workflowId);
      const previous = this.db.prepare(`SELECT * FROM learning_activations WHERE operation_id = ?`)
        .get(op) as Row | undefined;
      if (previous !== undefined) {
        if (previous.namespace !== namespace || previous.workflow_id !== workflowId
          || previous.to_revision !== target || previous.from_revision !== expected
          || previous.activated_at !== at) return fail('REVISION_CONFLICT');
        return receipt(previous);
      }
      const selected = this.readVersion(namespace, workflowId, target);
      this.sourceAvailable(namespace, selected.sourceRef);
      if (selected.validation !== 'passed') return fail('NOT_VALIDATED');
      const current = this.readActive(namespace, workflowId);
      if ((current?.revision ?? null) !== expected) return fail('REVISION_CONFLICT');
      if (target === expected) return fail('INVALID_ARGUMENT');
      const inserted = this.db.prepare(`INSERT INTO learning_activations(
        namespace, workflow_id, operation_id, from_revision, to_revision, activated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(namespace, workflowId, op, expected, target, at);
      return {sequence: Number(inserted.lastInsertRowid), operationId: op,
        fromRevision: expected, toRevision: target, activatedAt: at};
    });
  }

  /** Disable selection only; this never claims an already running tool was cancelled. */
  stopWorkflow(request: StopWorkflowRequest): void {
    active(request);
    const namespace = label(request.namespace);
    const workflowId = label(request.workflowId);
    const expected = request.expectedActiveRevision === null ? null : revision(request.expectedActiveRevision);
    const op = operation(request.operationId);
    const at = time(request.stoppedAt);
    inTransaction(this.db, request, () => {
      this.ensureNotErased(namespace, workflowId);
      const previous = this.db.prepare('SELECT * FROM learning_stops WHERE operation_id = ?').get(op) as Row | undefined;
      if (previous) {
        if (previous.namespace !== namespace || previous.workflow_id !== workflowId
          || previous.expected_revision !== expected || previous.stopped_at !== at) return fail('REVISION_CONFLICT');
        return;
      }
      if ((this.readActive(namespace, workflowId)?.revision ?? null) !== expected) return fail('REVISION_CONFLICT');
      const row = this.db.prepare(`SELECT MAX(sequence) AS sequence FROM learning_activations
        WHERE namespace = ? AND workflow_id = ?`).get(namespace, workflowId) as Row;
      this.db.prepare(`INSERT INTO learning_stops(namespace, workflow_id, operation_id,
        expected_revision, through_sequence, stopped_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(namespace, workflowId, op, expected, (row.sequence as number | null) ?? 0, at);
    });
  }

  /** Durable revocation fence; deletions/corrections may not restore an older workflow implicitly. */
  invalidateSource(request: InvalidateWorkflowSourceRequest): void {
    active(request);
    const namespace = label(request.namespace);
    const source = label(request.sourceRef, 1024);
    const op = operation(request.operationId);
    const at = time(request.invalidatedAt);
    inTransaction(this.db, request, () => {
      const previous = this.db.prepare(`SELECT * FROM learning_invalidated_sources
        WHERE namespace = ? AND source_ref = ?`).get(namespace, source) as Row | undefined;
      if (previous) {
        if (previous.operation_id !== op) return fail('REVISION_CONFLICT');
        return;
      }
      if (this.db.prepare('SELECT 1 FROM learning_invalidated_sources WHERE operation_id = ?').get(op)) {
        return fail('REVISION_CONFLICT');
      }
      this.db.prepare(`INSERT INTO learning_invalidated_sources(namespace, source_ref, operation_id, invalidated_at)
        VALUES (?, ?, ?, ?)`).run(namespace, source, op, at);
    });
  }

  /** Host-only physical purge; successful return requires a truncated WAL. */
  eraseWorkflow(request: EraseWorkflowRequest): void {
    active(request);
    const namespace = label(request.namespace);
    const workflowId = label(request.workflowId);
    const expected = revision(request.expectedRevision);
    const op = operation(request.operationId);
    inTransaction(this.db, request, () => {
      const existing = this.db.prepare(`SELECT operation_id, expected_revision FROM learning_erasures
        WHERE namespace = ? AND workflow_id = ?`).get(namespace, workflowId) as Row | undefined;
      if (existing !== undefined) {
        if (existing.operation_id !== op || existing.expected_revision !== expected) {
          return fail('REVISION_CONFLICT');
        }
        return;
      }
      if (this.db.prepare('SELECT 1 FROM learning_erasures WHERE operation_id = ?')
        .get(op) !== undefined) return fail('REVISION_CONFLICT');
      const head = this.db.prepare(`SELECT MAX(revision) AS revision FROM learning_versions
        WHERE namespace = ? AND workflow_id = ?`).get(namespace, workflowId) as Row;
      if (head.revision === null) return fail('NOT_FOUND');
      if (head.revision !== expected) return fail('REVISION_CONFLICT');
      this.db.prepare(`DELETE FROM learning_activations WHERE namespace = ? AND workflow_id = ?`)
        .run(namespace, workflowId);
      this.db.prepare(`DELETE FROM learning_stops WHERE namespace = ? AND workflow_id = ?`)
        .run(namespace, workflowId);
      this.db.prepare(`DELETE FROM learning_versions WHERE namespace = ? AND workflow_id = ?`)
        .run(namespace, workflowId);
      this.db.prepare(`INSERT INTO learning_erasures(namespace, workflow_id, operation_id,
        expected_revision) VALUES (?, ?, ?, ?)`).run(namespace, workflowId, op, expected);
    });
    this.checkpointErasureWal();
  }
}

export function openSqliteLearningHost(path: string): SqliteLearningHost {
  const db = openStorage(path, MIGRATIONS);
  try {
    db.exec('PRAGMA secure_delete = ON');
    const setting = db.prepare('PRAGMA secure_delete').get() as {secure_delete?: number} | undefined;
    if (setting?.secure_delete !== 1) return fail('STORAGE_UNAVAILABLE');
    return new SqliteLearningHost(db);
  } catch (error) {
    db.close();
    throw error;
  }
}
