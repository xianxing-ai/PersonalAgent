import test from 'node:test';
import assert from 'node:assert/strict';
import {Orb, breathSample, orbMotionKind} from '../src/features/orb/orb.js';
import {pcmLevel} from '../electron/audio-level.js';

test('breath moves close, far, close, then closer, and brightness follows', () => {
  const close = breathSample(0.18);
  const far = breathSample(0.42);
  const again = breathSample(0.66);
  const closest = breathSample(0.86);
  assert.ok(close.radius < 0.8);
  assert.ok(far.radius > 1.25);
  assert.ok(again.radius < 0.9 && again.radius > closest.radius);
  assert.ok(closest.radius < 0.6);
  assert.ok(close.bright > far.bright);
  assert.ok(closest.bright > far.bright);
  assert.equal(orbMotionKind({state: 'idle'}), 'earth');
  assert.equal(orbMotionKind({state: 'listening'}), 'voice');
  assert.equal(orbMotionKind({state: 'thinking'}), 'breath');
  assert.equal(orbMotionKind({state: 'executing'}), 'breath');
  assert.equal(orbMotionKind({state: 'idle', breathActive: true}), 'breath');
  assert.equal(orbMotionKind({state: 'listening', breathActive: true}), 'breath');
  assert.equal(orbMotionKind({state: 'error', breathActive: true}), 'collapse');
});

test('pcm loudness stays inside 0..1', () => {
  assert.equal(pcmLevel(new Uint8Array(320)), 0);
  assert.equal(pcmLevel(Uint8Array.of(1)), 0);
  const loud = new Uint8Array(400);
  const view = new DataView(loud.buffer);
  for (let i = 0; i < 200; i++) view.setInt16(i * 2, i % 2 ? 12000 : -12000, true);
  assert.equal(pcmLevel(loud), 1);
});

test('reduced motion ignores click gestures and does not replay them after motion resumes', () => {
  const orb = Object.assign(Object.create(Orb.prototype), {
    state: 'idle', time: 10, running: true, calm: false, mix: 1, breathUntil: null,
    stop() { this.running = false; }, start() { this.running = true; }, _draw() {},
  });
  orb.setCalm(true);
  orb.playBreath(3.2);
  assert.equal(orb._kind(), 'earth');
  assert.equal(orb.running, false);
  orb.setCalm(false);
  assert.equal(orb._kind(), 'earth');
  assert.equal(orb.running, true);
  orb.playBreath(3.2);
  assert.equal(orb._kind(), 'breath');
  orb.time += 3.2;
  assert.equal(orb._kind(), 'earth');
});

test('turning on reduced motion cancels a current click gesture before resuming', () => {
  const orb = Object.assign(Object.create(Orb.prototype), {
    state: 'listening', time: 10, running: true, calm: false, mix: 1, breathUntil: null,
    stop() { this.running = false; }, start() { this.running = true; }, _draw() {},
  });
  orb.playBreath();
  assert.equal(orb._kind(), 'breath');
  orb.setCalm(true);
  assert.equal(orb._kind(), 'voice');
  orb.setCalm(false);
  assert.equal(orb._kind(), 'voice');
});

test('stopping a hidden orb expires the click gesture without changing its task state', () => {
  for (const state of ['idle', 'listening', 'executing', 'waiting']) {
    const orb = Object.assign(Object.create(Orb.prototype), {
      state, time: 10, running: true, calm: false, mix: 1, breathUntil: null,
      _raf: null, _draw() {}, start() { this.running = true; },
    });
    orb.playBreath();
    orb.stop();
    assert.equal(orb.running, false);
    assert.equal(orb.breathUntil, null);
    orb.start();
    assert.equal(orb.state, state);
    assert.equal(orb._kind(), orbMotionKind({state}));
  }
});
