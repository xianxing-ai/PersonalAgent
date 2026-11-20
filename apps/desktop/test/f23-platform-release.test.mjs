import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createDesktopF23DecisionConfiguration,F23_INITIALIZE_TOOL} from '../electron/f23-decision-configuration.js';
import {createDesktopF23WorkflowPorts,F23_PREPARE_TOOL,F23_BIND_TOOL} from '../electron/f23-workflow-worker-ports.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
// Actual Runtime/Policy/SQLite, F23 graph and CAS consumer. Models, approvals and platform are explicit Fixtures.
test('F23 binds original paired outputs and platform score to the actual CAS consumer',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'pa-f23-'));let app,last,modelCalls=0,reads=0,evaluationTaskId;
  const main={catalogRevision:'a'.repeat(64),modelId:'main'},candidate={...main,modelId:'candidate'};
  const models={snapshot:()=>({catalog:{revision:main.catalogRevision}}),readExecutionModel:()=>main,resolveExecutionModel:value=>{
    assert.ok([main.modelId,candidate.modelId].includes(value.modelId));return structuredClone(value);}};
  const decision=createDesktopF23DecisionConfiguration({runtimeModule,getApplication:()=>app,models,namespace:'f23-fixture'});
  const ports=createDesktopF23WorkflowPorts({runtimeModule,getApplication:()=>app,models,decisionConfiguration:decision,namespace:'f23-fixture',
    configuration:{binding:()=>({gatewayUrl:'https://fixture.invalid',runtimeName:'fixture'}),snapshot:()=>({deploymentVersion:'fixture-v1'}),readCredentialReference:()=> 'fixture'},
    authorizeEvaluation:async()=>{throw Error('Fixture reader only');},authorizeExport:async()=>true,
    invokePaired:async({input,context,assertCurrent})=>{assertCurrent();modelCalls+=2;
      return {requestId:context.runId,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),result:{branches:Object.fromEntries(['main','shadow'].map(branch=>[branch,input.cases.map(item=>({id:item.id,
        inputDigest:hash(item.messages),output:branch+' fixture',startedAt:new Date(Date.now()-2000).toISOString(),finishedAt:new Date(Date.now()-1990).toISOString(),wallMs:10,modelCalls:1,
        deployment:{verification:'conditional',provider:'explicit-fixture'}}))]))}};},
    readEvaluation:async options=>{options.assertCurrent();reads++;assert.equal(options.expected.length,1);return {qualityScore:options.taskId==='main-eval'?0.8:0.9,digest:hash(options.expected),source:'explicit-fixture'};}});
  const choice={descriptor:{name:'decision.choose_candidate',version:'1.0.0',sideEffect:'read',requiredScopes:['decision:read'],requiresPresence:false,idempotencySupport:false,recoverySupport:false,
    inputSchema:object({context:{type:'string'},candidates:{type:'array',items:object({id:{type:'string'},description:{type:'string'}})},requestId:{type:'string'}}),outputSchema:{type:'object'}},
    execute:async args=>({selectedId:args.candidates[0].id})};
  const secret='f23-fixture-receipt-secret-at-least-32';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:'f23-fixture-checkpoint-secret-at-least-32',decisionTool:{name:choice.descriptor.name,version:'1.0.0'},
    receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async context=>{
      let args={};if(context.node.id==='F23_N04')args=context.predecessorOutputs.F23_N03.releaseRequest;
      if(context.node.id==='F23_N05'){const request=context.predecessorOutputs.F23_N04;args={operationId:request.operationId,configurationId:decision.configurationId};}
      return [{id:'original',description:'Original fixture action',value:{arguments:args}},{id:'abstain',description:'No action',abstain:true,value:{}}];}});
  const image={bindingId:'f23-fixture',receiptSecret:async()=>secret,advance:async request=>last=await engine.advance(request)};
  const tools=[decision.tool,...ports.tools,choice,runtimeModule.createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(s,w,p)=>app.runDefaultSubagentWorker(s,w,p)})];
  app=runtimeModule.createRuntimeApplication({path:join(dir,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'f23-fixture',delegateUserTasks:true,tools,
    hostOnlyTools:[F23_INITIALIZE_TOOL,...ports.hostOnlyTools],requiresToolAuthorization:()=>true,requestToolAuthorization:async()=> 'allow_once',
    readDefaultExecutionModel:()=>main,resolveExecutionModel:value=>({...main,...value}),configuredWorkflowWorkers:ports.configuredWorkflowWorkerPorts.map(worker=>({...worker,image})),
    coordinationBinding:'f23-fixture',coordination:{execute:async request=>request.continuation?{kind:'text',text:'Fixture done',verification:'mock'}:
      {kind:'tool_proposal',proposalId:'original-f23',toolName:'workflow.evaluation.release',toolVersion:'1.0.0',arguments:{evaluationTaskId,action:'promote'},verification:'mock'}},
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,exportPolicyVersion:'fixture',accepts:()=>true,project:({result})=>result}))});
  t.after(async()=>{app.close();await rm(dir,{recursive:true,force:true});});
  const deadline=new Date(Date.now()+30000).toISOString(),signal=new AbortController().signal;
  const wait=async task=>{while(app.activeTaskCount&&Date.now()<Date.parse(deadline))await new Promise(r=>setTimeout(r,5));
    const read=app.readHostToolTask(task.taskId);assert.equal(read.task.state,'succeeded',JSON.stringify(read.task));return read;};
  await wait(decision.initialize({commandId:'baseline',catalogRevision:main.catalogRevision},{deadline,signal}));
  const prepared=await wait(ports.submit(F23_PREPARE_TOOL,{experiment:{candidate,candidateVersion:'candidate-v1',splitAt:'2026-01-01T00:00:00.000Z',
    expiresAt:new Date(Date.now()+60000).toISOString(),metricRules:[{metric:'qualityScore',bound:'min_delta',value:0}],
    cases:[{id:'one',input:'Public fixture',reference:'Expected fixture',availableAt:'2025-01-01T00:00:00.000Z',expectedAt:'2026-02-01T00:00:00.000Z'}]}},{commandId:'prepare',deadline}));
  assert.ok(app.runtime.loadCheckpoint(prepared.task.taskId,'f23:received'),'Original receipt remains available despite independent cloud clock skew');
  const binding=branch=>({taskId:branch+'-eval',datasetId:branch+'-dataset',datasetVersion:'1',evaluatorId:'fixed-evaluator',evaluatorVersion:'1',itemIds:[branch+'-item']});
  const bound=await wait(ports.submit(F23_BIND_TOOL,{experimentId:prepared.task.taskId,main:binding('main'),shadow:binding('shadow')},{commandId:'bind',deadline}));
  evaluationTaskId=bound.task.taskId;
  const client=new Client(app);await client.connect();const parent=await client.call('task.submit',{goal:'Promote the original fixture comparison',conversationId:'f23-fixture'},
    {idempotencyKey:'original-f23',timeoutMs:30000});
  while(app.activeTaskCount&&Date.now()<Date.parse(deadline))await new Promise(r=>setTimeout(r,5));
  const [graph]=app.readSubagentTasks(parent.taskId);
  assert.equal(graph?.state,'succeeded',JSON.stringify({graph,last:last?.nodes,tasks:app.runtime.listTasks({limit:100}).items.filter(t=>t.state==='failed')}));
  assert.equal(modelCalls,2);assert.ok(reads>=4);assert.equal(decision.readDecisionConfiguration().configuration.revision,2);
  assert.deepEqual(decision.readDecisionConfiguration().executionModel,candidate);
});
