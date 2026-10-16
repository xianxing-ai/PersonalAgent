import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeApplication,createAgentArtsRuntimeApplication,createDesktopSubagentDispatchTool} from '../dist/application.js';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {Client} from '@personal-agent/client';
import {projectSubagentResult} from '../../desktop/electron/subagent-result-projection.js';
for(const childFailure of [false,true])test(`factory strict Desktop projection continues parent after ${childFailure?'failed':'successful'} cloud child`,async()=>{
  let app,childCalls=0,toolReads=0,parentContinuations=0;
  const selected={catalogRevision:'a'.repeat(64),modelId:'child-model',reasoningEffort:'high'};
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const read={name:'fixture.read',version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false},
    outputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},
    sideEffect:'read',requiredScopes:['fixture:read'],requiresPresence:false,idempotencySupport:true,recoverySupport:true};
  const exports=[dispatch.descriptor,read].map(tool=>({toolName:tool.name,toolVersion:tool.version,exportPolicyVersion:'fixture-v1',accepts:()=>true,
    project:tool.name===dispatch.descriptor.name?projectSubagentResult:({result})=>result}));
  app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'dispatch-runtime',
    responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',
    readDefaultExecutionModel:()=>selected,resolveExecutionModel:selection=>{assert.equal(selection.reasoningEffort,'high');return selected;},
    tools:[dispatch,{descriptor:read,execute:async()=>{toolReads++;return {value:'read'};}}],
    automaticTools:[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version}],competitionToolExports:exports,
    competitionToolAvailability:[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version,
      publicEnumPaths:['/subtasks/*/role','/subtasks/*/reasoningEffort'],available:({taskId})=>!app.runtime.getTask(taskId).conversationId.startsWith('desktop-subtask:')},
      {toolName:read.name,toolVersion:read.version,available:()=>true}],
    authorizationProvider:{read:async()=>'Bearer synthetic'},fetchImpl:async(_url,init)=>{
      const query=JSON.parse(JSON.parse(init.body).query);let value;
      if(query.goal?.includes('Cloud delegated child')){
        childCalls++;assert.deepEqual(query.executionModel,selected);
        if(childFailure)throw Error('Synthetic provider failure');
        value={kind:'text',text:'56'};
      }
      else if(query.continuation){
        parentContinuations++;const result=query.continuation.result;
        assert.equal(result.succeeded,childFailure?0:1);assert.equal(result.failed,childFailure?1:0);
        assert.equal(result.subtasks[0].state,childFailure?'failed':'succeeded');
        assert.equal(Object.hasOwn(result.subtasks[0],childFailure?'result':'error'),false);
        value={kind:'text',text:childFailure?'Child failed; no calculation result verified':'confirmed 56'};
      }
      else {
        const schema=query.availableTools.find(tool=>tool.name==='subagent.dispatch').inputSchema.properties.subtasks.items.properties;
        assert.ok(schema.role.enum.includes('coder'));assert.ok(schema.reasoningEffort.enum.includes('high'));
        value={kind:'tool_proposal',proposalId:'dispatch',toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version,
          arguments:{subtasks:[{subtaskId:'child',role:'coder',goal:'Cloud delegated child',model:'child-model',reasoningEffort:'high',thinkingDepth:0}]}};
      }
      return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify(value),index:0}}),{status:200,headers:{'content-type':'application/json'}});
    }});
  try {
    const client=new Client(app,Date.now);await client.connect();
    const accepted=await client.call('task.submit',{goal:'Delegate',conversationId:'desktop-workspace'},{idempotencyKey:'factory-dispatch',timeoutMs:5000});
    for(let index=0;index<200 && !['succeeded','failed'].includes(app.runtime.getTask(accepted.taskId).state);index++)await new Promise(resolve=>setTimeout(resolve,5));
    const task=app.runtime.getTask(accepted.taskId);assert.equal(task.state,'succeeded',JSON.stringify(task.error));
    assert.equal(childCalls,1);assert.equal(parentContinuations,1);assert.equal(toolReads,0);
    assert.equal(app.readSubagentTasks(task.taskId)[0].state,childFailure?'failed':'succeeded');
    assert.equal(app.runtime.loadCheckpoint(task.taskId,'competition-export-withheld'),undefined);
    const saved=app.runtime.loadCheckpoint(task.taskId,'competition-loop');assert.equal(saved.receipts.length,1);
    assert.equal(saved.receipts[0].continuation.result.failed,childFailure?1:0);
    const record=app.runtime.readToolExecutions(task.taskId)[0];assert.equal(record.state,'confirmed');assert.equal(record.policyDecision,'allow');assert.equal(record.executionStarted,true);
  } finally {app.close();}
});
test('trusted factory carries selected model through the actual coordinator into invocation query',async()=>{
  const selected={catalogRevision:'a'.repeat(64),modelId:'deepseek-v4.1-flash',reasoningEffort:'low'},queries=[];
  const app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'selected-runtime',
    readDefaultExecutionModel:()=>selected,authorizationProvider:{read:async()=>'Bearer synthetic'},fetchImpl:async(_url,init)=>{
      queries.push(JSON.parse(JSON.parse(init.body).query));
      return new Response(JSON.stringify({event:'message',data:{text:'selected response',index:0}}),{status:200,headers:{'content-type':'application/json'}});
    }});
  try {
    const client=new Client(app,Date.now);await client.connect();
    const accepted=await client.call('task.submit',{goal:'hello',conversationId:'desktop-workspace'},{idempotencyKey:'factory-selection',timeoutMs:5000});
    for(let index=0;index<200 && app.runtime.getTask(accepted.taskId).state!=='succeeded';index++) {
      if(app.runtime.getTask(accepted.taskId).state==='failed')break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.equal(app.runtime.getTask(accepted.taskId).state,'succeeded');assert.deepEqual(queries,[{goal:'hello',availableTools:[],executionModel:selected}]);
  } finally {app.close();}
});
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
