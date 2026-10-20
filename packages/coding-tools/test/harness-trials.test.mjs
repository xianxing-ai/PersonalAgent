import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {captureCodingRepairSnapshot,createIsolatedCodingRepairHost,createIsolatedCodingRepairTools,createWorkspaceCommandTool,
  createHarnessCandidateTrialTool,createHarnessCandidateAdoptionTool,createHarnessCandidateRecoveryTool} from '../dist/index.js';
import {harnessCandidateRecipeFingerprint} from '@personal-agent/contracts/harness-candidates';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';

const context=(taskId,extra={})=>({taskId,runId:'run-'+randomUUID(),authorizationRef:'explicit-fake-outer-grant-'+randomUUID(),
  argumentsDigest:'d'.repeat(64),scopes:['workspace:read','workspace:write','workspace:apply','workspace:execute'],
  deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal,...extra});
async function fixture(t) {
  const directory=await mkdtemp(path.join(tmpdir(),'pa-harness-trials-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const source=path.join(directory,'source'),sessions=path.join(directory,'sessions');await mkdir(source);
  await writeFile(path.join(source,'package.json'),'{"name":"public-fixture"}');
  await writeFile(path.join(source,'note.txt'),'user uncommitted content');
  const baseline=(await captureCodingRepairSnapshot(await realpath(source))).snapshot;
  const options={workspaceRoot:source,sessionRoot:sessions,workspaceId:'fixture',expectedBaselineSnapshotId:baseline.snapshotId,
    patch:{powerShellPath:'C:/Program Files/PowerShell/7/pwsh.exe'},recipes:[{recipeId:'fixture-check',packageIds:['root'],required:true}]};
  return {source,sessions,baseline,options,host:await createIsolatedCodingRepairHost(options)};
}

test('candidate sessions keep one baseline but never share writable source or task ownership',async t=>{
  const f=await fixture(t),a=context('candidate-a'),b=context('candidate-b');
  const first=await f.host.start({mode:'isolated',allowedPaths:['candidate.txt']},a);
  const second=await f.host.start({mode:'isolated',allowedPaths:['candidate.txt']},b);
  assert.notEqual(first.session.sessionId,second.session.sessionId);
  assert.equal(first.session.baselineSnapshotId,second.session.baselineSnapshotId);
  await f.host.patch(first.session.sessionId,{path:'candidate.txt',expectedSha256:null,edits:[],createText:'a only'},a);
  await assert.rejects(readFile(path.join(f.source,'candidate.txt')),{code:'ENOENT'});
  await assert.rejects(f.host.read(second.session.sessionId,{path:'candidate.txt'},b),{code:'NOT_FOUND'});
  await assert.rejects(f.host.snapshot(first.session.sessionId,b),{code:'UNAUTHORIZED'});
  assert.equal(await readFile(path.join(f.source,'note.txt'),'utf8'),'user uncommitted content');
  await assert.rejects(f.host.publish({version:1,sessionId:first.session.sessionId,baselineSnapshotId:f.baseline.snapshotId,
    snapshotId:(await f.host.snapshot(first.session.sessionId,a)).snapshotId,paths:['candidate.txt'],verificationRunIds:[]},a),{code:'SCOPE_DENIED'});
});

async function trialFixture(t,extra={}) {
  const f=await fixture(t),stored=new Map(),commandRoots=[];
  const host=await createIsolatedCodingRepairHost({...f.options,
    createCommandTool:({rootPath})=>{commandRoots.push(rootPath);return createWorkspaceCommandTool({rootPath,recipes:[{
      id:'fixture-check',executable:process.execPath,args:['-e',"require('node:assert/strict').equal(require('node:fs').readFileSync('candidate.txt','utf8'),'passes')"]}]});},...extra});
  const expected={binding:{version:1,taskId:'owner-task',workspaceId:'fixture',baselineSnapshotId:f.baseline.snapshotId,
    inputDigest:'1'.repeat(64),configurationDigest:'2'.repeat(64),workflowVersion:'F15-v6',runtimeVersion:'runtime-fixture-v1',
    recipeFingerprint:harnessCandidateRecipeFingerprint(f.options.recipes),executionKind:'real_host'},baseline:f.baseline,
    recipes:f.options.recipes,selectionPolicy:'unique_verified'};
  const key=c=>JSON.stringify([c.taskId,c.runId]);
  const options={host,readBinding:async()=>structuredClone(expected),
    readSession:async c=>stored.get(key(c)),saveSession:async(c,input)=>{
      assert.equal(stored.has(key(c)),false,'original Runtime checkpoint port is write-once');stored.set(key(c),structuredClone(input));}};
  const tool=createHarnessCandidateTrialTool(options),policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy});gateway.register(tool);
  const input=(candidateId,text='passes')=>({candidateId,patches:[{path:'candidate.txt',expectedSha256:null,edits:[],createText:text}],recipeIds:['fixture-check']});
  async function invoke(value,c=context('child-task'),scopes=tool.descriptor.requiredScopes) {
    policy.grant({authorizationRef:c.authorizationRef,taskId:c.taskId,toolName:tool.descriptor.name,scopes,
      argumentsDigest:toolArgumentsDigest(value),expiresAt:c.deadline,maxUses:1});
    return gateway.invoke({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:value,...c});
  }
  return {...f,host,stored,commandRoots,expected,options,tool,input,invoke};
}

