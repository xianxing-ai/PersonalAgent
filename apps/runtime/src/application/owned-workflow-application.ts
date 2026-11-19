import {ProtocolError} from '@personal-agent/contracts';
import {OwnedWorkflowHostBridge,createWorkflowShadowReleaseService,createWorkflowShadowReleaseAdapter,
  createWorkflowShadowReleaseReadbackAdapter,createVoiceFinalTranscriptService,createVoiceFinalTranscriptAdapter}
  from '@personal-agent/agentarts';
import type {RegisteredTool} from '@personal-agent/contracts';
import type {VoiceFinalTranscriptPort,WorkflowShadowHostPolicy} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';

export type RuntimeWorkflowShadowReleaseOptions=Parameters<typeof createWorkflowShadowReleaseService>[0]
  & {sideEffect:'local_write'|'external_write'};

export type RuntimeVoiceFinalTranscriptOptions={
  port:VoiceFinalTranscriptPort;
  requiredScopes?:readonly string[];
  now?:()=>number;
};

/** Host adapters enter ToolGateway only when their trusted ports are injected. Missing ports stay unregistered. */
export function createRuntimeOwnedWorkflowTools(options:{
  shadowRelease?:RuntimeWorkflowShadowReleaseOptions;
  voiceFinalTranscript?:RuntimeVoiceFinalTranscriptOptions;
}):RegisteredTool[] {
  const tools:RegisteredTool[]=[];
  if(options.shadowRelease) {
    const {sideEffect,...configuration}=options.shadowRelease;
    const service=createWorkflowShadowReleaseService(configuration);
    tools.push(createWorkflowShadowReleaseAdapter(service,{sideEffect}),createWorkflowShadowReleaseReadbackAdapter(service));
  }
  if(options.voiceFinalTranscript?.port&&typeof options.voiceFinalTranscript.port.readFinal==='function') {
    tools.push(createVoiceFinalTranscriptAdapter(createVoiceFinalTranscriptService(options.voiceFinalTranscript)));
  }
  return tools;
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
  /** F20_N03's public recipe operation executes the same recipe in the bound candidate trial. */
  mapOperation?:(request:OwnedWorkflowHostRequest)=>OwnedWorkflowHostRequest;
}
type OwnedWorkflowHostRequest=Parameters<ConstructorParameters<typeof OwnedWorkflowHostBridge>[0]['host']['submitHostToolTask']>[0];
type OwnedWorkflowOperationBinding={localTaskId:string;request:OwnedWorkflowHostRequest;mappedRequest?:OwnedWorkflowHostRequest};

/** Existing Runtime application composition; no second scheduler, execution loop or task store. */
export function createRuntimeOwnedWorkflowHost(application:RuntimeApplication,
  options:RuntimeOwnedWorkflowHostOptions):OwnedWorkflowHostBridge {
  if(!application?.runtime||typeof options?.assertActive!=='function')
    throw new ProtocolError('INVALID_ARGUMENT','Original Runtime application and trusted controller are required');
  return new OwnedWorkflowHostBridge({receiptSecret:options.receiptSecret,
    host:{submitHostToolTask:request=>{
      if(!options.parentTaskId)return application.submitHostToolTask(request);
      const originalKey='coding-repair:host:'+request.commandId;
      const operation=options.mapOperation?.(request)??request;
      if(operation.commandId!==request.commandId||operation.deadline!==request.deadline)
        throw new ProtocolError('REVISION_CONFLICT','Original graph operation identity changed');
      const mappedRequest=operation===request?undefined:structuredClone(operation);
      const original=application.runtime.loadCheckpoint(options.parentTaskId,originalKey) as OwnedWorkflowOperationBinding|undefined;
      if(original) {
        if(JSON.stringify(original.request)!==JSON.stringify(request)||JSON.stringify(original.mappedRequest)!==JSON.stringify(mappedRequest))
          throw new ProtocolError('REVISION_CONFLICT','Original graph host intent changed');
        const readback=application.readHostToolTask(original.localTaskId);
        if(readback.task.state!=='created')return readback;
        return application.finalizeHostToolTask({taskId:original.localTaskId,commandId:operation.commandId,
          arguments:operation.arguments,expectedTaskRevision:readback.task.revision});
      }
      const prepared=application.prepareHostToolTask({commandId:operation.commandId,toolName:operation.toolName,
        toolVersion:operation.toolVersion,deadline:operation.deadline});
      const binding={taskId:options.parentTaskId,operationId:request.commandId};
      const previous=application.runtime.loadCheckpoint(prepared.taskId,'coding-repair:parent');
      if(previous!==undefined&&JSON.stringify(previous)!==JSON.stringify(binding))
        throw new ProtocolError('REVISION_CONFLICT','Original graph host child changed');
      application.runtime.saveCheckpointOnce(prepared.taskId,'coding-repair:parent',binding);
      application.runtime.saveCheckpointOnce(options.parentTaskId,originalKey,
        {localTaskId:prepared.taskId,request:structuredClone(request),...(mappedRequest?{mappedRequest}:{})});
      return application.finalizeHostToolTask({taskId:prepared.taskId,commandId:operation.commandId,
        arguments:operation.arguments,expectedTaskRevision:prepared.revision});
    },
      readHostToolTask:id=>{
        const readback=application.readHostToolTask(id);
        if(!options.parentTaskId||!options.mapOperation)return readback;
        const original=application.runtime.loadCheckpoint(options.parentTaskId,'coding-repair:host:'+readback.commandId) as OwnedWorkflowOperationBinding|undefined;
        if(!original?.mappedRequest)return readback;
        const mapped=original.mappedRequest;
        if(original.localTaskId!==id||readback.commandId!==mapped.commandId
          ||readback.toolName!==mapped.toolName||readback.toolVersion!==mapped.toolVersion)
          throw new ProtocolError('UNAUTHORIZED','Mapped graph readback does not match its actual execution');
        return {...readback,toolName:original.request.toolName,toolVersion:original.request.toolVersion};
      }},
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
