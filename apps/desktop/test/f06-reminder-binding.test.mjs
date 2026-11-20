import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerifyWorkflowReminderBinding} from '../electron/f06-reminder-binding.js';
import {applyReminderDispatches,reminderScheduleId} from '@personal-agent/productivity';
import {notificationDigest} from '@personal-agent/notifications';

function fixture({todoId='todo-1',revision=1,nodeId='F06_N04'}={}) {
  const map=new Map();
  map.set('child:coding-repair:parent',{taskId:'parent',operationId:'n04'});
  map.set('parent:owned-workflow:intent:n04',{taskId:'parent',workflowId:'F06',sessionId:'session',
    proposal:{nodeId,operationId:'n04',toolName:'workflow.host.f06_n04',arguments:{todoId,revision}}});
  map.set('child:host-tool-intent',{commandId:'n04',toolName:'workflow.host.f06_n04',arguments:{todoId,revision}});
  map.set('parent:f06:n03-todo:session',{sessionId:'session',operationId:'n03',todoId,revision});
  const application={runtime:{loadCheckpoint:(taskId,key)=>map.get(taskId+':'+key)}};
  const verify=createVerifyWorkflowReminderBinding({getApplication:()=>application});
  const context={taskId:'child',signal:new AbortController().signal};
  return {verify,context,map};
}

test('F06 reminder binding accepts only same-graph N03 todoId/revision',async()=>{
  const f=fixture();
  assert.equal(await f.verify({todoId:'todo-1',revision:1,context:f.context}),true);
  assert.equal(await f.verify({todoId:'todo-1',revision:2,context:f.context}),false);
  assert.equal(await f.verify({todoId:'other',revision:1,context:f.context}),false);
  f.map.set('parent:owned-workflow:intent:n04',{taskId:'parent',workflowId:'F06',sessionId:'session',
    proposal:{nodeId:'F06_N05',operationId:'n04',toolName:'workflow.host.f06_n05',arguments:{}}});
  assert.equal(await f.verify({todoId:'todo-1',revision:1,context:f.context}),false);
});

test('F06 permits exactly the original durable automatic dispatch, never edits, rescheduling or unknown delivery',async()=>{
  const f=fixture(),time=Date.now()-5000,at=new Date(time).toISOString().replace(/\.\d{3}Z$/,'.000Z');
  const original={id:'todo-1',title:'Original reminder',revision:1,status:'open',createdAt:at,updatedAt:at,
    reminder:{state:'scheduled',remindAt:{kind:'instant',utc:at,timeZone:'UTC'},missedPolicy:'run_once'}};
  const id=reminderScheduleId(original.id,at),[currentItem]=applyReminderDispatches([original],[{scheduleId:id,status:'fired'}],()=>time+1000);
  f.map.set('parent:f06:n03-todo:session',{sessionId:'session',operationId:'n03',todoId:original.id,revision:1,item:original,reminderScheduleId:id});
  const verify=createVerifyWorkflowReminderBinding({getApplication:()=>({runtime:{loadCheckpoint:(taskId,key)=>f.map.get(taskId+':'+key),getTask:()=>({state:'succeeded'})}})});
  const input={todoId:original.id,revision:1,context:f.context,currentItem,
    schedule:{scheduleId:id,status:'fired',runAt:at,taskId:'delivery-task'},
    reminderRecord:{notificationId:id,taskId:'delivery-task',state:'visible',batchId:'original-batch',presentationAttempted:true},
    deliveryRound:{roundId:'desktop-batch-'+notificationDigest('original-batch'),batchIds:['original-batch'],itemIds:[id],
      attempts:{banner:{state:'delivered',evidenceRefs:['actual-device-receipt']}}}};
  assert.deepEqual(await verify(input),{delivered:true,revision:2});
  for(const changed of [{...currentItem,title:'Changed'},{...currentItem,status:'cancelled'},
    {...currentItem,revision:3},{...currentItem,reminder:{...currentItem.reminder,remindAt:{...currentItem.reminder.remindAt,utc:new Date().toISOString()}}}])
    assert.equal(await verify({...input,currentItem:changed}),false);
  for(const state of ['sending','unknown','failed'])assert.equal(await verify({...input,deliveryRound:{...input.deliveryRound,
    attempts:{banner:{state,evidenceRefs:['not-confirmed']}}}}),false);
  assert.equal(await verify({...input,schedule:{...input.schedule,status:'cancelled'}}),false);
  assert.equal(await verify({...input,reminderRecord:{...input.reminderRecord,taskId:'foreign'}}),false);
});
