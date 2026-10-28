import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as coding from '@personal-agent/coding-tools';
import {AuthorizationQuestions,createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createDesktopNativeExecutionHost} from '../electron/native-execution-host.js';
import {nativeTokenDiagnostic,unsupportedPsec} from '../../../packages/coding-tools/test/native-sandbox-fixture.mjs';

const explicitHelper=process.env.PA_TEST_JOB_HOST_EXE;
const required=process.env.PA_TEST_NATIVE_SANDBOX_REQUIRED==='1';
const configured=process.platform==='win32'&&explicitHelper&&existsSync(explicitHelper);
const integrationCache=fileURLToPath(new URL('../../../.cache/authorization-native-integration/',import.meta.url));
async function until(read,label,timeout=30000){
  const expires=Date.now()+timeout;
  while(Date.now()<expires){const value=read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}
  throw Error('Native authorization integration did not reach '+label);
}

function assertPreparationRefused({app,question,taskId,runId,preparationError,marker,substituted}){
  const task=app.runtime.getTask(taskId),approval=app.runtime.getApproval(runId),records=app.runtime.readToolExecutions(taskId);
  assert.equal(task.state,'failed');assert.equal(task.error?.code,'UNSUPPORTED_CAPABILITY');
  assert.equal(preparationError?.code,'UNSUPPORTED_CAPABILITY');
  assert.equal(task.error.message,'当前外部进程隔离后端或原授权不可用，未降级为普通进程');
  assert.equal(approval.state,'denied');assert.equal(approval.revision,2);
  assert.equal(approval.resolution?.actor,'system');assert.equal(approval.resolution?.reason,'stale');
  assert.equal(records.length,1);assert.equal(records[0].evidenceId,runId+'-question-invalidation');
  assert.equal(records[0].errorCode,'UNSUPPORTED_CAPABILITY');assert.equal(records[0].state,'failed');
  assert.equal(records[0].policyDecision,'deny');assert.equal(records[0].executionStarted,false);
  assert.equal(existsSync(marker),false);assert.equal(existsSync(substituted),false);
  assert.equal(app.runtime.loadCheckpoint(taskId,'native-sandbox-execution:'+runId),undefined);
  assert.equal(app.runtime.policy.get(runId),undefined);assert.equal(question.snapshot().length,0);
  for(const revision of [1,2])assert.throws(()=>app.runtime.respondApproval(runId,'allow_once',revision),{code:'REVISION_CONFLICT'});
  assert.equal(app.runtime.getApproval(runId).revision,2);assert.equal(app.runtime.policy.get(runId),undefined);
}

test('optional native integration requires a successful baseline and explicit unavailable PSEC API diagnostics',()=>{
  const unavailable={backend:'windows-psec',enforced:false,outcome:'unavailable',exitCode:null,stopped:true,reason:'native-create-environment:-2146233053'};
  const receipt={available:false,enforced:false,results:{baseline:{backend:'none',outcome:'exited',exitCode:0,stopped:true},readOnly:unavailable,workspaceWrite:unavailable,cancel:unavailable}};
  assert.equal(unsupportedPsec(receipt),true);
  for(const patch of [undefined,{...receipt,results:{}},{...receipt,available:true},
    {...receipt,results:{...receipt.results,baseline:{...receipt.results.baseline,exitCode:23}}},
    {...receipt,results:{...receipt.results,readOnly:{...unavailable,reason:'invalid-or-unavailable-trusted-configuration'}}},
    {...receipt,results:{...receipt.results,workspaceWrite:{...unavailable,reason:'native-create-environment:-2147467259'}}}])assert.equal(unsupportedPsec(patch),false);
});

