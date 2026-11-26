import test from 'node:test';
import assert from 'node:assert/strict';
import {ProtocolError} from '@personal-agent/contracts';
import {createF17ConfiguredDriverResolver} from '../dist/application/f17-configured-driver.js';
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
  await assert.rejects(f.host.authorizeReceipt({context:{...f.context(id),deadline:'2000-01-01T00:00:00.000Z'},
    result:read.confirmed.result}),{code:'TIMEOUT'});
  f.controller.abort();await assert.rejects(f.host.authorizeReceipt({context:f.context(id),result:read.confirmed.result}),{code:'CANCELLED'});
  assert.equal(f.counters.head,count);assert.equal(f.counters.command,1);
});

test('F17 invalid or out-of-order preparation timestamps cannot bind a failed reproduction',async t=>{
  const f=await fixture(t,'F17'),binding=await f.prepareF17(),key='f17:reproduction:prepared:repro';
  const saved=f.app.runtime.loadCheckpoint(f.scope.parentTaskId,key),heads=f.counters.head;
  for(const preparedAt of ['invalid','2000-01-01T00:00:00.000Z','2100-01-01T00:00:00.000Z']){
    f.app.runtime.saveCheckpoint(f.scope.parentTaskId,key,{...saved,preparedAt});
    await assert.rejects(f.ports.resolveReproduction(f.scope,{taskId:binding.command.taskId,operationId:'repro',
      arguments:{recipeId:'reproduce'}}),{code:'UNAUTHORIZED'});
  }
  assert.equal(f.counters.head,heads);assert.equal(f.counters.command,1);
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

test('F17 resolver consumes only the public binding and rejects another configuration or session',async t=>{
  const f=await fixture(t,'F17');let bound={sessionId:f.scope.sessionId,deadline:f.scope.deadline,configurationVersion:'fixture-v2'};
  const resolve=createF17ConfiguredDriverResolver({readConfiguredWorkflowBinding(request){
    assert.equal(request.workflowId,'F17');assert.equal(request.taskId,f.scope.parentTaskId);
    return request.sessionId===bound?.sessionId?bound:undefined;
  }},{configurationVersion:'fixture-v2'});
  assert.equal(resolve(f.scope),bound);
  assert.throws(()=>resolve({...f.scope,sessionId:'foreign'}),{code:'UNAUTHORIZED'});
  bound={...bound,configurationVersion:'replaced'};assert.throws(()=>resolve(f.scope),{code:'UNAUTHORIZED'});
  bound=undefined;assert.throws(()=>resolve(f.scope),{code:'UNAUTHORIZED'});
});
