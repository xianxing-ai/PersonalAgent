import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {PROTOCOL_VERSION,validateToolValue} from '@personal-agent/contracts';
import {createWorkspaceConfigHost} from '../electron/workspace-config-host.js';
import {createWorkspaceCommandRecipeTool} from '../electron/workspace-command-recipes.js';
import {createWorkspaceCommandTool} from '@personal-agent/coding-tools';
import {AuthorizationQuestions,createRuntimeApplication,createDesktopSubagentDispatchTool} from '@personal-agent/runtime/application';
import {LayaActionChoiceService} from '@personal-agent/cognition';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';

// Explicit Synthetic decision service; these tests do not certify the native
// sandbox or the integrated Main/Runtime question persistence.
function workspaceQuestions() {
  const entries=new Map(),resources=new Map(),allowed=new Set(),key=s=>JSON.stringify([s.taskId,s.runId]);
  const host={entries,resources,prepare(scope,{requirements,assertCurrent}) {
    const entry=entries.get(key(scope))??{scope,requirements:[],guards:[]};entry.requirements.push(...requirements);
    if(assertCurrent)entry.guards.push(assertCurrent);entries.set(key(scope),entry);
  },prepareExport(scope,{requirementId,projectionSchema,...requirement}) {
    host.prepare(scope,{requirements:[{...requirement,requirementId,kind:'export',projectionSchema}]});
  },currentRequirement(scope,id) {
    const entry=entries.get(key(scope));assert.ok(entry&&allowed.has(key(scope))&&!scope.signal.aborted,'no exact Synthetic decision');
    assert.ok(entry.requirements.some(r=>r.requirementId===id));assert.ok(entry.guards.every(guard=>guard()===true));
  },authorizeExport(scope,value,id) {host.currentRequirement(scope,id);
    const schema=entries.get(key(scope)).requirements.find(r=>r.requirementId===id).projectionSchema;
    assert.ok(schema);validateToolValue(schema,value);
  },readResourceGeneration(resource) {if(!resources.has(resource))resources.set(resource,randomUUID());return resources.get(resource);},
  rotateResourceGeneration(resource,expected) {assert.equal(host.readResourceGeneration(resource),expected);resources.set(resource,randomUUID());},
  allow(scope) {assert.ok(entries.has(key(scope)));allowed.add(key(scope));}};
  host.authorizeConsumedExport=(...args)=>host.authorizeExport(...args);
  return host;
}
function workspaceOperation(tool,args,taskId=randomUUID()) {
  const proposalId=randomUUID();return {taskId,runId:randomUUID(),proposalId,deadline:new Date(Date.now()+60_000).toISOString(),
    signal:new AbortController().signal,authorizationRef:'Synthetic original ToolGateway grant',scopes:tool.descriptor.requiredScopes,
    proposal:{proposalId,toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:args}};
}
function workspaceRuntime() {
  const state=new Map();return {readToolConversation:()=> 'Synthetic canonical user',runtime:{loadCheckpoint:(t,k)=>state.get(t+':'+k),
    saveCheckpoint:(t,k,v)=>state.set(t+':'+k,v),getTask:taskId=>({taskId,state:'running',cancelRequested:false})}};
}

test('Synthetic question workspace is discoverable with old consent false but executes and exports only its exact receipt',async t=>{
  const {root,open}=await workspaceBindingFixture(t);await writeFile(path.join(root,'Synthetic-private-name.js'),'Synthetic source');
  const question=workspaceQuestions(),host=open({question,findExecutable:()=>undefined});host.bindApplication(workspaceRuntime());
  assert.ok(host.tools.length,JSON.stringify(host.snapshot()));
  const tool=host.tools.find(item=>item.descriptor.name==='workspace.list_entries'),input={path:'.'},scope=workspaceOperation(tool,input);
  const policy=host.competitionToolExports.find(item=>item.toolName===tool.descriptor.name);
  assert.equal(host.snapshot().cloudExportAllowed,false);assert.equal(host.readWorkspaceBinding().rootPath,root);
  assert.equal(host.readDeveloperConfiguration().available(scope),true,'configuration readiness is not an operation grant');
  assert.equal(host.competitionToolAvailability.find(item=>item.toolName===tool.descriptor.name).available(scope),true);
  host.prepareExport({...scope,phase:'preflight'});assert.equal(policy.accepts({...scope,arguments:input}),true);
  await assert.rejects(tool.execute(input,scope));question.allow(scope);
  const result=await tool.execute(input,scope);assert.ok(result.entries.length>0);
  const projection=policy.project({...scope,result});assert.deepEqual(projection,{listed:true,truncated:false});
  assert.equal(JSON.stringify(projection).includes('Synthetic-private-name'),false);
  assert.equal(policy.accepts({...scope,arguments:input,phase:'final',projection}),true);
  assert.equal(policy.accepts({...scope,arguments:input,phase:'final',projection:{...projection,entries:result.entries}}),false);
  await assert.rejects(tool.execute({path:'different'},scope));await assert.rejects(tool.execute(input,{...scope,runId:'other'}));
  await assert.rejects(host.authorize({cloudExportAllowed:true,writeAllowed:true,commandAllowed:true}),/提问卡/);
  host.revoke();await assert.rejects(tool.execute(input,scope));assert.equal(policy.accepts({...scope,arguments:input,phase:'final',projection}),false);
});

test('Synthetic workspace permanent resource survives normal close and changes on explicit revoke, never persisting a grant',async t=>{
  const {open}=await workspaceBindingFixture(t),question=workspaceQuestions();
  const rule=host=>{host.bindApplication(workspaceRuntime());const tool=host.tools.find(t=>t.descriptor.name==='workspace.list_entries');
    const scope=workspaceOperation(tool,{path:'.'});host.prepareExport({...scope,phase:'preflight'});
    return question.entries.get(JSON.stringify([scope.taskId,scope.runId])).requirements.find(r=>r.requirementId==='workspace-session').ruleBindingDigest;};
  let host=open({question,findExecutable:()=>undefined});const first=rule(host);host.close();
  host=open({question,findExecutable:()=>undefined});assert.equal(rule(host),first);assert.equal(host.snapshot().cloudExportAllowed,false);
  host.revoke();assert.notEqual(rule(host),first);
});

test('Synthetic question commands require the injected native factory and pin Node resolution flags outside model arguments',async t=>{
  const {root,configuration,open}=await workspaceBindingFixture(t);await writeFile(path.join(root,'fixture.js'),'1;');
  const saved=JSON.parse(await readFile(configuration,'utf8'));saved.encryptedCheckFile=Buffer.from('fixture.js').toString('base64');
  await writeFile(configuration,JSON.stringify(saved));const question=workspaceQuestions(),constructed=[];let executions=0;
  const factory=options=>{constructed.push(options);const tool=createWorkspaceCommandTool(options);return {...tool,
    execute:async input=>{executions++;return {recipeId:input.recipeId,exitCode:0,stdout:'Synthetic private path/diagnostic',stderr:''};}};};
  const host=open({question,findExecutable:()=>undefined,createWorkspaceCommandTool:factory,createCommandRecipeTool:createWorkspaceCommandRecipeTool});
  host.bindApplication(workspaceRuntime());const tool=host.tools.find(item=>item.descriptor.name==='workspace.node_check'),scope=workspaceOperation(tool,{});
  assert.deepEqual(constructed[0].recipes[0].args,['--preserve-symlinks','--preserve-symlinks-main','--check','fixture.js']);
  host.prepareExport({...scope,phase:'preflight'});await assert.rejects(tool.execute({},scope));assert.equal(executions,0);
  question.allow(scope);const result=await tool.execute({},scope),policy=host.competitionToolExports.find(item=>item.toolName===tool.descriptor.name);
  assert.equal(executions,1);assert.deepEqual(policy.project({...scope,result}),{recipeId:'node-check',exitCode:0,passed:true});
  const unavailable=open({question,findExecutable:()=>undefined,createCommandRecipeTool:createWorkspaceCommandRecipeTool});
  unavailable.bindApplication(workspaceRuntime());assert.equal(unavailable.tools.some(t=>t.descriptor.name==='workspace.node_check'),false);
  question.rotateResourceGeneration=()=>{throw Error('Synthetic CAS unavailable');};
  assert.throws(()=>host.revoke(),/Synthetic CAS unavailable/);
  assert.equal(host.competitionToolAvailability.find(item=>item.toolName===tool.descriptor.name).available(scope),false);
  await assert.rejects(tool.execute({},scope));assert.equal(executions,1,'failed persistent revoke still closes every local execution fence');
});

test('Synthetic F15 helper predeclares metadata and summary on the original run and returns only its registered projections',async t=>{
  const {root,node,configuration,open}=await workspaceBindingFixture(t),question=workspaceQuestions();
  // Pre-create only this fixture recovery directory. The fake executable has
  // the wrong PowerShell basename, so apply-host assembly rejects before ACL
  // probing; no PowerShell, command, repair session or model is executed.
  await mkdir(path.join(path.dirname(configuration),'coding-recovery',createHash('sha256').update(root).digest('hex')),{recursive:true});
  const host=open({question,findExecutable:name=>name==='pwsh.exe'?node:undefined});
  const application=workspaceRuntime();let callbacks,invocation;
  application.configureCodingRepairSourceExport=(projectSource,authorizeMetadata)=>{callbacks={projectSource,authorizeMetadata};};
  application.readAuthorizationQuestionInvocation=()=>invocation;host.bindApplication(application);
  const tool=host.tools.find(item=>item.descriptor.name==='coding.repair.start'),scope=workspaceOperation(tool,{mode:'isolated'});
  invocation=scope.proposal;application.runtime.saveCheckpoint(scope.taskId,'coding-repair:graph',{initialRunId:scope.runId});
  application.runtime.saveCheckpoint(scope.taskId,'application-profile','huawei_ict_agentarts');
  application.runtime.saveCheckpoint(scope.taskId,'application-deadline',scope.deadline);host.prepareAuthorization(scope);
  const ids=question.entries.get(JSON.stringify([scope.taskId,scope.runId])).requirements.map(item=>item.requirementId);
  assert.ok(ids.includes('workspace-metadata-export'));assert.ok(ids.includes('workspace-workflow-summary-export'));
  const initial={version:1,session:{version:1,sessionId:'Synthetic-session',taskId:scope.taskId,workspaceId:'Synthetic-workspace',mode:'isolated',baselineSnapshotId:'snapshot-0'},
    initialSnapshot:{snapshotId:'snapshot-0',files:[{path:'fixture.js',sha256:'a'.repeat(64),packageId:'root',kind:'source',content:'Synthetic body stays local'}],
      packages:[{id:'root',path:'',dependencies:[]}]},recipes:[{recipeId:'node-check',packageIds:['root'],required:true}]};
  const request={taskId:scope.taskId,authorization:{taskId:scope.taskId,runId:scope.runId},deadline:scope.deadline,signal:scope.signal,
    stage:'initial',value:{goal:'Synthetic fixed goal',codingRepair:initial}};
  assert.throws(()=>callbacks.authorizeMetadata(request));question.allow(scope);
  const projected=callbacks.authorizeMetadata(request);assert.equal(projected.codingRepair.initialSnapshot.files[0].content,undefined);
  assert.equal(projected.goal,'Synthetic fixed goal');assert.equal(initial.initialSnapshot.files[0].content,'Synthetic body stays local');
  const summary={workflowId:'F15',state:'settled',mode:'isolated',confirmedOperations:3};
  assert.deepEqual(callbacks.authorizeMetadata({...request,stage:'completion',value:summary}),summary);
  assert.throws(()=>callbacks.authorizeMetadata({...request,stage:'completion',value:{...summary,raw:'Synthetic private'}}));
  assert.throws(()=>callbacks.authorizeMetadata({...request,authorization:{...request.authorization,runId:'forged'}}));
  host.revoke();assert.throws(()=>callbacks.authorizeMetadata(request));
});

