import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {createAgentArtsRuntimeApplication,createDesktopSubagentDispatchTool} from '../dist/application.js';
import {SyntheticWebSocket} from '../../../packages/coordination/test/fixtures/websocket.mjs';

// Actual Runtime/Policy/Gateway, forced user-work delegation and HTTP/WSS adapters.
// Network, tool effects and the cloud's choices are explicit offline fixtures.
const until=async predicate=>{for(let i=0;i<1000;i++){
  if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,5));
}throw Error('Synthetic child continuation did not settle');};
const descriptor=(name,sideEffect='read')=>({name,version:'1.0.0',sideEffect,requiredScopes:['fixture:bounded'],
  requiresPresence:false,recoverySupport:true,idempotencySupport:true,
  inputSchema:{type:'object',additionalProperties:false,required:['value'],properties:{value:{type:'integer',minimum:1,maximum:3}}},
  outputSchema:{type:'object',additionalProperties:false,required:['value'],properties:{value:{type:'integer'}}}});
const first=descriptor('fixture.first','local_write'),second=descriptor('fixture.second'),extra=descriptor('fixture.extra');
const text=value=>({kind:'text',text:value});
const proposal=(id,tool,args={value:1})=>({kind:'tool_proposal',proposalId:id,toolName:tool.name,toolVersion:tool.version,arguments:args});

test('opted-in ordinary user tasks retain their original directory both within a turn and after approval resume',async t=>{
  for(const optIn of [false,true])for(const needsApproval of [false,true])await t.test(`goal=${optIn}; approval=${needsApproval}`,async()=>{
    const requests=[],executions=[];
    const tools=[first,second].map(tool=>({descriptor:tool,execute:async args=>{executions.push(tool.name);return {value:args.value};}}));
    const app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'ordinary-continuation',
      responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',...(optIn?{continuationContext:'goal'}:{}),
      tools,competitionMaxSteps:4,authorizationProvider:{read:async()=> 'Bearer synthetic'},
      automaticTools:(needsApproval?[second]:[first,second]).map(tool=>({toolName:tool.name,toolVersion:tool.version})),
      competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true})),
      competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
        exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result})),
      fetchImpl:async(_url,init)=>{
        const query=JSON.parse(JSON.parse(init.body).query);requests.push(query);
        const answer=!query.continuation?proposal('ordinary-first',first)
          :query.continuation.proposalId==='ordinary-first'&&query.availableTools?proposal('ordinary-second',second)
          :text(query.continuation.proposalId==='ordinary-second'?'Both synthetic operations completed':'Legacy single-tool reply');
        return new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify(answer)}},{event:'task_end'},{event:'end'}]),
          {headers:{'content-type':'application/json'}});
      }});
    try{
      const client=new Client(app);await client.connect();
      const {taskId}=await client.call('task.submit',{goal:'Complete both synthetic operations',conversationId:'ordinary'},
        {idempotencyKey:'ordinary',timeoutMs:60000});
      if(needsApproval){await until(()=>app.runtime.getTask(taskId).state==='waiting_approval');
        const approval=(await client.call('approval.list',{taskId})).items.find(item=>item.state==='pending');
        await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});}
      await until(()=>['succeeded','failed','waiting_reconciliation'].includes(app.runtime.getTask(taskId).state)&&app.activeTaskCount===0);
      assert.equal(app.runtime.getTask(taskId).state,'succeeded');
      assert.deepEqual(executions,optIn?[first.name,second.name]:[first.name]);
      assert.equal(requests.length,optIn?3:2);
      if(optIn){assert.equal(requests[1].goal,requests[0].goal);assert.deepEqual(requests[1].availableTools,requests[0].availableTools);
        assert.deepEqual(requests[2].availableTools,requests[0].availableTools);}
      else assert.equal(requests[1].availableTools,undefined);
    }finally{app.close();}
  });
});

