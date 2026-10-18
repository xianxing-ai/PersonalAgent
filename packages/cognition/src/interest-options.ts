import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {actionArgumentsDigest} from './laya-action-choice.js';
import type {LayaActionChoiceService, LayaActionSelection} from './laya-action-choice.js';
import {decideInterest} from './interest-policy.js';
import type {InterestEvidenceRef, InterestPolicyDecision, InterestPolicyInput} from './interest-policy.js';
import {withCognitionDeadline} from './deadline.js';

export type InterestApproachId = 'track_public' | 'review_public' | 'retain_candidate' |
  'defer' | 'stop_tracking' | 'keep_revoked' | 'recheck';
export interface InterestApproach {
  readonly id: InterestApproachId;
  readonly revision: 1;
  readonly description: string;
  /** All choices are advice for AgentArts orchestration, never executable tools. */
  readonly kind: 'escalate';
  readonly source?: {readonly id: string; readonly revision: string; readonly validUntil: string};
  readonly evidence: readonly InterestEvidenceRef[];
  readonly scope: {readonly id: string; readonly revision: number};
}
export interface InterestOptions {
  readonly policy: InterestPolicyDecision;
  readonly options: readonly InterestApproach[];
}
export interface InterestChoiceReceipt {
  readonly digest: string;
  readonly topicId: string;
  readonly evidence: readonly InterestEvidenceRef[];
  readonly source?: {readonly id: string; readonly revision: string};
  readonly scope: {readonly id: string; readonly revision: number};
  readonly optionRefs: readonly {readonly id: InterestApproachId; readonly revision: 1}[];
  readonly selectedRef?: {readonly id: InterestApproachId; readonly revision: 1};
  readonly modelReceiptId: string;
}
export interface InterestChoiceResult extends InterestOptions {
  readonly selection: LayaActionSelection;
  readonly selected?: InterestApproach;
  readonly outcome: 'selected' | 'recheck';
  /** Source heads, scope revocation and user intent require a fresh trusted-host check. */
  readonly requiresHostRevalidation: true;
  readonly calibrated: false;
  readonly receipt: InterestChoiceReceipt;
}

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function invalid(message = 'Invalid interest options input'): never { throw Error(message); }
function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))
    || required.some(key => !Object.hasOwn(value, key))) return invalid();
  return value as Record<string, unknown>;
}
function time(value: unknown): number {
  if (!text(value)) return invalid();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return invalid();
  return parsed;
}
function identity(value: unknown): void {
  const ref = object(value, ['id', 'topicId', 'sourceId', 'sourceRevision']);
  if (![ref.id, ref.topicId, ref.sourceId, ref.sourceRevision].every(text)) invalid();
}
function validate(input: unknown): asserts input is InterestPolicyInput {
  const raw = object(input, ['topicId', 'at', 'evidenceMaxAgeMs', 'watchDurationMs', 'evidence', 'scope'],
    ['source', 'previous', 'tombstone', 'explicitEnable', 'classification']);
  if (!text(raw.topicId) || !Number.isFinite(raw.evidenceMaxAgeMs)
    || (raw.evidenceMaxAgeMs as number) <= 0 || !Number.isFinite(raw.watchDurationMs)
    || (raw.watchDurationMs as number) <= 0 || !Array.isArray(raw.evidence)) invalid();
  time(raw.at);
  const scope = object(raw.scope, ['state', 'id', 'revision', 'publicLowRiskTracking', 'expiresAt']);
  if (!['granted', 'none', 'revoked'].includes(scope.state as string) || !text(scope.id)
    || !Number.isSafeInteger(scope.revision) || (scope.revision as number) < 1
    || typeof scope.publicLowRiskTracking !== 'boolean') invalid();
  time(scope.expiresAt);
  if (raw.source !== undefined) {
    const source = object(raw.source, ['id', 'revision', 'visibility', 'risk', 'transportVerified', 'verificationExpiresAt']);
    if (!text(source.id) || !text(source.revision)
      || !['public', 'private'].includes(source.visibility as string)
      || !['low', 'high'].includes(source.risk as string)
      || typeof source.transportVerified !== 'boolean') invalid();
    time(source.verificationExpiresAt);
  }
  for (const value of raw.evidence) {
    const evidence = object(value, ['id', 'topicId', 'sourceId', 'sourceRevision', 'occurredAt',
      'interactionId', 'kind', 'match'], ['relatedEvidenceId']);
    if (![evidence.id, evidence.topicId, evidence.sourceId, evidence.sourceRevision,
      evidence.interactionId].every(text) || !['question', 'followup', 'bookmark', 'active_goal'].includes(evidence.kind as string)
      || !['exact', 'semantic', 'keyword'].includes(evidence.match as string)
      || (evidence.relatedEvidenceId !== undefined && !text(evidence.relatedEvidenceId))) invalid();
    time(evidence.occurredAt);
  }
  if (raw.previous !== undefined) {
    const previous = object(raw.previous, ['state']);
    if (!['candidate', 'watch_public', 'abstain', 'decay', 'revoked'].includes(previous.state as string)) invalid();
  }
  if (raw.tombstone !== undefined) {
    const tombstone = object(raw.tombstone, ['id', 'topicId', 'revokedAt']);
    if (!text(tombstone.id) || !text(tombstone.topicId)) invalid();
    time(tombstone.revokedAt);
  }
  if (raw.explicitEnable !== undefined) {
    const enable = object(raw.explicitEnable, ['id', 'topicId', 'occurredAt']);
    if (!text(enable.id) || !text(enable.topicId)) invalid();
    time(enable.occurredAt);
  }
  if (raw.classification !== undefined) {
    const classification = object(raw.classification, ['label', 'abstained', 'evidence', 'calibrated']);
    if (!['sustained', 'incidental', 'uncertain'].includes(classification.label as string)
      || typeof classification.abstained !== 'boolean' || classification.calibrated !== false
      || !Array.isArray(classification.evidence)) invalid();
    classification.evidence.forEach(identity);
  }
}

