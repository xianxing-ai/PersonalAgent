import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {buildReminderTrigger} from '@personal-agent/productivity';

const fail=(code,message)=>{throw new ProtocolError(code,message);};

/** Uses existing calendar.update and todo.update(clearReminder), each through the child Policy bridge. */
export function createF11CalendarWorkflowPorts({getApplication,bridge,todoHost,authorizeExport,now=Date.now}={}) {
  if(typeof getApplication!=='function'||typeof bridge?.invoke!=='function'||typeof todoHost?.snapshot!=='function'
    ||typeof authorizeExport!=='function')throw Error('F11 requires Runtime, child Policy bridge and original Todo host');
  const binding=scope=>{
    if(scope.signal.aborted||Date.parse(scope.deadline)<=now())fail('CANCELLED','F11 operation is no longer active');
    const app=getApplication(),bound=app.readConfiguredWorkflowBinding({taskId:scope.parentTaskId,workflowId:'F11',
      sessionId:scope.sessionId,signal:scope.signal});
    if(!bound||bound.deadline!==scope.deadline)fail('UNAUTHORIZED','F11 original workflow binding unavailable');
    return {app,plan:bound.input};
  };
  const recordKey=scope=>'f11:calendar-update:'+scope.sessionId;
  const saved=scope=>{const {app}=binding(scope);return app.runtime.loadCheckpoint(scope.parentTaskId,recordKey(scope));};
  const reminderKey=scope=>'f11:original-reminder:'+scope.sessionId;
  const clearKey=scope=>'f11:reminder-clear:'+scope.sessionId;
  const originalReminder=scope=>{
    const {app,plan}=binding(scope),original=app.runtime.loadCheckpoint(scope.parentTaskId,reminderKey(scope));
    if(!original||!isDeepStrictEqual(original.reminder,plan.reminder))fail('UNAUTHORIZED','F11 original reminder snapshot unavailable');
    return original;
  };
  const unchangedReminder=scope=>{
    const {app}=binding(scope),original=originalReminder(scope),item=todoHost.snapshot().items.find(value=>value.id===original.item.id);
    if(!isDeepStrictEqual(item,original.item)||Date.parse(original.trigger.runAt)<=now()
      ||!isDeepStrictEqual(app.runtime.getSchedule(original.trigger.scheduleId),original.schedule))
      fail('REVISION_CONFLICT','F11 original reminder changed before its conditional update');
    return original;
  };
  const childResult=(scope,toolName,record)=>{
    if(!record)return;
    const {app}=binding(scope),read=app.readHostToolTask(record.taskId),execution=app.runtime.readToolExecutions(record.taskId)
      .find(value=>value.evidenceId===record.runId);
    if(read.task.state!=='succeeded'||read.task.cancelRequested||read.toolName!==toolName||read.toolVersion!==record.toolVersion
      ||read.confirmed?.runId!==record.runId||!read.confirmed.evidenceRefs.includes(record.runId)
      ||!execution||execution.toolName!==toolName||execution.toolVersion!==record.toolVersion||execution.policyDecision!=='allow'
      ||!execution.executionStarted||execution.state!=='confirmed'
      ||!app.runtime.matchesToolExecutionInput(execution,{arguments:record.arguments,scopeRef:record.scopeRef}))return;
    return read.confirmed.result;
  };
  const clearedItem=(original,item)=>{
    if(!item||!Number.isFinite(Date.parse(item.updatedAt))||Date.parse(item.updatedAt)<Date.parse(original.item.updatedAt)
      ||Date.parse(item.updatedAt)>now())return false;
    const expected={...original.item,updatedAt:item.updatedAt,revision:original.item.revision+1};delete expected.reminder;
    return isDeepStrictEqual(item,expected);
  };
  const verifyReminderInvalidated=async(scope,receipt)=>{
    const {app,plan}=binding(scope),original=originalReminder(scope),record=app.runtime.loadCheckpoint(scope.parentTaskId,clearKey(scope));
    if(receipt.reminderId!==original.trigger.scheduleId||!record||!isDeepStrictEqual(record.arguments,
      {id:plan.reminder.todoId,expectedRevision:plan.reminder.revision,clearReminder:true}))return false;
    const result=childResult(scope,'todo.update',record),item=todoHost.snapshot().items.find(value=>value.id===plan.reminder.todoId);
    return result?.reminderTrigger===null&&clearedItem(original,result.item)&&isDeepStrictEqual(item,result.item)
      &&isDeepStrictEqual(app.runtime.getSchedule(original.trigger.scheduleId),{...original.schedule,status:'cancelled'});
  };
  const verifyUpdatedEvent=async(scope,receipt)=>{
    const {plan}=binding(scope),original=saved(scope);
    if(!original||!isDeepStrictEqual(original.arguments,plan.update)||original.taskId!==receipt.taskId||original.runId!==receipt.runId)return false;
    const result=childResult(scope,'calendar.update',original),item=result?.item;
    return result?.state==='updated'&&item?.source==='calendar'
      &&item.externalId===(plan.update.externalId??plan.update.uid)
      &&(!plan.update.startUtc||item.validFor?.split('/')[0]===plan.update.startUtc)
      &&(!plan.update.endUtc||item.validFor?.split('/')[1]===plan.update.endUtc);
  };
  return {
    assertCurrent:scope=>{binding(scope);},
    async verifyPlan(scope,input){
      const {app,plan}=binding(scope);if(!isDeepStrictEqual(input,{update:plan.update,reminder:plan.reminder}))return false;
      if(app.runtime.loadCheckpoint(scope.parentTaskId,clearKey(scope)))
        return verifyReminderInvalidated(scope,{reminderId:plan.reminder.scheduleId});
      const todo=todoHost.snapshot().items.find(item=>item.id===plan.reminder.todoId);
      if(todo?.revision!==plan.reminder.revision||todo.status!=='open'||todo.reminder?.state!=='scheduled')return false;
      const trigger=buildReminderTrigger(todo,plan.reminder.conversationId),schedule=app.runtime.getSchedule(plan.reminder.scheduleId);
      if(trigger?.scheduleId!==plan.reminder.scheduleId||!isDeepStrictEqual(schedule,{...trigger,status:'pending'}))return false;
      const original={reminder:plan.reminder,item:todo,trigger,schedule};
      app.runtime.saveCheckpointOnce(scope.parentTaskId,reminderKey(scope),original);
      if(!isDeepStrictEqual(originalReminder(scope),original))return false;
      unchangedReminder(scope);return true;
    },
    async invokeCalendarUpdate(scope,input,context){
      const {app,plan}=binding(scope);if(!isDeepStrictEqual(input,plan.update))fail('UNAUTHORIZED','F11 update arguments changed');
      const receipt=await bridge.invoke({actionKey:'f11.calendar.update',input:structuredClone(input)},context);binding(scope);
      if(receipt.toolName!=='calendar.update'||!isDeepStrictEqual(receipt.arguments,input))fail('UNAUTHORIZED','F11 calendar child receipt changed');
      const record={taskId:receipt.taskId,runId:receipt.runId,toolVersion:receipt.toolVersion,scopeRef:receipt.scopeRef,arguments:receipt.arguments};
      app.runtime.saveCheckpointOnce(scope.parentTaskId,recordKey(scope),record);
      if(!isDeepStrictEqual(saved(scope),record))fail('REVISION_CONFLICT','F11 original calendar child changed');
      return record;
    },
    async invalidateReminder(scope,input,context){
      const {app,plan}=binding(scope);if(!isDeepStrictEqual(input,plan.reminder))fail('UNAUTHORIZED','F11 original reminder changed');
      if(app.runtime.loadCheckpoint(scope.parentTaskId,clearKey(scope))){
        if(!await verifyReminderInvalidated(scope,{reminderId:input.scheduleId}))fail('RESULT_UNKNOWN','F11 original reminder clear changed');
        return;
      }
      const original=unchangedReminder(scope),args={id:input.todoId,expectedRevision:input.revision,clearReminder:true};
      const receipt=await bridge.invoke({actionKey:'f11.reminder.clear',input:args},context);binding(scope);
      if(receipt.toolName!=='todo.update'||!isDeepStrictEqual(receipt.arguments,args)||receipt.result?.reminderTrigger!==null
        ||!clearedItem(original,receipt.result.item))fail('RESULT_UNKNOWN','F11 exact original reminder mutation unavailable');
      const record={taskId:receipt.taskId,runId:receipt.runId,toolVersion:receipt.toolVersion,scopeRef:receipt.scopeRef,arguments:receipt.arguments};
      app.runtime.saveCheckpointOnce(scope.parentTaskId,clearKey(scope),record);
      if(!isDeepStrictEqual(app.runtime.loadCheckpoint(scope.parentTaskId,clearKey(scope)),record)
        ||!await verifyReminderInvalidated(scope,{reminderId:input.scheduleId}))fail('RESULT_UNKNOWN','F11 original reminder cancellation is unconfirmed');
    },
    async verifyOriginalPlan(scope,receipt){const {plan}=binding(scope);return receipt.reminderId===plan.reminder.scheduleId
      &&isDeepStrictEqual(receipt.arguments,plan.update)&&isDeepStrictEqual(saved(scope),{
        taskId:receipt.taskId,runId:receipt.runId,toolVersion:receipt.toolVersion,scopeRef:receipt.scopeRef,arguments:receipt.arguments});},
    verifyUpdatedEvent,
    verifyReminderInvalidated,
    async authorizeExport(scope,result){binding(scope);const allowed=await authorizeExport(scope,result);binding(scope);return allowed===true;},
  };
}
