import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {buildMinimalRepairCandidate} from '@personal-agent/cognition';
import {createRuntimeApplication,readF03CompetitionReview,readCompetitionWorkflowRepairReceipt} from '../dist/application.js';

const ref=(id,revision=1)=>({id,revision});
const node=(id,kind,dependencies,summary=id)=>({id,kind,dependencies,summary,sourceRef:'synthetic/f03',sensitivity:'private',
  state:'active',reason:'explicit synthetic Plan',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z'});
async function settle(app,id,states){for(let n=0;n<200;n++){const task=app.runtime.getTask(id);if(states.includes(task.state))return task;
  await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Original Runtime task did not settle');}
async function approve(client,taskId){const {items}=await client.call('approval.list',{taskId});assert.equal(items.length,1);
  await client.call('authorization.respond',{approvalId:items[0].approvalId,expectedRevision:items[0].revision,decision:'allow_once'});}

test('Competition F03 original selection uses a separate Policy CAS and restart only reads that original effect',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'f03-competition-')),namespace='synthetic-f03';
  let app,source,scope,binding,revoked=false;
  const decision={descriptor:{name:'decision.choose_candidate',version:'1.0.0',sideEffect:'read',requiredScopes:['decision:choose'],
    idempotencySupport:true,recoverySupport:true,requiresPresence:false,inputSchema:{type:'object',additionalProperties:false,required:['context'],properties:{context:{type:'string'}}},
    outputSchema:{type:'object',additionalProperties:false,required:['selectedId'],properties:{selectedId:{type:'string'}}}},
    execute:async()=>({selectedId:'repair'})};
  const options={path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',repairCandidateVersion:'1.0',hostUserNamespace:'f03-fixture',
    coordination:new FakeCoordinationPort(()=>({kind:'text',text:'synthetic',verification:'unverified'})),tools:[decision],
    localRepair:{graphNamespace:namespace,bindingVersion:'competition-v1',withSourceLock:work=>work(),
      competitionSource:{resolve:()=>revoked?undefined:readF03CompetitionReview(app,scope,source)}}};
  const create=()=>{app=createRuntimeApplication(options);app.readConfiguredWorkflowBinding=()=>structuredClone(binding);return app;};
  create();t.after(async()=>{app.close();await rm(directory,{recursive:true,force:true});});
  const client=new Client(app);await client.connect();
  const store=app.runtime.provisionCoordinationStore(namespace);
  store.append(0,node('goal','goal',[]));store.append(1,node('plan','plan',[ref('goal')]));store.append(2,node('goal','goal',[],'updated goal'));
  const at=new Date().toISOString(),deadline=new Date(Date.now()+30_000).toISOString();
  const candidate=buildMinimalRepairCandidate(store.read(),at,{expectedGraphRevision:3,targets:[ref('plan')]});assert.equal(candidate.kind,'candidate');
  const parent=app.runtime.submitTask({goal:'Synthetic configured F03 graph source',conversationId:'f03-fixture',idempotencyKey:'f03-original-graph'});
  app.runtime.transitionTask(parent.taskId,'planning');app.runtime.transitionTask(parent.taskId,'running');
  scope={taskId:parent.taskId,sessionId:'original-f03',operationId:'n02-choice',deadline,signal:new AbortController().signal};
  source={sourceDigest:'a'.repeat(64),graphNamespace:namespace,graphRevision:3,evaluatedAt:at,affected:[ref('plan')],
    allowedDependencies:[ref('goal',2)],candidate:candidate.request};
  const args={context:JSON.stringify({workflowId:'F03',nodeId:'F03_N02',candidateValues:[{id:'repair',value:{action:'revise',repair:candidate.request}}]})};
  const request={commandId:scope.operationId,toolName:decision.descriptor.name,toolVersion:'1.0.0',arguments:args,deadline};
  const child=app.prepareHostToolTask(request);
  app.runtime.saveCheckpoint(child.taskId,'coding-repair:parent',{taskId:parent.taskId,operationId:scope.operationId});
  app.runtime.saveCheckpoint(parent.taskId,'coding-repair:host:'+scope.operationId,{localTaskId:child.taskId,request});
  app.finalizeHostToolTask({taskId:child.taskId,commandId:request.commandId,arguments:args,expectedTaskRevision:child.revision});
  await settle(app,child.taskId,['waiting_approval']);await approve(client,child.taskId);
  assert.equal((await settle(app,child.taskId,['succeeded','failed'])).state,'succeeded');
  binding={input:{review:source},sessionId:scope.sessionId,deadline,configurationVersion:'competition-mail-review-v1',configurationDigest:'b'.repeat(64),
    confirmedOperations:[{nodeId:'F03_N02',operationId:scope.operationId,localTaskId:child.taskId,toolName:decision.descriptor.name,
      toolVersion:'1.0.0',result:{selectedId:'repair'}}]};
  assert.ok(readF03CompetitionReview(app,scope,source));
  assert.equal(app.runtime.loadCheckpoint(child.taskId,'proactive-cognition-review-v1'),undefined,'does not fabricate Laya review');
  const submission={sourceTaskId:parent.taskId,sourceOperationId:scope.operationId,idempotencyKey:'original-competition-cas',deadline};
  const repair=app.submitLocalRepair(submission);
  await settle(app,repair.taskId,['waiting_approval']);assert.equal(store.read().revision,3,'selection never authorizes CAS');
  const original=binding;binding={...binding,input:{review:{...source,sourceDigest:'c'.repeat(64)}}};
  assert.throws(()=>readF03CompetitionReview(app,scope,source),{code:'UNAUTHORIZED'});binding=original;
  await approve(client,repair.taskId);assert.equal((await settle(app,repair.taskId,['succeeded','failed'])).state,'succeeded');
  const proofInput={taskId:repair.taskId,sourceTaskId:parent.taskId,sourceOperationId:scope.operationId};
  const receipt=readCompetitionWorkflowRepairReceipt(app.runtime,proofInput);
  assert.equal(receipt?.graphRevision,4);assert.equal(receipt.graphUpdateVerified,true);
  assert.deepEqual(store.read().history.at(-1).dependencies,[ref('goal',2)]);
  app.close();create();revoked=true;
  assert.equal(app.submitLocalRepair(submission).taskId,repair.taskId,'existing identity is read, never dispatched again');
  assert.deepEqual(readCompetitionWorkflowRepairReceipt(app.runtime,proofInput),receipt);
  assert.equal(app.runtime.readToolExecutions(repair.taskId).length,1);
  assert.equal(app.runtime.bindCoordinationStore(namespace).read().revision,4);
});
