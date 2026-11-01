import test from 'node:test';
import assert from 'node:assert/strict';
import {scenario as fixture} from './fixtures/f06-runtime-scenario.mjs';
import {createDesktopNotificationPort} from '../electron/desktop-notification-port.js';

const pause=(ms=5)=>new Promise(resolve=>setTimeout(resolve,ms));

test('F06 original due schedule delivers once through real engine and exact automatic revision',async t=>{
  const f=await fixture(t);assert.equal(f.child.state,'succeeded',JSON.stringify(f.child.error));
  assert.equal(f.originalTodo.revision,1);assert.equal(f.todoHost.snapshot().items[0].revision,2);
  assert.equal(f.todoHost.snapshot().items[0].reminder.state,'delivered');assert.equal(f.shown,1);
  assert.ok(f.cloud.some(request=>request.continuation?.result?.reminderState==='delivered'&&request.continuation.result.delivered===true));
  assert.ok(f.proposals.some(item=>item.toolName==='workflow.guard.f06_n05'));
  assert.equal(f.decisionProofs.length,4,'all semantic and host candidate decisions use the production original-source gate');
  await f.todoHost.tick(true);assert.equal(f.shown,1);
  const task=f.app.runtime.listTasks({limit:100}).items.find(item=>f.app.runtime.loadCheckpoint(item.taskId,'host-tool-intent')?.toolName==='todo.create');
  const intent=f.app.runtime.loadCheckpoint(task.taskId,'host-tool-intent'),result=f.app.readHostToolTask(task.taskId).confirmed.result;
  const policy=f.policies.find(item=>item.toolName==='todo.create'),scope={taskId:task.taskId,proposalId:intent.commandId,
    runId:'host-tool-'+task.taskId,deadline:intent.deadline,arguments:intent.arguments,result,signal:new AbortController().signal};
  assert.deepEqual(policy.project(scope),result);
  assert.throws(()=>policy.project({...scope,result:{...result,item:{...result.item,title:'substituted'}}}),/出机许可不可用/);
  f.app.runtime.saveCheckpoint(task.taskId,'host-tool-intent',{...intent,commandId:'foreign'});
  assert.throws(()=>policy.project(scope),/出机许可不可用/);f.app.runtime.saveCheckpoint(task.taskId,'host-tool-intent',intent);
  f.todoHost.revoke();assert.throws(()=>policy.project(scope),/授权已失效/);
  await f.restart();await f.todoHost.tick(true);assert.equal(f.shown,1,'recovery never repeats original delivery');
});

test('F06 future graph completes scheduled, survives restart and original scheduler later delivers once',async t=>{
  const f=await fixture(t,{future:true});assert.equal(f.child.state,'succeeded',JSON.stringify(f.child.error));
  assert.equal(f.shown,0);assert.equal(f.todoHost.snapshot().items[0].revision,1);
  assert.ok(f.cloud.some(request=>request.continuation?.result?.reminderState==='scheduled'&&request.continuation.result.delivered===false));
  assert.equal(f.proposals.some(item=>item.toolName==='workflow.host.f06_n05'),false);
  const originalSchedules=f.app.runtime.listSchedules('desktop-todo-reminders:offline-f06');assert.equal(originalSchedules.length,1);
  assert.equal(originalSchedules[0].status,'pending');assert.equal(originalSchedules[0].runAt,f.input.remindUtc);
  await f.restart();assert.deepEqual(f.app.runtime.listSchedules('desktop-todo-reminders:offline-f06'),originalSchedules);
  await f.todoHost.tick(true);assert.equal(f.shown,0);
  await pause(Math.max(1,Date.parse(f.input.remindUtc)-Date.now()+20));
  await f.todoHost.tick(true);
  for(let i=0;i<200&&!f.shown;i++)await pause();
  assert.equal(f.shown,1);assert.equal(f.todoHost.snapshot().items[0].reminder.state,'delivered');
  assert.equal(f.app.runtime.getSchedule(originalSchedules[0].scheduleId).status,'fired');
  await f.restart();await f.todoHost.tick(true);assert.equal(f.shown,1);
  assert.equal(f.todoHost.snapshot().items.length,1);assert.equal(f.todoHost.snapshot().items[0].revision,2);
});

for(const change of ['cancel','edit'])test('F06 future completion rejects original reminder '+change+' during consent',async t=>{
  const f=await fixture(t,{future:true,beforeCompletion:async({todoHost})=>{
    const item=todoHost.snapshot().items[0];await todoHost.update({id:item.id,...(change==='cancel'?{status:'cancelled'}:{title:'User changed the original'})});
  }});
  assert.notEqual(f.child.state,'succeeded');assert.equal(f.shown,0);
  assert.equal(f.cloud.some(request=>request.continuation?.result?.reminderState==='scheduled'),false);
  assert.equal(f.todoHost.snapshot().items[0].revision,2);
  if(change==='cancel')assert.equal(f.app.runtime.listSchedules('desktop-todo-reminders:offline-f06')[0].status,'cancelled');
});