// Explicit Fake probe only: the real Runtime and production hosts must reject before
// creating a card, grant or command execution. This does not verify Windows isolation.
test('an unavailable native probe preserves the safe cause through the actual authorization consumer',async t=>{
  await mkdir(integrationCache,{recursive:true});
  const base=realpathSync.native(await mkdtemp(path.join(integrationCache,'fake-unavailable-'))),workspace=path.join(base,'workspace');
  await mkdir(workspace);
  const nodeExecutable=realpathSync.native(process.execPath),marker=path.join(workspace,'once.txt'),substituted=path.join(workspace,'substituted.txt');
  const unavailable={backend:'windows-psec',enforced:false,outcome:'unavailable',exitCode:null,stopped:true,reason:'native-create-environment:-2146233052'};
  const receipt={backend:'windows-psec',available:false,enforced:false,results:{
    baseline:{backend:'none',enforced:false,outcome:'exited',exitCode:0,stopped:true},readOnly:unavailable,workspaceWrite:unavailable,cancel:unavailable}};
  let app,native,preparationError,authorizationCalls=0,probeCalls=0,toolExecutions=0,nativeExecutorCalls=0;
  const getApplication=()=>app;
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),
    getApplication,namespace:'fake-unavailable',resolveConversation:taskId=>app.readToolConversation(taskId),available:()=>true,
    profiles:[{ref:'fake-unavailable',label:'Explicit Fake unavailable probe',mode:'workspace-write',revision:1,available:true}],
    defaultProfileRef:'fake-unavailable',describeExecution:(request,profile)=>native.describeExecution(request,profile)});
  native=createDesktopNativeExecutionHost({coding:{...coding,
    readWindowsNativeHelperAttestation:helperPath=>({helperPath,helperSha256:'a'.repeat(64)}),
    async verifyWindowsNativeSandbox(){probeCalls++;return receipt;},
    createWindowsNativeSandboxExecutor(){nativeExecutorCalls++;throw Error('Unavailable probe must never create an executor');}},
    question,getApplication,readConfiguration:()=>({rootPath:workspace,nodeExecutable,bindingId:'fake-unavailable'}),
    ensureHelper:async()=>nodeExecutable,probeRootPath:path.join(base,'readiness'),systemRoot:path.dirname(nodeExecutable),localAppData:workspace});
  const command=native.createCommandTool({rootPath:workspace,recipes:[{id:'must-not-run',executable:nodeExecutable,
    args:['-e',"require('node:fs').writeFileSync('once.txt','must-not-run')"]}]});
  const tool={...command,async execute(...args){toolExecutions++;return command.execute(...args);}};
  app=createRuntimeApplication({path:path.join(base,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'fake-unavailable',
    tools:[tool],requiresToolAuthorization:scope=>question.requiresAuthorization(scope),requestToolAuthorization:async scope=>{
      authorizationCalls++;
      try{await native.prepare(scope);}catch(error){preparationError=error;throw error;}
      return question.requestToolAuthorization(scope);
    }});
  let taskId;
  t.after(async()=>{
    question.close();native.close();
    if(taskId&&!['succeeded','failed','cancelled'].includes(app.runtime.getTask(taskId).state))app.runtime.requestCancel(taskId,'Synthetic fixture cleanup');
    await until(()=>app.activeTaskCount===0,'fake unavailable cleanup');app.close();
  });
  const input={commandId:'fake-unavailable',toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
    arguments:{recipeId:'must-not-run'},deadline:new Date(Date.now()+90000).toISOString()};
  taskId=app.submitHostToolTask(input).task.taskId;
  await until(()=>app.runtime.getTask(taskId).state==='failed','fake unavailable refusal');
  await until(()=>app.activeTaskCount===0,'fake unavailable worker');
  const runId='host-tool-'+taskId;
  assertPreparationRefused({app,question,taskId,runId,preparationError,marker,substituted});
  assert.equal(app.submitHostToolTask(input).task.taskId,taskId,'replay retains the same terminal task');
  assert.equal(authorizationCalls,1);assert.equal(probeCalls,1);assert.equal(toolExecutions,0);assert.equal(nativeExecutorCalls,0);
  assertPreparationRefused({app,question,taskId,runId,preparationError,marker,substituted});
});

