import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeF13SystemProbeHost,createRuntimeF13DiagnosticControlHost,createWorkflowBusinessToolBridge} from '@personal-agent/runtime/application';

const fail=(code,message)=>{throw new ProtocolError(code,message);};
const text={type:'string',minLength:1,maxLength:2048};
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const unavailable='f13_cloud_quota_lock_probe_and_confirmed_recovery_unavailable';

/** Wire the existing real local observation through its own Policy child. The
 * current product has no remote quota/health or confirmed resource-recovery
 * provider. Its complete F13 worker remains explicitly unavailable. */
export function createF13WorkflowWorkerPorts({getApplication,systemObserveTool,authorizeExport,now=Date.now}={}) {
  if(typeof getApplication!=='function'||systemObserveTool?.descriptor?.name!=='computer.system.observe'
    ||typeof authorizeExport!=='function')return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f13_system_observation_unavailable'};
  let application,bridge;
  const active=scope=>{
    const app=getApplication(),taskId=scope.parentTaskId??scope.taskId,task=app?.runtime.getTask(taskId);
    if(scope.signal.aborted||task?.cancelRequested)fail('CANCELLED','F13 original graph cancelled');
    if(!Number.isFinite(Date.parse(scope.deadline))||Date.parse(scope.deadline)<=now())fail('TIMEOUT','F13 original graph expired');
    if(!task||!['running','waiting_approval'].includes(task.state)||app.runtime.loadCheckpoint(taskId,'application-deadline')!==scope.deadline)
      fail('UNAUTHORIZED','F13 original graph unavailable');
    return app;
  };
  const child=()=>{
    const app=getApplication();if(app!==application){application=app;bridge=createWorkflowBusinessToolBridge({application:app,
      resolveTool:request=>request.actionKey==='f13.system.observe'&&isDeepStrictEqual(request.input,{})?
        {workflowId:'F13',nodeId:'F13_N02',hostToolName:'workflow.host.f13_n02',toolName:'computer.system.observe',toolVersion:'1.0.0',arguments:{}}:undefined,
      assertCurrent:(scope,context)=>{const app=active(scope),invocation=app.readAuthorizationQuestionInvocation(context.taskId,context.runId),
        grant=app.runtime.policy.get(context.authorizationRef);
        if(!invocation||!grant||grant.taskId!==context.taskId||grant.toolName!==invocation.toolName
          ||grant.argumentsDigest!==invocation.argumentsDigest||Date.parse(grant.expiresAt)<=now())
          fail('UNAUTHORIZED','F13 original exact probe approval is no longer current');},now:()=>new Date(now())});}return bridge;
  };
  const probe=createRuntimeF13SystemProbeHost({getApplication,systemObserve:systemObserveTool,requiredScopes:[...systemObserveTool.descriptor.requiredScopes],
    invokeSystemObserve:async context=>(await child().invoke({actionKey:'f13.system.observe',input:{}},context)).result,
    resolveProbeOutcome:async()=>fail('UNSUPPORTED_CAPABILITY',unavailable),assertCurrent:scope=>{active(scope);},now:()=>new Date(now())});
  const recovery=createRuntimeF13DiagnosticControlHost({getApplication,assertCurrent:scope=>{active(scope);},now:()=>new Date(now()),
    recover:async()=>fail('UNSUPPORTED_CAPABILITY','F13 original host stop and unknown effect have no confirmed recovery provider')});
  const tools=[...probe.tools,...recovery.tools],requestSchema=object({taskId:text,waitTimeSeconds:{type:'integer',minimum:0,maximum:86400}});
  const worker={workflowId:'F13',toolName:'workflow.system.diagnose',toolVersion:'1.0.0',configurationVersion:'desktop-f13-local-only-v1',
    requestSchema,inputSchema:object({...requestSchema.properties,currentNodeId:text,blockReason:text}),
    resultSchema:object({lockReleased:{type:'boolean'},taskResumed:{type:'boolean'}}),publicEnumPaths:[],sideEffect:'local_write',
    requiredTools:[...tools.map(tool=>({name:tool.descriptor.name,version:tool.descriptor.version})),{name:systemObserveTool.descriptor.name,version:systemObserveTool.descriptor.version}],
    available:()=>false,assertCurrent:scope=>{active(scope);},
    async resolveInput(){fail('UNSUPPORTED_CAPABILITY',unavailable);},assertFrontier:()=>false,
    async authorizeExport(input){active(input);const allowed=await authorizeExport({...input,workflowId:'F13'});active(input);return allowed===true;},
    async verifyCompletion(){fail('UNSUPPORTED_CAPABILITY','F13 cannot claim recovery without original provider readback');}};
  return {tools,configuredWorkflowWorkerPorts:[worker],unavailable};
}
