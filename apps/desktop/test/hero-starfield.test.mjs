import test from 'node:test';
import assert from 'node:assert/strict';
import {mountHeroStarfield} from '../src/features/workspace/hero-starfield.js';

test('decorative scene coalesces resizes, cancels hidden work and releases its observer on unload', t => {
  const keys=['window','document','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout'];
  const original=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
  t.after(()=>{for(const key of keys){if(original[key]===undefined)delete globalThis[key];else globalThis[key]=original[key];}});
  const listeners=new Map(),frames=new Map(),timers=new Map();let id=0,timerId=0,resize,disconnected=false;
  const flushTimers=()=>{for(const [k,fn] of [...timers.entries()]){timers.delete(k);fn();}};
  const target=name=>({addEventListener:(event,callback)=>listeners.set(`${name}:${event}`,callback),removeEventListener:(event,callback)=>{if(listeners.get(`${name}:${event}`)===callback)listeners.delete(`${name}:${event}`);}});
  globalThis.window={...target('window'),devicePixelRatio:1};
  globalThis.document={...target('document'),hidden:true,createElement:()=>({setAttribute(){},getContext(){throw Error('Hidden or disposed scene must not paint');}})};
  globalThis.requestAnimationFrame=callback=>{frames.set(++id,callback);return id;};
  globalThis.cancelAnimationFrame=key=>frames.delete(key);
  globalThis.setTimeout=callback=>{timers.set(++timerId,callback);return timerId;};
  globalThis.clearTimeout=key=>timers.delete(key);
  globalThis.ResizeObserver=class{constructor(callback){resize=callback;}observe(){}disconnect(){disconnected=true;}};
  const hero={dataset:{},prepend(){},getBoundingClientRect:()=>({width:1000,height:250})};
  const scene=mountHeroStarfield(hero);
  try {
    resize();flushTimers();assert.equal(frames.size,0);assert.equal(hero.dataset.scenePaused,'true');
    document.hidden=false;listeners.get('document:visibilitychange')();resize();resize();flushTimers();assert.equal(frames.size,1);
    document.hidden=true;listeners.get('document:visibilitychange')();assert.equal(frames.size,0);assert.equal(timers.size,0);
    document.hidden=false;listeners.get('document:visibilitychange')();flushTimers();assert.equal(frames.size,1);
    listeners.get('window:unload')();assert.equal(disconnected,true);assert.equal(frames.size,0);assert.equal(timers.size,0);assert.equal(listeners.size,0);
    resize();flushTimers();assert.equal(frames.size,0);
  } finally {
    scene.dispose();
  }
});