async function fixture(t,{transport='https',optIn=true,newTasks=false,legacyBeforeEnable=false,rootTool=false,budget=4,afterFirst,unknownSecond=false,proposeExtra=false,secondArguments={value:2},environment=false}={}) {
  let app,client,rootId,dispatchingTaskId;
  const requests=[],sends=[],executions=[],sockets=[],state={firstAllowed:true,extraReady:false,blockAvailability:false};
  let enteredAvailability;
  const availabilityEntered=new Promise(resolve=>{enteredAvailability=resolve;});
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const tools=[dispatch,...[first,second,extra].map(tool=>({descriptor:tool,async execute(args,context){
    executions.push({toolName:tool.name,taskId:context.taskId,args:structuredClone(args)});
    if(tool.name===first.name)await afterFirst?.(state,app,context.taskId);
    if(tool.name===second.name&&unknownSecond)throw new ProtocolError('RESULT_UNKNOWN','Explicit Fake unknown result');
    return {value:args.value};
  }}))];
  function answer(query){
    sends.push({taskId:dispatchingTaskId,query:structuredClone(query)});
    if(!query.continuation)return proposal('child-first',first);
    if(query.continuation.proposalId==='child-first')return proposal('child-second',proposeExtra?extra:second,secondArguments);
    if(query.continuation.proposalId==='child-second')return text('Synthetic child completed both original operations');
    assert.match(query.continuation.proposalId,/^required-delegation-/u);
    return rootTool?proposal('forbidden-root-tool',second):text('Synthetic main conversation summarized the original child');
  }
  app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic-child',
    ...(environment?{coordinationInput:{beforeCoordinationSend(){},readRequestContext:()=>'{"environment":true}'}}:{}),
    responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',...(optIn?{continuationContext:'goal'}:{}),
    ...(newTasks?{enableNewTaskToolContinuations:true}:{}),
    delegateUserTasks:true,competitionMaxSteps:budget,tools,
    automaticTools:[dispatch.descriptor,second,extra].map(tool=>({toolName:tool.name,toolVersion:tool.version})),
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      publicEnumPaths:['/subtasks/*/role','/subtasks/*/reasoningEffort'],async available(){
        if(state.blockAvailability){enteredAvailability();return new Promise(()=>{});}
        return tool.descriptor.name!==extra.name||state.extraReady;
      }})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      exportPolicyVersion:'synthetic-original-v1',accepts:()=>tool.descriptor.name!==first.name||state.firstAllowed,
      project:({result})=>result})),
    authorizationProvider:{read:async()=>{if(state.revokeOnCredential)state.firstAllowed=false;return 'Bearer synthetic-outer';}},
    beforeCompetitionSend:request=>{dispatchingTaskId=request.taskId;requests.push({taskId:request.taskId,revision:request.revision,
      ...(request.availableTools?{availableTools:structuredClone(request.availableTools)}:{}),
      ...(request.continuation?{continuation:structuredClone(request.continuation)}:{})});},
    ...(transport==='wss'?{transport:'wss',websocketUrl:'wss://agentarts.example.test/runtimes/synthetic-child/ws',
      websocketAuthorizationProvider:{read:async()=> 'Bearer synthetic-inner'},websocketFactory:()=>{
        const socket=new SyntheticWebSocket((frame,connection)=>{
          if(frame.type==='cancel')return;
          assert.equal(frame.type,'invoke');connection.accepted(frame);connection.result(frame,JSON.stringify(answer(JSON.parse(frame.payload.query))));
        });sockets.push(socket);return socket;
      }}:{}),
    fetchImpl:async(_url,init)=>{assert.equal(transport,'https','WSS does not silently fall back');
      return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify(answer(JSON.parse(JSON.parse(init.body).query))),index:0}}),
        {headers:{'content-type':'application/json'}});}});
  if(legacyBeforeEnable)app.enableNewTaskToolContinuations=false;
  client=new Client(app);await client.connect();
  t.after(async()=>{await until(()=>app.activeTaskCount===0);app.close();});
  const submitted=await client.call('task.submit',{goal:'Complete two bounded dependent operations, then summarize',conversationId:'original-main'},
    {idempotencyKey:'original-user-work',timeoutMs:60_000});rootId=submitted.taskId;
  await until(()=>app.activeTaskCount===0);
  const [child]=app.readSubagentTasks(rootId);assert.ok(child);
  if(legacyBeforeEnable)app.enableNewTaskToolContinuations=true;
  assert.equal(app.runtime.getTask(child.taskId).state,'waiting_approval');assert.equal(executions.length,0);
  const originalCatalog=app.runtime.loadCheckpoint(child.taskId,'competition-tool-catalog');
  const approval=app.runtime.getApproval(`competition-tool-${child.taskId}-1`);
  async function approve(){await client.call('authorization.respond',{approvalId:approval.approvalId,
    expectedRevision:approval.revision,decision:'allow_once'});}
  return {app,client,rootId,childId:child.taskId,approval,originalCatalog,requests,sends,executions,state,sockets,approve,availabilityEntered,
    settle:()=>until(()=>app.activeTaskCount===0)};
}

