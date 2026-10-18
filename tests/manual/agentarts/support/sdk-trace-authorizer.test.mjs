import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentArtsTraceAuthorizer} from './sdk-trace-authorizer.mjs';
import {readAgentArtsTrace} from './read-platform-trace.mjs';

const HOST = 'agentarts.cn-southwest-2.myhuaweicloud.com';
const SECRET = 'SYNTHETIC_PRIVATE_SECRET';
const options = () => ({deadline: new Date(Date.now() + 10_000).toISOString(), signal: new AbortController().signal});
const descriptor = extra => Object.freeze({url: `https://${HOST}/v1/ops/observation/traces/offline-42`,
  method: 'GET', body: '', headers: Object.freeze({Host: HOST, 'Content-Type': 'application/json', Accept: 'application/json'}),
  ...options(), ...extra});
const credentials = () => ({accessKey: 'SYNTHETIC_ACCESS', secretKey: SECRET});
const json = () => new Response(JSON.stringify({total: 1, span_list: [{trace_id: 'offline-42',
  duration: 12, tokens: 3, input: SECRET, output: SECRET, metadata: {private: SECRET}}]}),
{headers: {'content-type': 'application/json'}});
const safeError = code => error => {
  assert.equal(error.code, code);
  assert.ok(Object.isFrozen(error));
  assert.ok(!String(error).includes(SECRET));
  assert.ok(!JSON.stringify(error).includes(SECRET));
  return true;
};
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return {promise, resolve};
};

// Explicit Fake implements the verified official constructor/Sign interface.
// These headers exercise plumbing, not platform authentication or real HMAC.
function fakeSdk({construct, sign} = {}) {
  const state = {requests: [], signers: [], calls: []};
  class HttpRequest {
    constructor(method, url, headers, body) {
      const parsed = new URL(url);
      Object.assign(this, {method, host: parsed.host, uri: parsed.pathname, query: {}, headers, body});
      state.requests.push(this);
      construct?.(this);
    }
  }
  class Signer {
    constructor() {state.signers.push(this);}
    Sign(request) {
      state.calls.push({key: this.Key, secret: this.Secret, token: request.headers['X-Security-Token']});
      request.headers['X-Sdk-Date'] = '20261007T230000Z';
      const names = Object.keys(request.headers).map(name => name.toLowerCase()).sort();
      request.headers.Authorization = `SDK-HMAC-SHA256 Access=${this.Key}, SignedHeaders=${names.join(';')}, Signature=${'0'.repeat(64)}`;
      const result = {hostname: request.host, path: request.uri, method: request.method, headers: request.headers};
      return sign ? sign(request, result) : result;
    }
  }
  return {sdk: {HttpRequest, Signer}, state};
}

test('factory performs no credential lookup, signing or network and requires explicit SDK/callback', () => {
  const {sdk, state} = fakeSdk();
  let reads = 0;
  assert.equal(typeof createAgentArtsTraceAuthorizer({sdk, readCredentials: () => {reads++;}}), 'function');
  assert.equal(reads, 0); assert.equal(state.requests.length, 0); assert.equal(state.signers.length, 0);
  for (const input of [undefined, {}, {sdk}, {sdk, readCredentials: 1}, {sdk: {}, readCredentials: credentials},
    {sdk, readCredentials: credentials, credentials: SECRET}, {get sdk() {throw Error(SECRET);}, readCredentials: credentials}]) {
    assert.throws(() => createAgentArtsTraceAuthorizer(input), safeError('INVALID_ARGUMENT'));
  }
});

test('exact scope rejects alternate origins, queries, body, headers and descriptors before obtaining credentials', async () => {
  const {sdk, state} = fakeSdk();
  let reads = 0;
  const authorize = createAgentArtsTraceAuthorizer({sdk, readCredentials: () => {reads++; return credentials();}});
  const changes = [{url: 'https://other.example/v1/ops/observation/traces/offline-42'},
    {url: `https://${HOST}/v1/ops/observation/traces/offline-42?resource_id=other`},
    {url: `https://${HOST}/v1/ops/observation/traces/%2Fsecret`}, {method: 'POST'}, {body: SECRET},
    {headers: {Host: HOST, 'Content-Type': 'application/json', Accept: 'application/json', Authorization: SECRET}},
    {headers: {Host: 'other.example', 'Content-Type': 'application/json', Accept: 'application/json'}},
    {headers: {host: HOST, 'Content-Type': 'application/json', Accept: 'application/json'}},
    {deadline: '2026-02-30T00:00:00Z'}, {signal: {}}, {unknown: SECRET}];
  for (const change of changes) await assert.rejects(authorize(descriptor(change)), safeError('INVALID_ARGUMENT'));
  let getterReads = 0;
  await assert.rejects(authorize({...descriptor(), get url() {getterReads++; throw Error(SECRET);}}), safeError('INVALID_ARGUMENT'));
  const controller = new AbortController(); controller.abort(SECRET);
  await assert.rejects(authorize(descriptor({signal: controller.signal})), safeError('CANCELLED'));
  await assert.rejects(authorize(descriptor({deadline: new Date(0).toISOString()})), safeError('TIMEOUT'));
  assert.equal(getterReads, 0); assert.equal(reads, 0); assert.equal(state.requests.length, 0);
});

