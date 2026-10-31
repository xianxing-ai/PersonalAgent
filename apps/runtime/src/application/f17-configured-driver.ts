import type {RuntimeApplication} from './runtime-application.js';
import {sourceFailure} from './f16-source-receipts.js';
import {readConfiguredWorkflowBinding} from './configured-workflow-worker.js';
import type {OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

/** Read the public immutable binding. Checkpoint namespaces belong to the worker. */
export function createF17ConfiguredDriverResolver(application:Pick<RuntimeApplication,'readConfiguredWorkflowBinding'>,
  expected:{configurationVersion:string}) {
  return (scope:OwnedWorkflowHostScope)=>{
    const binding=readConfiguredWorkflowBinding(application,{taskId:scope.parentTaskId,workflowId:'F17',
      sessionId:scope.sessionId,signal:scope.signal});
    if(!binding||binding.deadline!==scope.deadline||binding.sessionId!==scope.sessionId
      ||binding.configurationVersion!==expected.configurationVersion)sourceFailure('Original configured F17 driver unavailable');
    return binding;
  };
}