for(const transport of ['https','wss'])test(`new delegated task pins its goal and original catalog across approval (${transport})`,async t=>{
  const f=await fixture(t,{transport,optIn:false,newTasks:true});
  assert.equal(f.app.usesGoalContinuation(f.rootId),true);
  assert.equal(f.app.usesGoalContinuation(f.childId),true);
  await f.approve();await f.settle();
  assert.equal(f.app.runtime.getTask(f.rootId).state,'succeeded');
  assert.equal(f.app.runtime.getTask(f.childId).state,'succeeded');
  assert.deepEqual(f.executions.map(item=>item.toolName),[first.name,second.name]);
  const sent=f.sends.filter(item=>item.taskId===f.childId);
  assert.equal(sent.length,3);
  for(const item of sent.filter(item=>item.query.continuation)) {
    assert.equal(item.query.goal,sent[0].query.goal);
    assert.deepEqual(item.query.availableTools,sent[0].query.availableTools);
  }
  assert.equal(f.requests.filter(item=>item.taskId===f.rootId)[0].availableTools,undefined);
});

test('an existing approval-waiting task keeps its legacy continuation when new-task mode is enabled',async t=>{
  const f=await fixture(t,{optIn:false,newTasks:true,legacyBeforeEnable:true});
  assert.equal(f.app.usesGoalContinuation(f.rootId),false);
  assert.equal(f.app.usesGoalContinuation(f.childId),false);
  await f.approve();await f.settle();
  assert.equal(f.app.runtime.getTask(f.childId).state,'succeeded');
  for(const item of f.sends.filter(item=>item.taskId===f.childId&&item.query.continuation)) {
    assert.equal(item.query.goal,undefined);assert.equal(item.query.availableTools,undefined);
  }
});

test('a changed persisted continuation binding cannot grant a later task a wider catalog',async t=>{
  const f=await fixture(t,{optIn:false,newTasks:true});
  const saved=f.app.runtime.loadCheckpoint(f.childId,'competition-continuation-context:v1');
  f.app.runtime.saveCheckpoint(f.childId,'competition-continuation-context:v1',{...saved,taskId:f.rootId});
  assert.throws(()=>f.app.usesGoalContinuation(f.childId),{code:'REVISION_CONFLICT'});
  assert.equal(f.executions.length,0);
});

for(const transport of ['https','wss'])for(const environment of [false,true])test(`opt-in actual child carries its immutable initial catalog through approval and multiple tools (${transport}, environment=${environment})`,async t=>{
  const f=await fixture(t,{transport,environment});await f.approve();await f.settle();
  assert.equal(f.app.runtime.getTask(f.rootId).state,'succeeded',JSON.stringify(f.app.runtime.getTask(f.rootId).error));
  assert.equal(f.app.runtime.getTask(f.childId).state,'succeeded',JSON.stringify(f.app.runtime.getTask(f.childId).error));
  assert.deepEqual(f.executions.map(item=>item.toolName),[first.name,second.name]);
  assert.ok(f.executions.every(item=>item.taskId===f.childId));assert.equal(f.app.readSubagentTasks(f.rootId).length,1);
  const childRequests=f.requests.filter(request=>request.taskId===f.childId),rootRequests=f.requests.filter(request=>request.taskId===f.rootId);
  assert.equal(childRequests.length,3);assert.equal(rootRequests.length,1);assert.equal(rootRequests[0].availableTools,undefined);
  assert.ok(childRequests[1].revision>f.originalCatalog.revision,'approval changes current task revision');
  for(const request of childRequests)assert.deepEqual(request.availableTools,f.originalCatalog.entries);
  assert.deepEqual(f.app.runtime.loadCheckpoint(f.childId,'competition-tool-catalog'),f.originalCatalog,'no revision or directory rewrite');
  assert.deepEqual(f.app.runtime.readToolExecutions(f.rootId).map(record=>record.toolName),['subagent.dispatch']);
  assert.ok(f.app.runtime.readToolExecutions(f.childId).every(record=>record.state==='confirmed'&&record.policyDecision==='allow'));
  if(transport==='wss'){
    const context=f.app.runtime.loadCheckpoint(f.childId,'competition-cloud-dispatch-context');
    assert.equal(context.request.phase,'continuation');assert.equal(context.catalog.revision,f.originalCatalog.revision);
    assert.equal(context.continuation.proposalId,'child-second');assert.equal(f.sockets.length,2);
  }
});

