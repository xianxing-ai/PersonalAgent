import {stateNames} from './state.js';

/** Compact workspace history; the trusted host opens each independent child window. */
export function mountSubagentConversations(root, invoke, escape) {
  ensureStylesheet();
  const section = node('section', '', 'subagent-conversations');
  section.hidden = true;
  section.setAttribute('aria-label', '最近的子智能体对话');
  const list = node('div', '', 'subagent-conversations-list');
  const status = notice();
  section.append(list, status);
  root.append(section);

  let tasks = new Map(), buttons = new Map();
  let signature = '', latestRequest = 0, nextTaskLabel = 0;
  const taskLabels = new Map(), pending = new Map();
  const keyOf = task => JSON.stringify([task.parentTaskId, task.taskId]);
  const labelFor = key => {
    if (!taskLabels.has(key)) taskLabels.set(key, '#' + String(++nextTaskLabel).padStart(2, '0'));
    return taskLabels.get(key);
  };

  async function open(key) {
    const task = tasks.get(key);
    if (!task || pending.has(key)) return;
    const version = ++latestRequest;
    pending.set(key, version);
    status.textContent = '';
    syncPending(key);
    try {
      await invoke('task.openSubagentConversation', {parentTaskId: task.parentTaskId, taskId: task.taskId});
    } catch (error) {
      if (tasks.has(key) && latestRequest === version && pending.get(key) === version) {
        showError(status, error, '无法打开子对话');
      }
    } finally {
      if (pending.get(key) === version) {
        pending.delete(key);
        syncPending(key);
      }
    }
  }

  function syncPending(key) {
    const button = buttons.get(key);
    if (!button) return;
    button.disabled = pending.has(key);
    button.setAttribute('aria-busy', String(pending.has(key)));
  }

  function update(subagentTasks) {
    const next = new Map();
    // The caller supplies recency order; keep a bounded two-row workspace preview.
    for (const task of Array.isArray(subagentTasks) ? subagentTasks : []) {
      if (validIdentity(task)) next.set(keyOf(task), task);
      if (next.size === 6) break;
    }
    tasks = next;
    section.hidden = tasks.size === 0;
    for (const key of pending.keys()) if (!tasks.has(key)) pending.delete(key);
    if (!tasks.size) status.textContent = '';
    const nextSignature = JSON.stringify([...tasks].map(([key, task]) =>
      [key, text(task.role), text(task.state), text(task.modelId)]));
    if (signature === nextSignature) return;
    signature = nextSignature;
    const focusedKey = [...buttons].find(([, button]) => button === document.activeElement)?.[0];
    buttons = new Map();
    const entries = [];
    for (const [key, task] of tasks) {
      const role = text(task.role) || '子智能体';
      const state = stateLabel(task.state);
      const button = action('', () => open(key));
      button.className = 'subagent-conversations-entry';
      button.setAttribute('aria-label', '打开独立子对话：' + role + ' ' + labelFor(key) + ' · ' + state);
      button.setAttribute('title', [role + ' · ' + state, '子任务 ' + task.taskId,
        '父任务 ' + task.parentTaskId, text(task.modelId)].join('\n'));
      button.append(node('span', role, 'subagent-conversations-role'),
        node('span', labelFor(key), 'subagent-conversations-id'),
        node('span', state, 'subagent-conversations-state'));
      buttons.set(key, button);
      syncPending(key);
      entries.push(button);
    }
    list.replaceChildren(...entries);
    if (focusedKey) buttons.get(focusedKey)?.focus({preventScroll: true});
  }

  return {update};
}

