import {createHash,randomUUID} from 'node:crypto';
import * as productivity from '@personal-agent/productivity';
import * as notifications from '@personal-agent/notifications';
import {createEncryptedModuleStorage} from './encrypted-module-storage.js';

/** Compose existing MOD-20/23 implementations. No business rules or task loop here. */
export function createDesktopTodoHost({userData,safeStorage,namespace,createDeliveryHost,notificationHost,question,
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
  const questionReady=()=>active&&Boolean(application)&&['prepare','prepareExport','currentRequirement','authorizeExport',
    'readResourceGeneration','rotateResourceGeneration'].every(name=>typeof question?.[name]==='function');
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const resource=hash({namespace,kind:'desktop-todo',version:1}),prepared=new Map();
  const preparationKey=scope=>JSON.stringify([scope.taskId,scope.proposalId??scope.proposal?.proposalId]);
  function original(scope) {
    const entry=prepared.get(preparationKey(scope));
    if(!entry||!questionReady()||scope.signal?.aborted||entry.generation!==generation
      ||Date.parse(entry.scope.deadline)<=now()||!bound(scope.taskId)
      ||question.readResourceGeneration(resource)!==entry.resourceGeneration)throw Error('待办本次授权已失效');
    return entry;
  }
  function assertAccess(context,input,tool) {
    if(context.signal.aborted||!bound(context.taskId))throw Error('待办会话许可已失效');
    if(question){
      const entry=[...prepared.values()].find(value=>value.scope.taskId===context.taskId&&value.scope.runId===context.runId);
      if(!entry||entry.toolName!==tool.descriptor.name||entry.argumentsDigest!==hash(input))throw Error('待办操作与原授权参数不匹配');
      const checked=original({...entry.scope,signal:context.signal});
      question.currentRequirement({...checked.scope,...context},'todo-session');
    }else if(!current())throw Error('待办会话许可已失效');
  }
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
    reason:failure || (questionReady()?'在主对话发起待办操作；需要的访问与出机范围在该次提问卡确认，提醒继续在本机保存':current()?'已有受限会话许可；提醒在本机持久保存':'对话操作尚未取得许可；已保存的提醒继续在本机运行')});
  let publishedState;
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
    finally {
      busy=false;
      // Polling the scheduler is necessary; rebroadcasting an unchanged UI snapshot is not.
      const state=JSON.stringify(snapshot());
      if(state!==publishedState){publishedState=state;onUpdate();}
    }
  }
  const tools=implementations.map(tool=>({descriptor:tool.descriptor,async execute(input,context){
    assertAccess(context,input,tool);
    const executing=implementations.find(item=>item.descriptor.name===tool.descriptor.name
      && item.descriptor.version===tool.descriptor.version);
    if(!executing) throw Error('待办工具当前实例不可用');
    const result=await executing.execute(input,context);
    // The module mutation is the authoritative receipt; schedule sync failure
    // must not turn a persisted todo.create into a retryable creation.
    await tick(true);return result;
  }}));
  const revoke=()=>{allowed=false;generation=randomUUID();prepared.clear();
    if(question){const previous=question.readResourceGeneration(resource);question.rotateResourceGeneration(resource,previous);}
    return snapshot();};
  return {
    tools,snapshot,tick,
    prepareExport(scope) {
      const tool=tools.find(item=>item.descriptor.name===scope.proposal?.toolName&&item.descriptor.version===scope.proposal?.toolVersion);
      if(!tool||!question)return;
      if(scope.phase!=='preflight'){original(scope);return;}
      if(!questionReady()||!scope.runId||scope.signal.aborted||Date.parse(scope.deadline)<=now()||!bound(scope.taskId,true))throw Error('待办授权提问通路不可用');
      for(const [key,value]of prepared)if(Date.parse(value.scope.deadline)<=now())prepared.delete(key);
      const resourceGeneration=question.readResourceGeneration(resource),entry={scope:{taskId:scope.taskId,runId:scope.runId,
        proposalId:scope.proposal.proposalId,toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
        deadline:scope.deadline,signal:scope.signal},toolName:tool.descriptor.name,
        argumentsDigest:hash(scope.proposal.arguments),generation,resourceGeneration};
      const key=preparationKey(scope),previous=prepared.get(key);
      if(previous&&hash({...previous,scope:{...previous.scope,signal:undefined}})!==hash({...entry,scope:{...entry.scope,signal:undefined}}))throw Error('待办原操作绑定已改变');
      prepared.set(key,entry);
      const ruleBindingDigest=hash({resource,resourceGeneration,toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
        projection:tool.descriptor.outputSchema});
      question.prepare(entry.scope,{requirements:[{requirementId:'todo-session',kind:'connector_session',scopes:tool.descriptor.requiredScopes,
        bindingDigest:hash({resource,resourceGeneration,generation,taskId:scope.taskId,runId:scope.runId,argumentsDigest:entry.argumentsDigest,deadline:scope.deadline}),
        ruleBindingDigest,summary:'仅访问本任务待办工具所列范围；不会开启其他任务的会话许可'}],
        assertCurrent:()=>{try{original(scope);return true;}catch{return false;}}});
      question.prepareExport(entry.scope,{requirementId:'todo-export',summary:'将本次待办工具声明字段的结果发送到本任务选定的 AgentArts 模型（最多 960 KiB）',
        bindingDigest:hash({ruleBindingDigest,taskId:scope.taskId,runId:scope.runId,argumentsDigest:entry.argumentsDigest}),
        ruleBindingDigest:hash({ruleBindingDigest,kind:'export'})});
    },
    // Environment guidance must not enumerate private todos or mint task leases.
    readConversationGuidance:()=>({registered:active && Boolean(application),
      availability:!active||!application?'unavailable':!question&&current()?'ready':'consent_required',
      reasonCode:!active||!application?'TODO_RUNTIME_UNAVAILABLE':!question&&current()?'TODO_TASK_CATALOG_REQUIRED':'TODO_CONSENT_REQUIRED'}),
    bindApplication(value) {application=value;delivery=createDeliveryHost({runtime:value.runtime,conversationId,
      enqueue,readReceipt:id=>Boolean(records()[id]),now});},
    authorize(input) {
      if(question)throw Error('请在当前对话提问卡授权此操作');
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
      // Legacy visible reminders have no new batch/feed identity. Closing the
      // original local inbox entry must not invent delivery or replay a toast.
      if (notificationHost && known[input.id].batchId) notificationHost.acknowledgeRead({operationId:'todo-read-'+input.id,itemIds:[input.id]});
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
      available:({taskId,signal})=>!signal.aborted && (question?questionReady():current()) && bound(taskId,true)}));},
    get competitionToolExports(){return tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      exportPolicyVersion:question?'question-todo-bounded-v2':'authorized-todo-session-v1',accepts:scope=>{
        if(!question)return current()&&bound(scope.taskId);
        try{const entry=original(scope);if(entry.argumentsDigest!==hash(scope.arguments))return false;
          if(scope.phase==='final'){
            if(!entry.projectionDigest||entry.projectionDigest!==hash(scope.projection))return false;
            question.currentRequirement({...entry.scope,signal:scope.signal??entry.scope.signal},'todo-export');
          }
          return true;}catch{return false;}
      },
      project:scope=>{
        const {taskId,result,signal}=scope;
        if(question){const entry=original(scope);question.currentRequirement({...entry.scope,signal},'todo-session');
          question.authorizeExport({...entry.scope,signal},result,'todo-export');entry.projectionDigest=hash(result);}
        else if(signal.aborted || !current() || !bound(taskId)) throw Error('待办云端许可已撤销');
        if(Buffer.byteLength(JSON.stringify(result),'utf8')>960*1024) throw Error('待办结果过大，请按状态缩小查询范围');
        return structuredClone(result);
      }}));},
    async close(){active=false;allowed=false;generation=randomUUID();prepared.clear();await delivery?.close();releaseNotifications?.();for(const release of releases) release();},
  };
}