test('Synthetic original F15 decision exports only its bound selectedId after the same question and rejects replacement',async t=>{
  const {open}=await workspaceBindingFixture(t),question=workspaceQuestions(),host=open({question,findExecutable:()=>undefined});
  const application=workspaceRuntime();let callbacks,invocation;
  application.configureCodingRepairSourceExport=(projectSource,authorizeMetadata)=>{callbacks={projectSource,authorizeMetadata};};
  application.readAuthorizationQuestionInvocation=()=>invocation;host.bindApplication(application);
  const taskId=randomUUID(),owner=randomUUID(),runId='host-tool-'+taskId,operationId='Synthetic-original-decision';
  const args={context:'Synthetic original F15 context',requestId:'Synthetic-original-request',candidates:[
    {id:'bound-coding-operation',description:'Synthetic bounded operation'},{id:'owned-review',description:'Synthetic review'}]};
  const scope={taskId,runId,deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal};
  invocation={toolName:'decision.choose_candidate',toolVersion:'1.0.0',arguments:args};
  const original={commandId:operationId,...invocation,deadline:scope.deadline};
  application.runtime.saveCheckpoint(owner,'coding-repair:graph',{version:1,sessionId:'Synthetic-session',
    input:{codingRepair:{session:{taskId:owner,sessionId:'Synthetic-session'}}}});
  application.runtime.saveCheckpoint(taskId,'coding-repair:parent',{taskId:owner,operationId});
  application.runtime.saveCheckpoint(owner,'coding-repair:host:'+operationId,{localTaskId:taskId,request:original});
  application.runtime.saveCheckpoint(owner,'application-profile','huawei_ict_agentarts');
  application.runtime.saveCheckpoint(owner,'application-deadline',scope.deadline);
  host.prepareAuthorization(workspaceOperation(host.tools.find(tool=>tool.descriptor.name==='workspace.list_entries'),{path:'.'},owner));
  host.prepareAuthorization(scope);
  const requirements=question.entries.get(JSON.stringify([taskId,runId])).requirements;
  assert.ok(requirements.some(item=>item.requirementId==='workspace-metadata-export'&&item.kind==='export'));
  const request={taskId:owner,authorization:{taskId,runId},deadline:scope.deadline,signal:scope.signal,
    stage:'receipt',value:{selectedId:'owned-review'}};
  assert.throws(()=>callbacks.authorizeMetadata(request),'preparation alone grants no export');question.allow(scope);
  assert.deepEqual(callbacks.authorizeMetadata(request),{selectedId:'owned-review'});
  assert.throws(()=>callbacks.authorizeMetadata({...request,value:{selectedId:'invented'}}));
  assert.throws(()=>callbacks.authorizeMetadata({...request,value:{selectedId:'owned-review',reason:'Synthetic typed detail'}}));
  assert.throws(()=>callbacks.authorizeMetadata({...request,stage:'initial'}));
  invocation={...invocation,arguments:{...args,context:'Synthetic replacement'}};
  assert.throws(()=>callbacks.authorizeMetadata(request),'changed original arguments cannot consume an old export');
});

async function defaultCodingStartQuestionFixture(t,invalidatePreparation=false) {
  const {Client}=await import('@personal-agent/client');
  const {root,node,configuration,open}=await workspaceBindingFixture(t);let application,failure;
  await mkdir(path.join(path.dirname(configuration),'coding-recovery',createHash('sha256').update(root).digest('hex')),{recursive:true});
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>application,
    namespace:'Synthetic-default-coding-start',resolveConversation:taskId=>application.readToolConversation(taskId),available:()=>true,
    profiles:[{ref:'default-read-only',label:'Synthetic read-only',mode:'read-only',revision:1,available:true},
      {ref:'workspace-write',label:'Synthetic workspace write',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'default-read-only',
    resolveProfile:(request,selected)=>request.requirements.some(item=>item.scopes.some(scope=>scope.endsWith(':write')))?'workspace-write':selected.ref,
    describeExecution:()=>({required:false,available:false,backend:'unavailable',enforced:false})});
  let resource;
  const host=open({question:{...question,readResourceGeneration(value){resource=value;return question.readResourceGeneration(value);}},
    findExecutable:name=>name==='pwsh.exe'?node:undefined});
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>application.runtime,getTools:()=>application.tools,
    runDefaultWorker:(subtask,worker,tools)=>application.runDefaultSubagentWorker(subtask,worker,tools)});
  const proposal={kind:'tool_proposal',proposalId:'Synthetic-original-f15',toolName:'coding.repair.workflow',toolVersion:'1.0.0',
    arguments:{subtasks:[{subtaskId:'repair',role:'coder',goal:'Synthetic bounded repair'}],codingRepair:{mode:'main',allowedPaths:['fixture.js']}},verification:'unverified'};
  application=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'Synthetic-default-coding-start',
    tools:[dispatch,...host.tools],coordinationBinding:'Synthetic-fixed-deployment',coordination:{execute:async request=>request.continuation
      ?{kind:'text',text:'Synthetic parent summary of the original child outcome',verification:'unverified'}:structuredClone(proposal)},
    automaticTools:[{toolName:'subagent.dispatch',toolVersion:'1.0.0'}],
    readConversationPreference:()=>({depth:1,fast:false}),
    codingRepair:{image:{bindingId:'Synthetic-image',receiptSecret:async()=> 'Synthetic-only-private-receipt-secret-32-chars',advance:async()=>assert.fail('No image advance before approval')}},
    prepareCompetitionToolExport:scope=>host.prepareExport(scope),
    competitionToolAvailability:[{toolName:'subagent.dispatch',toolVersion:'1.0.0',available:()=>true,publicEnumPaths:['/subtasks/*/role']},...host.competitionToolAvailability],
    competitionToolExports:[{toolName:'subagent.dispatch',toolVersion:'1.0.0',exportPolicyVersion:'Synthetic-dispatch-v1',accepts:()=>true,project:({result})=>result},...host.competitionToolExports],
    requiresToolAuthorization:scope=>scope.toolName==='coding.repair.start',
    requestToolAuthorization:async scope=>{
      host.prepareAuthorization(scope);
      if(invalidatePreparation&&scope.toolName==='coding.repair.start')question.rotateResourceGeneration(resource,question.readResourceGeneration(resource));
      try{return await question.requestToolAuthorization(scope);}catch(error){failure={code:error.code,message:error.message};throw error;}
    }});
  t.after(()=>{question.close();application.close();});host.bindApplication(application);
  const client=new Client(application);await client.connect();
  const parent=await client.call('task.submit',{goal:'Synthetic bounded coding repair',conversationId:'Synthetic-coding-conversation'},
    {idempotencyKey:'Synthetic-default-coding-start',timeoutMs:60_000});
  let card;
  for(let attempt=0;attempt<100;attempt++){
    card=question.snapshot().find(item=>item.toolName==='coding.repair.start'&&item.state==='pending');
    if(card||failure)break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  const [child]=application.readSubagentTasks(parent.taskId);
  if(!invalidatePreparation){
    assert.ok(card,'original card should be available: '+JSON.stringify({failure,tasks:application.runtime.listTasks({limit:10}).items}));
    assert.equal(card.taskId,child.taskId);assert.equal(card.conversationId,'Synthetic-coding-conversation');
    assert.equal(card.sourceApprovalId,'coding-start-'+child.taskId);
    assert.deepEqual(card.requirements.map(item=>item.kind),['tool','connector_session','export','export']);
    assert.equal(application.runtime.readToolExecutions(child.taskId).length,0,'no coding execution precedes the original card');
    question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'deny'},card.conversationId);
  }else assert.equal(card,undefined,'the invalidated workspace must never publish an actionable card');
  for(let attempt=0;attempt<100&&application.activeTaskCount;attempt++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(application.activeTaskCount,0);
  const runId='coding-start-'+child.taskId;
  assert.equal(application.runtime.getApproval(runId).state,'denied');
  if(invalidatePreparation){
    assert.equal(application.runtime.getTask(child.taskId).state,'failed');
    const initial=application.runtime.loadCheckpoint(child.taskId,'coding-repair:start-failure:v1:'+runId);
    const workspace=application.runtime.loadCheckpoint(child.taskId,'coding-repair:authorization-diagnostic:v1:'+runId);
    assert.equal(initial.reason,'question_current_changed');assert.equal(initial.code,'UNAUTHORIZED');
    assert.equal(workspace.reason,'resource_generation_changed');assert.equal(workspace.resourceDigest,resource);
    for(const diagnostic of [initial,workspace]){
      assert.equal(diagnostic.authority,'diagnostic_no_tool_grant');assert.equal(diagnostic.taskId,child.taskId);
      assert.equal(diagnostic.runId,runId);assert.equal(diagnostic.toolName,'coding.repair.start');
      assert.equal(diagnostic.argumentsDigest,application.runtime.getApproval(runId).argumentsDigest);
      assert.equal(diagnostic.deadline,application.runtime.loadCheckpoint(child.taskId,'application-deadline'));
    }
    assert.equal(application.runtime.readToolExecutions(child.taskId).some(record=>record.executionStarted),false);
    assert.deepEqual(question.snapshot(),[]);assert.equal(application.runtime.policy.get(runId),undefined);
  }
}

test('default delegated F15 start publishes the original unified question before any workspace execution',async t=>defaultCodingStartQuestionFixture(t));
test('default F15 invalidation retains fixed original and workspace reasons without granting or executing',async t=>defaultCodingStartQuestionFixture(t,true));

