import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceStartupController, createVoiceHostListeningPort} from '../dist/index.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
const turn = () => new Promise(resolve => setImmediate(resolve));
const request = (overrides = {}) => ({enabled:true, greet:true, listen:true,
  signal:new AbortController().signal, deadline:new Date(Date.now()+60_000).toISOString(), ...overrides});

function fixture({speechResult = Promise.resolve(), speechRelease = Promise.resolve(),
  ready = Promise.resolve(), release = true, listeningRelease = Promise.resolve()} = {}) {
  const calls = [], speechRequests = [], listenRequests = [];
  const controller = createVoiceStartupController({
    output:{speak(value) {calls.push('speak'); speechRequests.push(value);return {
      result:speechResult, stop(reason) {calls.push(`speech-stop:${reason}`);return speechRelease;}};}},
    listening:{start(value) {calls.push('listen');listenRequests.push(value);return {ready,
      async stop() {calls.push('listen-stop');await listeningRelease;return {resourcesReleased:release};}};}},
  });
  return {controller,calls,speechRequests,listenRequests};
}

test('disabled settings never invoke a device, output or listener', async () => {
  const f = fixture();
  assert.equal((await f.controller.start(request({enabled:false}))).state,'disabled');
  assert.deepEqual(f.calls,[]);
  await f.controller.dispose();
});

test('startup greets once, releases output then listens; resume delegates a fresh bounded lease', async () => {
  const f = fixture(), first = request();
  try {
    assert.equal((await f.controller.start(first)).state,'listening');
    assert.deepEqual(f.calls,['speak','speech-stop:completed','listen']);
    assert.equal(f.speechRequests[0].text,'你好，PersonalAgent 已启动。');
    assert.equal(f.listenRequests[0].deadline,first.deadline);
    assert.equal(f.controller.snapshot().greeting,'completed');
    assert.equal(Object.isFrozen(f.controller.snapshot()),true);
    const next = request();
    assert.equal((await f.controller.resume(next)).state,'listening');
    assert.equal(f.listenRequests[0].signal.aborted,true);
    assert.equal(f.listenRequests[1].deadline,next.deadline);
    assert.equal(f.calls.filter(call=>call==='speak').length,1);
    await f.controller.stop();
    assert.equal(f.controller.snapshot().resourcesReleased,true);
  } finally {await f.controller.dispose();}
});

test('greeting-only startup never opens continuous audio', async () => {
  const f = fixture();
  assert.equal((await f.controller.start(request({listen:false}))).state,'stopped');
  assert.deepEqual(f.calls,['speak','speech-stop:completed']);
  await f.controller.dispose();
});

test('cancellation of non-cooperative speech result stops output once and never starts capture', async () => {
  const result = deferred(), release = deferred(), parent = new AbortController();
  const f = fixture({speechResult:result.promise,speechRelease:release.promise});
  const starting = f.controller.start(request({signal:parent.signal}));
  const rejected = assert.rejects(starting,{code:'CANCELLED'});
  parent.abort();
  assert.equal(f.controller.snapshot().state,'stopping');
  release.resolve(); await rejected;
  result.resolve(); await turn();
  assert.deepEqual(f.calls,['speak','speech-stop:cancelled']);
  assert.equal(f.controller.snapshot().resourcesReleased,true);
  await f.controller.dispose();
});

test('failed speech release latches unavailable resources and blocks restart', async () => {
  const release = deferred(), f = fixture({speechRelease:release.promise});
  const starting = f.controller.start(request()), rejected = assert.rejects(starting,{code:'EXTERNAL_FAILURE'});
  release.reject(Error('private provider credential detail'));
  await rejected;
  assert.equal(f.controller.snapshot().state,'release_unconfirmed');
  await assert.rejects(f.controller.resume(request()),{code:'EXTERNAL_FAILURE'});
  assert.deepEqual(f.calls,['speak','speech-stop:completed']);
  assert.equal(JSON.stringify(f.controller.snapshot()).includes('private'),false);
  await f.controller.dispose();
});

test('missing ports are unavailable; failed greeting with confirmed release may still listen', async () => {
  const missing = createVoiceStartupController();
  await assert.rejects(missing.start(request()),{code:'EXTERNAL_FAILURE'});
  assert.equal(missing.snapshot().state,'unavailable');
  await missing.dispose();
  const result = deferred(), f = fixture({speechResult:result.promise});
  const starting = f.controller.start(request()); result.reject(Error('offline synthesis'));
  assert.equal((await starting).state,'listening');
  assert.equal(f.controller.snapshot().greeting,'failed');
  await f.controller.dispose();
});

