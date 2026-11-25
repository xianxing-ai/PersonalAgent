import {isDeepStrictEqual} from 'node:util';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import type {F01ModelSnapshot} from './workflow-f01-context-host.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;

/** F27_N01: reads the same trusted model capability snapshot as F01, without inventing context maps. */
export function createRuntimeF27ModelCapabilitiesHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  requiredScopes:readonly string[];
  readModels:(scope:Scope)=>Promise<F01ModelSnapshot>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:F01ModelSnapshot)=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.readModels!=='function'||typeof options.assertCurrent!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f27_model_capabilities_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F27',nodeId:'F27_N01',
    hostToolName:'workflow.host.f27_n01',assertCurrent:options.assertCurrent,now:options.now});
  const read=async(scope:Scope,context:ToolContext)=>{const models=await options.readModels(scope);active(context);return models;};
  const tool=createOwnedWorkflowAdapter({nodeId:'F27_N01',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['revision','models'],properties:{revision:{type:'string'},models:{type:'array'}}},
    async execute(_input,context){return read(active(context),context);}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context);
    if(!isDeepStrictEqual(result,await read(scope,context)))failOwnedHost('REVISION_CONFLICT','F27 model capabilities changed before export');
    if(await options.authorizeExport(scope,structuredClone(result) as F01ModelSnapshot)!==true)
      failOwnedHost('UNAUTHORIZED','F27 model capabilities export denied');
  }};
}
