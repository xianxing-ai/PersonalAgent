import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createRuntimeApplication, createDesktopSubagentDispatchTool} from '../dist/application.js';

const selection={catalogRevision:'a'.repeat(64),modelId:'selected-cloud',reasoningEffort:'high'};
const read={name:'fixture.delegated-work',version:'1.0.0',sideEffect:'read',requiredScopes:['fixture:read'],
  requiresPresence:false,recoverySupport:true,idempotencySupport:true,
  inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object'}};
async function until(predicate) {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}
  throw Error('Expected task state did not arrive');
}
function fixture({path:storage=':memory:',autoRead=false,automaticDispatch=true,delegate=true,reply,execute,selected,
  registered=true,coordination=true,descriptor=read,coordinationInput,fast=false,resolvedSelection=selected}={}) {
  let app;const calls=[];
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const tools=[...(registered?[dispatch]:[]),{descriptor,execute:async(input,context)=>{
    calls.push({taskId:context.taskId,input});return execute?execute(input,context):{answer:56};
  }}];
  const port=new FakeCoordinationPort(async request=>{
    const task=app.runtime.getTask(request.taskId);
    if(reply)return reply(request,task,app);
    if(task.conversationId.startsWith('desktop-subtask:')) {
      assert.ok(request.availableTools===undefined || request.availableTools.every(tool=>tool.name!=='subagent.dispatch'));
      if(!request.continuation)return {kind:'tool_proposal',proposalId:'child-work',toolName:descriptor.name,
        toolVersion:descriptor.version,arguments:{},verification:'unverified'};
      return {kind:'text',text:'Child independently returned 56',verification:'mock'};
    }
    assert.ok(request.continuation,'root must never ask the cloud to decide whether to delegate');
    assert.equal(request.continuation.result.succeeded,1);
    return {kind:'text',text:'Summary of confirmed child result',verification:'mock'};
  });
  app=createRuntimeApplication({path:storage,profile:'huawei_ict_agentarts',...(delegate?{delegateUserTasks:true}:{}),
    ...(coordination?{coordination:port}:{}),coordinationBinding:'fixed-fixture-config',tools,
    ...(coordinationInput?{coordinationInput}:{}),
    ...(selected?{readDefaultExecutionModel:()=>selected,resolveExecutionModel:value=>{
      assert.equal(value.modelId,selected.modelId);assert.equal(value.reasoningEffort,selected.reasoningEffort);return resolvedSelection;
    }}:{}),
    readConversationPreference:()=>({depth:2,fast,...(selected?{executionModel:selected}:{})}),
    automaticTools:[...(automaticDispatch&&registered?[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version}]:[]),
      ...(autoRead?[{toolName:descriptor.name,toolVersion:descriptor.version}]:[])],
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      exportPolicyVersion:'fixture-v1',accepts:()=>true,project:({result})=>result})),
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      publicEnumPaths:['/subtasks/*/role','/subtasks/*/reasoningEffort'],available:()=>true})),
  });
  return {app,port,calls};
}
async function submit(app,key='original',goal='Do the requested work') {
  const client=new Client(app);await client.connect();
  const task=await client.call('task.submit',{goal,conversationId:'user-chat'},
    {idempotencyKey:key,timeoutMs:60000});
  return {client,task};
}

