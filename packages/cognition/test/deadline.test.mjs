import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withCognitionDeadline} from '../dist/index.js';

test('queued work receives the submitted deadline even when the caller changes its lease', async () => {
  const lease = {signal: new AbortController().signal, deadline: new Date(Date.now() + 30_000).toISOString()};
  const submittedDeadline = lease.deadline;
  let observed;
  const pending = withCognitionDeadline(lease, async context => {observed = context.deadline; return 'completed';});
  lease.deadline = new Date(Date.now() + 60_000).toISOString();
  assert.equal(await pending, 'completed');
  assert.equal(observed, submittedDeadline);
  assert.notEqual(lease.deadline, submittedDeadline, 'Caller-owned objects remain mutable');
});

test('real-clock synchronous port crossing the deadline cannot return success before timers run',async()=>{
  const controller=new AbortController(),expiresAt=Date.now()+50;
  let timerFired=false,performed=0,portSignal;
  const timer=setTimeout(()=>{timerFired=true;},Math.max(0,expiresAt-Date.now()));
  try {
    await assert.rejects(withCognitionDeadline({deadline:new Date(expiresAt).toISOString(),signal:controller.signal},context=>{
      portSignal=context.signal;performed++;
      // Deliberately block the actual clock while both deadline timers are queued.
      while(Date.now()<=expiresAt) {}
      assert.equal(timerFired,false);
      return Promise.resolve('late success');
    }),{code:'TIMEOUT'});
    assert.equal(timerFired,false,'the synchronous return check must reject before the timer phase');
    assert.equal(portSignal.aborted,true);
    assert.equal(performed,1,'a timeout preserves the already-performed operation; it does not retry or undo it');
  } finally {clearTimeout(timer);}
});

test('cancellation queued behind operation settlement wins before the caller receives the result',async()=>{
  const controller=new AbortController();let performed=0;
  await assert.rejects(withCognitionDeadline({deadline:new Date(Date.now()+60_000).toISOString(),signal:controller.signal},()=>{
    performed++;
    // Operation adoption resolves before cancellation; its race reaction is
    // queued first. Abort still reaches the caller before the await resumes.
    queueMicrotask(()=>queueMicrotask(()=>queueMicrotask(()=>controller.abort())));
    return Promise.resolve('settled success');
  }),{code:'CANCELLED'});
  assert.equal(controller.signal.aborted,true);assert.equal(performed,1);
});
