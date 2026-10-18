import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decideProjectedFactImpact} from '../dist/projected-fact-decision.js';
import {ProactiveDecisionService} from '../dist/proactive-decision.js';

const input = () => ({
  graphNamespace: 'synthetic',
  projection: {graphRevision: 3, links: [{eventId: 'synthetic-change-2',
    fact: {id: 'calendar/location', revision: 2}, node: {id: 'memory-fact:location', revision: 2}}]},
  impact: {namespace: 'synthetic', graphRevision: 3, evaluatedAt: '2026-09-24T00:00:00.000Z',
    items: [{node: {id: 'plan-1', revision: 1}, kind: 'plan', action: 'RECHECK',
      reason: 'dependency_or_validity_changed', causes: [{reference: {id: 'memory-fact:location', revision: 1},
        currentRevision: 2, reason: 'superseded'}]}]},
  deadline: new Date(Date.now() + 5_000).toISOString(), signal: new AbortController().signal,
});
const validSuggestion = event => ({eventId: event.eventId, source: event.source,
  intervention: 'REMIND', confidence: 0.9, reason: 'model', facts: event.facts,
  authorizationRevision: event.authorization.revision});

test('committed projection and matching impact reach the safe decision service', async () => {
  let events;
  const decision = new ProactiveDecisionService({async choose(batch) {
    events = batch;
    return [{intervention: 'EXECUTE', confidence: 0.99}];
  }});
  const [suggestion] = await decideProjectedFactImpact(decision, input());
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'memory-projection:synthetic');
  assert.equal(events[0].eventId, 'synthetic-change-2');
  assert.deepEqual(events[0].facts, [{id: 'calendar/location', revision: 2}]);
  assert.deepEqual(events[0].authorization, {state: 'none', revision: 0});
  assert.deepEqual([suggestion.intervention, suggestion.reason], ['ESCALATE_AGENTARTS', 'uncalibrated_model']);
});

test('unavailable model escalates; unrelated impact does not call the model', async () => {
  let calls = 0;
  const decision = new ProactiveDecisionService({async choose() { calls++; throw new Error('offline'); }});
  const [suggestion] = await decideProjectedFactImpact(decision, input());
  assert.deepEqual([suggestion.intervention, suggestion.reason], ['ESCALATE_AGENTARTS', 'model_unavailable']);
  const unrelated = input();
  unrelated.impact.items[0].causes[0].reference.id = 'different-fact';
  assert.deepEqual(await decideProjectedFactImpact(decision, unrelated), []);
  assert.equal(calls, 1);
});

test('mismatched graph revisions are rejected before model use', async () => {
  const mismatched = input();
  mismatched.impact.graphRevision = 4;
  await assert.rejects(() => decideProjectedFactImpact({decide() { throw new Error('unexpected'); }}, mismatched),
    {code: 'INVALID_ARGUMENT'});
});

test('only the current projected node revision can explain a RECHECK', async () => {
  let calls = 0;
  let currentEvents;
  const decision = {async decide(request) {
    calls++; currentEvents = request.events; return request.events.map(validSuggestion);
  }};
  const stale = input();
  stale.impact.items[0].causes[0].currentRevision = 3;
  assert.deepEqual(await decideProjectedFactImpact(decision, stale), []);
  assert.equal(calls, 0);
  const current = input();
  await decideProjectedFactImpact(decision, current);
  assert.equal(currentEvents[0].facts[0].revision, 2);
  assert.equal(calls, 1);
});

test('the trusted projection namespace must match the impact report', async () => {
  let calls = 0;
  const otherGraph = input();
  otherGraph.impact.namespace = 'another-graph';
  await assert.rejects(() => decideProjectedFactImpact({decide() { calls++; }}, otherGraph),
    {code: 'INVALID_ARGUMENT'});
  assert.equal(calls, 0);
});

test('empty or unrelated events still honor cancellation and deadline without model use', async () => {
  let calls = 0;
  const decision = {decide() { calls++; throw Error('unexpected model call'); }};
  const cancelled = input();
  cancelled.projection.links = [];
  const controller = new AbortController();
  controller.abort();
  cancelled.signal = controller.signal;
  await assert.rejects(() => decideProjectedFactImpact(decision, cancelled), {code: 'CANCELLED'});
  const expired = input();
  expired.impact.items[0].action = 'KEEP';
  expired.deadline = new Date(Date.now() - 1_000).toISOString();
  await assert.rejects(() => decideProjectedFactImpact(decision, expired), {code: 'TIMEOUT'});
  assert.equal(calls, 0);
});

