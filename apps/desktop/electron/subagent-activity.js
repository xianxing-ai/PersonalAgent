/** Workspace is the host-wide activity view; panel stays scoped to its conversation. */
export function scopeSubagentConversations(items, readParent, visibleParent) {
  return items.filter(child=>{
    try{return visibleParent(readParent(child.parentTaskId));}
    catch(error){if(error?.code==='NOT_FOUND')return false;throw error;}
  });
}

export function projectSubagentActivity({tasks, surface, visible, readChildren, sourceSurface, readTask}) {
  return tasks.filter(task => surface === 'workspace' || visible(task, surface)).flatMap(parent =>
    (readChildren(parent.taskId) ?? []).map(child => ({...child, sourceSurface: sourceSurface(parent),
      ...(readTask?{updatedAt:readTask(child.taskId).updatedAt}:{})})))
    .sort((a,b)=>String(b.updatedAt??'').localeCompare(String(a.updatedAt??'')));
}

const SECRET = /(?:bearer\s+)[a-z0-9._\-]{8,}|(?:sk|rk|pk)-[a-z0-9_\-]{8,}|(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi;
const FAILURES = {
  TIMEOUT: '这一步超时了，可以稍后再试。',
  CANCELLED: '已停止。',
  UNAUTHORIZED: '没有通过授权，这次没有继续执行。',
  SCOPE_DENIED: '当前权限不够，这次没有执行。',
  UNSUPPORTED_CAPABILITY: '当前环境还不支持这一步。',
  EXTERNAL_FAILURE: '外部服务没有成功返回，可以稍后再试。',
  RESULT_UNKNOWN: '结果还不能确定，需要先核对，不会自动重做。',
  REVISION_CONFLICT: '原来的记录已经变了，请刷新后再试。',
};
function publicFailure(error) {
  const code = error?.code;
  return {code, retryable: Boolean(error?.retryable), message: FAILURES[code] ?? '这次没有完成，请稍后再试。'};
}
function redact(value) {
  return typeof value === 'string' ? value.replace(SECRET, '[密钥已隐藏]') : value;
}

/** Read-only task detail. Transcript text is already redacted by the runtime. */
export async function readSubagentConversation({payload, tasks, readChildren, readTask, readTranscript}) {
  const validId = value => typeof value === 'string' && value.trim().length > 0 && value.trim() === value;
  if (!payload || Array.isArray(payload) || typeof payload !== 'object'
    || Object.keys(payload).some(key => !['parentTaskId', 'taskId'].includes(key))
    || !validId(payload.parentTaskId) || !validId(payload.taskId)) {
    throw Error('子任务会话参数无效');
  }
  const {parentTaskId, taskId} = payload;
  const parent = tasks.get(parentTaskId);
  if (!parent || parent.taskId !== parentTaskId) throw Error('原始任务不可用，请刷新任务列表');
  let children;
  try { children = await readChildren(parentTaskId); }
  catch { throw Error('子任务列表不可用，请刷新任务列表'); }
  const child = Array.isArray(children) && children.find(item =>
    item?.parentTaskId === parentTaskId && item.taskId === taskId);
  if (!child || taskId === parentTaskId) throw Error('子任务不属于此原始任务或已不可用');
  let task;
  try { task = await readTask(taskId); }
  catch { throw Error('子任务详情不可用，请刷新任务列表'); }
  if (task?.taskId !== taskId || task.conversationId !== `desktop-subtask:${parentTaskId}`) {
    throw Error('子任务详情与原始任务不匹配');
  }
  return {
    parentTaskId, taskId, role: child.role, modelId: child.modelId,
    ...(child.reasoningEffort ? {reasoningEffort: child.reasoningEffort} : {}), state: task.state,
    ...(typeof task.goal === 'string' ? {goal: task.goal} : {}),
    ...(typeof task.resultSummary === 'string' ? {resultSummary: task.resultSummary} : {}),
    ...(task.error ? {error: publicFailure(task.error)} : {}),
    evidenceRefCount: Array.isArray(task.evidenceRefs) ? task.evidenceRefs.length : 0,
    steps: (task.steps ?? []).map(step => ({label: redact(step.label), state: step.state})),
    ...(typeof readTranscript === 'function' ? {transcript: await readTranscript(taskId), transcriptAvailable: true} : {transcriptAvailable: false}),
  };
}

/** Navigation only: use the original parent and owner conversation, never resubmit it. */
export async function openTaskConversation({payload, tasks, conversations, sourceSurface, openPanel, openWorkspace, publish}) {
  if (!payload || Object.keys(payload).some(key => key !== 'taskId') || typeof payload.taskId !== 'string') {
    throw Error('任务定位参数无效');
  }
  const task = tasks.get(payload.taskId);
  if (!task) throw Error('原始任务不可用，请刷新任务列表');
  const surface = sourceSurface(task);
  if (!['panel', 'workspace'].includes(surface)) throw Error('任务窗口不可用');
  const conversationId = conversations.conversationIdForTask(task);
  conversations.switch(surface, conversationId);
  if (surface === 'panel') await openPanel(); else await openWorkspace();
  publish();
  return {taskId: task.taskId, surface, conversationId};
}
