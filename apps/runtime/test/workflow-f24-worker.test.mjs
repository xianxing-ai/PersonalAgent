import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,delimiter} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import {openControlledVaultWriter,createKnowledgeWriteTool} from '@personal-agent/knowledge/write';
import {createRuntimeApplication,createDesktopSubagentDispatchTool} from '../dist/application.js';
import {createF24RecoveryWorkflowPorts} from '../dist/application/workflow-f24-worker.js';

// Actual Engine, Runtime, SQLite, Policy, HostBridge and knowledge reconciliation.
// Image decisions, writer and filesystem readback below are explicitly Synthetic.
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const secret='synthetic-f24-receipt-secret-at-least-32-bytes';
async function fixture({outcome='applied',conversation='synthetic-chat',exportAllowed=true,onExport,path=':memory:',knowledge}={}) {
  let app,sourceTaskId,writeCalls=0,readCalls=0,finalizeCalls=0;
  const exports=[],cloud=[],config={sourceId:'synthetic-vault',configRevision:1};
  const facade=new Proxy({},{get(_target,name){const value=app[name];return typeof value==='function'?value.bind(app):value;}});
  const bundle=createF24RecoveryWorkflowPorts({application:facade,hostUserNamespace:'synthetic-f24',sourceConfiguration:()=>config,
    authorizeExport:async request=>{exports.push(request);await onExport?.({request,app,config});return exportAllowed;}});
  const writer={descriptor:knowledge?.tool.descriptor??{name:'knowledge.apply_note_patch',version:'1.0.0',sideEffect:'local_write',
    inputSchema:object({sourceId:{const:config.sourceId},configRevision:{const:1}}),outputSchema:{type:'object'},
    requiredScopes:['synthetic:knowledge'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},
    async execute(args,context){writeCalls++;if(knowledge)await knowledge.tool.execute(args,context);
      throw new ProtocolError('RESULT_UNKNOWN','Synthetic lost acknowledgement after original write');}};
  const tools=[writer,...bundle.tools,createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,scoped)=>app.runDefaultSubagentWorker(subtask,worker,scoped)})];
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:'synthetic-f24-checkpoint-secret-at-least-32-bytes',
    selector:{select:async()=> 'supported'},receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),
    prepareCandidates:async()=>[{id:'supported',description:'Synthetic fixed empty host parameters',value:{arguments:{}}},
      {id:'recheck',description:'Synthetic abstention',value:{},abstain:true}]});
  const image={bindingId:'synthetic-f24-image',advance:request=>engine.advance(request),receiptSecret:async()=>secret};
  const applicationOptions={path,profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'synthetic-f24',
    coordinationBinding:'synthetic-f24-deployment',tools,configuredWorkflowWorkers:bundle.configuredWorkflowWorkerPorts.map(worker=>({...worker,image})),
    knowledgeWriteReconciliation:{reconcile:async(original,context)=>{readCalls++;if(knowledge)return knowledge.writer.reconcile(original,context);
      return {state:outcome,operationId:'a'.repeat(64),backupId:'synthetic-backup',
      lockRetained:true,...(outcome==='unknown'?{}:{currentSha256:'b'.repeat(64)})};},
      finalize:async(accepted,context)=>{finalizeCalls++;if(knowledge)return knowledge.writer.finalize(accepted,context);
        return {state:'finalized',operationId:accepted.operationId,outcome:accepted.outcome,currentSha256:accepted.currentSha256};}},
    coordination:{execute:async request=>{cloud.push(request);
      if(app.runtime.getTask(request.taskId).conversationId==='synthetic-chat'||request.continuation)
        return {kind:'text',text:'Synthetic recovery summary',verification:'unverified'};
      return {kind:'tool_proposal',proposalId:'synthetic-f24-request',toolName:'workflow.recovery.knowledge',toolVersion:'1.0.0',
        arguments:{sourceTaskId},verification:'unverified'};}},
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result}))};
  app=createRuntimeApplication(applicationOptions);
  const client=new Client(app);await client.connect();
  const approve=async()=>{
    for(const approval of app.runtime.listApprovals({state:'pending',limit:100}).items)
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
  };
  const until=async check=>{const end=Date.now()+20000;while(Date.now()<end){await approve();if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}
    assert.fail('Synthetic F24 did not settle: '+JSON.stringify(app.runtime.listTasks({limit:50}).items.map(t=>({id:t.taskId,state:t.state,error:t.error}))));};
  const parent=app.runtime.submitTask({goal:'Synthetic earlier operation',conversationId:conversation,idempotencyKey:'synthetic-original'});
  app.runtime.transitionTask(parent.taskId,'planning');app.runtime.transitionTask(parent.taskId,'running');
  const deadline=new Date(Date.now()+60000).toISOString(),bridge=app.createOwnedWorkflowHost({parentTaskId:parent.taskId,receiptSecret:secret,assertActive:()=>{}});
  const args=knowledge?.input??{sourceId:config.sourceId,configRevision:1},proposal={kind:'tool_proposal',nodeId:'F24_N04',operationId:'synthetic-original-write',
    proposalId:'synthetic-original-write',originControlRevision:0,inputDigest:hash({arguments:args}),toolSchemaDigest:hash(writer.descriptor.inputSchema),
    toolName:writer.descriptor.name,toolVersion:'1.0.0',arguments:args,resourceKeys:[],effect:'write'};
  sourceTaskId=bridge.submit({taskId:parent.taskId,sessionId:'synthetic-source-session',workflowId:'F24',controlRevision:0,deadline,taskDeadline:deadline},proposal).localTaskId;
  await until(()=>app.readHostToolTask(sourceTaskId).task.state==='waiting_reconciliation');
  async function run(){
    const root=await client.call('task.submit',{goal:'Read back the original knowledge operation',conversationId:'synthetic-chat'},
      {idempotencyKey:'synthetic-f24-recovery',timeoutMs:60000});
    let child;
    await until(()=>{[child]=app.readSubagentTasks(root.taskId);return child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state);});
    return {root,child};
  }
  return {get app(){return app;},client,bundle,config,exports,cloud,run,sourceTaskId,until,
    reopen(){app.close();app=createRuntimeApplication(applicationOptions);},
    setOutcome:value=>{outcome=value;},get counts(){return {writeCalls,readCalls,finalizeCalls};}};
}

