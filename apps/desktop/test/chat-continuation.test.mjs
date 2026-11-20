import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication,createDesktopSubagentDispatchTool,compileCoordinationGoal} from '@personal-agent/runtime/application';
import {projectSubagentResult} from '../electron/subagent-result-projection.js';

for(const clarification of [false,true,'long'])for(const childFailure of [false,true])test(`Synthetic delegated chat sends ${clarification==='long'?'long clarification context':clarification?'clarification context':'the original request'} to the child and returns its ${childFailure?'failure':'reply'}`,async()=>{
 let app,childCalls=0;
 const responseText='哈喽！有什么我可以帮你的吗？';
 const goal=clarification?'在青岛':'哈喽';
 const context=clarification?[{id:'previous-user',role:'user',content:'今天穿什么出门'+(clarification==='long'?'中'.repeat(119000)+'末尾约束':'')},
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
   assert.equal(query.continuation,undefined,'only the child calls AgentArts');
   childCalls++;
   assert.match(query.goal,clarification?/在青岛/:/哈喽/);
   if(clarification==='long')assert.ok(query.goal.length>119000);
   if(childFailure)throw Error('Synthetic cloud child unavailable');
   return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify({kind:'text',text:responseText}),index:0}}),{status:200,headers:{'content-type':'application/json'}});
  }});
 try{
  const client=new Client(app,Date.now);await client.connect();
  const {taskId}=await client.call('task.submit',{goal,conversationId:'desktop-panel:synthetic-chat'},{idempotencyKey:'synthetic-chat',timeoutMs:15000});
  const deadline=Date.now()+15000;
  while(!['succeeded','failed','waiting_reconciliation'].includes(app.runtime.getTask(taskId).state)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  const task=app.runtime.getTask(taskId);
  assert.equal(task.state,childFailure?'failed':'succeeded',JSON.stringify({error:task.error,children:app.readSubagentTasks(taskId)}));
  assert.equal(childCalls,1);
  const [child]=app.readSubagentTasks(taskId);
  if(childFailure) {
   assert.equal(task.error.code,'EXTERNAL_FAILURE');
   assert.match(task.error.message,/任务执行未完成.*子任务错误/);
   assert.equal(task.resultSummary,undefined);
   assert.equal(child.state,'failed');
  }else{
   assert.match(task.resultSummary,/^子助手已完成。执行记录和结果在子对话中。/u);
   assert.match(app.runtime.getTask(child.taskId).resultSummary,/哈喽！/);
  }
  const [receipt]=app.runtime.loadCheckpoint(taskId,'competition-loop').receipts;
  assert.equal(receipt.exportPolicyVersion,'1.2.0');
  const result=receipt.continuation.result;
  assert.equal(result.userRequest,compileCoordinationGoal(goal,goal,context));
  if(clarification){const request=JSON.parse(result.userRequest);assert.equal(request.publicGoal,'在青岛');
   assert.equal(request.conversationContext.treatment,'untrusted_data');
   assert.equal(request.conversationContext.messages[0].content,context[0].content);}
  if(clarification==='long')assert.ok(result.userRequest.length>119000);
  assert.equal(result.subtasks[0].state,childFailure?'failed':'succeeded');
  if(childFailure){assert.equal(result.failed,1);assert.equal(Object.hasOwn(result.subtasks[0],'result'),false);}
  else {assert.equal(result.subtasks[0].result,responseText);assert.deepEqual(result.subtasks[0].resultMetadata,{profile:'huawei_ict_agentarts',verification:'unverified'});}
  const execution=app.runtime.readToolExecutions(taskId)[0];
  assert.equal(execution.state,'confirmed');assert.equal(execution.policyDecision,'allow');assert.equal(execution.executionStarted,true);
 }finally{app.close();}
});
