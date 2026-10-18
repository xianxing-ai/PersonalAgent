/** Provisional local decision boundary. It cannot authorize, schedule or execute. */
export const INTERVENTIONS = [
  'IGNORE', 'MERGE', 'DEFER', 'REMIND', 'REQUEST_DECISION', 'EXECUTE', 'ESCALATE_AGENTARTS',
] as const;
export type Intervention = typeof INTERVENTIONS[number];

export interface DecisionRef { readonly id: string; readonly revision: number; }
export interface DecisionEvent {
  readonly eventId: string;
  readonly source: string;
  readonly observation: string;
  readonly goal?: {readonly ref: DecisionRef; readonly summary: string};
  readonly facts: readonly DecisionRef[];
  readonly plan?: DecisionRef;
  readonly authorization: {readonly state: 'none' | 'granted' | 'revoked'; readonly revision: number};
}
export interface DecisionRequest {
  readonly events: readonly DecisionEvent[];
  readonly deadline: string;
  readonly signal: AbortSignal;
}
export interface DecisionSuggestion {
  readonly eventId: string;
  readonly source: string;
  readonly intervention: Intervention;
  readonly confidence: number | null;
  readonly reason: 'rule_duplicate' | 'model' | 'uncalibrated_model' | 'low_confidence' | 'model_unavailable';
  readonly facts: readonly DecisionRef[];
  readonly plan?: DecisionRef;
  readonly authorizationRevision: number;
}
export interface DecisionPort {
  decide(request: DecisionRequest): Promise<readonly DecisionSuggestion[]>;
}
export interface ModelChoice { readonly intervention: Intervention; readonly confidence: number; }
export interface BoundedDecisionModel {
  choose(events: readonly DecisionEvent[], signal: AbortSignal): Promise<readonly ModelChoice[]>;
}

async function chooseBeforeAbort(model: BoundedDecisionModel, events: readonly DecisionEvent[],
  signal: AbortSignal, caller: AbortSignal): Promise<readonly ModelChoice[]> {
  if (signal.aborted) throw new DecisionError(caller.aborted ? 'CANCELLED' : 'TIMEOUT');
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new DecisionError(caller.aborted ? 'CANCELLED' : 'TIMEOUT'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, {once: true});
  });
  try { return await Promise.race([model.choose(events, signal), aborted]); }
  finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
}

export class DecisionError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'CANCELLED' | 'TIMEOUT') {
    super(`Decision request rejected: ${code}`);
  }
}

function invalid(): never { throw new DecisionError('INVALID_ARGUMENT'); }
function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}
function exact(value: unknown, keys: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { invalid(); }
  const own = Reflect.ownKeys(descriptors);
  if (own.some(key => typeof key !== 'string' || (!keys.includes(key) && !optional.includes(key)))
    || keys.some(key => !Object.hasOwn(descriptors, key))
    || own.some(key => { const d = descriptors[key as string]; return !d?.enumerable || !('value' in d); })) invalid();
}
function valueOf(object: object, key: string): unknown {
  try { return Object.getOwnPropertyDescriptor(object, key)?.value; } catch { return invalid(); }
}
function ref(value: unknown): DecisionRef {
  exact(value, ['id', 'revision']);
  const id = valueOf(value, 'id');
  const revision = valueOf(value, 'revision');
  if (!identifier(id) || !Number.isSafeInteger(revision) || (revision as number) < 1) invalid();
  return {id, revision: revision as number};
}
function validateEvent(value: unknown): DecisionEvent {
  exact(value, ['eventId', 'source', 'observation', 'facts', 'authorization'], ['goal', 'plan']);
  const eventId = valueOf(value, 'eventId');
  const source = valueOf(value, 'source');
  const observation = valueOf(value, 'observation');
  const rawFacts = valueOf(value, 'facts');
  const rawGoal = valueOf(value, 'goal');
  const rawPlan = valueOf(value, 'plan');
  const rawAuth = valueOf(value, 'authorization');
  if (!identifier(eventId) || !identifier(source)
    || typeof observation !== 'string' || !observation.trim() || observation.length > 200
    || !Array.isArray(rawFacts) || rawFacts.length > 8) invalid();
  let facts: DecisionRef[];
  try { facts = Array.from(rawFacts, item => ref(item)); } catch { invalid(); }
  if (new Set(facts.map(item => item.id)).size !== facts.length) invalid();
  let goal: DecisionEvent['goal'];
  if (rawGoal !== undefined) {
    exact(rawGoal, ['ref', 'summary']);
    const summary = valueOf(rawGoal, 'summary');
    if (typeof summary !== 'string' || !summary.trim() || summary.length > 100) invalid();
    goal = {ref: ref(valueOf(rawGoal, 'ref')), summary};
  }
  const plan = rawPlan === undefined ? undefined : ref(rawPlan);
  exact(rawAuth, ['state', 'revision']);
  const state = valueOf(rawAuth, 'state');
  const revision = valueOf(rawAuth, 'revision');
  if (!['none', 'granted', 'revoked'].includes(state as string)
    || !Number.isSafeInteger(revision) || (revision as number) < 0) invalid();
  return {eventId, source, observation, facts, ...(goal ? {goal} : {}), ...(plan ? {plan} : {}),
    authorization: {state: state as DecisionEvent['authorization']['state'], revision: revision as number}};
}
function validateRequest(request: DecisionRequest): {events: DecisionEvent[]; deadlineMs: number} {
  exact(request, ['events', 'deadline', 'signal']);
  const rawEvents = valueOf(request, 'events');
  const deadline = valueOf(request, 'deadline');
  const signal = valueOf(request, 'signal');
  if (!Array.isArray(rawEvents) || rawEvents.length < 1 || rawEvents.length > 4
    || typeof deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(deadline)
    || !Number.isFinite(Date.parse(deadline)) || new Date(deadline).toISOString() !== deadline
    || !(signal instanceof AbortSignal)) invalid();
  const events = Array.from(rawEvents, item => validateEvent(item));
  const versions = new Map<string, string>();
  const contents = new Map<string, string>();
  for (const event of events) {
    const identity = JSON.stringify([event.source, event.eventId]);
    const version = versionKey(event);
    const content = JSON.stringify([event.observation, event.goal?.summary ?? null]);
    if (versions.has(identity) && (versions.get(identity) !== version || contents.get(identity) !== content)) invalid();
    versions.set(identity, version);
    contents.set(identity, content);
  }
  return {events, deadlineMs: Date.parse(deadline)};
}
function checkLifecycle(signal: AbortSignal, deadlineMs: number): void {
  if (signal.aborted) throw new DecisionError('CANCELLED');
  if (Date.now() >= deadlineMs) throw new DecisionError('TIMEOUT');
}
function versionKey(event: DecisionEvent): string {
  const facts = [...event.facts].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return JSON.stringify([event.source, event.eventId, facts, event.goal?.ref ?? null,
    event.plan ?? null, event.authorization.state, event.authorization.revision]);
}
function suggestion(event: DecisionEvent, intervention: Intervention, confidence: number | null,
  reason: DecisionSuggestion['reason']): DecisionSuggestion {
  return {eventId: event.eventId, source: event.source, intervention, confidence, reason,
    facts: event.facts.map(item => ({...item})), ...(event.plan ? {plan: {...event.plan}} : {}),
    authorizationRevision: event.authorization.revision};
}

