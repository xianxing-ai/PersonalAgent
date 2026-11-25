import {ProtocolError} from '@personal-agent/contracts';
import type {RepairContext, RepairRef, RepairSource, RepairTarget} from './input.js';
import {projectedFactChanges} from './world-guidance.js';

const fail = (): never => { throw new ProtocolError('EXTERNAL_FAILURE', 'Invalid bound repair decision'); };
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/u.test(value);
const sameRef = (a: RepairRef, b: RepairRef) =>
  a.id === b.id && a.revision === b.revision;

/** An initial projection can prove a literal copy of one updated Goal. Treat
 * it as such only when every target is a plan and each declared dependency
 * is the same changed Goal, or the target has no dependency and a different
 * baseline. A graph with any ambiguous relationship keeps the semantic path. */
export function bindLiteralGoalRepair(context: RepairContext, sources: readonly RepairSource[]) {
  const factsChanged = projectedFactChanges(sources.filter(source => source.kind === 'goal' || source.kind === 'fact'));
  const change = factsChanged[0];
  if (factsChanged.length !== 1 || !change || change.current.kind !== 'goal'
    || change.previous.state !== 'active' || change.current.state !== 'active'
    || change.previous.summary === change.current.summary || !nonempty(change.current.summary)
    || context.allowedDependencies.length !== 1 || !sameRef(context.allowedDependencies[0]!, change.current.node)) {
    return undefined;
  }
  const allowedAffected = new Set<string>();
  const targets: RepairTarget[] = [];
  for (const target of context.targets) {
    const plan = sources.find(source => sameRef(source.node, target.node));
    if (plan?.kind !== 'plan' || target.summary === undefined) return undefined;
    if (!target.requestedDependencies.length && target.summary !== change.previous.summary) {
      targets.push(target);
      continue;
    }
    if (target.summary !== change.previous.summary || target.requestedDependencies.length !== 1
      || !sameRef(target.requestedDependencies[0]!, change.current.node)) return undefined;
    allowedAffected.add(target.node.id);
    targets.push({...target, requestedSummary: change.current.summary});
  }
  return allowedAffected.size ? {context: {...context, targets}, allowedAffected} : undefined;
}

export function boundPlanSlots(context: RepairContext, affected: readonly string[]) {
  return context.targets.filter(({node}) => affected.includes(node.id)).map((target, index) => ({
    slot: index + 1, node: target.node, ...(target.summary === undefined ? {} : {baseline: target.summary}),
    ...(target.requestedSummary === undefined ? {} : {requestedSummary: target.requestedSummary}),
    requestedDependencies: target.requestedDependencies,
  }));
}

/** A new draft describes semantics only. Legacy full reports still go through
 * their existing validation and never get rewritten as a result of failure. */
export function bindPlanDraft(raw: unknown, slots: ReturnType<typeof boundPlanSlots>,
  revision: number, version: '1.1' | '1.2'): unknown {
  if (!object(raw) || !Object.hasOwn(raw, 'planDraftVersion')) return raw;
  if (!exact(raw, ['planDraftVersion', 'disposition', 'steps', 'missing_information'])
    || raw.planDraftVersion !== '1.0' || typeof raw.disposition !== 'string' || !['KEEP', 'RECHECK', 'REVISE'].includes(raw.disposition)
    || !Array.isArray(raw.steps) || raw.steps.length > slots.length
    || !Array.isArray(raw.missing_information)) return fail();
  const preserved_steps: {node: RepairRef; reason: string}[] = [];
  const rechecked_steps: {node: RepairRef; condition: string}[] = [];
  const revised_steps: {node: RepairRef; replacement: string; reason: string}[] = [];
  const dependency_updates: {node: RepairRef; dependencies: RepairRef[]; reason: string}[] = [];
  const report = {
    reportVersion: version, base_revision: revision, disposition: raw.disposition,
    preserved_steps, rechecked_steps, revised_steps, removed_steps: [],
    dependency_updates, evidence_required: ['本地 Runtime/Policy 预览、授权、CAS 和独立读回'],
    missing_information: raw.missing_information, local_next_actions: [],
  };
  const seen = new Set<number>();
  for (const step of raw.steps) {
    if (!object(step) || !Number.isSafeInteger(step.slot) || !nonempty(step.reason)
      || typeof step.action !== 'string' || !['preserve', 'recheck', 'revise'].includes(step.action)) return fail();
    const slot = slots[(step.slot as number) - 1];
    if (!slot || seen.has(slot.slot)) return fail();
    seen.add(slot.slot);
    const {node, requestedSummary, requestedDependencies} = slot;
    const {reason} = step;
    const requiresReplacement = step.action === 'revise' && requestedSummary === undefined;
    if (!exact(step, ['slot', 'action', 'reason', ...(requiresReplacement ? ['replacement'] : [])])) return fail();
    if (step.action === 'preserve') report.preserved_steps.push({node, reason});
    else if (step.action === 'recheck') report.rechecked_steps.push({node, condition: reason});
    else {
      const replacement = requestedSummary ?? step.replacement;
      if (!nonempty(replacement)) return fail();
      report.revised_steps.push({node, replacement, reason});
      report.dependency_updates.push({node, dependencies: requestedDependencies, reason});
    }
  }
  return report;
}

/** Review approves the already validated Plan by reference, without copying
 * its proposal data. Permission and writes remain with the original host. */
export function bindReviewDecision(raw: unknown, expectedGraphRevision: number, changes: readonly unknown[]): unknown {
  if (!object(raw) || !Object.hasOwn(raw, 'reviewDecisionVersion')) return raw;
  if (raw.reviewDecisionVersion !== '1.0') return fail();
  if (raw.decision === 'accept' && exact(raw, ['reviewDecisionVersion', 'decision'])) {
    return {kind: 'repair_candidate', candidateVersion: '1.0', candidate: {expectedGraphRevision, changes}};
  }
  if (raw.decision === 'recheck' && exact(raw, ['reviewDecisionVersion', 'decision', 'reason']) && nonempty(raw.reason)) {
    return {kind: 'text', text: 'RECHECK：' + raw.reason};
  }
  return fail();
}
