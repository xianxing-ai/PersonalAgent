import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication,createRuntimeSubagentDispatchTool,resumeRuntimeSubagentTask} from '../dist/application.js';

const selection={catalogRevision:'a'.repeat(64),modelId:'explicit-cloud-model',reasoningEffort:'high'};
const descriptor={name:'fixture.explicit-child-read',version:'1.0.0',sideEffect:'read',requiredScopes:['fixture:read'],
  requiresPresence:false,idempotencySupport:true,recoverySupport:true,
  inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},
  outputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}};

// Real TaskRuntime/Policy/ToolGateway/SQLite; only the external coordination port is an explicit Fake.
async function fixture(persistent=false) {
  const directory=persistent?await mkdtemp(path.join(os.tmpdir(),'pa-explicit-child-')):undefined;
  const database=directory?path.join(directory,'runtime.sqlite'):':memory:';
  let app,reads=0,apiCalls=0;
  const requests=[];
  const options=()=>({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    getModelGateway:()=>{apiCalls++;throw Error('Competition recovery must not call an independent model');},
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const open=(coordinationBinding='original-cloud-deployment')=>createRuntimeApplication({path:database,
    profile:'huawei_ict_agentarts',coordinationBinding,resolveExecutionModel:requested=>{
      assert.deepEqual(requested,{modelId:selection.modelId,reasoningEffort:'high'});return selection;
    },subagentModels:{getModelGateway:options().getModelGateway},
    tools:[{descriptor,execute:async input=>{reads++;return input;}}],
    coordination:new FakeCoordinationPort(request=>{
      requests.push(request);assert.deepEqual(request.executionModel,selection);
      if(!request.continuation)return {kind:'tool_proposal',proposalId:'original-explicit-read',
        toolName:descriptor.name,toolVersion:descriptor.version,arguments:{value:'public fixture'},verification:'mock'};
      assert.deepEqual(request.continuation.result,{value:'public fixture'});
      return {kind:'text',text:'explicit cloud child continued',verification:'mock'};
    })});
  app=open();
  const parent=app.runtime.submitTask({goal:'delegate explicit model',conversationId:'explicit-model',idempotencyKey:'explicit-parent'});
  const dispatch=createRuntimeSubagentDispatchTool(options());
  const context={taskId:parent.taskId,runId:'dispatch',authorizationRef:'original-parent',scopes:['agent:delegate'],
    deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal};
  const result=await dispatch.execute({subtasks:[{subtaskId:'explicit',role:'coder',goal:'read approved public fixture',
    model:selection.modelId,reasoningEffort:'high'}]},context);
  assert.equal(result.succeeded,0);assert.equal(result.failed,0);
  const childId=app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-explicit`).taskId;
  assert.equal(app.runtime.getTask(childId).state,'waiting_approval');assert.equal(reads,0);
  return {get app(){return app;},get reads(){return reads;},get apiCalls(){return apiCalls;},parent,childId,context,requests,options,
    async restart(binding){app.close();app=open(binding);},
    async close(){app.close();if(directory)await rm(directory,{recursive:true,force:true});}};
}

for(const restart of [false,true])test(`explicit Competition child resumes its original approved invocation${restart?' after SQLite restart':''}`,async()=>{
  const current=await fixture(restart);
  try {
    const originalBinding=current.app.runtime.loadCheckpoint(current.childId,'subtask-parent');
    const originalSelection=current.app.runtime.loadCheckpoint(current.childId,'execution-model');
    if(restart)await current.restart();
    await assert.rejects(resumeRuntimeSubagentTask(current.options(),current.childId),{code:'UNAUTHORIZED'});
    assert.equal(current.reads,0);assert.equal(current.requests.length,1);
    const approval=current.app.runtime.getApproval(`competition-tool-${current.childId}-1`);
    current.app.runtime.respondApproval(approval.approvalId,'allow_once',approval.revision);
    const resumed=await resumeRuntimeSubagentTask(current.options(),current.childId);
    assert.equal(resumed.state,'succeeded',JSON.stringify(resumed.error));assert.equal(resumed.taskId,current.childId);
    assert.match(resumed.resultSummary,/explicit cloud child continued/);
    assert.equal(current.reads,1);assert.equal(current.apiCalls,0);assert.equal(current.requests.length,2);
    assert.deepEqual(current.app.runtime.loadCheckpoint(current.childId,'subtask-parent'),originalBinding);
    assert.deepEqual(current.app.runtime.loadCheckpoint(current.childId,'execution-model'),originalSelection);
    const records=current.app.runtime.readToolExecutions(current.childId);
    assert.equal(records.length,1);assert.equal(records[0].evidenceId,approval.approvalId);
    assert.equal(records[0].state,'confirmed');assert.equal(records[0].executionStarted,true);
    assert.ok(resumed.evidenceRefs.includes(approval.approvalId));
    assert.equal((await resumeRuntimeSubagentTask(current.options(),current.childId)).state,'succeeded');
    assert.equal(current.reads,1);assert.equal(current.requests.length,2);
  }finally{await current.close();}
});

for(const changed of ['dispatch-model','dispatch-effort','removed-dispatch-model','selected-model','selected-effort',
  'invalid-selection','model-kind','unknown-kind','extra-kind-field','arguments','revoked-grant','deployment']) {
  test(`explicit Competition child rejects ${changed} drift without consuming its approved read`,async()=>{
    const current=await fixture(changed==='deployment');
    try {
      if(changed==='deployment')await current.restart('different-cloud-deployment');
      const runtime=current.app.runtime;
      const approval=runtime.getApproval(`competition-tool-${current.childId}-1`);
      runtime.respondApproval(approval.approvalId,'allow_once',approval.revision);
      if(changed.startsWith('dispatch-')||changed==='removed-dispatch-model') {
        const binding=runtime.loadCheckpoint(current.childId,'subtask-parent');
        if(changed==='dispatch-model')binding.model='different-cloud-model';
        else if(changed==='dispatch-effort')binding.reasoningEffort='low';
        else delete binding.model;
        runtime.saveCheckpoint(current.childId,'subtask-parent',binding);
      } else if(changed.startsWith('selected-')||changed==='invalid-selection') {
        const next=changed==='selected-model'?{...selection,modelId:'different-cloud-model'}:
          changed==='selected-effort'?{...selection,reasoningEffort:'low'}:{};
        runtime.saveCheckpoint(current.childId,'execution-model',next);
      } else if(changed.endsWith('kind')||changed==='extra-kind-field') {
        runtime.saveCheckpoint(current.childId,'subtask-execution-binding',changed==='extra-kind-field'
          ?{kind:'competition',extra:true}:{kind:changed==='model-kind'?'model':'unknown'});
      } else if(changed==='arguments') {
        const loop=runtime.loadCheckpoint(current.childId,'competition-loop');
        loop.pending.arguments={value:'replaced after approval'};
        runtime.saveCheckpoint(current.childId,'competition-loop',loop);
      } else if(changed==='revoked-grant')runtime.policy.revoke(approval.approvalId);
      if(changed==='deployment') {
        const outcome=await resumeRuntimeSubagentTask(current.options(),current.childId);
        assert.equal(outcome.state,'failed');assert.equal(outcome.error.code,'REVISION_CONFLICT');
      } else await assert.rejects(resumeRuntimeSubagentTask(current.options(),current.childId),
        {code:changed==='arguments'||changed==='revoked-grant'?'UNAUTHORIZED':'REVISION_CONFLICT'});
      assert.equal(current.reads,0);assert.equal(current.apiCalls,0);assert.equal(current.requests.length,1);
      assert.deepEqual(runtime.readToolExecutions(current.childId),[]);
      if(changed==='revoked-grant')assert.equal(runtime.policy.get(approval.approvalId),undefined);
      else assert.equal(runtime.policy.get(approval.approvalId).usesRemaining,1);
    }finally{await current.close();}
  });
}
