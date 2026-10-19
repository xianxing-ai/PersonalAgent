import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';
import {createLiveHistoryQueue} from '../electron/live-history-queue.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

function fixture(options = {}) {
  let host, request, token;
  const commands = [];
  const contents = {mainFrame: {}, isDestroyed: () => false, send(_channel, message) {
    token = message.token; commands.push(message.type);
    if (['start', 'stop'].includes(message.type)) queueMicrotask(() => host.receive(
      {sender: contents, senderFrame: contents.mainFrame},
      {token: message.token, type: message.type === 'start' ? 'ready' : 'stopped'}));
  }};
  host = createLiveVoiceHost({
    getPanel: () => ({webContents: contents, isDestroyed: () => false, isVisible: () => true}),
    config: {snapshot: () => ({configured: true, reason: '就绪'}), current: () => ({})},
    microphoneHost: {authorize() {}, revoke: async () => {}},
    createSource: () => ({subscribe: () => ({ready: Promise.resolve(), closed: Promise.resolve(), unsubscribe() {}}), dispose: async () => {}}),
    createGateway: () => ({async connect(value) {request = value; return {sendAudio() {}, interrupt() {}, close: async () => {}};}}),
    createConsumer: () => ({}), client: {}, readContext: () => '', onTaskSubmitted() {},
    ...options,
  });
  return {host, commands, get request() {return request;}, drain() {
    host.receive({sender: contents, senderFrame: contents.mainFrame}, {token, type: 'drained'});
  }};
}

test('over twenty failed transcripts survive closing and reopening; audio continues and retry alone repairs history', async () => {
  let unavailable = true, retry;
  const saved = new Map();
  const f = fixture({
    schedule(callback) {retry = callback; return callback;}, unschedule() {},
    onTranscript(value) {if (unavailable) throw Error(); saved.set(value.id, value);},
  });
  try {
    await f.host.start();
    for (let i = 0; i < 40; i++) f.request.onEvent({type: 'transcript', role: 'user', id: `u${i}`, text: `合成轮次 ${i}`});
    assert.equal(f.host.snapshot().historyPersistence.pending, 40);
    assert.match(await f.request.onTool('read_context', {}, 'context'), /合成轮次 39/);
    f.request.onEvent({type: 'audio', data: Uint8Array.of(0, 0)});
    f.request.onEvent({type: 'turn_complete'}); f.drain();
    assert.equal(f.host.snapshot().status, 'listening');
    await f.host.stop();
    assert.equal(f.host.snapshot().historyPersistence.pending, 40);
    await f.host.start();
    assert.match(f.request.instructions, /合成轮次 39/);
    // Capture retry after startup; no new transcript is needed to repair the old ones.
    f.host.flushHistory();
    unavailable = false; retry();
    assert.equal(saved.size, 40);
    assert.equal(f.host.snapshot().historyPersistence.degraded, false);
  } finally {await f.host.dispose();}
});

test('backpressure stops once, exposes rejected count and retains all already queued records', async () => {
  const queue = createLiveHistoryQueue({maxMessages: 2});
  const f = fixture({historyQueue: queue, onTranscript() {throw Error();}});
  try {
    await f.host.start();
    for (let i = 0; i < 3; i++) f.request.onEvent({type: 'transcript', role: 'user', id: String(i), text: '合成话语'});
    await f.host.stop();
    assert.equal(queue.snapshot().pending, 2);
    assert.equal(queue.snapshot().rejected, 1);
    assert.match(f.host.snapshot().reason, /容量或标识异常/);
    assert.equal(f.host.hasActive(), false);
  } finally {await f.host.dispose();}
});

test('cancel during noncooperative status read ends the local wait and never cancels or resubmits the task', async () => {
  const reading = deferred(), calls = [];
  const f = fixture({
    client: {async call(operation) {
      calls.push(operation);
      if (operation === 'task.submit') return {taskId: 'accepted'};
      reading.resolve(); return new Promise(() => {});
    }},
    createConsumer: ({client}) => ({consume(input) {return {
      result: client.call('task.submit', {goal: input.text}).then(() => {throw Error('synthetic failure');}), stop: async () => {},
    };}}),
  });
  await f.host.start();
  const wait = f.request.onTool('request_work', {goal: 'A'}, 'a');
  const rejection = assert.rejects(wait, /synthetic failure|Live 已停止/);
  await reading.promise;
  await f.host.dispose(); await rejection;
  assert.deepEqual(calls, ['task.submit', 'task.get']);
});

test('unknown result reports reconciliation and a repeated request does not replay execution', async () => {
  let submits = 0;
  const f = fixture({
    client: {async call(operation) {
      if (operation === 'task.submit') {submits++; return {taskId: 'unknown-task'};}
      return {taskId: 'unknown-task', state: 'waiting_reconciliation'};
    }},
    createConsumer: ({client}) => ({consume(input) {return {
      result: client.call('task.submit', {goal: input.text}).then(() => {throw Error('unknown');}), stop: async () => {},
    };}}),
  });
  try {
    await f.host.start();
    for (let i = 0; i < 2; i++) assert.match(await f.request.onTool('request_work', {goal: 'A'}, 'a'), /尚未核实.*不会重复/);
    assert.equal(submits, 1);
  } finally {await f.host.dispose();}
});

test('P2 expired settled replay and read_context are rejected before accessing data', async () => {
  let clock = Date.now(), reads = 0, consumed = 0;
  const f = fixture({now: () => clock,
    readContext() {reads++; return '{}';},
    createConsumer: () => ({consume() {consumed++; return {result: Promise.resolve({replyText: '合成回答'})};}}),
  });
  try {
    await f.host.start();
    assert.equal(await f.request.onTool('request_work', {goal: 'A'}, 'a'), '合成回答');
    const before = reads;
    clock += 120 * 60_000;
    await assert.rejects(f.request.onTool('request_work', {goal: 'A'}, 'a'), /停止或到期/);
    await assert.rejects(f.request.onTool('read_context', {}, 'context'), /停止或到期/);
    assert.equal(reads, before);
    assert.equal(consumed, 1);
  } finally {await f.host.dispose();}
});

