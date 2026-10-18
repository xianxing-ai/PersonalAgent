import test from 'node:test';
import assert from 'node:assert/strict';
import {mountMicrophoneCapture} from '../src/app/microphone-capture.js';

function fixture(t, failure = '') {
  const reports = [], attempts = [], listeners = new Map(), windowListeners = new Map();
  const names = ['document', 'window', 'navigator', 'AudioContext', 'AudioWorkletNode'];
  const original = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  t.after(() => names.forEach((name, i) => {
    if (original[i]) Object.defineProperty(globalThis, name, original[i]); else delete globalThis[name];
  }));
  const attempt = name => {attempts.push(name); if (failure === name) throw Error('synthetic release failure');};
  const track = {readyState: 'live', addEventListener() {}, stop() {attempt('track'); this.readyState = 'ended';}};
  const stream = {getTracks: () => [track], getAudioTracks: () => [track]};
  const document = {hidden: false, addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => {if (listeners.get(name) === listener) listeners.delete(name);}};
  const window = {addEventListener: (name, listener) => windowListeners.set(name, listener),
    removeEventListener: (name, listener) => {if (windowListeners.get(name) === listener) windowListeners.delete(name);}};
  let context;
  class AudioContext {
    constructor() {context = this; this.sampleRate = 16000; this.state = 'suspended'; this.destination = {};
      this.audioWorklet = {addModule: async () => {}};}
    async resume() {this.state = 'running';}
    async close() {attempt('context'); this.state = 'closed';}
    createMediaStreamSource() {return {connect: node => node, disconnect() {attempt('source');}};}
    createGain() {return {gain: {}, connect() {}, disconnect() {attempt('gain');}};}
  }
  class AudioWorkletNode {
    constructor() {this.port = {close() {attempt('port');}};}
    connect() {return {connect() {}};}
    disconnect() {attempt('node');}
  }
  for (const [name, value] of Object.entries({document, window, navigator: {mediaDevices: {getUserMedia: async () => stream}},
    AudioContext, AudioWorkletNode})) Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
  let handler;
  const dispose = mountMicrophoneCapture({onCommand(value) {handler = value; return () => {attempts.push('unsubscribe');};},
    report(value) {reports.push(value);}});
  const tick = () => new Promise(resolve => setImmediate(resolve));
  return {reports, attempts, track, stream, listeners, windowListeners, document, dispose,
    get context() {return context;}, async command(value) {handler(value); await tick();}};
}

for (const failure of ['port', 'node', 'source', 'gain']) test(`microphone ${failure} cleanup failure still stops tracks and closes the device`, async t => {
  const f = fixture(t, failure);
  await f.command({type: 'start', token: 'one'});
  assert.equal(f.reports.at(-1).type, 'ready');
  await f.command({type: 'stop', token: 'one'});
  assert.equal(f.track.readyState, 'ended');
  assert.equal(f.context.state, 'closed');
  assert.deepEqual(f.reports.at(-1), {type: 'stopped', token: 'one', tracksStopped: true});
});

for (const failure of ['track', 'context']) test(`microphone ${failure} release failure is reported honestly and excludes restart`, async t => {
  const f = fixture(t, failure);
  await f.command({type: 'start', token: 'one'});
  await f.command({type: 'stop', token: 'one'});
  assert.ok(f.attempts.includes('context'), 'all releases must be attempted even when a track fails');
  assert.deepEqual(f.reports.at(-1), {type: 'stopped', token: 'one', tracksStopped: false});
  await f.command({type: 'start', token: 'two'});
  assert.deepEqual(f.reports.at(-1), {type: 'error', token: 'two'});
});

test('microphone disposal removes both page lifecycle listeners and releases once', async t => {
  const f = fixture(t);
  await f.command({type: 'start', token: 'one'});
  f.dispose(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.listeners.size, 0);
  assert.equal(f.windowListeners.size, 0);
  assert.equal(f.attempts.filter(name => name === 'context').length, 1);
  const count = f.reports.length;
  await f.command({type: 'start', token: 'late'});
  assert.equal(f.reports.length, count, 'a queued callback cannot reopen capture after disposal');
});

test('one failing track does not prevent other tracks or the context from closing', async t => {
  const f = fixture(t, 'track');
  const second = {readyState: 'live', stop() {this.readyState = 'ended';}};
  f.stream.getTracks = () => [f.track, second];
  await f.command({type: 'start', token: 'one'});
  await f.command({type: 'stop', token: 'one'});
  assert.equal(second.readyState, 'ended');
  assert.equal(f.context.state, 'closed');
  assert.equal(f.reports.at(-1).tracksStopped, false);
});

test('track enumeration failure still closes context and cannot claim release', async t => {
  const f = fixture(t);
  await f.command({type: 'start', token: 'one'});
  f.stream.getTracks = () => {throw Error('synthetic enumeration failure');};
  await f.command({type: 'stop', token: 'one'});
  assert.equal(f.context.state, 'closed');
  assert.equal(f.reports.at(-1).tracksStopped, false);
});

test('visibility and page exit share the same release and cannot reopen capture', async t => {
  const f = fixture(t);
  await f.command({type: 'start', token: 'one'});
  f.document.hidden = true; f.listeners.get('visibilitychange')(); f.windowListeners.get('pagehide')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.attempts.filter(name => name === 'context').length, 1);
  assert.equal(f.reports.filter(value => value.type === 'stopped').length, 1);
  assert.equal(f.track.readyState, 'ended');
});
