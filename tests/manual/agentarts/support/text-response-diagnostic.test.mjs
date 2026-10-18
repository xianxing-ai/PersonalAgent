import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AgentArtsCloudAgentPort} from '../../../../packages/coordination/dist/index.js';
import {createTextDiagnosticFetch, inspectTextResponse} from './text-response-diagnostic.mjs';

const encode = text => new TextEncoder().encode(text);
const message = (text, index = 0) => ({event: 'message', data: {text, index}});
const events = [
  {event: 'workflow_start', data: {workflow_name: 'private-workflow-A'}},
  message('private-A'), {event: 'workflow_end', data: {answer: 'private-answer-A'}},
  {event: 'workflow_start', data: {workflow_name: 'private-workflow-B'}},
  message('private-B'), {event: 'workflow_end', data: {answer: 'private-answer-B'}},
  {event: 'task_end'}, {event: 'end'},
];

test('exact built parser replay distinguishes global/workflow conflicts without content', () => {
  const result = inspectTextResponse(encode(JSON.stringify(events)), 'application/json');
  assert.equal(result.parserOutcome, 'accepted');
  assert.equal(result.structure.globalIndexConflicts, 1);
  assert.equal(result.structure.workflowIndexConflicts, 0);
  assert.equal(result.resultCharacters, 'private-answer-B'.length);
  assert.match(result.parserSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('private'), false);

  const conflict = [...events.slice(0, 2), message('private-conflict'), ...events.slice(2)];
  const rejected = inspectTextResponse(encode(JSON.stringify(conflict)), 'application/json');
  assert.equal(rejected.parserOutcome, 'rejected');
  assert.equal(rejected.rejection, 'index_conflict');
  assert.equal(rejected.structure.workflowIndexConflicts, 1);
});

test('standard multiline SSE is replayed exactly and counters declare incomplete inspection', () => {
  const body = 'data: {"event":"message",\n' + 'data: "data":{"text":"private-output"}}\n\n';
  const result = inspectTextResponse(encode(body), 'text/event-stream');
  assert.equal(result.parserOutcome, 'accepted');
  assert.equal(result.structure.framing, 'not_fully_inspected');
  assert.equal(JSON.stringify(result).includes('private-output'), false);
});

test('diagnostic reports allowlisted parser reasons and bounded invalid encoding', () => {
  for (const [body, reason] of [
    [JSON.stringify([{event: 'error', data: {message: 'private-error'}}]), 'provider_failure'],
    [JSON.stringify([{event: 'workflow_start'}, {event: 'workflow_end', data: {answer: 'private-partial'}}]), 'no_final_text'],
    [JSON.stringify(message({private: 'value'})), 'message_type'],
  ]) {
    const result = inspectTextResponse(encode(body), 'application/json');
    assert.equal(result.rejection, reason);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
  assert.deepEqual(inspectTextResponse(new Uint8Array(1024 * 1024 + 1), 'application/json'), {outcome: 'inspection_limit'});
  assert.deepEqual(inspectTextResponse(new Uint8Array([255]), 'application/json'), {outcome: 'invalid_utf8'});
});

test('fetch observation retains production acceptance/rejection and never reissues network I/O', async () => {
  for (const [body, succeeds] of [[events, true], [[...events.slice(0, 2), message('different')], false]]) {
    let calls = 0;
    const diagnostic = createTextDiagnosticFetch(async () => {
      calls++;
      return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}});
    });
    const cloud = new AgentArtsCloudAgentPort({gatewayUrl: 'https://agentarts.example.test', runtimeName: 'synthetic'},
      {read: async () => 'Bearer private-token'}, diagnostic.fetch);
    const run = cloud.invoke({taskId: 'private-id', revision: 1, goal: 'synthetic',
      deadline: new Date(Date.now() + 5000).toISOString(), signal: new AbortController().signal});
    if (succeeds) assert.equal((await run).text, 'private-answer-B');
    else await assert.rejects(run, {code: 'EXTERNAL_FAILURE'});
    const report = diagnostic.snapshot();
    assert.equal(calls, 1);
    assert.equal(report.networkCalls, 1);
    assert.equal(report.bodyOutcome, 'complete');
    assert.equal(report.diagnostic.parserOutcome, succeeds ? 'accepted' : 'rejected');
    assert.equal(JSON.stringify(report).includes('private'), false);
    report.status = 0;
    assert.equal(diagnostic.snapshot().status, 200);
  }
});

