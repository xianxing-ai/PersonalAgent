import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarSnapshotVersion} from '@personal-agent/calendar';
import {createF06TodoWorkflowPorts} from '../electron/f06-todo-workflow-ports.js';
import {createF07CalendarWorkflowPorts} from '../electron/f07-calendar-workflow-ports.js';
import {createF11CalendarWorkflowPorts} from '../electron/f11-calendar-workflow-ports.js';

// Isolated consumer boundary tests. Bridge, graph binding and account data are explicit fixtures.
const fixture=input=>{
  const controller=new AbortController(),time=Date.now(),deadline=new Date(time+60_000).toISOString(),calls=[],checkpoints=new Map();
  const bound={input,deadline,sessionId:'session',confirmedOperations:[]};
  const app={readConfiguredWorkflowBinding:()=>bound,runtime:{loadCheckpoint:(id,key)=>checkpoints.get(id+key),
    saveCheckpointOnce:(id,key,value)=>{if(!checkpoints.has(id+key))checkpoints.set(id+key,structuredClone(value));}}};
  const scope={parentTaskId:'parent',sessionId:'session',deadline,signal:controller.signal};
  return {app,bound,scope,controller,calls,getApplication:()=>app,authorizeExport:async()=>true,now:()=>time};
};

test('F06 forwards only the bound explicit reminder and preserves the original child receipt',async()=>{
  const f=fixture({todoTitle:'Fixture todo',due:'2026-11-01T09:00:00.000Z',remindUtc:'2026-11-01T08:00:00.000Z'});
  const ports=createF06TodoWorkflowPorts({...f,todoHost:{snapshot:()=>({items:[],notifications:[]})},
    notificationHost:{reconcileDelivery(){},runtimeHost:{getInterruptionRound(){}}},bridge:{async invoke(request){f.calls.push(request);
      return {toolName:'todo.create',arguments:request.input,result:{item:{id:'todo-1',revision:1}}};}}});
  assert.equal(await ports.verifyWriteBinding(f.scope,f.bound.input),true);
  assert.equal(await ports.verifyWriteBinding(f.scope,{...f.bound.input,remindUtc:'substituted'}),false);
  const input={title:f.bound.input.todoTitle,dueUtc:f.bound.input.due,remindUtc:f.bound.input.remindUtc};
  await ports.invokeTodoCreate(f.scope,input,{});
  assert.deepEqual(f.calls,[{actionKey:'f06.todo.create',input}]);
  await assert.rejects(ports.invokeTodoCreate(f.scope,{...input,title:'other'},{}),{code:'UNAUTHORIZED'});
  f.controller.abort();await assert.rejects(ports.invokeTodoCreate(f.scope,input,{}),{code:'CANCELLED'});assert.equal(f.calls.length,1);
});

test('F07 freshness compares the complete original window to a separately authorized read',async()=>{
  const readArgs={fromUtc:'2026-10-31T00:00:00.000Z',toUtc:'2026-11-01T00:00:00.000Z'};
  const f=fixture({calendarReadArguments:readArgs,title:'Meeting',slot:{startUtc:'2026-10-31T10:00:00.000Z',endUtc:'2026-10-31T11:00:00.000Z'}});
  const result={items:[],window:readArgs,hasMore:false,nextCursor:'',sourceVersion:calendarSnapshotVersion(readArgs,[])};
  f.bound.confirmedOperations.push({nodeId:'F07_N02',toolName:'calendar.events',localTaskId:'read',result});
  f.app.runtime.saveCheckpointOnce('read','host-tool-intent',{arguments:readArgs});
  let current=result;
  const ports=createF07CalendarWorkflowPorts({...f,bridge:{async invoke(request){f.calls.push(request);return {toolName:'calendar.events',arguments:request.input,result:current};}}});
  assert.equal(await ports.verifyReadBinding(f.scope,{calendarVersionAtRead:result.sourceVersion,calendarVersionNow:result.sourceVersion}),true);
  assert.equal(await ports.readSourceVersion(f.scope,{}),result.sourceVersion);
  await ports.readSourceVersion(f.scope,{},'before_export');await ports.readSourceVersion(f.scope,{},'after_export');
  assert.deepEqual(f.calls.map(call=>call.actionKey),['f07.calendar.recheck.execute','f07.calendar.recheck.before_export','f07.calendar.recheck.after_export']);
  assert.equal(await ports.verifyWriteBinding(f.scope,{title:'Meeting',slot:f.bound.input.slot}),false);
  f.bound.confirmedOperations.push({nodeId:'F07_N04',result:{versionConsistent:true,sourceVersion:result.sourceVersion}});
  assert.equal(await ports.verifyWriteBinding(f.scope,{title:'Meeting',slot:f.bound.input.slot}),true);
  current={...result,hasMore:true};await assert.rejects(ports.readSourceVersion(f.scope,{}),{code:'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(ports.invokeCalendarCreate({summary:'Meeting'},{}),{code:'RESULT_UNKNOWN'});
});

test('F11 uses the original calendar child then clears only its bound reminder and verifies cancellation',async()=>{
  const remindUtc='2026-11-01T08:00:00.000Z',reminder={todoId:'todo-1',revision:1,scheduleId:'todo-reminder:todo-1:'+remindUtc,conversationId:'fixture-todos'};
  const f=fixture({update:{uid:'event-1',startUtc:'2026-11-01T09:00:00.000Z',endUtc:'2026-11-01T10:00:00.000Z'},reminder});
  let todo={id:'todo-1',revision:1,status:'open',reminder:{state:'scheduled',remindAt:{utc:remindUtc}}},schedule={scheduleId:reminder.scheduleId,status:'pending'};
  const original={taskId:'calendar-child',runId:'host-tool-calendar-child',toolName:'calendar.update',toolVersion:'1',scopeRef:'scope',arguments:f.bound.input.update,
    result:{state:'updated',item:{source:'calendar',externalId:'event-1',validFor:f.bound.input.update.startUtc+'/'+f.bound.input.update.endUtc}}};
  f.app.readHostToolTask=()=>({task:{state:'succeeded'},toolName:original.toolName,confirmed:{runId:original.runId,result:original.result}});
  f.app.runtime.listSchedules=()=>[schedule];
  const ports=createF11CalendarWorkflowPorts({...f,todoHost:{snapshot:()=>({items:[todo]})},bridge:{async invoke(request){
    f.calls.push(request);if(request.actionKey==='f11.calendar.update')return original;
    todo={id:'todo-1',revision:2,status:'open'};schedule={...schedule,status:'cancelled'};
    return {toolName:'todo.update',arguments:request.input,result:{item:todo,reminderTrigger:null}};
  }}});
  assert.equal(await ports.verifyPlan(f.scope,f.bound.input),true);
  const receipt={...await ports.invokeCalendarUpdate(f.scope,f.bound.input.update,{}),reminderId:reminder.scheduleId};
  assert.equal(await ports.verifyUpdatedEvent(f.scope,receipt),true);
  await ports.invalidateReminder(f.scope,reminder,{});
  assert.equal(await ports.verifyOriginalPlan(f.scope,receipt),true);assert.equal(await ports.verifyReminderInvalidated(f.scope,receipt),true);
  assert.deepEqual(f.calls[1],{actionKey:'f11.reminder.clear',input:{id:'todo-1',clearReminder:true}});
  schedule={...schedule,status:'fired'};assert.equal(await ports.verifyReminderInvalidated(f.scope,receipt),false);
  await assert.rejects(ports.invalidateReminder(f.scope,{...reminder,todoId:'other'},{}),{code:'UNAUTHORIZED'});
});
