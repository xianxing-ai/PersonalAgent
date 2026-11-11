import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {createRuntimeApplication,createDesktopSubagentDispatchTool} from '@personal-agent/runtime/application';
import {createDesktopF27WorkflowWorkerPorts} from '../electron/f27-context-workflow-ports.js';

test('F27 actual graph consumes the original compiler mapping, rejects source drift and does not claim model capability verification',async t=>{
  // Real Runtime compiler/source map, Engine, Policy, HostBridge and SQLite.
  // Model catalog, candidate/selector, source overlay and approval responses are explicit Fixtures.
  const directory=await mkdtemp(join(tmpdir(),'pa-f27-'));let app,original,returned,changed=false,checked=false;
  const selection={modelId:'synthetic-text',catalogRevision:'a'.repeat(64)},privateText='Synthetic private background from the original conversation. '.repeat(200);
  const models={snapshot:()=>({available:true,catalog:{revision:selection.catalogRevision,models:[{
    id:selection.modelId,type:'text',availability:'unverified',requestProfile:'standard',reasoningEfforts:[]}]}}),resolveExecutionModel:()=>selection};
  const exported=[],imageRequests=[],proposals=[];let knowledgeCalls=0,summaryCalls=0,knowledgeChanged=false;
  const knowledge={descriptor:{name:'knowledge.search',version:'1.0.0',sideEffect:'read',requiredScopes:['knowledge:read'],
    inputSchema:{type:'object',additionalProperties:false,properties:{query:{type:'string'},limit:{type:'integer'}},required:['query','limit']},
    outputSchema:{type:'object'},idempotencySupport:false,recoverySupport:false,requiresPresence:false},execute:async args=>{
      assert.deepEqual(args,{query:'Synthetic configured public question',limit:5});knowledgeCalls++;
      return {publicCitation:'Synthetic public original citation',privateBody:'Synthetic raw knowledge stays local'};
    }};
  const knowledgePolicy={toolName:'knowledge.search',toolVersion:'1.0.0',exportPolicyVersion:'synthetic-public-v1',
    accepts:()=>!knowledgeChanged,project:({result})=>({publicCitation:result.publicCitation})};
  const source={snapshot:()=>({available:true,configured:true,enabled:true,dataLevel:'public',cloudExportAllowed:true,
    sourceId:'synthetic-public',configRevision:knowledgeChanged?2:1,publicQueries:['Synthetic configured public question']}),
    acquire:()=>({assertCurrent(){assert.equal(knowledgeChanged,false);},release(){}})};
  const factory=createDesktopF27WorkflowWorkerPorts({getApplication:()=>app,models,readDeploymentBinding:()=> 'synthetic-f27-deployment',
    getKnowledgeSourceConfig:()=>source,knowledgeToolExports:[knowledgePolicy],prepareCompetitionToolExport:async()=>{},
    authorizeExport:async request=>{
      exported.push(request);
      if(request.stage==='initial'){
        changed=true;assert.throws(()=>app.readF27ContextBinding(request),{code:'REVISION_CONFLICT'});changed=false;checked=true;
      }
      return true;
    }});
  const secret='synthetic-f27-original-receipt-secret-at-least-32-bytes';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:secret,decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},
    receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async context=>[
      {id:'supported',description:'Synthetic original compiled context',value:context.node.id==='F27_N02'?context.input.decisionOutput:{arguments:{}},
        ...(context.node.id==='F27_N02'?{branches:context.input.branches}:{})},
      {id:'review',description:'Synthetic abstention',value:null,abstain:true}]});
  const image={bindingId:'synthetic-f27-actual-engine',receiptSecret:async()=>secret,advance:async request=>{
    imageRequests.push(structuredClone({...request,signal:undefined}));const result=await engine.advance(request);proposals.push(...result.proposals);return result;}};
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const tools=[dispatch,knowledge,createWorkflowDecisionTool({selector:{select:async()=> 'supported'}}),...factory.tools];
  app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f27',delegateUserTasks:true,
    coordinationBinding:'synthetic-f27-deployment',tools,configuredWorkflowWorkers:factory.configuredWorkflowWorkerPorts.map(worker=>({...worker,image})),
    readDefaultExecutionModel:()=>selection,resolveExecutionModel:()=>selection,
    automaticTools:[{toolName:dispatch.descriptor.name,toolVersion:'1.0.0'}],
    coordinationInput:{beforeCoordinationSend(){assert.equal(changed,false);},contextCompaction:{
      policy:{version:'synthetic-v1',triggerCharacters:8000,targetCharacters:5000,maxCharacters:20000,retainMessages:0,
        maxSourceMessages:10,segmentCharacters:20000,maxSummaryCharacters:1000},modelConfigurationRef:'synthetic-original-model',
      summarize:async request=>{request.assertBeforeSend();summaryCalls++;return 'Synthetic original bounded model summary';},assertCurrent(){assert.equal(changed,false);},
      readSnapshot:()=>original?[{id:'original-history',taskId:original.taskId,role:'user',content:changed?'Synthetic replaced source':app.runtime.getTask(original.taskId).goal}]:[]}},
    coordination:{execute:async request=>{
      if(request.continuation){if(request.continuation.result?.contextVersion)returned=request.continuation.result;
        return {kind:'text',text:'Synthetic original context summary',verification:'mock'};}
      return {kind:'tool_proposal',proposalId:'synthetic-f27-context',toolName:'workflow.f27.prepare_context',toolVersion:'1.0.0',arguments:{knowledgeQueryIndex:0},verification:'mock'};
    }},competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result}))});
  t.after(async()=>{app.close();await rm(directory,{recursive:true,force:true});});
  original=app.runtime.submitTask({goal:privateText,conversationId:'f27-chat',idempotencyKey:'original'});
  app.runtime.transitionTask(original.taskId,'planning');app.runtime.transitionTask(original.taskId,'running');
  app.runtime.transitionTask(original.taskId,'verifying');
  app.runtime.transitionTask(original.taskId,'succeeded',{resultSummary:'Synthetic original source'});
  const client=new Client(app);await client.connect();
  const root=await client.call('task.submit',{goal:'Prepare my original context mapping',conversationId:'f27-chat'},
    {idempotencyKey:'synthetic-f27',timeoutMs:60000});
  let child;const end=Date.now()+20000;
  while(Date.now()<end){
    for(const approval of app.runtime.listApprovals({state:'pending',limit:100}).items)
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    [child]=app.readSubagentTasks(root.taskId);
    if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal(child?.state,'succeeded',JSON.stringify({child,failures:app.runtime.listTasks({limit:30}).items.filter(task=>task.error)}));
  assert.equal(checked,true);assert.equal(returned.state,'current');assert.equal(returned.modelVerification,'conditional');
  assert.equal(returned.capabilityVerification,'unverified');assert.equal(returned.compaction,'original_model_gateway_receipt');assert.equal(returned.budget.tokens.state,'unmeasured');
  assert.ok(summaryCalls>0);assert.equal(knowledgeCalls,1);assert.equal(returned.knowledgeExpansion.state,'confirmed');
  assert.deepEqual(returned.knowledgeExpansion.projection,{publicCitation:'Synthetic public original citation'});
  assert.equal(returned.sourceCount,1);assert.equal(returned.authorizationReplaced,false);
  const nodes=proposals.filter(p=>p.toolName.startsWith('workflow.host.')).map(p=>p.nodeId);
  assert.deepEqual([...nodes].sort(),['F27_N01','F27_N05','F27_N03','F27_N06','F27_N04','F27_N07'].sort());
  assert.ok(nodes.indexOf('F27_N06')<nodes.indexOf('F27_N04'));
  assert.equal(JSON.stringify({exported,imageRequests}).includes(privateText),false);
  assert.equal(JSON.stringify({exported,imageRequests}).includes('Synthetic raw knowledge stays local'),false);
  assert.equal(JSON.stringify({exported,imageRequests}).includes('Synthetic configured public question'),false);
  const marker=app.runtime.loadCheckpoint(child.taskId,'f27:validated-mapping');assert.equal(marker.contextDigest,returned.contextVersion);
  assert.equal(marker.sourceMapDigest,returned.sourceMapDigest);
});
