import {ProtocolError} from '@personal-agent/contracts';
import {isDeepStrictEqual} from 'node:util';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;

/** F06_N03: delegates to the registered todo write tool under graph and idempotency binding. */
export function createRuntimeF06TodoWriteHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  /** Trusted composition must invoke todo.create through the original Runtime,
   * Policy and ToolGateway, with a stable operation identity and readback. */
  invokeTodoCreate:(scope:Scope,input:{title:string;dueUtc?:string;remindUtc?:string},context:ToolContext)=>Promise<unknown>;
  requiredScopes:readonly string[];
  /** Must prove this write matches the graph operation idempotency key. */
  verifyWriteBinding:(scope:Scope,input:{todoTitle:string;due?:string;remindUtc?:string})=>Promise<boolean>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{todoId:string;opKey:string})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.invokeTodoCreate!=='function'
    ||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.verifyWriteBinding!=='function'||typeof options.assertCurrent!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f06_todo_write_trusted_ports_unavailable'};
  const {application}=options,runtime=application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext,input:{todoTitle:string;due?:string;remindUtc?:string})=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F06',nodeId:'F06_N03',
    hostToolName:'workflow.host.f06_n03',proposalArguments:input,assertCurrent:options.assertCurrent,now:options.now});
  const write=async(scope:Scope,context:ToolContext,input:{todoTitle:string;due?:string;remindUtc?:string})=>{
    if(!text(input.todoTitle)||input.due!==undefined&&!text(input.due)
      ||input.remindUtc!==undefined&&!text(input.remindUtc))failOwnedHost('INVALID_ARGUMENT','F06 todo write arguments invalid');
    if(await options.verifyWriteBinding(scope,input)!==true)failOwnedHost('UNAUTHORIZED','F06 todo write lacks original graph binding');
    active(context,input);
    const payload:{title:string;dueUtc?:string;remindUtc?:string}={title:input.todoTitle};
    if(input.due!==undefined)payload.dueUtc=input.due;
    // A due date is not permission to create a reminder. Preserve only the explicit reminder time.
    if(input.remindUtc!==undefined)payload.remindUtc=input.remindUtc;
    const created=await options.invokeTodoCreate(scope,payload,context);
    active(context,input);
    if(!plain(created)||!plain(created.item)||!text(created.item.id))failOwnedHost('EXTERNAL_FAILURE','Todo write receipt unavailable');
    const revision=created.item.revision;
    if(!Number.isSafeInteger(revision)||Number(revision)<1)
      failOwnedHost('EXTERNAL_FAILURE','Todo write revision unavailable');
    const trigger=created.reminderTrigger;
    if(input.remindUtc!==undefined&&(!plain(trigger)||!text(trigger.scheduleId)))
      failOwnedHost('RESULT_UNKNOWN','Created todo reminder receipt unavailable');
    // Persist the exact N03 identity for F06_N04 reminder binding; never invent reminders.
    runtime.saveCheckpointOnce(scope.parentTaskId,'f06:n03-todo:'+scope.sessionId,{
      sessionId:scope.sessionId,operationId:scope.operationId,todoId:created.item.id,revision,item:structuredClone(created.item),
      ...(plain(trigger)&&text(trigger.scheduleId)?{reminderScheduleId:trigger.scheduleId,reminderTrigger:structuredClone(trigger)}:{})});
    const bound=runtime.loadCheckpoint(scope.parentTaskId,'f06:n03-todo:'+scope.sessionId) as
      {sessionId?:string;operationId?:string;todoId?:string;revision?:number;reminderScheduleId?:string;reminderTrigger?:unknown;item?:unknown}|undefined;
    if(bound?.sessionId!==scope.sessionId||bound.operationId!==scope.operationId||bound.todoId!==created.item.id
      ||bound.revision!==revision||!isDeepStrictEqual(bound.item,created.item)
      ||bound.reminderScheduleId!==(plain(trigger)&&text(trigger.scheduleId)?trigger.scheduleId:undefined)
      ||!isDeepStrictEqual(bound.reminderTrigger,plain(trigger)&&text(trigger.scheduleId)?trigger:undefined))
      failOwnedHost('REVISION_CONFLICT','F06 todo write binding changed');
    return {todoId:created.item.id as string,revision:Number(revision),opKey:scope.operationId};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F06_N03',kind:'host',sideEffect:'local_write',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,required:['todoTitle'],properties:{
      todoTitle:{type:'string',minLength:1,maxLength:200},due:{type:'string'},remindUtc:{type:'string'}}},
    outputSchema:{type:'object',additionalProperties:false,required:['todoId','revision','opKey'],properties:{
      todoId:{type:'string'},revision:{type:'integer',minimum:1},opKey:{type:'string'}}},
    async execute(input,context){const args=input as {todoTitle:string;due?:string;remindUtc?:string};return write(active(context,args),context,args);}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    const intent=parent?.taskId&&parent.operationId?runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId) as {proposal?:{arguments?:unknown}}|undefined:undefined;
    const args=intent?.proposal?.arguments as {todoTitle:string;due?:string};
    const scope=active(context,args);
    if(!plain(result)||!text(result.todoId)||result.opKey!==scope.operationId)failOwnedHost('UNAUTHORIZED','F06 todo write receipt unavailable');
    if(await options.authorizeExport(scope,structuredClone(result) as {todoId:string;opKey:string})!==true)
      failOwnedHost('UNAUTHORIZED','F06 todo write export denied');
  }};
}

