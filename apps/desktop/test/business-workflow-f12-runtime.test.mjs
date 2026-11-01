import test from 'node:test';
import assert from 'node:assert/strict';
import {validateToolValue} from '@personal-agent/contracts';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createBusinessWorkflowWorkerPorts} from '../electron/business-workflow-worker-ports.js';
import {scenario} from './fixtures/f12-runtime-scenario.mjs';

// Actual Engine/SQLite/notification CAS feed/question/Policy. OS channel, candidate
// preparation/selection, cloud transport and graph export consent are explicit fixtures.
test('F12 request, bound input and original hosts require one explicit unique selection',()=>{
  const host={getDigest(){},deliverRound(){},getInterruptionPolicy(){},getLegacyPolicy(){},drain(){}};
  const composition=createBusinessWorkflowWorkerPorts({runtimeModule,getApplication:()=>undefined,notificationHost:host,
    prepareCompetitionToolExport:async()=>{},readBusinessAvailability:()=>({ready:true,bindingId:'fixture'}),authorizeExport:async()=>true});
  const worker=composition.configuredWorkflowWorkerPorts.find(item=>item.workflowId==='F12');
  for(const selected of [{},{itemId:'one',itemIds:['two']},{itemIds:[]},{itemIds:['one','one']}]){
    assert.throws(()=>validateToolValue(worker.requestSchema,{...selected,trigger:'event'}));
    assert.throws(()=>validateToolValue(worker.inputSchema,{...selected,trigger:'event',businessBindingId:'fixture'}));
    for(const nodeId of ['f12_n02','f12_n04','f12_n05']){
      const tool=composition.tools.find(item=>item.descriptor.name==='workflow.host.'+nodeId);
      assert.throws(()=>validateToolValue(tool.descriptor.inputSchema,{...selected,...(nodeId==='f12_n04'?{roundId:'original',channel:'banner'}:{})}));
    }
  }
});
test('F12 actual configured graph consumes current policy and durable original banner receipt',async t=>{
  const f=await scenario(t);assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.sends,1);
  assert.ok(f.approvals.includes('workflow.host.f12_n04'));assert.ok(f.host.snapshot().feed.items[0].deliveredAt);
  assert.ok(f.cloud.some(request=>request.continuation?.result?.notificationState==='delivered'));
});
test('F12 a durable device failure is reported as failed and never as delivered',async t=>{
  const f=await scenario(t,{failed:true});assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.sends,1);
  assert.ok(f.cloud.some(request=>request.continuation?.result?.notificationState==='failed'&&request.continuation.result.delivered===false));
  assert.equal(f.host.snapshot().feed.items[0].deliveredAt,undefined);
});
for(const option of ['silent','query','quotaZero','legacyPause'])test('F12 '+option+' retains unread feed without a late notification',async t=>{
  const f=await scenario(t,{[option]:true});assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.sends,0);
  assert.equal(f.host.snapshot().feed.items[0].unread,true);assert.equal(f.host.snapshot().feed.items[0].deliveredAt,undefined);
  assert.ok(f.cloud.some(request=>request.continuation?.result?.notificationState==='feed_only'));
});
for(const option of ['unknown','withdrawBeforeSend','readDuringCompletion','denyCompletion'])test('F12 '+option+' cannot publish a successful graph receipt',async t=>{
  const f=await scenario(t,{[option]:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,option==='withdrawBeforeSend'?0:1);
  assert.ok(f.approvals.includes('workflow.host.f12_n04'));
  assert.equal(f.cloud.some(request=>request.continuation?.result?.notificationState!==undefined),false);
});
test('F12 original delivery approval denial keeps the feed and produces no device send',async t=>{
  const f=await scenario(t,{denyTool:'workflow.host.f12_n04'});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,0);
  assert.ok(f.approvals.includes('workflow.host.f12_n04'));
  assert.equal(f.host.snapshot().feed.items[0].unread,true);
});
for(const option of ['policyBeforeSend','cancelBeforeSend'])test('F12 '+option+' revokes pending delivery before the device call',async t=>{
  const f=await scenario(t,{[option]:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,0);
  assert.ok(f.approvals.includes('workflow.host.f12_n04'));assert.equal(f.host.snapshot().feed.items[0].unread,true);
});
test('F12 a second graph cannot replace an unknown original round with another send',async t=>{
  const f=await scenario(t,{unknown:true,repeat:true});assert.notEqual(f.child.state,'succeeded');assert.notEqual(f.repeated.state,'succeeded');assert.equal(f.sends,1);
});

for(const splitBatches of [false,true])test('F12 explicit items share one original round across '+(splitBatches?'two ready batches':'one merged batch'),async t=>{
  const f=await scenario(t,{multi:true,splitBatches});assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.sends,1);
  const round=f.host.runtimeHost.getInterruptionRound(f.sent[0].roundId);
  assert.deepEqual([...round.itemIds].sort(),['item','item-2']);assert.equal(round.batchIds.length,splitBatches?2:1);assert.equal(round.counted,true);
  assert.equal(f.sent[0].body,'有 2 条更新，请查看通知列表。');assert.ok(f.host.snapshot().feed.items.every(item=>item.deliveredAt&&item.unread));
  assert.ok(f.cloud.some(request=>request.continuation?.result?.itemIds?.length===2&&request.continuation.result.delivered===true));
});
test('F12 explicit multiple-item on-demand digest neither sends nor marks any item read',async t=>{
  const f=await scenario(t,{multi:true,query:true});assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.sends,0);
  assert.ok(f.host.snapshot().feed.items.every(item=>item.unread&&!item.deliveredAt));
  assert.ok(f.cloud.some(request=>request.continuation?.result?.itemIds?.length===2&&request.continuation.result.notificationState==='feed_only'));
});
for(const option of ['extraItem','otherScope','replaceSelection','withdrawBeforeSend','cancelBeforeSend','policyBeforeSend'])
  test('F12 multi-item '+option+' rejects a changed or wider original delivery',async t=>{
    const f=await scenario(t,{multi:true,[option]:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,0);
    assert.ok(f.host.snapshot().feed.items.every(item=>!item.deliveredAt));
  });
test('F12 reading the second original item during final export rejects the multi-item completion',async t=>{
  const f=await scenario(t,{multi:true,readDuringCompletion:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,1);
  assert.equal(f.cloud.some(request=>request.continuation?.result?.notificationState!==undefined),false);
});
test('F12 multi-item unknown preserves the original round across a second graph without resending',async t=>{
  const f=await scenario(t,{multi:true,unknown:true,repeat:true});assert.notEqual(f.child.state,'succeeded');assert.notEqual(f.repeated.state,'succeeded');assert.equal(f.sends,1);
  assert.deepEqual([...f.host.runtimeHost.getInterruptionRound(f.sent[0].roundId).itemIds].sort(),['item','item-2']);
});
