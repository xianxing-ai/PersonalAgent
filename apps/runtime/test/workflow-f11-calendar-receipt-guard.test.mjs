import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyF11ConfirmedCalendarAndReminder} from '../dist/application/workflow-f11-calendar-receipt-guard.js';
import {createRuntimeF11CalendarChangeHost} from '../dist/application/workflow-f11-calendar-graph-host.js';

function fixture(){
  const binding={taskId:'task',runId:'run',toolVersion:'1',scopeRef:'grant',arguments:{uid:'event',notes:'online'},reminderId:'reminder'};
  const scope={parentTaskId:'graph',localTaskId:'child',operationId:'op',sessionId:'session',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
  const record={taskId:'task',evidenceId:'run',toolName:'calendar.update',toolVersion:'1',policyDecision:'allow',executionStarted:true,state:'confirmed'};
  const runtime={getTask:()=>({evidenceRefs:['run']}),readToolExecutions:()=>[record],
    matchesToolExecutionInput:(_record,input)=>input.scopeRef==='grant'&&input.arguments.uid==='event'};
  const options={application:{runtime},verifyOriginalPlan:async()=>true,verifyUpdatedEvent:async()=>true,verifyReminderInvalidated:async()=>true};
  return {binding,scope,record,options};
}
test('F11 node retains the calendar receipt and requires old reminder cancellation before success',async()=>{
  const f=fixture(),args={update:f.binding.arguments,reminder:{todoId:'todo',revision:1,scheduleId:'reminder',conversationId:'todos'}};
  const context={taskId:'child',runId:'host-tool-child',authorizationRef:'graph-grant',scopes:['calendar:write','todo:write'],
    deadline:f.scope.deadline,signal:f.scope.signal};
  const map=new Map([
    ['child:coding-repair:parent',{taskId:'graph',operationId:'op'}],
    ['child:host-tool-intent',{commandId:'op',toolName:'workflow.host.f11_n05',arguments:args,deadline:context.deadline}],
    ['graph:owned-workflow:intent:op',{taskId:'graph',workflowId:'F11',sessionId:'session',deadline:context.deadline,
      proposal:{nodeId:'F11_N05',operationId:'op',toolName:'workflow.host.f11_n05',arguments:args}}],
  ]);
  f.options.application.runtime.loadCheckpoint=(id,key)=>map.get(id+':'+key);
  f.options.application.runtime.getTask=()=>({state:'running',cancelRequested:false,evidenceRefs:['run']});
  let invalidated=false,readback=true,calls=[];
  const host=createRuntimeF11CalendarChangeHost({...f.options,calendarUpdate:{descriptor:{name:'calendar.update',inputSchema:{type:'object'}}},
    requiredScopes:['calendar:write','todo:write'],now:()=>new Date(),assertCurrent:()=>{},authorizeExport:async()=>true,
    verifyPlan:async()=>true,verifyUpdatedEvent:async()=>readback,verifyReminderInvalidated:async()=>invalidated,
    invokeCalendarUpdate:async()=>{calls.push('calendar.update');const {reminderId,...record}=f.binding;return record;},
    invalidateReminder:async()=>{calls.push('todo.update');invalidated=true;}});
  assert.equal(host.unavailable,null);
  assert.deepEqual(await host.tools[0].execute(args,context),{calendarUpdated:true,oldTrafficAlarmVoided:true});
  assert.deepEqual(calls,['calendar.update','todo.update']);
  calls=[];readback=false;invalidated=false;
  await assert.rejects(host.tools[0].execute(args,context),{code:'RESULT_UNKNOWN'});
  assert.deepEqual(calls,['calendar.update']);assert.equal(invalidated,false);
  await assert.rejects(host.tools[0].execute({...args,reminder:{...args.reminder,todoId:'substituted'}},context),{code:'UNAUTHORIZED'});
  assert.equal(createRuntimeF11CalendarChangeHost().tools.length,0);
});
test('F11 guard requires an authorized confirmed calendar update and reminder invalidation',async()=>{
  const f=fixture();assert.deepEqual(await verifyF11ConfirmedCalendarAndReminder(f.options,f.scope,f.binding),
    {calendarUpdated:true,oldTrafficAlarmVoided:true});
  f.record.toolName='calendar.events';await assert.rejects(verifyF11ConfirmedCalendarAndReminder(f.options,f.scope,f.binding),{code:'UNAUTHORIZED'});
  f.record.toolName='calendar.update';f.record.state='unknown';await assert.rejects(verifyF11ConfirmedCalendarAndReminder(f.options,f.scope,f.binding),{code:'UNAUTHORIZED'});
  f.record.state='confirmed';f.record.policyDecision='deny';await assert.rejects(verifyF11ConfirmedCalendarAndReminder(f.options,f.scope,f.binding),{code:'UNAUTHORIZED'});
});
test('F11 rejects unbound writes, unavailable ports and stale reminder proof',async()=>{
  const f=fixture();await assert.rejects(verifyF11ConfirmedCalendarAndReminder(undefined,f.scope,f.binding),{code:'UNSUPPORTED_CAPABILITY'});
  f.binding.arguments={uid:'other'};await assert.rejects(verifyF11ConfirmedCalendarAndReminder(f.options,f.scope,f.binding),{code:'UNAUTHORIZED'});
  f.binding.arguments={uid:'event'};f.options.verifyReminderInvalidated=async()=>false;
  await assert.rejects(verifyF11ConfirmedCalendarAndReminder(f.options,f.scope,f.binding),{code:'RESULT_UNKNOWN'});
  f.options.verifyReminderInvalidated=async()=>true;f.options.verifyOriginalPlan=async()=>false;
  await assert.rejects(verifyF11ConfirmedCalendarAndReminder(f.options,f.scope,f.binding),{code:'UNAUTHORIZED'});
});
test('F11 fails closed if provider readback is missing or throws',async()=>{
  const f=fixture();f.options.verifyUpdatedEvent=async()=>false;
  await assert.rejects(verifyF11ConfirmedCalendarAndReminder(f.options,f.scope,f.binding),{code:'RESULT_UNKNOWN'});
  f.options.verifyUpdatedEvent=async()=>{throw Error('synthetic secret');};
  await assert.rejects(verifyF11ConfirmedCalendarAndReminder(f.options,f.scope,f.binding),error=>
    error.code==='UNSUPPORTED_CAPABILITY'&&!error.message.includes('synthetic secret'));
});
test('F11 detects a reminder changing during verification',async()=>{
  const f=fixture();let calls=0;f.options.verifyReminderInvalidated=async()=>++calls===1;
  await assert.rejects(verifyF11ConfirmedCalendarAndReminder(f.options,f.scope,f.binding),{code:'RESULT_UNKNOWN'});
});
