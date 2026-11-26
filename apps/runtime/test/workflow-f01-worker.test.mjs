import {syntheticCoordinationExecution} from '../../../tests/helpers/synthetic-agentarts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import {createRuntimeApplication,createDesktopSubagentDispatchTool,createF01WorkflowWorkerPorts,createRuntimeF01LifecycleHost} from '../dist/application.js';
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});

// Actual Engine/Runtime/Policy/SQLite and nested dispatch. Source/model/clicks are Synthetic.
test('F01 commits the original bounded plan through actual subagent.dispatch and preserves its task identities',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pa-f01-worker-'));let app,checks=0,recursiveAdmission;
  const candidate={action:'dispatch',question:'',subtasks:[{subtaskId:'first',role:'planner',goal:'Synthetic child completion'}]};
  const selection={modelId:'synthetic-text',catalogRevision:'a'.repeat(64)};
  const exports=['subagent.dispatch','knowledge.search'].map(toolName=>({toolName,toolVersion:'1.0.0',exportPolicyVersion:'synthetic',accepts:()=>true,project:({result})=>result}));
  const lifecycle=createRuntimeF01LifecycleHost({getApplication:()=>app,commit:async()=>{throw Error('Unselected lifecycle');},readOperation:async()=>({state:'unknown'})});
  const bundle=createF01WorkflowWorkerPorts({getApplication:()=>app,lifecycle,question:{requestReply:async()=>{throw Error('Unselected question');},readReply:()=>{throw Error('Unselected question');}},
    createContextPorts:()=>({tools:[createOwnedWorkflowAdapter({nodeId:'F01_N02',kind:'host',sideEffect:'read',requiredScopes:['memory:read'],inputSchema:object({}),
      outputSchema:object({memory:{type:'object'},responsibilities:{type:'object'},models:{type:'object'}}),execute:async()=>({memory:{facts:[],snapshot:'synthetic'},responsibilities:{revision:'1',items:[]},models:{kind:'agentarts_catalog',revision:'synthetic',models:[]}})})],
      assertSourcesCurrent(){checks++;}}),assertExpansionCurrent:()=>{throw Error('Unselected expansion');},resolveExpansionInput:()=>{throw Error('Unselected expansion');},toolExports:exports,prepareCompetitionToolExport:async()=>{},authorizeExport:async()=>true});
  const choice={descriptor:{name:'decision.choose_candidate',version:'1.0.0',inputSchema:object({context:{type:'string'},candidates:{type:'array',items:object({id:{type:'string'},description:{type:'string'}})},requestId:{type:'string'}}),
    outputSchema:object({selectedId:{type:'string'}}),sideEffect:'read',requiredScopes:['decision:choose'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},execute:async args=>({selectedId:args.candidates[0].id})};
  const knowledge={descriptor:{...choice.descriptor,name:'knowledge.search',inputSchema:object({}),outputSchema:object({}),requiredScopes:['knowledge:read']},execute:async()=>{throw Error('Unselected Synthetic knowledge');}};
  const tools=[choice,knowledge,...bundle.tools,createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(task,worker,scope)=>app.runDefaultSubagentWorker(task,worker,scope)})];
  const secret='synthetic-f01-worker-receipt-secret-32-characters';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:'synthetic-f01-worker-checkpoint-secret-32-characters',decisionTool:{name:choice.descriptor.name,version:'1.0.0'},receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),
    prepareCandidates:async context=>[{id:'selected',description:'Synthetic bounded original choice',value:context.node.id==='F01_N03'?candidate:{arguments:{}}},{id:'abstain',description:'Retain uncertainty',value:{},abstain:true}]});
  const image={bindingId:'synthetic-f01',receiptSecret:async()=>secret,advance:request=>engine.advance(request)};
  app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f01-worker',delegateUserTasks:true,tools,
    readDefaultExecutionModel:()=>selection,resolveExecutionModel:value=>{if(value?.modelId&&value.modelId!==selection.modelId)throw Error('Unknown Synthetic model');return selection;},coordinationBinding:'synthetic-f01-binding',
    configuredWorkflowWorkers:bundle.configuredWorkflowWorkerPorts.map(worker=>({...worker,image})),coordination:{execute:syntheticCoordinationExecution(async request=>{
      const task=app.runtime.getTask(request.taskId);
      if(task.goal?.includes('Synthetic child completion'))recursiveAdmission=await bundle.configuredWorkflowWorkerPorts[0].available({taskId:task.taskId,deadline:request.deadline,signal:request.signal});
      return task.goal?.includes('F01 original instruction')&&task.conversationId!=='synthetic-chat'&&!request.continuation
        ?{kind:'tool_proposal',proposalId:'f01-original',toolName:'workflow.responsibility.manage',toolVersion:'1.0.0',arguments:{context:{fact:{id:'synthetic',revision:1},responsibilitySession:{taskId:'synthetic',sessionId:'synthetic'}}},verification:'unverified'}
        :{kind:'text',text:'Synthetic completed child',verification:'mock'};})},
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true,publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic',accepts:()=>true,project:({result})=>result}))});
  t.after(async()=>{app.close();await rm(directory,{recursive:true,force:true});});const client=new Client(app);await client.connect();
  const parent=await client.call('task.submit',{goal:'F01 original instruction',conversationId:'synthetic-chat'},{idempotencyKey:'f01-original-user',timeoutMs:120000});
  let graph;const end=Date.now()+20000;while(Date.now()<end){
    for(const approval of app.runtime.listApprovals({state:'pending',limit:100}).items)await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    [graph]=app.readSubagentTasks(parent.taskId);if(graph&&app.activeTaskCount===0&&['succeeded','failed','waiting_reconciliation','cancelled'].includes(graph.state))break;
    await new Promise(resolve=>setTimeout(resolve,5));}
  const diagnostic=()=>JSON.stringify(app.runtime.listTasks({limit:100}).items.map(task=>({taskId:task.taskId,state:task.state,error:task.error,tool:app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName})));
  assert.equal(graph?.state,'succeeded',diagnostic());assert.ok(checks>0);
  const tasks=app.runtime.listTasks({limit:100}).items,commit=tasks.find(task=>app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName==='workflow.host.f01_n06');
  const result=app.readHostToolTask(commit.taskId).confirmed.result;assert.equal(result.state,'completed');assert.equal(result.tasks.length,1);
  const dispatched=app.readSubagentTasks(result.dispatchTaskId);assert.equal(dispatched[0].taskId,result.tasks[0].taskId);assert.equal(dispatched[0].state,'succeeded');
  assert.ok(app.runtime.getTask(dispatched[0].taskId).goal.endsWith(candidate.subtasks[0].goal));assert.deepEqual(result.dependencies,[]);assert.equal(recursiveAdmission,false);
});
