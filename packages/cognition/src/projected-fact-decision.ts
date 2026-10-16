import {DecisionError, INTERVENTIONS} from './proactive-decision.js';
import type {DecisionEvent, DecisionPort, DecisionRef, DecisionSuggestion} from './proactive-decision.js';
import {withCognitionDeadline} from './deadline.js';

/** Structural view of Runtime's committed FactProjectionReceipt. No Runtime dependency. */
export interface ProjectedFactDecisionInput {
  /** Namespace bound by the trusted projection host, never supplied by a model. */
  readonly graphNamespace: string;
  readonly projection: {
    readonly graphRevision: number;
    readonly links: readonly {
      readonly eventId: string;
      readonly fact: DecisionRef;
      readonly node: DecisionRef;
    }[];
  };
  readonly impact: {
    readonly namespace: string;
    readonly graphRevision: number;
    readonly items: readonly {
      readonly action: 'KEEP' | 'RECHECK';
      readonly causes: readonly {readonly reference: DecisionRef; readonly currentRevision: number}[];
    }[];
  };
  readonly deadline: string;
  readonly signal: AbortSignal;
}

function checkLifecycle(deadline: string, signal: AbortSignal): void {
  if (typeof deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(deadline)
    || !Number.isFinite(Date.parse(deadline)) || new Date(deadline).toISOString() !== deadline
    || !(signal instanceof AbortSignal)) throw new DecisionError('INVALID_ARGUMENT');
  if (signal.aborted) throw new DecisionError('CANCELLED');
  if (Date.now() >= Date.parse(deadline)) throw new DecisionError('TIMEOUT');
}

function invalidResult(): never { throw new Error('Invalid projected fact decision result'); }

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResult();
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { invalidResult(); }
  const own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))
    || keys.some(key => !Object.hasOwn(descriptors, key))) invalidResult();
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) invalidResult();
    copy[key] = descriptor.value;
  }
  return copy;
}

function exactArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalidResult();
  const own = Reflect.ownKeys(value);
  if (own.length !== value.length + 1 || own.some(key => key !== 'length'
    && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)
      || Number(key) >= value.length))) invalidResult();
  const copy: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) invalidResult();
    copy.push(descriptor.value);
  }
  return copy;
}

/** Treat even an injected DecisionPort's output as advisory data, not a trusted binding. */
function validatedSuggestions(value: unknown, events: readonly DecisionEvent[]): readonly DecisionSuggestion[] {
  const rawSuggestions = exactArray(value, events.length);
  // Every submitted event needs one answer; the identity checks below reject
  // duplicates and replacements, so a partial batch cannot look complete.
  if (rawSuggestions.length !== events.length) invalidResult();
  const expected = new Map(events.map(event => [event.eventId, event]));
  const seen = new Set<string>();
  return rawSuggestions.map(raw => {
    const item = exactRecord(raw, ['eventId', 'source', 'intervention', 'confidence', 'reason',
      'facts', 'authorizationRevision']);
    const event = expected.get(item.eventId as string);
    if (!event || seen.has(event.eventId) || item.source !== event.source
      || item.authorizationRevision !== event.authorization.revision
      || !INTERVENTIONS.includes(item.intervention as DecisionSuggestion['intervention'])
      || !['rule_duplicate', 'model', 'uncalibrated_model', 'low_confidence',
        'model_unavailable'].includes(item.reason as string)
      || (item.confidence !== null && (typeof item.confidence !== 'number'
        || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1))) {
      invalidResult();
    }
    const submittedFacts = exactArray(item.facts, event.facts.length);
    if (submittedFacts.length !== event.facts.length) invalidResult();
    seen.add(event.eventId);
    const facts = event.facts.map((reference, index) => {
      const fact = exactRecord(submittedFacts[index], ['id', 'revision']);
      if (fact.id !== reference.id || fact.revision !== reference.revision) invalidResult();
      return {...reference};
    });
    return {eventId: event.eventId, source: event.source,
      intervention: item.intervention as DecisionSuggestion['intervention'],
      confidence: item.confidence as number | null,
      reason: item.reason as DecisionSuggestion['reason'], facts,
      authorizationRevision: event.authorization.revision};
  });
}

/** Called after the existing projection and impact processing, never from a new poller. */
export async function decideProjectedFactImpact(
  decision: DecisionPort, input: ProjectedFactDecisionInput
): Promise<readonly DecisionSuggestion[]> {
  if (!input) throw new DecisionError('INVALID_ARGUMENT');
  const {graphNamespace, projection, impact, deadline, signal} = input;
  if (!projection || !impact || !Number.isSafeInteger(projection.graphRevision)
    || projection.graphRevision < 0 || projection.graphRevision !== impact.graphRevision
    || !Array.isArray(projection.links) || projection.links.length > 4
    || !Array.isArray(impact.items) || typeof graphNamespace !== 'string'
    || !graphNamespace || graphNamespace.trim() !== graphNamespace
    || /[\u0000-\u001f\u007f]/.test(graphNamespace) || impact.namespace !== graphNamespace
    || `memory-projection:${graphNamespace}`.length > 128) {
    throw new DecisionError('INVALID_ARGUMENT');
  }
  checkLifecycle(deadline, signal);
  const events = projection.links.flatMap(link => {
    const affected = impact.items.filter(item => item.action === 'RECHECK'
      && item.causes.some(cause => cause.reference.id === link.node.id
        && cause.currentRevision === link.node.revision));
    if (affected.length === 0) return [];
    return [{
      eventId: link.eventId,
      source: `memory-projection:${graphNamespace}`,
      observation: `Projected fact changed; ${affected.length} dependent graph item(s) require recheck.`,
      facts: [link.fact],
      authorization: {state: 'none' as const, revision: 0},
    }];
  });
  if (new Set(events.map(event => event.eventId)).size !== events.length) {
    throw new DecisionError('INVALID_ARGUMENT');
  }
  if (events.length === 0) {
    checkLifecycle(deadline, signal);
    return [];
  }
  // Keep the expected binding private. An injected port can mutate its request
  // while awaiting, so neither the projection input nor the validation baseline
  // may be shared with the events handed to that port.
  const expectedEvents = events.map(event => ({...event,
    facts: event.facts.map(reference => ({...reference})),
    authorization: {...event.authorization},
  }));
  const submittedEvents = expectedEvents.map(event => ({...event,
    facts: event.facts.map(reference => ({...reference})),
    authorization: {...event.authorization},
  }));
  const suggestions = await withCognitionDeadline({deadline, signal},
    context => decision.decide({events: submittedEvents, ...context}));
  checkLifecycle(deadline, signal);
  return validatedSuggestions(suggestions, expectedEvents);
}
