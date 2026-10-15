import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdaptiveWorkflowSelector} from '../src/adaptive-decision.mjs';

const capabilities={text:true,streaming:false,toolCalling:false,structuredOutput:false,vision:false};
const deployment={provider:'test',deployment:'explicit-fake',model:'fake-deepseek',verification:'mock',capabilities};
function fixture(overrides={}) {
  const data=new Map();let localCalls=0,teacherCalls=0;
  const selector=createAdaptiveWorkflowSelector({laya:{select:async()=>{localCalls++;return 'a';}},
    teacher:{deployment,complete:async()=>{teacherCalls++;return {response:{kind:'final',text:JSON.stringify({selectedId:'b',rationale:'test evidence'})},deployment,latencyMs:1};}},
    store:{read:key=>data.get(key),writeOnce:(key,value)=>{if(data.has(key))return false;data.set(key,structuredClone(value));return true;}},
    modelRevision:'test-revision',verifyOutcome:value=>value.evidenceRefs?.[0]==='verified-test-evidence',...overrides});
  const input={requestId:'first',site:'test-site',criteriaVersion:'v1',criteria:'Compare supported plans',context:'public fixture',
    sources:[{sourceId:'fixture',revision:'1',sha256:'a'.repeat(64)}],candidates:[{id:'a',description:'plan A'},{id:'b',description:'plan B'}],
    signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()};
  return {selector,input,data,calls:()=>({localCalls,teacherCalls})};
}
test('unvalidated local result escalates once; teacher decision is not sent back through Laya',async()=>{
  const f=fixture(),record=await f.selector.decide(f.input);
  assert.equal(record.decided_by,'deepseek');assert.equal(record.selectedId,'b');assert.equal(record.reason,'unvalidated_decision_site');
  assert.deepEqual(f.calls(),{localCalls:1,teacherCalls:1});
  assert.deepEqual(await f.selector.decide(f.input),record);assert.deepEqual(f.calls(),{localCalls:1,teacherCalls:1});
  await assert.rejects(f.selector.decide({...f.input,context:'changed'}),{code:'REVISION_CONFLICT'});
});
test('verified exact experience avoids teacher calls; source/criteria revision invalidates reuse',async()=>{
  const f=fixture(),record=await f.selector.decide(f.input);
  await f.selector.rememberVerified(record,f.input,{evidenceRefs:['verified-test-evidence']});
  const reuse=await f.selector.decide({...f.input,requestId:'second'});
  assert.equal(reuse.decided_by,'verified_experience');assert.equal(reuse.trainingPerformed,false);
  assert.deepEqual(f.calls(),{localCalls:1,teacherCalls:1});
  await f.selector.decide({...f.input,requestId:'third',criteriaVersion:'v2'});
  assert.deepEqual(f.calls(),{localCalls:2,teacherCalls:2});
});
test('no experience is promoted from model claims alone',async()=>{
  const f=fixture(),record=await f.selector.decide(f.input);
  await assert.rejects(f.selector.rememberVerified(record,f.input,{evidenceRefs:['model-says-pass']}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(f.selector.rememberVerified(record,f.input,{evidenceRefs:['verified-test-evidence'],selectedId:'a'}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(f.selector.rememberVerified({...record,selectedId:'a'},f.input,{evidenceRefs:['verified-test-evidence']}),{code:'INVALID_ARGUMENT'});
});
test('invalid teacher candidate fails; interrupted intent cannot be replayed',async()=>{
  const f=fixture({teacher:{deployment,complete:async()=>({response:{kind:'final',text:'{"selectedId":"outside","rationale":"x"}'},deployment,latencyMs:1})}});
  await assert.rejects(f.selector.decide(f.input),{code:'INVALID_ARGUMENT'});
  await assert.rejects(f.selector.decide(f.input),{code:'RESULT_UNKNOWN'});
});
test('cancellation never escalates or creates completed decision',async()=>{
  const f=fixture(),cancel=new AbortController();cancel.abort();
  await assert.rejects(f.selector.decide({...f.input,signal:cancel.signal}),{code:'CANCELLED'});
  assert.deepEqual(f.calls(),{localCalls:0,teacherCalls:0});
});
test('only independently qualified site may accept local result',async()=>{
  const f=fixture({qualification:()=>true}),record=await f.selector.decide(f.input);
  assert.equal(record.decided_by,'laya');assert.deepEqual(f.calls(),{localCalls:1,teacherCalls:0});
});
test('owned-review and explicitly tagged abstention always escalate even at qualified sites',async()=>{
  for(const id of ['owned-review','custom-evidence-gap']) {
    const f=fixture({qualification:()=>true,laya:{select:async()=>id}});
    const input={...f.input,candidates:[{id,description:'Needs review'},{id:'b',description:'Action'}],
      ...(id.startsWith('custom')?{abstainIds:[id]}:{})};
    const record=await f.selector.decide(input);
    assert.equal(record.reason,'model_selected_review');assert.equal(record.decided_by,'deepseek');assert.equal(record.selectedId,'b');
  }
});
