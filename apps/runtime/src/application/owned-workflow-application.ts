import {ProtocolError} from '@personal-agent/contracts';
import {OwnedWorkflowHostBridge,createWorkflowShadowReleaseService,createWorkflowShadowReleaseAdapter,
  createWorkflowShadowReleaseReadbackAdapter} from '@personal-agent/agentarts';
import type {RegisteredTool} from '@personal-agent/contracts';
import type {WorkflowShadowHostPolicy} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';

export type RuntimeWorkflowShadowReleaseOptions=Parameters<typeof createWorkflowShadowReleaseService>[0]
  & {sideEffect:'local_write'|'external_write'};

/** Both steps enter the existing ToolGateway. Missing ports remain unavailable in the service. */
export function createRuntimeOwnedWorkflowTools(options:{shadowRelease?:RuntimeWorkflowShadowReleaseOptions}):RegisteredTool[] {
  if(!options.shadowRelease)return [];
  const {sideEffect,...configuration}=options.shadowRelease;
  const service=createWorkflowShadowReleaseService(configuration);
  return [createWorkflowShadowReleaseAdapter(service,{sideEffect}),createWorkflowShadowReleaseReadbackAdapter(service)];
}

export interface RuntimeOwnedWorkflowHostOptions {
  receiptSecret:string;
  /** Original graph task, bound before a host child can start executing. */
  parentTaskId?:string;
  /** Trusted controller checks its current task/session revision. This is not a Policy grant. */
  assertActive:(taskId:string,controlRevision:number)=>void;
  assertIsolation?:(taskId:string,isolation:{namespace:string;snapshotDigest:string})=>void;
  shadow?:WorkflowShadowHostPolicy;
  canRetryReadFailure?:NonNullable<ConstructorParameters<typeof OwnedWorkflowHostBridge>[0]['canRetryReadFailure']>;
}

/** Existing Runtime application composition; no second scheduler, execution loop or task store. */
export function createRuntimeOwnedWorkflowHost(application:RuntimeApplication,
  options:RuntimeOwnedWorkflowHostOptions):OwnedWorkflowHostBridge {
  if(!application?.runtime||typeof options?.assertActive!=='function')
    throw new ProtocolError('INVALID_ARGUMENT','Original Runtime application and trusted controller are required');
  return new OwnedWorkflowHostBridge({receiptSecret:options.receiptSecret,
    host:{submitHostToolTask:request=>{
      if(!options.parentTaskId)return application.submitHostToolTask(request);
      const originalKey='coding-repair:host:'+request.commandId;
      const original=application.runtime.loadCheckpoint(options.parentTaskId,originalKey) as {localTaskId:string;request:typeof request}|undefined;
      if(original) {
        if(JSON.stringify(original.request)!==JSON.stringify(request))throw new ProtocolError('REVISION_CONFLICT','Original graph host intent changed');
        const readback=application.readHostToolTask(original.localTaskId);
        if(readback.task.state!=='created')return readback;
        return application.finalizeHostToolTask({taskId:original.localTaskId,commandId:request.commandId,
          arguments:request.arguments,expectedTaskRevision:readback.task.revision});
      }
      const prepared=application.prepareHostToolTask({commandId:request.commandId,toolName:request.toolName,
        toolVersion:request.toolVersion,deadline:request.deadline});
      const binding={taskId:options.parentTaskId,operationId:request.commandId};
      const previous=application.runtime.loadCheckpoint(prepared.taskId,'coding-repair:parent');
      if(previous!==undefined&&JSON.stringify(previous)!==JSON.stringify(binding))
        throw new ProtocolError('REVISION_CONFLICT','Original graph host child changed');
      application.runtime.saveCheckpointOnce(prepared.taskId,'coding-repair:parent',binding);
      application.runtime.saveCheckpointOnce(options.parentTaskId,originalKey,{localTaskId:prepared.taskId,request:structuredClone(request)});
      return application.finalizeHostToolTask({taskId:prepared.taskId,commandId:request.commandId,
        arguments:request.arguments,expectedTaskRevision:prepared.revision});
    },
      readHostToolTask:id=>application.readHostToolTask(id)},
    checkpoints:{read:(id,key)=>application.runtime.loadCheckpoint(id,key),
      writeOnce:(id,key,value)=>application.runtime.saveCheckpointOnce(id,key,value)},
    assertActive:(id,revision)=>{
      const task=application.runtime.getTask(id);
      if(task.cancelRequested||task.state==='cancelled')
        throw new ProtocolError('CANCELLED','Original workflow task was cancelled');
      if(['succeeded','failed'].includes(task.state))
        throw new ProtocolError('REVISION_CONFLICT','Original workflow task is terminal');
      options.assertActive(id,revision);
    },
    ...(options.assertIsolation?{assertIsolation:options.assertIsolation}:{}),
    ...(options.shadow?{shadow:options.shadow}:{}),
    ...(options.canRetryReadFailure?{canRetryReadFailure:options.canRetryReadFailure}:{})});
}
