import assert from 'node:assert/strict';
import test from 'node:test';
import {FakeModelProvider, ModelCapabilityRegistry, ModelGateway, PanguModelProvider, UnavailableModelProvider, validateToolProposal} from '../dist/index.js';

const deadline = '2099-01-01T00:00:00.000Z';
const request = (overrides = {}) => ({
  messages: [{role: 'user', content: 'hello'}],
  tools: [],
  maxOutputTokens: 20,
  deadline,
  signal: new AbortController().signal,
  ...overrides,
});

const panguResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {'content-type': 'application/json', ...headers},
});

const panguOptions = (fetch, overrides = {}) => ({
  baseUrl: 'https://pangu.example.test/',
  model: 'pangu-nlp-n1-32k',
  deployment: 'deployment-a',
  apiKey: () => 'secret-key',
  fetch,
  timeoutMs: 100,
  ...overrides,
});

test('FakeModelProvider returns explicit deployment and records a sanitized request', async () => {
  const provider = new FakeModelProvider([{kind: 'final', text: 'hello'}], {provider: 'fake', deployment: 'fixture-a', model: 'fixture-model'});
  const gateway = new ModelGateway(provider);
  const result = await gateway.complete(request());
  assert.equal(result.response.text, 'hello');
  assert.equal(result.deployment.deployment, 'fixture-a');
  assert.equal(result.deployment.model, 'fixture-model');
  assert.equal(result.deployment.verification, 'mock');
  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].signal.aborted, false);
});

test('tool requests require declared tool calling and structured output capabilities', async () => {
  const provider = new FakeModelProvider([{kind: 'final', text: 'unused'}], {
    capabilities: {text: true, streaming: false, toolCalling: false, structuredOutput: false, vision: false},
  });
  const gateway = new ModelGateway(provider);
  const descriptor = {name: 'fixture.read', version: '1.0.0', inputSchema: {type: 'object'}, outputSchema: {type: 'object'}, sideEffect: 'read', requiredScopes: [], idempotencySupport: true, recoverySupport: true, requiresPresence: false};
  await assert.rejects(gateway.complete(request({tools: [descriptor]})), {code: 'UNSUPPORTED_CAPABILITY'});
  assert.equal(provider.requests.length, 0);
});

test('Pangu V2 provider maps a text completion and keeps usage metadata', async () => {
  let received;
  const provider = new PanguModelProvider(panguOptions(async (url, options) => {
    received = {url, options, body: JSON.parse(options.body)};
    return panguResponse({id: 'response-1', model: 'pangu-nlp-n1-32k', choices: [{message: {role: 'assistant', content: 'hello'}, finish_reason: 'stop'}], usage: {prompt_tokens: 3, completion_tokens: 2, total_tokens: 5}});
  }));
  const result = await new ModelGateway(provider).complete(request());
  assert.equal(received.url, 'https://pangu.example.test/api/v2/chat/completions');
  assert.equal(received.options.headers.authorization, 'Bearer secret-key');
  assert.deepEqual(received.body, {model: 'pangu-nlp-n1-32k', messages: [{role: 'user', content: 'hello'}], max_tokens: 20, stream: true});
  assert.deepEqual(result.response, {kind: 'final', text: 'hello'});
  assert.deepEqual(result.usage, {promptTokens: 3, completionTokens: 2, totalTokens: 5});
  assert.equal(result.deployment.provider, 'pangu');
  assert.equal(result.deployment.deployment, 'deployment-a');
  assert.equal(result.deployment.verification, 'conditional');
});

test('Pangu provider leaves output length to the service when no local budget is configured', async () => {
  let receivedBody;
  const provider = new PanguModelProvider(panguOptions(async (_url, options) => {
    receivedBody = JSON.parse(options.body);
    return panguResponse({choices: [{message: {content: 'unbounded locally'}, finish_reason: 'stop'}]});
  }));
  const unboundedRequest = request();
  delete unboundedRequest.maxOutputTokens;
  const result = await new ModelGateway(provider).complete(unboundedRequest);
  assert.equal(result.response.text, 'unbounded locally');
  assert.equal(Object.hasOwn(receivedBody, 'max_tokens'), false);
});

test('Pangu provider preserves an OpenAI-compatible versioned endpoint', async () => {
  let receivedUrl;
  const provider = new PanguModelProvider(panguOptions(async url => {
    receivedUrl = url;
    return panguResponse({choices: [{message: {content: 'hello'}, finish_reason: 'stop'}]});
  }, {baseUrl: 'https://api.modelarts-maas.com/openai/v1'}));
  await provider.complete(request());
  assert.equal(receivedUrl, 'https://api.modelarts-maas.com/openai/v1/chat/completions');
});

test('Pangu provider requires a non-empty injected API key and never logs it in errors', async () => {
  let calls = 0;
  const provider = new PanguModelProvider(panguOptions(async () => {
    calls++;
    return panguResponse({});
  }, {apiKey: () => ''}));
  await assert.rejects(provider.complete(request()), error => error.code === 'UNAUTHORIZED' && !error.message.includes('secret-key'));
  assert.equal(calls, 0);
});

