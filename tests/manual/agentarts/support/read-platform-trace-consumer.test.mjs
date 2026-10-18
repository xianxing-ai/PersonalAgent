import test from 'node:test';
import assert from 'node:assert/strict';
import {readAgentArtsTrace} from './read-platform-trace.mjs';
import {buildPlatformTraceFixtures} from './platform-trace-fixtures.mjs';

const options = () => ({deadline: new Date(Date.now() + 10_000).toISOString(),
  signal: new AbortController().signal});
// SDK-shaped synthetic headers test request plumbing, never signature validity.
function sign(request) {
  return {...request.headers, 'X-Sdk-Date': '20261007T080000Z',
    Authorization: 'SDK-HMAC-SHA256 Access=synthetic-key, SignedHeaders=content-type;host;x-sdk-date, Signature=' + '0'.repeat(64),
    'X-Security-Token': 'synthetic-session-token'};
}
function response(body, status = 200) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  let offset = 0;
  return {status, headers: new Headers({'Content-Type': 'application/json; charset=utf-8'}),
    body: new ReadableStream({pull(controller) {
      if (offset === bytes.length) {controller.close(); return;}
      controller.enqueue(bytes.slice(offset, offset + 11)); offset = Math.min(offset + 11, bytes.length);
    }})};
}
function assertPrivateAbsent(value, data) {
  const serialized = JSON.stringify(value instanceof Error
    ? {code: value.code, message: value.message, httpStatus: value.httpStatus} : value);
  for (const canary of data.privateCanaries) assert.equal(serialized.includes(canary), false);
  assert.doesNotMatch(serialized, /synthetic-session-token|synthetic-key|Signature=|span_id|trace_id|"input"|"output"|metadata|session_id|resource_id|model_name/);
}

