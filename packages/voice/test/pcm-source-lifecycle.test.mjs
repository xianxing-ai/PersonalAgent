import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createVoicePcmFrameSourcePort} from '../dist/pcm-frame-source.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
};
const turn = () => new Promise(resolve => setImmediate(resolve));

for (const failureAt of ['start', 'release']) {
  test(`unconfirmed PCM ${failureAt} prevents another attachment on the same source`, async () => {
    let starts = 0;
    const options = () => ({signal: new AbortController().signal,
      deadline: new Date(Date.now() + 10_000).toISOString(), onFrame() {}, onEnd() {}});
    const port = createVoicePcmFrameSourcePort({start() {
      starts++;
      if (failureAt === 'start') throw Error('private partial capture failure');
      return {async release() {throw Error('private release failure');}};
    }});
    const sub = port.subscribe(options());
    if (failureAt === 'start') await assert.rejects(sub.ready, {code: 'EXTERNAL_FAILURE'});
    else {await sub.ready; sub.unsubscribe();}
    await assert.rejects(sub.closed, {code: 'EXTERNAL_FAILURE'});
    assert.throws(() => port.subscribe(options()), {
      code: 'EXTERNAL_FAILURE', message: 'Voice PCM capture release failed',
    });
    assert.equal(starts, 1);
    await assert.rejects(port.dispose(), {code: 'EXTERNAL_FAILURE'});
  });
}

test('confirmed PCM release permits a new attachment before source disposal', async () => {
  let starts = 0;
  const port = createVoicePcmFrameSourcePort({start() {starts++; return {async release() {}};}});
  for (let i = 0; i < 2; i++) {
    const sub = port.subscribe({signal: new AbortController().signal,
      deadline: new Date(Date.now() + 10_000).toISOString(), onFrame() {}, onEnd() {}});
    await sub.ready;
    sub.unsubscribe();
    await sub.closed;
  }
  assert.equal(starts, 2);
  await port.dispose();
});

for (const boundary of ['ready', 'incoming', 'queued']) {
  test(`expired PCM ${boundary} cannot pass before the deadline timer runs`, async t => {
    let now = Date.now();
    const expires = now + 10_000;
    t.mock.method(Date, 'now', () => now);
    const start = deferred();
    const frameGate = deferred();
    let sink;
    let releases = 0;
    const events = [];
    const frames = [];
    const handle = {release() { releases++; }};
    const port = createVoicePcmFrameSourcePort({start(value) {
      sink = value;
      return boundary === 'ready' ? start.promise : handle;
    }});
    const sub = port.subscribe({signal: new AbortController().signal,
      deadline: new Date(expires).toISOString(),
      onFrame(frame) { frames.push([...frame.data]); return frameGate.promise; },
      onEnd(reason) { events.push(reason); }});
    try {
      if (boundary !== 'ready') await sub.ready;
      if (boundary === 'queued') {
        sink.onFrame(Uint8Array.of(1, 2));
        sink.onFrame(Uint8Array.of(3, 4));
      }
      now = expires;
      if (boundary === 'ready') {
        start.resolve(handle);
        await assert.rejects(sub.ready, {code: 'TIMEOUT'});
      } else if (boundary === 'incoming') sink.onFrame(Uint8Array.of(1, 2));
      else frameGate.resolve();
      await turn();
      assert.deepEqual(frames, boundary === 'queued' ? [[1, 2]] : []);
      assert.deepEqual(events, ['deadline']);
      assert.equal(releases, 1);
      await sub.closed;
    } finally {
      start.resolve(handle);
      frameGate.resolve();
      sub.unsubscribe();
      await port.dispose();
    }
  });
}

test('dispose reentered during start awaits the late release handle instead of reporting success', async () => {
  const releaseGate = deferred();
  let disposing;
  let disposeSettled = false;
  let releases = 0;
  const port = createVoicePcmFrameSourcePort({start() {
    disposing = port.dispose().then(() => { disposeSettled = true; });
    return {async release() { releases++; await releaseGate.promise; }};
  }});
  const sub = port.subscribe({signal: new AbortController().signal,
    deadline: new Date(Date.now() + 10_000).toISOString(), onFrame() {}, onEnd() {}});
  try {
    await turn();
    assert.equal(disposeSettled, false);
    assert.equal(releases, 1);
    await assert.rejects(sub.ready, {code: 'INVALID_STATE'});
    releaseGate.resolve();
    await disposing;
    await sub.closed;
    assert.equal(disposeSettled, true);
    assert.equal(releases, 1);
  } finally {
    releaseGate.resolve();
    sub.unsubscribe();
    await sub.closed;
    await disposing;
  }
});
