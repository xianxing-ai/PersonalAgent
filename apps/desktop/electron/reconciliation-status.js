/** Read-only UI metadata. Runtime alone decides whether a task can finish reconciliation. */
export function readReconciliationStatus(application,task,now=Date.now) {
  if(task?.state!=='waiting_reconciliation')return {};
  try {
    const runtime=application?.runtime;
    if(typeof runtime?.loadCheckpoint!=='function')throw Error('Runtime unavailable');
    const originalDeadline=runtime.loadCheckpoint(task.taskId,'application-deadline');
    const inflight=runtime.loadCheckpoint(task.taskId,'competition-cloud-inflight');
    const unknown=runtime.loadCheckpoint(task.taskId,'competition-cloud-unknown');
    const status={};
    if(originalDeadline!==undefined&&originalDeadline!==null) {
      const timestamp=typeof originalDeadline==='string'?Date.parse(originalDeadline):NaN;
      const current=now();
      if(!Number.isFinite(timestamp)||!Number.isFinite(current))throw Error('Deadline unavailable');
      status.deadline=new Date(timestamp).toISOString();
      status.deadlineExpired=timestamp<=current;
    }
    {
      // These trusted read APIs own the native recovery/received-failure checks. A cloud
      // marker may coexist with a valid recovery path; the UI must not hide that path.
      const nativeRecovery=typeof application.readHarnessCandidateRecoveryAvailable==='function'
        &&application.readHarnessCandidateRecoveryAvailable(task.taskId)===true;
      const receivedFailure=!nativeRecovery&&typeof runtime.readReceivedCloudFailureBinding==='function'
        &&runtime.readReceivedCloudFailureBinding(task.taskId)!==undefined;
      if(nativeRecovery)status.actionLabel='核对原编码操作';
      else if(receivedFailure)status.actionLabel='按已有回执尝试结束';
      else if(inflight||unknown) {
        const prefix=unknown?'未取得云端执行的有效回执。':'云端请求尚未确认结束。';
        status.blockedReason=prefix+(status.deadlineExpired?'原执行期限已过；':'')
          +'停止请求、到期或重启均不能证明原操作已结束。当前没有该操作的自动核查入口；请先查看目标结果，避免重复提交。你可以继续对话。';
      }else{
        if(typeof runtime.readToolExecutions!=='function')throw Error('Execution records unavailable');
        const records=runtime.readToolExecutions(task.taskId);
        if(!Array.isArray(records))throw Error('Execution records unavailable');
        // This record is necessary for the original Runtime action, not proof
        // that its remaining deadline/children/cache/export guards will pass.
        if(records.some(record=>record.executionStarted===true&&record.policyDecision==='allow'&&record.state==='confirmed'
          &&['subagent.dispatch','coding.repair.workflow'].includes(record.toolName)))status.actionLabel='按已有回执尝试结束';
        else status.blockedReason='当前没有该操作的自动核查入口；请先查看目标结果，避免重复提交。';
      }
    }
    return status;
  }catch {
    // Checkpoint and error messages may contain private configuration or receipts.
    return {actionLabel:'按已有回执尝试结束',notice:'暂时无法读取原任务回执；可以尝试检查已有回执，当前不能保证任务可结束。请勿重复提交原操作。'};
  }
}
