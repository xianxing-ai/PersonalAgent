import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';

// Synthetic provider events and PCM: proves host boundaries only, not an ASR,
// hardware echo cancellation, question playback or physical-device acceptance.
async function fixture({withAuthorization=true}={}) {
  let host,request,frames,sessionId,authorized=true;
  const now=Date.now(),deadline=new Date(now+60_000).toISOString();
  let question={questionId:'question',revision:2,state:'pending',taskId:'original-task',sourceApprovalId:'original-run',expiresAt:deadline};
  const contents={mainFrame:{},isDestroyed:()=>false,send(_channel,message){sessionId=message.token;
    if(['start','stop'].includes(message.type))queueMicrotask(()=>host.receive({sender:contents,senderFrame:contents.mainFrame},
      {token:message.token,type:message.type==='start'?'ready':'stopped'}));}};
  host=createLiveVoiceHost({getPanel:()=>({webContents:contents,isDestroyed:()=>false,isVisible:()=>true}),now:()=>now,
    config:{snapshot:()=>({configured:true}),current:()=>({})},microphoneHost:{authorize(){},revoke:async()=>{}},
    createSource:()=>({subscribe(options){frames=options;return {ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}};},dispose:async()=>{}}),
    createGateway:()=>({async connect(value){request=value;return {sendAudio(){},interrupt(){},close:async()=>{}};}}),
    createConsumer:()=>({}),client:{},readContext:()=>'',onTranscript(){},readConversationId:()=> 'fixture',readCurrentQuestion:()=>question,
    ...(withAuthorization?{authorizeFinalRead:()=>authorized}:{})});
  await host.start();
  const binding={sessionId,utteranceId:'voice-item',questionId:'question',questionRevision:2,conversationId:'fixture',
    sourceTaskId:'original-task',sourceApprovalId:'original-run',deadline,signal:new AbortController().signal};
  const speech=()=>{request.onEvent({type:'speech_started',utteranceId:'voice-item'});frames.onFrame({data:Uint8Array.of(0,0)});
    request.onEvent({type:'speech_stopped',utteranceId:'voice-item'});};
  const final=(extra={})=>request.onEvent({type:'transcript',id:'voice-item',utteranceId:'voice-item',role:'user',
    phase:'final',source:'input_audio',text:'合成转写',...extra});
  return {host,request,frames,binding,speech,final,revoke:()=>{authorized=false;},replaceQuestion:()=>{question={...question,revision:3};}};
}

test('Live host holds only an actual final event, with unknown echo and playback and an explicit local read grant',async()=>{
  const f=await fixture();try {
    f.speech();f.final({phase:'partial'});assert.equal(f.host.readFinalUserAudio(f.binding),undefined);
    f.final({source:'output_audio'});assert.equal(f.host.readFinalUserAudio(f.binding),undefined);
    f.final();const result=f.host.readFinalUserAudio(f.binding);
    assert.equal(result.text,'合成转写');assert.equal(result.phase,'final');assert.equal(result.echo,'unknown');
    assert.equal(result.questionPlaybackVerified,false);assert.equal(result.questionRevision,2);
    const {sessionId:ignoredSession,utteranceId:ignoredUtterance,...questionBinding}=f.binding;
    assert.equal(f.host.readFinalUserAudio(questionBinding).utteranceId,'voice-item');
    assert.equal(f.host.readFinalUserAudio({...f.binding,questionId:'other'}),undefined);
    f.revoke();assert.equal(f.host.readFinalUserAudio(f.binding),undefined);
  }finally{await f.host.stop();}
});

test('Live receipt is unavailable without captured frames, local authorization, or the original question',async()=>{
  const f=await fixture({withAuthorization:false});try {
    f.speech();f.final();assert.equal(f.host.readFinalUserAudio(f.binding),undefined);
  }finally{await f.host.stop();}
  const g=await fixture();try {
    g.request.onEvent({type:'speech_started',utteranceId:'voice-item'});
    g.request.onEvent({type:'speech_stopped',utteranceId:'voice-item'});g.final();
    assert.equal(g.host.readFinalUserAudio(g.binding),undefined);
    g.speech();g.final();assert.ok(g.host.readFinalUserAudio(g.binding));
    g.replaceQuestion();assert.equal(g.host.readFinalUserAudio(g.binding),undefined);
  }finally{await g.host.stop();}
});
