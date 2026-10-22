import test from 'node:test';
import assert from 'node:assert/strict';
import {ProtocolError} from '@personal-agent/contracts';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {ToolGateway} from '@personal-agent/tool-gateway';
import {TaskRuntime} from '../dist/index.js';
import {createRuntimeApplication,createAgentArtsRuntimeApplication,createDesktopSubagentDispatchTool} from '../dist/application.js';
import {SyntheticWebSocket} from '../../../packages/coordination/test/fixtures/websocket.mjs';

const descriptor=sideEffect=>({name:'fixture.action',version:'1.0.0',sideEffect,requiredScopes:['fixture:use'],
  idempotencySupport:true,recoverySupport:true,requiresPresence:false,
  inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object',properties:{},additionalProperties:false}});
const exportsFor=tools=>tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
  exportPolicyVersion:'fixture-v1',accepts:()=>true,project:({result})=>result}));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function submit(app,key='timeout',duration=120) {
  const response=await app.send({kind:'request',protocolVersion:'1.0.0',requestId:'fixture-request',operation:'task.submit',
    deadline:new Date(Date.now()+duration).toISOString(),idempotencyKey:key,
    payload:{goal:'Synthetic ordinary text',conversationId:'fixture-conversation'}},new AbortController().signal);
  assert.equal(response.outcome,'ok');return response.data.taskId;
}
async function settled(app,id,allowApproval=false) {
  for(let i=0;i<200;i++) {
    const task=app.runtime.getTask(id);
    if(['failed','cancelled','waiting_reconciliation',...(allowApproval?['waiting_approval']:[])].includes(task.state)&&app.activeTaskCount===0)return task;
    await sleep(5);
  }
  throw Error('Synthetic task did not settle: '+JSON.stringify({state:app.runtime.getTask(id).state,active:app.activeTaskCount,
    children:app.readSubagentTasks(id).map(child=>({state:child.state,code:child.error?.code}))}));
}

test('catalog availability timeout fails before any cloud or tool start even with a possible write',async()=>{
  let calls=0,executions=0,release;
  const tool={descriptor:descriptor('external_write'),execute:async()=>{executions++;return {};}};
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools:[tool],competitionToolExports:exportsFor([tool]),
    competitionToolAvailability:[{toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>new Promise(resolve=>{release=resolve;})}],
    coordination:{execute:async()=>{calls++;return {kind:'text',text:'unreachable',verification:'mock'};}}});
  try {
    const id=await submit(app),task=await settled(app,id);
    assert.equal(task.state,'failed');assert.equal(task.error.code,'TIMEOUT');
    assert.equal(calls,0);assert.equal(executions,0);assert.deepEqual(app.runtime.readToolExecutions(id),[]);
    assert.equal(Boolean(app.runtime.loadCheckpoint(id,'competition-cloud-inflight')),false);
    release(true);await sleep(10);assert.equal(calls,0,'late catalog completion cannot start a failed task');
  }finally{app.close();}
});

test('ordinary text timeout with a write in the catalog fails without claiming success',async()=>{
  const tool={descriptor:descriptor('external_write'),execute:async()=>{throw Error('must not execute');}};
  let calls=0;
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools:[tool],competitionToolExports:exportsFor([tool]),
    competitionToolAvailability:[{toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true}],
    coordination:{execute:async()=>{calls++;return new Promise(()=>{});}}});
  try {
    const id=await submit(app),task=await settled(app,id);
    assert.equal(calls,1);assert.equal(task.state,'failed');assert.equal(task.error.code,'TIMEOUT');
    assert.equal(app.runtime.readToolExecutions(id).length,0);
  }finally{app.close();}
});

