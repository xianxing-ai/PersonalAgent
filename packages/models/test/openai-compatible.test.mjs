import assert from 'node:assert/strict';
import test from 'node:test';
import {ModelGateway, OpenAICompatibleModelProvider, StructuredToolProvider} from '../dist/index.js';

const TOOL = {
  name: 'weather.forecast', version: '0.1.0-alpha.1',
  inputSchema: {type: 'object', properties: {location: {type: 'string'}}, required: ['location'], additionalProperties: false},
  outputSchema: {type: 'object', additionalProperties: true},
  sideEffect: 'read', requiredScopes: ['weather:read'], idempotencySupport: true, recoverySupport: true, requiresPresence: false,
};

function request(overrides = {}) {
  return {
    messages: [{role: 'user', content: '北京今天天气如何'}],
    tools: [],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal,
    ...overrides,
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return {ok: status >= 200 && status < 300, status,
    headers: {get: name => headers[String(name).toLowerCase()] ?? null},
    json: async () => body};
}

function provider(fetchImpl, options = {}) {
  return new OpenAICompatibleModelProvider({
    baseUrl: 'https://api.example.test/v1',
    model: 'test-model',
    apiKey: () => 'sk-test',
    fetch: async (url, init) => fetchImpl(url, init),
    ...options,
  });
}

test('trusted JSON output is explicit and does not advertise native tools or strict schemas',async()=>{
 for(const responseFormat of [undefined,'json_object']){
  let body;
  const p=provider(async(_url,init)=>{body=JSON.parse(init.body);return jsonResponse({choices:[{message:{content:'{"kind":"text","text":"hello"}'}}]});},{responseFormat});
  await p.complete(request({messages:[{role:'system',content:'Return one JSON object.'},{role:'user',content:'Hello'}]}));
  assert.deepEqual(body.response_format,responseFormat===undefined?undefined:{type:'json_object'});
  assert.equal(p.deployment.capabilities.toolCalling,false);
  assert.equal(p.deployment.capabilities.structuredOutput,false);
 }
 for(const responseFormat of ['json_schema','text',null,true])assert.throws(()=>provider(async()=>assert.fail('must not send'),{responseFormat}),{code:'INVALID_ARGUMENT'});
});

test('trusted native reasoning maps thinking, max effort and a single total output budget', async () => {
  let body;
  const nativeReasoning = {thinking: 'enabled', effort: 'max', supportedEfforts: ['low', 'high', 'max'],
    outputTokenParameter: 'max_completion_tokens'};
  const p = provider(async (_url, init) => {
    body = JSON.parse(init.body);
    return jsonResponse({choices: [{message: {content: 'Synthetic answer'}}]});
  }, {nativeReasoning});
  // Configuration is copied; callers cannot silently mutate the trusted binding.
  nativeReasoning.effort = 'low';
  const gateway = new ModelGateway(new StructuredToolProvider(p));
  await gateway.complete(request({maxOutputTokens: 128}));
  assert.deepEqual(body.thinking, {type: 'enabled'});
  assert.equal(body.reasoning_effort, 'max');
  assert.equal(body.max_completion_tokens, 128);
  assert.equal(Object.hasOwn(body, 'max_tokens'), false);
  assert.equal(gateway.deployment.capabilities.nativeReasoning.effort, 'max');
  assert.equal(gateway.deployment.verification, 'conditional');
  await gateway.complete(request({reasoningEffort: 'low'}));
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(Object.hasOwn(body, 'max_completion_tokens'), false);
});

test('native unsupported controls fail before credentials or transport; disabled thinking sends no effort', async () => {
  let credentials = 0, calls = 0, body;
  const p = provider(async (_url, init) => {
    calls++; body = JSON.parse(init.body);
    return jsonResponse({choices: [{message: {content: 'Synthetic answer'}}]});
  }, {apiKey: () => {credentials++; return 'synthetic';}, nativeReasoning: {
    thinking: 'enabled', supportedEfforts: ['low', 'max'], outputTokenParameter: 'max_completion_tokens',
  }});
  for (const overrides of [{reasoningEffort: 'medium'}, {thinkingBudget: 100}, {reasoningEffort: 'unknown'}]) {
    await assert.rejects(new ModelGateway(p).complete(request(overrides)), error =>
      ['UNSUPPORTED_CAPABILITY', 'INVALID_ARGUMENT'].includes(error.code));
  }
  assert.equal(credentials, 0); assert.equal(calls, 0);
  const disabled = provider(async (_url, init) => {
    body = JSON.parse(init.body); return jsonResponse({choices: [{message: {content: 'Synthetic answer'}}]});
  }, {nativeReasoning: {thinking: 'disabled', supportedEfforts: [], outputTokenParameter: 'max_tokens'}});
  await assert.rejects(disabled.complete(request({reasoningEffort: 'none'})), {code: 'UNSUPPORTED_CAPABILITY'});
  await disabled.complete(request({maxOutputTokens: 32}));
  assert.deepEqual(body.thinking, {type: 'disabled'});
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
  assert.equal(body.max_tokens, 32);
  assert.equal(Object.hasOwn(body, 'max_completion_tokens'), false);
});

test('native reasoning declarations reject malformed, conflicting and unlisted defaults', () => {
  const valid = {thinking: 'enabled', supportedEfforts: ['high', 'max'], outputTokenParameter: 'max_completion_tokens'};
  for (const nativeReasoning of [null, {...valid, thinking: 'auto'}, {...valid, extra: true},
    {...valid, supportedEfforts: ['high', 'high']}, {...valid, effort: 'low'},
    {...valid, outputTokenParameter: 'budget'}, {...valid, thinking: 'disabled', effort: 'high'},
    {...valid, thinking: 'disabled'}]) {
    assert.throws(() => provider(() => {throw Error('must not call');}, {nativeReasoning}), {code: 'INVALID_ARGUMENT'});
  }
});

test('maps a chat completion to a final text result with usage and stop reason', async () => {
  let seenUrl = '';
  let seenAuth = '';
  let seenBody;
  const p = provider(async (url, init) => {
    seenUrl = url;
    seenAuth = init.headers.authorization;
    seenBody = JSON.parse(init.body);
    return jsonResponse({choices: [{message: {role: 'assistant', content: '北京多云，午后局部阵雨。'}, finish_reason: 'stop'}],
      usage: {prompt_tokens: 12, completion_tokens: 8, total_tokens: 20}});
  });
  const result = await p.complete(request({maxOutputTokens: 64}));
  assert.equal(seenUrl, 'https://api.example.test/v1/chat/completions');
  assert.equal(seenAuth, 'Bearer sk-test');
  assert.equal(seenBody.model, 'test-model');
  assert.equal(seenBody.max_tokens, 64);
  assert.equal(seenBody.stream, false);
  assert.deepEqual(seenBody.messages, [{role: 'user', content: '北京今天天气如何'}]);
  assert.equal(result.response.kind, 'final');
  assert.equal(result.response.text, '北京多云，午后局部阵雨。');
  assert.deepEqual(result.usage, {promptTokens: 12, completionTokens: 8, totalTokens: 20});
  assert.equal(result.stopReason, 'stop');
  assert.equal(result.deployment.provider, 'openai-compatible');
  assert.equal(result.deployment.verification, 'conditional');
  assert.equal(result.deployment.capabilities.text, true);
  assert.equal(result.deployment.capabilities.toolCalling, false);
});

test('base url is normalized for trailing slashes and must be absolute with a version segment', async () => {
  const p = provider(async () => jsonResponse({choices: [{message: {content: 'ok'}, finish_reason: 'stop'}]}),
    {baseUrl: 'https://api.example.test/v1///'});
  await p.complete(request());
  assert.equal(p.baseUrl, 'https://api.example.test/v1');
  assert.throws(() => provider(async () => jsonResponse({}), {baseUrl: 'api.example.test/v1'}),
    {code: 'INVALID_ARGUMENT'});
});

test('text layer refuses tools and tool messages; tool calling composes through StructuredToolProvider', async () => {
  const p = provider(async () => jsonResponse({choices: [{message: {content: 'unused'}, finish_reason: 'stop'}]}));
  await assert.rejects(p.complete(request({tools: [TOOL]})), {code: 'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(p.complete(request({messages: [{role: 'tool', content: '{}'}]})), {code: 'UNSUPPORTED_CAPABILITY'});

  const tooling = provider(async () => jsonResponse({choices: [{message: {
    content: JSON.stringify({kind: 'tool_proposal', proposal: {toolName: 'weather.forecast', toolVersion: '0.1.0-alpha.1', arguments: {location: '北京'}}}),
  }, finish_reason: 'stop'}]}));
  const withTools = new StructuredToolProvider(tooling);
  const result = await withTools.complete(request({tools: [TOOL]}));
  assert.equal(result.response.kind, 'tool_proposal');
  assert.deepEqual(result.response.proposal.arguments, {location: '北京'});
  assert.equal(result.deployment.capabilities.toolCalling, true);
});

test('error taxonomy: auth, rate limit with retry-after, server failure retryable, client failure not', async () => {
  const auth = provider(async () => jsonResponse({error: {message: 'bad key'}}, 401));
  await assert.rejects(auth.complete(request()), {code: 'UNAUTHORIZED'});

  const limited = provider(async () => jsonResponse({error: {message: 'slow down'}}, 429, {'retry-after': '3'}));
  await assert.rejects(limited.complete(request()), error =>
    error.code === 'RATE_LIMITED' && error.retryable === true && error.retryAfterMs === 3000);

  const serverError = provider(async () => jsonResponse({error: {message: 'upstream'}}, 503));
  await assert.rejects(serverError.complete(request()), error =>
    error.code === 'EXTERNAL_FAILURE' && error.retryable === true);

  const clientError = provider(async () => jsonResponse({error: {message: 'bad request'}}, 400));
  await assert.rejects(clientError.complete(request()), error =>
    error.code === 'EXTERNAL_FAILURE' && error.retryable === false);
});

test('missing key, cancellation, network failure and malformed responses are mapped honestly', async () => {
  const noKey = new OpenAICompatibleModelProvider({baseUrl: 'https://api.example.test/v1', model: 'm',
    apiKey: () => '', fetch: async () => jsonResponse({})});
  await assert.rejects(noKey.complete(request()), {code: 'UNAUTHORIZED'});

  const controller = new AbortController();
  controller.abort();
  const cancelled = provider(async () => jsonResponse({choices: [{message: {content: 'x'}, finish_reason: 'stop'}]}));
  await assert.rejects(cancelled.complete(request({signal: controller.signal})), {code: 'CANCELLED'});

  const networkFailure = new OpenAICompatibleModelProvider({baseUrl: 'https://api.example.test/v1', model: 'm',
    apiKey: () => 'sk', fetch: async () => { throw Error('reset'); }});
  await assert.rejects(networkFailure.complete(request()), {code: 'EXTERNAL_FAILURE', retryable: true});

  for (const body of [{}, {choices: []}, {choices: [{message: {content: ''}}]}]) {
    const malformed = provider(async () => jsonResponse(body));
    await assert.rejects(malformed.complete(request()), {code: 'EXTERNAL_FAILURE'});
  }
});

test('a gateway routes through the provider and carries the configured deployment identity', async () => {
  const p = provider(async () => jsonResponse({choices: [{message: {content: 'final answer'}, finish_reason: 'length'}]}),
    {deployment: 'deepseek-chat-prod', contextLimitTokens: 65_536});
  const gateway = new ModelGateway(p);
  const result = await gateway.complete(request());
  assert.equal(result.response.kind, 'final');
  assert.equal(result.deployment.deployment, 'deepseek-chat-prod');
  assert.equal(result.deployment.capabilities.contextLimit, 65_536);
  assert.equal(result.stopReason, 'length');
});
