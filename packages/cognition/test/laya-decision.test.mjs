import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {ProactiveDecisionService} from '../dist/proactive-decision.js';
import {LayaDecisionModel, LocalLayaHttpTransport} from '../dist/laya-decision.js';
import {LocalLayaBatchHttpTransport} from '../dist/laya-batch-transport.js';

const event = (overrides = {}) => ({
  eventId: 'change-1', source: 'synthetic-calendar',
  observation: '比赛会议改到周五，原计划需要复查。',
  goal: {ref: {id: 'goal-1', revision: 2}, summary: '准备比赛演示'},
  facts: [{id: 'fact-1', revision: 3}], plan: {id: 'plan-1', revision: 4},
  authorization: {state: 'none', revision: 0}, ...overrides,
});
const request = events => ({events, deadline: new Date(Date.now() + 5_000).toISOString(),
  signal: new AbortController().signal});

test('reordered exact Unicode Fact refs merge one version without normalizing IDs or output order', async () => {
  const facts = [{id: '\u00e5', revision: 1}, {id: 'a\u030a', revision: 2}];
  const events = [event({facts}), event({facts: [...facts].reverse()})];
  const before = structuredClone(events);
  const calls = [];
  const service = new ProactiveDecisionService({async choose(unique) {
    calls.push(structuredClone(unique));
    return unique.map(() => ({intervention: 'REMIND', confidence: 0.9}));
  }});
  const result = await service.decide(request(events));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [before[0]]);
  assert.deepEqual(result.map(item => [item.intervention, item.reason]),
    [['REMIND', 'model'], ['MERGE', 'rule_duplicate']]);
  assert.deepEqual(result.map(item => item.facts), before.map(item => item.facts));
  assert.deepEqual(events, before);
});

test('exact Unicode version merging still rejects changed bindings and duplicate Fact IDs before the model', async t => {
  const facts = [{id: '\u00e5', revision: 1}, {id: 'a\u030a', revision: 2}];
  const changes = {
    revision: {facts: [{...facts[0], revision: 3}, facts[1]]},
    observation: {observation: 'Different synthetic observation'},
    authorization: {authorization: {state: 'granted', revision: 1}},
    goal: {goal: {ref: {id: 'goal-1', revision: 3}, summary: '准备比赛演示'}},
    plan: {plan: {id: 'plan-1', revision: 5}},
    duplicate: {facts: [facts[0], {...facts[0], revision: 2}]},
  };
  for (const [name, changed] of Object.entries(changes)) await t.test(name, async () => {
    let calls = 0;
    const service = new ProactiveDecisionService({async choose() {calls++; return [];}});
    const events = [event({facts}), event({facts, ...changed})];
    await assert.rejects(() => service.decide(request(events)), {code: 'INVALID_ARGUMENT'});
    assert.equal(calls, 0);
  });
});

test('same version is merged before one model call; changed authorization cannot share its decision', async () => {
  const calls = [];
  const service = new ProactiveDecisionService({async choose(events) {
    calls.push(events);
    return events.map(() => ({intervention: 'REMIND', confidence: 0.9}));
  }});
  const duplicate = event();
  const result = await service.decide(request([event(), duplicate]));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1);
  assert.deepEqual(result.map(item => [item.intervention, item.reason]),
    [['REMIND', 'model'], ['MERGE', 'rule_duplicate']]);
  await assert.rejects(() => service.decide(request([event(), event({authorization: {state: 'revoked', revision: 1}})])),
    {code: 'INVALID_ARGUMENT'});
});

test('suggestions retain source when distinct sources reuse one event ID', async () => {
  const service = new ProactiveDecisionService({async choose() {
    return [{intervention: 'REMIND', confidence: 0.9},
      {intervention: 'REQUEST_DECISION', confidence: 0.9}];
  }});
  const results = await service.decide(request([event({source: 'calendar'}), event({source: 'mail'})]));
  assert.deepEqual(results.map(item => [item.source, item.eventId, item.intervention]), [
    ['calendar', 'change-1', 'REMIND'], ['mail', 'change-1', 'REQUEST_DECISION'],
  ]);
});

test('model input mutation cannot rewrite the validated suggestion references', async () => {
  const original = event();
  const before = structuredClone(original);
  const service = new ProactiveDecisionService({async choose(events) {
    events[0].eventId = 'invented-event';
    events[0].source = 'invented-source';
    events[0].facts[0].id = 'invented-fact';
    events[0].facts[0].revision = 99;
    events[0].plan.revision = 99;
    events[0].authorization.revision = 99;
    events[0].goal.ref.revision = 99;
    return [{intervention: 'REMIND', confidence: 0.9}];
  }});
  const [result] = await service.decide(request([original]));
  assert.deepEqual(result, {eventId: before.eventId, source: before.source,
    intervention: 'REMIND', confidence: 0.9, reason: 'model',
    facts: before.facts, plan: before.plan, authorizationRevision: before.authorization.revision});
  assert.deepEqual(original, before, 'the caller retains its original event');
});

