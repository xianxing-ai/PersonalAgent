import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {AuthorizationQuestions,createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createDesktopTodoHost} from '../electron/todo-host.js';
import {createDesktopAuthorizationIntentHost,AUTHORIZATION_INTENT_TOOL} from '../electron/authorization-intent-host.js';
import {createDesktopNativeExecutionHost} from '../electron/native-execution-host.js';
import {createMicrophoneCaptureHost} from '../electron/microphone-capture-host.js';

const cache=new URL('../../../.cache/authorization-runtime-integration/',import.meta.url);mkdirSync(cache,{recursive:true});
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
const wait=async check=>{for(let n=0;n<200;n++){const result=check();if(result)return result;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Synthetic integration did not settle');};
function composition(directory){
  let application;const exports=[];
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>application,
    namespace:'Synthetic',resolveConversation:()=> 'Synthetic conversation',available:()=>true,
    profiles:[{ref:'application',label:'Synthetic application policy (no native executor)',mode:'workspace-write',revision:1,available:true},
      {ref:'changed',label:'Synthetic changed application policy',mode:'read-only',revision:1,available:true}],defaultProfileRef:'application'});
  const todo=createDesktopTodoHost({userData:directory,safeStorage,namespace:'Synthetic',question,
    createDeliveryHost:()=>({async tick(){},async close(){}})});
  const tool=todo.tools.find(item=>item.descriptor.name==='todo.create');
  application=createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'Synthetic',
    tools:todo.tools,competitionToolAvailability:todo.competitionToolAvailability,competitionToolExports:todo.competitionToolExports,
    prepareCompetitionToolExport:scope=>todo.prepareExport(scope),requiresToolAuthorization:scope=>question.requiresAuthorization(scope),
    requestToolAuthorization:scope=>question.requestToolAuthorization(scope),
    coordination:{async execute(request){
      if(request.continuation){exports.push(structuredClone(request.continuation));return {kind:'text',text:'Synthetic confirmed continuation',verification:'mock'};}
      return {kind:'tool_proposal',proposalId:'proposal-'+request.taskId,toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
        arguments:{title:request.goal},verification:'unverified'};
    }}});
  todo.bindApplication(application);const client=new Client(application);
  return {application,question,todo,exports,client,async close(){question.close();await wait(()=>application.activeTaskCount===0);await todo.close();application.close();}};
}

