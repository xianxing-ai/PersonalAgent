import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;

/** F21_N01: projects reference skill / MCP manifest from trusted Runtime composition. */
export function createRuntimeF21SourceManifestHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  readSourceManifest:(scope:Scope)=>Promise<{toolId:string;transport:string;digest?:string;version?:string}>;
  requiredScopes:readonly string[];
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  now:()=>Date;
}):{tools:RegisteredTool[];unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.readSourceManifest!=='function'
    ||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.assertCurrent!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f21_source_manifest_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F21',nodeId:'F21_N01',
    hostToolName:'workflow.host.f21_n01',assertCurrent:options.assertCurrent,now:options.now});
  const tool=createOwnedWorkflowAdapter({nodeId:'F21_N01',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['toolId','transport'],properties:{
      toolId:{type:'string'},transport:{type:'string'},digest:{type:'string'},version:{type:'string'}}},
    async execute(_input,context){
      const scope=active(context),manifest=await options.readSourceManifest(scope);active(context);
      if(!plain(manifest)||!text(manifest.toolId)||!text(manifest.transport))failOwnedHost('UNSUPPORTED_CAPABILITY','F21 source manifest unavailable');
      return {toolId:manifest.toolId,transport:manifest.transport,
        ...(text(manifest.digest)?{digest:manifest.digest}:{}),...(text(manifest.version)?{version:manifest.version}:{})};
    }});
  return {tools:[tool],unavailable:null};
}

/** F21_N03: reads protocol health from trusted skill/MCP host; no synthetic ping success. */
export function createRuntimeF21ProtocolHealthHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  readProtocolHealth:(scope:Scope)=>Promise<{connectionAlive:boolean;latencyMs?:number}>;
  requiredScopes:readonly string[];
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  now:()=>Date;
}):{tools:RegisteredTool[];unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.readProtocolHealth!=='function'
    ||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.assertCurrent!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f21_protocol_health_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F21',nodeId:'F21_N03',
    hostToolName:'workflow.host.f21_n03',assertCurrent:options.assertCurrent,now:options.now});
  const tool=createOwnedWorkflowAdapter({nodeId:'F21_N03',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{ping:{type:'boolean'}}},
    outputSchema:{type:'object',additionalProperties:false,required:['connectionAlive'],properties:{
      connectionAlive:{type:'boolean'},latencyMs:{type:'number'}}},
    async execute(_input,context){
      const scope=active(context),health=await options.readProtocolHealth(scope);active(context);
      if(!plain(health)||typeof health.connectionAlive!=='boolean')failOwnedHost('UNSUPPORTED_CAPABILITY','F21 protocol health unavailable');
      return {connectionAlive:health.connectionAlive,
        ...(Number.isFinite(health.latencyMs)?{latencyMs:health.latencyMs as number}:{})};
    }});
  return {tools:[tool],unavailable:null};
}
