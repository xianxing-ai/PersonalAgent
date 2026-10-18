import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskRuntime} from '@personal-agent/runtime';
import {ProactiveWorkflowEngine,proactiveWorkflowDigest,getProactiveWorkflowDescriptor,getProactiveWorkflowAdapterRequirements} from '../dist/proactive-workflows.js';

// Host signatures are explicit synthetic provenance fixtures; no real model/account quality claim.
const mac=value=>{const {proof,...body}=value;return createHmac('sha256','explicit-public-proactive-fixture').update(proactiveWorkflowDigest(body)).digest('hex');};
const signed=value=>({...value,proof:mac(value)}),valid=async value=>value.proof===mac(value);
const contracts=[false,true].map(qualifiedForMain=>({id:qualifiedForMain?'mature':'triage',version:'v1',criteria:'Use source context and current responsibility; no subscription is not irrelevance',
  qualifiedForMain,batchIndependent:true,candidates:['continue','research','delegate','local_plan','shadow','notify','request_user','defer','ignore'].map(action=>({id:action,action,description:action}))}));
const caps=['retrieve_context','local_decision_batch','teacher_decision','continue','research','delegate','local_plan','shadow','notify','request_user','update_item','schedule_wake'].map(kind=>({kind,ref:'fixture.'+kind,
  location:['retrieve_context','local_decision_batch','research'].includes(kind)?'local_device':'cloud_persistent',effect:['retrieve_context','local_decision_batch','teacher_decision','research'].includes(kind)?'read':'write'}));
const event=(now,id,entry='connector',extra={})=>signed({eventId:id,entry,conversationId:'conversation',sourceId:'source-'+id,entityRef:'entity-'+id,sourceVersion:'v1',observedAt:new Date(now-1000).toISOString(),
  change:'upsert',payloadRef:'actual-source-ref-'+id,payloadDigest:'a'.repeat(64),anchorRefs:['anchor-'+id],responsibilityRefs:[],goalRefs:[],contractRef:'triage',priority:'unknown',evidenceRefs:['persisted-source-'+id],...extra});
async function fixture(t,extra={}) {
  const directory=await mkdtemp(join(tmpdir(),'pa-proactive-')),path=join(directory,'runtime.sqlite');let runtime=new TaskRuntime(path),clock=Date.now(),latest;
  const anchor=runtime.submitTask({goal:'existing proactive fixture anchor',conversationId:'conversation',idempotencyKey:'proactive'}),timings=[];
  const identity={taskId:anchor.taskId,sessionId:'session',controlRevision:1,taskDeadline:new Date(clock+600000).toISOString()};
  const options={checkpointSecret:'explicit-public-proactive-checkpoint-secret',decisionContracts:contracts,verifyEvent:valid,verifyResponsibility:valid,
    verifyControl:valid,verifyReceipt:async(r,p)=>await valid(r)&&r.operationId===p.operationId&&r.argumentsDigest===p.argumentsDigest,now:()=>clock,onStage:value=>timings.push(value),...extra};
  let engine=new ProactiveWorkflowEngine(options),sequence=0;
  t.after(async()=>{runtime.close();await rm(directory,{recursive:true,force:true});});
  return {identity,timings,runtime:()=>runtime,get latest(){return latest;},
    event:(id,entry='connector',values={})=>event(clock,id,entry,values),
    async advance(delta={}){clock++;const result=await engine.advance({...identity,requestId:'request-'+(++sequence),deadline:identity.taskDeadline,signal:new AbortController().signal,
      availableCapabilities:caps,hostAvailability:{localDevice:true,cloudPersistentHost:true},...(latest?{checkpoint:latest.checkpoint}:{}),...delta});
      runtime.saveCheckpointOnce(anchor.taskId,'proactive-result-'+result.advanceRevision,result);latest=result;return result;},
    ack(p,result,state='confirmed'){clock++;return signed({proposalId:p.proposalId,operationId:p.operationId,argumentsDigest:p.argumentsDigest,state,result,observedAt:new Date(clock).toISOString(),evidenceRefs:['actual-fixture-evidence-'+p.operationId]});},
    control(action,id=action){return signed({commandId:id,action,evidenceRefs:['actual-fixture-control-'+id]});},
    reopen(){runtime.close();runtime=new TaskRuntime(path);engine=new ProactiveWorkflowEngine(options);latest=runtime.loadCheckpoint(anchor.taskId,'proactive-result-'+latest.advanceRevision);},
    async retrieve(result=latest){return this.advance({receipts:result.proposals.filter(p=>p.stage==='retrieve').map(p=>this.ack(p,{contextRef:'actual-context-'+p.itemIds[0],sourceVersions:{[p.arguments.source.sourceId]:p.arguments.source.version},
      sourceQuotes:[],goalRefs:[],memoryRefs:[],experienceRefs:[],scopeRefs:[]}))});},
    async select(result=latest,action='research',overrides={}){return this.advance({receipts:result.proposals.filter(p=>['laya','teacher'].includes(p.stage)).map(p=>this.ack(p,{selections:p.itemIds.map(itemId=>({itemId,candidateId:action,
      decisionRef:'actual-fixture-decision-'+p.operationId,decidedBy:p.stage==='laya'?'laya':'deepseek',uncertain:false,complex:false,importance:'normal',authorityRequired:false,...overrides}))}))});},
  };
}

