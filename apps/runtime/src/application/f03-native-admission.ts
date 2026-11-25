import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {CoordinationPort,CoordinationToolProposalResult} from '@personal-agent/coordination';
import type {TaskRuntime} from '../index.js';
import type {RuntimeConfiguredWorkflowCapability} from './configured-workflow-worker.js';
import {readRuntimeSubagentBinding} from './subagent-host.js';
import {readUserTaskDelegation} from './user-task-delegation.js';

export const F03_NATIVE_MAIL_REVIEW='f03-native-mail-review:v1';
const goal='按原邮件来源变化审查原计划，保留已发生的副作用。';
export interface F03MailReviewRequest {conversationId:string;deadline:string;idempotencyKey:string;arguments:Record<string,unknown>}
export interface F03MailReviewIntent extends F03MailReviewRequest {
  version:1;configurationRef:string;descriptor:ReturnType<RuntimeConfiguredWorkflowCapability['describe']>;
}
export function prepareF03MailReview(request:F03MailReviewRequest,entry:RuntimeConfiguredWorkflowCapability,
  configurationRef:string,now:number):F03MailReviewIntent {
  if(!request||Object.keys(request).sort().join(',')!=='arguments,conversationId,deadline,idempotencyKey'
    ||![request.conversationId,request.idempotencyKey].every(value=>typeof value==='string'&&value.trim()&&value.length<=1024)
    ||!Number.isFinite(Date.parse(request.deadline))||Date.parse(request.deadline)<=now)
    throw new ProtocolError('INVALID_ARGUMENT','Invalid original F03 review request');
  const descriptor=entry.describe();
  if(descriptor.name!=='workflow.business.f03'||descriptor.version!=='1.0.0')
    throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original F03 review entry is unavailable');
  validateToolValue(descriptor.inputSchema,request.arguments);
  return {version:1,...structuredClone(request),descriptor:structuredClone(descriptor),configurationRef};
}
export const f03MailReviewTaskKey=(id:string)=>'f03-native-mail-review:'+toolArgumentsDigest({id});
export const f03MailReviewGoal=()=>goal;

/** Native admission fixes only the original source reference. The real image still performs F03 review. */
export function f03MailReviewPort(runtime:TaskRuntime,port:CoordinationPort,childTaskId:string,
  configurationRef:string,entry:RuntimeConfiguredWorkflowCapability,now:()=>number):CoordinationPort|undefined {
  const parent=readRuntimeSubagentBinding(runtime,childTaskId);
  const saved=runtime.loadCheckpoint(parent.parentTaskId,F03_NATIVE_MAIL_REVIEW) as F03MailReviewIntent|undefined;
  if(saved===undefined)return;
  const frozen=structuredClone(saved);
  const current=()=>{
    const binding=readRuntimeSubagentBinding(runtime,childTaskId),delegation=readUserTaskDelegation(runtime,binding.parentTaskId);
    const root=runtime.getTask(binding.parentTaskId),child=runtime.getTask(childTaskId);
    if(!isDeepStrictEqual(runtime.loadCheckpoint(root.taskId,F03_NATIVE_MAIL_REVIEW),frozen)||frozen.version!==1
      ||frozen.configurationRef!==configurationRef||!isDeepStrictEqual(entry.describe(),frozen.descriptor)
      ||!delegation||binding.parentTaskId!==parent.parentTaskId||binding.subtaskId!=='user-work'
      ||binding.parentDeadline!==frozen.deadline||delegation.deadline!==frozen.deadline
      ||root.goal!==goal||root.conversationId!==frozen.conversationId
      ||runtime.findTaskByIdempotencyKey(f03MailReviewTaskKey(frozen.idempotencyKey))?.taskId!==root.taskId
      ||root.cancelRequested||child.cancelRequested||['succeeded','failed','cancelled','cancelling'].includes(root.state)
      ||runtime.loadCheckpoint(root.taskId,'private-copy-erasure')!==undefined||Date.parse(frozen.deadline)<=now())
      throw new ProtocolError('UNAUTHORIZED','Original native F03 request changed or expired');
    validateToolValue(frozen.descriptor.inputSchema,frozen.arguments);return child;
  };
  const proposal:CoordinationToolProposalResult={kind:'tool_proposal',proposalId:'native-f03-'+toolArgumentsDigest(frozen),
    toolName:frozen.descriptor.name,toolVersion:frozen.descriptor.version,arguments:structuredClone(frozen.arguments),verification:'unverified'};
  return {execute:async request=>{
    const child=current();
    runtime.assertExecutionEpoch(childTaskId,request.executionEpoch!);
    const boundProposal={...proposal,executionEpoch:request.executionEpoch!};
    if(request.taskId!==childTaskId||request.goal!==child.goal||request.deadline!==frozen.deadline||request.signal.aborted)
      throw new ProtocolError('UNAUTHORIZED','Native F03 invocation is outside its original child');
    if(request.continuation===undefined)return structuredClone(boundProposal);
    const loop=runtime.loadCheckpoint(childTaskId,'competition-loop') as {receipts?:{
      proposal:CoordinationToolProposalResult;continuation:unknown;workerRevision?:number}[]}|undefined;
    if(loop?.receipts?.length!==1||!isDeepStrictEqual(loop.receipts[0]!.proposal,boundProposal)
      ||!isDeepStrictEqual(loop.receipts[0]!.continuation,request.continuation)||request.continuation.state!=='confirmed'
      ||!Number.isSafeInteger(loop.receipts[0]!.workerRevision))
      throw new ProtocolError('UNAUTHORIZED','Native F03 summary requires its original confirmed graph');
    const result=await port.execute(request);current();
    if(result.kind!=='text')throw new ProtocolError('SCOPE_DENIED','Native F03 may only summarize its original graph');
    return result;
  }};
}