test('one approved candidate uses real isolated files and fixed verification while retaining actual task/run',async t=>{
  const f=await trialFixture(t),a=context('child-a'),b=context('child-b');
  // Real filesystem and fixed Node recipes; original Runtime checkpoint/Evidence confirmation is explicit Fake here.
  const passed=await f.invoke(f.input('candidate-a'),a),failed=await f.invoke(f.input('candidate-b','fails'),b);
  assert.equal(passed.binding.taskId,'owner-task');assert.equal(passed.binding.trialTaskId,'child-a');
  assert.equal(passed.session.taskId,'child-a');assert.notEqual(passed.session.sessionId,failed.session.sessionId);
  assert.equal(passed.checkReadback.verification[0].status,'VALID');assert.equal(failed.checkReadback.verification[0].status,'FAILED');
  assert.deepEqual(passed.checkReadback.verification[0].evidenceRefs,[a.runId]);
  assert.notEqual(passed.binding.artifactDigest,failed.binding.artifactDigest);
  assert.notEqual(f.commandRoots[0],f.commandRoots[1]);
  assert.equal(passed.checkReadback.snapshot.files.some(file=>'content' in file),false);
  assert.doesNotMatch(JSON.stringify(failed),/AssertionError|node:assert|user uncommitted content/);
  await assert.rejects(readFile(path.join(f.source,'candidate.txt')),{code:'ENOENT'});
  const restored=createHarnessCandidateTrialTool(f.options);
  await assert.rejects(restored.execute(f.input('candidate-a'),a),{code:'RESULT_UNKNOWN'});
  assert.equal(f.commandRoots.length,2,'recovery cannot replay the original candidate write/command');
});

test('Policy denies a trial without all scopes; required recipes and bound metadata cannot be supplied by model',async t=>{
  const f=await trialFixture(t);
  await assert.rejects(f.invoke(f.input('candidate-a'),context('child-a'),['workspace:read']),{code:'SCOPE_DENIED'});
  await assert.rejects(f.tool.execute({...f.input('candidate-a'),workspaceRoot:f.source},context('child-a')));
  await assert.rejects(f.tool.execute({...f.input('candidate-a'),recipeIds:['other']},context('child-a')),{code:'INVALID_ARGUMENT'});
  assert.equal(f.stored.size,0);assert.equal(f.commandRoots.length,0);
});

