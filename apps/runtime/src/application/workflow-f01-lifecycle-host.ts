import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {TaskSnapshot,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeResponsibilityLifecycleCommand} from './proactive-workflow-application.js';
import {readConfiguredWorkflowBinding} from './configured-workflow-worker.js';

type Lifetime={deadline:string;signal:AbortSignal};
export interface F01ResponsibilityTarget {taskId:string;sessionId:string}
export interface F01LifecycleSelection {
  target:F01ResponsibilityTarget;responsibilityId:string;responsibilityRevision:number;
  expectedLifecycleRevision:number;action:'activate'|'revoke';validUntil?:string;
}
export interface F01LifecycleInvocation {
  graphTaskId:string;sessionId:string;localTaskId:string;operationId:string;source:TaskSnapshot;
  selection:F01LifecycleSelection;command:RuntimeResponsibilityLifecycleCommand;
}
type Application=Pick<RuntimeApplication,'runtime'|'readHostToolTask'|'readConfiguredWorkflowBinding'|'readDelegatedUserTaskParent'>;
const text={type:'string',minLength:1,maxLength:256};
export const F01_LIFECYCLE_SCHEMA={type:'object',additionalProperties:false,
  required:['target','responsibilityId','responsibilityRevision','expectedLifecycleRevision','action'],properties:{
    target:{type:'object',additionalProperties:false,required:['taskId','sessionId'],properties:{taskId:text,sessionId:text}},
    responsibilityId:text,responsibilityRevision:{type:'integer',minimum:1},
    expectedLifecycleRevision:{type:'integer',minimum:0},action:{enum:['activate','revoke']},
    validUntil:{type:'string',minLength:1,maxLength:64}}};
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const denied=():never=>{throw new ProtocolError('UNAUTHORIZED','Original F01 lifecycle operation is unavailable');};

/** Current graph input and the original started Policy operation are the only
 * authority. Neither model text nor an explicit_instruction label is a grant. */
export function readF01LifecycleInvocation(application:Application,localTaskId:string,context:Lifetime,mode:'execute'|'readback'):F01LifecycleInvocation {
  if(context.signal.aborted||!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=Date.now())return denied();
  const runtime=application.runtime,local=application.readHostToolTask(localTaskId),runId='host-tool-'+localTaskId;
  const parent=runtime.loadCheckpoint(localTaskId,'coding-repair:parent');
  if(!plain(parent)||typeof parent.taskId!=='string'||typeof parent.operationId!=='string')return denied();
  const host=runtime.loadCheckpoint(localTaskId,'host-tool-intent'),intent=runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId);
  if(!plain(host)||!plain(intent)||!plain(intent.proposal)||intent.taskId!==parent.taskId||intent.workflowId!=='F01'
    ||typeof intent.sessionId!=='string'||intent.deadline!==context.deadline||intent.proposal.nodeId!=='F01_N09'
    ||intent.proposal.operationId!==parent.operationId||intent.proposal.toolName!=='workflow.host.f01_n09'
    ||local.commandId!==parent.operationId||local.toolName!=='workflow.host.f01_n09'||local.toolVersion!=='1.0.0'
    ||host.deadline!==context.deadline||host.commandId!==parent.operationId||host.toolName!==local.toolName||host.toolVersion!==local.toolVersion
    ||!isDeepStrictEqual(host.arguments,intent.proposal.arguments))return denied();
  const binding=readConfiguredWorkflowBinding(application,{taskId:parent.taskId,workflowId:'F01',sessionId:intent.sessionId,signal:context.signal});
  if(!binding||binding.deadline!==context.deadline||!plain(binding.input)||!isDeepStrictEqual(binding.input.lifecycle,host.arguments))return denied();
  validateToolValue(F01_LIFECYCLE_SCHEMA,host.arguments);
  const selection=structuredClone(host.arguments) as F01LifecycleSelection;
  if(selection.action==='activate'&&(!selection.validUntil||!Number.isFinite(Date.parse(selection.validUntil)))
    ||selection.action==='revoke'&&selection.validUntil!==undefined)return denied();
  const record=runtime.readToolExecutions(localTaskId).find(item=>item.evidenceId===runId);
  if(!record||record.toolName!==local.toolName||record.toolVersion!==local.toolVersion||!record.executionStarted||record.policyDecision!=='allow'
    ||!runtime.matchesToolExecutionInput(record,{arguments:{...selection},scopeRef:runId}))return denied();
  if(mode==='execute'&&(local.task.cancelRequested||local.task.state!=='running'||!runtime.isToolExecutionActive(record)))return denied();
  if(mode==='readback'&&(runtime.isToolExecutionActive(record)||!['unknown','confirmed'].includes(record.state)))return denied();
  const original=application.readDelegatedUserTaskParent(parent.taskId);if(!original||original.deadline!==context.deadline)return denied();
  const source=runtime.getTask(original.taskId),graph=runtime.getTask(parent.taskId);
  if(source.cancelRequested||graph.cancelRequested||source.conversationId!==original.conversationId||!source.goal
    ||runtime.loadCheckpoint(source.taskId,'private-copy-erasure')!==undefined
    ||runtime.loadCheckpoint(source.taskId,'private-copy-erasure-binding')!==undefined)return denied();
  const {target:_,...selected}=selection;
  return {graphTaskId:parent.taskId,sessionId:intent.sessionId,localTaskId,operationId:parent.operationId,source,selection,
    command:{...selected,expectedLifecycleRevision:selected.expectedLifecycleRevision===0?null:selected.expectedLifecycleRevision,
      commandId:'f01-lifecycle:'+localTaskId,sourceTaskId:source.taskId}};
}

