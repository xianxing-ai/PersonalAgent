import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFollowLock } from '../src/features/conversation/follow-lock.js';

const clock = (()=>{ let t=0; return { now:()=>t, tick:(ms)=>{ t+=ms; } }; })();

test('follow-lock: passive content growth never disables following', ()=>{
  const lock=createFollowLock({ now:clock.now });
  // Baseline: engaged at the bottom.
  assert.equal(lock.atBottom, true);
  // Layout tick pushes the bottom away (distance grows) without any scroll event.
  // The belief must remain engaged — pre-judgment reflow cannot kill follow.
  assert.equal(lock.atBottom, true);
  // A scroll event that is NOT user-driven (within the programmatic window) is ignored.
  lock.markProgrammatic();
  clock.tick(10);
  lock.onScroll(400);
  assert.equal(lock.atBottom, true);
  // After the window passes, only a genuine user scroll re-evaluates.
  clock.tick(200);
  lock.onScroll(400);
  assert.equal(lock.atBottom, false);
});

test('follow-lock: short non-scrollable thread cannot be unlocked by wheel-up', ()=>{
  const lock=createFollowLock({ now:clock.now });
  // A thread with no overflow reports distance 0; wheel-up fires no scroll event,
  // so onScroll is never called and the lock stays engaged for later growth.
  assert.equal(lock.atBottom, true);
  lock.onScroll(0);
  assert.equal(lock.atBottom, true);
});

test('follow-lock: user scroll away unlocks, returning to threshold re-arms', ()=>{
  const lock=createFollowLock({ now:clock.now });
  lock.onScroll(400);
  assert.equal(lock.atBottom, false);
  lock.onScroll(89);
  assert.equal(lock.atBottom, true);
  lock.onScroll(91);
  assert.equal(lock.atBottom, false);
  lock.onScroll(90);
  assert.equal(lock.atBottom, true);
});

test('follow-lock: conversation switch resets the belief', ()=>{
  const lock=createFollowLock({ now:clock.now });
  lock.onScroll(400);
  assert.equal(lock.atBottom, false);
  lock.reset();
  assert.equal(lock.atBottom, true);
});
