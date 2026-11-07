/** Provisional domain types, not a wire protocol or a persistence adapter. */
export type NodeKind = 'fact' | 'goal' | 'decision' | 'plan';
export interface NodeRef { id: string; revision: number; }
export interface NodeInput {
  id: string;
  kind: NodeKind;
  summary: string;
  sourceRef: string;
  validFrom: string;
  validUntil: string;
  sensitivity: 'public' | 'private' | 'restricted';
  state: 'active' | 'withdrawn';
  reason: string;
  dependencies: NodeRef[];
}
export interface NodeVersion extends NodeInput { revision: number; graphRevision: number; }
export interface GraphSnapshot {
  namespace: string;
  revision: number;
  history: NodeVersion[];
  /** Content-free positions removed by a trusted erasure; old revisions never alias new nodes. */
  erasedGraphRevisions?: number[];
}

export class GraphError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'REVISION_CONFLICT', message: string) { super(message); }
}
function invalid(): never { throw new GraphError('INVALID_ARGUMENT', 'Invalid goal graph data'); }
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
function object(v: unknown, keys: readonly string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)
    || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) invalid();
}
const inputKeys = ['id', 'kind', 'summary', 'sourceRef', 'validFrom', 'validUntil', 'sensitivity', 'state', 'reason', 'dependencies'];
function timestamp(v: unknown): number {
  if (!text(v) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return invalid();
  const n = Date.parse(v);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== v) return invalid();
  return n;
}
function validateInput(input: NodeInput, history: readonly NodeVersion[]): void {
  object(input, inputKeys);
  if (![input.id, input.summary, input.sourceRef, input.reason].every(text)
    || !['fact', 'goal', 'decision', 'plan'].includes(input.kind)
    || !['public', 'private', 'restricted'].includes(input.sensitivity)
    || !['active', 'withdrawn'].includes(input.state)
    || timestamp(input.validFrom) >= timestamp(input.validUntil)
    || !Array.isArray(input.dependencies)) invalid();
  const previous = history.findLast(n => n.id === input.id);
  if (previous && previous.kind !== input.kind) invalid();
  const seen = new Set<string>();
  for (const ref of input.dependencies) {
    object(ref, ['id', 'revision']);
    if (!text(ref.id) || !integer(ref.revision) || ref.revision < 1
      || ref.id === input.id || seen.has(ref.id)) invalid();
    seen.add(ref.id);
    // Dependencies point to an already-recorded version: revision graph is acyclic.
    if (!history.some(n => n.id === ref.id && n.revision === ref.revision)) invalid();
  }
}

export function createGraph(namespace: string): GraphSnapshot {
  if (!text(namespace)) invalid();
  return {namespace, revision: 0, history: []};
}

/** Validate untrusted JSON by replaying the ordered, append-only version history. */
export function parseGraph(value: unknown): GraphSnapshot {
  const sparse = !!value && typeof value === 'object' && Object.hasOwn(value, 'erasedGraphRevisions');
  object(value, sparse ? ['namespace', 'revision', 'history', 'erasedGraphRevisions']
    : ['namespace', 'revision', 'history']);
  if (!text(value.namespace) || !integer(value.revision) || !Array.isArray(value.history)
    || (sparse && (!Array.isArray(value.erasedGraphRevisions)
      || value.erasedGraphRevisions.length === 0))) invalid();
  const erased = sparse ? value.erasedGraphRevisions as number[] : [];
  if (value.revision !== value.history.length + erased.length
    || erased.some((revision, index) => !integer(revision) || revision < 1
      || revision > (value.revision as number) || (index > 0 && revision <= erased[index - 1]!))) invalid();
  const graph = createGraph(value.namespace);
  let expected = 1;
  let gap = 0;
  for (const raw of value.history) {
    while (erased[gap] === expected) { expected++; gap++; }
    object(raw, [...inputKeys, 'revision', 'graphRevision']);
    const {revision, graphRevision, ...input} = raw;
    validateInput(input as unknown as NodeInput, graph.history);
    const previous = graph.history.findLast(n => n.id === input.id);
    if (revision !== (previous?.revision ?? 0) + 1 || graphRevision !== expected) invalid();
    graph.history.push(structuredClone(raw) as unknown as NodeVersion);
    expected++;
  }
  while (erased[gap] === expected) { expected++; gap++; }
  if (expected !== (value.revision as number) + 1 || gap !== erased.length) invalid();
  graph.revision = value.revision;
  if (sparse) graph.erasedGraphRevisions = [...erased];
  return graph;
}

/** Pure compare-and-append. Host storage must perform its own atomic CAS on commit. */
export function appendVersion(snapshot: GraphSnapshot, expectedRevision: number, input: NodeInput): GraphSnapshot {
  const graph = parseGraph(snapshot);
  if (!integer(expectedRevision)) invalid();
  if (expectedRevision !== graph.revision) throw new GraphError('REVISION_CONFLICT', 'Goal graph revision changed');
  validateInput(input, graph.history);
  const previous = graph.history.findLast(n => n.id === input.id);
  if (!Number.isSafeInteger(graph.revision + 1)) invalid();
  graph.revision++;
  graph.history.push({...structuredClone(input), revision: (previous?.revision ?? 0) + 1, graphRevision: graph.revision});
  return graph;
}

/** Historical snapshot; does not overwrite current state or undo external actions. */
export function graphAt(snapshot: GraphSnapshot, revision: number): GraphSnapshot {
  const graph = parseGraph(snapshot);
  if (!integer(revision) || revision > graph.revision) invalid();
  const history = graph.history.filter(node => node.graphRevision <= revision);
  const erased = graph.erasedGraphRevisions?.filter(value => value <= revision);
  return erased?.length ? {...graph, revision, history, erasedGraphRevisions: erased}
    : {namespace: graph.namespace, revision, history};
}

export function currentNodes(snapshot: GraphSnapshot): NodeVersion[] {
  const graph = parseGraph(snapshot);
  const latest = new Map<string, NodeVersion>();
  for (const node of graph.history) latest.set(node.id, node);
  return [...latest.values()];
}

/** Validity is explicit and half-open; expired/withdrawn facts remain in history. */
export function isEffective(node: NodeVersion, at: string): boolean {
  const time = timestamp(at);
  return node.state === 'active' && timestamp(node.validFrom) <= time && time < timestamp(node.validUntil);
}

export {
  assertPrivacyDeletionReceipt,
  parsePrivacyDeletionReceipt,
  planPrivacyDeletionAcceptance,
  PRIVACY_ACCEPTANCE_PENDING_REASON,
  PRIVACY_ACCEPTANCE_PENDING_ITEMS,
  PRIVACY_ACCEPTANCE_LIMITS,
} from './privacy-deletion-acceptance-plan.js';
export type {
  PrivacyDeletionReceipt,
  PrivacyDeletionReceiptAction,
  PrivacyDeletionPendingItem,
  PrivacyDeletionAcceptancePlan,
  PlanPrivacyDeletionAcceptanceOptions,
  RealPrivacyAcceptanceEvidence,
} from './privacy-deletion-acceptance-plan.js';