test('uncalibrated suppression and action labels never become executable results', async () => {
  for (const intervention of ['IGNORE', 'MERGE', 'DEFER', 'EXECUTE']) {
    const service = new ProactiveDecisionService({async choose() { return [{intervention, confidence: 0.99}]; }});
    const [result] = await service.decide(request([event()]));
    assert.equal(result.intervention, 'ESCALATE_AGENTARTS');
    assert.equal(result.reason, 'uncalibrated_model');
    assert.equal(result.authorizationRevision, 0);
    assert.deepEqual(result.facts, [{id: 'fact-1', revision: 3}]);
  }
});

test('low confidence and malformed model response escalate without leaking model text', async () => {
  const low = new ProactiveDecisionService({async choose() { return [{intervention: 'REMIND', confidence: 0.2}]; }});
  const [lowResult] = await low.decide(request([event()]));
  assert.deepEqual([lowResult.intervention, lowResult.reason], ['ESCALATE_AGENTARTS', 'low_confidence']);
  const malformed = new ProactiveDecisionService({async choose() { throw new Error('private provider message'); }});
  const [failed] = await malformed.decide(request([event()]));
  assert.deepEqual([failed.intervention, failed.reason, failed.confidence],
    ['ESCALATE_AGENTARTS', 'model_unavailable', null]);
  assert.doesNotMatch(JSON.stringify(failed), /private provider message/);
});

test('a sparse model choice batch escalates every unique event without throwing', async () => {
  const service = new ProactiveDecisionService({async choose() {
    const choices = new Array(2);
    choices[0] = {intervention: 'REMIND', confidence: 0.9};
    return choices;
  }});
  const results = await service.decide(request([event(), event({eventId: 'change-2'})]));
  assert.deepEqual(results.map(item => [item.intervention, item.reason, item.confidence]), [
    ['ESCALATE_AGENTARTS', 'model_unavailable', null],
    ['ESCALATE_AGENTARTS', 'model_unavailable', null],
  ]);
});

test('deadline bounds even an uncooperative model, and caller cancellation stays distinct', async () => {
  const service = new ProactiveDecisionService({async choose() { return new Promise(() => {}); }});
  const timed = {...request([event()]), deadline: new Date(Date.now() + 30).toISOString()};
  await assert.rejects(() => service.decide(timed), {code: 'TIMEOUT'});
  const controller = new AbortController();
  const cancelled = {...request([event()]), signal: controller.signal};
  const pending = service.decide(cancelled);
  controller.abort();
  await assert.rejects(pending, {code: 'CANCELLED'});
  // Separate processes have no test-worker handles to hide an unreferenced deadline.
  for (const mode of ['deadline', 'cancelled', 'completed']) {
    const code = `
      import {ProactiveDecisionService} from ${JSON.stringify(new URL('../dist/proactive-decision.js', import.meta.url).href)};
      const mode=${JSON.stringify(mode)}, controller=new AbortController();
      const service=new ProactiveDecisionService({async choose() {
        return mode==='completed' ? [{intervention:'REMIND',confidence:0.9}] : new Promise(()=>{});
      }});
      const request={events:[${JSON.stringify(event())}],signal:controller.signal,
        deadline:new Date(Date.now()+(mode==='deadline'?30:10000)).toISOString()};
      const pending=service.decide(request);
      if(mode==='cancelled')controller.abort();
      try {await pending;console.log('completed');}
      catch(error) {if(!['TIMEOUT','CANCELLED'].includes(error.code))throw error;console.log(error.code);}
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', code],
      {encoding: 'utf8', timeout: 5000});
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    assert.equal(child.stdout.trim(), mode==='deadline' ? 'TIMEOUT' : mode==='cancelled' ? 'CANCELLED' : 'completed');
  }
});

test('Laya adapter sends a bounded multilingual choice batch and rejects unknown labels', async () => {
  let captured;
  const model = new LayaDecisionModel({async infer(payload) {
    captured = payload;
    return {answers: {event_0: {choice: 'REMIND', confidence: 0.91}}};
  }});
  const result = await model.choose([event()], new AbortController().signal);
  assert.deepEqual(result, [{intervention: 'REMIND', confidence: 0.91}]);
  assert.equal(captured.model, 'multilingual');
  assert.deepEqual(Object.keys(captured.questions), ['event_0']);
  assert.equal(captured.questions.event_0.type, 'choice');
  assert.equal(captured.state.events[0].observation, event().observation);
  assert.deepEqual(captured.state.events[0].facts, ['fact-1@3']);
  assert.deepEqual(captured.state.events[0].goal, {ref: 'goal-1@2', summary: '准备比赛演示'});
  assert.equal('authorization' in captured.state.events[0], false);
  const bad = new LayaDecisionModel({async infer() {
    return {answers: {event_0: {choice: 'ALLOW_ALL', confidence: 1}}};
  }});
  await assert.rejects(() => bad.choose([event()], new AbortController().signal), /Invalid Laya response/);
});

test('HTTP transport stays on authenticated loopback and does not return provider errors', async () => {
  let url;
  let authorization;
  const transport = new LocalLayaHttpTransport(8765, () => 'local-test-token',
    async (target, options) => {
      url = target;
      authorization = options.headers.authorization;
      return new Response(JSON.stringify({answers: {event_0: {choice: 'REMIND', confidence: 0.9}}}),
        {status: 200, headers: {'content-type': 'application/json'}});
    });
  const model = new LayaDecisionModel(transport);
  assert.deepEqual(await model.choose([event()], new AbortController().signal),
    [{intervention: 'REMIND', confidence: 0.9}]);
  assert.equal(url, 'http://127.0.0.1:8765/v1/systemone');
  assert.equal(authorization, 'Bearer local-test-token');
  const failed = new LocalLayaHttpTransport(8765, () => 'local-test-token',
    async () => new Response('secret remote error', {status: 500}));
  await assert.rejects(() => failed.infer({model: 'multilingual', state: {events: []}, questions: {}},
    new AbortController().signal), /^Error: Local Laya unavailable$/);
});

test('real fetch rejects a redirect before POST data reaches another local server', async () => {
  let redirectedHits = 0;
  const redirected = createServer((incoming, response) => {
    redirectedHits++;
    incoming.resume();
    response.writeHead(200, {'content-type': 'application/json'});
    response.end('{}');
  });
  const source = createServer((incoming, response) => {
    incoming.resume();
    response.writeHead(307, {location: `http://127.0.0.1:${redirected.address().port}/receive`});
    response.end();
  });
  try {
    redirected.listen(0, '127.0.0.1');
    await once(redirected, 'listening');
    source.listen(0, '127.0.0.1');
    await once(source, 'listening');
    const port = source.address().port;
    const transport = new LocalLayaHttpTransport(port, () => 'local-test-token');
    await assert.rejects(() => transport.infer({model: 'multilingual',
      state: {events: [{index: 0, observation: 'synthetic-only', facts: []}]}, questions: {}},
    new AbortController().signal));
    assert.equal(redirectedHits, 0);
  } finally {
    source.closeAllConnections();
    redirected.closeAllConnections();
    await Promise.all([new Promise(resolve => source.close(resolve)),
      new Promise(resolve => redirected.close(resolve))]);
  }
});