test('one original F15 uses three workflow groups while every host run retains its exact independent grant',async t=>{
  const {toolArgumentsDigest}=await import('@personal-agent/tool-gateway');
  const {createWorkflowDecisionTool}=await import('@personal-agent/agentarts');
  const {root,node,configuration,open}=await workspaceBindingFixture(t);let application,nativeReady=false;
  await mkdir(path.join(path.dirname(configuration),'coding-recovery',createHash('sha256').update(root).digest('hex')),{recursive:true});
  // Synthetic native identity only: no command, helper, model or file mutation
  // runs in this grouping test. The real question host, Runtime and Policy run.
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>application,
    namespace:'Synthetic-F15-groups',resolveConversation:taskId=>application.readToolConversation(taskId),available:()=>true,
    profiles:[{ref:'read',label:'Synthetic read',mode:'read-only',revision:1,available:true},
      {ref:'write',label:'Synthetic write',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'read',
    resolveProfile:(request,selected)=>request.taskConsent?.mode==='workspace-write'?'write':selected.ref,
    describeExecution:request=>({required:request?.taskConsent?.requiresNative===true,available:nativeReady,
      backend:nativeReady?'windows-psec':'unavailable',enforced:nativeReady,...(nativeReady?{bindingDigest:'a'.repeat(64)}:{})})});
  const host=open({question,findExecutable:name=>name==='pwsh.exe'?node:undefined});
  const decision=createWorkflowDecisionTool({selector:{select:async()=>assert.fail('No Synthetic inference')}});
  application=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:'Synthetic-F15-groups',tools:[...host.tools,decision]});
  t.after(()=>{question.close();application.close();});host.bindApplication(application);
  const runtime=application.runtime,owner=runtime.submitTask({goal:'Synthetic bounded workflow',conversationId:'Synthetic-F15-chat',idempotencyKey:'owner'});
  runtime.transitionTask(owner.taskId,'planning');runtime.transitionTask(owner.taskId,'running');
  const deadline=new Date(Date.now()+60_000).toISOString(),initialRunId='coding-start-'+owner.taskId;
  const request={version:1,mode:'main',allowedPaths:['fixture.js'],subtasks:[{subtaskId:'repair',role:'coder',goal:'Synthetic bounded repair'}]};
  const proposal={kind:'tool_proposal',proposalId:'Synthetic-F15',toolName:'coding.repair.workflow',toolVersion:'1.0.0',
    arguments:{subtasks:request.subtasks,codingRepair:{mode:'main',allowedPaths:request.allowedPaths}}};
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  runtime.saveCheckpoint(owner.taskId,'application-deadline',deadline);
  runtime.saveCheckpoint(owner.taskId,'competition-loop',{step:1,pendingRevision:3,pending:proposal});
  runtime.saveCheckpoint(owner.taskId,'coding-repair:worker-capability',{version:1,taskId:owner.taskId,deadline,revision:3,
    bindingId:'Synthetic-image',proposalDigest:hash(proposal),request});
  const graph={version:1,initialRunId,bindingId:'Synthetic-image',controlRevision:0,sessionId:'Synthetic-session'};
  runtime.saveCheckpoint(owner.taskId,'coding-repair:graph',graph);
  const grants=[],cards=[];let sequence=0;
  const run=async(name,args,{corruptLink=false,rejectPrepare=false}={})=>{
    const tool=[...host.tools,decision].find(item=>item.descriptor.name===name);assert.ok(tool,name);
    let taskId=owner.taskId,runId=initialRunId;
    if(name!=='coding.repair.start'){
      const commandId='Synthetic-operation-'+(++sequence),original={commandId,toolName:name,toolVersion:tool.descriptor.version,arguments:args,deadline};
      const prepared=application.prepareHostToolTask({commandId,toolName:name,toolVersion:tool.descriptor.version,deadline});
      taskId=prepared.taskId;runId='host-tool-'+taskId;
      runtime.saveCheckpoint(taskId,'host-tool-intent',{...original,namespace:'Synthetic-F15-groups',argumentsDigest:toolArgumentsDigest(args)});
      runtime.saveCheckpoint(taskId,'coding-repair:parent',{taskId:owner.taskId,operationId:commandId});
      runtime.saveCheckpoint(owner.taskId,'coding-repair:host:'+commandId,{localTaskId:corruptLink?'Synthetic-foreign':taskId,request:original});
      runtime.transitionTask(taskId,'planning');runtime.transitionTask(taskId,'running');
    }
    const argumentsDigest=toolArgumentsDigest(args),scope={taskId,runId,deadline,toolName:name,toolVersion:tool.descriptor.version,
      argumentsDigest,signal:new AbortController().signal};
    runtime.saveCheckpoint(taskId,'application-tool-invocation:'+runId,{toolName:name,toolVersion:tool.descriptor.version,arguments:args,argumentsDigest,deadline});
    runtime.requestToolApproval(runId,taskId,tool.descriptor,deadline,argumentsDigest);
    if(corruptLink||rejectPrepare){assert.throws(()=>host.prepareAuthorization(scope),{code:'UNAUTHORIZED'});return;}
    host.prepareAuthorization(scope);if(question.requiresNativeForAuthorization(scope))nativeReady=true;
    const pending=question.requestToolAuthorization(scope);
    const card=question.snapshot().find(item=>item.sourceApprovalId===runId&&item.state==='pending');
    if(card){cards.push(card);assert.equal(card.canReuseTask,true);assert.equal(card.suggestedDecision,'allow_task');
      question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_task'},card.conversationId);}
    assert.equal(await pending,'allow_once','the adapter still requests one exact Policy grant per original run');
    runtime.respondApproval(runId,'allow_once',runtime.getApproval(runId).revision);runtime.transitionTask(taskId,'running');
    assert.throws(()=>runtime.policy.authorize({authorizationRef:runId,taskId,toolName:name,argumentsDigest:'f'.repeat(64),
      requiredScopes:tool.descriptor.requiredScopes,now:Date.now()}),'task consent never permits swapped arguments');
    runtime.policy.authorize({authorizationRef:runId,taskId,toolName:name,argumentsDigest,requiredScopes:tool.descriptor.requiredScopes,now:Date.now()});
    assert.equal(runtime.policy.get(runId).usesRemaining,0);question.currentRequirement(scope,'workspace-session');grants.push(runId);
    return scope;
  };
  await run('coding.repair.start',{mode:'main',allowedPaths:['fixture.js']});
  graph.input={goal:request.subtasks[0].goal,codingRepair:{session:{taskId:owner.taskId,sessionId:graph.sessionId,mode:'main'}}};
  runtime.saveCheckpoint(owner.taskId,'coding-repair:graph',graph);
  await run('decision.choose_candidate',{context:'Synthetic local review',requestId:'Synthetic-request',
    candidates:[{id:'read',description:'Read bounded source'},{id:'owned-review',description:'Review'}]});
  const sourceScope=await run('coding.repair.read',{sessionId:graph.sessionId,path:'fixture.js'});
  await run('workflow.host.f15_n04',{sessionId:graph.sessionId,patches:[]});
  await run('workflow.host.f15_n05',{sessionId:graph.sessionId,patches:[],recipeIds:[]});
  question.currentRequirement(sourceScope,'workspace-session');
  await run('coding.repair.read',{sessionId:graph.sessionId,path:'fixture.js'});
  await run('workflow.host.f15_n06',{version:1,sessionId:graph.sessionId,baselineSnapshotId:'before',snapshotId:'after',
    paths:['fixture.js'],verificationRunIds:['Synthetic-verification']});
  assert.equal(cards.length,3,'source/init, isolated editing/checking and CAS each require one core decision');
  assert.deepEqual(cards.map(card=>card.sandbox.native.required),[false,true,false]);
  assert.equal(grants.length,7);assert.equal(new Set(grants).size,7);
  assert.ok(cards.every(card=>card.description.length<=512));
  await run('coding.repair.read',{sessionId:graph.sessionId,path:'fixture.js'},{corruptLink:true});
  assert.equal(cards.length,3,'a foreign reciprocal link is refused, never covered by old consent');
  await run('coding.repair.read',{sessionId:graph.sessionId,path:'other.js'},{rejectPrepare:true});
  const originalBinding=runtime.loadCheckpoint(owner.taskId,'coding-repair:worker-capability');
  runtime.saveCheckpoint(owner.taskId,'coding-repair:worker-capability',{...originalBinding,
    request:{...originalBinding.request,allowedPaths:['other.js']}});
  await run('coding.repair.read',{sessionId:graph.sessionId,path:'fixture.js'},{rejectPrepare:true});
  runtime.saveCheckpoint(owner.taskId,'coding-repair:worker-capability',originalBinding);
  runtime.saveCheckpoint(owner.taskId,'coding-repair:graph',{...graph,controlRevision:1});
  assert.throws(()=>question.currentRequirement(sourceScope,'workspace-session'),{code:'UNAUTHORIZED'},
    'a changed original graph invalidates a previously prepared and consumed workspace requirement');
  assert.equal(cards.length,3,'source-range or graph changes never gain authority from the original three decisions');
});

test('original nested F15 start can publish its unified question while the outer proposal remains pending',async t=>{
  const {root,node,configuration,open}=await workspaceBindingFixture(t);let application;
  await mkdir(path.join(path.dirname(configuration),'coding-recovery',createHash('sha256').update(root).digest('hex')),{recursive:true});
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>application,
    namespace:'Synthetic-coding-start',resolveConversation:()=> 'Synthetic-coding-conversation',available:()=>true,
    profiles:[{ref:'default-read-only',label:'Synthetic read-only',mode:'read-only',revision:1,available:true},
      {ref:'workspace-write',label:'Synthetic workspace write',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'default-read-only',
    resolveProfile:(request,selected)=>request.requirements.some(item=>item.scopes.some(scope=>scope.endsWith(':write')))?'workspace-write':selected.ref,
    describeExecution:()=>({required:false,available:false,backend:'unavailable',enforced:false})});
  const host=open({question,findExecutable:name=>name==='pwsh.exe'?node:undefined});
  application=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools:host.tools});
  t.after(()=>{question.close();application.close();});host.bindApplication(application);
  const task=application.runtime.submitTask({goal:'Synthetic original coding worker',conversationId:'Synthetic-coding-conversation',idempotencyKey:'start'});
  application.runtime.transitionTask(task.taskId,'planning');application.runtime.transitionTask(task.taskId,'running');
  const deadline=new Date(Date.now()+60_000).toISOString(),runId='coding-start-'+task.taskId;
  application.runtime.saveCheckpoint(task.taskId,'application-profile','huawei_ict_agentarts');
  application.runtime.saveCheckpoint(task.taskId,'application-deadline',deadline);
  application.runtime.saveCheckpoint(task.taskId,'coding-repair:graph',{version:1,initialRunId:runId});
  application.runtime.saveCheckpoint(task.taskId,'competition-loop',{step:1,pendingRevision:5,pending:{kind:'tool_proposal',
    proposalId:'Synthetic-original-f15',toolName:'coding.repair.workflow',toolVersion:'1.0.0',
    arguments:{subtasks:[{subtaskId:'repair',role:'coder',goal:'Synthetic goal'}],codingRepair:{mode:'main',allowedPaths:['fixture.js']}}}});
  const args={mode:'main',allowedPaths:['fixture.js']},tool=host.tools.find(item=>item.descriptor.name==='coding.repair.start');
  const {toolArgumentsDigest}=await import('@personal-agent/tool-gateway');
  const argumentsDigest=toolArgumentsDigest(args);
  application.runtime.saveCheckpoint(task.taskId,'application-tool-invocation:'+runId,{toolName:tool.descriptor.name,
    toolVersion:tool.descriptor.version,arguments:args,argumentsDigest,deadline});
  application.runtime.requestToolApproval(runId,task.taskId,tool.descriptor,deadline,argumentsDigest);
  const scope={taskId:task.taskId,runId,toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
    argumentsDigest,deadline,signal:new AbortController().signal};
  host.prepareAuthorization(scope);
  let failure;
  const pending=question.requestToolAuthorization(scope).catch(error=>{failure=error;});
  const card=question.snapshot().find(item=>item.sourceApprovalId===runId);
  assert.ok(card,'original card should be available: '+failure?.message);
  assert.deepEqual(card.requirements.map(item=>item.kind),['tool','connector_session','export','export']);
  assert.equal(application.runtime.getApproval(runId).state,'pending');
  question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'deny'},card.conversationId);
  assert.equal(await pending,'deny');
});

