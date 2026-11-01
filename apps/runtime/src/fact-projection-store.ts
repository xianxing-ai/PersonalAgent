import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {appendVersions, CoordinationStoreError} from '@personal-agent/goals/store';
import {graphAt, GraphError, parseGraph} from '@personal-agent/goals';
import type {GraphSnapshot, NodeInput, NodeRef} from '@personal-agent/goals';
import {parseFactChangeBatch} from '@personal-agent/memory';
import type {FactChangeBatch, FactChangeReceipt, FactRef, FactVersion, MemoryReadContext} from '@personal-agent/memory';
import {analyzeImpact} from '@personal-agent/cognition';
import type {ImpactReport} from '@personal-agent/cognition';
import {eraseDependentGraphHistory} from './fact-erasure.js';

export interface FactProjectionRequest extends MemoryReadContext {
  readonly consumerKey: string;
  readonly memoryNamespace: string;
  readonly batch: FactChangeBatch;
  readonly facts: readonly FactVersion[];
}

export interface FactProjectionLink {
  readonly eventId: string;
  readonly fact: FactRef;
  readonly node: NodeRef;
}

export interface FactProjectionReceipt {
  readonly batchToken: string;
  readonly graphRevision: number;
  readonly links: readonly FactProjectionLink[];
}

export interface PendingFactImpact extends FactProjectionReceipt {
  readonly consumerKey: string;
  readonly memoryNamespace: string;
}

export interface CompletedFactImpact {
  readonly batchToken: string;
  readonly report: ImpactReport;
}

export interface FactImpactReceipt {
  readonly projection: FactProjectionReceipt;
  readonly completed?: CompletedFactImpact;
}

/** Read-only, graph-scoped evidence. This is not authorization to finalize erasure. */
export interface FactErasurePreflight {
  readonly graphNamespace: string;
  readonly graphRevision: number;
  readonly graphDigest: string;
  readonly stateDigest: string;
  readonly targetVersions: number;
  readonly otherGraphNamespaces: readonly string[];
  readonly graphReceiptCount: number;
  readonly stagedTargetBatches: readonly {consumerKey: string; batchToken: string}[];
  readonly dependentNodes: readonly NodeRef[];
  /** Surviving free text has no proven source lineage and blocks finalization. */
  readonly untracedTextNodes: readonly NodeRef[];
  readonly affectedReceipts: readonly {
    consumerKey: string;
    batchToken: string;
    survivingFacts: readonly FactRef[];
    impact: 'none' | 'pending' | 'completed';
  }[];
  readonly impactRecords: readonly {
    memoryNamespace: string;
    consumerKey: string;
    batchToken: string;
    graphRevision: number;
    state: 'pending' | 'completed';
    referencesTarget: boolean;
  }[];
}

export interface FactErasurePreflightRequest extends MemoryReadContext {
  readonly memoryNamespace: string;
  readonly factId: string;
  readonly readDelivery: (consumerKey: string, batchToken: string,
    context: MemoryReadContext) => FactChangeBatch | Promise<FactChangeBatch>;
  readonly readVersion: (fact: FactRef, context: MemoryReadContext) => FactVersion | Promise<FactVersion>;
}

export interface FactErasureCommitRequest extends FactErasurePreflightRequest {
  readonly operationId: string;
  readonly expectedGraphRevision: number;
}

export interface FactErasureReceipt {
  readonly graphNamespace: string;
  readonly memoryNamespace: string;
  readonly factId: string;
  readonly operationId: string;
  readonly expectedGraphRevision: number;
  readonly committedAt: string;
}

export type StagedFactProjection = Pick<FactProjectionRequest,
  'consumerKey' | 'memoryNamespace' | 'batch' | 'facts'>;

export interface FactProjectionStore {
  /** Exact existing mapping only. A caller-supplied Fact identity never creates one. */
  readNodeFact(ref: NodeRef): (FactProjectionLink & {readonly memoryNamespace: string; readonly contentHash: string}) | undefined;
  preflightErasure(request: FactErasurePreflightRequest): Promise<FactErasurePreflight>;
  /** Trusted host only; Runtime-side commit, not Memory finalization or a wire operation. */
  commitErasure(request: FactErasureCommitRequest): Promise<void>;
  readErasureReceipt(memoryNamespace: string, factId: string): FactErasureReceipt | undefined;
  /** Post-commit WAL truncation; a busy result must be retried. */
  checkpointErasureWal(): void;
  stage(request: FactProjectionRequest): void;
  readStaged(consumerKey: string, memoryNamespace: string): StagedFactProjection | undefined;
  reviseStaged(request: FactProjectionRequest): void;
  discardStaged(consumerKey: string, memoryNamespace: string, batchToken: string): void;
  project(request: FactProjectionRequest, providerReceipt: FactChangeReceipt): FactProjectionReceipt;
  readPending(limit?: number, scope?: {readonly consumerKey: string; readonly memoryNamespace: string}): readonly PendingFactImpact[];
  readCompletedImpact(scope: {readonly consumerKey: string; readonly memoryNamespace: string;
    readonly batchToken: string}): CompletedFactImpact | undefined;
  listImpactReceipts(scope: {readonly consumerKey: string; readonly memoryNamespace: string;
    readonly afterGraphRevision: number; readonly limit: number}): readonly FactImpactReceipt[];
  completeImpact(request: CompleteFactImpactRequest): void;
}

export interface CompleteFactImpactRequest extends MemoryReadContext {
  readonly consumerKey: string;
  readonly memoryNamespace: string;
  readonly batchToken: string;
  readonly expectedGraphRevision: number;
  readonly report: ImpactReport;
}

export class FactProjectionError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'INTEGRITY_CONFLICT' | 'NOT_FOUND' | 'TIMEOUT' | 'CANCELLED' | 'STORAGE_UNAVAILABLE') {
    super(code === 'INTEGRITY_CONFLICT' ? 'Fact projection identity conflict' : 'Fact projection ' + code.toLowerCase());
    this.name = 'FactProjectionError';
  }
}

interface ProjectionInput {
  readonly consumerKey: string;
  readonly memoryNamespace: string;
  readonly batch: FactChangeBatch;
  readonly facts: readonly FactVersion[];
  readonly deadline: string;
  readonly signal: AbortSignal;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function text(value: unknown, maximum = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new FactProjectionError('INVALID_ARGUMENT');
  return value;
}

function instant(value: unknown): {readonly text: string; readonly milliseconds: number} {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new FactProjectionError('INVALID_ARGUMENT');
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new FactProjectionError('INVALID_ARGUMENT');
  }
  return {text: value, milliseconds};
}

