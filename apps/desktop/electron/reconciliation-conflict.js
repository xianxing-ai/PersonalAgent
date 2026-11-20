import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {conversationToolAction} from './conversation-prohibitions.js';
import {isDeletionOperation} from './deletion-operation-policy.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const decisionKey=id=>'reconciliation-conflict-decision:'+id;
const notificationKey=id=>'reconciliation-conflict-notification:'+id;
const readbackKey=id=>'reconciliation-conflict-readback:'+id;
const risky=toolName=>['send','publish'].includes(conversationToolAction(toolName))||isDeletionOperation({toolName});
/** Reads the exact unresolved local/remote frontier, never its private bodies or a proposed retry. */
export function readReconciliationConflict(application,task) {
  const runtime=application?.runtime;
  if(!['waiting_reconciliation','failed'].includes(task?.state)||typeof runtime?.getTask!=='function'||typeof runtime.readToolExecutions!=='function')return;
  const current=runtime.getTask(task.taskId);if(current.state!==task.state||current.revision!==task.revision)return;
  const stale=runtime.loadCheckpoint(task.taskId,'competition-stale-epoch');
  const executionEpoch=runtime.readExecutionEpoch?.(task.taskId)??runtime.loadCheckpoint(task.taskId,'execution-epoch')??0;
  const staleRun=record=>Number.isSafeInteger(stale?.expected)&&stale.current===executionEpoch
    &&runtime.loadCheckpoint(task.taskId,'execution-epoch:run:'+record.evidenceId)===stale.expected;
  const records=runtime.readToolExecutions(task.taskId).filter(record=>record.policyDecision!=='deny'
    &&(!staleRun(record)||record.executionStarted&&['unknown','started'].includes(record.state))
    &&(record.executionStarted&&['unknown','started'].includes(record.state)&&record.reconciliationOutcome!=='not_applied'
      ||(task.state==='failed'?record.state==='failed'&&risky(record.toolName):record.executionStarted
        &&record.state==='failed'&&record.reconciliationOutcome!=='not_applied')))
    .map(({evidenceId,inputDigest,toolName,toolVersion,state,executionStarted,reconciliationOutcome})=>({evidenceId,inputDigest,toolName,toolVersion,state,executionStarted,
      ...(reconciliationOutcome?{reconciliationOutcome}:{})})).sort((a,b)=>a.evidenceId.localeCompare(b.evidenceId));
  const loop=runtime.loadCheckpoint(task.taskId,'competition-loop');
  const staleCloud=Number.isSafeInteger(stale?.expected)&&stale.current===executionEpoch&&loop?.executionEpoch===stale.expected;
  const cloud=!staleCloud&&task.state==='waiting_reconciliation'
    ?runtime.loadCheckpoint(task.taskId,'competition-cloud-unknown')??runtime.loadCheckpoint(task.taskId,'competition-cloud-inflight'):undefined;
  const candidate=runtime.loadCheckpoint(task.taskId,'competition-completion-conflict');
  const completion=candidate?.version===1&&candidate.executionEpoch===executionEpoch
    &&candidate.localVerdict==='required_delegation_incomplete'&&/^[a-f0-9]{64}$/u.test(candidate.cloudResultDigest)?candidate:undefined;
  const diagnostics=['competition-coordination-failure','competition-cloud-terminal-error','competition-cloud-received-failure']
    .map(key=>runtime.loadCheckpoint(task.taskId,key)??null);
  // Generic transport diagnostics alone do not prove a conflicting write or a cloud/local disagreement.
  if(!records.length&&!cloud&&!completion)return;
  const conflictId=digest({taskId:task.taskId,executionEpoch,records,cloud:cloud??null,completion:completion??null,diagnostics}),saved=runtime.loadCheckpoint(task.taskId,decisionKey(conflictId));
  const skipped=saved?.version===1&&saved.taskId===task.taskId&&saved.conflictId===conflictId&&saved.decision==='skip';
  return {conflictId,expectedRevision:task.revision,skipped,kind:completion?'cloud_local':task.state==='failed'?'failed':'unknown',
    notice:skipped?'已按你的明确决定跳过此冲突的后续执行；保留原失败或未知结果，不会重试，也不记为成功。'
      :completion?'云端已给出完成回答，但本地必需子任务尚未完成，已停止执行。请只读核实，或明确跳过这一次冲突；沉默不会跳过，也不会记为成功。'
      :'原动作失败或结果待核实，已停止执行。请只读核实原结果，或明确跳过这一次冲突的后续执行；沉默不会跳过。'};
}
/** One original read only; never calls apply/resume or creates a new execution of the failed action. */
export async function inspectReconciliationConflictOnce({application,taskId,readOriginal,deadline,signal}) {
  const runtime=application?.runtime,binding=readReconciliationConflict(application,runtime?.getTask(taskId));if(!binding)return;
  const key=readbackKey(binding.conflictId),existing=runtime.loadCheckpoint(taskId,key);if(existing)return existing;
  const base={version:1,taskId,conflictId:binding.conflictId};
  if(typeof readOriginal!=='function'){
    const unavailable={...base,state:'unavailable'};runtime.saveCheckpointOnce(taskId,key,unavailable);return unavailable;
  }
  if(signal?.aborted||!signal||!Number.isFinite(Date.parse(deadline))||Date.parse(deadline)<=Date.now())throw new ProtocolError('CANCELLED','原冲突核实已取消或过期');
  if(!runtime.saveCheckpointOnce(taskId,key,{...base,state:'started'}))return runtime.loadCheckpoint(taskId,key);
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,Date.parse(deadline)-Date.now());
  signal.addEventListener('abort',abort,{once:true});
  let state='unknown',onAbort;
  const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(new ProtocolError('CANCELLED','原冲突只读核实已结束'));
    controller.signal.addEventListener('abort',onAbort,{once:true});});
  try{
    const result=await Promise.race([Promise.resolve().then(()=>{controller.signal.throwIfAborted();
      return readOriginal({taskId,conflictId:binding.conflictId,deadline,signal:controller.signal});}),cancelled]);
    if(!signal.aborted&&Date.parse(deadline)>Date.now()&&readReconciliationConflict(application,runtime.getTask(taskId))?.conflictId===binding.conflictId
      &&['confirmed','not_applied','unknown','unavailable'].includes(result?.state))state=result.state;
  }catch{/* The visible original conflict stays pending; errors contain no new execution authority. */}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',onAbort);}
  const result={...base,state};runtime.saveCheckpoint(taskId,key,result);return result;
}
export function recordReconciliationConflictSkip(application,task,{conflictId,expectedRevision}) {
  const binding=readReconciliationConflict(application,task),runtime=application?.runtime;
  if(!binding||binding.conflictId!==conflictId||binding.expectedRevision!==expectedRevision)
    throw new ProtocolError('REVISION_CONFLICT','这次冲突或原任务已变化，请查看当前待决操作');
  const key=decisionKey(conflictId),value={version:1,taskId:task.taskId,conflictId,decision:'skip'};
  runtime.saveCheckpointOnce(task.taskId,key,value);
  if(!isDeepStrictEqual(runtime.loadCheckpoint(task.taskId,key),value))throw new ProtocolError('REVISION_CONFLICT','原冲突决定已变化');
  return {...binding,skipped:true};
}
export function recordUnavailableConflictNotification(application,taskId) {
  const runtime=application?.runtime,binding=readReconciliationConflict(application,runtime?.getTask(taskId));if(!binding)return;
  const value={version:1,taskId,conflictId:binding.conflictId,state:'notification_skipped',reason:'fixed_contact_email_unavailable'};
  runtime.saveCheckpointOnce(taskId,notificationKey(binding.conflictId),value);return value;
}
export function assertNoUnresolvedWriteReplay({application,taskId,sideEffect}) {
  if(sideEffect==='read')return;
  const runtime=application?.runtime,task=runtime?.getTask(taskId);
  if(task?.state==='waiting_reconciliation'||task?.state==='failed'&&readReconciliationConflict(application,task))
    throw new ProtocolError('RESULT_UNKNOWN','原动作结果待核实；只允许原结果只读对账，不能重新发信、删除或发布');
}