test('actual Runtime/Policy/Todo uses one card with old consent off, permanent rules survive restart and new normal arguments',async()=>{
  const directory=mkdtempSync(new URL('todo-',cache));let f=composition(directory);await f.client.connect();
  assert.equal(f.todo.snapshot().sessionAllowed,false);assert.throws(()=>f.todo.authorize({readAndCloudConsent:true}),/提问卡/);
  const submitted=await f.client.call('task.submit',{goal:'Synthetic first title',conversationId:'Synthetic conversation'},{idempotencyKey:'first'});
  const card=await wait(()=>f.question.snapshot().find(item=>item.state==='pending'));
  assert.equal(f.todo.snapshot().items.length,0);assert.equal(f.exports.length,0,'no private result left before the decision');
  assert.deepEqual(card.requirements.map(item=>item.kind),['tool','connector_session','export']);
  await assert.rejects(f.client.call('authorization.respond',{approvalId:card.sourceApprovalId,decision:'allow_once',expectedRevision:1}),/统一授权卡|host question/i);
  f.question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_always'},card.conversationId);
  await wait(()=>['succeeded','failed','waiting_reconciliation'].includes(f.application.runtime.getTask(submitted.taskId).state));
  assert.equal(f.application.runtime.getTask(submitted.taskId).state,'succeeded',JSON.stringify(f.application.runtime.getTask(submitted.taskId).error));
  assert.equal(f.todo.snapshot().items.length,1);assert.equal(f.exports.length,1);
  assert.equal(f.todo.snapshot().sessionAllowed,false);
  const record=f.application.runtime.readToolExecutions(submitted.taskId).find(item=>item.toolName==='todo.create');
  assert.equal(record.state,'confirmed');assert.equal(record.executionStarted,true);
  assert.equal(f.application.runtime.policy.get(record.evidenceId).usesRemaining,0);
  const lease=f.application.runtime.loadCheckpoint(submitted.taskId,'authorization-question-export:'+record.evidenceId+':todo-export');
  assert.match(lease.resultDigest,/^[a-f0-9]{64}$/);assert.ok(lease.leaseRef);
  const original={...f.application.readAuthorizationQuestionInvocation(submitted.taskId,record.evidenceId,true),signal:new AbortController().signal};
  assert.equal(f.application.runtime.loadCheckpoint(submitted.taskId,'competition-loop').pending,undefined);
  assert.equal(f.question.currentRequirement(original,'todo-export'),true,'final result guard reads the original confirmed receipt after pending is cleared');
  assert.throws(()=>f.question.currentRequirement({...original,runId:'replaced-run'},'todo-export'));
  const changed=structuredClone(f.exports[0].result);changed.item.title='Substituted after execution';
  assert.throws(()=>f.question.authorizeConsumedExport(original,changed,'todo-export'));
  assert.throws(()=>f.question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'},card.conversationId));
  await f.close();f=composition(directory);await f.client.connect();
  const second=await f.client.call('task.submit',{goal:'Synthetic different normal title',conversationId:'Synthetic conversation'},{idempotencyKey:'second'});
  await wait(()=>['succeeded','failed'].includes(f.application.runtime.getTask(second.taskId).state));
  assert.equal(f.application.runtime.getTask(second.taskId).state,'succeeded');
  assert.equal(f.question.snapshot().filter(item=>item.state==='pending').length,0,'same resource/profile derives a new exact grant without another card');
  assert.equal(f.todo.snapshot().items.length,2);assert.equal(f.exports.length,1);
  const rule=f.question.sandboxSnapshot().rules.find(item=>item.active);f.question.revokeRule({ruleId:rule.ruleId,expectedRevision:rule.revision});
  const denied=await f.client.call('task.submit',{goal:'Synthetic denied after revoke',conversationId:'Synthetic conversation'},{idempotencyKey:'denied'});
  const next=await wait(()=>f.question.snapshot().find(item=>item.state==='pending'));
  f.question.respond({questionId:next.questionId,expectedRevision:next.revision,decision:'deny'},next.conversationId);
  await wait(()=>f.application.activeTaskCount===0);
  assert.equal(f.application.runtime.getTask(denied.taskId).state,'cancelled','retain the original Runtime user-denial transition');
  assert.equal(f.todo.snapshot().items.length,2);assert.equal(f.exports.length,1);await f.close();
});

test('no-cloud original Competition Runtime serves local intent cards and rejects guessed host-only execution',async()=>{
  let app;const directory=mkdtempSync(new URL('intent-',cache));
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'Synthetic',resolveConversation:()=> 'Synthetic conversation',available:()=>true,
    profiles:[{ref:'app',label:'Synthetic app policy',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'app'});
  const intent=createDesktopAuthorizationIntentHost({getApplication:()=>app,question,openConversation(){}});
  app=createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'Synthetic',
    tools:[intent.tool],hostOnlyTools:[AUTHORIZATION_INTENT_TOOL],requiresToolAuthorization:()=>true,
    requestToolAuthorization:scope=>{intent.prepareQuestion(scope);return question.requestToolAuthorization(scope);}});
  const client=new Client(app);await client.connect();let writes=0;
  const operation=intent.request({action:'memory.save',payload:{content:'Synthetic only'},scope:{resource:'Synthetic'},summary:'Synthetic local memory write',isCurrent:()=>true});
  const card=await wait(()=>question.snapshot().find(item=>item.state==='pending'));assert.equal(writes,0);
  question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'},card.conversationId);
  if(await operation)writes++;assert.equal(writes,1);assert.equal(app.isDefaultSubagentAvailable(),false,'no coordination/model provider was installed');
  await assert.rejects(app.send({kind:'request',protocolVersion:'1.0.0',requestId:'forged-host-tool',taskId:card.taskId,
    operation:'tool.invoke',deadline:new Date(Date.now()+60000).toISOString(),payload:{toolName:AUTHORIZATION_INTENT_TOOL,toolVersion:'1.0.0',scopeRef:'forged',
      arguments:{action:'memory.save',payloadDigest:'a'.repeat(64),scopeDigest:'b'.repeat(64)}}},new AbortController().signal),{code:'UNAUTHORIZED'});
  assert.equal(writes,1);intent.close();question.close();await wait(()=>app.activeTaskCount===0);app.close();
});

