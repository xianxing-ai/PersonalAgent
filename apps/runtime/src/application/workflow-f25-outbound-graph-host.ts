import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
const CREDENTIAL=/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9_.-]{16,}|\bsk-[A-Za-z0-9_-]{16,})/u;

/** F25_N03: reuses the same outbound credential scan used by trusted export hosts. */
export function createRuntimeF25OutboundContextHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  requiredScopes:readonly string[];
  /** Optional extra host secrets to reject in outbound payloads. */
  containsCredential?:(serialized:string)=>boolean;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{filteredOut:string[];cleanPayloadReady:boolean})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.assertCurrent!=='function'||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f25_outbound_context_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext,args?:unknown)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F25',nodeId:'F25_N03',
    hostToolName:'workflow.host.f25_n03',proposalArguments:args??(runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {arguments?:unknown})?.arguments,
    assertCurrent:options.assertCurrent,now:options.now});
  const inspect=(scope:Scope,context:ToolContext,input:{testPayloadContainsPrivate?:boolean})=>{
    const filteredOut:string[]=[];
    if(input.testPayloadContainsPrivate===true)filteredOut.push('private_marker');
    const serialized=JSON.stringify(input);
    if(CREDENTIAL.test(serialized)||options.containsCredential?.(serialized)===true)filteredOut.push('credential_pattern');
    return {filteredOut,cleanPayloadReady:filteredOut.length===0};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F25_N03',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{testPayloadContainsPrivate:{type:'boolean'}}},
    outputSchema:{type:'object',additionalProperties:false,required:['filteredOut','cleanPayloadReady'],properties:{
      filteredOut:{type:'array',items:{type:'string'}},cleanPayloadReady:{type:'boolean'}}},
    async execute(input,context){return inspect(active(context,input),context,input as {testPayloadContainsPrivate?:boolean});}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context);
    if(!result||typeof result!=='object'||!Array.isArray((result as {filteredOut?:unknown}).filteredOut)
      ||typeof (result as {cleanPayloadReady?:unknown}).cleanPayloadReady!=='boolean')failOwnedHost('UNAUTHORIZED','F25 outbound receipt unavailable');
    if(await options.authorizeExport(scope,structuredClone(result) as {filteredOut:string[];cleanPayloadReady:boolean})!==true)
      failOwnedHost('UNAUTHORIZED','F25 outbound export denied');
  }};
}
