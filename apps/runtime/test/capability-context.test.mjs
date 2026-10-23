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
  assert.ok(context.items.every(item=>item.status==='registered'));
  assert.deepEqual(context.recentProblems.map(item=>item.code),['RESULT_UNKNOWN','UNAUTHORIZED']);
  assert.doesNotMatch(JSON.stringify(context),/SECRET/);
  assert.equal(JSON.parse(capabilityContext({profile:'huawei_ict_agentarts',registered:[],errorCodes:[],
    catalogReadFailed:true})).capabilityStatus.catalogState,'read_failed');
});

test('optional diagnostics yield to the original task token budget',async()=>{
  let received;
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
    tools:[{descriptor:{name:'fixture.ready',version:'1.0.0',sideEffect:'read',requiredScopes:['fixture:read'],
      idempotencySupport:true,recoverySupport:true,requiresPresence:false,
      inputSchema:{type:'object',properties:{}},outputSchema:{type:'object',properties:{}}},execute:async()=>({})}],
    competitionToolExports:[{toolName:'fixture.ready',toolVersion:'1.0.0',exportPolicyVersion:'fixture-v1',accepts:()=>true,project:()=>({})}],
    competitionToolAvailability:[{toolName:'fixture.ready',toolVersion:'1.0.0',available:()=>true}],
    coordinationInput:{beforeCoordinationSend(){},goalTokenBudget:{tokenizerRef:'fixture-meter',contextTokens:100,
      reservedOutputTokens:10,countTokens:goal=>goal.includes('capabilityStatus')?1000:10}},
    coordination:{execute:async request=>{received=request.goal;return {kind:'text',text:'Synthetic answer',verification:'mock'};}}});
  try {
    const client=new Client(app);await client.connect();
    const submitted=await client.call('task.submit',{goal:'Keep original task',conversationId:'budget'},{idempotencyKey:'budget'});
    for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(app.runtime.getTask(submitted.taskId).state,'succeeded');
    assert.equal(received,'Keep original task');
  }finally{app.close();}
});

for(const withHooks of [false,true])test(`actual readiness preserves visibility and authorized execution (context hooks=${withHooks})`,async()=>{
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
    ...(withHooks?{coordinationInput:{beforeCoordinationSend(){}}}:{}),
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
