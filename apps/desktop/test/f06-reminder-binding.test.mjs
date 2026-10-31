import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerifyWorkflowReminderBinding} from '../electron/f06-reminder-binding.js';

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
