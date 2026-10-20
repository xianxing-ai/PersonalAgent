import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {TaskRuntime} from '../dist/index.js';

const receipt={sessionId:'original-session',requestId:'original-request',idempotencyKey:'original-key',payloadDigest:'a'.repeat(64),accepted:true};
function fixture(file=':memory:') {
  const runtime=new TaskRuntime(file),task=runtime.submitTask({goal:'native original task',conversationId:'native-fixture',idempotencyKey:'original'});
  runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
  const record={protocolVersion:'1.0',taskId:task.taskId,evidenceId:'original-run',requestId:'original-tool-request',
    toolName:'fixture.write',toolVersion:'1.0.0',inputDigest:'b'.repeat(64),executionStarted:true,policyDecision:'allow',
    startedAt:new Date().toISOString(),state:'unknown',errorCode:'RESULT_UNKNOWN',reconciliationOutcome:'unknown'};
  // Explicit fixture setup of the original durable UNKNOWN record; no tool or host is invoked.
  runtime.saveToolExecution(record);runtime.saveCheckpoint(task.taskId,'tool-result-original-run',{uncertain:true});
  runtime.saveCheckpoint(task.taskId,'native-original-readback',{sessionId:'original-session',state:'cleared'});
  runtime.transitionTask(task.taskId,'waiting_reconciliation',{error:{code:'RESULT_UNKNOWN',message:'Original unknown write',retryable:false}});
  const input={terminal:'failed',evidenceRefs:['original-run'],reason:'Original native session was stopped; unknown receipt retained',
    assertUnchangedAndStopped(){assert.equal(runtime.loadCheckpoint(task.taskId,'native-original-readback').state,'cleared');}};
  return {runtime,taskId:task.taskId,input};
}

for(const terminal of ['failed','cancelled'])test(`native ${terminal} atomically ends orchestration and preserves original UNKNOWN record and cache`,()=>{
  const f=fixture();try{
    const before=f.runtime.getTask(f.taskId),records=f.runtime.readToolExecutions(f.taskId),cache=f.runtime.loadCheckpoint(f.taskId,'tool-result-original-run');
    const result=f.runtime.finishNativeReconciliation(f.taskId,before.revision,{...f.input,terminal});
    assert.equal(result.state,terminal);assert.equal(result.revision,before.revision+1);assert.equal(result.error.code,'RESULT_UNKNOWN');
    assert.deepEqual(f.runtime.readToolExecutions(f.taskId),records);assert.deepEqual(f.runtime.loadCheckpoint(f.taskId,'tool-result-original-run'),cache);
    const proof=f.runtime.loadCheckpoint(f.taskId,'native-reconciliation-termination:v1');
    assert.equal(proof.toolOutcomesPreserved,true);assert.equal(proof.cloudResent,false);assert.equal(proof.originalRevision,before.revision);
    assert.throws(()=>f.runtime.finishNativeReconciliation(f.taskId,result.revision,f.input),{code:'REVISION_CONFLICT'});
  }finally{f.runtime.close();}
});

test('native transaction rolls back a changed readback and refuses a stale revision or asynchronous guard',()=>{
  const f=fixture();try{
    const before=f.runtime.getTask(f.taskId),readback=f.runtime.loadCheckpoint(f.taskId,'native-original-readback');
    assert.throws(()=>f.runtime.finishNativeReconciliation(f.taskId,before.revision+1,f.input),{code:'REVISION_CONFLICT'});
    assert.throws(()=>f.runtime.finishNativeReconciliation(f.taskId,before.revision,{...f.input,assertUnchangedAndStopped(){
      f.runtime.saveCheckpoint(f.taskId,'native-original-readback',{sessionId:'wrong-session',state:'cleared'});
    }}),{code:'REVISION_CONFLICT'});
    assert.throws(()=>f.runtime.finishNativeReconciliation(f.taskId,before.revision,{...f.input,assertUnchangedAndStopped:async()=>{}}),{code:'INVALID_ARGUMENT'});
    assert.throws(()=>f.runtime.finishNativeReconciliation(f.taskId,before.revision,{...f.input,assertUnchangedAndStopped(){throw Error('Original session still active');}}),/still active/);
    assert.deepEqual(f.runtime.getTask(f.taskId),before);assert.deepEqual(f.runtime.loadCheckpoint(f.taskId,'native-original-readback'),readback);
    assert.equal(f.runtime.loadCheckpoint(f.taskId,'native-reconciliation-termination:v1'),undefined);
  }finally{f.runtime.close();}
});

