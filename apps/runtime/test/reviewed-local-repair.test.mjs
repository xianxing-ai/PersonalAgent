import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Client} from '@personal-agent/client';
import {LayaActionChoiceService,prepareReviewedRepair} from '@personal-agent/cognition';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication,createProactiveCognitionHost} from '../dist/application.js';
const namespace='reviewed-goal-source';
const ref=(id,revision=1)=>({id,revision});
const alias=ref=>({...ref,id:createHash('sha256').update(ref.id).digest('hex')});
const node=(id,kind,dependencies,summary=id)=>({id,kind,dependencies,summary,sourceRef:'synthetic/goal',
  sensitivity:'private',state:'active',reason:'explicit goal intent',
  validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z'});
async function settle(app,id,states) {
  for(let n=0;n<200;n++){const task=app.runtime.getTask(id);if(states.includes(task.state))return task;await new Promise(resolve=>setTimeout(resolve,5));}
  throw Error('Reviewed task did not settle');
}
async function approve(client,id) {
  const {items}=await client.call('approval.list',{taskId:id});assert.equal(items.length,1);
  await client.call('authorization.respond',{approvalId:items[0].approvalId,expectedRevision:items[0].revision,decision:'allow_once'});
}
async function fixture(t) {
  const root=fileURLToPath(new URL('../../../.cache/reviewed-local-repair/',import.meta.url));
  await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'case-'));
  let app,review,candidate,sourceId,allowed=true,lock=Promise.resolve();
  const options={graphNamespace:namespace,bindingVersion:'reviewed-runtime-v1',
    withSourceLock:async work=>{await lock;return work();},
    reviewedSource:{resolve(input){
      if(!allowed || input.sourceTaskId!==sourceId || input.reviewTaskId!==review?.taskId)return;
      return prepareReviewedRepair(app.runtime.bindCoordinationStore(namespace).read(),new Date().toISOString(),review);
    }}};
  const port=new FakeCoordinationPort(()=>candidate);
  const create=()=>createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    coordination:port,repairCandidateVersion:'1.0',localRepair:options});
  app=create();const store=app.runtime.provisionCoordinationStore(namespace);
  store.append(0,node('goal','goal',[],'Original Goal'));
  store.append(1,node('plan','plan',[ref('goal')],'Original Plan'));
  store.append(2,node('goal','goal',[],'Revised Goal'));
  const facts=app.createCompetitionFactHost({memoryPath:path.join(directory,'memory.sqlite'),memoryNamespace:'public-fixture',graphNamespace:namespace,consumerKey:'fixture'});
  const chooser=new LayaActionChoiceService({infer:async request=>{
    const keys=Object.keys(request.questions.action.criteria),selected=keys.at(-1);
    return {answers:{action:{choice:selected,probabilities:Object.fromEntries(keys.map(key=>[key,key===selected?.98:.01])),answer_confidence:.98,confidence:.5}}};
  }});
  const cognition=createProactiveCognitionHost({application:app,facts,graphNamespace:namespace,bindingVersion:'review-host-v1',chooser});
  review=(await cognition.reviewGoalRevision({expectedGraphRevision:3,previousGoal:ref('goal'),currentGoal:ref('goal',2)},
    {at:new Date().toISOString(),deadline:new Date(Date.now()+30_000).toISOString(),signal:new AbortController().signal})).review;
  assert.equal(review.selectedOption.action,'REVISE');
  const request=review.selectedOption.repair;
  candidate={kind:'repair_candidate',candidateVersion:'1.0',verification:'unverified',candidate:{expectedGraphRevision:3,
    changes:request.changes.map(change=>({...change,node:alias(change.node),dependencies:change.dependencies.map(alias)}))}};
  const client=new Client(app);await client.connect();
  sourceId=(await client.call('task.submit',{goal:'Semantic repair fixture',conversationId:`desktop-proactive-goals:${namespace}`},
    {idempotencyKey:'reviewed-cloud-source',timeoutMs:30_000})).taskId;
  assert.equal((await settle(app,sourceId,['succeeded','failed'])).state,'succeeded');
  assert.deepEqual(app.runtime.getTask(sourceId).evidenceRefs,[],'Goal review does not fabricate Fact execution Evidence');
  const submission={sourceTaskId:sourceId,reviewTaskId:review.taskId,idempotencyKey:'reviewed-repair-once',deadline:new Date(Date.now()+30_000).toISOString()};
  t.after(async()=>{cognition.close();facts.close();app.close();await rm(directory,{recursive:true,force:true});});
  return {get app(){return app;},client,review,sourceId,submission,options,
    revoke:()=>{allowed=false;},block:()=>{let release;lock=new Promise(resolve=>{release=resolve;});return ()=>release();},
    reopen:()=>{app.close();app=create();return app;}};
}
test('pure Goal review reuses Policy/ToolGateway and durable CAS without synthetic Fact evidence',async t=>{
  const f=await fixture(t),repair=f.app.submitLocalRepair(f.submission);
  const proofInput={taskId:repair.taskId,sourceTaskId:f.sourceId,reviewTaskId:f.review.taskId,graphNamespace:namespace};
  assert.equal((await settle(f.app,repair.taskId,['waiting_approval','failed'])).state,'waiting_approval');
  assert.equal(f.app.readF03PlanRepairReceipt(proofInput),undefined,'approval is not a repair receipt');
  assert.equal(f.app.runtime.bindCoordinationStore(namespace).read().revision,3);
  await approve(f.client,repair.taskId);
  const done=await settle(f.app,repair.taskId,['succeeded','failed']);assert.equal(done.state,'succeeded',JSON.stringify(done.error));
  const graph=f.app.runtime.bindCoordinationStore(namespace).read();assert.equal(graph.revision,4);
  assert.deepEqual(graph.history.at(-1).dependencies,[ref('goal',2)]);assert.equal(graph.history.at(-1).revision,2);
  const records=f.app.runtime.readToolExecutions(repair.taskId);
  assert.equal(records.length,1);assert.equal(records[0].toolName,'cognition.commit_repair');
  assert.equal(records[0].policyDecision,'allow');assert.equal(records[0].executionStarted,true);assert.equal(records[0].state,'confirmed');
  assert.ok(done.evidenceRefs.includes(records[0].evidenceId));
  const proof=f.app.readF03PlanRepairReceipt(proofInput);
  assert.equal(proof?.graphRevision,4);assert.equal(proof.graphUpdateVerified,true);
  assert.deepEqual(proof.updatedNodes,[{id:'plan',revision:2,kind:'plan'}]);
  assert.ok(Object.isFrozen(proof) && Object.isFrozen(proof.updatedNodes) && Object.isFrozen(proof.updatedNodes[0]) && Object.isFrozen(proof.evidenceRefs));
  assert.equal(f.app.submitLocalRepair(f.submission).taskId,repair.taskId);
  const reopened=f.reopen();assert.equal(reopened.runtime.bindCoordinationStore(namespace).read().revision,4);
  assert.equal(reopened.submitLocalRepair(f.submission).state,'succeeded');
  assert.equal(reopened.runtime.readToolExecutions(repair.taskId).length,1);
  assert.deepEqual(reopened.readF03PlanRepairReceipt(proofInput),proof,'original proof survives SQLite reopen without dispatch');
});

