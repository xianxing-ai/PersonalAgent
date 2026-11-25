import {isDeepStrictEqual} from 'node:util';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max=2048):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;

/** F22_N01 versioned shadow snapshot. CPU/system observation is not a shadow substitute. */
export function createRuntimeF22ShadowObservationHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  requiredScopes:readonly string[];
  now:()=>Date;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  readVersionedSnapshot:(scope:Scope)=>Promise<{frozenComparisonInput:Record<string,unknown>}>;
  authorizeExport:(scope:Scope,result:{frozenComparisonInput:Record<string,unknown>})=>Promise<boolean>;
}):{tools:RegisteredTool[];unavailable:string|null} {
  if(!options?.application?.runtime||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||!options.requiredScopes.every(v=>text(v,256))||typeof options.assertCurrent!=='function'
    ||typeof options.readVersionedSnapshot!=='function'||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f22_shadow_observation_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F22',nodeId:'F22_N01',
    hostToolName:'workflow.host.f22_n01',assertCurrent:options.assertCurrent,now:options.now});
  const read=async(scope:Scope,context:ToolContext)=>{
    let snapshot:Awaited<ReturnType<NonNullable<typeof options>['readVersionedSnapshot']>>;
    try {snapshot=await options.readVersionedSnapshot(scope);}catch{return failOwnedHost('UNSUPPORTED_CAPABILITY','F22 shadow snapshot unavailable');}
    active(context);
    if(!object(snapshot)||!object(snapshot.frozenComparisonInput)||Array.isArray(snapshot.frozenComparisonInput))
      failOwnedHost('UNSUPPORTED_CAPABILITY','F22 shadow snapshot unavailable');
    return {frozenComparisonInput:structuredClone(snapshot.frozenComparisonInput)};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F22_N01',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['frozenComparisonInput'],
      properties:{frozenComparisonInput:{type:'object'}}},
    async execute(_input,context){
      const scope=active(context),result=await read(scope,context);active(context);
      if(await options.authorizeExport(scope,structuredClone(result))!==true)failOwnedHost('UNAUTHORIZED','F22 shadow snapshot export denied');
      active(context);if(!isDeepStrictEqual(result,await read(scope,context)))failOwnedHost('REVISION_CONFLICT','F22 shadow snapshot changed');
      return result;
    }});
  return {tools:[tool],unavailable:null};
}
