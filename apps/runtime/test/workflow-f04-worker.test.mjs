import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {openReadOnlyVault} from '@personal-agent/knowledge/filesystem';
import {openControlledVaultWriter} from '@personal-agent/knowledge/write';
import {createRuntimeApplication,createDesktopSubagentDispatchTool} from '../dist/application.js';
import {createTrustedKnowledgeTools} from '../dist/application/knowledge-tools.js';
import {createF04WorkflowWorkerPorts} from '../dist/application/workflow-f04-worker.js';
import {createDesktopF04WorkflowWorkerPorts} from '../../desktop/electron/f04-workflow-worker-ports.js';

const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const original='Mercury is a planet.';
const replacement='Mercury is the closest planet to the Sun.';
const sha=value=>createHash('sha256').update(value).digest('hex');
const powerShellPath=process.env.PA_TEST_PWSH;
// Real files, controlled writer, SQLite, Runtime, Policy, Engine and source export policy.
// Candidate judgments, approval clicks, source configuration and cloud transport are Synthetic.
async function fixture(t,{disposition='compatible',revokeProjection=false,longExcerpt=false,onExport,projectionFailure=false}={}){
  const directory=await mkdtemp(join(tmpdir(),'pa-f04-')),root=join(directory,'vault'),recovery=join(directory,'recovery');
  await mkdir(root);await mkdir(recovery);const content=original+(longExcerpt?' '+'.'.repeat(190)+'PRIVATE_TAIL_DO_NOT_EXPORT':'')+'\n';
  await writeFile(join(root,'source.md'),content);let app,facts,clears=0,writes=0,appends=0,drains=0,impacts=0,privateSource=false;
  const vault=await openReadOnlyVault({rootPath:root,vaultId:'synthetic-f04-vault'});
  const config={sourceId:'synthetic-f04-vault',configRevision:1,publicQueries:['Mercury'],allowedNotePaths:['source.md'],memoryNamespace:'synthetic-f04',writeAvailable:true};
  const writer=openControlledVaultWriter({rootPath:root,recoveryRootPath:recovery,powerShellPath,
    sourceId:config.sourceId,configRevision:1,allowedNotePaths:config.allowedNotePaths,bindingCurrent:()=>!privateSource});
  const snapshot=()=>({...config,configured:true,enabled:true,namespace:'synthetic-source',available:true,dataLevel:privateSource?'private':'public',cloudExportAllowed:true});
  const source={snapshot,clearIndex(){clears++;vault.clearIndex();},acquire(expected,signal){
    assert.equal(expected.sourceId,config.sourceId);assert.equal(expected.configRevision,config.configRevision);
    return {binding:snapshot(),signal,assertCurrent(){if(privateSource)throw new ProtocolError('UNAUTHORIZED','Synthetic original source revoked');},release(){},
      read:vault,write:{...writer,async apply(...args){writes++;return writer.apply(...args);}},reconcileWrite:writer.reconcile,finalizeWrite:writer.finalize};}};
  const knowledge=createTrustedKnowledgeTools(source),exports=[],images=[],cloud=[];
  if(revokeProjection){const policy=knowledge.competitionToolExports[0],project=policy.project;policy.project=async args=>{const result=project(args);await Promise.resolve();privateSource=true;return result;};}
  const factPort={publicMemory:{listCurrent:request=>facts.publicMemory.listCurrent(request),listHistory:request=>facts.publicMemory.listHistory(request)},
    readCurrentPublicFact:ref=>facts.readCurrentPublicFact(ref),readPublicSourceHead:key=>facts.readPublicSourceHead(key),
    recordPublicSource(...args){appends++;return facts.recordPublicSource(...args);},async drain(...args){drains++;const result=await facts.drain(...args);return result;},
    processImpacts(...args){impacts++;if(projectionFailure==='before')throw new ProtocolError('RESULT_UNKNOWN','Synthetic interruption before impact commit');
      const result=facts.processImpacts(...args);if(projectionFailure)throw new ProtocolError('RESULT_UNKNOWN','Synthetic reply loss after real impact commit');return result;},
    listImpactReceipts:request=>facts.listImpactReceipts(request),readCompletedImpact:key=>facts.readCompletedImpact(key)};
  const bundle=createDesktopF04WorkflowWorkerPorts({runtimeModule:{createF04WorkflowWorkerPorts},getApplication:()=>app,getKnowledgeSourceConfig:()=>source,
    getPublicFactHost:()=>({memoryNamespace:config.memoryNamespace,facts:factPort}),knowledgeToolExports:knowledge.competitionToolExports,
    prepareCompetitionToolExport:async()=>{},authorizeExport:async request=>{exports.push(request);await onExport?.({request,app,facts,config,root});return true;}});
  const choice={descriptor:{name:'decision.choose_candidate',version:'1.0.0',inputSchema:object({context:{type:'string'},
    candidates:{type:'array',items:object({id:{type:'string'},description:{type:'string'}})},requestId:{type:'string'}}),outputSchema:object({selectedId:{type:'string'}}),
    sideEffect:'read',requiredScopes:['decision:choose'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},execute:async args=>({selectedId:args.candidates[0].id})};
  const tools=[...knowledge.tools,choice,...bundle.tools,createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,scope)=>app.runDefaultSubagentWorker(subtask,worker,scope)})];
  const secret='synthetic-f04-original-receipt-secret-longer-than-32';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:'synthetic-f04-original-checkpoint-secret-longer-than-32',
    decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),
    prepareCandidates:async context=>[{id:'selected',description:'Synthetic classification or empty host arguments',value:context.node.id==='F04_N02'
      ?{version:1,kind:'fact',disposition,reason:'Synthetic semantic judgment'}:{arguments:{}}},{id:'abstain',description:'Retain uncertainty',value:{},abstain:true}]});
  const image={bindingId:'synthetic-f04-image',receiptSecret:async()=>secret,advance:request=>{
    bundle.configuredWorkflowWorkerPorts[0].assertCurrent({taskId:request.taskId,deadline:request.taskDeadline??request.deadline,signal:request.signal});
    images.push(JSON.stringify({input:request.input,receipts:request.receipts,resolvedValues:request.resolvedValues}));return engine.advance(request);}};
  const appOptions={path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'synthetic-f04',tools,
    configuredWorkflowWorkers:bundle.configuredWorkflowWorkerPorts.map(worker=>({...worker,image})),coordinationBinding:'synthetic-f04-deployment',
    coordination:{execute:async request=>{cloud.push(request);if(app.runtime.getTask(request.taskId).conversationId==='synthetic-chat'||request.continuation)
      return {kind:'text',text:'Synthetic F04 result',verification:'mock'};
      return {kind:'tool_proposal',proposalId:'synthetic-f04-proposal',toolName:'workflow.wiki.manage',toolVersion:'1.0.0',
        arguments:{query:'Mercury',factId:'original-fact',candidateKind:'fact',updateText:replacement},verification:'unverified'};}},
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:tool.descriptor.name==='knowledge.search'?['/sourceId','/configRevision','/query']:
        tool.descriptor.name==='knowledge.apply_note_patch'?['/sourceId','/configRevision','/path']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result}))};
  app=createRuntimeApplication(appOptions);knowledge.bindApplication(app);
  const factOptions={memoryPath:join(directory,'memory.sqlite'),memoryNamespace:config.memoryNamespace,graphNamespace:'synthetic-f04-graph',consumerKey:'synthetic-f04'};
  facts=app.createCompetitionFactHost(factOptions);
  facts.recordPublicSource({vaultId:config.sourceId,path:'source.md',factId:'original-fact',sourceRevision:sha(content),line:1,summary:'Original public source summary.',
    observedAt:new Date().toISOString(),validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z',expectedFactRevision:null},
    {deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal});
  const client=new Client(app);await client.connect();
  t.after(async()=>{facts.close();app.close();await rm(directory,{recursive:true,force:true});});
  async function run(){
    const parent=await client.call('task.submit',{goal:'Update the selected original public Fact source',conversationId:'synthetic-chat'},
      {idempotencyKey:'synthetic-f04-user',timeoutMs:120000});const end=Date.now()+60000;
    while(Date.now()<end){
      for(const approval of app.runtime.listApprovals({state:'pending',limit:100}).items)
        await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      const [child]=app.readSubagentTasks(parent.taskId);
      if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))return {parent,child};
      if(revokeProjection&&child?.state==='waiting_approval'&&app.activeTaskCount===0&&app.runtime.listTasks({limit:100}).items.some(task=>task.state==='failed'))return {parent,child};
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.fail('F04 did not settle: '+JSON.stringify(diagnostics()));
  }
  function diagnostics(){return app.runtime.listTasks({limit:100}).items.map(task=>({id:task.taskId,state:task.state,error:task.error,
    tool:app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName,runs:app.runtime.readToolExecutions(task.taskId)}));}
  return {get app(){return app;},get facts(){return facts;},bundle,run,exports,images,cloud,root,recovery,diagnostics,
    counts:()=>({writes,appends,drains,impacts,clears}),reopen(){facts.close();app.close();app=createRuntimeApplication(appOptions);knowledge.bindApplication(app);facts=app.createCompetitionFactHost(factOptions);}};
}

