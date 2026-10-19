const activeStates = new Set(['created', 'planning', 'running', 'waiting_approval', 'waiting_external',
  'waiting_reconciliation', 'verifying', 'cancelling']);

/** Ephemeral completion feedback only; the first snapshot never replays historical successes. */
export function mountSubagentCompletionNotice(root, invoke, {
  now = Date.now, setTimeout: schedule = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout,
} = {}) {
  const mountedAt = now();
  const notice = document.createElement('div');
  notice.className = 'subagent-completion-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.setAttribute('aria-atomic', 'true');
  notice.style.cssText = 'margin:8px 0;padding:6px 10px;font-size:12px;display:flex;align-items:center;gap:8px';
  const open = document.createElement('button');
  open.type = 'button';
  open.style.cssText = 'font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:left';
  const feedback = document.createElement('span');
  const dismiss = document.createElement('button');
  dismiss.type = 'button'; dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', '关闭完成提示');
  dismiss.style.cssText = 'font:inherit;color:inherit;background:none;border:0;margin-left:auto;cursor:pointer';
  notice.append(open, feedback, dismiss);
  notice.hidden = true;
  // Ensure the inline flex declaration never overrides the hidden attribute.
  notice.style.display = 'none';
  root.append(notice);

  const seen = new Map();
  let baseline = false, queue = [], current, timer, disposed = false;
  const clearTimer = () => {if (timer !== undefined) cancel(timer); timer = undefined;};
  function advance() {
    clearTimer();
    current = queue.shift();
    notice.hidden = !current;
    notice.style.display = current ? 'flex' : 'none';
    feedback.textContent = '';
    const role = current?.role || '子智能体';
    open.textContent = current ? `${role.endsWith('子智能体') ? role : `${role}子智能体`}已完成 ✓` : '';
    open.disabled = typeof invoke !== 'function';
    if (current) timer = schedule(advance, 8000);
  }
  dismiss.onclick = advance;
  open.onclick = async () => {
    const selected = current;
    if (!selected || open.disabled || typeof invoke !== 'function') return;
    open.disabled = true;
    try {
      await invoke('task.openSubagentConversation', {parentTaskId: selected.parentTaskId, taskId: selected.taskId});
      if (current === selected && !disposed) advance();
    } catch {
      if (current === selected && !disposed) {
        feedback.textContent = '暂时无法打开子对话，请稍后重试';
        open.disabled = false;
      }
    }
  };

  function update(subagentTasks) {
    if (disposed || !Array.isArray(subagentTasks)) return;
    const tasks = new Map();
    for (const task of subagentTasks) {
      if (typeof task?.taskId === 'string' && task.taskId.trim()
        && typeof task.parentTaskId === 'string' && task.parentTaskId.trim()
        && task.taskId !== task.parentTaskId) tasks.set(task.taskId, task);
    }
    queue = queue.filter(task => tasks.get(task.taskId)?.parentTaskId === task.parentTaskId);
    if (current && tasks.get(current.taskId)?.parentTaskId !== current.parentTaskId) advance();
    for (const [id, task] of tasks) {
      const previous = seen.get(id);
      // Runtime's persisted update time can prove a new completion even if its running snapshot was missed.
      const recordedAt = task.updatedAt ?? task.createdAt;
      const changedAt = typeof recordedAt === 'string' ? Date.parse(recordedAt) : NaN;
      const newRecord = !previous && Number.isFinite(changedAt) && changedAt >= mountedAt && changedAt <= now();
      if (baseline && task.state === 'succeeded' && !previous?.completed
        && (!previous || previous.parentTaskId === task.parentTaskId)
        && (activeStates.has(previous?.state) || newRecord)) {
        queue.push({taskId: id, parentTaskId: task.parentTaskId,
          role: typeof task.role === 'string' ? task.role.slice(0, 80) : ''});
      }
      seen.set(id, {parentTaskId: previous?.parentTaskId ?? task.parentTaskId, state: task.state,
        completed: previous?.completed === true || task.state === 'succeeded'});
    }
    baseline = true;
    if (!current && queue.length) advance();
  }
  return {update, dispose() {
    disposed = true; clearTimer(); queue = []; current = undefined;
    notice.hidden = true; notice.style.display = 'none';
  }};
}
