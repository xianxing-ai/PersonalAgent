import test from 'node:test';
import assert from 'node:assert/strict';
import {mountHuaweiSisPlayback} from '../src/app/huawei-sis-playback.js';
import {createDesktopSisPlaybackHost} from '../electron/huawei-sis-playback.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

function fixture(t, options = {}) {
  const names = ['document', 'window', 'AudioContext'];
  const original = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  t.after(() => names.forEach((name, i) => {
    if (original[i]) Object.defineProperty(globalThis, name, original[i]); else delete globalThis[name];
  }));
  const reports = [], contexts = [], listeners = new Map(), windowListeners = new Map();
  class AudioContext {
    constructor() {this.state = 'suspended'; this.destination = {}; contexts.push(this);}
    async decodeAudioData() {await options.decode?.(this); return {duration: 0};}
    async resume() {await options.resume?.(this); if (this.state !== 'closed') this.state = 'running';}
    async close() {this.closes = (this.closes ?? 0) + 1; await options.close?.(this);
      if (!options.unconfirmedClose) this.state = 'closed';}
    createBufferSource() {
      const source = {connect() {}, stop() {options.stop?.();}, disconnect() {options.disconnect?.();},
        start() {this.started = true;}};
      this.source = source; return source;
    }
  }
  const document = {hidden: false, addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => {if (listeners.get(name) === listener) listeners.delete(name);}};
  const window = {addEventListener: (name, listener) => windowListeners.set(name, listener),
    removeEventListener: (name, listener) => {if (windowListeners.get(name) === listener) windowListeners.delete(name);}};
  for (const [name, value] of Object.entries({document, window, AudioContext}))
    Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
  let handler;
  const dispose = mountHuaweiSisPlayback({onCommand(value) {handler = value; return () => {};},
    report(value) {reports.push(value); options.onReport?.(value);}});
  const tick = () => new Promise(resolve => setImmediate(resolve));
  return {reports, contexts, listeners, windowListeners, document, dispose, tick,
    async command(value) {handler(value); await tick();}};
}

test('a source disconnect failure cannot prevent context close, audio clearing or completion receipt', async t => {
  const f = fixture(t, {disconnect() {throw Error('synthetic disconnect failure');}});
  const audio = Uint8Array.of(1, 2, 3, 4);
  await f.command({type: 'start', id: 'one', audio});
  f.contexts[0].source.onended(); await f.tick();
  assert.equal(f.contexts[0].state, 'closed');
  assert.deepEqual([...audio], [0, 0, 0, 0]);
  assert.deepEqual(f.reports.at(-1), {type: 'completed', id: 'one'});
});

for (const mode of ['reject', 'unconfirmed']) test(`SIS ${mode} context close cannot report completion or permit another device`, async t => {
  const f = fixture(t, mode === 'reject' ? {close() {throw Error('synthetic close failure');}} : {unconfirmedClose: true});
  await f.command({type: 'start', id: 'one', audio: Uint8Array.of(1, 2)});
  f.contexts[0].source.onended(); await f.tick();
  assert.deepEqual(f.reports.at(-1), {type: 'release_failed', id: 'one'});
  await f.command({type: 'start', id: 'two', audio: Uint8Array.of(1, 2)});
  assert.equal(f.contexts.length, 1);
  assert.equal(f.reports.some(value => value.type === 'completed'), false);
});

test('concurrent stop retains device ownership, zeros audio and emits one confirmed stopped receipt', async t => {
  const closing = deferred();
  const f = fixture(t, {close: () => closing.promise});
  const audio = Uint8Array.of(1, 2);
  await f.command({type: 'start', id: 'one', audio});
  await f.command({type: 'stop', id: 'one'}); await f.command({type: 'stop', id: 'one'});
  await f.command({type: 'start', id: 'two', audio: Uint8Array.of(1, 2)});
  assert.equal(f.contexts.length, 1);
  assert.deepEqual([...audio], [0, 0]);
  assert.equal(f.reports.some(value => value.type === 'stopped'), false);
  closing.resolve(); await f.tick();
  assert.equal(f.contexts[0].closes, 1);
  assert.equal(f.reports.filter(value => value.type === 'stopped').length, 1);
});

test('stop during decode discards late results and cannot start a stale source in the next generation', async t => {
  const decoding = deferred();
  const f = fixture(t, {decode: context => context === f.contexts[0] ? decoding.promise : undefined});
  await f.command({type: 'start', id: 'one', audio: Uint8Array.of(1, 2)});
  await f.command({type: 'stop', id: 'one'});
  await f.command({type: 'start', id: 'two', audio: Uint8Array.of(1, 2)});
  decoding.resolve(); await f.tick();
  assert.equal(f.contexts[0].source, undefined);
  assert.equal(f.contexts[1].source.started, true);
  await f.command({type: 'stop', id: 'two'});
});

test('SIS disposal removes page handlers and cannot reopen through queued commands', async t => {
  const f = fixture(t);
  await f.command({type: 'start', id: 'one', audio: Uint8Array.of(1, 2)});
  f.dispose(); await f.tick();
  assert.equal(f.listeners.size, 0); assert.equal(f.windowListeners.size, 0);
  await f.command({type: 'start', id: 'late', audio: Uint8Array.of(1, 2)});
  assert.equal(f.contexts.length, 1);
  assert.equal(f.contexts[0].state, 'closed');
});

test('stop while decoding clears retained audio before slow device close and ignores late decode', async t => {
  const decoding = deferred(), closing = deferred();
  const f = fixture(t, {decode: () => decoding.promise, close: () => closing.promise});
  const audio = Uint8Array.of(1, 2, 3, 4);
  await f.command({type: 'start', id: 'one', audio});
  await f.command({type: 'stop', id: 'one'});
  assert.deepEqual([...audio], [0, 0, 0, 0]);
  assert.equal(f.reports.some(value => value.type === 'stopped'), false);
  closing.resolve(); decoding.resolve(); await f.tick();
  assert.equal(f.contexts[0].source, undefined);
  assert.deepEqual(f.reports.at(-1), {type: 'stopped', id: 'one'});
});

test('stop requested during completion close is reported as stopped after close confirms', async t => {
  const closing = deferred();
  const f = fixture(t, {close: () => closing.promise});
  await f.command({type: 'start', id: 'one', audio: Uint8Array.of(1, 2)});
  f.contexts[0].source.onended(); await f.tick();
  await f.command({type: 'stop', id: 'one'});
  closing.resolve(); await f.tick();
  assert.deepEqual(f.reports.at(-1), {type: 'stopped', id: 'one'});
  assert.equal(f.contexts[0].closes, 1);
});

test('existing SIS host rejects stop and subsequent playback after renderer release_failed', async t => {
  let host;
  const contents = {mainFrame: {}, isDestroyed: () => false, send: (_channel, value) => {void f.command(value);}};
  const event = {sender: contents, senderFrame: contents.mainFrame};
  const f = fixture(t, {close() {throw Error('synthetic close failure');}, onReport: value => host.receive(event, value)});
  host = createDesktopSisPlaybackHost({getPanel: () => ({webContents: contents, isDestroyed: () => false, isVisible: () => true})});
  const audio = new Uint8Array(44); audio.set([82, 73, 70, 70]); audio.set([87, 65, 86, 69], 8);
  const request = {audio, deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal};
  const playback = host.playWav(request); const rejection = assert.rejects(playback.result, /未能确认完成/);
  await f.tick();
  await assert.rejects(playback.stop(), /释放未确认/); await rejection;
  assert.throws(() => host.playWav(request), /尚未释放/);
  await assert.rejects(host.dispose(), /释放未确认/);
});
