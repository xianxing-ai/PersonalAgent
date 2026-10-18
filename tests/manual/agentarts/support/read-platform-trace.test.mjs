import assert from 'node:assert/strict';
import test from 'node:test';
import {readAgentArtsTrace} from './read-platform-trace.mjs';

const traceId = '94c7408e75f61939f1deb09b58a1baf1';
const origin = 'https://agentarts.cn-southwest-2.myhuaweicloud.com';
const privateText = 'private-input-output-secret';
const document = () => ({total: 5, span_list: [{trace_id: traceId, span_id: '7176c7f41140760d',
  span_type: 'workflow', span_name: privateText, status_message: privateText, input: privateText, output: privateText,
  session_id: privateText, resource_id: privateText, resource_name: privateText, model_name: privateText,
  metadata: privateText, duration: 5, tokens: 0, input_tokens: 0, output_tokens: 0, is_error: false}]});
const json = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json; charset=utf-8'}});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
const headers = request => ({...request.headers,
  Authorization: 'SDK-HMAC-SHA256 Access=fake,SignedHeaders=host;x-sdk-date,Signature=fake',
  'X-Sdk-Date': '20261007T160000Z', 'X-Security-Token': 'fake-temporary-token'});
const options = extra => ({traceId, deadline: new Date(Date.now() + 10_000).toISOString(),
  signal: new AbortController().signal, authorize: async request => headers(request), fetchImpl: async () => json(document()), ...extra});
const safeError = code => error => error.code === code && !String(error).includes(privateText);

test('one explicit signed GET returns only the documented numeric summary, not private data or a join', async () => {
  let signed, sent, calls = 0;
  const input = options({authorize: async request => { signed = request; return headers(request); },
    fetchImpl: async (url, init) => { calls++; sent = {url, init}; return json(document()); }});
  const receipt = await readAgentArtsTrace(input);
  assert.equal(calls, 1);
  assert.equal(signed.url, `${origin}/v1/ops/observation/traces/${traceId}`);
  assert.equal(signed.method, 'GET'); assert.equal(signed.body, ''); assert.equal(signed.deadline, input.deadline);
  assert.ok(Object.isFrozen(signed) && Object.isFrozen(signed.headers));
  assert.equal(sent.url, signed.url); assert.equal(sent.init.signal, signed.signal);
  assert.deepEqual(sent.init.headers, headers(signed));
  assert.equal(sent.init.redirect, 'error'); assert.equal(sent.init.method, 'GET');
  assert.ok(!Object.hasOwn(sent.init, 'body'));
  assert.deepEqual(receipt.spans, [{index: 0, durationMs: 5, tokens: 0, inputTokens: 0, outputTokens: 0, isError: false}]);
  assert.equal(receipt.total, 5); assert.equal(receipt.returnedSpanCount, 1);
  assert.equal(receipt.requestCorrelation, 'not_checked'); assert.equal(receipt.deploymentVersion, 'not_checked');
  assert.equal(receipt.cost, 'not_checked'); assert.equal(receipt.region, 'cn-southwest-2');
  assert.ok(!JSON.stringify(receipt).includes(privateText));
  assert.ok(!JSON.stringify(receipt).includes('fake-temporary-token'));
  assert.ok(Object.isFrozen(receipt) && Object.isFrozen(receipt.spans[0]));
});

test('missing optional metrics stay unknown, not zero or inferred from another metric', async () => {
  const value = {total: 1, span_list: [{trace_id: traceId, tokens: 8}]};
  const receipt = await readAgentArtsTrace(options({fetchImpl: async () => json(value)}));
  assert.deepEqual(receipt.spans[0], {index: 0, durationMs: null, tokens: 8, inputTokens: null, outputTokens: null, isError: null});
});

test('invalid request, expired deadline and pre-abort invoke neither signing nor transport', async () => {
  let calls = 0;
  const base = options({authorize: () => { calls++; }, fetchImpl: () => { calls++; }});
  for (const extra of [{traceId: '../secret'}, {traceId: 'x'.repeat(65)}, {deadline: '2026-02-30T00:00:00Z'},
    {deadline: new Date(0).toISOString()}, {signal: {}}, {unknown: true}]) {
    await assert.rejects(readAgentArtsTrace({...base, ...extra}), safeError('INVALID_ARGUMENT'));
  }
  const parent = new AbortController(); parent.abort(privateText);
  await assert.rejects(readAgentArtsTrace({...base, signal: parent.signal}), safeError('CANCELLED'));
  assert.equal(calls, 0);
});

test('immediate parent abort prevents the queued signer and transport from starting', async () => {
  const parent = new AbortController();
  let authorizations = 0, fetches = 0;
  const run = readAgentArtsTrace(options({signal: parent.signal,
    authorize: async request => { authorizations++; return headers(request); },
    fetchImpl: async () => { fetches++; return json(document()); }}));
  parent.abort(privateText);
  await assert.rejects(run, safeError('CANCELLED'));
  assert.equal(authorizations, 0);
  assert.equal(fetches, 0);
});

