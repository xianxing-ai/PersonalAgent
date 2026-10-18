const terminal=new Set(['succeeded','failed','cancelled','cancelling']);

/** Called by the existing Desktop poll. No timer, model, grant or second scheduler lives here. */
export function createDesktopProactiveRuntimePump({getApplication,getWorkflow,resolveUserConversation,recoverSources,now=Date.now}) {
  if([getApplication,getWorkflow,resolveUserConversation].some(value=>typeof value!=='function'))
    throw Error('Original Runtime, proactive host and structural conversation resolver required');
  const recovered=new Set(),reentered=new Set();let pending,scanCursor;
  async function run() {
    const application=getApplication(),workflow=getWorkflow();
    if(!application?.runtime||!workflow||workflow.snapshot().state!=='configured_not_verified')return {state:'unavailable',sessions:[]};
    const runtime=application.runtime,status=[],conversations=new Set();let beforeSequence=scanCursor?.beforeSequence,
      snapshotSequence=scanCursor?.snapshotSequence,pages=0;
    do {
      const page=workflow.maintenancePage({...(beforeSequence===undefined?{}:{beforeSequence}),
        ...(snapshotSequence===undefined?{}:{snapshotSequence})});
      snapshotSequence=page.snapshotSequence;
      for(const item of page.items) {
        const {binding}=item;
        if(terminal.has(item.state)||item.cancelRequested)continue;
        if(item.withheld||!resolveUserConversation(binding.sourceTaskId)) {status.push({taskId:binding.taskId,state:'source_unavailable'});continue;}
        if(Date.parse(binding.taskDeadline)<=now()) {status.push({taskId:binding.taskId,state:'deadline_expired'});continue;}
        // Old sessions lack an immutable image binding. Only explicit native resume may inspect them.
        if(!binding.imageBinding) {status.push({taskId:binding.taskId,state:'legacy_requires_explicit_resume'});continue;}
        const context={signal:new AbortController().signal,deadline:new Date(Math.min(Date.parse(binding.taskDeadline),now()+5000)).toISOString()};
        try {
          const session=await workflow.acquireMaintenance(binding.taskId,context);
          const sourceRecovery=typeof recoverSources==='function'?await recoverSources(binding.taskId,context):undefined;
          const schedules=Object.keys(session.host.inspect().application.state.schedules);
          if(schedules.length&&!conversations.has(item.conversationId)) {
            if(!recovered.has(item.conversationId)) {runtime.recoverMissedSchedules(item.conversationId);recovered.add(item.conversationId);}
            runtime.dispatchDueSchedules(item.conversationId);conversations.add(item.conversationId);
          }
          let wakes=0;
          for(const scheduleId of schedules) {
            const schedule=runtime.getSchedule(scheduleId);
            if(schedule.status!=='fired')continue;
            if(session.host.inspect().application.state.entries['runtime-wake:'+scheduleId])continue;
            session.host.ingestWake(scheduleId,context);wakes++;
          }
          const current=runtime.getTask(binding.taskId);
          if(!reentered.has(binding.taskId)&&['created','waiting_approval','waiting_reconciliation'].includes(current.state)) {
            application.resumeProactiveTask(binding.taskId);reentered.add(binding.taskId);
          }
          status.push({taskId:binding.taskId,state:sourceRecovery?.state==='unavailable'?'source_unavailable':'bound',wakes,...(sourceRecovery?{sourceRecovery:{state:sourceRecovery.state,
            deliveries:sourceRecovery.deliveries?.length??0}}:{})});
        }catch(error){status.push({taskId:binding.taskId,state:'unavailable',
          code:['CANCELLED','TIMEOUT','REVISION_CONFLICT','RESULT_UNKNOWN','UNAUTHORIZED'].includes(error?.code)?error.code:'HOST_UNAVAILABLE'});}
      }
      beforeSequence=page.nextBeforeSequence;
      if(++pages===10&&beforeSequence!==undefined){scanCursor={beforeSequence,snapshotSequence};return {state:'bounded',sessions:status,truncated:true};}
    }while(beforeSequence!==undefined);
    scanCursor=undefined;
    return {state:'processed',sessions:status,truncated:false};
  }
  return {tick(){if(pending)return pending;pending=run().finally(()=>{pending=undefined;});return pending;}};
}
