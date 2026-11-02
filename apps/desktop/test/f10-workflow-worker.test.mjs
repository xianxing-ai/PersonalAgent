import {syntheticCoordinationExecution} from '../../../tests/helpers/synthetic-agentarts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import {OpenAlexProvider} from '@personal-agent/research';
import {openReadOnlyVault} from '@personal-agent/knowledge/filesystem';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createPublicConnectorHost} from '../electron/public-connector-host.js';
import {createModelApiConfig} from '../electron/model-api-config.js';
import {createConfiguredDesktopF10WorkflowPorts} from '../electron/f10-workflow-worker-ports.js';
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});

// Actual factories, Engine, SQLite, file source/policy, auxiliary gateway/provider and final fetch guard.
// Research records, cloud/candidate decisions, encryption, native consent and HTTP replies are explicit Fixtures.
test('F10 keeps research metadata distinct, uses the original 200-character knowledge projection, and revocation after credentials sends zero HTTP',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pa-f10-')),vaultPath=join(directory,'vault');await mkdir(vaultPath);
  const privateTail='PRIVATE_TAIL_DO_NOT_EXPORT';await writeFile(join(vaultPath,'note.md'),'Project has a documented local read boundary. '+'.'.repeat(190)+privateTail+'\n');
  const vault=await openReadOnlyVault({rootPath:vaultPath,vaultId:'f10-public'});let app,dataLevel='public',revokeAfterCredentials=false,http=0,consents=0,last;
  const captured=[],modelBodies=[],binding=()=>({sourceId:'f10-public',configRevision:1,namespace:'f10-knowledge',configured:true,available:true,enabled:true,
    writeAvailable:false,dataLevel,cloudExportAllowed:true,publicQueries:['project'],allowedNotePaths:[]});
  const source={snapshot:binding,acquire(expected,signal){assert.equal(expected.sourceId,'f10-public');assert.equal(expected.configRevision,1);
    const current=()=>assert.equal(dataLevel,'public');return {binding:binding(),signal,release(){},assertCurrent:current,read:{search:request=>vault.search(request),
      readCitation:request=>vault.readCitation(request),assertCitationCurrent:request=>vault.assertCitationCurrent(request)}};}};
  const knowledge=runtimeModule.createTrustedKnowledgeTools(source),publicTools=createPublicConnectorHost({researchProvider:new OpenAlexProvider({
    fetchImpl:async()=>({ok:true,status:200,json:async()=>({results:[{id:'https://openalex.org/W-fixture',display_name:'Agent research metadata fixture'}]})})})});
  const research=publicTools.tools.find(tool=>tool.descriptor.name==='research.search');
  const models=createModelApiConfig({userData:join(directory,'models'),safeStorage:{isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text),decryptString:value=>value.toString()},
    createGateway:runtimeModule.createConfiguredSubagentModelGateway,
    createGuardedGateway:options=>runtimeModule.createConfiguredSubagentModelGateway({...options,apiKey:async()=>{const key=await options.apiKey();if(revokeAfterCredentials)dataLevel='private';return key;}}),
    fetchImpl:async(_url,request)=>{http++;const body=JSON.parse(request.body);modelBodies.push(body);const input=JSON.parse(body.messages.at(-1).content);
      return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({state:input.sourceKind==='metadata_only'?'unknown':'supported'})},finish_reason:'stop'}]}),
        {status:200,headers:{'content-type':'application/json'}});}});
  models.configure({id:'aux-review',provider:'openai-compatible',baseUrl:'https://fixture.invalid/v1',model:'fixture-review',displayName:'Explicit auxiliary fixture',apiKey:'fixture-not-a-secret',enabled:true,makeDefault:true});
  const originalPolicies=[...knowledge.competitionToolExports,...publicTools.competitionToolExports.filter(policy=>policy.toolName==='research.search')];
  let reviewError;
  const tracedRuntime={...runtimeModule,createF10WorkflowWorkerPorts:options=>runtimeModule.createF10WorkflowWorkerPorts({...options,
    reviewClaim:async(...args)=>{try{return await options.reviewClaim(...args);}catch(error){reviewError=error;throw error;}}})};
  const bundle=createConfiguredDesktopF10WorkflowPorts({runtimeModule:tracedRuntime,getApplication:()=>app,getKnowledgeSourceConfig:()=>source,modelApiHost:models,
    toolExports:originalPolicies,prepareCompetitionToolExport:async()=>{},authorizeExport:async request=>{captured.push(request.value);return true;},
    confirmModelExport:async request=>{consents++;assert.equal(request.model.role,'independent_auxiliary_reviewer');assert.equal(request.model.provider,'openai-compatible');return request.isCurrent();}});
  const choice={descriptor:{name:'decision.choose_candidate',version:'1.0.0',inputSchema:object({context:{type:'string'},candidates:{type:'array',items:object({id:{type:'string'},description:{type:'string'}})},requestId:{type:'string'}}),
    outputSchema:object({selectedId:{type:'string'}}),sideEffect:'read',requiredScopes:['decision:choose'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},execute:async args=>({selectedId:args.candidates[0].id})};
  const tools=[research,...knowledge.tools,choice,...bundle.tools,runtimeModule.createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(task,worker,scope)=>app.runDefaultSubagentWorker(task,worker,scope)})];
  const secret='synthetic-f10-receipt-secret-32-characters';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:'synthetic-f10-checkpoint-secret-32-characters',decisionTool:{name:choice.descriptor.name,version:'1.0.0'},
    receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async context=>{
      let value={arguments:{}};
      if(context.node.id==='F10_N05')value={arguments:{},findings:['F10_N02','F10_N03','F10_N04'].map(nodeId=>{const source=context.predecessorOutputs[nodeId].sources[0];assert.ok(source);
        return {claimId:nodeId,claim:source.kind==='metadata_only'?'Metadata alone establishes no paper result.':'Project has a documented local read boundary.',
          sourceRef:source.sourceRef,revision:source.revision,quote:source.text.slice(0,120)};})};
      if(context.node.id==='F10_N06')value={recommendation:'Synthetic cautious comparison; inspect original papers separately.',claimIds:context.predecessorOutputs.F10_N05.correctionsApplied.map(item=>item.claimId)};
      return [{id:'selected',description:'Synthetic exact source candidate',value},{id:'abstain',description:'Preserve uncertainty',value:{},abstain:true}];}});
  const image={bindingId:'synthetic-f10',receiptSecret:async()=>secret,advance:async request=>(last=await engine.advance(request))};
  app=runtimeModule.createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'f10-test',delegateUserTasks:true,tools,
    readDefaultExecutionModel:()=>({modelId:'synthetic-executor',catalogRevision:'a'.repeat(64)}),resolveExecutionModel:()=>({modelId:'synthetic-executor',catalogRevision:'a'.repeat(64)}),
    configuredWorkflowWorkers:bundle.configuredWorkflowWorkerPorts.map(worker=>({...worker,image})),coordinationBinding:'synthetic-f10',
    coordination:{execute:syntheticCoordinationExecution(async request=>request.continuation?{kind:'text',text:'Synthetic completed',verification:'mock'}:{kind:'tool_proposal',proposalId:'f10-original',toolName:'workflow.research.compare',
      toolVersion:'1.0.0',arguments:{queryA:'agent',queryB:'research',knowledgeQuery:'project',limit:1},verification:'unverified'})},
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:[...originalPolicies,...tools.filter(tool=>!originalPolicies.some(policy=>policy.toolName===tool.descriptor.name)).map(tool=>({toolName:tool.descriptor.name,
      toolVersion:tool.descriptor.version,exportPolicyVersion:'synthetic',accepts:()=>true,project:({result})=>result}))]});knowledge.bindApplication(app);
  t.after(async()=>{app.close();models.dispose();publicTools.close();await rm(directory,{recursive:true,force:true});});
  async function run(id){const client=new Client(app);await client.connect();const parent=await client.call('task.submit',{goal:'Synthetic F10 comparison',conversationId:id},{idempotencyKey:id,timeoutMs:120000});
    let graph;const end=Date.now()+20000;while(Date.now()<end){for(const approval of app.runtime.listApprovals({state:'pending',limit:100}).items)
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      [graph]=app.readSubagentTasks(parent.taskId);if(graph&&app.activeTaskCount===0&&['succeeded','failed','waiting_reconciliation'].includes(graph.state))return graph;
      await new Promise(resolve=>setTimeout(resolve,5));}throw Error('F10 graph did not settle');}
  const graph=await run('normal');assert.equal(graph.state,'succeeded',reviewError?.stack??JSON.stringify(last?.nodes));
  assert.equal(http,3);assert.equal(consents,3);assert.equal(JSON.stringify(captured).includes(privateTail),false);assert.equal(JSON.stringify(modelBodies).includes(privateTail),false);
  const final=captured.find(value=>value?.summaryTableReady);assert.deepEqual(final.rows.map(row=>row.state),['unknown','unknown','supported']);assert.equal(final.coverage.research,'metadata_only');
  assert.equal(final.reviewer.provider,'openai-compatible');assert.equal(final.verification,'model_advisory');
  revokeAfterCredentials=true;const next=await run('revoked');assert.notEqual(next.state,'succeeded');assert.equal(http,3,'credential-time source revocation must prevent HTTP');
});
