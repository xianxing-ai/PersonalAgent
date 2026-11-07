import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {openReadOnlyVault} from '@personal-agent/knowledge/filesystem';
import {createRuntimeApplication,createDesktopSubagentDispatchTool,createRuntimeOwnedWorkflowImageAdapter} from '../dist/application.js';
import {createTrustedKnowledgeTools} from '../dist/application/knowledge-tools.js';
import {createF05WorkflowWorkerPorts} from '../dist/application/workflow-f05-worker.js';

// Actual Engine, SQLite, source files, search, Runtime, Policy and ToolGateway.
// Candidate preparation/selection, user approvals and cloud transport are Synthetic.
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const secret='synthetic-f05-receipt-secret-longer-than-32';
const composition=readFileSync(new URL('../dist/application/agentarts.js',import.meta.url),'utf8');
const imageBegin=composition.indexOf('const ownedImage ='),imageEnd=composition.indexOf('const f09FromPorts =',imageBegin);
assert.ok(imageBegin>=0&&imageEnd>imageBegin);
async function fixture(t,{expand=false,unknown=false,onExport,tamperCandidate=false,newQuery='expansion',unknownSearch=false,changeAfterCredentials=false,
  longExcerpt=false,revokeProjection,gapUnknown=false}={}) {
  const directory=await mkdtemp(join(tmpdir(),'pa-f05-'));let app,facts,searches=0,credentialReads=0,httpSends=0;
  const longTail=longExcerpt?' '+'.'.repeat(190)+'PRIVATE_TAIL_DO_NOT_EXPORT':'';
  await writeFile(join(directory,'original.md'),'Initial source states that Mercury is a planet.'+longTail+'\n');
  await writeFile(join(directory,'expanded.md'),'Expansion source states that Venus is a planet.'+longTail+'\n');
  const vault=await openReadOnlyVault({rootPath:directory,vaultId:'synthetic-vault'});
  const config={sourceId:'synthetic-vault',configRevision:1,publicQueries:['initial','expansion'],memoryNamespace:'synthetic-memory'};
  let dataLevel='public';
  const binding=()=>({...config,namespace:'synthetic-knowledge',available:true,writeAvailable:false,dataLevel,cloudExportAllowed:true,allowedNotePaths:[]});
  const knowledge=createTrustedKnowledgeTools({snapshot:binding,acquire(expected,signal){
    const revision=config.configRevision;assert.equal(expected.sourceId,config.sourceId);assert.equal(expected.configRevision,revision);
    return {binding:binding(),signal,release(){},assertCurrent(){assert.equal(config.configRevision,revision);},
      read:{search:async request=>{searches++;if(unknownSearch)throw new ProtocolError('RESULT_UNKNOWN','Synthetic lost original search reply');return vault.search(request);}}};
  }});
  const exports=[],cloud=[],images=[],rawResults=[];
  const originalSearch=knowledge.tools[0].execute;
  knowledge.tools[0].execute=async(...args)=>{const result=await originalSearch(...args);rawResults.push(result);return result;};
  const policy=knowledge.competitionToolExports[0],originalProject=policy.project;
  if(revokeProjection==='after')policy.project=async request=>{const result=originalProject(request);await Promise.resolve();dataLevel='private';return result;};
  const bundle=createF05WorkflowWorkerPorts({getApplication:()=>app,sourceConfiguration:()=>dataLevel==='public'?({...config,publicQueries:[...config.publicQueries]}):undefined,
    memory:{listCurrent:request=>facts.publicMemory.listCurrent(request)},readCurrentFact:ref=>facts.readCurrentPublicFact(ref),
    readCitation:({source},scope)=>vault.readCitation({source,deadline:scope.deadline,signal:scope.signal}),
    assertCitationCurrent:({source},scope)=>vault.assertCitationCurrent({source,deadline:scope.deadline,signal:scope.signal}),
    knowledgeToolExport:policy,prepareCompetitionToolExport:async request=>{
      assert.equal(request.phase,'projection');assert.equal(request.proposal.toolName,'knowledge.search');
      if(revokeProjection==='before')dataLevel='private';
    },
    authorizeExport:async request=>{exports.push(request);await onExport?.({request,app,facts,config,directory});return true;}});
  const choice={descriptor:{name:'decision.choose_candidate',version:'1.0.0',inputSchema:object({context:{type:'string'},
    candidates:{type:'array',items:object({id:{type:'string'},description:{type:'string'}})},requestId:{type:'string'}}),
    outputSchema:object({selectedId:{type:'string'}}),sideEffect:'read',requiredScopes:['decision:choose'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},
    execute:async args=>({selectedId:args.candidates[0].id})};
  const tools=[knowledge.tools[0],choice,...bundle.tools,createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,scoped)=>app.runDefaultSubagentWorker(subtask,worker,scoped)})];
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:'synthetic-f05-checkpoint-secret-longer-than-32',
    decisionTool:{name:choice.descriptor.name,version:'1.0.0'},receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),
    prepareCandidates:async context=>{
      let value={arguments:{}};
      if(context.node.id==='F05_N03')value=expand?{action:'expand',query:newQuery}:{action:unknown||gapUnknown?'unknown':'answer'};
      if(context.node.id==='F05_N04'){
        const text=expand?'Expansion source states that Venus is a planet.':'Initial source states that Mercury is a planet.';
        value={version:1,answer:unknown?'Insufficient source support.':text,claims:unknown?[]:[{id:'claim-one',text,
          citations:[{sourceId:tamperCandidate?'expanded:99':expand?'expanded:0':'initial:0',quote:text}]}],unresolved:unknown?['No supported claim.']:[]};
      }
      if(context.node.id==='F05_N05')value={arguments:{verdict:unknown?'unknown':'supported',claimIds:unknown?[]:['claim-one'],unresolved:unknown?['No supported claim.']:[]}};
      return [{id:'selected',description:'Synthetic exact original candidate',value},{id:'recheck',description:'Synthetic abstention',value:{},abstain:true}];
    }});
  const assertWorkflowCurrent=request=>bundle.configuredWorkflowWorkerPorts[0].assertCurrent({taskId:request.taskId,
    deadline:request.taskDeadline??request.deadline,signal:request.signal});
  const compositionContext=Object.fromEntries(['fetchHandlesHostAuthorization','transport','websocketUrl','allowHttpsFallback',
    'websocketAuthorizationProvider','websocketFactory','invokeMode','workflowGoalInput','assertDeploymentBinding',
    'onTransportState','readOwnedWorkflowReceiptSecret'].map(key=>[key,undefined]));
  Object.assign(compositionContext,{ProtocolError,createRuntimeOwnedWorkflowImageAdapter,initialRequestMode:'goal-with-tools-json',
    gatewayUrl:'https://fixture.invalid',runtimeName:'synthetic-f05',deploymentVersion:'fixed',f20WorkflowWorkerPorts:undefined,
    configuredWorkflowWorkerPorts:bundle.configuredWorkflowWorkerPorts,authorizationProvider:{read:async()=>{credentialReads++;
      await writeFile(join(directory,'original.md'),'Source changed while reading the original credential.\n');return 'Bearer synthetic';}},
    fetchImpl:async()=>{httpSends++;throw Error('Stale F05 source must never reach HTTP');}});
  const transport=runInNewContext(composition.slice(imageBegin,imageEnd)+'\nownedImage;',compositionContext);
  t.after(()=>transport.close());
  const image={bindingId:'synthetic-f05-image',advance:request=>{
    assertWorkflowCurrent(request);
    images.push(JSON.stringify({input:request.input,receipts:request.receipts,resolvedValues:request.resolvedValues}));
    if(changeAfterCredentials&&request.receipts?.some(receipt=>receipt.nodeId==='F05_N05'&&receipt.result?.verdict))return transport.advance(request);
    return engine.advance(request);
  },receiptSecret:async()=>secret};
  const appOptions={path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'synthetic-f05',
    tools,configuredWorkflowWorkers:bundle.configuredWorkflowWorkerPorts.map(worker=>({...worker,image})),coordinationBinding:'synthetic-f05-deployment',
    coordination:{execute:async request=>{cloud.push(request);
      if(app.runtime.getTask(request.taskId).conversationId==='synthetic-chat'||request.continuation)return {kind:'text',text:'Synthetic graph result',verification:'mock'};
      return {kind:'tool_proposal',proposalId:'synthetic-f05-proposal',toolName:'workflow.memory.answer',toolVersion:'1.0.0',
        arguments:{query:'initial',factId:'original-fact',limit:2},verification:'unverified'};}},
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:tool.descriptor.name==='knowledge.search'?['/sourceId','/configRevision','/query']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result}))};
  app=createRuntimeApplication(appOptions);
  knowledge.bindApplication(app);
  facts=app.createCompetitionFactHost({memoryPath:join(directory,'memory.sqlite'),memoryNamespace:config.memoryNamespace,graphNamespace:'synthetic-f05-graph',consumerKey:'synthetic-f05'});
  facts.recordPublicSource({vaultId:'synthetic-vault',path:'original.md',factId:'original-fact',sourceRevision:'a'.repeat(64),line:1,
    summary:'A versioned Fact summary, not an original quotation.',observedAt:new Date().toISOString(),validFrom:'2026-01-01T00:00:00.000Z',
    validUntil:'2099-01-01T00:00:00.000Z',expectedFactRevision:null},{deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal});
  const client=new Client(app);await client.connect();
  t.after(async()=>{facts.close();app.close();await rm(directory,{recursive:true,force:true});});
  async function run(){
    const root=await client.call('task.submit',{goal:'Answer from the configured original sources',conversationId:'synthetic-chat'},
      {idempotencyKey:'synthetic-f05-root',timeoutMs:60000});
    const end=Date.now()+30000;let child;
    while(Date.now()<end){
      for(const approval of app.runtime.listApprovals({state:'pending',limit:100}).items)
        await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      [child]=app.readSubagentTasks(root.taskId);
      if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))return {root,child};
      if(revokeProjection&&child?.state==='waiting_approval'&&app.activeTaskCount===0
        &&app.runtime.listTasks({limit:100}).items.some(task=>task.state==='failed'
          &&app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName==='workflow.host.f05_n02'))return {root,child};
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.fail('F05 did not settle: '+JSON.stringify(app.runtime.listTasks({limit:50}).items.map(task=>({id:task.taskId,state:task.state,error:task.error}))));
  }
  return {get app(){return app;},facts,bundle,run,cloud,exports,images,rawResults,counts:()=>({searches,credentialReads,httpSends}),
    reopen(){app.close();app=createRuntimeApplication(appOptions);knowledge.bindApplication(app);},
    diagnostics:()=>app.runtime.listTasks({limit:50}).items.filter(task=>task.error).map(task=>({task,runs:app.runtime.readToolExecutions(task.taskId)}))};
}

