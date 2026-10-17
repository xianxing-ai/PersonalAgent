import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import {TaskRuntime} from '../dist/index.js';

test('active tool handoff binds the original first dispatch and is never restored or authorization',async()=>{
  const parent=fileURLToPath(new URL('../../../.cache/mcp-handoff/',import.meta.url));mkdirSync(parent,{recursive:true});
  const file=path.join(mkdtempSync(path.join(parent,'case-')),'runtime.sqlite');
  let release,entered,record,calls=0;
  const ready=new Promise(resolve=>{entered=resolve;}),waiting=new Promise(resolve=>{release=resolve;});
  const runtime=new TaskRuntime(file,{toolGateway:{list:()=>[],async invoke(invocation){
    calls++;record=runtime.readToolExecutions(invocation.taskId)[0];
    assert.equal(runtime.isToolExecutionActive(record),true);
    assert.equal(runtime.isToolExecutionActive({...record,inputDigest:'different'}),false);
    assert.equal(runtime.isToolExecutionActive({taskId:'absent',evidenceId:'absent'}),false);
    assert.equal(record.executionStarted,false,'handoff is not Policy authorization');
    entered();await waiting;throw new ProtocolError('RESULT_UNKNOWN','synthetic unknown');
  }}});
  const task=runtime.submitTask({goal:'synthetic handoff',conversationId:'handoff',idempotencyKey:'handoff'});
  runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
  const request={kind:'request',protocolVersion:'1.0.0',requestId:'handoff-request',taskId:task.taskId,idempotencyKey:'handoff-run',deadline:new Date(Date.now()+30000).toISOString(),operation:'tool.invoke',payload:{toolName:'synthetic.read',toolVersion:'1',arguments:{},scopeRef:'handoff-run'}};
  let other;
  try{
    const pending=runtime.send(request,new AbortController().signal);await ready;
    other=new TaskRuntime(file);
    assert.equal(other.readToolExecutions(task.taskId)[0].state,'started');
    assert.equal(other.isToolExecutionActive(record),false,'persisted started never creates a current-process handoff');
    other.close();other=undefined;
    release();assert.equal((await pending).outcome,'ok');
    assert.equal(runtime.isToolExecutionActive(record),false);
    assert.equal(runtime.readToolExecutions(task.taskId)[0].state,'unknown');
    runtime.transitionTask(task.taskId,'running');
    await runtime.send({...request,requestId:'handoff-replay'},new AbortController().signal);
    assert.equal(calls,1);assert.equal(runtime.isToolExecutionActive(record),false);
  }finally{release();other?.close();runtime.close();}
});
