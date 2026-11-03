import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import * as runtime from '@personal-agent/runtime/application';
import {readF26RegistryImageReference} from '../electron/f26-workflow-worker-ports.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
test('F26 registry readback preserves the top digest for single manifests and indexes while rejecting wrong platforms',async()=>{
  const repository='swr.cn-southwest-2.myhuaweicloud.com/fixture/owned',digest='sha256:'+'a'.repeat(64),child='sha256:'+'b'.repeat(64);
  for(const indexed of [false,true]){
    const calls=[],manifest={mediaType:indexed?'application/vnd.oci.image.index.v1+json':'application/vnd.oci.image.manifest.v1+json',digest,
      ...(indexed?{manifests:[{digest:child,platform:{os:'linux',architecture:'arm64'}},{digest:'sha256:'+'c'.repeat(64),platform:{os:'unknown',architecture:'unknown'}}]}:{})};
    let platform={os:'linux',architecture:'arm64'},current=true;
    const input={repository,imageReference:repository+':fixed',dockerPath:'fixture-docker',root:process.cwd(),deadline:new Date(Date.now()+10000).toISOString(),
      signal:new AbortController().signal,assertCurrent(){assert.equal(current,true);},execFileImpl:async(_executable,args)=>{
        calls.push(args);return {stdout:JSON.stringify(args.at(-1)==='{{json .Manifest}}'?manifest:platform)};
      }};
    assert.equal(await readF26RegistryImageReference(input),repository+'@'+digest);
    assert.equal(calls[1][3],repository+'@'+(indexed?child:digest));
    for(platform of [{os:'linux',architecture:'amd64'},{os:'windows',architecture:'arm64'}])
      await assert.rejects(readF26RegistryImageReference(input),{code:'PROTOCOL_MISMATCH'});
    if(indexed){manifest.manifests.push({digest:child,platform:{os:'linux',architecture:'arm64'}});
      await assert.rejects(readF26RegistryImageReference(input),{code:'PROTOCOL_MISMATCH'});}
    current=false;await assert.rejects(readF26RegistryImageReference(input));
  }
});
// Actual graph, Runtime, Policy, SQLite and business child; image, build, cloud and public HTTP are Fixtures.
test('F26 binds generated image digest and original public tool evidence without replaying the build',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'pa-f26-'));let app,last,builds=0,reads=0;
  const configuration={configurationDigest:'a'.repeat(64),sourceRevision:'b'.repeat(40),sourceDigest:'c'.repeat(64),scriptDigest:'d'.repeat(64),
    imageTag:'fixture:f26',registryReference:'fixture:f26',runtimeId:'runtime',runtimeName:'fixture-runtime',endpointId:'endpoint',endpointName:'fixed-endpoint',version:'fixed-v1',model:{}};
  const built={imageReference:'swr.cn-southwest-2.myhuaweicloud.com/fixture/image@sha256:'+'e'.repeat(64),architecture:'arm64'};
  const research={toolName:'research.search',toolVersion:'0.1.0-alpha.2',arguments:{query:'AgentArts',limit:1}};
  const policy={...research,exportPolicyVersion:'fixture',accepts:()=>true,project:({result})=>result};
  const ports=runtime.createF26WorkflowWorkerPorts({getApplication:()=>app,sourceConfiguration:()=>configuration,
    verifyBuild:receipt=>{assert.equal(receipt.result.exitCode,0);return built;},
    readDeployment:async(_scope,original)=>{assert.deepEqual(original,built);return {...built,podRunning:true,readinessProbe:true};},
    toolExports:[policy],prepareCompetitionToolExport:async()=>{},authorizeExport:async()=>true});
  const tool=(name,version,sideEffect,execute,inputSchema=object({}))=>({descriptor:{name,version,sideEffect,inputSchema,outputSchema:{type:'object'},
    requiredScopes:['fixture:execute'],requiresPresence:false,idempotencySupport:false,recoverySupport:false},execute});
  const choice=tool('decision.choose_candidate','1.0.0','read',async args=>({selectedId:args.candidates[0].id}),
    object({context:{type:'string'},candidates:{type:'array',items:object({id:{type:'string'},description:{type:'string'}})},requestId:{type:'string'}}));
  const command=tool('workspace.f26_release','1.0.0','external_write',async(_args,context)=>{ports.readBuildBinding(context);builds++;return {exitCode:0};},object({recipeId:{const:'f26-owned-image-release'}}));
  const tools=[...ports.tools,choice,command,tool(research.toolName,research.toolVersion,'read',async()=>{reads++;return {items:[{title:'Fixture metadata'}]};},object({query:{type:'string'},limit:{type:'integer'}})),
    runtime.createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(s,w,p)=>app.runDefaultSubagentWorker(s,w,p)})];
  const secret='f26-fixture-receipt-secret-at-least-32';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:'f26-fixture-checkpoint-secret-at-least-32',
    decisionTool:{name:choice.descriptor.name,version:'1.0.0'},receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),
    prepareCandidates:async context=>[{id:'original',description:'Fixed fixture proposal',value:context.node.id==='F26_N04'?{arguments:{},proposal:research}:{arguments:{}}},
      {id:'abstain',description:'No supported release action',abstain:true,value:{}}]});
  const image={bindingId:'f26-fixture',receiptSecret:async()=>secret,advance:async request=>{
    last=await engine.advance(request);
    app.runtime.saveCheckpoint(request.taskId,'f26:image-last',request.requestId);
    app.runtime.saveCheckpoint(request.taskId,'f26:image-readback:'+request.requestId,{workflowId:'F26',taskId:request.taskId,sessionId:request.sessionId,
      bindingId:image.bindingId,resultDigest:hash(last),deploymentVersion:configuration.version});return last;
  }};
  app=runtime.createRuntimeApplication({path:join(dir,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'f26-test',delegateUserTasks:true,tools,
    readDefaultExecutionModel:()=>({modelId:'fixture',catalogRevision:'f'.repeat(64)}),resolveExecutionModel:()=>({modelId:'fixture',catalogRevision:'f'.repeat(64)}),
    configuredWorkflowWorkers:ports.configuredWorkflowWorkerPorts.map(worker=>({...worker,image})),coordinationBinding:'f26-fixture',
    coordination:{execute:async request=>request.continuation?{kind:'text',text:'Fixture done',verification:'mock'}:
      {kind:'tool_proposal',proposalId:'original-f26',toolName:'workflow.release.verify',toolVersion:'1.0.0',arguments:{operation:'verify-selected-release'},verification:'mock'}},
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,exportPolicyVersion:'fixture',accepts:()=>true,project:({result})=>result}))});
  t.after(async()=>{app.close();await rm(dir,{recursive:true,force:true});});
  const client=new Client(app);await client.connect();const parent=await client.call('task.submit',{goal:'Verify fixture release',conversationId:'f26-test'},{idempotencyKey:'f26-original',timeoutMs:120000});
  let graph;const until=Date.now()+20000;
  while(Date.now()<until){
    for(const approval of app.runtime.listApprovals({state:'pending',limit:100}).items)await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    [graph]=app.readSubagentTasks(parent.taskId);if(graph&&app.activeTaskCount===0&&['succeeded','failed','waiting_reconciliation'].includes(graph.state))break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal(graph?.state,'succeeded',JSON.stringify({graph,last:last?.nodes,tasks:app.runtime.listTasks({limit:100}).items.map(task=>({taskId:task.taskId,state:task.state,error:task.error,executions:app.runtime.readToolExecutions(task.taskId)}))}));
  assert.equal(builds,1);assert.equal(reads,1);
  const coverage=app.runtime.loadCheckpoint(graph.taskId,'f26:coverage');assert.equal(coverage.imageReference,built.imageReference);
  assert.equal(coverage.routingChanged,false);assert.ok(coverage.remaining.includes('platform_evaluation'));
});
