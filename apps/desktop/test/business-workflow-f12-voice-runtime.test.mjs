import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {scenario} from './fixtures/f12-runtime-scenario.mjs';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';
import {createDesktopNotificationApplicationHost} from '../electron/notification-application-host.js';

// Real original Engine/Runtime/SQLite/Policy/questions/NotificationService/Live host.
// The cloud, selector, question answers and renderer events remain explicit fixtures.
async function run(t,options={}) {
  const spoken=[],drains=[];let live,request;
  const f=await scenario(t,{voice:true,...options,createVoiceHost:async({getApplication})=>{
    const contents={mainFrame:{},isDestroyed:()=>false,send(_channel,message){
      if(['start','stop'].includes(message.type))queueMicrotask(()=>live.receive({sender:contents,senderFrame:contents.mainFrame},
        {token:message.token,type:message.type==='start'?'ready':'stopped'}));
      if(message.type==='drain'&&message.drainId){drains.push(message.drainId);
        setTimeout(()=>live.receive({sender:contents,senderFrame:contents.mainFrame},{token:message.token,type:'drained',drainId:message.drainId}),10);}
    }};
    live=createLiveVoiceHost({getPanel:()=>({webContents:contents,isDestroyed:()=>false,isVisible:()=>true}),
      config:{snapshot:()=>({configured:true}),current:()=>({})},readConversationId:()=>options.foreignSession?'foreign':'fixture-chat',
      microphoneHost:{authorize(){},revoke:async()=>{}},createSource:()=>({subscribe:()=>({ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}}),dispose:async()=>{}}),
      createGateway:()=>({async connect(value){request=value;return {sendAudio(){},interrupt(){},close:async()=>{},speakText(text){
        spoken.push(text);setTimeout(()=>{
          if(options.revokeDuringSpeech){const app=getApplication();const task=app.runtime.listTasks({limit:100}).items.find(task=>app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName==='workflow.host.f12_n04');
            app.runtime.policy.revoke('host-tool-'+task.taskId);}
          const binding={responseId:'voice-response',renditionId:'voice-rendition'};
          request.onEvent({type:'audio',...binding,data:Uint8Array.of(0,0)});
          request.onEvent({type:'transcript',...binding,id:'voice-final',role:'assistant',phase:'final',source:'output_audio',text:options.replaceText?'替换文本':text});
          request.onEvent({type:'turn_complete',...binding});
        },10);return {accepted:true,renditionId:'voice-rendition'};
      }};}}),createConsumer:()=>({}),client:{},readContext:()=>'',onTranscript(){}});
    await live.start();t.after(()=>live.stop());return live;
  }});
  const candidates=f.app.runtime.listTasks({limit:100}).items.filter(task=>f.app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName==='workflow.host.f12_n04');
  const original=candidates.find(task=>f.host.readVoiceDelivery({taskId:task.taskId,roundId:f.app.runtime.loadCheckpoint(task.taskId,'host-tool-intent').arguments.roundId}))??candidates[0];
  const roundId=original&&f.app.runtime.loadCheckpoint(original.taskId,'host-tool-intent').arguments.roundId;
  return {...f,spoken,drains,original,round:roundId&&f.host.runtimeHost.getInterruptionRound(roundId),
    receipt:original&&f.host.readVoiceDelivery({taskId:original.taskId,roundId})};
}

test('original F12 voice policy runs one rendition and reads renderer drain while remaining unknown, unread and non-replayable',async t=>{
  const f=await run(t,{multi:true,repeat:true});
  assert.equal(f.spoken.length,1,JSON.stringify(f.diagnostics));assert.equal(f.sends,0);
  assert.ok(f.approvals.includes('workflow.host.f12_n04'));assert.equal(f.drains.length,1);
  assert.equal(f.receipt.state,'renderer_completed');assert.equal(f.receipt.playbackVerified,false);
  assert.equal(f.round.attempts.voice.state,'unknown');assert.equal(f.round.counted,true);assert.equal(f.round.attempts.banner,undefined);
  assert.equal(f.child.state,'waiting_reconciliation');assert.notEqual(f.repeated.state,'succeeded');
  assert.equal(f.host.snapshot().feed.items.every(item=>item.unread&&!item.deliveredAt),true);
  const record=f.app.runtime.readToolExecutions(f.original.taskId).find(record=>record.evidenceId==='host-tool-'+f.original.taskId);
  assert.equal(record.policyDecision,'allow');assert.equal(record.executionStarted,true);assert.equal(record.state,'unknown');
  await assert.rejects(f.host.deliverRound({roundId:f.round.roundId,channel:'voice',title:'replacement',body:'replacement'}),/./);
  const restoredHost=createDesktopNotificationApplicationHost({namespace:'f12',channel:{sendAdvisoryNotification(){throw Error('no retry');},readDeliveryOutcome(){}}});
  const restored=createRuntimeApplication({path:path.join(f.userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'f12',tools:restoredHost.tools});
  try {
    restoredHost.bindApplication(restored);
    assert.deepEqual(restoredHost.readVoiceDelivery({taskId:f.original.taskId,roundId:f.round.roundId}),f.receipt);
    assert.equal(restoredHost.runtimeHost.getInterruptionRound(f.round.roundId).attempts.voice.state,'unknown');
    await assert.rejects(restoredHost.deliverRound({roundId:f.round.roundId,channel:'voice',title:'PersonalAgent 通知',body:'有 2 条更新，请查看通知列表。',
      authority:{context:{taskId:f.original.taskId,runId:'host-tool-'+f.original.taskId,authorizationRef:'host-tool-'+f.original.taskId,
        signal:new AbortController().signal,deadline:f.round.expiresAt},assertCurrent(){}}}),/独立 Policy/);
    assert.equal(f.spoken.length,1);
  }finally{restoredHost.dispose();restored.close();}
});

for(const option of ['replaceText','revokeDuringSpeech'])test('F12 voice '+option+' never confirms delivery or resends',async t=>{
  const f=await run(t,{[option]:true,repeat:true});
  assert.equal(f.spoken.length,option==='foreignSession'?0:1,JSON.stringify(f.diagnostics));
  assert.equal(f.sends,0);assert.equal(f.round.attempts.voice.state,'unknown');assert.notEqual(f.receipt.state,'renderer_completed');
  assert.equal(f.host.snapshot().feed.items.every(item=>item.unread&&!item.deliveredAt),true);
});

test('F12 voice requires the active original conversation before admitting the graph',async t=>{
  const f=await run(t,{foreignSession:true});assert.equal(f.spoken.length,0);assert.equal(f.round,undefined);
  assert.equal(f.receipt,undefined);assert.equal(f.child.state,'failed');
});

for(const option of [{denyTool:'workflow.host.f12_n04'},{cancelBeforeSend:true},{withdrawBeforeSend:true}])test('F12 original approval/source prevents voice send '+JSON.stringify(option),async t=>{
  const f=await run(t,option);assert.equal(f.spoken.length,0);assert.equal(f.sends,0);assert.equal(f.round,undefined);
});
