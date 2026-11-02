import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopEgressHost} from '../electron/egress-host.js';
import {createAgentArtsTransportConfig} from '../electron/agentarts-transport-config.js';

const destination='https://example.test/runtimes/fixture/invocations';
const denied=error=>error.code==='UNAUTHORIZED';
function fixture(transport){
  let release,entered,calls=0,sends=0;
  const ready=new Promise(resolve=>{entered=resolve;}),waiting=new Promise(resolve=>{release=resolve;});
  const prepare=async()=>{calls++;entered();await waiting;};
  const host=transport?createAgentArtsTransportConfig({binding:{gatewayUrl:'https://example.test',runtimeName:'fixture'},environment:{},
    preparePayload:async scope=>{await prepare();return {assertBeforeSend(){if(!scope.isCurrent())throw Object.assign(Error('changed'),{code:'UNAUTHORIZED'});}};},
    fetchImpl:async()=>{sends++;return {status:200};}}):createDesktopEgressHost({classifyLocally:async()=>{await prepare();return 'public';}});
  const input={requestId:'concurrent-fixture',destination,payload:'{"query":"public fixture"}',
    deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal,isCurrent:()=>true};
  return {input,ready,release,prepare:scope=>transport?host.preparePayload(scope):host.prepare(scope),calls:()=>calls,sends:()=>sends,
    fetch:transport?()=>host.fetchImpl(destination,{method:'POST',redirect:'error',body:input.payload,signal:input.signal,
      headers:{'X-Request-Id':input.requestId,'X-PA-Deadline':input.deadline}}):undefined};
}

test('concurrent and sequential prepare retain every source guard in old leases and final HTTPS send',async()=>{
  for(const transport of [false,true]){
    const f=fixture(transport);let original=true,later=true;
    const first=f.prepare({...f.input,isCurrent:()=>original}),second=f.prepare({...f.input,isCurrent:()=>true});
    await f.ready;f.release();const leases=await Promise.all([first,second]);
    leases.push(await f.prepare({...f.input,isCurrent:()=>later}));assert.equal(f.calls(),1);
    original=false;
    for(const lease of leases)assert.throws(()=>lease.assertBeforeSend(f.input),denied);
    if(f.fetch)await assert.rejects(f.fetch(),denied);
    original=true;later=false;
    for(const lease of leases)assert.throws(()=>lease.assertBeforeSend(f.input),denied);
    if(f.fetch)await assert.rejects(f.fetch(),denied);
    assert.equal(f.sends(),0);
  }
});

test('an in-flight request rejects conflicting content or signal without replacing its original lease',async()=>{
  for(const transport of [false,true]){
    const f=fixture(transport),pending=f.prepare(f.input);await f.ready;
    await assert.rejects(f.prepare({...f.input,payload:'{"query":"changed fixture"}'}));
    await assert.rejects(f.prepare({...f.input,signal:new AbortController().signal}));
    f.release();const lease=await pending;lease.assertBeforeSend(f.input);
    (await f.prepare({...f.input})).assertBeforeSend(f.input);assert.equal(f.calls(),1);assert.equal(f.sends(),0);
  }
});
