import test from 'node:test';
import assert from 'node:assert/strict';
import {mountLiveVoicePlayback} from '../src/app/live-voice-playback.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

function fixture(options = {}) {
  const reports = [], contexts = [];
  let command;
  class AudioContext {
    constructor() {this.state = 'suspended'; this.currentTime = 0; this.destination = {}; contexts.push(this);}
    async resume() {await options.resume?.(this); if (this.state !== 'closed') this.state = 'running';}
    async close() {this.closes = (this.closes ?? 0) + 1; await options.close?.(this); this.state = 'closed';}
    createBuffer(_channels, size, rate) {return {duration: size / rate, getChannelData: () => new Float32Array(size)};}
    createBufferSource() {
      const source = {connect() {}, disconnect() {options.disconnect?.();}, start() {}, stop() {options.stop?.();}};
      this.source = source; return source;
    }
  }
  const dispose = mountLiveVoicePlayback({onCommand(handler) {command = handler; return () => {};},
    report(value) {reports.push(value);}}, AudioContext);
  return {reports, contexts, dispose, command: value => command(value)};
}

test('failed device readiness releases its context and does not wedge a later session', async () => {
  let fail = true;
  const f = fixture({resume() {if (fail) throw Error('synthetic device failure');}});
  await f.command({type: 'start', token: 'first'});
  assert.equal(f.contexts[0].state, 'closed');
  assert.equal(f.contexts[0].closes, 1);
  assert.ok(f.reports.some(value => value.token === 'first' && value.type === 'error'));
  fail = false;
  await f.command({type: 'start', token: 'next'});
  assert.ok(f.reports.some(value => value.token === 'next' && value.type === 'ready'));
  await f.command({type: 'stop', token: 'next'});
});

test('stop retains exclusive device ownership until close settles and deduplicates release', async () => {
  const closing = deferred();
  const f = fixture({close: () => closing.promise});
  await f.command({type: 'start', token: 'first'});
  const stopping = f.command({type: 'stop', token: 'first'});
  const repeated = f.command({type: 'stop', token: 'first'});
  await f.command({type: 'start', token: 'overlap'});
  assert.equal(f.contexts.length, 1, 'a closing context must exclude a second device');
  assert.equal(f.reports.some(value => value.type === 'stopped'), false);
  closing.resolve(); await Promise.all([stopping, repeated]);
  assert.equal(f.contexts[0].closes, 1);
  assert.equal(f.reports.filter(value => value.type === 'stopped' && value.token === 'first').length, 1);
});

test('source cleanup errors cannot prevent device close and confirmed release', async () => {
  const f = fixture({stop() {throw Error('synthetic stop failure');}, disconnect() {throw Error('synthetic disconnect failure');}});
  await f.command({type: 'start', token: 'first'});
  await f.command({type: 'audio', token: 'first', data: Uint8Array.of(0, 0)});
  await f.command({type: 'stop', token: 'first'});
  assert.equal(f.contexts[0].state, 'closed');
  assert.equal(f.reports.at(-1).type, 'stopped');
});

test('an unconfirmed device release never reports stopped and blocks unsafe restart', async () => {
  const f = fixture({close() {throw Error('synthetic close failure');}});
  await f.command({type: 'start', token: 'first'});
  await f.command({type: 'stop', token: 'first'});
  await f.command({type: 'start', token: 'next'});
  assert.equal(f.contexts.length, 1);
  assert.equal(f.reports.some(value => value.type === 'stopped'), false);
});

test('late resume after stop cannot report readiness or affect the next generation', async () => {
  const resuming = deferred();
  const f = fixture({resume: context => context === f.contexts[0] ? resuming.promise : undefined});
  const starting = f.command({type: 'start', token: 'first'});
  await f.command({type: 'stop', token: 'first'});
  await f.command({type: 'start', token: 'next'});
  resuming.reject(Error('synthetic late failure')); await starting;
  assert.equal(f.reports.some(value => value.token === 'first' && value.type === 'ready'), false);
  assert.equal(f.contexts[1].state, 'running');
  await f.command({type: 'stop', token: 'next'});
});

test('late source callbacks and audio arriving during close cannot report a completed turn', async () => {
  const closing = deferred();
  const f = fixture({close: () => closing.promise});
  await f.command({type: 'start', token: 'first'});
  await f.command({type: 'audio', token: 'first', data: Uint8Array.of(0, 0)});
  const lateEnded = f.contexts[0].source.onended;
  await f.command({type: 'drain', token: 'first'});
  const stopping = f.command({type: 'stop', token: 'first'});
  lateEnded();
  await f.command({type: 'audio', token: 'first', data: Uint8Array.of(0, 0)});
  assert.equal(f.reports.some(value => value.type === 'drained'), false);
  closing.resolve(); await stopping;
});

test('disposed output ignores queued commands and closes the owned device once', async () => {
  const f = fixture();
  await f.command({type: 'start', token: 'first'});
  f.dispose(); await new Promise(resolve => setImmediate(resolve));
  await f.command({type: 'start', token: 'late'});
  assert.equal(f.contexts.length, 1);
  assert.equal(f.contexts[0].closes, 1);
  assert.equal(f.contexts[0].state, 'closed');
});
