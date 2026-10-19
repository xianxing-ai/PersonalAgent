import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSubagentWindowAction,handleSubagentListAction} from '../electron/subagent-window-actions.js';

function fixture(){
  const calls=[],contents={mainFrame:{}};
  const record={binding:{parentTaskId:'original-parent',taskId:'original-child'},window:{webContents:contents,isDestroyed:()=>false,close:()=>calls.push('close')}};
  return {calls,record,event:{sender:contents,senderFrame:contents.mainFrame},readDetail:binding=>{calls.push(binding);return {taskId:binding.taskId};},openMain:()=>calls.push('main')};
}
test('child reader reads only its original host binding and closes without cancelling work',async()=>{
  const f=fixture();assert.deepEqual(await handleSubagentWindowAction({...f,name:'subagentConversation.snapshot'}),{taskId:'original-child'});
  await handleSubagentWindowAction({...f,name:'subagentConversation.main'});
  await handleSubagentWindowAction({...f,name:'subagentConversation.close'});
  assert.deepEqual(f.calls,[f.record.binding,'main','close']);
});
test('child readers reject task execution, rebinding and non-main-frame senders',async()=>{
  const f=fixture();
  for(const name of ['snapshot','task.submit','approval.respond','task.cancel','modelApi.configure'])await assert.rejects(handleSubagentWindowAction({...f,name}));
  await assert.rejects(handleSubagentWindowAction({...f,name:'subagentConversation.snapshot',payload:{taskId:'another-child'}}));
  await assert.rejects(handleSubagentWindowAction({...f,name:'subagentConversation.snapshot',event:{sender:f.event.sender,senderFrame:{}}}));
  await assert.rejects(handleSubagentWindowAction({...f,name:'subagentConversation.snapshot',event:{sender:{},senderFrame:f.event.senderFrame}}));
  assert.deepEqual(f.calls,[]);
});

test('child conversation submit and stop use only the immutable host binding',async()=>{
  const f=fixture(),calls=[];
  const ports={submit:(binding,payload)=>{calls.push(['submit',binding,payload]);return {acceptedTaskId:'new-execution'};},
    cancel:(binding,taskId)=>{calls.push(['cancel',binding,taskId]);return {accepted:true};}};
  assert.deepEqual(await handleSubagentWindowAction({...f,...ports,name:'subagentConversation.submit',payload:{text:'继续检查',requestId:'request-1'}}),{acceptedTaskId:'new-execution'});
  await handleSubagentWindowAction({...f,...ports,name:'subagentConversation.cancel',payload:{taskId:'new-execution'}});
  assert.equal(calls[0][1],f.record.binding);assert.equal(calls[1][1],f.record.binding);
  for(const payload of [{text:'替换',requestId:'x',taskId:'other'},{text:'',requestId:'x'},{text:'hello'},[]])
    await assert.rejects(handleSubagentWindowAction({...f,...ports,name:'subagentConversation.submit',payload}));
  await assert.rejects(handleSubagentWindowAction({...f,...ports,name:'subagentConversation.cancel',payload:{taskId:'other',parentTaskId:'other'}}));
  assert.equal(calls.length,2,'invalid targets must not reach execution ports');
});

test('all-conversations window pages and opens validated identities but cannot send or cancel work',async()=>{
  const f=fixture(),calls=[];
  const ports={event:f.event,window:f.record.window,list:input=>{calls.push(['list',input]);return {items:[]};},open:input=>{calls.push(['open',input]);return {opened:true};}};
  assert.deepEqual(await handleSubagentListAction({...ports,name:'subagentConversations.list',payload:{cursor:'page-2'}}),{items:[]});
  await handleSubagentListAction({...ports,name:'subagentConversations.open',payload:{parentTaskId:'parent',taskId:'child'}});
  assert.deepEqual(calls,[['list',{cursor:'page-2'}],['open',{parentTaskId:'parent',taskId:'child'}]]);
  for(const name of ['task.submit','subagentConversation.submit','subagentConversation.cancel','authorization.respond'])await assert.rejects(handleSubagentListAction({...ports,name}));
  await assert.rejects(handleSubagentListAction({...ports,name:'subagentConversations.list',payload:{cursor:'page',query:'unexpected'}}));
  await assert.rejects(handleSubagentListAction({...ports,name:'subagentConversations.open',payload:{parentTaskId:'parent',taskId:'child',text:'unexpected'}}));
  await assert.rejects(handleSubagentListAction({...ports,name:'subagentConversations.close',payload:{}}));
  assert.equal(calls.length,2);
});
