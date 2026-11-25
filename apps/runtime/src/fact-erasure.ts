import {isDeepStrictEqual} from 'node:util';
import {assertPrivacyDeletionReceipt, GraphError, parseGraph} from '@personal-agent/goals';
import type {GraphSnapshot, PrivacyDeletionReceipt} from '@personal-agent/goals';

export interface VerifyPhysicalErasureGraphUnlinkInput {
  readonly before: GraphSnapshot;
  readonly after: GraphSnapshot;
  readonly targetId: string;
  readonly receipt: unknown;
}

export interface PhysicalErasureGraphUnlinkReport {
  readonly verified: true;
  readonly namespace: string;
  readonly targetId: string;
  readonly graphRevision: number;
  readonly newlyErasedRevisions: readonly number[];
  readonly totalErasedGraphRevisions: readonly number[];
  readonly remainingNodes: number;
  readonly receipt: PrivacyDeletionReceipt;
}

/** Remove all versions of a node and every node that ever depended on it. */
export function eraseDependentGraphHistory(snapshot: GraphSnapshot, targetId: string): GraphSnapshot {
  const graph = parseGraph(snapshot);
  if (typeof targetId !== 'string' || !targetId.trim()) {
    throw new GraphError('INVALID_ARGUMENT', 'Invalid target node');
  }
  const removed = new Set([targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.history) {
      if (!removed.has(node.id) && node.dependencies.some(ref => removed.has(ref.id))) {
        removed.add(node.id);
        changed = true;
      }
    }
  }
  const history = graph.history.filter(node => !removed.has(node.id));
  if (history.length === graph.history.length) return graph;
  const erasedGraphRevisions = [...(graph.erasedGraphRevisions ?? []),
    ...graph.history.filter(node => removed.has(node.id)).map(node => node.graphRevision)]
    .sort((a, b) => a - b);
  return parseGraph({namespace: graph.namespace, revision: graph.revision, history,
    erasedGraphRevisions});
}

/**
 * Fail-closed verifier for physical erasure unlinking in the coordination graph.
 * Checks that all versions of `targetId` and every transitive dependent node are removed,
 * unrelated nodes and monotonic revision counter stay intact, and the receipt records
 * either the newly unlinked revisions or the cumulative sorted `erasedGraphRevisions`.
 */
export function verifyPhysicalErasureGraphUnlink(
  input: VerifyPhysicalErasureGraphUnlinkInput,
): PhysicalErasureGraphUnlinkReport {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || typeof input.targetId !== 'string' || !input.targetId.trim()) {
    throw new GraphError('INVALID_ARGUMENT', 'Invalid physical erasure verification input');
  }
  const before = parseGraph(input.before);
  const after = parseGraph(input.after);
  assertPrivacyDeletionReceipt(input.receipt);
  const receipt = input.receipt;
  if (receipt.action !== 'privacy_deletion' || receipt.physicalErasure !== true) {
    throw new GraphError('INVALID_ARGUMENT', 'Physical erasure verification requires action="privacy_deletion" and physicalErasure=true');
  }
  if (receipt.namespace !== before.namespace || receipt.targetId !== input.targetId || receipt.graphRevision !== before.revision) {
    throw new GraphError('REVISION_CONFLICT', 'Privacy deletion receipt identity or graph revision does not match source graph');
  }
  const expected = eraseDependentGraphHistory(before, input.targetId);
  const expectedIds = new Set(expected.history.map(node => node.id));
  const removedIds = new Set(before.history.filter(node => !expectedIds.has(node.id)).map(node => node.id));
  const beforeErased = before.erasedGraphRevisions ?? [];
  const expectedErased = expected.erasedGraphRevisions ?? [];
  const afterErased = after.erasedGraphRevisions ?? [];
  const newlyErasedRevisions = expectedErased.filter(rev => !beforeErased.includes(rev));
  if (after.namespace !== expected.namespace || after.revision !== expected.revision) {
    throw new GraphError('REVISION_CONFLICT', 'Post-erasure graph namespace or monotonic revision mismatch');
  }
  if (after.history.some(node => removedIds.has(node.id) || node.dependencies.some(ref => removedIds.has(ref.id)))
    || !isDeepStrictEqual(after.history, expected.history)) {
    throw new GraphError('REVISION_CONFLICT', 'Post-erasure graph retains target node, dependent link, or altered survivors');
  }
  if (!isDeepStrictEqual(afterErased, expectedErased)) {
    throw new GraphError('REVISION_CONFLICT', 'Post-erasure erasedGraphRevisions mismatch');
  }
  if (newlyErasedRevisions.length > 0 && (!receipt.erasedGraphRevisions || receipt.erasedGraphRevisions.length === 0)) {
    throw new GraphError('INVALID_ARGUMENT', 'Physical erasure receipt must record non-empty erasedGraphRevisions');
  }
  if (receipt.erasedGraphRevisions !== undefined) {
    const claimed = [...receipt.erasedGraphRevisions];
    if (!isDeepStrictEqual(claimed, newlyErasedRevisions) && !isDeepStrictEqual(claimed, expectedErased)) {
      throw new GraphError('REVISION_CONFLICT', 'Receipt erasedGraphRevisions does not match actual unlinked revisions');
    }
  }
  return Object.freeze({
    verified: true as const,
    namespace: after.namespace,
    targetId: input.targetId,
    graphRevision: after.revision,
    newlyErasedRevisions: Object.freeze(newlyErasedRevisions),
    totalErasedGraphRevisions: Object.freeze([...afterErased]),
    remainingNodes: after.history.length,
    receipt: structuredClone(receipt),
  });
}