export function createRuntimeF01LifecycleHost(options:{getApplication:()=>Application;
  commit:(invocation:F01LifecycleInvocation,scope:Lifetime)=>Promise<{state:'recorded';revision:number}>;
  readOperation:(invocation:F01LifecycleInvocation,scope:Lifetime)=>Promise<{state:'recorded';revision:number}|{state:'unknown'}>;
}) {
  const authority={
    assertCurrent(target:F01ResponsibilityTarget,command:RuntimeResponsibilityLifecycleCommand,source:TaskSnapshot,scope:Lifetime){
      if(!command.commandId.startsWith('f01-lifecycle:'))return denied();
      const invocation=readF01LifecycleInvocation(options.getApplication(),command.commandId.slice('f01-lifecycle:'.length),scope,'execute');
      if(!isDeepStrictEqual(invocation.selection.target,target)||!isDeepStrictEqual(invocation.command,command)
        ||invocation.source.taskId!==source.taskId||invocation.source.goal!==source.goal)return denied();
    },
    verify(target:F01ResponsibilityTarget,command:RuntimeResponsibilityLifecycleCommand,source:TaskSnapshot,scope:Lifetime){
      authority.assertCurrent(target,command,source,scope);return true;
    },
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F01_N09',kind:'host',sideEffect:'local_write',requiredScopes:['responsibility:lifecycle:write'],
    inputSchema:F01_LIFECYCLE_SCHEMA,outputSchema:{type:'object',additionalProperties:false,required:['state','revision'],
      properties:{state:{const:'recorded'},revision:{type:'integer',minimum:1}}},
    async execute(input,context:ToolContext){
      if(context.runId!=='host-tool-'+context.taskId||context.authorizationRef!==context.runId)return denied();
      const original=readF01LifecycleInvocation(options.getApplication(),context.taskId,context,'execute');
      if(!isDeepStrictEqual(input,original.selection))return denied();
      const result=await options.commit(original,context);
      try{authority.assertCurrent(original.selection.target,original.command,original.source,context);}
      catch{throw new ProtocolError('RESULT_UNKNOWN','Original F01 lifecycle requires readback');}return result;
    }});
  return {tools:[tool],authority,
    async readOriginalOperation(localTaskId:string,scope:Lifetime){
      const original=readF01LifecycleInvocation(options.getApplication(),localTaskId,scope,'readback');
      const result=await options.readOperation(original,scope);
      if(!isDeepStrictEqual(original,readF01LifecycleInvocation(options.getApplication(),localTaskId,scope,'readback')))return denied();
      return result;
    }};
}
