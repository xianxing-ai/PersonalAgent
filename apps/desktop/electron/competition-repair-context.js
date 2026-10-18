import {currentNodes} from '@personal-agent/goals';

export const SYNTHETIC_REPAIR_EXPORT_POLICY = 'synthetic-meeting-graph-v4';
const targets = Object.freeze([
  ['attend', 'goal', 'Attend meeting at 15:00'],
  ['prepare', 'decision', 'Prepare one hour before meeting'],
  ['preparation', 'plan', 'Prepare at 14:00'],
]);
const ref = node => ({id: node.id, revision: node.revision});
const same = (a, b) => a?.id === b?.id && a?.revision === b?.revision;
const deny = () => { throw Error('Synthetic repair context export denied'); };

/** Trusted host input only. No repair, guessed graph versions or full-graph export. */
export function projectSyntheticRepairContext(snapshot, projection) {
  const nodes = currentNodes(snapshot);
  if (snapshot.namespace !== 'mvp-synthetic-meeting'
    || projection?.graphRevision !== snapshot.revision
    || !Array.isArray(projection.links) || projection.links.length !== 1) return deny();
  const link = projection.links[0];
  if (link.fact?.id !== 'meeting/time' || link.fact.revision !== 2) return deny();
  const fact = nodes.find(node => same(node, link.node));
  if (!fact || fact.kind !== 'fact' || fact.state !== 'active'
    || fact.summary !== 'Synthetic meeting starts at 17:00'
    || !fact.sourceRef.startsWith('tool-evidence:')
    || fact.sourceRef.length <= 'tool-evidence:'.length) return deny();
  const selected = targets.map(([id, kind, summary]) => {
    const node = nodes.find(item => item.id === id);
    if (!node || node.kind !== kind || node.summary !== summary || node.state !== 'active'
      || node.sourceRef !== 'synthetic/mvp/explicit-plan') return deny();
    return node;
  });
  // Preserve the actual baseline edges. Their versions come from the store, not
  // from the meeting JSON or from a cloud-provided synthetic label.
  for (let index = 0; index < selected.length; index++) {
    const node = selected[index];
    if (node.dependencies.length !== 1) return deny();
    if (index === 0) {
      const previous = snapshot.history.find(item => same(item, node.dependencies[0]));
      if (!previous || previous.id !== fact.id || previous.kind !== 'fact'
        || previous.summary !== 'Synthetic meeting starts at 15:00'
        || previous.sourceRef !== 'synthetic/mvp/baseline') return deny();
    } else if (!same(node.dependencies[0], selected[index - 1])) return deny();
  }
  return {
    expectedGraphRevision: snapshot.revision,
    fact: {id: link.fact.id, revision: link.fact.revision},
    projectedFact: ref(fact),
    allowedDependencies: [ref(fact), ...selected.flatMap(node => [ref(node),
      {id: node.id, revision: node.revision + 1}])],
    targets: selected.map((node, index) => ({node: ref(node), summary: node.summary,
      dependencies: node.dependencies.map(ref),
      requestedSummary: [
        'Attend meeting at 17:00',
        'Prepare one hour before 17:00 meeting',
        'Prepare at 16:00',
      ][index],
      requestedDependencies: [[ref(fact)],
        [{id: selected[0].id, revision: selected[0].revision + 1}],
        [{id: selected[1].id, revision: selected[1].revision + 1}]][index],
    })),
  };
}

/** Separate cloud projection; local binding fields never become wire context fields. */
export function projectSyntheticRepairWire(snapshot, projection) {
  const context = projectSyntheticRepairContext(snapshot, projection);
  const selectedRefs = [context.targets[0].dependencies[0], context.projectedFact,
    ...context.targets.map(target => target.node)];
  const nodes = selectedRefs.map(reference => {
    const node = snapshot.history.find(item => same(item, reference));
    if (!node) return deny();
    const {id, revision, kind, summary, state, validFrom, validUntil} = node;
    return {id, revision, kind, summary, state, validFrom, validUntil};
  });
  return {
    repairContext: {expectedGraphRevision: context.expectedGraphRevision,
      allowedDependencies: context.allowedDependencies,
      targets: context.targets.map(({node, requestedSummary, requestedDependencies}) =>
        ({node, requestedSummary, requestedDependencies}))},
    repairSources: {sourceVersion: '1.0', expectedGraphRevision: snapshot.revision, nodes},
  };
}
