/**
 * Optional IMAGE28 graph hosts that Desktop can register only when trusted ports exist.
 * Missing providers stay absent; never Fake success.
 */
export function createDesktopWorkflowGraphComposition({
  runtimeModule,getApplication,feedsHost,todoHost,mailHost,notificationApplicationHost,systemObserveTool,
  verifyMailOperationScope,invokeSystemObserve,resolveSystemProbeOutcome,
  now=()=>new Date(),
}={}) {
  if(!runtimeModule||typeof getApplication!=='function')
    return {tools:[],unavailable:['composition_ports_unavailable'],f09WorkerPorts:undefined};
  const unavailable=[],tools=[];
  const assertCurrent=scope=>{
    const runtime=getApplication()?.runtime;
    if(!runtime)throw Error('Workflow Runtime unavailable');
    for(const id of [scope.parentTaskId,scope.localTaskId]){
      const task=runtime.getTask(id);
      if(task.cancelRequested||!['running','waiting_approval'].includes(task.state))
        throw Error('Original workflow task is no longer current');
    }
  };

  if(mailHost?.tools?.length&&typeof verifyMailOperationScope==='function'
    &&typeof runtimeModule.createRuntimeF08OperationScopeHost==='function'){
    const host=runtimeModule.createRuntimeF08OperationScopeHost({
      getApplication,requiredScopes:['mail:read'],assertCurrent,now,
      verifyOperationScope:verifyMailOperationScope,
    });
    if(host.tools?.length)tools.push(...host.tools);else if(host.unavailable)unavailable.push(host.unavailable);
  }else unavailable.push('f08_operation_scope_mail_host_unavailable');

  if(notificationApplicationHost&&typeof runtimeModule.createRuntimeF12QuietHoursHost==='function'){
    const quiet=runtimeModule.createRuntimeF12QuietHoursHost({
      getApplication,requiredScopes:['notifications:read'],
      notificationHost:notificationApplicationHost,
      resolveScope:()=>({kind:'connector',connectorId:'productivity'}),
      assertCurrent,now,
    });
    if(quiet.tools?.length)tools.push(...quiet.tools);else if(quiet.unavailable)unavailable.push(quiet.unavailable);
  }else unavailable.push('f12_quiet_hours_notification_host_unavailable');

  const observeName=runtimeModule.SYSTEM_OBSERVATION_TOOL_NAME??'computer.system.observe';
  if(systemObserveTool?.descriptor?.name===observeName&&typeof invokeSystemObserve==='function'
    &&typeof resolveSystemProbeOutcome==='function'&&typeof runtimeModule.createRuntimeF13SystemProbeHost==='function'){
    const probe=runtimeModule.createRuntimeF13SystemProbeHost({
      getApplication,systemObserve:systemObserveTool,
      requiredScopes:[...(systemObserveTool.descriptor.requiredScopes??[])],
      invokeSystemObserve,
      resolveProbeOutcome:resolveSystemProbeOutcome,
      assertCurrent,now,
    });
    if(probe.tools?.length)tools.push(...probe.tools);else if(probe.unavailable)unavailable.push(probe.unavailable);
  }else unavailable.push('f13_system_probe_observation_unavailable');

  void todoHost;void feedsHost;
  return {tools,unavailable,f09WorkerPorts:undefined};
}
