import test from 'node:test';
import assert from 'node:assert/strict';
import {commandCenterState,childThreadGroups,childThreadTitle} from '../src/features/workspace/command-center.js';
import {scopeSubagentConversations} from '../electron/subagent-activity.js';

test('empty command center does not invent agents, activity or configured services',()=>{
  const state=commandCenterState({});assert.equal(state.active,0);assert.equal(state.working,0);assert.equal(state.latest,undefined);assert.deepEqual(state.activity,[]);assert.equal(state.configured,0);
});

test('child threads use their delegated goals and stay in their original main conversation',()=>{
  const children=[{taskId:'a',parentTaskId:'main-a',role:'worker',goal:'[任务执行] 核对页面改动'},{taskId:'b',parentTaskId:'main-b'},{taskId:'gone',parentTaskId:'missing'}];
  const before=structuredClone(children),parents=new Map([['main-a',{conversationId:'active'}],['main-b',{conversationId:'other'}]]);
  const visible=scopeSubagentConversations(children,id=>{if(!parents.has(id))throw Object.assign(Error('missing'),{code:'NOT_FOUND'});return parents.get(id);},parent=>parent.conversationId==='active');
  assert.deepEqual(visible.map(child=>child.taskId),['a']);assert.equal(childThreadTitle(visible[0]),'核对页面改动');assert.deepEqual(children,before);
});
test('command center derives bounded activity and working counts from actual records without changing them',()=>{
  const tasks=Array.from({length:7},(_,i)=>({taskId:String(i),state:i===5?'running':'succeeded'}));tasks.push({taskId:'stopped',state:'running',outputTruncated:true});
  const data={tasks,subagentTasks:[{taskId:'child',state:'waiting_approval'},{taskId:'finished',state:'succeeded'}],health:[{state:'ready'},{state:'unavailable'}]};
  const before=structuredClone(data),state=commandCenterState(data);assert.equal(state.active,1);assert.equal(state.working,1);assert.equal(state.configured,1);assert.equal(state.activity.length,5);assert.equal(state.activity[0].taskId,'stopped');assert.deepEqual(data,before);
});

test('child summary filtering reports actual reader failures instead of silently returning an empty list',()=>{
  const failure=Object.assign(Error('Synthetic database read failure'),{code:'ERR_SQLITE_ERROR'});
  assert.throws(()=>scopeSubagentConversations([{parentTaskId:'main',taskId:'child'}],()=>{throw failure;},()=>true),
    error=>error===failure);
});

test('sidebar groups every child by actual state without truncating or converting failed work to success',()=>{
  const children=Array.from({length:10},(_,i)=>({taskId:String(i),state:i<7?'running':['succeeded','failed','cancelled'][i-7]}));
  const before=structuredClone(children),groups=childThreadGroups(children);
  assert.deepEqual(groups.map(group=>group.label),['进行中','已结束']);
  assert.deepEqual(groups.map(group=>group.children.length),[7,3]);
  assert.deepEqual(groups[1].children.map(child=>child.state),['succeeded','failed','cancelled']);
  assert.deepEqual(children,before);
});