for(const expand of [false,true])test(`F05 actual original source graph publishes with expansion=${expand}`,async t=>{
  const f=await fixture(t,{expand}),{child}=await f.run();assert.equal(child.state,'succeeded',JSON.stringify(f.diagnostics()));
  const result=f.cloud.find(request=>request.taskId===child.taskId&&request.continuation)?.continuation.result;
  assert.equal(result.state,'supported');assert.equal(result.citations[0].sourceId,expand?'expanded:0':'initial:0');
  assert.equal(f.counts().searches,expand?2:1,'receipt checks only reread exact citations, not the original search');
  assert.equal(result.verification,'source_versions_checked_model_support_advisory');
  assert.ok(f.exports.some(request=>request.stage==='completion'));
});
test('F05 explicitly unknown source support stays unknown in the delivered answer',async t=>{
  const f=await fixture(t,{unknown:true}),{child}=await f.run();assert.equal(child.state,'succeeded',JSON.stringify(f.diagnostics()));
  const result=f.cloud.find(request=>request.taskId===child.taskId&&request.continuation)?.continuation.result;
  assert.equal(result.state,'unknown');assert.equal(result.citations.length,0);assert.ok(result.unresolved.length);
});
test('F05 rejects fabricated citations and unavailable or repeated expansion queries',async t=>{
  for(const options of [{tamperCandidate:true},{expand:true,newQuery:'not-configured'},{expand:true,newQuery:'initial'}]){
    const f=await fixture(t,options),{child}=await f.run();assert.equal(child.state,'failed');
    assert.equal(f.exports.some(request=>request.stage==='completion'),false);assert.equal(f.counts().searches,1);
  }
});
test('F05 source change during exact export cannot publish an answer',async t=>{
  const f=await fixture(t,{onExport:async({request,directory})=>{
    if(request.stage==='receipt'&&request.proposal?.nodeId==='F05_N05'&&request.proposal.toolName==='workflow.host.f05_n05')
      await writeFile(join(directory,'original.md'),'Source changed after support review.\n');
  }}),{child}=await f.run();assert.equal(child.state,'failed');assert.equal(f.exports.some(request=>request.stage==='completion'),false);
  assert.ok(f.exports.some(request=>request.proposal?.toolName==='workflow.host.f05_n05'),'failure follows actual original support review');
});
test('F05 original unknown query survives SQLite reopen and does not replay on resume',async t=>{
  const f=await fixture(t,{unknownSearch:true}),{child}=await f.run();assert.equal(child.state,'waiting_reconciliation',JSON.stringify(f.diagnostics()));
  assert.equal(f.counts().searches,1);assert.equal(f.exports.some(request=>request.stage==='completion'),false);
  f.reopen();assert.equal(f.app.runtime.getTask(child.taskId).state,'waiting_reconciliation');
  assert.throws(()=>f.app.resumeTask(child.taskId),{code:'RESULT_UNKNOWN'});assert.equal(f.counts().searches,1);
});
test('F05 current Fact change, configuration revocation and original cancellation cannot publish',async t=>{
  for(const changed of ['fact','configuration','cancel']){
    const f=await fixture(t,{onExport:async({request,app,facts,config})=>{
      if(request.stage!=='receipt'||request.proposal?.toolName!=='workflow.host.f05_n05')return;
      if(changed==='configuration')config.configRevision++;
      else if(changed==='cancel')app.runtime.requestCancel(request.taskId);
      else facts.recordPublicSource({vaultId:'synthetic-vault',path:'original.md',factId:'original-fact',sourceRevision:'b'.repeat(64),line:1,
        summary:'Changed actual Fact before final export.',observedAt:new Date().toISOString(),validFrom:'2026-01-01T00:00:00.000Z',
        validUntil:'2099-01-01T00:00:00.000Z',expectedFactRevision:1},{deadline:request.deadline,signal:request.signal});
    }}),{child}=await f.run();
    assert.ok(['failed','cancelled'].includes(child.state),JSON.stringify({changed,diagnostics:f.diagnostics()}));
    assert.ok(f.exports.some(request=>request.proposal?.toolName==='workflow.host.f05_n05'));
    assert.equal(f.exports.some(request=>request.stage==='completion'),false);assert.equal(f.counts().searches,1);
  }
});
test('F05 required expansion precedes answer drafting and cannot be bypassed by candidate branches',()=>{
  const template=getOwnedWorkflowTemplate('F05');assert.deepEqual(template.nodes.find(node=>node.id==='F05_N04').dependencies.find(dep=>dep.nodeId==='F05_N06'),
    {nodeId:'F05_N06',required:false});
  assert.equal(template.nodes.find(node=>node.id==='F05_N04').hostGuard,true);assert.equal(template.nodes.find(node=>node.id==='F05_N06').hostGuard,true);
});

