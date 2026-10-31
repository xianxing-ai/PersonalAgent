import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './f16-f17-fixture.mjs';
import {awaitF16Port} from '../dist/application/f16-source-receipts.js';

test('F16 original Policy child consumes confirmed CI reads and fresh workspace Git HEAD, then survives SQLite reopen',async t=>{
  const f=await fixture(t);await f.prepareF16();
  const submitted=f.bridge.submit(f.original,f.proposal),id=submitted.localTaskId;
  await f.wait(id,['waiting_approval']);assert.equal(f.counters.head,0);
  await f.reopen();
  const read=await f.approve(id);assert.equal(read.task.state,'succeeded',JSON.stringify(read.task.error));
  const result=read.confirmed.result;assert.equal(result.commitSha,f.head);assert.equal(result.errorClass,'unknown');
  assert.equal(f.counters.github,3);assert.ok(f.counters.head>=2);
  await f.host.authorizeReceipt({context:f.context(id),result});
  const receipt=f.bridge.readReceipt(f.original,f.proposal);assert.equal(receipt.state,'confirmed');
  await f.reopen();assert.equal(f.bridge.submit(f.original,f.proposal).localTaskId,id);
  await f.host.authorizeReceipt({context:f.context(id),result});assert.equal(f.counters.github,3);
});

test('F16 permission denial never reads HEAD or emits a graph success',async t=>{
  const f=await fixture(t);await f.prepareF16();const {localTaskId:id}=f.bridge.submit(f.original,f.proposal);
  const read=await f.approve(id,'deny');assert.notEqual(read.task.state,'succeeded');assert.equal(f.counters.head,0);
  assert.notEqual(f.bridge.readReceipt(f.original,f.proposal)?.state,'confirmed');
});

test('F16 source task, run input and deadline substitution cannot bind',async t=>{
  const f=await fixture(t),binding=await f.prepareF16();
  for(const change of [
    b=>{b.logRead.taskId=b.runList.taskId;},b=>{b.logRead.runId='other-run';},
    b=>{b.logRead.arguments.jobId=9;},b=>{b.logRead.scopeRef='another-grant';},
  ]){const other=structuredClone(binding);change(other);assert.throws(()=>f.ports.bindSelection(f.scope,other));}
  assert.throws(()=>f.ports.bindSelection({...f.scope,deadline:new Date(Date.now()+200000).toISOString()},binding));
  const key='coding-repair:parent',old=f.app.runtime.loadCheckpoint(binding.logRead.taskId,key);
  f.app.runtime.saveCheckpoint(binding.logRead.taskId,key,{...old,taskId:'foreign-parent'});
  await assert.rejects(f.ports.resolveFailure(f.scope),{code:'UNAUTHORIZED'});
});

test('F16 rechecks exact source after export permission await and after host completion',async t=>{
  const f=await fixture(t),binding=await f.prepareF16();const {localTaskId:id}=f.bridge.submit(f.original,f.proposal);
  const read=await f.approve(id);assert.equal(read.task.state,'succeeded');
  f.onExport(async()=>{
    await new Promise(r=>setTimeout(r,1));
    const key='tool-result-'+binding.logRead.runId,saved=f.app.runtime.loadCheckpoint(binding.logRead.taskId,key);
    f.app.runtime.saveCheckpoint(binding.logRead.taskId,key,{...saved,result:{...saved.result,text:'Substituted log'}});
    return true;
  });
  await assert.rejects(f.host.authorizeReceipt({context:f.context(id),result:read.confirmed.result}));
});

test('F16 changed HEAD is rejected through the existing workspace tool',async t=>{
  const f=await fixture(t);await f.prepareF16();f.git('commit','--allow-empty','-qm','Changed HEAD');
  const {localTaskId:id}=f.bridge.submit(f.original,f.proposal),read=await f.approve(id);
  assert.equal(read.task.state,'failed');assert.equal(read.task.error.code,'REVISION_CONFLICT');
});

test('F16 trusted waits terminate on cancellation/deadline without replaying an uncooperative port',async()=>{
  const controller=new AbortController();let calls=0;
  const scope={signal:controller.signal,deadline:new Date(Date.now()+10000).toISOString()};
  const pending=awaitF16Port(scope,()=>new Date(),()=>{calls++;return new Promise(()=>{});});
  await new Promise(r=>setTimeout(r,1));controller.abort();await assert.rejects(pending,{code:'CANCELLED'});assert.equal(calls,1);
  await assert.rejects(awaitF16Port({signal:new AbortController().signal,deadline:new Date(Date.now()+20).toISOString()},()=>new Date(),()=>new Promise(()=>{})),{code:'TIMEOUT'});
});
