import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {validateToolValue} from '@personal-agent/contracts';
import {notificationDigest} from '@personal-agent/notifications';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createBusinessWorkflowWorkerPorts} from '../electron/business-workflow-worker-ports.js';
import {scenario} from './fixtures/f12-runtime-scenario.mjs';
import {createDesktopNotificationPort} from '../electron/desktop-notification-port.js';

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

test('F12 publishes return input only with a source reader and requires its exact reference',()=>{
  const compose=explicitReturnSource=>createBusinessWorkflowWorkerPorts({runtimeModule,getApplication:()=>undefined,explicitReturnSource,
    notificationHost:{getDigest(){},deliverRound(){},getInterruptionPolicy(){},getLegacyPolicy(){},drain(){}},
    prepareCompetitionToolExport:async()=>{},readBusinessAvailability:()=>({ready:true,bindingId:'fixture'}),authorizeExport:async()=>true})
    .configuredWorkflowWorkerPorts.find(worker=>worker.workflowId==='F12');
  const source={taskId:'original',sourceTaskId:'user',sessionId:'session',commandId:'return',controlRevision:1};
  assert.throws(()=>validateToolValue(compose().requestSchema,{itemId:'item',trigger:'on_return',returnSource:source}));
  const schema=compose({read(){throw Error('schema only');}}).requestSchema;
  validateToolValue(schema,{itemId:'item',trigger:'on_return',returnSource:source});
  for(const request of [{itemId:'item',trigger:'on_return'},{itemId:'item',trigger:'event',returnSource:source},
    {itemId:'item',trigger:'on_return',returnSource:{...source,controlRevision:0}},{itemId:'item',trigger:'on_return',returnSource:{...source,approved:true}}])
    assert.throws(()=>validateToolValue(schema,request));
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

test('F12 waits for an asynchronous original show receipt without another device send',async t=>{
  let port,beforeShow,onShown;const shown=new Promise(resolve=>{onShown=resolve;});
  const f=await scenario(t,{multi:true,createChannel:({getNotificationHost,userData})=>{
    port=createDesktopNotificationPort({storageDir:path.join(userData,'device'),onOutcome:outcome=>getNotificationHost().receipt(outcome),
      notifier:{isSupported:async()=>true,async show(input,callbacks){
        const timer=setTimeout(()=>{const receipt=port.readDeliveryOutcome(input.id);
          beforeShow=getNotificationHost().runtimeHost.getInterruptionRound(receipt.roundId).attempts.banner.state;callbacks.onShow();onShown();},40);
        return {close:()=>clearTimeout(timer)};
      }}});return port;
  }});
  await shown;assert.equal(beforeShow,'unknown');assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.sends,1);
  const receipt=port.readDeliveryOutcome(f.sent[0].id),round=f.host.runtimeHost.getInterruptionRound(f.sent[0].roundId);
  assert.equal(receipt.deliveryState,'delivered');assert.deepEqual(round.attempts.banner.evidenceRefs,receipt.evidenceRefs);
  assert.equal(round.attempts.banner.state,'delivered');
});

for(const action of ['failed','cancel','withdraw'])test('F12 asynchronous native '+action+' preserves the original effect without replay',async t=>{
  let port,resolveOutcome;const outcome=new Promise(resolve=>{resolveOutcome=resolve;});
  const f=await scenario(t,{multi:true,createChannel:({getApplication,getNotificationHost,userData})=>{
    port=createDesktopNotificationPort({storageDir:path.join(userData,'device'),onOutcome:receipt=>getNotificationHost().receipt(receipt),
      notifier:{isSupported:async()=>true,async show(_input,callbacks){
        const change=setTimeout(()=>{
          if(action==='withdraw')getNotificationHost().runtimeHost.withdrawNotifications({operationId:'native-pending-withdraw',itemIds:['item-2']});
          if(action==='cancel'){
            const app=getApplication(),original=app.runtime.listTasks({limit:100}).items.find(task=>task.state==='running'
              &&app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName==='workflow.host.f12_n04');
            assert.ok(original);app.runtime.requestCancel(original.taskId);
          }
        },10);
        const receipt=setTimeout(()=>{action==='failed'?callbacks.onFailed():callbacks.onShow();resolveOutcome();},40);
        return {close(){clearTimeout(change);clearTimeout(receipt);}};
      }}});return port;
  }});
  await outcome;assert.equal(f.sends,1);assert.equal(port.readDeliveryOutcome(f.sent[0].id).deliveryState,action==='failed'?'failed':'delivered');
  if(action==='failed'){
    assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));
    assert.ok(f.cloud.some(request=>request.continuation?.result?.notificationState==='failed'&&request.continuation.result.delivered===false));
  }else{
    assert.notEqual(f.child.state,'succeeded');assert.equal(f.cloud.some(request=>request.continuation?.result?.notificationState!==undefined),false);
    assert.equal(f.host.runtimeHost.getInterruptionRound(f.sent[0].roundId).attempts.banner.state,'delivered');
  }
});

test('F12 original explicit return reads the current digest with no send, read acknowledgement or interruption',async t=>{
  const f=await scenario(t,{returning:true,multi:true,repeat:true});
  assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.repeated.state,'succeeded',JSON.stringify(f.diagnostics));
  assert.equal(f.sends,0);assert.ok(f.approvals.includes('workflow.host.f12_n05'));assert.equal(f.approvals.includes('workflow.host.f12_n04'),false);
  assert.equal(f.host.runtimeHost.getInterruptionRound('workflow-f12-'+notificationDigest(f.child.taskId)),undefined);
  const digest=f.host.getDigest({trigger:'on_return'});assert.equal(digest.interruptionCount,0);
  assert.deepEqual(digest.items.map(item=>({id:item.id,unread:item.unread})),[{id:'item',unread:true},{id:'item-2',unread:true}]);
  assert.ok(f.cloud.some(request=>request.continuation?.result?.notificationState==='feed_only'));
});

for(const option of ['unrecordedReturn','foreignReturn','cancelReturn','eraseReturn','changeReturnDuringInitial','changeReturnDuringCompletion'])
  test('F12 '+option+' refuses return digest completion without modifying feed',async t=>{
    const f=await scenario(t,{returning:true,[option]:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,0);
    assert.equal(f.cloud.some(request=>request.continuation?.result?.notificationState==='feed_only'),false);
    assert.equal(f.host.runtimeHost.notificationFeed().items.find(item=>item.id==='item').unread,true);
    if(option==='changeReturnDuringInitial')assert.equal(f.proposals.length,0);
  });

test('F12 return source does not replace the original digest child Policy approval',async t=>{
  const f=await scenario(t,{returning:true,denyTool:'workflow.host.f12_n05'});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,0);
  assert.equal(f.cloud.some(request=>request.continuation?.result?.notificationState==='feed_only'),false);
});
