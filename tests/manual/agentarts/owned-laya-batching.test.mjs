import assert from 'node:assert/strict';
import test from 'node:test';
import {runOwnedLayaBatching} from './owned-laya-batching.mjs';

const syntheticKey='synthetic-loopback-key-never-export';
function fakeTransport({capability=true,tamperBatch=false}={}) {
  let forwards=0;const paths=[];
  const result=(payload,index,scope)=>{
    const names=Object.keys(payload.questions.decision.criteria),choice=names[index];
    return {tokenWindow:{formatVersion:'1.0.0',encoderMaxTokens:8192,maxLength:1024,headMaxLength:256,
      headerTokens:[39],stateTokens:[60],requiredSequenceTokens:[100],expectedInputTokens:[100],encodedTokens:100,droppedTokens:0,truncated:false},
      inferenceMetrics:{formatVersion:'1.0.0',forwardScope:scope,precheckMs:1,forwardMs:10,processCpuMs:15,
        precheckProcessCpuMs:1,forwardProcessCpuMs:14,cgroupBefore:{status:'unsupported'},cgroupAfter:{status:'unsupported'},cgroupCpuDelta:{status:'missing'}},
      answers:{decision:{choice,probabilities:Object.fromEntries(names.map(name=>[name,name===choice?0.8:0.2/(names.length-1)])),
        answer_confidence:0.8,confidence:0.5}}};
  };
  return {paths,get forwards(){return forwards;},request:async(url,options)=>{
    const target=new URL(url);assert.equal(target.origin,'http://127.0.0.1:8123');paths.push(target.pathname);
    assert.equal(options.headers.authorization,'Bearer '+syntheticKey);assert.equal(options.redirect,'error');
    if(target.pathname==='/health')return Response.json({status:'ok',model:'multilingual',warmed:true,inferenceBusy:false,
      inferenceCalls:forwards,capabilities:capability?['multi_state','independent_items']:['multi_state'],maxStates:4});
    const payload=JSON.parse(options.body);forwards++;
    if(target.pathname==='/v1/systemone')return Response.json(result(payload,0,'sdk_predict_batch'));
    assert.equal(target.pathname,'/v1/systemone/independent-batch');
    const items=payload.items.map((item,index)=>({itemId:tamperBatch?'not-the-original-item':item.itemId,
      result:{...result(item,index===0?1:0,'sdk_heterogeneous_forward'),
        sharedForward:{batchId:payload.batchId,batchSize:payload.items.length}}}));
    return Response.json({batching:'independent_items',batchId:payload.batchId,items:items.reverse()});
  }};
}

test('manual compares identical full public payloads while recording actual forward counts and choice disagreement',async()=>{
  const fake=fakeTransport();
  const report=await runOwnedLayaBatching({port:8123,apiKey:syntheticKey,
    deadline:new Date(Date.now()+10000).toISOString(),request:fake.request});
  assert.equal(report.status,'passed_transport_and_forward_count_checks');assert.equal(fake.forwards,8);
  assert.equal(report.groups.length,2);assert.equal(report.serviceStartedByManual,false);assert.equal(report.weightsLoadedByManual,false);
  for(const group of report.groups) {
    assert.equal(group.samePublicPayloads,true);assert.equal(group.sequential.actualForwardCount,group.size);
    assert.equal(group.batch.actualForwardCount,1);assert.equal(group.batch.forwardMeasurements.length,1);
    assert.equal(group.batch.forwardMeasurements[0].ms,10);
    assert.equal(group.choiceAgreement[0].equal,false,'A real choice difference is retained, not rejected or replaced');
    assert.ok(group.sequential.payloads.every(item=>/^[a-f0-9]{64}$/.test(item.payloadSha256)));
  }
  assert.equal(report.semanticCorrectnessVerified,false);assert.equal(report.maasCalls,0);assert.equal(report.toolExecutions,0);
  assert.equal(JSON.stringify(report).includes(syntheticKey),false);
  assert.ok(fake.paths.every(path=>['/health','/v1/systemone','/v1/systemone/independent-batch'].includes(path)));
});

test('manual refuses a service without the new capability before submitting any inference',async()=>{
  const fake=fakeTransport({capability:false});
  const report=await runOwnedLayaBatching({port:8123,apiKey:syntheticKey,
    deadline:new Date(Date.now()+10000).toISOString(),request:fake.request});
  assert.equal(report.status,'failed');assert.equal(fake.forwards,0);assert.deepEqual(fake.paths,['/health']);
});

test('manual cannot promote a mismatched batch identity to a completed measurement',async()=>{
  const fake=fakeTransport({tamperBatch:true});
  const report=await runOwnedLayaBatching({port:8123,apiKey:syntheticKey,sizes:[2],
    deadline:new Date(Date.now()+10000).toISOString(),request:fake.request});
  assert.equal(report.status,'failed');assert.equal(report.failure.stage,'independent_batch_2');
  assert.equal(Object.hasOwn(report.groups[0],'batch'),false);
  assert.equal(JSON.stringify(report).includes(syntheticKey),false);
});
