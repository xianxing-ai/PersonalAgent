import {createHash, randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {openStorage, type Migration} from '@personal-agent/storage';
import {FactChangeFeedError, MemoryQueryError, parseFactChangeBatch} from './index.js';
import type {
  ConfirmFactChangeBatchRequest,
  FactChangeBatch,
  FactChangeEntry,
  FactChangeFeedPort,
  FactChangeReceipt,
  FactPage,
  FactRef,
  FactSensitivity,
  FactVersion,
  GetFactVersionRequest,
  ListCurrentFactsRequest,
  ListFactHistoryRequest,
  MemoryQueryPort,
  MemoryReadContext,
  ReadFactChangesRequest,
} from './index.js';

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SENSITIVITIES: readonly FactSensitivity[] = ['public', 'private', 'restricted'];
const CONFIRMATIONS = ['external_observation', 'model_inference', 'user_confirmed'] as const;
const STATES = ['active', 'withdrawn'] as const;
const MAX_ID = 256;
const MAX_SUMMARY = 4096;
const MAX_SOURCE = 1024;
const MAX_PAGE = 100;

/** Content-free trusted recovery inventory, never a consumer query or authorization. */
export interface FactErasureMarker {
  readonly factId: string;
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly phase: 'pending' | 'completed';
}

const MIGRATIONS: readonly Migration[] = [{
  version: 1,
  sql: `
    CREATE TABLE memory_namespaces (
      namespace TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL CHECK (sequence >= 0)
    ) STRICT;
    CREATE TABLE memory_facts (
      namespace TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence >= 1),
      event_id TEXT NOT NULL,
      fact_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      sensitivity TEXT NOT NULL CHECK (sensitivity IN ('public', 'private', 'restricted')),
      state TEXT NOT NULL CHECK (state IN ('active', 'withdrawn')),
      source_ref TEXT NOT NULL,
      valid_from_ms INTEGER NOT NULL,
      valid_until_ms INTEGER NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (namespace, fact_id, revision),
      UNIQUE (namespace, sequence),
      UNIQUE (namespace, event_id),
      FOREIGN KEY (namespace) REFERENCES memory_namespaces(namespace)
    ) STRICT;
    CREATE INDEX memory_facts_current_idx ON memory_facts(namespace, fact_id, revision DESC);
    CREATE INDEX memory_facts_changes_idx ON memory_facts(namespace, sequence);
    CREATE TABLE memory_query_snapshots (
      token TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('current', 'history')),
      filter_key TEXT NOT NULL,
      watermark INTEGER NOT NULL,
      FOREIGN KEY (namespace) REFERENCES memory_namespaces(namespace)
    ) STRICT;
    CREATE TABLE memory_query_cursors (
      token TEXT PRIMARY KEY,
      snapshot_token TEXT NOT NULL,
      offset INTEGER NOT NULL CHECK (offset >= 0),
      FOREIGN KEY (snapshot_token) REFERENCES memory_query_snapshots(token) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE memory_feed_bindings (
      namespace TEXT NOT NULL,
      consumer_id TEXT NOT NULL,
      binding_id TEXT NOT NULL UNIQUE,
      scope_key TEXT NOT NULL,
      allowed_json TEXT NOT NULL,
      valid INTEGER NOT NULL CHECK (valid IN (0, 1)),
      checkpoint TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('bootstrap', 'changes')),
      bootstrap_watermark INTEGER,
      bootstrap_watermark_token TEXT,
      bootstrap_entries_json TEXT,
      bootstrap_offset INTEGER NOT NULL CHECK (bootstrap_offset >= 0),
      changes_after INTEGER NOT NULL CHECK (changes_after >= 0),
      pending_batch_token TEXT,
      PRIMARY KEY (namespace, consumer_id),
      FOREIGN KEY (namespace) REFERENCES memory_namespaces(namespace)
    ) STRICT;
    CREATE TABLE memory_feed_deliveries (
      batch_token TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      consumer_id TEXT NOT NULL,
      binding_id TEXT NOT NULL,
      batch_json TEXT NOT NULL,
      next_bootstrap_offset INTEGER,
      next_changes_after INTEGER,
      confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)),
      confirmed_expected_checkpoint TEXT,
      confirmed_handled_key TEXT,
      receipt_checkpoint TEXT
    ) STRICT;
  `,
}, {
  version: 2,
  sql: `
    CREATE TABLE memory_public_sources (
      namespace TEXT NOT NULL,
      vault_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      fact_id TEXT NOT NULL,
      source_revision TEXT NOT NULL,
      fact_revision INTEGER NOT NULL CHECK (fact_revision >= 1),
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (namespace, vault_id, source_path, fact_id),
      UNIQUE (namespace, fact_id),
      FOREIGN KEY (namespace, fact_id, fact_revision)
        REFERENCES memory_facts(namespace, fact_id, revision)
    ) STRICT;
  `,
}, {
  version: 3,
  sql: `
    CREATE TABLE memory_erasure_intents (
      namespace TEXT NOT NULL,
      fact_id TEXT NOT NULL,
      operation_id TEXT NOT NULL UNIQUE,
      expected_revision INTEGER NOT NULL CHECK (expected_revision >= 1),
      phase TEXT NOT NULL CHECK (phase IN ('pending', 'completed')),
      PRIMARY KEY (namespace, fact_id),
      FOREIGN KEY (namespace) REFERENCES memory_namespaces(namespace)
    ) STRICT;
  `,
}, {
  version: 4,
  sql: `
    CREATE TABLE memory_user_revisions (
      operation_id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      fact_id TEXT NOT NULL,
      expected_revision INTEGER NOT NULL CHECK (expected_revision >= 1),
      fact_revision INTEGER NOT NULL CHECK (fact_revision >= 2),
      fingerprint TEXT NOT NULL,
      FOREIGN KEY (namespace, fact_id, fact_revision)
        REFERENCES memory_facts(namespace, fact_id, revision)
    ) STRICT;
  `,
}, {
  version: 5,
  sql: `
    CREATE TABLE memory_user_creations (
      operation_id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      fact_id TEXT NOT NULL,
      fact_revision INTEGER NOT NULL CHECK (fact_revision = 1),
      fingerprint TEXT NOT NULL,
      FOREIGN KEY (namespace, fact_id, fact_revision)
        REFERENCES memory_facts(namespace, fact_id, revision)
    ) STRICT;
  `,
}];

type Row = Record<string, unknown>;
type Context = MemoryReadContext & {readonly expiresAt: number};

function queryFail(code: ConstructorParameters<typeof MemoryQueryError>[0] = 'INVALID_ARGUMENT'): never {
  throw new MemoryQueryError(code);
}

function feedFail(code: ConstructorParameters<typeof FactChangeFeedError>[0] = 'INVALID_ARGUMENT'): never {
  throw new FactChangeFeedError(code);
}

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const keys = Reflect.ownKeys(value);
  const allowed = new Set([...required, ...optional]);
  if (keys.some(key => typeof key !== 'string' || !allowed.has(key)
    || !Object.prototype.propertyIsEnumerable.call(value, key))
    || required.some(key => !Object.prototype.propertyIsEnumerable.call(value, key))) throw new Error();
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum = MAX_ID): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error();
  return value;
}

function time(value: unknown): {readonly text: string; readonly milliseconds: number} {
  if (typeof value !== 'string' || !UTC.test(value)) throw new Error();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) throw new Error();
  return {text: value, milliseconds};
}

function ref(value: unknown): FactRef {
  const record = exact(value, ['id', 'revision']);
  if (typeof record.revision !== 'number' || !Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error();
  return {id: text(record.id), revision: record.revision};
}

function fact(value: unknown): FactVersion {
  const record = exact(value,
    ['ref', 'summary', 'sourceRef', 'observedAt', 'validFrom', 'validUntil', 'sensitivity', 'state', 'confirmation'],
    ['corrects']);
  const validFrom = time(record.validFrom);
  const validUntil = time(record.validUntil);
  if (validFrom.milliseconds >= validUntil.milliseconds
    || !SENSITIVITIES.includes(record.sensitivity as FactSensitivity)
    || !STATES.includes(record.state as typeof STATES[number])
    || !CONFIRMATIONS.includes(record.confirmation as typeof CONFIRMATIONS[number])) throw new Error();
  const parsed: FactVersion = {
    ref: ref(record.ref),
    summary: text(record.summary, MAX_SUMMARY),
    sourceRef: text(record.sourceRef, MAX_SOURCE),
    observedAt: time(record.observedAt).text,
    validFrom: validFrom.text,
    validUntil: validUntil.text,
    sensitivity: record.sensitivity as FactSensitivity,
    state: record.state as FactVersion['state'],
    confirmation: record.confirmation as FactVersion['confirmation'],
  };
  if (record.corrects !== undefined) parsed.corrects = ref(record.corrects);
  return parsed;
}

function publicSourceKey(value: Record<string, unknown>): {
  vaultId: string; path: string; factId: string;
} {
  const vaultId = text(value.vaultId);
  const path = text(value.path, MAX_SOURCE);
  const factId = text(value.factId);
  if (!/^[a-z0-9-]+$/.test(vaultId) || path.includes('\\') || path.includes(':')
    || path.split('/').some(part => part === '' || part === '.' || part === '..')) throw new Error();
  return {vaultId, path, factId};
}

function context(record: Record<string, unknown>, fail: typeof queryFail | typeof feedFail): Context {
  try {
    if (record.signal === null || typeof record.signal !== 'object') return fail();
    const signal = record.signal as AbortSignal;
    if (typeof signal.aborted !== 'boolean'
      || typeof signal.addEventListener !== 'function'
      || typeof signal.removeEventListener !== 'function') return fail();
    const deadline = time(record.deadline);
    if (signal.aborted) return fail('CANCELLED' as never);
    if (deadline.milliseconds <= Date.now()) return fail('TIMEOUT' as never);
    return {deadline: deadline.text, signal, expiresAt: deadline.milliseconds};
  } catch (error) {
    if (error instanceof MemoryQueryError || error instanceof FactChangeFeedError) throw error;
    return fail();
  }
}

function active(value: Context, fail: typeof queryFail | typeof feedFail): void {
  if (value.signal.aborted) return fail('CANCELLED' as never);
  if (value.expiresAt <= Date.now()) return fail('TIMEOUT' as never);
}

function scope(value: unknown, withConsumer: boolean): {
  readonly values: readonly FactSensitivity[];
  readonly key: string;
  readonly consumerId?: string;
} {
  const record = exact(value, withConsumer ? ['consumerId', 'allowedSensitivities'] : ['allowedSensitivities']);
  if (!Array.isArray(record.allowedSensitivities) || record.allowedSensitivities.length === 0) throw new Error();
  const values = record.allowedSensitivities.map(item => {
    if (!SENSITIVITIES.includes(item as FactSensitivity)) throw new Error();
    return item as FactSensitivity;
  });
  if (new Set(values).size !== values.length) throw new Error();
  const sorted = Object.freeze([...values].sort());
  const consumerId = withConsumer ? text(record.consumerId) : undefined;
  return {values: sorted, key: JSON.stringify(sorted), ...(consumerId === undefined ? {} : {consumerId})};
}

interface PageOptions {
  readonly limit: number;
  readonly snapshot?: string;
  readonly cursor?: string;
}

function parsePage(record: Record<string, unknown>): PageOptions {
  if (typeof record.limit !== 'number' || !Number.isSafeInteger(record.limit)
    || record.limit < 1 || record.limit > MAX_PAGE) throw new Error();
  const snapshot = record.snapshot === undefined ? undefined : text(record.snapshot);
  const cursor = record.cursor === undefined ? undefined : text(record.cursor);
  if (cursor !== undefined && snapshot === undefined) throw new Error();
  return {
    limit: record.limit,
    ...(snapshot === undefined ? {} : {snapshot}),
    ...(cursor === undefined ? {} : {cursor}),
  };
}

function rowText(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Invalid database value: ${key}`);
  return value;
}

function rowNumber(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid database value: ${key}`);
  return value;
}