test('one explicitly signed official GET preserves URL and headers and reports partial spans without a request join', async () => {
  const data = buildPlatformTraceFixtures(), input = options();
  const calls = []; let approved;
  const summary = await readAgentArtsTrace({traceId: data.traceId, ...input,
    authorize(request) {
      approved = request;
      assert.equal(request.url, `https://agentarts.cn-southwest-2.myhuaweicloud.com/v1/ops/observation/traces/${data.traceId}`);
      assert.equal(request.method, 'GET'); assert.equal(request.body, '');
      assert.equal(request.deadline, input.deadline);
      assert.equal(Object.isFrozen(request), true); assert.equal(Object.isFrozen(request.headers), true);
      assert.deepEqual(request.headers, {Host: 'agentarts.cn-southwest-2.myhuaweicloud.com',
        'Content-Type': 'application/json', Accept: 'application/json'});
      return sign(request);
    },
    fetchImpl(url, init) {
      calls.push({url, init});
      assert.equal(url, approved.url); assert.equal(init.method, approved.method);
      assert.deepEqual(init.headers, sign(approved)); assert.equal(init.signal, approved.signal);
      assert.ok(['error', 'manual'].includes(init.redirect));
      return response(data.partial);
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(summary.surface, 'ShowOpsTrace'); assert.equal(summary.region, 'cn-southwest-2');
  assert.equal(summary.httpStatus, 200); assert.equal(summary.total, 5); assert.equal(summary.returnedSpanCount, 1);
  assert.deepEqual(summary.spans, [{index: 0, durationMs: 5, tokens: 0,
    inputTokens: 0, outputTokens: 0, isError: false}]);
  assert.equal(summary.requestCorrelation, 'not_checked');
  assert.equal(summary.deploymentVersion, 'not_checked'); assert.equal(summary.cost, 'not_checked');
  assertPrivateAbsent(summary, data);
  assert.doesNotMatch(JSON.stringify(summary), /complete|totalTokens|verified|runtimeVersion|requestId/);
});

test('streamed official root metrics retain unknowns without invented totals, timings or private trace material', async () => {
  const data = buildPlatformTraceFixtures();
  for (const body of [data.mixedMetrics, data.privateFields, data.empty]) {
    const summary = await readAgentArtsTrace({traceId: data.traceId, ...options(),
      authorize: sign, fetchImpl: () => response(body)});
    assert.equal(summary.returnedSpanCount, body.span_list.length);
    assertPrivateAbsent(summary, data);
    if (body === data.mixedMetrics) {
      assert.deepEqual(summary.spans, [
        {index: 0, durationMs: 125, tokens: 7, inputTokens: 4, outputTokens: 3, isError: true},
        {index: 1, durationMs: null, tokens: null, inputTokens: null, outputTokens: null, isError: null},
        {index: 2, durationMs: 0, tokens: null, inputTokens: null, outputTokens: null, isError: false},
      ]);
    }
    if (body === data.empty) assert.deepEqual(summary.spans, []);
    assert.equal(summary.requestCorrelation, 'not_checked');
    assert.equal(summary.deploymentVersion, 'not_checked'); assert.equal(summary.cost, 'not_checked');
    assert.equal(Object.hasOwn(summary, 'totalTokens'), false);
  }
});

test('a span from another trace rejects the whole streamed response rather than combining it with the requested trace', async () => {
  const data = buildPlatformTraceFixtures();
  const body = structuredClone(data.privateFields);
  body.span_list[0].trace_id = 'different-synthetic-trace';
  await assert.rejects(readAgentArtsTrace({traceId: data.traceId, ...options(),
    authorize: sign, fetchImpl: () => response(body)}), error => {
    assert.equal(error.code, 'EXTERNAL_FAILURE'); assertPrivateAbsent(error, data);
    assert.equal(error.message.includes('different-synthetic-trace'), false); return true;
  });
});

test('one absolute deadline is consumed across signing, fetch and body rather than renewed for each stage', async () => {
  const data = buildPlatformTraceFixtures(), began = Date.now(), originalNow = Date.now;
  let now = began, phase = '', signal;
  const deadline = new Date(began + 250).toISOString();
  // Controlled wall-clock progression makes all three stages run without sleeps:
  // each uses less than 250ms, but their combined 260ms exceeds the original lease.
  Date.now = () => now;
  try {
    await assert.rejects(readAgentArtsTrace({traceId: data.traceId, deadline,
      signal: new AbortController().signal,
      authorize(request) {phase = 'sign'; now += 100; signal = request.signal;
        assert.equal(request.deadline, deadline); return sign(request);},
      fetchImpl(_url, init) {phase = 'fetch'; now += 100; assert.equal(init.signal, signal);
        return {status: 200, headers: new Headers({'content-type': 'application/json'}), body: {
          getReader() {return {read() {phase = 'body'; now += 60;
            return Promise.resolve({done: false, value: new TextEncoder().encode(JSON.stringify(data.privateFields))});},
          cancel() {}, releaseLock() {}};},
        }};
      },
    }), error => {assert.equal(error.code, 'TIMEOUT'); assertPrivateAbsent(error, data); return true;});
    assert.equal(phase, 'body'); assert.equal(signal.aborted, true);
  } finally {Date.now = originalNow;}
});

test('cancellation while a complete private body arrives cannot turn that response into a successful summary', async () => {
  const data = buildPlatformTraceFixtures(), controller = new AbortController();
  let reads = 0, fetches = 0, signedSignal;
  await assert.rejects(readAgentArtsTrace({traceId: data.traceId, ...options(), signal: controller.signal,
    authorize(request) {signedSignal = request.signal; return sign(request);},
    fetchImpl() {fetches++; return {status: 200, headers: new Headers({'content-type': 'application/json'}),
      body: {getReader() {return {read() {reads++; controller.abort();
        return Promise.resolve({done: false, value: new TextEncoder().encode(JSON.stringify(data.privateFields))});},
      cancel() {}, releaseLock() {}};}}};},
  }), error => {assert.equal(error.code, 'CANCELLED'); assertPrivateAbsent(error, data); return true;});
  assert.equal(fetches, 1); assert.equal(reads, 1); assert.equal(signedSignal.aborted, true);
});

test('redirects and server failures are one attempted GET and never return their private body or retry', async () => {
  const data = buildPlatformTraceFixtures();
  for (const status of [302, 401, 503]) {
    let fetches = 0, signatures = 0;
    await assert.rejects(readAgentArtsTrace({traceId: data.traceId, ...options(),
      authorize(request) {signatures++; return sign(request);},
      fetchImpl(_url, init) {fetches++; assert.ok(['error', 'manual'].includes(init.redirect));
        return response(data.privateFields, status);},
    }), error => {
      assert.equal(error.code, status === 401 ? 'UNAUTHORIZED' : 'EXTERNAL_FAILURE');
      assert.equal(error.httpStatus, status); assertPrivateAbsent(error, data); return true;
    });
    assert.equal(signatures, 1); assert.equal(fetches, 1);
  }
});

test('transport and truncated-stream failures never expose provider error text or silently accept partial JSON', async () => {
  const data = buildPlatformTraceFixtures();
  const fetches = [
    () => {throw Error(data.privateCanaries[0]);},
    () => ({status: 200, headers: new Headers({'content-type': 'application/json'}),
      body: new ReadableStream({start(controller) {
        controller.enqueue(new TextEncoder().encode('{"span_list":[{"input":' + JSON.stringify(data.privateCanaries[0]))); controller.close();
      }})}),
  ];
  for (const fetchImpl of fetches) {
    await assert.rejects(readAgentArtsTrace({traceId: data.traceId, ...options(), authorize: sign, fetchImpl}),
      error => {assert.equal(error.code, 'EXTERNAL_FAILURE'); assertPrivateAbsent(error, data);
        assert.equal(data.privateCanaries.some(canary => error.message.includes(canary)), false); return true;});
  }
});
