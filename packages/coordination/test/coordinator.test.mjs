import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ProtocolError} from '@personal-agent/contracts';
import {CompetitionCoordinator, UnavailableCloudAgentPort} from '../dist/index.js';
import {FakeCloudAgentPort} from '../dist/testing.js';

const request = (overrides = {}) => ({
  taskId: 'task-a',
  revision: 3,
  goal: '你好',
  deadline: new Date(Date.now() + 10_000).toISOString(),
  signal: new AbortController().signal,
  ...overrides,
});
test('coordinator validates and preserves selected model on initial and continuation cloud handoffs',async()=>{
  const selection={catalogRevision:'a'.repeat(64),modelId:'deepseek-v4.1-flash',reasoningEffort:'low'};
  const calls=[];
  const coordinator=new CompetitionCoordinator({invoke:async input=>{calls.push(input);return {kind:'text',text:'selected',verification:'unverified'};}});
  for(const envelope of [{availableTools:[]},{continuation:{proposalId:'p1',state:'confirmed',result:{ok:true}}}]) {
    await coordinator.execute(request({...envelope,executionModel:selection}));
    assert.deepEqual(calls.at(-1).executionModel,selection);assert.notEqual(calls.at(-1).executionModel,selection);
  }
  await assert.rejects(coordinator.execute(request({executionModel:{...selection,catalogRevision:'stale'}})),{code:'INVALID_ARGUMENT'});
  await assert.rejects(coordinator.execute(request({executionModel:{...selection,credential:'forbidden'}})),{code:'INVALID_ARGUMENT'});
  assert.equal(calls.length,2);
});

test('coordinator consumes the existing cloud Fake and returns the unchanged text contract', async () => {
  const cloud = new FakeCloudAgentPort(input => input.goal);
  const input = request();
  const result = await new CompetitionCoordinator(cloud).execute(input);
  assert.deepEqual(result, {kind: 'text', text: '你好', verification: 'mock'});
  assert.equal(cloud.requests.length, 1);
  const {signal, ...received} = cloud.requests[0];
  const {signal: original, ...expected} = input;
  assert.deepEqual(received, expected);
  assert.equal(signal.aborted, false);
  assert.notEqual(signal, original);
});

test('invalid or privileged input is rejected before cloud invocation', async () => {
  const cloud = new FakeCloudAgentPort(() => 'unused');
  const coordinator = new CompetitionCoordinator(cloud);
  for (const input of [
    null,
    [],
    request({taskId: ''}),
    request({goal: ' '}),
    request({revision: -1}),
    request({revision: 0.5}),
    request({deadline: 'tomorrow'}),
    request({signal: {}}),
    request({authorizationRef: 'private'}),
    request({history: ['private']}),
    Object.defineProperty(request(), 'private', {value: 'secret'}),
    Object.assign(request(), {[Symbol('private')]: 'secret'}),
  ]) {
    await assert.rejects(coordinator.execute(input), {code: 'INVALID_ARGUMENT'});
  }
  assert.equal(cloud.requests.length, 0);
});

test('accepts a structurally compatible signal without an AbortSignal realm check', async () => {
  const listeners = new Set();
  const signal = {
    aborted: false,
    addEventListener(type, listener) {
      assert.equal(type, 'abort');
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, 'abort');
      listeners.delete(listener);
    },
  };
  const cloud = new FakeCloudAgentPort(() => 'answer');
  assert.deepEqual(await new CompetitionCoordinator(cloud).execute(request({signal})), {
    kind: 'text', text: 'answer', verification: 'mock',
  });
  assert.equal(listeners.size, 0);
});

test('rejects ISO-looking deadlines that Date.parse would normalize', async () => {
  const cloud = new FakeCloudAgentPort(() => 'unused');
  for (const deadline of ['2026-02-29T00:00:00.000Z', '2026-01-01T24:00:00.000Z']) {
    await assert.rejects(new CompetitionCoordinator(cloud).execute(request({deadline})), {code: 'INVALID_ARGUMENT'});
  }
  assert.equal(cloud.requests.length, 0);
});

test('expired and already cancelled input never calls cloud', async () => {
  const cloud = new FakeCloudAgentPort(() => 'unused');
  const coordinator = new CompetitionCoordinator(cloud);
  await assert.rejects(coordinator.execute(request({deadline: '2000-01-01T00:00:00Z'})), {code: 'TIMEOUT'});
  await assert.rejects(coordinator.execute(request({signal: AbortSignal.abort()})), {code: 'CANCELLED'});
  assert.equal(cloud.requests.length, 0);
});