test('mandatory user delegation creates a real child, preserves selection and scopes the two tool catalogs',async()=>{
  const {app,port,calls}=fixture({autoRead:true,selected:selection,fast:true});
  try {
    const {client,task}=await submit(app);
    await until(()=>app.activeTaskCount===0);
    const parent=app.runtime.getTask(task.taskId),[child]=app.readSubagentTasks(task.taskId);
    assert.equal(parent.state,'succeeded',JSON.stringify(parent.error));assert.equal(child.state,'succeeded');
    assert.equal(calls.length,1);assert.equal(calls[0].taskId,child.taskId);
    assert.deepEqual(app.runtime.loadCheckpoint(task.taskId,'competition-tool-catalog').entries.map(tool=>tool.name),['subagent.dispatch']);
    assert.deepEqual(app.runtime.loadCheckpoint(child.taskId,'competition-tool-catalog').entries.map(tool=>tool.name),[read.name]);
    assert.deepEqual(app.runtime.loadCheckpoint(child.taskId,'execution-model'),selection);
    assert.equal(app.runtime.loadCheckpoint(child.taskId,'subtask-parent').thinkingDepth,2);
    assert.equal(app.runtime.loadCheckpoint(child.taskId,'competition-max-steps'),4);
    assert.equal(app.runtime.loadCheckpoint(child.taskId,'subtask-thinking-binding').stepBudget.maxSteps,4);
    assert.equal(port.requests.length,3);assert.equal(port.requests[0].taskId,child.taskId);
    assert.equal(port.requests[2].taskId,parent.taskId);assert.ok(port.requests[2].continuation);
    assert.deepEqual(app.runtime.readToolExecutions(parent.taskId).map(record=>record.toolName),['subagent.dispatch']);
    assert.deepEqual(app.runtime.readToolExecutions(child.taskId).map(record=>record.toolName),[read.name]);
    const duplicate=await client.call('task.submit',{goal:'Do the requested work',conversationId:'user-chat'},
      {idempotencyKey:'original',timeoutMs:60000});
    assert.equal(duplicate.taskId,parent.taskId);assert.equal(calls.length,1);
    assert.equal(app.readSubagentTasks(parent.taskId).length,1);
  } finally {app.close();}
});

test('root business tools are rejected at ToolPort and Gateway even with an explicit grant',async()=>{
  let entered,release;const enteredChild=new Promise(resolve=>{entered=resolve;});
  const {app,calls}=fixture({reply:async(request,task)=>{
    if(task.conversationId.startsWith('desktop-subtask:')) {
      entered();await new Promise(resolve=>{release=resolve;});return {kind:'text',text:'Child result',verification:'mock'};
    }
    return {kind:'text',text:'Root summary',verification:'mock'};
  }});
  try {
    const {client,task}=await submit(app);await enteredChild;
    const runId='forged-root-work',deadline=new Date(Date.now()+60000).toISOString();
    app.runtime.policy.grant({authorizationRef:runId,taskId:task.taskId,toolName:read.name,scopes:read.requiredScopes,
      argumentsDigest:toolArgumentsDigest({}),maxUses:1,expiresAt:deadline});
    await assert.rejects(app.tools.invoke({taskId:task.taskId,toolName:read.name,toolVersion:read.version,
      arguments:{},runId,authorizationRef:runId,deadline,signal:new AbortController().signal}),{code:'SCOPE_DENIED'});
    const original=app.runtime.loadCheckpoint(task.taskId,'competition-loop').pending;
    await assert.rejects(app.tools.invoke({taskId:task.taskId,toolName:original.toolName,toolVersion:original.toolVersion,
      arguments:{subtasks:[{...original.arguments.subtasks[0],goal:'substituted work'}]},
      runId:`competition-tool-${task.taskId}-1`,authorizationRef:`competition-tool-${task.taskId}-1`,deadline,
      signal:new AbortController().signal}),{code:'SCOPE_DENIED'});
    await assert.rejects(client.call('tool.invoke',{toolName:read.name,toolVersion:read.version,arguments:{},scopeRef:runId},
      {taskId:task.taskId,idempotencyKey:runId,timeoutMs:60000}),/only dispatch|scope|Scope|User conversation/);
    assert.equal(calls.length,0);
    assert.equal(app.runtime.policy.get(runId).usesRemaining,1,'rejection must not consume the unrelated grant');
  } finally {release?.();await until(()=>app.activeTaskCount===0);app.close();}
});

