import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '../dist/application.js';
import {bindF27ContextSourceMap} from '../dist/application/f27-context-source-map.js';
import {compactConversationContext} from '../dist/application/context-compaction.js';
import {COMPETITION_CONTEXT_CHECKPOINT} from '../dist/application/context-binding.js';

test('actual selected context maps only exact original messages and stores no bodies or source IDs',()=>{
  const source=[{id:'private-source-id',role:'user',content:'private-source-body'},{id:'answer',role:'assistant',content:'untrusted-data'}];
  const result=bindF27ContextSourceMap({source,assembled:source,selected:[source[0]]});
  assert.equal(result.sources.length,2);assert.equal(result.selected.length,1);assert.equal(result.selected[0].kind,'original');
  assert.deepEqual([result.selected[0].sourceStart,result.selected[0].sourceEnd],[0,1]);
  assert.doesNotMatch(JSON.stringify(result),/private-source-id|private-source-body|untrusted-data/);
  for(const selected of [[{...source[0],content:'substituted'}],[source[1],source[0]],[source[0],source[0]]])
    assert.throws(()=>bindF27ContextSourceMap({source,assembled:source,selected}),{code:'REVISION_CONFLICT'});
});

test('compaction source ranges and summaries bind to the real compactor receipt',async()=>{
  const source=Array.from({length:5},(_,index)=>({id:'source-'+index,role:index%2?'assistant':'user',content:('source-body-'+index).repeat(65)}));
  let saved;
  const compacted=await compactConversationContext({force:true,scope:{taskId:'synthetic',conversationId:'synthetic',cutoff:'synthetic',
    deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal},
    policy:{version:'synthetic-v1',triggerCharacters:4500,targetCharacters:2000,maxCharacters:8000,retainMessages:1,maxSourceMessages:10,segmentCharacters:2000,maxSummaryCharacters:100},
    modelConfigurationRef:'synthetic-model',readSnapshot:()=>({configurationRef:'synthetic-config',messages:source}),
    compile:messages=>JSON.stringify({publicGoal:'original instructions',messages}),
    summarize:async request=>{request.assertBeforeSend();return 'Synthetic summary '+request.segment.index;},assertCurrent:()=>{},
    saveCheckpoint:value=>{saved=value;},loadCheckpoint:()=>saved});
  assert.equal(compacted.state,'compacted');
  const input={source,assembled:compacted.messages,selected:compacted.messages,receipt:compacted.receipt};
  const map=bindF27ContextSourceMap(input);assert.ok(map.selected.some(item=>item.kind==='summary'));
  assert.equal(map.selected.at(-1).kind,'original');assert.equal(map.selected.at(-1).sourceStart,4);
  for(const patch of [
    {source:source.map((message,index)=>index?message:{...message,content:'edited original'})},
    {receipt:{...compacted.receipt,sourceCount:1}},
    {receipt:{...compacted.receipt,segments:compacted.receipt.segments.map((segment,index)=>index?segment:{...segment,rangeDigest:'0'.repeat(64)})}},
    {assembled:compacted.messages.map((message,index)=>index?message:{...message,content:JSON.stringify({kind:'derived_conversation_summary',treatment:'untrusted_data',text:'forged summary'})})},
  ])assert.throws(()=>bindF27ContextSourceMap({...input,...patch}),{code:'REVISION_CONFLICT'});
});

async function waitFor(app,taskId){
  for(let n=0;n<1000;n++){const task=app.runtime.getTask(taskId);if(['succeeded','failed','cancelled'].includes(task.state))return task;
    await new Promise(resolve=>setTimeout(resolve,5));}
  throw Error('Synthetic source mapping task did not settle');
}

for(const mutation of ['none','edit','withdraw','replace_reader','replace_mapping'])test(`real outgoing adapter ${mutation==='none'?'retains':'rejects'} ${mutation} source mapping after credential await`,async()=>{
  let app,taskId,sends=0;
  let messages=[{id:'private-message-canary',role:'user',content:'private-body-canary'}];
  const hooks={readConversationSnapshot:()=>structuredClone(messages),beforeCoordinationSend(){}};
  app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic',
    coordinationInput:hooks,authorizationProvider:{read:async()=>{
      if(mutation==='edit')messages[0].content='changed';
      if(mutation==='withdraw')messages=[];
      if(mutation==='replace_reader')hooks.readConversationSnapshot=()=>structuredClone(messages);
      if(mutation==='replace_mapping'){
        const binding=app.runtime.loadCheckpoint(taskId,COMPETITION_CONTEXT_CHECKPOINT);
        app.runtime.saveCheckpoint(taskId,COMPETITION_CONTEXT_CHECKPOINT,{...binding,sourceMap:{version:1}});
      }
      return 'Bearer synthetic';}},fetchImpl:async()=>{sends++;return new Response(JSON.stringify({event:'message',data:{text:'synthetic reply',index:0}}),
      {headers:{'content-type':'application/json'}});}});
  try{const client=new Client(app);await client.connect();({taskId}=await client.call('task.submit',{goal:'Synthetic mapping',conversationId:'mapping'},
    {idempotencyKey:'source-map-'+mutation,timeoutMs:60000}));
    const result=await waitFor(app,taskId);assert.equal(result.state,mutation==='none'?'succeeded':'failed',JSON.stringify(result.error));
    assert.equal(sends,mutation==='none'?1:0);
    if(mutation==='none'){
      const binding=app.runtime.loadCheckpoint(taskId,COMPETITION_CONTEXT_CHECKPOINT);
      assert.equal(binding.sourceMap.sources.length,1);assert.doesNotMatch(JSON.stringify(binding.sourceMap),/private-message-canary|private-body-canary/);
    }
  }finally{app.close();}
});
