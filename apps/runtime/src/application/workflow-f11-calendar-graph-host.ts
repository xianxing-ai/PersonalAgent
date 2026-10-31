import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {isDeepStrictEqual} from 'node:util';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import {verifyF11ConfirmedCalendarAndReminder,type F11CalendarChangeBinding} from './workflow-f11-calendar-receipt-guard.js';

type Scope=OwnedWorkflowHostScope;
type Reminder={todoId:string;revision:number;scheduleId:string;conversationId:string};
type Input={update:Record<string,unknown>;reminder:Reminder};
type GuardOptions=NonNullable<Parameters<typeof verifyF11ConfirmedCalendarAndReminder>[0]>;

/** One original calendar.update child followed by the original reminder's todo.update child.
 * Each child crosses Policy separately. A partial/unknown write remains reconcilable, never replayed here. */
export function createRuntimeF11CalendarChangeHost(options?:{
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;calendarUpdate:RegisteredTool;
  requiredScopes:readonly string[];
  invokeCalendarUpdate:(scope:Scope,input:Record<string,unknown>,context:ToolContext)=>Promise<Omit<F11CalendarChangeBinding,'reminderId'>>;
  invalidateReminder:(scope:Scope,input:Reminder,context:ToolContext)=>Promise<void>;
  verifyPlan:(scope:Scope,input:Input)=>Promise<boolean>;
  verifyOriginalPlan:GuardOptions['verifyOriginalPlan'];verifyUpdatedEvent:GuardOptions['verifyUpdatedEvent'];
  verifyReminderInvalidated:GuardOptions['verifyReminderInvalidated'];
  readChangeBinding:(scope:Scope)=>F11CalendarChangeBinding|undefined;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{calendarUpdated:true;oldTrafficAlarmVoided:true})=>Promise<boolean>;
  now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||options.calendarUpdate?.descriptor.name!=='calendar.update'
    ||!options.requiredScopes?.length||typeof options.invokeCalendarUpdate!=='function'||typeof options.invalidateReminder!=='function'
    ||typeof options.verifyPlan!=='function'||typeof options.verifyOriginalPlan!=='function'||typeof options.verifyUpdatedEvent!=='function'
    ||typeof options.verifyReminderInvalidated!=='function'||typeof options.assertCurrent!=='function'||typeof options.authorizeExport!=='function'
    ||typeof options.readChangeBinding!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f11_calendar_and_reminder_ports_unavailable'};
  const runtime=options.application.runtime;
  const active=(context:ToolContext,input:Input)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F11',nodeId:'F11_N05',
    hostToolName:'workflow.host.f11_n05',proposalArguments:input,assertCurrent:options.assertCurrent,now:options.now});
  const tool=createOwnedWorkflowAdapter({nodeId:'F11_N05',kind:'host',sideEffect:'external_write',requiredScopes:[...options.requiredScopes],
    inputSchema:{type:'object',additionalProperties:false,required:['update','reminder'],properties:{
      update:structuredClone(options.calendarUpdate.descriptor.inputSchema),reminder:{type:'object',additionalProperties:false,
        required:['todoId','revision','scheduleId','conversationId'],properties:{todoId:{type:'string',minLength:1},
          revision:{type:'integer',minimum:1},scheduleId:{type:'string',minLength:1},conversationId:{type:'string',minLength:1}}}}},
    outputSchema:{type:'object',additionalProperties:false,required:['calendarUpdated','oldTrafficAlarmVoided'],
      properties:{calendarUpdated:{const:true},oldTrafficAlarmVoided:{const:true}}},
    async execute(raw,context){
      const input=raw as Input,scope=active(context,input);
      if(await options.verifyPlan(scope,input)!==true)failOwnedHost('UNAUTHORIZED','F11 original change plan unavailable');
      active(context,input);
      const written=await options.invokeCalendarUpdate(scope,input.update,context);active(context,input);
      const bound={...written,reminderId:input.reminder.scheduleId};
      // Verify the real calendar execution before any reminder mutation.
      if(await options.verifyUpdatedEvent(scope,bound)!==true)failOwnedHost('RESULT_UNKNOWN','F11 calendar readback unavailable');
      active(context,input);await options.invalidateReminder(scope,input.reminder,context);active(context,input);
      const result=await verifyF11ConfirmedCalendarAndReminder({application:options.application,verifyOriginalPlan:options.verifyOriginalPlan,
        verifyUpdatedEvent:options.verifyUpdatedEvent,verifyReminderInvalidated:options.verifyReminderInvalidated},scope,bound);
      active(context,input);
      if(await options.authorizeExport(scope,result)!==true)failOwnedHost('UNAUTHORIZED','F11 confirmed change export denied');
      active(context,input);
      await verifyF11ConfirmedCalendarAndReminder(options,scope,bound);active(context,input);return result;
    }});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const args=(runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {arguments?:Input})?.arguments;
    if(!args)failOwnedHost('UNAUTHORIZED','F11 original change intent unavailable');
    const scope=active(context,args),bound=options.readChangeBinding(scope);
    if(!bound)failOwnedHost('UNAUTHORIZED','F11 original confirmed change binding unavailable');
    const verified=await verifyF11ConfirmedCalendarAndReminder(options,scope,bound);active(context,args);
    if(!isDeepStrictEqual(result,verified))failOwnedHost('UNAUTHORIZED','F11 original change result was replaced');
    if(await options.authorizeExport(scope,verified)!==true)failOwnedHost('UNAUTHORIZED','F11 original change receipt export denied');
    await verifyF11ConfirmedCalendarAndReminder(options,scope,bound);active(context,args);
  }};
}

