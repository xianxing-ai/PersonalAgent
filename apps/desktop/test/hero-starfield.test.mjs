import test from 'node:test';
import assert from 'node:assert/strict';
import {mountHeroStarfield} from '../src/features/workspace/hero-starfield.js';

test('starfield waits for visible area, coalesces resizes and releases observers and scheduled work', t => {
  const keys = ['window','document','ResizeObserver','IntersectionObserver','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout'];
  const original = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  t.after(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete globalThis[key];
      else globalThis[key] = original[key];
    }
  });
  const listeners = new Map(), frames = new Map(), timers = new Map(), created = [], disconnected = [];
  let id = 0, resize, intersect, width = 0;
  const events = name => ({
    addEventListener:(type, fn) => listeners.set(name + ':' + type, fn),
    removeEventListener:(type, fn) => { if (listeners.get(name + ':' + type) === fn) listeners.delete(name + ':' + type); },
  });
  function flush(callbacks) {
    for (const [key, fn] of Array.from(callbacks)) {
      callbacks.delete(key);
      fn();
    }
  }
  globalThis.window = {...events('window'), devicePixelRatio:1};
  globalThis.document = {...events('document'), hidden:true, createElement(tag) {
    created.push(tag);
    return {setAttribute(){}, getContext(){throw Error('No drawing without positive size and visibility');}};
  }};
  globalThis.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  globalThis.cancelAnimationFrame = key => frames.delete(key);
  globalThis.setTimeout = fn => { timers.set(++id, fn); return id; };
  globalThis.clearTimeout = key => timers.delete(key);
  globalThis.ResizeObserver = class {
    constructor(fn) { resize = fn; }
    observe() {}
    disconnect() { disconnected.push('resize'); }
  };
  globalThis.IntersectionObserver = class {
    constructor(fn) { intersect = ratio => fn([{isIntersecting:ratio > 0, intersectionRatio:ratio}]); }
    observe() {}
    disconnect() { disconnected.push('viewport'); }
  };
  const hero = {dataset:{}, prepend(){}, getBoundingClientRect:() => ({width,height:200})};
  mountHeroStarfield(hero);
  assert.equal(hero.dataset.scenePaused, 'true');
  intersect(1);
  resize();
  assert.equal(timers.size, 0, 'document hidden even when the hero intersects');
  document.hidden = false;
  listeners.get('document:visibilitychange')();
  resize();
  resize();
  assert.equal(hero.dataset.scenePaused, 'false');
  assert.equal(timers.size, 1);
  flush(timers);
  assert.equal(frames.size, 1);
  flush(frames);
  assert.deepEqual(created, ['canvas'], 'zero-size first paint does not construct animated layers');
  width = 300;
  resize();
  flush(timers);
  assert.equal(frames.size, 1);
  intersect(0);
  assert.equal(frames.size, 0, 'scrolling out cancels the pending paint');
  assert.equal(hero.dataset.scenePaused, 'true');
  resize();
  listeners.get('document:visibilitychange')();
  assert.equal(timers.size, 0, 'document visibility alone cannot resume an offscreen hero');
  intersect(1);
  assert.equal(timers.size, 1);
  document.hidden = true;
  listeners.get('document:visibilitychange')();
  assert.equal(timers.size, 0, 'hiding before first paint cancels the initial delay');
  document.hidden = false;
  listeners.get('document:visibilitychange')();
  flush(timers);
  assert.equal(frames.size, 1);
  listeners.get('window:unload')();
  assert.deepEqual(disconnected.sort(), ['resize', 'viewport']);
  assert.equal(listeners.size, 0);
  intersect(0);
  intersect(1);
  resize();
  assert.equal(hero.dataset.scenePaused, 'true');
  assert.equal(timers.size + frames.size, 0, 'stale observers cannot restart disposed work');
});
