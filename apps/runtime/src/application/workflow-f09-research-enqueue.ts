import {createHash} from 'node:crypto';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {TaskRuntime} from '../index.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

const key='f09:research-launch:v1';
const textSchema={type:'string',minLength:1,maxLength:256};
type Signal={sourceOperationId:string;signalId:string};

export interface F09ResearchLaunch extends Signal {
  workflowId:'F10';
  inputRef:string;
  parentTaskId:string;
  sessionId:string;
  operationId:string;
  deadline:string;
}

export interface F09ResearchEnqueueOptions {
  getRuntime:()=>TaskRuntime;
  /** Checks the original source lease, graph frontier, and availability of the F10 consumer. */
  assertCurrent:(scope:OwnedWorkflowHostScope)=>void;
  /** Reads the selected signal from confirmed F09 receipts and resolves the configured F10 input. */
  resolveLaunch:(scope:OwnedWorkflowHostScope)=>(Signal & {inputRef:string})|undefined;
}

/** Registers only when the trusted F09 and F10 composition ports are available. */
export function createRuntimeF09ResearchEnqueue(options?:F09ResearchEnqueueOptions) {
  if(typeof options?.getRuntime!=='function'||typeof options.assertCurrent!=='function'||typeof options.resolveLaunch!=='function')return [];
  return [createOwnedWorkflowAdapter({
    nodeId:'F09_N04',kind:'host',sideEffect:'local_write',requiredScopes:['runtime:enqueue_research'],
    inputSchema:{type:'object',additionalProperties:false,required:['signalPayload'],properties:{
      signalPayload:{type:'object',additionalProperties:false,required:['sourceOperationId','signalId'],
        properties:{sourceOperationId:textSchema,signalId:textSchema}},
    }},
    outputSchema:{type:'object',additionalProperties:false,required:['researchTaskSpawned'],properties:{
      researchTaskSpawned:{type:'object',additionalProperties:false,required:['taskId','state'],
        properties:{taskId:textSchema,state:{type:'string',enum:['accepted']}}},
    }},
    async execute(input,context) {
      const {signalPayload}=input as {signalPayload:Signal};
      const runtime=options.getRuntime();
      const assertCurrent=()=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F09',nodeId:'F09_N04',
        hostToolName:'workflow.host.f09_n04',proposalArguments:input,assertCurrent:options.assertCurrent});
      const original=options.resolveLaunch(assertCurrent());
      if(!original)failOwnedHost('UNSUPPORTED_CAPABILITY','Original F09 signal or F10 input unavailable');
      if(original.sourceOperationId!==signalPayload.sourceOperationId||original.signalId!==signalPayload.signalId)
        failOwnedHost('UNAUTHORIZED','F09 research signal differs from the original selection');
      if(typeof original.inputRef!=='string'||!original.inputRef.trim()||original.inputRef.length>256)
        failOwnedHost('UNSUPPORTED_CAPABILITY','F10 input reference unavailable');
      const scope=assertCurrent();
      const launch:F09ResearchLaunch={workflowId:'F10',inputRef:original.inputRef,sourceOperationId:original.sourceOperationId,
        signalId:original.signalId,parentTaskId:scope.parentTaskId,sessionId:scope.sessionId,
        operationId:scope.operationId,deadline:scope.deadline};
      const digest=createHash('sha256').update(JSON.stringify([launch.parentTaskId,launch.sessionId])).digest('hex');
      const parent=runtime.getTask(scope.parentTaskId);
      if(!parent.conversationId)failOwnedHost('UNAUTHORIZED','Original F09 conversation unavailable');
      const task=runtime.submitTaskWithCheckpoint({goal:'F10 深度研究',conversationId:parent.conversationId,
        idempotencyKey:'f09-research:'+digest},key,launch);
      return {researchTaskSpawned:{taskId:task.taskId,state:'accepted'}};
    },
  })];
}

export function readF09ResearchLaunch(runtime:TaskRuntime,taskId:string):F09ResearchLaunch|undefined {
  return runtime.loadCheckpoint(taskId,key) as F09ResearchLaunch|undefined;
}
