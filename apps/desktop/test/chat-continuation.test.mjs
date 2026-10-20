import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication,createDesktopSubagentDispatchTool,compileCoordinationGoal} from '@personal-agent/runtime/application';
import {projectSubagentResult} from '../electron/subagent-result-projection.js';

for(const clarification of [false,true])for(const childFailure of [false,true])test(`Synthetic delegated chat exports ${clarification?'clarification context':'original request'} and ${childFailure?'failure':'clean reply'} through guarded continuation`,async()=>{
 let app,childCalls=0,parentCalls=0;
 const goal=clarification?'在青岛':'哈喽';
 const context=clarification?[{id:'previous-user',role:'user',content:'今天穿什么出门'},
  {id:'previous-assistant',role:'assistant',content:'请告诉我你在哪个城市。'}]:[];
 const selected={catalogRevision:'a'.repeat(64),modelId:'synthetic-chat-model'};
 const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
  runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
 const read={name:'fixture.read',version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false},
  outputSchema:{type:'object',properties:{}},sideEffect:'read',requiredScopes:[],requiresPresence:false,idempotencySupport:true,recoverySupport:true};
 app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic-chat',
  responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',delegateUserTasks:true,
  readDefaultExecutionModel:()=>selected,resolveExecutionModel:()=>selected,
  coordinationInput:{readConversationContext:async()=>context,beforeCoordinationSend:()=>{}},
  tools:[dispatch,{descriptor:read,execute:async()=>{assert.fail('Greeting must not execute the fixture tool');}}],automaticTools:[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version}],
  competitionToolAvailability:[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version,
   publicEnumPaths:['/subtasks/*/role','/subtasks/*/reasoningEffort'],available:({taskId})=>!app.runtime.getTask(taskId).conversationId.startsWith('desktop-subtask:')},
   {toolName:read.name,toolVersion:read.version,available:()=>true}],
  competitionToolExports:[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version,exportPolicyVersion:'1.2.0',accepts:()=>true,
   project:input=>projectSubagentResult({...input,userRequest:compileCoordinationGoal(
    app.runtime.loadCheckpoint(input.taskId,'required-subagent-delegation:v1').goal,goal,context)})},
   {toolName:read.name,toolVersion:read.version,exportPolicyVersion:'synthetic-read-v1',accepts:()=>true,project:({result})=>result}],
  authorizationProvider:{read:async()=>'Bearer synthetic'},fetchImpl:async(_url,init)=>{
   const raw=JSON.parse(init.body).query;
   let query;try{query=JSON.parse(raw);}catch{query={goal:raw};}
   let text;
   if(query.continuation){
    parentCalls++;
    const result=query.continuation.result;
    assert.equal(result.userRequest,compileCoordinationGoal(goal,goal,context));
    if(clarification){const request=JSON.parse(result.userRequest);assert.equal(request.publicGoal,'在青岛');
     assert.equal(request.conversationContext.treatment,'untrusted_data');
     assert.equal(request.conversationContext.messages[0].content,'今天穿什么出门');}
    assert.equal(result.subtasks[0].state,childFailure?'failed':'succeeded');
    if(childFailure){assert.equal(result.failed,1);assert.equal(Object.hasOwn(result.subtasks[0],'result'),false);}
    else {assert.equal(result.subtasks[0].result,'哈喽！有什么我可以帮你的吗？');assert.deepEqual(result.subtasks[0].resultMetadata,{profile:'huawei_ict_agentarts',verification:'unverified'});}
    text=childFailure?'这次回答失败，请稍后再试。':'哈喽！有什么我可以帮你的吗？';
   }else{
    childCalls++;
    assert.match(query.goal,clarification?/在青岛/:/哈喽/);
    if(childFailure)throw Error('Synthetic cloud child unavailable');
    text='哈喽！有什么我可以帮你的吗？';
   }
   return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify({kind:'text',text}),index:0}}),{status:200,headers:{'content-type':'application/json'}});
  }});
 try{
  const client=new Client(app,Date.now);await client.connect();
  const {taskId}=await client.call('task.submit',{goal,conversationId:'desktop-panel:synthetic-chat'},{idempotencyKey:'synthetic-chat',timeoutMs:15000});
  const deadline=Date.now()+15000;
  while(!['succeeded','failed','waiting_reconciliation'].includes(app.runtime.getTask(taskId).state)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  const task=app.runtime.getTask(taskId);
  assert.equal(task.state,'succeeded',JSON.stringify({error:task.error,children:app.readSubagentTasks(taskId)}));
  assert.equal(childCalls,1);assert.equal(parentCalls,1);
  assert.match(task.resultSummary,childFailure?/回答失败/:/哈喽！/);
  assert.equal(app.runtime.loadCheckpoint(taskId,'competition-loop').receipts[0].exportPolicyVersion,'1.2.0');
  const execution=app.runtime.readToolExecutions(taskId)[0];
  assert.equal(execution.state,'confirmed');assert.equal(execution.policyDecision,'allow');assert.equal(execution.executionStarted,true);
 }finally{app.close();}
});
