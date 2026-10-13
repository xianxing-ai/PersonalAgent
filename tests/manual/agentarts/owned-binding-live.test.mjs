import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {ProtocolError} from '@personal-agent/contracts';
import {getOwnedBindings, OwnedAgentOrchestrator} from '@personal-agent/agentarts';
import {FakeModelProvider} from '@personal-agent/models';
import {FakeCloudAgentPort} from '@personal-agent/coordination/testing';
import {SyntheticWebSocket} from '../../../packages/coordination/test/fixtures/websocket.mjs';
import {CASES, REPAIR_QUERY, createCaseDiagnostics, createLiveTransport, createReceiptWriter, main, normalizeDeadline, parseOptions, runAcceptance, selectCases, validateCatalog,
  validateConfiguration} from './owned-binding-live.mjs';

const goalId = 'b'.repeat(64), planId = 'a'.repeat(64), otherId = 'c'.repeat(64);
const ref = (id, revision = 1) => ({id, revision});
const world = {reportVersion: '1.1', revision: 7, observed_facts: [
  {node: ref(goalId), fact: '14点准备', confidence: 'explicit'},
  {node: ref(goalId, 2), fact: '16点准备', confidence: 'explicit'},
], changed_facts: [{previous: ref(goalId), current: ref(goalId, 2), change: '目标时间变化'}],
affected_items: [{kind: 'plan_step', node: ref(planId), impact: 'direct', reason: '目标时间变化'}],
missing_information: [], recommended_disposition: 'REVISE', summary: '只改准备时间'};
const plan = {reportVersion: '1.1', base_revision: 7, disposition: 'REVISE',
  preserved_steps: [{node: ref(otherId), reason: '其他工作不受影响'}], rechecked_steps: [],
  revised_steps: [{node: ref(planId), replacement: '16点准备', reason: '目标时间变化'}], removed_steps: [],
  dependency_updates: [{node: ref(planId), dependencies: [ref(goalId, 2)], reason: '使用新目标版本'}],
  evidence_required: ['本地Policy、CAS及执行读回'], missing_information: [], local_next_actions: []};
const candidate = {kind: 'repair_candidate', candidateVersion: '1.0', candidate: {expectedGraphRevision: 7,
  changes: [{node: ref(planId), summary: '16点准备', reason: '目标时间变化', dependencies: [ref(goalId, 2)]}]}};
const answer = {kind: 'text', text: 'synthetic private-output marker never saved'};
const catalog = () => ({bindingVersion: '1.0.0', verification: 'unverified', bindings: getOwnedBindings()});
const deadline = () => new Date(Date.now() + 30_000).toISOString();
const config = {gatewayUrl: 'https://synthetic.cn-southwest-2.huaweicloud-agentarts.com', runtimeName: 'synthetic',
  inboundAuthorization: 'Bearer synthetic-platform-secret', wssToken: 'synthetic-inner-token-private-at-least-32'};