test('native termination cannot pass a live original worker or original tool activity',()=>{
  const f=fixture();try{
    const before=f.runtime.getTask(f.taskId);
    f.runtime.active.set(f.taskId,new AbortController());
    assert.throws(()=>f.runtime.finishNativeReconciliation(f.taskId,before.revision,f.input),{code:'REVISION_CONFLICT'});f.runtime.active.clear();
    f.runtime.activeToolExecutions.set(JSON.stringify([f.taskId,'original-run']),'b'.repeat(64));
    assert.throws(()=>f.runtime.finishNativeReconciliation(f.taskId,before.revision,f.input),{code:'REVISION_CONFLICT'});f.runtime.activeToolExecutions.clear();
    assert.deepEqual(f.runtime.getTask(f.taskId),before);
  }finally{f.runtime.close();}
});

for(const fault of ['missing-terminal','wrong-session','wrong-request','wrong-digest','unknown-other-operation','malformed-unknown'])test(`native termination retains and rejects ${fault} cloud receipt`,()=>{
  const f=fixture();try{
    f.runtime.saveCheckpoint(f.taskId,'competition-cloud-inflight',receipt);f.runtime.saveCheckpoint(f.taskId,'competition-cloud-received',receipt);
    if(fault!=='missing-terminal')f.runtime.saveCheckpoint(f.taskId,'competition-cloud-terminal-error',{version:'1.0',kind:'wss_terminal_error',receipt:{...receipt,
      ...(fault==='wrong-session'?{sessionId:'different'}:fault==='wrong-request'?{requestId:'different'}:fault==='wrong-digest'?{payloadDigest:'c'.repeat(64)}:{})}});
    if(fault==='unknown-other-operation')f.runtime.saveCheckpoint(f.taskId,'competition-cloud-unknown',{...receipt,requestId:'other-operation'});
    if(fault==='malformed-unknown')f.runtime.saveCheckpoint(f.taskId,'competition-cloud-unknown',false);
    const before=f.runtime.getTask(f.taskId);
    assert.throws(()=>f.runtime.finishNativeReconciliation(f.taskId,before.revision,f.input),{code:'RESULT_UNKNOWN'});
    assert.deepEqual(f.runtime.getTask(f.taskId),before);assert.deepEqual(f.runtime.loadCheckpoint(f.taskId,'competition-cloud-inflight'),receipt);
    assert.equal(f.runtime.loadCheckpoint(f.taskId,'native-reconciliation-termination:v1'),undefined);
  }finally{f.runtime.close();}
});

test('an exact original terminal cloud error permits native termination while retaining all cloud markers',()=>{
  const f=fixture();try{
    for(const key of ['inflight','received','unknown'])f.runtime.saveCheckpoint(f.taskId,'competition-cloud-'+key,receipt);
    const marker={version:'1.0',kind:'wss_terminal_error',receipt};f.runtime.saveCheckpoint(f.taskId,'competition-cloud-terminal-error',marker);
    const before=f.runtime.getTask(f.taskId);f.runtime.finishNativeReconciliation(f.taskId,before.revision,f.input);
    for(const key of ['inflight','received','unknown'])assert.deepEqual(f.runtime.loadCheckpoint(f.taskId,'competition-cloud-'+key),receipt);
    assert.deepEqual(f.runtime.loadCheckpoint(f.taskId,'competition-cloud-terminal-error'),marker);
    assert.equal(f.runtime.loadCheckpoint(f.taskId,'native-reconciliation-termination:v1').cloudDisposition,'transport_terminal_error');
  }finally{f.runtime.close();}
});

test('native termination proof and original UNKNOWN receipt survive SQLite reopen',()=>{
  mkdirSync('.cache',{recursive:true});const folder=mkdtempSync(path.resolve('.cache/native-termination-')),file=path.join(folder,'runtime.sqlite');
  const f=fixture(file);let reopened;try{
    const records=f.runtime.readToolExecutions(f.taskId),before=f.runtime.getTask(f.taskId);
    const result=f.runtime.finishNativeReconciliation(f.taskId,before.revision,f.input),proof=f.runtime.loadCheckpoint(f.taskId,'native-reconciliation-termination:v1');
    f.runtime.close();reopened=new TaskRuntime(file);
    assert.deepEqual(reopened.getTask(f.taskId),result);assert.deepEqual(reopened.readToolExecutions(f.taskId),records);
    assert.deepEqual(reopened.loadCheckpoint(f.taskId,'native-reconciliation-termination:v1'),proof);
  }finally{if(reopened)reopened.close();else f.runtime.close();rmSync(folder,{recursive:true,force:true});}
});
