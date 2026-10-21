import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationDigest as digest} from '@personal-agent/notifications';
import {createDesktopVoiceCommandHost} from '../electron/voice-command-host.js';

// Synthetic trusted audio receipts: voice may focus the real card, never sign its decision.
function fixture(){
  let time=Date.now(),focused=0,writes=0,responses=0,sequence=0;
  let current={questionId:'formal',revision:2,state:'pending',sourceApprovalId:'original',taskId:'task',
    argumentsDigest:'a'.repeat(64),expiresAt:new Date(time+30000).toISOString(),requirements:[{summary:'Only this write'}]};
  const voice=createDesktopVoiceCommandHost({now:()=>time,readCurrentQuestion:()=>current,focusQuestion:()=>{focused++;},
    notifications:{configureSettings:()=>{writes++;}},respondApproval:()=>{responses++;}});
  const final=(card,text='同意',extra={})=>({source:'live_input_audio',phase:'final',origin:'user',echo:false,sessionId:'live',utteranceId:String(++sequence),
    text,transcriptDigest:digest(text),startedAt:new Date(time).toISOString(),completedAt:new Date(time).toISOString(),expiresAt:card.expiresAt,
    questionId:card.questionId,questionRevision:card.revision,argumentsDigest:card.argumentsDigest,signal:new AbortController().signal,...extra});
  return {voice,final,focused:()=>focused,writes:()=>writes,responses:()=>responses,set:value=>{current=value;},advance:()=>{time+=30001;}};
}
test('oral yes and no only guide to the same formal card; no settings or Policy mutation',async()=>{
  const f=fixture(),card=f.voice.snapshot();
  for(const text of ['同意','确认','不同意','拒绝']){
    const result=await f.voice.consumeFinal(f.final(card,text));assert.equal(result.consumed,false);assert.equal(result.state,'awaiting_card');
    assert.equal(result.questionId,card.questionId);assert.equal(f.voice.snapshot().state,'pending');
  }
  assert.equal(f.focused(),4);assert.equal(f.responses(),0);assert.equal(f.writes(),0);
  assert.throws(()=>f.voice.prepareSettings({patch:{mode:'silent'}}),/不能另建或口头/);
  assert.equal(f.voice.prepareApproval({approvalId:'original'}).questionId,card.questionId);
  assert.throws(()=>f.voice.prepareApproval({approvalId:'other'}),/正式提问卡/);
  assert.equal(f.voice.cancel().state,'pending');assert.equal(f.voice.reconcile().state,'pending');
});
test('partial, model, echo, substituted identity, duplicate and expired finals cannot select a card',async()=>{
  const f=fixture(),card=f.voice.snapshot();
  for(const extra of [{phase:'partial'},{origin:'model'},{echo:true},{source:'renderer'},{questionRevision:1},
    {argumentsDigest:'b'.repeat(64)},{startedAt:new Date(Date.parse(card.guidanceIssuedAt)-1).toISOString()}]){
    assert.equal((await f.voice.consumeFinal(f.final(card,'同意',extra))).consumed,false);
  }
  assert.equal(f.focused(),0);const receipt=f.final(card);await f.voice.consumeFinal(receipt);
  assert.equal((await f.voice.consumeFinal(receipt)).reason,'duplicate_final');
  assert.equal((await f.voice.consumeFinal(f.final(card,'如果只预览就同意'))).reason,'requires_card_selection');
  f.set({...card,revision:3});assert.equal((await f.voice.consumeFinal(f.final(card))).consumed,false);
  f.advance();assert.equal(f.voice.snapshot(),null);assert.equal(f.responses(),0);assert.equal(f.writes(),0);
});
