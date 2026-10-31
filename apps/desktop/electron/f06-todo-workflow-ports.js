import {isDeepStrictEqual} from 'node:util';
import {notificationDigest} from '@personal-agent/notifications';
import {ProtocolError} from '@personal-agent/contracts';

const fail=(code,message)=>{throw new ProtocolError(code,message);};
const fields=input=>({todoTitle:input.todoTitle,...(input.due!==undefined?{due:input.due}:{}),
  ...(input.remindUtc!==undefined?{remindUtc:input.remindUtc}:{})});

/** Concrete business ports. The bridge creates a separately authorized todo.create child;
 * existing reminder scheduling and Desktop delivery retain ownership of their durable records. */
export function createF06TodoWorkflowPorts({getApplication,bridge,todoHost,notificationHost,authorizeExport,now=Date.now}={}) {
  if(typeof getApplication!=='function'||typeof bridge?.invoke!=='function'||typeof todoHost?.snapshot!=='function'
    ||typeof notificationHost?.reconcileDelivery!=='function'||typeof authorizeExport!=='function')
    throw Error('F06 requires Runtime, child Policy bridge, Todo and durable notification hosts');
  const binding=scope=>{
    if(scope.signal.aborted||Date.parse(scope.deadline)<=now())fail('CANCELLED','F06 operation is no longer active');
    const app=getApplication(),bound=app.readConfiguredWorkflowBinding({taskId:scope.parentTaskId,workflowId:'F06',
      sessionId:scope.sessionId,signal:scope.signal});
    if(!bound||bound.deadline!==scope.deadline)fail('UNAUTHORIZED','F06 original workflow binding unavailable');
    return {app,bound};
  };
  const reminder=(scope,notification)=>{
    const {app,bound}=binding(scope),saved=app.runtime.loadCheckpoint(scope.parentTaskId,'f06:n03-todo:'+scope.sessionId);
    if(!saved?.reminderScheduleId||saved.sessionId!==scope.sessionId
      ||!isDeepStrictEqual(notification,{todoId:saved.todoId,revision:saved.revision})
      ||!bound.confirmedOperations.some(op=>op.nodeId==='F06_N04'&&op.result?.shouldFireAlarm===true
        &&op.result?.isTaskAlreadyFinished===false))fail('UNAUTHORIZED','F06 reminder lacks its original ready receipt');
    const snapshot=todoHost.snapshot(),item=snapshot.items.find(value=>value.id===saved.todoId);
    if(!item||item.status!=='open'||!item.reminder||item.reminder.remindAt.utc!==bound.input.remindUtc)
      fail('REVISION_CONFLICT','F06 original todo reminder changed');
    const entry=snapshot.notifications.find(value=>value.notificationId===saved.reminderScheduleId);
    if(!entry?.batchId)fail('RESULT_UNKNOWN','F06 reminder has no durable notification batch');
    const roundId='desktop-batch-'+notificationDigest(entry.batchId);
    const round=notificationHost.runtimeHost.getInterruptionRound(roundId);
    if(!round||!round.batchIds.includes(entry.batchId)||!round.itemIds.includes(saved.reminderScheduleId))
      fail('RESULT_UNKNOWN','F06 original notification round unavailable');
    return {roundId,round};
  };
  return {
    assertCurrent:scope=>{binding(scope);},
    async verifyWriteBinding(scope,input){return isDeepStrictEqual(fields(binding(scope).bound.input),input);},
    async invokeTodoCreate(scope,input,context){
      const original=fields(binding(scope).bound.input),expected={title:original.todoTitle,
        ...(original.due!==undefined?{dueUtc:original.due}:{}),...(original.remindUtc!==undefined?{remindUtc:original.remindUtc}:{})};
      if(!isDeepStrictEqual(input,expected))fail('UNAUTHORIZED','F06 todo child arguments changed');
      const receipt=await bridge.invoke({actionKey:'f06.todo.create',input:structuredClone(input)},context);
      binding(scope);
      if(receipt.toolName!=='todo.create'||!isDeepStrictEqual(receipt.arguments,input))fail('UNAUTHORIZED','F06 child receipt changed');
      return receipt.result;
    },
    async verifyReminderReady(scope,{notification}){reminder(scope,notification);return true;},
    async deliverNotification(scope,{notification}){
      const {roundId}=reminder(scope,notification);
      // Reconcile the original attempt only. A missing/unknown device receipt is never a resend request.
      notificationHost.reconcileDelivery(roundId);
      const {round}=reminder(scope,notification),attempt=round.attempts.banner;
      if(!attempt||attempt.state==='sending'||attempt.state==='unknown')fail('RESULT_UNKNOWN','F06 original delivery requires reconciliation');
      return {delivered:attempt.state==='delivered'&&attempt.evidenceRefs.length>0};
    },
    async authorizeExport(scope,result){binding(scope);const allowed=await authorizeExport(scope,result);binding(scope);return allowed===true;},
  };
}