test('F05 final original citation fence after credential resolution prevents every HTTP send',async t=>{
  const f=await fixture(t,{changeAfterCredentials:true}),{child}=await f.run();
  assert.equal(child.state,'failed',JSON.stringify(f.diagnostics()));
  assert.deepEqual(f.counts(),{searches:1,credentialReads:1,httpSends:0});
  assert.ok(f.exports.some(request=>request.proposal?.toolName==='workflow.host.f05_n05'));
  assert.equal(f.exports.some(request=>request.stage==='completion'),false);
});

test('F05 initial and expanded evidence use the real original knowledge export projection',async t=>{
  const f=await fixture(t,{expand:true,longExcerpt:true}),{child}=await f.run();
  assert.equal(child.state,'succeeded',JSON.stringify(f.diagnostics()));assert.equal(f.counts().searches,2);
  assert.ok(f.rawResults.every(result=>result.hits[0].excerpt.length>200&&result.hits[0].excerpt.length<=320));
  assert.ok(f.rawResults.every(result=>JSON.stringify(result).includes('PRIVATE_TAIL_DO_NOT_EXPORT')));
  assert.ok(f.images.every(value=>!value.includes('PRIVATE_TAIL_DO_NOT_EXPORT')));
  const projected=f.exports.filter(request=>request.stage==='receipt'&&['workflow.host.f05_n02','workflow.host.f05_n06'].includes(request.proposal?.toolName));
  assert.equal(projected.length,2);assert.ok(projected.every(request=>request.value.result.sources[0].excerpt.length===200));
});

test('F05 original knowledge policy revocation before or after asynchronous projection prevents graph export',async t=>{
  for(const revokeProjection of ['before','after']){
    const f=await fixture(t,{longExcerpt:true,revokeProjection}),{child}=await f.run();
    assert.ok(['failed','waiting_approval'].includes(child.state));assert.equal(f.counts().searches,1);
    assert.ok(f.diagnostics().some(item=>item.task.state==='failed'
      &&f.app.runtime.loadCheckpoint(item.task.taskId,'host-tool-intent')?.toolName==='workflow.host.f05_n02'));
    assert.equal(f.exports.some(request=>request.proposal?.toolName==='workflow.host.f05_n02'),false);
    assert.ok(f.images.every(value=>!value.includes('PRIVATE_TAIL_DO_NOT_EXPORT')));
  }
});

test('F05 original unknown gap judgment cannot be promoted by a later supported candidate',async t=>{
  const f=await fixture(t,{gapUnknown:true}),{child}=await f.run();assert.equal(child.state,'failed');
  assert.equal(f.exports.some(request=>request.stage==='completion'),false);assert.equal(f.counts().searches,1);
});
