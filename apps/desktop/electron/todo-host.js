import {randomUUID} from 'node:crypto';
import * as productivity from '@personal-agent/productivity';
import * as notifications from '@personal-agent/notifications';
import {createEncryptedModuleStorage} from './encrypted-module-storage.js';

/** Compose existing MOD-20/23 implementations. No business rules or task loop here. */
export function createDesktopTodoHost({userData,safeStorage,namespace,createDeliveryHost,notificationHost,
  now=Date.now,onUpdate=()=>{},onNotification=()=>{}}) {
  const storage=createEncryptedModuleStorage({userData,safeStorage,filename:'productivity-state.json'});
  const conversationId=`desktop-todo-reminders:${namespace}`;
  const service=new productivity.TodoService(storage,{now,idFactory:randomUUID});
  const savedPolicy=storage.get('desktop-notification-policy') ?? {};
  notifications.assertPolicyValid(savedPolicy);
  const policy={...savedPolicy};
  const notificationScope={kind:'connector',connectorId:'productivity'};
  notificationHost?.restoreLegacySettings(policy);
  let notificationService=notificationHost ?? new notifications.NotificationService(storage,policy,{now,idFactory:randomUUID});
  let application,delivery,allowed=false,active=true,generation=randomUUID(),failure='',lastTick=-Infinity,busy=false;
  const implementations=[],releases=[];
  const toolHost={register(tool){implementations.push(tool);return ()=>{};}};
  releases.push(productivity.register(toolHost,{storage,conversationId,now,idFactory:randomUUID}));
  let releaseNotifications;
  function registerNotifications() {
    releaseNotifications?.();
    const index=implementations.findIndex(tool=>tool.descriptor.name==='notifications.status');
    if(index>=0) implementations.splice(index,1);
    // notifications.events 只读工具暂由 fallback 提供；notificationHost 路径暴露 events 属下一增量。
    const eventsIndex=implementations.findIndex(tool=>tool.descriptor.name==='notifications.events');
    if(eventsIndex>=0) implementations.splice(eventsIndex,1);
    if (notificationHost) {
      releaseNotifications=toolHost.register({descriptor:{name:'notifications.status',version:notifications.NOTIFICATIONS_MODULE_VERSION,
        inputSchema:{type:'object',additionalProperties:false,properties:{}},outputSchema:{type:'object'},
        sideEffect:'read',requiredScopes:['notifications:read'],idempotencySupport:true,recoverySupport:true,requiresPresence:false},
        async execute(){return notificationHost.status(notificationScope);}});
    } else releaseNotifications=notifications.register(toolHost,{storage,policy,now,idFactory:randomUUID});
  }
  registerNotifications();
  const current=()=>active && allowed && Boolean(application);
  function bound(taskId,claim=false) {
    if (!application || !taskId) return false;
    const key='desktop-todo-cloud-scope';
    if(claim && application.runtime.loadCheckpoint(taskId,key)===undefined) application.runtime.saveCheckpoint(taskId,key,generation);
    return application.runtime.loadCheckpoint(taskId,key)===generation;
  }
  const records=()=>storage.get('desktop-reminder-records') ?? {};
  function enqueue(schedule) {
    const known=records(); if(known[schedule.scheduleId]) return;
    known[schedule.scheduleId]={notificationId:schedule.scheduleId,taskId:schedule.taskId,
      summary:schedule.goal,occurredAt:new Date(now()).toISOString(),state:'queued'};
    storage.set('desktop-reminder-records',known);
  }
  async function drain() {
    let known=records();
    // This queue is the durable receipt. Re-ingestion is safe across a crash
    // before NotificationService persisted its batch.
    notificationService.ingest(Object.values(known).filter(item=>item.state==='queued').map(item=>({
      source:'productivity',accountRef:'local',externalId:item.notificationId,
      occurredAt:item.occurredAt,fetchedAt:item.occurredAt,contentRef:item.notificationId,
      sensitivity:'private',dedupeKey:item.notificationId,
    })),{scope:{kind:'connector',connectorId:'productivity'}});
    for (const batch of notificationService.drain().batches) {
      known=records();let changed=false;
      if (notificationHost && !batch.itemRefs.every(id=>known[id])) continue;
      for(const id of batch.itemRefs) if(known[id]?.state==='queued') {known[id].state='visible';known[id].batchId=batch.id;changed=true;}
      if(changed) storage.set('desktop-reminder-records',known);
      // Ack means durably available in the local UI inbox, not seen by a user.
      if (!notificationHost) notificationService.acknowledge(batch.id);
    }
    known=records();
    for(const item of Object.values(known)) if(item.state==='visible' && !item.presentationAttempted) {
      if (notificationHost) {
        const items=Object.values(known).filter(value=>value.state==='visible' && value.batchId===item.batchId && !value.presentationAttempted);
        for(const value of items)value.presentationAttempted=true;
        storage.set('desktop-reminder-records',known);
        try {await onNotification({batchId:item.batchId,items:structuredClone(items),summary:items.map(value=>value.summary).join('\n')});} catch {}
        continue;
      }
      // Native toast delivery is best-effort; persist before showing to avoid
      // duplicates on restart. The durable in-app inbox is never discarded.
      item.presentationAttempted=true;storage.set('desktop-reminder-records',known);
      try {onNotification(structuredClone(item));} catch { /* Inbox remains available. */ }
    }
  }
  const snapshot=()=>({available:Boolean(application),sessionAllowed:allowed,
    items:service.list(),notifications:Object.values(records()).filter(item=>item.state==='visible'),
    notificationStatus:notificationService.status(notificationScope),policy:notificationHost?.legacySettingsSnapshot()?.policy??structuredClone(policy),
    reason:failure || (current()?'已允许本会话在对话中管理待办；提醒在本机持久保存':'允许本会话后，可在主对话管理待办；已保存的提醒继续在本机运行')});
  async function tick(force=false) {
    if(!active || !delivery || busy || (!force && now()-lastTick<1000)) return;
    busy=true;lastTick=now();
    try {
      await delivery.tick(productivity.reminderTriggers(service.list(),conversationId));
      await drain();
      const dispatches=application.runtime.listSchedules(conversationId).filter(schedule=>
        schedule.status==='skipped' || (schedule.status==='fired' && Boolean(records()[schedule.scheduleId])))
        .map(schedule=>({scheduleId:schedule.scheduleId,status:schedule.status}));
      for(const item of productivity.applyReminderDispatches(service.list(),dispatches,now)) service.save(item);
      const unconfirmed=application.runtime.listSchedules(conversationId).some(schedule=>schedule.status==='fired'
        && !records()[schedule.scheduleId] && schedule.taskId
        && ['failed','waiting_reconciliation'].includes(application.runtime.getTask(schedule.taskId).state));
      failure=unconfirmed?'有提醒未确认进入通知队列，请在任务记录中核查；系统不会盲目重试':'';
    } catch {failure='待办提醒暂未同步成功，已保存的数据保留；请检查本机存储和 Runtime';}
    finally {busy=false;onUpdate();}
  }
  const tools=implementations.map(tool=>({descriptor:tool.descriptor,async execute(input,context){
    if(context.signal.aborted || !current() || !bound(context.taskId)) throw Error('待办会话许可已失效');
    const executing=implementations.find(item=>item.descriptor.name===tool.descriptor.name
      && item.descriptor.version===tool.descriptor.version);
    if(!executing) throw Error('待办工具当前实例不可用');
    const result=await executing.execute(input,context);
    // The module mutation is the authoritative receipt; schedule sync failure
    // must not turn a persisted todo.create into a retryable creation.
    await tick(true);return result;
  }}));
  const revoke=()=>{allowed=false;generation=randomUUID();return snapshot();};
  return {
    tools,snapshot,tick,
    bindApplication(value) {application=value;delivery=createDeliveryHost({runtime:value.runtime,conversationId,
      enqueue,readReceipt:id=>Boolean(records()[id]),now});},
    authorize(input) {
      if(!application || !active || input?.readAndCloudConsent!==true || Object.keys(input).length!==1) throw Error('请确认待办内容用于云端管理');
      revoke();allowed=true;return snapshot();
    },
    revoke,
    async configureNotifications(input) {
      if(!input || typeof input!=='object' || Array.isArray(input)
        || Object.keys(input).some(key=>!['quietHours','pauseUntilUtc','digest'].includes(key))) throw Error('通知设置无效');
      notifications.assertPolicyValid(input);const next=structuredClone(input);
      if (notificationHost) {
        const result=await notificationHost.configureLegacySettings(next);
        if(result.state!=='confirmed')throw Error('原通知设置结果待核实，请读取任务 '+result.taskId+'；不会重新提交');
      }
      storage.set('desktop-notification-policy',next);
      for(const key of Object.keys(policy)) delete policy[key];Object.assign(policy,next);
      if (!notificationHost) notificationService=new notifications.NotificationService(storage,policy,{now,idFactory:randomUUID});
      registerNotifications();
      lastTick=-Infinity;return snapshot();
    },
    dismiss(input) {
      if(!input || Object.keys(input).length!==1 || typeof input.id!=='string') throw Error('通知标识无效');
      const known=records();if(!known[input.id]) throw Error('通知不存在');
      if (notificationHost) notificationHost.acknowledgeRead({operationId:'todo-read-'+input.id,itemIds:[input.id]});
      known[input.id].state='dismissed';storage.set('desktop-reminder-records',known);return snapshot();
    },
    async create(input) {
      if(!active) throw Error('待办服务未就绪');
      if(!input || typeof input.title!=='string' || !input.title.trim()) throw Error('待办标题不能为空');
      const createInput = {title: input.title.trim()};
      if (input.notes) createInput.notes = input.notes;
      if (input.dueUtc) createInput.due = {kind: 'instant', utc: input.dueUtc};
      if (input.remindUtc) createInput.reminder = {remindAt: {kind: 'instant', utc: input.remindUtc}, missedPolicy: input.missedPolicy ?? 'run_once'};
      service.create(createInput);
      await tick(true);
      return snapshot();
    },
    async update(input) {
      if(!active || !input || typeof input.id!=='string') throw Error('待办标识无效');
      const updateInput = {};
      if (input.title) updateInput.title = input.title.trim();
      if (input.notes !== undefined) updateInput.notes = input.notes;
      if (input.status && ['open','done','cancelled'].includes(input.status)) updateInput.status = input.status;
      service.update(input.id, updateInput);
      await tick(true);
      return snapshot();
    },
    get competitionToolAvailability(){return tools.map(tool=>({toolName:tool.descriptor.name,
      toolVersion:tool.descriptor.version,
      publicEnumPaths:tool.descriptor.name==='todo.list'?['/status']:tool.descriptor.name==='todo.update'?['/status','/missedPolicy']:tool.descriptor.name==='todo.create'?['/missedPolicy']:[],
      available:({taskId,signal})=>!signal.aborted && current() && bound(taskId,true)}));},
    get competitionToolExports(){return tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      exportPolicyVersion:'authorized-todo-session-v1',accepts:({taskId})=>current() && bound(taskId),
      project:({taskId,result,signal})=>{
        if(signal.aborted || !current() || !bound(taskId)) throw Error('待办云端许可已撤销');
        if(Buffer.byteLength(JSON.stringify(result),'utf8')>960*1024) throw Error('待办结果过大，请按状态缩小查询范围');
        return structuredClone(result);
      }}));},
    async close(){active=false;revoke();await delivery?.close();releaseNotifications?.();for(const release of releases) release();},
  };
}
