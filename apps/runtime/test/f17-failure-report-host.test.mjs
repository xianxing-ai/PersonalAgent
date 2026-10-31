import test from 'node:test';
import assert from 'node:assert/strict';
import {ProtocolError} from '@personal-agent/contracts';
import {fixture} from './f16-f17-fixture.mjs';

test('F17 real failing recipe and original version become a persistent stack report through Policy/HostBridge',async t=>{
  const f=await fixture(t,'F17'),reproduction=await f.prepareF17();
  const command=f.app.readHostToolTask(reproduction.command.taskId).confirmed.result;
  assert.equal(command.exitCode,1);assert.match(command.stdout,/not ok/);
  const {localTaskId:id}=f.bridge.submit(f.original,f.proposal);await f.wait(id,['waiting_approval']);
  await f.reopen();const read=await f.approve(id);assert.equal(read.task.state,'succeeded',JSON.stringify(read.task.error));
  const result=read.confirmed.result;assert.equal(result.failureCount,1);assert.ok(result.locatedFrameCount>=1);assert.equal(result.all6PassResolved,false);
  const saved=f.app.runtime.loadCheckpoint(id,'f17:failure-report:report-op');
  assert.equal(saved.document.reproduction.headSha,f.head);assert.equal(saved.document.reproduction.recipeId,'reproduce');
  assert.equal(saved.document.reproduction.command.runId,reproduction.command.runId);
  assert.match(saved.document.failures.failures[0].frames[0].file,/failure.test.mjs/);
  await f.host.authorizeReceipt({context:f.context(id),result});assert.equal(f.bridge.readReceipt(f.original,f.proposal).state,'confirmed');
  await f.reopen();assert.equal(f.bridge.submit(f.original,f.proposal).localTaskId,id);
  await f.host.authorizeReceipt({context:f.context(id),result});assert.equal(f.counters.command,1);
});

test('F17 permission denial does not deliver a report',async t=>{
  const f=await fixture(t,'F17');await f.prepareF17();const {localTaskId:id}=f.bridge.submit(f.original,f.proposal);
  const read=await f.approve(id,'deny');assert.notEqual(read.task.state,'succeeded');
  assert.equal(f.app.runtime.loadCheckpoint(id,'f17:failure-report:report-op'),undefined);
});

test('F17 exact original command arguments, run and HEAD are required',async t=>{
  const f=await fixture(t,'F17'),binding=await f.prepareF17();
  await assert.rejects(f.ports.resolveReproduction(f.scope,{taskId:binding.command.taskId,operationId:'repro',arguments:{recipeId:'other'}}));
  await assert.rejects(f.ports.resolveReproduction(f.scope,{taskId:binding.beforeHead.taskId,operationId:'repro',arguments:{recipeId:'reproduce'}}));
  f.git('commit','--allow-empty','-qm','Changed HEAD');
  const {localTaskId:id}=f.bridge.submit(f.original,f.proposal),read=await f.approve(id);
  assert.equal(read.task.state,'waiting_reconciliation');assert.equal(f.counters.command,1);
  assert.equal(f.app.runtime.loadCheckpoint(id,'f17:failure-report:report-op'),undefined);
});

test('F17 export denial and source change while awaiting permission reject completed report receipts',async t=>{
  const f=await fixture(t,'F17'),binding=await f.prepareF17();const {localTaskId:id}=f.bridge.submit(f.original,f.proposal);
  const read=await f.approve(id);assert.equal(read.task.state,'succeeded');
  f.onExport(async()=>false);await assert.rejects(f.host.authorizeReceipt({context:f.context(id),result:read.confirmed.result}),{code:'UNAUTHORIZED'});
  f.onExport(async()=>{await new Promise(r=>setTimeout(r,1));
    const key='host-tool-intent',saved=f.app.runtime.loadCheckpoint(binding.command.taskId,key);
    f.app.runtime.saveCheckpoint(binding.command.taskId,key,{...saved,arguments:{recipeId:'other'}});return true;});
  await assert.rejects(f.host.authorizeReceipt({context:f.context(id),result:read.confirmed.result}));assert.equal(f.counters.command,1);
});

test('F17 cancelled or expired original receipt export cannot read versions or replay reproduction',async t=>{
  const f=await fixture(t,'F17');await f.prepareF17();const {localTaskId:id}=f.bridge.submit(f.original,f.proposal);
  const read=await f.approve(id);assert.equal(read.task.state,'succeeded');const count=f.counters.head;
  f.controller.abort();await assert.rejects(f.host.authorizeReceipt({context:f.context(id),result:read.confirmed.result}),{code:'CANCELLED'});
  assert.equal(f.counters.head,count);assert.equal(f.counters.command,1);
});

test('F17 unknown after report persistence is retained across SQLite restart and never replays the reproduction',async t=>{
  const f=await fixture(t,'F17');await f.prepareF17();let reads=0;
  f.onHead(async()=>{if(++reads===2)throw new ProtocolError('RESULT_UNKNOWN','Synthetic interruption after report write');});
  const {localTaskId:id}=f.bridge.submit(f.original,f.proposal),read=await f.approve(id);
  assert.equal(read.task.state,'waiting_reconciliation');assert.ok(f.app.runtime.loadCheckpoint(id,'f17:failure-report:report-op'));
  assert.equal(read.confirmed,undefined);assert.equal(f.counters.command,1);
  await f.reopen();assert.equal(f.bridge.submit(f.original,f.proposal).localTaskId,id);
  assert.equal(f.app.runtime.getTask(id).state,'waiting_reconciliation');assert.equal(f.counters.command,1);
  assert.notEqual(f.bridge.readReceipt(f.original,f.proposal)?.state,'confirmed');
  await assert.rejects(f.host.authorizeReceipt({context:f.context(id),result:{}}));
});
