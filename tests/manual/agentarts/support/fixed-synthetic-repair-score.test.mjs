import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ProtocolError} from '@personal-agent/contracts';
import {parseCoordinationRepairCandidate} from '@personal-agent/coordination';
import {appendVersion} from '@personal-agent/goals';
import {buildFixedSyntheticRepairCases} from './fixed-synthetic-repair-cases.mjs';
import {scoreRepairProposal, scoreRepairReadback} from './fixed-synthetic-repair-score.mjs';

const clone = value => structuredClone(value);
const taskId = 'synthetic-private-task-canary';
const parsed = (fixture, variant = 'correct') => parseCoordinationRepairCandidate(fixture.candidates[variant]).candidate;
const parseCandidate = candidate => parseCoordinationRepairCandidate({kind: 'repair_candidate',
  candidateVersion: '1.0', candidate, verification: 'unverified'}).candidate;
const allTrue = checks => Object.values(checks).every(value => value === true);

function apply(snapshot, candidate) {
  let result = clone(snapshot);
  for (const change of candidate.changes) {
    const {revision, graphRevision, ...previous} = result.history.findLast(node => node.id === change.node.id);
    result = appendVersion(result, result.revision, {...previous, summary: change.summary,
      reason: change.reason, dependencies: change.dependencies});
  }
  return result;
}

function readback(fixture, candidate = parsed(fixture)) {
  return {taskId, before: clone(fixture.snapshot), after: apply(fixture.snapshot, candidate)};
}

const score = (observation, fixture, candidate = parsed(fixture)) =>
  scoreRepairReadback(observation, {taskId, fixture, candidate});

function rejectsInput(observation, options) {
  assert.throws(() => scoreRepairReadback(observation, options), error => {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, 'INVALID_ARGUMENT');
    assert.equal(error.message, 'Invalid fixed synthetic repair readback');
    return true;
  });
}

test('correct fixed proposals retain six checks and expose exact scope and completion counts', () => {
  for (const fixture of buildFixedSyntheticRepairCases()) {
    const {checks, scope} = scoreRepairProposal(parsed(fixture), fixture.expected);
    assert.deepEqual(Object.keys(checks), ['graphRevision', 'nodeSet', 'nodeRevisions', 'summaries',
      'dependencies', 'dependencyOrder', 'noUnrelatedChanges', 'targetCoverage', 'repairCompleteness']);
    assert.ok(allTrue(checks));
    const required = fixture.expected.changes.length;
    assert.deepEqual(scope, {required, proposed: required, targetHits: required, unrelated: 0,
      missed: 0, correctlyRepaired: required, unrepaired: 0, precision: 1, recall: 1});
  }
});

test('nonminimal and incomplete proposals separate target coverage from complete semantic repair', () => {
  for (const fixture of buildFixedSyntheticRepairCases()) {
    const required = fixture.expected.changes.length;
    const extra = scoreRepairProposal(parsed(fixture, 'nonMinimal'), fixture.expected);
    assert.equal(extra.checks.noUnrelatedChanges, false);
    assert.equal(extra.checks.targetCoverage, true);
    assert.equal(extra.checks.repairCompleteness, true);
    assert.equal(extra.scope.unrelated, 1);
    assert.equal(extra.scope.precision, required / (required + 1));
    const incomplete = scoreRepairProposal(parsed(fixture, 'incomplete'), fixture.expected);
    assert.equal(incomplete.scope.unrepaired, 1);
    assert.equal(incomplete.checks.repairCompleteness, false);
    assert.equal(incomplete.scope.missed, required > 1 ? 1 : 0);
    assert.equal(incomplete.scope.recall, required > 1 ? (required - 1) / required : 1);
    for (const variant of ['wrongDependency', 'wrongSourceVersion', 'wrongSummary']) {
      const result = scoreRepairProposal(parsed(fixture, variant), fixture.expected);
      assert.equal(result.scope.targetHits, required, variant);
      assert.equal(result.scope.unrepaired, 1, variant);
      assert.equal(result.checks.repairCompleteness, false, variant);
    }
    const wrongRevision = parsed(fixture);
    wrongRevision.changes[0].node.revision++;
    const result = scoreRepairProposal(parseCandidate(wrongRevision), fixture.expected);
    assert.equal(result.checks.nodeRevisions, false);
    assert.equal(result.scope.unrepaired, 1);
  }
});

