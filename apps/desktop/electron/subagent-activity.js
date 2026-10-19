/** Workspace is the host-wide activity view; panel stays scoped to its conversation. */
export function projectSubagentActivity({tasks, surface, visible, readChildren, sourceSurface, readTask}) {
  return tasks.filter(task => surface === 'workspace' || visible(task, surface)).flatMap(parent =>
    (readChildren(parent.taskId) ?? []).map(child => ({...child, sourceSurface: sourceSurface(parent),
      ...(readTask?{updatedAt:readTask(child.taskId).updatedAt}:{})})))
    .sort((a,b)=>String(b.updatedAt??'').localeCompare(String(a.updatedAt??'')));
}

/** Read-only task detail. The public Runtime snapshot is not a complete model transcript. */
export async function readSubagentConversation({payload, tasks, readChildren, readTask}) {
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
    ...(task.error ? {error: {code: task.error.code, retryable: task.error.retryable,
      message: '子任务返回错误，详细错误信息已隐藏'}} : {}),
    evidenceRefCount: Array.isArray(task.evidenceRefs) ? task.evidenceRefs.length : 0,
    steps: (task.steps ?? []).map(step => ({label: step.label, state: step.state})),
    transcriptAvailable: false,
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
