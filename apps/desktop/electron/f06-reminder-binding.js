import {isDeepStrictEqual} from 'node:util';
import {applyReminderDispatches,reminderScheduleId} from '@personal-agent/productivity';
import {notificationDigest} from '@personal-agent/notifications';

const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.trim().length>0;

/** Prove F06_N04 reads the same-graph N03 confirmed todoId/revision. Never invent reminders. */
export function createVerifyWorkflowReminderBinding({getApplication,now=Date.now}={}) {
  if(typeof getApplication!=='function')throw Error('F06 reminder binding requires the original Runtime application');
  return async({todoId,revision,context,currentItem,reminderRecord,schedule,deliveryRound}={})=>{
    if(!text(todoId)||!Number.isSafeInteger(revision)||revision<1||!plain(context)||!text(context.taskId)
      ||!(context.signal instanceof AbortSignal)||context.signal.aborted)return false;
    const application=getApplication();
    if(!application?.runtime)return false;
    try {
      const parent=application.runtime.loadCheckpoint(context.taskId,'coding-repair:parent');
      if(!plain(parent)||!text(parent.taskId)||!text(parent.operationId))return false;
      const intent=application.runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId);
      const host=application.runtime.loadCheckpoint(context.taskId,'host-tool-intent');
      if(!plain(intent)||intent.workflowId!=='F06'||intent.taskId!==parent.taskId||!text(intent.sessionId)
        ||intent.proposal?.nodeId!=='F06_N04'||intent.proposal.operationId!==parent.operationId
        ||intent.proposal.toolName!=='workflow.host.f06_n04'||!plain(host)||host.commandId!==parent.operationId
        ||host.toolName!=='workflow.host.f06_n04'||!isDeepStrictEqual(host.arguments,intent.proposal.arguments))return false;
      const binding=application.runtime.loadCheckpoint(parent.taskId,'f06:n03-todo:'+intent.sessionId);
      if(!plain(binding)||binding.sessionId!==intent.sessionId||binding.todoId!==todoId
        ||binding.revision!==revision||!text(binding.operationId))return false;
      if(!currentItem||currentItem.revision===revision)return true;
      // Only the existing scheduler's single automatic dispatch may advance the original revision.
      // User edits, cancellation, rescheduling and unknown device delivery remain conflicts.
      const original=binding.item,id=binding.reminderScheduleId,updatedAt=Date.parse(currentItem.updatedAt);
      if(!original||original.revision!==revision||original.status!=='open'||original.reminder?.state!=='scheduled'
        ||id!==reminderScheduleId(todoId,original.reminder.remindAt.utc)||currentItem.revision!==revision+1
        ||!Number.isFinite(updatedAt)||updatedAt<Date.parse(original.updatedAt)||updatedAt>now()
        ||Date.parse(original.reminder.remindAt.utc)>now())return false;
      const [expected]=applyReminderDispatches([original],[{scheduleId:id,status:'fired'}],()=>updatedAt);
      if(!isDeepStrictEqual(currentItem,expected)||schedule?.scheduleId!==id||schedule.status!=='fired'
        ||schedule.runAt!==original.reminder.remindAt.utc||!text(schedule.taskId)
        ||application.runtime.getTask(schedule.taskId).state!=='succeeded'
        ||reminderRecord?.notificationId!==id||reminderRecord.taskId!==schedule.taskId
        ||reminderRecord.state!=='visible'||!text(reminderRecord.batchId)||reminderRecord.presentationAttempted!==true
        ||deliveryRound?.roundId!=='desktop-batch-'+notificationDigest(reminderRecord.batchId)
        ||!deliveryRound.batchIds?.includes(reminderRecord.batchId)||!deliveryRound.itemIds?.includes(id)
        ||deliveryRound.attempts?.banner?.state!=='delivered'||!deliveryRound.attempts.banner.evidenceRefs?.length)return false;
      return {delivered:true,revision:currentItem.revision};
    }catch{return false;}
  };
}
