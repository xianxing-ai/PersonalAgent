import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowShadowReleaseDigest as hash} from '@personal-agent/agentarts';
import {createAgentArtsEvaluationRequestAuth} from '../electron/agentarts-observation-auth.js';
import {readAgentArtsEvaluation} from '../electron/agentarts-evaluation-readback.js';
test('evaluation readback binds original rows and scores; signing permits only exact read requests',async()=>{
  const credentials={accessKey:'fixtureaccesskey',secretKey:'fixture-private-secret-key'},auth=createAgentArtsEvaluationRequestAuth(credentials,{taskIds:['original-task']});
  const item={item_id:'item-one',task_id:'original-task',dataset_id:'dataset',dataset_version:'1',item_data:[{input:'Public fixture',output:'Actual fixture output',reference:'Fixture rubric'}],agent_output:[],
    evaluations:[{evaluator_id:'evaluator',evaluator_version:'1',score:0.8,latency_s:1,status_code:'200',created_at:new Date().toISOString()}]};
  let tamper=false,calls=0;
  const input={taskId:'original-task',datasetId:'dataset',datasetVersion:'1',evaluatorId:'evaluator',evaluatorVersion:'1',
    expected:[{itemId:item.item_id,inputDigest:hash(item.item_data),outputDigest:hash(item.agent_output)}],
    deadline:new Date(Date.now()+10000).toISOString(),signal:new AbortController().signal,assertCurrent(){},authorize:request=>auth.authorize(request),
    fetchImpl:async(url,request)=>{calls++;assert.equal(request.method,'POST');assert.equal(request.body,JSON.stringify({offset:0,limit:100}));
      const row=structuredClone(item);row.item_data=row.item_data.map(value=>Object.fromEntries(Object.entries(value).reverse()));
      if(tamper)row.item_data[0].output='substituted';return new Response(JSON.stringify({data:{total:1,items:[row]}}),{headers:{'Content-Type':'application/json'}});}};
  const result=await readAgentArtsEvaluation(input);assert.equal(calls,2);assert.equal(result.qualityScore,0.8);assert.doesNotMatch(JSON.stringify(result),/Actual fixture|secret/);
  tamper=true;await assert.rejects(readAgentArtsEvaluation(input),{code:'REVISION_CONFLICT'});
  await assert.rejects(auth.authorize({method:'POST',url:'https://agentarts.cn-southwest-2.myhuaweicloud.com/v1/ops/evaluation-tasks/other-task/results',
    body:JSON.stringify({offset:0,limit:100}),headers:{Host:'agentarts.cn-southwest-2.myhuaweicloud.com','Content-Type':'application/json',Accept:'application/json'},
    deadline:input.deadline,signal:input.signal}),/outside/);
});
