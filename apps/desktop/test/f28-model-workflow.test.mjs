import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {createRuntimeApplication,createDesktopSubagentDispatchTool,createConfiguredSubagentModelGateway} from '@personal-agent/runtime/application';
import {createModelApiConfig} from '../electron/model-api-config.js';
import {createDesktopF28WorkflowWorkerPorts} from '../electron/f28-model-workflow-ports.js';

test('F28 actual graph uses original guarded ModelGateway calls and retains unverified candidates locally',async t=>{
  // Actual Engine, Runtime, Policy, SQLite, configuration and ModelGateway/Provider.
  // safeStorage, HTTP, candidate selection and human responses are explicit Fixtures.
  const directory=await mkdtemp(join(tmpdir(),'pa-f28-'));let app,returned;
  const privateGoal='Synthetic private original F28 goal',privateCandidate='Synthetic private model candidate';
  const sent=[],modelApprovals=[],exports=[],imageRequests=[],proposals=[],n12Tools=[];let leafCalls=0;
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:buffer=>Buffer.from(buffer).reverse().toString()};
  const fetchImpl=async(_url,options)=>{
    const payload=JSON.parse(options.body);sent.push(payload);
    assert.equal(modelApprovals.length,sent.length);assert.equal(payload.tools,undefined);
    return new Response(JSON.stringify({choices:[{message:{content:privateCandidate+' '+sent.length},finish_reason:'stop'}],
      usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}),{headers:{'content-type':'application/json'}});
  };
  const createGateway=config=>createConfiguredSubagentModelGateway({...config,fetch:config.fetch??fetchImpl});
  const modelApiHost=createModelApiConfig({userData:directory,safeStorage,createGateway,createGuardedGateway:createGateway,fetchImpl});
  modelApiHost.configure({id:'synthetic-model',provider:'openai-compatible',baseUrl:'https://synthetic.invalid/v1',model:'synthetic-text',
    displayName:'Fixture',apiKey:'synthetic-secret',enabled:true,makeDefault:true});
  assert.equal(sent.length,0);
  const factory=createDesktopF28WorkflowWorkerPorts({getApplication:()=>app,modelApiHost,
    authorizeExport:async request=>{exports.push(structuredClone({...request,signal:undefined}));return true;},
    confirmModelExport:async request=>{request.assertCurrent();modelApprovals.push(request.payload);return true;}});
  const secret='synthetic-f28-original-receipt-secret-at-least-32-bytes';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:secret,decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},
    receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async context=>[
      {id:'supported',description:'Synthetic original bounded model candidate',value:context.node.id==='F28_N02'?context.input.decisionOutput
        :context.node.id==='F28_N05'?context.input.reviewOutput:{arguments:{}},
        ...(context.node.id==='F28_N02'?{branches:context.input.branches}:{})},
      {id:'review',description:'Synthetic abstention',value:null,abstain:true}]});
  const image={bindingId:'synthetic-f28-actual-engine',receiptSecret:async()=>secret,advance:async request=>{
    imageRequests.push(structuredClone({...request,signal:undefined}));const result=await engine.advance(request);proposals.push(...result.proposals);return result;}};
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    getToolsForSubtask:(subtask,worker)=>factory.getToolsForSubtask(subtask,worker,app.tools),
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const leaf={descriptor:{name:'synthetic.f28.read',version:'1.0.0',inputSchema:{type:'object',additionalProperties:false,properties:{},required:[]},
    outputSchema:{type:'object',additionalProperties:false,properties:{observed:{type:'boolean'}},required:['observed']},sideEffect:'read',requiredScopes:['synthetic:read'],
    idempotencySupport:false,recoverySupport:false,requiresPresence:false},execute:async()=>{leafCalls++;return {observed:true};}};
  const excluded={...leaf,descriptor:{...leaf.descriptor,name:'synthetic.f28.other'},execute:async()=>assert.fail('unbound sibling tool must not run')};
  const tools=[dispatch,createWorkflowDecisionTool({selector:{select:async()=> 'supported'}}),leaf,excluded,...factory.tools];
  app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f28',delegateUserTasks:true,
    coordinationBinding:'synthetic-f28-deployment',tools,getToolsForSubtask:factory.getToolsForSubtask,
    configuredWorkflowWorkers:factory.configuredWorkflowWorkerPorts.map(worker=>({...worker,image})),
    automaticTools:[{toolName:dispatch.descriptor.name,toolVersion:'1.0.0'}],coordination:{execute:async request=>{
      if(app.runtime.loadCheckpoint(request.taskId,'f28:tool-scope-origin')){
        n12Tools.push((request.availableTools??[]).map(tool=>tool.name));
        return request.continuation?{kind:'text',text:'Synthetic original read observed',verification:'mock'}
          :{kind:'tool_proposal',proposalId:'synthetic-f28-original-read',toolName:leaf.descriptor.name,toolVersion:'1.0.0',arguments:{},verification:'mock'};
      }
      if(request.continuation){if(request.continuation.result?.state==='candidate_only')returned=request.continuation.result;
        return {kind:'text',text:'Synthetic local candidate references',verification:'mock'};}
      return {kind:'tool_proposal',proposalId:'synthetic-f28-candidates',toolName:'workflow.f28.model_candidates',toolVersion:'1.0.0',
        arguments:{toolExecution:{tools:[{name:leaf.descriptor.name,version:'1.0.0'}],maxSteps:4}},verification:'mock'};
    }},competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result}))});
  t.after(async()=>{app.close();modelApiHost.dispose();await rm(directory,{recursive:true,force:true});});
  const client=new Client(app);await client.connect();const root=await client.call('task.submit',{goal:privateGoal,conversationId:'f28-chat'},
    {idempotencyKey:'synthetic-f28',timeoutMs:60000});
  let child;const end=Date.now()+20000;
  while(Date.now()<end){
    for(const approval of app.runtime.listApprovals({state:'pending',limit:100}).items)
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    [child]=app.readSubagentTasks(root.taskId);
    if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal(child?.state,'succeeded',JSON.stringify({child,failures:app.runtime.listTasks({limit:30}).items.filter(task=>task.error)}));
  assert.equal(sent.length,3);assert.equal(modelApprovals.length,3);
  assert.equal(JSON.stringify(sent).includes(privateGoal),true);assert.equal(JSON.stringify(sent[2]).includes(privateCandidate),true);
  assert.equal(returned.sourcesSupported,'unverified');assert.equal(returned.tests,'not_run');assert.equal(returned.nativeCapabilityVerification,'unverified');
  const hostOrder=proposals.filter(p=>p.toolName.startsWith('workflow.host.')).map(p=>p.nodeId);
  assert.deepEqual([...hostOrder].sort(),['F28_N03','F28_N06','F28_N07','F28_N08','F28_N10','F28_N11','F28_N12'].sort());
  assert.equal(hostOrder.indexOf('F28_N12')<hostOrder.indexOf('F28_N10'),true);
  assert.equal(leafCalls,1);assert.equal(returned.toolExecution.state,'completed');assert.equal(returned.toolExecution.actualToolCalls,1);
  assert.deepEqual(n12Tools[0],['synthetic.f28.read']);assert.ok(n12Tools.every(names=>names.every(name=>name==='synthetic.f28.read')));
  const toolChild=returned.toolExecution.taskId;assert.equal(app.readToolConversation(toolChild),'f28-chat');
  assert.equal(app.runtime.readToolExecutions(toolChild)[0].policyDecision,'allow');
  const expectedRevision=app.runtime.getTask(child.taskId).revision;
  assert.equal(factory.readLocalCandidates({taskId:child.taskId,conversationId:'f28-chat',expectedRevision}).candidates.length,3);
  assert.throws(()=>factory.readLocalCandidates({taskId:child.taskId,conversationId:'other-chat',expectedRevision}),{code:'UNAUTHORIZED'});
  assert.equal(JSON.stringify({exports,imageRequests}).includes(privateGoal),false);
  assert.equal(JSON.stringify({exports,imageRequests}).includes(privateCandidate),false);
  for(const node of ['F28_N06','F28_N07','F28_N08']){
    const receipt=app.runtime.loadCheckpoint(child.taskId,'f28:model:'+node);
    assert.equal(receipt.result.response.text.startsWith(privateCandidate),true);
    assert.equal(app.readHostToolTask(receipt.taskId).confirmed.runId,receipt.runId);
    assert.equal(app.runtime.loadCheckpoint(child.taskId,'f28:model:'+node+':attempted').requestDigest,receipt.requestDigest);
  }
});
