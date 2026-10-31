/**
 * Trusted Desktop ports for F28 native config host/guard (Owner/zemeng ModelGateway surface).
 * Lab injects createRuntimeF28NativeConfigHost when ModelGateway declarations are readable.
 */
export function createF28ModelGraphPorts({getApplication,modelApiHost,authorizeExport,now=()=>new Date()}={}) {
  if(typeof getApplication!=='function'||typeof modelApiHost?.readHarnessConfiguration!=='function'
    ||typeof authorizeExport!=='function')
    return {unavailable:'f28_native_config_desktop_ports_unavailable',ports:undefined};

  const assertCurrent=scope=>{
    const application=getApplication();
    if(!application?.runtime)throw Error('F28 Runtime unavailable');
    const task=application.runtime.getTask(scope.localTaskId??scope.taskId);
    if(task.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(task.state))
      throw Error('F28 original task is no longer current');
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
    try {
      const roles=await readNativeConfig(scope,input);
      if(input.check==='native_roles_declared'&&(roles.research||roles.analysis||roles.coder))return 'selected';
      if(input.check==='native_roles_declared')return 'skipped';
      return 'unknown';
    }catch{return 'unknown';}
  };

  return {
    unavailable:null,
    ports:{
      readNativeConfig,
      resolveGuardState,
      assertCurrent,
      authorizeExport:async(scope,result)=>authorizeExport({scope,result,now:now()})===true,
      now,
    },
  };
}
