import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

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
  const verifyUpdatedEvent=async(scope,receipt)=>{
    const {app,plan}=binding(scope),original=saved(scope);
    if(!original||!isDeepStrictEqual(original.arguments,plan.update)||original.taskId!==receipt.taskId||original.runId!==receipt.runId)return false;
    const read=app.readHostToolTask(original.taskId),item=read.confirmed?.result?.item;
    return read.task.state==='succeeded'&&read.toolName==='calendar.update'&&read.confirmed?.runId===original.runId
      &&read.confirmed.result.state==='updated'&&item?.source==='calendar'
      &&item.externalId===(plan.update.externalId??plan.update.uid)
      &&(!plan.update.startUtc||item.validFor?.split('/')[0]===plan.update.startUtc)
      &&(!plan.update.endUtc||item.validFor?.split('/')[1]===plan.update.endUtc);
  };
  return {
    assertCurrent:scope=>{binding(scope);},
    async verifyPlan(scope,input){
      const {plan}=binding(scope);if(!isDeepStrictEqual(input,{update:plan.update,reminder:plan.reminder}))return false;
      // Recovery after a confirmed first child uses its original receipt, never repeats the calendar write.
      if(saved(scope))return true;
      const todo=todoHost.snapshot().items.find(item=>item.id===plan.reminder.todoId);
      return todo?.revision===plan.reminder.revision&&todo.status==='open'&&todo.reminder?.state==='scheduled'
        &&plan.reminder.scheduleId==='todo-reminder:'+todo.id+':'+todo.reminder.remindAt.utc;
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
      const {plan}=binding(scope);if(!isDeepStrictEqual(input,plan.reminder))fail('UNAUTHORIZED','F11 original reminder changed');
      const receipt=await bridge.invoke({actionKey:'f11.reminder.clear',input:{id:input.todoId,clearReminder:true}},context);binding(scope);
      if(receipt.toolName!=='todo.update'||!isDeepStrictEqual(receipt.arguments,{id:input.todoId,clearReminder:true})
        ||receipt.result?.item?.id!==input.todoId||receipt.result.item.reminder!==undefined
        ||receipt.result.item.revision<=input.revision)fail('RESULT_UNKNOWN','F11 original reminder mutation unavailable');
    },
    async verifyOriginalPlan(scope,receipt){const {plan}=binding(scope);return receipt.reminderId===plan.reminder.scheduleId
      &&isDeepStrictEqual(receipt.arguments,plan.update)&&isDeepStrictEqual(saved(scope),{
        taskId:receipt.taskId,runId:receipt.runId,toolVersion:receipt.toolVersion,scopeRef:receipt.scopeRef,arguments:receipt.arguments});},
    verifyUpdatedEvent,
    async verifyReminderInvalidated(scope,receipt){
      const {app,plan}=binding(scope),todo=todoHost.snapshot().items.find(item=>item.id===plan.reminder.todoId);
      const schedule=app.runtime.listSchedules(plan.reminder.conversationId).find(item=>item.scheduleId===receipt.reminderId);
      return !!todo&&todo.reminder===undefined&&todo.revision>plan.reminder.revision&&schedule?.status==='cancelled';
    },
    async authorizeExport(scope,result){binding(scope);const allowed=await authorizeExport(scope,result);binding(scope);return allowed===true;},
  };
}