/** Dedicated child-window view; its host fixes identity and restricts the IPC surface. */
export function mountSubagentConversationPage(root, invoke) {
  ensureStylesheet();
  const page = node('section', '', 'subagent-conversation-page');
  page.setAttribute('aria-label', '独立子对话');
  const header = node('div', '', 'subagent-conversation-page-header');
  const title = node('h1', '子智能体对话');
  const status = notice();
  const content = node('div', '', 'subagent-conversations-content');
  content.setAttribute('aria-label', '已保存的子任务记录');
  const footer = node('div', '', 'subagent-conversations-actions');
  const refreshButton = action('刷新子对话', () => refresh());
  const mainButton = action('返回主对话', () => navigate('subagentConversation.main', '无法返回主对话'));
  const closeButton = action('关闭子对话', () => navigate('subagentConversation.close', '无法关闭子对话'));
  header.append(title, closeButton);
  footer.append(refreshButton, mainButton);
  page.append(header, status, content, footer);
  root.append(page);

  let identity = null, readVersion = 0, navigating = false, closed = false;
  const current = version => !closed && !navigating && readVersion === version;

  async function refresh() {
    if (closed || navigating) return;
    const version = ++readVersion;
    status.setAttribute('role', 'status');
    status.textContent = '正在读取子对话…';
    content.setAttribute('aria-busy', 'true');
    try {
      const record = await invoke('subagentConversation.snapshot');
      if (!current(version)) return;
      if (!validIdentity(record)) throw Error('子对话记录缺少任务标识');
      const nextIdentity = JSON.stringify([record.parentTaskId, record.taskId]);
      if (identity && identity !== nextIdentity) throw Error('子对话记录与当前窗口不匹配');
      identity = nextIdentity;
      title.textContent = (text(record.role) || '子智能体') + ' · ' + record.taskId.slice(-8);
      title.setAttribute('title', '子任务 ' + record.taskId + '\n父任务 ' + record.parentTaskId);
      status.textContent = record.transcriptAvailable === true
        ? '以下内容来自已保存的子任务记录。'
        : '仅展示已保存的任务与回答；完整逐轮会话暂不可读。';
      content.replaceChildren();
      renderRecord(content, record);
    } catch (error) {
      if (current(version)) showError(status, error, '无法读取子对话');
    } finally {
      if (current(version)) content.setAttribute('aria-busy', 'false');
    }
  }

  async function navigate(name, fallback) {
    if (closed || navigating) return;
    navigating = true;
    readVersion++;
    content.setAttribute('aria-busy', 'false');
    for (const button of [refreshButton, mainButton, closeButton]) button.disabled = true;
    try {
      await invoke(name);
      if (name === 'subagentConversation.close') closed = true;
      else {
        status.setAttribute('role', 'status');
        status.textContent = '已返回主对话。';
      }
    } catch (error) {
      showError(status, error, fallback);
    } finally {
      navigating = false;
      if (!closed) for (const button of [refreshButton, mainButton, closeButton]) button.disabled = false;
    }
  }

  void refresh();
  return {refresh};
}

function renderRecord(content, record) {
  const metadata = node('p', [stateLabel(record.state), text(record.modelId) || '模型未记录',
    text(record.reasoningEffort) || '推理强度未记录'].join(' · '), 'subagent-conversations-metadata');
  content.append(metadata, node('h2', '任务目标'),
    node('p', text(record.goal) || '任务目标未记录', 'subagent-conversations-message'),
    node('h2', '已保存回答'),
    node('p', text(record.resultSummary) || '回答未记录', 'subagent-conversations-message'));
  const error = errorText(record.error);
  if (error) content.append(node('h2', '任务错误'), node('p', error, 'subagent-conversations-error'));
  content.append(node('h2', '执行步骤'));
  const steps = Array.isArray(record.steps) ? record.steps : [];
  if (!steps.length) content.append(node('p', '执行步骤未记录'));
  else {
    const list = node('ol', '', 'subagent-conversations-steps');
    for (const step of steps) list.append(node('li', [text(step?.label) || '步骤内容未记录',
      stateLabel(step?.state)].join(' · ')));
    content.append(list);
  }
  if (Number.isSafeInteger(record.evidenceRefCount) && record.evidenceRefCount >= 0) {
    content.append(node('p', '执行记录引用 ' + record.evidenceRefCount + ' 条', 'subagent-conversations-metadata'));
  }
  content.append(node('p', '执行回执不等于独立验证。', 'subagent-conversations-metadata'));
}

function ensureStylesheet() {
  if (document.querySelector('link[data-subagent-conversations]')) return;
  const stylesheet = node('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./subagent-conversations.css', import.meta.url).href;
  stylesheet.dataset.subagentConversations = '';
  document.head.append(stylesheet);
}
function validIdentity(record) {
  return typeof record?.parentTaskId === 'string' && record.parentTaskId
    && typeof record.taskId === 'string' && record.taskId;
}
function stateLabel(state) { return text(stateNames[state]) || text(state) || '状态未记录'; }
function text(value) { return typeof value === 'string' ? value : ''; }
function errorText(error) { return text(error?.message) || text(error); }
function notice() {
  const element = node('p', '', 'subagent-conversations-notice');
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  return element;
}
function showError(status, error, fallback) {
  status.setAttribute('role', 'alert');
  status.textContent = fallback + '：' + (errorText(error) || '未知错误');
}
function node(tag, value = '', className = '') {
  const element = document.createElement(tag);
  // Data, including task identifiers and errors, always remains plain text.
  element.textContent = text(value);
  if (className) element.className = className;
  return element;
}
function action(label, onclick) {
  const button = node('button', label);
  button.type = 'button';
  button.onclick = onclick;
  return button;
}
