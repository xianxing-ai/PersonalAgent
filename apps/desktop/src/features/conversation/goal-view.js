import {stateNames, isTerminal} from './state.js';

export function appliedGoalRef(task) {
  const ref = task?.result?.currentGoal;
  return task?.state === 'succeeded' && task.result.kind === 'applied'
    && Array.isArray(task.evidenceRefs) && task.evidenceRefs.length > 0
    && typeof ref?.id === 'string' && ref.id
    && Number.isSafeInteger(ref.revision) && ref.revision > 0 ? ref : null;
}

// Goal changes use the trusted Desktop bridge.
export function createGoalControl(invoke, getDraftSummary = () => '') {
  if (!document.querySelector('link[data-goal-view]')) {
    const stylesheet = element('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./goal-view.css', import.meta.url).href;
    stylesheet.dataset.goalView = '';
    document.head.append(stylesheet);
  }
  const button = element('button', '持续目标');
  button.type = 'button';
  button.className = 'goal-open';
  button.setAttribute('aria-haspopup', 'dialog');

  const dialog = element('dialog');
  dialog.className = 'goal-dialog';
  dialog.setAttribute('aria-label', '持续目标');
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
  const title = element('h2', '持续目标');
  const status = element('p');
  status.setAttribute('aria-live', 'polite');
  const source = element('p', '来源由可信宿主记录。');
  const list = element('div');
  list.setAttribute('aria-label', '已保存的目标');
  const taskHistory = element('div');
  taskHistory.setAttribute('aria-label', '目标写入任务');
  const taskStatus = element('p');
  taskStatus.setAttribute('aria-live', 'polite');
  const taskActions = element('div');
  const readTask = action('刷新任务状态', () => void refreshTask());
  const cancelTask = action('取消目标任务', () => void cancelActiveTask());
  const allow = action('批准一次', () => void decide('allow_once'));
  const deny = action('拒绝', () => void decide('deny'));
  taskActions.append(readTask, cancelTask, allow, deny);

  const form = element('form');
  const id = field('目标 ID', 'input');
  const summary = field('目标内容', 'textarea');
  const reason = field('创建或修订原因', 'input');
  const validFrom = field('开始时间', 'input', 'datetime-local');
  const validUntil = field('截止时间', 'input', 'datetime-local');
  const sensitivity = field('敏感级别', 'select');
  options(sensitivity.control, [['private', '私有'], ['restricted', '受限'], ['public', '公开']]);
  const state = field('状态', 'select');
  options(state.control, [['active', '进行中'], ['withdrawn', '已撤回']]);
  const save = element('button', '保存目标');
  save.type = 'submit';
  form.append(id.label, summary.label, reason.label, validFrom.label, validUntil.label,
    sensitivity.label, state.label, save);

  const newGoal = action('新建目标', resetDraft);
  const reload = action('刷新目标', () => void refreshGoals());
  const close = action('关闭', () => { changeView(); dialog.close(); });
  dialog.append(title, status, source, list, taskHistory, taskStatus, taskActions,
    form, newGoal, reload, close);

  let graphRevision = null;
  let selected = null;
  let validity = null;
  let activeTask = null;
  let initialized = false;
  let available = false;
  let outcomeUnknown = false;
  // A real accepted write survives changes to the visible draft and task selection.
  let writeTask = null;
  let viewVersion = 0;
  let draftVersion = 0;
  let taskVersion = 0;
  let listVersion = 0;
  let historyVersion = 0;
  let historyTaskIds = [];
  let selecting = false;
  const cancellations = new Set();
  const decisions = new Set();
  let approvalTimer;

  // Bind every asynchronous UI result to the interaction that requested it.
  const context = () => ({view: viewVersion, draft: draftVersion, task: taskVersion});
  const current = scope => dialog.open && scope.view === viewVersion
    && scope.draft === draftVersion && scope.task === taskVersion;
  const writePending = () => selecting || outcomeUnknown || Boolean(writeTask && !isTerminal(writeTask))
    || Boolean(activeTask && !isTerminal(activeTask));
  const changeDraft = () => { draftVersion++; taskVersion++; selecting = false; };
  const changeTask = () => { taskVersion++; selecting = false; };
  const changeView = () => {
    clearApprovalTimer();
    viewVersion++;
    if (selecting) { selecting = false; save.disabled = writePending(); }
  };
  dialog.addEventListener('cancel', changeView);
  dialog.addEventListener('close', () => { if (!dialog.open) changeView(); });
  form.addEventListener('input', () => {
    const pendingSelection = selecting;
    changeDraft();
    if (pendingSelection) save.disabled = writePending();
  });

  function decisionPending(task) {
    return [...decisions].some(request => request.taskId === task?.taskId
      && request.approvalId === task.approval?.approvalId && request.revision === task.approval?.revision);
  }
  function syncTaskActions() {
    cancelTask.disabled = cancellations.has(activeTask?.taskId);
    const actionable = activeTask?.state === 'waiting_approval' && activeTask.approval?.state === 'pending'
      && Number.isFinite(approvalExpiry(activeTask)) && approvalExpiry(activeTask) > Date.now();
    allow.hidden = deny.hidden = !actionable;
    allow.disabled = deny.disabled = !actionable || decisionPending(activeTask);
  }

  function approvalExpiry(task) {
    return typeof task?.approval?.expiresAt === 'string' ? Date.parse(task.approval.expiresAt) : Number.NaN;
  }
  function approvalNotice(task) {
    if (task.approval?.state === 'allowed') return '授权已批准，等待任务恢复。';
    const expiry = approvalExpiry(task);
    return !Number.isFinite(expiry) ? '授权期限无法核实，请刷新任务状态；仍可取消目标任务。'
      : expiry <= Date.now() ? '此授权已过期，请取消目标任务后重新发起。' : '等待一次性授权决定。';
  }
  function clearApprovalTimer() {
    clearTimeout(approvalTimer);
    approvalTimer = undefined;
  }
  function scheduleApprovalExpiry(task, scope) {
    clearApprovalTimer();
    const expiry = approvalExpiry(task);
    if (task.state !== 'waiting_approval' || task.approval?.state !== 'pending'
      || !Number.isFinite(expiry) || expiry <= Date.now()) return;
    const {approvalId, revision} = task.approval;
    const timer = setTimeout(() => {
      if (approvalTimer !== timer) return;
      approvalTimer = undefined;
      if (!dialog.open || activeTask !== task || activeTask.approval?.approvalId !== approvalId
        || activeTask.approval?.revision !== revision) return;
      syncTaskActions();
      if (expiry > Date.now()) { scheduleApprovalExpiry(task, scope); return; }
      if (current(scope)) setStatus('pending', approvalNotice(task));
    }, Math.min(Math.max(expiry - Date.now(), 1), 2_147_483_647));
    approvalTimer = timer;
    timer.unref?.();
  }

  function setStatus(kind, message) {
    status.dataset.state = kind;
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    status.textContent = message;
  }

  function setAvailable(next, message = '') {
    available = next;
    button.textContent = '持续目标';
    form.hidden = !next;
    list.hidden = !next;
    newGoal.hidden = !next;
    if (!next) setStatus('unavailable', message || '持续目标尚未接通。');
  }
  setAvailable(false);

  function renderGoals(goals) {
    list.replaceChildren();
    if (!goals.length) list.append(element('p', '暂无已保存的目标。'));
    for (const goal of goals) {
      const row = element('div');
      row.append(element('span', `${goal.summary} · ${goal.state === 'withdrawn' ? '已撤回' : '进行中'} · 版本 ${goal.revision}`),
        action('修订', () => void selectGoal(goal.id)));
      list.append(row);
    }
  }

  function setValidity(goal) {
    validFrom.control.value = toLocalTime(goal.validFrom);
    validUntil.control.value = toLocalTime(goal.validUntil);
    // Keep the UTC identity of untouched fields, including ambiguous local DST times.
    validity = {
      from: {local: validFrom.control.value, utc: goal.validFrom},
      until: {local: validUntil.control.value, utc: goal.validUntil},
    };
  }

  async function refreshGoals(scope = context()) {
    const request = ++listVersion;
    try {
      const result = await invoke('goal.list');
      if (!current(scope) || request !== listVersion) return false;
      if (!Number.isSafeInteger(result?.graphRevision) || !Array.isArray(result.goals)) {
        throw Error('目标宿主未提供持久列表');
      }
      graphRevision = result.graphRevision;
      renderGoals(result.goals);
      setAvailable(true);
      if (!activeTask) setStatus('ready', '目标列表已从可信宿主读取。');
      return true;
    } catch (error) {
      if (!current(scope) || request !== listVersion) return false;
      setAvailable(false, `持续目标尚未接通：${message(error)}`);
      return false;
    }
  }

  async function selectGoal(goalId) {
    changeDraft();
    selecting = true;
    save.disabled = true;
    const scope = context();
    try {
      const result = await invoke('goal.get', goalId);
      if (!current(scope)) return;
      if (result?.goal?.id !== goalId || !Number.isSafeInteger(result.graphRevision)) throw Error('目标已不存在，请刷新列表');
      selecting = false;
      selected = result.goal;
      graphRevision = result.graphRevision;
      id.control.value = selected.id;
      id.control.readOnly = true;
      summary.control.value = selected.summary;
      reason.control.value = selected.reason;
      setValidity(selected);
      sensitivity.control.value = selected.sensitivity;
      state.control.value = selected.state;
      state.label.hidden = false;
      source.textContent = `来源：${selected.sourceRef}；目标版本 ${selected.revision}，图版本 ${graphRevision}。`;
      save.textContent = '保存修订';
      save.disabled = writePending();
      setStatus('editing', `正在修订目标版本 ${selected.revision}。`);
    } catch (error) {
      if (!current(scope)) return;
      selecting = false;
      save.disabled = writePending();
      setStatus('error', message(error));
    }
  }

  function resetDraft() {
    changeDraft();
    selected = null;
    validity = null;
    form.reset();
    id.control.readOnly = false;
    id.control.value = globalThis.crypto?.randomUUID?.() ?? '';
    summary.control.value = String(getDraftSummary() ?? '').trim();
    validFrom.control.value = toLocalTime(new Date().toISOString());
    sensitivity.control.value = 'private';
    state.control.value = 'active';
    state.label.hidden = true;
    source.textContent = '来源由可信宿主记录；保存前不会写入。';
    save.textContent = '保存目标';
    save.disabled = writePending();
    setStatus('editing', '请填写原因和有效期，再明确保存。');
  }

  function renderTaskHistory(tasks) {
    historyTaskIds = tasks.map(task => task.taskId);
    taskHistory.replaceChildren();
    for (const task of tasks) {
      taskHistory.append(taskHistoryAction(task, '查看写入任务'));
    }
  }

  function taskIdentity(task) {
    const id = String(task.taskId);
    const abbreviate = value => value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
    const short = historyTaskIds.some(other => other !== id && abbreviate(other) === abbreviate(id)) ? id : abbreviate(id);
    const kind = task.operation === 'goals.create' ? '创建目标' : task.operation === 'goals.revise' ? '修改目标' : '目标写入';
    return {id, short, kind};
  }
  function taskHistoryAction(task, prefix) {
    const identity = taskIdentity(task), state = stateNames[task.state] ?? task.state;
    const button = action(`${prefix}：${state} · ${identity.kind} ${identity.short}`, () => void refreshTask(task.taskId));
    button.title = `任务 ID：${identity.id}`;
    button.setAttribute('aria-label', `${prefix}：${state} · ${identity.kind}，任务 ID：${identity.id}`);
    return button;
  }

  async function refreshTasks(scope = context()) {
    const request = ++historyVersion;
    try {
      const tasks = await invoke('goal.listTasks');
      if (!current(scope) || request !== historyVersion) return;
      if (!Array.isArray(tasks)) throw Error('目标任务列表格式无效');
      const knownTasks = writeTask && !tasks.some(task => task.taskId === writeTask.taskId)
        ? [...tasks, writeTask] : tasks;
      renderTaskHistory(knownTasks);
      const pending = knownTasks.find(task => task.taskId === writeTask?.taskId && !isTerminal(task))
        ?? knownTasks.find(task => !isTerminal(task));
      if (pending) await showTask(pending, scope);
    } catch (error) {
      if (!current(scope) || request !== historyVersion) return;
      taskStatus.textContent = `目标任务恢复状态暂不可用：${message(error)}`;
      taskStatus.title = '';
      taskStatus.setAttribute('aria-label', taskStatus.textContent);
    }
  }

  async function refreshTask(taskId = activeTask?.taskId) {
    if (!taskId) return;
    changeTask();
    save.disabled = writePending();
    const scope = context();
    try {
      const task = await invoke('goal.readTask', taskId);
      if (!current(scope)) return;
      if (task?.taskId !== taskId) throw Error('目标任务身份与请求不一致');
      await showTask(task, scope);
    }
    catch (error) { if (current(scope)) setStatus('error', `任务读回失败：${message(error)}。请勿重复提交。`); }
  }

  async function showTask(task, scope = context()) {
    if (!current(scope)) return;
    if (!task?.taskId || typeof task.state !== 'string') throw Error('目标任务读回格式无效');
    if (task.taskId === writeTask?.taskId) writeTask = task;
    activeTask = task;
    const identity = taskIdentity(task);
    taskStatus.textContent = `目标任务：${stateNames[task.state] ?? task.state} · 任务版本 ${task.revision} · ${identity.kind} ${identity.short}`;
    taskStatus.title = `任务 ID：${identity.id}`;
    taskStatus.setAttribute('aria-label', `目标任务：${stateNames[task.state] ?? task.state} · 任务版本 ${task.revision} · ${identity.kind}，任务 ID：${identity.id}`);
    taskActions.hidden = false;
    readTask.disabled = false;
    syncTaskActions();
    cancelTask.hidden = isTerminal(task) || task.state === 'cancelling';
    scheduleApprovalExpiry(task, scope);
    save.disabled = writePending();

    if (task.state === 'waiting_reconciliation') {
      setStatus('pending', '写入结果待核实，请勿重复提交。');
    } else if (task.state === 'cancelling') {
      setStatus('pending', '取消已受理，等待 Runtime 确认终态。');
    } else if (task.state === 'waiting_approval') {
      setStatus('pending', approvalNotice(task));
    } else if (!isTerminal(task)) {
      setStatus('pending', `任务${stateNames[task.state] ?? task.state}，尚未保存成功。`);
    } else if (appliedGoalRef(task)) {
      await verifyAppliedGoal(task, scope);
    } else if (task.result?.kind === 'conflict') {
      await refreshGoals(scope);
      if (!current(scope)) return;
      save.disabled = true;
      setStatus('error', `目标版本冲突，当前图版本 ${task.result.graphRevision}；草稿已保留，请核对后重试。`);
    } else if (task.result?.kind === 'rejected') {
      setStatus('error', '目标写入被拒绝；没有保存成功。');
    } else {
      if (task.state === 'succeeded') save.disabled = true;
      setStatus('error', `目标任务${stateNames[task.state] ?? task.state}；${task.error?.message ?? '未取得经确认的目标读回'}。`);
    }
  }

  async function verifyAppliedGoal(task, scope) {
    const ref = task.result.currentGoal;
    try {
      const readback = await invoke('goal.get', ref.id);
      if (!current(scope)) return;
      if (!readback?.goal || readback.goal.id !== ref.id || readback.goal.revision !== ref.revision
        || readback.graphRevision < task.result.graphRevision) throw Error('目标版本与写入回执不一致');
      selected = readback.goal;
      graphRevision = readback.graphRevision;
      id.control.value = selected.id;
      id.control.readOnly = true;
      summary.control.value = selected.summary;
      reason.control.value = selected.reason;
      setValidity(selected);
      sensitivity.control.value = selected.sensitivity;
      state.control.value = selected.state;
      source.textContent = `来源：${selected.sourceRef}；目标版本 ${selected.revision}，图版本 ${graphRevision}。`;
      state.label.hidden = false;
      save.textContent = '保存修订';
      if (!(await refreshGoals(scope))) {
        if (!current(scope)) return;
        throw Error('目标列表读回不可用');
      }
      if (!current(scope)) return;
      const previous = task.result.previousGoal?.revision ?? '新建';
      setStatus(outcomeUnknown ? 'pending' : 'saved', outcomeUnknown
        ? `所选历史任务的目标已确认并读回：版本 ${previous} → ${ref.revision}，图版本 ${task.result.graphRevision}；先前提交结果仍待核实，请勿重复提交。`
        : `目标已确认并读回：版本 ${previous} → ${ref.revision}，图版本 ${task.result.graphRevision}。`);
    } catch (error) {
      if (!current(scope)) return;
      save.disabled = true;
      setStatus('error', `任务已结束，但目标读回尚未验证：${message(error)}。请勿重复提交。`);
    }
  }

  async function cancelActiveTask() {
    if (!activeTask || isTerminal(activeTask)) return;
    const taskId = activeTask.taskId;
    if (cancellations.has(taskId)) return;
    cancellations.add(taskId);
    changeTask();
    const scope = context();
    cancelTask.disabled = true;
    try {
      const result = await invoke('goal.cancel', taskId);
      if (!current(scope)) return;
      if (result?.task && result.task.taskId !== taskId) throw Error('目标任务身份与取消请求不一致');
      if (result?.task) await showTask(result.task, scope);
      if (!current(scope)) return;
      if (result?.cancelAccepted && !isTerminal(result.task ?? activeTask)) {
        setStatus('pending', '取消已受理，等待 Runtime 终态；写入结果仍需核实。');
      }
    } catch (error) { if (current(scope)) setStatus('error', `取消请求状态未知：${message(error)}。请刷新任务状态。`); }
    finally { cancellations.delete(taskId); syncTaskActions(); }
  }

  async function decide(decision) {
    const approval = activeTask?.approval;
    if (activeTask?.state !== 'waiting_approval' || approval?.state !== 'pending') return;
    if (!Number.isFinite(approvalExpiry(activeTask)) || approvalExpiry(activeTask) <= Date.now()) {
      syncTaskActions();
      setStatus('pending', approvalNotice(activeTask));
      return;
    }
    if (decisionPending(activeTask)) return;
    const taskId = activeTask.taskId;
    const request = {taskId, approvalId: approval.approvalId, revision: approval.revision};
    decisions.add(request);
    changeTask();
    const scope = context();
    allow.disabled = deny.disabled = true;
    try {
      await invoke('authorization.respond', {approvalId: approval.approvalId,
        decision, expectedRevision: approval.revision, taskId});
      if (!current(scope)) return;
      setStatus('pending', decision === 'deny' ? '拒绝已提交，等待 Runtime 终态。' : '批准已提交，等待任务恢复。');
      await refreshTask(taskId);
    } catch (error) { if (current(scope)) setStatus('error', `授权决定状态未知：${message(error)}。请刷新任务状态，勿重复决定。`); }
    finally { decisions.delete(request); syncTaskActions(); }
  }

  button.onclick = async () => {
    changeView();
    if (!initialized) { resetDraft(); initialized = true; }
    dialog.showModal();
    const scope = context();
    if (await refreshGoals(scope)) await refreshTasks(scope);
  };
  reload.onclick = () => void refreshGoals();
  form.onsubmit = async event => {
    event.preventDefault();
    if (!available || writePending() || !Number.isSafeInteger(graphRevision)) return;
    const start = Date.parse(validity?.from.local === validFrom.control.value
      ? validity.from.utc : validFrom.control.value);
    const end = Date.parse(validity?.until.local === validUntil.control.value
      ? validity.until.utc : validUntil.control.value);
    if (!id.control.value.trim() || !summary.control.value.trim() || !reason.control.value.trim()
      || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      setStatus('error', '请填写目标 ID、内容、原因和有效的起止时间。');
      return;
    }
    const goal = {id: id.control.value.trim(), summary: summary.control.value.trim(),
      validFrom: new Date(start).toISOString(), validUntil: new Date(end).toISOString(),
      sensitivity: sensitivity.control.value, state: selected ? state.control.value : 'active',
      reason: reason.control.value.trim(), dependencies: selected?.dependencies ?? []};
    const payload = {expectedGraphRevision: graphRevision,
      ...(selected ? {expectedGoalRevision: selected.revision} : {}), goal};
    save.disabled = true;
    outcomeUnknown = true;
    changeTask();
    const scope = context();
    setStatus('pending', '目标写入任务正在提交；受理不等于完成。');
    try {
      const task = await invoke(selected ? 'goal.revise' : 'goal.create', payload);
      if (!task?.taskId || typeof task.state !== 'string') throw Error('目标任务读回格式无效');
      writeTask = task;
      outcomeUnknown = false;
      save.disabled = writePending();
      if (current(scope)) await showTask(task, scope);
      else if (dialog.open) {
        taskHistory.append(taskHistoryAction(task, '查看已受理目标任务'));
      }
    }
    catch (error) { if (current(scope)) setStatus('error', `提交结果未知：${message(error)}。草稿已保留，请核对目标任务；勿重复提交。`); }
  };

  taskActions.hidden = true;
  return {button, dialog};
}

function element(tag, text = '') {
  const value = document.createElement(tag);
  value.textContent = text;
  return value;
}
function action(text, callback) {
  const button = element('button', text);
  button.type = 'button';
  button.onclick = callback;
  return button;
}
function field(name, tag, type) {
  const label = element('label', name);
  const control = element(tag);
  if (type) control.type = type;
  if (type === 'datetime-local') control.step = '0.001';
  control.setAttribute('aria-label', name);
  label.append(control);
  return {label, control};
}
function options(select, values) {
  for (const [value, label] of values) {
    const option = element('option', label);
    option.value = value;
    select.append(option);
  }
}
function message(error) { return error?.message || String(error); }
function toLocalTime(iso) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, -1);
}
