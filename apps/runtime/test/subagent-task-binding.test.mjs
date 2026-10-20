import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {validateToolValue} from '@personal-agent/contracts';
import {createRuntimeApplication, createDesktopSubagentDispatchTool} from '../dist/application.js';
import {ModelGateway, FakeModelProvider} from '@personal-agent/models';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createConfiguredSubagentModelGateway, createRuntimeSubagentDispatchTool, resumeRuntimeSubagentTask, readRuntimeSubagentSummary} from '../dist/application/subagent-host.js';

const descriptor = {name:'fixture.child-read', version:'1.0.0',
  inputSchema:{type:'object',required:['value'],additionalProperties:false,properties:{value:{type:'string'}}},
  outputSchema:{type:'object',required:['value'],additionalProperties:false,properties:{value:{type:'string'}}},
  sideEffect:'read',requiredScopes:['fixture:read'],idempotencySupport:true,recoverySupport:true,requiresPresence:false};
const context = parent => ({taskId:parent.taskId,runId:'dispatch',authorizationRef:'parent-ref',scopes:['agent:delegate'],
  signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString()});
function fixture(automatic = true, database = ':memory:', local = false) {
  const calls = [];
  const tool = {descriptor,execute:async (input,ctx) => {calls.push(ctx); return input;}};
  // API recovery remains a Local fixture; Competition selects models on its cloud port.
  const app = createRuntimeApplication({path:database,profile:local?'local':'huawei_ict_agentarts',tools:[tool],
    ...(local?{}:{coordination:new FakeCoordinationPort(() => ({kind:'text',text:'unused',verification:'mock'}))}),
    ...(automatic ? {automaticTools:[{toolName:descriptor.name,toolVersion:descriptor.version}]} : {})});
  const parent = app.runtime.submitTask({goal:'delegate',conversationId:'competition',idempotencyKey:'parent'});
  return {app,parent,calls};
}
test('Runtime model factory composes each public provider and denies revoked credentials before network', async () => {
  assert.throws(()=>createConfiguredSubagentModelGateway({profile:'local',provider:'openai-compatible',
    baseUrl:'https://synthetic.invalid/v1',model:'synthetic',deployment:'synthetic',apiKey:()=>''}),{code:'UNSUPPORTED_CAPABILITY'});
  assert.throws(()=>createConfiguredSubagentModelGateway({profile:'huawei_ict_agentarts',provider:'pangu',
    baseUrl:'https://synthetic.invalid/v1',model:'synthetic',deployment:'synthetic',apiKey:()=>'',
    nativeReasoning:{thinking:'enabled',supportedEfforts:[],outputTokenParameter:'max_tokens'}}),{code:'UNSUPPORTED_CAPABILITY'});
  for (const provider of ['pangu','openai-compatible']) {
    let decorated = false;
    const gateway = createConfiguredSubagentModelGateway({provider,baseUrl:'https://synthetic.invalid/v1',
      model:'synthetic',deployment:'synthetic-deployment',apiKey:()=>''}, implementation => {
      decorated = true; return implementation;
    });
    assert.equal(decorated,true);
    assert.equal(gateway.deployment.provider,provider);
    await assert.rejects(gateway.complete({messages:[{role:'user',content:'synthetic'}],tools:[],
      signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString()}),{code:'UNAUTHORIZED'});
  }
});
test('selected models use persisted child IDs, Policy, ToolGateway and Evidence; replay does not execute twice', async () => {
  const {app,parent,calls} = fixture();
  try {
    const requests = [];
    const gateways = new Map(['research','coder'].map(name => [name,new ModelGateway(new FakeModelProvider([
      req => {requests.push(req); return {kind:'tool_proposal',proposal:{toolName:descriptor.name,toolVersion:descriptor.version,arguments:{value:name}}};},
      req => {requests.push(req); return {kind:'final',text:`result ${name}`};},
    ], {model:name}))]));
    const selected = [];
    const dispatch = createDesktopSubagentDispatchTool({getRuntime:()=>app.runtime,getTools:()=>app.tools,
      getModelGateway:name=>{selected.push(name);return gateways.get(name);}});
    const input = {subtasks:[{subtaskId:'r',role:'researcher',goal:'research',model:'research',thinkingDepth:4},
      {subtaskId:'c',role:'coder',goal:'code',model:'coder',thinkingDepth:2}]};
    const result = await dispatch.execute(input,context(parent));
    assert.equal(result.succeeded,2);
    assert.deepEqual(selected,['research','coder']);
    assert.equal(calls.length,2);
    for (const [index,id] of ['r','c'].entries()) {
      const child = app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-${id}`);
      assert.equal(child.state,'succeeded');
      assert.equal(calls[index].taskId,child.taskId);
      assert.equal(calls[index].runId,`agent-run-${child.taskId}-1`);
      assert.equal(calls[index].authorizationRef,calls[index].runId);
      assert.equal(app.runtime.policy.get(calls[index].runId).usesRemaining,0);
      assert.ok(child.evidenceRefs.length > 0);
      assert.equal(app.runtime.loadCheckpoint(child.taskId,'subtask-parent').parentTaskId,parent.taskId);
    }
    assert.ok(requests.every(req=>req.reasoningEffort===undefined));
    const replay = await dispatch.execute(input,context(parent));
    assert.equal(replay.succeeded,2);
    assert.equal(calls.length,2);
    assert.equal(requests.length,4);
  } finally {app.close();}
});
test('unknown selected model stays failed without falling back to legacy Pangu config', async () => {
  const {app,parent} = fixture();
  try {
    const tool = createDesktopSubagentDispatchTool({getRuntime:()=>app.runtime,getModelGateway:()=>undefined,
      modelConfig:{baseUrl:'https://synthetic.invalid/v1',model:'legacy',apiKey:'synthetic'}});
    const result = await tool.execute({subtasks:[{subtaskId:'unknown',role:'coder',goal:'code',model:'missing'}]},context(parent));
    assert.equal(result.succeeded,0); assert.equal(result.failed,1);
    assert.equal(app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-unknown`).error.code,'UNSUPPORTED_CAPABILITY');
  } finally {app.close();}
});
test('a child waiting for actual approval cannot be aggregated as succeeded', async () => {
  const {app,parent,calls} = fixture(false,':memory:',true);
  try {
    const gateway = new ModelGateway(new FakeModelProvider([()=>({kind:'tool_proposal',
      proposal:{toolName:descriptor.name,toolVersion:descriptor.version,arguments:{value:'pending'}}})]));
    const tool = app.createSubagentDispatchTool(()=>gateway);
    const result = await tool.execute({subtasks:[{subtaskId:'approval',role:'coder',goal:'read'}]},context(parent));
    assert.equal(result.succeeded,0); assert.equal(calls.length,0);
    assert.equal(result.failed,0);
    assert.equal(result.subtasks[0].state,'pending');
    validateToolValue(tool.descriptor.outputSchema,result);
    const child = app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-approval`);
    assert.equal(child.state,'waiting_approval');
    assert.match(result.subtasks[0].error,/waiting_approval/);
    assert.equal(child.evidenceRefs.length,0);
  } finally {app.close();}
});
test('approved child resumes the same invocation once and readback replaces pending aggregation', async () => {
  const {app,parent,calls} = fixture(false,':memory:',true);
  try {
    const gateway = new ModelGateway(new FakeModelProvider([
      ()=>({kind:'tool_proposal',proposal:{toolName:descriptor.name,toolVersion:descriptor.version,arguments:{value:'approved'}}}),
      ()=>({kind:'final',text:'confirmed child result'}),
    ]));
    const options = {getRuntime:()=>app.runtime,getTools:()=>app.tools,getModelGateway:()=>gateway};
    const tool = app.createSubagentDispatchTool(()=>gateway);
    const input = {subtasks:[{subtaskId:'resume',role:'coder',goal:'read',model:'chosen'}]};
    const dispatchContext = context(parent);
    const waiting = await tool.execute(input,dispatchContext);
    assert.equal(waiting.subtasks[0].state,'pending');
    const child = app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-resume`);
    const loop = app.runtime.loadCheckpoint(child.taskId,'agent-loop');
    assert.equal(loop.step,1);
    const approval = app.runtime.getApproval(`agent-run-${child.taskId}-1`);
    await assert.rejects(resumeRuntimeSubagentTask(options,child.taskId),{code:'UNAUTHORIZED'});
    assert.equal(app.runtime.getTask(child.taskId).state,'waiting_approval');
    app.runtime.respondApproval(approval.approvalId,'allow_once',approval.revision);
    const resumed = await resumeRuntimeSubagentTask(options,child.taskId);
    assert.equal(resumed.taskId,child.taskId); assert.equal(resumed.state,'succeeded');
    assert.equal(calls.length,1); assert.equal(calls[0].runId,approval.approvalId);
    assert.equal(calls[0].taskId,child.taskId);
    assert.ok(resumed.evidenceRefs.length>0);
    assert.equal(app.runtime.loadCheckpoint(child.taskId,'subtask-parent').parentDeadline,dispatchContext.deadline);
    const summary = readRuntimeSubagentSummary(app.runtime,parent.taskId);
    assert.equal(summary.succeeded,1); assert.equal(summary.failed,0);
    assert.match(summary.summary,/confirmed child result/);
    assert.doesNotMatch(summary.summary,/次级智能体协作汇总/,'a single child answer is the answer');
    const replay = await tool.execute(input,dispatchContext);
    assert.equal(replay.succeeded,1); assert.equal(calls.length,1);
    assert.equal((await resumeRuntimeSubagentTask(options,child.taskId)).state,'succeeded');
    assert.equal(calls.length,1);
  } finally {app.close();}
});
test('changing the selected deployment while waiting cannot execute an old approved proposal', async () => {
  const {app,parent,calls} = fixture(false,':memory:',true);
  try {
    const proposal = {kind:'tool_proposal',proposal:{toolName:descriptor.name,toolVersion:descriptor.version,arguments:{value:'old-binding'}}};
    let gateway = new ModelGateway(new FakeModelProvider([()=>proposal],{deployment:'config-before'}));
    const options = {getRuntime:()=>app.runtime,getTools:()=>app.tools,getModelGateway:()=>gateway};
    const tool = app.createSubagentDispatchTool(()=>gateway);
    await tool.execute({subtasks:[{subtaskId:'changed',role:'coder',goal:'read',model:'stable-id'}]},context(parent));
    const child = app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-changed`);
    const approval = app.runtime.getApproval(`agent-run-${child.taskId}-1`);
    app.runtime.respondApproval(approval.approvalId,'allow_once',approval.revision);
    gateway = new ModelGateway(new FakeModelProvider([()=>({kind:'final',text:'must not run'})],{deployment:'config-after'}));
    const outcome = await resumeRuntimeSubagentTask(options,child.taskId);
    assert.equal(outcome.state,'failed'); assert.equal(outcome.error.code,'REVISION_CONFLICT');
    assert.equal(calls.length,0);
    assert.equal(app.runtime.policy.get(approval.approvalId).usesRemaining,1);
  } finally {app.close();}
});

test('native configuration survives SQLite restart; same-identity drift cannot consume child approval', async () => {
  const base = new URL('../../../.cache/native-reasoning-runtime/',import.meta.url);
  mkdirSync(base,{recursive:true});
  for (const changed of [false,true]) {
    const database = path.join(mkdtempSync(base),'tasks.sqlite');
    let current = fixture(false,database);
    const native = {thinking:'enabled',effort:'max',supportedEfforts:['max'],outputTokenParameter:'max_completion_tokens'};
    const gateway = (nativeReasoning,steps) => {
      const fake = new FakeModelProvider(steps,{model:'native-synthetic',deployment:'stable-deployment'});
      return new ModelGateway(fake,{...fake.deployment,capabilities:{...fake.deployment.capabilities,nativeReasoning}});
    };
    const options = model => ({getRuntime:()=>current.app.runtime,getTools:()=>current.app.tools,
      getModelGateway:()=>model,getModelConfigurationRef:()=> 'stable-config-ref'});
    try {
      const first = gateway(native,[()=>({kind:'tool_proposal',proposal:{toolName:descriptor.name,
        toolVersion:descriptor.version,arguments:{value:'native-restart'}}})]);
      await createRuntimeSubagentDispatchTool(options(first)).execute({subtasks:[{subtaskId:'native-restart',
        role:'researcher',goal:'synthetic read',model:'native',thinkingDepth:0}]},context(current.parent));
      const childId = current.app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${current.parent.taskId}-native-restart`).taskId;
      assert.equal(current.app.runtime.getTask(childId).state,'waiting_approval');
      assert.deepEqual(current.app.runtime.loadCheckpoint(childId,'subtask-model-binding').nativeReasoning,native);
      current.app.close();
      current = fixture(false,database);
      const approval = current.app.runtime.getApproval(`agent-run-${childId}-1`);
      current.app.runtime.respondApproval(approval.approvalId,'allow_once',approval.revision);
      const restored = gateway(changed?{...native,effort:undefined,thinking:'disabled',supportedEfforts:[]}:native,
        [()=>({kind:'final',text:'Synthetic restored answer'})]);
      const result = await resumeRuntimeSubagentTask(options(restored),childId);
      assert.equal(result.state,changed?'failed':'succeeded');
      assert.equal(current.calls.length,changed?0:1);
      if (changed) {
        assert.equal(result.error.code,'REVISION_CONFLICT');
        assert.equal(current.app.runtime.policy.get(approval.approvalId).usesRemaining,1);
      } else {
        assert.equal(current.app.runtime.policy.get(approval.approvalId).usesRemaining,0);
        assert.equal(current.app.runtime.loadCheckpoint(childId,'subtask-thinking-binding').modelReasoning.effort,'max');
        assert.equal(current.app.runtime.loadCheckpoint(childId,'subtask-thinking-binding').modelReasoning.requestedEffort,'max');
        assert.equal(current.app.runtime.loadCheckpoint(childId,'subtask-thinking-binding').stepBudget.maxSteps,2);
      }
    } finally {current.app.close();}
  }
});

