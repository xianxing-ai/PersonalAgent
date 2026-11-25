import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {ToolContext} from '@personal-agent/contracts';
import type {TaskRuntime} from '../index.js';

export type OwnedWorkflowHostScope={parentTaskId:string;localTaskId:string;operationId:string;sessionId:string;deadline:string;signal:AbortSignal};
const text=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=2048;
export function failOwnedHost(code:string,message:string):never {throw new ProtocolError(code,message);}

/** Shared fail-closed binding for owned-workflow HostBridge child tools. */
export function assertOwnedWorkflowHostScope(input:{
  runtime:TaskRuntime;context:ToolContext;workflowId:string;nodeId:string;hostToolName:string;
  proposalArguments?:unknown;hostArguments?:unknown;assertCurrent?:(scope:OwnedWorkflowHostScope,context:ToolContext)=>void;
  now?:()=>Date;
}):OwnedWorkflowHostScope {
  const {runtime,context}=input;
  if(context.signal.aborted)failOwnedHost('CANCELLED','Original workflow host cancelled');
  const now=input.now?.() ?? new Date();
  if(!(now instanceof Date)||!Number.isFinite(now.getTime())||!Number.isFinite(Date.parse(context.deadline))
    ||Date.parse(context.deadline)<=now.getTime())failOwnedHost('TIMEOUT','Original workflow host expired');
  if(!context.authorizationRef||context.runId!=='host-tool-'+context.taskId)failOwnedHost('UNAUTHORIZED','Original workflow host authorization unavailable');
  const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
  if(!text(parent?.taskId)||!text(parent.operationId))failOwnedHost('UNAUTHORIZED','Original workflow host binding unavailable');
  const intent=runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId) as
    {taskId?:string;workflowId?:string;sessionId?:string;deadline?:string;proposal?:{nodeId?:string;operationId?:string;toolName?:string;arguments?:unknown}}|undefined;
  const host=runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {commandId?:string;toolName?:string;arguments?:unknown;deadline?:string}|undefined;
  const owner=runtime.getTask(parent.taskId);
  const proposalArgs=input.proposalArguments ?? {};
  const hostArgs=input.hostArguments ?? proposalArgs;
  if(owner.cancelRequested||!['running','waiting_approval'].includes(owner.state)||intent?.taskId!==parent.taskId
    ||intent.workflowId!==input.workflowId||!text(intent.sessionId)||intent.proposal?.nodeId!==input.nodeId
    ||intent.proposal.operationId!==parent.operationId||intent.proposal.toolName!==input.hostToolName
    ||host?.commandId!==parent.operationId||host.toolName!==input.hostToolName||host.deadline!==context.deadline
    ||intent.deadline!==context.deadline||!isDeepStrictEqual(intent.proposal.arguments,proposalArgs)
    ||!isDeepStrictEqual(host.arguments,hostArgs))
    failOwnedHost('UNAUTHORIZED','Original workflow host intent changed');
  const scope={parentTaskId:parent.taskId,localTaskId:context.taskId,operationId:parent.operationId,
    sessionId:intent.sessionId,deadline:context.deadline,signal:context.signal};
  if(typeof input.assertCurrent==='function') {
    try {
      const checked:unknown=input.assertCurrent(scope,context);
      if(checked!==undefined){void Promise.resolve(checked).catch(()=>undefined);failOwnedHost('UNAUTHORIZED','Workflow host gate must be synchronous');}
    }catch {failOwnedHost('UNAUTHORIZED','Original workflow host authority unavailable');}
  }
  return scope;
}