function optionalNumber(row: Row, key: string): number | undefined {
  return row[key] === null || row[key] === undefined ? undefined : rowNumber(row, key);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function token(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function transaction<T>(db: DatabaseSync, action: () => T, checkActive?: () => void): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    // BEGIN may block on another writer; check again before work and before commit.
    checkActive?.();
    const result = action();
    checkActive?.();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function cloneEntry(entry: FactChangeEntry): FactChangeEntry {
  return {eventId: entry.eventId, fact: {id: entry.fact.id, revision: entry.fact.revision}};
}

function cloneBatch(batch: FactChangeBatch): FactChangeBatch {
  return {...batch, entries: batch.entries.map(cloneEntry)};
}

function handledKey(entries: readonly FactChangeEntry[]): string {
  return JSON.stringify(entries.map(entry => [entry.eventId, entry.fact.id, entry.fact.revision]));
}

export class SqliteMemoryHost {
  constructor(private readonly db: DatabaseSync) {}

  private invalidateFactSnapshots(namespace: string, factId: string): void {
    const snapshots = this.db.prepare(
      'SELECT token, mode, filter_key, scope_key, watermark FROM memory_query_snapshots WHERE namespace = ?',
    ).all(namespace) as Row[];
    for (const snapshot of snapshots) {
      const filter = parseJson<Record<string, unknown>>(rowText(snapshot, 'filter_key'));
      let affected = snapshot.mode === 'history' && filter.factId === factId;
      if (snapshot.mode === 'current') {
        const latest = this.db.prepare([
          "SELECT sensitivity, state, source_ref, valid_from_ms, valid_until_ms, json_extract(payload, '$.confirmation') AS confirmation",
          'FROM memory_facts WHERE namespace = ? AND fact_id = ? AND sequence <= ?',
          'ORDER BY revision DESC LIMIT 1',
        ].join(' ')).get(namespace, factId, rowNumber(snapshot, 'watermark')) as Row | undefined;
        const allowed = parseJson<FactSensitivity[]>(rowText(snapshot, 'scope_key'));
        const at = Date.parse(filter.at as string);
        affected = latest !== undefined && allowed.includes(latest.sensitivity as FactSensitivity)
          && (filter.privateAdminHeads === true ? latest.confirmation === 'user_confirmed'
            || latest.state === 'withdrawn' && latest.confirmation === 'external_observation'
              && this.db.prepare('SELECT 1 FROM memory_user_creations WHERE namespace = ? AND fact_id = ?')
                .get(namespace, factId) !== undefined
            : (filter.factId === null || filter.factId === factId)
              && (filter.sourceRef === null || filter.sourceRef === latest.source_ref)
              && latest.state === 'active' && (latest.valid_from_ms as number) <= at
              && at < (latest.valid_until_ms as number));
      }
      if (affected) this.db.prepare('DELETE FROM memory_query_snapshots WHERE token = ?')
        .run(rowText(snapshot, 'token'));
    }
  }

  close(): void {
    this.db.close();
  }

  /** Post-commit WAL maintenance; a busy checkpoint must be retried. */
  private checkpointErasureWal(): void {
    try {
      const mode = this.db.prepare('PRAGMA journal_mode').get() as {journal_mode?: string} | undefined;
      const result = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
        {busy?: number; log?: number; checkpointed?: number} | undefined;
      if (mode?.journal_mode !== 'wal' || result?.busy !== 0
        || result.log !== 0 || result.checkpointed !== 0) return queryFail('STORAGE_UNAVAILABLE');
    } catch {
      return queryFail('STORAGE_UNAVAILABLE');
    }
  }

  /** Recheck committed erasures after a crash or blocked post-commit checkpoint. */
  resumeCompletedErasureMaintenance(namespaceValue: unknown): void {
    try {
      const namespace = text(namespaceValue);
      const completed = this.db.prepare(`SELECT 1 FROM memory_erasure_intents
        WHERE namespace = ? AND phase = 'completed' LIMIT 1`).get(namespace);
      if (completed === undefined) return;
      const remaining = this.db.prepare(`SELECT 1 FROM memory_erasure_intents e
        WHERE e.namespace = ? AND e.phase = 'completed' AND (
          EXISTS (SELECT 1 FROM memory_facts f WHERE f.namespace = e.namespace AND f.fact_id = e.fact_id)
          OR EXISTS (SELECT 1 FROM memory_public_sources s WHERE s.namespace = e.namespace AND s.fact_id = e.fact_id)
          OR EXISTS (SELECT 1 FROM memory_user_creations c WHERE c.namespace = e.namespace AND c.fact_id = e.fact_id)
          OR EXISTS (SELECT 1 FROM memory_user_revisions r WHERE r.namespace = e.namespace AND r.fact_id = e.fact_id)
        ) LIMIT 1`).get(namespace);
      if (remaining !== undefined) return queryFail('STORAGE_UNAVAILABLE');
      this.checkpointErasureWal();
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail('STORAGE_UNAVAILABLE');
    }
  }

  /** Stable ID pagination over durable intents, including completed tombstones. */
  listFactErasures(namespaceValue: unknown, value: unknown): readonly FactErasureMarker[] {
    try {
      const namespace = text(namespaceValue);
      const record = exact(value, ['limit', 'deadline', 'signal'], ['afterFactId']);
      const operation = context(record, queryFail);
      if (!Number.isSafeInteger(record.limit) || (record.limit as number) < 1
        || (record.limit as number) > MAX_PAGE) return queryFail();
      const after = record.afterFactId === undefined ? '' : text(record.afterFactId);
      active(operation, queryFail);
      const rows = this.db.prepare(`SELECT fact_id, operation_id, expected_revision, phase
        FROM memory_erasure_intents WHERE namespace = ? AND fact_id > ?
        ORDER BY fact_id LIMIT ?`).all(namespace, after, record.limit as number) as Row[];
      return rows.map(row => ({factId: rowText(row, 'fact_id'),
        operationId: rowText(row, 'operation_id'), expectedRevision: rowNumber(row, 'expected_revision'),
        phase: rowText(row, 'phase') as FactErasureMarker['phase']}));
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail();
    }
  }

  /**
   * Before exposing an application-restored UNBOUND database, reapply markers
   * read from its still-authoritative original host. No file copy or discovery.
   * A missing authoritative inventory must be handled as unavailable by the caller.
   */
  restoreUnboundErasureMarkers(namespaceValue: unknown, value: unknown): void {
    try {
      const namespace = text(namespaceValue);
      const record = exact(value, ['markers', 'deadline', 'signal']);
      const operation = context(record, queryFail);
      if (!Array.isArray(record.markers) || record.markers.length > MAX_PAGE) return queryFail();
      const markers = record.markers.map(raw => {
        const marker = exact(raw, ['factId', 'operationId', 'expectedRevision', 'phase']);
        const factId = text(marker.factId);
        const operationId = text(marker.operationId, 128);
        if (!/^[A-Za-z0-9_.-]+$/.test(operationId)
          || !Number.isSafeInteger(marker.expectedRevision) || (marker.expectedRevision as number) < 1
          || marker.phase !== 'completed') return queryFail('SCOPE_DENIED');
        return {factId, operationId, expectedRevision: marker.expectedRevision as number};
      });
      transaction(this.db, () => {
        active(operation, queryFail);
        if (this.db.prepare('SELECT 1 FROM memory_feed_bindings WHERE namespace = ? LIMIT 1')
          .get(namespace) !== undefined) return queryFail('SCOPE_DENIED');
        for (const marker of markers) {
          const existing = this.db.prepare(`SELECT operation_id, expected_revision, phase
            FROM memory_erasure_intents WHERE namespace = ? AND fact_id = ?`)
            .get(namespace, marker.factId) as Row | undefined;
          if (existing && (existing.operation_id !== marker.operationId
            || existing.expected_revision !== marker.expectedRevision || existing.phase !== 'completed')) {
            return queryFail('REVISION_CONFLICT');
          }
          const head = this.db.prepare(`SELECT MAX(revision) AS revision FROM memory_facts
            WHERE namespace = ? AND fact_id = ?`).get(namespace, marker.factId) as Row;
          if (head.revision !== null && (head.revision as number) > marker.expectedRevision) {
            return queryFail('REVISION_CONFLICT');
          }
          this.invalidateFactSnapshots(namespace, marker.factId);
          for (const table of ['memory_public_sources', 'memory_user_revisions', 'memory_user_creations', 'memory_facts']) {
            this.db.prepare(`DELETE FROM ${table} WHERE namespace = ? AND fact_id = ?`).run(namespace, marker.factId);
          }
          this.db.prepare(`INSERT OR IGNORE INTO memory_erasure_intents
            (namespace, fact_id, operation_id, expected_revision, phase) VALUES (?, ?, ?, ?, 'completed')`)
            .run(namespace, marker.factId, marker.operationId, marker.expectedRevision);
        }
      }, () => active(operation, queryFail));
      this.resumeCompletedErasureMaintenance(namespace);
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail('STORAGE_UNAVAILABLE');
    }
  }

  provision(namespaceValue: unknown): void {
    try {
      const namespace = text(namespaceValue);
      this.db.prepare('INSERT OR IGNORE INTO memory_namespaces(namespace, sequence) VALUES (?, 0)').run(namespace);
    } catch {
      return queryFail();
    }
  }

  /** Trusted private admin head read; includes withdrawn/expired heads, never older fallback. */
  readUserFactHead(namespaceValue: unknown, factIdValue: unknown): FactVersion | undefined {
    const namespace = text(namespaceValue);
    const factId = text(factIdValue);
    const row = this.db.prepare(`SELECT f.payload FROM memory_facts f
      WHERE f.namespace = ? AND f.fact_id = ?
        AND NOT EXISTS (SELECT 1 FROM memory_erasure_intents e
          WHERE e.namespace = f.namespace AND e.fact_id = f.fact_id)
      ORDER BY f.revision DESC LIMIT 1`).get(namespace, factId) as Row | undefined;
    if (!row) return undefined;
    const saved = fact(parseJson(rowText(row, 'payload')));
    const invalidated = saved.state === 'withdrawn' && saved.confirmation === 'external_observation'
      && this.db.prepare('SELECT 1 FROM memory_user_creations WHERE namespace = ? AND fact_id = ?')
        .get(namespace, factId) !== undefined;
    if (saved.sensitivity !== 'private' || saved.confirmation !== 'user_confirmed' && !invalidated) return queryFail('SCOPE_DENIED');
    return structuredClone(saved);
  }

  /** Trusted private admin listing; inactive heads remain discoverable for physical deletion. */
  async listUserFactHeads(namespaceValue: unknown,
    raw: Omit<ListCurrentFactsRequest, 'factId' | 'sourceRef'>): Promise<FactPage> {
    try {
      const namespace = text(namespaceValue);
      const record = exact(raw, ['at', 'limit', 'deadline', 'signal'], ['snapshot', 'cursor']);
      const operation = context(record, queryFail);
      const at = time(record.at);
      const page = parsePage(record);
      await Promise.resolve();
      active(operation, queryFail);
      const result = this.queryPage(namespace, scope({allowedSensitivities: ['private']}, false),
        'current', JSON.stringify({at: at.text, privateAdminHeads: true}), page, {privateAdminHeads: true});
      active(operation, queryFail);
      return structuredClone(result);
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail();
    }
  }

  /** Trusted private composition readiness; a previous feed binding is irreversible here. */
  assertUnboundNamespace(namespaceValue: unknown): void {
    const namespace = text(namespaceValue);
    if (this.db.prepare('SELECT 1 FROM memory_feed_bindings WHERE namespace = ? LIMIT 1')
      .get(namespace) !== undefined) return queryFail('SCOPE_DENIED');
  }

  append(namespaceValue: unknown, value: unknown): FactVersion {
    try {
      const namespace = text(namespaceValue);
      const next = fact(value);
      return transaction(this.db, () => {
        if (this.db.prepare(`SELECT 1 FROM memory_public_sources
          WHERE namespace = ? AND fact_id = ?`).get(namespace, next.ref.id) !== undefined) return queryFail();
        return this.appendFact(namespace, next);
      });
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail();
    }
  }

  /** Host-only primitive after source detachment and authorization; refuses any feed binding. */
  eraseUnboundFact(namespaceValue: unknown, value: unknown): void {
    try {
      const namespace = text(namespaceValue);
      const record = exact(value, ['factId', 'expectedRevision', 'operationId', 'deadline', 'signal']);
      const factId = text(record.factId);
      const operationId = text(record.operationId, 128);
      const expectedRevision = record.expectedRevision;
      if (!/^[A-Za-z0-9_.-]+$/.test(operationId)
        || typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision)
        || expectedRevision < 1) return queryFail();
      const operation = context(record, queryFail);
      transaction(this.db, () => {
        active(operation, queryFail);
        const existing = this.db.prepare(
          'SELECT operation_id, expected_revision, phase FROM memory_erasure_intents WHERE namespace = ? AND fact_id = ?',
        ).get(namespace, factId) as Row | undefined;
        if (existing !== undefined) {
          if (existing.operation_id === operationId && existing.expected_revision === expectedRevision
            && existing.phase === 'completed') return;
          return queryFail('REVISION_CONFLICT');
        }
        const head = this.db.prepare(`SELECT MAX(revision) AS revision FROM memory_facts
          WHERE namespace = ? AND fact_id = ?`).get(namespace, factId) as Row;
        if (head.revision === null) return queryFail('NOT_FOUND');
        if (head.revision !== expectedRevision) return queryFail('REVISION_CONFLICT');
        if (this.db.prepare('SELECT 1 FROM memory_feed_bindings WHERE namespace = ? LIMIT 1')
          .get(namespace) !== undefined) return queryFail('SCOPE_DENIED');
        this.db.prepare('DELETE FROM memory_public_sources WHERE namespace = ? AND fact_id = ?')
          .run(namespace, factId);
        this.db.prepare('DELETE FROM memory_user_revisions WHERE namespace = ? AND fact_id = ?')
          .run(namespace, factId);
        this.db.prepare('DELETE FROM memory_user_creations WHERE namespace = ? AND fact_id = ?')
          .run(namespace, factId);
        this.invalidateFactSnapshots(namespace, factId);
        this.db.prepare('DELETE FROM memory_facts WHERE namespace = ? AND fact_id = ?')
          .run(namespace, factId);
        this.db.prepare(
          "INSERT INTO memory_erasure_intents(namespace, fact_id, operation_id, expected_revision, phase) VALUES (?, ?, ?, ?, 'completed')",
        ).run(namespace, factId, operationId, expectedRevision);
        active(operation, queryFail);
      }, () => active(operation, queryFail));
      this.checkpointErasureWal();
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail();
    }
  }

  /** Hide one fact and rewrite shared delivery records without dropping other entries. */
  beginFactErasure(namespaceValue: unknown, value: unknown): void {
    try {
      const namespace = text(namespaceValue);
      const record = exact(value, ['factId', 'expectedRevision', 'operationId', 'deadline', 'signal']);
      const factId = text(record.factId);
      const operationId = text(record.operationId, 128);
      const expectedRevision = record.expectedRevision;
      if (!/^[A-Za-z0-9_.-]+$/.test(operationId)
        || typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision)
        || expectedRevision < 1) return queryFail();
      const operation = context(record, queryFail);
      transaction(this.db, () => {
        active(operation, queryFail);
        const existing = this.db.prepare(
          'SELECT operation_id, expected_revision FROM memory_erasure_intents WHERE namespace = ? AND fact_id = ?',
        ).get(namespace, factId) as Row | undefined;
        if (existing !== undefined) {
          if (existing.operation_id !== operationId || existing.expected_revision !== expectedRevision) {
            return queryFail('REVISION_CONFLICT');
          }
          return;
        }
        const head = this.db.prepare(
          'SELECT MAX(revision) AS revision FROM memory_facts WHERE namespace = ? AND fact_id = ?',
        ).get(namespace, factId) as Row;
        if (head.revision === null) return queryFail('NOT_FOUND');
        if (head.revision !== expectedRevision) return queryFail('REVISION_CONFLICT');
        this.db.prepare(
          "INSERT INTO memory_erasure_intents(namespace, fact_id, operation_id, expected_revision, phase) VALUES (?, ?, ?, ?, 'pending')",
        ).run(namespace, factId, operationId, expectedRevision);

        this.invalidateFactSnapshots(namespace, factId);

        const bindings = this.db.prepare([
          'SELECT consumer_id, binding_id, bootstrap_entries_json, bootstrap_offset, mode,',
          'pending_batch_token',
          'FROM memory_feed_bindings WHERE namespace = ?',
        ].join(' ')).all(namespace) as Row[];
        const bootstrap = new Map<string, FactChangeEntry[]>();
        for (const binding of bindings) {
          if (typeof binding.bootstrap_entries_json !== 'string') continue;
          const entries = parseJson<FactChangeEntry[]>(rowText(binding, 'bootstrap_entries_json'));
          bootstrap.set(rowText(binding, 'binding_id'), entries);
          const removedBefore = entries.slice(0, rowNumber(binding, 'bootstrap_offset'))
            .filter(entry => entry.fact.id === factId).length;
          if (!entries.some(entry => entry.fact.id === factId)) continue;
          const retained = entries.filter(entry => entry.fact.id !== factId);
          const nextOffset = rowNumber(binding, 'bootstrap_offset') - removedBefore;
          this.db.prepare([
            'UPDATE memory_feed_bindings SET bootstrap_entries_json = ?, bootstrap_offset = ?',
            'WHERE namespace = ? AND consumer_id = ?',
          ].join(' ')).run(JSON.stringify(retained), nextOffset,
            namespace, rowText(binding, 'consumer_id'));
          if (binding.mode === 'bootstrap' && binding.pending_batch_token === null
            && nextOffset === retained.length) {
            this.db.prepare([
              "UPDATE memory_feed_bindings SET mode = 'changes', changes_after = bootstrap_watermark",
              'WHERE namespace = ? AND consumer_id = ?',
            ].join(' ')).run(namespace, rowText(binding, 'consumer_id'));
          }
        }
        const deliveries = this.db.prepare([
          'SELECT batch_token, binding_id, batch_json, next_bootstrap_offset, confirmed',
          'FROM memory_feed_deliveries WHERE namespace = ?',
        ].join(' ')).all(namespace) as Row[];
        for (const delivery of deliveries) {
          const batch = parseJson<FactChangeBatch>(rowText(delivery, 'batch_json'));
          const entries = batch.entries.filter(entry => entry.fact.id !== factId);
          const originalNextOffset = optionalNumber(delivery, 'next_bootstrap_offset');
          let nextOffset = originalNextOffset;
          let atWatermark = batch.atWatermark;
          if (nextOffset !== undefined) {
            const original = bootstrap.get(rowText(delivery, 'binding_id'));
            if (original !== undefined) {
              nextOffset -= original.slice(0, nextOffset)
                .filter(entry => entry.fact.id === factId).length;
              atWatermark = nextOffset === original.filter(entry => entry.fact.id !== factId).length;
            }
          }
          if (entries.length === batch.entries.length && nextOffset === originalNextOffset
            && atWatermark === batch.atWatermark) continue;
          this.db.prepare([
            'UPDATE memory_feed_deliveries SET batch_json = ?, next_bootstrap_offset = ?,',
            'confirmed_handled_key = CASE WHEN confirmed = 1 THEN ? ELSE NULL END',
            'WHERE batch_token = ?',
          ].join(' ')).run(JSON.stringify({...batch, entries, atWatermark}),
            nextOffset ?? null, handledKey(entries),
            rowText(delivery, 'batch_token'));
        }
        active(operation, queryFail);
      }, () => active(operation, queryFail));
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail();
    }
  }

  /** Host-only second phase after a durable Runtime receipt has been read back. */
  completeFactErasure(namespaceValue: unknown, value: unknown): void {
    try {
      const namespace = text(namespaceValue);
      const record = exact(value, ['factId', 'expectedRevision', 'operationId', 'runtimeReceipt',
        'deadline', 'signal']);
      const factId = text(record.factId);
      const operationId = text(record.operationId, 128);
      const expectedRevision = record.expectedRevision;
      const proof = exact(record.runtimeReceipt, ['graphNamespace', 'memoryNamespace', 'factId',
        'operationId', 'expectedGraphRevision', 'committedAt']);
      text(proof.graphNamespace);
      time(proof.committedAt);
      if (!/^[A-Za-z0-9_.-]+$/.test(operationId)
        || !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1
        || proof.memoryNamespace !== namespace
        || proof.factId !== factId || proof.operationId !== operationId
        || !Number.isSafeInteger(proof.expectedGraphRevision)
        || (proof.expectedGraphRevision as number) < 0) return queryFail();
      const operation = context(record, queryFail);
      transaction(this.db, () => {
        active(operation, queryFail);
        const intent = this.db.prepare(
          'SELECT operation_id, expected_revision, phase FROM memory_erasure_intents WHERE namespace = ? AND fact_id = ?',
        ).get(namespace, factId) as Row | undefined;
        if (intent === undefined) return queryFail('NOT_FOUND');
        if (intent.operation_id !== operationId || intent.expected_revision !== expectedRevision) {
          return queryFail('REVISION_CONFLICT');
        }
        if (intent.phase === 'completed') {
          if (this.db.prepare('SELECT 1 FROM memory_facts WHERE namespace = ? AND fact_id = ? LIMIT 1')
            .get(namespace, factId) !== undefined
            || this.db.prepare('SELECT 1 FROM memory_public_sources WHERE namespace = ? AND fact_id = ? LIMIT 1')
              .get(namespace, factId) !== undefined) return queryFail('SCOPE_DENIED');
          return;
        }
        if (intent.phase !== 'pending') return queryFail();
        const head = this.db.prepare('SELECT MAX(revision) AS revision FROM memory_facts WHERE namespace = ? AND fact_id = ?')
          .get(namespace, factId) as Row;
        if (head.revision !== expectedRevision) return queryFail('REVISION_CONFLICT');
        const bindings = this.db.prepare('SELECT bootstrap_entries_json FROM memory_feed_bindings WHERE namespace = ?')
          .all(namespace) as Row[];
        for (const binding of bindings) {
          if (binding.bootstrap_entries_json !== null
            && parseJson<FactChangeEntry[]>(rowText(binding, 'bootstrap_entries_json'))
              .some(entry => entry.fact.id === factId)) return queryFail('SCOPE_DENIED');
        }
        const deliveries = this.db.prepare(
          'SELECT batch_json, confirmed, confirmed_handled_key FROM memory_feed_deliveries WHERE namespace = ?',
        ).all(namespace) as Row[];
        for (const delivery of deliveries) {
          const batch = parseJson<FactChangeBatch>(rowText(delivery, 'batch_json'));
          if (batch.entries.some(entry => entry.fact.id === factId)
            || (delivery.confirmed === 1
              && delivery.confirmed_handled_key !== handledKey(batch.entries))) {
            return queryFail('SCOPE_DENIED');
          }
        }
        this.db.prepare('DELETE FROM memory_public_sources WHERE namespace = ? AND fact_id = ?')
          .run(namespace, factId);
        this.db.prepare('DELETE FROM memory_user_revisions WHERE namespace = ? AND fact_id = ?')
          .run(namespace, factId);
        this.db.prepare('DELETE FROM memory_user_creations WHERE namespace = ? AND fact_id = ?')
          .run(namespace, factId);
        const removed = this.db.prepare('DELETE FROM memory_facts WHERE namespace = ? AND fact_id = ?')
          .run(namespace, factId);
        if (Number(removed.changes) !== expectedRevision) return queryFail('SCOPE_DENIED');
        this.db.prepare("UPDATE memory_erasure_intents SET phase = 'completed' WHERE namespace = ? AND fact_id = ?")
          .run(namespace, factId);
        active(operation, queryFail);
      }, () => active(operation, queryFail));
      this.checkpointErasureWal();
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail();
    }
  }

  private appendFact(namespace: string, next: FactVersion): FactVersion {
    if (this.db.prepare('SELECT 1 FROM memory_erasure_intents WHERE namespace = ? AND fact_id = ?')
      .get(namespace, next.ref.id) !== undefined) return queryFail('SCOPE_DENIED');
    const namespaceRow = this.db.prepare('SELECT sequence FROM memory_namespaces WHERE namespace = ?')
      .get(namespace) as Row | undefined;
    if (namespaceRow === undefined) return queryFail('NOT_FOUND');
    const previousRow = this.db.prepare(
      'SELECT payload FROM memory_facts WHERE namespace = ? AND fact_id = ? ORDER BY revision DESC LIMIT 1',
    ).get(namespace, next.ref.id) as Row | undefined;
    const previous = previousRow === undefined ? undefined : fact(parseJson(rowText(previousRow, 'payload')));
    if (next.ref.revision !== (previous?.ref.revision ?? 0) + 1) return queryFail();
    if (previous === undefined) {
      if (next.corrects !== undefined || next.state === 'withdrawn') return queryFail();
    } else if (next.corrects === undefined
      || next.corrects.id !== previous.ref.id
      || next.corrects.revision !== previous.ref.revision) return queryFail();

    const sequence = rowNumber(namespaceRow, 'sequence') + 1;
    this.db.prepare(`INSERT INTO memory_facts(
      namespace, sequence, event_id, fact_id, revision, sensitivity, state,
      source_ref, valid_from_ms, valid_until_ms, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      namespace, sequence, token('memory-feed-event'), next.ref.id, next.ref.revision,
      next.sensitivity, next.state, next.sourceRef, Date.parse(next.validFrom),
      Date.parse(next.validUntil), JSON.stringify(next),
    );
    this.db.prepare('UPDATE memory_namespaces SET sequence = ? WHERE namespace = ?').run(sequence, namespace);
    if (previous !== undefined && previous.sensitivity !== next.sensitivity) {
      const bindings = this.db.prepare(
        'SELECT consumer_id, allowed_json FROM memory_feed_bindings WHERE namespace = ? AND valid = 1',
      ).all(namespace) as Row[];
      for (const binding of bindings) {
        const allowed = new Set(parseJson<FactSensitivity[]>(rowText(binding, 'allowed_json')));
        if (allowed.has(previous.sensitivity) && !allowed.has(next.sensitivity)) {
          this.db.prepare('UPDATE memory_feed_bindings SET valid = 0 WHERE namespace = ? AND consumer_id = ?')
            .run(namespace, rowText(binding, 'consumer_id'));
        }
      }
    }
    return structuredClone(next);
  }

  /** Host-only first user-confirmed private fact after authorization outside this port. */
  createUserFact(namespaceValue: unknown, value: unknown): {
    readonly fact: FactVersion;
    readonly appended: boolean;
  } {
    try {
      const namespace = text(namespaceValue);
      const record = exact(value, ['factId', 'operationId', 'summary', 'sourceRef',
        'observedAt', 'validFrom', 'validUntil', 'deadline', 'signal']);
      const factId = text(record.factId);
      const operationId = text(record.operationId, 128);
      if (!/^[A-Za-z0-9_.-]+$/.test(operationId)) return queryFail();
      const operation = context(record, queryFail);
      const next = fact({ref: {id: factId, revision: 1}, summary: record.summary,
        sourceRef: record.sourceRef, observedAt: record.observedAt,
        validFrom: record.validFrom, validUntil: record.validUntil,
        sensitivity: 'private', state: 'active', confirmation: 'user_confirmed'});
      const fingerprint = createHash('sha256').update(JSON.stringify(next)).digest('hex');
      return transaction(this.db, () => {
        active(operation, queryFail);
        if (this.db.prepare('SELECT 1 FROM memory_erasure_intents WHERE namespace = ? AND fact_id = ?')
          .get(namespace, factId) !== undefined) return queryFail('SCOPE_DENIED');
        const receipt = this.db.prepare(`SELECT namespace, fact_id, fingerprint
          FROM memory_user_creations WHERE operation_id = ?`).get(operationId) as Row | undefined;
        if (receipt !== undefined) {
          if (receipt.namespace !== namespace || receipt.fact_id !== factId
            || receipt.fingerprint !== fingerprint) return queryFail('REVISION_CONFLICT');
          const saved = this.db.prepare(`SELECT payload FROM memory_facts
            WHERE namespace = ? AND fact_id = ? AND revision = 1`)
            .get(namespace, factId) as Row | undefined;
          if (saved === undefined) return queryFail('SCOPE_DENIED');
          return {fact: fact(parseJson(rowText(saved, 'payload'))), appended: false};
        }
        if (this.db.prepare('SELECT 1 FROM memory_public_sources WHERE namespace = ? AND fact_id = ?')
          .get(namespace, factId) !== undefined) return queryFail('SCOPE_DENIED');
        if (this.db.prepare('SELECT 1 FROM memory_facts WHERE namespace = ? AND fact_id = ? LIMIT 1')
          .get(namespace, factId) !== undefined) return queryFail('REVISION_CONFLICT');
        const saved = this.appendFact(namespace, next);
        this.db.prepare(`INSERT INTO memory_user_creations(
          operation_id, namespace, fact_id, fact_revision, fingerprint
        ) VALUES (?, ?, ?, 1, ?)`).run(operationId, namespace, factId, fingerprint);
        return {fact: saved, appended: true};
      }, () => active(operation, queryFail));
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail();
    }
  }

  /** Trusted source invalidation only. Preserves the confirmed text/history; grants no new fact or deletion authority. */
  invalidateUserFactSource(namespaceValue: unknown, value: unknown): {readonly fact: FactVersion; readonly appended: boolean} {
    try {
      const namespace = text(namespaceValue);
      const record = exact(value, ['factId', 'expectedRevision', 'sourceRef', 'observedAt', 'deadline', 'signal']);
      const operation = context(record, queryFail);
      const factId = text(record.factId);
      const sourceRef = text(record.sourceRef, MAX_SOURCE);
      const observedAt = time(record.observedAt).text;
      if (!Number.isSafeInteger(record.expectedRevision) || (record.expectedRevision as number) < 1) return queryFail();
      return transaction(this.db, () => {
        active(operation, queryFail);
        if (this.db.prepare('SELECT 1 FROM memory_user_creations WHERE namespace = ? AND fact_id = ?')
          .get(namespace, factId) === undefined) return queryFail('SCOPE_DENIED');
        const current = this.readUserFactHead(namespace, factId);
        if (!current) return queryFail('NOT_FOUND');
        if (current.ref.revision !== record.expectedRevision || current.sourceRef !== sourceRef) return queryFail('REVISION_CONFLICT');
        if (current.state === 'withdrawn') return {fact: current, appended: false};
        const next = fact({...current, ref: {id: factId, revision: current.ref.revision + 1},
          state: 'withdrawn', confirmation: 'external_observation', observedAt, corrects: current.ref});
        return {fact: this.appendFact(namespace, next), appended: true};
      }, () => active(operation, queryFail));
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail();
    }
  }

  /** Host-only user-confirmed correction or withdrawal after authorization outside this port. */
  reviseUserFact(namespaceValue: unknown, value: unknown): {
    readonly fact: FactVersion;
    readonly appended: boolean;
  } {
    try {
      const namespace = text(namespaceValue);
      const record = exact(value, ['factId', 'expectedRevision', 'operationId', 'summary',
        'sourceRef', 'observedAt', 'validFrom', 'validUntil', 'sensitivity', 'state',
        'deadline', 'signal']);
      const factId = text(record.factId);
      const operationId = text(record.operationId, 128);
      const expected = record.expectedRevision;
      if (!/^[A-Za-z0-9_.-]+$/.test(operationId)
        || typeof expected !== 'number' || !Number.isSafeInteger(expected)
        || expected < 1 || expected >= Number.MAX_SAFE_INTEGER) return queryFail();
      const operation = context(record, queryFail);
      const next = fact({ref: {id: factId, revision: expected + 1},
        summary: record.summary, sourceRef: record.sourceRef,
        observedAt: record.observedAt, validFrom: record.validFrom,
        validUntil: record.validUntil, sensitivity: record.sensitivity,
        state: record.state, confirmation: 'user_confirmed',
        corrects: {id: factId, revision: expected}});
      const fingerprint = createHash('sha256').update(JSON.stringify(next)).digest('hex');
      return transaction(this.db, () => {
        active(operation, queryFail);
        if (this.db.prepare('SELECT 1 FROM memory_erasure_intents WHERE namespace = ? AND fact_id = ?')
          .get(namespace, factId) !== undefined) return queryFail('SCOPE_DENIED');
        const receipt = this.db.prepare(`SELECT namespace, fact_id, expected_revision,
          fact_revision, fingerprint FROM memory_user_revisions WHERE operation_id = ?`)
          .get(operationId) as Row | undefined;
        if (receipt !== undefined) {
          if (receipt.namespace !== namespace || receipt.fact_id !== factId
            || receipt.expected_revision !== expected || receipt.fingerprint !== fingerprint
            || receipt.fact_revision !== next.ref.revision) return queryFail('REVISION_CONFLICT');
          const saved = this.db.prepare(`SELECT payload FROM memory_facts
            WHERE namespace = ? AND fact_id = ? AND revision = ?`)
            .get(namespace, factId, next.ref.revision) as Row | undefined;
          if (saved === undefined) return queryFail('SCOPE_DENIED');
          return {fact: fact(parseJson(rowText(saved, 'payload'))), appended: false};
        }
        if (this.db.prepare('SELECT 1 FROM memory_public_sources WHERE namespace = ? AND fact_id = ?')
          .get(namespace, factId) !== undefined) return queryFail('SCOPE_DENIED');
        const head = this.db.prepare(`SELECT MAX(revision) AS revision FROM memory_facts
          WHERE namespace = ? AND fact_id = ?`).get(namespace, factId) as Row;
        if (head.revision === null) return queryFail('NOT_FOUND');
        if (head.revision !== expected) return queryFail('REVISION_CONFLICT');
        const saved = this.appendFact(namespace, next);
        this.db.prepare(`INSERT INTO memory_user_revisions(
          operation_id, namespace, fact_id, expected_revision, fact_revision, fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?)`).run(operationId, namespace, factId,
          expected, next.ref.revision, fingerprint);
        return {fact: saved, appended: true};
      }, () => active(operation, queryFail));
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail();
    }
  }

  readPublicSourceHead(namespaceValue: unknown, keyValue: unknown): number | null {
    try {
      const namespace = text(namespaceValue);
      const key = publicSourceKey(exact(keyValue, ['vaultId', 'path', 'factId']));
      if (this.db.prepare('SELECT 1 FROM memory_namespaces WHERE namespace = ?').get(namespace) === undefined) {
        return queryFail('NOT_FOUND');
      }
      const row = this.db.prepare(`SELECT fact_revision FROM memory_public_sources
        WHERE namespace = ? AND vault_id = ? AND source_path = ? AND fact_id = ?`)
        .get(namespace, key.vaultId, key.path, key.factId) as Row | undefined;
      return row === undefined ? null : rowNumber(row, 'fact_revision');
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail();
    }
  }

  appendPublicSource(namespaceValue: unknown, value: unknown): {
    readonly fact: FactVersion;
    readonly appended: boolean;
  } {
    try {
      const namespace = text(namespaceValue);
      const record = exact(value, ['vaultId', 'path', 'factId', 'sourceRevision', 'line',
        'summary', 'observedAt', 'validFrom', 'validUntil', 'expectedFactRevision',
        'deadline', 'signal']);
      const operation = context(record, queryFail);
      const key = publicSourceKey(record);
      const sourceRevision = text(record.sourceRevision, 64);
      if (!/^[0-9a-f]{64}$/.test(sourceRevision)
        || typeof record.line !== 'number' || !Number.isSafeInteger(record.line)
        || record.line < 1) return queryFail();
      const expected = record.expectedFactRevision;
      if (expected !== null && (typeof expected !== 'number'
        || !Number.isSafeInteger(expected) || expected < 1)) return queryFail();
      const sourceRef = `${key.vaultId}/${key.path}#L${record.line}@${sourceRevision}`;
      const fields = {
        summary: record.summary, sourceRef, observedAt: record.observedAt,
        validFrom: record.validFrom, validUntil: record.validUntil,
        sensitivity: 'public', state: 'active', confirmation: 'external_observation',
      };
      const verified = fact({ref: {id: key.factId, revision: 1}, ...fields});
      const fingerprint = JSON.stringify([verified.summary, verified.sourceRef,
        verified.validFrom, verified.validUntil, verified.sensitivity,
        verified.state, verified.confirmation]);
      return transaction(this.db, () => {
        if (this.db.prepare('SELECT 1 FROM memory_namespaces WHERE namespace = ?').get(namespace) === undefined) {
          return queryFail('NOT_FOUND');
        }
        if (this.db.prepare('SELECT 1 FROM memory_erasure_intents WHERE namespace = ? AND fact_id = ?')
          .get(namespace, key.factId) !== undefined) return queryFail('SCOPE_DENIED');
        const row = this.db.prepare(`SELECT source_revision, fact_revision, fingerprint
          FROM memory_public_sources WHERE namespace = ? AND vault_id = ?
          AND source_path = ? AND fact_id = ?`)
          .get(namespace, key.vaultId, key.path, key.factId) as Row | undefined;
        if (row !== undefined && rowText(row, 'source_revision') === sourceRevision) {
          if (rowText(row, 'fingerprint') !== fingerprint) return queryFail();
          const saved = this.db.prepare(`SELECT payload FROM memory_facts
            WHERE namespace = ? AND fact_id = ? AND revision = ?`)
            .get(namespace, key.factId, rowNumber(row, 'fact_revision')) as Row | undefined;
          if (saved === undefined) return queryFail();
          return {fact: fact(parseJson(rowText(saved, 'payload'))), appended: false};
        }
        if ((row === undefined ? null : rowNumber(row, 'fact_revision')) !== expected) {
          return queryFail('REVISION_CONFLICT');
        }
        if (row === undefined && this.db.prepare(`SELECT 1 FROM memory_facts
          WHERE namespace = ? AND fact_id = ? LIMIT 1`).get(namespace, key.factId) !== undefined) {
          return queryFail();
        }
        const previousRevision = row === undefined ? 0 : rowNumber(row, 'fact_revision');
        const next = fact({
          ...fields,
          ref: {id: key.factId, revision: previousRevision + 1},
          ...(previousRevision === 0 ? {} : {
            corrects: {id: key.factId, revision: previousRevision},
          }),
        });
        const saved = this.appendFact(namespace, next);
        this.db.prepare(`INSERT INTO memory_public_sources(
          namespace, vault_id, source_path, fact_id, source_revision, fact_revision, fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(namespace, vault_id, source_path, fact_id) DO UPDATE SET
          source_revision = excluded.source_revision,
          fact_revision = excluded.fact_revision, fingerprint = excluded.fingerprint`)
          .run(namespace, key.vaultId, key.path, key.factId, sourceRevision,
            next.ref.revision, fingerprint);
        return {fact: saved, appended: true};
      }, () => active(operation, queryFail));
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail();
    }
  }

  /** Host-only tombstone after the caller independently verifies source withdrawal. */
  withdrawPublicSource(namespaceValue: unknown, value: unknown): {
    readonly fact: FactVersion;
    readonly appended: boolean;
  } {
    try {
      const namespace = text(namespaceValue);
      const record = exact(value, ['vaultId', 'path', 'factId', 'withdrawalId',
        'expectedFactRevision', 'observedAt', 'deadline', 'signal']);
      const operation = context(record, queryFail);
      const key = publicSourceKey(record);
      const withdrawalId = text(record.withdrawalId, 128);
      if (!/^[A-Za-z0-9_.-]+$/.test(withdrawalId)
        || typeof record.expectedFactRevision !== 'number'
        || !Number.isSafeInteger(record.expectedFactRevision)
        || record.expectedFactRevision < 1) return queryFail();
      const observedAt = time(record.observedAt).text;
      const marker = `withdrawn:${withdrawalId}`;
      const fingerprint = JSON.stringify([marker, record.expectedFactRevision, observedAt]);
      return transaction(this.db, () => {
        if (this.db.prepare('SELECT 1 FROM memory_erasure_intents WHERE namespace = ? AND fact_id = ?')
          .get(namespace, key.factId) !== undefined) return queryFail('SCOPE_DENIED');
        const row = this.db.prepare(`SELECT source_revision, fact_revision, fingerprint
          FROM memory_public_sources WHERE namespace = ? AND vault_id = ?
          AND source_path = ? AND fact_id = ?`)
          .get(namespace, key.vaultId, key.path, key.factId) as Row | undefined;
        if (row === undefined) return queryFail('NOT_FOUND');
        const currentRevision = rowNumber(row, 'fact_revision');
        if (rowText(row, 'source_revision') === marker) {
          if (rowText(row, 'fingerprint') !== fingerprint
            || currentRevision !== (record.expectedFactRevision as number) + 1) return queryFail('REVISION_CONFLICT');
          const saved = this.db.prepare(`SELECT payload FROM memory_facts
            WHERE namespace = ? AND fact_id = ? AND revision = ?`)
            .get(namespace, key.factId, currentRevision) as Row | undefined;
          if (saved === undefined) return queryFail();
          return {fact: fact(parseJson(rowText(saved, 'payload'))), appended: false};
        }
        if (currentRevision !== record.expectedFactRevision) return queryFail('REVISION_CONFLICT');
        const previousRow = this.db.prepare(`SELECT payload FROM memory_facts
          WHERE namespace = ? AND fact_id = ? AND revision = ?`)
          .get(namespace, key.factId, currentRevision) as Row | undefined;
        if (previousRow === undefined) return queryFail();
        const previous = fact(parseJson(rowText(previousRow, 'payload')));
        if (previous.state !== 'active') return queryFail('REVISION_CONFLICT');
        const next = fact({ref: {id: key.factId, revision: currentRevision + 1},
          summary: 'Public source withdrawn', sourceRef: previous.sourceRef,
          observedAt, validFrom: previous.validFrom, validUntil: previous.validUntil,
          sensitivity: 'public', state: 'withdrawn', confirmation: 'external_observation',
          corrects: previous.ref});
        const saved = this.appendFact(namespace, next);
        this.db.prepare(`UPDATE memory_public_sources SET source_revision = ?,
          fact_revision = ?, fingerprint = ? WHERE namespace = ? AND vault_id = ?
          AND source_path = ? AND fact_id = ?`).run(marker, next.ref.revision, fingerprint,
            namespace, key.vaultId, key.path, key.factId);
        return {fact: saved, appended: true};
      }, () => active(operation, queryFail));
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail();
    }
  }

  bind(namespaceValue: unknown, optionsValue: unknown): MemoryQueryPort {
    let namespace: string;
    let allowed: ReturnType<typeof scope>;
    try {
      namespace = text(namespaceValue);
      allowed = scope(optionsValue, false);
      if (this.db.prepare('SELECT 1 FROM memory_namespaces WHERE namespace = ?').get(namespace) === undefined) {
        return queryFail('NOT_FOUND');
      }
    } catch (error) {
      if (error instanceof MemoryQueryError) throw error;
      return queryFail();
    }

    return Object.freeze({
      listCurrent: async (raw: ListCurrentFactsRequest): Promise<FactPage> => {
        try {
          const record = exact(raw, ['at', 'limit', 'deadline', 'signal'],
            ['factId', 'sourceRef', 'snapshot', 'cursor']);
          const operation = context(record, queryFail);
          const at = time(record.at);
          const factId = record.factId === undefined ? undefined : text(record.factId);
          const sourceRef = record.sourceRef === undefined ? undefined : text(record.sourceRef, MAX_SOURCE);
          const page = parsePage(record);
          await Promise.resolve();
          active(operation, queryFail);
          const result = this.queryPage(namespace, allowed, 'current',
            JSON.stringify({at: at.text, factId: factId ?? null, sourceRef: sourceRef ?? null}),
            page, {
              at: at.milliseconds,
              ...(factId === undefined ? {} : {factId}),
              ...(sourceRef === undefined ? {} : {sourceRef}),
            });
          active(operation, queryFail);
          return structuredClone(result);
        } catch (error) {
          if (error instanceof MemoryQueryError) throw error;
          return queryFail();
        }
      },
      listHistory: async (raw: ListFactHistoryRequest): Promise<FactPage> => {
        try {
          const record = exact(raw, ['factId', 'limit', 'deadline', 'signal'], ['snapshot', 'cursor']);
          const operation = context(record, queryFail);
          const factId = text(record.factId);
          const page = parsePage(record);
          await Promise.resolve();
          active(operation, queryFail);
          const result = this.queryPage(namespace, allowed, 'history',
            JSON.stringify({factId}), page, {factId});
          active(operation, queryFail);
          return structuredClone(result);
        } catch (error) {
          if (error instanceof MemoryQueryError) throw error;
          return queryFail();
        }
      },
      getVersion: async (raw: GetFactVersionRequest): Promise<FactVersion> => {
        try {
          const record = exact(raw, ['fact', 'deadline', 'signal']);
          const operation = context(record, queryFail);
          const requested = ref(record.fact);
          await Promise.resolve();
          active(operation, queryFail);
          const row = this.db.prepare(
            `SELECT f.payload, f.sensitivity FROM memory_facts f
              WHERE f.namespace = ? AND f.fact_id = ? AND f.revision = ?
              AND NOT EXISTS (SELECT 1 FROM memory_erasure_intents e
                WHERE e.namespace = f.namespace AND e.fact_id = f.fact_id)`,
          ).get(namespace, requested.id, requested.revision) as Row | undefined;
          if (row === undefined || !allowed.values.includes(rowText(row, 'sensitivity') as FactSensitivity)) {
            return queryFail('SCOPE_DENIED');
          }
          const result = fact(parseJson(rowText(row, 'payload')));
          active(operation, queryFail);
          return structuredClone(result);
        } catch (error) {
          if (error instanceof MemoryQueryError) throw error;
          return queryFail();
        }
      },
    });
  }

  bindFeed(namespaceValue: unknown, optionsValue: unknown): FactChangeFeedPort {
    let namespace: string;
    let allowed: ReturnType<typeof scope>;
    let bindingId: string;
    try {
      namespace = text(namespaceValue);
      allowed = scope(optionsValue, true);
      if (this.db.prepare('SELECT 1 FROM memory_namespaces WHERE namespace = ?').get(namespace) === undefined) {
        return feedFail('SCOPE_DENIED');
      }
      bindingId = transaction(this.db, () => {
        const current = this.db.prepare(
          'SELECT binding_id, scope_key, valid FROM memory_feed_bindings WHERE namespace = ? AND consumer_id = ?',
        ).get(namespace, allowed.consumerId!) as Row | undefined;
        if (current !== undefined && rowNumber(current, 'valid') === 1
          && rowText(current, 'scope_key') === allowed.key) return rowText(current, 'binding_id');
        const nextBinding = token('memory-feed-binding');
        this.db.prepare(`INSERT INTO memory_feed_bindings(
          namespace, consumer_id, binding_id, scope_key, allowed_json, valid, checkpoint, mode,
          bootstrap_watermark, bootstrap_watermark_token, bootstrap_entries_json,
          bootstrap_offset, changes_after, pending_batch_token
        ) VALUES (?, ?, ?, ?, ?, 1, ?, 'bootstrap', NULL, NULL, NULL, 0, 0, NULL)
        ON CONFLICT(namespace, consumer_id) DO UPDATE SET
          binding_id = excluded.binding_id, scope_key = excluded.scope_key,
          allowed_json = excluded.allowed_json, valid = 1, checkpoint = excluded.checkpoint,
          mode = 'bootstrap', bootstrap_watermark = NULL, bootstrap_watermark_token = NULL,
          bootstrap_entries_json = NULL, bootstrap_offset = 0, changes_after = 0,
          pending_batch_token = NULL`).run(
          namespace, allowed.consumerId!, nextBinding, allowed.key,
          JSON.stringify(allowed.values), token('memory-feed-checkpoint'),
        );
        return nextBinding;
      });
    } catch (error) {
      if (error instanceof FactChangeFeedError) throw error;
      return feedFail();
    }

    return Object.freeze({
      read: async (raw: ReadFactChangesRequest): Promise<FactChangeBatch> => {
        try {
          const record = exact(raw, ['limit', 'deadline', 'signal']);
          const operation = context(record, feedFail);
          if (typeof record.limit !== 'number' || !Number.isSafeInteger(record.limit)
            || record.limit < 1 || record.limit > MAX_PAGE) return feedFail();
          await Promise.resolve();
          active(operation, feedFail);
          const batch = transaction(this.db, () => this.readFeedBatch(
            namespace, allowed.consumerId!, bindingId, allowed.values, record.limit as number,
          ), () => active(operation, feedFail));
          active(operation, feedFail);
          return cloneBatch(batch);
        } catch (error) {
          if (error instanceof FactChangeFeedError) throw error;
          return feedFail();
        }
      },
    });
  }

  confirmFeedBatch(namespaceValue: unknown, consumerValue: unknown, requestValue: unknown): FactChangeReceipt {
    try {
      const namespace = text(namespaceValue);
      const consumerId = text(consumerValue);
      const record = exact(requestValue, ['batchToken', 'expectedCheckpoint', 'handled', 'deadline', 'signal']);
      const operation = context(record, feedFail);
      const batchToken = text(record.batchToken);
      const expectedCheckpoint = text(record.expectedCheckpoint);
      const handled = parseHandled(record.handled);
      active(operation, feedFail);
      return transaction(this.db, () => {
        const delivery = this.db.prepare('SELECT * FROM memory_feed_deliveries WHERE batch_token = ?')
          .get(batchToken) as Row | undefined;
        if (delivery === undefined || rowText(delivery, 'namespace') !== namespace
          || rowText(delivery, 'consumer_id') !== consumerId) return feedFail('SCOPE_DENIED');
        const binding = this.db.prepare(
          'SELECT * FROM memory_feed_bindings WHERE namespace = ? AND consumer_id = ?',
        ).get(namespace, consumerId) as Row | undefined;
        if (binding === undefined) return feedFail('SCOPE_DENIED');
        if (rowNumber(binding, 'valid') !== 1
          || rowText(binding, 'binding_id') !== rowText(delivery, 'binding_id')) return feedFail('REBUILD_REQUIRED');

        const suppliedHandled = handledKey(handled);
        const batch = parseJson<FactChangeBatch>(rowText(delivery, 'batch_json'));
        if (rowNumber(delivery, 'confirmed') === 1) {
          if (expectedCheckpoint !== rowText(delivery, 'confirmed_expected_checkpoint')) {
            return feedFail('REVISION_CONFLICT');
          }
          if (suppliedHandled !== rowText(delivery, 'confirmed_handled_key')) return feedFail();
          return {batchToken, checkpoint: rowText(delivery, 'receipt_checkpoint')};
        }
        if (binding.pending_batch_token !== batchToken) return feedFail('SCOPE_DENIED');
        if (expectedCheckpoint !== batch.baseCheckpoint
          || rowText(binding, 'checkpoint') !== batch.baseCheckpoint) return feedFail('REVISION_CONFLICT');
        if (suppliedHandled !== handledKey(batch.entries)) return feedFail();

        const nextCheckpoint = token('memory-feed-checkpoint');
        if (batch.mode === 'bootstrap') {
          const nextOffset = optionalNumber(delivery, 'next_bootstrap_offset');
          if (nextOffset === undefined) throw new Error('Missing bootstrap offset');
          if (batch.atWatermark) {
            this.db.prepare(`UPDATE memory_feed_bindings SET bootstrap_offset = ?, mode = 'changes',
              changes_after = bootstrap_watermark, checkpoint = ?, pending_batch_token = NULL
              WHERE namespace = ? AND consumer_id = ?`).run(nextOffset, nextCheckpoint, namespace, consumerId);
          } else {
            this.db.prepare(`UPDATE memory_feed_bindings SET bootstrap_offset = ?, checkpoint = ?,
              pending_batch_token = NULL WHERE namespace = ? AND consumer_id = ?`)
              .run(nextOffset, nextCheckpoint, namespace, consumerId);
          }
        } else {
          const nextPosition = optionalNumber(delivery, 'next_changes_after');
          if (nextPosition === undefined) throw new Error('Missing changes position');
          this.db.prepare(`UPDATE memory_feed_bindings SET changes_after = ?, checkpoint = ?,
            pending_batch_token = NULL WHERE namespace = ? AND consumer_id = ?`)
            .run(nextPosition, nextCheckpoint, namespace, consumerId);
        }
        this.db.prepare(`UPDATE memory_feed_deliveries SET confirmed = 1,
          confirmed_expected_checkpoint = ?, confirmed_handled_key = ?, receipt_checkpoint = ?
          WHERE batch_token = ?`).run(expectedCheckpoint, suppliedHandled, nextCheckpoint, batchToken);
        return {batchToken, checkpoint: nextCheckpoint};
      }, () => active(operation, feedFail));
    } catch (error) {
      if (error instanceof FactChangeFeedError) throw error;
      return feedFail();
    }
  }

  /** Trusted recovery read for a delivery already selected by this consumer. */
  readFeedDelivery(namespaceValue: unknown, consumerValue: unknown, requestValue: unknown): FactChangeBatch {
    try {
      const namespace = text(namespaceValue);
      const consumerId = text(consumerValue);
      const record = exact(requestValue, ['batchToken', 'deadline', 'signal']);
      const batchToken = text(record.batchToken);
      const operation = context(record, feedFail);
      active(operation, feedFail);
      const row = this.db.prepare([
        'SELECT batch_json FROM memory_feed_deliveries',
        'WHERE namespace = ? AND consumer_id = ? AND batch_token = ?',
      ].join(' ')).get(namespace, consumerId, batchToken) as Row | undefined;
      if (row === undefined) return feedFail('SCOPE_DENIED');
      const batch = parseFactChangeBatch(parseJson(rowText(row, 'batch_json')));
      active(operation, feedFail);
      return batch;
    } catch (error) {
      if (error instanceof FactChangeFeedError) throw error;
      return feedFail();
    }
  }

  private queryPage(
    namespace: string,
    allowed: ReturnType<typeof scope>,
    mode: 'current' | 'history',
    filterKey: string,
    page: PageOptions,
    criteria: {readonly at?: number; readonly factId?: string; readonly sourceRef?: string;
      readonly privateAdminHeads?: boolean},
  ): FactPage {
    let snapshot = page.snapshot;
    let watermark: number;
    if (snapshot === undefined) {
      const namespaceRow = this.db.prepare('SELECT sequence FROM memory_namespaces WHERE namespace = ?')
        .get(namespace) as Row | undefined;
      if (namespaceRow === undefined) return queryFail('NOT_FOUND');
      watermark = rowNumber(namespaceRow, 'sequence');
      snapshot = token('memory-snapshot');
      this.db.prepare(`INSERT INTO memory_query_snapshots(
        token, namespace, scope_key, mode, filter_key, watermark
      ) VALUES (?, ?, ?, ?, ?, ?)`).run(
        snapshot, namespace, allowed.key, mode, filterKey, watermark,
      );
    } else {
      const snapshotRow = this.db.prepare('SELECT * FROM memory_query_snapshots WHERE token = ?')
        .get(snapshot) as Row | undefined;
      if (snapshotRow === undefined
        || rowText(snapshotRow, 'namespace') !== namespace
        || rowText(snapshotRow, 'scope_key') !== allowed.key
        || rowText(snapshotRow, 'mode') !== mode
        || rowText(snapshotRow, 'filter_key') !== filterKey) return queryFail();
      watermark = rowNumber(snapshotRow, 'watermark');
    }

    let offset = 0;
    if (page.cursor !== undefined) {
      const cursorRow = this.db.prepare(
        'SELECT snapshot_token, offset FROM memory_query_cursors WHERE token = ?',
      ).get(page.cursor) as Row | undefined;
      if (cursorRow === undefined || rowText(cursorRow, 'snapshot_token') !== snapshot) return queryFail();
      offset = rowNumber(cursorRow, 'offset');
    }

    const placeholders = allowed.values.map(() => '?').join(', ');
    let rows: Row[];
    if (mode === 'current') {
      const clauses = [
        'f.namespace = ?',
        'f.sequence <= ?',
        'NOT EXISTS (SELECT 1 FROM memory_erasure_intents e WHERE e.namespace = f.namespace AND e.fact_id = f.fact_id)',
        `f.sensitivity IN (${placeholders})`,
      ];
      const parameters: (string | number)[] = [
        namespace, watermark, ...allowed.values,
      ];
      if (criteria.privateAdminHeads) {
        clauses.push("(json_extract(f.payload, '$.confirmation') = 'user_confirmed' OR (f.state = 'withdrawn'"
          + " AND json_extract(f.payload, '$.confirmation') = 'external_observation' AND EXISTS (SELECT 1"
          + " FROM memory_user_creations u WHERE u.namespace = f.namespace AND u.fact_id = f.fact_id)))");
      } else {
        clauses.push("f.state = 'active'", 'f.valid_from_ms <= ?', '? < f.valid_until_ms');
        parameters.push(criteria.at!, criteria.at!);
      }
      if (criteria.factId !== undefined) { clauses.push('f.fact_id = ?'); parameters.push(criteria.factId); }
      if (criteria.sourceRef !== undefined) { clauses.push('f.source_ref = ?'); parameters.push(criteria.sourceRef); }
      rows = this.db.prepare(`SELECT f.payload FROM memory_facts f
        JOIN (
          SELECT fact_id, MAX(revision) revision FROM memory_facts
          WHERE namespace = ? AND sequence <= ? GROUP BY fact_id
        ) latest ON latest.fact_id = f.fact_id AND latest.revision = f.revision
        WHERE ${clauses.join(' AND ')}
        ORDER BY f.fact_id, f.revision LIMIT ? OFFSET ?`).all(
        namespace, watermark, ...parameters, page.limit + 1, offset,
      ) as Row[];
    } else {
      rows = this.db.prepare(`SELECT f.payload FROM memory_facts f
        WHERE f.namespace = ? AND f.sequence <= ? AND f.fact_id = ?
          AND f.sensitivity IN (${placeholders})
          AND NOT EXISTS (SELECT 1 FROM memory_erasure_intents e
            WHERE e.namespace = f.namespace AND e.fact_id = f.fact_id)
        ORDER BY f.fact_id, f.revision LIMIT ? OFFSET ?`).all(
        namespace, watermark, criteria.factId!, ...allowed.values, page.limit + 1, offset,
      ) as Row[];
    }

    const hasMore = rows.length > page.limit;
    const facts = rows.slice(0, page.limit).map(row => fact(parseJson(rowText(row, 'payload'))));
    if (!hasMore) return {snapshot, facts};
    const nextCursor = token('memory-cursor');
    this.db.prepare('INSERT INTO memory_query_cursors(token, snapshot_token, offset) VALUES (?, ?, ?)')
      .run(nextCursor, snapshot, offset + facts.length);
    return {snapshot, facts, nextCursor};
  }

  private readFeedBatch(
    namespace: string,
    consumerId: string,
    bindingId: string,
    allowed: readonly FactSensitivity[],
    limit: number,
  ): FactChangeBatch {
    const binding = this.db.prepare(
      'SELECT * FROM memory_feed_bindings WHERE namespace = ? AND consumer_id = ?',
    ).get(namespace, consumerId) as Row | undefined;
    if (binding === undefined) return feedFail('SCOPE_DENIED');
    if (rowNumber(binding, 'valid') !== 1 || rowText(binding, 'binding_id') !== bindingId) {
      return feedFail('REBUILD_REQUIRED');
    }
    if (typeof binding.pending_batch_token === 'string') {
      const pending = this.db.prepare('SELECT batch_json FROM memory_feed_deliveries WHERE batch_token = ?')
        .get(binding.pending_batch_token) as Row | undefined;
      if (pending === undefined) throw new Error('Missing pending delivery');
      return parseJson<FactChangeBatch>(rowText(pending, 'batch_json'));
    }

    const mode = rowText(binding, 'mode') as FactChangeBatch['mode'];
    let batch: FactChangeBatch;
    let nextBootstrapOffset: number | undefined;
    let nextChangesAfter: number | undefined;
    if (mode === 'bootstrap') {
      let watermark = optionalNumber(binding, 'bootstrap_watermark');
      let watermarkToken = typeof binding.bootstrap_watermark_token === 'string'
        ? binding.bootstrap_watermark_token : undefined;
      let entries = typeof binding.bootstrap_entries_json === 'string'
        ? parseJson<FactChangeEntry[]>(binding.bootstrap_entries_json) : undefined;
      if (watermark === undefined) {
        const namespaceRow = this.db.prepare('SELECT sequence FROM memory_namespaces WHERE namespace = ?')
          .get(namespace) as Row;
        watermark = rowNumber(namespaceRow, 'sequence');
        watermarkToken = token('memory-feed-watermark');
        const placeholders = allowed.map(() => '?').join(', ');
        const rows = this.db.prepare(`SELECT f.event_id, f.fact_id, f.revision FROM memory_facts f
          JOIN (
            SELECT fact_id, MAX(revision) revision FROM memory_facts
            WHERE namespace = ? AND sequence <= ? GROUP BY fact_id
          ) latest ON latest.fact_id = f.fact_id AND latest.revision = f.revision
          WHERE f.namespace = ? AND f.sequence <= ? AND f.sensitivity IN (${placeholders})
            AND NOT EXISTS (SELECT 1 FROM memory_erasure_intents e
              WHERE e.namespace = f.namespace AND e.fact_id = f.fact_id)
          ORDER BY f.fact_id, f.revision`).all(
          namespace, watermark, namespace, watermark, ...allowed,
        ) as Row[];
        entries = rows.map(row => ({
          eventId: rowText(row, 'event_id'),
          fact: {id: rowText(row, 'fact_id'), revision: rowNumber(row, 'revision')},
        }));
        this.db.prepare(`UPDATE memory_feed_bindings SET bootstrap_watermark = ?,
          bootstrap_watermark_token = ?, bootstrap_entries_json = ?
          WHERE namespace = ? AND consumer_id = ?`).run(
          watermark, watermarkToken, JSON.stringify(entries), namespace, consumerId,
        );
      }
      const offset = rowNumber(binding, 'bootstrap_offset');
      const selected = entries!.slice(offset, offset + limit);
      nextBootstrapOffset = offset + selected.length;
      batch = {
        mode,
        batchToken: token('memory-feed-batch'),
        baseCheckpoint: rowText(binding, 'checkpoint'),
        watermark: watermarkToken!,
        entries: selected.map(cloneEntry),
        atWatermark: nextBootstrapOffset === entries!.length,
      };
    } else {
      const namespaceRow = this.db.prepare('SELECT sequence FROM memory_namespaces WHERE namespace = ?')
        .get(namespace) as Row;
      const watermark = rowNumber(namespaceRow, 'sequence');
      const changesAfter = rowNumber(binding, 'changes_after');
      const placeholders = allowed.map(() => '?').join(', ');
      const rows = this.db.prepare(`SELECT f.sequence, f.event_id, f.fact_id, f.revision FROM memory_facts f
        WHERE f.namespace = ? AND f.sequence > ? AND f.sequence <= ? AND f.sensitivity IN (${placeholders})
          AND NOT EXISTS (SELECT 1 FROM memory_erasure_intents e
            WHERE e.namespace = f.namespace AND e.fact_id = f.fact_id)
        ORDER BY f.sequence LIMIT ?`).all(
        namespace, changesAfter, watermark, ...allowed, limit + 1,
      ) as Row[];
      const selected = rows.slice(0, limit);
      const atWatermark = rows.length <= limit;
      nextChangesAfter = atWatermark ? watermark : rowNumber(selected.at(-1)!, 'sequence');
      batch = {
        mode,
        batchToken: token('memory-feed-batch'),
        baseCheckpoint: rowText(binding, 'checkpoint'),
        watermark: token('memory-feed-watermark'),
        entries: selected.map(row => ({
          eventId: rowText(row, 'event_id'),
          fact: {id: rowText(row, 'fact_id'), revision: rowNumber(row, 'revision')},
        })),
        atWatermark,
      };
    }

    this.db.prepare(`INSERT INTO memory_feed_deliveries(
      batch_token, namespace, consumer_id, binding_id, batch_json,
      next_bootstrap_offset, next_changes_after, confirmed,
      confirmed_expected_checkpoint, confirmed_handled_key, receipt_checkpoint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL)`).run(
      batch.batchToken,
      namespace,
      consumerId,
      bindingId,
      JSON.stringify(batch),
      nextBootstrapOffset ?? null,
      nextChangesAfter ?? null,
    );
    this.db.prepare(
      'UPDATE memory_feed_bindings SET pending_batch_token = ? WHERE namespace = ? AND consumer_id = ?',
    ).run(batch.batchToken, namespace, consumerId);
    return batch;
  }
}

function parseHandled(value: unknown): readonly FactChangeEntry[] {
  if (!Array.isArray(value) || value.length > MAX_PAGE
    || Reflect.ownKeys(value).length !== value.length + 1) throw new Error();
  const events = new Set<string>();
  const facts = new Set<string>();
  return value.map(item => {
    const record = exact(item, ['eventId', 'fact']);
    const eventId = text(record.eventId);
    const parsedRef = ref(record.fact);
    const factKey = JSON.stringify([parsedRef.id, parsedRef.revision]);
    if (events.has(eventId) || facts.has(factKey)) throw new Error();
    events.add(eventId);
    facts.add(factKey);
    return {eventId, fact: parsedRef};
  });
}

export function openSqliteMemoryHost(path: string): SqliteMemoryHost {
  const db = openStorage(path, MIGRATIONS);
  try {
    db.exec('PRAGMA secure_delete = ON');
    const setting = db.prepare('PRAGMA secure_delete').get() as {secure_delete?: number} | undefined;
    if (setting?.secure_delete !== 1) return queryFail('STORAGE_UNAVAILABLE');
    return new SqliteMemoryHost(db);
  } catch (error) {
    db.close();
    throw error;
  }
}