test('F03 plan receipt rejects substituted original sources and preserves known historical effects after later revisions',async t=>{
  const f=await fixture(t),repair=f.app.submitLocalRepair(f.submission);
  await settle(f.app,repair.taskId,['waiting_approval']);await approve(f.client,repair.taskId);
  assert.equal((await settle(f.app,repair.taskId,['succeeded','failed'])).state,'succeeded');
  const input={taskId:repair.taskId,sourceTaskId:f.sourceId,reviewTaskId:f.review.taskId,graphNamespace:namespace};
  const original=f.app.readF03PlanRepairReceipt(input);assert.ok(original);
  for(const field of ['taskId','sourceTaskId','reviewTaskId','graphNamespace']) {
    assert.equal(f.app.readF03PlanRepairReceipt({...input,[field]:'foreign-'+input[field]}),undefined,field);
  }
  for(const [taskId,key,replace] of [
    [f.review.taskId,'proactive-cognition-review-v1',value=>({...value,bindingVersion:'substituted'})],
    [f.sourceId,'competition-repair-candidate',value=>({...value,candidate:{...value.candidate,expectedGraphRevision:999}})],
    [repair.taskId,'local-repair-intent',value=>({...value,sourceTaskId:'foreign-source'})],
    [repair.taskId,'tool-result-'+original.runId,()=>({result:{kind:'applied',graphRevision:3}})],
  ]) {
    const saved=f.app.runtime.loadCheckpoint(taskId,key);f.app.runtime.saveCheckpoint(taskId,key,replace(saved));
    assert.equal(f.app.readF03PlanRepairReceipt(input),undefined,key);
    f.app.runtime.saveCheckpoint(taskId,key,saved);assert.deepEqual(f.app.readF03PlanRepairReceipt(input),original);
  }
  const store=f.app.runtime.bindCoordinationStore(namespace);
  store.append(4,node('unrelated','goal',[]));
  assert.equal(f.app.readF03PlanRepairReceipt(input).graphUpdateVerified,true,'unrelated later revisions preserve verified target heads');
  store.append(5,node('plan','plan',[ref('goal',2)],'Later independent plan'));
  const historical=f.app.readF03PlanRepairReceipt(input);
  assert.equal(historical.graphRevision,4);assert.equal(historical.currentGraphRevision,6);
  assert.equal(historical.graphUpdateVerified,false);assert.deepEqual(historical.updatedNodes,original.updatedNodes);
  assert.equal(f.app.runtime.readToolExecutions(repair.taskId).length,1,'reads never replay the original CAS');
});
test('changed review, cloud candidate, current graph or revoked resolver rejects before any CAS',async t=>{
  for(const changed of ['review','candidate','graph','revoked']) {
    const f=await fixture(t),repair=f.app.submitLocalRepair(f.submission);
    await settle(f.app,repair.taskId,['waiting_approval']);
    if(changed==='review') f.app.runtime.saveCheckpoint(f.review.taskId,'proactive-cognition-review-v1',
      {...f.review,selection:{...f.review.selection,state:'review',eligibleForRuntime:false}});
    if(changed==='candidate') {
      const candidate=f.app.runtime.loadCheckpoint(f.sourceId,'competition-repair-candidate');
      candidate.candidate.changes[0].summary='Substituted cloud content';f.app.runtime.saveCheckpoint(f.sourceId,'competition-repair-candidate',candidate);
    }
    if(changed==='graph') f.app.runtime.bindCoordinationStore(namespace).append(3,node('other','goal',[]));
    if(changed==='revoked') f.revoke();
    await approve(f.client,repair.taskId);
    const done=await settle(f.app,repair.taskId,['failed','succeeded']);assert.equal(done.state,'failed');
    assert.equal(f.app.runtime.bindCoordinationStore(namespace).read().revision,changed==='graph'?4:3);
    assert.equal(f.app.runtime.bindCoordinationStore(namespace).read().history.filter(node=>node.id==='plan').length,1);
  }
});
test('cancelled source-lock wait cannot commit and substituted idempotency intent is rejected',async t=>{
  const f=await fixture(t);const release=f.block();const repair=f.app.submitLocalRepair(f.submission);
  await settle(f.app,repair.taskId,['waiting_approval']);
  assert.throws(()=>f.app.submitLocalRepair({...f.submission,reviewTaskId:'other-review'}),{code:'REVISION_CONFLICT'});
  await approve(f.client,repair.taskId);
  await f.client.call('task.cancel',{taskId:repair.taskId});release();
  const stopped=await settle(f.app,repair.taskId,['cancelled','failed','waiting_reconciliation']);
  assert.equal(f.app.runtime.bindCoordinationStore(namespace).read().revision,3);
  if(stopped.state==='waiting_reconciliation') {
    for(let n=0;n<100 && f.app.activeTaskCount;n++) await new Promise(resolve=>setTimeout(resolve,5));
    const reopened=f.reopen();
    assert.equal(reopened.submitLocalRepair(f.submission).state,'waiting_reconciliation');
    assert.equal(reopened.runtime.bindCoordinationStore(namespace).read().revision,3);
    assert.equal(reopened.runtime.readToolExecutions(repair.taskId).length,1);
  }
});