test('visible request budget factory preserves public binding and rejects Pangu before credentials', async () => {
  let credentials = 0;
  const config = {provider:'openai-compatible',profile:'huawei_ict_agentarts',baseUrl:'https://synthetic.invalid/v1',
    model:'synthetic',deployment:'synthetic',apiKey:()=>{credentials++;return '';},contextLimitTokens:100,
    requestTokenBudget:{model:'synthetic',tokenizerRef:'synthetic-meter:v1',configurationRef:'synthetic-config:v1',
      reservedOutputTokens:20,countInputTokens:()=>80}};
  assert.throws(()=>createConfiguredSubagentModelGateway({...config,provider:'pangu'}),{code:'UNSUPPORTED_CAPABILITY'});
  const gateway = createConfiguredSubagentModelGateway(config);
  assert.deepEqual(gateway.deployment.capabilities.requestTokenBudget,{scope:'provider-body',model:'synthetic',
    tokenizerRef:'synthetic-meter:v1',configurationRef:'synthetic-config:v1',contextTokens:100,reservedOutputTokens:20});
  await assert.rejects(gateway.complete({messages:[{role:'user',content:'synthetic'}],tools:[],
    signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString()}),{code:'UNAUTHORIZED'});
  assert.equal(credentials,1);
  const formatted=createConfiguredSubagentModelGateway({...config,requestFormat:'huawei-maas-deepseek-thinking-v1'});
  assert.equal(formatted.deployment.capabilities.requestFormat,'huawei-maas-deepseek-thinking-v1');
  assert.equal(formatted.deployment.capabilities.requestTokenBudget.requestFormat,'huawei-maas-deepseek-thinking-v1');
  assert.throws(()=>createConfiguredSubagentModelGateway({...config,provider:'pangu',requestTokenBudget:undefined,
    requestFormat:'huawei-maas-deepseek-thinking-v1'}),{code:'UNSUPPORTED_CAPABILITY'});
});