async function trackedRun({sideEffect='external_write',tracked=true,before,execute}={}) {
  const policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy,now:Date.now});
  if(execute)gateway.register({descriptor:descriptor(sideEffect),execute});
  const runtime=new TaskRuntime(':memory:',{toolGateway:gateway}),task=runtime.submitTask({goal:'Synthetic tracked timeout',conversationId:'fixture',idempotencyKey:'tracked'});
  const deadline=new Date(Date.now()+100).toISOString();
  policy.grant({authorizationRef:'fixture-grant',taskId:task.taskId,toolName:'fixture.action',scopes:['fixture:use'],expiresAt:deadline});
  try {
    const result=await runtime.runTask(task.taskId,async context=>{
      if(tracked)context.declareRuntimeToolTracking();
      before?.(runtime,task.taskId);
      if(execute)await runtime.send({kind:'request',protocolVersion:'1.0.0',requestId:'fixture-tool-request',taskId:task.taskId,
        operation:'tool.invoke',deadline,idempotencyKey:'fixture-run',payload:{toolName:'fixture.action',toolVersion:'1.0.0',arguments:{},scopeRef:'fixture-grant'}},context.signal);
      await new Promise((_resolve,reject)=>context.signal.addEventListener('abort',()=>reject(new ProtocolError('CANCELLED','Synthetic abort')),{once:true}));
      return {resultSummary:'unreachable'};
    },{deadline,sideEffect});
    return {result,records:runtime.readToolExecutions(task.taskId)};
  }finally{runtime.close();}
}
test('generic host workers retain conservative write timeout handling without the trusted declaration',async()=>{
  const {result}=await trackedRun({tracked:false});assert.equal(result.state,'waiting_reconciliation');assert.equal(result.error.code,'RESULT_UNKNOWN');
});
test('a real started write retains unknown outcome and its execution identity',async()=>{
  let executions=0;
  const {result,records}=await trackedRun({execute:async()=>{executions++;return new Promise(()=>{});}});
  assert.equal(executions,1);assert.equal(result.state,'waiting_reconciliation');assert.equal(result.error.code,'RESULT_UNKNOWN');
  assert.equal(records.length,1);assert.equal(records[0].executionStarted,true);assert.equal(records[0].evidenceId,'fixture-run');
});
test('an independently confirmed read followed by timeout fails while retaining its original result record',async()=>{
  const {result,records}=await trackedRun({sideEffect:'read',execute:async()=>({})});
  assert.equal(result.state,'failed');assert.equal(result.error.code,'TIMEOUT');
  assert.equal(records[0].state,'confirmed');assert.equal(records[0].executionStarted,true);
});
for(const key of ['competition-cloud-inflight','competition-cloud-received','competition-cloud-unknown','competition-export-withheld']) {
  test(`a ${key} hold cannot become an ordinary timeout failure`,async()=>{
    const {result}=await trackedRun({before:(runtime,id)=>runtime.saveCheckpoint(id,key,{synthetic:true})});
    assert.equal(result.state,'waiting_reconciliation');assert.equal(result.error.code,'RESULT_UNKNOWN');
  });
}
test('an unregistered pending worker and a failed evidence read both retain unknown',async()=>{
  for(const before of [(runtime,id)=>runtime.saveCheckpoint(id,'competition-loop',{pending:{toolName:'untracked.worker',toolVersion:'1.0.0'}}),
    runtime=>{const load=runtime.loadCheckpoint.bind(runtime);runtime.loadCheckpoint=(id,key)=>{if(key==='competition-cloud-inflight')throw Error('Synthetic unavailable');return load(id,key);};}]) {
    const {result}=await trackedRun({before});assert.equal(result.state,'waiting_reconciliation');
  }
});

test('a tracked parent cannot waive an active or failed child using a different host execution path',async()=>{
  for(const failedChild of [false,true]) {
  const runtime=new TaskRuntime(':memory:'),parent=runtime.submitTask({goal:'Synthetic parent',conversationId:'fixture',idempotencyKey:'parent'});
  const child=runtime.submitTaskWithCheckpoint({goal:'Synthetic other host',conversationId:`desktop-subtask:${parent.taskId}`,
    idempotencyKey:`subagent-dispatch-${parent.taskId}-other`},'subtask-parent',{parentTaskId:parent.taskId,subtaskId:'other'});
  let childExecution;
  const wait=context=>new Promise((_resolve,reject)=>context.signal.addEventListener('abort',()=>reject(new Error('Synthetic abort')),{once:true}));
  try {
    const result=await runtime.runTask(parent.taskId,async context=>{
      context.declareRuntimeToolTracking();
      childExecution=runtime.runTask(child.taskId,failedChild?async()=>{await sleep(20);throw Error('Synthetic other host failure');}:wait,
        {deadline:new Date(Date.now()+150).toISOString(),sideEffect:'external_write'});
      return wait(context);
    },{deadline:new Date(Date.now()+100).toISOString(),sideEffect:'external_write'});
    assert.equal(result.state,'waiting_reconciliation');assert.equal((await childExecution).state,failedChild?'failed':'waiting_reconciliation');
  }finally{runtime.close();}
  }
});

