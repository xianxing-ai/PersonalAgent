import {stateNames} from './state.js';

/** Read-only background list. The panel's existing completion notice stays the only one. */
export function mountBackgroundTasks(root, invoke) {
  if (!document.querySelector('link[data-background-tasks]')) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./background-tasks.css', import.meta.url).href;
    stylesheet.dataset.backgroundTasks = '';
    document.head.append(stylesheet);
  }
  const section = document.createElement('section');
  section.className = 'background-tasks';
  section.setAttribute('aria-label', '后台任务');
  const title = document.createElement('h2');
  title.textContent = '后台任务';
  const status = document.createElement('p');
  status.className = 'background-tasks-status';
  status.setAttribute('role', 'status');
  const list = document.createElement('ul');
  list.className = 'background-tasks-list';
  section.append(title, status, list);
  root.append(section);
  let closed = false;
  let pending;
  function row(item) {
    const entry = document.createElement('li');
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = `${text(item.role) || '子智能体'} · ${text(item.goal) || item.subtaskId || item.taskId}`;
    open.onclick = () => invoke('task.openSubagentConversation', {parentTaskId: item.parentTaskId, taskId: item.taskId}).catch(() => {
      status.textContent = '暂时无法打开子对话';
    });
    const meta = document.createElement('span');
    const state = Object.hasOwn(stateNames, item.state) ? stateNames[item.state] : text(item.state);
    meta.textContent = [state, item.queued ? '排队' : '', item.typeName ? `类型 ${item.typeName}` : ''].filter(Boolean).join(' · ');
    entry.append(open, meta);
    if (item.state === 'created' || item.state === 'running' || item.state === 'planning') {
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.textContent = '停止';
      stop.onclick = () => invoke('asyncSubagents.stop', {parentTaskId: item.parentTaskId, subtaskId: item.subtaskId}).then(refresh).catch(() => {
        status.textContent = '停止请求没有被接受';
      });
      entry.append(stop);
    }
    return entry;
  }
  function refresh() {
    if (closed) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.resolve().then(() => invoke('asyncSubagents.list', {}))
      .then(result => {
        if (closed) return;
        if (!result || !Array.isArray(result.items)) throw Error('Invalid background tasks');
        list.replaceChildren(...result.items.map(row));
        status.textContent = result.items.length ? '' : '没有正在后台运行的子任务';
      })
      .catch(() => { if (!closed) status.textContent = '后台任务读取失败'; })
      .finally(() => { pending = undefined; });
    return pending;
  }
  return {refresh, dispose() { closed = true; }};
}

function text(value) {return typeof value === 'string' ? value : '';}
