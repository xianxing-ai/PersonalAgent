import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {isDeepStrictEqual} from 'node:util';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;

/** F07_N04: compares caller-supplied calendar versions against a trusted live source version. */
export function createRuntimeF07CalendarFreshnessHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  requiredScopes:readonly string[];
  readSourceVersion:(scope:Scope,context:ToolContext,phase:'execute'|'before_export'|'after_export')=>Promise<string>;
  /** Check the version at read against the same graph's original confirmed calendar read. */
  verifyReadBinding:(scope:Scope,input:{calendarVersionAtRead:string;calendarVersionNow:string})=>Promise<boolean>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{versionConsistent:boolean;sourceVersion:string})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.application.readHostToolTask!=='function'||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.readSourceVersion!=='function'||typeof options.assertCurrent!=='function'
    ||typeof options.verifyReadBinding!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f07_calendar_freshness_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext,args?:unknown)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F07',nodeId:'F07_N04',
    hostToolName:'workflow.host.f07_n04',proposalArguments:args??(runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {arguments?:unknown}|undefined)?.arguments,
    assertCurrent:options.assertCurrent,now:options.now});
  const check=async(scope:Scope,context:ToolContext,input:{calendarVersionAtRead:string;calendarVersionNow:string},
    phase:'execute'|'before_export'|'after_export'='execute')=>{
    if(!text(input.calendarVersionAtRead)||!text(input.calendarVersionNow))failOwnedHost('INVALID_ARGUMENT','F07 calendar version arguments invalid');
    if(await options.verifyReadBinding(scope,input)!==true)failOwnedHost('UNAUTHORIZED','F07 original calendar read binding unavailable');
    active(context,input);
    const live=await options.readSourceVersion(scope,context,phase);active(context,input);
    if(!text(live))failOwnedHost('UNSUPPORTED_CAPABILITY','F07 calendar source version unavailable');
    const versionConsistent=input.calendarVersionAtRead===input.calendarVersionNow&&input.calendarVersionNow===live;
    return {versionConsistent,sourceVersion:live};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F07_N04',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,required:['calendarVersionAtRead','calendarVersionNow'],properties:{
      calendarVersionAtRead:{type:'string'},calendarVersionNow:{type:'string'}}},
    outputSchema:{type:'object',additionalProperties:false,required:['versionConsistent','sourceVersion'],properties:{
      versionConsistent:{type:'boolean'},sourceVersion:{type:'string'}}},
    async execute(input,context){const args=input as {calendarVersionAtRead:string;calendarVersionNow:string};return check(active(context,args),context,args);}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const args=(runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {arguments?:unknown}|undefined)?.arguments as {calendarVersionAtRead:string;calendarVersionNow:string};
    const scope=active(context,args),saved=options.application.readHostToolTask(context.taskId);
    if(saved.commandId!==scope.operationId||saved.toolName!=='workflow.host.f07_n04'||saved.task.state!=='succeeded'
      ||saved.confirmed?.runId!==context.runId||!saved.confirmed.evidenceRefs.includes(context.runId)
      ||!isDeepStrictEqual(saved.confirmed.result,result))failOwnedHost('UNAUTHORIZED','F07 original freshness receipt unavailable');
    const latest=await check(scope,context,args,'before_export');
    if(!isDeepStrictEqual(latest,result))failOwnedHost('REVISION_CONFLICT','F07 calendar changed before receipt export');
    if(await options.authorizeExport(scope,structuredClone(result) as {versionConsistent:boolean;sourceVersion:string})!==true)
      failOwnedHost('UNAUTHORIZED','F07 calendar freshness export denied');
    active(context,args);
    if(!isDeepStrictEqual(await check(scope,context,args,'after_export'),result))
      failOwnedHost('REVISION_CONFLICT','F07 calendar changed while authorizing receipt export');
  }};
}

/** F07_N05: delegates to registered calendar write tool under graph binding. */
export function createRuntimeF07CalendarWriteHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  calendarCreate:RegisteredTool;
  /** Invoke the original calendar operation through Runtime Policy/ToolGateway. */
  invokeCalendarCreate:(input:{summary:string;startUtc:string;endUtc:string;location?:string},context:ToolContext,scope:Scope)=>Promise<unknown>;
  requiredScopes:readonly string[];
  verifyWriteBinding:(scope:Scope,input:{title:string;slot:unknown})=>Promise<boolean>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{eventCreated:boolean;externalInviteHeld:boolean})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||options.calendarCreate?.descriptor?.name!=='calendar.create'
    ||typeof options.invokeCalendarCreate!=='function'||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.verifyWriteBinding!=='function'||typeof options.assertCurrent!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f07_calendar_write_trusted_ports_unavailable'};
  const {application,calendarCreate}=options,runtime=application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext,args?:unknown)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F07',nodeId:'F07_N05',
    hostToolName:'workflow.host.f07_n05',proposalArguments:args??(runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {arguments?:unknown}|undefined)?.arguments,
    assertCurrent:options.assertCurrent,now:options.now});
  const write=async(scope:Scope,context:ToolContext,input:{title:string;slot:unknown})=>{
    if(!text(input.title)||input.slot===undefined||typeof input.slot!=='object'||input.slot===null)
      failOwnedHost('INVALID_ARGUMENT','F07 calendar write arguments invalid');
    if(await options.verifyWriteBinding(scope,input)!==true)failOwnedHost('UNAUTHORIZED','F07 calendar write lacks original graph binding');
    active(context,input);
    const slot=input.slot as Record<string,unknown>;
    if(!text(slot.startUtc)||!text(slot.endUtc))failOwnedHost('INVALID_ARGUMENT','F07 calendar slot invalid');
    if(!requiredScopes.every(item=>context.scopes.includes(item))||!calendarCreate.descriptor.requiredScopes.every(item=>context.scopes.includes(item)))
      failOwnedHost('SCOPE_DENIED','F07 calendar scope required');
    const created=await options.invokeCalendarCreate({summary:input.title,startUtc:slot.startUtc,endUtc:slot.endUtc,
      ...(text(slot.location)?{location:slot.location}:{})},context,scope);
    active(context,input);
    const state=plain(created)&&typeof created.state==='string'?created.state:undefined;
    return {eventCreated:state==='created'||state==='confirmed',externalInviteHeld:false};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F07_N05',kind:'host',sideEffect:'external_write',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,required:['title','slot'],properties:{title:{type:'string'},slot:{type:'object'}}},
    outputSchema:{type:'object',additionalProperties:false,required:['eventCreated','externalInviteHeld'],properties:{
      eventCreated:{type:'boolean'},externalInviteHeld:{type:'boolean'}}},
    async execute(input,context){return write(active(context,input),context,input as {title:string;slot:unknown});}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context);
    if(typeof (result as {eventCreated?:unknown}).eventCreated!=='boolean')failOwnedHost('UNAUTHORIZED','F07 calendar write receipt unavailable');
    if(await options.authorizeExport(scope,structuredClone(result) as {eventCreated:boolean;externalInviteHeld:boolean})!==true)
      failOwnedHost('UNAUTHORIZED','F07 calendar write export denied');
  }};
}