test('F04 preserves seven original nodes and selects the original host write through guards',()=>{
  const template=getOwnedWorkflowTemplate('F04');assert.equal(template.nodes.length,7);
  for(const id of ['F04_N03','F04_N07'])assert.equal(template.nodes.find(node=>node.id===id).hostGuard,true);
});
test('F04 actual file write, scoped Fact CAS and durable impact complete through original graph',{skip:!powerShellPath},async t=>{
  const f=await fixture(t),{child}=await f.run();assert.equal(child.state,'succeeded',JSON.stringify(f.diagnostics()));
  assert.equal(await readFile(join(f.root,'source.md'),'utf8'),replacement+'\n');
  const fact=f.facts.readCurrentPublicFact({id:'original-fact',revision:2});assert.equal(fact.summary,replacement);assert.equal(fact.confirmation,'external_observation');
  assert.deepEqual(fact.corrects,{id:'original-fact',revision:1});assert.deepEqual(f.counts(),{writes:1,appends:1,drains:1,impacts:1,clears:1});
  const last=f.cloud.find(request=>request.taskId===child.taskId&&request.continuation)?.continuation.result;assert.equal(last.state,'updated');assert.ok(last.projection.batchToken);
  assert.equal(f.images.join('').includes('backupId'),false);assert.equal(f.images.join('').includes('sourceOperationId'),false);
});
for(const disposition of ['conflict','invalid'])test('F04 '+disposition+' candidate remains isolated with no effective write',{skip:!powerShellPath},async t=>{
  const f=await fixture(t,{disposition}),{child}=await f.run();assert.equal(child.state,'succeeded',JSON.stringify(f.diagnostics()));
  assert.equal(await readFile(join(f.root,'source.md'),'utf8'),original+'\n');assert.equal(f.facts.readCurrentPublicFact({id:'original-fact',revision:1}).summary,'Original public source summary.');
  assert.deepEqual(f.counts(),{writes:0,appends:0,drains:0,impacts:0,clears:1});assert.ok(f.app.runtime.loadCheckpoint(child.taskId,'f04:quarantined-candidate'));
});
test('F04 clipped original excerpts cannot authorize a full source write',{skip:!powerShellPath},async t=>{
  const f=await fixture(t,{longExcerpt:true}),{child}=await f.run();assert.equal(child.state,'failed',JSON.stringify(f.diagnostics()));
  assert.equal(f.counts().writes,0);assert.equal(f.images.join('').includes('PRIVATE_TAIL_DO_NOT_EXPORT'),false);
});
test('F04 async original policy revocation exports no source and performs no write',{skip:!powerShellPath},async t=>{
  const f=await fixture(t,{revokeProjection:true}),{child}=await f.run();assert.ok(['failed','waiting_approval'].includes(child.state),JSON.stringify(f.diagnostics()));
  assert.equal(f.counts().writes,0);assert.equal(f.images.join('').includes(original),false);
});
test('F04 confirmed source write remains preserved when original projection outcome is unknown',{skip:!powerShellPath},async t=>{
  const f=await fixture(t,{projectionFailure:true}),{child}=await f.run();assert.equal(child.state,'waiting_reconciliation',JSON.stringify(f.diagnostics()));
  assert.equal(await readFile(join(f.root,'source.md'),'utf8'),replacement+'\n');assert.equal(f.counts().writes,1);
  f.reopen();assert.equal(f.app.runtime.getTask(child.taskId).state,'waiting_reconciliation');assert.throws(()=>f.app.resumeTask(child.taskId),{code:'RESULT_UNKNOWN'});
  const scope={taskId:child.taskId,deadline:f.app.runtime.loadCheckpoint(child.taskId,'application-deadline'),signal:new AbortController().signal},before=f.counts();
  assert.equal(f.bundle.recovery.readAvailable(scope),true);
  const [first,duplicate]=await Promise.all([f.bundle.recovery.reconcileOriginalReadback(scope),f.bundle.recovery.reconcileOriginalReadback(scope)]);
  assert.equal(first.state,'confirmed');assert.deepEqual(duplicate,first);assert.deepEqual(f.counts(),before);
  assert.equal((await f.bundle.recovery.reconcileOriginalReadback(scope)).state,'confirmed');assert.deepEqual(f.counts(),before);
  assert.equal(f.app.runtime.getTask(child.taskId).state,'waiting_reconciliation','readback does not dispatch another graph');
  assert.equal(f.app.readHostToolTask(first.localTaskId).confirmed.result.state,'updated');
  const intent=f.app.runtime.loadCheckpoint(child.taskId,'f04:projection-intent');
  f.app.runtime.saveCheckpoint(child.taskId,'f04:projection-intent',{...intent,sourceOperationId:'0'.repeat(64)});
  assert.equal(f.bundle.recovery.readAvailable(scope),false);await assert.rejects(async()=>f.bundle.recovery.reconcileOriginalReadback(scope));
  f.app.runtime.saveCheckpoint(child.taskId,'f04:projection-intent',intent);
  await writeFile(join(f.root,'source.md'),'Unrelated later file replacement.\n');assert.equal(f.bundle.recovery.readAvailable(scope),false);
  await assert.rejects(async()=>f.bundle.recovery.reconcileOriginalReadback(scope));assert.deepEqual(f.counts(),before);
});
test('F04 incomplete original impact stays unknown and readback performs zero writes or feed work',{skip:!powerShellPath},async t=>{
  const f=await fixture(t,{projectionFailure:'before'}),{child}=await f.run();assert.equal(child.state,'waiting_reconciliation',JSON.stringify(f.diagnostics()));
  f.reopen();const scope={taskId:child.taskId,deadline:f.app.runtime.loadCheckpoint(child.taskId,'application-deadline'),signal:new AbortController().signal},before=f.counts();
  for(let count=0;count<2;count++)assert.equal((await f.bundle.recovery.reconcileOriginalReadback(scope)).state,'unknown');
  assert.deepEqual(f.counts(),before);assert.equal(f.facts.readCurrentPublicFact({id:'original-fact',revision:2}).summary,replacement);
  const cancelled=new AbortController();cancelled.abort();assert.equal(f.bundle.recovery.readAvailable({...scope,signal:cancelled.signal}),false);
  await assert.rejects(async()=>f.bundle.recovery.reconcileOriginalReadback({...scope,signal:cancelled.signal}),{code:'CANCELLED'});
  assert.equal(f.bundle.recovery.readAvailable({...scope,deadline:'2000-01-01T00:00:00.000Z'}),false);assert.deepEqual(f.counts(),before);
});
