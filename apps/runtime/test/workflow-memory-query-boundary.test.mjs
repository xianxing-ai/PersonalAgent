import test from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeSearchTool} from '@personal-agent/knowledge/tool';
import {createRuntimeF03MemoryQueryHost,createRuntimeF04MemoryQueryHost,createRuntimeF05JointRecallHost} from '../dist/application.js';

// Synthetic data verifies the local query boundary, not a real memory source.
for(const [workflowId,createHost] of [['F03',createRuntimeF03MemoryQueryHost],['F04',createRuntimeF04MemoryQueryHost]]) {
test(`${workflowId} rejects invalid fact timelines and results outside the bound query`,async()=>{
  const now=Date.now(),deadline=new Date(now+60000).toISOString();
  const nodeId=workflowId+'_N05',name='workflow.host.'+nodeId.toLowerCase();
  const parent={taskId:'parent',operationId:'operation'};
  const intent={taskId:'parent',workflowId,sessionId:'session',deadline,
    proposal:{nodeId,operationId:'operation',toolName:name,arguments:{}}};
  const hostIntent={commandId:'operation',toolName:name,arguments:{},deadline};
  const runtime={loadCheckpoint:(id,key)=>key==='coding-repair:parent'?parent:key==='host-tool-intent'?hostIntent:intent,
    getTask:()=>({state:'running',cancelRequested:false})};
  const context={taskId:'child',runId:'host-tool-child',authorizationRef:'grant',scopes:['memory:read'],deadline,signal:new AbortController().signal};
  let fact={ref:{id:'bound',revision:1},summary:'synthetic',sourceRef:'source',observedAt:new Date(now).toISOString(),
    validFrom:'invalid',validUntil:'2099-01-01T00:00:00Z',sensitivity:'public',state:'active'};
  const host=createHost({application:{runtime},memory:{listCurrent:async()=>({snapshot:'snapshot',facts:[fact]})},
    requiredScopes:['memory:read'],resolveQuery:async()=>({factId:'bound',limit:1}),assertCurrent:()=>{},authorizeExport:async()=>true,now:()=>new Date(now)});
  await assert.rejects(host.tools[0].execute({},context),{code:'EXTERNAL_FAILURE'});
  fact={...fact,validFrom:'2020-01-01T00:00:00Z',ref:{id:'other',revision:1}};
  await assert.rejects(host.tools[0].execute({},context),{code:'EXTERNAL_FAILURE'});
  fact={...fact,ref:{id:'bound',revision:1}};
  assert.equal((await host.tools[0].execute({},context)).facts.length,1);
});
}

test('F05 reads the original scoped query and rejects a changed knowledge revision before export',async()=>{
  const now=Date.now(),deadline=new Date(now+60000).toISOString();
  const name='workflow.host.f05_n02',operationId='recall';
  const context={taskId:'child',runId:'host-tool-child',authorizationRef:'grant',
    scopes:['memory:read','knowledge:read'],deadline,signal:new AbortController().signal};
  const records=new Map([
    ['coding-repair:parent',{taskId:'parent',operationId}],
    ['host-tool-intent',{commandId:operationId,toolName:name,arguments:{},deadline}],
    ['owned-workflow:intent:'+operationId,{taskId:'parent',workflowId:'F05',sessionId:'session',deadline,
      proposal:{nodeId:'F05_N02',operationId,toolName:name,arguments:{}}}],
  ]);
  const runtime={loadCheckpoint:(_id,key)=>records.get(key),getTask:()=>({state:'running'})};
  let revision='a'.repeat(64);
  let exports=0;
  const knowledgeSearch=createKnowledgeSearchTool({search:async input=>{
    assert.equal(input.query,'public source');
    return {hits:[{source:{vaultId:'public',path:'source.md',line:1,revision},excerpt:'public example'}],truncated:false};
  }});
  const host=createRuntimeF05JointRecallHost({application:{runtime},knowledgeSearch,
    memory:{listCurrent:async()=>({snapshot:'snapshot',facts:[]})},
    invokeKnowledgeSearch:(input,scope)=>knowledgeSearch.execute(input,scope),
    requiredMemoryScopes:['memory:read'],requiredKnowledgeScopes:['knowledge:read'],
    resolveMemoryQuery:async()=>({factId:'original-fact',limit:1}),
    resolveKnowledgeQuery:async()=>({query:'public source',limit:1}),
    assertCurrent:()=>{},authorizeExport:async()=>{exports++;return true;},now:()=>new Date(now)});
  await assert.rejects(host.tools[0].execute({}, {...context,scopes:['memory:read']}),{code:'SCOPE_DENIED'});
  const result=await host.tools[0].execute({},context);
  assert.equal(result.knowledge.hits[0].source.revision,revision);
  await host.authorizeReceipt({context,result});
  revision='b'.repeat(64);
  await assert.rejects(host.authorizeReceipt({context,result}),{code:'REVISION_CONFLICT'});
  assert.equal(exports,1);
});
