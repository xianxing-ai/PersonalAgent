import {isDeepStrictEqual} from 'node:util';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeNotificationHost} from './notification-host.js';
import type {NotificationChannel,NotificationScope} from '@personal-agent/notifications';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const channel=(v:unknown):v is NotificationChannel=>v==='banner'||v==='voice';

/** F12_N02: reads effective quiet-hours/interruption policy from Runtime NotificationHost. */
export function createRuntimeF12QuietHoursHost(options?:{
  application?:Pick<RuntimeApplication,'runtime'>;
  getApplication?:()=>Pick<RuntimeApplication,'runtime'>|undefined;
  notificationHost:Pick<RuntimeNotificationHost,'getInterruptionPolicy'>;
  resolveScope:(scope:Scope)=>NotificationScope;
  requiredScopes:readonly string[];
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  now:()=>Date;
}):{tools:RegisteredTool[];unavailable:string|null} {
  if((!options?.application?.runtime&&typeof options?.getApplication!=='function')
    ||typeof options.notificationHost?.getInterruptionPolicy!=='function'
    ||typeof options.resolveScope!=='function'||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.assertCurrent!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f12_quiet_hours_trusted_ports_unavailable'};
  const requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext)=>{
    const runtime=options.getApplication?.()?.runtime??options.application?.runtime;
    if(!runtime)failOwnedHost('UNSUPPORTED_CAPABILITY','F12 quiet-hours Runtime unavailable');
    return assertOwnedWorkflowHostScope({runtime,context,workflowId:'F12',nodeId:'F12_N02',
      hostToolName:'workflow.host.f12_n02',assertCurrent:options.assertCurrent,now:options.now});
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F12_N02',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{policyRevision:{type:'integer',minimum:0}}},
    outputSchema:{type:'object',additionalProperties:false,required:['mode','digestMode','allowUrgentBreakthrough'],properties:{
      mode:{type:'string'},maxInterruptions:{type:'integer'},windowMinutes:{type:'integer'},silentUntilUtc:{type:'string',nullable:true},
      preferredChannel:{type:'string'},allowUrgentBreakthrough:{type:'boolean'},digestMode:{type:'string'},quietHours:{type:'object'}}},
    async execute(_input,context){
      const scope=active(context),resolved=options.notificationHost.getInterruptionPolicy(options.resolveScope(scope));
      active(context);
      if(!plain(resolved)||resolved.state!=='configured'||!plain(resolved.effective))
        failOwnedHost('UNSUPPORTED_CAPABILITY','F12 interruption policy unavailable');
      const policy=resolved.effective;
      return {mode:policy.mode,digestMode:policy.digestMode,allowUrgentBreakthrough:policy.allowUrgentBreakthrough,
        ...(policy.maxInterruptions!==null&&policy.maxInterruptions!==undefined?{maxInterruptions:policy.maxInterruptions}:{}),
        ...(policy.windowMinutes!==null&&policy.windowMinutes!==undefined?{windowMinutes:policy.windowMinutes}:{}),
        ...(policy.silentUntilUtc!==null&&policy.silentUntilUtc!==undefined?{silentUntilUtc:policy.silentUntilUtc}:{}),
        ...(policy.preferredChannel?{preferredChannel:policy.preferredChannel}:{}),
        ...(policy.quietHours?{quietHours:structuredClone(policy.quietHours)}:{})};
    }});
  return {tools:[tool],unavailable:null};
}

/** F12_N04: delivery uses NotificationHost begin/complete; delivered only on explicit receipt state. */
export function createRuntimeF12NotificationDeliverHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  notificationHost:Pick<RuntimeNotificationHost,'beginDelivery'|'completeDelivery'>;
  requiredScopes:readonly string[];
  verifyDeliveryBinding:(scope:Scope,input:{roundId:string;itemId:string;channel:NotificationChannel})=>Promise<boolean>;
  /** Trusted desktop/device readback; must not assume delivery from beginDelivery alone. */
  resolveDeliveryReceipt:(scope:Scope,input:{roundId:string;itemId:string;channel:NotificationChannel},context:ToolContext)=>Promise<{state:'delivered'|'unknown'|'failed';evidenceRefs:readonly string[]}>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{delivered:boolean;roundId:string})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.application.readHostToolTask!=='function'||typeof options.notificationHost?.beginDelivery!=='function'
    ||typeof options.notificationHost.completeDelivery!=='function'||typeof options.resolveDeliveryReceipt!=='function'
    ||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.verifyDeliveryBinding!=='function'||typeof options.assertCurrent!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f12_notification_deliver_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes],host=options.notificationHost;
  const active=(context:ToolContext,args?:unknown)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F12',nodeId:'F12_N04',
    hostToolName:'workflow.host.f12_n04',proposalArguments:args??(runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {arguments?:unknown}|undefined)?.arguments,
    assertCurrent:options.assertCurrent,now:options.now});
  const tool=createOwnedWorkflowAdapter({nodeId:'F12_N04',kind:'host',sideEffect:'external_write',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,required:['roundId','itemId','channel'],properties:{
      roundId:{type:'string'},itemId:{type:'string'},channel:{type:'string',enum:['banner','voice']},policyRevision:{type:'integer'}}},
    outputSchema:{type:'object',additionalProperties:false,required:['delivered','roundId'],properties:{
      delivered:{type:'boolean'},roundId:{type:'string'}}},
    async execute(input,context){
      const scope=active(context,input),payload=input as {roundId:string;itemId:string;channel:string};
      if(!text(payload.roundId)||!text(payload.itemId)||!channel(payload.channel))failOwnedHost('INVALID_ARGUMENT','F12 delivery arguments invalid');
      const bound={roundId:payload.roundId,itemId:payload.itemId,channel:payload.channel};
      if(await options.verifyDeliveryBinding(scope,bound)!==true)failOwnedHost('UNAUTHORIZED','F12 delivery lacks original binding');
      active(context,input);
      const receipt=await options.resolveDeliveryReceipt(scope,bound,context);active(context,input);
      if(!receipt||!['delivered','unknown','failed'].includes(receipt.state)||!Array.isArray(receipt.evidenceRefs))
        failOwnedHost('UNSUPPORTED_CAPABILITY','F12 delivery receipt unavailable');
      host.beginDelivery({roundId:bound.roundId,channel:bound.channel});
      host.completeDelivery({roundId:bound.roundId,channel:bound.channel,state:receipt.state,evidenceRefs:receipt.evidenceRefs});
      active(context,input);
      return {delivered:receipt.state==='delivered',roundId:bound.roundId};
    }});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context);
    if(!plain(result)||typeof result.delivered!=='boolean'||!text(result.roundId))failOwnedHost('UNAUTHORIZED','F12 delivery receipt unavailable');
    const saved=options.application.readHostToolTask(context.taskId);
    if(saved.commandId!==scope.operationId||saved.toolName!=='workflow.host.f12_n04'||saved.task.state!=='succeeded'
      ||saved.confirmed?.runId!==context.runId||!saved.confirmed.evidenceRefs.includes(context.runId)
      ||!isDeepStrictEqual(saved.confirmed.result,result))failOwnedHost('UNAUTHORIZED','F12 original delivery receipt unavailable');
    if(await options.authorizeExport(scope,structuredClone(result) as {delivered:boolean;roundId:string})!==true)
      failOwnedHost('UNAUTHORIZED','F12 delivery export denied');
    active(context);
    const current=options.application.readHostToolTask(context.taskId);
    if(!isDeepStrictEqual(current,saved))failOwnedHost('REVISION_CONFLICT','F12 delivery receipt changed during export');
  }};
}