test('original Runtime decision, unified question and consumed selectedId lease retain exact host identity with explicit Fake inference',async t=>{
  const {open}=await workspaceBindingFixture(t);let application,callbacks;
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>application,
    namespace:'Synthetic-coding-decision',resolveConversation:()=> 'Synthetic-coding-conversation',available:()=>true,
    profiles:[{ref:'Synthetic',label:'Synthetic application policy; no native process',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'Synthetic'});
  const host=open({question,findExecutable:()=>undefined});
  const chooser=new LayaActionChoiceService({infer:async payload=>{
    const ids=Object.keys(payload.questions.action.criteria);
    return {answers:{action:{choice:ids[0],probabilities:{[ids[0]]:0.9,[ids[1]]:0.1},answer_confidence:0.9,confidence:0.53}}};
  }});
  application=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:'Synthetic-coding-decision',tools:host.tools,
    codingRepair:{image:{bindingId:'Synthetic-unused-image',advance:async()=>assert.fail('no image call'),receiptSecret:async()=>assert.fail('no image call')}},
    proactiveDecision:{localChooser:chooser},requiresToolAuthorization:()=>true,
    requestToolAuthorization:scope=>{host.prepareAuthorization(scope);return question.requestToolAuthorization(scope);}});
  t.after(()=>{question.close();application.close();});
  const configure=application.configureCodingRepairSourceExport.bind(application);
  application.configureCodingRepairSourceExport=(projectSource,authorizeMetadata)=>{callbacks={projectSource,authorizeMetadata};configure(projectSource,authorizeMetadata);};
  host.bindApplication(application);
  const owner=application.runtime.submitTask({goal:'Synthetic F15 owner',conversationId:'Synthetic-coding-conversation',idempotencyKey:'owner'});
  application.runtime.transitionTask(owner.taskId,'planning');application.runtime.transitionTask(owner.taskId,'running');
  const deadline=new Date(Date.now()+60_000).toISOString();
  application.runtime.saveCheckpoint(owner.taskId,'application-profile','huawei_ict_agentarts');
  application.runtime.saveCheckpoint(owner.taskId,'application-deadline',deadline);
  application.runtime.saveCheckpoint(owner.taskId,'desktop-coding-scope',host.readWorkspaceBinding().bindingId);
  application.runtime.saveCheckpoint(owner.taskId,'coding-repair:graph',{version:1,sessionId:'Synthetic-session',
    input:{codingRepair:{session:{taskId:owner.taskId,sessionId:'Synthetic-session'}}}});
  const args={context:'Synthetic exact current F15 decision',requestId:'Synthetic-request',candidates:[
    {id:'bound-coding-operation',description:'Synthetic bounded current operation'},{id:'owned-review',description:'Synthetic review'}]};
  const request={commandId:'Synthetic-original-decision',toolName:'decision.choose_candidate',toolVersion:'1.0.0',arguments:args,deadline};
  const prepared=application.prepareHostToolTask({commandId:request.commandId,toolName:request.toolName,toolVersion:request.toolVersion,deadline});
  application.runtime.saveCheckpoint(prepared.taskId,'coding-repair:parent',{taskId:owner.taskId,operationId:request.commandId});
  application.runtime.saveCheckpoint(owner.taskId,'coding-repair:host:'+request.commandId,{localTaskId:prepared.taskId,request});
  application.finalizeHostToolTask({taskId:prepared.taskId,commandId:request.commandId,arguments:args,expectedTaskRevision:prepared.revision});
  let card;
  for(let attempt=0;attempt<200&&!card;attempt++) {
    card=question.snapshot().find(item=>item.state==='pending');
    if(!card)await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.ok(card,JSON.stringify(application.runtime.getTask(prepared.taskId).error));
  assert.equal(card.taskId,prepared.taskId);assert.equal(card.sourceApprovalId,'host-tool-'+prepared.taskId);
  assert.deepEqual(card.requirements.map(item=>item.kind),['tool','connector_session','export']);
  assert.equal(application.readHostToolTask(prepared.taskId).confirmed,undefined);
  question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'},card.conversationId);
  await application.waitForHostToolTask(prepared.taskId);
  const read=application.readHostToolTask(prepared.taskId);assert.equal(read.task.state,'succeeded',JSON.stringify(read.task.error));
  assert.deepEqual(read.confirmed.result,{selectedId:'bound-coding-operation'});
  const scope={taskId:owner.taskId,stage:'receipt',value:read.confirmed.result,
    authorization:{taskId:prepared.taskId,runId:card.sourceApprovalId},deadline,signal:new AbortController().signal};
  assert.deepEqual(callbacks.authorizeMetadata(scope),read.confirmed.result);
  const lease=application.runtime.loadCheckpoint(prepared.taskId,'authorization-question-export:'+card.sourceApprovalId+':workspace-metadata-export');
  assert.equal(lease.questionId,card.questionId);assert.equal(lease.resultDigest,createHash('sha256').update(JSON.stringify(read.confirmed.result)).digest('hex'));
  assert.ok(lease.leaseRef);assert.equal(application.runtime.policy.get(card.sourceApprovalId).usesRemaining,0);
  assert.throws(()=>callbacks.authorizeMetadata({...scope,value:{...scope.value,scores:[0.9,0.1]}}));
  assert.equal(application.runtime.readToolExecutions(prepared.taskId).length,1,'export never executes the decision again');
});

async function workspaceBindingFixture(t) {
  const cache=path.resolve(fileURLToPath(new URL('../../../.cache/',import.meta.url)));
  await mkdir(cache,{recursive:true});
  const base=await mkdtemp(path.join(cache,'p6-workspace-binding-'));
  const root=path.join(base,'workspace'),otherRoot=path.join(base,'other-workspace');
  const userData=path.join(base,'user-data'),nodeDir=path.join(base,'node-a'),otherNodeDir=path.join(base,'node-b');
  await Promise.all([root,otherRoot,userData,nodeDir,otherNodeDir].map(dir=>mkdir(dir)));
  const nodeName=process.platform==='win32'?'node.exe':'node';
  const node=path.join(nodeDir,nodeName),otherNode=path.join(otherNodeDir,nodeName);
  // Metadata fixtures only: neither selected executable is ever launched.
  await writeFile(node,'synthetic node A');await writeFile(otherNode,'synthetic node B');
  const configuration=path.join(userData,'coding-workspace.json');
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  await writeFile(configuration,JSON.stringify({version:1,encrypted:Buffer.from(root).toString('base64'),
    encryptedNode:Buffer.from(node).toString('base64')}));
  const hosts=[];
  const open=(options={})=> {
    const host=createWorkspaceConfigHost({userData,safeStorage,
      selectDirectory:async()=>otherRoot,selectNodeExecutable:async()=>otherNode,...options});
    hosts.push(host);return host;
  };
  t.after(async()=> {
    for(const host of hosts) host.close();
    assert.equal(path.dirname(base),cache); // Only this newly created cache fixture is removed.
    assert.ok(path.basename(base).startsWith('p6-workspace-binding-'));
    await rm(base,{recursive:true,force:true});
  });
  return {root,node,configuration,open};
}
const allowWorkspaceRead=host=>host.authorize({cloudExportAllowed:true,writeAllowed:false,commandAllowed:false});

