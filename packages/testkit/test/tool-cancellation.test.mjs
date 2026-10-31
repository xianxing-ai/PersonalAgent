import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FakeToolHost} from '../dist/index.js';
test('running tool receives abort and timeout signals without retry',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
  const host=new FakeToolHost();
  let calls=0,signal;
  host.register({descriptor:{name:'pending',version:'1',inputSchema:{type:'object'},outputSchema:{type:'object'},sideEffect:'external_write',requiredScopes:[],idempotencySupport:false,recoverySupport:false,requiresPresence:false},
    execute:async(_input,context)=>{calls++;signal=context.signal;return new Promise(()=>{});}});
  const context={taskId:'t',runId:'r',authorizationRef:'fixture',signal:new AbortController().signal,deadline:new Date(Date.now()+30).toISOString(),scopes:[]};
  const timed=host.invoke('pending',{},context);
  assert.equal(calls,1);
  t.mock.timers.tick(30);
  await assert.rejects(timed,{code:'TIMEOUT'});
  assert.equal(signal.aborted,true);assert.equal(calls,1);
  const controller=new AbortController();
  const pending=host.invoke('pending',{}, {...context,signal:controller.signal,deadline:new Date(Date.now()+10000).toISOString()});
  controller.abort();
  await assert.rejects(pending,{code:'CANCELLED'});
  assert.equal(signal.aborted,true);assert.equal(calls,2);
});
