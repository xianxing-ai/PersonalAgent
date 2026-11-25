import {ProtocolError} from '@personal-agent/contracts';
import {reminderScheduleId} from '@personal-agent/productivity';

const fail=(code,message)=>{throw new ProtocolError(code,message);};
/** Original Runtime notification storage only: no channel, policy grant or delivery claim. */
export function createCloudRuntimeNotifications({application,assertCurrent,now=Date.now}) {
  const runtimeHost=application.createNotificationHost({policy:{},settingsScopes:['notifications:settings'],
    verifyUserCommand:()=>false,now});
  function scope(binding) {
    assertCurrent();
    if(!binding||['taskId','sourceTaskId','sessionId'].some(key=>typeof binding[key]!=='string'||!binding[key].trim())
      ||!Number.isFinite(Date.parse(binding.taskDeadline)))fail('INVALID_ARGUMENT','Original cloud notification binding required');
    application.runtime.getTask(binding.taskId);application.runtime.getTask(binding.sourceTaskId);
    return {kind:'responsibility',responsibilityId:binding.taskId};
  }
  function current(binding) {
    const result=scope(binding),task=application.runtime.getTask(binding.taskId),source=application.runtime.getTask(binding.sourceTaskId);
    if(task.cancelRequested||source.cancelRequested||Date.parse(binding.taskDeadline)<=now())
      fail('UNAUTHORIZED','Original cloud notification responsibility expired or stopped');
    return result;
  }
  const feed=binding=>{const own=scope(binding);return runtimeHost.notificationFeed().items.filter(item=>
    item.scope.kind==='responsibility'&&item.scope.responsibilityId===own.responsibilityId);};
  return {runtimeHost,
    snapshot(binding) {
      const items=feed(binding).slice(-100),ids=new Set(items.map(item=>item.id));
      const scopes=[...new Map(items.map(item=>[JSON.stringify(item.scope),item.scope])).values()];
      const digest=trigger=>scopes.flatMap(scope=>runtimeHost.getDigest({trigger,scope}).items).filter(item=>ids.has(item.id)).map(item=>item.id);
      return {items:items.map(({id,source,contentRef,occurredAt,receivedAt,readAt})=>
        ({id,source,contentRef,occurredAt,receivedAt,...(readAt?{readAt}:{})})),
      unreadItemIds:digest('on_demand'),returnItemIds:digest('on_return'),interruptionCount:0,delivery:'waiting_device'};
    },
    enqueueReminder(binding,schedule,item) {
      const boundScope=current(binding),runtime=application.runtime;
      const original=runtime.listSchedules(schedule?.conversationId).find(value=>value.scheduleId===schedule?.scheduleId);
      if(!original||original.status!=='fired'||!original.taskId||original.taskId!==schedule.taskId||original.runAt!==schedule.runAt
        ||item?.status!=='open'||item.reminder?.state!=='scheduled'||original.runAt!==item.reminder.remindAt.utc
        ||original.scheduleId!==reminderScheduleId(item.id,item.reminder.remindAt.utc)
        ||runtime.getTask(original.taskId).cancelRequested||runtime.getTask(original.taskId).state!=='running')
        fail('UNAUTHORIZED','Only the original fired reminder may enter the cloud notification feed');
      const receivedAt=new Date(now()).toISOString();
      return runtimeHost.ingest([{source:'todo',accountRef:binding.taskId,externalId:item.id,occurredAt:original.runAt,
        fetchedAt:receivedAt,contentRef:'todo:'+item.id,sensitivity:'normal',dedupeKey:original.scheduleId}],
      {scope:{...boundScope,connectorId:'todo'},validUntilUtc:binding.taskDeadline});
    },
    hasReminder(binding,scheduleId) {return feed(binding).some(item=>item.id===scheduleId);},
    acknowledgeRead(binding,input) {
      current(binding);const entries=feed(binding);
      if(!Array.isArray(input?.itemIds)||!input.itemIds.length||input.itemIds.some(id=>
        !entries.some(item=>item.id===id&&item.validity==='active')))
        fail('UNAUTHORIZED','Only current notifications of the original responsibility may be read');
      return runtimeHost.acknowledgeRead(input);
    },
  };
}
