import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runAgentArtsTextOutputProbe} from './agentarts-text-output-probe.mjs';
const options=gateway=>({gateway,deadline:new Date(Date.now()+500).toISOString(),signal:new AbortController().signal});
test('synthetic gateway: submission alone is insufficient; complete audio has exact digest',async()=>{
  const bytes=new Uint8Array([1,2,3,4]);let closed=0,sunk=[];
  const result=await runAgentArtsTextOutputProbe({...options({async connect(request){return {
    speakText(text){assert.ok(text);request.onEvent({type:'audio',data:bytes,responseId:'fixture'});
      request.onEvent({type:'transcript',role:'assistant',source:'output_audio',phase:'final',text:'fixture'});
      request.onEvent({type:'turn_complete'});return {accepted:true};},async close(){closed++;}};}}),onAudio:chunk=>sunk.push(...chunk)});
  assert.equal(result.status,'passed');assert.equal(closed,1);assert.deepEqual(sunk,[1,2,3,4]);
  assert.equal(result.outputAudioSha256,createHash('sha256').update(bytes).digest('hex'));
  assert.match(result.verification,/no_playback/);
});
test('synthetic acceptance/empty turn cannot claim delivered audio',async()=>{
  const result=await runAgentArtsTextOutputProbe(options({async connect(request){return {
    speakText(){request.onEvent({type:'turn_complete'});return {accepted:true};},async close(){}};}}));
  assert.equal(result.accepted,true);assert.equal(result.status,'unknown');assert.equal(result.checks.outputAudio,false);
});
test('synthetic gateway errors are redacted and audio bounded',async()=>{
  for(const event of [{type:'error',message:'private-secret'},{type:'audio',data:new Uint8Array(8)}]){
    const result=await runAgentArtsTextOutputProbe({...options({async connect(request){return {
      speakText(){request.onEvent(event);return {accepted:true};},async close(){}};}}),maxAudioBytes:4});
    assert.equal(result.status,'failed');assert.equal(JSON.stringify(result).includes('private-secret'),false);
  }
});
test('deadline closes idle session; pre-cancel never connects',async()=>{
  let closed=0;const result=await runAgentArtsTextOutputProbe({...options({async connect(){return {
    speakText(){return {accepted:true};},async close(){closed++;}};}}),deadline:new Date(Date.now()+15).toISOString()});
  assert.equal(result.status,'unknown');assert.equal(result.reason,'deadline');assert.equal(closed,1);
  const controller=new AbortController();controller.abort();
  const cancelled=await runAgentArtsTextOutputProbe({...options({connect(){throw Error('must not connect');}}),signal:controller.signal});
  assert.equal(cancelled.reason,'cancelled');assert.equal(cancelled.status,'unknown');
});
