import assert from 'node:assert/strict';
import {test} from 'node:test';
import {currentNodes, parseGraph} from '@personal-agent/goals';
import {analyzeImpact, previewStoredRepair} from '@personal-agent/cognition';
import {parseCoordinationRepairCandidate} from '@personal-agent/coordination';
import {buildFixedSyntheticRepairCases} from './fixed-synthetic-repair-cases.mjs';

const clone = value => structuredClone(value);
const store = snapshot => ({read: () => clone(snapshot)});
const preview = (item, candidate) => previewStoredRepair(store(item.snapshot), item.at, candidate.candidate);
const actions = report => report.items.map(item => [item.node.id, item.action]);

test('three fixed worlds have valid histories and precisely the expected affected scope', () => {
  const cases = buildFixedSyntheticRepairCases();
  assert.deepEqual(cases.map(item => item.caseId),
    ['meeting-time-chain', 'meeting-parallel-dependants', 'delivery-plan-only']);
  for (const item of cases) {
    assert.deepEqual(parseGraph(item.snapshot), item.snapshot);
    assert.deepEqual(new Set(currentNodes(item.snapshot).map(node => node.kind)),
      new Set(['fact', 'goal', 'decision', 'plan']));
    const impact = analyzeImpact(item.snapshot, item.at);
    assert.deepEqual(impact.items.filter(node => node.action === 'RECHECK').map(node => node.node),
      item.expected.changes.map(change => change.node));
    assert.ok(impact.items.filter(node => node.node.id.startsWith('stable-'))
      .every(node => node.action === 'KEEP'));
    assert.equal(item.expected.expectedGraphRevision, item.snapshot.revision);
  }
});

test('correct public candidates repair the full chain while preserving all unrelated versions and the input', () => {
  for (const item of buildFixedSyntheticRepairCases()) {
    const before = clone(item.snapshot);
    const result = parseCoordinationRepairCandidate(item.candidates.correct);
    assert.deepEqual(result.candidate, item.expected);
    const repaired = preview(item, result);
    assert.ok(repaired.after.report.items.every(node => node.action === 'KEEP'));
    assert.equal(repaired.after.snapshot.revision, before.revision + item.expected.changes.length);
    const targetIds = new Set(item.expected.changes.map(change => change.node.id));
    const unaffectedBefore = currentNodes(before).filter(node => !targetIds.has(node.id));
    const unaffectedAfter = currentNodes(repaired.after.snapshot).filter(node => !targetIds.has(node.id));
    assert.deepEqual(unaffectedAfter, unaffectedBefore);
    assert.deepEqual(item.snapshot, before);
    assert.ok(repaired.inputs.every(input => input.sourceRef ===
      before.history.findLast(node => node.id === input.id).sourceRef));
  }
});

test('source-version and incomplete counterexamples remain unresolved; stale graph and nonminimal edits are rejected', () => {
  for (const item of buildFixedSyntheticRepairCases()) {
    for (const [key, candidate] of Object.entries(item.candidates)) {
      assert.deepEqual(parseCoordinationRepairCandidate(candidate), candidate, `${item.caseId}/${key}`);
    }
    for (const key of ['wrongSourceVersion', 'incomplete']) {
      assert.ok(actions(preview(item, item.candidates[key]).after.report)
        .some(([, action]) => action === 'RECHECK'), `${item.caseId}/${key}`);
    }
    assert.throws(() => preview(item, item.candidates.staleGraph), {code: 'REVISION_CONFLICT'});
    assert.throws(() => preview(item, item.candidates.nonMinimal), {code: 'NOT_APPLICABLE'});
  }
});

test('semantic counterexamples can pass structural preview but differ in source identity or summary', () => {
  for (const item of buildFixedSyntheticRepairCases()) {
    for (const key of ['wrongDependency', 'wrongSummary']) {
      const candidate = parseCoordinationRepairCandidate(item.candidates[key]);
      assert.ok(preview(item, candidate).after.report.items.every(node => node.action === 'KEEP'));
      assert.notDeepEqual(candidate.candidate, item.expected, `${item.caseId}/${key}`);
    }
    const correct = item.expected.changes[0];
    const wrongDependency = item.candidates.wrongDependency.candidate.changes[0];
    assert.deepEqual(wrongDependency.node, correct.node);
    assert.notDeepEqual(wrongDependency.dependencies, correct.dependencies);
    assert.notEqual(item.candidates.wrongSummary.candidate.changes[0].summary, correct.summary);
  }
});

test('model goal contains only fixed source worlds and general task rules; evaluator answers are isolated across calls', () => {
  const first = buildFixedSyntheticRepairCases();
  const second = buildFixedSyntheticRepairCases();
  assert.deepEqual(first, second);
  for (const item of first) {
    const [rubric, payload, extra] = item.goal.split('\n\nSynthetic world:\n');
    assert.equal(extra, undefined);
    assert.match(rubric, /minimal repair/);
    assert.deepEqual(JSON.parse(payload), {at: item.at, graph: item.snapshot});
    assert.doesNotMatch(item.goal, /requestedSummary|nextSummary|"changes"|"candidates"|"correct"/);
    for (const change of item.expected.changes) assert.ok(!item.goal.includes(change.summary));
    item.expected.changes[0].summary = 'Caller changed an evaluator answer';
    item.candidates.correct.candidate.changes[0].dependencies.length = 0;
    item.snapshot.history[0].summary = 'Caller changed a source world';
    assert.ok(!item.goal.includes('Caller changed'));
  }
  assert.deepEqual(second, buildFixedSyntheticRepairCases());
});
