import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeF04MemoryQueryHost} from '../dist/application/workflow-f04-f05-recall-host.js';

// Synthetic data verifies the local query boundary, not a real memory source.
test('F04 rejects invalid fact timelines and results outside the bound query',async()=>{
  const now=Date.now(),deadline=new Date(now+60000).toISOString();
  const parent={taskId:'parent',operationId:'operation'};
  const intent={taskId:'parent',workflowId:'F04',sessionId:'session',deadline,
    proposal:{nodeId:'F04_N05',operationId:'operation',toolName:'workflow.host.f04_n05',arguments:{}}};
  const hostIntent={commandId:'operation',toolName:'workflow.host.f04_n05',arguments:{},deadline};
  const runtime={loadCheckpoint:(id,key)=>key==='coding-repair:parent'?parent:key==='host-tool-intent'?hostIntent:intent,
    getTask:()=>({state:'running',cancelRequested:false})};
  const context={taskId:'child',runId:'host-tool-child',authorizationRef:'grant',scopes:['memory:read'],deadline,signal:new AbortController().signal};
  let fact={ref:{id:'bound',revision:1},summary:'synthetic',sourceRef:'source',observedAt:new Date(now).toISOString(),
    validFrom:'invalid',validUntil:'2099-01-01T00:00:00Z',sensitivity:'public',state:'active'};
  const host=createRuntimeF04MemoryQueryHost({application:{runtime},memory:{listCurrent:async()=>({snapshot:'snapshot',facts:[fact]})},
    requiredScopes:['memory:read'],resolveQuery:async()=>({factId:'bound',limit:1}),assertCurrent:()=>{},authorizeExport:async()=>true,now:()=>new Date(now)});
  await assert.rejects(host.tools[0].execute({},context),{code:'EXTERNAL_FAILURE'});
  fact={...fact,validFrom:'2020-01-01T00:00:00Z',ref:{id:'other',revision:1}};
  await assert.rejects(host.tools[0].execute({},context),{code:'EXTERNAL_FAILURE'});
  fact={...fact,ref:{id:'bound',revision:1}};
  assert.equal((await host.tools[0].execute({},context)).facts.length,1);
});
