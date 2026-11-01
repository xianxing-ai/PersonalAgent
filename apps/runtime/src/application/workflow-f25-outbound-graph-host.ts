import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
const CREDENTIAL=/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9_.-]{16,}|\bsk-[A-Za-z0-9_-]{16,})/u;

/** F25_N03 scans the original host payload; model-supplied markers cannot attest privacy. */
export function createRuntimeF25OutboundContextHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  requiredScopes:readonly string[];
  /** Optional extra host secrets to reject in outbound payloads. */
  containsCredential?:(serialized:string)=>boolean;
  readOutboundContext:(scope:Scope)=>{sourceId:string;revision:number;dataLevel:'public'|'private'|'sensitive';
    cloudExportAllowed:boolean;payload:unknown};
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{filteredOut:string[];cleanPayloadReady:boolean})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.readOutboundContext!=='function'||typeof options.assertCurrent!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f25_outbound_context_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext,args?:unknown)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F25',nodeId:'F25_N03',
    hostToolName:'workflow.host.f25_n03',proposalArguments:args??(runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {arguments?:unknown})?.arguments,
    assertCurrent:options.assertCurrent,now:options.now});
  const inspect=(scope:Scope,context:ToolContext,input:{testPayloadContainsPrivate?:boolean})=>{
    const source=options.readOutboundContext(scope);
    if(!source||typeof source.sourceId!=='string'||!source.sourceId||source.sourceId.length>256
      ||!Number.isSafeInteger(source.revision)||source.revision<1||!['public','private','sensitive'].includes(source.dataLevel)
      ||typeof source.cloudExportAllowed!=='boolean'||source.payload===undefined)
      failOwnedHost('UNSUPPORTED_CAPABILITY','F25 original outbound source unavailable');
    let serialized:string;
    try{serialized=JSON.stringify(source.payload);}catch{return failOwnedHost('UNSUPPORTED_CAPABILITY','F25 original outbound payload unavailable');}
    if(typeof serialized!=='string'||Buffer.byteLength(serialized,'utf8')>512*1024)
      failOwnedHost('UNSUPPORTED_CAPABILITY','F25 original outbound payload unavailable');
    const filteredOut:string[]=[];
    if(source.dataLevel!=='public')filteredOut.push('private_source');
    if(!source.cloudExportAllowed)filteredOut.push('export_not_authorized');
    if(input.testPayloadContainsPrivate===true)filteredOut.push('private_marker');
    if(CREDENTIAL.test(serialized)||options.containsCredential?.(serialized)===true)filteredOut.push('credential_pattern');
    active(context);
    return {binding:{sourceId:source.sourceId,revision:source.revision,
      digest:createHash('sha256').update(JSON.stringify([source.dataLevel,source.cloudExportAllowed,serialized])).digest('hex')},
      result:{filteredOut,cleanPayloadReady:filteredOut.length===0}};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F25_N03',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{testPayloadContainsPrivate:{type:'boolean'}}},
    outputSchema:{type:'object',additionalProperties:false,required:['filteredOut','cleanPayloadReady'],properties:{
      filteredOut:{type:'array',items:{type:'string'}},cleanPayloadReady:{type:'boolean'}}},
    async execute(input,context){
      const inspected=inspect(active(context,input),context,input as {testPayloadContainsPrivate?:boolean});
      runtime.saveCheckpointOnce(context.taskId,'f25:outbound-source',inspected);
      if(!isDeepStrictEqual(runtime.loadCheckpoint(context.taskId,'f25:outbound-source'),inspected))
        failOwnedHost('REVISION_CONFLICT','F25 original outbound source changed');
      return inspected.result;
    }});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context);
    if(!result||typeof result!=='object'||!Array.isArray((result as {filteredOut?:unknown}).filteredOut)
      ||typeof (result as {cleanPayloadReady?:unknown}).cleanPayloadReady!=='boolean')failOwnedHost('UNAUTHORIZED','F25 outbound receipt unavailable');
    const args=(runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {arguments?:{testPayloadContainsPrivate?:boolean}})?.arguments;
    const original=runtime.loadCheckpoint(context.taskId,'f25:outbound-source') as ReturnType<typeof inspect>|undefined;
    const assertSource=()=>{
      if(!original||!isDeepStrictEqual(result,original.result)||!isDeepStrictEqual(original,inspect(scope,context,args??{})))
        failOwnedHost('REVISION_CONFLICT','F25 original outbound source changed');
    };
    assertSource();
    if(await options.authorizeExport(scope,structuredClone(result) as {filteredOut:string[];cleanPayloadReady:boolean})!==true)
      failOwnedHost('UNAUTHORIZED','F25 outbound export denied');
    active(context);assertSource();
  }};
}
