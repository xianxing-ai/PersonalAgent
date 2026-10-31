import test from 'node:test';
import assert from 'node:assert/strict';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createRuntimeF24ReconciliationHost} from '../dist/application/workflow-f24-reconciliation-host.js';

// Explicit synthetic sources; these do not establish external readback or cloud acceptance.
function fixture() {
  const now=Date.now(),deadline=new Date(now+60000).toISOString(),signal=new AbortController().signal;
  const context={taskId:'f24-child',runId:'host-tool-f24-child',authorizationRef:'host-tool-f24-child',
    argumentsDigest:toolArgumentsDigest({}),scopes:['read-original'],deadline,signal};
  const binding={taskId:'business',runId:'business-run',toolName:'business.write',toolVersion:'1.0.0',
    inputDigest:'a'.repeat(64),readbackEvidenceId:'verified-readback'};
  const proposal={kind:'tool_proposal',nodeId:'F24_N09',operationId:'f24-operation',toolName:'workflow.host.f24_n09',
    toolVersion:'1.0.0',arguments:{},originControlRevision:4};
  const record={taskId:'business',evidenceId:'business-run',toolName:'business.write',toolVersion:'1.0.0',
    inputDigest:binding.inputDigest,policyDecision:'allow',executionStarted:true,state:'confirmed',reconciliationOutcome:'applied'};
  const toolRecord={taskId:context.taskId,evidenceId:context.runId,toolName:proposal.toolName,toolVersion:'1.0.0',
    policyDecision:'allow',executionStarted:true,state:'started',inputDigest:'b'.repeat(64)};
  const observation={evidenceId:'verified-readback',kind:'observation',verification:'verified',sourceRef:'synthetic-readback'};
  const checkpoints=new Map(),put=(id,key,value)=>checkpoints.set(id+'|'+key,value);
  put('f24-child','coding-repair:parent',{taskId:'graph',operationId:'f24-operation'});
  put('f24-child','host-tool-intent',{namespace:'fixture',commandId:'f24-operation',toolName:proposal.toolName,
    toolVersion:'1.0.0',arguments:{},argumentsDigest:toolArgumentsDigest({}),deadline});
  put('graph','owned-workflow:intent:f24-operation',{taskId:'graph',workflowId:'F24',sessionId:'session',deadline,taskDeadline:deadline,proposal});
  put('graph','coding-repair:host:f24-operation',{localTaskId:'f24-child',request:{commandId:'f24-operation',
    toolName:proposal.toolName,toolVersion:'1.0.0',arguments:{},deadline}});
  put('graph','driver:driver-binding',{taskId:'graph',workflowId:'F24',sessionId:'session',deadline});
  put('graph','driver',{sessionId:'session',controlRevision:4,result:{state:'awaiting_host',proposals:[proposal],
    nodes:{F24_N09:{state:'waiting_receipt'}}}});
  let authorized=true,verification=true,exportAllowed=true,result,changeOnExport=false;
  const task={state:'waiting_reconciliation',revision:1,evidenceRefs:['business-run','verified-readback']};
  const graphTask={state:'running',revision:3,evidenceRefs:[]};
  const hostTask={state:'running',revision:1,evidenceRefs:[],conversationId:'host-tool:fixture'};
  const grant={taskId:'f24-child',toolName:proposal.toolName,argumentsDigest:toolArgumentsDigest({}),expiresAt:deadline,scopes:['read-original']};
  const runtime={loadCheckpoint:(id,key)=>checkpoints.get(id+'|'+key),getTask:id=>id==='graph'?graphTask:id==='f24-child'?hostTask:task,
    readToolExecutions:id=>id==='f24-child'?[toolRecord]:[record],readEvidence:()=>[observation],
    matchesToolExecutionInput:()=>true,isToolExecutionActive:()=>true,policy:{get:()=>authorized?grant:undefined}};
  const app={runtime,readHostToolTask:()=>({commandId:'f24-operation',toolName:proposal.toolName,task:{state:'succeeded'},
    confirmed:{runId:context.runId,evidenceRefs:[context.runId],result}})};
  const options={application:app,hostUserNamespace:'fixture',driverCheckpointKey:'driver',requiredScopes:['read-original'],now:()=>new Date(now),
    assertCurrent:()=>{if(!authorized)throw Error('synthetic secret');},resolveOriginalEffect:async()=>binding,
    verifyReadback:async()=>verification,authorizeExport:async()=>{if(changeOnExport)task.revision++;return exportAllowed;}};
  const host=createRuntimeF24ReconciliationHost(options);
  return {context,binding,record,toolRecord,observation,task,graphTask,hostTask,proposal,options,host,put,
    complete:value=>{result=value;toolRecord.state='confirmed';hostTask.state='succeeded';},revoke:()=>{authorized=false;},
    denyVerification:()=>{verification=false;},denyExport:()=>{exportAllowed=false;},changeOnExport:()=>{changeOnExport=true;}};
}

