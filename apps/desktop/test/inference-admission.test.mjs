import test from 'node:test';
import assert from 'node:assert/strict';
import {createInferenceAdmission} from '../electron/inference-admission.js';

test('bounded admission preserves FIFO, returns overload before execution and supports pressure reduction',async()=>{
  let limit=3;const queue=createInferenceAdmission({getLimit:()=>limit}),signal=new AbortController().signal;
  const release=await queue.acquire(signal),order=[];
  const pending=[1,2,3].map(index=>queue.acquire(signal).then(unlock=>{order.push(index);unlock();}));
  assert.deepEqual(queue.snapshot(),{active:1,queued:3});
  await assert.rejects(queue.acquire(signal),{code:'RATE_LIMITED'});
  limit=1;await assert.rejects(queue.acquire(signal),{code:'RATE_LIMITED'});
  release();await Promise.all(pending);assert.deepEqual(order,[1,2,3]);assert.deepEqual(queue.snapshot(),{active:0,queued:0});
});

test('cancelled waiters release their own queue storage without releasing the active inference',async()=>{
  const queue=createInferenceAdmission({getLimit:()=>2}),release=await queue.acquire(new AbortController().signal);
  for(let index=0;index<10000;index++){
    const controller=new AbortController(),waiting=queue.acquire(controller.signal),rejected=assert.rejects(waiting,{name:'AbortError'});
    controller.abort();await rejected;assert.deepEqual(queue.snapshot(),{active:1,queued:0});
  }
  release();release();assert.deepEqual(queue.snapshot(),{active:0,queued:0});
});
