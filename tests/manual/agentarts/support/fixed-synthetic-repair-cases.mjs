const AT = '2026-10-07T08:00:00.000Z';
const ref = (id, revision = 1) => ({id, revision});
const clone = value => structuredClone(value);

function node(id, kind, summary, dependencies = []) {
  return {id, kind, summary, dependencies, sourceRef: `synthetic/source/${id}`,
    validFrom: '2026-10-07T00:00:00.000Z', validUntil: '2026-10-08T00:00:00.000Z',
    sensitivity: 'public', state: 'active', reason: 'Fixed synthetic evaluation fixture'};
}

function world(caseId, inputs) {
  const revisions = new Map();
  const history = inputs.map((input, index) => {
    const revision = (revisions.get(input.id) ?? 0) + 1;
    revisions.set(input.id, revision);
    return {...clone(input), revision, graphRevision: index + 1};
  });
  return {namespace: `synthetic-repair/${caseId}`, revision: history.length, history};
}

function change(id, summary, dependencies) {
  return {node: ref(id), summary, reason: 'Recheck the changed source and preserve the dependency identity',
    dependencies};
}

function result(candidate) {
  return {kind: 'repair_candidate', candidateVersion: '1.0', candidate: clone(candidate),
    verification: 'unverified'};
}

// This rubric describes the task, rather than supplying per-case target IDs,
// next summaries, next dependencies, or the evaluator's answer.
const RUBRIC = [
  'Propose a minimal repair of the synthetic versioned dependency graph below.',
  'Use the graph history, active current nodes and newest fact versions at the evaluation time.',
  'Repair all directly or transitively affected Goal/Decision/Plan nodes in dependency order.',
  'Keep their original dependency identities and unrelated dependencies; bind changed dependencies to the newest effective version, including earlier changes in this candidate.',
  'Preserve existing summary wording, changing only explicit UTC times required by the authoritative fact and the one-hour preparation rule when present.',
  'Do not revise any unaffected node, any fact, provenance or validity interval. Do not invent dependency edges.',
  'Return a repair_candidate version 1.0 with expectedGraphRevision and changes (node, summary, reason, dependencies). Each reason must explain the change.',
  'A candidate does not authorize a tool, write the graph, change task state, or establish execution or Evidence. Do not output verification or execution claims.',
].join('\n');

function makeCase(caseId, inputs, expectedChanges, changedFactId) {
  const snapshot = world(caseId, inputs);
  const expected = {expectedGraphRevision: snapshot.revision, changes: expectedChanges};
  const stable = snapshot.history.find(item => item.id === 'stable-plan');
  const candidates = {correct: result(expected)};
  const first = expectedChanges.find(item => item.dependencies.some(dep => dep.id === changedFactId));

  const wrongDependency = clone(expected);
  wrongDependency.changes.find(item => item.node.id === first.node.id).dependencies =
    first.dependencies.map(dep => dep.id === changedFactId ? ref('stable-fact') : clone(dep));
  candidates.wrongDependency = result(wrongDependency);

  const wrongSourceVersion = clone(expected);
  wrongSourceVersion.changes.find(item => item.node.id === first.node.id).dependencies =
    first.dependencies.map(dep => dep.id === changedFactId ? ref(changedFactId) : clone(dep));
  candidates.wrongSourceVersion = result(wrongSourceVersion);

  candidates.nonMinimal = result({...clone(expected), changes: [...clone(expectedChanges),
    change(stable.id, 'Unrequested change to the unrelated plan', clone(stable.dependencies))]});
  candidates.staleGraph = result({...clone(expected), expectedGraphRevision: snapshot.revision - 1});
  const wrongSummary = clone(expected);
  wrongSummary.changes[0].summary = 'Perform the affected activity at 23:00 UTC';
  candidates.wrongSummary = result(wrongSummary);
  // A single-target case still has a nonempty, schema-valid incomplete repair:
  // it retains the stale source edge instead of repairing that sole target.
  candidates.incomplete = result(expectedChanges.length > 1
    ? {...clone(expected), changes: clone(expectedChanges.slice(0, -1))} : wrongSourceVersion);

  return {caseId,
    goal: `${RUBRIC}\n\nSynthetic world:\n${JSON.stringify({at: AT, graph: snapshot})}`,
    expected, candidates, snapshot, at: AT};
}

function stableNodes() {
  return [
    node('stable-fact', 'fact', 'Cafeteria lunch starts at 12:00 UTC'),
    node('stable-goal', 'goal', 'Have lunch at 12:00 UTC', [ref('stable-fact')]),
    node('stable-decision', 'decision', 'Walk to the cafeteria at 11:50 UTC', [ref('stable-goal')]),
    node('stable-plan', 'plan', 'Leave for lunch at 11:50 UTC', [ref('stable-decision')]),
  ];
}

/** Evaluator-only fixtures. Send only case.goal through CoordinationRequest. */
export function buildFixedSyntheticRepairCases() {
  return [
    makeCase('meeting-time-chain', [
      node('meeting-time', 'fact', 'Meeting starts at 15:00 UTC'),
      node('attend', 'goal', 'Attend meeting at 15:00 UTC', [ref('meeting-time')]),
      node('prepare', 'decision', 'Prepare one hour before the 15:00 UTC meeting', [ref('attend')]),
      node('preparation', 'plan', 'Prepare at 14:00 UTC', [ref('prepare')]),
      ...stableNodes(),
      node('meeting-time', 'fact', 'Meeting starts at 17:00 UTC'),
    ], [
      change('attend', 'Attend meeting at 17:00 UTC', [ref('meeting-time', 2)]),
      change('prepare', 'Prepare one hour before the 17:00 UTC meeting', [ref('attend', 2)]),
      change('preparation', 'Prepare at 16:00 UTC', [ref('prepare', 2)]),
    ], 'meeting-time'),
    makeCase('meeting-parallel-dependants', [
      node('meeting-time', 'fact', 'Meeting starts at 15:00 UTC'),
      ...stableNodes(),
      node('attend', 'goal', 'Attend meeting at 15:00 UTC', [ref('meeting-time')]),
      node('preparation', 'plan', 'Prepare one hour before the 15:00 UTC meeting',
        [ref('meeting-time'), ref('stable-decision')]),
      node('meeting-time', 'fact', 'Meeting starts at 17:00 UTC'),
    ], [
      change('attend', 'Attend meeting at 17:00 UTC', [ref('meeting-time', 2)]),
      change('preparation', 'Prepare one hour before the 17:00 UTC meeting',
        [ref('meeting-time', 2), ref('stable-decision')]),
    ], 'meeting-time'),
    makeCase('delivery-plan-only', [
      node('delivery-time', 'fact', 'Parcel arrives at 08:00 UTC'),
      ...stableNodes(),
      node('delivery-plan', 'plan', 'Check parcel arrival at 08:00 UTC',
        [ref('delivery-time'), ref('stable-decision')]),
      node('delivery-time', 'fact', 'Parcel arrives at 09:00 UTC'),
    ], [
      change('delivery-plan', 'Check parcel arrival at 09:00 UTC',
        [ref('delivery-time', 2), ref('stable-decision')]),
    ], 'delivery-time'),
  ];
}
