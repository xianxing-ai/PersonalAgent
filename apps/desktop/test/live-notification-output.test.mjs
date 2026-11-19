import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';

// Actual Live host and IPC receiver; cloud/device events are explicit fixtures.
async function fixture(t,{missingIdentity=false,revokeBeforeSend=false}={}) {
  let host,request,token,question,current=true;
  const sent=[],spoken=[],receipts=[],controller=new AbortController();
  const contents={mainFrame:{},isDestroyed:()=>false,send(_channel,message){sent.push(message);token=message.token;
    if(['start','stop'].includes(message.type))queueMicrotask(()=>receive({token:message.token,type:message.type==='start'?'ready':'stopped'}));}};
  const receive=message=>host.receive({sender:contents,senderFrame:contents.mainFrame},message);
  host=createLiveVoiceHost({getPanel:()=>({webContents:contents,isDestroyed:()=>false,isVisible:()=>true}),
    config:{snapshot:()=>({configured:true}),current:()=>({})},readConversationId:()=>'original-conversation',
    microphoneHost:{authorize(){},revoke:async()=>{}},
    createSource:()=>({subscribe:()=>({ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}}),dispose:async()=>{}}),
    createGateway:()=>({async connect(value){request=value;return {sendAudio(){},interrupt(){},close:async()=>{},
      speakText(text){spoken.push(text);return {accepted:true,...(!missingIdentity?{renditionId:'original-rendition'}:{})};},
      askUserQuestion(){return {accepted:true};}};}}),
    createConsumer:()=>({}),client:{},readContext:()=>'',onTranscript(){},readCurrentQuestion:()=>question});
  await host.start();t.after(()=>host.stop());
  const binding={roundId:'original-round',taskId:'original-task',runId:'original-run',conversationId:'original-conversation',
    text:'公开合成通知，请查看通知列表。',deadline:new Date(Date.now()+30000).toISOString(),signal:controller.signal};
  const speak=()=>host.speakNotification(binding,{assertCurrent(){if(!current)throw Error('source withdrawn');},onReceipt:r=>{
    receipts.push(r);if(revokeBeforeSend)current=false;
  }});
  const event=(type,extra={})=>request.onEvent({type,responseId:'original-response',renditionId:'original-rendition',...extra});
  const render=()=>{event('audio',{data:Uint8Array.of(0,0)});event('transcript',{id:'original-final',role:'assistant',phase:'final',source:'output_audio',text:binding.text});event('turn_complete');};
  return {host,binding,speak,event,render,spoken,receipts,sent,controller,receive:message=>receive({token,...message}),
    get drain(){return sent.findLast(message=>message.type==='drain'&&message.drainId);},
    revoke(){current=false;},question(){question={state:'pending',questionId:'question',revision:1,expiresAt:binding.deadline};}};
}

test('notification binds original rendition, response, exact text and dedicated drain without claiming playback',async t=>{
  const f=await fixture(t);assert.equal(f.speak().state,'accepted');f.render();
  assert.ok(f.drain?.drainId);f.receive({type:'drained'});f.receive({type:'drained',drainId:'old-question-drain'});
  assert.equal(f.host.readNotificationDelivery(f.binding).state,'draining');
  assert.equal(f.host.snapshot().status,'speaking','an old drain cannot release the original notification');
  f.receive({type:'drained',drainId:f.drain.drainId});const receipt=f.host.readNotificationDelivery(f.binding);
  assert.equal(receipt.state,'renderer_completed');assert.equal(receipt.playbackVerified,false);
  assert.equal(receipt.audioFrames,1);assert.equal(receipt.responseId,'original-response');assert.equal(receipt.renditionId,'original-rendition');
  assert.equal(receipt.text,undefined);assert.equal(receipt.roundId,f.binding.roundId);assert.equal(receipt.runId,f.binding.runId);
  assert.equal(f.speak().state,'renderer_completed');assert.equal(f.spoken.length,1);
  assert.equal(f.host.readQuestionDelivery({conversationId:f.binding.conversationId,deadline:f.binding.deadline,signal:f.binding.signal}),undefined);
  assert.equal(f.host.readNotificationDelivery({...f.binding,runId:'replacement'}),undefined);
  assert.throws(()=>f.host.speakNotification({...f.binding,text:'替换通知'},{assertCurrent(){},onReceipt(){}}),/绑定其他参数/);
});

