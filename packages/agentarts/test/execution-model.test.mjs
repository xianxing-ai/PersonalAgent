import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnedAgentOrchestrator,parseAgentInput} from '../dist/index.js';
import {FakeModelProvider} from '@personal-agent/models';
const selection={catalogRevision:'a'.repeat(64),modelId:'cloud-deepseek',reasoningEffort:'high'};

test('an absent catalog does not block an implicit fast dispatch or invent catalog hints',async()=>{
  const model=new FakeModelProvider([{kind:'final',text:JSON.stringify({kind:'text',text:'answer'})}]);
  const agent=new OwnedAgentOrchestrator({fast:model,world:model,plan:model,review:model},128,undefined,undefined,undefined,
    {executionModels:{catalog:()=>undefined,resolve(){assert.fail('no explicit model was requested');}}});
  const result=await agent.invoke({query:JSON.stringify({goal:'delegate',availableTools:[{name:'subagent.dispatch',version:'1.0.0',inputSchema:{type:'object'}}]}),
    deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal,sessionId:'session',requestId:'request'});
  assert.equal(result.text,'answer');
  assert.equal('executionModelCatalog' in JSON.parse(model.requests[0].messages[1].content),false);
});
test('execution selection survives initial and confirmed continuation envelopes',()=>{
  for(const envelope of [{goal:'hello',availableTools:[]},{continuation:{proposalId:'p1',state:'confirmed',result:{ok:true}}}])
    assert.deepEqual(parseAgentInput(JSON.stringify({...envelope,executionModel:selection})).executionModel,selection);
  assert.throws(()=>parseAgentInput(JSON.stringify({goal:'hello',availableTools:[],executionModel:{...selection,catalogRevision:'stale'}})));
});
test('selected model uses registry and selected native effort on the existing pipeline',async()=>{
  const fallback=new FakeModelProvider([]),selected=new FakeModelProvider([{kind:'final',text:JSON.stringify({kind:'text',text:'selected'})}]);
  const calls=[];
  const agent=new OwnedAgentOrchestrator({fast:fallback,world:fallback,plan:fallback,review:fallback},128,undefined,undefined,undefined,
    {executionModels:{catalog(){return {version:'1.0',revision:selection.catalogRevision,defaultModelId:selection.modelId,models:[]};},resolve(value){calls.push(value);return selected;}}});
  assert.equal((await agent.invoke({query:JSON.stringify({goal:'hello',availableTools:[],executionModel:selection}),
    deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal,sessionId:'session',requestId:'request'})).text,'selected');
  assert.deepEqual(calls,[selection]);assert.equal(fallback.requests.length,0);assert.equal(selected.requests[0].reasoningEffort,'high');
  assert.equal('executionModelCatalog' in JSON.parse(selected.requests[0].messages[1].content),false);
});
test('only dispatch-capable fast calls receive compact executable text choices',async()=>{
  const model=new FakeModelProvider(Array.from({length:3},()=>({kind:'final',text:JSON.stringify({kind:'text',text:'answer'})})));
  let reads=0;
  const entries=[
    {id:'text',displayName:'large display name',requestProfile:'standard',type:'text',availability:'unverified',reasoningEfforts:[]},
    {id:'audio',displayName:'audio',requestProfile:'standard',type:'audio',availability:'available',reasoningEfforts:[]},
    {id:'unavailable',displayName:'unavailable',requestProfile:'standard',type:'text',availability:'unavailable',reasoningEfforts:[]},
  ];
  const agent=new OwnedAgentOrchestrator({fast:model,world:model,plan:model,review:model},128,undefined,undefined,undefined,
    {executionModels:{catalog(){reads++;return {version:'1.0',revision:selection.catalogRevision,defaultModelId:'text',models:entries};},resolve(){return model;}}});
  const request=query=>({query:JSON.stringify(query),deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal,sessionId:'session',requestId:'request'});
  await agent.invoke(request({goal:'ordinary text',availableTools:[]}));
  await agent.invoke(request({goal:'delegate',availableTools:[{name:'subagent.dispatch',version:'1.0.0',inputSchema:{type:'object'}}]}));
  await agent.invoke(request({continuation:{proposalId:'p1',state:'confirmed',result:{ok:true}}}));
  assert.equal(reads,1);
  const data=model.requests.map(request=>JSON.parse(request.messages[1].content));
  assert.equal('executionModelCatalog' in data[0],false);assert.equal('executionModelCatalog' in data[2],false);
  assert.deepEqual(data[1].executionModelCatalog,{revision:selection.catalogRevision,defaultModelId:'text',models:[{id:'text',reasoningEfforts:[]}]});
});