test('independent targets and dependencies may reorder but new-revision dependencies must follow their targets', () => {
  const [chain, parallel] = buildFixedSyntheticRepairCases();
  for (const fixture of [chain, parallel]) {
    const candidate = parsed(fixture);
    candidate.changes.reverse();
    candidate.changes.forEach(change => change.dependencies.reverse());
    const result = scoreRepairProposal(parseCandidate(candidate), fixture.expected);
    assert.equal(result.checks.dependencyOrder, fixture === parallel);
    assert.equal(result.scope.unrepaired, 0);
    if (fixture === parallel) {
      assert.equal(score(readback(fixture, candidate), fixture, candidate).status, 'passed');
    } else {
      assert.equal(score(readback(fixture), fixture, candidate).checks.candidateConsistency, false);
    }
  }
});

test('correct public appendVersion readbacks pass without changing the caller data', () => {
  for (const fixture of buildFixedSyntheticRepairCases()) {
    const observation = readback(fixture);
    const before = clone({fixture, observation});
    const result = score(observation, fixture);
    assert.equal(result.status, 'passed');
    assert.ok(allTrue(result.checks));
    assert.deepEqual(result.scope, scoreRepairProposal(parsed(fixture), fixture.expected).scope);
    assert.deepEqual({fixture, observation}, before);
  }
});

test('local incomplete, nonminimal and semantically wrong appends fail even when they match the model request', () => {
  for (const fixture of buildFixedSyntheticRepairCases()) {
    for (const variant of ['wrongDependency', 'wrongSourceVersion', 'wrongSummary', 'nonMinimal', 'incomplete']) {
      const candidate = parsed(fixture, variant);
      const result = score(readback(fixture, candidate), fixture, candidate);
      assert.equal(result.status, 'failed', variant);
      assert.equal(result.checks.candidateConsistency, true, variant);
      assert.deepEqual(result.scope, scoreRepairProposal(candidate, fixture.expected).scope, variant);
    }
    const untouched = score({taskId, before: clone(fixture.snapshot), after: clone(fixture.snapshot)}, fixture);
    assert.equal(untouched.status, 'failed');
    assert.equal(untouched.scope.proposed, 0);
    assert.equal(untouched.scope.precision, null);
    assert.equal(untouched.scope.recall, 0);
    assert.equal(untouched.scope.unrepaired, fixture.expected.changes.length);
  }
});

test('readback compares its actual append version and body with both fixture and candidate independently', () => {
  const fixture = buildFixedSyntheticRepairCases()[0];
  const observation = readback(fixture);
  for (const variant of ['staleGraph', 'wrongSummary', 'wrongSourceVersion']) {
    const result = score(observation, fixture, parsed(fixture, variant));
    assert.equal(result.status, 'failed', variant);
    assert.equal(result.checks.candidateConsistency, false, variant);
    assert.equal(result.scope.unrepaired, 0, variant);
  }
  const wrongRevision = parsed(fixture);
  wrongRevision.changes[0].node.revision++;
  assert.equal(score(observation, fixture, parseCandidate(wrongRevision)).checks.candidateConsistency, false);

  const duplicate = clone(observation);
  duplicate.after = apply(duplicate.after, {changes: [parsed(fixture).changes[0]]});
  const result = score(duplicate, fixture);
  assert.equal(result.status, 'failed');
  assert.equal(result.scope.proposed, fixture.expected.changes.length);
  assert.equal(result.scope.unrepaired, 1);
  assert.equal(result.checks.appendRevisions, false);
  assert.equal(result.checks.graphIncrement, false);

  const malformed = clone(observation);
  malformed.after.history.at(-1).revision++;
  rejectsInput(malformed, {taskId, fixture, candidate: parsed(fixture)});
});

test('before must match the fixture and after must preserve namespace and every old history entry', () => {
  const fixture = buildFixedSyntheticRepairCases()[0];
  const wrongBefore = clone(fixture.snapshot);
  wrongBefore.history.find(node => node.id === 'stable-fact').summary = 'private rewritten source';
  const result = score({taskId, before: wrongBefore, after: apply(wrongBefore, parsed(fixture))}, fixture);
  assert.equal(result.status, 'failed');
  assert.equal(result.checks.beforeSnapshot, false);
  assert.equal(result.checks.historyPreserved, true);

  const rewritten = readback(fixture);
  rewritten.after.history.find(node => node.id === 'stable-fact').summary = 'private rewritten source';
  assert.equal(score(rewritten, fixture).checks.historyPreserved, false);
  assert.equal(score(rewritten, fixture).status, 'failed');
  const renamed = readback(fixture);
  renamed.after.namespace = 'private-other-namespace';
  assert.equal(score(renamed, fixture).checks.namespace, false);
  assert.equal(score(renamed, fixture).status, 'failed');
});