test('dispatch itself still waits for the existing Policy approval without creating a child early',async()=>{
  const {app,port}=fixture({automaticDispatch:false,autoRead:true});
  try {
    const {client,task}=await submit(app);await until(()=>app.activeTaskCount===0);
    assert.equal(app.runtime.getTask(task.taskId).state,'waiting_approval');assert.equal(port.requests.length,0);
    assert.deepEqual(app.readSubagentTasks(task.taskId),[]);
    const approval=app.runtime.getApproval(`competition-tool-${task.taskId}-1`);
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    await until(()=>app.activeTaskCount===0);
    assert.equal(app.runtime.getTask(task.taskId).state,'succeeded');assert.equal(app.readSubagentTasks(task.taskId).length,1);
  } finally {app.close();}
});

test('child approval restart keeps original delegation without enabling the option again or repeating work',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'pa-required-child-'));let first,restored;
  try {
    first=fixture({path:path.join(directory,'runtime.sqlite'),selected:selection});
    const {task}=await submit(first.app);await until(()=>first.app.activeTaskCount===0);
    const [child]=first.app.readSubagentTasks(task.taskId);
    assert.equal(child.state,'waiting_approval');assert.equal(first.calls.length,0);assert.equal(first.port.requests.length,1);
    const binding=first.app.runtime.loadCheckpoint(task.taskId,'required-subagent-delegation:v1');
    const approval=first.app.runtime.getApproval(`competition-tool-${child.taskId}-1`);
    first.app.close();first=undefined;
    restored=fixture({path:path.join(directory,'runtime.sqlite'),delegate:false,selected:selection});
    const client=new Client(restored.app);await client.connect();
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    await until(()=>restored.app.activeTaskCount===0);
    assert.equal(restored.app.runtime.getTask(task.taskId).state,'succeeded');assert.equal(restored.calls.length,1);
    assert.equal(restored.calls[0].taskId,child.taskId);assert.equal(restored.app.readSubagentTasks(task.taskId).length,1);
    assert.deepEqual(restored.app.runtime.loadCheckpoint(task.taskId,'required-subagent-delegation:v1'),binding);
    assert.equal(restored.app.runtime.readToolExecutions(task.taskId).length,1);
    assert.equal(restored.app.runtime.readToolExecutions(child.taskId).length,1);
    assert.equal(restored.port.requests.length,2);
  } finally {first?.app.close();restored?.app.close();await rm(directory,{recursive:true,force:true});}
});

for(const summaryFailure of ['adapter','tool-proposal'])test(`failed root summary (${summaryFailure}) preserves its already executed child`,async()=>{
  const {app,calls}=fixture({autoRead:true,reply:(request,task)=>{
    if(task.conversationId.startsWith('desktop-subtask:')) {
      if(!request.continuation)return {kind:'tool_proposal',proposalId:'work',toolName:read.name,toolVersion:read.version,arguments:{},verification:'unverified'};
      return {kind:'text',text:'Actual child result',verification:'mock'};
    }
    if(summaryFailure==='adapter')throw Error('summary transport failed');
    return {kind:'tool_proposal',proposalId:'root-work',toolName:read.name,toolVersion:read.version,arguments:{},verification:'mock'};
  }});
  try {
    const {task}=await submit(app);await until(()=>app.activeTaskCount===0);
    const [child]=app.readSubagentTasks(task.taskId);
    assert.notEqual(app.runtime.getTask(task.taskId).state,'succeeded');assert.equal(child.state,'succeeded');assert.equal(calls.length,1);
    assert.match(app.runtime.getTask(child.taskId).resultSummary,/Actual child result/);
    assert.equal(app.runtime.readToolExecutions(child.taskId)[0].state,'confirmed');
    assert.deepEqual(app.runtime.readToolExecutions(task.taskId).map(record=>record.toolName),['subagent.dispatch']);
  } finally {app.close();}
});