test('Pangu provider maps authentication and rate-limit errors without retrying', async () => {
  let calls = 0;
  const unauthorized = new PanguModelProvider(panguOptions(async () => {
    calls++;
    return panguResponse({error: {message: 'no'}}, 401);
  }));
  await assert.rejects(unauthorized.complete(request()), {code: 'UNAUTHORIZED'});
  assert.equal(calls, 1);

  const limited = new PanguModelProvider(panguOptions(async () => {
    calls++;
    return panguResponse({error: {message: 'slow'}}, 429, {'retry-after': '2'});
  }));
  await assert.rejects(limited.complete(request()), error => error.code === 'RATE_LIMITED' && error.retryable === true && error.retryAfterMs === 2000);
  assert.equal(calls, 2);
});

test('Pangu provider exposes malformed responses and server failures as external failures', async () => {
  const malformed = new PanguModelProvider(panguOptions(async () => new Response('not-json', {
    status: 200,
    headers: {'content-type': 'application/json'},
  })));
  await assert.rejects(malformed.complete(request()), {code: 'EXTERNAL_FAILURE'});

  const missingChoices = new PanguModelProvider(panguOptions(async () => panguResponse({})));
  await assert.rejects(missingChoices.complete(request()), {code: 'EXTERNAL_FAILURE'});

  const unavailable = new PanguModelProvider(panguOptions(async () => panguResponse({error: {message: 'temporary'}}, 503)));
  await assert.rejects(unavailable.complete(request()), error => error.code === 'EXTERNAL_FAILURE' && error.retryable === true);
});

test('Pangu provider maps timeout and caller cancellation distinctly', async () => {
  const waitForAbort = (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), {once: true});
  });
  const timedOut = new PanguModelProvider(panguOptions(waitForAbort, {timeoutMs: 5}));
  await assert.rejects(timedOut.complete(request()), {code: 'TIMEOUT'});

  const controller = new AbortController();
  const cancelled = new PanguModelProvider(panguOptions(waitForAbort, {timeoutMs: 1000}));
  const pending = cancelled.complete(request({signal: controller.signal}));
  controller.abort();
  await assert.rejects(pending, {code: 'CANCELLED'});
});

test('Pangu provider rejects tool messages and unsupported capabilities', async () => {
  const provider = new PanguModelProvider(panguOptions(async () => panguResponse({})));
  await assert.rejects(provider.complete(request({messages: [{role: 'tool', content: 'result'}]})), {code: 'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(provider.complete(request({requiredCapabilities: ['toolCalling']})), {code: 'UNSUPPORTED_CAPABILITY'});
});

test('unavailable provider is explicit and is not silently replaced by Fake', async () => {
  const unavailable = new UnavailableModelProvider();
  await assert.rejects(new ModelGateway(unavailable).complete(request()), {code: 'UNSUPPORTED_CAPABILITY'});
});

test('tool proposal rejects model-supplied authorization fields', () => {
  assert.throws(() => validateToolProposal({toolName: 'fixture.read', toolVersion: '1.0.0', arguments: {}, scopeRef: 'forged'}), {code: 'UNAUTHORIZED'});
});

test('capability probe is recorded before a gateway is enabled', async () => {
  const provider = new FakeModelProvider([{kind: 'final', text: 'unused'}]);
  const registry = new ModelCapabilityRegistry();
  const deployment = await registry.probe(provider, {probe: async () => ({text: true, streaming: false, toolCalling: false, structuredOutput: false, vision: false})});
  assert.equal(deployment.capabilities.toolCalling, false);
  assert.equal(registry.get('fake', 'fake-deployment', 'fake-model').capabilities.toolCalling, false);
  await assert.rejects(new ModelGateway(provider, deployment).complete(request({tools: [{name: 'fixture.read', version: '1.0.0', inputSchema: {type: 'object'}, outputSchema: {type: 'object'}, sideEffect: 'read', requiredScopes: [], idempotencySupport: true, recoverySupport: true, requiresPresence: false}]})), {code: 'UNSUPPORTED_CAPABILITY'});
});

test('Pangu streams reasoning and text, then falls back once when the endpoint rejects streaming', async () => {
  const deltas = [];
  const provider = new PanguModelProvider(panguOptions(async () => new Response([
    'data: {"choices":[{"delta":{"reasoning_content":"先想"}}]}',
    '',
    'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":"stop"}]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n'), {status: 200, headers: {'content-type': 'text/event-stream'}})));
  const streamed = await provider.complete(request({onDelta: delta => deltas.push(delta)}));
  assert.equal(streamed.response.text, '你好');
  assert.equal(streamed.reasoning, '先想');
  assert.deepEqual(deltas, [{kind: 'reasoning', text: '先想'}, {kind: 'text', text: '你好'}]);

  let calls = 0;
  const fallback = new PanguModelProvider(panguOptions(async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    if (calls === 1) {
      assert.equal(body.stream, true);
      return new Response(JSON.stringify({error: {message: 'stream is not supported'}}), {status: 400, headers: {'content-type': 'application/json'}});
    }
    assert.equal(body.stream, false);
    return panguResponse({choices: [{message: {content: '回退后的回答', reasoning_content: '想过了'}, finish_reason: 'stop'}]});
  }));
  const second = [];
  const result = await fallback.complete(request({onDelta: delta => second.push(delta)}));
  assert.equal(calls, 2);
  assert.equal(result.response.text, '回退后的回答');
  assert.equal(result.reasoning, '想过了');
  assert.deepEqual(second.map(item => item.kind), ['reasoning', 'text']);
});
