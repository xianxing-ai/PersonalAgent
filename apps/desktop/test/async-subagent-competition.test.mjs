import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication,createDesktopSubagentDispatchTool,createDesktopAsyncSubagentTools} from '@personal-agent/runtime/application';
import {additiveConversationBindings} from '../electron/additive-conversation-tools.js';
import {deliverSubagentReport} from '../electron/async-subagent-host.js';
import {Conversations} from '../electron/conversations.js';

const until=async(predicate,detail)=>{for(let i=0;i<1000;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error(detail());};

test('Competition async work keeps original user authority, bounded type context and workspace ownership after the turn finishes',async t=>{
  let app,reads=0;
  const conversations=new Conversations(),conversationId=conversations.create('workspace','original').id;
  conversations.create('panel','unrelated');
  const host={competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)};
  // Main constructs the tool hosts before assigning the Runtime application.
  const controller=createDesktopAsyncSubagentTools({...host,onReport:report=>deliverSubagentReport(conversations,
    {...report,messageId:'report-'+report.taskId})});
  const read={descriptor:{name:'fixture.async.read',version:'1.0.0',sideEffect:'read',requiredScopes:['fixture:read'],
    inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object'},
    requiresPresence:false,idempotencySupport:true,recoverySupport:true},execute:async()=>{reads++;return {public:'fixture'};}};
  const dispatch=createDesktopSubagentDispatchTool(host),tools=[dispatch,...controller.tools,read];
  const additive=additiveConversationBindings(controller.tools,()=>app.runtime),requests=[];
  const port=new FakeCoordinationPort(request=>{
    requests.push(request);
    const binding=app.runtime.loadCheckpoint(request.taskId,'subtask-parent');
    if(binding?.subtaskId==='user-work')return request.continuation?{kind:'text',text:'已排队',verification:'mock'}:
      {kind:'tool_proposal',proposalId:'spawn-original',toolName:'subagent.spawn',toolVersion:'1.0.0',verification:'mock',arguments:{subtasks:[
        {subtaskId:'background',typeName:'bounded-notes',goal:'只读说明',thinkingDepth:2},
        {subtaskId:'foreign-proof',role:'researcher',goal:'不得运行'}]}};
    if(binding?.subtaskId==='background')return request.continuation?{kind:'text',text:'原工作区结果',verification:'mock'}:
      {kind:'tool_proposal',proposalId:'original-read',toolName:read.descriptor.name,toolVersion:'1.0.0',arguments:{},verification:'mock'};
    assert.equal(binding,undefined,'a foreign async proof must never reach the model');
    return {kind:'text',text:'已交给后台',verification:'mock'};
  });
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,coordination:port,
    coordinationBinding:'synthetic-original',tools,automaticTools:[dispatch,...controller.tools.filter(tool=>tool.descriptor.name==='subagent.spawn')]
      .map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version})),
    competitionToolAvailability:[...additive.availability,...[dispatch,read].map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true}))],
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'fixture-v1',accepts:()=>true,project:({result})=>result}))});
  t.after(()=>app.close());
  const proposal=controller.registry.propose({kind:'create',definition:{name:'bounded-notes',description:'只读笔记',instructions:'只读取已批准内容，不删除',
    allowedTools:[read.descriptor.name],baseRole:'researcher',maxSteps:2,deadlineMs:30000,enabled:true}},[read.descriptor.name]);
  controller.registry.confirm(proposal.proposalId,proposal.digest,[read.descriptor.name]);
  const client=new Client(app);await client.connect();
  const parent=await client.call('task.submit',{goal:'后台读取说明',conversationId},{idempotencyKey:'original-async',timeoutMs:120000});
  const detail=()=>JSON.stringify({tasks:app.runtime.listTasks({limit:100}).items.map(task=>({id:task.taskId,state:task.state,error:task.error,
    binding:app.runtime.loadCheckpoint(task.taskId,'subtask-parent')?.subtaskId,
    diagnostic:app.runtime.loadCheckpoint(task.taskId,'competition-coordination-failure')})),requests:requests.map(request=>({taskId:request.taskId,goal:request.goal}))});
  await until(()=>app.runtime.getTask(parent.taskId).state==='succeeded'&&app.activeTaskCount===0,detail);
  const child=app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-background`);
  const foreign=app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-foreign-proof`);
  assert.ok(child);assert.ok(foreign);
  const marker=app.runtime.loadCheckpoint(child.taskId,'async-subagent-spawn:v1');
  assert.notEqual(marker.sourceTaskId,parent.taskId);assert.ok(marker.sourceRunId);assert.ok(marker.sourceInputDigest);
  assert.ok(Date.parse(marker.deadline)<Date.parse(app.runtime.loadCheckpoint(child.taskId,'subtask-parent').parentDeadline));
  assert.deepEqual(controller.instruct(parent.taskId,'background','不要发送，保留条件整句',0),{revision:1});
  app.runtime.saveCheckpoint(foreign.taskId,'async-subagent-spawn:v1',{
    ...app.runtime.loadCheckpoint(foreign.taskId,'async-subagent-spawn:v1'),sourceInputDigest:'foreign'});
  const availability=additive.availability.find(item=>item.toolName==='subagent.spawn');
  assert.equal(await availability.available({taskId:marker.sourceTaskId}),true);
  assert.equal(await availability.available({taskId:child.taskId}),false);
  await assert.rejects(controller.tools.find(tool=>tool.descriptor.name==='subagent.spawn').execute({subtasks:[{subtaskId:'nested',role:'planner',goal:'reject'}]},
    {taskId:child.taskId,runId:'forbidden',authorizationRef:'forbidden',deadline:marker.deadline,signal:new AbortController().signal,scopes:['agent:delegate']}),{code:'INVALID_ARGUMENT'});
  await controller.pump();
  await until(()=>app.runtime.getTask(child.taskId).state==='waiting_approval'&&!app.runtime.isTaskActive(child.taskId),detail);
  assert.equal(app.runtime.getTask(foreign.taskId).state,'failed');assert.equal(reads,0);
  assert.throws(()=>controller.instruct(parent.taskId,'background','在途不得假接受',1),{code:'UNSUPPORTED_CAPABILITY'});
  const request=requests.find(value=>value.taskId===child.taskId);
  assert.match(request.goal,/不可信补充上下文/);assert.match(request.goal,/只读取已批准内容，不删除/);assert.match(request.goal,/不要发送，保留条件整句/);
  assert.deepEqual(request.availableTools.map(tool=>tool.name??tool.toolName),[read.descriptor.name]);
  assert.equal(request.deadline,marker.deadline);assert.equal(app.runtime.loadCheckpoint(child.taskId,'competition-max-steps'),2);
  const approval=app.runtime.listApprovals({taskId:child.taskId,state:'pending'}).items[0];assert.ok(approval);
  await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
  await until(()=>app.runtime.getTask(child.taskId).state==='succeeded'&&!app.runtime.isTaskActive(child.taskId),detail);
  assert.equal(reads,1);await controller.pump();await controller.pump();
  const messages=conversations.messagesFor('workspace',conversationId);assert.equal(messages.length,2);
  const completed=messages.filter(message=>message.id==='report-'+child.taskId);assert.equal(completed.length,1);assert.match(completed[0].text,/原工作区结果/);
  assert.equal(conversations.messagesFor('panel').length,0);
  assert.deepEqual(deliverSubagentReport(conversations,{conversationId:'missing-original',messageId:'missing',summary:'不得改投'}),{pending:true});
  assert.equal(conversations.messagesFor('panel').length,0);
});