/** Bounded event-time routing. Any model answer is only a suggestion for the trusted host. */
export class ProactiveDecisionService implements DecisionPort {
  constructor(private readonly model: BoundedDecisionModel, private readonly minimumConfidence = 0.8) {
    if (!(minimumConfidence > 0 && minimumConfidence <= 1)) invalid();
  }

  async decide(request: DecisionRequest): Promise<readonly DecisionSuggestion[]> {
    const {events, deadlineMs} = validateRequest(request);
    checkLifecycle(request.signal, deadlineMs);
    const seen = new Set<string>();
    const unique: DecisionEvent[] = [];
    const duplicates = new Set<number>();
    events.forEach((event, index) => {
      const key = versionKey(event);
      if (seen.has(key)) duplicates.add(index);
      else { seen.add(key); unique.push(event); }
    });
    let choices: readonly ModelChoice[];
    let failed = false;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    request.signal.addEventListener('abort', cancel, {once: true});
    // This awaited operation must remain alive even when the model owns no handles.
    const timer = setTimeout(cancel, Math.max(1, Math.min(30_000, deadlineMs - Date.now())));
    const signal = controller.signal;
    try {
      // The model receives advisory data only; keep the validated references
      // private so a mutating provider cannot rewrite the resulting binding.
      choices = await chooseBeforeAbort(this.model, structuredClone(unique), signal, request.signal);
      checkLifecycle(request.signal, deadlineMs);
      if (signal.aborted) throw new DecisionError(request.signal.aborted ? 'CANCELLED' : 'TIMEOUT');
      if (!Array.isArray(choices) || choices.length !== unique.length) throw new Error('model shape');
      for (let index = 0; index < choices.length; index++) {
        const choice = choices[index]!;
        exact(choice, ['intervention', 'confidence']);
        if (!INTERVENTIONS.includes(choice.intervention as Intervention)
          || typeof choice.confidence !== 'number' || !Number.isFinite(choice.confidence)
          || choice.confidence < 0 || choice.confidence > 1) throw new Error('model shape');
      }
    } catch (error) {
      checkLifecycle(request.signal, deadlineMs);
      if (signal.aborted) throw new DecisionError(request.signal.aborted ? 'CANCELLED' : 'TIMEOUT');
      failed = true;
      choices = unique.map(() => ({intervention: 'ESCALATE_AGENTARTS', confidence: 0}));
      void error;
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', cancel);
    }
    let next = 0;
    return events.map((event, index) => {
      if (duplicates.has(index)) return suggestion(event, 'MERGE', null, 'rule_duplicate');
      const choice = choices[next++]!;
      if (failed) return suggestion(event, 'ESCALATE_AGENTARTS', null, 'model_unavailable');
      if (choice.confidence < this.minimumConfidence) {
        return suggestion(event, 'ESCALATE_AGENTARTS', choice.confidence, 'low_confidence');
      }
      // The published base checkpoint is not calibrated for this task. It cannot
      // silently suppress, postpone, merge, or initiate a real action.
      if (['IGNORE', 'MERGE', 'DEFER', 'EXECUTE'].includes(choice.intervention)) {
        return suggestion(event, 'ESCALATE_AGENTARTS', choice.confidence, 'uncalibrated_model');
      }
      return suggestion(event, choice.intervention, choice.confidence, 'model');
    });
  }
}