test('unknown command keeps the original session stopped-state requirement and never starts a replacement trial',async t=>{
  let commands=0,stopState='unknown';
  const f=await trialFixture(t,{createCommandTool:()=>({descriptor:{name:'workspace.run_allowed_command',version:'1.0.0',inputSchema:{}},
    async execute(){commands++;throw Error('Explicit Fake unknown process outcome');}}),readCommandStopState:async()=>stopState});
  const c=context('child-a');await assert.rejects(f.invoke(f.input('candidate-a'),c),{code:'RESULT_UNKNOWN'});
  const session=[...f.stored.values()][0].session;
  assert.equal((await f.host.reconcile(session.sessionId,context('child-a'))).state,'unknown');
  const recovery=createHarnessCandidateRecoveryTool({host:f.host,readOriginalSession:async(ctx,runId)=>f.stored.get(JSON.stringify([ctx.taskId,runId]))});
  const read=context('child-a',{scopes:['workspace:read']}),unknown=await recovery.execute({trialRunId:c.runId},read);
  assert.equal(unknown.state,'unknown');assert.equal(unknown.checkReadback.verification[0].status,'UNKNOWN');
  assert.deepEqual(unknown.checkReadback.verification[0].evidenceRefs,[c.runId]);
  stopState='running';assert.equal((await recovery.execute({trialRunId:c.runId},read)).state,'in_progress');
  stopState='stopped';const stopped=await recovery.execute({trialRunId:c.runId},read);
  assert.equal(stopped.state,'clear');assert.equal(stopped.checkReadback.verification[0].status,'UNKNOWN','stopped does not turn unknown verification into passing');
  await assert.rejects(recovery.execute({trialRunId:c.runId},context('owner-task')),{code:'UNAUTHORIZED'});
  await assert.rejects(createHarnessCandidateTrialTool(f.options).execute(f.input('candidate-a'),c),{code:'RESULT_UNKNOWN'});
  assert.equal(commands,1);assert.equal(f.stored.size,1);
});

test('composition accepts only trusted original run references and performs a new independent verification',async t=>{
  const f=await trialFixture(t),a=context('child-a'),b=context('child-b');
  const parentA=await f.invoke(f.input('parent-a'),a);
  const second=f.input('parent-b');second.patches.push({path:'parent-note.txt',expectedSha256:null,edits:[],createText:'second parent'});
  const parentB=await f.invoke(second,b),confirmed=new Map([[a.runId,parentA],[b.runId,parentB]]);
  let reads=0;
  const combined=createHarnessCandidateTrialTool({...f.options,readParentArtifactDigests:async(_ctx,_id,runs,patches)=>{
    reads++;assert.deepEqual(patches,second.patches);
    return runs.map(run=>{const trial=confirmed.get(run);if(!trial)throw Error('Explicit Fake Runtime rejects unconfirmed or foreign run');return trial.binding.artifactDigest;});}});
  const value={...second,candidateId:'combined',parentTrialRunIds:[a.runId,b.runId]},c=context('child-c');
  const result=await approved(combined,value,c);
  assert.deepEqual(result.binding.parentArtifactDigests,[parentA.binding.artifactDigest,parentB.binding.artifactDigest]);
  assert.notEqual(result.session.sessionId,parentA.session.sessionId);assert.notEqual(result.session.sessionId,parentB.session.sessionId);
  assert.deepEqual(result.checkReadback.verification[0].evidenceRefs,[c.runId]);assert.equal(f.commandRoots.length,3);assert.equal(reads,2);
  await assert.rejects(combined.execute({...value,parentTrialRunIds:[a.runId,'foreign-run']},context('child-d')));
  await assert.rejects(f.tool.execute(value,context('child-d')),{code:'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(f.tool.execute({...value,parentArtifactDigests:result.binding.parentArtifactDigests},context('child-d')));
  assert.equal(f.commandRoots.length,3);
});

test('cancellation and expiration stop a new trial before isolation or command execution',async t=>{
  const f=await trialFixture(t),controller=new AbortController();controller.abort();
  await assert.rejects(f.tool.execute(f.input('candidate-a'),context('child-a',{signal:controller.signal})),{code:'CANCELLED'});
  await assert.rejects(f.tool.execute(f.input('candidate-a'),context('child-a',{deadline:'2000-01-01T00:00:00Z'})),{code:'TIMEOUT'});
  assert.equal(f.stored.size,0);assert.equal(f.commandRoots.length,0);
});

test('in-flight cancellation settles the command and keeps the original unknown receipt without another trial',async t=>{
  let entered,commands=0;
  const started=new Promise(resolve=>{entered=resolve;});
  const f=await trialFixture(t,{createCommandTool:()=>({descriptor:{name:'workspace.run_allowed_command',version:'1.0.0',inputSchema:{}},
    async execute(_value,c){commands++;entered();await new Promise(resolve=>c.signal.addEventListener('abort',resolve,{once:true}));
      throw Error('Explicit Fake stopped command');}}),readCommandStopState:async()=> 'stopped'});
  const controller=new AbortController(),c=context('child-a',{signal:controller.signal});
  const running=f.tool.execute(f.input('candidate-a'),c);await started;controller.abort();
  await assert.rejects(running);
  const original=[...f.stored.values()][0].session.sessionId;
  const healthy=context('child-a');assert.equal((await f.host.reconcile(original,healthy)).state,'clear');
  await assert.rejects(createHarnessCandidateTrialTool(f.options).execute(f.input('candidate-a'),{...healthy,runId:c.runId}),{code:'RESULT_UNKNOWN'});
  assert.equal(commands,1);assert.equal(f.stored.size,1);
});

test('trusted configuration drift after verification refuses to issue a comparable receipt',async t=>{
  const f=await trialFixture(t),options={...f.options};let reads=0;
  options.readBinding=async()=>{const value=structuredClone(f.expected);if(++reads===2)value.binding.configurationDigest='3'.repeat(64);return value;};
  await assert.rejects(createHarnessCandidateTrialTool(options).execute(f.input('candidate-a'),context('child-a')),{code:'REVISION_CONFLICT'});
  assert.equal(f.stored.size,1);assert.equal(f.commandRoots.length,1);
  await assert.rejects(readFile(path.join(f.source,'candidate.txt')),{code:'ENOENT'});
});

async function approved(tool,value,c) {
  const policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy});gateway.register(tool);
  policy.grant({authorizationRef:c.authorizationRef,taskId:c.taskId,toolName:tool.descriptor.name,scopes:tool.descriptor.requiredScopes,
    argumentsDigest:toolArgumentsDigest(value),expiresAt:c.deadline,maxUses:1});
  return gateway.invoke({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:value,...c});
}
async function adoptionFixture(t,extra={}) {
  const confirmed=new Set();
  const f=await trialFixture(t,{readVerificationEvidence:async({originRunId})=>confirmed.has(originRunId)?[originRunId]:undefined,...extra});
  const trialContext=context('child-a'),trial=await f.invoke(f.input('selected'),trialContext);
  // Explicit Fake Runtime selection/confirmation ports; trial and adoption commands/files are real.
  const selection={trial,comparison:{version:1,state:'selected',reason:'explicit-fake-runtime-comparison',candidates:[],verification:'unverified',
    recommendation:{candidateId:trial.binding.candidateId,artifactId:trial.binding.artifactId,artifactDigest:trial.binding.artifactDigest,
      trialRunId:trialContext.runId,publishRequest:{version:1,sessionId:trial.session.sessionId,baselineSnapshotId:f.baseline.snapshotId,
        snapshotId:trial.checkReadback.snapshot.snapshotId,paths:['candidate.txt'],verificationRunIds:trial.checkReadback.verification.map(r=>r.runId)}}},
    patches:f.input('selected').patches};
  const options={...f.options,readSelection:async()=>structuredClone(selection)};
  return {...f,confirmed,selection,trialContext,options,adopt:createHarnessCandidateAdoptionTool(options)};
}

