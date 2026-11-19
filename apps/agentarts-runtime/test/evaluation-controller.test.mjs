import test from 'node:test';
import assert from 'node:assert/strict';
import {createEvaluationController} from '../src/evaluation-controller.mjs';
import {createAgentServer} from '../src/server.mjs';
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
test('agent server dispatches evaluationVersion and executionEpochVersion envelopes cleanly',async t=>{
  const token='public-fixture-inner-credential-at-least-32-bytes';
  const controller=createEvaluationController({executionModels:{resolve(selection){
    return {complete:async()=>({response:{kind:'final',text:selection.modelId},deployment:{verification:'mock'}})};}}});
  const server=createAgentServer({orchestrator:{invoke:async()=>{throw Error('No fallback');}},mode:'standalone-validation',
    authToken:token,serviceControllers:{evaluationVersion:controller}});
  server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+'/invocations';
  const value={evaluationVersion:1,operation:'paired_model_outputs',main:{modelId:'main'},shadow:{modelId:'candidate'},
    cases:[{id:'public-case',messages:[{role:'user',content:'Public fixture'}]}]};
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-pa-agent-token':'Bearer '+token},
    body:JSON.stringify({query:JSON.stringify({executionEpochVersion:1,executionEpoch:3,query:JSON.stringify(value)})})});
  assert.equal(response.status,200);
  const events=await response.json();
  const envelope=JSON.parse(events[0].data.text);
  assert.equal(envelope.executionEpochVersion,1);assert.equal(envelope.executionEpoch,3);
  assert.equal(envelope.result.evaluationVersion,1);assert.equal(envelope.result.branches.main[0].output,'main');
});
