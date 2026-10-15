import assert from 'node:assert/strict';
import test from 'node:test';
import {OwnedWorkflowEngine,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {createOwnedLayaSelector} from '../src/laya-selector.mjs';

function choiceResult(payload,index=0,scope='sdk_predict_batch') {
  const names=Object.keys(payload.questions.decision.criteria),chosen=names[index];
  const probabilities=Object.fromEntries(names.map(name=>[name,name===chosen?0.8:0.2/(names.length-1)]));
  return {tokenWindow:{formatVersion:'1.0.0',encoderMaxTokens:8192,maxLength:1024,headMaxLength:256,
    headerTokens:[39],stateTokens:[60],requiredSequenceTokens:[100],expectedInputTokens:[100],encodedTokens:100,droppedTokens:0,truncated:false},
    inferenceMetrics:{formatVersion:'1.0.0',forwardScope:scope,precheckMs:1,forwardMs:5,processCpuMs:8,
      precheckProcessCpuMs:1,forwardProcessCpuMs:7,cgroupBefore:{status:'unsupported'},cgroupAfter:{status:'unsupported'},cgroupCpuDelta:{status:'missing'}},
    answers:{decision:{choice:chosen,probabilities,answer_confidence:0.8,confidence:0.7}}};
}
const contextOf=payload=>JSON.parse(payload.state.split('\n')[1]);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

test('F28 parallel frontier submits one independent batch and binds different candidate sets to their own nodes',async()=>{
  const template=getOwnedWorkflowTemplate('F28');let inFlight=0,peak=0,arrivals=0,release,fakeForwardCalls=0;
  const barrier=new Promise(resolve=>release=resolve),posted=[],decisions=[];
  const selector=createOwnedLayaSelector({cpuExecutionPolicy:'packed',port:8123,getApiKey:()=> 'synthetic-loopback-key',
    onDecision:receipt=>decisions.push(receipt),request:async(url,options)=>{
      const payload=JSON.parse(options.body),pathname=new URL(url).pathname;posted.push({pathname,payload});
      inFlight++;peak=Math.max(peak,inFlight);fakeForwardCalls++;
      await new Promise(resolve=>setTimeout(resolve,5));inFlight--;
      if(pathname==='/v1/systemone')return Response.json(choiceResult(payload));
      assert.equal(pathname,'/v1/systemone/independent-batch');assert.match(payload.batchId,uuid);assert.equal(payload.items.length,2);
      const items=payload.items.map(item=>{
        assert.match(item.itemId,uuid);assert.notEqual(item.itemId,'synthetic-request');
        return {itemId:item.itemId,result:{...choiceResult(item,contextOf(item).nodeId==='F28_N06'?1:0,'sdk_heterogeneous_forward'),
          sharedForward:{batchId:payload.batchId,batchSize:payload.items.length}}};
      });
      // Transport order is not node identity. Reverse rows to verify itemId binding.
      return Response.json({batching:'independent_items',batchId:payload.batchId,items:items.reverse()});
    }});
  const runtime=new OwnedWorkflowEngine({checkpointSecret:'synthetic-fixed-checkpoint-secret-32-chars',selector,
    host:{capabilities:template.nodes.flatMap(node=>node.capabilities.map(cap=>cap.name)),
      read:async()=>({state:'completed',value:{fixture:'synthetic native model configuration'}}),
      condition:async context=>['F28_N02','F28_N03'].includes(context.node.id)?'selected':'skipped'},
    prepareCandidates:async context=>{
      if(['F28_N06','F28_N07'].includes(context.node.id)) {arrivals++;if(arrivals===2)release();await barrier;}
      if(context.node.id==='F28_N06')return [
        {id:'research-first',description:'Synthetic first research candidate',value:{branch:'research',selection:'first'}},
        {id:'research-second',description:'Synthetic second research candidate',value:{branch:'research',selection:'second'}},
        {id:'research-review',description:'Research needs more evidence',value:null,abstain:true}];
      if(context.node.id==='F28_N07')return [
        {id:'analysis-only',description:'Synthetic analysis candidate',value:{branch:'analysis',selection:'only'}},
        {id:'analysis-review',description:'Analysis needs more evidence',value:null,abstain:true}];
      return [{id:'proposal',description:'Synthetic evidence-supported candidate',value:{nodeId:context.node.id}},
        {id:'review',description:'Need more evidence',value:null,abstain:true}];
    }});
  const request={workflowId:'F28',taskId:'synthetic-task',controlRevision:1,sessionId:'synthetic-session',requestId:'synthetic-request',
    input:{goal:'synthetic parallel research'},deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal,availableTools:[]};
  let last=await runtime.advance(request);
  for(let step=0;step<3;step++)last=await runtime.advance({...request,checkpoint:last.checkpoint});
  assert.equal(last.nodes.F28_N04.state,'completed');const before={http:posted.length,forwards:fakeForwardCalls};
  last=await runtime.advance({...request,checkpoint:last.checkpoint});
  assert.equal(arrivals,2);assert.equal(peak,1);assert.equal(fakeForwardCalls-before.forwards,1);
  const frontierPosts=posted.slice(before.http);assert.equal(frontierPosts.length,1);
  const batch=frontierPosts[0];assert.equal(batch.pathname,'/v1/systemone/independent-batch');
  const items=new Map(batch.payload.items.map(item=>[contextOf(item).nodeId,item]));
  assert.deepEqual(new Set(items.keys()),new Set(['F28_N06','F28_N07']));
  assert.notEqual(items.get('F28_N06').itemId,items.get('F28_N07').itemId);
  assert.equal(Object.keys(items.get('F28_N06').questions.decision.criteria).length,3);
  assert.equal(Object.keys(items.get('F28_N07').questions.decision.criteria).length,2);
  assert.equal(items.get('F28_N06').state.includes('analysis-only'),false);
  assert.equal(items.get('F28_N07').state.includes('research-second'),false);
  assert.deepEqual(last.nodes.F28_N06.value,{branch:'research',selection:'second'});
  assert.deepEqual(last.nodes.F28_N07.value,{branch:'analysis',selection:'only'});
  assert.equal(last.nodes.F28_N08.state,'pending');assert.equal(last.verification,'unverified');
  const batchDecisions=decisions.filter(receipt=>receipt.batchId===batch.payload.batchId);
  assert.equal(batchDecisions.length,2);
  assert.ok(batchDecisions.every(receipt=>receipt.batchSize===2&&receipt.sharedForwardScope==='sdk_heterogeneous_forward'));
});

test('an isolated choice preserves the single-state endpoint and opaque candidate mapping',async()=>{
  const posted=[];
  const selector=createOwnedLayaSelector({port:8123,getApiKey:()=> 'synthetic-loopback-key',request:async(url,options)=>{
    assert.equal(new URL(url).pathname,'/v1/systemone');const payload=JSON.parse(options.body);posted.push(payload);
    assert.equal(Object.hasOwn(payload,'items'),false);return Response.json(choiceResult(payload,1));
  }});
  for(const name of ['first','second'])assert.equal(await selector.select({context:'Public isolated '+name,
    candidates:[{id:name+'-ready',description:'Public ready observation'},{id:name+'-review',description:'Public observation needs review'}],
    deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal,requestId:name}),name+'-review');
  assert.equal(posted.length,2);assert.notEqual(posted[0].state,posted[1].state);
});
