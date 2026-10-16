import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeApplication,createDesktopSubagentDispatchTool} from '../dist/application.js';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {Client} from '@personal-agent/client';
test('catalog selection failure after acceptance leaves a failed task and never falls back',async()=>{
  let sends=0;
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
    readDefaultExecutionModel(){throw Error('private catalog error');},
    coordination:new FakeCoordinationPort(()=>{sends++;return {kind:'text',text:'unexpected',verification:'mock'};})});
  const client=new Client(app,Date.now);
  try {
    await client.connect();
    const accepted=await client.call('task.submit',{goal:'hello',conversationId:'desktop-workspace'},{idempotencyKey:'missing-catalog',timeoutMs:5000});
    const task=app.runtime.getTask(accepted.taskId);
    assert.equal(task.state,'failed');assert.equal(sends,0);assert.equal(task.error.code,'UNSUPPORTED_CAPABILITY');assert.doesNotMatch(task.error.message,/private catalog error/);
  } finally {app.close();}
});
test('Competition explicit child selection is checkpointed and dispatched on the same cloud port',async()=>{
  const selection={catalogRevision:'a'.repeat(64),modelId:'selected-cloud',reasoningEffort:'high'};
  const requests=[];
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
    coordination:new FakeCoordinationPort(request=>{requests.push(request);return {kind:'text',text:'cloud child',verification:'mock'};}),
    resolveExecutionModel:value=>{assert.equal(value.modelId,selection.modelId);assert.equal(value.reasoningEffort,'high');return selection;},
    subagentModels:{getModelGateway(){throw Error('Competition may not call the API model');}}});
  try {
    const parent=app.runtime.submitTask({goal:'parent',conversationId:'conversation',idempotencyKey:'parent'});
    const tool=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
      runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools),
      getModelGateway(){throw Error('Desktop wrapper must preserve Competition-only dispatch');}});
    const result=await tool.execute({subtasks:[{subtaskId:'child',role:'coder',goal:'child',model:selection.modelId,reasoningEffort:'high',thinkingDepth:0}]},
      {taskId:parent.taskId,runId:'dispatch',authorizationRef:'parent',scopes:['agent:delegate'],signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()});
    assert.equal(result.succeeded,1);assert.deepEqual(requests[0].executionModel,selection);
    const child=app.readSubagentTasks(parent.taskId)[0];assert.equal(child.modelId,selection.modelId);assert.equal(child.reasoningEffort,'high');assert.equal(child.state,'succeeded');
    assert.deepEqual(app.runtime.loadCheckpoint(child.taskId,'execution-model'),selection);
    assert.equal(app.runtime.loadCheckpoint(child.taskId,'subtask-parent').reasoningEffort,'high');
    await assert.rejects(tool.execute({subtasks:[{subtaskId:'child',role:'coder',goal:'child',model:selection.modelId,reasoningEffort:'low',thinkingDepth:0}]},
      {taskId:parent.taskId,runId:'dispatch',authorizationRef:'parent',scopes:['agent:delegate'],signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()}),{code:'REVISION_CONFLICT'});
  } finally {app.close();}
});
