/** Session-local delivery only. Runtime owns task state; acceptance is not playback proof. */
export function createLiveTextOutput({readSession, onUpdate = () => {}, now = Date.now}) {
  const tracked = new Map(), pending = new Map();
  let delivery = {state:'idle', playbackVerified:false};
  const update = value => {delivery={...value,playbackVerified:false};onUpdate();return {...delivery};};
  const current = () => {
    const record=readSession();
    return record && !record.controller.signal.aborted && now()<Date.parse(record.deadline) ? record : undefined;
  };
  function flush() {
    const record=current();
    if (!record || record.phase!=='listening' || record.userSpeaking || record.workingCount) return;
    const next=pending.entries().next().value;
    if (!next) return;
    const [taskId,item]=next;
    if (item.sessionId!==record.id || item.conversationId!==record.conversationId) {pending.delete(taskId);return;}
    if (typeof record.session?.speakText!=='function') {
      pending.delete(taskId);return update({state:'unavailable',taskId,reason:'当前语音模型不支持文字结果播报'});
    }
    try {
      const result=record.session.speakText(item.text);
      pending.delete(taskId);
      return update({state:result?.accepted===true?'accepted':'unavailable',taskId,revision:item.revision});
    } catch (error) {
      if (error?.code==='REALTIME_BUSY') return;
      pending.delete(taskId);
      return update({state:'failed',taskId,reason:'文字结果未能交给语音模型；请查看文字回答'});
    }
  }
  return {
    snapshot:()=>({...delivery,pending:pending.size}), flush,
    cancel(taskId) {
      tracked.delete(taskId);pending.delete(taskId);
      if(delivery.taskId===taskId && delivery.state==='accepted') current()?.session?.interrupt();
    },
    drained() {if(delivery.state==='accepted')update({state:'ended',taskId:delivery.taskId});},
    track({taskId,conversationId}) {
      const record=current();
      if (!record || record.conversationId!==conversationId) return update({state:'unavailable',reason:'当前对话未开启 Live，回答保留为文字'});
      if (typeof taskId!=='string' || !taskId || tracked.size>=256) return update({state:'unavailable',reason:'文字播报任务绑定不可用'});
      if (!tracked.has(taskId)) tracked.set(taskId,{sessionId:record.id,conversationId,revision:-1});
      return {state:'waiting_result',playbackVerified:false};
    },
    observe(task) {
      const binding=tracked.get(task?.taskId),record=current();
      if (!binding || binding.done || !record || binding.sessionId!==record.id || binding.conversationId!==record.conversationId
        || task.conversationId!==binding.conversationId || !Number.isSafeInteger(task.revision) || task.revision<=binding.revision) return;
      binding.revision=task.revision;
      if (!['succeeded','failed','cancelled'].includes(task.state)) return;
      // Consume once at the first terminal revision; later refreshes cannot replay speech.
      binding.done=true;
      if (task.state!=='succeeded' || task.cancelRequested || task.outputTruncated) return;
      if (typeof task.resultSummary!=='string' || !task.resultSummary.trim() || task.resultSummary.length>8000)
        return update({state:'unavailable',taskId:task.taskId,reason:'回答为空或超过播报上限，请查看完整文字回答'});
      if (pending.size>=8) return update({state:'unavailable',taskId:task.taskId,reason:'语音播报队列已满，请查看文字回答'});
      pending.set(task.taskId,{...binding,revision:task.revision,text:task.resultSummary});
      update({state:'queued',taskId:task.taskId,revision:task.revision});flush();
    },
    clear() {tracked.clear();pending.clear();delivery={state:'idle',playbackVerified:false};},
  };
}
