import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {ModelGateway, FakeModelProvider} from '@personal-agent/models';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication, createDesktopSubagentDispatchTool,
  SUBAGENT_DISPATCH_TOOL_NAME, SUBAGENT_DISPATCH_TOOL_VERSION} from '../dist/application.js';

const descriptor = {name:'fixture.approved-child',version:'1.0.0',
  inputSchema:{type:'object',required:['value'],additionalProperties:false,properties:{value:{type:'string'}}},
  outputSchema:{type:'object',required:['value'],additionalProperties:false,properties:{value:{type:'string'}}},
  sideEffect:'read',requiredScopes:['fixture:read'],requiresPresence:false,idempotencySupport:true,recoverySupport:true};
async function until(predicate) {
  for(let attempt=0;attempt<200;attempt++) {if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}
  throw Error('Expected persisted state was not reached');
}

test('child approval resumes the original child and confirmed parent dispatch, then continues the cloud once',async t=>{
  let app,calls=0;
  // Competition children retain the original cloud invocation, including approval recovery.
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools),
    getModelGateway:()=>{throw Error('Competition approval must not use an independent API');}});
  const port=new FakeCoordinationPort(request=>{
    if(app.runtime.getTask(request.taskId).conversationId.startsWith('desktop-subtask:')) {
      if(!request.continuation)return {kind:'tool_proposal',proposalId:'approved-child-read',toolName:descriptor.name,
        toolVersion:descriptor.version,arguments:{value:'approved'},verification:'mock'};
      assert.deepEqual(request.continuation.result,{value:'approved'});
      return {kind:'text',text:'confirmed child answer',verification:'mock'};
    }
    if(!request.continuation) return {kind:'tool_proposal',proposalId:'dispatch-one',
      toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION,
      arguments:{subtasks:[{subtaskId:'child',role:'researcher',goal:'Read approved synthetic value'}]},verification:'mock'};
    assert.equal(request.continuation.state,'confirmed');
    assert.equal(request.continuation.result.succeeded,1);
    assert.equal(request.continuation.result.failed,0);
    assert.match(request.continuation.result.summary,/confirmed child answer/);
    return {kind:'text',text:'parent confirmed refreshed child answer',verification:'mock'};
  });
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',coordination:port,
    tools:[dispatch,{descriptor,execute:async input=>{calls++;return input;}}],
    automaticTools:[{toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION}]});
  t.after(()=>app.close());
  const client=new Client(app,Date.now);await client.connect();
  const parent=await client.call('task.submit',{goal:'Delegate and wait for real child result',conversationId:'competition'},
    {idempotencyKey:'parent-child-recovery'});
  await until(()=>app.runtime.getTask(parent.taskId).state==='waiting_approval'&&app.activeTaskCount===0);
  const child=app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-child`);
  assert.equal(child.state,'waiting_approval');assert.equal(calls,0);assert.equal(port.requests.length,2);
  const parentRecord=app.runtime.readToolExecutions(parent.taskId);
  assert.equal(parentRecord.length,1);assert.equal(parentRecord[0].state,'confirmed');
  const approval=app.runtime.getApproval(`competition-tool-${child.taskId}-1`);
  await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
  await until(()=>['succeeded','failed'].includes(app.runtime.getTask(parent.taskId).state)&&app.activeTaskCount===0);
  const result=app.runtime.getTask(parent.taskId);
  assert.equal(result.state,'succeeded',JSON.stringify(result.error));
  assert.equal(app.runtime.getTask(child.taskId).state,'succeeded');assert.equal(calls,1);
  assert.equal(port.requests.length,4);
  assert.equal(app.runtime.readToolExecutions(parent.taskId).length,1);
  assert.equal(app.runtime.readToolExecutions(child.taskId).length,1);
  assert.ok(result.evidenceRefs.includes(approval.approvalId));
  assert.match(app.runtime.loadCheckpoint(parent.taskId,'subagent-current-summary').summary,/confirmed child answer/);
  assert.throws(()=>app.resumeTask(child.taskId),{code:'REVISION_CONFLICT'});
  assert.equal(calls,1);
});

for(const action of ['deny','cancel']) test(`terminal child ${action} refreshes the waiting parent without executing its tool`,async t=>{
  let app,calls=0;
  const gateway=new ModelGateway(new FakeModelProvider([
    ()=>({kind:'tool_proposal',proposal:{toolName:descriptor.name,toolVersion:descriptor.version,arguments:{value:'never'}}}),
  ]));
  const selection={getModelGateway:()=>gateway};
  const dispatch=createDesktopSubagentDispatchTool({getRuntime:()=>app.runtime,getTools:()=>app.tools,...selection});
  const port=new FakeCoordinationPort(request=>!request.continuation ? {kind:'tool_proposal',proposalId:'one',
    toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION,
    arguments:{subtasks:[{subtaskId:'child',role:'researcher',goal:'synthetic read'}]},verification:'mock'} : (()=>{
      assert.equal(request.continuation.result.cancelled,1);assert.equal(request.continuation.result.succeeded,0);
      return {kind:'text',text:'Child cancelled; no action completed',verification:'mock'};
    })());
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',coordination:port,subagentModels:selection,
    tools:[dispatch,{descriptor,execute:async input=>{calls++;return input;}}],
    automaticTools:[{toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION}]});
  t.after(()=>app.close());
  const client=new Client(app,Date.now);await client.connect();
  const {taskId}=await client.call('task.submit',{goal:'Delegate',conversationId:'competition'},{idempotencyKey:action});
  await until(()=>app.runtime.getTask(taskId).state==='waiting_approval'&&app.activeTaskCount===0);
  const child=app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${taskId}-child`);
  if(action==='deny') {
    const approval=app.runtime.getApproval(`agent-run-${child.taskId}-1`);
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'deny'});
  } else await client.call('task.cancel',{taskId:child.taskId,reason:'Cancel child'});
  await until(()=>['succeeded','failed'].includes(app.runtime.getTask(taskId).state)&&app.activeTaskCount===0);
  assert.equal(app.runtime.getTask(taskId).state,'succeeded');assert.equal(app.runtime.getTask(child.taskId).state,'cancelled');
  assert.equal(calls,0);assert.equal(port.requests.length,2);assert.equal(app.runtime.readToolExecutions(taskId).length,1);
});