/** F06_N05 condition is a current local observation, never a model branch selection. */
export function createRuntimeF06ReminderGuard(options?:{
  application:Pick<RuntimeApplication,'runtime'>;requiredScopes:readonly string[];
  resolveReminderState:(scope:Scope)=>Promise<'selected'|'skipped'>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{state:'selected'|'skipped'})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.resolveReminderState!=='function'||typeof options.assertCurrent!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f06_reminder_guard_trusted_ports_unavailable'};
  const runtime=options.application.runtime;
  const active=(context:ToolContext,args:unknown)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F06',nodeId:'F06_N05',
    hostToolName:'workflow.guard.f06_n05',proposalArguments:args,assertCurrent:options.assertCurrent,now:options.now});
  const read=async(context:ToolContext,args:unknown)=>{
    const scope=active(context,args),state=await options.resolveReminderState(scope);active(context,args);
    if(state!=='selected'&&state!=='skipped')failOwnedHost('RESULT_UNKNOWN','F06 reminder condition is unknown');
    return {state};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F06_N05',kind:'guard',sideEffect:'read',requiredScopes:[...options.requiredScopes],
    inputSchema:{type:'object',additionalProperties:false,required:['workflowId','nodeId','input','predecessorOutputs','predecessorStates'],properties:{
      workflowId:{const:'F06'},nodeId:{const:'F06_N05'},input:{type:'object'},predecessorOutputs:{type:'object'},predecessorStates:{type:'object'}}},
    outputSchema:{type:'object'},execute:(input,context)=>read(context,input)});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const args=(runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {arguments?:unknown})?.arguments;
    const expected=await read(context,args),scope=active(context,args);
    if(!isDeepStrictEqual(result,expected))failOwnedHost('REVISION_CONFLICT','F06 reminder condition changed before export');
    if(await options.authorizeExport(scope,expected)!==true)failOwnedHost('UNAUTHORIZED','F06 reminder condition export denied');
    if(!isDeepStrictEqual(result,await read(context,args)))failOwnedHost('REVISION_CONFLICT','F06 reminder condition changed during export');
  }};
}

/** F06_N05: trusted delivery only; never claims user-visible delivery without a host callback. */
export function createRuntimeF06NotificationDeliverHost(options?:{
  application:Pick<RuntimeApplication,'runtime'>;
  requiredScopes:readonly string[];
  /** Confirmed N04 receipt and notification payload must match the same graph session. */
  verifyReminderReady:(scope:Scope,input:{notification:unknown})=>Promise<boolean>;
  deliverNotification:(scope:Scope,input:{notification:unknown})=>Promise<{delivered:boolean}>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{delivered:boolean})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||typeof options.verifyReminderReady!=='function'||typeof options.deliverNotification!=='function'
    ||typeof options.assertCurrent!=='function'||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f06_notification_deliver_trusted_ports_unavailable'};
  const runtime=options.application.runtime,requiredScopes=[...options.requiredScopes];
  const active=(context:ToolContext,input:{notification:unknown})=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F06',nodeId:'F06_N05',
    hostToolName:'workflow.host.f06_n05',proposalArguments:input,assertCurrent:options.assertCurrent,now:options.now});
  const deliver=async(scope:Scope,context:ToolContext,input:{notification:unknown})=>{
    if(input.notification===undefined||typeof input.notification!=='object'||input.notification===null)
      failOwnedHost('INVALID_ARGUMENT','F06 notification payload invalid');
    if(await options.verifyReminderReady(scope,input)!==true)failOwnedHost('UNAUTHORIZED','F06 reminder delivery lacks original binding');
    active(context,input);
    const outcome=await options.deliverNotification(scope,structuredClone(input));
    active(context,input);
    if(!plain(outcome)||typeof outcome.delivered!=='boolean')failOwnedHost('RESULT_UNKNOWN','F06 notification delivery outcome unknown');
    return {delivered:outcome.delivered};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F06_N05',kind:'host',sideEffect:'external_write',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,required:['notification'],properties:{notification:{type:'object'}}},
    outputSchema:{type:'object',additionalProperties:false,required:['delivered'],properties:{delivered:{type:'boolean'}}},
    async execute(input,context){const args=input as {notification:unknown};return deliver(active(context,args),context,args);}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    const intent=parent?.taskId&&parent.operationId?runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId) as {proposal?:{arguments?:unknown}}|undefined:undefined;
    const args=intent?.proposal?.arguments as {notification:unknown};
    const scope=active(context,args);
    if(!plain(result)||typeof result.delivered!=='boolean')failOwnedHost('UNAUTHORIZED','F06 notification receipt unavailable');
    if(await options.authorizeExport(scope,structuredClone(result) as {delivered:boolean})!==true)
      failOwnedHost('UNAUTHORIZED','F06 notification export denied');
  }};
}
