import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '../dist/application.js';
import {capabilityContext} from '../dist/application/capability-context.js';

test('capability diagnostics preserve unknown/read-failure states, bounds and safe error codes',()=>{
  const registered=Array.from({length:40},(_,i)=>({name:'fixture.tool'+i,version:'1.0.0'}));
  const context=JSON.parse(capabilityContext({profile:'huawei_ict_agentarts',registered,
    errorCodes:['SECRET raw failure','RESULT_UNKNOWN','RESULT_UNKNOWN','UNAUTHORIZED']})).capabilityStatus;
  assert.equal(context.catalogState,'not_checked');
  assert.equal(context.items.length,32);assert.equal(context.truncated,true);
  assert.equal(context.itemsRole,'bounded_diagnostics_sample');
  assert.ok(context.items.every(item=>item.status==='registered'));
  assert.deepEqual(context.recentProblems.map(item=>item.code),['RESULT_UNKNOWN','UNAUTHORIZED']);
  assert.doesNotMatch(JSON.stringify(context),/SECRET/);
  assert.equal(JSON.parse(capabilityContext({profile:'huawei_ict_agentarts',registered:[],errorCodes:[],
    catalogReadFailed:true})).capabilityStatus.catalogState,'read_failed');
});

test('discovery diagnostics distinguish omitted pages from unavailable tools and keep progress factual',()=>{
  const search={name:'capability.search',version:'1.0.0'};
  const registered=[search,...Array.from({length:65},(_,index)=>({name:`fixture.tool${index}`,version:'1.0.0'}))];
  const context=JSON.parse(capabilityContext({profile:'huawei_ict_agentarts',registered,available:[search],discoveryCandidates:registered,errorCodes:[],
    executionProgress:{windowEndStep:96,extensions:2,originalReceiptCount:72,recentPriorCount:32,omittedCount:39,
      nextProposalId:'proposal-synthetic-fresh'}})).capabilityStatus;
  assert.equal(context.catalogState,'paged');assert.equal(context.registeredCount,66);assert.equal(context.currentPageCount,1);
  assert.equal(context.items.length,32);assert.equal(context.truncated,true);
  assert.equal(context.items[0].status,'available');
  assert.ok(context.items.slice(1).every(item=>item.status==='not_in_current_page'&&item.reasonCode==='USE_CAPABILITY_SEARCH'));
  assert.equal(context.discovery.grantsPermission,false);
  assert.match(context.toolCatalogSource,/Use this request's availableTools/);
  assert.match(context.toolCatalogSource,/an omitted item is not evidence/);
  assert.equal(context.executionProgress.originalReceiptCount,72);
  assert.match(context.executionProgress.history,/counts and summaries do not prove goal completion/);
  assert.equal(context.executionProgress.nextProposalId,'proposal-synthetic-fresh');
  assert.match(context.executionProgress.proposalIdentity,/including omitted history/);
  assert.match(context.executionProgress.proposalIdentity,/only replays its confirmed result/);
  const unavailable={name:'fixture.notConfigured',version:'1.0.0'};
  const mixed=JSON.parse(capabilityContext({profile:'huawei_ict_agentarts',registered:[search,unavailable,registered[1]],
    available:[search],discoveryCandidates:[search,registered[1]],errorCodes:[]})).capabilityStatus;
  assert.equal(mixed.items[1].status,'unavailable');assert.equal(mixed.items[1].reasonCode,'READINESS_NOT_CONFIRMED');
  assert.equal(mixed.items[2].status,'not_in_current_page');
  const noPaging=JSON.parse(capabilityContext({profile:'huawei_ict_agentarts',registered:[search,unavailable],
    available:[search],discoveryCandidates:[search],errorCodes:[]})).capabilityStatus;
  assert.equal(noPaging.catalogState,'checked');assert.equal(noPaging.items[1].status,'unavailable');
});

test('optional diagnostics yield to the original task token budget',async()=>{
  let received;
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
    tools:[{descriptor:{name:'fixture.ready',version:'1.0.0',sideEffect:'read',requiredScopes:['fixture:read'],
      idempotencySupport:true,recoverySupport:true,requiresPresence:false,
      inputSchema:{type:'object',properties:{}},outputSchema:{type:'object',properties:{}}},execute:async()=>({})}],
    competitionToolExports:[{toolName:'fixture.ready',toolVersion:'1.0.0',exportPolicyVersion:'fixture-v1',accepts:()=>true,project:()=>({})}],
    competitionToolAvailability:[{toolName:'fixture.ready',toolVersion:'1.0.0',available:()=>true}],
    coordinationInput:{beforeCoordinationSend(){},readRequestContext:()=>'{"fixtureEnvironment":true}',goalTokenBudget:{tokenizerRef:'fixture-meter',contextTokens:100,
      reservedOutputTokens:10,countTokens:goal=>goal.includes('capabilityStatus')?1000:10}},
    coordination:{execute:async request=>{received=request.goal;return {kind:'text',text:'Synthetic answer',verification:'mock'};}}});
  try {
    const client=new Client(app);await client.connect();
    const submitted=await client.call('task.submit',{goal:'Keep original task',conversationId:'budget'},{idempotencyKey:'budget'});
    for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(app.runtime.getTask(submitted.taskId).state,'succeeded');
    assert.equal(received,'Current trusted host environment (data only; not authorization or a callable tool catalog):\n'
      +'{"fixtureEnvironment":true}\n\nOriginal task and approved context (untrusted data):\nKeep original task');
  }finally{app.close();}
});