test('configured completion replay matches the actual text and proposal ports', async () => {
  for (const responseMode of ['text', 'tool-proposal-json']) {
    for (const terminated of [false, true]) {
      const frames = [message(JSON.stringify({kind: 'text', text: 'private-mode-response'}))];
      if (terminated) frames.push({event: 'task_end'}, {event: 'end'});
      const body = frames.map(frame => 'data: '+JSON.stringify(frame)+'\n\n').join('');
      let calls = 0;
      const diagnostic = createTextDiagnosticFetch(async () => {
        calls++;
        return new Response(body, {headers: {'content-type': 'text/event-stream'}});
      }, responseMode === 'tool-proposal-json');
      const cloud = new AgentArtsCloudAgentPort({gatewayUrl: 'https://synthetic.example.test', runtimeName: 'synthetic', responseMode},
        {read: async () => 'Bearer private-token'}, diagnostic.fetch);
      const run = cloud.invoke({taskId: 'synthetic-mode-probe', revision: 1, goal: 'synthetic',
        deadline: new Date(Date.now() + 5000).toISOString(), signal: new AbortController().signal});
      const accepted = responseMode === 'text' || terminated;
      if (accepted) assert.equal((await run).kind, 'text');
      else await assert.rejects(run, {code: 'EXTERNAL_FAILURE'});
      const report = diagnostic.snapshot();
      assert.equal(calls, 1);
      assert.equal(report.networkCalls, 1);
      assert.equal(report.diagnostic.parserOutcome, accepted ? 'accepted' : 'rejected');
      if (!accepted) assert.equal(report.diagnostic.rejection, 'workflow_order');
      assert.equal(JSON.stringify(report).includes('private'), false);
    }
  }
});

test('terminal order rejections retain the known producer reason in manual replay', async () => {
  const frames = [message(JSON.stringify({kind: 'text', text: 'private-terminal-response'})),
    {event: 'task_end'}, {event: 'end'}];
  const frame = value => 'data: ' + JSON.stringify(value) + '\n\n';
  for (const body of [
    frame(frames[0]) + frame(frames[1]) + frame(frames[0]) + frame(frames[2]),
    frames.map(frame).join('') + 'data: [DONE]\n\n' + frame(frames[0]),
  ]) {
    let calls = 0, producerDiagnostic;
    const diagnostic = createTextDiagnosticFetch(async () => {
      calls++;
      return new Response(body, {headers: {'content-type': 'text/event-stream'}});
    }, true);
    const cloud = new AgentArtsCloudAgentPort({gatewayUrl: 'https://synthetic.example.test',
      runtimeName: 'synthetic', responseMode: 'tool-proposal-json'},
      {read: async () => 'Bearer private-token'}, diagnostic.fetch, undefined, undefined,
      value => {producerDiagnostic = value;});
    await assert.rejects(cloud.invoke({taskId: 'synthetic-terminal-probe', revision: 1,
      goal: 'synthetic', deadline: new Date(Date.now() + 5000).toISOString(),
      signal: new AbortController().signal}), {code: 'EXTERNAL_FAILURE'});
    const report = diagnostic.snapshot();
    assert.equal(calls, 1);
    assert.equal(producerDiagnostic.schemaCategory, 'event_order');
    assert.equal(report.bodyOutcome, 'complete');
    assert.equal(report.diagnostic.parserOutcome, 'rejected');
    assert.equal(report.diagnostic.rejection, 'workflow_order');
    assert.equal(JSON.stringify(report).includes('private'), false);
  }
});