/** Explicit plan conditions only. Selection admits the original Policy path; it is not a write grant. */
export function createRuntimeF11PlanGuards(options?:{
  application:Pick<RuntimeApplication,'runtime'>;requiredScopes:readonly string[];
  resolvePlanGuard:(scope:Scope,nodeId:'F11_N04'|'F11_N05')=>Promise<'selected'|'skipped'>;
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  authorizeExport:(scope:Scope,result:{state:'selected'|'skipped'})=>Promise<boolean>;now:()=>Date;
}):{tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||!options.requiredScopes?.length||typeof options.resolvePlanGuard!=='function'
    ||typeof options.assertCurrent!=='function'||typeof options.authorizeExport!=='function'||typeof options.now!=='function')
    return {tools:[],unavailable:'f11_plan_guard_trusted_ports_unavailable'};
  const runtime=options.application.runtime;
  const active=(nodeId:'F11_N04'|'F11_N05',context:ToolContext,args:unknown)=>assertOwnedWorkflowHostScope({runtime,context,workflowId:'F11',nodeId,
    hostToolName:'workflow.guard.'+nodeId.toLowerCase(),proposalArguments:args,assertCurrent:options.assertCurrent,now:options.now});
  const read=async(nodeId:'F11_N04'|'F11_N05',context:ToolContext,args:unknown)=>{
    const scope=active(nodeId,context,args),state=await options.resolvePlanGuard(scope,nodeId);active(nodeId,context,args);
    if(state!=='selected'&&state!=='skipped')failOwnedHost('RESULT_UNKNOWN','F11 original plan condition unavailable');
    return {state};
  };
  const tools=(['F11_N04','F11_N05'] as const).map(nodeId=>createOwnedWorkflowAdapter({nodeId,kind:'guard',sideEffect:'read',
    requiredScopes:[...options.requiredScopes],inputSchema:{type:'object',additionalProperties:false,
      required:['workflowId','nodeId','input','predecessorOutputs','predecessorStates'],properties:{workflowId:{const:'F11'},nodeId:{const:nodeId},
        input:{type:'object'},predecessorOutputs:{type:'object'},predecessorStates:{type:'object'}}},outputSchema:{type:'object'},
    execute:(args,context)=>read(nodeId,context,args)}));
  return {tools,unavailable:null,authorizeReceipt:async({context,result})=>{
    const intent=runtime.loadCheckpoint(context.taskId,'host-tool-intent') as {toolName?:string;arguments?:unknown}|undefined;
    const nodeId=intent?.toolName==='workflow.guard.f11_n04'?'F11_N04':intent?.toolName==='workflow.guard.f11_n05'?'F11_N05':undefined;
    if(!nodeId)failOwnedHost('UNAUTHORIZED','F11 original guard intent unavailable');
    const scope=active(nodeId,context,intent?.arguments),verified=await read(nodeId,context,intent?.arguments);
    if(!isDeepStrictEqual(verified,result))failOwnedHost('REVISION_CONFLICT','F11 plan condition changed');
    if(await options.authorizeExport(scope,verified)!==true)failOwnedHost('UNAUTHORIZED','F11 plan condition export denied');
    if(!isDeepStrictEqual(await read(nodeId,context,intent?.arguments),result))failOwnedHost('REVISION_CONFLICT','F11 plan condition changed during export');
  }};
}