test('selected artifact is freshly checked in main session, then only a later confirmed operation can CAS publish',async t=>{
  const f=await adoptionFixture(t),c=context('owner-task');
  const prepared=await approved(f.adopt,{trialRunId:f.trialContext.runId},c);
  assert.notEqual(prepared.sessionId,f.selection.trial.session.sessionId);assert.equal(f.commandRoots.length,2);
  assert.equal(prepared.verification[0].status,'VALID');assert.deepEqual(prepared.verification[0].evidenceRefs,[c.runId]);
  await assert.rejects(readFile(path.join(f.source,'candidate.txt')),{code:'ENOENT'});
  const publish=createIsolatedCodingRepairTools(f.host).find(tool=>tool.descriptor.name==='coding.repair.publish');
  const request={version:1,sessionId:prepared.sessionId,baselineSnapshotId:f.baseline.snapshotId,snapshotId:prepared.snapshot.snapshotId,
    paths:['candidate.txt'],verificationRunIds:prepared.verification.map(r=>r.runId)};
  await assert.rejects(approved(publish,request,context('owner-task')),{code:'RESULT_UNKNOWN'});
  f.confirmed.add(c.runId);
  const result=await approved(publish,request,context('owner-task'));
  assert.equal(result.state,'published');assert.equal(await readFile(path.join(f.source,'candidate.txt'),'utf8'),'passes');
  assert.equal(f.commandRoots.length,2,'publish does not re-run either candidate command');
});