test('SQLite child approval survives unchanged budget; version, capacity and reservation drift cannot consume it', async () => {
  const base = new URL('../../../.cache/visible-budget-runtime/',import.meta.url);
  mkdirSync(base,{recursive:true});
  const binding = {scope:'provider-body',model:'budget-synthetic',tokenizerRef:'synthetic-meter:v1',
    configurationRef:'budget-config:v1',contextTokens:100,reservedOutputTokens:20};
  for (const changed of ['same','removed','tokenizerRef','configurationRef','contextTokens','reservedOutputTokens','requestFormat']) {
    const database = path.join(mkdtempSync(base),'tasks.sqlite');
    let current = fixture(false,database);
    const gateway = (requestTokenBudget,steps) => {
      const fake = new FakeModelProvider(steps,{model:'budget-synthetic',deployment:'stable-deployment'});
      return new ModelGateway(fake,{...fake.deployment,capabilities:{...fake.deployment.capabilities,
        ...(requestTokenBudget===undefined?{}:{requestTokenBudget})}});
    };
    const options = model => ({getRuntime:()=>current.app.runtime,getTools:()=>current.app.tools,
      getModelGateway:()=>model,getModelConfigurationRef:()=> 'stable-config-ref'});
    try {
      const first = gateway(binding,[()=>({kind:'tool_proposal',proposal:{toolName:descriptor.name,
        toolVersion:descriptor.version,arguments:{value:'budget-restart'}}})]);
      await createRuntimeSubagentDispatchTool(options(first)).execute({subtasks:[{subtaskId:'budget-restart',
        role:'researcher',goal:'synthetic read',model:'budget'}]},context(current.parent));
      const childId = current.app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${current.parent.taskId}-budget-restart`).taskId;
      assert.equal(current.app.runtime.getTask(childId).state,'waiting_approval');
      assert.deepEqual(current.app.runtime.loadCheckpoint(childId,'subtask-model-binding').requestTokenBudget,binding);
      current.app.close();current = fixture(false,database);
      const approval = current.app.runtime.getApproval(`agent-run-${childId}-1`);
      current.app.runtime.respondApproval(approval.approvalId,'allow_once',approval.revision);
      const next = changed==='removed'?undefined:changed==='same'?binding:{...binding,
        [changed]:changed==='requestFormat'?'huawei-maas-deepseek-thinking-v1'
          :typeof binding[changed]==='number'?binding[changed]+1:`${binding[changed]}-changed`};
      const restored = gateway(next,[()=>({kind:'final',text:'Synthetic restored answer'})]);
      const result = await resumeRuntimeSubagentTask(options(restored),childId);
      assert.equal(result.state,changed==='same'?'succeeded':'failed');
      assert.equal(current.calls.length,changed==='same'?1:0);
      assert.equal(current.app.runtime.policy.get(approval.approvalId).usesRemaining,changed==='same'?0:1);
      if (changed!=='same') assert.equal(result.error.code,'REVISION_CONFLICT');
    } finally {current.app.close();}
  }
});

test('request format changes across SQLite restart reject old approval even without a token meter',async()=>{
  const base=new URL('../../../.cache/request-format-runtime/',import.meta.url);mkdirSync(base,{recursive:true});
  const format='huawei-maas-deepseek-thinking-v1';
  for(const [before,after] of [[format,format],[undefined,format],[format,undefined]]) {
    const database=path.join(mkdtempSync(base),'tasks.sqlite');
    let current=fixture(false,database);
    const gateway=(requestFormat,steps)=>{
      const fake=new FakeModelProvider(steps,{model:'format-synthetic',deployment:'stable-deployment'});
      return new ModelGateway(fake,{...fake.deployment,capabilities:{...fake.deployment.capabilities,
        ...(requestFormat===undefined?{}:{requestFormat})}});
    };
    const options=model=>({getRuntime:()=>current.app.runtime,getTools:()=>current.app.tools,getModelGateway:()=>model,
      getModelConfigurationRef:()=> 'stable-config-ref'});
    try {
      const first=gateway(before,[()=>({kind:'tool_proposal',proposal:{toolName:descriptor.name,toolVersion:descriptor.version,arguments:{value:'format'}}})]);
      await createRuntimeSubagentDispatchTool(options(first)).execute({subtasks:[{subtaskId:'format',role:'researcher',goal:'read',model:'stable'}]},context(current.parent));
      const childId=current.app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${current.parent.taskId}-format`).taskId;
      const saved=current.app.runtime.loadCheckpoint(childId,'subtask-model-binding');
      assert.equal(saved.requestFormat,before);assert.equal(saved.requestTokenBudget,undefined);
      current.app.close();current=fixture(false,database);
      const approval=current.app.runtime.getApproval(`agent-run-${childId}-1`);
      current.app.runtime.respondApproval(approval.approvalId,'allow_once',approval.revision);
      const restored=gateway(after,[()=>({kind:'final',text:'synthetic restored'})]);
      const result=await resumeRuntimeSubagentTask(options(restored),childId);
      const same=before===after;
      assert.equal(result.state,same?'succeeded':'failed');assert.equal(current.calls.length,same?1:0);
      assert.equal(current.app.runtime.policy.get(approval.approvalId).usesRemaining,same?0:1);
      if(!same)assert.equal(result.error.code,'REVISION_CONFLICT');
    } finally {current.app.close();}
  }
});
test('summary without definitions preserves a subtask ID containing surrounding spaces', async () => {
  const {app,parent} = fixture(false,':memory:',true);
  try {
    const provider = new FakeModelProvider([()=>({kind:'final',text:'spaced ID result'})]);
    const gateway = new ModelGateway(provider);
    const tool = app.createSubagentDispatchTool(()=>gateway);
    const input = {subtasks:[{subtaskId:' r ',role:'researcher',goal:'read'}]};
    const dispatched = await tool.execute(input,context(parent));
    assert.equal(dispatched.succeeded,1);
    const child = app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}- r `);
    assert.equal(child.state,'succeeded');
    const readback = readRuntimeSubagentSummary(app.runtime,parent.taskId);
    assert.equal(readback.subtasks[0].subtaskId,' r ');
    assert.deepEqual(readback,dispatched);
    assert.equal(provider.requests.length,1);
  } finally {app.close();}
});

test('default Competition workers and an explicitly selected API run as separate parallel children without lost progress', async () => {
  const {app,parent} = fixture();
  let release;
  const bothStarted = new Promise(resolve=>{release=resolve;});
  const started = [];
  const provider = new FakeModelProvider([()=>({kind:'final',text:'specialist API output'})]);
  const selected = [];
  const deadline = context(parent).deadline;
  try {
    const options = {getRuntime:()=>app.runtime,getTools:()=>app.tools,
      runDefaultWorker:async (subtask,worker,tools)=>{
        assert.notEqual(worker.taskId,parent.taskId);
        assert.equal(worker.deadline,deadline);
        assert.equal(app.runtime.getTask(worker.taskId).state,'running');
        assert.equal(worker.loadCheckpoint('subtask-parent').role,subtask.role);
        assert.equal(tools.list().some(item=>item.name==='subagent.dispatch'),false);
        started.push(worker.taskId); if(started.length===2) release();
        await bothStarted;
        return {resultSummary:`cloud fixture ${subtask.subtaskId}`,evidenceRefs:[]};
      },getModelGateway:name=>{selected.push(name);return name==='specialist'?new ModelGateway(provider):undefined;}};
    const tool = createRuntimeSubagentDispatchTool(options);
    const defs = [{subtaskId:'cloud-r',role:'researcher',goal:'research',thinkingDepth:2},
      {subtaskId:'cloud-p',role:'planner',goal:'plan'},
      {subtaskId:'api',role:'reviewer',goal:'review',model:'specialist'}];
    const outcome = await tool.execute({subtasks:defs},{...context(parent),deadline});
    assert.equal(outcome.succeeded,3);
    assert.equal(started.length,2); assert.notEqual(started[0],started[1]);
    assert.deepEqual(selected,['specialist']); assert.equal(provider.requests.length,1);
    const records = app.runtime.loadCheckpoint(parent.taskId,'subtask-progress-records');
    assert.deepEqual(Object.keys(records).sort(),['api','cloud-p','cloud-r']);
    assert.equal(readRuntimeSubagentSummary(app.runtime,parent.taskId).succeeded,3);
    const child = app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-cloud-r`);
    assert.equal(app.runtime.loadCheckpoint(child.taskId,'subtask-thinking-binding').modelReasoning.supported,false);
    await tool.execute({subtasks:defs},{...context(parent),deadline});
    assert.equal(started.length,2); assert.equal(provider.requests.length,1);
    const failed = await tool.execute({subtasks:[{subtaskId:'unknown-api',role:'coder',goal:'code',model:'missing'}]},context(parent));
    assert.equal(failed.failed,1); assert.equal(started.length,2);
    await assert.rejects(tool.execute({subtasks:[{subtaskId:'empty-api',role:'coder',goal:'code',model:' '}]},context(parent)),{code:'INVALID_ARGUMENT'});
  } finally {app.close();}
});

