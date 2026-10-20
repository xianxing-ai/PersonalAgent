import assert from 'node:assert/strict';
import test from 'node:test';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {compareHarnessCandidates} from '@personal-agent/agentarts';
import {createRuntimeHarnessCandidateBindings} from '../dist/application/harness-candidate-bindings.js';
import {createRuntimeHarnessCandidateTools} from '../dist/application/harness-candidates.js';
import {context as configuration,trial} from '../../../packages/agentarts/test/harness-candidate-fixtures.mjs';

function fixture() {
  const c=configuration(),checkpoints=new Map(),records=[],contexts=new Map(),tasks=new Map();
  const deadline=new Date(Date.now()+60000).toISOString();let sourcesAllowed=true;
  const key=(taskId,name)=>JSON.stringify([taskId,name]);
  const runtime={getTask:taskId=>tasks.get(taskId)??({taskId,state:'running',cancelRequested:false,revision:1}),
    loadCheckpoint:(taskId,name)=>structuredClone(checkpoints.get(key(taskId,name))),
    saveCheckpointOnce:(taskId,name,value)=>{const k=key(taskId,name);if(checkpoints.has(k))return false;checkpoints.set(k,structuredClone(value));return true;},
    readToolExecutions:taskId=>records.filter(r=>r.taskId===taskId),
    matchesToolExecutionInput:(record,input)=>record.argumentsDigest===toolArgumentsDigest(input.arguments)&&record.scopeRef===input.scopeRef,
    readEvidence:taskId=>records.filter(r=>r.taskId===taskId&&r.executionStarted).map(r=>({evidenceId:r.evidenceId,kind:'execution',sourceRef:r.toolName}))};
  const scope=ctx=>({ownerTaskId:c.binding.taskId,actualTaskId:ctx.taskId,parentTaskId:'synthetic-parent',scopeRef:ctx.authorizationRef,
    configurationRef:c.binding.configurationDigest,inputDigest:c.binding.inputDigest,deadline,workspaceRef:'synthetic-opaque-workspace-binding'});
  const options={resolveHarnessScope:(ctx,source)=>source?(sourcesAllowed?scope(contexts.get(source.runId)):undefined):scope(ctx),readConfiguration:()=>structuredClone(c)};
  const bindings=createRuntimeHarnessCandidateBindings({runtime},options);
  function begin(toolName,args,runId,taskId=c.binding.taskId) {
    const ctx={taskId,runId,authorizationRef:runId,deadline,scopes:['workspace:read','workspace:write','workspace:apply','workspace:execute'],signal:new AbortController().signal};
    contexts.set(runId,ctx);runtime.saveCheckpointOnce(taskId,'application-deadline',deadline);
    const argumentsDigest=toolArgumentsDigest(args);
    runtime.saveCheckpointOnce(taskId,'application-tool-invocation:'+runId,{toolName,toolVersion:'1.0.0',arguments:args,argumentsDigest,deadline});
    records.push({taskId,evidenceId:runId,toolName,toolVersion:'1.0.0',argumentsDigest,inputDigest:toolArgumentsDigest({taskId,toolName,arguments:args,scopeRef:runId}),
      scopeRef:runId,policyDecision:'allow',executionStarted:true,state:'started'});
    return ctx;
  }
  function confirm(ctx,result) {records.find(r=>r.evidenceId===ctx.runId).state='confirmed';runtime.saveCheckpointOnce(ctx.taskId,'tool-result-'+ctx.runId,{result});}
  const input=(ctx,sessionId)=>({version:1,session:{version:1,sessionId,taskId:ctx.taskId,workspaceId:c.binding.workspaceId,mode:'isolated',baselineSnapshotId:c.baseline.snapshotId},
    initialSnapshot:structuredClone(c.baseline),recipes:structuredClone(c.recipes)});
  async function observed(candidateId,status='VALID',patches=[],changeResult) {
    const ctx=begin('coding.repair.trial',{candidateId,patches,recipeIds:['unit']},'run-'+candidateId);
    await bindings.trial.readBinding(ctx,candidateId);await bindings.trial.saveSession(ctx,input(ctx,'session-'+candidateId));
    const result=trial(candidateId,c,status,ctx.runId);changeResult?.(result);confirm(ctx,result);return {ctx,result};
  }
  return {c,runtime,bindings,begin,confirm,input,observed,records,disableSources:()=>{sourcesAllowed=false;},
    setTask:(taskId,state,revision)=>tasks.set(taskId,{taskId,state,revision,cancelRequested:false})};
}
test('factories are lazy; distinct workspace IDs and authorization refs retain immutable session identity',async()=>{
  let reads=0;const lazy={get runtime(){reads++;throw Error('Runtime not constructed');}};
  createRuntimeHarnessCandidateBindings(lazy,{});createRuntimeHarnessCandidateTools(lazy,{getBinding(){},resolveTrialOrigin(){}});
  assert.equal(reads,0);
  const f=fixture(),ctx=f.begin('coding.repair.trial',{candidateId:'one',patches:[],recipeIds:['unit']},'run-one');
  assert.equal(await f.bindings.trial.readSession(ctx),undefined);
  await f.bindings.trial.readBinding(ctx,'one');const input=f.input(ctx,'session-one');
  await f.bindings.trial.saveSession(ctx,input);assert.deepEqual(await f.bindings.trial.readSession(ctx),input);
  await assert.rejects(f.bindings.trial.saveSession(ctx,f.input(ctx,'different-session')),{code:'REVISION_CONFLICT'});
  f.records.find(r=>r.evidenceId==='run-one').state='unknown';
  const recovery=f.begin('coding.repair.reconcile_trial',{trialRunId:'run-one'},'recover');
  assert.deepEqual(await f.bindings.recovery.readOriginalSession(recovery,'run-one'),input);
});
test('source scope and exact original input are required for peer origin resolution',async()=>{
  const f=fixture();await f.observed('one');const compare=f.begin('harness.candidates.compare',{trialRunIds:['run-one']},'compare');
  assert.equal(f.bindings.compare.getBinding(compare).binding.taskId,f.c.binding.taskId);
  assert.equal(f.bindings.compare.resolveTrialOrigin(f.c.binding.taskId,'run-one',compare).actualTaskId,f.c.binding.taskId);
  f.disableSources();assert.throws(()=>f.bindings.compare.resolveTrialOrigin(f.c.binding.taskId,'run-one',compare),{code:'UNAUTHORIZED'});
});
test('native recovery reads only original waiting-task metadata and preserves unknown without a running context',async()=>{
  const f=fixture();await f.observed('one');f.records.find(r=>r.evidenceId==='run-one').state='unknown';
  f.setTask(f.c.binding.taskId,'waiting_reconciliation',7);f.disableSources();
  const input={ownerTaskId:f.c.binding.taskId,actualTaskId:f.c.binding.taskId,trialRunId:'run-one',expectedRevision:7,configurationRef:f.c.binding.configurationDigest};
  const saved=f.bindings.readOriginalSessionForRecovery(input);
  assert.equal(saved.session.sessionId,'session-one');
  assert.equal(f.runtime.getTask(input.actualTaskId).state,'waiting_reconciliation');assert.equal(f.records[0].state,'unknown');
  assert.throws(()=>f.bindings.readOriginalSessionForRecovery({...input,expectedRevision:6}),{code:'REVISION_CONFLICT'});
  assert.throws(()=>f.bindings.readOriginalSessionForRecovery({...input,configurationRef:'another-config'}),{code:'UNAUTHORIZED'});
});
test('an internally consistent replacement session cannot replace the original saveOnce trial session',async()=>{
  const f=fixture();await f.observed('one','VALID',[],result=>{
    result.binding.sessionId='replacement';result.session.sessionId='replacement';result.checkReadback.sessionId='replacement';
    result.checkReadback.verification.forEach(receipt=>{receipt.sessionId='replacement';});
  });
  const compare=f.begin('harness.candidates.compare',{trialRunIds:['run-one']},'compare');f.bindings.compare.getBinding(compare);
  assert.throws(()=>f.bindings.compare.resolveTrialOrigin(f.c.binding.taskId,'run-one',compare),{code:'UNAUTHORIZED'});
});
test('adoption reads the latest confirmed comparison and exact original trial patches, never replacement model input',async()=>{
  const f=fixture(),patches=[{path:'src.js',expectedSha256:f.c.baseline.files[0].sha256,edits:[{oldText:'broken',newText:'fixed'}]}];
  const a=await f.observed('one','VALID',patches),b=await f.observed('two','FAILED');
  const ids=['run-one','run-two'],compare=f.begin('harness.candidates.compare',{trialRunIds:ids},'compare');
  f.bindings.compare.getBinding(compare);
  const result=compareHarnessCandidates(f.c,[a.result,b.result]);result.recommendation.trialRunId='run-one';
  f.confirm(compare,{...result,evidenceRefs:ids});
  const adopt=f.begin('coding.repair.prepare_adoption',{trialRunId:'run-one'},'adopt');
  const selected=await f.bindings.adoption.readSelection(adopt,'run-one');
  assert.deepEqual(selected.patches,patches);assert.equal(selected.trial.binding.artifactId,a.result.binding.artifactId);
  await assert.rejects(f.bindings.adoption.readSelection(adopt,'run-two'),{code:'UNAUTHORIZED'});
  const pending=f.begin('harness.candidates.compare',{trialRunIds:ids},'later-unknown');
  f.bindings.compare.getBinding(pending);f.records.find(r=>r.evidenceId===pending.runId).state='unknown';
  await assert.rejects(f.bindings.adoption.readSelection(adopt,'run-one'),{code:'UNAUTHORIZED'});
});
test('composition consumes the exact original disjoint patch union and refuses additions or conflicting overlap',async()=>{
  const f=fixture(),a={path:'a.js',expectedSha256:'a'.repeat(64),edits:[{oldText:'1',newText:'2'}]},
    b={path:'b.js',expectedSha256:'b'.repeat(64),edits:[{oldText:'1',newText:'3'}]};
  const first=await f.observed('one','FAILED',[a]),second=await f.observed('two','FAILED',[b]);
  const refs=['run-one','run-two'],ctx=f.begin('coding.repair.trial',{candidateId:'combined',patches:[a,b],recipeIds:['unit'],parentTrialRunIds:refs},'combine');
  await f.bindings.trial.readBinding(ctx,'combined');
  assert.deepEqual(await f.bindings.trial.readParentArtifactDigests(ctx,'combined',refs,[a,b]),[first.result.binding.artifactDigest,second.result.binding.artifactDigest]);
  await assert.rejects(f.bindings.trial.readParentArtifactDigests(ctx,'combined',refs,[a]),{code:'UNAUTHORIZED'});
  const g=fixture(),conflicting={...a,edits:[{oldText:'1',newText:'conflicting'}]};
  await g.observed('one','FAILED',[a]);await g.observed('two','FAILED',[conflicting]);
  const overlap=g.begin('coding.repair.trial',{candidateId:'combined',patches:[a],recipeIds:['unit'],parentTrialRunIds:refs},'overlap');
  await g.bindings.trial.readBinding(overlap,'combined');
  await assert.rejects(g.bindings.trial.readParentArtifactDigests(overlap,'combined',refs,[a]),{code:'UNSUPPORTED_CAPABILITY'});
});
test('host-only provenance pins the captured comparison and reuses the canonical succeeded main session',async()=>{
  const f=fixture(),a=await f.observed('one'),b=await f.observed('two','FAILED');
  const ids=['run-one','run-two'],compare=f.begin('harness.candidates.compare',{trialRunIds:ids},'compare');
  f.bindings.compare.getBinding(compare);
  const result=compareHarnessCandidates(f.c,[a.result,b.result]);result.recommendation.trialRunId='run-one';
  f.confirm(compare,{...result,evidenceRefs:ids});
  const adopt=f.begin('coding.repair.prepare_adoption',{trialRunId:'run-one'},'adopt');
  await f.bindings.adoption.readSelection(adopt,'run-one');
  const saved=f.input(adopt,'main-session');saved.session.mode='main';await f.bindings.adoption.saveSession(adopt,saved);
  const checked=structuredClone(a.result.checkReadback);checked.sessionId='main-session';
  checked.verification.forEach(receipt=>{receipt.sessionId='main-session';receipt.runId='fresh-main-check';receipt.evidenceRefs=['adopt'];});
  f.confirm(adopt,checked);
  const request={ownerTaskId:f.c.binding.taskId,actualTaskId:f.c.binding.taskId,runId:'adopt'};
  assert.throws(()=>f.bindings.readOriginalSessionForProvenance(request),{code:'UNAUTHORIZED'},'running task is not a succeeded experience source');
  f.setTask(f.c.binding.taskId,'succeeded',8);
  assert.deepEqual(f.bindings.readOriginalSessionForProvenance(request),saved);
  const origin=f.bindings.readAdoptionOrigin(request);assert.equal(origin.comparison.runId,'compare');assert.equal(origin.trial.runId,'run-one');
  assert.equal(origin.adoptionInputDigest,f.records.find(r=>r.evidenceId==='adopt').inputDigest);
  assert.equal(f.runtime.loadCheckpoint(f.c.binding.taskId,'harness-candidates:adoption-origin:adopt').artifactId,a.result.binding.artifactId);
  assert.equal(f.runtime.loadCheckpoint(f.c.binding.taskId,'harness-candidates:session:adopt').input.session.sessionId,'main-session');
  assert.equal(f.runtime.loadCheckpoint(f.c.binding.taskId,'harness-candidates:selection:adopt'),undefined,'no competing selection journal');
  f.records.find(r=>r.evidenceId==='compare').inputDigest='substituted';
  assert.throws(()=>f.bindings.readAdoptionOrigin(request),{code:'UNAUTHORIZED'});
});
