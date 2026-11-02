import test from 'node:test';
import assert from 'node:assert/strict';
import {createHuaweiSisRecognitionPort,createHuaweiSisOutputPort,VOICE_AUDIO_FORMAT} from '../dist/index.js';

const request=()=>({sessionId:'explicit-fixture',replyId:'reply-fixture',text:'public fixture',locale:'zh-CN',
  deadline:new Date(Date.now()+30000).toISOString(),signal:new AbortController().signal});

test('SIS configured with production content guard cannot send unclassified raw audio',async()=>{
  let reads=0,sends=0,prepared=0;
  const port=createHuaweiSisRecognitionPort({region:'cn-north-4',projectId:'fixture',
    tokenPort:{getSisToken:async()=>{reads++;return 'fixture';}},fetchImpl:async()=>{sends++;throw Error('no send');},
    preparePayload:async()=>{prepared++;return {assertBeforeSend(){}};}});
  await assert.rejects(port.recognize({...request(),audio:new Uint8Array(320),format:VOICE_AUDIO_FORMAT,durationMs:10}).result,
    error=>error.code==='UNSUPPORTED_CAPABILITY');
  assert.equal(reads,0);assert.equal(sends,0);assert.equal(prepared,0);
});

test('SIS text output prepares actual body then checks it immediately before transport',async()=>{
  const order=[];let original;
  const port=createHuaweiSisOutputPort({region:'cn-north-4',projectId:'fixture',tokenPort:{getSisToken:async()=> 'fixture'},
    playback:{playWav(){throw Error('no successful TTS claimed');}},
    preparePayload:async scope=>{original=scope;order.push('prepare');return {assertBeforeSend(actual){
      assert.equal(scope.isCurrent(),true);assert.equal(actual.destination,scope.destination);assert.equal(actual.payload,scope.payload);order.push('assert');}};},
    fetchImpl:async(url,init)=>{assert.equal(url,original.destination);assert.equal(init.body,original.payload);order.push('fetch');return new Response('',{status:500});}});
  await assert.rejects(port.speak(request()).result,error=>error.code==='EXTERNAL_FAILURE');
  assert.deepEqual(order,['prepare','assert','fetch']);assert.equal(JSON.parse(original.payload).text,'public fixture');
});
