import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication,createAgentArtsRuntimeApplication,createDesktopSubagentDispatchTool} from '../dist/application.js';
const namespace='synthetic-plan-graph';
const node=(id,kind,dependencies=[],summary=id)=>({id,kind,dependencies,summary,sourceRef:'synthetic/plan',state:'active',
  sensitivity:'private',reason:'explicit plan',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z'});
const scope=()=>({deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal});
async function until(predicate){for(let n=0;n<500;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Plan task did not settle');}
async function fixture(t,{unknown=false,withFact=false,changeAtCredentials=false,asyncReader=false}={}) {
  const root=fileURLToPath(new URL('../../../.cache/plan-execution/',import.meta.url));await mkdir(root,{recursive:true});
  const directory=await mkdtemp(join(root,'case-'));let app,facts,changed=false,executions=0,preparations=0,sends=0,credentialReads=0,fetches=0;
  const effect={descriptor:{name:'fixture.plan-effect',version:'1.0.0',sideEffect:'external_write',requiredScopes:['fixture:write'],
    requiresPresence:false,recoverySupport:true,idempotencySupport:true,inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object'}},
    execute:async()=>{executions++;if(unknown)throw Error('Synthetic lost effect acknowledgement');return {done:true};}};
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const port=new FakeCoordinationPort(request=>app.runtime.getTask(request.taskId).conversationId.startsWith('desktop-subtask:')
    ?request.continuation?{kind:'text',text:'Synthetic original execution observed',verification:'mock'}:
      {kind:'tool_proposal',proposalId:'original-effect',toolName:effect.descriptor.name,toolVersion:'1.0.0',arguments:{},verification:'unverified'}
    :{kind:'text',text:'Synthetic original child summary',verification:'mock'});
  const options={path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,coordination:port,
    coordinationBinding:'synthetic-fixed-deployment',assertCoordinationBinding:()=>{if(changed)throw Error('changed deployment');},tools:[dispatch,effect],
    coordinationInput:{prepareCoordinationGoal:async request=>{preparations++;return request.publicGoal;},beforeCoordinationSend:()=>{sends++;}},
    planExecution:{readCurrentFact:(input,context)=>{
      if(input.memoryNamespace!=='synthetic-memory'||!facts)return;
      assert.deepEqual(Object.keys(context).sort(),['deadline','signal']);
      const fact=facts.readCurrentPublicFact(input.fact);return asyncReader?Promise.resolve(fact):fact;
    }},automaticTools:[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version}],
    competitionToolAvailability:[dispatch,effect].map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      publicEnumPaths:['/subtasks/*/role'],available:()=>true})),
    competitionToolExports:[dispatch,effect].map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      exportPolicyVersion:'synthetic-only',accepts:()=>true,project:({result})=>result}))};
  const create=()=>{
    if(!changeAtCredentials)return createRuntimeApplication(options);
    const {profile,coordination,...runtimeOptions}=options;
    return createAgentArtsRuntimeApplication({...runtimeOptions,gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic-plan',
      deploymentVersion:'synthetic-v1',initialRequestMode:'goal-with-tools-json',responseMode:'tool-proposal-json',
      authorizationProvider:{read:async()=>{credentialReads++;facts.recordPublicSource(source(2),scope());return 'Bearer synthetic';}},
      fetchImpl:async()=>{fetches++;throw Error('Changed Fact must stop the final original send');}});
  };
  app=create();const store=app.runtime.provisionCoordinationStore(namespace);
  let dependencies=[];
  const publicSource={vaultId:'synthetic-vault',path:'one.md',factId:'original-fact'};
  const source=revision=>({...publicSource,sourceRevision:(revision===1?'a':'b').repeat(64),line:1,summary:'PUBLIC_FACT_SENTINEL',
    observedAt:new Date().toISOString(),validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z',expectedFactRevision:revision-1||null});
  if(withFact) {
    facts=app.createCompetitionFactHost({memoryPath:join(directory,'memory.sqlite'),memoryNamespace:'synthetic-memory',graphNamespace:namespace,consumerKey:'synthetic-plan'});
    facts.recordPublicSource(source(1),scope());await facts.drain({limit:10,maxBatches:2,...scope()});
    const fact=store.read().history[0];dependencies=[{id:fact.id,revision:fact.revision}];
  }
  store.append(store.read().revision,node('goal','goal',dependencies));store.append(store.read().revision,node('plan','plan',[{id:'goal',revision:1}],'Selected original Plan summary'));
  const selection={graphNamespace:namespace,expectedGraphRevision:store.read().revision,plan:{id:'plan',revision:1}};
  t.after(async()=>{facts?.close();app.close();await rm(directory,{recursive:true,force:true});});
  return {get app(){return app;},store,selection,port,counts:()=>({executions,preparations,sends,credentialReads,fetches}),changeDeployment:()=>{changed=true;},
    changeFact:()=>facts.recordPublicSource(source(2),scope()),reopen:()=>{app.close();app=create();return app;},
    submit:async(context=scope())=>{const preview=await app.previewPlanExecution(selection,context);
      return app.submitPlanExecutionTask({...selection,sourceDigest:preview.sourceDigest,conversationId:'user-plan',deadline:context.deadline},context);}};
}
async function approve(app,taskId){const client=new Client(app);await client.connect();const {items}=await client.call('approval.list',{taskId});
  assert.equal(items.length,1);await client.call('authorization.respond',{approvalId:items[0].approvalId,expectedRevision:items[0].revision,decision:'allow_once'});}
async function waitingApproval(app,taskId){await until(()=>{
  const root=app.runtime.getTask(taskId),children=app.readSubagentTasks(taskId);
  if(root.state==='failed'||children.some(child=>child.state==='failed'))throw Error(JSON.stringify({root,children}));
  return children[0]?.state==='waiting_approval';
});}

test('selected Plan freezes actual sources before admission and follows original delegation, preparation and per-tool approval',async t=>{
  const f=await fixture(t,{withFact:true}),[task,repeated]=await Promise.all([f.submit(),f.submit()]);
  assert.equal(repeated.taskId,task.taskId,'concurrent clicks share one original admission and dispatch');
  await waitingApproval(f.app,task.taskId);
  const child=f.app.readSubagentTasks(task.taskId)[0],binding=f.app.readPlanExecutionBinding(child.taskId);
  assert.equal(binding.rootTaskId,task.taskId);assert.deepEqual(binding.plan,f.selection.plan);assert.equal(f.counts().executions,0);
  const source=f.app.runtime.loadCheckpoint(task.taskId,'plan-execution-source:v1').source;
  assert.equal(source.facts.length,1);assert.equal(source.facts[0].fact.revision,1);
  assert.deepEqual(f.app.runtime.bindFactProjectionStore(namespace).readNodeFact(source.facts[0].node),source.facts[0]);
  assert.throws(()=>f.app.runtime.bindFactProjectionStore(namespace).readNodeFact({...source.facts[0].node,foreign:true}),{code:'INVALID_ARGUMENT'});
  assert.ok(f.port.requests.every(request=>!request.goal.includes('PUBLIC_FACT_SENTINEL')),'dependency Fact bodies stay local');
  await approve(f.app,child.taskId);await until(()=>f.app.activeTaskCount===0);
  assert.equal(f.app.runtime.getTask(task.taskId).state,'succeeded');assert.equal(f.counts().executions,1);
  assert.ok(f.counts().preparations>0 && f.counts().sends>0,'original prepare/send callbacks are consumed');
  assert.equal(f.app.readPlanExecutionTask({...f.selection,expectedGraphRevision:999}).taskId,task.taskId);
  f.store.append(f.store.read().revision,node('plan','plan',[{id:'goal',revision:1}],'Explicit new Plan version'));
  const next={...f.selection,expectedGraphRevision:f.store.read().revision,plan:{id:'plan',revision:2}},context=scope();
  const preview=await f.app.previewPlanExecution(next,context);
  const nextTask=await f.app.submitPlanExecutionTask({...next,sourceDigest:preview.sourceDigest,conversationId:'user-plan',deadline:context.deadline},context);
  assert.notEqual(nextTask.taskId,task.taskId);await waitingApproval(f.app,nextTask.taskId);
  await approve(f.app,f.app.readSubagentTasks(nextTask.taskId)[0].taskId);await until(()=>f.app.activeTaskCount===0);
  assert.equal(f.counts().executions,2,'a new explicit Plan version is an independent operation');
});

test('actual AgentArts final guard rejects a Fact changed while reading credentials, before any HTTP send',async t=>{
  const f=await fixture(t,{withFact:true,changeAtCredentials:true}),task=await f.submit();
  await until(()=>f.app.activeTaskCount===0);
  assert.equal(f.counts().credentialReads,1);assert.equal(f.counts().fetches,0);assert.equal(f.counts().executions,0);
  assert.equal(f.app.runtime.getTask(task.taskId).state,'failed');
  assert.equal(f.app.readPlanExecutionTask(f.selection).taskId,task.taskId);
});

test('an asynchronous Fact source cannot be installed as a final synchronous Plan guard',async t=>{
  const f=await fixture(t,{withFact:true,asyncReader:true});
  await assert.rejects(f.submit(),{code:'UNAUTHORIZED'});assert.equal(f.app.readPlanExecutionTask(f.selection),undefined);
  assert.equal(f.port.requests.length,0);
});

test('changed original Fact without a graph drain and replaced Plan stop the original approval before its effect',async t=>{
  for(const change of ['fact','plan','deployment','cancel']) {
    const f=await fixture(t,{withFact:true}),task=await f.submit();await waitingApproval(f.app,task.taskId);
    const child=f.app.readSubagentTasks(task.taskId)[0];
    if(change==='fact')f.changeFact();
    if(change==='plan')f.store.append(f.store.read().revision,node('plan','plan',[{id:'goal',revision:1}],'Changed Plan'));
    if(change==='deployment')f.changeDeployment();
    if(change==='cancel')f.app.runtime.requestCancel(task.taskId);
    if(change==='deployment')await assert.rejects(approve(f.app,child.taskId),{code:'REVISION_CONFLICT'});
    else await approve(f.app,child.taskId);
    await until(()=>f.app.activeTaskCount===0);
    assert.equal(f.counts().executions,0,change);
    assert.equal(f.app.readPlanExecutionTask(f.selection).taskId,task.taskId,'historical task remains readable');
  }
});

test('original unknown survives restart and new clicks or changed deployment never replay a Plan version',async t=>{
  const f=await fixture(t,{unknown:true}),task=await f.submit();await until(()=>f.app.readSubagentTasks(task.taskId)[0]?.state==='waiting_approval');
  const child=f.app.readSubagentTasks(task.taskId)[0];await approve(f.app,child.taskId);await until(()=>f.app.activeTaskCount===0);
  assert.equal(f.app.runtime.getTask(task.taskId).state,'waiting_reconciliation');assert.equal(f.counts().executions,1);
  f.reopen();f.changeDeployment();f.app.runtime.bindCoordinationStore(namespace).append(2,node('plan','plan',[{id:'goal',revision:1}],'New independent version'));
  const prior=f.app.readPlanExecutionTask({...f.selection,expectedGraphRevision:3});assert.equal(prior.taskId,task.taskId);
  assert.equal(prior.state,'waiting_reconciliation');assert.equal(f.app.readPlanExecutionBinding(child.taskId).rootTaskId,task.taskId);
  const original=f.app.runtime.readToolExecutions(child.taskId).find(record=>record.toolName==='fixture.plan-effect');
  assert.equal(f.app.runtime.reconcileToolExecution(child.taskId,original.evidenceId,'unknown').state,'waiting_reconciliation',
    'source revocation does not forbid original read-only unknown observation');
  const retry=await f.app.submitPlanExecutionTask({...f.selection,sourceDigest:'f'.repeat(64),conversationId:'another-view',deadline:scope().deadline},scope());
  assert.equal(retry.taskId,task.taskId);assert.equal(f.counts().executions,1);
});

test('missing original Fact mapping, stale selection and changed native confirmation admit no new task',async t=>{
  const f=await fixture(t),context=scope(),preview=await f.app.previewPlanExecution(f.selection,context);
  await assert.rejects(f.app.submitPlanExecutionTask({...f.selection,sourceDigest:'f'.repeat(64),conversationId:'user-plan',deadline:context.deadline},context),{code:'REVISION_CONFLICT'});
  assert.equal(f.app.readPlanExecutionTask(f.selection),undefined);
  f.store.append(2,node('unmapped','fact'));f.store.append(3,node('plan','plan',[{id:'unmapped',revision:1}]));
  assert.throws(()=>f.app.previewPlanExecution({...f.selection,expectedGraphRevision:4,plan:{id:'plan',revision:2}},context),{code:'UNSUPPORTED_CAPABILITY'});
  assert.throws(()=>f.app.previewPlanExecution(f.selection,context),{code:'REVISION_CONFLICT'});
  assert.ok(preview.sourceDigest);assert.equal(f.port.requests.length,0);
});

test('substituted immutable Plan origin cannot authorize the original pending child',async t=>{
  const f=await fixture(t),task=await f.submit();await waitingApproval(f.app,task.taskId);
  const child=f.app.readSubagentTasks(task.taskId)[0],key='plan-execution-source:v1',saved=f.app.runtime.loadCheckpoint(task.taskId,key);
  f.app.runtime.saveCheckpoint(task.taskId,key,{...saved,source:{...saved.source,summary:'Substituted Plan'}});
  assert.throws(()=>f.app.readPlanExecutionBinding(child.taskId),{code:'UNAUTHORIZED'});
  await approve(f.app,child.taskId);await until(()=>f.app.activeTaskCount===0);assert.equal(f.counts().executions,0);
  f.app.runtime.saveCheckpoint(task.taskId,key,saved);assert.equal(f.app.readPlanExecutionTask(f.selection).taskId,task.taskId);
});
