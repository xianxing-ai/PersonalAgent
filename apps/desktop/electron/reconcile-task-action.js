/** Trusted Desktop action: original-task verification only; Runtime owns terminal state. */
export async function reconcileTaskFromSurface({taskId,sender,panel,workspace,tasks,taskSurface,application,mailRecovery,resumeMailWorkflow,refresh,publish,observe,reportNative}){
 if(sender!==panel&&sender!==workspace)throw Error('请从当前对话核实任务');
 if(typeof taskId!=='string'||!tasks.has(taskId))throw Error('未知任务');
 const task=tasks.get(taskId);if(taskSurface(task)!==(sender===workspace?'workspace':'panel'))throw Error('无法核实其他工作区的任务');
 if(task.state!=='waiting_reconciliation')throw Error('当前任务不在待核实状态');
 let native;
 const knowledge=application?.readF04RecoveryAvailable?.(taskId)?'reconcileF04WorkflowTask':
  application?.readF24RecoveryAvailable?.(taskId)?'reconcileF24WorkflowTask':undefined;
 if(knowledge){
  if(typeof application[knowledge]!=='function'||typeof observe!=='function')throw Error('原知识写入的核实入口尚不可用');
  const current=application.runtime.getTask(taskId);
  if(current.state!=='waiting_reconciliation'||current.revision!==task.revision)throw Error('原任务已变化，请刷新后核实');
  native=await observe(scope=>application[knowledge](taskId,current.revision,scope));
 }else if(application?.readHarnessCandidateRecoveryAvailable?.(taskId)){
  if(typeof application.reconcileHarnessCandidateTask!=='function'||typeof observe!=='function')throw Error('原编码试验的核实入口尚不可用');
  const current=application.runtime.getTask(taskId);
  if(current.state!=='waiting_reconciliation'||current.revision!==task.revision)throw Error('原任务已变化，请刷新后核实');
  native=await observe(scope=>application.reconcileHarnessCandidateTask(taskId,current.revision,scope));
 }else if(mailRecovery?.readOriginalSendRecoveryAvailable?.(taskId)){
  if(typeof observe!=='function')throw Error('原发送结果的核实入口尚不可用');
  const current=application.runtime.getTask(taskId);
  if(current.state!=='waiting_reconciliation'||current.revision!==task.revision)throw Error('原任务已变化，请刷新后核实');
  native=await observe(async scope=>{
    let result=mailRecovery.readOriginalSendReconciliation({taskId});
    if(result.state==='unavailable'){
      await mailRecovery.prepareOriginalSendReconciliation({taskId},scope);
      result=mailRecovery.readOriginalSendReconciliation({taskId});
    }
    if(result.state==='confirmed')result=mailRecovery.applyOriginalSendReconciliation({taskId});
    const write=result.task;
    if(result.state==='confirmed'&&write&&!write.cancelRequested&&['waiting_reconciliation','succeeded'].includes(write.state)
      &&application.runtime.loadCheckpoint?.(write.taskId,'workflow-business-tool:source')){
      if(typeof resumeMailWorkflow!=='function')throw Error('原邮件工作流的恢复入口尚不可用');
      const resumed=await resumeMailWorkflow({taskId:write.taskId,...scope});result={...result,resumed:resumed?.resumed===true};
    }
    return {kind:'mail_send',...result};
  });
 }else{
  if(typeof application?.reconcileConfirmedSubagentTermination!=='function')throw Error('原任务核实入口尚不可用');
  await application.reconcileConfirmedSubagentTermination(taskId);
 }
 const result=await refresh(taskId);publish();if(native&&reportNative)await reportNative(native);return result;
}
