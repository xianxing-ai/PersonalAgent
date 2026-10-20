import assert from 'node:assert/strict';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {TaskRuntime} from '../dist/index.js';
import {createRuntimeHarnessCandidateTools} from '../dist/application/harness-candidates.js';
import {context,trial} from '../../../packages/agentarts/test/harness-candidate-fixtures.mjs';

async function fixture(run,{originChange,resultChange,bindingChange}={}) {
  const now=Date.now(),deadline=new Date(now+60000).toISOString();let gateway;
  const runtime=new TaskRuntime(':memory:',{now:()=>new Date(now),createToolGateway:policy=>{gateway=new ToolGateway({policy});return gateway;}});
  try {
    const client=new Client(runtime,()=>now);await client.connect();
    const {taskId}=await client.call('task.submit',{goal:'Synthetic trial comparison',conversationId:'synthetic-user-work'},{idempotencyKey:'owner'});
    runtime.transitionTask(taskId,'planning');runtime.transitionTask(taskId,'running');runtime.saveCheckpoint(taskId,'application-deadline',deadline);
    const c=context(taskId),origins=new Map(),calls=[];
    const [compare]=createRuntimeHarnessCandidateTools({runtime},{getBinding:()=>{const v=structuredClone(c);bindingChange?.(v);return v;},
      resolveTrialOrigin:(owner,runId)=>{assert.equal(owner,taskId);const value=origins.get(runId);return originChange?originChange(value):value;}});
    gateway.register(compare);
    gateway.register({descriptor:{name:'coding.repair.trial',version:'1.0.0',inputSchema:{type:'object'},outputSchema:{},sideEffect:'local_write',
      requiredScopes:['workspace:read','workspace:write','workspace:apply','workspace:execute'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},
      execute:async(args,ctx)=>{calls.push(ctx.runId);const result=trial(args.candidateId,c,args.candidateId==='bad'?'FAILED':'VALID',ctx.runId);
        resultChange?.(result);return result;}});
    const invoke=async(toolName,args,runId,scopes=['workspace:read','workspace:write','workspace:apply','workspace:execute'])=>{
      if(!runtime.policy.get(runId))runtime.policy.grant({authorizationRef:runId,taskId,toolName,scopes,expiresAt:deadline,argumentsDigest:toolArgumentsDigest(args)});
      origins.set(runId,{actualTaskId:taskId,arguments:args,scopeRef:runId});
      return client.call('tool.invoke',{toolName,toolVersion:'1.0.0',arguments:args,scopeRef:runId},{taskId,idempotencyKey:runId,timeoutMs:60000});
    };
    const start=(candidateId,runId='trial-'+candidateId)=>invoke('coding.repair.trial',{candidateId,patches:[],recipeIds:['unit']},runId);
    await run({runtime,client,taskId,c,calls,invoke,start,compare,deadline});
  } finally {runtime.close();}
}
test('actual Runtime/Policy/Gateway stores synthetic trial Evidence and compare consumes only original runs',async()=>{
  await fixture(async({runtime,taskId,invoke,start,calls})=>{
    await start('good');await start('bad');
    const output=await invoke('harness.candidates.compare',{trialRunIds:['trial-good','trial-bad']},'compare');
    assert.equal(output.state,'confirmed');assert.equal(output.result.state,'selected');
    assert.equal(output.result.recommendation.candidateId,'good');assert.deepEqual(output.result.evidenceRefs,['trial-good','trial-bad']);
    assert.equal(output.result.recommendation.trialRunId,'trial-good');
    assert.deepEqual(calls,['trial-good','trial-bad']);
    assert.equal(runtime.readToolExecutions(taskId).length,3);
    assert.ok(runtime.readToolExecutions(taskId).every(r=>r.state==='confirmed'&&r.policyDecision==='allow'&&r.executionStarted));
    const replay=await invoke('harness.candidates.compare',{trialRunIds:['trial-good','trial-bad']},'compare');
    assert.deepEqual(replay.result,output.result);assert.equal(calls.length,2,'comparison replay never repeats a trial');
  });
});
test('run ID alone cannot supply foreign/missing result or changed original arguments',async()=>{
  await fixture(async({invoke,start})=>{
    await start('good');await assert.rejects(invoke('harness.candidates.compare',{trialRunIds:['trial-good']},'compare'),{code:'UNAUTHORIZED'});
  },{originChange:value=>value?{...value,arguments:{...value.arguments,candidateId:'forged'}}:undefined});
  await fixture(async({invoke})=>{await assert.rejects(invoke('harness.candidates.compare',{trialRunIds:['missing']},'compare'),{code:'UNAUTHORIZED'});});
});
test('confirmed tool result cannot change candidate/task/executor or claim unrelated Evidence',async()=>{
  for(const change of [t=>{t.binding.candidateId='forged';},t=>{t.binding.taskId='foreign';},
    t=>{t.binding.trialTaskId='foreign';},t=>{t.checkReadback.verification[0].evidenceRefs=['unrelated'];}]){
    await fixture(async({invoke,start})=>{await start('good');
      await assert.rejects(invoke('harness.candidates.compare',{trialRunIds:['trial-good']},'compare'),{code:'UNAUTHORIZED'});
    },{resultChange:change});
  }
});
test('missing read scope is rejected by actual Gateway before comparison and no runner is invoked',async()=>{
  await fixture(async({invoke,calls})=>{
    await assert.rejects(invoke('harness.candidates.compare',{trialRunIds:['missing']},'denied',['unrelated:read']),{code:'SCOPE_DENIED'});
    assert.equal(calls.length,0);
  });
});
test('missing production ports do not register; direct calls without the original Gateway operation reject',async()=>{
  assert.deepEqual(createRuntimeHarnessCandidateTools({runtime:{}}),[]);
  await fixture(async({compare,taskId,deadline})=>{
    await assert.rejects(compare.execute({trialRunIds:['missing']},{taskId,runId:'forged',authorizationRef:'forged',deadline,
      scopes:['workspace:read'],signal:new AbortController().signal}),{code:'UNAUTHORIZED'});
    const aborted=new AbortController();aborted.abort();
    await assert.rejects(compare.execute({trialRunIds:['missing']},{taskId,runId:'forged',authorizationRef:'forged',deadline,
      scopes:['workspace:read'],signal:aborted.signal}),{code:'CANCELLED'});
  });
});
test('frozen comparison context cannot be replaced between calls',async()=>{
  await fixture(async({invoke,start,c})=>{
    await start('good');await invoke('harness.candidates.compare',{trialRunIds:['trial-good']},'compare-one');
    c.binding.configurationDigest='b'.repeat(64);
    await assert.rejects(invoke('harness.candidates.compare',{trialRunIds:['trial-good']},'compare-two'),{code:'REVISION_CONFLICT'});
  });
});