test('original microphone intent publishes its SQLite question before an unverified native executor is needed',async t=>{
  let app,native,preparationError;const directory=mkdtempSync(new URL('microphone-intent-',cache));
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'Synthetic microphone',resolveConversation:()=> 'Synthetic microphone conversation',available:()=>true,
    profiles:[{ref:'default-read-only',label:'Synthetic application read-only',mode:'read-only',revision:1,available:true}],
    defaultProfileRef:'default-read-only',describeExecution:(request,profile)=>native.describeExecution(request,profile)});
  const intent=createDesktopAuthorizationIntentHost({getApplication:()=>app,question,openConversation(){}});
  native=createDesktopNativeExecutionHost({coding:{},question,getApplication:()=>app,
    readConfiguration:()=>assert.fail('Application-only microphone approval must not inspect an external command configuration'),
    ensureHelper:()=>assert.fail('Microphone approval must not launch a native helper'),probeRootPath:directory,
    systemRoot:directory,localAppData:directory});
  app=createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'Synthetic-microphone',
    tools:[intent.tool],hostOnlyTools:[AUTHORIZATION_INTENT_TOOL],requiresToolAuthorization:()=>true,
    requestToolAuthorization:async scope=>{
      try{intent.prepareQuestion(scope);await native.prepare(scope);return await question.requestToolAuthorization(scope);}
      catch(error){preparationError=error;throw error;}
    }});
  const panel={isDestroyed:()=>false,isVisible:()=>true,webContents:{id:17,isDestroyed:()=>false}};
  const microphone=createMicrophoneCaptureHost({getPanel:()=>panel,permissionGate:{grant:()=>assert.fail('No physical capture in this Synthetic test')},
    confirmAuthorization:request=>{
      const {signal,isCurrent,...payload}=request;
      return intent.request({action:'voice.capture',payload,scope:{panelId:payload.panelId,purpose:payload.purpose,expiresAt:payload.expiresAt},
        summary:'Synthetic Live microphone purpose',deadline:payload.expiresAt,signal,isCurrent});
    }});
  t.after(async()=>{await microphone.revoke();intent.close();question.close();native.close();await wait(()=>app.activeTaskCount===0);app.close();});
  const operation=microphone.authorize({purpose:'live',deadline:new Date(Date.now()+60000).toISOString()});operation.catch(()=>{});
  const outcome=await wait(()=>{
    const card=question.snapshot().find(item=>item.state==='pending');if(card)return {card};
    const task=app.runtime.listTasks({limit:1}).items[0];if(task?.state==='failed')return {task};
  });
  if(!outcome.card)t.diagnostic(JSON.stringify({preparationCode:preparationError?.code,
    preparationReason:preparationError?.message==='Host state must be bounded lossless JSON'?'state_not_lossless_json':'unclassified',
    taskCode:outcome.task.error?.code,taskReason:outcome.task.error?.message==='原授权请求已失效，本次操作未执行；请在当前对话重新提出。'
      ?'question_invalidated_before_execution':'unclassified',questionCount:question.snapshot().length,
    executionStarted:app.runtime.readToolExecutions(outcome.task.taskId).some(item=>item.executionStarted)}));
  assert.ok(outcome.card,'the original microphone purpose must remain visible for an explicit current card decision');
  const {card}=outcome;assert.equal(microphone.snapshot().authorized,false);assert.equal(microphone.snapshot().busy,true);
  assert.equal(question.sandboxSnapshot().selected.mode,'read-only');assert.equal(card.sandbox.native.required,false);
  assert.equal(card.sandbox.native.available,false);assert.equal(card.sandbox.native.enforced,false);
  const description=native.describeExecution({toolName:AUTHORIZATION_INTENT_TOOL,requirements:[]},{mode:'read-only'});
  assert.equal(Object.hasOwn(description,'bindingDigest'),false);
  assert.deepEqual(description,JSON.parse(JSON.stringify(description)));
  assert.equal(app.runtime.loadCheckpoint(card.taskId,'host-tool-intent').arguments.action,'voice.capture');
  assert.equal(app.runtime.readToolExecutions(card.taskId).length,0);
  question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'},card.conversationId);
  assert.equal((await operation).authorized,true);assert.equal(microphone.snapshot().active,false);
  await wait(()=>app.activeTaskCount===0);assert.equal(app.runtime.getTask(card.taskId).state,'succeeded');
  assert.equal(app.runtime.policy.get(card.sourceApprovalId).usesRemaining,0);
});

