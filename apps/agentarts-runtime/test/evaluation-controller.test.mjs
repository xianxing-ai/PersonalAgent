import test from 'node:test';
import assert from 'node:assert/strict';
import {createEvaluationController} from '../src/evaluation-controller.mjs';
test('paired evaluation uses both pinned models with identical input and no answer keys or tools',async()=>{
  const calls=[];const controller=createEvaluationController({executionModels:{resolve(selection){
    assert.ok(['main','candidate'].includes(selection.modelId));return {complete:async request=>{
      calls.push({selection,request});return {response:{kind:'final',text:selection.modelId},deployment:{verification:'mock'}};}};}}});
  const value={evaluationVersion:1,operation:'paired_model_outputs',main:{modelId:'main'},shadow:{modelId:'candidate'},
    cases:[{id:'public-case',messages:[{role:'user',content:'Public fixture'}]}]};
  const request={value,deadline:new Date(Date.now()+30000).toISOString(),signal:new AbortController().signal,requestId:'original-request',sessionId:'original-session'};
  const result=await controller(request);assert.equal(calls.length,2);assert.deepEqual(calls[0].request.messages,calls[1].request.messages);
  assert.deepEqual(calls[0].request.tools,[]);assert.equal(result.branches.main[0].output,'main');assert.equal(result.branches.shadow[0].output,'candidate');
  assert.equal(result.branches.main[0].modelCalls,1);assert.ok(result.branches.shadow[0].wallMs>=0);
  await assert.rejects(controller({...request,value:{...value,cases:[{...value.cases[0],answer:'must not reach model'}]}}),{code:'INVALID_ARGUMENT'});
  assert.equal(calls.length,2);
});
