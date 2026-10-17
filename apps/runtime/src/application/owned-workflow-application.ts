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
    host:{submitHostToolTask:request=>application.submitHostToolTask(request),
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
