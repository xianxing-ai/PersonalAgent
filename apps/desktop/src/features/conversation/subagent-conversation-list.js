import {stateNames} from './state.js';

/** Read-only paginated history. Opening a row delegates binding checks to the trusted host. */
export function mountSubagentConversationList(root, invoke) {
  if (!document.querySelector('link[data-subagent-conversation-list]')) {
    const stylesheet = node('link'); stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./subagent-conversation-list.css', import.meta.url).href;
    stylesheet.dataset.subagentConversationList = ''; document.head.append(stylesheet);
  }
  const page = node('section', '', 'subagent-history-page');
  const header = node('header', '', 'subagent-history-header');
  const title = node('h1', '全部子智能体对话');
  const refreshButton = action('刷新', () => refresh());
  const collapseButton = action('收起全部子对话', () => collapseAll());
  const closeButton = action('关闭', close);
  header.append(title, collapseButton, refreshButton, closeButton);
  const searchLabel = node('label', '搜索已加载记录', 'subagent-history-search');
  const search = node('input'); search.type = 'search';
  search.placeholder = '角色、任务目标或 ID（仅搜索已加载记录）';
  search.setAttribute('aria-label', '搜索已加载记录');
  searchLabel.append(search);
  const count = node('p', '', 'subagent-history-count');
  const status = node('p', '', 'subagent-history-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const scroll = node('div', '', 'subagent-history-scroll');
  const list = node('ul', '', 'subagent-history-list');
  list.setAttribute('aria-label', '已加载的子智能体对话');
  const empty = node('p', '', 'subagent-history-empty');
  scroll.append(list, empty);
  const more = action('加载更多历史记录', () => loadMore());
  more.className = 'subagent-history-more'; more.hidden = true;
  page.append(header, searchLabel, count, status, scroll, more); root.append(page);

  let records = new Map(), nextCursor, generation = 0, pending, closed = false, closing = false;
  let openRevision = 0, feedbackRevision = 0;
  const opening = new Map();
  const keyOf = item => JSON.stringify([item.parentTaskId, item.taskId]);
  const feedback = (message, error = false) => {
    status.textContent = message; status.setAttribute('role', error ? 'alert' : 'status');
    return ++feedbackRevision;
  };
  function syncBusy() {
    refreshButton.disabled = closing || closed || pending?.kind === 'refresh';
    collapseButton.disabled = closing || closed;
    closeButton.disabled = closing || closed;
    more.disabled = closing || closed || Boolean(pending);
    more.hidden = !nextCursor;
    page.setAttribute('aria-busy', String(Boolean(pending) || closing));
  }
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const matches = [...records].filter(([, item]) => !query
      || [item.role, item.goal, item.taskId, item.parentTaskId].some(value => text(value).toLocaleLowerCase().includes(query)));
    count.textContent = `已加载 ${records.size} 条${query ? `，匹配 ${matches.length} 条` : ''}${nextCursor ? '；还有历史记录未加载' : ''}`;
    const focused = [...list.querySelectorAll('button')].find(button => button === document.activeElement)?.dataset.key;
    list.replaceChildren(...matches.map(([key, item]) => {
      const row = node('li');
      const button = action('', () => open(key)); button.className = 'subagent-history-entry'; button.dataset.key = key;
      button.disabled = closing || closed || opening.has(key);
      button.setAttribute('aria-busy', String(opening.has(key)));
      button.setAttribute('aria-label', `打开子对话：${text(item.role) || '子智能体'} · ${item.taskId}`);
      const heading = node('span', '', 'subagent-history-entry-heading');
      heading.append(node('strong', text(item.role) || '子智能体'), node('span', Object.hasOwn(stateNames, item.state) ? stateNames[item.state] : '状态未记录'));
      button.append(heading, node('span', text(item.goal) || '任务目标未记录', 'subagent-history-goal'),
        node('span', `子任务 ${item.taskId} · 父任务 ${item.parentTaskId}`, 'subagent-history-metadata'),
        node('span', [text(item.modelId) || '模型未记录', text(item.updatedAt) || '更新时间未记录'].join(' · '), 'subagent-history-metadata'));
      row.append(button); return row;
    }));
    empty.hidden = matches.length > 0;
    empty.textContent = query ? '已加载记录中没有匹配项；可清空搜索并继续加载历史记录。'
      : pending && records.size === 0 ? '正在读取历史记录…' : '暂无已加载的子智能体记录。';
    if (focused && document.activeElement === document.body) {
      [...list.querySelectorAll('button')].find(button => button.dataset.key === focused)?.focus({preventScroll:true});
    }
    syncBusy();
  }
  search.oninput = render;

  function readPage(cursor, replace) {
    if (closed || closing) return Promise.resolve();
    if (pending && (!replace || pending.kind === 'refresh')) return pending.promise;
    const version = ++generation;
    const operation = {kind:replace ? 'refresh' : 'more', promise:undefined};
    pending = operation;
    const feedbackOwner = feedback(replace ? '正在刷新历史记录…' : '正在加载更多历史记录…'); render();
    operation.promise = Promise.resolve().then(() => invoke('subagentConversations.list', cursor ? {cursor} : {}))
      .then(result => {
        if (version !== generation || closed || closing) return;
        if (!result || !Array.isArray(result.items)
          || (result.nextCursor !== undefined && (typeof result.nextCursor !== 'string' || !result.nextCursor || result.nextCursor === cursor))) {
          throw Error('Invalid history page');
        }
        const next = replace ? new Map() : new Map(records);
        for (const item of result.items) {
          if (!validId(item?.parentTaskId) || !validId(item?.taskId) || item.parentTaskId === item.taskId) throw Error('Invalid task identity');
          // Project only the fields this page needs; raw evidence and other data never enter its DOM.
          const projected = {parentTaskId:item.parentTaskId, taskId:item.taskId, role:text(item.role),
            modelId:text(item.modelId), state:text(item.state), updatedAt:text(item.updatedAt), goal:text(item.goal)};
          next.set(keyOf(projected), projected);
        }
        records = next; nextCursor = result.nextCursor;
        if (feedbackOwner === feedbackRevision) feedback('');
      }).catch(() => {
        if (version === generation && !closed && !closing && feedbackOwner === feedbackRevision) feedback('历史记录读取失败；已加载的记录保留，请重试。', true);
      }).finally(() => {
        if (version === generation && !closed && !closing) {pending = undefined; render();}
      });
    return operation.promise;
  }
  function refresh() {return readPage(undefined, true);}
  function loadMore() {return nextCursor ? readPage(nextCursor, false) : Promise.resolve();}
  async function open(key) {
    const item = records.get(key);
    if (!item || opening.has(key) || closed || closing) return;
    const version = ++openRevision;
    opening.set(key, version); const feedbackOwner = feedback('正在打开子对话…'); render();
    try {
      await invoke('subagentConversations.open', {parentTaskId:item.parentTaskId, taskId:item.taskId});
      if (version === openRevision && records.has(key) && !closed && !closing && feedbackOwner === feedbackRevision) feedback('已打开子对话。');
    } catch {
      if (version === openRevision && records.has(key) && !closed && !closing && feedbackOwner === feedbackRevision) feedback('无法打开此子对话，请刷新记录后重试。', true);
    } finally {
      if (opening.get(key) === version) opening.delete(key);
      if (!closed && !closing) render();
    }
  }
  async function collapseAll() {
    if (closed || closing) return;
    closing = true; render();
    try {
      const result = await invoke('subagentConversations.collapseAll');
      const count = Number(result?.closed ?? 0);
      feedback(count > 0 ? `已收起 ${count} 个子对话窗口。` : '当前没有打开的子对话窗口。');
    } catch { feedback('无法收起子对话窗口，请重试。', true); }
    finally { closing = false; if (!closed) render(); }
  }
  async function close() {
    if (closed || closing) return;
    closing = true; generation++; pending = undefined; render();
    try {await invoke('subagentConversations.close'); closed = true;}
    catch {feedback('无法关闭历史记录窗口，请重试。', true);}
    finally {closing = false; render();}
  }
  void refresh();
  return {refresh};
}

function text(value) {return typeof value === 'string' ? value : '';}
function validId(value) {return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;}
function node(tag, value = '', className = '') {
  const element = document.createElement(tag); element.textContent = value;
  if (className) element.className = className;
  return element;
}
function action(label, onclick) {const button = node('button', label); button.type = 'button'; button.onclick = onclick; return button;}
