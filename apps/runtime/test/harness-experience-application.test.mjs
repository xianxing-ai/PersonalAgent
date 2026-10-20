import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@personal-agent/client';
import {openSqliteLearningHost} from '@personal-agent/learning';
import {harnessCandidateRecipeFingerprint} from '@personal-agent/contracts/harness-candidates';
import {codingRepairPackageGraphDigest} from '@personal-agent/coding-tools';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication,createRuntimeSubagentDispatchTool,SUBAGENT_DISPATCH_TOOL_NAME} from '../dist/application.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(predicate){for(let i=0;i<1000;i++){if(predicate())return;await tick();}assert.fail('Original application did not settle');}

async function fixture(t,{enabled=true,useConfigure=false}={}){
  const folder=await mkdtemp(join(tmpdir(),'harness-experience-app-'));
  const learning=openSqliteLearningHost(join(folder,'learning.sqlite'));
  const recipes=[{recipeId:'unit',packageIds:['pkg'],required:true}],recipeFingerprint=harnessCandidateRecipeFingerprint(recipes);
  const baseline={snapshotId:'baseline',packages:[{id:'pkg',path:'',dependencies:[]}],files:[
    {path:'src.js',sha256:'a'.repeat(64),packageId:'pkg',kind:'source'},
    {path:'test.js',sha256:'b'.repeat(64),packageId:'pkg',kind:'test'}]};
  const patches=[{path:'src.js',expectedSha256:'a'.repeat(64),edits:[{oldText:'old',newText:'new'}]}];
  let app,mode='publish',bindingId='opaque-workspace-grant',developerEnabled=enabled,snapshot=structuredClone(baseline),sessionIndex=0,
    publishes=0,confirmation=false,release,entered;
  const sessions=new Map(),observed=[];
  // Explicit Synthetic host: the real_host wire value exercises the production
  // contract; no real workspace command, publication or account is invoked.
  const host={
    async start({mode},context){const session={version:1,sessionId:'synthetic-'+(++sessionIndex),taskId:context.taskId,
      workspaceId:'actual-workspace-id',mode,baselineSnapshotId:'baseline'};
      sessions.set(session.sessionId,session);return {version:1,session,initialSnapshot:structuredClone(baseline),recipes};},
    async check(sessionId,_patches,_recipeIds,context){const checked=structuredClone(baseline);checked.snapshotId='checked-'+sessionId;checked.files[0].sha256='c'.repeat(64);
      return {version:1,sessionId,snapshot:checked,verification:[{version:1,sessionId,runId:'verify-'+context.runId,
        recipeId:'unit',packageIds:['pkg'],inputSnapshotId:checked.snapshotId,files:checked.files,packageGraphDigest:codingRepairPackageGraphDigest(checked),
        exitCode:0,status:'VALID',evidenceRefs:[],diagnostics:[]}]};},
    async reconcile(){return {state:'clear'};},async publish(){throw Error('Synthetic publication must enter the original Gateway tool');},
  };
  const dispatch=createRuntimeSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const publisher={descriptor:{name:'coding.repair.publish',version:'1.0.0',sideEffect:'local_write',
    requiredScopes:['workspace:read','workspace:write','workspace:apply','workspace:execute'],idempotencySupport:false,recoverySupport:false,
    requiresPresence:false,inputSchema:{type:'object'},outputSchema:{}},execute:async(input,context)=>{
      publishes++;
      const original=app.runtime.readToolExecutions(context.taskId).find(r=>r.toolName==='coding.repair.prepare_adoption');
      const checked=app.runtime.loadCheckpoint(context.taskId,'tool-result-'+original.evidenceId).result;
      assert.deepEqual(app.readHarnessCandidateVerificationEvidence({session:sessions.get(input.sessionId),runId:input.verificationRunIds[0],
        originTaskId:context.taskId,originRunId:original.evidenceId}),[original.evidenceId]);
      snapshot=structuredClone(checked.snapshot);
      return {version:1,sessionId:input.sessionId,state:'published',files:[{path:'src.js',beforeSha256:'a'.repeat(64),afterSha256:'c'.repeat(64)}],
        evidenceRefs:[original.evidenceId]};
    }};
  const port=new FakeCoordinationPort(async request=>{
    const parent=app.runtime.loadCheckpoint(request.taskId,'subtask-parent');
    if(parent?.subtaskId!=='user-work')return {kind:'text',text:'Original interaction summary',verification:'mock'};
    observed.push({taskId:request.taskId,goal:request.goal});
    if(mode==='hold'){entered=request.taskId;await new Promise(resolve=>release=resolve);return {kind:'text',text:'Original held response',verification:'mock'};}
    if(mode==='plain')return {kind:'text',text:'Original next task',verification:'mock'};
    const records=app.runtime.readToolExecutions(request.taskId),trial=records.find(r=>r.toolName==='coding.repair.trial'),
      compare=records.find(r=>r.toolName==='harness.candidates.compare'),adoption=records.find(r=>r.toolName==='coding.repair.prepare_adoption'),
      published=records.find(r=>r.toolName==='coding.repair.publish');
    const proposal=(toolName,args)=>({kind:'tool_proposal',proposalId:'proposal-'+records.length,toolName,toolVersion:'1.0.0',arguments:args,verification:'mock'});
    if(!trial)return proposal('coding.repair.trial',{candidateId:'candidate',patches,recipeIds:['unit']});
    if(!compare)return proposal('harness.candidates.compare',{trialRunIds:[trial.evidenceId]});
    if(!adoption)return proposal('coding.repair.prepare_adoption',{trialRunId:trial.evidenceId});
    if(!published){const checked=app.runtime.loadCheckpoint(request.taskId,'tool-result-'+adoption.evidenceId).result;
      return proposal('coding.repair.publish',{version:1,sessionId:checked.sessionId,baselineSnapshotId:'baseline',snapshotId:checked.snapshot.snapshotId,
        paths:['src.js'],verificationRunIds:checked.verification.map(r=>r.runId)});}
    return {kind:'text',text:'Published original verified artifact',verification:'mock'};
  });
  app=createRuntimeApplication({path:join(folder,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,
    coordination:port,coordinationBinding:'synthetic-original-cloud-config',competitionMaxSteps:8,
    readDeveloperHarnessConfiguration:()=>developerEnabled?{workspaceRef:bindingId,maxExecutorSteps:6}:undefined,
    harnessCandidates:{host,readContext:(_context,scope)=>({binding:{version:1,taskId:scope.ownerTaskId,workspaceId:'actual-workspace-id',
      baselineSnapshotId:'baseline',inputDigest:scope.inputDigest,configurationDigest:scope.configurationRef,workflowVersion:'workflow-v1',runtimeVersion:'runtime-v1',
      recipeFingerprint,executionKind:'real_host'},baseline:structuredClone(baseline),recipes,selectionPolicy:'unique_verified'})},
    tools:[dispatch,publisher],competitionToolExports:[{toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:'1.0.0',exportPolicyVersion:'synthetic-summary',accepts:()=>true,project:({result})=>result},
      {toolName:'coding.repair.publish',toolVersion:'1.0.0',exportPolicyVersion:'synthetic-publish',accepts:()=>true,project:({result})=>result}],
    automaticTools:[SUBAGENT_DISPATCH_TOOL_NAME,'coding.repair.trial','harness.candidates.compare','coding.repair.prepare_adoption','coding.repair.publish']
      .map(toolName=>({toolName,toolVersion:'1.0.0'}))});
  const experienceOptions={namespace:'synthetic-harness',learning,
    readCurrent:()=>({snapshot:structuredClone(snapshot),versions:{workflowVersion:'workflow-v1',runtimeVersion:'runtime-v1',executionKind:'real_host'},
      configuration:{bindingId:'opaque-workspace-grant',workspaceId:'actual-workspace-id',recipeFingerprint}}),
    confirmActivation:async()=>confirmation};
  let experience;
  if(useConfigure){app.configureHarnessExperience(experienceOptions);experience=app.harnessExperience;}
  else experience=app.createHarnessExperienceApplication(experienceOptions);
  const client=new Client(app);await client.connect();
  t.after(async()=>{release?.();await until(()=>app.activeTaskCount===0);app.close();learning.close();await rm(folder,{recursive:true,force:true});});
  let index=0;
  const start=async(next='publish')=>{mode=next;const root=await client.call('task.submit',{goal:'Synthetic original development',conversationId:'synthetic-main'},
    {idempotencyKey:'task-'+(++index),timeoutMs:60000});return root;};
  const owner=root=>app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${root.taskId}-user-work`);
  const settle=async root=>{await until(()=>app.activeTaskCount===0);assert.equal(app.runtime.getTask(root.taskId).state,'succeeded',JSON.stringify({root:app.runtime.getTask(root.taskId),owner:owner(root),records:owner(root)&&app.runtime.readToolExecutions(owner(root).taskId)}));return owner(root);};
  const context=()=>({deadline:new Date(Date.now()+30000).toISOString(),signal:new AbortController().signal});
  return {app,experience,learning,start,settle,owner,observed,context,publishes:()=>publishes,setBinding:value=>bindingId=value,
    confirm:()=>confirmation=true,setEnabled:value=>developerEnabled=value,entered:()=>entered,release:()=>release?.()};
}

test('canonical published user-work automatically proposes once, and unactivated experience is never consumed',async t=>{
  const f=await fixture(t),root=await f.start(),owner=await f.settle(root);
  const candidates=f.experience.listCandidates();assert.equal(candidates.length,1,'actual completion hook proposed canonical origin; '+JSON.stringify({
    error:f.app.runtime.loadCheckpoint(owner.taskId,'harness-experience:proposal-error'),
    proposalKeys:f.app.runtime.listCheckpointKeys(owner.taskId).filter(key=>key.startsWith('harness-experience:proposal:'))}));
  const [candidate]=candidates;assert.equal(candidate.validation,'candidate');assert.equal(f.experience.readActive(candidate.workflowId),null);
  assert.equal(f.publishes(),1);assert.equal(f.app.runtime.listCheckpointKeys(owner.taskId).filter(k=>k.startsWith('harness-experience:proposal:')).length,1);
  const proposalKey=f.app.runtime.listCheckpointKeys(owner.taskId).find(k=>k.startsWith('harness-experience:proposal:'));
  assert.match(f.app.runtime.loadCheckpoint(owner.taskId,proposalKey).operationId,/^[A-Za-z0-9_.-]+$/,'automatic proposals use the original learning operation schema');
  const next=await f.start('plain'),nextOwner=await f.settle(next);
  assert.equal(f.app.runtime.loadCheckpoint(nextOwner.taskId,'harness-experience:lease:v1').lease,null);
  assert.equal(f.observed.filter(x=>x.taskId===nextOwner.taskId).some(x=>x.goal.includes('requiredRecipeIds')),false);
  const records=f.app.runtime.readToolExecutions(owner.taskId),ref=name=>({taskId:owner.taskId,runId:records.find(r=>r.toolName===name).evidenceId});
  const origin={ownerTaskId:owner.taskId,candidateId:'candidate',trial:ref('coding.repair.trial'),comparison:ref('harness.candidates.compare'),
    adoption:ref('coding.repair.prepare_adoption'),publication:ref('coding.repair.publish')};
  const propose=value=>f.experience.proposeFromConfirmed(value,{...f.context(),workflowId:'explicit-negative',expectedRevision:null,
    operationId:'negative',createdAt:new Date().toISOString()});
  assert.throws(()=>propose({...origin,ownerTaskId:nextOwner.taskId}));
  assert.throws(()=>propose({...origin,comparison:origin.trial}),'only the exact canonical adoption comparison is accepted');
  const published=records.find(r=>r.toolName==='coding.repair.publish');f.app.runtime.saveToolExecution({...published,state:'unknown'});
  assert.throws(()=>propose(origin));f.app.runtime.saveToolExecution(published);
  f.setBinding('revoked-grant');assert.throws(()=>propose(origin));f.setBinding('opaque-workspace-grant');
  assert.equal(f.experience.listCandidates().length,1);assert.equal(f.publishes(),1,'negative source validation never executes a tool');
});

test('native confirmation activates a frozen recipe lease; stop during a model wait prevents later consumption',async t=>{
  const f=await fixture(t);await f.settle(await f.start());const [candidate]=f.experience.listCandidates();
  await f.experience.validate(candidate.workflowId,candidate.revision,f.context());
  const activation={...f.context(),workflowId:candidate.workflowId,revision:candidate.revision,expectedActiveRevision:null,
    operationId:'activate',activatedAt:new Date().toISOString()};
  await assert.rejects(f.experience.activate(activation));assert.equal(f.experience.readActive(candidate.workflowId),null);
  f.confirm();await f.experience.activate(activation);
  const root=await f.start('hold');await until(()=>f.entered());const owner=f.owner(root);
  const bound=f.app.runtime.loadCheckpoint(owner.taskId,'harness-experience:lease:v1');assert.equal(bound.lease.revision,candidate.revision);
  assert.match(f.observed.find(x=>x.taskId===owner.taskId).goal,/requiredRecipeIds.*unit/);
  f.experience.stop({...f.context(),workflowId:candidate.workflowId,expectedActiveRevision:candidate.revision,operationId:'stop',stoppedAt:new Date().toISOString()});
  f.release();await until(()=>f.app.activeTaskCount===0);
  assert.equal(f.app.runtime.getTask(owner.taskId).state,'failed','stale activation cannot finish the old model exchange');
  assert.deepEqual(f.app.runtime.loadCheckpoint(owner.taskId,'harness-experience:lease:v1'),bound,'no silent lease replacement');
  assert.equal(f.publishes(),1);assert.equal(f.app.runtime.readToolExecutions(owner.taskId).length,0);
});

test('unconfigured ordinary user-work freezes no experience and enabling mid-flight cannot bind a new lease',async t=>{
  const f=await fixture(t,{enabled:false,useConfigure:true});
  assert.equal(f.app.harnessExperience,f.experience,'Main configure/getter shares the canonical original instance');
  const root=await f.start('hold');await until(()=>f.entered());const owner=f.owner(root);
  const bound=f.app.runtime.loadCheckpoint(owner.taskId,'harness-experience:lease:v1');
  assert.deepEqual(bound,{ownerTaskId:owner.taskId,scope:null,lease:null});
  assert.equal(f.app.runtime.getTask(owner.taskId).state,'running','missing optional harness configuration cannot block ordinary work');
  const sent=f.observed.find(x=>x.taskId===owner.taskId);
  assert.match(sent.goal,/Synthetic original development/,'the original main goal reaches its original worker');
  assert.equal(sent.goal.includes('requiredRecipeIds'),false);
  f.setEnabled(true);f.release();await f.settle(root);
  assert.deepEqual(f.app.runtime.loadCheckpoint(owner.taskId,'harness-experience:lease:v1'),bound,'no activation or configuration is adopted mid-flight');
  assert.equal(f.experience.listCandidates().length,0);assert.equal(f.publishes(),0);
  assert.equal(f.app.runtime.readToolExecutions(owner.taskId).length,0);
  const next=await f.start('plain'),nextOwner=await f.settle(next);
  const nextBinding=f.app.runtime.loadCheckpoint(nextOwner.taskId,'harness-experience:lease:v1');
  assert.equal(nextBinding.scope.workspaceId,'actual-workspace-id','a later task can read the now-configured current source');
  assert.equal(nextBinding.lease,null,'configuration alone never activates experience');
});
