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
    if(inflight||unknown) {
      // These trusted read APIs own the native recovery/received-failure checks. A cloud
      // marker may coexist with a valid recovery path; the UI must not hide that path.
      const nativeRecovery=typeof application.readHarnessCandidateRecoveryAvailable==='function'
        &&application.readHarnessCandidateRecoveryAvailable(task.taskId)===true;
      const receivedFailure=!nativeRecovery&&typeof runtime.readReceivedCloudFailureBinding==='function'
        &&runtime.readReceivedCloudFailureBinding(task.taskId)!==undefined;
      if(!nativeRecovery&&!receivedFailure) {
        const prefix=unknown?'云端执行结果未知，尚未取得可信结果读回。':'云端请求尚未确认结束，尚未取得可信结果读回。';
        status.blockedReason=prefix+(status.deadlineExpired?'原执行期限已过；':'')
          +'停止请求、到期或重启均不能证明原操作已结束，当前无法核实并结束。你可以继续对话，请避免重复提交该操作。';
      }
    }
    return status;
  }catch {
    // Checkpoint and error messages may contain private configuration or receipts.
    return {blockedReason:'暂时无法读取原任务的核实状态，当前无法核实并结束。你可以继续对话，请稍后重试核实。'};
  }
}
