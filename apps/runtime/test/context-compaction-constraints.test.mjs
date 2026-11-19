import test from 'node:test';
import assert from 'node:assert/strict';
const source=process.env.PA_TEST_CONTEXT_COMPACTION_SOURCE??new URL('../dist/application/context-compaction.js',import.meta.url);
const {compactConversationContext,mustPreserveContextMessage}=await import(source);
const {bindF27ContextSourceMap}=await import(new URL('./f27-context-source-map.js',source));
const {createContextModelSummarizer}=await import(new URL('./context-compaction-model.js',source));

function fixture(){
  const source={configurationRef:'local-source',messages:Array.from({length:20},(_,i)=>({id:'message-'+i,role:'assistant',content:'Ordinary narration '+i+' '+ 'material '.repeat(70)}))};
  const sent=[],saved={};let cached;
  const options={scope:{taskId:'task',conversationId:'conversation',cutoff:'task',deadline:'2099-01-01T00:00:00.000Z',signal:new AbortController().signal},
    policy:{version:'constraints-test',triggerCharacters:5000,targetCharacters:4000,maxCharacters:18000,retainMessages:2,maxSourceMessages:32,segmentCharacters:2000,maxSummaryCharacters:120},
    modelConfigurationRef:'model',readSnapshot:()=>source,compile:messages=>JSON.stringify(messages),assertCurrent(){},
    summarize:async input=>{sent.push(...input.segment.messages);input.assertBeforeSend();return 'Ordinary summary '+input.segment.index;},
    saveCheckpoint:receipt=>{saved.value=receipt;},remember:value=>{cached=value;}};
  return {source,options,sent,saved,cache:()=>cached};
}
test('constraints, conditions, pending operations and explicit sidebar sentences stay verbatim through compaction and actual F27 mapping',async()=>{
  const f=fixture();
  Object.assign(f.source.messages[2],{role:'user',content:'  不发送。除非我确认，在明天 18 点之前仅保留草稿。  '});
  Object.assign(f.source.messages[5],{role:'user',content:'Must retain this condition until Friday, only after review.'});
  Object.assign(f.source.messages[8],{content:'The original action awaits a receipt.',taskState:'waiting_reconciliation'});
  Object.assign(f.source.messages[11],{content:'侧边栏原句：保留完整限定词与对象',preserveVerbatim:true});
  const protectedMessages=f.source.messages.filter(mustPreserveContextMessage),original=structuredClone(f.source.messages);
  const result=await compactConversationContext(f.options);assert.equal(result.state,'compacted');
  for(const message of protectedMessages){assert.equal(f.sent.some(value=>value.id===message.id),false);assert.deepEqual(result.messages.find(value=>value.id===message.id),message);}
  const mapped=bindF27ContextSourceMap({source:original,assembled:result.messages,selected:result.messages,receipt:result.receipt});
  assert.equal(mapped.selected.filter(value=>value.kind==='original').length,protectedMessages.length+2);
  for(const mapping of mapped.selected.filter(value=>value.kind==='summary'))
    assert.equal(original.slice(mapping.sourceStart,mapping.sourceEnd).some(mustPreserveContextMessage),false);
  const before=f.sent.length,reused=await compactConversationContext({...f.options,previous:f.cache()});
  assert.equal(f.sent.length,before);assert.deepEqual(reused.messages,result.messages);
  bindF27ContextSourceMap({source:original,assembled:reused.messages,selected:reused.messages,receipt:reused.receipt});
  const tampered=structuredClone(result.messages);tampered.find(value=>value.id===protectedMessages[0].id).content='rewritten';
  assert.throws(()=>bindF27ContextSourceMap({source:original,assembled:tampered,selected:tampered,receipt:result.receipt}),{code:'REVISION_CONFLICT'});
});
test('verbatim material exceeding budget fails rather than trimming or sending it for a summary',async()=>{
  const f=fixture();for(const message of f.source.messages)Object.assign(message,{preserveVerbatim:true,content:'do not change '+ 'x'.repeat(1000)});
  await assert.rejects(compactConversationContext(f.options),/Verbatim constraints/);assert.equal(f.sent.length,0);assert.equal(f.saved.value,undefined);
});
test('the summary provider boundary independently rejects constraint material before approval or transport',async()=>{
  let sends=0,approvals=0;
  const summarize=createContextModelSummarizer({model:{deployment:{provider:'fixture',model:'fixture',deployment:'fixture'}},configurationRef:'fixture',maxOutputTokens:100,
    authorizeModelRequest:()=>{approvals++;},assertModelConfiguration(){},guardedComplete:async()=>{sends++;throw Error('must not send');}});
  for(const content of ['不要删除，除非我下一轮确认。','If approved before tomorrow, keep this condition.'])
    await assert.rejects(summarize({segment:{messages:[{id:'protected',role:'user',content}]}}),{code:'UNAUTHORIZED'});
  assert.equal(sends,0);assert.equal(approvals,0);
});

function mainFixture(){
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
  const f=mainFixture();
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
  const f=mainFixture();for(const item of f.source.messages)item.preserveVerbatim=true;
  f.options.policy.maxCharacters=4000;
  await assert.rejects(compactConversationContext(f.options),/Verbatim constraints/);
  assert.equal(f.sent.length,0);
});

test('all withheld source within budget remains unchanged without a model call',async()=>{
  const f=mainFixture();for(const item of f.source.messages)item.answerWithheld=true;
  const result=await compactConversationContext(f.options);
  assert.equal(result.state,'unchanged');assert.deepEqual(result.messages,f.source.messages);
  assert.equal(f.sent.length,0);
});

test('an older checkpoint without a prefix binding cannot silently replace the original context',async()=>{
  const f=mainFixture();f.source.messages[2].content='不要删除';
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