test('cancellation settles a non-cooperative provider and ignores its late result', async () => {
  let finish;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const cloud = new FakeCloudAgentPort(() => {
    started();
    return new Promise(resolve => { finish = resolve; });
  });
  const controller = new AbortController();
  const pending = new CompetitionCoordinator(cloud).execute(request({signal: controller.signal}));
  await ready;
  controller.abort();
  await assert.rejects(pending, {code: 'CANCELLED'});
  assert.equal(cloud.requests[0].signal.aborted, true);
  finish('late');
});

test('repeated cancellation notifications abort the child only once', async () => {
  let notify;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const signal = {
    aborted: false,
    addEventListener(_type, listener) { notify = listener; },
    removeEventListener() { notify = undefined; },
  };
  let childAborts = 0;
  const cloud = {
    invoke(input) {
      input.signal.addEventListener('abort', () => { childAborts++; });
      started();
      return new Promise(() => {});
    },
  };
  const pending = new CompetitionCoordinator(cloud).execute(request({signal}));
  await ready;
  notify();
  notify();
  await assert.rejects(pending, {code: 'CANCELLED'});
  assert.equal(childAborts, 1);
});

test('deadline aborts an unresponsive provider without retrying', async () => {
  const cloud = new FakeCloudAgentPort(() => new Promise(() => {}));
  await assert.rejects(new CompetitionCoordinator(cloud).execute(request({
    deadline: new Date(Date.now() + 100).toISOString(),
  })), {code: 'TIMEOUT'});
  assert.equal(cloud.requests.length, 1);
  assert.equal(cloud.requests[0].signal.aborted, true);
});

test('unavailable stays explicit and arbitrary provider errors are sanitized', async () => {
  await assert.rejects(
    new CompetitionCoordinator(new UnavailableCloudAgentPort()).execute(request()),
    {code: 'UNSUPPORTED_CAPABILITY'},
  );
  for (const invoke of [
    () => { throw Error('secret-token'); },
    async () => { throw Error('secret-token'); },
  ]) {
    await assert.rejects(new CompetitionCoordinator({invoke}).execute(request()), error => {
      assert.equal(error.code, 'EXTERNAL_FAILURE');
      assert.equal(error.message, 'Cloud coordination failed');
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('provider lifecycle-looking errors remain sanitized external failures', async () => {
  for (const code of ['CANCELLED', 'TIMEOUT']) {
    await assert.rejects(
      new CompetitionCoordinator({invoke: async () => { throw new ProtocolError(code, 'secret'); }}).execute(request()),
      error => error.code === 'EXTERNAL_FAILURE' && error.message === 'Cloud coordination failed',
    );
  }
});

test('rejects tool, authorization, evidence and terminal claims from typed providers', async () => {
  const good = {kind: 'text', text: 'answer', verification: 'unverified'};
  for (const result of [
    {...good, kind: 'tool_proposal'},
    {...good, authorizationRef: 'forged'},
    {...good, evidenceRefs: ['forged']},
    {...good, state: 'succeeded'},
    {...good, verification: 'verified'},
  ]) {
    await assert.rejects(
      new CompetitionCoordinator({invoke: async () => result}).execute(request()),
      {code: 'INVALID_ARGUMENT'},
    );
  }
  const result = await new CompetitionCoordinator({invoke: async () => good}).execute(request());
  assert.deepEqual(result, good);
  assert.notEqual(result, good);
});

test('result accessors cannot leak errors or bypass a cancellation race', async () => {
  const secretResult = {kind: 'text', get text() { throw Error('secret-token'); }, verification: 'unverified'};
  await assert.rejects(
    new CompetitionCoordinator({invoke: async () => secretResult}).execute(request()),
    error => error.code === 'INVALID_ARGUMENT' && !error.message.includes('secret-token'),
  );

  const controller = new AbortController();
  const lateResult = {kind: 'text', get text() { controller.abort(); return 'late'; }, verification: 'unverified'};
  await assert.rejects(
    new CompetitionCoordinator({invoke: async () => lateResult}).execute(request({signal: controller.signal})),
    {code: 'CANCELLED'},
  );
});