for(const outcome of ['applied','not_applied'])test(`F24 actual graph consumes original ${outcome} readback without a second write`,async()=>{
  const f=await fixture({outcome});try{const {child}=await f.run();assert.equal(child.state,'succeeded',JSON.stringify({error:child.error,
    pending:f.app.readPendingOwnedWorkflowHostTask(child.taskId),runs:f.app.runtime.listTasks({limit:50}).items.filter(t=>t.error).map(t=>({error:t.error,runs:f.app.runtime.readToolExecutions(t.taskId)}))}));
    assert.deepEqual(f.counts,{writeCalls:1,readCalls:1,finalizeCalls:1});
    const result=f.cloud.find(request=>request.taskId===child.taskId&&request.continuation)?.continuation.result;
    assert.equal(result.state,outcome);assert.equal(result.sourceTaskId,f.sourceTaskId);assert.equal(result.sourceRunId,'host-tool-'+f.sourceTaskId);
    assert.ok(result.evidenceRefs.every(ref=>f.app.runtime.readEvidence(f.sourceTaskId).some(e=>e.evidenceId===ref&&e.verification==='verified')));
    assert.ok(f.exports.some(request=>request.stage==='initial'));assert.ok(f.exports.some(request=>request.stage==='completion'));
    assert.equal(f.app.runtime.readToolExecutions(f.sourceTaskId).length,1);
  }finally{f.app.close();}
});

test('F24 unknown stays on the original graph child and blocks resume, without another write',async()=>{
  const f=await fixture({outcome:'unknown'});try{const {child}=await f.run();assert.equal(child.state,'waiting_reconciliation',JSON.stringify(child.error));
    const host=f.app.readPendingOwnedWorkflowHostTask(child.taskId);assert.ok(host);assert.equal(host.state,'waiting_reconciliation');
    assert.throws(()=>f.app.resumeTask(child.taskId),{code:'RESULT_UNKNOWN'});assert.deepEqual(f.counts,{writeCalls:1,readCalls:1,finalizeCalls:0});
    assert.equal(f.exports.some(request=>request.stage==='completion'),false);
  }finally{f.app.close();}
});

test('F24 rejects a foreign conversation before source readback or export',async()=>{
  const f=await fixture({conversation:'other-private-chat'});try{const {child}=await f.run();assert.equal(child.state,'failed');
    assert.equal(child.error.code,'UNAUTHORIZED');assert.deepEqual(f.counts,{writeCalls:1,readCalls:0,finalizeCalls:0});assert.equal(f.exports.length,0);
  }finally{f.app.close();}
});

test('F24 denied exact export does not perform readback',async()=>{
  const f=await fixture({exportAllowed:false});try{const {child}=await f.run();assert.equal(child.state,'failed');
    assert.equal(child.error.code,'UNAUTHORIZED');assert.deepEqual(f.counts,{writeCalls:1,readCalls:0,finalizeCalls:0});
  }finally{f.app.close();}
});

