import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ProactiveDecisionService} from '../dist/proactive-decision.js';

const event = (overrides = {}) => ({
  eventId: 'change-1', source: 'synthetic-calendar',
  observation: '比赛会议改到周五，原计划需要复查。',
  goal: {ref: {id: 'goal-1', revision: 2}, summary: '准备比赛演示'},
  facts: [{id: 'fact-1', revision: 3}], plan: {id: 'plan-1', revision: 4},
  authorization: {state: 'none', revision: 0}, ...overrides,
});
const request = (events, overrides = {}) => ({events, deadline: new Date(Date.now() + 5_000).toISOString(),
  signal: new AbortController().signal, ...overrides});
const silentModel = calls => ({async choose() { calls++; return []; }});

test('constructor bounds the advisory threshold and a custom threshold stays exact', async () => {
  for (const minimum of [0, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new ProactiveDecisionService({async choose() { return []; }}, minimum),
      {code: 'INVALID_ARGUMENT'});
  }
  const strict = new ProactiveDecisionService({async choose() { return [{intervention: 'REMIND', confidence: 0.9}]; }}, 1);
  const [strictResult] = await strict.decide(request([event()]));
  assert.deepEqual([strictResult.intervention, strictResult.reason], ['ESCALATE_AGENTARTS', 'low_confidence']);
  const exact = new ProactiveDecisionService({async choose() { return [{intervention: 'REMIND', confidence: 1}]; }}, 1);
  const [exactResult] = await exact.decide(request([event()]));
  assert.deepEqual([exactResult.intervention, exactResult.reason], ['REMIND', 'model']);
});

test('malformed requests are rejected before the model is called', async t => {
  const requests = {
    'not an object': () => 'request',
    'empty events': () => request([]),
    'more than four events': () => request([event(), event(), event(), event(),
      event({eventId: 'change-5'})]),
    'events not an array': () => request(event()),
    'extra request field': () => ({...request([event()]), caller: 'forged'}),
    'signal is not an AbortSignal': () => request([event()], {signal: 'not-a-signal'}),
    'deadline without milliseconds': () => request([event()],
      {deadline: '2026-11-04T09:00:00Z'}),
    'unparseable deadline': () => request([event()], {deadline: 'not-a-date'}),
    'deadline that does not round-trip': () => request([event()],
      {deadline: '2026-02-30T00:00:00.000Z'}),
  };
  for (const [name, make] of Object.entries(requests)) await t.test(name, async () => {
    const calls = [];
    const service = new ProactiveDecisionService(silentModel(calls));
    await assert.rejects(() => service.decide(make()), {code: 'INVALID_ARGUMENT'});
    assert.equal(calls.length, 0);
  });
});

test('event identity fields must be trimmed printable identifiers of bounded length', async t => {
  const identities = {
    'empty eventId': {eventId: ''},
    'padded source': {source: ' synthetic-calendar '},
    'control character in event ID': {eventId: 'change-\u00011'},
    'oversized event ID': {eventId: 'a'.repeat(129)},
    'deleted event ID': {eventId: 'change-1\u007f'},
  };
  for (const [name, override] of Object.entries(identities)) await t.test(name, async () => {
    const calls = [];
    const service = new ProactiveDecisionService(silentModel(calls));
    await assert.rejects(() => service.decide(request([event(override)])), {code: 'INVALID_ARGUMENT'});
    assert.equal(calls.length, 0);
  });
});

test('event payloads are validated before the model observes them', async t => {
  const payload = {
    'blank observation': {observation: '   '},
    'oversized observation': {observation: 'x'.repeat(201)},
    'too many facts': {facts: Array.from({length: 9}, (_, index) => ({id: `fact-${index}`, revision: 1}))},
    'duplicate fact IDs': {facts: [{id: 'fact-1', revision: 1}, {id: 'fact-1', revision: 2}]},
    'invalid fact revision': {facts: [{id: 'fact-1', revision: 0}]},
    'blank goal summary': {goal: {ref: {id: 'goal-1', revision: 2}, summary: '  '}},
    'oversized goal summary': {goal: {ref: {id: 'goal-1', revision: 2}, summary: 'x'.repeat(101)}},
    'unknown authorization state': {authorization: {state: 'assumed', revision: 0}},
    'negative authorization revision': {authorization: {state: 'granted', revision: -1}},
    'fractional authorization revision': {authorization: {state: 'granted', revision: 0.5}},
    'extra event field': {hiddenAuthorization: 'forged'},
    'array event': 'not-an-event',
  };
  for (const [name, override] of Object.entries(payload)) await t.test(name, async () => {
    const calls = [];
    const service = new ProactiveDecisionService(silentModel(calls));
    const events = override === 'not-an-event' ? [override] : [event(override)];
    await assert.rejects(() => service.decide(request(events)), {code: 'INVALID_ARGUMENT'});
    assert.equal(calls.length, 0);
  });
});

test('a lifecycle that already ended is reported before the model runs', async () => {
  const calls = [];
  const service = new ProactiveDecisionService(silentModel(calls));
  await assert.rejects(() => service.decide(request([event()], {signal: AbortSignal.abort()})),
    {code: 'CANCELLED'});
  await assert.rejects(() => service.decide(request([event()],
    {deadline: new Date(Date.now() - 1000).toISOString()})), {code: 'TIMEOUT'});
  assert.equal(calls.length, 0);
});

test('a minimal event keeps empty facts, no plan and its authorization revision', async () => {
  const minimal = {eventId: 'change-1', source: 'synthetic-calendar', observation: '会议改期，需要复查。',
    facts: [], authorization: {state: 'none', revision: 7}};
  const service = new ProactiveDecisionService({async choose(events) {
    assert.equal(events.length, 1);
    return [{intervention: 'REQUEST_DECISION', confidence: 1}];
  }}, 1);
  const [result] = await service.decide(request([minimal]));
  assert.deepEqual(result, {eventId: 'change-1', source: 'synthetic-calendar',
    intervention: 'REQUEST_DECISION', confidence: 1, reason: 'model', facts: [],
    authorizationRevision: 7});
  assert.equal('plan' in result, false);
  assert.equal('goal' in result, false);
});