test('default child approval resumes the original invocation, and changed tool scope preserves the unconsumed grant', async () => {
  for(const changed of [false,true]) {
    const {app,parent,calls} = fixture(false);
    let allowed = true;
    try {
      const options = {getRuntime:()=>app.runtime,getTools:()=>app.tools,
        getToolsForSubtask:()=>allowed?app.tools:undefined,
        runDefaultWorker:async (_subtask,worker,tools)=>{
          const proposal = {toolName:descriptor.name,arguments:{value:'cloud-approved'}};
          worker.saveCheckpoint('competition-loop',{step:1,pending:proposal});
          const runId=`competition-tool-${worker.taskId}-1`;
          const result = await tools.invoke({...proposal,toolVersion:descriptor.version,taskId:worker.taskId,runId,
            authorizationRef:runId,signal:worker.signal,deadline:worker.deadline});
          return {resultSummary:result.state==='confirmed'?'cloud continuation fixture':'pending',evidenceRefs:result.evidenceRefs};
        }};
      const tool = createRuntimeSubagentDispatchTool(options);
      const dispatched = await tool.execute({subtasks:[{subtaskId:'cloud',role:'researcher',goal:'read'}]},context(parent));
      assert.equal(dispatched.succeeded,0); assert.equal(dispatched.failed,0);
      const child = app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-cloud`);
      assert.equal(child.state,'waiting_approval');
      await assert.rejects(resumeRuntimeSubagentTask(options,child.taskId),{code:'UNAUTHORIZED'});
      const approval = app.runtime.getApproval(`competition-tool-${child.taskId}-1`);
      app.runtime.respondApproval(approval.approvalId,'allow_once',approval.revision);
      if(changed) allowed=false;
      const resumed = await resumeRuntimeSubagentTask(options,child.taskId);
      assert.equal(resumed.state,changed?'failed':'succeeded');
      assert.equal(calls.length,changed?0:1);
      assert.equal(app.runtime.policy.get(approval.approvalId).usesRemaining,changed?1:0);
      if(changed) assert.equal(resumed.error.code,'REVISION_CONFLICT');
      else {
        assert.equal(calls[0].taskId,child.taskId); assert.equal(calls[0].runId,approval.approvalId);
        assert.ok(resumed.evidenceRefs.length>0);
        assert.equal(readRuntimeSubagentSummary(app.runtime,parent.taskId).succeeded,1);
      }
    } finally {app.close();}
  }
});

test('parent cancellation reaches both running default children without restarting them', async () => {
  const {app,parent} = fixture();
  const controller = new AbortController();
  let started=0, aborted=0;
  try {
    const tool = createRuntimeSubagentDispatchTool({getRuntime:()=>app.runtime,
      runDefaultWorker:async (_subtask,worker)=>new Promise((_,reject)=>{
        worker.signal.addEventListener('abort',()=>{aborted++;reject(Error('synthetic cancelled'));},{once:true});
        started++; if(started===2) controller.abort('parent stopped');
      })});
    const defs=[{subtaskId:'cancel-a',role:'researcher',goal:'a'},{subtaskId:'cancel-b',role:'planner',goal:'b'}];
    const result=await tool.execute({subtasks:defs},{...context(parent),signal:controller.signal});
    assert.equal(started,2); assert.equal(aborted,2); assert.equal(result.cancelled,2);
    for(const def of defs) assert.equal(app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-${def.subtaskId}`).state,'cancelled');
    assert.equal(readRuntimeSubagentSummary(app.runtime,parent.taskId).cancelled,2);
  } finally {app.close();}
});
