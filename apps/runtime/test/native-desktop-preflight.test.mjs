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

test('#731 distinct safe native pre-launch messages project cleanly when zero execution is proven, while started/unknown executions stay waiting_reconciliation',()=>{
  const distinctMessages=[
    '外部进程隔离宿主已关闭，命令尚未启动（未降级为普通进程）',
    '工作目录或 Node 路径不可用，命令尚未启动（未降级为普通进程）',
    '缺少 Windows 进程沙箱宿主组件或校验失败，命令尚未启动（未降级为普通进程）',
    '当前 Windows 环境不支持 PSEC/AppContainer 隔离 API，命令尚未启动（未降级为普通进程）',
    'Windows 进程隔离自检未通过，命令尚未启动（未降级为普通进程）',
    '工作区配置、权限策略或原授权已变化，命令尚未启动（未降级为普通进程）',
  ];
  const descriptor={name:'workspace.npm_test',version:'1.0.0',sideEffect:'local_write',
    requiredScopes:['workspace:execute'],requiresPresence:false,recoverySupport:true,idempotencySupport:true,
    inputSchema:{type:'object',properties:{}},outputSchema:{type:'object',properties:{}}};
  for(const msg of distinctMessages){
    const runtime=new TaskRuntime(':memory:');
    try{
      const task=runtime.submitTask({goal:'pre-launch failure',conversationId:'native-test',idempotencyKey:'p-'+msg});
      runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
      runtime.requestToolApproval('ref-1',task.taskId,descriptor,new Date(Date.now()+30000).toISOString(),'a'.repeat(64));
      runtime.invalidatePendingApproval('ref-1','stale',new ProtocolError('UNSUPPORTED_CAPABILITY',msg));
      const updated=runtime.getTask(task.taskId),record=runtime.readToolExecutions(task.taskId)[0];
      assert.equal(updated.state,'failed');
      assert.equal(updated.error.code,'UNSUPPORTED_CAPABILITY');
      assert.equal(updated.error.message,msg);
      assert.equal(record.executionStarted,false);
    }finally{runtime.close();}
  }

  for(const scenario of ['started-record','cloud-unknown']){
    const runtime=new TaskRuntime(':memory:');
    try{
      const task=runtime.submitTask({goal:'must stay reconciliation',conversationId:'native-test',idempotencyKey:'u-'+scenario});
      runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
      if(scenario==='started-record'){
        runtime.saveToolExecution({protocolVersion:'1.0.0',policyDecision:'allow',executionStarted:true,
          inputDigest:'a'.repeat(64),evidenceId:'ev-prior',requestId:'prior-run',taskId:task.taskId,
          toolName:'workspace.npm_test',toolVersion:'1.0.0',startedAt:new Date().toISOString(),state:'started'});
      }else{
        runtime.saveCheckpoint(task.taskId,'competition-cloud-unknown',{original:true});
      }
      runtime.requestToolApproval('ref-u',task.taskId,descriptor,new Date(Date.now()+30000).toISOString(),'a'.repeat(64));
      runtime.invalidatePendingApproval('ref-u','stale',new ProtocolError('UNSUPPORTED_CAPABILITY',distinctMessages[0]));
      const updated=runtime.getTask(task.taskId);
      assert.equal(updated.state,'waiting_reconciliation');
      assert.equal(updated.error.code,'RESULT_UNKNOWN');
      assert.doesNotMatch(updated.error.message,/命令尚未启动/);
    }finally{runtime.close();}
  }
});
