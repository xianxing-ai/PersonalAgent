import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {TaskRuntime} from '../dist/index.js';

test('execution epoch survives restart, deduplicates controls and retains original checkpoints',()=>{
  mkdirSync('.cache',{recursive:true});
  const path=join(mkdtempSync('.cache/execution-epoch-'),'runtime.sqlite');
  let runtime=new TaskRuntime(path);
  const task=runtime.submitTask({goal:'Synthetic epoch persistence',conversationId:'epoch-fixture',idempotencyKey:'epoch'});
  try {
    assert.equal(runtime.readExecutionEpoch(task.taskId),0);
    assert.throws(()=>runtime.assertExecutionEpoch(task.taskId,-1),{code:'REVISION_CONFLICT'});
    assert.equal(runtime.loadCheckpoint(task.taskId,'competition-stale-epoch'),undefined);
    assert.equal(runtime.advanceExecutionEpoch(task.taskId,{requestId:'pause',reason:'pause'}),1);
    runtime.saveCheckpoint(task.taskId,'original-unknown-operation',{runId:'original-run',state:'unknown'});
    runtime.close();runtime=new TaskRuntime(path);
    assert.equal(runtime.readExecutionEpoch(task.taskId),1);
    assert.equal(runtime.advanceExecutionEpoch(task.taskId,{requestId:'pause',reason:'pause'}),1);
    assert.throws(()=>runtime.advanceExecutionEpoch(task.taskId,{requestId:'pause',reason:'stop'}),{code:'REVISION_CONFLICT'});
    assert.throws(()=>runtime.assertExecutionEpoch(task.taskId,0),{code:'REVISION_CONFLICT'});
    assert.deepEqual(runtime.loadCheckpoint(task.taskId,'competition-stale-epoch'),{expected:0,current:1});
    assert.equal(runtime.advanceExecutionEpoch(task.taskId,{requestId:'replan',reason:'replan'}),2);
    runtime.requestCancel(task.taskId);
    assert.equal(runtime.readExecutionEpoch(task.taskId),3);
    assert.throws(()=>runtime.assertExecutionEpoch(task.taskId,2),{code:'REVISION_CONFLICT'});
    assert.deepEqual(runtime.loadCheckpoint(task.taskId,'competition-stale-epoch'),{expected:0,current:1});
    runtime.requestCancel(task.taskId);
    assert.equal(runtime.readExecutionEpoch(task.taskId),3);
    assert.deepEqual(runtime.loadCheckpoint(task.taskId,'original-unknown-operation'),{runId:'original-run',state:'unknown'});
  } finally {runtime.close();}
});

test('epoch invalidation preserves an actually started unknown tool record for independent readback',async()=>{
  const runtime=new TaskRuntime(':memory:',{toolGateway:{list:()=>[],invoke:async invocation=>{
    invocation.onAuthorized();throw new ProtocolError('RESULT_UNKNOWN','Synthetic interrupted write');
  }}});
  const task=runtime.submitTask({goal:'Synthetic unknown effect',conversationId:'epoch-fixture',idempotencyKey:'unknown-effect'});
  const client=new Client(runtime);await client.connect();
  runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
  try {
    const outcome=await client.call('tool.invoke',{toolName:'fixture.write',toolVersion:'1.0.0',arguments:{},scopeRef:'fixture'},
      {taskId:task.taskId,idempotencyKey:'original-unknown-run'});
    assert.equal(outcome.state,'unknown');
    const original=runtime.readToolExecutions(task.taskId);
    assert.equal(original[0].executionStarted,true);
    runtime.advanceExecutionEpoch(task.taskId,{requestId:'replan',reason:'replan'});
    runtime.requestCancel(task.taskId);
    assert.deepEqual(runtime.readToolExecutions(task.taskId),original);
    assert.equal(runtime.getTask(task.taskId).state,'waiting_reconciliation');
    assert.equal(runtime.getTask(task.taskId).cancelRequested,true);
  } finally {runtime.close();}
});

test('final ToolGateway authorization fence rejects an epoch changed during an asynchronous gateway wait',async()=>{
  let entered,release,executions=0;
  const waiting=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const runtime=new TaskRuntime(':memory:',{toolGateway:{list:()=>[],invoke:async invocation=>{
    entered();await gate;invocation.onAuthorized();executions++;return {};
  }}});
  const task=runtime.submitTask({goal:'Synthetic final execution fence',conversationId:'epoch-fixture',idempotencyKey:'epoch-gateway'});
  const client=new Client(runtime);await client.connect();
  runtime.transitionTask(task.taskId,'planning');
  runtime.transitionTask(task.taskId,'running');
  try {
    const invocation=client.call('tool.invoke',{toolName:'fixture.write',toolVersion:'1.0.0',arguments:{},scopeRef:'fixture'},
      {taskId:task.taskId,idempotencyKey:'original-run'});
    const rejected=assert.rejects(invocation,{code:'REVISION_CONFLICT'});
    await waiting;
    runtime.advanceExecutionEpoch(task.taskId,{requestId:'replan',reason:'replan'});
    release();await rejected;
    assert.equal(executions,0);
    assert.equal(runtime.readToolExecutions(task.taskId)[0].executionStarted,false);
    assert.equal(runtime.readToolExecutions(task.taskId)[0].state,'failed');
  } finally {runtime.close();}
});
