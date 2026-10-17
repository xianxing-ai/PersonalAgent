import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskRuntime} from '@personal-agent/runtime';
import {evaluateWorkflowShadowPolicy,createWorkflowShadowHistory,createWorkflowShadowCheckpointPort,verifyWorkflowShadowBranches} from '../dist/workflow-shadow-policy.js';

// Explicit synthetic host receipt verifier, not real business/model quality evidence.
const sign=value=>{const {proof,...body}=value;return createHmac('sha256','explicit-public-fixture-key').update(JSON.stringify(body)).digest('hex');};
const verify=async value=>value.proof===sign(value);
const receipt=(branch,extra={})=>{const value={receiptId:branch+'-receipt',taskKey:'task',taskClass:'coding',decisionRef:'decision',branch,
  candidateId:branch+'-candidate',baselineSha256:'a'.repeat(64),conditionsDigest:'b'.repeat(64),workspaceRef:branch+'-isolated',resultSha256:'c'.repeat(64),
  qualityMetricId:'fixture-quality-v1',qualityScore:branch==='shadow'?2:1,wallMs:branch==='shadow'?8:10,modelCalls:1,evidenceRefs:[branch+'-evidence'],...extra};return {...value,proof:sign(value)};};
const config={sampling:{base:0.4,min:0,max:1,adjustmentRate:0.2,minimumVerifiedSamples:1},comparison:{qualityWeight:1,wallMsWeight:0.1,modelCallWeight:0.1}};
const plan={taskKey:'task',taskClass:'coding',mode:'ordinary',decision:{selectedCandidateId:'main-candidate',shadowCandidateId:'shadow-candidate',shadowRequested:true,uncertain:false,decisionRef:'decision'}};
const resources={mainPriorityAvailable:true,shadowAllowed:true,taskValueEligible:true};
async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'pa-shadow-policy-')),path=join(directory,'runtime.sqlite');let runtime=new TaskRuntime(path);
  const anchor=runtime.submitTask({goal:'trusted policy history anchor',conversationId:'shadow-fixture',idempotencyKey:'history'});
  const anchorPort={loadCheckpoint:key=>runtime.loadCheckpoint(anchor.taskId,key),saveCheckpointOnce:(key,value)=>runtime.saveCheckpointOnce(anchor.taskId,key,value)};
  const checkpoints=createWorkflowShadowCheckpointPort(anchorPort),history=createWorkflowShadowHistory({checkpoints,verifyReceipt:verify});
  t.after(async()=>{runtime.close();await rm(directory,{recursive:true,force:true});});
  return {history,checkpoints,anchorPort,reopen:()=>{runtime.close();runtime=new TaskRuntime(path);},runtime:()=>runtime,anchor};
}
const evaluate=(history,changes={},configuration=config)=>evaluateWorkflowShadowPolicy({plan,resources,history,...changes},configuration);