test('developer configuration is Main-only, preserves the original task lease and never grants metadata export',async t=>{
  const {root,open}=await workspaceBindingFixture(t),host=open(),checkpoints=new Map();
  let canonical='synthetic-user';
  host.bindApplication({readToolConversation:()=>canonical,runtime:{loadCheckpoint:(task,key)=>checkpoints.get(task+key),saveCheckpoint:(task,key,value)=>checkpoints.set(task+key,value)}});
  const configuration=host.readDeveloperConfiguration(),scope={taskId:'developer-task',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
  assert.equal(configuration.rootPath,root);assert.equal(configuration.metadataExportAllowed,false);assert.equal(configuration.available(scope),false);
  await allowWorkspaceRead(host);assert.equal(configuration.available(scope),true);canonical=undefined;assert.equal(configuration.available(scope),false);
  canonical='synthetic-user';host.revoke();assert.equal(configuration.available(scope),false);
  assert.throws(()=>configuration.assertCurrent(scope),{code:'UNAUTHORIZED'});
  assert.equal(Object.hasOwn(host.snapshot(),'rootPath'),false);
});

test('harness workspace consumer preserves consent and actual scope with a stable deferred repair proxy',async t=>{
  const {root,node,configuration,open}=await workspaceBindingFixture(t);
  await writeFile(path.join(root,'fixture.js'),'export const fixture = 1;\n');
  const record=JSON.parse(await readFile(configuration,'utf8'));
  record.encryptedCheckFile=Buffer.from('fixture.js').toString('base64');await writeFile(configuration,JSON.stringify(record));
  // Version and Runtime checkpoint ports are explicit metadata fixtures; no command/helper is invoked.
  let versions={workflowVersion:'F15-fixture-v1',runtimeVersion:'runtime-fixture-v1',executionKind:'real_host'},onVersionsRead;
  // Explicit discovery fixture; host.start copies real files but never launches this executable.
  const host=open({findExecutable:name=>name==='pwsh.exe'?node:undefined,
    createCommandRecipeTool:createWorkspaceCommandRecipeTool,readHarnessVersions:()=>{onVersionsRead?.();return versions;}});
  const checkpoints=new Map(),permittedHarnessSessions=new Set();
  host.bindApplication({readToolConversation:()=> 'fixture-conversation',runtime:{
    loadCheckpoint:(task,key)=>checkpoints.get(task+key),saveCheckpoint:(task,key,value)=>checkpoints.set(task+key,value)},
    // Explicit Fake Runtime canonical reader; it never trusts a model backend/directory argument.
    isHarnessCodingRepairSession:(ctx,{sessionId,operation})=>ctx.taskId===context.taskId
      &&['publish','snapshot','readback','reconcile'].includes(operation)&&permittedHarnessSessions.has(sessionId)});
  const context={taskId:'owner-task',runId:'fixture-run',authorizationRef:'fixture-run',scopes:['workspace:read','workspace:write','workspace:apply','workspace:execute'],
    deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
  const configurationBinding=host.readDeveloperConfiguration();
  const scope={ownerTaskId:context.taskId,actualTaskId:context.taskId,parentTaskId:'parent-task',scopeRef:context.runId,
    configurationRef:'a'.repeat(64),inputDigest:'b'.repeat(64),deadline:context.deadline,workspaceRef:configurationBinding.bindingId};
  assert.equal(Object.isFrozen(host.harnessRepairHost),true);
  assert.equal(host.harnessRepairHost,host.harnessRepairHost);
  assert.equal(await host.readHarnessCandidateContext(context,scope),undefined);
  await host.authorize({cloudExportAllowed:true,writeAllowed:true,commandAllowed:true});
  assert.equal(configurationBinding.available(context),true);
  const result=await host.readHarnessCandidateContext(context,scope);
  assert.equal(result.binding.taskId,scope.ownerTaskId);assert.equal(result.binding.inputDigest,scope.inputDigest);
  assert.equal(result.binding.configurationDigest,scope.configurationRef);assert.equal(result.binding.runtimeVersion,'runtime-fixture-v1');
  assert.equal(result.binding.workspaceId,createHash('sha256').update(root).digest('hex'));
  assert.notEqual(result.binding.workspaceId,scope.workspaceRef,'workspace identity differs from the configuration grant');
  assert.deepEqual(result.recipes,[{recipeId:'node-check',packageIds:['root'],required:true}]);
  assert.equal(result.baseline.files.some(file=>'content' in file),false);
  assert.equal(Object.hasOwn(result,'rootPath'),false);
  const current=host.readHarnessExperienceCurrentSync();
  assert.deepEqual(current.snapshot,result.baseline);
  assert.equal(current.configuration.workspaceId,result.binding.workspaceId);
  assert.equal(current.configuration.recipeFingerprint,result.binding.recipeFingerprint);
  assert.equal(Object.hasOwn(current,'rootPath'),false);
  // This runtime deliberately has no getTask/taskLive port: a succeeded source owner is not a read fence.
  assert.equal(typeof current.then,'undefined');
  const synchronousVersions=versions;versions=Promise.resolve(synchronousVersions);
  assert.equal(host.readHarnessExperienceCurrentSync(),undefined,'an asynchronous versions port cannot stand in for a current synchronous read');
  versions=synchronousVersions;
  const childContext={...context,taskId:'actual-child',runId:'child-run'};
  checkpoints.set('actual-childcoding-repair:parent',{taskId:context.taskId});
  const childScope={...scope,actualTaskId:childContext.taskId};
  const childBinding=await host.readHarnessCandidateContext(childContext,childScope);
  const started=await host.harnessRepairHost.start({mode:'isolated',allowedPaths:['fixture.js']},childContext);
  assert.equal(started.session.taskId,childContext.taskId,'harness keeps the real executor identity');
  assert.equal(started.session.workspaceId,childBinding.binding.workspaceId);
  assert.equal(started.initialSnapshot.snapshotId,childBinding.baseline.snapshotId);
  assert.deepEqual(started.recipes,childBinding.recipes);
  const originalStart=host.tools.find(tool=>tool.descriptor.name==='coding.repair.start');
  const original=await originalStart.execute({mode:'isolated',allowedPaths:['fixture.js']},childContext);
  assert.equal(original.session.taskId,context.taskId,'existing F15 keeps its owner mapping');
  assert.equal(original.session.workspaceId,createHash('sha256').update(root).digest('hex'));
  assert.equal(original.session.workspaceId,started.session.workspaceId);
  const prepare=await host.harnessRepairHost.start({mode:'main',allowedPaths:['fixture.js']},context);
  const sessionId=prepare.session.sessionId;
  const originalSnapshot=host.tools.find(tool=>tool.descriptor.name==='coding.repair.snapshot');
  await assert.rejects(originalSnapshot.execute({sessionId},context),{code:'ENOENT'},'model sessionId alone does not select the harness backend');
  permittedHarnessSessions.add(sessionId);
  assert.equal((await originalSnapshot.execute({sessionId},context)).snapshotId,prepare.initialSnapshot.snapshotId);
  const originalReadback=host.tools.find(tool=>tool.descriptor.name==='coding.repair.readback');
  const readback=await originalReadback.execute({sessionId},context);
  assert.equal(readback.sessionId,sessionId);
  const readbackExport=host.competitionToolExports.find(item=>item.toolName==='coding.repair.readback');
  assert.equal(readbackExport.exportPolicyVersion,'coding-repair-metadata-v1');
  assert.equal(readbackExport.accepts({taskId:context.taskId}),true);
  assert.deepEqual(readbackExport.project({taskId:context.taskId,result:readback,signal:context.signal}),readback);
  const publishExport=host.competitionToolExports.find(item=>item.toolName==='coding.repair.publish');
  const originalPublished={version:1,sessionId,state:'unknown',files:[],evidenceRefs:[]};
  assert.deepEqual(publishExport.project({taskId:context.taskId,result:originalPublished,signal:context.signal}),originalPublished);
  const originalPublish=host.tools.find(tool=>tool.descriptor.name==='coding.repair.publish');
  await assert.rejects(originalPublish.execute({version:1,sessionId,baselineSnapshotId:prepare.initialSnapshot.snapshotId,
    snapshotId:prepare.initialSnapshot.snapshotId,paths:[],verificationRunIds:[]},context),{code:'REVISION_CONFLICT'},
    'publish reaches the actual main journal then retains the original required verification guard');
  const originalReconcile=host.tools.find(tool=>tool.descriptor.name==='coding.repair.reconcile');
  assert.equal((await originalReconcile.execute({sessionId},context)).state,'clear');
  assert.equal((await originalSnapshot.execute({sessionId:original.session.sessionId},childContext)).snapshotId,original.initialSnapshot.snapshotId,
    'original F15 owner-mapped sessions retain their original backend');
  assert.equal(await host.readHarnessCandidateContext(context,{...scope,actualTaskId:'forged-child'}),undefined);
  assert.equal(await host.readHarnessCandidateContext(context,{...scope,workspaceRef:'wrong-root'}),undefined);
  const retainedVersions=versions;
  versions=undefined;assert.equal(await host.readHarnessCandidateContext(context,scope),undefined);
  versions=retainedVersions;let reads=0;onVersionsRead=()=>{if(++reads===2)host.revoke();};
  assert.equal(await host.readHarnessCandidateContext(context,scope),undefined,'late version reads cannot survive original consent revocation');
  assert.equal(await host.readHarnessCandidateContext(context,scope),undefined);
  assert.equal(host.readHarnessExperienceCurrentSync(),undefined);
  assert.equal(readbackExport.accepts({taskId:context.taskId}),false);
  assert.throws(()=>publishExport.project({taskId:context.taskId,result:originalPublished,signal:context.signal}),{code:'UNAUTHORIZED'});
  await assert.rejects(host.harnessRepairHost.snapshot('unused',context),{code:'UNAUTHORIZED'});
});

test('a workspace without package.json never advertises a required npm-test recipe and keeps F15 honestly unavailable',async t=>{
  for (const withCheckFile of [true,false]) await t.test(withCheckFile
    ?'a selected check file exposes only the node-check recipe'
    :'no exposed recipe leaves F15 unavailable instead of ready',async t=>{
    const {root,node,configuration,open}=await workspaceBindingFixture(t);
    // Metadata fixtures only: the npm CLI and the job helper are never launched.
    const npm=path.join(path.dirname(root),'npm-cli.js'),helper=path.join(path.dirname(root),'WindowsJobProcessHost.exe');
    await Promise.all([writeFile(npm,'// synthetic npm metadata only'),writeFile(helper,'synthetic helper metadata only')]);
    const record=JSON.parse(await readFile(configuration,'utf8'));
    record.encryptedNpmCli=Buffer.from(npm).toString('base64');
    if (withCheckFile) {
      await writeFile(path.join(root,'check.js'),'const synthetic = true;\n');
      record.encryptedCheckFile=Buffer.from('check.js').toString('base64');
    }
    await writeFile(configuration,JSON.stringify(record));
    const question=workspaceQuestions();
    const host=open({question,findExecutable:name=>name==='pwsh.exe'?node:undefined,jobHelperExecutable:helper,
      createCommandRecipeTool:createWorkspaceCommandRecipeTool,createWorkspaceCommandTool:options=>createWorkspaceCommandTool(options),
      readHarnessVersions:()=>({workflowVersion:'F15-fixture-v1',runtimeVersion:'runtime-fixture-v1',executionKind:'real_host'})});
    const checkpoints=new Map();
    host.bindApplication({readToolConversation:()=> 'fixture-conversation',runtime:{
      loadCheckpoint:(task,key)=>checkpoints.get(task+':'+key),saveCheckpoint:(task,key,value)=>checkpoints.set(task+':'+key,value)}});
    const context={taskId:'owner-task',runId:'fixture-run',authorizationRef:'fixture-run',
      scopes:['workspace:read','workspace:write','workspace:apply','workspace:execute'],
      deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
    const tool=host.tools.find(item=>item.descriptor.name==='workspace.read_text');
    const proposalId='synthetic-proposal';
    host.prepareExport({taskId:context.taskId,runId:context.runId,proposalId,deadline:context.deadline,signal:context.signal,
      authorizationRef:context.authorizationRef,scopes:context.scopes,phase:'preflight',
      proposal:{proposalId,toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:{path:'check.js'}}});
    question.allow({taskId:context.taskId,runId:context.runId});
    const binding=host.readDeveloperConfiguration();
    assert.ok(binding,'the developer configuration must stay bound to the selected workspace');
    const scope={ownerTaskId:context.taskId,actualTaskId:context.taskId,parentTaskId:'parent-task',scopeRef:context.runId,
      configurationRef:'a'.repeat(64),inputDigest:'b'.repeat(64),deadline:context.deadline,workspaceRef:binding.bindingId};
    const result=await host.readHarnessCandidateContext(context,scope);
    if (withCheckFile) {
      assert.ok(result,'the selected node check keeps F15 available');
      assert.deepEqual(result.recipes.map(recipe=>recipe.recipeId),['node-check']);
      assert.equal(result.recipes.every(recipe=>recipe.required===true),true);
    } else {
      assert.equal(result,undefined,'a workspace without any exposed recipe must not report a runnable F15');
    }
    assert.equal(Boolean(result?.recipes?.some(recipe=>recipe.recipeId==='npm-test'||recipe.recipeId==='npm-build')),false,
      'a workspace without package.json must never advertise a required npm recipe');
    assert.equal(host.tools.some(item=>['workspace.npm_test','workspace.npm_build'].includes(item.descriptor.name)),false);
    const current=host.readHarnessExperienceCurrentSync();
    if (withCheckFile)assert.ok(current,'the current F15 experience stays readable for the selected node check');
    else assert.equal(current,undefined,'the current F15 experience must be honestly unavailable');
  });
});

test('local read consent permits MCP binding without granting AgentArts availability or export',async t=>{
  const {root,open}=await workspaceBindingFixture(t);
  const host=open();
  assert.equal(host.readWorkspaceBinding(),undefined);
  await host.authorize({cloudExportAllowed:false,writeAllowed:false,commandAllowed:false});
  const binding=host.readWorkspaceBinding();
  assert.equal(binding.rootPath,root);
  host.bindApplication({runtime:{loadCheckpoint:(_taskId,key)=>
    key==='desktop-coding-scope'?binding.bindingId:undefined}});
  assert.equal(host.snapshot().readAvailable,true);
  assert.equal(host.snapshot().cloudExportAllowed,false);
  assert.equal(host.snapshot().writeAvailable,false);
  assert.equal(host.snapshot().commandAvailable,false);
  assert.equal(host.readWorkspaceExportConfigurationRef(),undefined);
  for(const entry of host.competitionToolAvailability) {
    assert.equal(await entry.available({taskId:'local-only',signal:new AbortController().signal}),false);
  }
  for(const entry of host.competitionToolExports) {
    assert.equal(entry.accepts({taskId:'local-only'}),false);
    assert.throws(()=>entry.project({taskId:'local-only',signal:new AbortController().signal}),
      error=>error.code==='UNAUTHORIZED');
  }
  host.revoke();
  assert.equal(host.readWorkspaceBinding(),undefined);
  assert.equal(host.isWorkspaceBindingCurrent(binding),false);
  assert.equal(host.snapshot().readAvailable,false);
  assert.equal(open().readWorkspaceBinding(),undefined);
});

test('native selector cancellation receipts are explicit and never persist into snapshots or authorization',async t=>{
  const {root,configuration,open}=await workspaceBindingFixture(t);
  const host=open({selectDirectory:async()=>undefined,selectNodeExecutable:async()=>undefined,
    selectCheckFile:async()=>undefined,selectNpmCli:async()=>undefined});
  const before=await readFile(configuration,'utf8');
  for(const method of ['select','selectNode','selectCheckFile','selectNpmCli']) {
    const snapshot=host.snapshot(),result=await host[method]();
    assert.deepEqual(result,{...snapshot,selectionCancelled:true});
    assert.deepEqual(host.snapshot(),snapshot);
    assert.equal(Object.hasOwn(host.snapshot(),'selectionCancelled'),false);
    assert.equal(await readFile(configuration,'utf8'),before);
  }
  assert.equal(Object.hasOwn(await host.authorize({cloudExportAllowed:true,writeAllowed:false,commandAllowed:false}),'selectionCancelled'),false);
  assert.equal(Object.hasOwn(host.revoke(),'selectionCancelled'),false);
  const selected=await open({selectDirectory:async()=>root}).select();
  assert.equal(Object.hasOwn(selected,'selectionCancelled'),false);
  assert.equal(Object.hasOwn(JSON.parse(await readFile(configuration,'utf8')),'selectionCancelled'),false);
});

test('native selections cannot persist late results after their workspace host closes',async t=>{
  for(const [method,selector] of [['select','selectDirectory'],['selectNode','selectNodeExecutable'],
    ['selectCheckFile','selectCheckFile'],['selectNpmCli','selectNpmCli']]) {
    await t.test(method,async t=>{
      const {root,node,configuration,open}=await workspaceBindingFixture(t);
      const choices={select:path.join(path.dirname(root),'other-workspace'),
        selectNode:path.join(path.dirname(root),'node-b',path.basename(node)),
        selectCheckFile:path.join(root,'synthetic.js'),selectNpmCli:path.join(path.dirname(root),'npm-cli.js')};
      await writeFile(choices.selectCheckFile,'const synthetic = true;\n');
      await writeFile(choices.selectNpmCli,'// synthetic npm fixture\n');
      let settle,calls=0;
      const host=open({[selector]:()=>{calls++;return new Promise(done=>{settle=done;});}});
      const before=await readFile(configuration,'utf8');
      const pending=host[method]();host.close();
      const rejected=assert.rejects(pending,/选择已失效|宿主已关闭/);
      settle(choices[method]);await rejected;
      assert.equal(await readFile(configuration,'utf8'),before,'the closed host must not replace persisted selections');
      await assert.rejects(host[method](),/宿主已关闭/);
      assert.equal(calls,1,'closed hosts cannot reopen native selectors');
    });
  }
});

test('revocation invalidates an outstanding native choice before it can overwrite settings',async t=>{
  const {configuration,open}=await workspaceBindingFixture(t);
  let settle;
  const host=open({selectDirectory:()=>new Promise(done=>{settle=done;})});
  await allowWorkspaceRead(host);
  const before=await readFile(configuration,'utf8');
  const pending=host.select();host.revoke();
  const rejected=assert.rejects(pending,/选择已失效/);
  settle(path.join(path.dirname(configuration),'..','other-workspace'));await rejected;
  assert.equal(await readFile(configuration,'utf8'),before);
  assert.equal(host.snapshot().cloudExportAllowed,false);
});

test('an older native choice cannot overwrite a newer confirmed selection',async t=>{
  const {root,configuration,open}=await workspaceBindingFixture(t);
  const choices=[];
  const host=open({selectDirectory:()=>new Promise(done=>{choices.push(done);})});
  const older=host.select(),newer=host.select();
  choices[1](path.join(path.dirname(root),'other-workspace'));await newer;
  const confirmed=await readFile(configuration,'utf8');
  const rejected=assert.rejects(older,/选择已失效/);
  choices[0](root);await rejected;
  assert.equal(await readFile(configuration,'utf8'),confirmed);
  assert.equal(host.snapshot().displayName,'other-workspace');
});

test('trusted workspace binding requires session consent and invalidates old generations', async t=> {
  const {root,node,configuration,open}=await workspaceBindingFixture(t);
  const host=open();
  assert.equal(host.readWorkspaceBinding(),undefined);
  const stored=await readFile(configuration,'utf8');
  await allowWorkspaceRead(host);
  const binding=host.readWorkspaceBinding();
  assert.deepEqual(Object.keys(binding),['rootPath','nodeExecutable','bindingId']);
  assert.equal(binding.rootPath,root);assert.equal(binding.nodeExecutable,node);assert.ok(Object.isFrozen(binding));
  assert.equal(host.isWorkspaceBindingCurrent({...binding}),true);
  assert.equal(host.isWorkspaceBindingCurrent({...binding,bindingId:'old'}),false);
  assert.equal(host.isWorkspaceBindingCurrent({...binding,extra:true}),false);
  let getterReads=0;
  assert.equal(host.isWorkspaceBindingCurrent({nodeExecutable:node,bindingId:binding.bindingId,
    get rootPath(){getterReads++;return root;}}),false);
  assert.equal(getterReads,0);
  const visible=JSON.stringify(host.snapshot());
  for(const privateValue of [root,node,binding.bindingId]) assert.equal(visible.includes(privateValue),false);
  assert.equal(await readFile(configuration,'utf8'),stored);
  host.revoke();assert.equal(host.readWorkspaceBinding(),undefined);
  assert.equal(host.isWorkspaceBindingCurrent(binding),false);
  await allowWorkspaceRead(host);
  const renewed=host.readWorkspaceBinding();
  assert.notEqual(renewed.bindingId,binding.bindingId);assert.equal(host.isWorkspaceBindingCurrent(binding),false);
  host.close();assert.equal(host.readWorkspaceBinding(),undefined);
  assert.equal(host.isWorkspaceBindingCurrent(renewed),false);
  assert.equal(open().readWorkspaceBinding(),undefined); // Encrypted settings never restore consent.
});

test('trusted workspace binding rejects changed selections until reassembly', async t=> {
  const {open}=await workspaceBindingFixture(t);
  let host=open();await allowWorkspaceRead(host);
  const original=host.readWorkspaceBinding();
  await host.selectNode();
  assert.equal(host.readWorkspaceBinding(),undefined);assert.equal(host.isWorkspaceBindingCurrent(original),false);
  await assert.rejects(()=>allowWorkspaceRead(host),/重启/);assert.equal(host.readWorkspaceBinding(),undefined);
  host.close();host=open();await allowWorkspaceRead(host);
  const rebound=host.readWorkspaceBinding();assert.ok(rebound);
  await host.select();
  assert.equal(host.readWorkspaceBinding(),undefined);assert.equal(host.isWorkspaceBindingCurrent(rebound),false);
  await assert.rejects(()=>allowWorkspaceRead(host),/重启/);
});

test('changed command selections require reassembly instead of authorizing startup inputs',async t=>{
  for(const method of ['selectNode','selectCheckFile','selectNpmCli']) {
    await t.test(method,async t=>{
      const {root,node,configuration,open}=await workspaceBindingFixture(t);
      const first=path.join(root,'first.js'),second=path.join(root,'second.js');
      const firstNpm=path.join(path.dirname(node),'node_modules','npm','bin','npm-cli.js');
      const secondNpm=path.join(path.dirname(root),'npm-b','npm-cli.js');
      const helper=path.join(path.dirname(root),'WindowsJobProcessHost.exe');
      await Promise.all([mkdir(path.dirname(firstNpm),{recursive:true}),mkdir(path.dirname(secondNpm))]);
      await Promise.all([first,second,firstNpm,secondNpm,helper].map(file=>writeFile(file,'// synthetic metadata only\n')));
      const record=JSON.parse(await readFile(configuration,'utf8'));
      record.encryptedCheckFile=Buffer.from('first.js').toString('base64');
      record.encryptedNpmCli=Buffer.from(firstNpm).toString('base64');
      await writeFile(configuration,JSON.stringify(record));
      let selection;
      let executionCount=0;
      let executedBinding;
      const factory=options=>({
        tool:{descriptor:{name:'workspace.run_allowed_command',version:'1.0.0',sideEffect:'local_write',
          requiredScopes:['workspace:execute']},execute:async({recipeId})=>{
            executionCount++;
            executedBinding={node:options.nodeExecutable,file:options.checkFiles[0].path,npm:options.npmCliPath};
            return {recipeId,exitCode:0};
          }},
        recipes:[{id:'node-check',executable:options.nodeExecutable,args:['--check',options.checkFiles[0].path]},
          ...(options.allowProjectScripts?[{id:'npm-build',executable:helper,args:['--cwd',root,'--exe',options.nodeExecutable,
            '--',options.npmCliPath,'run','build']}]:[])],
        diagnostics:{projectScriptsExposed:options.allowProjectScripts},
      });
      const selectors={selectNode:'selectNodeExecutable',selectCheckFile:'selectCheckFile',selectNpmCli:'selectNpmCli'};
      const options={jobHelperExecutable:helper,createCommandRecipeTool:factory,
        [selectors[method]]:async()=>selection};
      let host=open(options);
      const checkpoints=new Map();
      const application={runtime:{loadCheckpoint:(id,key)=>checkpoints.get(`${id}:${key}`),
        saveCheckpoint:(id,key,value)=>checkpoints.set(`${id}:${key}`,value)}};
      host.bindApplication(application);
      const permission={cloudExportAllowed:true,writeAllowed:false,commandAllowed:true,projectCodeAllowed:true};
      await host.authorize(permission);
      const request={taskId:'before-selection',signal:new AbortController().signal};
      const available=name=>host.competitionToolAvailability.find(tool=>tool.toolName===name).available(request);
      assert.equal(available('workspace.node_check'),true);
      await host[method](); // Cancel leaves the existing authorization untouched.
      assert.equal(host.snapshot().cloudExportAllowed,true);
      selection={selectNode:node,selectCheckFile:first,selectNpmCli:firstNpm}[method];
      await host[method]();
      assert.equal(host.snapshot().authorizationAvailable,true);
      await host.authorize(permission);
      assert.equal(available('workspace.node_check'),false,'renewing consent never revives an old task binding');
      request.taskId='after-unchanged-selection';
      assert.equal(available('workspace.node_check'),true);
      selection={selectNode:path.join(path.dirname(root),'node-b',path.basename(node)),
        selectCheckFile:second,selectNpmCli:secondNpm}[method];
      await host[method]();
      assert.equal(host.snapshot().authorizationAvailable,false);
      assert.equal(host.snapshot().cloudExportAllowed,false);
      assert.equal(host.snapshot().projectScriptsAvailable,false);
      assert.match(host.snapshot().reason,/重启/);
      await assert.rejects(()=>host.authorize(permission),/重启/);
      assert.equal(available('workspace.node_check'),false);
      assert.equal(available('workspace.npm_build'),false);
      await assert.rejects(host.tools.find(tool=>tool.descriptor.name==='workspace.node_check').execute({},request),/许可已撤销|绑定已改变/);
      assert.equal(executionCount,0,'stale command closures must not execute');
      host.close();host=open(options);host.bindApplication(application);
      await host.authorize({...permission,projectCodeAllowed:method!=='selectNode'});
      assert.equal(host.snapshot().authorizationAvailable,true);
      assert.equal(host.snapshot().nodeCheckAvailable,true);
      if(method==='selectCheckFile') assert.equal(host.snapshot().checkFileName,'second.js');
      assert.equal(available('workspace.node_check'),false,'reassembly keeps previous task bindings invalid');
      request.taskId='after-reassembly';
      assert.equal(available('workspace.node_check'),true);
      await host.tools.find(tool=>tool.descriptor.name==='workspace.node_check').execute({},request);
      assert.equal(executionCount,1);
      assert.equal(executedBinding.node,method==='selectNode'?selection:node);
      assert.equal(executedBinding.file,method==='selectCheckFile'?'second.js':'first.js');
      assert.equal(executedBinding.npm,method==='selectNode'?undefined:method==='selectNpmCli'?secondNpm:firstNpm);
    });
  }
});

test('native workspace selections expose standalone Node tests and retain normal npm recipes after reopening',async t=>{
  for(const standalone of [true,false]) {
    await t.test(standalone?'dependency-free Node test':'installed npm build and test',async t=>{
      const {root,node,open}=await workspaceBindingFixture(t);
      const npm=path.join(path.dirname(root),'npm-cli.js'),helper=path.join(path.dirname(root),'WindowsJobProcessHost.exe');
      const check=path.join(root,'check.js');
      await Promise.all([writeFile(npm,'// synthetic npm metadata only'),writeFile(helper,'synthetic helper metadata only'),
        writeFile(check,'const synthetic = true;\n'),writeFile(path.join(root,'package.json'),JSON.stringify({
          name:'synthetic-project',scripts:standalone?{test:'node --test'}:{build:'synthetic build',test:'synthetic test'}}))]);
      if(!standalone)await mkdir(path.join(root,'node_modules'));
      const calls=[],recipes=[];
      const options={selectDirectory:async()=>root,selectNodeExecutable:async()=>node,selectCheckFile:async()=>check,
        selectNpmCli:async()=>npm,jobHelperExecutable:helper,
        createCommandRecipeTool:options=>createWorkspaceCommandRecipeTool({...options,createWorkspaceCommandTool:configuration=>{
          recipes.push(...configuration.recipes);
          return {descriptor:{name:'workspace.run_allowed_command',version:'1.0.0',sideEffect:'local_write',
            requiredScopes:['workspace:execute']},execute:async({recipeId})=>{
              // Explicit Fake command boundary: no fixture executable or project script is launched.
              calls.push(configuration.recipes.find(recipe=>recipe.id===recipeId));
              return {recipeId,exitCode:0,stdout:'',stderr:''};
            }};
        }})};
      let host=open(options);
      await host.select();await host.selectNode();await host.selectCheckFile();await host.selectNpmCli();host.close();
      host=open(options);
      const checkpoints=new Map();host.bindApplication({runtime:{loadCheckpoint:(id,key)=>checkpoints.get(`${id}:${key}`),
        saveCheckpoint:(id,key,value)=>checkpoints.set(`${id}:${key}`,value)}});
      assert.equal(host.snapshot().projectScriptsAvailable,true);
      const createTool=host.tools.find(tool=>tool.descriptor.name==='workspace.create_text');
      assert.ok(createTool,'create-only workspace tool is registered with the locked helper');
      assert.deepEqual(createTool.descriptor.requiredScopes,['workspace:read','workspace:write','workspace:create']);
      assert.equal(createTool.descriptor.sideEffect,'local_write');
      const snapshot=await host.authorize({cloudExportAllowed:true,writeAllowed:false,commandAllowed:true,projectCodeAllowed:true});
      assert.equal(snapshot.nodeCheckAvailable,true);
      assert.deepEqual(snapshot.projectCommands,standalone?['test']:['build','test']);
      const request={taskId:'synthetic-test-task',signal:new AbortController().signal};
      for(const name of ['workspace.node_check',...snapshot.projectCommands.map(script=>'workspace.npm_'+script)]) {
        assert.equal(host.competitionToolAvailability.find(entry=>entry.toolName===name).available(request),true);
        assert.equal((await host.tools.find(tool=>tool.descriptor.name===name).execute({},request)).exitCode,0);
      }
      const testRecipe=calls.find(recipe=>recipe.id==='npm-test');
      assert.equal(testRecipe.executable,helper);
      assert.deepEqual(testRecipe.args,['--cwd',root,'--exe',node,'--',...(standalone?['--test']:[npm,'run','test'])]);
      if(!standalone)assert.deepEqual(calls.find(recipe=>recipe.id==='npm-build').args,['--cwd',root,'--exe',node,'--',npm,'run','build']);
      assert.ok(recipes.length>0);
    });
  }
});

test('project recipe validation rejects mixed shapes and changed executable or workspace bindings',async t=>{
  const {root,node,open}=await workspaceBindingFixture(t);
  const npm=path.join(path.dirname(root),'npm-cli.js'),helper=path.join(path.dirname(root),'WindowsJobProcessHost.exe');
  await Promise.all([writeFile(npm,'// synthetic npm metadata only'),writeFile(helper,'synthetic helper metadata only'),
    writeFile(path.join(root,'package.json'),JSON.stringify({name:'synthetic-project',scripts:{test:'node --test'}}))]);
  const selectors={selectDirectory:async()=>root,selectNodeExecutable:async()=>node,selectNpmCli:async()=>npm};
  const selection=open(selectors);await selection.select();await selection.selectNode();await selection.selectNpmCli();selection.close();
  const invalid=[
    ['different cwd',recipe=>({...recipe,args:recipe.args.map((value,index)=>index===1?path.dirname(root):value)})],
    ['different Node',recipe=>({...recipe,args:recipe.args.map((value,index)=>index===3?npm:value)})],
    ['different helper',recipe=>({...recipe,executable:node})],
    ['extra argument',recipe=>({...recipe,args:[...recipe.args,'--watch']})],
    ['mixed npm and Node arguments',recipe=>({...recipe,args:['--cwd',root,'--exe',node,'--',npm,'--test']})],
    ['Node test mislabeled as build',recipe=>({...recipe,id:'npm-build'})],
  ];
  for(const [name,mutate] of invalid)await t.test(name,async()=>{
    let calls=0;
    const host=open({...selectors,jobHelperExecutable:helper,createCommandRecipeTool:options=>{
      const recipe=createWorkspaceCommandRecipeTool({...options,createWorkspaceCommandTool:()=>({
        descriptor:{name:'workspace.run_allowed_command',version:'1.0.0',sideEffect:'local_write',requiredScopes:['workspace:execute']},
        execute:async()=>{calls++;throw Error('Invalid recipe must never execute');}})});
      return {...recipe,recipes:recipe.recipes.map(mutate)};
    }});
    assert.equal(host.snapshot().projectScriptsAvailable,false);
    assert.match(host.snapshot().commandReason,/装配失败/);
    await assert.rejects(()=>host.authorize({cloudExportAllowed:true,writeAllowed:false,commandAllowed:true,projectCodeAllowed:true}),/尚未准备好/);
    assert.equal(host.tools.some(tool=>['workspace.npm_test','workspace.npm_build'].includes(tool.descriptor.name)),false);
    assert.equal(calls,0);
  });
});

test('trusted workspace binding rejects root or Node replacement at the same path', async t=> {
  for(const changed of ['root','node']) {
    const {root,node,open}=await workspaceBindingFixture(t);
    const host=open();await allowWorkspaceRead(host);
    const binding=host.readWorkspaceBinding();
    if(changed==='node') {await rename(node,node+'.previous');await writeFile(node,'synthetic node C');}
    else {await rename(root,root+'-previous');await mkdir(root);}
    assert.equal(host.readWorkspaceBinding(),undefined);assert.equal(host.isWorkspaceBindingCurrent(binding),false);
  }
});

// Prepared for the final unified suite. These do not grant PUBLIC export consent.
test('workspace export gate keeps source local and redacts non-content result projections', async t=> {
  const {root,open}=await workspaceBindingFixture(t);
  const host=open();
  const checkpoints=new Map();
  host.bindApplication({runtime:{loadCheckpoint:(id,key)=>checkpoints.get(id+key),
    saveCheckpoint:(id,key,value)=>checkpoints.set(id+key,value)}});
  await writeFile(path.join(root,'private.js'),'const privateValue="LOCAL_ONLY";\n');
  await host.authorize({cloudExportAllowed:true,writeAllowed:true,commandAllowed:false});
  const request={taskId:'export-private',proposalId:'proposal-private',
    signal:new AbortController().signal,deadline:new Date(Date.now()+30000).toISOString()};
  const local=async(name,args,scopes)=> {
    assert.equal(host.competitionToolAvailability.find(item=>item.toolName===name).available(request),true);
    return host.tools.find(item=>item.descriptor.name===name).execute(args,{...request,scopes});
  };
  const read=await local('workspace.read_text',{path:'private.js'},['workspace:read']);
  assert.match(read.content,/LOCAL_ONLY/); // The real local result is preserved.
  const readExport=host.competitionToolExports.find(item=>item.toolName==='workspace.read_text');
  assert.throws(()=>readExport.project({...request,result:read}),{code:'UNSUPPORTED_CAPABILITY'});
  const list=await local('workspace.list_entries',{path:'.'},['workspace:list']);
  const listExport=host.competitionToolExports.find(item=>item.toolName==='workspace.list_entries');
  assert.deepEqual(listExport.project({...request,result:list}),{listed:true,truncated:false});
  const preview=await local('workspace.preview_text_patch',{path:'private.js',expectedSha256:read.sha256,
    edits:[{oldText:'LOCAL_ONLY',newText:'STILL_LOCAL'}]},['workspace:read']);
  const previewExport=host.competitionToolExports.find(item=>item.toolName==='workspace.preview_text_patch');
  const safe=previewExport.project({...request,result:preview});
  assert.deepEqual(safe,{previewed:true,changed:true});
  for(const privateValue of ['private.js','LOCAL_ONLY','STILL_LOCAL',read.sha256]) {
    assert.equal(JSON.stringify(safe).includes(privateValue),false);
  }
  assert.throws(()=>previewExport.project({...request,result:{...preview,unexpected:'private'}}),{code:'INVALID_ARGUMENT'});
  const cancelled=new AbortController();cancelled.abort();
  assert.throws(()=>previewExport.project({...request,signal:cancelled.signal,result:preview}),{code:'CANCELLED'});
  host.revoke();assert.throws(()=>previewExport.project({...request,result:preview}),{code:'UNAUTHORIZED'});
});

test('selected workspace binds tasks, keeps consent session-only and rejects reuse after revocation', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'pa-coding-selected-'));
  const userData=await mkdtemp(path.join(os.tmpdir(),'pa-coding-config-'));
  await writeFile(path.join(root,'hello.js'),'console.log("hello");\n');
  const largerSource='// Synthetic source above the old demo limit\n'.repeat(256);
  await writeFile(path.join(root,'larger.js'),largerSource);
  // Explicit in-memory crypto stand-in; no actual account configuration is accessed.
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  let host=createWorkspaceConfigHost({userData,safeStorage,selectDirectory:async()=>root});
  assert.equal(host.snapshot().configured,false);
  await host.select();assert.equal(host.snapshot().configured,true);
  assert.match(host.snapshot().reason,/重启/);host.close();
  host=createWorkspaceConfigHost({userData,safeStorage,selectDirectory:async()=>undefined});
  const checkpoints=new Map();
  host.bindApplication({runtime:{loadCheckpoint:(id,key)=>checkpoints.get(id+key),
    saveCheckpoint:(id,key,value)=>checkpoints.set(id+key,value)}});
  const request={taskId:'task-one',signal:new AbortController().signal,deadline:new Date(Date.now()+30000).toISOString()};
  const binding=host.competitionToolAvailability.find(item=>item.toolName==='workspace.read_text');
  const read=host.tools.find(item=>item.descriptor.name==='workspace.read_text');
  const context={...request,scopes:['workspace:read']};
  try {
    assert.equal(binding.available(request),false);
    await host.authorize({cloudExportAllowed:true,writeAllowed:false,commandAllowed:false});
    assert.equal(binding.available(request),true);
    const result=await read.execute({path:'hello.js'},context);
    assert.equal(result.content,'console.log("hello");\n');
    const policy=host.competitionToolExports.find(item=>item.toolName==='workspace.read_text');
    const larger=await read.execute({path:'larger.js'},context);
    assert.equal(larger.content,largerSource);
    assert.throws(()=>policy.project({...request,result:larger}),{code:'UNSUPPORTED_CAPABILITY'});
    assert.equal(policy.accepts(request),false); // Local consent supplies no exact PUBLIC grant.
    host.revoke();assert.equal(policy.accepts(request),false);
    await assert.rejects(read.execute({path:'hello.js'},context),/撤销|绑定/);
    await host.authorize({cloudExportAllowed:true,writeAllowed:false,commandAllowed:false});
    assert.equal(binding.available(request),false);
    assert.equal(binding.available({...request,taskId:'task-two'}),true);
  } finally {host.close();}
});

