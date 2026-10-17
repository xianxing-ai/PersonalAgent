import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runAgentArtsRealtimeProbe,parseRealtimeProbeWav} from './agentarts-realtime-probe.mjs';
const options=gateway=>({gateway,pcmBytes:new Uint8Array(640),deadline:new Date(Date.now()+1000).toISOString(),signal:new AbortController().signal,pace:false});
test('fake gateway establishes strict milestones and audio digest; no device or network involved',async()=>{
 let sent=0,closed=0;const output=new Uint8Array([1,2,3,4]);
 const result=await runAgentArtsRealtimeProbe(options({connect:async request=>({sendAudio(bytes){sent+=bytes.length;if(sent>=640+38400)queueMicrotask(()=>{
  request.onEvent({type:'transcript',role:'user',source:'input_audio',phase:'final',text:'fixture input'});
  request.onEvent({type:'transcript',role:'assistant',source:'output_audio',phase:'final',text:'fixture output'});
  request.onEvent({type:'audio',data:output});request.onEvent({type:'turn_complete'});
 });},async close(){closed++;}})}));
 assert.equal(result.status,'passed');assert.equal(result.inputAudioBytes,39040);assert.equal(closed,1);
 assert.equal(result.outputAudioSha256,createHash('sha256').update(output).digest('hex'));assert.ok(Object.values(result.checks).every(Boolean));
});
test('turn without transcript/audio is unknown and gateway errors are failed without leaking message',async()=>{
 for(const [event,status]of [[{type:'turn_complete'},'unknown'],[{type:'error',message:'private-key'},'failed']]){
  let first=true;const result=await runAgentArtsRealtimeProbe(options({connect:async request=>({sendAudio(){if(first){first=false;request.onEvent(event);}},async close(){}})}));
  assert.equal(result.status,status);assert.equal(JSON.stringify(result).includes('private-key'),false);
 }
});
test('WAV parser accepts only intact mono 16k PCM16',()=>{
 const wav=Buffer.alloc(48);wav.write('RIFF');wav.writeUInt32LE(40,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
 wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4,40);
 assert.equal(parseRealtimeProbeWav(wav).length,4);wav.writeUInt16LE(2,22);assert.throws(()=>parseRealtimeProbeWav(wav));
});
