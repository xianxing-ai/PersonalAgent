import test from 'node:test';
import assert from 'node:assert/strict';
import {mailSendIdentityScenario} from './fixtures/mail-send-identity-scenario.mjs';

test('unknown send uses one independently approved original Sent read; cancellation stays unchanged and no SMTP replays',async t=>{
  const f=await mailSendIdentityScenario({mode:'cancel',reconcile:true});t.after(()=>f.close());
  const taskId=await f.send();await f.wait(()=>f.sends()===1);
  await f.client.call('task.cancel',{taskId});await f.wait(()=>f.application.activeTaskCount===0);
  const runtime=f.application.runtime,original=runtime.getTask(taskId),execution=runtime.readToolExecutions(taskId)[0];
  assert.equal(execution.state,'unknown');assert.equal(original.cancelRequested,true);
  const source={taskId,runId:execution.evidenceId};
  const scope={deadline:new Date(Date.now()+30000).toISOString(),signal:new AbortController().signal};
  const read=f.host.prepareOriginalSendReconciliation(source,scope);
  await f.wait(()=>runtime.getTask(read.task.taskId).state==='waiting_approval');assert.equal(f.reads(),0);assert.equal(f.sends(),1);
  assert.equal(f.host.prepareOriginalSendReconciliation(source,scope).task.taskId,read.task.taskId);
  assert.equal(f.host.readOriginalSendReconciliation(source).state,'pending');
  await f.approve(read.task.taskId);await f.wait(()=>f.application.activeTaskCount===0
    &&['succeeded','failed','cancelled','waiting_reconciliation'].includes(runtime.getTask(read.task.taskId).state));
  assert.equal(f.host.readOriginalSendReconciliation(source).state,'confirmed');assert.equal(f.reads(),1);
  assert.equal(f.host.applyOriginalSendReconciliation(source).state,'confirmed');
  assert.deepEqual(runtime.getTask(taskId),original);assert.equal(runtime.readToolExecutions(taskId)[0].state,'unknown');
  assert.equal(runtime.readEvidence(taskId).filter(value=>value.kind==='observation'&&value.verification==='verified').length,1);
  assert.equal(f.host.applyOriginalSendReconciliation(source).state,'confirmed');assert.equal(f.reads(),1);assert.equal(f.sends(),1);
  f.rotate();assert.throws(()=>f.host.applyOriginalSendReconciliation(source),{code:'UNAUTHORIZED'});
});
