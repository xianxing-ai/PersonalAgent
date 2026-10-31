import {isDeepStrictEqual} from 'node:util';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;

export type F28NativeConfigRoles={research:boolean;analysis:boolean;coder:boolean};

/** F28_N03 host: maps trusted ModelGateway/native declarations to role support; no budget-as-thinking. */
export function createRuntimeF28NativeConfigHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  requiredScopes:readonly string[];
  readNativeConfig:(scope:Scope,input:{check:string})=>Promise<F28NativeConfigRoles & {check:string}>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:F28NativeConfigRoles & {check:string})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.readNativeConfig!=='function'||typeof options.assertCurrent!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f28_native_config_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext,args?:unknown)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F28',nodeId:'F28_N03',
    hostToolName:'workflow.host.f28_n03',proposalArguments:args??(runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {arguments?:unknown})?.arguments,
    assertCurrent:options.assertCurrent,now:options.now});
  const read=async(scope:Scope,context:ToolContext,input:{check:string})=>{
    if(!text(input.check))failOwnedHost('INVALID_ARGUMENT','F28 native config check invalid');
    const config=await options.readNativeConfig(scope,input);active(context,input);
    if(!plain(config)||config.check!==input.check||typeof config.research!=='boolean'
      ||typeof config.analysis!=='boolean'||typeof config.coder!=='boolean')
      failOwnedHost('UNSUPPORTED_CAPABILITY','F28 native configuration unavailable');
    return {check:config.check,research:config.research,analysis:config.analysis,coder:config.coder};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F28_N03',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,required:['check'],properties:{check:{type:'string',minLength:1}}},
    outputSchema:{type:'object',additionalProperties:false,required:['check','research','analysis','coder'],properties:{
      check:{type:'string'},research:{type:'boolean'},analysis:{type:'boolean'},coder:{type:'boolean'}}},
    async execute(input,context){return read(active(context,input),context,input as {check:string});}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context);
    if(!isDeepStrictEqual(result,await read(scope,context,{check:(result as {check?:string}).check??''})))
      failOwnedHost('REVISION_CONFLICT','F28 native config changed before export');
    if(await options.authorizeExport(scope,structuredClone(result) as F28NativeConfigRoles & {check:string})!==true)
      failOwnedHost('UNAUTHORIZED','F28 native config export denied');
  }};
}

/** F28_N03 guard: same trusted read, returns selected/skipped/unknown without inventing support. */
export function createRuntimeF28NativeConfigGuard(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  requiredScopes:readonly string[];
  resolveGuardState:(scope:Scope,input:{workflowId:string;nodeId:string;input:unknown;
    predecessorOutputs:Record<string,unknown>;predecessorStates:Record<string,unknown>})=>Promise<'selected'|'skipped'|'unknown'>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  now:()=>Date;
}):{tools:RegisteredTool[];unavailable:string|null} {
  if(!options?.application?.runtime||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.resolveGuardState!=='function'||typeof options.assertCurrent!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f28_native_config_guard_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext,args:unknown)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F28',nodeId:'F28_N03',
    hostToolName:'workflow.guard.f28_n03',proposalArguments:args,assertCurrent:options.assertCurrent,now:options.now});
  const tool=createOwnedWorkflowAdapter({nodeId:'F28_N03',kind:'guard',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,required:['workflowId','nodeId','input','predecessorOutputs','predecessorStates'],properties:{
      workflowId:{const:'F28'},nodeId:{const:'F28_N03'},input:{},predecessorOutputs:{type:'object'},predecessorStates:{type:'object'}}},
    outputSchema:{type:'object',additionalProperties:false,required:['state'],properties:{state:{type:'string',enum:['selected','skipped','unknown']}}},
    async execute(input,context){
      const scope=active(context,input),state=await options.resolveGuardState(scope,input as Parameters<typeof options.resolveGuardState>[1]);active(context,input);
      if(state!=='selected'&&state!=='skipped'&&state!=='unknown')failOwnedHost('UNSUPPORTED_CAPABILITY','F28 native config guard unavailable');
      return {state};
    }});
  return {tools:[tool],unavailable:null};
}