test('F24 missing trusted ports never registers tools or a graph',()=>{
  assert.deepEqual(createF24RecoveryWorkflowPorts().tools,[]);assert.deepEqual(createF24RecoveryWorkflowPorts().configuredWorkflowWorkerPorts,[]);
});

test('F24 later exact readback resolves the same host; concurrent and repeated requests do not execute writes',async()=>{
  const f=await fixture({outcome:'unknown'});try{const {child}=await f.run();assert.equal(child.state,'waiting_reconciliation');
    const scope={taskId:child.taskId,deadline:f.app.runtime.loadCheckpoint(child.taskId,'application-deadline'),signal:new AbortController().signal};
    const old=f.app.readPendingOwnedWorkflowHostTask(child.taskId);f.setOutcome('applied');
    const results=await Promise.all([f.bundle.reconcileOriginalReadback(scope),f.bundle.reconcileOriginalReadback(scope)]);
    assert.deepEqual(results,[{state:'confirmed',localTaskId:old.taskId},{state:'confirmed',localTaskId:old.taskId}]);
    assert.deepEqual(await f.bundle.reconcileOriginalReadback(scope),results[0]);
    assert.deepEqual(f.counts,{writeCalls:1,readCalls:2,finalizeCalls:1});
    f.app.resumeTask(child.taskId);await f.until(()=>f.app.runtime.getTask(child.taskId).state==='succeeded'&&f.app.activeTaskCount===0);
    assert.equal(f.app.runtime.readToolExecutions(old.taskId).length,1);assert.equal(f.counts.writeCalls,1);
  }finally{f.app.close();}
});

test('F24 source configuration changes during exact export stop before readback',async()=>{
  const f=await fixture({onExport:({request,config})=>{if(request.stage==='initial')config.configRevision++;}});
  try{const {child}=await f.run();assert.equal(child.state,'failed');assert.equal(child.error.code,'REVISION_CONFLICT');
    assert.deepEqual(f.counts,{writeCalls:1,readCalls:0,finalizeCalls:0});
  }finally{f.app.close();}
});

test('F24 cancelled original user request cannot continue from an export callback',async()=>{
  const f=await fixture({onExport:({request,app})=>{if(request.stage==='initial')app.runtime.requestCancel(app.readDelegatedUserTaskParent(request.taskId).taskId);}});
  try{const {child}=await f.run();assert.ok(['cancelled','failed'].includes(child.state));assert.deepEqual(f.counts,{writeCalls:1,readCalls:0,finalizeCalls:0});
  }finally{f.app.close();}
});

test('F24 observes an existing local cancellation and preserves the actual applied effect',async()=>{
  const f=await fixture();try{
    f.app.runtime.requestCancel(f.sourceTaskId,'Synthetic user stop of original unknown operation');
    const {child}=await f.run();assert.equal(child.state,'succeeded',JSON.stringify(child.error));
    const result=f.cloud.find(request=>request.taskId===child.taskId&&request.continuation)?.continuation.result;
    assert.equal(result.state,'applied');assert.deepEqual(f.counts,{writeCalls:1,readCalls:1,finalizeCalls:1});
    const receipts=f.exports.filter(request=>request.stage==='receipt').map(request=>request.proposal.toolName);
    assert.ok(receipts.includes('workflow.host.f24_n06'));assert.ok(receipts.includes('workflow.host.f24_n08'));
    assert.equal(receipts.includes('workflow.host.f24_n07'),false);
  }finally{f.app.close();}
});

test('F24 original SQLite unknown survives Runtime reopen and resolves by readback only',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'f24-recovery-')),f=await fixture({path:join(directory,'runtime.sqlite'),outcome:'unknown'});
  try{const {child}=await f.run(),old=f.app.readPendingOwnedWorkflowHostTask(child.taskId);
    const scope={taskId:child.taskId,deadline:f.app.runtime.loadCheckpoint(child.taskId,'application-deadline'),signal:new AbortController().signal};
    f.reopen();assert.equal(f.app.readPendingOwnedWorkflowHostTask(child.taskId).taskId,old.taskId);
    assert.equal((await f.bundle.reconcileOriginalReadback(scope)).state,'unknown');f.setOutcome('applied');
    assert.deepEqual(await f.bundle.reconcileOriginalReadback(scope),{state:'confirmed',localTaskId:old.taskId});
    assert.equal(f.app.readHostToolTask(old.taskId).task.state,'succeeded');assert.equal(f.counts.writeCalls,1);
    assert.equal(f.app.runtime.readToolExecutions(old.taskId).length,1);
  }finally{f.app.close();await rm(directory,{recursive:true,force:true});}
});