/** Pure, bounded approaches; even track_public is an AgentArts proposal, not a watcher. */
export function buildInterestOptions(input: InterestPolicyInput): InterestOptions {
  const snapshot = structuredClone(input);
  validate(snapshot);
  const policy = decideInterest(snapshot);
  const common = {revision: 1 as const, kind: 'escalate' as const,
    evidence: structuredClone(policy.evidence),
    scope: {id: snapshot.scope.id, revision: snapshot.scope.revision}};
  const option = (id: InterestApproachId, description: string): InterestApproach => ({id, description, ...common});
  let options: InterestApproach[];
  switch (policy.state) {
    case 'watch_public':
      if (!snapshot.source || !policy.expiresAt) return invalid();
      options = [{...option('track_public', 'Ask AgentArts to plan tracking for this verified public source.'),
        source: {id: snapshot.source.id, revision: snapshot.source.revision, validUntil: policy.expiresAt}},
        option('review_public', 'Ask AgentArts to review the public source without starting tracking.'),
        option('defer', 'Ask AgentArts to defer a tracking decision.')];
      break;
    case 'candidate':
      options = [option('retain_candidate', 'Retain the interest candidate for review.'),
        option('defer', 'Defer the interest candidate decision.')];
      break;
    case 'revoked':
      options = [option('stop_tracking', 'Ask AgentArts to stop any existing tracking.'),
        option('keep_revoked', 'Keep the user revocation in effect.')];
      break;
    case 'decay':
      options = [option('stop_tracking', 'Ask AgentArts to stop stale tracking.'),
        option('defer', 'Defer a new interest decision.')];
      break;
    case 'abstain':
      options = [option('recheck', 'Ask AgentArts to recheck evidence and source scope.'),
        option('defer', 'Defer the interest decision.')];
      break;
  }
  return structuredClone({policy, options});
}

function nowMs(clock: () => Date | number): number {
  const value = clock();
  const result = value instanceof Date ? value.getTime() : value;
  if (typeof result !== 'number' || !Number.isFinite(result)) return invalid('Invalid interest clock');
  return result;
}
const key = (value: {id: string; revision: number}) => JSON.stringify([value.id, value.revision]);
function selectionRef(selection: LayaActionSelection, options: readonly InterestApproach[]): InterestApproach | undefined {
  if (selection.selected === undefined) return undefined;
  const selected = object(selection.selected, ['id', 'revision']);
  if (!text(selected.id) || !Number.isSafeInteger(selected.revision)) return invalid('Invalid interest selection');
  const option = options.find(option => key(option) === key(selected as {id: string; revision: number}));
  if (!option) return invalid('Interest selection is outside offered options');
  return option;
}