test('adoption refuses substituted selection and preserves a concurrent user CAS conflict',async t=>{
  const f=await adoptionFixture(t),c=context('owner-task');
  await assert.rejects(f.adopt.execute({trialRunId:'different-run'},c),{code:'UNAUTHORIZED'});
  const prepared=await approved(f.adopt,{trialRunId:f.trialContext.runId},c);f.confirmed.add(c.runId);
  await writeFile(path.join(f.source,'note.txt'),'concurrent user change');
  const publish=createIsolatedCodingRepairTools(f.host).find(tool=>tool.descriptor.name==='coding.repair.publish');
  const result=await approved(publish,{version:1,sessionId:prepared.sessionId,baselineSnapshotId:f.baseline.snapshotId,
    snapshotId:prepared.snapshot.snapshotId,paths:['candidate.txt'],verificationRunIds:prepared.verification.map(r=>r.runId)},context('owner-task'));
  assert.equal(result.state,'conflict');assert.equal(await readFile(path.join(f.source,'note.txt'),'utf8'),'concurrent user change');
  await assert.rejects(readFile(path.join(f.source,'candidate.txt')),{code:'ENOENT'});
});

test('a fresh adoption failure stays FAILED and cannot inherit a selected parent passing check',async t=>{
  const f=await adoptionFixture(t,{createCommandTool:({rootPath,session})=>createWorkspaceCommandTool({rootPath,recipes:[{
    id:'fixture-check',executable:process.execPath,args:['-e',session.mode==='main'?'process.exit(7)':'process.exit(0)']}]})});
  const c=context('owner-task'),prepared=await approved(f.adopt,{trialRunId:f.trialContext.runId},c);f.confirmed.add(c.runId);
  assert.equal(f.selection.trial.checkReadback.verification[0].status,'VALID');
  assert.equal(prepared.verification[0].status,'FAILED');assert.equal(prepared.verification[0].exitCode,7);
  const publish=createIsolatedCodingRepairTools(f.host).find(tool=>tool.descriptor.name==='coding.repair.publish');
  await assert.rejects(approved(publish,{version:1,sessionId:prepared.sessionId,baselineSnapshotId:f.baseline.snapshotId,
    snapshotId:prepared.snapshot.snapshotId,paths:['candidate.txt'],verificationRunIds:prepared.verification.map(r=>r.runId)},context('owner-task')),{code:'RESULT_UNKNOWN'});
  await assert.rejects(readFile(path.join(f.source,'candidate.txt')),{code:'ENOENT'});
});

test('source drift rejects a later candidate before creating another trial directory',async t=>{
  const f=await fixture(t);await f.host.start({mode:'isolated'},context('candidate-a'));
  const existing=await readdir(f.sessions);
  await writeFile(path.join(f.source,'note.txt'),'concurrent user edit');
  await assert.rejects(f.host.start({mode:'isolated'},context('candidate-b')),{code:'REVISION_CONFLICT'});
  assert.deepEqual(await readdir(f.sessions),existing);
  assert.equal(await readFile(path.join(f.source,'note.txt'),'utf8'),'concurrent user edit');
});

test('a restored candidate cannot silently replace its pinned baseline configuration',async t=>{
  const f=await fixture(t),c=context('candidate-a'),started=await f.host.start({mode:'isolated'},c);
  const restored=await createIsolatedCodingRepairHost(f.options);
  assert.equal((await restored.snapshot(started.session.sessionId,c)).snapshotId,f.baseline.snapshotId);
  const changed=await createIsolatedCodingRepairHost({...f.options,expectedBaselineSnapshotId:'a'.repeat(64)});
  await assert.rejects(changed.snapshot(started.session.sessionId,c),{code:'REVISION_CONFLICT'});
  await assert.rejects(restored.start({mode:'isolated'},context('candidate-b',{scopes:[]})),{code:'SCOPE_DENIED'});
  const controller=new AbortController();controller.abort();
  await assert.rejects(restored.start({mode:'isolated'},context('candidate-b',{signal:controller.signal})),{code:'CANCELLED'});
});
