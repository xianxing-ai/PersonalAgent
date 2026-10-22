import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {TaskSnapshot} from '@personal-agent/contracts';
import {actionArgumentsDigest,withCognitionDeadline} from '@personal-agent/cognition';
import type {LayaActionCandidate,LayaActionChoiceRequest,LayaActionSelection} from '@personal-agent/cognition';
import type {TaskRuntime} from '../index.js';

interface Application {readonly profile:string;readonly runtime:TaskRuntime}
export interface ConnectorChangeOrigin {id:string;origin:{taskId:string;runId:string};revision:string}
export interface ConnectorChangeDecisionTaskOptions {
  application:Application;taskId:string;origin:ConnectorChangeOrigin;summary:string;deadline:string;signal:AbortSignal;
  chooser:{choose(input:LayaActionChoiceRequest):Promise<LayaActionSelection>};
  /** Native current-head/scope reader. Its text is local inference input, never cloud context. */
  readCurrent():{context:string};
  now?:()=>number;
}
const fail=(code:string):never=>{throw new ProtocolError(code,'Original connector change decision unavailable');};
/** Runtime Application owns the local bounded decision worker and task terminal state.
 * Desktop supplies trusted current-source projection ports, not an execution callback. */
export async function runRuntimeConnectorChangeDecision(options:ConnectorChangeDecisionTaskOptions):Promise<TaskSnapshot> {
  const {application,taskId,origin}=options,runtime=application.runtime,now=options.now??Date.now;
  if(application.profile!=='huawei_ict_agentarts'||!options.chooser||typeof options.readCurrent!=='function')fail('UNSUPPORTED_CAPABILITY');
  const terminal=new Set(['succeeded','failed','cancelled']),recoveryKey='connector-change-recovery:v1';
  const allowed=new Set(['connector-change-origin','connector-change-decision','application-deadline',
    recoveryKey,'runtime-interruption:v1','runtime-startup-recovery:v1']);
  function pure() {
    const task=runtime.getTask(taskId);
    if(!isDeepStrictEqual(runtime.loadCheckpoint(taskId,'connector-change-origin'),origin)
      ||task.goal!=='判断是否告知用户：'+options.summary||runtime.readToolExecutions(taskId).length
      ||runtime.listCheckpointKeys(taskId).some(key=>!allowed.has(key)))fail('RESULT_UNKNOWN');
    return task;
  }
  function current() {
    pure();
    const source=runtime.getTask(origin.origin.taskId),record=runtime.readToolExecutions(source.taskId).find(item=>item.evidenceId===origin.origin.runId);
    if(source.cancelRequested||['failed','cancelled','cancelling'].includes(source.state)
      ||['private-copy-erasure','private-copy-erasure-binding'].some(key=>runtime.loadCheckpoint(source.taskId,key)!==undefined))fail('SCOPE_DENIED');
    if(record?.state!=='confirmed'||record.policyDecision!=='allow'||!record.executionStarted
      ||!runtime.readEvidence(source.taskId).some(item=>item.evidenceId===record.evidenceId&&item.kind==='execution')
      ||runtime.loadCheckpoint(source.taskId,'tool-result-'+record.evidenceId)===undefined)fail('RESULT_UNKNOWN');
    const projection=options.readCurrent();
    if(!projection||typeof projection.context!=='string'||!projection.context.trim())fail('INVALID_ARGUMENT');
    return projection;
  }
  let task=pure();
  if(terminal.has(task.state))return task;
  if(runtime.isTaskActive(taskId))return task;
  if(task.cancelRequested||task.state==='cancelling')return runtime.confirmCancellation(taskId);
  let storedDeadline=runtime.loadCheckpoint(taskId,'application-deadline');
  if(storedDeadline===undefined) {
    if(task.state!=='created'||!Number.isFinite(Date.parse(options.deadline)))fail('RESULT_UNKNOWN');
    runtime.saveCheckpointOnce(taskId,'application-deadline',options.deadline);
    storedDeadline=runtime.loadCheckpoint(taskId,'application-deadline');
  }
  const deadline=typeof storedDeadline==='string'&&Number.isFinite(Date.parse(storedDeadline))?storedDeadline:fail('RESULT_UNKNOWN');
  current();
  type Decision={action:'notify'|'defer'|'ignore';reason:string;receiptId:string|null;calibrated:false;deadline:string;decidedAt:string};
  function savedDecision():Decision|undefined {
    const saved=runtime.loadCheckpoint(taskId,'connector-change-decision') as Decision|undefined;
    if(saved===undefined)return undefined;
    if(!['notify','defer','ignore'].includes(saved.action)||saved.calibrated!==false||saved.deadline!==deadline
      ||!Number.isFinite(Date.parse(saved.decidedAt))||Date.parse(saved.decidedAt)>Date.parse(deadline))fail('RESULT_UNKNOWN');
    return saved;
  }
  function result(decision:Decision) {
    return {resultSummary:decision.action==='notify'?options.summary:decision.action==='ignore'?'本次变化无需提醒用户':'变化已保留，暂不打扰用户',
      evidenceRefs:[origin.origin.runId]};
  }
  const existing=savedDecision();
  if(existing) {
    // The choice was durably saved before the interrupted terminal transition.
    // Finish only this original local result; never choose again or extend its inference deadline.
    current();task=pure();
    if(task.state==='created')fail('RESULT_UNKNOWN');
    if(task.state==='waiting_approval')task=runtime.transitionTask(taskId,'running');
    if(task.state==='running'||task.state==='waiting_reconciliation')task=runtime.transitionTask(taskId,'verifying');
    if(task.state!=='verifying')fail('RESULT_UNKNOWN');
    return runtime.transitionTask(taskId,'succeeded',{...result(existing),error:null});
  }
  if(now()>=Date.parse(deadline))return runtime.transitionTask(taskId,'failed',{
    error:{code:'TIMEOUT',message:'Original local connector decision deadline expired',retryable:false}});
  if(task.state==='running'||task.state==='verifying') {
    // Adopt only the original inactive local inference, never a cloud/tool invocation.
    task=runtime.transitionTask(taskId,'waiting_reconciliation',{
      error:{code:'RESULT_UNKNOWN',message:'Original local connector inference was interrupted',retryable:false}});
  }
  if(task.state==='waiting_reconciliation') {
    runtime.saveCheckpoint(taskId,recoveryKey,{version:1,origin,deadline,recoveredRevision:task.revision});
    try {task=runtime.prepareVerifiedContinuation(taskId,task.revision);}
    catch(error) {
      if((error as {code?:string})?.code==='REVISION_CONFLICT')fail('RESULT_UNKNOWN');
      throw error;
    }
  } else if(task.state==='waiting_approval') {
    const recovery=runtime.loadCheckpoint(taskId,recoveryKey) as {version?:number;origin?:unknown;deadline?:string;recoveredRevision?:number}|undefined;
    if(recovery?.version!==1||!isDeepStrictEqual(recovery.origin,origin)||recovery.deadline!==deadline
      ||recovery.recoveredRevision!==task.revision-1)fail('RESULT_UNKNOWN');
  } else if(task.state!=='created')fail('RESULT_UNKNOWN');
  return runtime.runTask(taskId,async worker=>{
    const projection=current(),scopeRef='connector-change:'+origin.id;
    const choices:readonly [string,LayaActionCandidate['kind'],string][]=[
      ['notify','escalate','告知用户这次变化，使用现有通知策略和渠道'],
      ['defer','defer','保留变化事件，暂缓提醒'],['ignore','noop','本次变化不值得打扰用户']];
    const candidates: LayaActionCandidate[]=choices.map(([id,kind,description])=>({id,kind,description,revision:1,risk:'low',
      sources:[{id:origin.id,revision:1}],scopeRef,expiresAt:worker.deadline,argumentsDigest:actionArgumentsDigest({})}));
    const signal=AbortSignal.any([worker.signal,options.signal]);
    const selected=await withCognitionDeadline({deadline:worker.deadline,signal},context=>options.chooser.choose({
      context:projection.context,candidates,...context}),now);
    current();signal.throwIfAborted();
    const candidate=candidates.find(value=>value.id===selected?.selected?.id&&value.revision===selected.selected.revision);
    const selectedAction=candidate?.id;
    const action:Decision['action']=selected?.state==='selected'&&selected.eligibleForRuntime===true
      &&(selectedAction==='notify'||selectedAction==='defer'||selectedAction==='ignore')?selectedAction:'defer';
    const decision:Decision={action,reason:selected?.reason??'unavailable',
      receiptId:typeof selected?.receipt?.id==='string'?selected.receipt.id:null,calibrated:false,
      deadline:worker.deadline,decidedAt:new Date(now()).toISOString()};
    if(now()>=Date.parse(worker.deadline))throw new ProtocolError('TIMEOUT','Original local connector decision deadline expired');
    runtime.saveCheckpointOnce(taskId,'connector-change-decision',decision);
    return result(decision);
  },{deadline,sideEffect:'read',...(task.state==='created'?{}:{resume:true})});
}

