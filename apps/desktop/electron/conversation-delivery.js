/** Desktop delivery bookkeeping only. Runtime remains the owner of task state and cancellation. */
export function createConversationDelivery(submitting) {
  const requests=new Map(),truncated=new Map(),acceptedStops=new Set();
  const truncate=task=>{
    if(!truncated.has(task.taskId))truncated.set(task.taskId,{resultSummary:task.resultSummary,steps:structuredClone(task.steps)});
  };
  return {
    begin(conversationId) {
      const request={conversationId,interrupted:false};
      requests.set(conversationId,request);submitting.add(conversationId);return request;
    },
    finish(request) {
      if(requests.get(request.conversationId)!==request)return;
      requests.delete(request.conversationId);submitting.delete(request.conversationId);
    },
    interruptPending(conversationId,except) {
      const request=requests.get(conversationId);
      if(request&&request!==except){request.interrupted=true;requests.delete(conversationId);submitting.delete(conversationId);return request;}
    },
    truncate,
    acceptStop(taskId,result) {
      if(result?.taskId===taskId&&(result.cancelAccepted===true||['succeeded','failed','cancelled'].includes(result.state)))acceptedStops.add(taskId);
      else throw Error('任务停止未受理，请重试停止');
    },
    stopped(task) {return acceptedStops.has(task.taskId)||task.cancelRequested===true;},
    project(task) {
      // Persisted cancelRequested tasks must not regain their old composer lock after restart.
      if(task.cancelRequested&&!['succeeded','failed','cancelled'].includes(task.state))truncate(task);
      const cutoff=truncated.get(task.taskId);
      return cutoff?{...task,...cutoff,outputTruncated:true}:task;
    },
  };
}