test('missing dispatch or cloud configuration fails explicitly without local fallback',async t=>{
  for(const options of [{registered:false},{coordination:false}])await t.test(JSON.stringify(options),async()=>{
    const {app,port,calls}=fixture(options);
    try {
      const {task}=await submit(app);await until(()=>app.activeTaskCount===0);
      const failed=app.runtime.getTask(task.taskId);assert.equal(failed.state,'failed');assert.equal(failed.error.code,'UNSUPPORTED_CAPABILITY');
      assert.equal(calls.length,0);assert.equal(port.requests.length,0);assert.deepEqual(app.readSubagentTasks(task.taskId),[]);
    } finally {app.close();}
  });
});

test('legacy submissions remain on their original lifecycle when mandatory delegation is disabled',async()=>{
  const {app}=fixture({delegate:false,reply:()=>({kind:'text',text:'Original direct reply',verification:'mock'})});
  try {
    const {task}=await submit(app);await until(()=>app.activeTaskCount===0);
    assert.equal(app.runtime.getTask(task.taskId).state,'succeeded');assert.deepEqual(app.readSubagentTasks(task.taskId),[]);
    assert.equal(app.runtime.loadCheckpoint(task.taskId,'required-subagent-delegation:v1'),undefined);
  } finally {app.close();}
  assert.throws(()=>createRuntimeApplication({path:':memory:',profile:'local',delegateUserTasks:true}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,competitionMaxSteps:1}),{code:'INVALID_ARGUMENT'});
});

test('delegated parent context lookup binds exact child identity and rejects forged, expired and cancelled scopes',async()=>{
  const {app}=fixture();
  try {
    const {task}=await submit(app);await until(()=>app.activeTaskCount===0);
    const [child]=app.readSubagentTasks(task.taskId);
    const original=app.runtime.loadCheckpoint(child.taskId,'subtask-parent');
    const parentBinding=app.runtime.loadCheckpoint(task.taskId,'required-subagent-delegation:v1');
    const deadline=app.runtime.loadCheckpoint(task.taskId,'application-deadline');
    assert.deepEqual(app.readDelegatedUserTaskParent(child.taskId),{taskId:task.taskId,conversationId:'user-chat',deadline});
    assert.equal(app.readDelegatedUserTaskParent('unknown'),undefined);
    app.runtime.saveCheckpoint(child.taskId,'subtask-parent',{...original,goal:'forged'});
    assert.equal(app.readDelegatedUserTaskParent(child.taskId),undefined);
    app.runtime.saveCheckpoint(child.taskId,'subtask-parent',original);
    const impostor=app.runtime.submitTaskWithCheckpoint({goal:app.runtime.getTask(child.taskId).goal,
      conversationId:`desktop-subtask:${task.taskId}`,idempotencyKey:'forged-child'},'subtask-parent',original);
    assert.equal(app.readDelegatedUserTaskParent(impostor.taskId),undefined,'matching metadata cannot forge idempotency ownership');
    app.runtime.saveCheckpoint(task.taskId,'required-subagent-delegation:v1',{...parentBinding,deadline:'2000-01-01T00:00:00.000Z'});
    app.runtime.saveCheckpoint(task.taskId,'application-deadline','2000-01-01T00:00:00.000Z');
    app.runtime.saveCheckpoint(child.taskId,'subtask-parent',{...original,parentDeadline:'2000-01-01T00:00:00.000Z'});
    assert.equal(app.readDelegatedUserTaskParent(child.taskId),undefined);
    app.runtime.saveCheckpoint(task.taskId,'required-subagent-delegation:v1',parentBinding);
    app.runtime.saveCheckpoint(task.taskId,'application-deadline',deadline);
    app.runtime.saveCheckpoint(child.taskId,'subtask-parent',original);
    assert.ok(app.readDelegatedUserTaskParent(child.taskId));
    app.runtime.requestCancel(task.taskId,'stop original parent');
    assert.equal(app.readDelegatedUserTaskParent(child.taskId),undefined);
    app.runtime.requestCancel(child.taskId,'stop original child');
    assert.equal(app.readDelegatedUserTaskParent(child.taskId),undefined);
  } finally {app.close();}
});

