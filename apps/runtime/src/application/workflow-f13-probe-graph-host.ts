import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import {SYSTEM_OBSERVATION_TOOL_NAME} from '@personal-agent/windows-client';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;

/** F13_N02: runs the registered local probe, then asks a trusted resolver for graph fields. */
export function createRuntimeF13SystemProbeHost(options?:{
  application?:Pick<RuntimeApplication,'runtime'>;
  getApplication?:()=>Pick<RuntimeApplication,'runtime'>|undefined;
  systemObserve:RegisteredTool;
  /** Invoke the observation via the original Runtime Policy/ToolGateway. */
  invokeSystemObserve:(context:ToolContext)=>Promise<unknown>;
  requiredScopes:readonly string[];
  /** Must reject cloud/quota/lock checks that are not actually registered. */
  resolveProbeOutcome:(scope:Scope,checks:readonly string[],localObservation:unknown)=>Promise<{cloudAlive:boolean;quotaNormal:boolean;staleLockFound:boolean}>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  now:()=>Date;
}):{tools:RegisteredTool[];unavailable:string|null} {
  if((!options?.application?.runtime&&typeof options?.getApplication!=='function')
    ||options.systemObserve?.descriptor?.name!==SYSTEM_OBSERVATION_TOOL_NAME
    ||typeof options.invokeSystemObserve!=='function'||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.resolveProbeOutcome!=='function'||typeof options.assertCurrent!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f13_system_probe_trusted_ports_unavailable'};
  const requiredScopes=[...options.requiredScopes],observe=options.systemObserve;
  const active=(context:ToolContext,args:unknown)=>{
    const runtime=options.getApplication?.()?.runtime??options.application?.runtime;
    if(!runtime)failOwnedHost('UNSUPPORTED_CAPABILITY','F13 probe Runtime unavailable');
    return assertOwnedWorkflowHostScope({runtime,context,workflowId:'F13',nodeId:'F13_N02',
      hostToolName:'workflow.host.f13_n02',proposalArguments:args,assertCurrent:options.assertCurrent,now:options.now});
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F13_N02',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{checks:{type:'array',items:{type:'string'}}}},
    outputSchema:{type:'object',additionalProperties:false,required:['cloudAlive','quotaNormal','staleLockFound'],properties:{
      cloudAlive:{type:'boolean'},quotaNormal:{type:'boolean'},staleLockFound:{type:'boolean'}}},
    async execute(input,context){
      const scope=active(context,input),checks=Array.isArray((input as {checks?:unknown}).checks)?(input as {checks:string[]}).checks:[];
      if(checks.some(name=>!text(name)))failOwnedHost('INVALID_ARGUMENT','F13 probe checks invalid');
      if(!requiredScopes.every(item=>context.scopes.includes(item))||!observe.descriptor.requiredScopes.every(item=>context.scopes.includes(item)))
        failOwnedHost('SCOPE_DENIED','F13 system observation scope required');
      const observation=await options.invokeSystemObserve(context);
      active(context,input);
      const outcome=await options.resolveProbeOutcome(scope,checks,observation);active(context,input);
      if(!outcome||typeof outcome.cloudAlive!=='boolean'||typeof outcome.quotaNormal!=='boolean'||typeof outcome.staleLockFound!=='boolean')
        failOwnedHost('UNSUPPORTED_CAPABILITY','F13 probe outcome unavailable');
      return outcome;
    }});
  return {tools:[tool],unavailable:null};
}
