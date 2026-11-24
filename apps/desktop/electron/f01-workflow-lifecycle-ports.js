import {createRuntimeF01LifecycleHost} from '@personal-agent/runtime/application';

/** The existing proactive session owns persistence; this factory owns no state. */
export function createF01WorkflowLifecyclePorts({getApplication,getProactiveHost}={}) {
  if(typeof getApplication!=='function'||typeof getProactiveHost!=='function')
    return {tools:[],unavailable:'f01_original_responsibility_host_unavailable'};
  const host=()=>{const value=getProactiveHost();
    if(typeof value?.recordResponsibilityLifecycle!=='function'||typeof value?.readResponsibilityLifecycleOperation!=='function')
      throw Error('原责任生命周期宿主不可用');return value;};
  const runtime=createRuntimeF01LifecycleHost({getApplication,
    commit:(original,scope)=>host().recordResponsibilityLifecycle(original.selection.target,original.command,scope),
    readOperation:(original,scope)=>host().readResponsibilityLifecycleOperation(original.selection.target,original.command,scope)});
  return {...runtime,unavailable:null};
}