// Prepared unit fixtures only, not real Runtime/Policy/Evidence acceptance.
// The export implementation itself is imported from its public cloud package.
async function confirmedExportFixture(t) {
  const {createWorkspaceReferenceExport}=await import('@personal-agent/mcp');
  const {open,root}=await workspaceBindingFixture(t);
  const taskId='prepared-workspace-task',proposalId='prepared-original-proposal';
  const runId=`competition-tool-${taskId}-1`,args={path:'public-reference.js',maxBytes:1024};
  const content='// Explicit synthetic PUBLIC reference\r\n';
  const result={path:args.path,encoding:'utf-8',byteLength:Buffer.byteLength(content),content,
    sha256:createHash('sha256').update(content).digest('hex')};
  const deadline=new Date(Date.now()+60000).toISOString();
  const proposal={kind:'tool_proposal',proposalId,toolName:'workspace.read_text',toolVersion:'1.0.0',
    arguments:structuredClone(args),verification:'unverified'};
  const finishedAt=new Date(Date.now()-100).toISOString();
  const data={task:{taskId,state:'running',evidenceRefs:[runId]},
    record:{evidenceId:runId,taskId,protocolVersion:PROTOCOL_VERSION,requestId:'original-runtime-request',
      toolName:proposal.toolName,toolVersion:proposal.toolVersion,policyDecision:'allow',executionStarted:true,
      state:'confirmed',startedAt:new Date(Date.now()-200).toISOString(),finishedAt},
    evidence:[{evidenceId:runId,kind:'execution',sourceRef:proposal.toolName,capturedAt:finishedAt}],
    result:structuredClone(result),loop:{step:1,pending:proposal,evidenceRefs:[],receipts:[]},
    preflight:{authorizationId:'prepared-native-public-grant',expiresAt:deadline,sensitivity:'PUBLIC',
      purpose:'coding-reference',maxExportBytes:1024}};
  data.permission={...data.preflight,contentDigest:result.sha256};
  const checkpoints=new Map([[`${taskId}:application-profile`,'huawei_ict_agentarts'],
    [`${taskId}:application-deadline`,deadline]]);
  const runtime={getTask:()=>structuredClone(data.task),
    loadCheckpoint:(id,key)=>key==='competition-loop'?structuredClone(data.loop)
      :key===`tool-result-${runId}`?{result:structuredClone(data.result)}:checkpoints.get(`${id}:${key}`),
    saveCheckpoint:(id,key,value)=>checkpoints.set(`${id}:${key}`,value),
    readToolExecutions:()=>[structuredClone(data.record)],readEvidence:()=>structuredClone(data.evidence),
    matchesToolExecutionInput:(_record,input)=>input.scopeRef===runId && isDeepStrictEqual(input.arguments,args)};
  const host=open({createWorkspaceReferenceExport,readWorkspaceExportPreflight:query=> {
    data.onPreflight?.(query);return data.preflight;
  },readWorkspaceExportAuthorization:query=> {
    data.onAuthorization?.(query);return data.permission;
  }});
  host.bindApplication({runtime});await allowWorkspaceRead(host);
  const signal=new AbortController();
  host.competitionToolAvailability.find(item=>item.toolName==='workspace.read_text')
    .available({taskId,signal:signal.signal});
  const query={taskId,proposalId,path:args.path,configurationRef:host.readWorkspaceExportConfigurationRef()};
  const request={taskId,proposalId,arguments:structuredClone(args),phase:'preflight'};
  const exporter=host.competitionToolExports.find(item=>item.toolName==='workspace.read_text');
  return {host,root,data,checkpoints,query,request,exporter,result,runId,signal,deadline};
}

