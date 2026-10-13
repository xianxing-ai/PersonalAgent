import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPcmKeywordWakeSignalSource, WakeLifecycleController} from '../dist/index.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const frame = sequence => ({
  sequence,
  data: new Uint8Array([1, 0]),
  format: {encoding: 'pcm_s16le', sampleRateHz: 16_000, channels: 1},
});

function setup({captureReady = deferred(), detectorReady = deferred(), releaseFailure = false} = {}) {
  const captureClosed = deferred();
  const detectorClosed = deferred();
  const events = [];
  const accepted = [];
  let captureOptions;
  let detectorOptions;
  let unsubscribes = 0;
  let stops = 0;
  const pcm = {
    subscribe(options) {
      captureOptions = options;
      return {
        ready: captureReady.promise,
        closed: captureClosed.promise,
        unsubscribe() {
          unsubscribes++;
          if (releaseFailure) captureClosed.reject(new Error('private host release detail'));
          else captureClosed.resolve();
        },
      };
    },
  };
  const detector = {
    start(options) {
      detectorOptions = options;
      return {
        ready: detectorReady.promise,
        closed: detectorClosed.promise,
        accept(value) { accepted.push(value); },
        stop() { stops++; detectorClosed.resolve({reason: 'stopped', detections: 0}); },
      };
    },
  };
  const source = createPcmKeywordWakeSignalSource(pcm, detector);
  return {
    source, events, accepted, captureReady, detectorReady,
    get captureOptions() { return captureOptions; },
    get detectorOptions() { return detectorOptions; },
    get unsubscribes() { return unsubscribes; },
    get stops() { return stops; },
  };
}

test('requires detector and capture readiness before listening and drops early or late detections', async () => {
  const host = setup();
  const abort = new AbortController();
  let settled = false;
  const pending = host.source.subscribe(event => host.events.push(event), {
    signal: abort.signal, deadlineAtMs: Date.now() + 5_000,
  }).then(value => { settled = true; return value; });

  await tick();
  assert.equal(host.captureOptions, undefined);
  host.detectorOptions.onDetected();
  assert.deepEqual(host.events, []);
  host.detectorReady.resolve();
  await tick();
  assert.ok(host.captureOptions);
  assert.equal(settled, false);
  host.captureOptions.onFrame(frame(0));
  assert.equal(host.accepted.length, 1);
  host.detectorOptions.onDetected();
  assert.deepEqual(host.events, []);

  host.captureReady.resolve();
  const subscription = await pending;
  host.detectorOptions.onDetected();
  assert.deepEqual(host.events, [{kind: 'wake'}]);
  subscription.unsubscribe();
  await subscription.closed;
  host.detectorOptions.onDetected();
  host.captureOptions.onFrame(frame(1));
  assert.deepEqual(host.events, [{kind: 'wake'}]);
  assert.equal(host.accepted.length, 1);
  assert.equal(host.unsubscribes, 1);
  assert.equal(host.stops, 1);
});

test('missing capture ready fails closed and never publishes lifecycle listening', async () => {
  const pcm = {
    subscribe() {
      return {closed: Promise.resolve(), unsubscribe() { unsubscribes++; }};
    },
  };
  let unsubscribes = 0;
  let stops = 0;
  const detectorClosed = deferred();
  const detector = {start: () => ({
    ready: Promise.resolve(), closed: detectorClosed.promise,
    accept() {}, stop() { stops++; detectorClosed.resolve({reason: 'stopped'}); },
  })};
  const source = createPcmKeywordWakeSignalSource(pcm, detector);
  const states = [];
  const controller = new WakeLifecycleController({
    authorization: {check: async () => ({
      kind: 'allowed', expiresAtMs: Date.now() + 5_000,
      revocationSignal: new AbortController().signal,
    })},
    source,
    onWake: () => assert.fail('wake must not be delivered'),
  });
  controller.subscribeLifecycle(value => states.push(value.state));
  assert.deepEqual(await controller.enable({deadlineAtMs: Date.now() + 5_000}), {
    kind: 'not_listening', reason: 'source_unavailable',
  });
  assert.deepEqual(states, ['disabled']);
  assert.equal(unsubscribes, 1);
  assert.equal(stops, 1);
  controller.dispose();
});