test('a malformed internal execution description retains its fixed cause before Runtime invalidation',async t=>{
  let app;const directory=mkdtempSync(new URL('malformed-question-',cache));
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'Synthetic malformed backend',resolveConversation:()=> 'Synthetic microphone conversation',available:()=>true,
    profiles:[{ref:'read',label:'Synthetic application read-only',mode:'read-only',revision:1,available:true}],defaultProfileRef:'read',
    // Explicit defective host port; no executor, microphone or external input runs.
    describeExecution:()=>({required:false,available:false,backend:'unavailable',enforced:false,bindingDigest:undefined})});
  const intent=createDesktopAuthorizationIntentHost({getApplication:()=>app,question,openConversation(){}});
  app=createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'Synthetic-malformed',
    tools:[intent.tool],hostOnlyTools:[AUTHORIZATION_INTENT_TOOL],requiresToolAuthorization:()=>true,
    requestToolAuthorization:scope=>{intent.prepareQuestion(scope);return question.requestToolAuthorization(scope);}});
  t.after(async()=>{intent.close();question.close();await wait(()=>app.activeTaskCount===0);app.close();});
  assert.equal(await intent.request({action:'voice.capture',payload:{purpose:'live',panelId:17},scope:{purpose:'live',panelId:17},
    summary:'Synthetic microphone intent',isCurrent:()=>true}),false);
  await wait(()=>app.activeTaskCount===0);
  const task=app.runtime.listTasks({limit:1}).items[0],runId='host-tool-'+task.taskId;
  const invocation=app.runtime.loadCheckpoint(task.taskId,'application-tool-invocation:'+runId);
  const saved=app.runtime.loadCheckpoint(task.taskId,'authorization-question-diagnostic:v1:'+runId);
  assert.deepEqual(saved,{version:1,authority:'diagnostic_no_tool_grant',taskId:task.taskId,runId,
    toolName:AUTHORIZATION_INTENT_TOOL,toolVersion:'1.0.0',argumentsDigest:invocation.argumentsDigest,deadline:invocation.deadline,
    stage:'question-open',code:'INVALID_ARGUMENT',reason:'state_not_lossless_json'});
  assert.equal(task.state,'failed');assert.equal(task.error.code,'REVISION_CONFLICT');
  assert.equal(question.snapshot().length,0);assert.equal(app.runtime.getApproval(runId).state,'denied');
  assert.equal(app.runtime.policy.get(runId),undefined);
  assert.ok(app.runtime.readToolExecutions(task.taskId).every(item=>item.executionStarted===false));
});

test('one original workflow decision derives distinct exact payload/run receipts, and cancellation invalidates later stages',async()=>{
  let app;const directory=mkdtempSync(new URL('stages-',cache));
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'Synthetic',resolveConversation:()=> 'Synthetic conversation',available:()=>true,
    profiles:[{ref:'app',label:'Synthetic bounded application operation',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'app'});
  const intent=createDesktopAuthorizationIntentHost({getApplication:()=>app,question,openConversation(){}});
  app=createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'Synthetic',
    tools:[intent.tool],hostOnlyTools:[AUTHORIZATION_INTENT_TOOL],requiresToolAuthorization:()=>true,
    requestToolAuthorization:scope=>{intent.prepareQuestion(scope);return question.requestToolAuthorization(scope);}});
  const owner=app.runtime.submitTask({goal:'Synthetic bounded workflow',conversationId:'Synthetic conversation',idempotencyKey:'owner'});
  app.runtime.transitionTask(owner.taskId,'planning');app.runtime.transitionTask(owner.taskId,'running');
  const deadline=new Date(Date.now()+60000).toISOString();app.runtime.saveCheckpoint(owner.taskId,'application-deadline',deadline);
  const operation={taskId:owner.taskId,digest:'d'.repeat(64)},request=payload=>intent.request({action:'developer.export',payload,
    scope:{resource:'Synthetic fixed repository',destination:'Synthetic model',budget:'original workflow budget'},operation,deadline,
    summary:'Synthetic model, tool projection and final stages under one original operation',isCurrent:()=>app.runtime.getTask(owner.taskId).state==='running'});
  const first=request({phase:'model',messages:['Synthetic only']});
  const card=await wait(()=>question.snapshot().find(item=>item.state==='pending'));
  question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'},card.conversationId);
  assert.equal(await first,true);
  assert.equal(await request({phase:'final',result:'Different exact Synthetic payload'}),true);
  assert.equal(question.snapshot().length,1,'derived later-stage decisions do not ask a second question');
  const decisions=app.runtime.listTasks({limit:100}).items.filter(item=>item.taskId!==owner.taskId);
  assert.equal(decisions.length,2);assert.ok(decisions.every(item=>item.state==='succeeded'));
  const inputs=decisions.map(item=>app.runtime.loadCheckpoint(item.taskId,'host-tool-intent'));
  assert.notEqual(inputs[0].argumentsDigest,inputs[1].argumentsDigest,'each derived run keeps its actual payload binding');
  app.runtime.requestCancel(owner.taskId,'Synthetic stop');
  assert.equal(await request({phase:'late',result:'Must not export'}),false);
  assert.equal(app.runtime.listTasks({limit:100}).items.length,3);
  intent.close();question.close();await wait(()=>app.activeTaskCount===0);app.close();
});
