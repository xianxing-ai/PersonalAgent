import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalWorkflowDecisionHost} from '../src/local-laya.mjs';
test('invalid adaptive configuration stops the already started local service',async()=>{
  let stopped=0,started=0;
  await assert.rejects(createLocalWorkflowDecisionHost({adaptive:{},startService:async()=>{
    started++;return {port:44174,key:'public-fixture',isReady:()=>true,stop:async()=>{stopped++;}};
  }}),/required/);
  assert.equal(started,1);assert.equal(stopped,1);
});
test('successful local host transfers cleanup ownership to returned stop',async()=>{
  let stopped=0;
  const host=await createLocalWorkflowDecisionHost({startService:async()=>({port:44174,key:'public-fixture',isReady:()=>true,
    device:'cpu',torchThreads:2,precision:'fp32',stop:async()=>{stopped++;}})});
  assert.equal(stopped,0);assert.equal(host.snapshot().adaptive,false);await host.stop();assert.equal(stopped,1);
});
