import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';

test('Live suppresses input until the current playback drain and tail have finished',async()=>{
  let host,request,clock=Date.now();
  const messages=[],saved=[];
  const contents={mainFrame:{},isDestroyed:()=>false,send(_channel,message){
    messages.push(message);
    if(['start','stop'].includes(message.type))queueMicrotask(()=>host.receive(
      {sender:contents,senderFrame:contents.mainFrame},{token:message.token,type:message.type==='start'?'ready':'stopped'}));
  }};
  const event={sender:contents,senderFrame:contents.mainFrame};
  host=createLiveVoiceHost({getPanel:()=>({webContents:contents,isDestroyed:()=>false,isVisible:()=>true}),now:()=>clock,
    config:{snapshot:()=>({configured:true}),current:()=>({})},microphoneHost:{authorize(){},revoke:async()=>{}},
    createSource:()=>({subscribe(){return {ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}};},dispose:async()=>{}}),
    createGateway:()=>({async connect(value){request=value;return {sendAudio(){},interrupt(){},close:async()=>{}};}}),
    createConsumer:()=>({}),client:{},readContext:()=>'',onTranscript:value=>saved.push(value)});
  try {
    await host.start();
    const token=messages.find(message=>message.type==='start').token;
    request.onEvent({type:'audio',data:Uint8Array.of(0,0)});
    request.onEvent({type:'turn_complete'});
    const drain=messages.findLast(message=>message.type==='drain');
    clock+=500;
    request.onEvent({type:'transcript',id:'before-drain',role:'user',text:'echo',phase:'final',source:'input_audio'});
    await new Promise(setImmediate);
    assert.equal(saved.some(item=>item.text==='echo'),false);
    host.receive(event,{token,type:'drained',drainId:'old-drain'});
    clock+=500;
    request.onEvent({type:'transcript',id:'after-stale-drain',role:'user',text:'stale echo',phase:'final',source:'input_audio'});
    await new Promise(setImmediate);
    assert.equal(saved.some(item=>item.text==='stale echo'),false);
    assert.equal(typeof drain.drainId,'string');
    request.onEvent({type:'audio',data:Uint8Array.of(0,0)});
    host.receive(event,{token,type:'drained',drainId:drain.drainId});
    clock+=500;
    request.onEvent({type:'transcript',id:'overlap',role:'user',text:'overlapping echo',phase:'final',source:'input_audio'});
    await new Promise(setImmediate);
    assert.equal(saved.some(item=>item.text==='overlapping echo'),false);
    request.onEvent({type:'turn_complete'});
    const currentDrain=messages.findLast(message=>message.type==='drain');
    assert.notEqual(currentDrain.drainId,drain.drainId);
    host.receive(event,{token,type:'drained',drainId:currentDrain.drainId});
    clock+=351;
    request.onEvent({type:'transcript',id:'fresh',role:'user',text:'fresh speech',phase:'final',source:'input_audio'});
    await new Promise(setImmediate);
    assert.equal(saved.some(item=>item.text==='fresh speech'),true);
  } finally {await host.stop();}
});