test('root remains a single required dispatch and refuses another tool even after the real child finishes',async t=>{
  const f=await fixture(t,{rootTool:true});await f.approve();await f.settle();
  assert.equal(f.app.runtime.getTask(f.childId).state,'succeeded');assert.notEqual(f.app.runtime.getTask(f.rootId).state,'succeeded');
  assert.equal(f.app.readSubagentTasks(f.rootId).length,1);assert.equal(f.executions.length,2);
  assert.equal(f.requests.filter(item=>item.taskId===f.rootId)[0].availableTools,undefined);
  assert.deepEqual(f.app.runtime.readToolExecutions(f.rootId).map(record=>record.toolName),['subagent.dispatch']);
});

test('without goal opt-in the actual child continuation retains its old directory-free wire shape',async t=>{
  const f=await fixture(t,{optIn:false});await f.approve();await f.settle();
  const continuations=f.sends.filter(item=>item.taskId===f.childId&&item.query.continuation);
  assert.equal(continuations.length,2);for(const item of continuations){assert.equal(item.query.goal,undefined);assert.equal(item.query.availableTools,undefined);}
  assert.equal(f.app.runtime.getTask(f.childId).state,'succeeded');
});

test('a newly ready capability is not appended and cannot execute outside the child original directory',async t=>{
  const f=await fixture(t,{afterFirst:state=>{state.extraReady=true;},proposeExtra:true});await f.approve();await f.settle();
  const continued=f.requests.filter(item=>item.taskId===f.childId&&item.continuation)[0];
  assert.deepEqual(continued.availableTools,f.originalCatalog.entries);assert.ok(continued.availableTools.every(item=>item.name!==extra.name));
  assert.deepEqual(f.executions.map(item=>item.toolName),[first.name]);assert.equal(f.app.runtime.getTask(f.childId).state,'failed');
});

test('revocation of the confirmed source scope prevents the next cloud send while retaining its original effect and receipt',async t=>{
  const f=await fixture(t,{afterFirst:state=>{state.firstAllowed=false;}});await f.approve();await f.settle();
  assert.equal(f.requests.filter(item=>item.taskId===f.childId).length,1);assert.deepEqual(f.executions.map(item=>item.toolName),[first.name]);
  assert.equal(f.app.runtime.getTask(f.childId).state,'waiting_reconciliation');
  assert.equal(f.app.runtime.readToolExecutions(f.childId)[0].state,'confirmed');
  assert.equal(f.app.runtime.loadCheckpoint(f.childId,'competition-loop').continuation.proposalId,'child-first');
});

test('source revocation during credential reading is rechecked at the actual continuation send',async t=>{
  const f=await fixture(t,{afterFirst:state=>{state.revokeOnCredential=true;}});await f.approve();await f.settle();
  assert.equal(f.requests.filter(item=>item.taskId===f.childId).length,1);assert.equal(f.sends.length,1);
  assert.deepEqual(f.executions.map(item=>item.toolName),[first.name]);assert.equal(f.app.runtime.getTask(f.childId).state,'waiting_reconciliation');
});

for(const environment of [false,true])test(`descriptor schema drift after a confirmed effect cannot export a continuation catalog (environment=${environment})`,async t=>{
  const f=await fixture(t,{environment,afterFirst:(_state,app)=>{
    const original=app.tools.list.bind(app.tools);
    app.tools.list=()=>original().map(tool=>tool.name===second.name?{...tool,inputSchema:{...tool.inputSchema,
      properties:{value:{type:'integer',minimum:1,maximum:900}}}}:tool);
  }});await f.approve();await f.settle();
  assert.equal(f.sends.length,1,JSON.stringify({child:f.app.runtime.getTask(f.childId),
    executions:f.app.runtime.readToolExecutions(f.childId),sends:f.sends.map(item=>item.taskId)}));assert.deepEqual(f.executions.map(item=>item.toolName),[first.name]);
  assert.equal(f.app.runtime.getTask(f.childId).state,'waiting_reconciliation');
  assert.deepEqual(f.app.runtime.loadCheckpoint(f.childId,'competition-tool-catalog'),f.originalCatalog);
  const records=f.app.runtime.readToolExecutions(f.childId);
  assert.equal(records.length,1);
  assert.equal(records[0].state,'confirmed');assert.equal(records[0].executionStarted,true);assert.equal(records[0].policyDecision,'allow');
});

test('a forged wider continuation directory is rejected against the original snapshot',async t=>{
  let checked=false;
  const f=await fixture(t,{afterFirst:async(_state,app,taskId)=>{
    const saved=app.runtime.loadCheckpoint(taskId,'competition-tool-catalog');
    await assert.rejects(app.assertCompetitionToolCatalogAllowed({taskId,revision:app.runtime.getTask(taskId).revision,
      deadline:app.runtime.loadCheckpoint(taskId,'application-deadline'),signal:new AbortController().signal,continuation:true,
      availableTools:[...saved.entries,{name:extra.name,version:extra.version,inputSchema:extra.inputSchema}]}),{code:'UNAUTHORIZED'});
    checked=true;
  }});await f.approve();await f.settle();assert.equal(checked,true);
  assert.equal(f.app.runtime.getTask(f.childId).state,'succeeded');assert.equal(f.executions.length,2);
});

