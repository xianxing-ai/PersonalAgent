import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createF24KnowledgeReconciliationPorts} from '../dist/application/workflow-f24-knowledge-ports.js';

// Synthetic persisted records; this does not prove an external knowledge write.
function fixture(){
  const taskId='original',runId='host-tool-original',args={path:'note.md'},argumentsDigest=toolArgumentsDigest(args);
  const result={state:'applied',operationId:'a'.repeat(64),backupId:'backup',lockRetained:true,currentSha256:'b'.repeat(64)};
  const evidenceId='knowledge-readback-'+createHash('sha256').update(JSON.stringify([taskId,runId,argumentsDigest,result.operationId,result.state,result.currentSha256])).digest('hex');
  const evidence={evidenceId,kind:'observation',sourceRef:'runtime:knowledge-readback',verification:'verified'};
  const intent={namespace:'user',toolName:'knowledge.apply_note_patch',toolVersion:'1.0.0',arguments:args,argumentsDigest};
  const receipt={taskId,runId,toolName:intent.toolName,toolVersion:intent.toolVersion,argumentsDigest,executionRecordId:runId,result,evidence};
  const record={taskId,evidenceId:runId,toolName:intent.toolName,toolVersion:intent.toolVersion,inputDigest:'c'.repeat(64),
    policyDecision:'allow',executionStarted:true,state:'confirmed',reconciliationOutcome:'applied'};
  const task={conversationId:'host-tool:user',evidenceRefs:[evidenceId]},checkpoints=new Map([
    ['host-tool-intent',intent],['knowledge-write-readback',receipt],['tool-reconciliation-'+runId,{result}]]);
  const runtime={getTask:()=>task,loadCheckpoint:(_id,key)=>checkpoints.get(key),readToolExecutions:()=>[record],
    matchesToolExecutionInput:()=>true,readEvidence:()=>[evidence]};
  let bound=true;
  const options={runtime,namespace:'user',target:{taskId,runId},isOriginalTarget:async()=>bound};
  const scope={parentTaskId:'graph',localTaskId:'child',sessionId:'session',operationId:'op',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
  return {runtime,options,scope,record,receipt,result,evidence,task,checkpoints,ports:createF24KnowledgeReconciliationPorts(options),revoke:()=>{bound=false;}};
}
test('knowledge ports require explicit trusted target and graph binding',()=>{
  assert.equal(createF24KnowledgeReconciliationPorts().unavailable,'f24_knowledge_original_binding_unavailable');
  const f=fixture();delete f.options.isOriginalTarget;assert.equal(createF24KnowledgeReconciliationPorts(f.options).unavailable,'f24_knowledge_original_binding_unavailable');
});
test('knowledge ports bind the authorized original run to the exact persisted verified readback',async()=>{
  const f=fixture(),binding=await f.ports.resolveOriginalEffect(f.scope);
  assert.equal(binding.taskId,'original');assert.equal(binding.runId,'host-tool-original');assert.equal(binding.readbackEvidenceId,f.evidence.evidenceId);
  assert.equal(await f.ports.verifyReadback({scope:f.scope,binding,record:f.record,observations:[f.evidence]}),true);
  assert.equal(await f.ports.verifyReadback({scope:f.scope,binding:{...binding,taskId:'other'},record:f.record,observations:[f.evidence]}),false);
  f.revoke();assert.equal(await f.ports.resolveOriginalEffect(f.scope),undefined);
});
test('knowledge ports refuse unknown, missing evidence, invalid provenance and inconsistent stored outcome',async()=>{
  const unknown=fixture();unknown.record.state='unknown';delete unknown.record.reconciliationOutcome;assert.equal(await unknown.ports.resolveOriginalEffect(unknown.scope),undefined);
  const missing=fixture();missing.task.evidenceRefs=[];assert.equal(await missing.ports.resolveOriginalEffect(missing.scope),undefined);
  const source=fixture();source.evidence.sourceRef='untrusted';assert.equal(await source.ports.resolveOriginalEffect(source.scope),undefined);
  const changed=fixture();changed.checkpoints.set('tool-reconciliation-host-tool-original',{result:{...changed.result,state:'not_applied'}});
  assert.equal(await changed.ports.resolveOriginalEffect(changed.scope),undefined);
  const denied=fixture();denied.record.policyDecision='deny';assert.equal(await denied.ports.resolveOriginalEffect(denied.scope),undefined);
});