test('parent abort after ready stops listening and unknown release remains busy', async () => {
  const f = fixture({release:false}), parent = new AbortController();
  await f.controller.start(request({greet:false,signal:parent.signal}));
  parent.abort(); await f.controller.stop();
  assert.equal(f.controller.snapshot().state,'release_unconfirmed');
  assert.equal(f.controller.snapshot().resourcesReleased,false);
  await assert.rejects(f.controller.start(request()),{code:'EXTERNAL_FAILURE'});
  await f.controller.dispose();
});

test('cancelled startup discards late readiness and never reopens after explicit stop', async () => {
  const ready = deferred(), f = fixture({ready:ready.promise});
  const starting = f.controller.start(request({greet:false}));
  const rejected = assert.rejects(starting,{code:'CANCELLED'});
  await f.controller.stop(); await rejected;
  await f.controller.start(request({greet:false,listen:false}));
  ready.resolve(); await turn();
  assert.equal(f.controller.snapshot().state,'stopped');
  assert.equal(f.calls.filter(call=>call==='listen-stop').length,1);
  await f.controller.dispose();
});

test('expired or invalid grant never starts output or capture', async () => {
  const f = fixture();
  await assert.rejects(f.controller.start(request({deadline:new Date(Date.now()-1).toISOString()})),{code:'CANCELLED'});
  await assert.rejects(f.controller.start(request({enabled:undefined})),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(f.calls,[]); await f.controller.dispose();
});

test('deadline stops pending readiness without treating a startup request as listening', async t => {
  t.mock.timers.enable({apis:['Date','setTimeout']});
  const ready = deferred(), f = fixture({ready:ready.promise});
  const starting = f.controller.start(request({greet:false,deadline:new Date(Date.now()+30).toISOString()}));
  const rejected = assert.rejects(starting,{code:'CANCELLED'});
  t.mock.timers.tick(31); await rejected;
  assert.equal(f.controller.snapshot().state,'stopped');
  assert.deepEqual(f.calls,['listen','listen-stop']);
  ready.resolve(); await f.controller.dispose();
});

test('existing host adapter owns one original host session and never calls Runtime', async () => {
  const calls = []; let active = false;
  const host = {async start(){calls.push('start');active=true;return {status:'listening'};},
    async stop(){calls.push('stop');active=false;},hasActive:()=>active};
  const controller = createVoiceStartupController({listening:createVoiceHostListeningPort(host)});
  await controller.start(request({greet:false}));
  assert.equal(active,true);
  await controller.resume(request({greet:false}));
  await controller.stop();
  assert.deepEqual(calls,['start','stop','start','stop']);
  await controller.dispose();
});

test('host adapter cancellation before its startup microtask does not acquire or stop someone else', async () => {
  const calls = [], parent = new AbortController();
  const port = createVoiceHostListeningPort({async start(){calls.push('start');},
    async stop(){calls.push('stop');},hasActive:()=>false});
  const handle = port.start(request({signal:parent.signal}));
  parent.abort();
  await assert.rejects(handle.ready,{code:'CANCELLED'});
  assert.equal((await handle.stop()).resourcesReleased,true);
  assert.deepEqual(calls,[]);
});

test('explicit stop during resume release prevents automatic reacquisition', async () => {
  const released = deferred(), f = fixture({listeningRelease:released.promise});
  await f.controller.start(request({greet:false}));
  const resuming = f.controller.resume(request()), rejected = assert.rejects(resuming,{code:'CANCELLED'});
  const stopping = f.controller.stop();
  released.resolve(); await stopping; await rejected;
  assert.deepEqual(f.calls,['listen','listen-stop']);
  await f.controller.dispose();
});

test('host returning stopped never becomes a listening receipt', async () => {
  let stops = 0;
  const controller = createVoiceStartupController({listening:createVoiceHostListeningPort({
    async start(){return {status:'stopped'};}, async stop(){stops++;},hasActive:()=>false})});
  await assert.rejects(controller.start(request({greet:false})),{code:'EXTERNAL_FAILURE'});
  assert.equal(controller.snapshot().state,'unavailable');
  assert.equal(stops,1);await controller.dispose();
});

test('another host owner appearing before adapter startup is never stopped by this controller', async () => {
  let active = false, starts = 0, stops = 0;
  const port = createVoiceHostListeningPort({async start(){starts++;return {status:'listening'};},
    async stop(){stops++;},hasActive:()=>active});
  const handle = port.start(request());active = true;
  await assert.rejects(handle.ready,{code:'INVALID_STATE'});
  await handle.stop();assert.equal(starts,0);assert.equal(stops,0);
});
