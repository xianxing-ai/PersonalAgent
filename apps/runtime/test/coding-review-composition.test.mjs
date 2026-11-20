import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeApplication} from '../dist/application.js';
import {codingRepairSignedReviewDescriptor} from '../dist/application/coding-repair-signed-review.js';

// Synthetic image and review ports; actual ToolGateway is used for registration.
const tool=()=>({descriptor:codingRepairSignedReviewDescriptor(),execute:async()=>({})});
const port={read:()=>undefined,assertCurrent:()=>{}};
const make=options=>createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',coordinationBinding:'synthetic-coordinator',
  assertCoordinationBinding:()=>{},codingRepair:{image:{bindingId:'synthetic-image',advance:async()=>{throw Error('unused');},
    receiptSecret:async()=>{throw Error('unused');}}},...options});
test('trusted F15 reviewer registers into the existing gateway only before tasks',()=>{
  const app=make();try{
    assert.deepEqual(app.readCodingRepairExecutionIdentity(),{coordinationBinding:'synthetic-coordinator',imageBinding:'synthetic-image'});
    const before=app.tools.list();assert.equal(before.filter(value=>value.name==='workflow.host.f15_independent_review').length,1);
    app.configureCodingRepairIndependentReview({tool:tool(),port});
    assert.deepEqual(app.tools.list(),before,'configuration must not change the frozen gateway descriptors');
    app.runtime.submitTask({goal:'Synthetic pending task',conversationId:'test',idempotencyKey:'test'});
    assert.throws(()=>app.configureCodingRepairIndependentReview({tool:tool(),port}),{code:'REVISION_CONFLICT'});
    assert.equal(app.tools.list().filter(value=>value.name==='workflow.host.f15_independent_review').length,1);
  }finally{app.close();}
});
test('missing or changed deployment and another owner of the name fail closed',()=>{
  const unavailable=make({assertCoordinationBinding:()=>{throw Error('changed');}});
  try{assert.equal(unavailable.readCodingRepairExecutionIdentity(),undefined);
    assert.throws(()=>unavailable.configureCodingRepairIndependentReview({tool:tool(),port}),{code:'UNSUPPORTED_CAPABILITY'});}
  finally{unavailable.close();}
  const duplicate=make({tools:[tool()]});try{
    assert.throws(()=>duplicate.configureCodingRepairIndependentReview({tool:tool(),port}),{code:'REVISION_CONFLICT'});
  }finally{duplicate.close();}
});
test('F15 reviewer is host-only even if an availability entry attempts to publish it',async()=>{
  const app=make({competitionToolAvailability:[{toolName:'workflow.host.f15_independent_review',toolVersion:'1.0.0',available:()=>true}],
    competitionToolExports:[{toolName:'workflow.host.f15_independent_review',toolVersion:'1.0.0',exportPolicyVersion:'synthetic',
      accepts:()=>true,project:({result})=>result}]});
  try{
    await assert.rejects(app.send({operation:'tool.invoke',payload:{toolName:'workflow.host.f15_independent_review'}},new AbortController().signal),{code:'UNAUTHORIZED'});
    const task=app.runtime.submitTask({goal:'Synthetic catalog',conversationId:'test',idempotencyKey:'catalog'}),deadline=new Date(Date.now()+60000).toISOString();
    await app.runtime.runTask(task.taskId,async worker=>{
      const entries=await app.prepareCompetitionToolCatalog({taskId:task.taskId,deadline,signal:worker.signal});
      assert.equal(entries.some(value=>value.name==='workflow.host.f15_independent_review'),false);
      return {resultSummary:'catalog verified'};
    },{deadline,sideEffect:'read'});
  }finally{app.close();}
});
test('an original waiting-reconciliation task prevents review-provider replacement',async()=>{
  const app=make();try{
    app.configureCodingRepairIndependentReview({tool:tool(),port});
    const task=app.runtime.submitTask({goal:'Synthetic unknown',conversationId:'test',idempotencyKey:'unknown'}),deadline=new Date(Date.now()+60000).toISOString();
    await app.runtime.runTask(task.taskId,async()=>{app.runtime.transitionTask(task.taskId,'waiting_reconciliation');
      return {resultSummary:'unknown'};},{deadline,sideEffect:'read'});
    assert.equal(app.runtime.getTask(task.taskId).state,'waiting_reconciliation');
    assert.throws(()=>app.configureCodingRepairIndependentReview({tool:tool(),port}),{code:'REVISION_CONFLICT'});
  }finally{app.close();}
});