test('unchanged reader consumes full signed GET, fresh credentials and signer per call, with optional token signed', async () => {
  const {sdk, state} = fakeSdk();
  let reads = 0, fetches = 0;
  const authorize = createAgentArtsTraceAuthorizer({sdk, readCredentials(request) {
    reads++;
    assert.ok(Object.isFrozen(request) && Object.isFrozen(request.headers));
    assert.equal(request.method, 'GET'); assert.equal(request.body, '');
    assert.equal(request.url, descriptor().url);
    return {...credentials(), accessKey: `SYNTHETIC_ACCESS_${reads}`,
      ...(reads === 2 ? {securityToken: 'SYNTHETIC_SESSION_TOKEN'} : {})};
  }});
  for (let index = 0; index < 2; index++) {
    const result = await readAgentArtsTrace({traceId: 'offline-42', ...options(), authorize,
      fetchImpl(url, init) {
        fetches++;
        assert.equal(url, descriptor().url); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
        assert.ok(Object.isFrozen(init.headers));
        assert.equal(init.headers.Host, HOST); assert.equal(init.headers.Accept, 'application/json');
        assert.equal(init.headers['Content-Type'], 'application/json');
        assert.equal(init.headers['X-Security-Token'], index ? 'SYNTHETIC_SESSION_TOKEN' : undefined);
        assert.match(init.headers.Authorization, index ? /x-security-token/ : /SignedHeaders=accept;content-type;host;x-sdk-date,/);
        return json();
      }});
    assert.equal(result.returnedSpanCount, 1); assert.ok(!JSON.stringify(result).includes(SECRET));
    assert.equal(result.cost, 'not_checked'); assert.equal(result.requestCorrelation, 'not_checked');
  }
  assert.equal(reads, 2); assert.equal(fetches, 2);
  assert.notEqual(state.signers[0], state.signers[1]); assert.notEqual(state.requests[0].headers, state.requests[1].headers);
  assert.deepEqual(state.calls.map(call => call.key), ['SYNTHETIC_ACCESS_1', 'SYNTHETIC_ACCESS_2']);
  assert.ok(state.signers.every(signer => signer.Key === '' && signer.Secret === ''));
  const original = descriptor(); await authorize(original);
  assert.ok(!Object.hasOwn(original.headers, 'Authorization'));
});

test('missing or invalid credentials and private callback failures never reach SDK or transport', async () => {
  const {sdk, state} = fakeSdk();
  for (const supplied of [undefined, null, {}, {accessKey: 'x'}, {accessKey: 'x', secretKey: SECRET, securityToken: '\r\n'},
    {accessKey: 'x', secretKey: SECRET, extra: SECRET}]) {
    const authorize = createAgentArtsTraceAuthorizer({sdk, readCredentials: () => supplied});
    await assert.rejects(authorize(descriptor()), error => {
      assert.ok(['UNAUTHORIZED', 'INVALID_ARGUMENT'].includes(error.code));
      assert.ok(!String(error).includes(SECRET)); return true;
    });
  }
  let fetches = 0, providerReads = 0;
  const error = new Proxy(new Error(SECRET), {get() {providerReads++; throw Error(SECRET);}});
  const authorize = createAgentArtsTraceAuthorizer({sdk, readCredentials: () => {throw error;}});
  await assert.rejects(authorize(descriptor()), safeError('EXTERNAL_FAILURE'));
  await assert.rejects(readAgentArtsTrace({traceId: 'offline-42', ...options(), authorize,
    fetchImpl() {fetches++;}}), safeError('EXTERNAL_FAILURE'));
  assert.equal(providerReads, 0); assert.equal(fetches, 0); assert.equal(state.requests.length, 0);
});