test('cancellation while capture ready is pending releases both handles and ignores late ready', async () => {
  const host = setup({detectorReady: {promise: Promise.resolve()}});
  const abort = new AbortController();
  const pending = host.source.subscribe(event => host.events.push(event), {
    signal: abort.signal, deadlineAtMs: Date.now() + 5_000,
  });
  await tick();
  assert.ok(host.captureOptions);
  abort.abort();
  await assert.rejects(pending, /Wake PCM source unavailable/);
  host.captureReady.resolve();
  await tick();
  host.detectorOptions.onDetected();
  assert.deepEqual(host.events, []);
  assert.equal(host.unsubscribes, 1);
  assert.equal(host.stops, 1);
});

test('reentrant cancellation inside capture subscribe releases its late handle', async () => {
  const abort = new AbortController();
  const captureClosed = deferred();
  const detectorClosed = deferred();
  let unsubscribes = 0;
  let stops = 0;
  const source = createPcmKeywordWakeSignalSource({
    subscribe() {
      abort.abort();
      return {
        ready: new Promise(() => {}), closed: captureClosed.promise,
        unsubscribe() { unsubscribes++; captureClosed.resolve(); },
      };
    },
  }, {
    start: () => ({
      ready: Promise.resolve(), closed: detectorClosed.promise,
      accept() {}, stop() { stops++; detectorClosed.resolve({reason: 'stopped'}); },
    }),
  });
  await assert.rejects(source.subscribe(() => {}, {
    signal: abort.signal, deadlineAtMs: Date.now() + 5_000,
  }), /Wake PCM source unavailable/);
  await tick();
  assert.equal(unsubscribes, 1);
  assert.equal(stops, 1);
});

test('release failure rejects closed with a fixed error', async () => {
  const host = setup({
    captureReady: {promise: Promise.resolve()},
    detectorReady: {promise: Promise.resolve()},
    releaseFailure: true,
  });
  const subscription = await host.source.subscribe(() => {}, {
    signal: new AbortController().signal, deadlineAtMs: Date.now() + 5_000,
  });
  subscription.unsubscribe();
  await assert.rejects(subscription.closed, error => {
    assert.equal(error.message, 'Wake source release failed');
    assert.equal(error.message.includes('private host'), false);
    return true;
  });
});

for (const readiness of ['detector', 'capture']) {
  test(`expiry while ${readiness} readiness is pending fails closed before a delayed timer`, async t => {
    let currentMs = 1_000;
    t.mock.method(Date, 'now', () => currentMs);
    const host = setup();
    const abort = new AbortController();
    const pending = host.source.subscribe(event => host.events.push(event), {
      signal: abort.signal, deadlineAtMs: 1_500,
    });
    if (readiness === 'capture') {
      host.detectorReady.resolve();
      await tick();
      assert.ok(host.captureOptions);
    }
    currentMs = 2_000;
    host[`${readiness}Ready`].resolve();
    await assert.rejects(pending, {message: 'Wake PCM source unavailable'});
    await tick();

    assert.equal(host.stops, 1);
    assert.equal(host.unsubscribes, readiness === 'capture' ? 1 : 0);
    if (readiness === 'detector') assert.equal(host.captureOptions, undefined);
    assert.deepEqual(host.events, [{kind: 'error'}]);
    host.detectorOptions.onDetected();
    host.captureOptions?.onFrame(frame(0));
    abort.abort();
    await tick();
    assert.deepEqual(host.accepted, []);
    assert.deepEqual(host.events, [{kind: 'error'}]);
    assert.equal(host.stops, 1);
    assert.equal(host.unsubscribes, readiness === 'capture' ? 1 : 0);
  });
}

for (const callback of ['frame', 'detection']) {
  test(`a ${callback} at expiry stops listening before a delayed timer and releases once`, async t => {
    let currentMs = 1_000;
    t.mock.method(Date, 'now', () => currentMs);
    const host = setup({
      captureReady: {promise: Promise.resolve()},
      detectorReady: {promise: Promise.resolve()},
    });
    const subscription = await host.source.subscribe(event => host.events.push(event), {
      signal: new AbortController().signal, deadlineAtMs: 1_500,
    });
    currentMs = 1_500;
    if (callback === 'frame') host.captureOptions.onFrame(frame(0));
    else host.detectorOptions.onDetected();
    await subscription.closed;
    assert.deepEqual(host.accepted, []);
    assert.deepEqual(host.events, [{kind: 'error'}]);
    assert.equal(host.stops, 1);
    assert.equal(host.unsubscribes, 1);

    host.captureOptions.onFrame(frame(0));
    host.detectorOptions.onDetected();
    subscription.unsubscribe();
    await subscription.closed;
    assert.deepEqual(host.accepted, []);
    assert.deepEqual(host.events, [{kind: 'error'}]);
    assert.equal(host.stops, 1);
    assert.equal(host.unsubscribes, 1);
  });
}
