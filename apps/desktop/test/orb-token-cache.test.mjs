import test from 'node:test';
import assert from 'node:assert/strict';
import {Orb} from '../src/features/orb/orb.js';

// The orb paints every animation frame. Reading CSS custom properties per frame forces a style
// recalculation at display rate, so tokens are cached and only re-read on a preference change.

function harness(t) {
  const originals = {window: globalThis.window, getComputedStyle: globalThis.getComputedStyle, ResizeObserver: globalThis.ResizeObserver, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame};
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  const gradient = () => ({addColorStop() {}});
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key === 'createRadialGradient' || key === 'createLinearGradient' || key === 'createPattern') return gradient;
      if (key in target) return target[key];
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const canvas = {width: 0, height: 0, parentElement: null, getContext: () => ctx, getBoundingClientRect: () => ({width: 200, height: 200})};
  let styleReads = 0;
  globalThis.getComputedStyle = () => {
    styleReads++;
    return {getPropertyValue: () => ''};
  };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const listeners = new Map();
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); },
  };
  return {canvas, listeners, reads: () => styleReads};
}

test('orb caches design tokens across frames and re-reads them only when preferences change', t => {
  const h = harness(t);
  const orb = new Orb(h.canvas, {variant: 'matrix', layout: 'shell', count: 24});
  orb.stop();
  assert.equal(h.reads(), 0, 'construction paints nothing while the frame loop is stubbed');

  for (let frame = 0; frame < 30; frame++) orb._draw();
  assert.equal(h.reads(), 1, 'thirty painted frames read computed style exactly once');

  h.listeners.get('preferences-changed')();
  assert.equal(h.reads(), 2, 'an idle orb repaints once from freshly read tokens');
  orb._draw();
  orb._draw();
  assert.equal(h.reads(), 2, 'the refreshed tokens are reused afterwards');

  orb.refreshTokens();
  assert.equal(h.reads(), 3);
  orb._draw();
  assert.equal(h.reads(), 3);

  orb.dispose();
  assert.equal(h.listeners.has('preferences-changed'), false, 'dispose detaches the preference listener');
});
