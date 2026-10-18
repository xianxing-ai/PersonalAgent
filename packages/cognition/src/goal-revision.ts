import type {GraphSnapshot, NodeRef} from '@personal-agent/goals';
import type {CoordinationStorePort} from '@personal-agent/goals/store';
import {analyzeImpact, CognitionError} from './impact.js';
import type {ImpactItem} from './impact.js';
import {previewRepairSnapshot} from './repair.js';
import type {StoredRepairChange, StoredRepairPreview} from './repair.js';

export interface GoalRevisionSelectionRequest {
  expectedGraphRevision: number;
  previousGoal: NodeRef;
  currentGoal: NodeRef;
}

export interface GoalRevisionImpact {
  namespace: string;
  graphRevision: number;
  evaluatedAt: string;
  previousGoal: NodeRef;
  currentGoal: NodeRef;
  items: ImpactItem[];
}

/** Additive local discovery scope; the consecutive revision/repair contracts are unchanged. */
export interface GoalAncestorSelectionRequest {
  expectedGraphRevision: number;
  currentGoal: NodeRef;
}
export interface GoalAncestorImpact {
  namespace: string;
  graphRevision: number;
  evaluatedAt: string;
  currentGoal: NodeRef;
  items: ImpactItem[];
}

export interface GoalRevisionRepairRequest extends GoalRevisionSelectionRequest {
  changes: StoredRepairChange[];
}

export interface GoalRevisionRepairPreview {
  impact: GoalRevisionImpact;
  repair: StoredRepairPreview;
}

function invalid(): never { throw new CognitionError('INVALID_ARGUMENT'); }
function notApplicable(): never { throw new CognitionError('NOT_APPLICABLE'); }
function conflict(): never { throw new CognitionError('REVISION_CONFLICT'); }

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Reflect.ownKeys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) return invalid();
  return value as Record<string, unknown>;
}

function selection(value: unknown, keys: readonly string[]): GoalRevisionSelectionRequest {
  const request = exact(value, keys);
  const previous = exact(request.previousGoal, ['id', 'revision']);
  const current = exact(request.currentGoal, ['id', 'revision']);
  if (!Number.isSafeInteger(request.expectedGraphRevision) || (request.expectedGraphRevision as number) < 0
    || typeof previous.id !== 'string' || !previous.id.trim()
    || previous.id !== current.id || !Number.isSafeInteger(previous.revision)
    || !Number.isSafeInteger(current.revision) || (previous.revision as number) < 1
    || (current.revision as number) !== (previous.revision as number) + 1) return invalid();
  return {
    expectedGraphRevision: request.expectedGraphRevision as number,
    previousGoal: {id: previous.id, revision: previous.revision as number},
    currentGoal: {id: current.id as string, revision: current.revision as number}
  };
}

/** Select only current nodes affected by the stated, committed Goal revision. */
export function selectGoalRevisionImpact(
  snapshot: GraphSnapshot, at: string, request: GoalRevisionSelectionRequest
): GoalRevisionImpact {
  const selected = selection(request, ['expectedGraphRevision', 'previousGoal', 'currentGoal']);
  const report = analyzeImpact(snapshot, at);
  if (report.graphRevision !== selected.expectedGraphRevision) return conflict();
  const previous = snapshot.history.find(node => node.id === selected.previousGoal.id
    && node.revision === selected.previousGoal.revision);
  const current = snapshot.history.findLast(node => node.id === selected.currentGoal.id);
  if (!previous || previous.kind !== 'goal' || !current || current.kind !== 'goal') return notApplicable();
  if (current.revision !== selected.currentGoal.revision) return conflict();
  const items = report.items.filter(item => item.action === 'RECHECK'
    && item.causes.some(cause => cause.reason === 'superseded'
      && cause.reference.id === selected.previousGoal.id
      && cause.reference.revision === selected.previousGoal.revision
      && cause.currentRevision === selected.currentGoal.revision));
  return structuredClone({namespace: report.namespace, graphRevision: report.graphRevision,
    evaluatedAt: report.evaluatedAt, previousGoal: selected.previousGoal,
    currentGoal: selected.currentGoal, items});
}

/**
 * Unresolved older Goal pins omitted by the latest consecutive-revision scope.
 * This is a current-head discovery scope, not a nonconsecutive revision receipt.
 * Keep any item covered by the original selector out, including mixed-cause items.
 */
export function selectGoalAncestorImpact(
  snapshot: GraphSnapshot, at: string, request: GoalAncestorSelectionRequest
): GoalAncestorImpact {
  const raw = exact(request, ['expectedGraphRevision', 'currentGoal']);
  const current = exact(raw.currentGoal, ['id', 'revision']);
  if (!Number.isSafeInteger(raw.expectedGraphRevision) || (raw.expectedGraphRevision as number) < 0
    || typeof current.id !== 'string' || !current.id.trim()
    || !Number.isSafeInteger(current.revision) || (current.revision as number) < 2) return invalid();
  const currentGoal = {id: current.id, revision: current.revision as number};
  // Reuse the original exact graph/head and Goal-kind checks without relaxing its contract.
  const consecutive = selectGoalRevisionImpact(snapshot, at, {
    expectedGraphRevision: raw.expectedGraphRevision as number,
    previousGoal: {id: currentGoal.id, revision: currentGoal.revision - 1}, currentGoal,
  });
  const covered = new Set(consecutive.items.map(item => JSON.stringify([item.node.id, item.node.revision])));
  const report = analyzeImpact(snapshot, at);
  const items = report.items.filter(item => item.action === 'RECHECK'
    && !covered.has(JSON.stringify([item.node.id, item.node.revision]))
    && item.causes.some(cause => cause.reason === 'superseded'
      && cause.reference.id === currentGoal.id
      && cause.currentRevision === currentGoal.revision
      && cause.reference.revision < currentGoal.revision - 1));
  return structuredClone({namespace: report.namespace, graphRevision: report.graphRevision,
    evaluatedAt: report.evaluatedAt, currentGoal, items});
}

/** Preview caller-authored changes confined to the selected RECHECK subgraph. */
export function previewGoalRevisionRepair(
  store: CoordinationStorePort, at: string, request: GoalRevisionRepairRequest
): GoalRevisionRepairPreview {
  const selected = selection(request,
    ['expectedGraphRevision', 'previousGoal', 'currentGoal', 'changes']);
  if (!store || typeof store.read !== 'function') return notApplicable();
  const snapshot = structuredClone(store.read());
  const impact = selectGoalRevisionImpact(snapshot, at, selected);
  const repair = previewRepairSnapshot(snapshot, at, {
    expectedGraphRevision: selected.expectedGraphRevision, changes: request.changes
  });
  const affected = new Set(impact.items.map(item => `${item.node.id}\u0000${item.node.revision}`));
  if (request.changes.some(change => !affected.has(`${change.node.id}\u0000${change.node.revision}`))) {
    return notApplicable();
  }
  return structuredClone({impact, repair});
}
