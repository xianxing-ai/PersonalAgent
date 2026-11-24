import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {TaskRuntime} from '../dist/index.js';
import {completeRuntimeConnectorWatchWake,runRuntimeConnectorChangeDecision} from '../dist/application.js';

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

test('cancelled pure local connector tasks allow stop epoch checkpoints while unknown checkpoints still fail closed',async()=>{
  const runtime=new TaskRuntime(':memory:');
  const application={profile:'huawei_ict_agentarts',runtime};
  const deadline=new Date(Date.now()+60_000).toISOString();
  const summary='收到一封新邮件';
  const unusedChooser={choose:async()=>{throw new Error('Chooser must not run for cancelled decision');}};
  const unusedReadCurrent=()=>{throw new Error('readCurrent must not run before confirmCancellation');};
  try {
    const cleanOrigin={id:'change-clean',origin:{taskId:'source-1',runId:'run-1'},revision:'rev-1'};
    const cleanTask=runtime.submitTaskWithCheckpoint({goal:'判断是否告知用户：'+summary,conversationId:'desktop-panel',
      idempotencyKey:'clean-cancel'},'connector-change-origin',cleanOrigin);
    runtime.saveCheckpointOnce(cleanTask.taskId,'application-deadline',deadline);
    runtime.saveCheckpointOnce(cleanTask.taskId,'connector-change-decision',{action:'notify',reason:'selected',
      receiptId:'persisted-choice',calibrated:false,deadline,decidedAt:new Date().toISOString()});
    runtime.transitionTask(cleanTask.taskId,'planning');
    runtime.transitionTask(cleanTask.taskId,'running');
    runtime.requestCancel(cleanTask.taskId,'Explicit cancel');
    runtime.recoverInterruptedTasks();
    assert.equal(runtime.getTask(cleanTask.taskId).state,'waiting_reconciliation');

    const settled=await runRuntimeConnectorChangeDecision({application,taskId:cleanTask.taskId,origin:cleanOrigin,
      summary,deadline,signal:new AbortController().signal,chooser:unusedChooser,readCurrent:unusedReadCurrent});
    assert.equal(settled.state,'cancelled');

    for(const kind of ['cloud','extra-epoch']){
      const origin={id:'change-'+kind,origin:{taskId:'source-1',runId:'run-1'},revision:'rev-1'};
      const polluted=runtime.submitTaskWithCheckpoint({goal:'判断是否告知用户：'+summary,conversationId:'desktop-panel',
        idempotencyKey:'polluted-'+kind},'connector-change-origin',origin);
      runtime.saveCheckpointOnce(polluted.taskId,'application-deadline',deadline);
      runtime.transitionTask(polluted.taskId,'planning');
      runtime.transitionTask(polluted.taskId,'running');
      runtime.requestCancel(polluted.taskId,'Explicit cancel');
      if(kind==='cloud')runtime.saveCheckpointOnce(polluted.taskId,'competition-cloud-inflight',{synthetic:true});
      else runtime.advanceExecutionEpoch(polluted.taskId,{requestId:'pause',reason:'pause'});
      runtime.recoverInterruptedTasks();
      await assert.rejects(runRuntimeConnectorChangeDecision({application,taskId:polluted.taskId,origin,
        summary,deadline,signal:new AbortController().signal,chooser:unusedChooser,readCurrent:unusedReadCurrent}),
        {code:'RESULT_UNKNOWN'});
      assert.equal(runtime.getTask(polluted.taskId).state,'waiting_reconciliation');
    }

    const createWake=(scheduleId,extraCloud=false)=>{
      runtime.createSchedule({scheduleId,conversationId:'connector-watch:fixture:'+scheduleId,
        goal:'唤醒已批准的连接器订阅',runAt:new Date(Date.now()-1000).toISOString(),timeZone:'UTC',
        missedRunPolicy:'run_once',taskIdempotencyKey:scheduleId});
      runtime.dispatchDueSchedules('connector-watch:fixture:'+scheduleId);
      const wake=runtime.getSchedule(scheduleId);
      runtime.saveCheckpointOnce(wake.taskId,'connector-watch-wake-admission',{version:1,scheduleId,taskId:wake.taskId,
        conversationId:wake.conversationId,idempotencyKey:wake.taskIdempotencyKey,deadline});
      runtime.transitionTask(wake.taskId,'planning');
      runtime.transitionTask(wake.taskId,'running');
      runtime.requestCancel(wake.taskId,'Explicit wake cancel');
      if(extraCloud)runtime.saveCheckpointOnce(wake.taskId,'competition-cloud-inflight',{synthetic:true});
      runtime.recoverInterruptedTasks();
      return wake;
    };

    const cleanWake=createWake('connector-watch-clean-cancel');
    const cancelledWake=await completeRuntimeConnectorWatchWake({application,scheduleId:cleanWake.scheduleId,deadline});
    assert.equal(cancelledWake.state,'cancelled');

    const pollutedWake=createWake('connector-watch-cloud-cancel',true);
    await assert.rejects(completeRuntimeConnectorWatchWake({application,scheduleId:pollutedWake.scheduleId,deadline}),
      {code:'RESULT_UNKNOWN'});
    assert.equal(runtime.getTask(pollutedWake.taskId).state,'waiting_reconciliation');
  } finally {runtime.close();}
});