function delegatedFixture(startedWrite=true) {
  let app,executions=0,cloudCalls=0;
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const write={descriptor:descriptor('external_write'),execute:async()=>{executions++;return new Promise(()=>{});}},tools=[dispatch,write];
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,tools,
    automaticTools:[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version}],
    competitionToolExports:exportsFor(tools),competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,
      toolVersion:tool.descriptor.version,available:({taskId})=>!startedWrite&&tool===write
        &&app.runtime.getTask(taskId).conversationId.startsWith('desktop-subtask:')?new Promise(()=>{}):true,
      ...(tool===dispatch?{publicEnumPaths:['/subtasks/*/role']}: {})})),
    coordination:{execute:async()=>{cloudCalls++;return {kind:'tool_proposal',proposalId:'child-write',toolName:write.descriptor.name,
      toolVersion:write.descriptor.version,arguments:{},verification:'unverified'};}}});
  return {app,counts:()=>({executions,cloudCalls})};
}
async function approveChild(app,id) {
  let child;
  for(let i=0;i<100;i++){child=app.readSubagentTasks(id)[0];if(child?.state==='waiting_approval')break;await sleep(2);}
  assert.equal(child?.state,'waiting_approval');
  const approval=app.runtime.getApproval(`competition-tool-${child.taskId}-1`);
  const decision=await app.send({kind:'request',protocolVersion:'1.0.0',requestId:'fixture-approval',operation:'authorization.respond',
    deadline:new Date(Date.now()+1000).toISOString(),payload:{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'}},new AbortController().signal);
  assert.equal(decision.outcome,'ok');
}
for(const startedWrite of [false,true])test(`actual delegated parent keeps child timeout classification (started write=${startedWrite})`,async()=>{
  const {app,counts}=delegatedFixture(startedWrite);
  try {
    const id=await submit(app,'delegated',400);
    if(startedWrite)await approveChild(app,id);
    const parent=await settled(app,id),[child]=app.readSubagentTasks(id);
    assert.ok(child);assert.equal(parent.state,startedWrite?'waiting_reconciliation':'failed');
    assert.equal(parent.error?.code,startedWrite?'RESULT_UNKNOWN':'TIMEOUT');
    if(startedWrite){assert.equal(child.state,'waiting_reconciliation');assert.deepEqual(counts(),{executions:1,cloudCalls:1});}
    else {assert.ok(['failed','cancelled'].includes(child.state));assert.deepEqual(counts(),{executions:0,cloudCalls:0});}
  }finally{app.close();}
});

test('a changed original dispatch digest cannot promote its parent from approval to reconciliation',async()=>{
  const {app}=delegatedFixture();
  try {
    const id=await submit(app,'changed-dispatch',400);await settled(app,id,true);
    const original=app.runtime.loadCheckpoint(id,'subagent-parent-wait');
    app.runtime.saveCheckpoint(id,'subagent-parent-wait',{...original,argumentsDigest:'0'.repeat(64)});
    await approveChild(app,id);const parent=await settled(app,id,true),[child]=app.readSubagentTasks(id);
    assert.equal(child.state,'waiting_reconciliation');assert.equal(parent.state,'waiting_approval');
  }finally{app.close();}
});
test('an unrelated child cannot promote a waiting parent even when its checkpoint names that parent',async()=>{
  const {app,counts}=delegatedFixture();
  try {
    const id=await submit(app,'foreign-child',400);await settled(app,id,true);
    const foreign=app.runtime.submitTaskWithCheckpoint({goal:'Synthetic unrelated task',conversationId:'unrelated',idempotencyKey:'foreign'},
      'subtask-parent',{parentTaskId:id,subtaskId:'user-work'});
    app.runtime.transitionTask(foreign.taskId,'planning');app.runtime.transitionTask(foreign.taskId,'running');
    app.runtime.transitionTask(foreign.taskId,'waiting_reconciliation');await app.refreshSubagentParent(foreign.taskId);
    assert.equal(app.runtime.getTask(id).state,'waiting_approval');assert.deepEqual(counts(),{executions:0,cloudCalls:1});
  }finally{app.close();}
});

function cloudOptions(tools,factory) {
  return {path:':memory:',gatewayUrl:'https://synthetic.invalid',runtimeName:'synthetic',transport:'wss',
    websocketUrl:'wss://synthetic.invalid/runtimes/synthetic/ws',allowHttpsFallback:false,
    authorizationProvider:{read:async()=>'Bearer synthetic'},websocketAuthorizationProvider:{read:async()=>'Bearer synthetic'},
    websocketFactory:factory,fetchImpl:async()=>{throw Error('Synthetic test forbids real fetch');},
    responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',tools,
    competitionToolExports:exportsFor(tools),competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,
      toolVersion:tool.descriptor.version,available:()=>true,...(tool.descriptor.name==='subagent.dispatch'?{publicEnumPaths:['/subtasks/*/role']}: {})}))};
}
test('actual never-sent WSS adapter failure makes both a delegated child and read-only parent fail without timeout',async()=>{
  let app,connections=0,executions=0;
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const unused={descriptor:descriptor('external_write'),execute:async()=>{executions++;return {};}};
  app=createAgentArtsRuntimeApplication({...cloudOptions([dispatch,unused],()=>{connections++;throw Error('Synthetic connect failure');}),
    delegateUserTasks:true,automaticTools:[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version}]});
  try {
    const id=await submit(app,'never-sent-parent',5000),parent=await settled(app,id),[child]=app.readSubagentTasks(id);
    assert.equal(child.state,'failed');assert.equal(child.error.code,'EXTERNAL_FAILURE');
    assert.equal(parent.state,'failed');assert.equal(parent.error.code,'EXTERNAL_FAILURE');
    assert.equal(connections,2);assert.equal(executions,0);
    assert.equal(Boolean(app.runtime.loadCheckpoint(id,'competition-export-withheld')),false);
    assert.equal(Boolean(app.runtime.loadCheckpoint(child.taskId,'competition-cloud-inflight')),false);
  }finally{app.close();}
});
for(const sideEffect of ['read','local_write'])test(`typed never-sent continuation failure respects confirmed ${sideEffect} effects`,async()=>{
  let connections=0,executions=0;
  const tool={descriptor:descriptor(sideEffect),execute:async()=>{executions++;return {};}};
  const app=createAgentArtsRuntimeApplication({...cloudOptions([tool],()=>{
    if(++connections>1)throw Error('Synthetic later connect failure');
    return new SyntheticWebSocket((frame,socket)=>{
      if(frame.type!=='invoke')return;
      socket.accepted(frame);socket.result(frame,JSON.stringify({kind:'tool_proposal',proposalId:'original-tool',
        toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:{}}));
      queueMicrotask(()=>socket.disconnect());
    });
  }),automaticTools:[{toolName:tool.descriptor.name,toolVersion:tool.descriptor.version}]});
  try {
    const id=await submit(app,'never-sent-continuation',5000),task=await settled(app,id),records=app.runtime.readToolExecutions(id);
    assert.equal(executions,1);assert.equal(connections,2);assert.equal(records[0].state,'confirmed');
    assert.equal(task.state,sideEffect==='read'?'failed':'waiting_reconciliation');
    assert.equal(task.error.code,sideEffect==='read'?'EXTERNAL_FAILURE':'UNAUTHORIZED');
    assert.equal(Boolean(app.runtime.loadCheckpoint(id,'competition-export-withheld')),sideEffect!=='read');
  }finally{app.close();}
});
test('an actual sent WSS invocation with unknown outcome retains the original cloud hold',async()=>{
  const tool={descriptor:descriptor('external_write'),execute:async()=>{throw Error('must not execute');}};
  const app=createAgentArtsRuntimeApplication(cloudOptions([tool],()=>new SyntheticWebSocket((frame,socket)=>{
    if(frame.type!=='invoke')return;socket.accepted(frame);socket.disconnect();
  })));
  try {
    const id=await submit(app,'sent-unknown',5000),task=await settled(app,id);
    assert.equal(task.state,'waiting_reconciliation');assert.equal(task.error.code,'RESULT_UNKNOWN');
    assert.equal(app.runtime.loadCheckpoint(id,'competition-cloud-unknown').accepted,true);
    assert.equal(app.runtime.readToolExecutions(id).length,0);
  }finally{app.close();}
});
test('a generic adapter error after a confirmed read does not gain the never-sent exemption',async()=>{
  const tool={descriptor:descriptor('read'),execute:async()=>({})};
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools:[tool],competitionToolExports:exportsFor([tool]),
    automaticTools:[{toolName:tool.descriptor.name,toolVersion:tool.descriptor.version}],
    competitionToolAvailability:[{toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true}],
    coordination:{execute:async request=>{if(request.continuation)throw new ProtocolError('EXTERNAL_FAILURE','Synthetic generic error');
      return {kind:'tool_proposal',proposalId:'original',toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:{},verification:'unverified'};}}});
  try {
    const id=await submit(app,'generic-adapter',5000),task=await settled(app,id);
    assert.equal(task.state,'waiting_reconciliation');assert.equal(task.error.code,'UNAUTHORIZED');
    assert.equal(app.runtime.loadCheckpoint(id,'competition-export-withheld').withheld,true);
  }finally{app.close();}
});
