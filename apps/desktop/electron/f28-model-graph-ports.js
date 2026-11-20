/**
 * Trusted Desktop ports for F28 native config host/guard (Owner/zemeng ModelGateway surface).
 * Lab injects createRuntimeF28NativeConfigHost when ModelGateway declarations are readable.
 */
export function createF28ModelGraphPorts({getApplication,modelApiHost,authorizeExport,resolveOriginalDispatchState,now=()=>new Date()}={}) {
  if(typeof getApplication!=='function'||typeof modelApiHost?.readHarnessConfiguration!=='function'
    ||typeof authorizeExport!=='function')
    return {unavailable:'f28_native_config_desktop_ports_unavailable',ports:undefined};

  const assertCurrent=scope=>{
    const application=getApplication();
    if(!application?.runtime)throw Error('F28 Runtime unavailable');
    const task=application.runtime.getTask(scope.parentTaskId??scope.taskId);
    if(task.cancelRequested||!['running','waiting_approval'].includes(task.state))
      throw Error('F28 original task is no longer current');
    if(scope.localTaskId){
      const local=application.runtime.getTask(scope.localTaskId);
      if(local.cancelRequested||!['running','waiting_approval','succeeded'].includes(local.state))
        throw Error('F28 original host is no longer current');
    }
  };

  const readNativeConfig=async(scope,input)=>{
    assertCurrent(scope);
    const config=modelApiHost.readHarnessConfiguration();
    if(!config||typeof config!=='object')
      throw Object.assign(Error('F28 native configuration unavailable'),{code:'UNSUPPORTED_CAPABILITY'});
    const roles=config.nativeRoles??config.roles;
    // Without an explicit native declaration, refuse to invent support from budgets/thinking flags.
    if(!roles||typeof roles.research!=='boolean'||typeof roles.analysis!=='boolean'||typeof roles.coder!=='boolean')
      throw Object.assign(Error('F28 native role declaration unavailable'),{code:'UNSUPPORTED_CAPABILITY'});
    return {check:input.check,research:roles.research,analysis:roles.analysis,coder:roles.coder};
  };

  const resolveGuardState=async(scope,input)=>{
    assertCurrent(scope);
    // Native model support does not establish the original F28 dispatch condition.
    if(typeof resolveOriginalDispatchState!=='function')return 'unknown';
    const state=await resolveOriginalDispatchState(scope,input);
    assertCurrent(scope);
    return ['selected','skipped','unknown'].includes(state)?state:'unknown';
  };

  return {
    unavailable:null,
    ports:{
      readNativeConfig,
      resolveGuardState,
      assertCurrent,
      authorizeExport:async(scope,result)=>{
        assertCurrent(scope);
        const allowed=await authorizeExport({scope,result,now:now()});
        assertCurrent(scope);
        return allowed===true;
      },
      now,
    },
  };
}
