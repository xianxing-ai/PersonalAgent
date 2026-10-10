import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ProtocolError} from '@personal-agent/contracts';
import {AgentArtsCloudAgentPort} from '../dist/index.js';

const gatewayUrl = 'https://agentarts.example.test';
const runtimeName = 'workflow-input-fixture';

const request = (overrides = {}) => ({
  taskId: 'local/task/private-id',
  revision: 7,
  goal: '检查项目状态',
  deadline: new Date(Date.now() + 10_000).toISOString(),
  signal: new AbortController().signal,
  ...overrides,
});

const response = text => new Response(JSON.stringify({event: 'message', data: {text}}), {
  status: 200,
  headers: {'content-type': 'application/json'},
});

const authorization = calls => ({
  read: async signal => {
    calls.count += 1;
    assert.equal(signal.aborted, false);
    return 'Bearer synthetic-test-token';
  },
});

test('text-only adapters reject tool continuations before authorization or transport', async () => {
  const calls = {count: 0};
  let transports = 0;
  const cloud = new AgentArtsCloudAgentPort({gatewayUrl, runtimeName, workflowGoalInput: 'goal'},
    authorization(calls), async () => { transports++; return response('unexpected'); });
  await assert.rejects(cloud.invoke(request({continuation: {
    proposalId: 'synthetic-proposal', state: 'confirmed', result: {value: 'synthetic'},
  }})), {code: 'INVALID_ARGUMENT', message: 'AgentArts text adapter does not support tool continuation'});
  assert.equal(calls.count, 0);
  assert.equal(transports, 0);
});

test('omitting workflowGoalInput preserves the exact query request body', async () => {
  const authCalls = {count: 0};
  let seen;
  const cloud = new AgentArtsCloudAgentPort({gatewayUrl, runtimeName}, authorization(authCalls),
    async (_url, init) => {
      seen = init;
      return response('default accepted');
    });
  const input = request();

  assert.deepEqual(await cloud.invoke(input), {
    kind: 'text', text: 'default accepted', verification: 'unverified',
  });
  assert.equal(authCalls.count, 1);
  assert.equal(seen.body, JSON.stringify({query: input.goal}));
  assert.deepEqual(Object.keys(JSON.parse(seen.body)), ['query']);
});

test('explicit workflow input sends only the named goal and keeps standard text unverified', async () => {
  const authCalls = {count: 0};
  let body;
  const cloud = new AgentArtsCloudAgentPort({gatewayUrl, runtimeName, workflowGoalInput: 'user_goal'},
    authorization(authCalls), async (_url, init) => {
      body = init.body;
      return response('workflow accepted');
    });
  const input = request();

  assert.deepEqual(await cloud.invoke(input), {
    kind: 'text', text: 'workflow accepted', verification: 'unverified',
  });
  assert.equal(body, JSON.stringify({inputs: {user_goal: input.goal}}));
  assert.deepEqual(JSON.parse(body), {inputs: {user_goal: input.goal}});
  assert.equal(body.includes(input.taskId), false);
  assert.equal(body.includes(input.deadline), false);
  assert.equal(body.includes(String(input.revision)), false);
  assert.equal(authCalls.count, 1);
});

test('the constructed port keeps a copied workflow input after its source config changes', async () => {
  const config = {gatewayUrl, runtimeName, workflowGoalInput: 'original_goal'};
  let body;
  const cloud = new AgentArtsCloudAgentPort(config, authorization({count: 0}), async (_url, init) => {
    body = init.body;
    return response('copied');
  });
  config.workflowGoalInput = 'mutated_goal';

  const input = request();
  await cloud.invoke(input);
  assert.equal(body, JSON.stringify({inputs: {original_goal: input.goal}}));
  assert.equal(body.includes('mutated_goal'), false);
});

