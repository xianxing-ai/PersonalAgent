import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {LayaActionChoiceService} from '@personal-agent/cognition';
import {createComputerControlLaya} from '../electron/computer-control-laya.js';

function fixture(selected='candidate_0') {
  const observations=[];
  const chooser=new LayaActionChoiceService({infer:async request=>{
    observations.push(request);
    return {answers:{action:{choice:selected,probabilities:{candidate_0:selected==='candidate_0'?0.9:0.1,
      candidate_1:selected==='candidate_1'?0.9:0.1},answer_confidence:0.9,confidence:0.8}}};
  }});
  let task={state:'running',goal:'Type the synthetic test value into the editor',cancelRequested:false},ready=true,starts=0;
  const host={snapshot:()=>({ready,state:ready?'ready':'stopped'}),start:async()=>{starts++;},choose:input=>chooser.choose(input)};
  const adapter=createComputerControlLaya({getHost:()=>host,readTask:()=>task});
  const input={taskId:'synthetic-task',targetRef:randomUUID(),operation:'set_value',windowTitle:'Synthetic window',
    controls:[{ref:randomUUID(),role:'Edit',name:'Synthetic editor',patterns:['value'],value:'must not leave control'}],
    expiresAt:new Date(Date.now()+30000).toISOString(),deadline:new Date(Date.now()+30000).toISOString(),signal:new AbortController().signal};
  return {adapter,input,observations,host,setTask:value=>{task=value;},setReady:value=>{ready=value;},starts:()=>starts};
}

test('local typed choice maps only an observed control and never includes its value',async()=>{
  const f=fixture(),result=await f.adapter.select(f.input);
  assert.deepEqual(result,{state:'selected',controlRef:f.input.controls[0].ref});
  assert.equal(f.observations.length,1);
  assert.doesNotMatch(JSON.stringify(f.observations),/must not leave control/);
  assert.match(JSON.stringify(f.observations),/untrusted data/);
});

test('review and unavailable states cannot be promoted to a selected control',async()=>{
  const f=fixture('candidate_1');assert.deepEqual(await f.adapter.select(f.input),{state:'review'});
  f.setReady(false);assert.deepEqual(await f.adapter.select(f.input),{state:'unavailable'});
  f.adapter.prepare();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.starts(),1);
  f.setTask({state:'cancelled',goal:'Type the synthetic test value into the editor'});
  assert.deepEqual(await f.adapter.select(f.input),{state:'unavailable'});
});

test('a forged or stale choice is not accepted',async()=>{
  const f=fixture();f.host.choose=async()=>({state:'selected',eligibleForRuntime:true,reason:'selected',calibrated:false,
    selected:{id:'control-0',revision:1},receipt:{promptVersion:'action-choice-v1',contextDigest:'forged',id:'forged',candidates:[]}});
  assert.deepEqual(await f.adapter.select(f.input),{state:'unavailable'});
  f.input.expiresAt=new Date(Date.now()-1).toISOString();
  assert.deepEqual(await f.adapter.select(f.input),{state:'unavailable'});
});
