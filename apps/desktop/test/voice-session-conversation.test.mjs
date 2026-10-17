import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';
import {createLiveVoiceHistory} from '../electron/live-voice-history.js';
import {createLiveHistoryQueue} from '../electron/live-history-queue.js';
import {createDesktopSisConfigHost} from '../electron/huawei-sis-config.js';
test('Live binds speech history, context and accepted work to its original conversation while panel switches',async()=>{
  let host,request,current='desktop-panel:a',consumerConversation;const saved=[],submitted=[],reads=[];
  const contents={mainFrame:{},isDestroyed:()=>false,send(_channel,message){if(['start','stop'].includes(message.type))queueMicrotask(()=>host.receive({sender:contents,senderFrame:contents.mainFrame},{token:message.token,type:message.type==='start'?'ready':'stopped'}));}};
  host=createLiveVoiceHost({getPanel:()=>({webContents:contents,isDestroyed:()=>false,isVisible:()=>true}),config:{snapshot:()=>({configured:true}),current:()=>({})},
    readConversationId:()=>current,readContext:({conversationId})=>{reads.push(conversationId);return {messages:[{role:'user',text:'history '+conversationId}]};},
    onTranscript:message=>saved.push(message),onTaskSubmitted:message=>submitted.push(message),
    microphoneHost:{authorize(){},revoke:async()=>{}},createSource:()=>({subscribe:()=>({ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}}),dispose:async()=>{}}),
    createGateway:()=>({connect:async value=>{request=value;return {sendAudio(){},close:async()=>{}};}}),client:{call:async()=>({taskId:'accepted'})},
    createConsumer:options=>{consumerConversation=options.conversationId;return {consume:({text})=>({result:options.client.call('task.submit',{goal:text}).then(()=>({replyText:'accepted'}))})};}});
  try{
    await host.start();current='desktop-panel:b';request.onEvent({type:'transcript',id:'speech',role:'user',text:'synthetic transcript'});
    await request.onTool('request_work',{goal:'synthetic goal'},'call1');const context=await request.onTool('read_context',{},'call2');
    assert.equal(saved[0].conversationId,'desktop-panel:a');assert.equal(submitted[0].conversationId,'desktop-panel:a');assert.equal(consumerConversation,'desktop-panel:a');
    assert.ok(reads.every(id=>id==='desktop-panel:a'));assert.match(context,/history desktop-panel:a/);assert.doesNotMatch(context,/desktop-panel:b/);
    assert.equal(host.historyMessages({conversationId:'desktop-panel:a'}).length,1);assert.equal(host.historyMessages({conversationId:'desktop-panel:b'}).length,0);
  }finally{await host.stop();}
});
test('recovery queue preserves conversation identity and context never leaks another conversation',()=>{
  let persisted=[];const queue=createLiveHistoryQueue({store:{read:()=>persisted,write:value=>{persisted=structuredClone(value);}}});
  const history=createLiveVoiceHistory({save(){throw Error('offline');},queue});
  history.record({id:'a',sessionId:'s',role:'user',text:'private A',createdAt:new Date().toISOString(),conversationId:'desktop-panel:a'});
  assert.equal(persisted[0].conversationId,'desktop-panel:a');assert.deepEqual(history.context({conversationId:'desktop-panel:b'}),[]);
  assert.throws(()=>history.record({id:'a',sessionId:'s',role:'user',text:'retarget',createdAt:new Date().toISOString(),conversationId:'desktop-panel:b'}));
});
test('missing SIS configuration reports exact credential presence and unavailable AA proxy without exposing secrets',()=>{
  const host=createDesktopSisConfigHost({userData:new URL('./nonexistent-sis-fixture/',import.meta.url).pathname,env:{PA_HUAWEI_SIS_REGION:'cn-north-4'},safeStorage:{}});
  const snapshot=host.snapshot();assert.equal(snapshot.configured,false);assert.deepEqual(snapshot.missingFields,['projectId','iamToken']);
  assert.equal(snapshot.route,'direct-huawei-sis');assert.equal(snapshot.agentArtsProxy,'unavailable');assert.equal(snapshot.credentialSource,'environment');
});