test('F06 child denial creates no Todo or schedule',async t=>{
  const f=await fixture(t,{future:true,denyTool:'todo.create'});assert.notEqual(f.child.state,'succeeded');
  assert.equal(f.todoHost.snapshot().items.length,0);assert.deepEqual(f.app.runtime.listSchedules('desktop-todo-reminders:offline-f06'),[]);
});

test('F06 original decision source revoked after question preparation cannot be approved',async t=>{
  const f=await fixture(t,{future:true,revokeDecisionSource:true});assert.notEqual(f.child.state,'succeeded');
  assert.equal(f.decisionProofs.length,1);assert.ok(f.responses.some(response=>response.accepted===false&&response.state==='stale'));
  assert.equal(f.todoHost.snapshot().items.length,0);assert.deepEqual(f.app.runtime.listSchedules('desktop-todo-reminders:offline-f06'),[]);
});

test('F06 becoming due during completion consent is not exported as scheduled and original reminder remains deliverable',async t=>{
  const f=await fixture(t,{future:true,beforeCompletion:async({todoHost})=>{
    await pause(Math.max(1,Date.parse(todoHost.snapshot().items[0].reminder.remindAt.utc)-Date.now()+20));
  }});
  assert.notEqual(f.child.state,'succeeded');assert.equal(f.cloud.some(request=>request.continuation?.result?.reminderState==='scheduled'),false);
  await f.todoHost.tick(true);for(let i=0;i<200&&!f.shown;i++)await pause();
  assert.equal(f.shown,1);await f.todoHost.tick(true);assert.equal(f.shown,1);
});

test('F06 unknown device delivery never becomes confirmed and recovery does not resend',async t=>{
  const f=await fixture(t,{unknownDelivery:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.shown,1);
  assert.equal(f.cloud.some(request=>request.continuation?.result?.delivered===true),false);
  await f.restart();await f.todoHost.tick(true);assert.equal(f.shown,1);
});

test('F06 accepts the original injected device channel and keeps its durable receipt across restart',async t=>{
  let displayed=0;
  const f=await fixture(t,{createChannel:({getNotificationHost,userData})=>createDesktopNotificationPort({storageDir:userData,
    onOutcome:outcome=>getNotificationHost().receipt(outcome),notifier:{isSupported:async()=>true,
      async show(_input,events){displayed++;events.onShow();return {close(){}};}}})});
  assert.equal(f.child.state,'succeeded',JSON.stringify(f.child.error));assert.equal(displayed,1);assert.equal(f.sent.length,1);
  const schedules=f.app.runtime.listSchedules('desktop-todo-reminders:offline-f06');assert.equal(schedules.length,1);assert.equal(schedules[0].status,'fired');
  const round=f.notificationHost.runtimeHost.getInterruptionRound(f.sent[0].roundId);
  assert.equal(round.attempts.banner.state,'delivered');assert.ok(round.attempts.banner.evidenceRefs.length);
  await f.restart();await f.todoHost.tick(true);assert.equal(displayed,1);assert.equal(f.sent.length,1);
  assert.deepEqual(f.app.runtime.listSchedules('desktop-todo-reminders:offline-f06'),schedules);
});

test('F06 explicitly unavailable device injection never falls back to a fixture channel',async t=>{
  await assert.rejects(fixture(t,{createChannel:()=>undefined}),/Explicit F06 device channel is unavailable/);
});

test('F06 asynchronous original device receipt never triggers another scheduler send',async t=>{
  let port,beforeShow,finish;const shown=new Promise(resolve=>{finish=resolve;});
  const f=await fixture(t,{createChannel:({getNotificationHost,userData})=>{
    port=createDesktopNotificationPort({storageDir:userData,onOutcome:outcome=>getNotificationHost().receipt(outcome),
      notifier:{isSupported:async()=>true,async show(input,events){
        const timer=setTimeout(()=>{const receipt=port.readDeliveryOutcome(input.id);
          beforeShow=getNotificationHost().runtimeHost.getInterruptionRound(receipt.roundId).attempts.banner.state;events.onShow();finish();},40);
        return {close:()=>clearTimeout(timer)};
      }}});return port;
  }});
  await shown;assert.equal(beforeShow,'unknown');assert.equal(f.shown,1);
  assert.equal(port.readDeliveryOutcome(f.sent[0].id).deliveryState,'delivered');
  assert.equal(f.child.state,'succeeded',JSON.stringify(f.child.error));
  await f.restart();await f.todoHost.tick(true);assert.equal(f.shown,1);
});