test('constructor rejects invalid workflow names before I/O while __proto__ remains a safe own key', async () => {
  let authCalls = 0;
  let fetchCalls = 0;
  const auth = {read: async () => { authCalls += 1; return 'Bearer synthetic-test-token'; }};
  const fetchImpl = async () => {
    fetchCalls += 1;
    return response('unexpected');
  };
  for (const workflowGoalInput of [
    '',
    '   ',
    'x'.repeat(129),
    null,
    7,
    ['goal'],
    {name: 'goal'},
    'inputs.goal',
    'goal/path',
    'goal\nother',
  ]) {
    assert.throws(
      () => new AgentArtsCloudAgentPort({gatewayUrl, runtimeName, workflowGoalInput}, auth, fetchImpl),
      error => error instanceof ProtocolError && error.code === 'INVALID_ARGUMENT',
    );
  }
  assert.equal(authCalls, 0);
  assert.equal(fetchCalls, 0);

  let body;
  const cloud = new AgentArtsCloudAgentPort({gatewayUrl, runtimeName, workflowGoalInput: '__proto__'},
    auth, async (_url, init) => {
      fetchCalls += 1;
      body = init.body;
      return response('safe');
    });
  const input = request();
  await cloud.invoke(input);
  const parsed = JSON.parse(body);
  assert.deepEqual(Object.keys(parsed), ['inputs']);
  assert.deepEqual(Object.keys(parsed.inputs), ['__proto__']);
  assert.equal(Object.hasOwn(parsed.inputs, '__proto__'), true);
  assert.equal(parsed.inputs.__proto__, input.goal);
  assert.equal(Object.getPrototypeOf(parsed.inputs), Object.prototype);
  assert.equal(authCalls, 1);
  assert.equal(fetchCalls, 1);
});


test('WSS rejects HTTPS-only workflow names before any credentials or transport, including fallback', () => {
  let credentials = 0, sockets = 0, fetches = 0;
  const auth = {read: async () => { credentials++; return 'Bearer synthetic'; }};
  const fetchImpl = async () => { fetches++; return response('unexpected'); };
  for (const allowHttpsFallback of [false, true]) {
    for (const workflowGoalInput of ['_goal', '__proto__', 'g'.repeat(65), 'g'.repeat(128)]) {
      assert.throws(() => new AgentArtsCloudAgentPort({gatewayUrl, runtimeName, transport: 'wss',
        websocketUrl: `wss://agentarts.example.test/runtimes/${runtimeName}/ws`,
        workflowGoalInput, allowHttpsFallback}, auth, fetchImpl, undefined, undefined, undefined,
        {factory: () => { sockets++; throw Error('unexpected socket'); }}),
      error => error instanceof ProtocolError && error.code === 'UNSUPPORTED_CAPABILITY'
        && error.message.includes('workflow goal input name'));
    }
  }
  assert.deepEqual({credentials, sockets, fetches}, {credentials: 0, sockets: 0, fetches: 0});
});

test('WSS accepts current wire name boundaries and HTTPS preserves its broader names', async () => {
  for (const workflowGoalInput of ['goal', 'g'.repeat(64)]) {
    const cloud = new AgentArtsCloudAgentPort({gatewayUrl, runtimeName, transport: 'wss',
      websocketUrl: `wss://agentarts.example.test/runtimes/${runtimeName}/ws`, workflowGoalInput},
    authorization({count: 0}), async () => { throw Error('unexpected HTTP'); }, undefined, undefined, undefined,
    {factory: () => { throw Error('unexpected socket'); }});
    cloud.close();
  }
  for (const workflowGoalInput of ['_goal', 'g'.repeat(65), 'g'.repeat(128)]) {
    let body;
    const cloud = new AgentArtsCloudAgentPort({gatewayUrl, runtimeName, workflowGoalInput},
      authorization({count: 0}), async (_url, init) => { body = JSON.parse(init.body); return response('accepted'); });
    await cloud.invoke(request());
    assert.deepEqual(body, {inputs: {[workflowGoalInput]: request().goal}});
  }
});
