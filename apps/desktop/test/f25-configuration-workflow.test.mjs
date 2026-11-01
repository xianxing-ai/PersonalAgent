import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {createRuntimeApplication,createDesktopSubagentDispatchTool,AuthorizationQuestions} from '@personal-agent/runtime/application';
import {createKnowledgeSourceConfig} from '../electron/knowledge-source-config.js';
import {createAgentArtsConfig} from '../electron/agentarts-config.js';
import {createDesktopAuthorizationIntentHost} from '../electron/authorization-intent-host.js';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {prepareConfiguredWorkflowDecisionQuestion} from '../electron/configured-workflow-decision-source.js';
import {createDesktopF25Configuration,createDesktopF25WorkflowWorkerPorts} from '../electron/f25-configuration-host.js';

test('F25 actual graph applies original scope through Intent and preserves unverified account state without exporting its source body',async t=>{
  // Real files, configuration hosts, Engine, Intent/Question, Runtime, Policy and SQLite.
  // Encryption, account credentials, candidates/selector and the human responses are explicit Fixtures; no network request.
  const directory=await mkdtemp(join(tmpdir(),'pa-f25-')),userData=join(directory,'host'),vault=join(directory,'vault');
  await mkdir(userData);await mkdir(vault);
  const privateName='synthetic-private-filename.md',privateQuery='synthetic-private-selection-query';
  await writeFile(join(vault,privateName),'Synthetic source body, never a cloud prompt');
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
  let app,questions,returned;const exported=[],cloudRequests=[],proposals=[],intentControls=[];
  const questionFacade=new Proxy({},{get(_target,name){return(...args)=>questions[name](...args);}});
  const intents=createDesktopAuthorizationIntentHost({getApplication:()=>app,question:questionFacade,openConversation(){}});
  const account=createAgentArtsConfig({userData,safeStorage,environment:{},fetchImpl:async()=>assert.fail('configuration must not probe a network')});
  account.configure({gatewayUrl:'https://synthetic.huaweicloud-agentarts.com',runtimeName:'synthetic-runtime',authorization:'Synthetic account credential, not for export'});
  const source=await createKnowledgeSourceConfig({userData,safeStorage,namespace:'synthetic-f25',hostIdentity:'synthetic-host',
    selectDirectory:async()=>vault,selectNoteFiles:async()=>[join(vault,privateName)],
    confirmPermissions:async(details,control)=>{intentControls.push(control);const {isCurrent,...payload}=details;
      return intents.request({action:'knowledge.configure',payload,scope:{sourceId:details.sourceId,configRevision:details.configRevision},
        summary:'Synthetic exact PUBLIC catalog consent',isCurrent,...control});}});
  await source.select();await source.selectNotes({sourceId:source.snapshot().sourceId,configRevision:source.snapshot().configRevision});
  const before=source.readDataScopeConfiguration(),configuration=createDesktopF25Configuration({userData,safeStorage,getAgentArtsConfig:()=>account,getKnowledgeSourceConfig:()=>source});
  configuration.configure({expectedRevision:0,dataLevel:'public',cloudExportAllowed:true,publicQueries:[privateQuery]});
  assert.deepEqual(source.readDataScopeConfiguration(),before,'staging is not an execution or source permission');
  const factory=createDesktopF25WorkflowWorkerPorts({getApplication:()=>app,configuration,authorizeExport:async request=>{exported.push(request);return true;}});
  const secret='synthetic-f25-original-receipt-secret-at-least-32-bytes';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:secret,decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},
    receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async context=>[
      {id:'supported',description:'Synthetic exact staged scope',value:context.node.id==='F25_N02'?context.input.decisionOutput:{arguments:{}}},
      {id:'review',description:'Synthetic abstention',value:null,abstain:true}]});
  const image={bindingId:'synthetic-f25-actual-engine',receiptSecret:async()=>secret,advance:async request=>{
    cloudRequests.push(structuredClone({...request,signal:undefined}));const result=await engine.advance(request);proposals.push(...result.proposals);return result;}};
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const tools=[dispatch,intents.tool,createWorkflowDecisionTool({selector:{select:async()=> 'supported'}}),...factory.tools];
  app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f25',delegateUserTasks:true,
    coordinationBinding:'synthetic-f25',tools,configuredWorkflowWorkers:factory.configuredWorkflowWorkerPorts.map(worker=>({...worker,image})),
    automaticTools:[{toolName:dispatch.descriptor.name,toolVersion:'1.0.0'}],requestToolAuthorization:scope=>{
      intents.prepareQuestion(scope);prepareConfiguredWorkflowDecisionQuestion({application:app,scope,question:questions});return questions.requestToolAuthorization(scope);},
    coordination:{execute:async request=>{
      if(request.continuation){if(request.continuation.result?.configurationRef)returned=request.continuation.result;
        return {kind:'text',text:'Synthetic configuration result',verification:'mock'};}
      return {kind:'tool_proposal',proposalId:'synthetic-f25-scope',toolName:'workflow.f25.configure_data_scope',toolVersion:'1.0.0',arguments:{},verification:'mock'};
    }},competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result}))});
  questions=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'synthetic-f25-questions',resolveConversation:()=> 'f25-chat',available:()=>true,
    profiles:[{ref:'synthetic',label:'Synthetic test policy',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'synthetic'});
  t.after(async()=>{intents.close();questions.close();app.close();configuration.close();source.close();await rm(directory,{recursive:true,force:true});});
  const client=new Client(app);await client.connect();
  const root=await client.call('task.submit',{goal:'Apply the staged account data scope',conversationId:'f25-chat'},
    {idempotencyKey:'synthetic-f25',timeoutMs:60000});
  let child;const end=Date.now()+20000;
  while(Date.now()<end){
    for(const q of questions.snapshot('f25-chat').filter(item=>item.state==='pending'))
      questions.respond({questionId:q.questionId,expectedRevision:q.revision,decision:'allow_once'},'f25-chat');
    [child]=app.readSubagentTasks(root.taskId);
    if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal(child?.state,'succeeded',JSON.stringify({child,tasks:app.runtime.listTasks({limit:30}).items.filter(task=>task.error)}));
  assert.deepEqual(source.readDataScopeConfiguration(),{...before,configRevision:before.configRevision+1,dataLevel:'public',cloudExportAllowed:true,publicQueries:[privateQuery]});
  assert.equal(intentControls.length,1);assert.ok(intentControls[0].signal instanceof AbortSignal);
  assert.equal(intentControls[0].deadline,app.runtime.loadCheckpoint(child.taskId,'application-deadline'));
  assert.equal(returned.saved,true);assert.equal(returned.pingConnected,'unverified');assert.equal(returned.capabilityTested,'unverified');
  assert.equal(returned.accountActive,'unverified');assert.equal(returned.sourceRevision,before.configRevision+1);
  assert.deepEqual(proposals.filter(p=>p.toolName.startsWith('workflow.host.')).map(p=>p.nodeId),['F25_N03','F25_N04']);
  assert.equal(configuration.snapshot().stage,'saved');
  const serialized=JSON.stringify({exported,cloudRequests});
  for(const privateValue of [privateName,privateQuery,'Synthetic account credential, not for export'])assert.equal(serialized.includes(privateValue),false);
  const n03=exported.find(item=>item.proposal?.toolName==='workflow.host.f25_n03');assert.deepEqual(n03.value.result.filteredOut,['private_source','export_not_authorized']);
  assert.equal(JSON.stringify(app.runtime.loadCheckpoint(n03.localTaskId,'f25:outbound-source')).includes(privateName),false,'N03 persists only its digest and conclusion');
  assert.equal((await readFile(join(userData,'f25-data-scope.json'),'utf8')).includes(privateQuery),false,'staged private scope stays in the existing encryption boundary');
});