test('P2 synchronous read_context rechecks the deadline before returning the assembled context', async () => {
  let clock = Date.now(), expireDuringRead = false;
  const f = fixture({now: () => clock, readContext() {
    if (expireDuringRead) clock += 120 * 60_000;
    return '{"messages":[]}';
  }});
  try {
    await f.host.start(); expireDuringRead = true;
    await assert.rejects(f.request.onTool('read_context', {}, 'context'), /停止或到期/);
  } finally {await f.host.dispose();}
});

test('P2 task.get late result past request deadline cannot escape as a successful reply', async () => {
  let clock = Date.now();
  const reading = deferred(), status = deferred(),calls=[];
  const f = fixture({now: () => clock,
    client: {async call(operation) {
      calls.push(operation);
      if (operation === 'task.submit') return {taskId: 'accepted'};
      reading.resolve(); return status.promise;
    }},
    createConsumer: ({client}) => ({consume(input) {return {
      result: client.call('task.submit', {goal: input.text}).then(() => {throw Error('synthetic failure');}),
    };}}),
  });
  try {
    await f.host.start();
    const wait = f.request.onTool('request_work', {goal: 'A'}, 'a');
    const rejection = assert.rejects(wait, /工作等待已到期/);
    await reading.promise; clock += 120_001;
    status.resolve({taskId: 'accepted', state: 'succeeded', resultSummary: '不应外返'});
    await rejection;
    assert.equal(f.host.snapshot().status, 'listening');
    assert.deepEqual(calls,['task.submit','task.get']);
    assert.equal(f.host.snapshot().workRequests[0].taskId,'accepted');
    assert.equal(f.host.snapshot().workRequests[0].state,'awaiting_result');
  } finally {await f.host.dispose();}
});

test('Local/Synthetic late approval summary cannot escape the original work wait deadline or resubmit',async()=>{
  let clock=Date.now();const preparing=deferred(),prepared=deferred(),calls=[];
  const question={taskId:'original-pending',state:'pending',questionId:'original-question',revision:1,argumentsDigest:'a'.repeat(64),
    summary:'Synthetic current parameters',expiresAt:new Date(clock+600_000).toISOString()};
  const f=fixture({now:()=>clock,readCurrentQuestion:()=>question,
    prepareTaskApproval(){preparing.resolve();return prepared.promise;},
    client:{async call(operation){calls.push(operation);if(operation==='task.submit')return {taskId:'original-pending'};
      return {taskId:'original-pending',state:'waiting_approval'};}},
    createConsumer:({client})=>({consume(input){return {result:client.call('task.submit',{goal:input.text})
      .then(()=>{throw Error('Synthetic consumer ended before approval readback');})};}})});
  try{
    await f.host.start();const rejection=assert.rejects(f.request.onTool('request_work',{goal:'Synthetic original approval'},'approval-deadline'),/工作等待已到期/);
    await preparing.promise;clock+=120_001;prepared.resolve(question);await rejection;
    assert.deepEqual(calls,['task.submit','task.get']);assert.equal(f.host.snapshot().workRequests[0].taskId,'original-pending');
    assert.equal(f.host.snapshot().workRequests[0].state,'awaiting_result');assert.equal(f.host.snapshot().status,'listening');
  }finally{await f.host.dispose();}
});

test('P2 old generation cannot replay a completed request after the next Live starts', async () => {
  const f = fixture({createConsumer: () => ({consume: () => ({result: Promise.resolve({replyText: 'done'})})})});
  try {
    await f.host.start();
    await f.request.onTool('request_work', {goal: 'A'}, 'a');
    const old = f.request;
    await f.host.stop(); await f.host.start();
    await assert.rejects(old.onTool('request_work', {goal: 'A'}, 'a'), /停止或到期/);
    old.onEvent({type: 'transcript', id: 'late', role: 'user', text: '旧事件'});
    assert.equal(f.host.historyMessages().length, 0);
  } finally {await f.host.dispose();}
});

test('public history overlay retains IDs, honors cutoff and supports stopped-session reads without granting export', async () => {
  let clock = Date.now();
  const f = fixture({now: () => clock, onTranscript() {throw Error('synthetic disk failure');}});
  try {
    await f.host.start();
    f.request.onEvent({type: 'transcript', id: 'a', role: 'user', text: 'first'});
    const cutoff = new Date(clock).toISOString();
    clock += 1000;
    f.request.onEvent({type: 'transcript', id: 'b', role: 'assistant', text: 'second'});
    await f.host.stop();
    const overlay = f.host.historyMessages({conversationId: 'desktop-panel', cutoff,
      deadline: new Date(clock + 1000).toISOString(), signal: new AbortController().signal});
    assert.equal(overlay.length, 1); assert.equal(overlay[0].text, 'first');
    assert.ok(overlay[0].id); assert.ok(overlay[0].sessionId);
    assert.deepEqual(f.host.historyMessages({conversationId: 'desktop-workspace'}), []);
    overlay[0].text = 'mutated'; assert.equal(f.host.historyMessages()[0].text, 'first');
    assert.throws(() => f.host.historyMessages({deadline: new Date(clock).toISOString()}), /取消或到期/);
    assert.throws(() => f.host.historyMessages({signal: AbortSignal.abort()}), /取消或到期/);
  } finally {await f.host.dispose();}
});
