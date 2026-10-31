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

/** F12_N04: the device host persists begin/complete before and after the effect. Read it back here. */
export function createRuntimeF12NotificationDeliverHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  notificationHost:Pick<RuntimeNotificationHost,'getInterruptionRound'>;
  requiredScopes:readonly string[];
  verifyDeliveryBinding:(scope:Scope,input:{roundId:string;itemId:string;channel:NotificationChannel})=>Promise<boolean>;
  /** Uses the existing durable device delivery port, then reads the original attempt; unknown must not resend. */
  resolveDeliveryReceipt:(scope:Scope,input:{roundId:string;itemId:string;channel:NotificationChannel},context:ToolContext)=>Promise<{state:'delivered'|'unknown'|'failed'|'suppressed';evidenceRefs:readonly string[]}>;
  verifyDeliveryResult?:(scope:Scope,result:{delivered:boolean;roundId:string})=>unknown;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{delivered:boolean;roundId:string})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.application.readHostToolTask!=='function'||typeof options.notificationHost?.getInterruptionRound!=='function'
    ||typeof options.resolveDeliveryReceipt!=='function'
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
      if(!receipt||!['delivered','unknown','failed','suppressed'].includes(receipt.state)||!Array.isArray(receipt.evidenceRefs))
        failOwnedHost('UNSUPPORTED_CAPABILITY','F12 delivery receipt unavailable');
      const round=host.getInterruptionRound(bound.roundId),attempt=round?.attempts[bound.channel];
      if(receipt.state==='suppressed'?(round?.state!=='suppressed'||round.counted||!!attempt||receipt.evidenceRefs.length!==0)
        :!attempt||attempt.state!==receipt.state||!isDeepStrictEqual(attempt.evidenceRefs,receipt.evidenceRefs))
        failOwnedHost('RESULT_UNKNOWN','F12 original durable device receipt unavailable');
      if(receipt.state==='unknown')failOwnedHost('RESULT_UNKNOWN','F12 original device delivery requires reconciliation');
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
    options.verifyDeliveryResult?.(scope,result as {delivered:boolean;roundId:string});
    if(await options.authorizeExport(scope,structuredClone(result) as {delivered:boolean;roundId:string})!==true)
      failOwnedHost('UNAUTHORIZED','F12 delivery export denied');
    active(context);
    const current=options.application.readHostToolTask(context.taskId);
    if(!isDeepStrictEqual(current,saved))failOwnedHost('REVISION_CONFLICT','F12 delivery receipt changed during export');
    options.verifyDeliveryResult?.(scope,result as {delivered:boolean;roundId:string});
  }};
}

/** The F12 read/condition hosts share one exact original graph scope, never a notification send grant. */
export function createRuntimeF12ConfiguredReadHosts(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  readPolicy:(scope:Scope)=>Record<string,unknown>;readDigest:(scope:Scope)=>Record<string,unknown>;
  resolveAction:(scope:Scope)=>'deliver'|'feed_only';
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:unknown)=>Promise<boolean>;now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.readPolicy!=='function'||typeof options.readDigest!=='function'
    ||typeof options.resolveAction!=='function'||typeof options.assertCurrent!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f12_configured_read_ports_unavailable'};
  const runtime=options.application.runtime;
  const specs=[{nodeId:'F12_N02',kind:'host'},{nodeId:'F12_N04',kind:'guard'},{nodeId:'F12_N05',kind:'guard'},{nodeId:'F12_N05',kind:'host'}] as const;
  const active=(spec:typeof specs[number],context:ToolContext,args:unknown)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F12',nodeId:spec.nodeId,
    hostToolName:'workflow.'+spec.kind+'.'+spec.nodeId.toLowerCase(),proposalArguments:args,assertCurrent:options.assertCurrent,now:options.now});
  const read=(spec:typeof specs[number],context:ToolContext,args:unknown)=>{
    const scope=active(spec,context,args);
    const result=spec.kind==='guard'?{state:(options.resolveAction(scope)==='deliver')===(spec.nodeId==='F12_N04')?'selected':'skipped'}
      :spec.nodeId==='F12_N02'?options.readPolicy(scope):options.readDigest(scope);
    active(spec,context,args);return result;
  };
  const tools=specs.map(spec=>createOwnedWorkflowAdapter({...spec,sideEffect:'read',requiredScopes:['notifications:read'],
    inputSchema:spec.kind==='guard'?{type:'object',additionalProperties:false,required:['workflowId','nodeId','input','predecessorOutputs','predecessorStates'],
      properties:{workflowId:{const:'F12'},nodeId:{const:spec.nodeId},input:{type:'object'},predecessorOutputs:{type:'object'},predecessorStates:{type:'object'}}}
      :{type:'object',additionalProperties:false,required:['itemId'],properties:{itemId:{type:'string',minLength:1}}},outputSchema:{type:'object'},
    execute:async(args,context)=>read(spec,context,args)}));
  return {tools,unavailable:null,authorizeReceipt:async({context,result})=>{
    const intent=runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {toolName?:string;arguments?:unknown}|undefined;
    const spec=specs.find(item=>intent?.toolName==='workflow.'+item.kind+'.'+item.nodeId.toLowerCase());
    if(!spec)failOwnedHost('UNAUTHORIZED','F12 original read intent unavailable');
    const scope=active(spec,context,intent?.arguments),verified=read(spec,context,intent?.arguments);
    if(!isDeepStrictEqual(verified,result))failOwnedHost('REVISION_CONFLICT','F12 original policy, condition or feed changed');
    if(await options.authorizeExport(scope,verified)!==true)failOwnedHost('UNAUTHORIZED','F12 original read export denied');
    if(!isDeepStrictEqual(read(spec,context,intent?.arguments),result))failOwnedHost('REVISION_CONFLICT','F12 read changed during export');
  }};
}
