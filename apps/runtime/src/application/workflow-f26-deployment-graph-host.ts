import {isDeepStrictEqual} from 'node:util';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
const text=(v:unknown,max=256):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;

/** F26_N03 platform deployment runtime readback; absent without a trusted platform port. */
export function createRuntimeF26DeploymentReadbackHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  requiredScopes:readonly string[];
  now:()=>Date;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  readDeploymentRuntime:(scope:Scope)=>Promise<{podRunning:boolean;readinessProbe:boolean}>;
  authorizeExport:(scope:Scope,result:{podRunning:boolean;readinessProbe:boolean})=>Promise<boolean>;
}):{tools:RegisteredTool[];unavailable:string|null} {
  if(!options?.application?.runtime||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||!options.requiredScopes.every(v=>text(v))||typeof options.assertCurrent!=='function'
    ||typeof options.readDeploymentRuntime!=='function'||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f26_deployment_readback_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F26',nodeId:'F26_N03',
    hostToolName:'workflow.host.f26_n03',assertCurrent:options.assertCurrent,now:options.now});
  const read=async(scope:Scope,context:ToolContext)=>{
    let runtimeReadback:Awaited<ReturnType<NonNullable<typeof options>['readDeploymentRuntime']>>;
    try {runtimeReadback=await options.readDeploymentRuntime(scope);}catch{return failOwnedHost('UNSUPPORTED_CAPABILITY','F26 deployment readback unavailable');}
    active(context);
    if(!runtimeReadback||typeof runtimeReadback.podRunning!=='boolean'||typeof runtimeReadback.readinessProbe!=='boolean')
      failOwnedHost('UNSUPPORTED_CAPABILITY','F26 deployment readback unavailable');
    return {podRunning:runtimeReadback.podRunning,readinessProbe:runtimeReadback.readinessProbe};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F26_N03',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['podRunning','readinessProbe'],
      properties:{podRunning:{type:'boolean'},readinessProbe:{type:'boolean'}}},
    async execute(_input,context){
      const scope=active(context),result=await read(scope,context);active(context);
      if(await options.authorizeExport(scope,structuredClone(result))!==true)failOwnedHost('UNAUTHORIZED','F26 deployment readback export denied');
      active(context);if(!isDeepStrictEqual(result,await read(scope,context)))failOwnedHost('REVISION_CONFLICT','F26 deployment readback changed');
      return result;
    }});
  return {tools:[tool],unavailable:null};
}
