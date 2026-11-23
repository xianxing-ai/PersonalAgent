import test from 'node:test';
import assert from 'node:assert/strict';
import {compactConversationContext,mustPreserveContextMessage} from '../dist/application/context-compaction.js';
import {createContextModelSummarizer} from '../dist/application/context-compaction-model.js';

function fixture(){
  const source={configurationRef:'fixture',messages:Array.from({length:12},(_,i)=>({id:`message-${i}`,role:'user',content:`Narrative ${i} ${'material '.repeat(60)}`}))};
  const sent=[];let cached;
  const options={scope:{taskId:'task',conversationId:'conversation',cutoff:'task',deadline:'2099-01-01T00:00:00.000Z',signal:new AbortController().signal},
    policy:{version:'fixture',triggerCharacters:4000,targetCharacters:3500,maxCharacters:12000,retainMessages:2,maxSourceMessages:32,segmentCharacters:1500,maxSummaryCharacters:120},
    modelConfigurationRef:'model',readSnapshot:()=>source,compile:messages=>JSON.stringify(messages),assertCurrent(){},
    summarize:async input=>{sent.push(...input.segment.messages);input.assertBeforeSend();return `summary ${input.segment.index}`;},
    saveCheckpoint(){},remember:value=>{cached=value;}};
  return {source,sent,options,cache:()=>cached};
}

test('protected messages stay verbatim and in source order relative to summaries, including cache reuse',async()=>{
  const f=fixture();
  f.source.messages[2].content='不要删除，除非我确认。';
  f.source.messages[6].content='Only send after Friday.';
  f.source.messages[8].taskState='waiting_reconciliation';
  const protectedMessages=f.source.messages.filter(mustPreserveContextMessage);
  const result=await compactConversationContext(f.options);
  assert.equal(result.state,'compacted');
  for(const message of protectedMessages){
    assert.equal(f.sent.some(item=>item.id===message.id),false);
    assert.deepEqual(result.messages.find(item=>item.id===message.id),message);
  }
  const ids=result.messages.map(message=>message.id);
  const first=ids.indexOf('message-2'),second=ids.indexOf('message-6'),third=ids.indexOf('message-8');
  assert.ok(first>0&&second>first+1&&third>second+1,'summaries retain their relative positions');
  const before=f.sent.length;
  const reused=await compactConversationContext({...f.options,previous:f.cache()});
  assert.equal(f.sent.length,before);assert.deepEqual(reused.messages,result.messages);
});

test('all protected source exceeding budget fails without summarizing',async()=>{
  const f=fixture();for(const item of f.source.messages)item.preserveVerbatim=true;
  f.options.policy.maxCharacters=4000;
  await assert.rejects(compactConversationContext(f.options),/Verbatim constraints/);
  assert.equal(f.sent.length,0);
});

test('all withheld source within budget remains unchanged without a model call',async()=>{
  const f=fixture();for(const item of f.source.messages)item.answerWithheld=true;
  const result=await compactConversationContext(f.options);
  assert.equal(result.state,'unchanged');assert.deepEqual(result.messages,f.source.messages);
  assert.equal(f.sent.length,0);
});

test('an older checkpoint without a prefix binding cannot silently replace the original context',async()=>{
  const f=fixture();f.source.messages[2].content='不要删除';
  const result=await compactConversationContext(f.options);
  const legacy=structuredClone(result.receipt);delete legacy.prefixCount;
  await assert.rejects(compactConversationContext({...f.options,loadCheckpoint:()=>legacy}),{code:'REVISION_CONFLICT'});
});

test('model boundary rejects a protected segment before authorization or transport',async()=>{
  let calls=0;
  const summarize=createContextModelSummarizer({model:{deployment:{provider:'fixture',model:'fixture',deployment:'fixture'}},
    configurationRef:'fixture',maxOutputTokens:100,authorizeModelRequest:()=>{calls++;},assertModelConfiguration(){},
    guardedComplete:async()=>{calls++;throw Error('must not send');}});
  await assert.rejects(summarize({segment:{messages:[{id:'protected',role:'user',content:'不要删除，除非我确认。'}]}}),{code:'UNAUTHORIZED'});
  assert.equal(calls,0);
});