export class LayaInterestDecisionService {
  constructor(private readonly chooser: Pick<LayaActionChoiceService, 'choose'>,
    private readonly now: () => Date | number = Date.now) {}

  async choose(input: InterestPolicyInput, request: {deadline: string; signal: AbortSignal}): Promise<InterestChoiceResult> {
    const lease = {...request};
    const snapshot = structuredClone(input);
    validate(snapshot);
    const started = nowMs(this.now);
    if (!(lease.signal instanceof AbortSignal) || time(lease.deadline) <= started
      || time(snapshot.at) > started) invalid();
    const evaluated = {...snapshot, at: new Date(started).toISOString()};
    const built = buildInterestOptions(evaluated);
    const model = await withCognitionDeadline(lease, bounded => this.chooser.choose({
      context: JSON.stringify({topicId: evaluated.topicId, policyState: built.policy.state,
        reason: built.policy.reason, evidenceCount: built.policy.evidence.length,
        destination: 'AgentArts orchestration; no tracking or authorization granted'}),
      candidates: built.options.map(option => ({id: option.id, revision: option.revision,
        kind: 'escalate' as const, description: option.description, sources: [],
        scopeRef: JSON.stringify([evaluated.scope.id, evaluated.scope.revision]),
        expiresAt: option.id === 'track_public' ? new Date(Math.min(time(lease.deadline),
          time(option.source!.validUntil))).toISOString() : lease.deadline,
        risk: 'low' as const, argumentsDigest: actionArgumentsDigest({})})),
      ...bounded
    }), () => nowMs(this.now));
    const offered = selectionRef(model, built.options);
    const current = nowMs(this.now);
    const currentPolicy = decideInterest({...evaluated, at: new Date(current).toISOString()});
    const fresh = !lease.signal.aborted && current < time(lease.deadline)
      && currentPolicy.state === built.policy.state
      && currentPolicy.reason === built.policy.reason
      && isDeepStrictEqual(currentPolicy.evidence, built.policy.evidence)
      && isDeepStrictEqual(currentPolicy.source, built.policy.source)
      && (offered?.id !== 'track_public' || (currentPolicy.state === 'watch_public'
        && built.policy.expiresAt !== undefined && current < time(built.policy.expiresAt)
        && currentPolicy.expiresAt !== undefined && current < time(currentPolicy.expiresAt)));
    const selected = model.state === 'selected' && fresh ? offered : undefined;
    const evidence = [...built.policy.evidence].sort((a, b) => {
      const left = JSON.stringify([a.id, a.topicId, a.sourceId, a.sourceRevision]);
      const right = JSON.stringify([b.id, b.topicId, b.sourceId, b.sourceRevision]);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    const binding = {topicId: evaluated.topicId, evidence, source: built.policy.source ?? null,
      scope: {id: evaluated.scope.id, revision: evaluated.scope.revision},
      optionRefs: built.options.map(option => ({id: option.id, revision: option.revision})),
      selectedRef: selected ? {id: selected.id, revision: selected.revision} : null,
      policy: {state: built.policy.state, reason: built.policy.reason,
        expiresAt: built.policy.expiresAt ?? null},
      scopeMetadata: {state: evaluated.scope.state,
        publicLowRiskTracking: evaluated.scope.publicLowRiskTracking,
        expiresAt: evaluated.scope.expiresAt},
      sourceMetadata: evaluated.source ?? null,
      tombstone: evaluated.tombstone ?? null,
      explicitEnable: evaluated.explicitEnable ?? null,
      optionValidity: built.options.map(option => ({id: option.id, revision: option.revision,
        expiresAt: option.id === 'track_public' ? option.source!.validUntil : lease.deadline}))};
    const receipt: InterestChoiceReceipt = {digest: createHash('sha256').update(JSON.stringify(binding)).digest('hex'),
      topicId: evaluated.topicId, evidence, ...(built.policy.source ? {source: built.policy.source} : {}),
      scope: binding.scope, optionRefs: binding.optionRefs,
      ...(selected ? {selectedRef: {id: selected.id, revision: selected.revision}} : {}),
      modelReceiptId: model.receipt.id};
    return structuredClone({...built, selection: model, ...(selected ? {selected} : {}),
      outcome: selected ? 'selected' as const : 'recheck' as const,
      requiresHostRevalidation: true as const, calibrated: false as const, receipt});
  }
}