test('native PUBLIC workspace export consumes original confirmed result and pins its proposal/run', async t=> {
  const f=await confirmedExportFixture(t);
  const candidate=f.host.readWorkspaceExportCandidate(f.query);
  assert.equal(candidate.runId,f.runId);assert.equal(candidate.contentDigest,f.result.sha256);
  assert.deepEqual(candidate.arguments,f.request.arguments);assert.ok(Object.isFrozen(candidate));
  assert.equal(Object.hasOwn(candidate,'content'),false);
  assert.equal(f.exporter.exportPolicyVersion,'workspace-reference-3.0.0');
  assert.equal(f.exporter.accepts(f.request),true);
  const projected=f.exporter.project({...f.request,result:f.result,signal:f.signal.signal});
  assert.deepEqual(projected,{source:'approved-workspace-reference',content:f.result.content,
    byteLength:f.result.byteLength,contentDigest:f.result.sha256,truncated:false,readConfirmed:true});
  for(const localOnly of [f.root,f.query.path,f.runId,f.data.permission.authorizationId]) {
    assert.equal(JSON.stringify(projected).includes(localOnly),false);
    assert.equal(JSON.stringify(f.host.snapshot()).includes(localOnly),false);
  }
  assert.throws(()=>f.exporter.project({...f.request,result:{...f.result,content:'swapped'},signal:f.signal.signal}),
    {code:'UNAUTHORIZED'});
  assert.equal(f.exporter.accepts({...f.request,arguments:{...f.request.arguments,maxBytes:512}}),false);
  const originalProposal=f.data.loop.pending;
  f.data.loop={step:2,evidenceRefs:[f.runId],receipts:[{proposal:originalProposal,
    continuation:{proposalId:f.query.proposalId,state:'confirmed',result:projected},
    exportPolicyVersion:f.exporter.exportPolicyVersion}]};
  assert.equal(f.exporter.accepts(f.request),true); // Uses the already pinned original mapping.
  assert.deepEqual(f.host.readConfirmedWorkspaceExport({...f.query,arguments:f.request.arguments,contentDigest:f.result.sha256}),
    {runId:f.runId,result:f.result});
  f.data.result={...f.result,content:'another confirmed-looking result',
    byteLength:Buffer.byteLength('another confirmed-looking result'),
    sha256:createHash('sha256').update('another confirmed-looking result').digest('hex')};
  assert.equal(f.host.readWorkspaceExportCandidate(f.query),undefined);
});

