import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createMicrophoneCaptureHost} from '../electron/microphone-capture-host.js';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';
import {createVoicePcmFrameSourcePort} from '@personal-agent/voice';
import {AgentArtsRealtimeModelGateway} from '@personal-agent/models';
class SyntheticSocket extends EventEmitter{
  static instances=[];readyState=0;bufferedAmount=0;sent=[];
  constructor(){super();SyntheticSocket.instances.push(this);queueMicrotask(()=>{this.readyState=1;this.emit('open');});}
  send(raw){const frame=JSON.parse(raw);this.sent.push(frame);if(frame.type==='session.update')queueMicrotask(()=>this.emit('message',Buffer.from('{"type":"session.updated"}')));}
  close(){this.readyState=3;queueMicrotask(()=>this.emit('close'));}terminate(){this.close();}
}
const tick=()=>new Promise(setImmediate);
for(const blocked of [false,true])test(`synthetic device broker to PCM source to real AgentArts gateway ${blocked?'classifies backpressure':'sends exact 3200-byte PCM'}`,async()=>{
  let live,microphone,micToken;const diagnostics=[];
  const contents={mainFrame:{},isDestroyed:()=>false,send(channel,message){
    if(channel==='desktop:live-command' && ['start','stop'].includes(message.type))queueMicrotask(()=>live.receive({sender:contents,senderFrame:contents.mainFrame},{token:message.token,type:message.type==='start'?'ready':'stopped'}));
    if(channel==='desktop:microphone-command'){
      micToken=message.token;queueMicrotask(()=>microphone.receive({sender:contents,senderFrame:contents.mainFrame},
        message.type==='start'?{token:micToken,type:'ready',trackLive:true,sampleRate:16000}:{token:micToken,type:'stopped',tracksStopped:true}));
    }
  }};
  const panel={webContents:contents,isDestroyed:()=>false,isVisible:()=>true};
  microphone=createMicrophoneCaptureHost({getPanel:()=>panel,permissionGate:{grant:()=>()=>{}}});
  const gateway=new AgentArtsRealtimeModelGateway({websocketUrl:'wss://agentarts.example.test/runtimes/voice/ws?endpoint=fixed-release',
    authorizationProvider:{read:async()=>'Bearer synthetic-outer'},websocketAuthorizationProvider:{read:async()=>'Bearer synthetic-inner'}},SyntheticSocket);
  live=createLiveVoiceHost({getPanel:()=>panel,config:{snapshot:()=>({configured:true}),current:()=>({route:'agentarts-wss'})},microphoneHost:microphone,
    createSource:()=>createVoicePcmFrameSourcePort(microphone.binding),createGateway:()=>gateway,createConsumer:()=>({}),client:{},readContext:()=>({}),
    onDiagnostic:entry=>diagnostics.push(entry)});
  try{
    await live.start();const socket=SyntheticSocket.instances.at(-1);assert.equal(live.snapshot().status,'listening');
    if(blocked)socket.bufferedAmount=128001;
    const pcm=new Uint8Array(3200).fill(127);
    microphone.receive({sender:contents,senderFrame:contents.mainFrame},{type:'frame',token:micToken,data:pcm});await tick();await tick();
    if(blocked){
      assert.equal(live.snapshot().audioSendFailure.code,'SEND_BACKPRESSURE');assert.equal(live.snapshot().audioSendFailure.frameBytes,3200);
      assert.equal(live.snapshot().audioSendFailure.sampleRateHz,16000);assert.match(live.snapshot().reason,/网络发送阻塞/);
      assert.equal(socket.sent.filter(frame=>frame.type==='input_audio_buffer.append').length,0);
    }else{
      const frame=socket.sent.find(frame=>frame.type==='input_audio_buffer.append');assert.equal(Buffer.from(frame.audio,'base64').byteLength,3200);
      assert.equal(live.snapshot().status,'listening');assert.ok(diagnostics.some(entry=>entry.stage==='microphone'&&entry.status==='ready'));
    }
    assert.equal(pcm.every(byte=>byte===0),true);assert.doesNotMatch(JSON.stringify(diagnostics),/synthetic-outer|synthetic-inner|audio"|transcript/);
  }finally{await live.stop();}
});
