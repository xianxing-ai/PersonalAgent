import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {parseCoordinationContinuation, parseCoordinationRepairCandidate} from '@personal-agent/coordination';
import {parseGraph} from '@personal-agent/goals';

const sameRef = (left, right) => left.id === right.id && left.revision === right.revision;
const sameDependencies = (left, right) => left.length === right.length
  && right.every(ref => left.some(other => sameRef(ref, other)));
const sameChange = (left, right) => left !== undefined && sameRef(left.node, right.node)
  && left.summary === right.summary && sameDependencies(left.dependencies, right.dependencies);

/** Both inputs are candidate objects already accepted by the public candidate parser. */
export function scoreRepairProposal(actual, expected) {
  const byId = new Map(actual.changes.map(change => [change.node.id, change]));
  const positions = new Map(actual.changes.map((change, index) => [change.node.id, index]));
  const required = new Set(expected.changes.map(change => change.node.id)).size;
  const proposed = byId.size;
  const targetHits = expected.changes.filter(change => byId.has(change.node.id)).length;
  const correctlyRepaired = expected.changes.filter(change => sameChange(byId.get(change.node.id), change)).length;
  const scope = {required, proposed, targetHits, unrelated: proposed - targetHits,
    missed: required - targetHits, correctlyRepaired, unrepaired: required - correctlyRepaired,
    precision: proposed === 0 ? null : targetHits / proposed,
    recall: required === 0 ? null : targetHits / required};
  const checks = {
    graphRevision: actual.expectedGraphRevision === expected.expectedGraphRevision,
    nodeSet: actual.changes.length === expected.changes.length && targetHits === required,
    nodeRevisions: expected.changes.every(change => {
      const observed = byId.get(change.node.id);
      return observed !== undefined && sameRef(observed.node, change.node);
    }),
    summaries: expected.changes.every(change => byId.get(change.node.id)?.summary === change.summary),
    dependencies: expected.changes.every(change => {
      const observed = byId.get(change.node.id);
      return observed !== undefined && sameDependencies(observed.dependencies, change.dependencies);
    }),
    dependencyOrder: actual.changes.every((change, index) => change.dependencies.every(ref => {
      const target = byId.get(ref.id);
      return !target || ref.revision !== target.node.revision + 1 || positions.get(ref.id) < index;
    })),
    noUnrelatedChanges: scope.unrelated === 0,
    targetCoverage: scope.missed === 0,
    repairCompleteness: scope.unrepaired === 0,
  };
  return {checks, scope};
}

function invalid() {
  throw new ProtocolError('INVALID_ARGUMENT', 'Invalid fixed synthetic repair readback');
}

function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
}

function candidateCopy(candidate) {
  return parseCoordinationRepairCandidate({kind: 'repair_candidate', candidateVersion: '1.0',
    candidate, verification: 'unverified'}).candidate;
}

function readbackInputs(observation, options) {
  try {
    // Clone before reading any observation/options property. The public boundary
    // bounds bytes/depth/arrays and rejects accessors, symbols and non-JSON data.
    const copy = parseCoordinationContinuation({proposalId: 'repair-readback', state: 'confirmed',
      result: {observation, options}}).result;
    exactObject(copy.observation, ['taskId', 'before', 'after']);
    exactObject(copy.options, ['taskId', 'fixture', 'candidate']);
    const {taskId, fixture, candidate} = copy.options;
    if (typeof taskId !== 'string' || taskId.length === 0 || taskId.length > 128
      || taskId.trim() !== taskId || /[\u0000-\u001f\u007f]/.test(taskId)
      || copy.observation.taskId !== taskId) invalid();
    return {before: parseGraph(copy.observation.before), after: parseGraph(copy.observation.after),
      snapshot: parseGraph(fixture.snapshot), expected: candidateCopy(fixture.expected),
      candidate: candidateCopy(candidate)};
  } catch {
    invalid();
  }
}

/**
 * Observation must come from the trusted host's read-only local graph readback,
 * never the model response. Parsing checks structure, not that provenance.
 * No graph execution, writes, task transition or Evidence claim occurs here.
 */
export function scoreRepairReadback(observation, options) {
  const {before, after, snapshot, expected, candidate} = readbackInputs(observation, options);
  const appended = after.history.filter(node => node.graphRevision > before.revision);
  const previous = new Map(before.history.map(node => [node.id, node]));
  const requested = new Map(candidate.changes.map(change => [change.node.id, change]));
  const actual = {expectedGraphRevision: before.revision, changes: appended.map(node => ({
    node: {id: node.id, revision: node.revision - 1}, summary: node.summary,
    reason: node.reason, dependencies: node.dependencies,
  }))};
  const {checks, scope} = scoreRepairProposal(actual, expected);
  const requestChecks = scoreRepairProposal(actual, candidate).checks;
  const immutableFields = ['kind', 'sourceRef', 'validFrom', 'validUntil', 'sensitivity', 'state'];
  Object.assign(checks, {
    beforeSnapshot: isDeepStrictEqual(before, snapshot),
    namespace: after.namespace === before.namespace && after.namespace === snapshot.namespace,
    historyPreserved: after.history.length >= before.history.length
      && isDeepStrictEqual(after.history.slice(0, before.history.length), before.history),
    noErasures: before.erasedGraphRevisions === undefined && after.erasedGraphRevisions === undefined,
    graphIncrement: after.revision === before.revision + expected.changes.length
      && appended.length === expected.changes.length,
    appendRevisions: scope.proposed === appended.length && appended.every(node => {
      const prior = previous.get(node.id);
      return prior !== undefined && node.revision === prior.revision + 1;
    }),
    immutableFields: appended.every(node => {
      const prior = previous.get(node.id);
      return prior !== undefined && immutableFields.every(field => node[field] === prior[field]);
    }),
    candidateConsistency: Object.values(requestChecks).every(Boolean)
      && scoreRepairProposal(candidate, candidate).checks.dependencyOrder
      && appended.every(node => node.reason === requested.get(node.id)?.reason),
  });
  return {status: Object.values(checks).every(Boolean) ? 'passed' : 'failed', checks, scope};
}