function core() {
  const outputs = {world, plan, review: candidate, fast: answer};
  return new OwnedAgentOrchestrator(Object.fromEntries(Object.entries(outputs).map(([role, value]) => [role,
    new FakeModelProvider(Array.from({length: 16}, () => ({kind: 'final', text: JSON.stringify(value)})))])), 2048);
}
function fake({mutate = value => value, discover = async () => catalog()} = {}) {
  const orchestrator = core(), envelopes = []; let closed = 0;
  const port = new FakeCloudAgentPort(async request => {
    const input = JSON.parse(request.goal); envelopes.push(input);
    const control = {query: input.query, deadline: request.deadline, signal: request.signal,
      sessionId: 'synthetic', requestId: String(request.revision)};
    const result = input.type === 'workflow'
      ? await orchestrator.invokeWorkflow({...control, workflowId: input.id, world: input.world, plan: input.plan})
      : await orchestrator.invokeController({...control, controllerId: input.id});
    return JSON.stringify(mutate(result, input));
  });
  port.close = () => closed++;
  return {port, discover, envelopes, get closed() { return closed; }};
}
async function offlineCli(t, transport, fs, group = 'ordinary') {
  const root = fileURLToPath(new URL('../../../.cache/owned-binding-live-tests/', import.meta.url));
  await mkdir(root, {recursive: true});
  const directory = await mkdtemp(path.join(root, 'receipt-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  let text = '', exitCode, receiptPath;
  await main(['--live', '--group', group, '--deadline', deadline(), '--out', directory],
    Readable.from([JSON.stringify(config)]), {transportFactory: () => transport,
      receiptWriterFactory: file => { receiptPath = file; return createReceiptWriter(file, fs); },
      output: {write(value) { text += value; }}, setExitCode(value) { exitCode = value; }});
  return {receipt: JSON.parse(text), text, exitCode, receiptPath};
}

test('final rename failure preserves tmp and prints the terminal receipt without replay or a saved claim', async t => {
  for (const discoveryFailed of [false, true]) {
    const h = fake(discoveryFailed ? {discover: async () => { throw new Error('synthetic discovery failure'); }} : {});
    let writes = 0, renames = 0;
    const actual = await offlineCli(t, h, {
      writeFileImpl: async (...args) => { writes++; return writeFile(...args); },
      renameImpl: async (from, to) => {
        renames++;
        const value = JSON.parse(await readFile(from, 'utf8'));
        if (value.status !== 'running') throw Object.assign(new Error(config.wssToken),
          {code: 'EPERM', path: 'synthetic-private-path', dest: config.inboundAuthorization});
        return rename(from, to);
      },
    }, discoveryFailed ? 'all' : 'ordinary');
    assert.equal(actual.exitCode, 1); assert.equal(actual.receipt.status, 'failed');
    assert.equal(actual.receipt.evidence, 'mock');
    assert.equal(actual.receipt.cases.length, discoveryFailed ? 11 : 2);
    assert.equal(actual.receipt.cases.every(row => row.status === (discoveryFailed ? 'skipped' : 'passed')), true);
    assert.ok(Number.isFinite(Date.parse(actual.receipt.finishedAt)));
    assert.deepEqual(actual.receipt.persistence, {status: 'failed', stage: 'rename', errno: 'EPERM'});
    assert.equal(h.port.requests.length, discoveryFailed ? 0 : 2);
    assert.equal(writes, discoveryFailed ? 13 : 4); assert.equal(renames, writes);
    const disk = JSON.parse(await readFile(actual.receiptPath, 'utf8'));
    const tmp = JSON.parse(await readFile(actual.receiptPath + '.tmp', 'utf8'));
    assert.equal(disk.status, 'running');
    assert.equal(tmp.status, discoveryFailed ? 'failed' : 'passed');
    assert.deepEqual(tmp.cases, actual.receipt.cases);
    for (const secret of [config.wssToken, config.inboundAuthorization, 'synthetic-private-path', actual.receiptPath, 'saved']) {
      assert.equal(actual.text.includes(secret), false);
    }
  }
});

test('a partial write failure stops remaining bindings and preserves the partial tmp with content-free diagnostics', async t => {
  const h = fake(); let writes = 0, renames = 0;
  const actual = await offlineCli(t, h, {
    writeFileImpl: async (file, value) => {
      writes++;
      if (writes === 2) {
        await writeFile(file, 'synthetic-partial-body');
        throw Object.assign(new Error('synthetic-private-write-path'), {code: 'ENOSPC'});
      }
      return writeFile(file, value);
    },
    renameImpl: async (...args) => { renames++; return rename(...args); },
  });
  assert.equal(actual.exitCode, 1); assert.equal(actual.receipt.status, 'failed');
  assert.deepEqual(actual.receipt.persistence, {status: 'failed', stage: 'write', errno: 'ENOSPC'});
  assert.equal(h.port.requests.length, 1); assert.equal(writes, 2); assert.equal(renames, 1);
  assert.equal(actual.receipt.cases[0].status, 'passed');
  assert.equal((JSON.parse(await readFile(actual.receiptPath, 'utf8'))).cases.length, 0);
  assert.equal(await readFile(actual.receiptPath + '.tmp', 'utf8'), 'synthetic-partial-body');
  assert.equal(actual.text.includes('synthetic-partial-body'), false);
  assert.equal(actual.text.includes('synthetic-private-write-path'), false);
});

test('unrecognized filesystem codes are UNKNOWN and an initial write failure invokes no binding', async () => {
  const h = fake(); let writes = 0, renames = 0;
  const writer = createReceiptWriter('unused-synthetic-path', {
    writeFileImpl: async () => { writes++; throw Object.assign(Error(config.wssToken), {code: config.inboundAuthorization}); },
    renameImpl: async () => { renames++; },
  });
  const result = await runAcceptance({...h, deadline: deadline(), onProgress: writer});
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.persistence, {status: 'failed', stage: 'write', errno: 'UNKNOWN'});
  assert.equal(h.port.requests.length, 0); assert.equal(writes, 1); assert.equal(renames, 0);
  assert.equal(JSON.stringify(result).includes(config.wssToken), false);
  assert.equal(JSON.stringify(result).includes(config.inboundAuthorization), false);
});

test('repair fixture changes one plan and preserves unrelated context', () => {
  const payload = JSON.parse(REPAIR_QUERY.slice(REPAIR_QUERY.indexOf('{')));
  assert.deepEqual(payload.repairContext.targets, [
    {node: ref(planId), summary: '14点准备', requestedDependencies: [ref(goalId, 2)]},
  ]);
  assert.ok(payload.nodes.some(item => item.id === otherId && item.kind === 'plan'
    && item.summary === '其他工作'));
});

test('selection is exact, ordered and explicitly includes review prerequisites', () => {
  assert.deepEqual(selectCases({bindings: [CASES[6].id]}).map(item => [item.key, item.prerequisite]),
    [['world', true], ['plan_1', true], ['review_1', false]]);
  assert.equal(selectCases().length, 11);
  assert.throws(() => selectCases({bindings: ['not-a-binding']}), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => parseOptions(['--live', '--group', 'all']), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => parseOptions(['--plan', '--live']), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => parseOptions(['--live', '--token', 'secret']), {code: 'INVALID_ARGUMENT'});
  assert.equal(parseOptions(['--plan', '--group', 'ordinary']).plan, true);
});
test('all 11 bindings pass actual core with Fake transport; reports are passed exactly and receipts are content-free', async () => {
  const h = fake(), snapshots = [];
  const result = await runAcceptance({...h, deadline: deadline(), onProgress: async value => snapshots.push(value)});
  assert.equal(result.status, 'passed'); assert.equal(result.evidence, 'mock');
  assert.equal(result.cases.filter(item => item.type === 'workflow').length, 8);
  assert.equal(result.cases.filter(item => item.type === 'controller').length, 3);
  assert.equal(result.toolExecutions, 0); assert.equal(result.executionAuthorized, false);
  assert.equal(h.port.requests.length, 11); assert.equal(h.closed, 1);
  assert.equal(new Set(h.port.requests.map(item => item.deadline)).size, 1);
  const review = h.envelopes.find(item => item.id === CASES[5].id);
  assert.deepEqual(review.world, world); assert.deepEqual(review.plan, plan);
  assert.equal(result.cases.find(item => item.case === 'world').kind, 'role_report');
  assert.equal(result.cases.find(item => item.case === 'deterministic').applicationKind, 'text');
  assert.equal(JSON.stringify(snapshots).includes(answer.text), false);
  assert.equal(JSON.stringify(snapshots).includes(goalId), false);
});
test('cancelled binding discovery is recorded as CANCELLED and invokes no bindings', async () => {
  const controller = new AbortController();
  const h = fake({discover: async signal => {
    assert.equal(signal, controller.signal);
    controller.abort();
    throw Object.assign(new Error('synthetic cancelled request'), {code: 'ECONNRESET'});
  }});
  const result = await runAcceptance({...h, deadline: deadline(), signal: controller.signal});
  assert.deepEqual(result.discovery, {status: 'failed', errorCode: 'CANCELLED'});
  assert.equal(result.cases.every(row => row.status === 'skipped'), true);
  assert.equal(h.port.requests.length, 0);
  assert.equal(h.closed, 1);
});
test('catalog identity, duplicate or requirements drift stops every invocation', async () => {
  for (const change of [value => value.bindings.pop(), value => value.bindings[0].id = value.bindings[1].id,
    value => value.bindings[0].requirements = []]) {
    const bad = catalog(); change(bad);
    assert.throws(() => validateCatalog(bad), {code: 'CATALOG_MISMATCH'});
    const h = fake({discover: async () => bad});
    const result = await runAcceptance({...h, deadline: deadline()});
    assert.equal(result.status, 'failed'); assert.equal(h.port.requests.length, 0);
    assert.ok(result.cases.every(item => item.status === 'skipped'));
    assert.equal(h.closed, 1);
  }
});
test('versionless or out-of-scope reports cannot reach plan/review; independent bindings still run once', async () => {
  for (const change of [value => delete value.reportVersion,
    value => value.affected_items[0].node.id = 'd'.repeat(64)]) {
    const h = fake({mutate: value => {if (value.result.role === 'world') change(value.result.value); return value;}});
    const result = await runAcceptance({...h, deadline: deadline()});
    assert.equal(result.cases.find(item => item.case === 'world').status, 'failed');
    assert.equal(result.cases.find(item => item.case === 'plan').status, 'skipped');
    assert.equal(result.cases.find(item => item.case === 'review').status, 'skipped');
    assert.equal(result.cases.find(item => item.case === 'controller_mvp').status, 'passed');
    assert.equal(h.port.requests.length, 7);
  }
});
test('review substitution is rejected by the same core validator; one failed review does not retry', async () => {
  const h = fake({mutate: (value, input) => {
    if (input.id === CASES[5].id) value.result.value.candidate.changes[0].reason = 'substituted private reason';
    return value;
  }});
  const result = await runAcceptance({...h, deadline: deadline(), selection: selectCases({bindings: [CASES[5].id]})});
  assert.equal(result.cases.at(-1).status, 'failed'); assert.equal(h.port.requests.length, 3);
  assert.equal(JSON.stringify(result).includes('private reason'), false);
});
test('KEEP is not misreported as a positive repair result and prevents dependent calls', async () => {
  const h = fake({mutate: value => {
    if (value.result.role === 'world') {
      value.result.value.recommended_disposition = 'KEEP'; value.result.value.affected_items = [];
    }
    return value;
  }});
  const result = await runAcceptance({...h, deadline: deadline(), selection: selectCases({bindings: [CASES[5].id]})});
  assert.equal(result.cases[0].errorCode, 'EXPECTED_REVISE');
  assert.equal(result.cases[1].errorCode, 'DEPENDENCY_FAILED'); assert.equal(h.port.requests.length, 1);
});
test('errors are allowlisted; foreign messages, codes, credentials and response bodies are never saved', async () => {
  const h = fake();
  h.port.invoke = async () => { throw Object.assign(Error(config.wssToken), {code: config.inboundAuthorization}); };
  const result = await runAcceptance({...h, deadline: deadline(), selection: selectCases({group: 'ordinary'})});
  assert.ok(result.cases.every(item => item.errorCode === 'EXTERNAL_FAILURE'));
  assert.equal(JSON.stringify(result).includes(config.wssToken), false);
  assert.equal(JSON.stringify(result).includes(config.inboundAuthorization), false);
});
test('expired deadline and cancellation stop discovery and invocation, with no extra attempts', async () => {
  for (const cancelled of [false, true]) {
    let discoveries = 0; const h = fake({discover: async () => {discoveries++; return catalog();}});
    const controller = new AbortController(); if (cancelled) controller.abort();
    const result = await runAcceptance({...h, deadline: cancelled ? deadline() : new Date(0).toISOString(), signal: controller.signal});
    assert.equal(result.discovery.errorCode, cancelled ? 'CANCELLED' : 'TIMEOUT');
    assert.equal(discoveries, 0); assert.equal(h.port.requests.length, 0);
  }
});
test('configuration rejects header injection and credential redirects before network construction', () => {
  for (const changes of [{gatewayUrl: 'https://evil.example'}, {gatewayUrl: config.gatewayUrl + '/redirect'},
    {inboundAuthorization: 'Bearer secret\r\nInjected: secret'}, {wssToken: 'short'}, {runtimeName: '../other'}]) {
    assert.throws(() => validateConfiguration({...config, ...changes}), {code: 'INVALID_ARGUMENT'});
  }
});
test('discovery diagnoses network, HTTP, body and JSON failures without retry or sensitive output', async () => {
  const sensitive = config.wssToken + config.inboundAuthorization + config.gatewayUrl;
  const scenarios = [
    [async () => { throw Object.assign(Error(sensitive), {cause: {code: 'UND_ERR_CONNECT_TIMEOUT', message: sensitive}}); },
      {phase: 'network', errno: 'UND_ERR_CONNECT_TIMEOUT'}],
    [async () => { throw Object.assign(Error(sensitive), {code: sensitive, cause: {code: sensitive}}); }, {phase: 'network'}],
    [async () => ({status: 403, body: {cancel: async () => { throw Error(sensitive); }}}),
      {phase: 'http', httpStatus: 403}, 'UNAUTHORIZED'],
    [async () => new Response(sensitive, {status: 503}), {phase: 'http', httpStatus: 503}],
    [async () => ({status: sensitive}), {phase: 'http'}],
    [async () => new Response(new ReadableStream({start(controller) {
      controller.error(Object.assign(Error(sensitive), {code: 'ECONNRESET'}));
    }})), {phase: 'body', httpStatus: 200, errno: 'ECONNRESET'}],
    [async () => new Response('x'.repeat(64_001)), {phase: 'body', httpStatus: 200}, 'INVALID_ARGUMENT'],
    [async () => new Response(sensitive), {phase: 'json', httpStatus: 200}],
  ];
  for (const [fetchImpl, diagnostic, errorCode = 'EXTERNAL_FAILURE'] of scenarios) {
    let gets = 0, sockets = 0;
    const transport = createLiveTransport(config, new AbortController().signal, {
      fetchImpl: async (...args) => { gets++; return fetchImpl(...args); },
      socketFactory: () => { sockets++; throw Error('unexpected invoke'); },
    });
    const receipt = await runAcceptance({...transport, deadline: deadline()});
    assert.deepEqual(receipt.discovery, {status: 'failed', errorCode, ...diagnostic});
    assert.equal(receipt.status, 'failed'); assert.equal(receipt.cases.every(row => row.status === 'skipped'), true);
    assert.equal(gets, 1); assert.equal(sockets, 0); assert.equal(receipt.retries, 0);
    for (const secret of [config.wssToken, config.inboundAuthorization, config.gatewayUrl]) {
      assert.equal(JSON.stringify(receipt).includes(secret), false);
    }
  }
});

test('generic injected discovery errors cannot supply receipt diagnostics', async () => {
  const h = fake({discover: async () => { throw Object.assign(Error(config.wssToken),
    {code: 'EXTERNAL_FAILURE', diagnostic: {phase: 'network', errno: 'ECONNRESET', httpStatus: 503},
      phase: config.wssToken, httpStatus: 200, errno: config.inboundAuthorization}); }});
  const receipt = await runAcceptance({...h, deadline: deadline()});
  assert.deepEqual(receipt.discovery, {status: 'failed', errorCode: 'EXTERNAL_FAILURE'});
  assert.equal(h.port.requests.length, 0);
});

test('real public WSS adapter consumes binding wrappers over existing FakeSocket; GET is discovery only', async () => {
  const sockets = [], calls = [], responses = fake();
  const transport = createLiveTransport(config, new AbortController().signal, {
    fetchImpl: async (url, init) => {
      calls.push({url, init}); return new Response(JSON.stringify(catalog()));
    },
    socketFactory: (url, options) => {
      assert.equal(url, config.gatewayUrl.replace('https:', 'wss:') + '/runtimes/synthetic/invocations/ws');
      assert.equal(options.rejectUnauthorized, true); assert.equal(options.followRedirects, false);
      const socket = new SyntheticWebSocket((frame, peer) => {
        if (frame.type !== 'invoke') return;
        peer.accepted(frame);
        responses.port.invoke({taskId: 'synthetic', revision: sockets.length, goal: frame.payload.query,
          deadline: frame.deadline, signal: new AbortController().signal})
          .then(result => peer.result(frame, result.text), () => peer.disconnect());
      }); sockets.push(socket); return socket;
    },
  });
  const result = await runAcceptance({...transport, deadline: deadline()});
  assert.equal(result.status, 'passed'); assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.redirect, 'error'); assert.ok(calls[0].init.headers['X-Hw-Agentarts-Session-Id']);
  assert.equal(sockets.length, 1); assert.equal(sockets[0].sent.filter(item => item.type === 'invoke').length, 11);
  assert.equal(sockets[0].terminations, 1);
});
test('post-send disconnect stays RESULT_UNKNOWN with no retry, HTTPS fallback, or leaked receipt', async () => {
  let invokes = 0, gets = 0;
  const transport = createLiveTransport(config, new AbortController().signal, {
    fetchImpl: async () => {gets++; return new Response(JSON.stringify(catalog()));},
    socketFactory: () => new SyntheticWebSocket((frame, socket) => {
      if (frame.type === 'invoke') { invokes++; socket.accepted(frame); socket.disconnect(); }
    }),
  });
  const result = await runAcceptance({...transport, deadline: deadline(), selection: selectCases({bindings: [CASES[0].id]})});
  assert.equal(result.cases[0].errorCode, 'RESULT_UNKNOWN'); assert.equal(invokes, 1); assert.equal(gets, 1);
  assert.equal(Object.hasOwn(result.cases[0], 'payloadDigest'), false);
});
test('PowerShell seven-digit deadline is normalized before the real public port; raw form fails before socket creation', async () => {
  assert.equal(normalizeDeadline('2026-10-13T01:49:46.0528240Z'), '2026-10-13T01:49:46.052Z');
  assert.throws(() => normalizeDeadline('not-a-date'), {code: 'INVALID_ARGUMENT'});
  const canonical = deadline(), powershell = canonical.replace(/(\.\d{3})Z$/, (_match, millis) => millis + '8240Z');
  assert.equal(parseOptions(['--live', '--deadline', powershell]).deadline, canonical);
  const sockets = [], calls = [], responses = fake();
  const transport = createLiveTransport(config, new AbortController().signal, {
    fetchImpl: async (url, init) => { calls.push({url, init}); return new Response(JSON.stringify(catalog())); },
    socketFactory: () => {
      const socket = new SyntheticWebSocket((frame, peer) => {
        if (frame.type !== 'invoke') return;
        assert.equal(frame.deadline, canonical);
        peer.accepted(frame);
        responses.port.invoke({taskId: 'synthetic', revision: 1, goal: frame.payload.query,
          deadline: frame.deadline, signal: new AbortController().signal})
          .then(result => peer.result(frame, result.text), () => peer.disconnect());
      }); sockets.push(socket); return socket;
    },
  });
  try {
    await assert.rejects(transport.port.invoke({taskId: 'synthetic', revision: 1, goal: 'probe',
      deadline: powershell, signal: new AbortController().signal}), {code: 'INVALID_ARGUMENT'});
    assert.equal(sockets.length, 0); assert.equal(calls.length, 0);
    const result = await runAcceptance({...transport, deadline: powershell,
      selection: selectCases({bindings: [CASES[0].id]})});
    assert.equal(result.status, 'passed'); assert.equal(result.deadline, canonical);
    assert.equal(sockets.length, 1); assert.equal(calls.length, 1);
    assert.equal(sockets[0].sent.filter(frame => frame.type === 'invoke').length, 1);
    assert.equal(sockets[0].terminations, 1);
  } finally { transport.port.close(); }
});
test('per-case diagnostics remain isolated on one WSS session and save only allowlisted fields', async () => {
  const sockets = [], responses = fake(); let invokes = 0;
  const transport = createLiveTransport(config, new AbortController().signal, {
    fetchImpl: async () => new Response(JSON.stringify(catalog())),
    socketFactory: () => {
      const socket = new SyntheticWebSocket((frame, peer) => {
        if (frame.type !== 'invoke') return;
        invokes++; peer.accepted(frame);
        if (invokes === 1) { peer.result(frame, ''); return; } // terminal wire events, invalid application text
        responses.port.invoke({taskId: 'synthetic', revision: invokes, goal: frame.payload.query,
          deadline: frame.deadline, signal: new AbortController().signal})
          .then(result => peer.result(frame, result.text), () => peer.disconnect());
      }); sockets.push(socket); return socket;
    },
  });
  const result = await runAcceptance({...transport, deadline: deadline(), selection: selectCases({group: 'ordinary'})});
  assert.equal(sockets.length, 1); assert.equal(invokes, 2);
  const [first, second] = result.cases;
  assert.equal(first.status, 'failed'); assert.equal(second.status, 'passed');
  for (const row of result.cases) {
    assert.equal(row.dispatch, true); assert.equal(row.accepted, true); assert.equal(row.terminal, true);
    assert.match(row.requestId, /^[0-9a-f-]{36}$/i);
  }
  assert.notEqual(first.requestId, second.requestId);
  assert.equal(first.diagnostic.stage, 'response_schema'); assert.equal(first.diagnostic.schemaCategory, 'no_text');
  assert.equal(first.diagnostic.code, 'EXTERNAL_FAILURE'); assert.equal(first.diagnostic.httpStatus, 200);
  assert.equal(Object.hasOwn(second, 'diagnostic'), false);
  const probe = createCaseDiagnostics(); probe.begin('synthetic', 1);
  probe.onDiagnostic({stage: config.wssToken, schemaCategory: config.inboundAuthorization,
    code: 'EXTERNAL_FAILURE', httpStatus: '500 private', requestId: config.wssToken,
    message: config.wssToken, stack: config.wssToken, url: config.gatewayUrl});
  const sanitized = probe.finish();
  assert.deepEqual(sanitized, {dispatch: false, accepted: false, terminal: false, diagnostic: {code: 'EXTERNAL_FAILURE'}});
  assert.equal(JSON.stringify(result).includes(config.wssToken), false);
});