test('a second-round proposal remains subject to the original local argument Schema before execution',async t=>{
  const f=await fixture(t,{secondArguments:{value:900}});await f.approve();await f.settle();
  const child=f.app.runtime.getTask(f.childId);assert.equal(child.state,'failed');assert.equal(child.error.code,'INVALID_ARGUMENT');
  assert.deepEqual(f.executions.map(item=>item.toolName),[first.name]);
});

test('unknown second tool output stays held and cannot be replayed as another autonomous round',async t=>{
  const f=await fixture(t,{unknownSecond:true});await f.approve();await f.settle();
  assert.equal(f.app.runtime.getTask(f.childId).state,'waiting_reconciliation');
  const count=f.sends.length;assert.deepEqual(f.executions.map(item=>item.toolName),[first.name,second.name]);
  assert.equal(f.app.runtime.readToolExecutions(f.childId).find(item=>item.toolName===second.name).state,'unknown');
  assert.throws(()=>f.app.resumeConfirmedTask(f.childId));await f.settle();
  assert.equal(f.executions.length,2);assert.equal(f.sends.length,count);
});

test('original step budget refuses a new tool before approval or execution when no continuation round remains',async t=>{
  const f=await fixture(t,{budget:2});await f.approve();await f.settle();
  const child=f.app.runtime.getTask(f.childId);assert.equal(child.state,'failed');assert.equal(child.error.code,'TIMEOUT');
  assert.deepEqual(f.executions.map(item=>item.toolName),[first.name]);assert.equal(f.app.runtime.loadCheckpoint(f.childId,'competition-max-steps'),2);
});

test('parent cancellation interrupts a hung continuation catalog provider without another send or tool effect',async t=>{
  const f=await fixture(t,{afterFirst:state=>{state.blockAvailability=true;}});
  const approving=f.approve();await f.availabilityEntered;
  await f.client.call('task.cancel',{taskId:f.rootId,reason:'Stop original synthetic work'});await approving;await f.settle();
  assert.equal(f.requests.filter(item=>item.taskId===f.childId).length,1);assert.deepEqual(f.executions.map(item=>item.toolName),[first.name]);
  assert.equal(f.app.runtime.getTask(f.childId).state,'cancelled');
});

test('goal continuation protocol has a distinct deployment binding while the old configuration digest is unchanged',()=>{
  const options={path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'binding',responseMode:'tool-proposal-json',
    authorizationProvider:{read:async()=> 'Bearer synthetic'}};
  const legacy=createAgentArtsRuntimeApplication(options),enabled=createAgentArtsRuntimeApplication({...options,continuationContext:'goal'});
  try{
    const expected=createHash('sha256').update(JSON.stringify({gatewayUrl:options.gatewayUrl,runtimeName:options.runtimeName,
      invokeMode:'published',workflowGoalInput:null,responseMode:'tool-proposal-json',initialRequestMode:'goal'})).digest('hex');
    assert.equal(legacy.coordinationConfigurationRef,expected);assert.notEqual(enabled.coordinationConfigurationRef,expected);
  }finally{legacy.close();enabled.close();}
});

test('new-task continuation keeps the legacy deployment identity and requires the guarded tool catalog',()=>{
  const options={path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'binding',responseMode:'tool-proposal-json',
    authorizationProvider:{read:async()=> 'Bearer synthetic'}};
  assert.throws(()=>createAgentArtsRuntimeApplication({...options,enableNewTaskToolContinuations:true}),{code:'INVALID_ARGUMENT'});
  const bindings={initialRequestMode:'goal-with-tools-json',tools:[{descriptor:second,execute:async args=>args}],
    competitionToolAvailability:[{toolName:second.name,toolVersion:second.version,available:()=>true}],
    competitionToolExports:[{toolName:second.name,toolVersion:second.version,exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result}]};
  const legacy=createAgentArtsRuntimeApplication({...options,...bindings});
  const enabled=createAgentArtsRuntimeApplication({...options,...bindings,enableNewTaskToolContinuations:true});
  try {assert.equal(legacy.coordinationConfigurationRef,enabled.coordinationConfigurationRef);}
  finally {legacy.close();enabled.close();}
});