test('workspace confirmed reader rejects wrong original identity, input, execution and Evidence', async t=> {
  const changes={
    taskSnapshot:data=>{data.task.taskId='other-task';},
    task:data=>{data.record.taskId='other-task';},
    run:data=>{data.record.evidenceId='other-run';},
    tool:data=>{data.record.toolName='mcp.workspace.read_text';},
    version:data=>{data.record.toolVersion='2.0.0';},
    protocol:data=>{data.record.protocolVersion='0.0.0';},
    scopeAndArguments:data=>{data.loop.pending.arguments.maxBytes=512;},
    policy:data=>{data.record.policyDecision='deny';},
    unknown:data=>{data.record.state='unknown';},
    notExecuted:data=>{data.record.executionStarted=false;},
    unfinished:data=>{delete data.record.finishedAt;},
    taskEvidence:data=>{data.task.evidenceRefs=[];},
    evidence:data=>{data.evidence[0].sourceRef='other-tool';},
    historicResult:data=>{delete data.result.sha256;},
    invalidBytes:data=>{data.result.byteLength++;},
    proposal:data=>{data.loop.pending.proposalId='another-proposal';},
    noOriginalMapping:data=>{data.loop.receipts=[{proposal:data.loop.pending}];delete data.loop.pending;},
    cancelled:data=>{data.task.cancelRequested=true;},
  };
  for(const [name,change] of Object.entries(changes)) await t.test(name,async sub=> {
    const f=await confirmedExportFixture(sub);change(f.data);
    assert.equal(f.host.readWorkspaceExportCandidate(f.query),undefined);
    assert.equal(f.host.readConfirmedWorkspaceExport({...f.query,arguments:f.request.arguments,contentDigest:f.result.sha256}),undefined);
    assert.equal(f.exporter.accepts({...f.request,phase:'final',projection:{source:'approved-workspace-reference',
      content:f.result.content,byteLength:f.result.byteLength,contentDigest:f.result.sha256,
      truncated:false,readConfirmed:true}}),false);
  });
});

test('workspace export rechecks native revocation, grant replacement, deadline and cancellation', async t=> {
  const f=await confirmedExportFixture(t);
  assert.equal(f.exporter.accepts(f.request),true);
  const permission=f.data.permission;
  const preflight=f.data.preflight;
  f.data.preflight={...preflight,authorizationId:'replacement-grant'};
  assert.equal(f.exporter.accepts(f.request),false);
  f.data.preflight=preflight;f.data.permission=permission;
  f.data.onAuthorization=()=>f.signal.abort();
  assert.throws(()=>f.exporter.project({...f.request,result:f.result,signal:f.signal.signal}),{code:'CANCELLED'});
  f.data.onAuthorization=undefined;
  f.checkpoints.set(`${f.query.taskId}:application-deadline`,new Date(Date.now()-1).toISOString());
  assert.equal(f.exporter.accepts(f.request),false);
  f.checkpoints.set(`${f.query.taskId}:application-deadline`,f.deadline);
  f.data.onPreflight=()=>f.host.revoke();
  assert.equal(f.exporter.accepts(f.request),false);
  assert.equal(f.host.readWorkspaceExportConfigurationRef(),undefined);
  await allowWorkspaceRead(f.host);
  assert.notEqual(f.host.readWorkspaceExportConfigurationRef(),f.query.configurationRef);
  assert.equal(f.host.readWorkspaceExportCandidate(f.query),undefined);
});

test('first PUBLIC preflight never claims confirmation and final checks require the original read', async t=> {
  const f=await confirmedExportFixture(t);
  const confirmedRecord=f.data.record,confirmedResult=f.data.result;
  f.data.record={...confirmedRecord,state:'started',policyDecision:'not_evaluated',executionStarted:false};
  delete f.data.result;
  const target=f.host.readWorkspaceExportPreflightCandidate(f.query);
  assert.ok(target);assert.deepEqual(target.arguments,f.request.arguments);
  assert.equal(Object.hasOwn(target,'contentDigest'),false);assert.equal(Object.hasOwn(target,'byteLength'),false);
  assert.equal(f.host.readWorkspaceExportCandidate(f.query),undefined);
  assert.equal(f.exporter.accepts(f.request),true);
  assert.equal(f.exporter.accepts({...f.request,phase:'final'}),false);
  f.data.loop.step=2;
  assert.equal(f.host.readWorkspaceExportPreflightCandidate(f.query),undefined); // Cannot swap the original run.
  f.data.loop.step=1;
  assert.throws(()=>f.exporter.project({...f.request,result:f.result,signal:f.signal.signal}),{code:'UNAUTHORIZED'});
  f.data.record=confirmedRecord;f.data.result=confirmedResult;
  const projection=f.exporter.project({...f.request,result:f.result,signal:f.signal.signal});
  assert.equal(f.exporter.accepts({...f.request,phase:'final',projection}),true);
  assert.equal(f.exporter.accepts({...f.request,phase:'final',projection:{...projection,content:'swapped'}}),false);
  f.data.permission=undefined;
  assert.equal(f.exporter.accepts({...f.request,phase:'final',projection}),false);
});

test('PUBLIC export requires native purpose, byte bound and exact post-read scope', async t=> {
  const f=await confirmedExportFixture(t);
  const scope=f.data.preflight;
  f.data.preflight=undefined;assert.equal(f.exporter.accepts(f.request),false);
  f.data.preflight={...scope,sensitivity:'PRIVATE'};assert.equal(f.exporter.accepts(f.request),false);
  f.data.preflight={...scope,purpose:'arbitrary-send'};assert.equal(f.exporter.accepts(f.request),false);
  f.data.preflight={...scope,expiresAt:new Date(Date.parse(f.deadline)+60000).toISOString()};
  assert.equal(f.exporter.accepts(f.request),false);
  f.data.preflight={...scope,maxExportBytes:1};assert.equal(f.exporter.accepts(f.request),true);
  assert.throws(()=>f.exporter.project({...f.request,result:f.result,signal:f.signal.signal}),{code:'UNAUTHORIZED'});
  // A fresh task/host has a separate original permission binding; do not replace it.
  const other=await confirmedExportFixture(t);
  assert.equal(other.exporter.accepts(other.request),true);
  other.data.permission={...other.data.permission,purpose:'reference-summary'};
  assert.throws(()=>other.exporter.project({...other.request,result:other.result,signal:other.signal.signal}),{code:'UNAUTHORIZED'});
});