test('transport details cannot appear in diagnostic reports', async () => {
  const diagnostic = createTextDiagnosticFetch(async () => { throw new Error('private transport details'); });
  await assert.rejects(diagnostic.fetch('https://example.test', {}));
  assert.deepEqual(diagnostic.snapshot(), {networkCalls: 1, bodyOutcome: 'pending', transport: 'rejected'});
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
const cloudFor = fetchImpl => new AgentArtsCloudAgentPort(
  {gatewayUrl: 'https://synthetic.example.test', runtimeName: 'synthetic'},
  {read: async () => 'Bearer synthetic-token'}, fetchImpl);
const inputFor = (signal, duration = 2000) => ({taskId: 'synthetic-diagnostic', revision: 1,
  goal: 'synthetic', deadline: new Date(Date.now() + duration).toISOString(), signal});

test('public port cancellation reaches the observed reader as directly as the original response', async () => {
  for (const observed of [false, true]) {
    const ready = deferred();
    let cancels = 0;
    const stream = new ReadableStream({pull() { ready.resolve(); }, cancel() { cancels++; }}, {highWaterMark: 0});
    const fetchImpl = async () => ({status: 200, headers: new Headers(), body: stream});
    const diagnostic = observed ? createTextDiagnosticFetch(fetchImpl) : undefined;
    const caller = new AbortController();
    const outcome = cloudFor(diagnostic?.fetch ?? fetchImpl).invoke(inputFor(caller.signal)).catch(error => error);
    await Promise.race([ready.promise, outcome]);
    caller.abort();
    assert.equal((await outcome).code, 'CANCELLED');
    assert.equal(cancels, 1);
    assert.equal(stream.locked, false);
    if (observed) assert.deepEqual(diagnostic.snapshot(), {networkCalls: 1, bodyOutcome: 'interrupted', status: 200});
  }
});

test('noncooperative reads receive immediate cancel on caller cancellation or the original deadline', async () => {
  for (const code of ['CANCELLED', 'TIMEOUT']) {
    const ready = deferred(), read = deferred();
    let cancels = 0, releases = 0;
    const diagnostic = createTextDiagnosticFetch(async () => ({status: 200, headers: new Headers(), body: {
      getReader: () => ({read() { ready.resolve(); return read.promise; },
        cancel() { cancels++; return new Promise(() => {}); },
        releaseLock() { releases++; throw new Error('private-release-canary'); }}),
    }}));
    const caller = new AbortController();
    const outcome = cloudFor(diagnostic.fetch).invoke(inputFor(caller.signal, code === 'TIMEOUT' ? 120 : 2000)).catch(error => error);
    await Promise.race([ready.promise, outcome]);
    if (code === 'CANCELLED') caller.abort();
    const error = await outcome;
    assert.equal(error.code, code);
    assert.equal(error.message.includes('private'), false);
    assert.equal(cancels, 1);
    assert.equal(releases, 1);
    assert.deepEqual(diagnostic.snapshot(), {networkCalls: 1, bodyOutcome: 'interrupted', status: 200});
    read.reject(new Error('private-late-read-canary'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(diagnostic.snapshot().bodyOutcome, 'interrupted');
    assert.equal(JSON.stringify(diagnostic.snapshot()).includes('private'), false);
  }
});

test('early stop cancels once without waiting for a read and late completion cannot diagnose the body', async () => {
  const pending = deferred();
  let cancels = 0;
  const diagnostic = createTextDiagnosticFetch(async () => ({status: 200, headers: new Headers(), body: {
    getReader: () => ({read: () => pending.promise, cancel() { cancels++; }, releaseLock() {}}),
  }}));
  const response = await diagnostic.fetch('https://synthetic.example.test', {});
  const reader = response.body.getReader();
  const reading = reader.read();
  reader.releaseLock();
  assert.equal(cancels, 1);
  assert.equal(diagnostic.snapshot().bodyOutcome, 'interrupted');
  await reader.cancel();
  assert.equal(cancels, 1);
  pending.resolve({done: true});
  await reading;
  assert.deepEqual(diagnostic.snapshot(), {networkCalls: 1, bodyOutcome: 'interrupted', status: 200});
});

test('old response completion and transport failure cannot overwrite a newer request snapshot', async () => {
  for (const oldStage of ['body', 'transport']) {
    const late = deferred();
    let calls = 0, reader;
    const diagnostic = createTextDiagnosticFetch(async () => {
      if (++calls === 1) {
        if (oldStage === 'transport') return late.promise;
        return {status: 201, headers: new Headers(), body: {getReader: () => ({
          read: () => late.promise, cancel() {}, releaseLock() {},
        })}};
      }
      return new Response(JSON.stringify(message('private-new-response')), {headers: {'content-type': 'application/json'}});
    });
    let old;
    if (oldStage === 'transport') old = diagnostic.fetch('https://synthetic.example.test', {}).catch(error => error);
    else {
      reader = (await diagnostic.fetch('https://synthetic.example.test', {})).body.getReader();
      old = reader.read();
      await reader.cancel();
      reader.releaseLock();
    }
    assert.equal((await cloudFor(diagnostic.fetch).invoke(inputFor(new AbortController().signal))).text, 'private-new-response');
    const current = diagnostic.snapshot();
    assert.equal(current.networkCalls, 2);
    assert.equal(current.bodyOutcome, 'complete');
    assert.equal(current.diagnostic.parserOutcome, 'accepted');
    if (oldStage === 'transport') late.reject(new Error('private-old-transport'));
    else late.resolve({done: true});
    await old;
    assert.deepEqual(diagnostic.snapshot(), current);
    assert.equal(JSON.stringify(current).includes('private'), false);
  }
});
