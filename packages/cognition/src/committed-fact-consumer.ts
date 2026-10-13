import {isDeepStrictEqual} from 'node:util';
import type {CoordinationStorePort} from '@personal-agent/goals/store';
import {analyzeImpact, CognitionError} from './impact.js';
import type {ImpactReport} from './impact.js';
import {DecisionError} from './proactive-decision.js';
import type {DecisionPort, DecisionSuggestion} from './proactive-decision.js';
import {decideProjectedFactImpact} from './projected-fact-decision.js';
import {previewProjectedRepair, selectProjectedRepairScope} from './projected-repair.js';
import type {ProjectedRepairInput, ProjectedRepairRequest,
  ProjectedRepairPreview, ProjectedRepairScope} from './projected-repair.js';

/** Local host handoff after its batch-scoped durable impact completion. */
export interface DurableFactProjectionInput extends ProjectedRepairInput {
  /** Trusted host evaluation time for the current graph, not the old report. */
  at: string;
  deadline: string;
  signal: AbortSignal;
}

export interface CompletedFactProjectionDecision {
  scope: ProjectedRepairScope;
  suggestions: readonly DecisionSuggestion[];
}

/** Structural view of DEP02's scoped durable read, not a second feed contract. */
export interface CompletedFactImpactReader {
  readCompletedImpact(batchToken: string): {batchToken: string; report: ImpactReport} | undefined;
}

/** Validate the durable original and derive a current-graph view of its links. */
function completedScope(
  store: CoordinationStorePort,
  completion: CompletedFactImpactReader,
  input: ProjectedRepairInput,
  at: string
) {
  if (!completion || typeof completion.readCompletedImpact !== 'function'
    || !input?.projection || typeof input.projection.batchToken !== 'string'
    || !input.projection.batchToken.trim()) throw new CognitionError('INVALID_ARGUMENT');
  const processed = completion.readCompletedImpact(input.projection.batchToken);
  if (!processed) throw new CognitionError('NOT_APPLICABLE');
  if (typeof processed.batchToken !== 'string' || !processed.batchToken
    || processed.batchToken !== input.projection.batchToken) {
    throw new CognitionError('INVALID_ARGUMENT');
  }
  if (!Number.isSafeInteger(input.projection.graphRevision)
    || input.projection.graphRevision < 0) throw new CognitionError('INVALID_ARGUMENT');
  const historical = structuredClone(store.read(input.projection.graphRevision));
  if (historical.revision !== input.projection.graphRevision) {
    throw new CognitionError('REVISION_CONFLICT');
  }
  const completedReport = analyzeImpact(historical, processed.report?.evaluatedAt);
  if (!isDeepStrictEqual(completedReport, processed.report)) {
    throw new CognitionError('INVALID_ARGUMENT');
  }
  const snapshot = structuredClone(store.read());
  if (snapshot.revision < input.projection.graphRevision) throw new CognitionError('REVISION_CONFLICT');
  const report = analyzeImpact(snapshot, at);
  if (Date.parse(at) < Date.parse(completedReport.evaluatedAt)) {
    throw new CognitionError('INVALID_ARGUMENT');
  }
  // A local current-graph view of the original links; it is not a new receipt.
  const currentProjection = {...input.projection, graphRevision: snapshot.revision};
  const scope = selectProjectedRepairScope(snapshot, report.evaluatedAt, {
    graphNamespace: input.graphNamespace, projection: currentProjection
  });
  for (const link of input.projection.links) {
    const current = snapshot.history.findLast(node => node.id === link.node.id);
    if (!current || current.kind !== 'fact' || current.revision !== link.node.revision) {
      throw new CognitionError('REVISION_CONFLICT');
    }
  }
  return {snapshot, report, currentProjection, scope};
}

/** Read exact durable completion before advice; never acknowledge or write. */
export async function decideDurableFactProjection(
  store: CoordinationStorePort,
  decision: DecisionPort,
  completion: CompletedFactImpactReader,
  input: DurableFactProjectionInput
): Promise<CompletedFactProjectionDecision> {
  if (!input || !(input.signal instanceof AbortSignal)) throw new DecisionError('INVALID_ARGUMENT');
  if (input.signal.aborted) throw new DecisionError('CANCELLED');
  if (typeof input.deadline !== 'string' || !Number.isFinite(Date.parse(input.deadline))) {
    throw new DecisionError('INVALID_ARGUMENT');
  }
  if (Date.now() >= Date.parse(input.deadline)) throw new DecisionError('TIMEOUT');
  const {graphNamespace, deadline, signal} = input;
  const {snapshot, report, currentProjection, scope} = completedScope(store, completion, input, input.at);
  // A durable feed batch can contain up to 100 links, while the advisory port
  // accepts at most four per call. Snapshot every link before the first await
  // and share one lifecycle across ordered chunks; these views are not receipts.
  const projection = structuredClone(currentProjection);
  const suggestions: DecisionSuggestion[] = [];
  for (let offset = 0; offset < Math.max(1, projection.links.length); offset += 4) {
    const chunk = await decideProjectedFactImpact(decision, {
      graphNamespace,
      projection: {...projection, links: projection.links.slice(offset, offset + 4)},
      impact: report,
      deadline,
      signal
    });
    // Stop before another model call when the graph changes. No partial result,
    // feed acknowledgement or graph write is published if a later chunk fails.
    if (store.read().revision !== snapshot.revision) throw new CognitionError('REVISION_CONFLICT');
    suggestions.push(...chunk);
  }
  return {scope, suggestions};
}

/** Preview only explicit changes in the current affected subset of a completed batch. */
export function previewDurableFactRepair(
  store: CoordinationStorePort,
  completion: CompletedFactImpactReader,
  at: string,
  request: ProjectedRepairRequest
): ProjectedRepairPreview {
  const {snapshot, currentProjection} = completedScope(store, completion, request, at);
  const preview = previewProjectedRepair(store, at, {
    graphNamespace: request.graphNamespace, projection: currentProjection, changes: request.changes
  });
  // Match the existing local repair gate: keep each target's dependency IDs.
  for (const change of request.changes) {
    const original = snapshot.history.findLast(node => node.id === change.node.id);
    if (!original || original.revision !== change.node.revision) {
      throw new CognitionError('REVISION_CONFLICT');
    }
    if (original.dependencies.length !== change.dependencies.length
      || original.dependencies.some(ref => !change.dependencies.some(next => next.id === ref.id))) {
      throw new CognitionError('NOT_APPLICABLE');
    }
  }
  return preview;
}
