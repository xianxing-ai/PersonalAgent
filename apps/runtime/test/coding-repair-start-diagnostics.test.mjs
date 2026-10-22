import test from 'node:test';
import assert from 'node:assert/strict';
import {ProtocolError} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createRuntimeApplication} from '../dist/application.js';
import {runRuntimeCodingRepairWorkflow} from '../dist/application/coding-repair-application.js';

async function failureFixture(t,error,{rejectDiagnostic=false}={}) {
  const application=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts'});
  t.after(()=>application.close());
  const task=application.runtime.submitTask({goal:'Synthetic start failure',conversationId:'Synthetic',idempotencyKey:'start'});
  application.runtime.transitionTask(task.taskId,'planning');application.runtime.transitionTask(task.taskId,'running');
  const deadline=new Date(Date.now()+60_000).toISOString(),signal=new AbortController().signal;
  const worker={taskId:task.taskId,deadline,signal,
    loadCheckpoint:key=>application.runtime.loadCheckpoint(task.taskId,key),
    saveCheckpoint:(key,value)=>{
      if(rejectDiagnostic&&key.startsWith('coding-repair:start-failure:'))throw Error('Synthetic unavailable diagnostic storage');
      application.runtime.saveCheckpoint(task.taskId,key,value);
    }};
  const subtask={subtaskId:'repair',role:'coder',goal:'Synthetic bounded repair'};
  const options={image:{bindingId:'Synthetic-image',receiptSecret:async()=> 'Synthetic-only-receipt-secret-32-characters',
    advance:async()=>assert.fail('No image advance after failed start')}};
  const request={version:1,mode:'main',allowedPaths:['public.svg'],subtasks:[subtask]};
  await assert.rejects(runRuntimeCodingRepairWorkflow(application,subtask,worker,
    {list:()=>[],invoke:async()=>{throw error;}},options,request),value=>value===error);
  const runId='coding-start-'+task.taskId;
  return {runId,deadline,taskId:task.taskId,diagnostic:worker.loadCheckpoint('coding-repair:start-failure:v1:'+runId)};
}

test('start failure diagnostics bind the original operation and retain only fixed categories',async t=>{
  for(const [name,error,reason,code]of [
    ['original question failure',new ProtocolError('UNAUTHORIZED','原任务或权限策略已变化，操作未获允许'),'question_current_changed','UNAUTHORIZED'],
    ['unrecognized local text',new Error('Synthetic secret body at C:\\private\\token.txt'),'unclassified_local_failure','EXTERNAL_FAILURE'],
    ['unrecognized protocol text',new ProtocolError('UNAUTHORIZED','Synthetic private account value'),'unclassified_local_failure','UNAUTHORIZED'],
  ])await t.test(name,async t=>{
    const f=await failureFixture(t,error),saved=f.diagnostic;
    assert.deepEqual(saved,{version:1,authority:'diagnostic_no_tool_grant',taskId:f.taskId,runId:f.runId,
      toolName:'coding.repair.start',toolVersion:'1.0.0',argumentsDigest:toolArgumentsDigest({mode:'main',allowedPaths:['public.svg']}),
      deadline:f.deadline,stage:'isolation-start',code,reason});
    assert.equal(JSON.stringify(saved).includes(error.message),false,'no free error text or source body enters the private receipt');
  });
});

test('diagnostic storage failure cannot replace the original start failure',async t=>{
  const error=new ProtocolError('UNAUTHORIZED','Synthetic original failure');
  const f=await failureFixture(t,error,{rejectDiagnostic:true});assert.equal(f.diagnostic,undefined);
});