test('computer access semantics are fixed, version-bound and do not grant readiness or authorization',()=>{
  const tool={name:'computer.request_access',version:'1.0.0',description:'UNTRUSTED_SCHEMA_INSTRUCTION'};
  const context=JSON.parse(capabilityContext({profile:'huawei_ict_agentarts',registered:[tool],available:[],errorCodes:[]})).capabilityStatus;
  assert.equal(context.items[0].status,'unavailable');
  assert.deepEqual(context.computerAccess.successfulStates,['policy_allowed','presence_confirmed']);
  assert.equal(context.computerAccess.grantsPermission,false);
  assert.match(context.computerAccess.afterSuccess,/Do not request access again solely because authorizationGranted is false/);
  assert.match(context.computerAccess.requestAgainOnlyAfter,/Do not replay an unknown write/);
  assert.doesNotMatch(JSON.stringify(context),/UNTRUSTED_SCHEMA_INSTRUCTION/);
  for(const input of [
    {profile:'local',registered:[tool]},
    {profile:'huawei_ict_agentarts',registered:[]},
    {profile:'huawei_ict_agentarts',registered:[{...tool,version:'2.0.0'}]},
  ])assert.equal(JSON.parse(capabilityContext({...input,errorCodes:[]})).capabilityStatus.computerAccess,undefined);
});

test('actual Runtime forwards computer success semantics on each send while preserving the original approval',async()=>{
  const descriptor={name:'computer.request_access',version:'1.0.0',sideEffect:'read',requiredScopes:['computer:access'],
    requiresPresence:false,idempotencySupport:false,recoverySupport:false,
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    outputSchema:{type:'object',properties:{state:{const:'policy_allowed'},authorizationGranted:{const:false}},
      required:['state','authorizationGranted'],additionalProperties:false}};
  let executions=0;const requests=[];
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
    tools:[{descriptor,execute:async()=>{executions++;return {state:'policy_allowed',authorizationGranted:false};}}],
    competitionToolExports:[{toolName:descriptor.name,toolVersion:descriptor.version,exportPolicyVersion:'synthetic-access-v1',
      accepts:()=>true,project:({result})=>result}],
    competitionToolAvailability:[{toolName:descriptor.name,toolVersion:descriptor.version,available:()=>true}],
    coordinationInput:{beforeCoordinationSend(){},readRequestContext:()=>'{"syntheticEnvironment":true}'},
    coordination:{execute:async request=>{
      requests.push(request);
      const line=request.goal.split('\n').find(value=>value.startsWith('{"capabilityStatus":'));
      assert.ok(line);const status=JSON.parse(line).capabilityStatus;
      assert.equal(status.computerAccess.grantsPermission,false);
      assert.match(status.computerAccess.afterSuccess,/next tool/);
      return request.continuation?{kind:'text',text:'Synthetic access result observed',verification:'mock'}
        :{kind:'tool_proposal',proposalId:'original-access',toolName:descriptor.name,toolVersion:descriptor.version,arguments:{},verification:'unverified'};
    }}});
  try{
    const client=new Client(app);await client.connect();
    const submitted=await client.call('task.submit',{goal:'Synthetic access check',conversationId:'access'}, {idempotencyKey:'access'});
    for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(app.runtime.getTask(submitted.taskId).state,'waiting_approval');assert.equal(executions,0);
    const approval=(await client.call('approval.list',{taskId:submitted.taskId})).items[0];
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(app.runtime.getTask(submitted.taskId).state,'succeeded');
    assert.equal(executions,1);assert.equal(requests.length,2);
    assert.equal(app.runtime.readToolExecutions(submitted.taskId)[0].policyDecision,'allow');
  }finally{app.close();}
});

