/**
 * Trusted Desktop ports for F14_N01 observation host (Owner/zemeng capability surface).
 * Lab wires createRuntimeF14ObservationHost into conversationTools when these ports are ready.
 * Does not Fake observe; invokeObservation must submit browser.observe via Runtime Policy.
 */
export function createF14ObservationGraphPorts({
  getApplication,browserObserveTool,computerControlLease,authorizeExport,now=()=>new Date(),
}={}) {
  if(typeof getApplication!=='function'
    ||browserObserveTool?.descriptor?.name!=='browser.observe'
    ||browserObserveTool.descriptor.version!=='1.0.0'
    ||browserObserveTool.descriptor.sideEffect!=='read'
    ||typeof authorizeExport!=='function')
    return {unavailable:'f14_observation_desktop_ports_unavailable',ports:undefined};

  const assertCurrent=(scope)=>{
    const application=getApplication();
    if(!application?.runtime)throw Error('F14 Runtime unavailable');
    const task=application.runtime.getTask(scope.localTaskId??scope.taskId);
    if(task.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(task.state))
      throw Error('F14 original task is no longer current');
    if(computerControlLease&&typeof computerControlLease.assertWritable==='function')
      computerControlLease.assertWritable(scope.localTaskId??scope.taskId);
  };

  /** Caller must enqueue browser.observe as an original HostTool task; this only reads binding identity. */
  const invokeObservation=async(scope,_context)=>{
    assertCurrent(scope);
    const application=getApplication();
    const binding=application.runtime.loadCheckpoint(scope.localTaskId,'f14:pending-observation');
    if(!binding||typeof binding.localTaskId!=='string'||typeof binding.operationId!=='string')
      throw Object.assign(Error('F14 original browser observation unavailable'),{code:'UNSUPPORTED_CAPABILITY'});
    return {localTaskId:binding.localTaskId,operationId:binding.operationId};
  };

  return {
    unavailable:null,
    ports:{
      browserObserve:browserObserveTool,
      invokeObservation,
      assertCurrent,
      authorizeExport:async(scope,result)=>authorizeExport({scope,result,now:now()})===true,
      now,
    },
  };
}