/** Complete only the existing Scheduler's exact fired wake. This is an admission
 * receipt for a separate source read, never evidence that the connector read succeeded. */
export async function completeRuntimeConnectorWatchWake({application,scheduleId,deadline}:{application:Application;scheduleId:string;deadline:string}):Promise<TaskSnapshot> {
  if(application.profile!=='huawei_ict_agentarts')fail('UNSUPPORTED_CAPABILITY');
  const runtime=application.runtime,schedule=runtime.getSchedule(scheduleId);
  if(!schedule.scheduleId.startsWith('connector-watch-')||!schedule.conversationId.startsWith('connector-watch:')
    ||schedule.status!=='fired'||!schedule.taskId||runtime.findTaskByIdempotencyKey(schedule.taskIdempotencyKey)?.taskId!==schedule.taskId)fail('UNAUTHORIZED');
  let task=runtime.getTask(schedule.taskId!);
  if(task.conversationId!==schedule.conversationId||task.goal!==schedule.goal
    ||schedule.goal!=='唤醒已批准的连接器订阅')fail('SCOPE_DENIED');
  if(['succeeded','failed','cancelled'].includes(task.state)||runtime.isTaskActive(task.taskId))return task;
  const key='connector-watch-wake-admission',binding={version:1,scheduleId,taskId:task.taskId,
    conversationId:schedule.conversationId,idempotencyKey:schedule.taskIdempotencyKey,deadline};
  if(task.state==='created')runtime.saveCheckpointOnce(task.taskId,key,binding);
  const saved=runtime.loadCheckpoint(task.taskId,key);
  if(!isDeepStrictEqual(saved,binding)||runtime.readToolExecutions(task.taskId).length
    ||runtime.listCheckpointKeys(task.taskId).some(name=>![key,'runtime-interruption:v1','runtime-startup-recovery:v1'].includes(name)))fail('RESULT_UNKNOWN');
  if(task.cancelRequested||task.state==='cancelling')return runtime.confirmCancellation(task.taskId);
  if(task.state!=='created') {
    // The original admission already began. This only settles that known local
    // receipt and does not rerun a source read, inference or external side effect.
    if(task.state==='running'||task.state==='waiting_reconciliation')task=runtime.transitionTask(task.taskId,'verifying');
    if(task.state!=='verifying')fail('RESULT_UNKNOWN');
    return runtime.transitionTask(task.taskId,'succeeded',{resultSummary:'已唤醒原连接器读取；读取结果另行核实',error:null});
  }
  return runtime.runTask(task.taskId,async()=>({resultSummary:'已唤醒原连接器读取；读取结果另行核实'}),{deadline,sideEffect:'read'});
}
