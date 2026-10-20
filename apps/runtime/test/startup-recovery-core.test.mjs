import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {TaskRuntime} from '../dist/index.js';

test('real SQLite startup preserves original interrupted state/revision without replaying its task',()=>{
  mkdirSync('.cache',{recursive:true});const folder=mkdtempSync(path.resolve('.cache/startup-core-')),file=path.join(folder,'runtime.sqlite');
  let runtime=new TaskRuntime(file);try{
    const task=runtime.submitTask({goal:'original persisted task',conversationId:'fixture',idempotencyKey:'original'});
    runtime.transitionTask(task.taskId,'planning');const prior=runtime.transitionTask(task.taskId,'running');
    runtime.close();runtime=new TaskRuntime(file);
    const recovered=runtime.recoverInterruptedTasks();assert.equal(recovered.length,1);assert.equal(recovered[0].taskId,task.taskId);
    const marker=runtime.loadCheckpoint(task.taskId,'runtime-interruption:v1');
    assert.equal(marker.originalState,'running');assert.equal(marker.originalRevision,prior.revision);
    assert.equal(marker.recoveredRevision,recovered[0].revision);assert.deepEqual(runtime.recoverInterruptedTasks(),[]);
  }finally{runtime.close();rmSync(folder,{recursive:true,force:true});}
});
test('startup classification cannot adopt a worker already active in this Runtime',async()=>{
  const runtime=new TaskRuntime(':memory:');let release;try{
    const task=runtime.submitTask({goal:'still running',conversationId:'fixture',idempotencyKey:'live'});
    const work=runtime.runTask(task.taskId,()=>new Promise(resolve=>{release=resolve;}),{deadline:new Date(Date.now()+30000).toISOString(),sideEffect:'read'});
    assert.equal(runtime.isTaskActive(task.taskId),true);assert.deepEqual(runtime.recoverInterruptedTasks(),[]);
    assert.equal(runtime.getTask(task.taskId).state,'running');release({resultSummary:'done'});await work;
    assert.equal(runtime.isTaskActive(task.taskId),false);
  }finally{runtime.close();}
});
test('native cancellation ends only the original unstarted event root; generic created tasks retain prior semantics',()=>{
  const runtime=new TaskRuntime(':memory:');try{
    const origin={deliveryId:'original',eventDigest:'a'.repeat(64),sourceTaskId:'source',originalParentTaskId:'parent'};
    const event=runtime.submitTaskWithCheckpoint({goal:'event accepted before enqueue',conversationId:'fixture',idempotencyKey:'harness-event-root:original'},'harness-event-origin',origin);
    assert.equal(runtime.requestCancel(event.taskId).state,'cancelled');assert.equal(runtime.getTask(event.taskId).cancelRequested,true);
    const plain=runtime.submitTask({goal:'generic created',conversationId:'fixture',idempotencyKey:'generic'});
    assert.equal(runtime.requestCancel(plain.taskId).state,'cancelling');
  }finally{runtime.close();}
});
