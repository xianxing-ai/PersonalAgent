import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import path from 'node:path';
import {startLayaService} from '../src/laya-service.mjs';

function fixture() {
  const child=new EventEmitter(), calls=[], exits=[];
  child.kill=signal=>{exits.push(signal); queueMicrotask(()=>child.emit('exit',0,signal)); return true;};
  return {child,calls,exits,spawnProcess:(...args)=>{calls.push(args); return child;}};
}
const modelPath=path.resolve('synthetic-model-only');
const warmHealth=(overrides={})=>({status:'ok',model:'multilingual',warmed:true,
  capabilities:['multi_state','independent_items'],executionPolicy:'sequential',inferenceMode:'inference_mode',...overrides});
test('one child must complete authenticated warm readiness before it is available',async()=>{
  const f=fixture();let unavailable=0, healthCalls=0;
  const service=await startLayaService({modelPath,spawnProcess:f.spawnProcess,onUnavailable:()=>unavailable++,
    request:async(url,options)=>{
      healthCalls++; assert.equal(url,'http://127.0.0.1:8000/health');
      assert.equal(options.redirect,'error'); assert.equal(options.headers.authorization,'Bearer '+f.calls[0][2].env.LAYA_API_KEY);
      return Response.json(warmHealth({warmed:healthCalls>1}));
    }});
  assert.equal(f.calls.length,1);assert.equal(healthCalls,2);assert.equal(service.isReady(),true);
  assert.equal(f.calls[0][2].windowsHide,true);assert.equal(f.calls[0][2].stdio,'ignore');
  assert.match(service.key,/^[a-f0-9]{64}$/);assert.equal(f.calls[0][2].env.HF_HUB_OFFLINE,'1');
  assert.equal(f.calls[0][2].env.PA_AGENT_MODEL_API_KEY,undefined);
  assert.equal(f.calls[0][2].env.LAYA_CPU_EXECUTION_POLICY,'sequential');assert.equal(service.cpuExecutionPolicy,'sequential');
  await service.stop();await service.stop();assert.deepEqual(f.exits,['SIGTERM']);assert.equal(service.isReady(),false);assert.equal(unavailable,0);
});
test('loaded but unwarmed or wrong-model health never becomes ready and child is stopped',async()=>{
  for(const value of [{status:'ok',model:'multilingual',warmed:false,capabilities:['multi_state']},
    {status:'ok',model:'foreign',warmed:true,capabilities:['multi_state']}]) {
    const f=fixture();await assert.rejects(startLayaService({modelPath,spawnProcess:f.spawnProcess,startupTimeoutMs:15,
      request:async()=>Response.json(value)}),/Owned Laya startup unavailable/);
    assert.deepEqual(f.exits,['SIGTERM']);
  }
});
test('unexpected Python exit invalidates readiness and notifies the host exactly once',async()=>{
  const f=fixture();let unavailable=0;
  const service=await startLayaService({modelPath,spawnProcess:f.spawnProcess,onUnavailable:()=>unavailable++,
    request:async()=>Response.json(warmHealth())});
  f.child.emit('exit',1,null);f.child.emit('error',new Error('synthetic private path'));
  assert.equal(service.isReady(),false);assert.equal(unavailable,1);await service.stop();assert.deepEqual(f.exits,[]);
});
test('startup cancellation terminates the original child without creating a replacement',async()=>{
  const f=fixture(), control=new AbortController();
  const pending=startLayaService({modelPath,spawnProcess:f.spawnProcess,signal:control.signal,
    request:async()=>{control.abort();throw new Error('synthetic cancelled fetch');}});
  await assert.rejects(pending,/Owned Laya startup unavailable/);assert.equal(f.calls.length,1);assert.deepEqual(f.exits,['SIGTERM']);
});
test('concurrent stop requests signal one original child and escalate a non-preemptible forward once',async()=>{
  const f=fixture();f.child.kill=signal=>{f.exits.push(signal);if(signal==='SIGKILL')queueMicrotask(()=>f.child.emit('exit',null,signal));return true;};
  const control=new AbortController();
  const service=await startLayaService({modelPath,spawnProcess:f.spawnProcess,shutdownTimeoutMs:10,signal:control.signal,
    request:async()=>Response.json(warmHealth())});
  control.abort();await Promise.all([service.stop(),service.stop()]);assert.deepEqual(f.exits,['SIGTERM','SIGKILL']);assert.equal(service.isReady(),false);
});

test('trusted packed policy is explicit, passed to the child and must match authenticated readback',async()=>{
  const f=fixture();const service=await startLayaService({modelPath,cpuExecutionPolicy:'packed',spawnProcess:f.spawnProcess,
    request:async()=>Response.json(warmHealth({executionPolicy:'packed'}))});
  assert.equal(f.calls[0][2].env.LAYA_CPU_EXECUTION_POLICY,'packed');assert.equal(service.cpuExecutionPolicy,'packed');await service.stop();
  for(const incompatible of [warmHealth({executionPolicy:'packed'}),warmHealth({inferenceMode:'no_grad'}),
    {status:'ok',model:'multilingual',warmed:true,capabilities:['multi_state']}]) {
    const rejected=fixture();await assert.rejects(startLayaService({modelPath,spawnProcess:rejected.spawnProcess,startupTimeoutMs:15,
      request:async()=>Response.json(incompatible)}),/Owned Laya startup unavailable/);
    assert.deepEqual(rejected.exits,['SIGTERM']);
  }
  const invalid=fixture();await assert.rejects(startLayaService({modelPath,cpuExecutionPolicy:'auto-calibrate',spawnProcess:invalid.spawnProcess}),/Invalid Laya startup/);
  assert.equal(invalid.calls.length,0);
});