test('F24 does not publish without all trusted source and export ports',()=>{
  const f=fixture();
  for(const key of ['resolveOriginalEffect','verifyReadback','authorizeExport','assertCurrent']) {
    const missing={...f.options};delete missing[key];
    assert.deepEqual(createRuntimeF24ReconciliationHost(missing).tools,[]);
  }
});
test('F24 reports only the independently verified original reconciled business run',async()=>{
  const f=fixture(),tool=f.host.tools[0];
  assert.equal(tool.descriptor.name,'workflow.host.f24_n09');
  const result=await tool.execute({},f.context);
  assert.deepEqual(result,{state:'applied',taskId:'business',taskRevision:1,runId:'business-run',evidenceRefs:['verified-readback']});
  f.complete(result);await f.host.authorizeReceipt({context:f.context,result});
  await assert.rejects(tool.execute({taskId:'model-selected'},f.context));
  await assert.rejects(f.host.authorizeReceipt({context:f.context,result:{...result,state:'not_applied'}}),{code:'UNAUTHORIZED'});
});
test('F24 keeps unknown, missing readback and unrelated or unauthorized runs unavailable',async()=>{
  const f=fixture();f.record.state='unknown';delete f.record.reconciliationOutcome;
  await assert.rejects(f.host.tools[0].execute({},f.context),{code:'RESULT_UNKNOWN'});
  const missing=fixture();missing.observation.verification='conditional';
  await assert.rejects(missing.host.tools[0].execute({},missing.context),{code:'RESULT_UNKNOWN'});
  const forged=fixture();forged.binding.taskId='graph';
  await assert.rejects(forged.host.tools[0].execute({},forged.context),{code:'UNSUPPORTED_CAPABILITY'});
  const mismatch=fixture();mismatch.record.inputDigest='c'.repeat(64);
  await assert.rejects(mismatch.host.tools[0].execute({},mismatch.context),{code:'UNSUPPORTED_CAPABILITY'});
  const refused=fixture();refused.denyVerification();
  await assert.rejects(refused.host.tools[0].execute({},refused.context),{code:'UNSUPPORTED_CAPABILITY'});
});
test('F24 rejects stale frontier, revocation, cancellation and change during export',async()=>{
  const f=fixture();f.put('graph','driver',{sessionId:'session',controlRevision:4,result:{state:'settled',proposals:[]}});
  await assert.rejects(f.host.tools[0].execute({},f.context),{code:'UNAUTHORIZED'});
  const cancelled=fixture();cancelled.graphTask.cancelRequested=true;
  await assert.rejects(cancelled.host.tools[0].execute({},cancelled.context),{code:'UNAUTHORIZED'});
  const revoked=fixture();const value=await revoked.host.tools[0].execute({},revoked.context);revoked.complete(value);revoked.revoke();
  await assert.rejects(revoked.host.authorizeReceipt({context:revoked.context,result:value}),{code:'UNAUTHORIZED'});
  const changed=fixture();const old=await changed.host.tools[0].execute({},changed.context);changed.complete(old);changed.changeOnExport();
  await assert.rejects(changed.host.authorizeReceipt({context:changed.context,result:old}),{code:'REVISION_CONFLICT'});
  const denied=fixture();const value2=await denied.host.tools[0].execute({},denied.context);denied.complete(value2);denied.denyExport();
  await assert.rejects(denied.host.authorizeReceipt({context:denied.context,result:value2}),{code:'UNAUTHORIZED'});
});
test('F24 binds namespace, original HostTask and both argument digests',async()=>{
  const namespace=fixture();namespace.hostTask.conversationId='host-tool:other';
  await assert.rejects(namespace.host.tools[0].execute({},namespace.context),{code:'UNAUTHORIZED'});
  const issued=fixture();issued.put('graph','coding-repair:host:f24-operation',{localTaskId:'different-child'});
  await assert.rejects(issued.host.tools[0].execute({},issued.context),{code:'UNAUTHORIZED'});
  const digest=fixture();digest.context.argumentsDigest='forged';
  await assert.rejects(digest.host.tools[0].execute({},digest.context),{code:'SCOPE_DENIED'});
  const ref=fixture();ref.context.authorizationRef='different-grant';
  await assert.rejects(ref.host.tools[0].execute({},ref.context),{code:'SCOPE_DENIED'});
});
test('F24 sanitizes untrusted source exceptions',async()=>{
  const f=fixture();f.options.resolveOriginalEffect=async()=>{throw Error('synthetic-secret');};
  const tool=createRuntimeF24ReconciliationHost(f.options).tools[0];
  await assert.rejects(tool.execute({},f.context),{code:'UNSUPPORTED_CAPABILITY',message:'F24 trusted readback unavailable'});
});
