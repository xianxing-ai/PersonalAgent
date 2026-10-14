import assert from 'node:assert/strict';
import test from 'node:test';
import {OwnedWorkflowEngine,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {createOwnedLayaSelector} from '../src/laya-selector.mjs';

test('F28 prepares independent branches in parallel while the single embedded decision forward is serialized',async()=>{
  const template=getOwnedWorkflowTemplate('F28');let inFlight=0,peak=0,arrivals=0,release;
  const barrier=new Promise(resolve=>release=resolve),posted=[];
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-loopback-key',request:async(_url,options)=>{
    const payload=JSON.parse(options.body);posted.push(JSON.parse(payload.state.context).nodeId);
    inFlight++;peak=Math.max(peak,inFlight);await new Promise(resolve=>setTimeout(resolve,5));inFlight--;
    return Response.json({answers:{decision:{choice:'candidate_0',probabilities:{candidate_0:0.8,candidate_1:0.2},answer_confidence:0.8,confidence:0.7}}});
  }});
  const runtime=new OwnedWorkflowEngine({checkpointSecret:'synthetic-fixed-checkpoint-secret-32-chars',selector,
    host:{capabilities:template.nodes.flatMap(node=>node.capabilities.map(cap=>cap.name)),
      read:async()=>({state:'completed',value:{fixture:'synthetic native model configuration'}}),
      condition:async context=>['F28_N02','F28_N03'].includes(context.node.id)?'selected':'skipped'},
    prepareCandidates:async context=>{
      if(['F28_N06','F28_N07'].includes(context.node.id)) {arrivals++;if(arrivals===2)release();await barrier;}
      return [{id:'proposal',description:'Synthetic evidence-supported candidate',value:{nodeId:context.node.id}},
        {id:'review',description:'Need more evidence',value:null,abstain:true}];
    }});
  const request={workflowId:'F28',taskId:'synthetic-task',controlRevision:1,sessionId:'synthetic-session',requestId:'synthetic-request',
    input:{goal:'synthetic parallel research'},deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal,availableTools:[]};
  let last=await runtime.advance(request);
  for(let step=0;step<4;step++)last=await runtime.advance({...request,checkpoint:last.checkpoint});
  assert.equal(arrivals,2);assert.equal(peak,1);assert.ok(posted.includes('F28_N06'));assert.ok(posted.includes('F28_N07'));
  assert.equal(last.nodes.F28_N06.state,'completed');assert.equal(last.nodes.F28_N07.state,'completed');
  assert.equal(last.nodes.F28_N08.state,'pending');assert.equal(last.verification,'unverified');
});