test('oversized single and batch responses stop their producers without awaiting or replacing cancellation errors', async t => {
  for (const Transport of [LocalLayaHttpTransport, LocalLayaBatchHttpTransport]) {
    for (const mode of ['pending', 'throw', 'reject']) await t.test(`${Transport.name} ${mode}`, async () => {
      let cancellations = 0;
      const response = new Response(new ReadableStream({start(controller) {
        controller.enqueue(new Uint8Array(32768)); controller.enqueue(new Uint8Array(32769));
      }, cancel() {
        cancellations++;
        if (mode === 'throw') throw Error('Synthetic cancellation failure');
        return mode === 'reject' ? Promise.reject(Error('Synthetic cancellation failure')) : new Promise(() => {});
      }}));
      const transport = new Transport(8765, () => 'local-test-token', async () => response);
      const operation = Transport === LocalLayaBatchHttpTransport ? 'inferBatch' : 'infer';
      await assert.rejects(transport[operation]({model: 'multilingual', state: {events: []}, questions: {}},
        new AbortController().signal), /^Error: Oversized Laya response$/);
      assert.equal(cancellations, 1, 'the rejected oversized response must stop its producer');
      assert.equal(response.body.locked, false);
    });
  }
});

test('single and batch responses still accept exactly 65536 bytes without cancellation', async () => {
  for (const Transport of [LocalLayaHttpTransport, LocalLayaBatchHttpTransport]) {
    let cancellations = 0;
    const response = new Response(new ReadableStream({start(controller) {
      controller.enqueue(new TextEncoder().encode(' '.repeat(65534) + '{}')); controller.close();
    }, cancel() {cancellations++;}}));
    const transport = new Transport(8765, () => 'local-test-token', async () => response);
    const operation = Transport === LocalLayaBatchHttpTransport ? 'inferBatch' : 'infer';
    assert.deepEqual(await transport[operation]({model: 'multilingual', state: {events: []}, questions: {}},
      new AbortController().signal), {});
    assert.equal(cancellations, 0); assert.equal(response.body.locked, false);
  }
});

test('a reader failure retains its original error when cancellation throws synchronously', async () => {
  const original = Error('Synthetic read failure'); let cancellations = 0, releases = 0;
  const transport = new LocalLayaHttpTransport(8765, () => 'local-test-token', async () => ({ok: true,
    body: {getReader: () => ({read: async () => {throw original;},
      cancel: () => {cancellations++; throw Error('Synthetic cancellation failure');},
      releaseLock: () => {releases++;}})}}));
  await assert.rejects(transport.infer({model: 'multilingual', state: {events: []}, questions: {}},
    new AbortController().signal), error => error === original);
  assert.equal(cancellations, 1); assert.equal(releases, 1);
});