test('cancelled child cannot read its parent context while the original parent remains active',async()=>{
  const {app}=fixture();
  try {
    const {task}=await submit(app);await until(()=>app.activeTaskCount===0);
    const [child]=app.readSubagentTasks(task.taskId);
    assert.ok(app.readDelegatedUserTaskParent(child.taskId));
    app.runtime.requestCancel(child.taskId,'stop child');
    assert.equal(app.runtime.getTask(task.taskId).cancelRequested,undefined);
    assert.equal(app.readDelegatedUserTaskParent(child.taskId),undefined);
  } finally {app.close();}
});

test('ordinary preexisting subagents cannot inherit user conversation context',()=>{
  const {app}=fixture({delegate:false});
  try {
    const parent=app.runtime.submitTask({goal:'legacy parent',conversationId:'legacy',idempotencyKey:'legacy-parent'});
    const child=app.runtime.submitTaskWithCheckpoint({goal:'[任务执行] legacy parent',conversationId:`desktop-subtask:${parent.taskId}`,
      idempotencyKey:`subagent-dispatch-${parent.taskId}-user-work`},'subtask-parent',{
      parentTaskId:parent.taskId,parentDeadline:new Date(Date.now()+60000).toISOString(),subtaskId:'user-work',
      role:'coordinator',roleLabel:'任务执行',goal:'legacy parent',thinkingDepth:2});
    assert.equal(app.readDelegatedUserTaskParent(child.taskId),undefined);
  } finally {app.close();}
});

test('private prepared root input cannot enter the delegated summary and does not erase the executed child',async()=>{
  let app,rootPrepared=0,rootReleased=0;
  const f=fixture({autoRead:true,coordinationInput:{
    prepareCoordinationGoal:async scope=>{
      if(app.runtime.getTask(scope.taskId).conversationId==='user-chat') {rootPrepared++;return 'PRIVATE BODY '+scope.publicGoal;}
      return scope.publicGoal;
    },beforeCoordinationSend:()=>{},releaseTask:()=>{rootReleased++;},
  }});app=f.app;
  try {
    const {task}=await submit(app);await until(()=>app.activeTaskCount===0);
    const [child]=app.readSubagentTasks(task.taskId);
    assert.equal(child.state,'succeeded');assert.equal(f.calls.length,1);assert.equal(rootPrepared,1);assert.equal(rootReleased,1);
    assert.notEqual(app.runtime.getTask(task.taskId).state,'succeeded');
    assert.ok(f.port.requests.every(request=>request.taskId===child.taskId),'root private body must not be sent');
    assert.doesNotMatch(JSON.stringify(app.runtime.getTask(task.taskId)),/PRIVATE BODY/);
    assert.match(app.runtime.getTask(child.taskId).resultSummary,/56/);
  } finally {app.close();}
});

test('an unknown child write keeps original reconciliation and a duplicate user submission never repeats it',async()=>{
  const {app,calls}=fixture({descriptor:{...read,sideEffect:'external_write'},execute:()=>{throw Error('write outcome unknown');}});
  try {
    const {client,task}=await submit(app);await until(()=>app.activeTaskCount===0);
    const [child]=app.readSubagentTasks(task.taskId);
    const approval=app.runtime.getApproval(`competition-tool-${child.taskId}-1`);
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    await until(()=>app.activeTaskCount===0);
    assert.equal(calls.length,1);assert.equal(app.runtime.getTask(child.taskId).state,'waiting_reconciliation');
    assert.equal(app.runtime.getTask(task.taskId).state,'waiting_approval','existing parent wait remains blocked while the child is unresolved');
    assert.equal(app.runtime.readToolExecutions(child.taskId)[0].state,'unknown');
    await client.call('task.submit',{goal:'Do the requested work',conversationId:'user-chat'},
      {idempotencyKey:'original',timeoutMs:60000});
    assert.equal(calls.length,1);assert.equal(app.readSubagentTasks(task.taskId).length,1);
  } finally {app.close();}
});