test('a DecisionPort cannot replace the projected Fact identity or smuggle extra action data', async () => {
  const valid = event => ({eventId: event.eventId, source: event.source,
    intervention: 'REMIND', confidence: 0.9, reason: 'model', facts: event.facts,
    authorizationRevision: 0});
  const forged = [
    event => ({...valid(event), source: 'other-source'}),
    event => ({...valid(event), facts: [{id: event.facts[0].id, revision: 99}]}),
    event => ({...valid(event), authorizationRevision: 1}),
    event => ({...valid(event), toolArguments: {path: 'unexpected'}}),
    event => ({...valid(event), confidence: Infinity}),
  ];
  for (const make of forged) {
    await assert.rejects(() => decideProjectedFactImpact({
      async decide({events}) { return [make(events[0])]; },
    }, input()), /Invalid projected fact decision result/);
  }
  await assert.rejects(() => decideProjectedFactImpact({
    async decide({events}) { return [valid(events[0]), valid(events[0])]; },
  }, input()), /Invalid projected fact decision result/);
});

test('each affected event needs exactly one bound suggestion while port order is preserved', async () => {
  const pair = () => {
    const request = input();
    request.projection.links.push({eventId: 'synthetic-change-3',
      fact: {id: 'calendar/time', revision: 2}, node: {id: 'memory-fact:time', revision: 2}});
    request.impact.items[0].causes.push({reference: {id: 'memory-fact:time', revision: 1},
      currentRevision: 2, reason: 'superseded'});
    return request;
  };
  for (const make of [
    () => [],
    events => [validSuggestion(events[0])],
    events => [validSuggestion(events[0]), validSuggestion(events[0])],
  ]) {
    await assert.rejects(() => decideProjectedFactImpact({
      async decide({events}) { return make(events); },
    }, pair()), /Invalid projected fact decision result/);
  }
  const result = await decideProjectedFactImpact({
    async decide({events}) { return events.map(validSuggestion).reverse(); },
  }, pair());
  assert.deepEqual(result.map(item => item.eventId), ['synthetic-change-3', 'synthetic-change-2']);
  const empty = input();
  empty.projection.links = [];
  assert.deepEqual(await decideProjectedFactImpact({decide() { throw Error('unexpected advice'); }}, empty), []);
});

test('an ignored cancellation still prevents a late decision result from being returned', async () => {
  const controller = new AbortController();
  const request = input();
  request.signal = controller.signal;
  await assert.rejects(() => decideProjectedFactImpact({async decide() {
    controller.abort();
    return [];
  }}, request), {code: 'CANCELLED'});
});

test('uncooperative DecisionPorts still settle on cancellation and deadline', async () => {
  for (const code of ['CANCELLED', 'TIMEOUT']) {
    const controller = new AbortController();
    const request = input();
    request.signal = controller.signal;
    if (code === 'TIMEOUT') request.deadline = new Date(Date.now() + 30).toISOString();
    let portSignal;
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    const pending = decideProjectedFactImpact({decide({signal}) {
      portSignal = signal;
      started();
      return new Promise(() => {});
    }}, request);
    await entered;
    if (code === 'CANCELLED') controller.abort();
    let guard;
    try {
      const result = await Promise.race([
        pending.then(() => 'unexpected success', error => error.code),
        new Promise(resolve => { guard = setTimeout(() => resolve('unsettled'), 300); }),
      ]);
      assert.equal(result, code, 'the adapter must finish even if its injected port ignores abort');
      assert.equal(portSignal.aborted, true, 'the deadline must also reach the injected port');
    } finally { clearTimeout(guard); }
  }
});

test('port mutation cannot rewrite the private Fact, source or authorization binding', async () => {
  const mutate = [
    event => { event.source = 'forged-source'; },
    event => { event.facts[0].revision = 99; },
    event => { event.authorization.revision = 1; },
  ];
  for (const change of mutate) {
    const request = input();
    await assert.rejects(() => decideProjectedFactImpact({async decide({events}) {
      change(events[0]);
      const event = events[0];
      return [{eventId: event.eventId, source: event.source,
        intervention: 'REMIND', confidence: 0.9, reason: 'model', facts: event.facts,
        authorizationRevision: event.authorization.revision}];
    }}, request), /Invalid projected fact decision result/);
    assert.deepEqual(request.projection.links[0].fact,
      {id: 'calendar/location', revision: 2}, 'the original projection is never exposed');
  }
});