function ref(value: unknown): FactRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FactProjectionError('INVALID_ARGUMENT');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== 2 || !Object.hasOwn(raw, 'id') || !Object.hasOwn(raw, 'revision')
    || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 1) {
    throw new FactProjectionError('INVALID_ARGUMENT');
  }
  return {id: text(raw.id), revision: raw.revision as number};
}

function parseFact(value: unknown): FactVersion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FactProjectionError('INVALID_ARGUMENT');
  const raw = value as Record<string, unknown>;
  const required = ['ref', 'summary', 'sourceRef', 'observedAt', 'validFrom', 'validUntil',
    'sensitivity', 'state', 'confirmation'];
  const keys = Object.keys(raw);
  if (required.some(key => !Object.hasOwn(raw, key))
    || keys.some(key => !required.includes(key) && key !== 'corrects')
    || keys.length !== required.length + (Object.hasOwn(raw, 'corrects') ? 1 : 0)
    || !['public', 'private', 'restricted'].includes(raw.sensitivity as string)
    || !['active', 'withdrawn'].includes(raw.state as string)
    || !['external_observation', 'model_inference', 'user_confirmed'].includes(raw.confirmation as string)) {
    throw new FactProjectionError('INVALID_ARGUMENT');
  }
  const observedAt = instant(raw.observedAt);
  const validFrom = instant(raw.validFrom);
  const validUntil = instant(raw.validUntil);
  if (validFrom.milliseconds >= validUntil.milliseconds) throw new FactProjectionError('INVALID_ARGUMENT');
  const parsed: FactVersion = {
    ref: ref(raw.ref),
    summary: text(raw.summary, 4096),
    sourceRef: text(raw.sourceRef, 1024),
    observedAt: observedAt.text,
    validFrom: validFrom.text,
    validUntil: validUntil.text,
    sensitivity: raw.sensitivity as FactVersion['sensitivity'],
    state: raw.state as FactVersion['state'],
    confirmation: raw.confirmation as FactVersion['confirmation']
  };
  if (raw.corrects !== undefined) parsed.corrects = ref(raw.corrects);
  return parsed;
}

function checkpoint(context: MemoryReadContext): void {
  if (context.signal.aborted) throw new FactProjectionError('CANCELLED');
  const deadline = instant(context.deadline).milliseconds;
  if (Date.now() >= deadline) throw new FactProjectionError('TIMEOUT');
}

function factKey(value: FactRef): string {
  return JSON.stringify([value.id, value.revision]);
}

function validateRequest(request: FactProjectionRequest): ProjectionInput {
  if (!request || typeof request !== 'object') throw new FactProjectionError('INVALID_ARGUMENT');
  if (!request.signal || typeof request.signal.aborted !== 'boolean') {
    throw new FactProjectionError('INVALID_ARGUMENT');
  }
  const context = {deadline: text(request.deadline), signal: request.signal};
  checkpoint(context);
  const batch = parseFactChangeBatch(request.batch);
  if (!Array.isArray(request.facts) || request.facts.length !== batch.entries.length) {
    throw new FactProjectionError('INVALID_ARGUMENT');
  }
  const facts = request.facts.map(parseFact);
  const byRef = new Map(facts.map(fact => [factKey(fact.ref), fact]));
  if (byRef.size !== facts.length || batch.entries.some(entry => !byRef.has(factKey(entry.fact)))) {
    throw new FactProjectionError('INVALID_ARGUMENT');
  }
  return {
    consumerKey: text(request.consumerKey),
    memoryNamespace: text(request.memoryNamespace),
    batch,
    facts: batch.entries.map(entry => byRef.get(factKey(entry.fact))!),
    ...context
  };
}

function nodeId(namespace: string, factId: string): string {
  return 'memory-fact:' + createHash('sha256').update(JSON.stringify([namespace, factId])).digest('base64url');
}

function nodeInput(namespace: string, fact: FactVersion): NodeInput {
  return {
    id: nodeId(namespace, fact.ref.id),
    kind: 'fact',
    summary: fact.summary,
    sourceRef: fact.sourceRef,
    validFrom: fact.validFrom,
    validUntil: fact.validUntil,
    sensitivity: fact.sensitivity,
    state: fact.state,
    reason: 'Projected from immutable Memory fact ' + fact.ref.id + '@' + fact.ref.revision,
    dependencies: []
  };
}

function storage<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof FactProjectionError || error instanceof GraphError
      || error instanceof CoordinationStoreError) throw error;
    throw new FactProjectionError('STORAGE_UNAVAILABLE');
  }
}

function loadGraph(db: DatabaseSync, namespace: string): GraphSnapshot {
  const row = db.prepare('SELECT snapshot_json FROM coordination_graphs WHERE namespace = ?').get(namespace);
  if (!row) throw new CoordinationStoreError('NOT_FOUND');
  try {
    const graph = parseGraph(JSON.parse(row.snapshot_json as string));
    if (graph.namespace !== namespace) throw new Error();
    return graph;
  } catch {
    throw new CoordinationStoreError('STORAGE_UNAVAILABLE');
  }
}

function otherActiveGraphs(db: DatabaseSync, namespace: string): readonly string[] {
  const occupied = new Set<string>();
  for (const row of db.prepare('SELECT namespace FROM coordination_graphs WHERE namespace <> ?')
    .all(namespace) as {namespace: string}[]) {
    if (loadGraph(db, row.namespace).history.length) occupied.add(row.namespace);
  }
  const artifacts = db.prepare([
    'SELECT graph_namespace FROM coordination_fact_projections WHERE graph_namespace <> ?',
    'UNION SELECT graph_namespace FROM coordination_projection_staging WHERE graph_namespace <> ?',
    'UNION SELECT graph_namespace FROM coordination_projection_receipts WHERE graph_namespace <> ?',
    'UNION SELECT graph_namespace FROM coordination_pending_impacts WHERE graph_namespace <> ?'
  ].join(' ')).all(namespace, namespace, namespace, namespace) as {graph_namespace: string}[];
  for (const row of artifacts) occupied.add(row.graph_namespace);
  return [...occupied].sort();
}

function parseLinks(value: unknown): readonly FactProjectionLink[] {
  if (!Array.isArray(value)) throw new Error();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error();
    const raw = item as Record<string, unknown>;
    if (Object.keys(raw).length !== 3) throw new Error();
    return {eventId: text(raw.eventId), fact: ref(raw.fact), node: ref(raw.node)};
  });
}

function receipt(row: Record<string, unknown>): FactProjectionReceipt {
  return {
    batchToken: row.batch_token as string,
    graphRevision: row.graph_revision as number,
    links: parseLinks(JSON.parse(row.links_json as string))
  };
}

interface NewProjection {
  readonly entry: FactChangeBatch['entries'][number];
  readonly fact: FactVersion;
  readonly contentHash: string;
}