test('public conversation history is compiled after required dispatch and reaches the actual child and root summary',async()=>{
  let app;const prepared=[];
  const f=fixture({autoRead:true,coordinationInput:{
    prepareCoordinationGoal:async scope=>{prepared.push(scope.taskId);return scope.publicGoal;},
    readConversationContext:async scope=>{
      const inherited=app.readDelegatedUserTaskParent(scope.taskId);
      if(app.runtime.getTask(scope.taskId).conversationId.startsWith('desktop-subtask:')) {
        assert.equal(inherited.conversationId,'user-chat');
      }
      return app.readConversationContext({...scope,...(inherited?{taskId:inherited.taskId,conversationId:inherited.conversationId}:{}),
        historyMessages:[{id:'prior-public-turn',role:'user',content:'Earlier public context'}]});
    },beforeCoordinationSend:()=>{},
  }});app=f.app;
  try {
    const {task}=await submit(app);await until(()=>app.activeTaskCount===0);
    const [child]=app.readSubagentTasks(task.taskId);
    assert.equal(app.runtime.getTask(task.taskId).state,'succeeded');assert.equal(child.state,'succeeded');
    assert.equal(prepared[0],child.taskId,'the root must not collect context before dispatch');
    assert.equal(prepared.at(-1),task.taskId);
    assert.equal(f.port.requests.length,3);
    for(const request of f.port.requests) {
      const compiled=JSON.parse(request.goal);
      assert.equal(compiled.conversationContext.messages[0].content,'Earlier public context');
    }
  } finally {app.close();}
});

test('delegated execution cannot silently switch the original selected model catalog',async()=>{
  const {app,port,calls}=fixture({selected:selection,resolvedSelection:{...selection,catalogRevision:'b'.repeat(64)},
    reply:request=>{
      assert.ok(request.continuation);assert.equal(request.continuation.result.failed,1);
      return {kind:'text',text:'Original selected child configuration is unavailable',verification:'mock'};
    }});
  try {
    const {task}=await submit(app);await until(()=>app.activeTaskCount===0);
    const [child]=app.readSubagentTasks(task.taskId);
    assert.equal(child.state,'failed');assert.equal(app.runtime.getTask(child.taskId).error.code,'REVISION_CONFLICT');
    assert.equal(calls.length,0);assert.equal(port.requests.length,1);assert.equal(port.requests[0].taskId,task.taskId);
    assert.deepEqual(app.runtime.loadCheckpoint(task.taskId,'execution-model'),selection);
  } finally {app.close();}
});

test('a short read-only weather request still executes only in the required user-work child',async()=>{
  const {app,port,calls}=fixture({autoRead:true});
  const goal='北京今天下午适合跑步吗';
  try{
    const {task}=await submit(app,'weather-mandatory',goal);
    await until(()=>app.activeTaskCount===0);
    const parent=app.runtime.getTask(task.taskId),[child]=app.readSubagentTasks(task.taskId);
    assert.equal(parent.state,'succeeded',JSON.stringify(parent.error));
    assert.ok(child,'read-only weather work must still create a durable child');
    assert.equal(child.state,'succeeded');
    assert.equal(app.runtime.loadCheckpoint(task.taskId,'required-subagent-delegation:v1').goal,goal);
    assert.deepEqual(calls.map(call=>call.taskId),[child.taskId]);
    assert.deepEqual(app.runtime.readToolExecutions(task.taskId).map(record=>record.toolName),['subagent.dispatch']);
    assert.deepEqual(app.runtime.readToolExecutions(child.taskId).map(record=>record.toolName),[read.name]);
    assert.ok(port.requests.filter(request=>request.taskId===parent.taskId).every(request=>request.continuation),
      'the root receives the confirmed child result and never plans the weather tool call');
  }finally{app.close();}
});
