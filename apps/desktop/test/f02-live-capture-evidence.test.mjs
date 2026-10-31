import test from 'node:test';
import assert from 'node:assert/strict';
import {createMicrophoneCaptureHost} from '../electron/microphone-capture-host.js';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';

// Actual Desktop hosts; synthetic IPC/device frames and provider events. No real
// recording, cloud ASR, acoustic echo cancellation or human listening is asserted.
test('F02 final binds real capture-host readback and exact playback drain turn without promoting acoustic flags',async()=>{
  let live,mic,request,captureToken,clock=Date.now();const commands=[];
  const deadline=new Date(clock+60000).toISOString();
  let question={questionId:'original-question',revision:1,state:'pending',taskId:'source',sourceApprovalId:'run',expiresAt:deadline};
  const contents={id:1,mainFrame:{},isDestroyed:()=>false,send(channel,message){
    commands.push({channel,...message});
    if(channel==='desktop:microphone-command'){
      captureToken=message.token;queueMicrotask(()=>mic.receive(event,{token:message.token,
        ...(message.type==='start'?{type:'ready',trackLive:true,sampleRate:16000}:{type:'stopped',tracksStopped:true})}));
    }else if(['start','stop'].includes(message.type))queueMicrotask(()=>live.receive(event,{token:message.token,type:message.type==='start'?'ready':'stopped'}));
  }};
  const event={sender:contents,senderFrame:contents.mainFrame},panel={webContents:contents,isDestroyed:()=>false,isVisible:()=>true};
  mic=createMicrophoneCaptureHost({getPanel:()=>panel,permissionGate:{grant:()=>()=>{}},confirmAuthorization:async()=>true,now:()=>clock});
  live=createLiveVoiceHost({getPanel:()=>panel,now:()=>clock,config:{snapshot:()=>({configured:true}),current:()=>({})},
    microphoneHost:mic,createSource:()=>({subscribe(options){let sub,release;
      const closed=new Promise(resolve=>{release=resolve;});
      const ready=mic.binding.start({onFrame:data=>options.onFrame({data})}).then(value=>{sub=value;});
      return {ready,closed,unsubscribe(){void ready.then(()=>sub.release()).then(release);}};
    },dispose:async()=>{}}),createGateway:()=>({async connect(value){request=value;return {sendAudio(){},interrupt(){},close:async()=>{},askUserQuestion:()=>({accepted:true})};}}),
    createConsumer:()=>({}),client:{},readContext:()=>'',onTranscript(){},readConversationId:()=> 'voice-test',readCurrentQuestion:()=>question,authorizeFinalRead:()=>true});
  try{
    await live.start();const queued=live.askCurrentQuestion();assert.equal(queued.state,'queued');assert.equal(queued.questionRevision,1);
    const liveToken=commands.find(item=>item.channel==='desktop:live-command'&&item.type==='start').token;
    const binding={questionId:question.questionId,questionRevision:1,conversationId:'voice-test',sourceTaskId:'source',sourceApprovalId:'run',deadline,signal:new AbortController().signal};
    request.onEvent({type:'audio',data:Uint8Array.of(1,0)});
    request.onEvent({type:'transcript',id:'assistant-question',role:'assistant',phase:'final',text:'请在当前对话的原授权卡中决定；语音回答不会批准。'});
    request.onEvent({type:'turn_complete'});const drain=commands.at(-1);assert.ok(drain.drainId);
    live.receive(event,{token:liveToken,type:'drained',drainId:'older-turn'});assert.equal(live.readQuestionDelivery(binding),undefined);
    live.receive(event,{token:liveToken,type:'drained',drainId:drain.drainId});
    const playback=live.readQuestionDelivery(binding);assert.equal(playback.audioFrames,1);assert.equal(playback.playbackVerified,false);
    clock++;
    request.onEvent({type:'speech_started',utteranceId:'utterance'});
    mic.receive(event,{type:'frame',token:captureToken,data:Uint8Array.of(3,4,5,6)});
    request.onEvent({type:'speech_stopped',utteranceId:'utterance'});
    const final={type:'transcript',id:'utterance',utteranceId:'utterance',role:'user',source:'input_audio',phase:'final',text:'合成问题回答'};
    request.onEvent({...final,phase:'partial'});assert.equal(live.readFinalCaptureEvidence(binding),undefined);
    request.onEvent(final);const receipt=live.readFinalUserAudio(binding),evidence=live.readFinalCaptureEvidence(binding);
    assert.equal(receipt.echo,'unknown');assert.equal(receipt.questionPlaybackVerified,false);
    assert.equal(evidence.capture.end.frames-evidence.capture.start.frames,1);
    assert.equal(evidence.capture.end.bytes-evidence.capture.start.bytes,4);
    assert.equal(evidence.transcriptDigest,receipt.transcriptDigest);
    assert.equal(live.readFinalCaptureEvidence({...binding,questionRevision:2}),undefined);
    question={...question,revision:2};assert.equal(live.readFinalUserAudio(binding),undefined);
    assert.equal(live.readQuestionDelivery(binding),undefined);
  }finally{await live.stop();}
});