/** Runtime-owned adapter. The caller receives no database or general transaction callback. */
export function bindFactProjectionStore(db: DatabaseSync, graphNamespace: string): FactProjectionStore {
  const namespace = text(graphNamespace);
  const bound: FactProjectionStore = Object.freeze({
    readNodeFact: (ref: NodeRef) => storage(() => {
      if(!ref || Object.keys(ref).sort().join(',')!=='id,revision' || typeof ref.id!=='string' || !ref.id
        || !Number.isSafeInteger(ref.revision) || ref.revision<1) throw new FactProjectionError('INVALID_ARGUMENT');
      const rows=db.prepare('SELECT * FROM coordination_fact_projections WHERE graph_namespace = ? AND node_id = ? AND node_revision = ?')
        .all(namespace,ref.id,ref.revision) as Record<string,unknown>[];
      if(!rows.length)return undefined;
      const row=rows[0]!,node=loadGraph(db,namespace).history.find(node=>node.id===ref.id&&node.revision===ref.revision);
      if(rows.length!==1 || !node || node.kind!=='fact' || node.graphRevision!==row.graph_revision
        || node.id!==nodeId(row.memory_namespace as string,row.fact_id as string)) throw new FactProjectionError('INTEGRITY_CONFLICT');
      return {memoryNamespace:row.memory_namespace as string,contentHash:row.content_hash as string,eventId:row.event_id as string,
        fact:{id:row.fact_id as string,revision:row.fact_revision as number},node:{...ref}};
    }),
    preflightErasure: async (request: FactErasurePreflightRequest): Promise<FactErasurePreflight> => {
      if (!request || typeof request.readDelivery !== 'function'
        || typeof request.readVersion !== 'function' || !request.signal
        || typeof request.signal.aborted !== 'boolean') throw new FactProjectionError('INVALID_ARGUMENT');
      const memoryNamespace = text(request.memoryNamespace);
      const factId = text(request.factId);
      const context = {deadline: text(request.deadline), signal: request.signal};
      checkpoint(context);
      const inventory = storage(() => {
        const graph = loadGraph(db, namespace);
        const targetId = nodeId(memoryNamespace, factId);
        const mappings = db.prepare([
          'SELECT fact_revision, event_id, node_id, node_revision, graph_revision',
          'FROM coordination_fact_projections',
          'WHERE graph_namespace = ? AND memory_namespace = ? AND fact_id = ?',
          'ORDER BY fact_revision'
        ].join(' ')).all(namespace, memoryNamespace, factId) as Record<string, unknown>[];
        if (graph.history.filter(node => node.id === targetId).length !== mappings.length
          || mappings.some(row => row.node_id !== targetId || !graph.history.some(node =>
            node.id === row.node_id && node.revision === row.node_revision
              && node.graphRevision === row.graph_revision))) {
          throw new FactProjectionError('INTEGRITY_CONFLICT');
        }
        const retained = eraseDependentGraphHistory(graph, targetId);
        const retainedIds = new Set(retained.history.map(node => node.id));
        const receipts = db.prepare([
          'SELECT consumer_key, batch_token, base_checkpoint, watermark, graph_revision, links_json',
          'FROM coordination_projection_receipts',
          'WHERE graph_namespace = ? AND memory_namespace = ?',
          'ORDER BY consumer_key, batch_token'
        ].join(' ')).all(namespace, memoryNamespace) as Record<string, unknown>[];
        const otherGraphNamespaces = otherActiveGraphs(db, namespace);
        const graphReceiptCount = (db.prepare([
          'SELECT COUNT(*) AS total FROM coordination_projection_receipts WHERE graph_namespace = ?'
        ].join(' ')).get(namespace) as {total: number}).total;
        const allReceipts = db.prepare([
          'SELECT * FROM coordination_projection_receipts WHERE graph_namespace = ?',
          'ORDER BY memory_namespace, consumer_key, batch_token'
        ].join(' ')).all(namespace) as Record<string, unknown>[];
        const impacts = db.prepare([
          'SELECT memory_namespace, consumer_key, batch_token, graph_revision, links_json, handled_at, report_json',
          'FROM coordination_pending_impacts WHERE graph_namespace = ?',
          'ORDER BY memory_namespace, consumer_key, batch_token'
        ].join(' ')).all(namespace) as Record<string, unknown>[];
        const staging = db.prepare([
          'SELECT consumer_key, batch_token, handled_key, payload_json',
          'FROM coordination_projection_staging',
          'WHERE graph_namespace = ? AND memory_namespace = ?',
          'ORDER BY consumer_key, batch_token'
        ].join(' ')).all(namespace, memoryNamespace) as Record<string, unknown>[];
        return {graph, targetId, mappings, retainedIds, receipts, otherGraphNamespaces,
          graphReceiptCount, allReceipts, impacts, staging};
      });
      const stagedTargetBatches = inventory.staging.flatMap(row => {
        const payload = storage(() => JSON.parse(row.payload_json as string)) as
          {batch: FactChangeBatch; facts: FactVersion[]};
        const batch = parseFactChangeBatch(payload.batch);
        const facts = payload.facts.map(parseFact);
        if (batch.batchToken !== row.batch_token || digest({batch, facts}) !== row.handled_key
          || batch.entries.length !== facts.length
          || batch.entries.some((entry, index) => factKey(entry.fact) !== factKey(facts[index]!.ref))) {
          throw new FactProjectionError('INTEGRITY_CONFLICT');
        }
        return batch.entries.some(entry => entry.fact.id === factId)
          ? [{consumerKey: row.consumer_key as string, batchToken: row.batch_token as string}] : [];
      });
      const affectedReceipts: FactErasurePreflight['affectedReceipts'][number][] = [];
      const seenTargetVersions = new Set<number>();
      for (const row of inventory.receipts) {
        checkpoint(context);
        const links = storage(() => parseLinks(JSON.parse(row.links_json as string)));
        if (!links.some(link => link.fact.id === factId)) continue;
        for (const link of links) if (link.fact.id === factId) seenTargetVersions.add(link.fact.revision);
        const consumerKey = row.consumer_key as string;
        const batchToken = row.batch_token as string;
        const batch = parseFactChangeBatch(await request.readDelivery(consumerKey, batchToken, context));
        const survivors = links.filter(link => link.fact.id !== factId);
        if (batch.batchToken !== batchToken || batch.baseCheckpoint !== row.base_checkpoint
          || batch.watermark !== row.watermark || batch.entries.length !== survivors.length
          || batch.entries.some((entry, index) => entry.eventId !== survivors[index]!.eventId
            || factKey(entry.fact) !== factKey(survivors[index]!.fact))) {
          throw new FactProjectionError('INTEGRITY_CONFLICT');
        }
        for (const link of links) {
          checkpoint(context);
          const mapping = storage(() => db.prepare([
            'SELECT event_id, content_hash, node_id, node_revision FROM coordination_fact_projections',
            'WHERE graph_namespace = ? AND memory_namespace = ? AND fact_id = ? AND fact_revision = ?'
          ].join(' ')).get(namespace, memoryNamespace, link.fact.id, link.fact.revision)) as Record<string, unknown> | undefined;
          if (!mapping || mapping.event_id !== link.eventId || mapping.node_id !== link.node.id
            || mapping.node_revision !== link.node.revision
            || !inventory.graph.history.some(node => node.id === link.node.id
              && node.revision === link.node.revision)) throw new FactProjectionError('INTEGRITY_CONFLICT');
          if (link.fact.id !== factId) {
            const fact = parseFact(await request.readVersion(link.fact, context));
            if (factKey(fact.ref) !== factKey(link.fact) || digest(fact) !== mapping.content_hash) {
              throw new FactProjectionError('INTEGRITY_CONFLICT');
            }
          }
        }
        const impact = storage(() => db.prepare([
          'SELECT graph_revision, links_json, handled_at, report_json FROM coordination_pending_impacts',
          'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ? AND batch_token = ?'
        ].join(' ')).get(namespace, memoryNamespace, consumerKey, batchToken)) as Record<string, unknown> | undefined;
        let impactState: 'none' | 'pending' | 'completed' = 'none';
        if (impact) {
          const impactLinks = storage(() => parseLinks(JSON.parse(impact.links_json as string)));
          if (impact.graph_revision !== row.graph_revision || impactLinks.some(link => !links.some(item =>
            item.eventId === link.eventId && factKey(item.fact) === factKey(link.fact)
              && item.node.id === link.node.id && item.node.revision === link.node.revision))) {
            throw new FactProjectionError('INTEGRITY_CONFLICT');
          }
          impactState = impact.handled_at === null ? 'pending' : 'completed';
          if ((impactState === 'pending') !== (impact.report_json === null)) {
            throw new FactProjectionError('INTEGRITY_CONFLICT');
          }
          if (impactState === 'completed') {
            const report = storage(() => JSON.parse(impact.report_json as string)) as ImpactReport;
            if (report.namespace !== namespace || report.graphRevision !== row.graph_revision
              || !Array.isArray(report.items)) throw new FactProjectionError('INTEGRITY_CONFLICT');
          }
        }
        affectedReceipts.push({consumerKey, batchToken,
          survivingFacts: survivors.map(link => structuredClone(link.fact)), impact: impactState});
      }
      if (inventory.mappings.some(row => !seenTargetVersions.has(row.fact_revision as number))) {
        throw new FactProjectionError('INTEGRITY_CONFLICT');
      }
      const impactRecords = inventory.impacts.map(row => {
        const links = storage(() => parseLinks(JSON.parse(row.links_json as string)));
        const completed = row.handled_at !== null;
        if (completed === (row.report_json === null)) throw new FactProjectionError('INTEGRITY_CONFLICT');
        const report = completed ? storage(() => JSON.parse(row.report_json as string)) as ImpactReport : undefined;
        if (report && (report.namespace !== namespace || report.graphRevision !== row.graph_revision
          || !Array.isArray(report.items))) throw new FactProjectionError('INTEGRITY_CONFLICT');
        return {
          memoryNamespace: row.memory_namespace as string,
          consumerKey: row.consumer_key as string,
          batchToken: row.batch_token as string,
          graphRevision: row.graph_revision as number,
          state: completed ? 'completed' as const : 'pending' as const,
          referencesTarget: links.some(link => link.node.id === inventory.targetId)
            || (report?.items.some(item => item.node?.id === inventory.targetId
              || item.causes?.some(cause => cause.reference?.id === inventory.targetId)) ?? false),
        };
      });
      checkpoint(context);
      if (canonical(storage(() => loadGraph(db, namespace))) !== canonical(inventory.graph)) {
        throw new FactProjectionError('INTEGRITY_CONFLICT');
      }
      return {
        graphNamespace: namespace,
        graphRevision: inventory.graph.revision,
        graphDigest: digest(inventory.graph),
        stateDigest: digest({graph: inventory.graph, mappings: inventory.mappings,
          receipts: inventory.allReceipts, impacts: inventory.impacts, staging: inventory.staging}),
        targetVersions: inventory.mappings.length,
        otherGraphNamespaces: inventory.otherGraphNamespaces,
        graphReceiptCount: inventory.graphReceiptCount,
        stagedTargetBatches,
        dependentNodes: inventory.graph.history.filter(node => node.id !== inventory.targetId
          && !inventory.retainedIds.has(node.id)).map(node => ({id: node.id, revision: node.revision})),
        untracedTextNodes: inventory.graph.history.filter(node => node.kind !== 'fact'
          && inventory.retainedIds.has(node.id)).map(node => ({id: node.id, revision: node.revision})),
        affectedReceipts,
        impactRecords,
      };
    },
    commitErasure: async (request: FactErasureCommitRequest): Promise<void> => {
      const memoryNamespace = text(request?.memoryNamespace);
      const factId = text(request?.factId);
      const operationId = text(request?.operationId, 128);
      if (!/^[A-Za-z0-9_.-]+$/.test(operationId)
        || !request.signal || typeof request.signal.aborted !== 'boolean'
        || !Number.isSafeInteger(request.expectedGraphRevision) || request.expectedGraphRevision < 0) {
        throw new FactProjectionError('INVALID_ARGUMENT');
      }
      const context = {deadline: text(request.deadline), signal: request.signal};
      checkpoint(context);
      const prior = storage(() => db.prepare([
        'SELECT operation_id, expected_graph_revision FROM coordination_fact_erasure_receipts',
        'WHERE graph_namespace = ? AND memory_namespace = ? AND fact_id = ?'
      ].join(' ')).get(namespace, memoryNamespace, factId)) as Record<string, unknown> | undefined;
      if (prior) {
        if (prior.operation_id !== operationId || prior.expected_graph_revision !== request.expectedGraphRevision) {
          throw new FactProjectionError('INTEGRITY_CONFLICT');
        }
        return;
      }
      const inspection = await bound.preflightErasure(request);
      if (inspection.graphRevision !== request.expectedGraphRevision || inspection.targetVersions === 0
        || inspection.otherGraphNamespaces.length || inspection.stagedTargetBatches.length
        || inspection.untracedTextNodes.length) throw new FactProjectionError('INTEGRITY_CONFLICT');
      const plans: {consumerKey: string; batchToken: string;
        batch: FactChangeBatch; facts: readonly FactVersion[]}[] = [];
      for (const item of inspection.affectedReceipts) {
        checkpoint(context);
        const batch = parseFactChangeBatch(await request.readDelivery(item.consumerKey, item.batchToken, context));
        const facts = await Promise.all(batch.entries.map(async entry =>
          parseFact(await request.readVersion(entry.fact, context))));
        const input = validateRequest({consumerKey: item.consumerKey, memoryNamespace,
          batch, facts, ...context});
        if (batch.batchToken !== item.batchToken || batch.entries.length !== item.survivingFacts.length
          || batch.entries.some((entry, index) => factKey(entry.fact) !== factKey(item.survivingFacts[index]!))) {
          throw new FactProjectionError('INTEGRITY_CONFLICT');
        }
        plans.push({consumerKey: item.consumerKey, batchToken: item.batchToken,
          batch: input.batch, facts: input.facts});
      }
      storage(() => {
        checkpoint(context);
        db.exec('PRAGMA secure_delete = ON');
        const setting = db.prepare('PRAGMA secure_delete').get() as
          {secure_delete?: number} | undefined;
        if (setting?.secure_delete !== 1) throw new FactProjectionError('STORAGE_UNAVAILABLE');
        db.exec('BEGIN IMMEDIATE');
        try {
          checkpoint(context);
          const existing = db.prepare([
            'SELECT operation_id, expected_graph_revision FROM coordination_fact_erasure_receipts',
            'WHERE graph_namespace = ? AND memory_namespace = ? AND fact_id = ?'
          ].join(' ')).get(namespace, memoryNamespace, factId) as Record<string, unknown> | undefined;
          if (existing) {
            if (existing.operation_id !== operationId
              || existing.expected_graph_revision !== request.expectedGraphRevision) {
              throw new FactProjectionError('INTEGRITY_CONFLICT');
            }
            db.exec('COMMIT');
            return;
          }
          const graph = loadGraph(db, namespace);
          const mappings = db.prepare([
            'SELECT fact_revision, event_id, node_id, node_revision, graph_revision',
            'FROM coordination_fact_projections',
            'WHERE graph_namespace = ? AND memory_namespace = ? AND fact_id = ?',
            'ORDER BY fact_revision'
          ].join(' ')).all(namespace, memoryNamespace, factId);
          const receipts = db.prepare([
            'SELECT * FROM coordination_projection_receipts WHERE graph_namespace = ?',
            'ORDER BY memory_namespace, consumer_key, batch_token'
          ].join(' ')).all(namespace);
          const impacts = db.prepare([
            'SELECT memory_namespace, consumer_key, batch_token, graph_revision, links_json, handled_at, report_json',
            'FROM coordination_pending_impacts WHERE graph_namespace = ?',
            'ORDER BY memory_namespace, consumer_key, batch_token'
          ].join(' ')).all(namespace);
          const staging = db.prepare([
            'SELECT consumer_key, batch_token, handled_key, payload_json',
            'FROM coordination_projection_staging',
            'WHERE graph_namespace = ? AND memory_namespace = ?',
            'ORDER BY consumer_key, batch_token'
          ].join(' ')).all(namespace, memoryNamespace);
          if (otherActiveGraphs(db, namespace).length || graph.revision !== inspection.graphRevision
            || digest(graph) !== inspection.graphDigest
            || digest({graph, mappings, receipts, impacts, staging}) !== inspection.stateDigest) {
            throw new FactProjectionError('INTEGRITY_CONFLICT');
          }
          const scrubbed = eraseDependentGraphHistory(graph, nodeId(memoryNamespace, factId));
          if (scrubbed.history.length === graph.history.length) {
            throw new FactProjectionError('INTEGRITY_CONFLICT');
          }
          for (const plan of plans) {
            const row = receipts.find(item => item.memory_namespace === memoryNamespace
              && item.consumer_key === plan.consumerKey && item.batch_token === plan.batchToken);
            if (!row || row.base_checkpoint !== plan.batch.baseCheckpoint
              || row.watermark !== plan.batch.watermark) throw new FactProjectionError('INTEGRITY_CONFLICT');
            const links = parseLinks(JSON.parse(row.links_json as string));
            const survivors = links.filter(link => link.fact.id !== factId);
            if (survivors.length !== plan.batch.entries.length || survivors.some((link, index) =>
              link.eventId !== plan.batch.entries[index]!.eventId
                || factKey(link.fact) !== factKey(plan.facts[index]!.ref))) {
              throw new FactProjectionError('INTEGRITY_CONFLICT');
            }
            for (const fact of plan.facts) {
              const mapped = db.prepare([
                'SELECT content_hash FROM coordination_fact_projections',
                'WHERE graph_namespace = ? AND memory_namespace = ? AND fact_id = ? AND fact_revision = ?'
              ].join(' ')).get(namespace, memoryNamespace, fact.ref.id, fact.ref.revision) as
                {content_hash: string} | undefined;
              if (!mapped || mapped.content_hash !== digest(fact)) {
                throw new FactProjectionError('INTEGRITY_CONFLICT');
              }
            }
            db.prepare([
              'UPDATE coordination_projection_receipts SET handled_key = ?, links_json = ?',
              'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ? AND batch_token = ?'
            ].join(' ')).run(digest({batch: plan.batch, facts: plan.facts}), JSON.stringify(survivors),
              namespace, memoryNamespace, plan.consumerKey, plan.batchToken);
          }
          for (const row of impacts) {
            const links = parseLinks(JSON.parse(row.links_json as string));
            const retained = links.filter(link => link.node.id !== nodeId(memoryNamespace, factId));
            let reportJson = row.report_json as string | null;
            if (row.handled_at !== null) {
              const report = JSON.parse(reportJson!) as ImpactReport;
              const oldAt = graphAt(graph, row.graph_revision as number);
              if (canonical(report) !== canonical(analyzeImpact(oldAt, report.evaluatedAt))) {
                throw new FactProjectionError('INTEGRITY_CONFLICT');
              }
              reportJson = canonical(analyzeImpact(graphAt(scrubbed, row.graph_revision as number),
                report.evaluatedAt));
            } else if (reportJson !== null) {
              throw new FactProjectionError('INTEGRITY_CONFLICT');
            }
            db.prepare([
              'UPDATE coordination_pending_impacts SET links_json = ?, report_json = ?',
              'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ? AND batch_token = ?'
            ].join(' ')).run(JSON.stringify(retained), reportJson, namespace,
              row.memory_namespace as string, row.consumer_key as string, row.batch_token as string);
          }
          const removed = db.prepare([
            'DELETE FROM coordination_fact_projections',
            'WHERE graph_namespace = ? AND memory_namespace = ? AND fact_id = ?'
          ].join(' ')).run(namespace, memoryNamespace, factId);
          if (Number(removed.changes) !== inspection.targetVersions) {
            throw new FactProjectionError('INTEGRITY_CONFLICT');
          }
          db.prepare('UPDATE coordination_graphs SET snapshot_json = ? WHERE namespace = ?')
            .run(JSON.stringify(scrubbed), namespace);
          db.prepare([
            'INSERT INTO coordination_fact_erasure_receipts',
            '(graph_namespace, memory_namespace, fact_id, operation_id, expected_graph_revision, committed_at)',
            'VALUES (?, ?, ?, ?, ?, ?)'
          ].join(' ')).run(namespace, memoryNamespace, factId, operationId,
            request.expectedGraphRevision, new Date().toISOString());
          checkpoint(context);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
    },
    readErasureReceipt: (memoryNamespace: string, factId: string): FactErasureReceipt | undefined => {
      const scope = text(memoryNamespace);
      const target = text(factId);
      const row = storage(() => db.prepare([
        'SELECT operation_id, expected_graph_revision, committed_at',
        'FROM coordination_fact_erasure_receipts',
        'WHERE graph_namespace = ? AND memory_namespace = ? AND fact_id = ?'
      ].join(' ')).get(namespace, scope, target)) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return {graphNamespace: namespace, memoryNamespace: scope, factId: target,
        operationId: row.operation_id as string,
        expectedGraphRevision: row.expected_graph_revision as number,
        committedAt: row.committed_at as string};
    },
    checkpointErasureWal: (): void => storage(() => {
      const mode = db.prepare('PRAGMA journal_mode').get() as {journal_mode?: string} | undefined;
      const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
        {busy?: number; log?: number; checkpointed?: number} | undefined;
      if (mode?.journal_mode !== 'wal' || result?.busy !== 0
        || result.log !== 0 || result.checkpointed !== 0) {
        throw new FactProjectionError('STORAGE_UNAVAILABLE');
      }
    }),
    stage: (request: FactProjectionRequest): void => {
      const input = validateRequest(request);
      const handledKey = digest({batch: input.batch, facts: input.facts});
      storage(() => {
        checkpoint(input);
        db.exec('BEGIN IMMEDIATE');
        try {
          checkpoint(input);
          loadGraph(db, namespace);
          const completed = db.prepare([
            'SELECT handled_key FROM coordination_projection_receipts',
            'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ? AND batch_token = ?'
          ].join(' ')).get(namespace, input.memoryNamespace, input.consumerKey,
            input.batch.batchToken) as Record<string, unknown> | undefined;
          if (completed) {
            if (completed.handled_key !== handledKey) throw new FactProjectionError('INTEGRITY_CONFLICT');
          } else {
            const existing = db.prepare([
              'SELECT batch_token, handled_key FROM coordination_projection_staging',
              'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ?'
            ].join(' ')).all(namespace, input.memoryNamespace, input.consumerKey) as Record<string, unknown>[];
            if (existing.length > 1 || (existing.length === 1
              && (existing[0]!.batch_token !== input.batch.batchToken
                || existing[0]!.handled_key !== handledKey))) {
              throw new FactProjectionError('INTEGRITY_CONFLICT');
            }
            if (!existing.length) db.prepare([
              'INSERT INTO coordination_projection_staging',
              '(graph_namespace, memory_namespace, consumer_key, batch_token, handled_key, payload_json, staged_at)',
              'VALUES (?, ?, ?, ?, ?, ?, ?)'
            ].join(' ')).run(namespace, input.memoryNamespace, input.consumerKey,
              input.batch.batchToken, handledKey,
              JSON.stringify({batch: input.batch, facts: input.facts}), new Date().toISOString());
          }
          checkpoint(input);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
    },
    readStaged: (consumerKey: string, memoryNamespace: string): StagedFactProjection | undefined => storage(() => {
      const consumer = text(consumerKey);
      const memory = text(memoryNamespace);
      const rows = db.prepare([
        'SELECT batch_token, handled_key, payload_json FROM coordination_projection_staging',
        'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ?'
      ].join(' ')).all(namespace, memory, consumer) as Record<string, unknown>[];
      if (!rows.length) return undefined;
      if (rows.length !== 1) throw new FactProjectionError('INTEGRITY_CONFLICT');
      const payload = JSON.parse(rows[0]!.payload_json as string) as {batch: FactChangeBatch; facts: FactVersion[]};
      const batch = parseFactChangeBatch(payload.batch);
      const facts = payload.facts.map(parseFact);
      if (batch.batchToken !== rows[0]!.batch_token
        || digest({batch, facts}) !== rows[0]!.handled_key) throw new FactProjectionError('INTEGRITY_CONFLICT');
      return {consumerKey: consumer, memoryNamespace: memory, batch, facts};
    }),
    reviseStaged: (request: FactProjectionRequest): void => {
      const input = validateRequest(request);
      storage(() => {
        checkpoint(input);
        db.exec('BEGIN IMMEDIATE');
        try {
          const row = db.prepare([
            'SELECT handled_key, payload_json FROM coordination_projection_staging',
            'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ? AND batch_token = ?',
          ].join(' ')).get(namespace, input.memoryNamespace, input.consumerKey,
            input.batch.batchToken) as Record<string, unknown> | undefined;
          if (!row) throw new FactProjectionError('NOT_FOUND');
          const old = JSON.parse(row.payload_json as string) as {batch: FactChangeBatch; facts: FactVersion[]};
          const oldBatch = parseFactChangeBatch(old.batch);
          const oldFacts = old.facts.map(parseFact);
          if (digest({batch: oldBatch, facts: oldFacts}) !== row.handled_key
            || oldBatch.batchToken !== input.batch.batchToken
            || oldBatch.mode !== input.batch.mode
            || oldBatch.baseCheckpoint !== input.batch.baseCheckpoint
            || oldBatch.watermark !== input.batch.watermark
            || input.batch.entries.length > oldBatch.entries.length
            || (input.batch.entries.length === oldBatch.entries.length
              && input.batch.atWatermark === oldBatch.atWatermark)) {
            throw new FactProjectionError('INTEGRITY_CONFLICT');
          }
          let oldIndex = 0;
          for (let index = 0; index < input.batch.entries.length; index++) {
            const entry = input.batch.entries[index]!;
            while (oldIndex < oldBatch.entries.length
              && (oldBatch.entries[oldIndex]!.eventId !== entry.eventId
                || factKey(oldBatch.entries[oldIndex]!.fact) !== factKey(entry.fact))) oldIndex++;
            if (oldIndex === oldBatch.entries.length
              || canonical(oldFacts[oldIndex]) !== canonical(input.facts[index])) {
              throw new FactProjectionError('INTEGRITY_CONFLICT');
            }
            oldIndex++;
          }
          db.prepare([
            'UPDATE coordination_projection_staging SET handled_key = ?, payload_json = ?',
            'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ? AND batch_token = ?',
          ].join(' ')).run(digest({batch: input.batch, facts: input.facts}),
            JSON.stringify({batch: input.batch, facts: input.facts}),
            namespace, input.memoryNamespace, input.consumerKey, input.batch.batchToken);
          checkpoint(input);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
    },
    discardStaged: (consumerKey: string, memoryNamespace: string, batchToken: string): void => storage(() => {
      db.prepare([
        'DELETE FROM coordination_projection_staging',
        'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ? AND batch_token = ?'
      ].join(' ')).run(namespace, text(memoryNamespace), text(consumerKey), text(batchToken));
    }),
    project: (request: FactProjectionRequest, providerReceipt: FactChangeReceipt): FactProjectionReceipt => {
      const input = validateRequest(request);
      const handledKey = digest({batch: input.batch, facts: input.facts});
      if (!providerReceipt || providerReceipt.batchToken !== input.batch.batchToken) {
        throw new FactProjectionError('INVALID_ARGUMENT');
      }
      text(providerReceipt.checkpoint);
      return storage(() => {
        checkpoint(input);
        db.exec('BEGIN IMMEDIATE');
        try {
          checkpoint(input);
          const existingReceipt = db.prepare([
            'SELECT batch_token, handled_key, graph_revision, links_json',
            'FROM coordination_projection_receipts',
            'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ? AND batch_token = ?'
          ].join(' ')).get(namespace, input.memoryNamespace, input.consumerKey,
            input.batch.batchToken) as Record<string, unknown> | undefined;
          if (existingReceipt) {
            if (existingReceipt.handled_key !== handledKey) throw new FactProjectionError('INTEGRITY_CONFLICT');
            const result = receipt(existingReceipt);
            checkpoint(input);
            db.exec('COMMIT');
            return result;
          }

          const staged = db.prepare([
            'SELECT handled_key, payload_json FROM coordination_projection_staging',
            'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ? AND batch_token = ?'
          ].join(' ')).get(namespace, input.memoryNamespace, input.consumerKey,
            input.batch.batchToken) as Record<string, unknown> | undefined;
          if (!staged) throw new FactProjectionError('NOT_FOUND');
          if (staged.handled_key !== handledKey
            || digest(JSON.parse(staged.payload_json as string)) !== handledKey) {
            throw new FactProjectionError('INTEGRITY_CONFLICT');
          }

          const graph = loadGraph(db, namespace);
          const links = new Map<string, FactProjectionLink>();
          const pending: NewProjection[] = [];
          for (let index = 0; index < input.batch.entries.length; index++) {
            const entry = input.batch.entries[index]!;
            const fact = input.facts[index]!;
            const contentHash = digest(fact);
            const mapped = db.prepare([
              'SELECT event_id, content_hash, node_id, node_revision, graph_revision',
              'FROM coordination_fact_projections',
              'WHERE graph_namespace = ? AND memory_namespace = ? AND fact_id = ? AND fact_revision = ?'
            ].join(' ')).get(namespace, input.memoryNamespace, fact.ref.id, fact.ref.revision) as Record<string, unknown> | undefined;
            if (mapped) {
              if (mapped.event_id !== entry.eventId || mapped.content_hash !== contentHash) {
                throw new FactProjectionError('INTEGRITY_CONFLICT');
              }
              if (!graph.history.some(node => node.id === mapped.node_id
                && node.revision === mapped.node_revision
                && node.graphRevision === mapped.graph_revision)) {
                throw new FactProjectionError('INTEGRITY_CONFLICT');
              }
              links.set(factKey(fact.ref), {
                eventId: entry.eventId,
                fact: structuredClone(fact.ref),
                node: {id: mapped.node_id as string, revision: mapped.node_revision as number}
              });
              continue;
            }
            const event = db.prepare([
              'SELECT fact_id, fact_revision FROM coordination_fact_projections',
              'WHERE graph_namespace = ? AND memory_namespace = ? AND event_id = ?'
            ].join(' ')).get(namespace, input.memoryNamespace, entry.eventId) as Record<string, unknown> | undefined;
            if (event && (event.fact_id !== fact.ref.id || event.fact_revision !== fact.ref.revision)) {
              throw new FactProjectionError('INTEGRITY_CONFLICT');
            }
            pending.push({entry, fact, contentHash});
          }

          const next = pending.length
            ? appendVersions(graph, graph.revision, pending.map(item => nodeInput(input.memoryNamespace, item.fact)))
            : graph;
          const appended = next.history.slice(graph.history.length);
          for (let index = 0; index < pending.length; index++) {
            const item = pending[index]!;
            const node = appended[index]!;
            db.prepare([
              'INSERT INTO coordination_fact_projections',
              '(graph_namespace, memory_namespace, fact_id, fact_revision, event_id, content_hash,',
              'node_id, node_revision, graph_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ].join(' ')).run(namespace, input.memoryNamespace, item.fact.ref.id, item.fact.ref.revision,
              item.entry.eventId, item.contentHash, node.id, node.revision, node.graphRevision);
            links.set(factKey(item.fact.ref), {
              eventId: item.entry.eventId,
              fact: structuredClone(item.fact.ref),
              node: {id: node.id, revision: node.revision}
            });
          }
          if (pending.length) {
            db.prepare('UPDATE coordination_graphs SET snapshot_json = ? WHERE namespace = ?')
              .run(JSON.stringify(next), namespace);
          }

          const orderedLinks = input.batch.entries.map(entry => links.get(factKey(entry.fact))!);
          const linksJson = JSON.stringify(orderedLinks);
          const now = new Date().toISOString();
          db.prepare([
            'INSERT INTO coordination_projection_receipts',
            '(graph_namespace, memory_namespace, consumer_key, batch_token, base_checkpoint, watermark, handled_key,',
            'graph_revision, links_json, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ].join(' ')).run(namespace, input.memoryNamespace, input.consumerKey,
            input.batch.batchToken, input.batch.baseCheckpoint,
            input.batch.watermark, handledKey, next.revision, linksJson, now);
          if (pending.length) {
            const pendingLinks = pending.map(item => links.get(factKey(item.fact.ref))!);
            db.prepare([
              'INSERT INTO coordination_pending_impacts',
              '(graph_namespace, memory_namespace, consumer_key, batch_token, graph_revision, links_json, created_at)',
              'VALUES (?, ?, ?, ?, ?, ?, ?)'
            ].join(' ')).run(namespace, input.memoryNamespace, input.consumerKey, input.batch.batchToken,
              next.revision, JSON.stringify(pendingLinks), now);
          }
          db.prepare([
            'DELETE FROM coordination_projection_staging',
            'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ? AND batch_token = ?'
          ].join(' ')).run(namespace, input.memoryNamespace, input.consumerKey, input.batch.batchToken);
          checkpoint(input);
          db.exec('COMMIT');
          return {batchToken: input.batch.batchToken, graphRevision: next.revision, links: orderedLinks};
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
    },
    readPending: (limit = 100, scope?: {readonly consumerKey: string; readonly memoryNamespace: string}): readonly PendingFactImpact[] => storage(() => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new FactProjectionError('INVALID_ARGUMENT');
      const consumer = scope === undefined ? undefined : text(scope.consumerKey);
      const memory = scope === undefined ? undefined : text(scope.memoryNamespace);
      loadGraph(db, namespace);
      const rows = db.prepare([
        'SELECT memory_namespace, consumer_key, batch_token, graph_revision, links_json',
        'FROM coordination_pending_impacts',
        'WHERE graph_namespace = ? AND handled_at IS NULL',
        ...(scope === undefined ? [] : ['AND consumer_key = ? AND memory_namespace = ?']),
        'ORDER BY created_at, batch_token LIMIT ?'
      ].join(' ')).all(...(scope === undefined ? [namespace, limit] : [namespace, consumer!, memory!, limit])) as Record<string, unknown>[];
      return rows.map(row => ({
        memoryNamespace: row.memory_namespace as string,
        consumerKey: row.consumer_key as string,
        batchToken: row.batch_token as string,
        graphRevision: row.graph_revision as number,
        links: parseLinks(JSON.parse(row.links_json as string))
      }));
    }),
    readCompletedImpact: (scope: {readonly consumerKey: string; readonly memoryNamespace: string;
      readonly batchToken: string}): CompletedFactImpact | undefined => storage(() => {
      const consumer = text(scope.consumerKey);
      const memory = text(scope.memoryNamespace);
      const batchToken = text(scope.batchToken);
      const row = db.prepare([
        'SELECT graph_revision, handled_at, report_json FROM coordination_pending_impacts',
        'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ? AND batch_token = ?'
      ].join(' ')).get(namespace, memory, consumer, batchToken) as Record<string, unknown> | undefined;
      if (!row) throw new FactProjectionError('NOT_FOUND');
      if (row.handled_at === null) return undefined;
      const report = JSON.parse(row.report_json as string) as ImpactReport;
      if (report.namespace !== namespace || report.graphRevision !== row.graph_revision
        || !Array.isArray(report.items)) throw new FactProjectionError('STORAGE_UNAVAILABLE');
      return {batchToken, report: structuredClone(report)};
    }),
    listImpactReceipts: (scope: {readonly consumerKey: string; readonly memoryNamespace: string;
      readonly afterGraphRevision: number; readonly limit: number}): readonly FactImpactReceipt[] => storage(() => {
      const consumer = text(scope.consumerKey);
      const memory = text(scope.memoryNamespace);
      if (!Number.isSafeInteger(scope.afterGraphRevision) || scope.afterGraphRevision < 0
        || !Number.isSafeInteger(scope.limit) || scope.limit < 1 || scope.limit > 100) {
        throw new FactProjectionError('INVALID_ARGUMENT');
      }
      loadGraph(db, namespace);
      const rows = db.prepare([
        'SELECT p.batch_token, p.graph_revision, r.links_json, p.handled_at, p.report_json',
        'FROM coordination_pending_impacts AS p',
        'JOIN coordination_projection_receipts AS r ON r.graph_namespace = p.graph_namespace',
        'AND r.memory_namespace = p.memory_namespace AND r.consumer_key = p.consumer_key',
        'AND r.batch_token = p.batch_token',
        'WHERE p.graph_namespace = ? AND p.memory_namespace = ? AND p.consumer_key = ? AND p.graph_revision > ?',
        'ORDER BY p.graph_revision, p.batch_token LIMIT ?'
      ].join(' ')).all(namespace, memory, consumer, scope.afterGraphRevision, scope.limit) as Record<string, unknown>[];
      return rows.map(row => {
        const batchToken = row.batch_token as string;
        const graphRevision = row.graph_revision as number;
        const projection: FactProjectionReceipt = {batchToken, graphRevision,
          links: parseLinks(JSON.parse(row.links_json as string))};
        if (row.handled_at === null) return {projection};
        const report = JSON.parse(row.report_json as string) as ImpactReport;
        if (report.namespace !== namespace || report.graphRevision !== graphRevision
          || !Array.isArray(report.items)) throw new FactProjectionError('STORAGE_UNAVAILABLE');
        return {projection, completed: {batchToken, report: structuredClone(report)}};
      });
    }),
    completeImpact: (request: CompleteFactImpactRequest): void => storage(() => {
      const context = {deadline: text(request.deadline), signal: request.signal};
      if (!context.signal || typeof context.signal.aborted !== 'boolean'
        || !Number.isSafeInteger(request.expectedGraphRevision) || request.expectedGraphRevision < 1
        || !request.report || typeof request.report !== 'object'
        || request.report.namespace !== namespace
        || request.report.graphRevision !== request.expectedGraphRevision
        || !Array.isArray(request.report.items)) throw new FactProjectionError('INVALID_ARGUMENT');
      const consumerKey = text(request.consumerKey);
      const memoryNamespace = text(request.memoryNamespace);
      const batchToken = text(request.batchToken);
      const reportJson = canonical(request.report);
      checkpoint(context);
      db.exec('BEGIN IMMEDIATE');
      try {
        checkpoint(context);
        const row = db.prepare([
          'SELECT graph_revision, handled_at, report_json FROM coordination_pending_impacts',
          'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ? AND batch_token = ?'
        ].join(' ')).get(namespace, memoryNamespace, consumerKey,
          batchToken) as Record<string, unknown> | undefined;
        if (!row) throw new FactProjectionError('NOT_FOUND');
        if (row.graph_revision !== request.expectedGraphRevision) {
          throw new FactProjectionError('INTEGRITY_CONFLICT');
        }
        if (row.handled_at !== null) {
          if (row.report_json !== reportJson) throw new FactProjectionError('INTEGRITY_CONFLICT');
          checkpoint(context);
          db.exec('COMMIT');
          return;
        }
        db.prepare([
          'UPDATE coordination_pending_impacts SET handled_at = ?, report_json = ?',
          'WHERE graph_namespace = ? AND memory_namespace = ? AND consumer_key = ?',
          'AND batch_token = ? AND handled_at IS NULL'
        ].join(' ')).run(new Date().toISOString(), reportJson, namespace,
          memoryNamespace, consumerKey, batchToken);
        checkpoint(context);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    })
  });
  return bound;
}