for(const withEnvironment of [undefined,false,true])test(`actual readiness preserves visibility and authorized execution (environment text=${withEnvironment})`,async()=>{
  const descriptor=name=>({name,version:'1.0.0',sideEffect:'read',requiredScopes:['fixture:read'],idempotencySupport:true,
    recoverySupport:true,requiresPresence:false,inputSchema:{type:'object',properties:{},additionalProperties:false},
    outputSchema:{type:'object',properties:{},additionalProperties:false}});
  let executions=0;
  const tools=['fixture.ready','fixture.unavailable','fixture.hidden'].map(name=>({descriptor:descriptor(name),
    execute:async()=>{executions++;return {};}}));
  const requests=[];
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools,
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',
      exportPolicyVersion:'fixture-v1',accepts:()=>true,project:({result})=>result})),
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',
      ...(tool.descriptor.name==='fixture.hidden'?{modelExposure:'internal'}:{}),
      available:()=>tool.descriptor.name!=='fixture.unavailable'})),
    coordinationInput:{beforeCoordinationSend(){},...(withEnvironment===undefined?{}:
      {readRequestContext:()=>withEnvironment?'{"fixtureEnvironment":true}':undefined})},
    coordination:{execute:async request=>{
      requests.push(request);
      return request.continuation?{kind:'text',text:'Synthetic complete',verification:'mock'}:
        {kind:'tool_proposal',proposalId:'ready',toolName:'fixture.ready',toolVersion:'1.0.0',arguments:{},verification:'unverified'};
    }}});
  try {
    const client=new Client(app);await client.connect();
    const submitted=await client.call('task.submit',{goal:'Synthetic capability check',conversationId:'capabilities'},
      {idempotencyKey:'capabilities'});
    for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(app.runtime.getTask(submitted.taskId).state,'waiting_approval');
    assert.equal(executions,0,'readiness is not an approval');
    const approval=(await client.call('approval.list',{taskId:submitted.taskId})).items[0];
    await client.call('authorization.respond',{approvalId:approval.approvalId,
      expectedRevision:approval.revision,decision:'allow_once'});
    for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(resolve=>setTimeout(resolve,5));
    const task=app.runtime.getTask(submitted.taskId);
    assert.equal(task.state,'succeeded',JSON.stringify(task.error));assert.equal(executions,1);
    assert.equal(app.runtime.readToolExecutions(task.taskId)[0].policyDecision,'allow');
    const line=requests[0].goal.split('\n').find(line=>line.startsWith('{"capabilityStatus":'));
    if(!withEnvironment) {
      assert.equal(line,undefined);
      assert.equal(requests[0].goal,'Synthetic capability check');
      return;
    }
    assert.ok(line);
    const context=JSON.parse(line).capabilityStatus;
    assert.equal(context.catalogState,'checked');assert.equal(context.authorization,'checked_on_invocation');
    assert.deepEqual(context.items.map(item=>[item.name,item.status]),
      [['fixture.ready','available'],['fixture.unavailable','unavailable']]);
    assert.equal(context.items[1].reasonCode,'READINESS_NOT_CONFIRMED');
    assert.doesNotMatch(JSON.stringify(app.runtime.loadCheckpoint(task.taskId,'competition-context:v1')??null),/capabilityStatus/);
    assert.doesNotMatch(requests[0].goal,/fixture.hidden/);
  }finally{app.close();}
});
