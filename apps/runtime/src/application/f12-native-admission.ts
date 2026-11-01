import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {CoordinationPort,CoordinationToolProposalResult} from '@personal-agent/coordination';
import type {TaskRuntime} from '../index.js';
import type {RuntimeConfiguredWorkflowCapability} from './configured-workflow-worker.js';
import {readRuntimeSubagentBinding} from './subagent-host.js';
import {readUserTaskDelegation} from './user-task-delegation.js';

export const F12_NATIVE_RETURN='f12-native-return:v1';
const goal='汇总这次明确归来时仍有效且未读的通知。';
export interface F12ReturnDigestRequest {
  conversationId:string;deadline:string;idempotencyKey:string;arguments:Record<string,unknown>;
}
export interface F12ReturnDigestIntent extends F12ReturnDigestRequest {
  version:1;configurationRef:string;descriptor:ReturnType<RuntimeConfiguredWorkflowCapability['describe']>;
}
export function prepareF12ReturnDigest(request:F12ReturnDigestRequest,entry:RuntimeConfiguredWorkflowCapability,
  configurationRef:string,now:number):F12ReturnDigestIntent {
  if(!request||Object.keys(request).sort().join(',')!=='arguments,conversationId,deadline,idempotencyKey'
    ||![request.conversationId,request.idempotencyKey].every(value=>typeof value==='string'&&value.trim()&&value.length<=1024)
    ||typeof request.deadline!=='string'||!Number.isFinite(Date.parse(request.deadline))||Date.parse(request.deadline)<=now
    ||request.arguments?.trigger!=='on_return')throw new ProtocolError('INVALID_ARGUMENT','Invalid native F12 return request');
  const descriptor=entry.describe();
  if(descriptor.name!=='workflow.business.f12'||descriptor.version!=='1.0.0')
    throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original F12 entry is unavailable');
  validateToolValue(descriptor.inputSchema,request.arguments);
  return {version:1,...structuredClone(request),descriptor:structuredClone(descriptor),configurationRef};
}
export const f12ReturnTaskKey=(id:string)=>'f12-native-return:'+toolArgumentsDigest({id});
export const f12ReturnGoal=()=>goal;

/** A native request selects the original configured graph, never a model-authored replacement. */
export function f12ReturnDigestPort(runtime:TaskRuntime,port:CoordinationPort,childTaskId:string,
  configurationRef:string,entry:RuntimeConfiguredWorkflowCapability,now:()=>number):CoordinationPort|undefined {
  const parent=readRuntimeSubagentBinding(runtime,childTaskId),saved=runtime.loadCheckpoint(parent.parentTaskId,F12_NATIVE_RETURN) as F12ReturnDigestIntent|undefined;
  if(saved===undefined)return;
  const frozen=structuredClone(saved);
  const current=()=>{
    const binding=readRuntimeSubagentBinding(runtime,childTaskId),delegation=readUserTaskDelegation(runtime,binding.parentTaskId);
    const root=runtime.getTask(binding.parentTaskId),child=runtime.getTask(childTaskId);
    if(!isDeepStrictEqual(runtime.loadCheckpoint(root.taskId,F12_NATIVE_RETURN),frozen)||frozen.version!==1
      ||frozen.configurationRef!==configurationRef||!isDeepStrictEqual(entry.describe(),frozen.descriptor)
      ||!delegation||binding.parentTaskId!==parent.parentTaskId||binding.subtaskId!=='user-work'
      ||binding.parentDeadline!==frozen.deadline||delegation.deadline!==frozen.deadline
      ||root.goal!==goal||root.conversationId!==frozen.conversationId
      ||runtime.findTaskByIdempotencyKey(f12ReturnTaskKey(frozen.idempotencyKey))?.taskId!==root.taskId
      ||root.cancelRequested||child.cancelRequested||['succeeded','failed','cancelled','cancelling'].includes(root.state)
      ||Date.parse(frozen.deadline)<=now())throw new ProtocolError('UNAUTHORIZED','Original native F12 request changed or expired');
    validateToolValue(frozen.descriptor.inputSchema,frozen.arguments);
    return child;
  };
  const proposal:CoordinationToolProposalResult={kind:'tool_proposal',proposalId:'native-f12-'+toolArgumentsDigest(frozen),
    toolName:frozen.descriptor.name,toolVersion:frozen.descriptor.version,arguments:structuredClone(frozen.arguments),verification:'unverified'};
  return {execute:async request=>{
    const child=current();
    if(request.taskId!==childTaskId||request.goal!==child.goal||request.deadline!==frozen.deadline||request.signal.aborted)
      throw new ProtocolError('UNAUTHORIZED','Native F12 invocation is outside its original child');
    if(request.continuation===undefined)return structuredClone(proposal);
    const loop=runtime.loadCheckpoint(childTaskId,'competition-loop') as {receipts?:{
      proposal:CoordinationToolProposalResult;continuation:unknown;workerSelection?:unknown;workerRevision?:number}[]}|undefined;
    const receipts=loop?.receipts;
    if(!receipts||receipts.length!==1||!isDeepStrictEqual(receipts[0]!.proposal,proposal)
      ||!isDeepStrictEqual(receipts[0]!.continuation,request.continuation)||request.continuation.state!=='confirmed'
      ||!Number.isSafeInteger(receipts[0]!.workerRevision))
      throw new ProtocolError('UNAUTHORIZED','Native F12 summary requires its original confirmed graph');
    // The original loop authenticates the configured receipt before this exchange;
    // this port additionally restricts it to the single native request.
    const result=await port.execute(request);current();
    if(result.kind!=='text')throw new ProtocolError('SCOPE_DENIED','Native F12 may only summarize its original graph');
    return result;
  }};
}
