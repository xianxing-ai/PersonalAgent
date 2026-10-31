import type {RuntimeApplication} from './runtime-application.js';
import type {OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import {failOwnedHost} from './workflow-owned-host-scope.js';

/** Trusted binding to the original Gateway invocation and the specific old alarm. */
export interface F11CalendarChangeBinding {
  taskId:string;runId:string;toolVersion:string;scopeRef:string;arguments:Record<string,unknown>;reminderId:string;
}
export interface F11CalendarChangeGuardOptions {
  application:Pick<RuntimeApplication,'runtime'>;
  /** Revalidate N03/N04, original authorization, exact event and intended update. */
  verifyOriginalPlan:(scope:OwnedWorkflowHostScope,binding:F11CalendarChangeBinding)=>Promise<boolean>;
  /** Verify confirmed calendar.update result and actual provider readback for this event. */
  verifyUpdatedEvent:(scope:OwnedWorkflowHostScope,binding:F11CalendarChangeBinding)=>Promise<boolean>;
  /** Read authoritative old-reminder invalidation and bind it to the same original event/update. */
  verifyReminderInvalidated:(scope:OwnedWorkflowHostScope,binding:F11CalendarChangeBinding)=>Promise<boolean>;
}
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=1024;

/** Guard for F11_N05. This never invokes a write or
 * registers a graph node. Call only with a binding resolved by trusted host. */
export async function verifyF11ConfirmedCalendarAndReminder(options:F11CalendarChangeGuardOptions|undefined,
  scope:OwnedWorkflowHostScope,binding:F11CalendarChangeBinding):Promise<{calendarUpdated:true;oldTrafficAlarmVoided:true}> {
  if(!options?.application?.runtime||typeof options.verifyOriginalPlan!=='function'||typeof options.verifyUpdatedEvent!=='function'
    ||typeof options.verifyReminderInvalidated!=='function'||!binding||!text(binding.taskId)||!text(binding.runId)
    ||!text(binding.toolVersion)||!text(binding.scopeRef)||!text(binding.reminderId)
    ||!binding.arguments||typeof binding.arguments!=='object'||Array.isArray(binding.arguments))
    failOwnedHost('UNSUPPORTED_CAPABILITY','F11 calendar change trusted ports unavailable');
  if(scope.signal.aborted)failOwnedHost('CANCELLED','F11 calendar change cancelled');
  const runtime=options.application.runtime;
  let record:ReturnType<typeof runtime.readToolExecutions>[number]|undefined;
  try {
    const task=runtime.getTask(binding.taskId);
    record=runtime.readToolExecutions(binding.taskId).find(item=>item.evidenceId===binding.runId);
    if(!task.evidenceRefs.includes(binding.runId))failOwnedHost('UNAUTHORIZED','F11 calendar update evidence unavailable');
  }catch {return failOwnedHost('UNAUTHORIZED','F11 calendar update evidence unavailable');}
  if(!record||record.taskId!==binding.taskId||record.toolName!=='calendar.update'||record.toolVersion!==binding.toolVersion
    ||record.policyDecision!=='allow'||!record.executionStarted||record.state!=='confirmed'
    ||!runtime.matchesToolExecutionInput(record,{arguments:binding.arguments,scopeRef:binding.scopeRef}))
    failOwnedHost('UNAUTHORIZED','F11 original calendar write unavailable');
  const check=async(fn:(scope:OwnedWorkflowHostScope,binding:F11CalendarChangeBinding)=>Promise<boolean>)=>{
    try {return await fn(scope,binding)===true;}catch {return failOwnedHost('UNSUPPORTED_CAPABILITY','F11 calendar or reminder verification unavailable');}
  };
  if(!await check(options.verifyOriginalPlan))failOwnedHost('UNAUTHORIZED','F11 original plan unavailable');
  if(!await check(options.verifyUpdatedEvent))failOwnedHost('RESULT_UNKNOWN','F11 calendar readback unavailable');
  if(!await check(options.verifyReminderInvalidated))failOwnedHost('RESULT_UNKNOWN','F11 old reminder invalidation unavailable');
  if(scope.signal.aborted)failOwnedHost('CANCELLED','F11 calendar change cancelled');
  if(!await check(options.verifyOriginalPlan))failOwnedHost('UNAUTHORIZED','F11 original plan changed');
  if(!await check(options.verifyUpdatedEvent)||!await check(options.verifyReminderInvalidated))
    failOwnedHost('RESULT_UNKNOWN','F11 calendar or reminder changed during verification');
  return {calendarUpdated:true,oldTrafficAlarmVoided:true};
}
