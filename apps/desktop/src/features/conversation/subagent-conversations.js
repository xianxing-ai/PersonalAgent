import {stateNames} from './state.js';

/** Read-only child conversations; the host owns task identity and persisted content. */
export function mountSubagentConversations(root, invoke, escape) {
  // Dynamic content uses textContent instead of HTML interpolation (including IDs).
  if (!document.querySelector('link[data-subagent-conversations]')) {
    const stylesheet = node('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./subagent-conversations.css', import.meta.url).href;
    stylesheet.dataset.subagentConversations = '';
    document.head.append(stylesheet);
  }
  const section = node('section', '', 'subagent-conversations');
  section.hidden = true;
  section.setAttribute('aria-label', '子智能体对话');
  const list = node('div', '', 'subagent-conversations-list');
  const detail = node('section', '', 'subagent-conversations-detail');
  detail.hidden = true;
  detail.setAttribute('aria-label', '子对话内容');
  section.append(list, detail);
  root.append(section);

  let tasks = new Map();
  let buttons = new Map();
  let selected = null;
  let requestVersion = 0;
  let signature = '';
  const taskLabels = new Map();
  let nextTaskLabel = 0;
  const keyOf = task => JSON.stringify([task.parentTaskId, task.taskId]);
  const current = (key, version) => selected === key && requestVersion === version && tasks.has(key);
  const labelFor = key => {
    if (!taskLabels.has(key)) taskLabels.set(key, `#${String(++nextTaskLabel).padStart(2, '0')}`);
    return taskLabels.get(key);
  };
  section.onkeydown = event => {
    if (event.key !== 'Escape' || detail.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  function syncButtons() {
    for (const [key, button] of buttons) button.setAttribute('aria-expanded', String(selected === key));
  }

  function close() {
    const previous = selected;
    selected = null;
    requestVersion++;
    detail.hidden = true;
    detail.replaceChildren();
    syncButtons();
    buttons.get(previous)?.focus();
  }

  function frame(task) {
    detail.hidden = false;
    const header = node('div', '', 'subagent-conversations-header');
    const title = node('h3', `${text(task.role) || '子智能体'} ${labelFor(keyOf(task))}`);
    title.setAttribute('title', task.taskId);
    const closeButton = action('关闭子对话', close);
    header.append(title, closeButton);
    const status = node('p', '', 'subagent-conversations-notice');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const content = node('div', '', 'subagent-conversations-content');
    const actions = node('div', '', 'subagent-conversations-actions');
    const refresh = action('刷新子对话', () => void load(selected));
    const parent = action('返回父对话', async () => {
      const key = selected, version = requestVersion;
      parent.disabled = true;
      try {
        await invoke('task.openConversation', {taskId: task.parentTaskId});
        if (current(key, version)) close();
      } catch (error) {
        if (current(key, version)) showError(status, error, '无法打开父对话');
      } finally {
        if (current(key, version)) parent.disabled = false;
      }
    });
    actions.append(refresh, parent);
    detail.replaceChildren(header, status, content, actions);
    return {status, content};
  }

  async function load(key) {
    const task = tasks.get(key);
    if (!task) return;
    selected = key;
    const version = ++requestVersion;
    syncButtons();
    const {status, content} = frame(task);
    status.textContent = '正在读取子对话…';
    try {
      const result = await invoke('task.subagentConversation', {
        parentTaskId: task.parentTaskId, taskId: task.taskId,
      });
      if (!current(key, version)) return;
      if (!result || result.parentTaskId !== task.parentTaskId || result.taskId !== task.taskId) {
        throw Error('子对话记录与所选任务不匹配，请刷新重试');
      }
      status.textContent = result.transcriptAvailable === true
        ? '以下内容来自已保存的子任务记录。'
        : '仅展示已保存的任务与回答；完整逐轮会话暂不可读。';
      renderRecord(content, result);
    } catch (error) {
      if (current(key, version)) showError(status, error, '无法读取子对话');
    }
  }

  function update(subagentTasks) {
    const next = new Map();
    for (const task of Array.isArray(subagentTasks) ? subagentTasks : []) {
      if (typeof task?.parentTaskId === 'string' && task.parentTaskId
        && typeof task.taskId === 'string' && task.taskId) next.set(keyOf(task), task);
    }
    tasks = next;
    section.hidden = tasks.size === 0;
    if (selected && !tasks.has(selected)) {
      selected = null;
      requestVersion++;
      detail.hidden = true;
      detail.replaceChildren();
    }
    const nextSignature = JSON.stringify([...tasks].map(([key, task]) =>
      [key, text(task.role), text(task.state), text(task.modelId)]));
    if (signature === nextSignature) return;
    signature = nextSignature;
    const focusedKey = [...buttons].find(([, button]) => button === document.activeElement)?.[0];
    buttons = new Map();
    const entries = [];
    for (const [key, task] of tasks) {
      const role = text(task.role) || '子智能体';
      const state = stateNames[task.state] || text(task.state) || '状态未记录';
      const button = action('', () => void load(key));
      button.className = 'subagent-conversations-entry';
      button.setAttribute('aria-label', `查看子对话：${role} ${labelFor(key)} · ${state}`);
      button.setAttribute('aria-expanded', String(selected === key));
      button.setAttribute('title', `子任务 ${task.taskId}\n父任务 ${task.parentTaskId}`);
      button.append(node('span', role, 'subagent-conversations-role'),
        node('span', labelFor(key), 'subagent-conversations-id'),
        node('span', state, 'subagent-conversations-state'));
      if (text(task.modelId)) button.append(node('span', task.modelId, 'subagent-conversations-model'));
      buttons.set(key, button);
      entries.push(button);
    }
    list.replaceChildren(...entries);
    if (focusedKey) buttons.get(focusedKey)?.focus({preventScroll: true});
  }

  return {update};
}

function renderRecord(content, record) {
  const metadata = node('p', [stateNames[record.state] || text(record.state) || '状态未记录',
    text(record.modelId) || '模型未记录', text(record.reasoningEffort) || '推理强度未记录'].join(' · '),
  'subagent-conversations-metadata');
  content.append(metadata, node('h4', '任务目标'),
    node('p', text(record.goal) || '任务目标未记录', 'subagent-conversations-message'),
    node('h4', '已保存回答'),
    node('p', text(record.resultSummary) || '回答未记录', 'subagent-conversations-message'));
  const error = errorText(record.error);
  if (error) content.append(node('h4', '任务错误'), node('p', error, 'subagent-conversations-error'));
  content.append(node('h4', '执行步骤'));
  const steps = Array.isArray(record.steps) ? record.steps : [];
  if (!steps.length) content.append(node('p', '执行步骤未记录'));
  else {
    const list = node('ol', '', 'subagent-conversations-steps');
    for (const step of steps) list.append(node('li', [text(step?.label) || '步骤内容未记录',
      stateNames[step?.state] || text(step?.state) || '状态未记录'].join(' · ')));
    content.append(list);
  }
  if (Number.isSafeInteger(record.evidenceRefCount) && record.evidenceRefCount >= 0) {
    content.append(node('p', `执行记录引用 ${record.evidenceRefCount} 条`, 'subagent-conversations-metadata'));
  }
  content.append(node('p', '执行回执不等于独立验证。', 'subagent-conversations-metadata'));
}

function text(value) { return typeof value === 'string' ? value : ''; }
function errorText(error) { return text(error?.message) || text(error); }
function showError(status, error, fallback) {
  status.setAttribute('role', 'alert');
  status.textContent = `${fallback}：${errorText(error) || '未知错误'}`;
}
function node(tag, value = '', className = '') {
  const element = document.createElement(tag);
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
