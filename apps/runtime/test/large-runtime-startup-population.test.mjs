import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskRuntime} from '../dist/index.js';
import {createRuntimeStartupRecovery} from '../dist/application/startup-recovery.js';

function fixture(t) {
  const runtime=new TaskRuntime(':memory:');t.after(()=>runtime.close());
  const task=runtime.submitTask({goal:'Synthetic original startup task',conversationId:'synthetic-original',idempotencyKey:'original'});
  for(const [key,value]of Object.entries({'application-profile':'huawei_ict_agentarts','application-goal':task.goal,
    'application-deadline':'2035-01-01T00:00:00.000Z','competition-configuration-binding':'synthetic-configuration','competition-max-steps':4}))
    runtime.saveCheckpoint(task.taskId,key,value);
  const queries=[],listTasks=runtime.listTasks.bind(runtime);
  runtime.listTasks=options=>{const page=listTasks(options);queries.push({options:structuredClone(options),
    returned:page.items.length,snapshotSequence:page.snapshotSequence});return page;};
  const options={runtime,configurationRef:'synthetic-configuration',durableCloudDispatch:true,exclusiveOwner:true,
    resumeOriginalTask(){assert.fail('Read-only inspection cannot start a worker');}};
  return {runtime,task,queries,options};
}

test('startup inspection queries only original child conversation instead of every unrelated task',t=>{
  const f=fixture(t);
  for(let index=0;index<250;index++)f.runtime.submitTask({goal:'Synthetic unrelated task',conversationId:'synthetic-unrelated',idempotencyKey:'unrelated-'+index});
  const result=createRuntimeStartupRecovery(f.options).inspect(f.task.taskId);
  assert.equal(result.classification,'before_first_send');
  t.diagnostic(JSON.stringify({kind:'real-sqlite-inspection',population:251,queries:f.queries.length,
    globalQueries:f.queries.filter(query=>query.options.conversationId===undefined).length,
    returnedRows:f.queries.reduce((sum,query)=>sum+query.returned,0)}));
  assert.ok(f.queries.every(query=>query.options.conversationId==='desktop-subtask:'+f.task.taskId),
    'Original-child inspection must not repeatedly enumerate unrelated Runtime history');
  assert.equal(f.queries.reduce((sum,query)=>sum+query.returned,0),0);
});

test('startup child queries preserve pagination and do not miss an unfinished oldest child after one hundred rows',t=>{
  const f=fixture(t),conversationId='desktop-subtask:'+f.task.taskId;
  const oldest=f.runtime.submitTask({goal:'Synthetic pending child',conversationId,idempotencyKey:'oldest-child'});
  for(let index=0;index<130;index++){
    const child=f.runtime.submitTask({goal:'Synthetic terminal child',conversationId,idempotencyKey:'terminal-'+index});
    f.runtime.transitionTask(child.taskId,'planning');f.runtime.transitionTask(child.taskId,'running');
    f.runtime.transitionTask(child.taskId,'verifying');f.runtime.transitionTask(child.taskId,'succeeded',{resultSummary:'Synthetic completed'});
  }
  const result=createRuntimeStartupRecovery(f.options).inspect(f.task.taskId);
  assert.equal(result.classification,'parent_wait');assert.equal(f.runtime.getTask(oldest.taskId).state,'created');
  t.diagnostic(JSON.stringify({kind:'real-sqlite-child-pagination',childPopulation:131,queries:f.queries.length,
    globalQueries:f.queries.filter(query=>query.options.conversationId===undefined).length,
    returnedRows:f.queries.reduce((sum,query)=>sum+query.returned,0)}));
  assert.ok(f.queries.every(query=>query.options.conversationId===conversationId));
  assert.equal(f.queries.length,2);assert.equal(f.queries[1].options.snapshotSequence,f.queries[0].snapshotSequence);
  assert.equal(f.queries.reduce((sum,query)=>sum+query.returned,0),131);
});

test('a child admitted during startup handoff invalidates original recovery facts without running the parent',async t=>{
  const f=fixture(t);let workerHandoffs=0,newChild;
  const recovery=createRuntimeStartupRecovery({...f.options,resumeOriginalTask(request){
    workerHandoffs++;
    newChild=f.runtime.submitTask({goal:'Synthetic newly observed child',conversationId:'desktop-subtask:'+f.task.taskId,idempotencyKey:'late-child'});
    request.assertUnchanged();assert.fail('Changed original population cannot start the parent worker');
  }});
  const report=await recovery.recover();assert.equal(workerHandoffs,1);
  assert.equal(report.items[0].outcome,'retained');
  assert.equal(report.items[0].reason,'original_worker_rejected_changed_or_unavailable_recovery');
  assert.equal(f.runtime.getTask(f.task.taskId).state,'created');assert.equal(f.runtime.getTask(newChild.taskId).state,'created');
  assert.equal(f.runtime.readToolExecutions(f.task.taskId).length,0);
});
