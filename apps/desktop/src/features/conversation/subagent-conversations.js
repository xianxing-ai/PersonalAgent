import {stateNames} from './state.js';
import {isStopRequest} from './stop-request.js';
import {answerCardHtml,liveFromTranscript,rememberActivity,replaceAnswerCard,syncContainerAnswerDisclosures} from './answer-block.js';
import {resultText} from './result-text.js';

/** Compact workspace history; the trusted host opens each independent child window. */
export function mountSubagentConversations(root, invoke, escape) {
  ensureStylesheet();
  const section = node('section', '', 'subagent-conversations');
  section.setAttribute('aria-label', '最近的子智能体对话');
  const list = node('div', '', 'subagent-conversations-list');
  list.hidden = true;
  const status = notice();
  const more = action('更多', async () => {
    if (more.disabled) return;
    const version = ++latestRequest;
    more.disabled = true;
    status.textContent = '';
    try {
      await invoke('subagentConversations.openAll');
    } catch (error) {
      if (latestRequest === version) showError(status, error, '无法查看全部子智能体');
    } finally {
      more.disabled = false;
    }
  });
  more.className = 'subagent-conversations-more';
  more.setAttribute('aria-label', '查看全部子智能体');
  // One action reclaims every child window's renderer process instead of closing them one by one.
  const collapse = action('收起', async () => {
    if (collapse.disabled) return;
    collapse.disabled = true;
    status.textContent = '';
    try {
      const result = await invoke('subagentConversations.collapseAll');
      const closed = Number(result?.closed ?? 0);
      status.textContent = closed > 0 ? `已收起 ${closed} 个子对话窗口。` : '当前没有打开的子对话窗口。';
    } catch (error) {
      showError(status, error, '无法收起子对话');
    } finally {
      collapse.disabled = false;
    }
  });
  collapse.className = 'subagent-conversations-collapse';
  collapse.setAttribute('aria-label', '收起全部子对话窗口');
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
    list.hidden = tasks.size === 0;
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

/** Dedicated child conversation; the host binds all new executions to its original child. */
export function mountSubagentConversationPage(root, invoke, {embedded=false}={}) {
  ensureStylesheet();
  const page = node('section', '', 'subagent-conversation-page');
  page.setAttribute('aria-label', '独立子对话');
  const header = node('div', '', 'subagent-conversation-page-header');
  const title = node('h1', '子智能体对话');
  const status = notice();
  const content = node('div', '', 'subagent-conversations-content');
  content.setAttribute('aria-label', '子任务与对话记录');
  const original = node('details', '', 'subagent-conversation-original');
  const originalBody = node('div');
  original.append(node('summary', '查看原始子任务记录'), originalBody);
  const messages = node('div', '', 'subagent-conversation-messages');
  messages.setAttribute('aria-label', '追加对话记录');
  const origin=node('article','','subagent-conversation-origin-turn');
  content.append(origin);
  content.append(original, node('h2', '对话记录'), messages);

  const composer = node('form', '', 'subagent-conversation-composer');
  const input = node('textarea');
  input.rows = 2;
  input.setAttribute('aria-label', '给子智能体的消息');
  input.placeholder = '继续和这个子智能体对话…';
  const composerStatus = notice();
  const availability = notice();
  availability.className += ' subagent-conversation-availability';
  const composerActions = node('div', '', 'subagent-conversation-compose-actions');
  const sendButton = action('发送', () => submit());
  const stopButton = action('停止', () => cancel());
  const headerStopButton = action('停止子智能体', () => cancel());
  headerStopButton.className='subagent-conversation-stop';
  const bindingLabel=embedded?node('span','','subagent-conversation-model'):null;
  if(embedded){sendButton.textContent='↑';sendButton.setAttribute('aria-label','发送');sendButton.className='subagent-conversation-send';input.placeholder='给这个子智能体发送消息…';composerActions.append(bindingLabel);}
  composerActions.append(stopButton, sendButton);
  composer.append(input, composerStatus, availability, composerActions);
  composer.onsubmit = event => { event.preventDefault(); return submit(); };
  input.oninput = () => { draftVersion++; syncControls(); };
  input.onkeydown = event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const footer = node('div', '', 'subagent-conversations-actions');
  const refreshButton = action('刷新子对话', () => refresh());
  const mainButton = action('返回主对话', () => navigate('subagentConversation.main', '无法返回主对话'));
  const closeButton = action('关闭子对话', () => navigate('subagentConversation.close', '无法关闭子对话'));
  header.append(title, closeButton);
  footer.append(mainButton);
  page.append(header, status, content, composer, footer);
  root.append(page);

  let identity = null, readVersion = 0, draftVersion = 0, navigating = false, closed = false;
  let activeTaskId = null, canSubmit = false, sending = null, cancelling = null, retryRequest = null;
  let submitUnavailableReason = '';
  const liveTurns=new Map(), turns=new Map(), answerSlots=new Map(), watermarks=new Map();
  let pendingActivities,refreshQueued=false;
  // Set when the user stops: the composer stays usable even if the host still reports the old
  // task as active, because waiting for the runtime to unwind is what made stop feel broken.
  let truncated = false;
  const current = version => !closed && !navigating && readVersion === version;
  const beforeUnload=event=>{
    if(!closed&&(input.value.trim()||sending)){event.preventDefault();event.returnValue=false;}
  };
  const nearBottom=()=>content.scrollHeight-content.scrollTop-content.clientHeight<72;
  const visible=()=>!embedded||!root.hidden;
  const unsubscribeActivity=globalThis.window?.desktop?.onTaskActivity?.(event=>{
    if(!visible()||event.kind==='reasoning')return;
    if(event.kind==='reasoning_summary')event={...event,kind:'reasoning'};
    pendingActivities?.push(event);
    if(!turns.has(event.taskId)||event.sequence<=(watermarks.get(event.taskId)??0))return;
    watermarks.set(event.taskId,event.sequence);
    const live=rememberActivity(liveTurns,event);
    const slot=answerSlots.get(event.taskId);
    if(!slot)return;
    const follow=nearBottom();
    answerSlots.set(event.taskId,replaceAnswerCard(slot,turns.get(event.taskId),live,escapeHtml));
    if(follow)content.scrollTop=content.scrollHeight;
  });
  const unsubscribeUpdates=globalThis.window?.desktop?.onSubagentUpdate?.(taskId=>{
    if(visible()&&(turns.has(taskId)||taskId===activeTaskId))void refresh();
  });
  const dispose=()=>{
    closed=true;readVersion++;unsubscribeActivity?.();unsubscribeUpdates?.();
    globalThis.window?.removeEventListener('beforeunload',beforeUnload);
    globalThis.window?.removeEventListener('unload',dispose);
  };
  globalThis.window?.addEventListener('beforeunload',beforeUnload);
  globalThis.window?.addEventListener('unload',dispose,{once:true});

  function syncControls() {
    const busy = closed || navigating;
    input.disabled = busy;
    // A stop request never blocks the composer: the local truncation already released the task.
    sendButton.disabled = busy || Boolean(sending) || !canSubmit || !input.value.trim();
    stopButton.disabled = busy || Boolean(sending || cancelling) || !activeTaskId;
    headerStopButton.disabled=stopButton.disabled;
    refreshButton.disabled = busy || Boolean(sending || cancelling);
    mainButton.disabled = closeButton.disabled = busy;
    sendButton.setAttribute('aria-busy', String(Boolean(sending)));
    stopButton.setAttribute('aria-busy', String(Boolean(cancelling)));
    headerStopButton.setAttribute('aria-busy',String(Boolean(cancelling)));
    availability.textContent = activeTaskId && canSubmit
      ? '正在工作，现在发送会插到下一步。'
      : canSubmit ? '' : submitUnavailableReason || '当前子对话暂不能发送新消息。';
  }

  function renderAnswer(container,record){
    const task={...record,resultSummary:resultText(record.resultSummary??record.replyText,record.resultMetadata)};
    const segments=record.transcript?.segments?.filter(segment=>segment.kind!=='reasoning')
      .map(segment=>segment.kind==='reasoning_summary'?{...segment,kind:'reasoning'}:segment);
    const live=liveFromTranscript({segments});
    const previous=liveTurns.get(task.taskId);
    if(previous?.openDisclosures)live.openDisclosures=previous.openDisclosures;
    turns.set(task.taskId,task);
    liveTurns.set(task.taskId,live);
    watermarks.set(task.taskId,record.transcript?.activityThrough??0);
    for(const event of pendingActivities??[]){
      if(event.taskId!==task.taskId||event.sequence<=watermarks.get(task.taskId))continue;
      rememberActivity(liveTurns,event);
      watermarks.set(task.taskId,event.sequence);
    }
    for(const entry of record.injections??[])container.append(node('p',entry.text,'subagent-conversation-user'));
    const progress=record.steps?.at(-1)?.label;
    if(!task.resultSummary&&!task.error)container.append(node('p',progress||stateLabel(task.state),'subagent-conversations-metadata'));
    const output=node('div');
    output.innerHTML=answerCardHtml(task,live,escapeHtml);
    if(output.firstElementChild){
      answerSlots.set(task.taskId,output.firstElementChild);
      container.append(output.firstElementChild);
    }
    if(Number.isSafeInteger(record.evidenceRefCount)&&record.evidenceRefCount>0)
      container.append(node('p',record.evidenceRefCount+' 条执行证据','subagent-conversations-metadata'));
    if(record.toolActivity?.length)container.append(renderToolActivity(record.toolActivity));
  }

  function applySnapshot(record) {
    if (!validIdentity(record)) throw Error('子对话记录缺少任务标识');
    const nextIdentity = JSON.stringify([record.parentTaskId, record.taskId]);
    if (identity && identity !== nextIdentity) throw Error('子对话记录与当前窗口不匹配');
    const follow=!identity||nearBottom();
    identity = nextIdentity;
    const reportedActive = text(record.activeTaskId) || null;
    if (reportedActive && truncated) {
      // Keep the local truncation until the host itself reports no active task.
      activeTaskId = null;
      canSubmit = true;
      submitUnavailableReason = '';
    } else {
      activeTaskId = reportedActive;
      canSubmit = record.canSubmit === true;
      submitUnavailableReason = text(record.submitUnavailableReason);
      if (!reportedActive) truncated = false;
    }
    title.textContent = embedded?(text(record.goal).replace(/^\[任务执行\]\s*/,'').trim()||text(record.role)||'分对话'):(text(record.role)||'子智能体')+' · '+record.taskId.slice(-8);
    title.setAttribute('title', '子任务 ' + record.taskId + '\n父任务 ' + record.parentTaskId);
    status.setAttribute('role', 'status');
    status.textContent = '';
    originalBody.replaceChildren();
    renderRecord(originalBody, record);
    syncContainerAnswerDisclosures(content,liveTurns);
    turns.clear();answerSlots.clear();
    origin.replaceChildren(node('p',text(record.goal).replace(/^\[任务执行\]\s*/,'')||'任务目标未记录','subagent-conversation-user'));
    renderAnswer(origin,record);
    if(bindingLabel)bindingLabel.textContent=text(record.modelId)||'原子任务模型';
    renderMessages(messages,record.messages,renderAnswer);
    for(const taskId of liveTurns.keys())if(!turns.has(taskId)){liveTurns.delete(taskId);watermarks.delete(taskId);}
    if(follow)content.scrollTop=content.scrollHeight;
    syncControls();
  }

  async function refresh() {
    if (closed || navigating || sending || cancelling || !visible()) return;
    if(pendingActivities){refreshQueued=true;return;}
    const version = ++readVersion;
    const events=[];
    pendingActivities=events;
    status.setAttribute('role', 'status');
    if(!identity)status.textContent = '正在读取子对话…';
    content.setAttribute('aria-busy', 'true');
    try {
      const record = await invoke('subagentConversation.snapshot');
      if (current(version)) applySnapshot(record);
    } catch (error) {
      if (current(version)) showError(status, error, '无法读取子对话');
    } finally {
      pendingActivities=undefined;
      if (current(version)) content.setAttribute('aria-busy', 'false');
      if(refreshQueued){refreshQueued=false;void refresh();}
    }
  }

  async function submit() {
    if (closed || navigating || sending || !input.value.trim()) return;
    if (isStopRequest(input.value)) {
      // "停止" in this composer is an instruction to the running task, not a new message.
      if (activeTaskId) { await cancel(); return; }
      composerStatus.setAttribute('role', 'status');
      composerStatus.textContent = '当前没有正在执行的任务。';
      return;
    }
    if (!canSubmit) return;
    const value = input.value;
    if (!retryRequest || retryRequest.text !== value) {
      try {
        retryRequest = {text: value, requestId: crypto.randomUUID()};
      } catch (error) {
        showError(composerStatus, error, '无法创建消息请求标识');
        return;
      }
    }
    const request = retryRequest;
    const sentDraftVersion = draftVersion;
    const version = ++readVersion;
    sending = request;
    content.setAttribute('aria-busy', 'false');
    composerStatus.setAttribute('role', 'status');
    composerStatus.textContent = '正在提交消息…';
    syncControls();
    try {
      const result = await invoke('subagentConversation.submit', {...request});
      if (!current(version)) return;
      // A newly accepted message owns the composer again; the earlier truncation is over.
      truncated = false;
      if (validIdentity(result)) {
        applySnapshot(result);
      } else if (text(result?.acceptedTaskId)) {
        activeTaskId = result.acceptedTaskId;
        canSubmit = result.injected===true;
      } else throw Error('未收到可核实的受理记录，请刷新后使用同一消息重试');
      if (draftVersion === sentDraftVersion && input.value === value) input.value = '';
      if (retryRequest === request) retryRequest = null;
      composerStatus.textContent = result?.injected===true?'已发送给当前执行的子智能体':'消息已受理';
    } catch (error) {
      if (current(version)) {
        // The host refuses a new message while the stopped turn is still unwinding.
        if (/active or unresolved task/i.test(text(error?.message))) {
          showError(composerStatus, Error('上一条执行仍在停止中，请稍候几秒再发送'), '发送失败，草稿已保留');
        } else showError(composerStatus, error, '发送失败，草稿已保留');
      }
    } finally {
      if (sending === request) sending = null;
      syncControls();
    }
    if (current(version)) await refresh();
  }

  async function cancel() {
    if (closed || navigating || sending || cancelling || !activeTaskId) return;
    const taskId = activeTaskId;
    const version = ++readVersion;
    cancelling = taskId;
    // Forced truncation: release the composer now instead of waiting for the runtime to unwind.
    truncated = true;
    activeTaskId = null;
    canSubmit = true;
    submitUnavailableReason = '';
    content.setAttribute('aria-busy', 'false');
    composerStatus.setAttribute('role', 'status');
    composerStatus.textContent = '正在请求停止；当前输出已截断，可以继续发送新消息；执行是否停止仍待确认。';
    syncControls();
    try {
      const result = await invoke('subagentConversation.cancel', {taskId});
      if (!current(version)) return;
      if (validIdentity(result)) {
        applySnapshot(result);
        composerStatus.textContent = '停止请求已受理；可以继续发送新消息，是否停止以任务状态为准。';
      } else if (result?.cancelAccepted === true) {
        composerStatus.textContent = '停止请求已受理；可以继续发送新消息，是否停止以任务状态为准。';
      } else if (result?.cancelAccepted === false) {
        composerStatus.textContent = '当前任务未接受停止请求；本地已停止显示，可刷新核实最新状态。';
      } else throw Error('未收到可核实的停止回执，请刷新任务状态');
    } catch (error) {
      if (current(version)) showError(composerStatus, error, '停止请求未获确认；本地已停止显示，可刷新核实');
    } finally {
      if (cancelling === taskId) cancelling = null;
      syncControls();
    }
    if (current(version)) await refresh();
  }

  async function navigate(name, fallback) {
    if (closed || navigating) return;
    if(name==='subagentConversation.close'&&(input.value.trim()||sending)){
      showError(status,Error('请先发送或清空当前草稿，提交中的消息须等待受理'),fallback);return;
    }
    navigating = true;
    readVersion++;
    content.setAttribute('aria-busy', 'false');
    syncControls();
    try {
      await invoke(name);
      if (name === 'subagentConversation.close') dispose();
      else {
        status.setAttribute('role', 'status');
        status.textContent = '已返回主对话。';
      }
    } catch (error) {
      showError(status, error, fallback);
    } finally {
      navigating = false;
      syncControls();
    }
  }

  syncControls();
  void refresh();
  return {refresh,dispose,focus:()=>input.focus({preventScroll:true}),hasUnsentChanges:()=>Boolean(input.value.trim()||sending||cancelling)};
}

function renderToolActivity(rows) {
  const history=node('details','','subagent-conversation-original');
  const list=node('ol','','subagent-conversations-steps');
  const names={running:'已调用',returned:'已返回',waiting_approval:'等待授权',allowed:'已授权',denied:'已拒绝',expired:'已过期',revoked:'已撤销'};
  for(const row of rows){
    const element=node('li');
    const details=node('details');
    details.append(node('summary',text(row.label)||text(row.toolName)),node('p',names[row.state]??stateLabel(row.state),'subagent-conversations-metadata'));
    element.append(details);list.append(element);
  }
  history.append(node('summary','工具与授权记录'),list);
  return history;
}

function renderMessages(container, values, renderAnswer) {
  container.replaceChildren();
  const messages = (Array.isArray(values) ? values : []).filter(message => text(message?.taskId));
  if (!messages.length) {
    container.append(node('p', '尚无已保存的追加消息。', 'subagent-conversations-metadata'));
    return;
  }
  for (const message of messages) {
    const article = node('article', '', 'subagent-conversation-turn');
    article.setAttribute('data-task-id', message.taskId);
    article.append(node('h3', '你'), node('p', text(message.userText) || '用户消息未记录',
      'subagent-conversation-user'), node('h3', '子智能体'));
    renderAnswer(article,message);
    container.append(article);
  }
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
function escapeHtml(value) {
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
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
