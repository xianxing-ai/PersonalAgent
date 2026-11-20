import type {RepairContext, RepairRef, RepairSource} from './input.js';

export function projectedFactChanges(facts: readonly RepairSource[]) {
  return facts.flatMap(current => {
    const previous = facts.find(item => item.node.id === current.node.id && item.node.revision === current.node.revision - 1);
    if (!previous || previous.kind !== current.kind
      || (previous.summary === current.summary && previous.state === current.state)
      || facts.some(item => item.node.id === current.node.id && item.node.revision > current.node.revision)) return [];
    return [{previous, current}];
  });
}

/** Output vocabulary only. These candidates do not select impact or authorize repair. */
export function worldGuidance(context: RepairContext, sources: readonly RepairSource[], allowedAffected?: ReadonlySet<string>) {
  const facts = sources.filter(source => source.kind === 'fact' || source.kind === 'goal');
  const affected = context.targets.flatMap(target => {
    if (allowedAffected !== undefined && !allowedAffected.has(target.node.id)) return [];
    const source = sources.find(item => item.node.id === target.node.id && item.node.revision === target.node.revision);
    if (!source || source.kind === 'fact') return [];
    return [{node: target.node, kind: source.kind === 'plan' ? 'plan_step' : source.kind}];
  });
  const changed = projectedFactChanges(facts).map(({previous, current}) => ({previous: previous.node, current: current.node}));
  return {reportVersion: affected.some(item => item.kind === 'goal') ? '1.2' : '1.1',
    revision: context.expectedGraphRevision,
    observed_fact_candidates: facts.map(source => ({node: source.node, fact: source.summary})),
    changed_fact_candidates: changed, affected_item_candidates: affected};
}

/** Derived scope & dependency constraints only; never preselects disposition or changes. */
export function planGuidance(
  context: RepairContext,
  world: {reportVersion?: '1.1' | '1.2'; affected: readonly string[]},
  prospectiveDependencies: readonly RepairRef[] = [],
) {
  const affectedIds = new Set(world.affected);
  const affected_targets = context.targets
    .filter(target => affectedIds.has(target.node.id))
    .map(target => ({
      node: target.node,
      ...(target.summary !== undefined ? {current_summary: target.summary} : {}),
      required_dependencies: target.requestedDependencies,
      ...(target.requestedSummary !== undefined ? {required_replacement: target.requestedSummary} : {}),
    }));
  const preserved_targets = context.targets
    .filter(target => !affectedIds.has(target.node.id))
    .map(target => ({node: target.node}));
  return {
    reportVersion: world.reportVersion ?? '1.1',
    base_revision: context.expectedGraphRevision,
    affected_targets,
    preserved_targets,
    ...(prospectiveDependencies.length ? {prospective_dependencies: prospectiveDependencies} : {}),
  };
}