test('ordinary tasks can deliver verified main without counterfactual; explicit comparison preserves both paths',async t=>{
  const f=await fixture(t),history=await f.history.read('coding'),main=await verifyWorkflowShadowBranches([receipt('main')],verify);
  const noSample={...config,sampling:{...config.sampling,base:0,min:0,max:0}};
  const ordinary=evaluate(history,{observedBranches:main},noSample);
  assert.equal(ordinary.action,'skip');assert.equal(ordinary.mayDeliverMain,true);assert.equal(ordinary.comparison.status,'unknown');
  const explicit=evaluate(history,{plan:{...plan,mode:'compare'},observedBranches:main},noSample);
  assert.equal(explicit.action,'run');assert.equal(explicit.mayDeliverMain,false);
  const none=evaluate(history,{plan:{...plan,decision:{...plan.decision,shadowRequested:false}}});assert.equal(none.action,'skip');
  assert.equal(evaluate(history,{plan:{...plan,decision:{...plan.decision,uncertain:true}}}).action,'need_teacher');
});
test('main priority, trusted resources and task value constrain shadow without invented budgets',async t=>{
  const f=await fixture(t),history=await f.history.read('coding'),explicit={...plan,mode:'compare'};
  assert.equal(evaluate(history,{plan:explicit,resources:{...resources,mainPriorityAvailable:false}}).action,'defer');
  assert.equal(evaluate(history,{plan:explicit,resources:{...resources,shadowAllowed:false}}).action,'defer');
  assert.equal(evaluate(history,{plan:explicit,resources:{...resources,taskValueEligible:false}}).action,'skip');
  assert.equal(evaluate(history,{plan:{...plan,decision:{...plan.decision,shadowCandidateId:'main-candidate'}}}).action,'need_teacher');
});
test('only same-baseline isolated comparable evidence yields quality/time/call deltas',async t=>{
  const f=await fixture(t),history=await f.history.read('coding');
  const observed=await verifyWorkflowShadowBranches([receipt('main'),receipt('shadow')],verify);
  const result=evaluate(history,{observedBranches:observed});assert.equal(result.action,'skip');assert.equal(result.mayDeliverMain,true);
  assert.deepEqual(result.comparison,{status:'comparable',qualityDelta:1,wallMsDelta:-2,modelCallsDelta:0,benefit:1.2,recommendedBranch:'shadow'});
  for(const extra of [{baselineSha256:'d'.repeat(64)},{conditionsDigest:'e'.repeat(64)},{workspaceRef:'main-isolated'},{qualityMetricId:'different'}]) {
    const mismatched=await verifyWorkflowShadowBranches([receipt('main'),receipt('shadow',extra)],verify);
    const unknown=evaluate(history,{observedBranches:mismatched,plan:{...plan,mode:'compare'}});
    assert.equal(unknown.comparison.status,'unknown');assert.equal(unknown.action,'need_teacher');assert.equal(unknown.mayDeliverMain,false);
  }
});
test('real SQLite checkpoints persist verified history, exact replay does not count twice, sampling is task-stable',async t=>{
  const f=await fixture(t);assert.equal((await f.history.record(receipt('main'),receipt('shadow'))).recorded,true);
  assert.equal((await f.history.record(receipt('main'),receipt('shadow'))).reason,'duplicate_verified_pair');
  f.reopen();const history=await f.history.read('coding'),result=evaluate(history);
  assert.equal(result.historySamples,1);assert.ok(Math.abs(result.samplingRate-0.6)<1e-12);assert.equal(result.provenance,'experience_statistics_not_training');
  assert.equal(evaluate(history).sampled,result.sampled);
  assert.equal((await f.history.read('other-class')).pairs.length,0);
  // Public JS object mutation cannot rewrite the private verified snapshot.
  history.pairs[0][1].qualityScore=-100;assert.equal(evaluate(history).samplingRate,result.samplingRate);
});
test('missing counterfactual conditions never enter benefit history and adverse history lowers host-configured sampling',async t=>{
  const f=await fixture(t);
  const unknown=await f.history.record(receipt('main'),receipt('shadow',{conditionsDigest:'d'.repeat(64)}));
  assert.equal(unknown.recorded,false);assert.equal((await f.history.read('coding')).pairs.length,0);
  await f.history.record(receipt('main'),receipt('shadow',{qualityScore:0,wallMs:20,modelCalls:4}));
  assert.equal(evaluate(await f.history.read('coding')).samplingRate,0.2);
});
test('user/model verified labels, forged history and receipts for a different selected task are rejected',async t=>{
  const f=await fixture(t),history=await f.history.read('coding');
  await assert.rejects(verifyWorkflowShadowBranches([{...receipt('main'),proof:'model says verified',verified:true}],verify),{code:'UNAUTHORIZED'});
  assert.throws(()=>evaluate({taskClass:'coding',pairs:[],verified:true}),{code:'UNAUTHORIZED'});
  assert.throws(()=>evaluate(history,{observedBranches:{branches:[receipt('main')],verified:true}}),{code:'UNAUTHORIZED'});
  const other=await verifyWorkflowShadowBranches([receipt('main',{taskKey:'other-task'})],verify);
  assert.throws(()=>evaluate(history,{observedBranches:other}),{code:'REVISION_CONFLICT'});
});
test('existing checkpoint writeOnce arbitrates concurrent history append; revision corruption is rejected',async t=>{
  const f=await fixture(t),second=createWorkflowShadowHistory({checkpoints:createWorkflowShadowCheckpointPort(f.anchorPort),verifyReceipt:verify});
  const outcomes=await Promise.allSettled([f.history.record(receipt('main'),receipt('shadow')),second.record(receipt('main'),receipt('shadow'))]);
  assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,1);
  assert.equal(outcomes.find(value=>value.status==='rejected').reason.code,'REVISION_CONFLICT');
  assert.equal((await f.history.read('coding')).pairs.length,1);
  const changed=receipt('shadow',{qualityScore:3});await assert.rejects(f.history.record(receipt('main'),changed),{code:'REVISION_CONFLICT'});
  const key='workflow-shadow-history:v1:'+createHash('sha256').update(JSON.stringify('coding')).digest('hex')+':revision:1';
  const envelope=f.runtime().loadCheckpoint(f.anchor.taskId,key);
  f.runtime().saveCheckpoint(f.anchor.taskId,key,{...envelope,previousDigest:'tampered-fixture'});
  await assert.rejects(f.history.read('coding'),{code:'INVALID_ARGUMENT'});
});