test('a provider Proxy cannot impersonate a fixed internal error or expose its private message', async () => {
  let providerReads = 0, fetches = 0;
  const providerError = new Proxy(new Error(privateText), {get(target, key, receiver) {
    providerReads++;
    if (typeof key === 'symbol' && key !== Symbol.toPrimitive) return true;
    return Reflect.get(target, key, receiver);
  }});
  await assert.rejects(readAgentArtsTrace(options({authorize: async () => { throw providerError; },
    fetchImpl: async () => { fetches++; }})), error => {
    assert.notEqual(error, providerError);
    assert.equal(error.code, 'EXTERNAL_FAILURE');
    assert.ok(!String(error).includes(privateText));
    assert.ok(Object.isFrozen(error));
    return true;
  });
  assert.equal(providerReads, 0);
  assert.equal(fetches, 0);
});

test('runtime Bearer, missing signed headers, modified host and header injection never reach fetch', async () => {
  let calls = 0;
  for (const change of [value => ({...value, Authorization: 'Bearer private-input-output-secret'}),
    value => { delete value['X-Sdk-Date']; return value; }, value => ({...value, Host: 'other.example'}),
    value => ({...value, Authorization: `SDK-HMAC-SHA256 ${privateText}\r\nX-Extra: injected`})]) {
    await assert.rejects(readAgentArtsTrace(options({authorize: async request => change(headers(request)),
      fetchImpl: async () => { calls++; }})), error => ['INVALID_ARGUMENT', 'UNAUTHORIZED'].includes(error.code)
        && !String(error).includes(privateText));
  }
  assert.equal(calls, 0);
});

test('HTTP403 exposes fixed status/code, drops private body and never retries', async () => {
  let calls = 0, cancelled = 0;
  await assert.rejects(readAgentArtsTrace(options({fetchImpl: async () => {
    calls++; return new Response(new ReadableStream({cancel() { cancelled++; }}), {status: 403,
      headers: {'Content-Type': 'application/json', 'X-Private': privateText}});
  }})), error => safeError('UNAUTHORIZED')(error) && error.httpStatus === 403);
  assert.equal(calls, 1); assert.equal(cancelled, 1);
});

test('malformed/mismatched data, private errors, non-JSON and oversized bodies fail with fixed errors', async () => {
  for (const response of [json({total: 1, span_list: [{trace_id: 'other'}]}),
    json({total: 1, span_list: [{trace_id: traceId, tokens: -1}]}),
    json({total: 1, span_list: [{trace_id: traceId, is_error: privateText}]}),
    json({error_msg: privateText}), new Response(privateText, {headers: {'Content-Type': 'text/plain'}}),
    new Response('{', {headers: {'Content-Type': 'application/json'}}),
    new Response(' '.repeat(1024 * 1024 + 1), {headers: {'Content-Type': 'application/json'}})]) {
    await assert.rejects(readAgentArtsTrace(options({fetchImpl: async () => response})), safeError('EXTERNAL_FAILURE'));
  }
  await assert.rejects(readAgentArtsTrace(options({authorize: async () => { throw Error(privateText); }})), safeError('EXTERNAL_FAILURE'));
});

for (const stage of ['authorize', 'fetch', 'body']) {
  for (const cause of ['CANCELLED', 'TIMEOUT']) {
    test(`${cause} bounds noncooperative ${stage}, consumes late failures and discards a late response`, async context => {
      context.mock.timers.enable({apis: ['setTimeout', 'Date'], now: Date.now()});
      const entered = deferred(), pending = deferred(), parent = new AbortController();
      let calls = 0, cancelled = 0, capturedSignal;
      const input = options({deadline: new Date(Date.now() + 500).toISOString(), signal: parent.signal,
        authorize: async request => {
          capturedSignal = request.signal;
          if (stage === 'authorize') { entered.resolve(); return pending.promise; }
          return headers(request);
        }, fetchImpl: async () => {
          calls++;
          if (stage === 'fetch') { entered.resolve(); return pending.promise; }
          return {status: 200, headers: new Headers({'Content-Type': 'application/json'}), body: {getReader: () => ({
            read() { entered.resolve(); return pending.promise; }, cancel() { cancelled++; return new Promise(() => {}); },
            releaseLock() {},
          })}};
        }});
      const run = readAgentArtsTrace(input);
      await entered.promise;
      const rejected = assert.rejects(run, safeError(cause));
      if (cause === 'CANCELLED') parent.abort(privateText);
      else context.mock.timers.tick(500);
      await rejected;
      assert.equal(capturedSignal.aborted, true);
      assert.equal(calls, stage === 'authorize' ? 0 : 1);
      if (stage === 'fetch') {
        pending.resolve(new Response(new ReadableStream({cancel() { cancelled++; }})));
      } else pending.reject(Error(privateText));
      await new Promise(resolve => setImmediate(resolve));
      if (stage !== 'authorize') assert.ok(cancelled >= 1);
      assert.equal(calls, stage === 'authorize' ? 0 : 1);
    });
  }
}