test('erasures and changes to immutable source, validity, sensitivity or state cannot pass readback', () => {
  const fixture = buildFixedSyntheticRepairCases()[0];
  const erased = readback(fixture);
  const removed = erased.after.history.find(node => node.id === 'stable-plan');
  erased.after.history = erased.after.history.filter(node => node !== removed);
  erased.after.erasedGraphRevisions = [removed.graphRevision];
  const erasedResult = score(erased, fixture);
  assert.equal(erasedResult.status, 'failed');
  assert.equal(erasedResult.checks.noErasures, false);
  for (const [field, value] of [['sourceRef', 'private-new-source'], ['validFrom', '2026-10-06T00:00:00.000Z'],
    ['validUntil', '2026-10-09T00:00:00.000Z'], ['sensitivity', 'private'], ['state', 'withdrawn']]) {
    const changed = readback(fixture);
    changed.after.history.at(-1)[field] = value;
    const result = score(changed, fixture);
    assert.equal(result.status, 'failed', field);
    assert.equal(result.checks.immutableFields, false, field);
  }
});

test('task binding, unknown wrapper fields and malformed graphs reject with one fixed protocol error', () => {
  const fixture = buildFixedSyntheticRepairCases()[0];
  const valid = readback(fixture);
  const options = {taskId, fixture, candidate: parsed(fixture)};
  for (const observation of [null, {...valid, taskId: 'another-private-task'},
    {...valid, modelClaims: 'private-verified'}, {...valid, before: {...valid.before, extra: 'private'}},
    {...valid, after: {...valid.after, revision: valid.after.revision + 1}}]) {
    rejectsInput(observation, options);
  }
  rejectsInput(valid, {...options, unknown: 'private'});
  rejectsInput(valid, {...options, taskId: ''});
});

test('getters, symbols, sparse arrays, cycles and oversized observations are rejected without evaluating input code', () => {
  const fixture = buildFixedSyntheticRepairCases()[0];
  const valid = readback(fixture);
  const options = {taskId, fixture, candidate: parsed(fixture)};
  let getters = 0;
  const getter = () => { getters++; throw Error('private-getter-content'); };
  const wrapper = clone(valid);
  Object.defineProperty(wrapper, 'taskId', {enumerable: true, get: getter});
  rejectsInput(wrapper, options);
  const nested = clone(valid);
  Object.defineProperty(nested.after.history[0], 'summary', {enumerable: true, get: getter});
  rejectsInput(nested, options);
  const accessorOptions = {...options};
  Object.defineProperty(accessorOptions, 'candidate', {enumerable: true, get: getter});
  rejectsInput(valid, accessorOptions);
  assert.equal(getters, 0);
  const symbol = {...valid, [Symbol('private')]: 'private'};
  rejectsInput(symbol, options);
  const sparse = clone(valid);
  delete sparse.after.history[0];
  rejectsInput(sparse, options);
  const cycle = clone(valid);
  cycle.after.history = [cycle];
  rejectsInput(cycle, options);
  rejectsInput({...valid, after: {...valid.after, namespace: 'x'.repeat(1_048_576)}}, options);
});

test('results contain only status, boolean checks and numeric scope, never request or graph content', () => {
  const fixture = buildFixedSyntheticRepairCases()[0];
  const candidate = parsed(fixture);
  candidate.changes.forEach(change => { change.reason = 'private-reason-canary'; });
  const observation = readback(fixture, candidate);
  const result = score(observation, fixture, candidate);
  assert.equal(result.status, 'passed');
  assert.deepEqual(Object.keys(result), ['status', 'checks', 'scope']);
  assert.ok(Object.values(result.checks).every(value => typeof value === 'boolean'));
  assert.ok(Object.values(result.scope).every(value => value === null || typeof value === 'number'));
  const serialized = JSON.stringify(result);
  for (const secret of [taskId, fixture.snapshot.namespace, candidate.changes[0].node.id,
    candidate.changes[0].summary, 'private-reason-canary', 'synthetic/source/']) {
    assert.equal(serialized.includes(secret), false);
  }
  observation.after.history.at(-1).reason = 'private-different-request-reason';
  assert.equal(score(observation, fixture, candidate).checks.candidateConsistency, false);
});
