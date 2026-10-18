import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSubagentWindowAction} from '../electron/subagent-window-actions.js';

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