test('F24 recovery refuses replaced original source parameters, expired deadline and cancelled requests',async()=>{
  const f=await fixture({outcome:'unknown'});try{const {child}=await f.run();
    const scope={taskId:child.taskId,deadline:f.app.runtime.loadCheckpoint(child.taskId,'application-deadline'),signal:new AbortController().signal};
    const controller=new AbortController();controller.abort();
    await assert.rejects(async()=>f.bundle.reconcileOriginalReadback({...scope,signal:controller.signal}),{code:'CANCELLED'});
    await assert.rejects(async()=>f.bundle.reconcileOriginalReadback({...scope,deadline:new Date(Date.now()-1000).toISOString()}),{code:'TIMEOUT'});
    const intent=f.app.runtime.loadCheckpoint(f.sourceTaskId,'host-tool-intent');
    f.app.runtime.saveCheckpoint(f.sourceTaskId,'host-tool-intent',{...intent,arguments:{...intent.arguments,sourceId:'replaced'}});
    await assert.rejects(async()=>f.bundle.reconcileOriginalReadback(scope));
    assert.deepEqual(f.counts,{writeCalls:1,readCalls:1,finalizeCalls:0});
  }finally{f.app.close();}
});

test('F24 rejects polluted original readback receipts without resolving its unknown host',async()=>{
  const f=await fixture({outcome:'unknown'});try{const {child}=await f.run();
    const scope={taskId:child.taskId,deadline:f.app.runtime.loadCheckpoint(child.taskId,'application-deadline'),signal:new AbortController().signal};
    f.setOutcome('applied');await f.app.reconcileKnowledgeWriteTask(f.sourceTaskId,scope);
    const receipt=f.app.runtime.loadCheckpoint(f.sourceTaskId,'knowledge-write-readback');
    f.app.runtime.saveCheckpoint(f.sourceTaskId,'knowledge-write-readback',{...receipt,evidence:{...receipt.evidence,sourceRef:'untrusted'}});
    assert.equal((await f.bundle.reconcileOriginalReadback(scope)).state,'unknown');
    assert.equal(f.app.readPendingOwnedWorkflowHostTask(child.taskId).state,'waiting_reconciliation');assert.equal(f.counts.writeCalls,1);
  }finally{f.app.close();}
});

const powerShellPath=process.env.PA_TEST_POWERSHELL??process.env.PA_TEST_PWSH??(process.env.PATH??'').split(delimiter).map(p=>join(p,'pwsh.exe')).find(existsSync);
test('F24 reads the actual controlled file writer journal after a Synthetic lost acknowledgement',{
  skip:process.platform!=='win32'||!powerShellPath||!existsSync(powerShellPath),
},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'f24-real-file-')),root=join(directory,'vault'),recovery=join(directory,'recovery');
  await mkdir(root);await mkdir(recovery);const before='# Synthetic public note\r\nold sample\r\n',after=before.replace('old sample','new sample');
  await writeFile(join(root,'sample.md'),before,'utf8');
  const writer=openControlledVaultWriter({rootPath:root,recoveryRootPath:recovery,powerShellPath,sourceId:'synthetic-vault',configRevision:1,
    allowedNotePaths:['sample.md'],bindingCurrent:()=>true});
  const input={sourceId:'synthetic-vault',configRevision:1,path:'sample.md',expectedSha256:createHash('sha256').update(before).digest('hex'),
    edits:[{oldText:'old sample',newText:'new sample'}]};
  let f;
  try{f=await fixture({knowledge:{writer,tool:createKnowledgeWriteTool(writer),input}});
    assert.equal(await readFile(join(root,'sample.md'),'utf8'),after);
    const {child}=await f.run();assert.equal(child.state,'succeeded',JSON.stringify(child.error));
    assert.deepEqual(f.counts,{writeCalls:1,readCalls:1,finalizeCalls:1});
    const receipt=f.app.runtime.loadCheckpoint(f.sourceTaskId,'knowledge-write-readback');
    assert.equal(receipt.result.currentSha256,createHash('sha256').update(after).digest('hex'));
    assert.equal(await readFile(join(recovery,receipt.result.backupId),'utf8'),before);
    assert.equal(await readFile(join(root,'sample.md'),'utf8'),after);
  }finally{f?.app.close();await rm(directory,{recursive:true,force:true});}
});