test('four entrances are retained even with no subscriptions; duplicate versions merge and independent questions batch Laya-first',async t=>{
  const f=await fixture(t),inputs=['connector','user_instruction','subtask_feedback','wake'].map((entry,i)=>f.event('event-'+i,entry));
  let result=await f.advance({events:[...inputs,inputs[0]]});assert.equal(Object.keys(result.items).length,4);assert.equal(result.proposals.length,4);
  assert.ok(result.proposals.every(p=>p.stage==='retrieve'));result=await f.retrieve();assert.equal(result.proposals.length,1);
  assert.equal(result.proposals[0].stage,'laya');assert.equal(result.proposals[0].itemIds.length,4);
  assert.ok(result.proposals[0].arguments.independentQuestions.every(q=>q.candidateOnly));
  result=await f.select(result,'ignore',{importance:'irrelevant'});assert.equal(result.proposals[0].stage,'teacher','unqualified Laya cannot silently suppress an event');
  result=await f.select(result,'research');assert.equal(result.proposals.length,4);assert.ok(result.proposals.every(p=>p.stage==='action'));
  assert.ok(f.timings.every(value=>Number.isFinite(value.wallMs)&&value.startedAtUtc&&value.finishedAtUtc));
});
test('mature contract handles ordinary events without a permanent second model; important suppression still escalates',async t=>{
  const f=await fixture(t);await f.advance({events:[f.event('mature','connector',{contractRef:'mature'})]});await f.retrieve();
  let result=await f.select(undefined,'research');assert.equal(result.proposals[0].stage,'action');
  const g=await fixture(t);await g.advance({events:[g.event('important','connector',{contractRef:'mature',priority:'important'})]});await g.retrieve();
  result=await g.select(undefined,'ignore',{importance:'irrelevant'});assert.equal(result.proposals[0].stage,'teacher');
  result=await g.select(result,'ignore',{importance:'irrelevant'});assert.equal(result.proposals[0].capabilityKind,'request_user');
});
test('actual branch receipts update existing SQLite state and reasoned wake uses the original Scheduler; return never replays notification',async t=>{
  const f=await fixture(t);await f.advance({events:[f.event('notify')]});await f.retrieve();await f.select();let result=await f.select(undefined,'notify');
  const notification=result.proposals[0];let notificationCalls=1;const wake={runAt:new Date(Date.now()+60000).toISOString(),reason:'actual source expires; refresh this responsibility',timeZone:'UTC',missedRunPolicy:'run_once'};
  result=await f.advance({receipts:[f.ack(notification,{status:'changed',resultRef:'actual-notification-readback',nextWake:wake})]});
  const update=result.proposals[0];f.runtime().saveCheckpoint(f.identity.taskId,'actual-item-'+update.itemIds[0],update.arguments);
  result=await f.advance({receipts:[f.ack(update,{itemId:update.itemIds[0],stateRef:'sqlite:actual-item'})]});
  const schedule=result.proposals[0],actual=f.runtime().createSchedule({scheduleId:schedule.operationId,goal:'refresh original responsibility',conversationId:'conversation',
    runAt:schedule.arguments.wake.runAt,timeZone:'UTC',missedRunPolicy:'run_once',taskIdempotencyKey:schedule.arguments.taskIdempotencyKey});
  result=await f.advance({receipts:[f.ack(schedule,{scheduleId:actual.scheduleId,runAt:actual.runAt,state:actual.status})]});
  assert.equal(Object.values(result.items)[0].state,'done');f.reopen();
  result=await f.advance({control:f.control('enter_unattended')});assert.equal(result.mode,'unattended');
  result=await f.advance({control:f.control('return')});assert.equal(result.returnSummary.changed.length,1);assert.equal(result.returnSummary.replayedNotifications,0);assert.equal(result.proposals.length,0);
  result=await f.advance({control:f.control('return')});assert.equal(result.returnSummary.newEvidenceOperationIds.length,0);assert.equal(result.proposals.length,0);
  assert.equal(notificationCalls,1);assert.equal(f.runtime().listSchedules('conversation').length,1);
});
test('unknown write is not resubmitted while another independent branch progresses; original readback can settle it',async t=>{
  const f=await fixture(t);await f.advance({events:[f.event('a'),f.event('b')]});await f.retrieve();await f.select();let result=await f.select(undefined,'delegate');
  const [a,b]=result.proposals;result=await f.advance({receipts:[f.ack(a,{reason:'write outcome unknown'},'unknown'),f.ack(b,{status:'completed',resultRef:'actual-child-result'})]});
  assert.equal(result.proposals.length,1);assert.equal(result.proposals[0].stage,'update');assert.equal(result.cancellationRequirements[0].operationId,a.operationId);
  assert.equal(Object.values(result.items).find(i=>i.itemId===a.itemIds[0]).state,'waiting_reconciliation');
  const before=result.proposals[0];result=await f.advance();assert.equal(result.proposals.length,0,'no duplicate original operations');
  result=await f.advance({receipts:[f.ack(a,{status:'completed',resultRef:'original-write-reconciled'}),f.ack(before,{itemId:before.itemIds[0],stateRef:'actual-state'})]});
  assert.ok(result.proposals.every(p=>p.operationId!==a.operationId));assert.equal(result.proposals[0].stage,'update');
});
test('offline local device waits without actual cloud persistent host; configured cloud takeover does not pretend Laya ran',async t=>{
  const f=await fixture(t);let result=await f.advance({events:[f.event('offline')],hostAvailability:{localDevice:false,cloudPersistentHost:false}});
  assert.equal(result.proposals.length,0);assert.equal(Object.values(result.items)[0].state,'waiting_device');
  result=await f.advance();result=await f.retrieve(result);
  const local=result.proposals[0];result=await f.advance({receipts:[f.ack(local,{reason:'local device disappeared'},'failed')],hostAvailability:{localDevice:false,cloudPersistentHost:true}});
  assert.equal(result.proposals[0].stage,'teacher');assert.equal(result.proposals[0].location,'cloud_persistent');
});
test('pause/cancel and original deadline/revision are enforced; cancelled writes require actual readback',async t=>{
  const f=await fixture(t);let result=await f.advance({events:[f.event('pause')],control:f.control('pause')});assert.equal(result.proposals.length,0);
  result=await f.advance({control:f.control('resume')});assert.equal(result.proposals[0].stage,'retrieve');
  result=await f.advance({control:f.control('cancel')});assert.equal(result.mode,'cancel_requested');assert.equal(result.proposals.length,0);assert.equal(result.cancellationRequirements.length,1);
  await assert.rejects(f.advance({control:f.control('resume','invalid-resume')}),{code:'REVISION_CONFLICT'});
  await assert.rejects(f.advance({taskDeadline:new Date(Date.parse(f.identity.taskDeadline)+1).toISOString()}),{code:'REVISION_CONFLICT'});
  await assert.rejects(f.advance({controlRevision:2}),{code:'REVISION_CONFLICT'});
});
test('forged Evidence, inferred-interest authorization, changed event identity and checkpoint tampering fail closed',async t=>{
  const f=await fixture(t);await assert.rejects(f.advance({events:[{...f.event('bad'),proof:'model says verified'}]}),{code:'UNAUTHORIZED'});
  const responsibility=signed({id:'interest',revision:1,conversationId:'conversation',sourceQuotes:[],goalRefs:[],authority:'inferred_interest',scopeRefs:['write:all']});
  await assert.rejects(f.advance({responsibilities:[responsibility]}),{code:'INVALID_ARGUMENT'});
  const original=f.event('stable');await f.advance({events:[original]});
  await assert.rejects(f.advance({events:[signed({...original,payloadDigest:'b'.repeat(64)})]}),{code:'REVISION_CONFLICT'});
  await assert.rejects(f.advance({checkpoint:f.latest.checkpoint.slice(0,-3)+'bad'}),{code:'INVALID_ARGUMENT'});
  const descriptor=getProactiveWorkflowDescriptor();assert.equal(descriptor.changesOwnedF01ToF28,false);assert.equal(descriptor.entries.length,4);
  assert.ok(getProactiveWorkflowAdapterRequirements().some(r=>r.kind==='schedule_wake'));
});
