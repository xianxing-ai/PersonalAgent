import test from 'node:test';
import assert from 'node:assert/strict';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createRuntimeF03ReconciliationHost} from '../dist/application/workflow-f03-reconciliation-host.js';

// Synthetic records demonstrate boundaries, not a real effect or external readback.
function fixture(){
  const deadline=new Date(Date.now()+60000).toISOString();
  const context={taskId:'child',runId:'host-tool-child',authorizationRef:'host-tool-child',argumentsDigest:toolArgumentsDigest({}),
    deadline,signal:new AbortController().signal,scopes:['effect:read']};
  const proposal={kind:'tool_proposal',nodeId:'F03_N07',operationId:'op',toolName:'workflow.host.f03_n07',
    toolVersion:'1.0.0',arguments:{},originControlRevision:2};
  const binding={taskId:'business',runId:'business-run',toolName:'business.write',toolVersion:'1.0.0',inputDigest:'a'.repeat(64),readbackEvidenceId:'observation'};
  const record={taskId:'business',evidenceId:'business-run',toolName:'business.write',toolVersion:'1.0.0',inputDigest:binding.inputDigest,
    policyDecision:'allow',executionStarted:true,state:'confirmed',reconciliationOutcome:'applied'};
  const toolRecord={taskId:'child',evidenceId:context.runId,toolName:proposal.toolName,toolVersion:'1.0.0',policyDecision:'allow',executionStarted:true,state:'started'};
  const original={state:'waiting_reconciliation',revision:3,evidenceRefs:['observation']},parent={state:'running'},child={state:'running',conversationId:'host-tool:fixture'};
  const predecessor={effect:'bound'},records={'prior-op':{nodeId:'F03_N06',toolName:'workflow.host.f03_n06',localTaskId:'prior',operationId:'prior-op',result:predecessor}};
  const store=new Map(),put=(id,key,value)=>store.set(id+'|'+key,value);
  put('child','coding-repair:parent',{taskId:'parent',operationId:'op'});
  put('child','host-tool-intent',{namespace:'fixture',commandId:'op',toolName:proposal.toolName,toolVersion:'1.0.0',arguments:{},argumentsDigest:toolArgumentsDigest({}),deadline});
  put('parent','owned-workflow:intent:op',{taskId:'parent',workflowId:'F03',sessionId:'session',deadline,taskDeadline:deadline,proposal});
  put('parent','coding-repair:host:op',{localTaskId:'child',request:{commandId:'op',toolName:proposal.toolName,toolVersion:'1.0.0',arguments:{},deadline}});
  put('parent','driver:driver-binding',{taskId:'parent',workflowId:'F03',sessionId:'session',deadline});
  put('parent','driver',{sessionId:'session',controlRevision:2,confirmedOperations:records,result:{state:'awaiting_host',proposals:[proposal],nodes:{F03_N07:{state:'waiting_receipt'}}}});
  let grant=true,causal=true,result;
  const runtime={loadCheckpoint:(id,key)=>store.get(id+'|'+key),getTask:id=>id==='parent'?parent:id==='child'?child:original,
    readToolExecutions:id=>id==='child'?[toolRecord]:[record],readEvidence:()=>[{evidenceId:'observation',kind:'observation',verification:'verified'}],
    matchesToolExecutionInput:()=>true,isToolExecutionActive:()=>true,policy:{get:()=>grant?{taskId:'child',toolName:proposal.toolName,
      argumentsDigest:toolArgumentsDigest({}),expiresAt:deadline,scopes:['effect:read']}:undefined}};
  const application={runtime,readHostToolTask:id=>id==='prior'?{commandId:'prior-op',toolName:'workflow.host.f03_n06',task:{state:'succeeded'},
    confirmed:{runId:'host-tool-prior',evidenceRefs:['host-tool-prior'],result:predecessor}}:
    {commandId:'op',toolName:proposal.toolName,task:{state:'succeeded'},confirmed:{runId:context.runId,evidenceRefs:[context.runId],result}}};
  const options={application,hostUserNamespace:'fixture',driverCheckpointKey:'driver',requiredScopes:['effect:read'],now:()=>new Date(),assertCurrent:()=>{},
    resolveOriginalEffect:async()=>binding,verifyOriginalEffectCause:async()=>causal,verifyReadback:async()=>true,authorizeExport:async()=>true};
  return {options,context,record,binding,records,predecessor,host:createRuntimeF03ReconciliationHost(options),
    complete:value=>{result=value;toolRecord.state='confirmed';child.state='succeeded';},revoke:()=>{grant=false;},denyCause:()=>{causal=false;}};
}
test('F03 requires trusted original cause and reconciliation ports',()=>{
  assert.equal(createRuntimeF03ReconciliationHost().tools.length,0);
  const f=fixture();delete f.options.verifyOriginalEffectCause;assert.equal(createRuntimeF03ReconciliationHost(f.options).tools.length,0);
});
test('F03 reads and exports only the confirmed original reconciled effect',async()=>{
  const f=fixture(),result=await f.host.tools[0].execute({},f.context);
  assert.deepEqual(result,{state:'applied',taskId:'business',taskRevision:3,runId:'business-run',evidenceRefs:['observation']});
  f.complete(result);await f.host.authorizeReceipt({context:f.context,result});
  await assert.rejects(f.host.authorizeReceipt({context:f.context,result:{...result,state:'not_applied'}}),{code:'UNAUTHORIZED'});
});
test('F03 refuses unknown writes, missing causal receipt, mismatch and revoked permission',async()=>{
  const unknown=fixture();unknown.record.state='unknown';delete unknown.record.reconciliationOutcome;
  await assert.rejects(unknown.host.tools[0].execute({},unknown.context),{code:'RESULT_UNKNOWN'});
  const missing=fixture();delete missing.records['prior-op'];await assert.rejects(missing.host.tools[0].execute({},missing.context),{code:'UNSUPPORTED_CAPABILITY'});
  const different=fixture();different.binding.inputDigest='b'.repeat(64);await assert.rejects(different.host.tools[0].execute({},different.context),{code:'UNSUPPORTED_CAPABILITY'});
  const cause=fixture();cause.denyCause();await assert.rejects(cause.host.tools[0].execute({},cause.context),{code:'UNSUPPORTED_CAPABILITY'});
  const revoked=fixture();revoked.revoke();await assert.rejects(revoked.host.tools[0].execute({},revoked.context),{code:'UNAUTHORIZED'});
});
