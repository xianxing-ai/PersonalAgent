import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {TaskRuntime} from '../index.js';
import type {F24OriginalEffectBinding,F24ReconciliationHostOptions} from './workflow-f24-reconciliation-host.js';

type Scope=Parameters<F24ReconciliationHostOptions['resolveOriginalEffect']>[0];
type Verification=Parameters<F24ReconciliationHostOptions['verifyReadback']>[0];
type Target={taskId:string;runId:string};
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);

/** Consumes only an already finalized KnowledgeWriteReconciliationAdapter receipt.
 * Target is fixed by trusted composition, not supplied by a graph or model. */
export function createF24KnowledgeReconciliationPorts(options?:{
  runtime:TaskRuntime;namespace:string;target:Target;
  isOriginalTarget:(scope:Scope,target:Target)=>Promise<boolean>;
}):{resolveOriginalEffect?:F24ReconciliationHostOptions['resolveOriginalEffect'];
  verifyReadback?:F24ReconciliationHostOptions['verifyReadback'];unavailable:string|null} {
  if(!options?.runtime||!text(options.namespace)||!text(options.target?.taskId)||!text(options.target?.runId)
    ||options.target.runId!=='host-tool-'+options.target.taskId||typeof options.isOriginalTarget!=='function')
    return {unavailable:'f24_knowledge_original_binding_unavailable'};
  const {runtime,namespace}=options,target=structuredClone(options.target);
  const inspect=():F24OriginalEffectBinding|undefined=>{
    try {
      const task=runtime.getTask(target.taskId),intent=runtime.loadCheckpoint(target.taskId,'host-tool-intent');
      const receipt=runtime.loadCheckpoint(target.taskId,'knowledge-write-readback');
      if(!plain(intent)||intent.namespace!==namespace||task.conversationId!=='host-tool:'+namespace
        ||intent.toolName!=='knowledge.apply_note_patch'||intent.toolVersion!=='1.0.0'||!plain(intent.arguments)
        ||intent.argumentsDigest!==toolArgumentsDigest(intent.arguments)||!plain(receipt)||!plain(receipt.result)||!plain(receipt.evidence))return;
      const result=receipt.result,evidence=receipt.evidence;
      const record=runtime.readToolExecutions(target.taskId).find(item=>item.evidenceId===target.runId);
      const checkpoint=runtime.loadCheckpoint(target.taskId,'tool-reconciliation-'+target.runId);
      if(!record||record.taskId!==target.taskId||record.toolName!==intent.toolName||record.toolVersion!==intent.toolVersion
        ||record.policyDecision!=='allow'||record.executionStarted!==true||!sha(record.inputDigest)
        ||!runtime.matchesToolExecutionInput(record,{arguments:intent.arguments,scopeRef:target.runId})
        ||receipt.taskId!==target.taskId||receipt.runId!==target.runId||receipt.toolName!==intent.toolName
        ||receipt.toolVersion!==intent.toolVersion||receipt.argumentsDigest!==intent.argumentsDigest||receipt.executionRecordId!==target.runId
        ||!['applied','not_applied'].includes(String(result.state))||result.state!==record.reconciliationOutcome
        ||result.state==='applied'&&record.state!=='confirmed'||result.state==='not_applied'&&record.state!=='failed'
        ||!sha(result.operationId)||!sha(result.currentSha256)||!text(result.backupId)||typeof result.lockRetained!=='boolean'
        ||!plain(checkpoint)||!isDeepStrictEqual(checkpoint.result,result))return;
      const evidenceId='knowledge-readback-'+createHash('sha256').update(JSON.stringify([
        target.taskId,target.runId,intent.argumentsDigest,result.operationId,result.state,result.currentSha256])).digest('hex');
      const actual=runtime.readEvidence(target.taskId).filter(item=>item.evidenceId===evidenceId);
      if(evidence.evidenceId!==evidenceId||evidence.kind!=='observation'||evidence.verification!=='verified'
        ||evidence.sourceRef!=='runtime:knowledge-readback'||!task.evidenceRefs.includes(evidenceId)
        ||actual.length!==1||!isDeepStrictEqual(actual[0],evidence))return;
      return {taskId:target.taskId,runId:target.runId,toolName:intent.toolName,toolVersion:intent.toolVersion,
        inputDigest:record.inputDigest,readbackEvidenceId:evidenceId};
    }catch{return undefined;}
  };
  const resolve:NonNullable<F24ReconciliationHostOptions['resolveOriginalEffect']>=async scope=>{
    if(scope.signal.aborted||await options.isOriginalTarget(scope,structuredClone(target))!==true||scope.signal.aborted)return;
    const original=inspect();
    if(!original||await options.isOriginalTarget(scope,structuredClone(target))!==true||scope.signal.aborted)return;
    const after=inspect();return isDeepStrictEqual(original,after)?original:undefined;
  };
  const verify:NonNullable<F24ReconciliationHostOptions['verifyReadback']>=async (input:Verification)=>{
    const current=await resolve(input.scope);
    if(!current||!isDeepStrictEqual(current,input.binding))return false;
    const record=runtime.readToolExecutions(target.taskId).find(item=>item.evidenceId===target.runId);
    const observations=runtime.readEvidence(target.taskId).filter(item=>item.evidenceId===current.readbackEvidenceId);
    return isDeepStrictEqual(record,input.record)&&isDeepStrictEqual(observations,input.observations);
  };
  return {resolveOriginalEffect:resolve,verifyReadback:verify,unavailable:null};
}
