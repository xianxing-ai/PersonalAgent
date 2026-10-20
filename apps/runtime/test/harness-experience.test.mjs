import assert from 'node:assert/strict';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {openSqliteLearningHost} from '@personal-agent/learning';
import {TaskRuntime} from '../dist/index.js';
import {createRuntimeHarnessExperienceApplication,harnessExperienceWorkspaceDigest} from '../dist/application/harness-experience.js';
import {createHarnessExperienceBindings} from '../dist/application/harness-experience-bindings.js';

// Explicit synthetic tools. Real TaskRuntime/Policy/ToolGateway/SQLite records, no account or filesystem publish.
async function fixture(t) {
  const now=Date.now(),deadline=new Date(now+60000).toISOString();let gateway;
  const runtime=new TaskRuntime(':memory:',{now:()=>new Date(now),createToolGateway:policy=>{gateway=new ToolGateway({policy});return gateway;}});
  const learning=openSqliteLearningHost(':memory:');
  t.after(()=>{learning.close();runtime.close();});
  const client=new Client(runtime,()=>now);await client.connect();
  const {taskId}=await client.call('task.submit',{goal:'Synthetic original adoption',conversationId:'synthetic-experience'},{idempotencyKey:'owner'});
  runtime.transitionTask(taskId,'planning');runtime.transitionTask(taskId,'running');
  const context={deadline,signal:new AbortController().signal};
  const packages=[{id:'pkg',path:'pkg',dependencies:[]}];
  const baseline={snapshotId:'baseline',packages,files:[{path:'a.ts',sha256:'a'.repeat(64),packageId:'pkg',kind:'source'}]};
  const snapshot={snapshotId:'checked',packages,files:[{...baseline.files[0],sha256:'b'.repeat(64)}]};
  const scope={workspaceId:'workspace',workspaceDigest:harnessExperienceWorkspaceDigest(snapshot),configurationDigest:'c'.repeat(64),
    workflowVersion:'F15@1',runtimeVersion:'runtime@1',recipeFingerprint:'d'.repeat(64)};
  const session={version:1,sessionId:'main-session',taskId,workspaceId:'workspace',mode:'main',baselineSnapshotId:'baseline'};
  const recipes=[{recipeId:'unit',packageIds:['pkg'],required:true}];
  const mainInput={version:1,session,initialSnapshot:baseline,recipes};
  // Explicit Fake canonical-reader ports; the production producer is owned by MOD31, never this adapter.
  const canonicalSessions=new Map(),canonicalOrigins=new Map();
  const bindings=createHarnessExperienceBindings(runtime,{
    readOriginalSessionForProvenance:({ownerTaskId,actualTaskId,runId})=>ownerTaskId===taskId&&actualTaskId===taskId?structuredClone(canonicalSessions.get(runId)):undefined,
    readAdoptionOrigin:({ownerTaskId,actualTaskId,runId})=>ownerTaskId===taskId&&actualTaskId===taskId?structuredClone(canonicalOrigins.get(runId)):undefined,
  });
  const checked={version:1,sessionId:session.sessionId,snapshot,verification:[{version:1,sessionId:session.sessionId,runId:'verification',
    recipeId:'unit',packageIds:['pkg'],inputSnapshotId:snapshot.snapshotId,files:snapshot.files,exitCode:0,status:'VALID',evidenceRefs:['adopt'],diagnostics:[]}]};
  const trialSession={...session,sessionId:'trial-session',mode:'isolated'};
  const values={
    'coding.repair.trial':{session:trialSession,binding:{version:1,taskId,trialTaskId:taskId,candidateId:'candidate',workspaceId:'workspace',
      ...scope,sessionId:trialSession.sessionId,executionKind:'real_host',artifactId:'artifact',artifactDigest:'e'.repeat(64)},
      checkReadback:{...checked,sessionId:trialSession.sessionId,verification:checked.verification.map(receipt=>
        ({...receipt,sessionId:trialSession.sessionId,evidenceRefs:['trial']}))}},
    'harness.candidates.compare':{version:1,state:'selected',recommendation:{candidateId:'candidate',trialRunId:'trial',artifactId:'artifact',artifactDigest:'e'.repeat(64)}},
    'coding.repair.prepare_adoption':checked,
    'coding.repair.publish':{version:1,sessionId:session.sessionId,state:'published',files:[{path:'a.ts',beforeSha256:'a'.repeat(64),afterSha256:'b'.repeat(64)}],evidenceRefs:['adopt']},
  };
  const invocations=new Map();
  for(const [name,result] of Object.entries(values))gateway.register({descriptor:{name,version:'1.0.0',inputSchema:{type:'object'},outputSchema:{},
    sideEffect:'local_write',requiredScopes:['workspace:write'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},execute:async(_args,context)=>{
      if(name==='coding.repair.trial')canonicalSessions.set(context.runId,{...mainInput,session:trialSession});
      if(name==='coding.repair.prepare_adoption') {
        canonicalOrigins.set(context.runId,{version:1,ownerTaskId:taskId,candidateId:'candidate',adoption:{taskId,runId:context.runId},
          trial:{taskId,runId:'trial'},comparison:{taskId,runId:'compare'}});
        canonicalSessions.set(context.runId,structuredClone(mainInput));
      }
      return structuredClone(result);
    }});
  const invoke=async(name,args,runId)=>{
    runtime.policy.grant({authorizationRef:runId,taskId,toolName:name,scopes:['workspace:write'],expiresAt:deadline,argumentsDigest:toolArgumentsDigest(args)});
    invocations.set(runId,{arguments:args,scopeRef:runId});
    runtime.saveCheckpoint(taskId,'application-tool-invocation:'+runId,{toolName:name,toolVersion:'1.0.0',arguments:args,deadline});
    const result=await client.call('tool.invoke',{toolName:name,toolVersion:'1.0.0',arguments:args,scopeRef:runId},{taskId,idempotencyKey:runId,timeoutMs:60000});
    assert.equal(result.state,'confirmed');
  };
  await invoke('coding.repair.trial',{candidateId:'candidate',patches:[],recipeIds:['unit']},'trial');
  await invoke('harness.candidates.compare',{trialRunIds:['trial']},'compare');
  await invoke('coding.repair.prepare_adoption',{trialRunId:'trial'},'adopt');
  await invoke('coding.repair.publish',{version:1,sessionId:session.sessionId,baselineSnapshotId:'baseline',snapshotId:'checked',paths:['a.ts'],verificationRunIds:['verification']},'publish');
  runtime.transitionTask(taskId,'verifying');
  runtime.transitionTask(taskId,'succeeded');
  const ref=runId=>({taskId,runId});
  const origin={ownerTaskId:taskId,candidateId:'candidate',trial:ref('trial'),comparison:ref('compare'),adoption:ref('adopt'),publication:ref('publish')};
  let current={scope,snapshot};
  const app=createRuntimeHarnessExperienceApplication({namespace:'developer',runtime,learning,
    assertOrigin:value=>{assert.deepEqual(value,origin);},readInvocation:bindings.readInvocation,
    readMainInput:run=>{assert.deepEqual(run,{taskId,runId:'adopt'});return bindings.readMainInput(run);},
    readCurrent:()=>current,confirmActivation:async()=>true});
  const propose=()=>app.proposeFromConfirmed(origin,{...context,workflowId:'experience',expectedRevision:null,operationId:'propose',createdAt:new Date(now).toISOString()});
  return {app,runtime,learning,context,scope,taskId,origin,invocations,propose,setCurrent:value=>{current=value;},snapshot,bindings};
}
test('actual Runtime confirmed adoption/publication feeds existing learning and a read-only policy lease',async t=>{
  const f=await fixture(t);
  const candidate=f.propose();assert.equal(candidate.validation,'candidate');
  assert.deepEqual(f.bindings.publishedOrigins(f.taskId),[f.origin]);
  assert.deepEqual(Object.keys(f.bindings).sort(),['publishedOrigins','readInvocation','readMainInput','readOrigin']);
  assert.equal(f.bindings.readMainInput({taskId:f.taskId,runId:'compare'}),undefined,'never guesses the latest main session');
  assert.equal(f.app.readApplicable('experience',f.scope,f.context),null);
  await f.app.validate('experience',1,f.context);
  await f.app.activate({...f.context,workflowId:'experience',revision:1,expectedActiveRevision:null,operationId:'activate',activatedAt:new Date().toISOString()});
  const lease=f.app.readApplicable('experience',f.scope,f.context);
  assert.deepEqual(f.app.assertApplicable(lease,f.scope,f.context),{version:1,requiredRecipeIds:['unit']});
  assert.equal(f.runtime.readToolExecutions(f.taskId).length,4,'experience never executes another tool');
});
test('altered original invocation, unknown publish and changed current workspace are refused',async t=>{
  const f=await fixture(t);
  const saved=f.runtime.loadCheckpoint(f.taskId,'application-tool-invocation:adopt');
  f.runtime.saveCheckpoint(f.taskId,'application-tool-invocation:adopt',{...saved,arguments:{trialRunId:'another'}});
  assert.throws(f.propose,{code:'NOT_VALIDATED'});f.runtime.saveCheckpoint(f.taskId,'application-tool-invocation:adopt',saved);
  const published=f.runtime.loadCheckpoint(f.taskId,'tool-result-publish');
  f.runtime.saveCheckpoint(f.taskId,'tool-result-publish',{...published,result:{...published.result,state:'unknown'}});
  assert.throws(f.propose,{code:'NOT_VALIDATED'});f.runtime.saveCheckpoint(f.taskId,'tool-result-publish',published);
  f.setCurrent({scope:f.scope,snapshot:{...f.snapshot,files:[{...f.snapshot.files[0],sha256:'f'.repeat(64)}]}});
  assert.throws(f.propose,{code:'REVISION_CONFLICT'});
});

async function activeGuidance(t) {
  const f=await fixture(t);f.propose();await f.app.validate('experience',1,f.context);
  await f.app.activate({...f.context,workflowId:'experience',revision:1,expectedActiveRevision:null,
    operationId:'activate',activatedAt:new Date().toISOString()});
  const lease=f.app.readApplicable('experience',f.scope,f.context);
  const nextSnapshot={...f.snapshot,files:[{...f.snapshot.files[0],sha256:'f'.repeat(64)}]};
  const nextScope={...f.scope,workspaceDigest:harnessExperienceWorkspaceDigest(nextSnapshot)};
  // Explicit after-publication snapshot fixture. H1 separately proves this task's actual CAS/readback gate.
  f.setCurrent({scope:nextScope,snapshot:nextSnapshot});
  return {...f,lease,nextScope,nextSnapshot};
}
test('published guidance source assertion is void and never reissues an executable lease after workspace change',async t=>{
  const f=await activeGuidance(t);
  assert.equal(f.app.assertPublishedGuidanceSource(f.lease,f.nextScope,f.context),undefined);
  assert.throws(()=>f.app.assertApplicable(f.lease,f.nextScope,f.context),{code:'REVISION_CONFLICT'});
  assert.throws(()=>f.app.readApplicable('experience',f.nextScope,f.context),{code:'REVISION_CONFLICT'});
  assert.equal(f.runtime.readToolExecutions(f.taskId).length,4,'source assertion does not execute or publish anything');
});
test('published guidance source still rejects config/version/selection drift, unknown or withdrawn sources',async t=>{
  const f=await activeGuidance(t);
  for(const field of ['workspaceId','configurationDigest','workflowVersion','runtimeVersion','recipeFingerprint']) {
    const bad={...f.nextScope,[field]:field==='configurationDigest'||field==='recipeFingerprint'?'e'.repeat(64):'changed'};
    f.setCurrent({scope:bad,snapshot:f.nextSnapshot});
    assert.throws(()=>f.app.assertPublishedGuidanceSource(f.lease,bad,f.context),{code:'REVISION_CONFLICT'});
  }
  f.setCurrent({scope:f.nextScope,snapshot:f.nextSnapshot});
  assert.throws(()=>f.app.assertPublishedGuidanceSource({...f.lease,activationSequence:f.lease.activationSequence+1},f.nextScope,f.context),{code:'REVISION_CONFLICT'});
  assert.throws(()=>f.app.assertPublishedGuidanceSource({...f.lease,source:{...f.lease.source,requiredRecipeIds:['invented']}},f.nextScope,f.context),{code:'REVISION_CONFLICT'});
  assert.throws(()=>f.app.assertPublishedGuidanceSource(f.lease,{...f.nextScope,workspaceDigest:'e'.repeat(64)},f.context),{code:'REVISION_CONFLICT'});
  const cached=f.runtime.loadCheckpoint(f.taskId,'tool-result-publish');
  f.runtime.saveCheckpoint(f.taskId,'tool-result-publish',{...cached,result:{...cached.result,state:'unknown'}});
  assert.throws(()=>f.app.assertPublishedGuidanceSource(f.lease,f.nextScope,f.context),{code:'NOT_VALIDATED'});
  f.runtime.saveCheckpoint(f.taskId,'tool-result-publish',cached);
  f.runtime.saveCheckpoint(f.taskId,'private-copy-erasure',{state:'pending'});
  assert.throws(()=>f.app.assertPublishedGuidanceSource(f.lease,f.nextScope,f.context),{code:'NOT_VALIDATED'});
  f.app.stop({...f.context,workflowId:'experience',expectedActiveRevision:1,operationId:'stop',stoppedAt:new Date().toISOString()});
  assert.throws(()=>f.app.assertPublishedGuidanceSource(f.lease,f.nextScope,f.context),{code:'REVISION_CONFLICT'});
});