// Real Runtime, Policy, ToolGateway, question service/host and native execution host.
// Only the user's card decision and workspace contents are synthetic; no model or account is opened.
test('one real original question gates a production PSEC command and never replenishes authority',{
  skip:!configured&&!required?'Explicit trusted Windows PA_TEST_JOB_HOST_EXE unavailable':false,timeout:120000,
},async t=>{
  assert.ok(configured,'Required native integration needs Windows and the explicit trusted helper');
  t.diagnostic('Native integration inherited token: '+JSON.stringify(nativeTokenDiagnostic()));
  const helperPath=realpathSync.native(explicitHelper),pins=coding.readWindowsNativeHelperAttestation(helperPath);
  const nodeExecutable=realpathSync.native(process.execPath),systemRoot=realpathSync.native(process.env.SystemRoot);
  await mkdir(integrationCache,{recursive:true});
  // Canonicalize only this newly created trusted fixture, never weaken production alias rejection.
  const base=realpathSync.native(await mkdtemp(path.join(integrationCache,'case-'))),workspace=path.join(base,'workspace');
  await mkdir(workspace);
  const marker=path.join(workspace,'once.txt'),substituted=path.join(workspace,'substituted.txt');
  let app,native,configurationEnabled=true,authorizationCalls=0,originalScope,readiness,preparationError;
  const getApplication=()=>app;
  const profiles=[{ref:'native-workspace-write',label:'Synthetic workspace / real Windows boundary',mode:'workspace-write',revision:1,available:true}];
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),
    getApplication,namespace:'native-integration',resolveConversation:taskId=>app.readToolConversation(taskId),
    available:()=>true,profiles,defaultProfileRef:profiles[0].ref,
    describeExecution:(request,profile)=>native.describeExecution(request,profile)});
  const observedCoding={...coding,async verifyWindowsNativeSandbox(...args){readiness=await coding.verifyWindowsNativeSandbox(...args);return readiness;}};
  native=createDesktopNativeExecutionHost({coding:observedCoding,question,getApplication,
    readConfiguration:()=>configurationEnabled?{rootPath:workspace,nodeExecutable,bindingId:'synthetic-fixed-root'}:undefined,
    ensureHelper:async()=>helperPath,probeRootPath:path.join(base,'readiness'),systemRoot,localAppData:workspace});
  // Match production node-check/git callers: the factory must inject its minimal environment.
  // Do not populate it in this fixture and conceal a production-only launch failure.
  const tool=native.createCommandTool({rootPath:workspace,maxDurationMs:15000,maxOutputBytes:4096,recipes:[
    {id:'write-once',executable:nodeExecutable,args:['--preserve-symlinks','--preserve-symlinks-main','-e',
      "require('node:fs').appendFileSync('once.txt','x');process.stdout.write('synthetic-write-confirmed')"]},
    {id:'substituted',executable:nodeExecutable,args:['--preserve-symlinks','--preserve-symlinks-main','-e',
      "require('node:fs').writeFileSync('substituted.txt','must-not-run')"]},
  ]});
  const taskIds=[];
  app=createRuntimeApplication({path:path.join(base,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'native-integration',
    tools:[tool],requiresToolAuthorization:scope=>question.requiresAuthorization(scope),
    requestToolAuthorization:async scope=>{
      authorizationCalls++;originalScope=scope;
      try{await native.prepare(scope);}catch(error){preparationError=error;throw error;}
      return question.requestToolAuthorization(scope);
    }});
  t.after(async()=>{
    question.close();native.close();
    for(const taskId of taskIds){const task=app.runtime.getTask(taskId);if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(taskId,'Synthetic fixture cleanup');}
    await until(()=>app.activeTaskCount===0,'idle cleanup');app.close();
  });
  const deadline=new Date(Date.now()+90000).toISOString();
  const input={commandId:'native-exact-once',toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
    arguments:{recipeId:'write-once'},deadline};
  const submitted=app.submitHostToolTask(input);taskIds.push(submitted.task.taskId);
  const taskId=submitted.task.taskId,runId='host-tool-'+taskId;
  const prepared=await until(()=>{
    const card=question.snapshot().find(value=>value.taskId===taskId&&value.state==='pending');
    if(card)return {card};
    const task=app.runtime.getTask(taskId);
    return ['failed','cancelled','waiting_reconciliation'].includes(task.state)?{task}:undefined;
  },'original question or terminal readiness failure');
  if(!prepared.card){
    // Runtime invalidates the same pending approval and preserves the fixed safe
    // native refusal in both task and denied execution record; it never grants authority.
    const approval=app.runtime.getApproval(runId);
    t.diagnostic('Native preparation failure: '+JSON.stringify({taskState:prepared.task.state,
      taskErrorCode:prepared.task.error?.code,preparationErrorCode:preparationError?.code,
      approvalState:approval.state,approvalRevision:approval.revision,
      readiness:readiness?{backend:readiness.backend,available:readiness.available,enforced:readiness.enforced,results:readiness.results}:null}));
    assertPreparationRefused({app,question,taskId,runId,preparationError,marker,substituted});
    const diagnostic={required,taskState:prepared.task.state,errorCode:prepared.task.error.code,
      readiness:readiness?{backend:readiness.backend,available:readiness.available,enforced:readiness.enforced,results:readiness.results}:null};
    await writeFile(path.join(base,'unavailable-receipt.json'),JSON.stringify(diagnostic,null,2));
    t.diagnostic('Actual native readiness: '+JSON.stringify(diagnostic));
    if(!required&&unsupportedPsec(readiness)){
      t.skip('Actual baseline passed; this runner lacks the required PSEC API (see native-create-environment diagnostics)');return;
    }
    assert.fail('Required or unexpected native backend failure; no command executed: '+JSON.stringify(diagnostic));
  }
  const {card}=prepared;
  assert.equal(app.runtime.getTask(taskId).state,'waiting_approval');assert.equal(card.taskId,taskId);assert.equal(card.sourceApprovalId,runId);
  assert.equal(card.sandbox.native.backend,'windows-psec');assert.equal(card.sandbox.native.available,true);assert.equal(card.sandbox.native.enforced,true);
  assert.deepEqual(card.requirements.map(value=>value.requirementId),['tool','native-execution']);
  assert.equal(existsSync(marker),false,'readiness diagnostics never execute the proposed business recipe');
  assert.equal(app.runtime.loadCheckpoint(taskId,'native-sandbox-execution:'+runId),undefined);
  assert.equal(app.runtime.policy.get(runId),undefined,'a question alone is not a Policy grant');
  assert.throws(()=>app.submitHostToolTask({...input,arguments:{recipeId:'substituted'}}),{code:'REVISION_CONFLICT'});
  assert.equal(existsSync(substituted),false);
  const answer={questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'};
  assert.equal(question.respond(answer,card.conversationId).accepted,true);
  await until(()=>app.runtime.getTask(taskId).state==='succeeded','confirmed native task');
  await until(()=>app.activeTaskCount===0,'settled worker');
  assert.equal(readFileSync(marker,'utf8'),'x');assert.equal(existsSync(substituted),false);
  const readback=app.readHostToolTask(taskId),records=app.runtime.readToolExecutions(taskId);
  assert.equal(readback.confirmed.runId,runId);assert.equal(readback.confirmed.result.exitCode,0);
  assert.equal(readback.confirmed.result.stdout,'synthetic-write-confirmed');
  assert.equal(records.length,1);assert.equal(records[0].evidenceId,runId);assert.equal(records[0].state,'confirmed');
  assert.equal(records[0].policyDecision,'allow');assert.equal(records[0].executionStarted,true);
  const audit=app.runtime.loadCheckpoint(taskId,'native-sandbox-execution:'+runId);
  assert.equal(audit.length,1);assert.equal(audit[0].backend,'windows-psec');assert.equal(audit[0].enforced,true);
  assert.equal(audit[0].outcome,'exited');assert.equal(audit[0].executionStarted,true);assert.equal(audit[0].stopped,true);
  assert.equal(app.runtime.policy.get(runId).usesRemaining,0);
  assert.throws(()=>question.respond(answer,card.conversationId),{code:'REVISION_CONFLICT'});
  const replay=app.submitHostToolTask(input);assert.equal(replay.task.taskId,taskId);
  assert.equal(replay.confirmed.runId,runId);assert.equal(readFileSync(marker,'utf8'),'x');assert.equal(authorizationCalls,1);
  await assert.rejects(app.tools.invoke({toolName:input.toolName,toolVersion:input.toolVersion,arguments:{recipeId:'substituted'},
    taskId,runId,authorizationRef:runId,deadline,signal:new AbortController().signal}));
  assert.equal(readFileSync(marker,'utf8'),'x');assert.equal(existsSync(substituted),false);assert.equal(app.runtime.policy.get(runId).usesRemaining,0);

  // An unavailable production configuration must fail before a new question/command, never plain spawn.
  configurationEnabled=false;
  const unavailable=app.submitHostToolTask({...input,commandId:'native-unavailable',arguments:{recipeId:'substituted'}});
  taskIds.push(unavailable.task.taskId);
  await until(()=>app.runtime.getTask(unavailable.task.taskId).state==='failed','unavailable backend failure');
  await until(()=>app.activeTaskCount===0,'unavailable worker cleanup');
  assert.equal(existsSync(substituted),false);assert.equal(question.snapshot().length,1);
  assert.equal(app.runtime.loadCheckpoint(unavailable.task.taskId,'native-sandbox-execution:host-tool-'+unavailable.task.taskId),undefined);
  await assert.rejects(native.prepare(originalScope),/未降级为普通进程/);
  const receipt={version:1,scope:'synthetic-user-decision-real-runtime-native-command',modelCalls:0,accountCalls:0,
    helperSha256:pins.helperSha256,helperFilesSha256:pins.helperFilesSha256,taskId,runId,questionId:card.questionId,
    originalArgumentsDigest:records[0].argumentsDigest??app.runtime.getApproval(runId).argumentsDigest,
    native:audit[0],beforeApprovalRecipeExecutions:0,confirmedRecipeExecutions:1,repeatExecutions:0,
    substitutedExecutions:0,unavailableFallbackExecutions:0,policyUsesRemaining:app.runtime.policy.get(runId).usesRemaining};
  await writeFile(path.join(base,'receipt.json'),JSON.stringify(receipt,null,2));
  t.diagnostic('Native whole-chain receipt saved under the ignored authorization-native-integration case directory');
});
