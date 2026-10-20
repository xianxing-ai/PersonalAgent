// Host-local overlay for the existing Conversations store, not a second task store.
import {createLiveHistoryQueue} from './live-history-queue.js';
import {compileCoordinationGoal} from '@personal-agent/runtime/application';

export function createLiveVoiceHistory({save, readContext = () => '', recentLimit = 20,
  recoveryStore, queue = createLiveHistoryQueue({store: recoveryStore})}) {
  let contextDegraded=false;
  if (typeof save !== 'function' || !Number.isSafeInteger(recentLimit) || recentLimit < 1) {
    throw Error('Live 历史保存端口无效');
  }
  const recent = new Map(queue.messages().slice(-recentLimit).map(message => [message.id, message]));
  function trim() {
    for (const id of recent.keys()) {
      if (recent.size <= recentLimit) break;
      recent.delete(id);
    }
  }
  function flush() {
    queue.flush(save);
    trim();
    return !queue.snapshot().degraded;
  }
  function messages() {
    // Pending recovery is independent of the display window. Revisions win by ID.
    const values = new Map(queue.messages().map(message => [message.id, message]));
    for (const [id, message] of recent) if (!values.has(id)) values.set(id, message);
    return [...values.values()].sort((a,b) => Date.parse(a.createdAt)-Date.parse(b.createdAt))
      .map(message => ({...message}));
  }
  function record(message) {
    if (!message || !['user', 'assistant'].includes(message.role)
      || typeof message.id !== 'string' || !message.id || message.id.length > 256
      || typeof message.sessionId !== 'string' || !message.sessionId || message.sessionId.length > 256
      || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 100000
      || !Number.isFinite(Date.parse(message.createdAt))) throw Error('Live 对话消息格式无效');
    const prior = recent.get(message.id) ?? queue.messages().find(value => value.id === message.id);
    if(message.conversationId!==undefined && (typeof message.conversationId!=='string' || !message.conversationId.trim() || message.conversationId.length>256))throw Error('Live 历史对话归属无效');
    if (prior && (prior.sessionId !== message.sessionId || prior.role !== message.role || (prior.conversationId??'desktop-panel')!==(message.conversationId??'desktop-panel'))) {
      throw Error('Live 对话消息标识冲突');
    }
    const value = {id:message.id, sessionId:message.sessionId, role:message.role,
      ...(message.conversationId===undefined?{}:{conversationId:message.conversationId}),
      text:message.text.trim(), createdAt:prior?.createdAt ?? new Date(message.createdAt).toISOString()};
    if (!prior || prior.text !== value.text) {
      queue.enqueue(value);
      recent.set(value.id, value);
    }
    flush();
    trim();
    return {...value};
  }
  function context({conversationId='desktop-panel'}={}) {
    let data = {};
    contextDegraded=false;
    try {
      const raw = readContext({conversationId});
      const parsed = typeof raw === 'string' ? raw.trim()?JSON.parse(raw):{} : raw;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
    } catch { contextDegraded=true; /* Preserve unsaved transcripts, but the host must block incomplete sends. */ }
    const entries = [], messagesById = new Map();
    const canonical=Array.isArray(data.contextMessages)?data.contextMessages:undefined;
    for (const task of (!canonical&&Array.isArray(data.tasks) ? data.tasks : [])) {
      if(task?.conversationId!==undefined && task.conversationId!==conversationId)continue;
      const time = Date.parse(task?.createdAt) || 0;
      if (typeof task?.goal === 'string' && task.goal.trim()) entries.push({time, role:'user', text:task.goal});
      if (task?.state === 'succeeded' && typeof task.result === 'string' && task.result.trim()) {
        entries.push({time:time+1, role:'assistant', text:task.result});
      } else if (task?.state === 'failed') {
        entries.push({time:time+1, role:'assistant', text:`[任务执行失败：${task.failureReason || '未成功'}]`});
      } else if (task?.state === 'cancelled') entries.push({time:time+1, role:'assistant', text:'[任务已取消]'});
    }
    let index = 0;
    for (const message of [...(canonical?canonical.map((m,index)=>({...m,text:m.content,canonicalIndex:index})):
      Array.isArray(data.messages) ? data.messages : []), ...messages().filter(message=>(message.conversationId??'desktop-panel')===conversationId)]) {
      if(message?.conversationId!==undefined && message.conversationId!==conversationId)continue;
      if (!message || !['user', 'assistant'].includes(message.role)
        || typeof message.text !== 'string' || !message.text.trim()) continue;
      // Identity dedup preserves intentional repeated sentences in separate turns.
      const id = typeof message.id === 'string' ? message.id : `unidentified:${index++}`;
      const prior=messagesById.get(id);
      messagesById.set(id, {id,time:prior?.time??message.canonicalIndex??(Date.parse(message.createdAt)||0), role:message.role, text:message.text,
        ...(message.taskState?{taskState:message.taskState}:{})});
    }
    entries.push(...messagesById.values());
    const ordered=entries.sort((a,b)=>a.time-b.time).map(({id,role,text,taskState},index)=>({id:id??'live-context-'+index,role,content:String(text),...(taskState?{taskState}:{})}));
    const compiled=ordered.length?JSON.parse(compileCoordinationGoal('衔接本会话前文','衔接本会话前文',ordered,'preserve-user-requests')).conversationContext:{messages:[]};
    const selected=compiled.messages.map(({role,content,taskState})=>({role,text:content,...(taskState?{taskState}:{})}));
    if(compiled.selection)selected.push({role:'assistant',text:JSON.stringify({contextSelection:compiled.selection})});
    if(JSON.stringify(selected).length>16000)throw Error('Live 关键上下文超过预算，无法完整发送，请缩小范围');
    return selected;
  }
  return {record, flush, context, messages, snapshot:()=>({...queue.snapshot(), contextDegraded,pendingCount:queue.snapshot().pending,
    transcripts:messages().slice(-recentLimit)})};
}
