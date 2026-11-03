import {syntheticCoordinationExecution} from '../../../tests/helpers/synthetic-agentarts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createF03MailReviewWorkflowPorts} from '../electron/f03-mail-review-workflow-ports.js';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {prepareConfiguredWorkflowDecisionQuestion} from '../electron/configured-workflow-decision-source.js';
import {prepareWorkflowHostPreflight} from '../electron/workflow-host-preflight.js';

// Actual graph Engine + Runtime + Policy + questions; private source, selector, cloud and approval responses are explicit fixtures.
test('F03 actual graph preserves known mail effects and defers unavailable replacement Fact without CAS or redispatch',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'f03-graph-'));let app;const proposals=[],exports=[],images=[];
  const source={graphTaskId:'original-fixture-f08',readRunId:'original-fixture-read'};
  const review={sourceDigest:'a'.repeat(64),graphNamespace:'f03-graph',graphRevision:0,evaluatedAt:new Date().toISOString(),affected:[],allowedDependencies:[]};
  const original={reference:source,review,plan:{id:'original-plan',revision:1},conversationId:'f03-chat',
    effects:[{taskId:'original-archive',runId:'host-tool-original-archive',toolName:'mail.archive',result:{state:'confirmed'},evidenceRefs:['host-tool-original-archive']}],
    privateContext:[],originalDeadline:'2099-01-01T00:00:00.000Z',requiresReview:true};
  const model={configuration:{configurationId:'original-f23',revision:1,version:'v1',parametersDigest:'b'.repeat(64)},
    executionModel:{catalogRevision:'c'.repeat(64),modelId:'fixture-model',reasoningEffort:'none'}};
  const ports=createF03MailReviewWorkflowPorts({getApplication:()=>app,sourceChanges:{readReviewSource:(ref)=>{assert.deepEqual(ref,source);return structuredClone(original);}},
    assertCurrent:()=>{},authorizeExport:async scope=>{exports.push(scope.stage);return true;},
    readDecisionConfiguration:()=>model,assertDecisionConfiguration:value=>assert.deepEqual(value,model)});
  const [worker]=ports.configuredWorkflowWorkerPorts;assert.ok(worker);
  const question=createDesktopAuthorizationQuestionHost({createQuestions:args=>new runtimeModule.AuthorizationQuestions(args),getApplication:()=>app,
    namespace:'f03',resolveConversation:id=>app.readToolConversation(id)??app.runtime.getTask(id).conversationId,available:()=>true,
    profiles:[{ref:'bounded',revision:1,mode:'workspace-write',label:'Synthetic scope',available:true}],defaultProfileRef:'bounded'});
  const decision=createWorkflowDecisionTool({selector:{select:async()=> 'original'}});
  const tools=[...ports.tools,decision,runtimeModule.createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,context,scoped)=>app.runDefaultSubagentWorker(subtask,context,scoped)})];
  const secret='original-f03-synthetic-receipt-secret-32';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:secret,receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),
    decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},prepareCandidates:async context=>[
      {id:'original',description:'Original synthetic F03 source',value:context.node.id==='F03_N02'?{action:'defer'}:{arguments:{sourceDigest:review.sourceDigest}}},
      {id:'abstain',description:'Abstain',value:null,abstain:true}]});
  app=runtimeModule.createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,
    hostUserNamespace:'f03',coordinationBinding:'fixture-f03-deployment',tools,configuredWorkflowWorkers:[{...worker,image:{bindingId:'fixture-f03-image',
      receiptSecret:async()=>secret,advance:async request=>{images.push(request.input);const result=await engine.advance(request);proposals.push(...result.proposals);return result;}}}],
    coordination:{execute:syntheticCoordinationExecution(async request=>request.continuation||app.runtime.getTask(request.taskId).conversationId==='f03-chat'
      ?{kind:'text',text:'Original review remains pending',verification:'unverified'}
      :{kind:'tool_proposal',proposalId:'original-f03-review',toolName:worker.toolName,toolVersion:worker.toolVersion,arguments:{source},verification:'unverified'})},
    requiresToolAuthorization:()=>true,requestToolAuthorization:async scope=>{
      await prepareWorkflowHostPreflight({application:app,scope,prepareExport:async()=>{}});
      prepareConfiguredWorkflowDecisionQuestion({application:app,scope,question});return question.requestToolAuthorization(scope);},
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,exportPolicyVersion:'synthetic-f03',
      accepts:()=>true,project:({result})=>result}))});
  app.runtime.provisionCoordinationStore('f03-graph');
  t.after(async()=>{for(const task of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);
    question.close();for(let n=0;n<100&&app.activeTaskCount;n++)await new Promise(resolve=>setTimeout(resolve,5));app.close();await rm(directory,{recursive:true,force:true});});
  const client=new Client(app);await client.connect();const root=await client.call('task.submit',{goal:'Synthetic original F03 review',conversationId:'f03-chat'},
    {idempotencyKey:'f03-graph',timeoutMs:30_000});
  for(let n=0;n<1500;n++){
    for(const card of question.snapshot().filter(card=>card.state==='pending'))question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'},card.conversationId);
    if(['succeeded','failed','cancelled'].includes(app.runtime.getTask(root.taskId).state))break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  const [child]=app.readSubagentTasks(root.taskId),loop=app.runtime.loadCheckpoint(child.taskId,'competition-loop');
  assert.equal(child.state,'succeeded',JSON.stringify({child,loop,proposals:proposals.map(item=>({nodeId:item.nodeId,toolName:item.toolName}))}));
  const result=loop.receipts.at(-1).continuation.result;
  assert.deepEqual(result,{state:'requires_review',graphRevision:0,sourceDigest:review.sourceDigest,effectsPreserved:true});
  assert.ok(proposals.some(item=>item.toolName==='workflow.guard.f03_n07'));
  assert.ok(proposals.some(item=>item.toolName==='workflow.guard.f03_n08'));
  assert.equal(proposals.some(item=>item.toolName==='cognition.commit_repair'),false);
  assert.equal(app.runtime.bindCoordinationStore('f03-graph').read().revision,0);
  assert.ok(images.every(input=>JSON.stringify(input.executionModel)===JSON.stringify(model.executionModel)));
  assert.ok(exports.includes('initial')&&exports.includes('receipt')&&exports.includes('completion'));
});