test('SDK constructor scope mutation is rejected before Sign and signed scope/header mutations never reach fetch', async () => {
  for (const construct of [request => {request.host = 'other.example';}, request => {request.query.resource_id = ['other'];},
    request => {request.body = SECRET;}, request => {request.headers.Accept = 'text/plain';}]) {
    const {sdk, state} = fakeSdk({construct});
    const authorize = createAgentArtsTraceAuthorizer({sdk, readCredentials: credentials});
    await assert.rejects(authorize(descriptor()), safeError('EXTERNAL_FAILURE'));
    assert.equal(state.calls.length, 0);
  }
  const changes = [(_request, result) => ({...result, path: result.path + '/'}),
    (_request, result) => ({...result, hostname: 'other.example'}), (_request, result) => ({...result, method: 'POST'}),
    (request, result) => {request.query.other = ['private']; return result;},
    (request, result) => {request.body = SECRET; return result;},
    (_request, result) => ({...result, headers: {...result.headers, Host: 'other.example'}}),
    (_request, result) => ({...result, headers: {...result.headers, host: HOST}}),
    (_request, result) => ({...result, headers: {...result.headers, 'X-Unregistered': SECRET}}),
    (_request, result) => ({...result, headers: {...result.headers, Authorization: 'Bearer ' + SECRET}}),
    (_request, result) => ({...result, headers: {...result.headers, 'X-Security-Token': 'changed'}}),
    (request, result) => {const copy = {...result, headers: {...result.headers}}; request.headers.Accept = 'text/plain'; return copy;},
    (_request, result) => ({...result, headers: {...result.headers,
      Authorization: result.headers.Authorization.replace(';x-security-token', '')}})];
  for (const sign of changes) {
    const {sdk} = fakeSdk({sign}); let fetches = 0;
    const authorize = createAgentArtsTraceAuthorizer({sdk, readCredentials: () => ({...credentials(), securityToken: 'SYNTHETIC_SESSION_TOKEN'})});
    await assert.rejects(readAgentArtsTrace({traceId: 'offline-42', ...options(), authorize,
      fetchImpl() {fetches++;}}), safeError('EXTERNAL_FAILURE'));
    assert.equal(fetches, 0);
  }
});

test('SDK failures are fixed redacted errors and a rejected signer is never reused', async () => {
  const {sdk, state} = fakeSdk({sign() {throw Error(SECRET);}});
  const authorize = createAgentArtsTraceAuthorizer({sdk, readCredentials: credentials});
  for (let index = 0; index < 2; index++) await assert.rejects(authorize(descriptor()), safeError('EXTERNAL_FAILURE'));
  assert.equal(state.signers.length, 2); assert.notEqual(state.signers[0], state.signers[1]);
  assert.ok(state.signers.every(signer => signer.Key === '' && signer.Secret === ''));
});

test('reader cancels a pending credential callback and late credentials cannot start signing or fetch', async () => {
  const {sdk, state} = fakeSdk(); const pending = deferred(), began = deferred();
  const controller = new AbortController(); let fetches = 0;
  const authorize = createAgentArtsTraceAuthorizer({sdk, readCredentials(request) {
    assert.equal(request.signal.aborted, false); began.resolve(); return pending.promise;
  }});
  const run = readAgentArtsTrace({traceId: 'offline-42', ...options(), signal: controller.signal, authorize,
    fetchImpl() {fetches++;}});
  await began.promise; controller.abort(SECRET);
  await assert.rejects(run, safeError('CANCELLED'));
  pending.resolve(credentials()); await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.requests.length, 0); assert.equal(state.calls.length, 0); assert.equal(fetches, 0);
});

test('the original absolute deadline bounds an uncooperative credential callback without a new lease', async () => {
  const {sdk, state} = fakeSdk(); const pending = deferred(), began = deferred(); let fetches = 0;
  const authorize = createAgentArtsTraceAuthorizer({sdk, readCredentials() {began.resolve(); return pending.promise;}});
  const run = readAgentArtsTrace({traceId: 'offline-42', ...options(), deadline: new Date(Date.now() + 250).toISOString(),
    authorize, fetchImpl() {fetches++;}});
  await began.promise; await assert.rejects(run, safeError('TIMEOUT'));
  pending.resolve(credentials()); await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.requests.length, 0); assert.equal(fetches, 0);
});

test('expiry or cancellation during synchronous SDK Sign rejects its result without transport', async () => {
  const originalNow = Date.now; const initial = originalNow(); let now = initial;
  Date.now = () => now;
  try {
    const {sdk} = fakeSdk({sign(_request, result) {now = initial + 11_000; return result;}});
    const authorize = createAgentArtsTraceAuthorizer({sdk, readCredentials: credentials});
    await assert.rejects(authorize(descriptor({deadline: new Date(initial + 10_000).toISOString()})), safeError('TIMEOUT'));
  } finally {Date.now = originalNow;}
  const controller = new AbortController();
  const {sdk} = fakeSdk({sign(_request, result) {controller.abort(SECRET); return result;}});
  const authorize = createAgentArtsTraceAuthorizer({sdk, readCredentials: credentials});
  await assert.rejects(authorize(descriptor({signal: controller.signal})), safeError('CANCELLED'));
});
