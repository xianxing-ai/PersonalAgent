import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication,createRuntimeSubagentDispatchTool,DEVELOPER_HARNESS_TOOL_NAME,
  DEVELOPER_HARNESS_TOOL_VERSION,SUBAGENT_DISPATCH_TOOL_NAME,SUBAGENT_DISPATCH_TOOL_VERSION} from '../dist/application.js';

const read = {name:'fixture.harness.read',version:'1.0.0',sideEffect:'read',requiredScopes:['fixture:read'],
  idempotencySupport:true,recoverySupport:true,requiresPresence:false,
  inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},
  outputSchema:{type:'object',additionalProperties:true}};
const plan = revision => ({planId:'development',expectedRevision:revision,tasks:[
  {id:'research',role:'researcher',goal:'Inspect the requested change',dependsOn:[],maxSteps:2},
  {id:'implement',role:'coder',goal:'Implement the requested change',dependsOn:['research'],maxSteps:2},
  {id:'review',role:'reviewer',goal:'Review the executed change',dependsOn:['implement'],maxSteps:2},
]});
async function until(predicate) {
  const end=Date.now()+15_000;
  while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}
  throw new Error('Expected Runtime state did not arrive');
}
function fixture(t, options={}) {
  let app,reads=0;
  const visits=[];
  const dispatch=createRuntimeSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const port=new FakeCoordinationPort(async request=>{
    const binding=app.runtime.loadCheckpoint(request.taskId,'subtask-parent');
    visits.push({taskId:request.taskId,binding,request});
    if(binding?.subtaskId==='user-work'){
      if(!request.continuation)return {kind:'tool_proposal',proposalId:'native-plan',toolName:DEVELOPER_HARNESS_TOOL_NAME,
        toolVersion:DEVELOPER_HARNESS_TOOL_VERSION,arguments:options.proposal?.(request.revision)??plan(request.revision),verification:'mock'};
      if(options.continueOwner)return options.continueOwner(request,app);
      return {kind:'text',text:'Native user-work collected actual executor results',verification:'mock'};
    }
    if(binding?.role==='researcher'){
      if(options.research) return options.research(request,app);
      return {kind:'text',text:'Research evidence',verification:'mock'};
    }
    if(binding?.role==='coder'){
      if(!request.continuation)return {kind:'tool_proposal',proposalId:'executor-read',toolName:read.name,
        toolVersion:read.version,arguments:{value:'bounded implementation input'},verification:'mock'};
      return {kind:'text',text:'Implementation evidence',verification:'mock'};
    }
    return {kind:'text',text:binding?.role==='reviewer'?'Review evidence':'Original interaction summary',verification:'mock'};
  });
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,
    competitionMaxSteps:8,coordination:port,coordinationBinding:'fixture-native-harness',
    developerHarness:{workspaceRef:'fixture-confined-workspace',maxExecutorSteps:6},
    competitionToolExports:[{toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION,
      exportPolicyVersion:'fixture-root-summary-v1',accepts:()=>true,project:({result})=>result},
      {toolName:read.name,toolVersion:read.version,exportPolicyVersion:'fixture-read-v1',accepts:()=>true,project:({result})=>result}],
    tools:[dispatch,{descriptor:{...read,...(options.sideEffect?{sideEffect:options.sideEffect}:{})},execute:async(input,context)=>{
      reads++;return options.read?options.read(input,context,app):input;
    }}],automaticTools:[{toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION},
      {toolName:DEVELOPER_HARNESS_TOOL_NAME,toolVersion:DEVELOPER_HARNESS_TOOL_VERSION},
      {toolName:read.name,toolVersion:read.version}],
    ...(options.application??{})});
  t.after(()=>app.close());
  const client=new Client(app);
  return {app,client,visits,reads:()=>reads,start:async(idempotencyKey='native-development')=>{
    await client.connect();
    return client.call('task.submit',{goal:'Develop the requested feature',conversationId:'native-main'},
      {idempotencyKey,timeoutMs:60_000});
  }};
}
function children(app,parent){return app.runtime.listTasks({conversationId:`desktop-subtask:${parent.taskId}`,limit:100}).items;}
function ownerOf(app,parent){return app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-user-work`);}
function resultOf(app,parent){return app.runtime.loadCheckpoint(ownerOf(app,parent).taskId,'developer-harness:result:development');}

test('native user-work executes a dependency plan through same-parent tasks, Gateway and existing conversations',async t=>{
  const f=fixture(t),parent=await f.start();
  await until(()=>f.app.activeTaskCount===0);
  const owner=ownerOf(f.app,parent),tasks=children(f.app,parent);
  assert.equal(f.app.runtime.getTask(parent.taskId).state,'succeeded',JSON.stringify({parent:f.app.runtime.getTask(parent.taskId),tasks}));
  assert.equal(tasks.length,4);
  const result=resultOf(f.app,parent);
  assert.equal(result.state,'completed');
  assert.deepEqual(result.executors.map(item=>item.state),['succeeded','succeeded','succeeded']);
  assert.equal(f.reads(),1);
  assert.deepEqual(f.app.runtime.readToolExecutions(parent.taskId).map(item=>item.toolName),[SUBAGENT_DISPATCH_TOOL_NAME]);
  assert.deepEqual(Object.keys(f.app.runtime.loadCheckpoint(parent.taskId,'subtask-progress-records')),['user-work']);
  assert.equal(f.app.runtime.loadCheckpoint(owner.taskId,'developer-harness:budget:v1').limit,6);
  const peers=tasks.filter(task=>task.taskId!==owner.taskId);
  for(const child of peers){
    const scope=f.app.runtime.loadCheckpoint(child.taskId,'subtask-tools-binding');
    assert.ok(scope.every(tool=>![SUBAGENT_DISPATCH_TOOL_NAME,DEVELOPER_HARNESS_TOOL_NAME].includes(tool.name)));
    assert.equal(f.app.runtime.loadCheckpoint(child.taskId,'competition-max-steps'),2);
    assert.equal(f.app.runtime.loadCheckpoint(child.taskId,'subtask-parent').parentTaskId,parent.taskId);
    assert.equal(f.app.runtime.loadCheckpoint(child.taskId,'application-deadline'),
      f.app.runtime.loadCheckpoint(parent.taskId,'application-deadline'));
    assert.equal(f.app.readSubagentConversation({parentTaskId:parent.taskId,taskId:child.taskId}).canSubmit,true);
  }
  assert.equal(f.app.readSubagentTasks(parent.taskId).length,4);
  const coder=peers.find(task=>f.app.runtime.loadCheckpoint(task.taskId,'subtask-parent').role==='coder');
  assert.match(coder.goal,/Research evidence/);
  const review=peers.find(task=>f.app.runtime.loadCheckpoint(task.taskId,'subtask-parent').role==='reviewer');
  assert.match(review.goal,/Implementation evidence/);
  const followup=f.app.submitSubagentConversationMessage({parentTaskId:parent.taskId,taskId:review.taskId,
    requestId:'continue-native-review',text:'Explain the review evidence'});
  await until(()=>f.app.runtime.getTask(followup.acceptedTaskId).state==='succeeded');
  assert.equal(f.app.readSubagentConversation({parentTaskId:parent.taskId,taskId:review.taskId}).messages.length,1);
  await assert.rejects(f.app.tools.invoke({taskId:parent.taskId,runId:'root-execution-forbidden',authorizationRef:'root-execution-forbidden',
    toolName:DEVELOPER_HARNESS_TOOL_NAME,toolVersion:DEVELOPER_HARNESS_TOOL_VERSION,arguments:plan(0),
    deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal}),{code:'SCOPE_DENIED'});
  assert.throws(()=>f.app.readSubagentConversation({parentTaskId:owner.taskId,taskId:review.taskId}),{code:'SCOPE_DENIED'});
});

test('failed dependencies never create downstream executors',async t=>{
  const f=fixture(t,{research:()=>{throw new ProtocolError('EXTERNAL_FAILURE','Fixture research failed');}});
  const parent=await f.start();await until(()=>f.app.activeTaskCount===0);
  assert.equal(children(f.app,parent).length,2);assert.equal(f.reads(),0);
  assert.deepEqual(resultOf(f.app,parent).executors.map(item=>item.state),['failed','blocked','blocked']);
});

test('a model need not invent a revision absent from its public cloud input',async t=>{
  const f=fixture(t,{proposal:revision=>{const value=plan(revision);delete value.expectedRevision;return value;}});
  const parent=await f.start();await until(()=>f.app.activeTaskCount===0);
  assert.equal(resultOf(f.app,parent).state,'completed');assert.equal(children(f.app,parent).length,4);
  const record=f.app.runtime.loadCheckpoint(ownerOf(f.app,parent).taskId,'developer-harness:plan:development');
  assert.ok(Number.isSafeInteger(record.sourceRevision));
});

test('independent executors share admission, merge progress, and reject generic-wire scope expansion',{timeout:15_000},async t=>{
  let started=0,arrive,release;
  const entered=new Promise(resolve=>{arrive=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,{proposal:revision=>({planId:'development',expectedRevision:revision,tasks:[
    {id:'first',role:'researcher',goal:'First independent inspection',dependsOn:[],maxSteps:2},
    {id:'second',role:'researcher',goal:'Second independent inspection',dependsOn:[],maxSteps:2},
    {id:'review',role:'reviewer',goal:'Review both inspections',dependsOn:['first','second'],maxSteps:2},
  ]}),research:async()=>{started++;if(started===2)arrive();await gate;
    return {kind:'text',text:'Independent inspection evidence',verification:'mock'};}});
  const parent=await f.start();await entered;
  const sibling=children(f.app,parent).find(task=>f.app.runtime.loadCheckpoint(task.taskId,'subtask-parent').role==='researcher');
  await assert.rejects(f.client.call('tool.invoke',{toolName:DEVELOPER_HARNESS_TOOL_NAME,toolVersion:DEVELOPER_HARNESS_TOOL_VERSION,
    arguments:plan(0),scopeRef:'forbidden-broker'}, {taskId:sibling.taskId,idempotencyKey:'forbidden-broker-wire'}),{code:'SCOPE_DENIED'});
  const owner=ownerOf(f.app,parent),pending=f.app.runtime.loadCheckpoint(owner.taskId,'competition-loop');
  await assert.rejects(f.app.tools.invoke({taskId:owner.taskId,runId:'different-owner-run',authorizationRef:'different-owner-run',
    toolName:DEVELOPER_HARNESS_TOOL_NAME,toolVersion:DEVELOPER_HARNESS_TOOL_VERSION,
    arguments:{...pending.pending.arguments,planId:'injected'},deadline:f.app.runtime.loadCheckpoint(owner.taskId,'application-deadline'),
    signal:new AbortController().signal}),{code:'UNAUTHORIZED'});
  release();await until(()=>f.app.activeTaskCount===0);
  assert.equal(started,2);assert.deepEqual(resultOf(f.app,parent).executors.map(item=>item.state),['succeeded','succeeded','succeeded']);
  const progress=f.app.runtime.loadCheckpoint(ownerOf(f.app,parent).taskId,'developer-harness:progress:development');
  assert.equal(Object.keys(progress).length,3);assert.ok(Object.values(progress).every(record=>record.state==='succeeded'));
});

test('the trusted total budget is reserved across plans rather than multiplied per invocation',async t=>{
  const f=fixture(t,{continueOwner:request=>({kind:'tool_proposal',proposalId:'second-plan',
    toolName:DEVELOPER_HARNESS_TOOL_NAME,toolVersion:DEVELOPER_HARNESS_TOOL_VERSION,verification:'mock',arguments:{
      planId:'second',expectedRevision:request.revision,
      tasks:[{id:'extra',role:'researcher',goal:'An extra execution',dependsOn:[],maxSteps:1}],
    }})});
  const parent=await f.start();await until(()=>f.app.activeTaskCount===0);
  assert.equal(children(f.app,parent).length,4);
  const owner=ownerOf(f.app,parent);
  assert.equal(owner.state,'failed');
  assert.equal(f.app.runtime.loadCheckpoint(owner.taskId,'developer-harness:plan:second'),undefined);
  const budget=f.app.runtime.loadCheckpoint(owner.taskId,'developer-harness:budget:v1');
  assert.deepEqual(Object.keys(budget.reservations),['development']);assert.equal(budget.reservations.development.steps,6);
});

test('workspace changes stop later admission and forged executor markers grant no conversation scope',async t=>{
  let current=true;
  const f=fixture(t,{application:{developerHarness:{workspaceRef:'fixture-confined-workspace',maxExecutorSteps:6,
    assertCurrent:()=>{if(!current)throw new ProtocolError('REVISION_CONFLICT','Fixture workspace changed');}}},
    research:()=>{current=false;return {kind:'text',text:'Original workspace inspection',verification:'mock'};}});
  const parent=await f.start();await until(()=>f.app.activeTaskCount===0);
  assert.equal(children(f.app,parent).length,2);assert.equal(f.reads(),0);
  assert.equal(ownerOf(f.app,parent).state,'failed');
  const sibling=children(f.app,parent).find(task=>task.taskId!==ownerOf(f.app,parent).taskId);
  const marker=f.app.runtime.loadCheckpoint(sibling.taskId,'developer-harness-executor:v1');
  f.app.runtime.saveCheckpoint(sibling.taskId,'developer-harness-executor:v1',{...marker,maxSteps:999});
  assert.throws(()=>f.app.readSubagentConversation({parentTaskId:parent.taskId,taskId:sibling.taskId}),{code:'UNAUTHORIZED'});
  assert.throws(()=>f.app.readSubagentTasks(parent.taskId),{code:'UNAUTHORIZED'});
});

test('strict plan schema, cycles, and total budget reject before executor admission',async t=>{
  for(const [name,proposal] of [
    ['scope expansion',revision=>({...plan(revision),workspaceRef:'different-workspace'})],
    ['cycle',revision=>{const value=plan(revision);value.tasks[0].dependsOn=['review'];return value;}],
    ['budget',revision=>{const value=plan(revision);value.tasks[2].maxSteps=3;return value;}],
    ['revision',revision=>plan(revision+1)],
  ])await t.test(name,async tt=>{
    const f=fixture(tt,{proposal}),parent=await f.start();await until(()=>f.app.activeTaskCount===0);
    assert.equal(children(f.app,parent).length,1);assert.equal(f.reads(),0);
    assert.equal(ownerOf(f.app,parent).state,'failed');
  });
});

test('an unknown executor write remains pending and cannot start a dependent or replay its input',async t=>{
  const f=fixture(t,{sideEffect:'local_write',read:(_input,context,app)=>{
    // The real tool path records unknown under this exact task/run.
    app.runtime.transitionTask(context.taskId,'waiting_reconciliation');
    throw new ProtocolError('RESULT_UNKNOWN','Fixture write outcome needs independent readback');
  }});
  const parent=await f.start();await until(()=>f.app.activeTaskCount===0);
  assert.equal(f.app.runtime.getTask(parent.taskId).state,'waiting_reconciliation');
  const result=resultOf(f.app,parent);
  assert.equal(result.state,'waiting_reconciliation');assert.equal(result.executors[2].state,'not_started');
  assert.equal(children(f.app,parent).length,3);assert.equal(f.reads(),1);
  const uncertain=result.executors[1];
  assert.equal(f.app.runtime.getTask(uncertain.taskId).state,'waiting_reconciliation');
  assert.throws(()=>f.app.resumeTask(uncertain.taskId));
  assert.equal(f.reads(),1);
});

test('an executor approval continues the original broker run and dependency plan through the interaction root',async t=>{
  const f=fixture(t,{application:{automaticTools:[
    {toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION},
    {toolName:DEVELOPER_HARNESS_TOOL_NAME,toolVersion:DEVELOPER_HARNESS_TOOL_VERSION},
  ]}}),parent=await f.start();
  await until(()=>f.app.activeTaskCount===0);
  assert.equal(f.app.runtime.getTask(parent.taskId).state,'waiting_approval');
  const original=resultOf(f.app,parent),owner=ownerOf(f.app,parent);
  assert.equal(original.state,'waiting_approval');assert.equal(original.executors[2].state,'not_started');
  assert.equal(f.reads(),0);
  const budget=f.app.runtime.loadCheckpoint(owner.taskId,'developer-harness:budget:v1');
  const originalRun=f.app.runtime.loadCheckpoint(owner.taskId,'developer-harness:plan:development').runId;
  const coder=original.executors[1].taskId;
  const approval=f.app.runtime.getApproval(`competition-tool-${coder}-1`);
  await f.client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
  await until(()=>f.app.runtime.getTask(parent.taskId).state==='succeeded'&&f.app.activeTaskCount===0);
  assert.equal(f.reads(),1);assert.equal(children(f.app,parent).length,4);
  assert.deepEqual(resultOf(f.app,parent).executors.map(item=>item.state),['succeeded','succeeded','succeeded']);
  assert.equal(f.app.runtime.loadCheckpoint(owner.taskId,'developer-harness:plan:development').runId,originalRun);
  assert.deepEqual(f.app.runtime.loadCheckpoint(owner.taskId,'developer-harness:budget:v1'),budget);
  assert.deepEqual(f.app.runtime.readToolExecutions(parent.taskId).map(item=>item.toolName),[SUBAGENT_DISPATCH_TOOL_NAME]);
  assert.equal(f.app.runtime.readToolExecutions(owner.taskId).filter(item=>item.toolName===DEVELOPER_HARNESS_TOOL_NAME).length,1);
  assert.ok(f.app.runtime.getTask(parent.taskId).evidenceRefs.includes(approval.approvalId));
});

test('cancellation stops new admission and drains already started executor work',{timeout:15_000},async t=>{
  let entered,release;
  const arrived=new Promise(resolve=>{entered=resolve;});
  let stopped=false;
  const f=fixture(t,{research:async request=>{
    entered();
    await new Promise(resolve=>{release=resolve;request.signal.addEventListener('abort',()=>{stopped=true;resolve();},{once:true});});
    return {kind:'text',text:'Stopped fixture research',verification:'mock'};
  }});
  const parent=await f.start();await arrived;
  await f.client.call('task.cancel',{taskId:parent.taskId,reason:'Stop original native work'});
  await until(()=>f.app.activeTaskCount===0);release();
  assert.equal(stopped,true);assert.equal(f.reads(),0);
  assert.equal(children(f.app,parent).length,2);
  assert.ok(children(f.app,parent).every(task=>['cancelled','failed'].includes(task.state)));
  assert.equal(f.app.runtime.getTask(parent.taskId).state,'cancelled');
});

test('composition is explicit and preserves the original root-only delegation model',()=>{
  assert.throws(()=>createRuntimeApplication({path:':memory:',profile:'local',
    developerHarness:{workspaceRef:'workspace',maxExecutorSteps:6}}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,
    developerHarness:{workspaceRef:'workspace',maxExecutorSteps:0}}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,
    developerHarness:{workspaceRef:'workspace',maxExecutorSteps:6},readDeveloperHarnessConfiguration:()=>undefined}),{code:'INVALID_ARGUMENT'});
  const app=createRuntimeApplication({path:':memory:'});
  try{assert.ok(!app.tools?.list().some(tool=>tool.name===DEVELOPER_HARNESS_TOOL_NAME));}finally{app.close();}
});

test('trusted dynamic configuration enables the next original user worker without application restart',async t=>{
  let configuration;
  const f=fixture(t,{application:{developerHarness:undefined,readDeveloperHarnessConfiguration:()=>configuration}});
  const first=await f.start('disabled');await until(()=>f.app.activeTaskCount===0);
  const firstOwner=ownerOf(f.app,first);
  assert.equal(children(f.app,first).length,1);assert.equal(f.reads(),0);
  assert.ok(!f.visits.find(visit=>visit.taskId===firstOwner.taskId).request.availableTools
    ?.some(tool=>tool.name===DEVELOPER_HARNESS_TOOL_NAME));
  configuration={workspaceRef:'fixture-confined-workspace',maxExecutorSteps:6,configurationRef:'trusted-config-r2'};
  const second=await f.start('enabled');await until(()=>f.app.activeTaskCount===0);
  assert.equal(f.app.runtime.getTask(second.taskId).state,'succeeded');assert.equal(children(f.app,second).length,4);
  const owner=ownerOf(f.app,second),saved=f.app.runtime.loadCheckpoint(owner.taskId,'developer-harness:plan:development');
  assert.equal(saved.binding.workspaceRef,configuration.workspaceRef);
  assert.equal(f.app.runtime.loadCheckpoint(owner.taskId,'developer-harness:budget:v1').limit,6);
  assert.deepEqual(f.app.runtime.readToolExecutions(second.taskId).map(item=>item.toolName),[SUBAGENT_DISPATCH_TOOL_NAME]);
});

test('trusted configuration revisions stop new dependency admission and retain the original total allowance',async t=>{
  let configuration={workspaceRef:'fixture-confined-workspace',maxExecutorSteps:6,configurationRef:'trusted-config-r1'};
  const f=fixture(t,{application:{developerHarness:undefined,readDeveloperHarnessConfiguration:()=>configuration},
    research:()=>{configuration={...configuration,maxExecutorSteps:60,configurationRef:'trusted-config-r2'};
      return {kind:'text',text:'Inspected original workspace',verification:'mock'};}});
  const parent=await f.start();await until(()=>f.app.activeTaskCount===0);
  assert.equal(children(f.app,parent).length,2);assert.equal(f.reads(),0);
  const owner=ownerOf(f.app,parent),budget=f.app.runtime.loadCheckpoint(owner.taskId,'developer-harness:budget:v1');
  assert.equal(budget.limit,6);assert.equal(budget.reservations.development.steps,6);
  assert.equal(f.app.runtime.getTask(owner.taskId).state,'failed');
});

test('disabling configuration denies old executor approval before grant consumption while read and cancellation stay usable',async t=>{
  let configuration={workspaceRef:'fixture-confined-workspace',maxExecutorSteps:6,configurationRef:'trusted-config-r1'};
  const f=fixture(t,{application:{developerHarness:undefined,readDeveloperHarnessConfiguration:()=>configuration,
    automaticTools:[{toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION},
      {toolName:DEVELOPER_HARNESS_TOOL_NAME,toolVersion:DEVELOPER_HARNESS_TOOL_VERSION}]}});
  const parent=await f.start();await until(()=>f.app.activeTaskCount===0);
  const original=resultOf(f.app,parent),coder=original.executors[1].taskId;
  const approval=f.app.runtime.getApproval(`competition-tool-${coder}-1`);
  configuration=undefined;
  await assert.rejects(f.client.call('authorization.respond',{approvalId:approval.approvalId,
    expectedRevision:approval.revision,decision:'allow_once'}),{code:'REVISION_CONFLICT'});
  assert.equal(f.app.runtime.getApproval(approval.approvalId).state,'pending');
  assert.equal(f.app.runtime.policy.get(approval.approvalId),undefined);assert.equal(f.reads(),0);
  const conversation=f.app.readSubagentConversation({parentTaskId:parent.taskId,taskId:coder});
  assert.equal(conversation.canSubmit,false);
  assert.match(conversation.submitUnavailableReason,/原模型、部署或工具绑定不可用或已变化/);
  assert.ok(f.app.readSubagentTasks(parent.taskId).some(task=>task.taskId===coder));
  assert.equal(f.app.cancelSubagentConversationTask({parentTaskId:parent.taskId,taskId:coder,executionTaskId:coder}).cancelAccepted,true);
  await f.client.call('task.cancel',{taskId:parent.taskId,reason:'Stop disabled original work'});
  await until(()=>f.app.activeTaskCount===0);assert.equal(f.reads(),0);
});