for(const mode of ['response','rendition','text','no-audio','interrupted','authority','cancelled'])test('notification refuses '+mode+' and never repeats the original rendition',async t=>{
  const f=await fixture(t);f.speak();
  if(mode==='authority')f.revoke();
  if(mode==='cancelled')f.controller.abort();
  if(mode==='interrupted')f.event('interrupted');
  if(mode!=='no-audio')f.event('audio',{data:Uint8Array.of(0,0),...(mode==='response'?{responseId:'foreign'}:{}),...(mode==='rendition'?{renditionId:'foreign'}:{})});
  f.event('transcript',{id:'final',role:'assistant',phase:'final',source:'output_audio',text:mode==='text'?'替换文本':f.binding.text});f.event('turn_complete');
  f.receive({type:'drained',drainId:f.drain?.drainId});
  assert.equal(f.receipts.at(-1).state,'unknown');assert.equal(f.receipts.some(r=>r.state==='renderer_completed'),false);
  if(mode==='authority'||mode==='cancelled'){
    assert.equal(f.sent.filter(message=>message.type==='audio').length,0,'revoked original audio never reaches Renderer');
    f.event('audio',{data:Uint8Array.of(0,0)});assert.equal(f.sent.filter(message=>message.type==='audio').length,0,'late cancelled audio stays blocked');
  }
  try{f.speak();}catch{}assert.equal(f.spoken.length,1);
});

test('notification cannot borrow question, another conversation, or a legacy provider accepted result',async t=>{
  const f=await fixture(t,{missingIdentity:true});
  assert.throws(()=>f.host.speakNotification({...f.binding,conversationId:'foreign'},{assertCurrent(){},onReceipt(){}}),/不可播报/);
  assert.equal(f.speak().state,'unknown');f.render();f.receive({type:'drained',drainId:f.drain.drainId});
  assert.equal(f.speak().state,'unknown');assert.equal(f.spoken.length,1);
  f.question();assert.equal(f.host.askCurrentQuestion().state,'queued');
  assert.equal(f.host.readNotificationDelivery(f.binding).state,'unknown','a later question cannot supply the original notification receipt');
  await f.host.stop();assert.equal(f.host.readNotificationDelivery(f.binding),undefined);
});

test('pending original question excludes notification playback; lost session cannot read an old drain',async t=>{
  const f=await fixture(t);f.question();assert.throws(()=>f.speak(),/不可播报/);assert.equal(f.spoken.length,0);
  const g=await fixture(t);g.speak();g.render();await g.host.stop();
  assert.equal(g.receipts.at(-1).state,'unknown');assert.equal(g.host.readNotificationDelivery(g.binding),undefined);
});

for(const mode of ['revoke','cancel'])test('notification rechecks original authority at the asynchronous drain boundary: '+mode,async t=>{
  const f=await fixture(t);f.speak();f.render();assert.equal(f.host.readNotificationDelivery(f.binding).state,'draining');
  if(mode==='revoke')f.revoke();else f.controller.abort();
  f.receive({type:'drained',drainId:f.drain.drainId});
  assert.equal(f.receipts.at(-1).state,'unknown');assert.equal(f.receipts.some(receipt=>receipt.state==='renderer_completed'),false);
  assert.equal(f.spoken.length,1);
});

test('notification rechecks source after persisting the intent and before touching the original session',async t=>{
  const f=await fixture(t,{revokeBeforeSend:true});assert.equal(f.speak().state,'unknown');assert.equal(f.spoken.length,0);
});
