/**
 * Optional IMAGE28 graph hosts that Desktop can register only when trusted ports exist.
 * Missing providers stay absent; never Fake success.
 */
export function createDesktopWorkflowGraphComposition({
  runtimeModule,getApplication,feedsHost,todoHost,mailHost,notificationApplicationHost,systemObserveTool,
  now=()=>new Date(),
}={}) {
  if(!runtimeModule||typeof getApplication!=='function')
    return {tools:[],unavailable:['composition_ports_unavailable'],f09WorkerPorts:undefined};
  const unavailable=[],tools=[];
  const assertCurrent=()=>{};

  if(mailHost?.tools?.length&&typeof runtimeModule.createRuntimeF08OperationScopeHost==='function'){
    const host=runtimeModule.createRuntimeF08OperationScopeHost({
      getApplication,requiredScopes:['mail:read'],assertCurrent,now,
      verifyOperationScope:async(_scope,context,input)=>{
        if(!context.authorizationRef||typeof input.toolName!=='string'||!input.toolName.startsWith('mail.'))
          return {ready:false,blockingReason:'mail_authorization_unavailable'};
        const names=new Set((mailHost.tools??[]).map(tool=>tool.descriptor?.name).filter(Boolean));
        if(!names.has(input.toolName))
          return {ready:false,blockingReason:'mail_tool_unregistered'};
        return {ready:true};
      },
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
  if(systemObserveTool?.descriptor?.name===observeName&&typeof runtimeModule.createRuntimeF13SystemProbeHost==='function'){
    const probe=runtimeModule.createRuntimeF13SystemProbeHost({
      getApplication,systemObserve:systemObserveTool,
      requiredScopes:[...(systemObserveTool.descriptor.requiredScopes??[])],
      invokeSystemObserve:async context=>systemObserveTool.execute({},context),
      // Local CPU/memory never proves cloud/quota/lock; refuse those checks explicitly.
      resolveProbeOutcome:async(_scope,checks)=>{
        if(checks.some(name=>/cloud|quota|lock/i.test(name))) {
          const error=new Error('F13 cloud/quota/lock probe is unavailable');
          error.code='UNSUPPORTED_CAPABILITY';
          throw error;
        }
        return {cloudAlive:false,quotaNormal:false,staleLockFound:false};
      },
      assertCurrent,now,
    });
    if(probe.tools?.length)tools.push(...probe.tools);else if(probe.unavailable)unavailable.push(probe.unavailable);
  }else unavailable.push('f13_system_probe_observation_unavailable');

  void todoHost;void feedsHost;
  return {tools,unavailable,f09WorkerPorts:undefined};
}
