import {createHash,randomUUID} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {register,TodoService,reminderTriggers,reminderScheduleId,applyReminderDispatches} from '@personal-agent/productivity';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createReminderDeliveryHost,readPersistedRuntimeProactiveWorkflow} from '@personal-agent/runtime/application';

const KEY='cloud-reminder-operations-v1',ORIGIN='cloud-reminder-child-v1';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(code,message)=>{throw new ProtocolError(code,message);};
/** Cloud-owned todos use the original product store, Policy tasks and reminder Scheduler. */
export function createCloudRuntimeReminders({getApplication,getNotifications,namespace,assertCurrent,now=Date.now}) {
  let workflow;const products=new Map(),deliveries=new Map();
  const app=()=>{assertCurrent();const value=getApplication();if(!value?.runtime)fail('UNSUPPORTED_CAPABILITY','Original cloud Runtime unavailable');return value;};
  const saved=binding=>app().runtime.loadCheckpoint(binding.taskId,KEY)??{version:1,operations:[]};
  const save=(binding,state)=>app().runtime.saveCheckpoint(binding.taskId,KEY,state);
  const conversation=binding=>'cloud-todo-reminders:'+hash([namespace,binding.taskId]);
  function originalProducts(binding) {
    let value=products.get(binding.taskId);if(value)return value;
    const storage=app().runtime.bindTrustedHostState('cloud-productivity:'+hash([namespace,binding.taskId]));
    const tools=[];register({register(tool){tools.push(tool);return ()=>{};}},{storage,conversationId:conversation(binding),now,idFactory:randomUUID});
    value={tools,service:new TodoService(storage,{now,idFactory:randomUUID})};products.set(binding.taskId,value);return value;
  }
  function active(binding) {
    const runtime=app().runtime,task=runtime.getTask(binding.taskId),source=runtime.getTask(binding.sourceTaskId);
    if(task.cancelRequested||source.cancelRequested||['succeeded','failed','cancelled','cancelling'].includes(task.state)
      ||createHash('sha256').update(source.goal??'').digest('hex')!==binding.goalDigest||Date.parse(binding.taskDeadline)<=now()
      ||runtime.loadCheckpoint(binding.sourceTaskId,'private-copy-erasure')!==undefined
      ||runtime.loadCheckpoint(binding.sourceTaskId,'private-copy-erasure-binding')!==undefined)
      fail('UNAUTHORIZED','Original cloud reminder responsibility is unavailable');
    const state=readPersistedRuntimeProactiveWorkflow(runtime,binding.taskId,binding.sessionId)?.application.state;
    const control=Object.values(state?.commands??{}).sort((a,b)=>b.revision-a.revision)[0]?.command.action;
    if(['pause','cancel'].includes(state?.pendingControl?.action??control))fail('UNAUTHORIZED','Original cloud responsibility is paused or cancelled');
  }
  function origin(binding,taskId) {
    const runtime=app().runtime,operation=saved(binding).operations.find(value=>value.taskId===taskId),entry=runtime.loadCheckpoint(taskId,ORIGIN);
    const intent=runtime.loadCheckpoint(taskId,'host-tool-intent');
    if(!operation||entry?.parentTaskId!==binding.taskId||entry.commandId!==operation.commandId||entry.argumentsDigest!==toolArgumentsDigest(operation.arguments)
      ||entry.toolName!==operation.toolName||runtime.findTaskByIdempotencyKey('host-tool:'+JSON.stringify([namespace,operation.commandId]))?.taskId!==taskId
      ||intent&&(intent.commandId!==operation.commandId||intent.toolName!==operation.toolName||intent.argumentsDigest!==entry.argumentsDigest))
      fail('UNAUTHORIZED','Reminder child is not the original cloud operation');
    return operation;
  }
  // Registration supplies the public descriptors; each execution below selects its fixed original task store.
  const definitions=[];
  register({register(tool){definitions.push(tool);return ()=>{};}},{conversationId:'cloud-todo-reminders:'+namespace,now,idFactory:randomUUID,
    storage:{get(){fail('UNAUTHORIZED','A bound reminder task is required');},set(){fail('UNAUTHORIZED','A bound reminder task is required');},delete(){fail('UNAUTHORIZED','A bound reminder task is required');}}});
  const tools=definitions.filter(tool=>['todo.create','todo.update'].includes(tool.descriptor.name)).map(tool=>({...tool,execute:async(input,context)=>{
    const runtime=app().runtime,entry=runtime.loadCheckpoint(context.taskId,ORIGIN);
    if(!entry||!workflow)fail('UNAUTHORIZED','Original cloud reminder binding unavailable');
    const binding=workflow.readBinding(entry.parentTaskId);active(binding);const operation=origin(binding,context.taskId);
    if(operation.toolName!==tool.descriptor.name||toolArgumentsDigest(input)!==entry.argumentsDigest)
      fail('SCOPE_DENIED','Original reminder arguments changed');
    const epoch=runtime.readExecutionEpoch(binding.taskId),result=await originalProducts(binding).tools.find(value=>value.descriptor.name===tool.descriptor.name).execute(input,context);
    runtime.assertExecutionEpoch(binding.taskId,epoch);active(binding);return result;
  }}));
  function prepare(binding,operation) {
    const application=app(),runtime=application.runtime;
    let task=operation.taskId?runtime.getTask(operation.taskId):runtime.findTaskByIdempotencyKey('host-tool:'+JSON.stringify([namespace,operation.commandId]));
    task??=application.prepareHostToolTask({commandId:operation.commandId,toolName:operation.toolName,
      toolVersion:tools.find(value=>value.descriptor.name===operation.toolName).descriptor.version,deadline:binding.taskDeadline});
    const expected={parentTaskId:binding.taskId,commandId:operation.commandId,toolName:operation.toolName,argumentsDigest:toolArgumentsDigest(operation.arguments)};
    runtime.saveCheckpointOnce(task.taskId,ORIGIN,expected);
    if(hash(runtime.loadCheckpoint(task.taskId,ORIGIN))!==hash(expected))fail('REVISION_CONFLICT','Original reminder operation changed');
    if(!operation.taskId){const state=saved(binding),current=state.operations.find(value=>value.commandId===operation.commandId);
      current.taskId=task.taskId;save(binding,state);operation=current;}
    origin(binding,task.taskId);
    if(task.state==='created'&&runtime.loadCheckpoint(task.taskId,'host-tool-intent')===undefined)
      application.finalizeHostToolTask({taskId:task.taskId,commandId:operation.commandId,expectedTaskRevision:task.revision,arguments:operation.arguments});
    const read=application.readHostToolTask(task.taskId);
    if(read.task.state==='waiting_approval'&&read.approval?.state==='allowed')application.resumeHostToolTask(task.taskId);
  }
  return {tools,
    bindWorkflow(value){if(workflow&&workflow!==value)fail('REVISION_CONFLICT','Cloud reminder owner changed');workflow=value;},
    configure(binding,input,commandId){
      active(binding);const state=saved(binding);if(state.operations.length>=32)fail('UNSUPPORTED_CAPABILITY','Bounded cloud reminder operations require a new explicit session');
      if(state.operations.some(value=>!value.taskId||!['succeeded','failed','cancelled'].includes(app().runtime.getTask(value.taskId).state)))
        fail('RESULT_UNKNOWN','Read back or resolve the original reminder operation before another request');
      const toolName=input.action==='create'?'todo.create':'todo.update';let args;
      if(input.action==='create'){
        if(input.remindUtc!==undefined&&(!Number.isFinite(Date.parse(input.remindUtc))||Date.parse(input.remindUtc)>Date.parse(binding.taskDeadline)))
          fail('UNAUTHORIZED','Reminder cannot extend the original session deadline');
        args={title:input.title,...(input.dueUtc?{dueUtc:input.dueUtc}:{}),...(input.remindUtc?{remindUtc:input.remindUtc}:{}),
          ...(input.missedPolicy?{missedPolicy:input.missedPolicy}:{})};
      } else {
        const item=originalProducts(binding).service.get(input.id);
        if(item.revision!==input.expectedRevision)fail('REVISION_CONFLICT','Original cloud todo revision changed');
        args={id:item.id,expectedRevision:input.expectedRevision,...(input.status?{status:input.status}:{}),...(input.clearReminder?{clearReminder:true}:{})};
      }
      const operation={commandId:'cloud-todo-'+hash([binding.taskId,commandId]),toolName,arguments:args};
      if(state.operations.some(value=>value.commandId===operation.commandId))fail('RESULT_UNKNOWN','Read back the original reminder operation');
      state.operations.push(operation);save(binding,state);prepare(binding,operation);
    },
    approvalTaskIds(binding){return saved(binding).operations.flatMap(value=>value.taskId?[value.taskId]:[]);},
    assertReadCurrent(binding,taskId){active(binding);origin(binding,taskId);},
    snapshot(binding){const state=saved(binding),items=originalProducts(binding).service.list();
      return {items:items.map(item=>({id:item.id,title:item.title,status:item.status,revision:item.revision,
        ...(item.due?{dueUtc:item.due.utc}:{}),...(item.reminder?{remindUtc:item.reminder.remindAt.utc,reminderState:item.reminder.state}:{})})),
        operations:state.operations.map(value=>({commandId:value.commandId,...(value.taskId?{taskId:value.taskId,state:app().runtime.getTask(value.taskId).state}:{state:'created'})}))};},
    restrict(binding,action='cancel'){
      const runtime=app().runtime;
      for(const {taskId}of saved(binding).operations)if(taskId){const task=runtime.getTask(taskId);
        if(action!=='pause'||['running','planning'].includes(task.state))runtime.requestCancel(taskId,'Original cloud reminder responsibility stopped');}
      if(action!=='pause')runtime.reconcileSchedules(conversation(binding),[]);
    },
    async maintain(binding){
      try{active(binding);}catch{return {state:'unavailable'};}
      const application=app(),runtime=application.runtime,state=saved(binding);
      for(const operation of state.operations)prepare(binding,operation);
      const {service}=originalProducts(binding),notifications=getNotifications();if(!notifications)return {state:'unavailable'};
      let delivery=deliveries.get(binding.taskId);if(!delivery){delivery=createReminderDeliveryHost({runtime,conversationId:conversation(binding),now,
        enqueue(schedule){active(binding);const item=service.list().find(value=>value.reminder&&reminderScheduleId(value.id,value.reminder.remindAt.utc)===schedule.scheduleId);
          if(!item)fail('UNAUTHORIZED','Original cloud reminder no longer exists');notifications.enqueueReminder(binding,schedule,item);},
        readReceipt:scheduleId=>notifications.hasReminder(binding,scheduleId)});deliveries.set(binding.taskId,delivery);}
      await delivery.tick(reminderTriggers(service.list(),conversation(binding)));
      active(binding);const dispatches=runtime.listSchedules(conversation(binding)).filter(schedule=>schedule.status==='skipped'
        ||schedule.status==='fired'&&notifications.hasReminder(binding,schedule.scheduleId)).map(({scheduleId,status})=>({scheduleId,status}));
      for(const item of applyReminderDispatches(service.list(),dispatches,now))service.save(item);
      return {state:'bound'};
    },
    async close(){for(const delivery of deliveries.values())await delivery.close();}
  };
}
