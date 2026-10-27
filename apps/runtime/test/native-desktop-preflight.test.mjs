import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProtocolError,ToolNotStartedError} from '@personal-agent/contracts';
import {TaskRuntime} from '../dist/index.js';

test('trusted desktop preflight refusal records failed/non-dispatched; ordinary write failure remains unknown',async()=>{
  const base=fileURLToPath(new URL('../../../.cache/native-desktop-runtime/',import.meta.url));await mkdir(base,{recursive:true});
  for(const notStarted of [true,false]){
    const runtime=new TaskRuntime(path.join(await mkdtemp(path.join(base,'case-')),'runtime.sqlite'),{toolGateway:{list:()=>[],async invoke(request){
      request.onAuthorized();throw notStarted?new ToolNotStartedError('UNAUTHORIZED','Target changed before dispatch'):new ProtocolError('RESULT_UNKNOWN','Original device result unknown');
    }}});
    try{
      const task=runtime.submitTask({goal:'synthetic desktop preflight',conversationId:'native-test',idempotencyKey:'native-test'});
      runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
      const response=await runtime.send({kind:'request',protocolVersion:'1.0.0',requestId:'preflight-request',taskId:task.taskId,
        deadline:new Date(Date.now()+30000).toISOString(),operation:'tool.invoke',payload:{toolName:'computer.desktop.click',toolVersion:'1.0.0',arguments:{},scopeRef:'run'}},new AbortController().signal);
      const run=runtime.readToolExecutions(task.taskId)[0];
      assert.equal(run.executionStarted,!notStarted);assert.equal(run.state,notStarted?'failed':'unknown');
      assert.equal(runtime.getTask(task.taskId).state,notStarted?'running':'waiting_reconciliation');
      assert.equal(response.outcome,notStarted?'error':'ok');
    }finally{runtime.close();}
  }
});

test('native preparation refusal preserves its fixed safe cause and cannot disclose arbitrary provider text',()=>{
  const fixed='当前外部进程隔离后端或原授权不可用，未降级为普通进程';
  for(const message of [fixed,'PRIVATE_PROVIDER_BODY_DO_NOT_PUBLISH']){
    const runtime=new TaskRuntime(':memory:');
    try{
      const task=runtime.submitTask({goal:'synthetic native preparation failure',conversationId:'native-test',idempotencyKey:'native-refusal'});
      runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
      runtime.requestToolApproval('native-refusal',task.taskId,{name:'workspace.npm_test',version:'1.0.0',sideEffect:'local_write',
        requiredScopes:['workspace:execute'],requiresPresence:false,recoverySupport:true,idempotencySupport:true,
        inputSchema:{type:'object',properties:{}},outputSchema:{type:'object',properties:{}}},new Date(Date.now()+30000).toISOString(),'a'.repeat(64));
      runtime.invalidatePendingApproval('native-refusal','stale',new ProtocolError('UNSUPPORTED_CAPABILITY',message));
      const result=runtime.getTask(task.taskId),record=runtime.readToolExecutions(task.taskId)[0];
      assert.equal(result.state,'failed');assert.equal(record.executionStarted,false);assert.equal(record.policyDecision,'deny');
      assert.equal(result.error.code,message===fixed?'UNSUPPORTED_CAPABILITY':'REVISION_CONFLICT');
      assert.equal(record.errorCode,result.error.code,'the original denied execution record retains the same safe cause');
      if(message===fixed)assert.equal(result.error.message,fixed);
      assert.doesNotMatch(JSON.stringify(result),/PRIVATE_PROVIDER_BODY/);
    }finally{runtime.close();}
  }
});

test('native approval invalidation never invokes a hostile cause accessor',()=>{
  const runtime=new TaskRuntime(':memory:');let reads=0;
  try {
    const task=runtime.submitTask({goal:'synthetic hostile error',conversationId:'native-test',idempotencyKey:'hostile-error'});
    runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
    runtime.requestToolApproval('hostile-refusal',task.taskId,{name:'workspace.npm_test',version:'1.0.0',sideEffect:'local_write',
      requiredScopes:['workspace:execute'],requiresPresence:false,recoverySupport:true,idempotencySupport:true,
      inputSchema:{type:'object',properties:{}},outputSchema:{type:'object',properties:{}}},new Date(Date.now()+30000).toISOString(),'a'.repeat(64));
    const cause=Object.defineProperties(new Error(),{
      message:{get(){reads++;throw Error('PRIVATE_ACCESSOR_BODY');}},
      code:{get(){reads++;throw Error('PRIVATE_ACCESSOR_CODE');}}});
    runtime.invalidatePendingApproval('hostile-refusal','stale',cause);
    assert.equal(reads,0);assert.equal(runtime.getApproval('hostile-refusal').state,'denied');
    assert.equal(runtime.getTask(task.taskId).error.code,'REVISION_CONFLICT');
    assert.doesNotMatch(JSON.stringify(runtime.getTask(task.taskId)),/PRIVATE_ACCESSOR/);
  } finally {runtime.close();}
});
