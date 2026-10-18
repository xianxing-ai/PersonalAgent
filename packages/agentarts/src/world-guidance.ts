import type {RepairContext, RepairSource} from './input.js';

/** Output vocabulary only. These candidates do not select impact or authorize repair. */
export function worldGuidance(context: RepairContext, sources: readonly RepairSource[]) {
  const facts = sources.filter(source => source.kind === 'fact' || source.kind === 'goal');
  const affected = context.targets.flatMap(target => {
    const source = sources.find(item => item.node.id === target.node.id && item.node.revision === target.node.revision);
    if (!source || source.kind === 'fact') return [];
    return [{node: target.node, kind: source.kind === 'plan' ? 'plan_step' : source.kind}];
  });
  const changed = facts.flatMap(current => {
    const previous = facts.find(item => item.node.id === current.node.id && item.node.revision === current.node.revision - 1);
    if (!previous || previous.kind !== current.kind
      || (previous.summary === current.summary && previous.state === current.state)
      || facts.some(item => item.node.id === current.node.id && item.node.revision > current.node.revision)) return [];
    return [{previous: previous.node, current: current.node}];
  });
  return {reportVersion: affected.some(item => item.kind === 'goal') ? '1.2' : '1.1',
    revision: context.expectedGraphRevision,
    observed_fact_candidates: facts.map(source => ({node: source.node, fact: source.summary})),
    changed_fact_candidates: changed, affected_item_candidates: affected};
}
