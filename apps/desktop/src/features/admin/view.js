import {stateNames} from '../conversation/state.js';
import {themePreference, saveTheme, saveCalm} from '../../ui/preferences.js';
import {mountLiveVoiceControls} from '../../app/live-voice-controls.js';
import {mountSisVoiceSettings} from './sis-voice-settings.js';
import {mountNotificationSettings} from './notification-settings.js';
import {mountProactiveControls} from '../../app/proactive-controls.js';
import {mountMailControls} from '../../app/mail-controls.js';
import {mountCalendarControls} from '../../app/calendar-controls.js';
import {mountLayaControls} from '../../app/laya-controls.js';
import {mountWorkspaceControls} from '../../app/workspace-controls.js';
import {mountAgentArtsControls} from '../../app/agentarts-controls.js';
import {mountFeedsControls} from '../../app/feeds-controls.js';
import {mountNotepadControls} from '../../app/notepad-controls.js';
import {mountTodoControls} from '../../app/todo-controls.js';
import {mountGoalCloudControls} from '../../app/goal-cloud-controls.js';
import {mountKnowledgeControls} from '../../app/knowledge-controls.js';
import {mountAgentArtsModelControls} from '../../app/agentarts-model-controls.js';
import {mountModelApiControls} from '../../app/model-api-controls.js';
import {mountReferenceToolsControls} from '../../app/reference-tools-controls.js';
import {mountInstalledSkillsControls} from '../../app/installed-skills-controls.js';
import {mountKnowledgeSourceControls} from '../../app/knowledge-source-controls.js';
import {mountMemoryLearningControls} from './memory-learning-controls.js';
import {profilePage, bindProfile} from './profile.js';
import {approvalPresentation, authorizationHistoryHtml, authorizationListHtml, nextApprovalExpiry} from './approval-status.js';
import {agentArtsModelPage} from './agentarts-model.js';
import {evidencePanelHtml} from './evidence-view.js';
import {createWorkspacePatchRecoveryControls, workspacePatchRecoveryHtml} from './workspace-patch-recovery-controls.js';
import {windowControlsHtml} from '../../ui/window-controls.js';
import {matchesSettingSearch} from './setting-search.js';
import {mountPageMotion} from '../../ui/page-motion.js';

export const sections = {
  settings: '常规', import: '导入', profile: '个人资料', appearance: '外观', voice: '语音', notifications: '通知', configuration: '配置',
  personalization: '个性化', pets: '桌面宠物', shortcuts: '键盘快捷键', usage: '使用情况和计费', analytics: '分析', account: '账户',
  computer: '电脑操控', capabilities: '插件', browser: '浏览器', hooks: '钩子', connections: '连接', git: 'Git', environment: '环境', worktrees: 'Worktrees',
  tasks: '任务监控', authorizations: '安全', models: '模型', memory: '记忆', archive: '已归档任务', overview: '概览',
};

const navGroups = [
  {label: '常用', items: ['tasks', 'models', 'memory', 'notifications', 'authorizations', 'archive']},
  {label: '偏好', items: ['settings', 'profile', 'appearance', 'voice', 'personalization', 'pets', 'shortcuts']},
  {label: '集成', items: ['connections', 'computer', 'capabilities', 'configuration']},
  {label: '开发', items: ['hooks', 'git', 'environment', 'worktrees', 'analytics']},
];

const iconPaths = {
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
  import: '<path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 19h14"/>', profile: '<circle cx="12" cy="8" r="3"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/>',
  appearance: '<circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  voice: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v3"/>', configuration: '<path d="M4 7h10m4 0h2M4 17h2m4 0h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  personalization: '<path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="m18 15 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z"/>',
  pets: '<path d="M6 10 4 6m14 4 2-4M7 9c-3 1-4 4-3 7 1 4 4 5 8 5s7-1 8-5c1-3 0-6-3-7"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M10 18h4"/>',
  shortcuts: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h.01M11 9h.01M15 9h.01M7 13h.01M11 13h6M7 17h10"/>',
  usage: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10m3-8.5c-.6-1-1.6-1.5-3-1.5-1.7 0-3 1-3 2.3 0 3.7 6 1.7 6 5.4 0 1.3-1.3 2.3-3 2.3-1.4 0-2.4-.5-3-1.5"/>',
  analytics: '<path d="M4 19V9m5 10V5m6 14v-7m5 7V3"/>', account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  computer: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>', capabilities: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 14v7M14 17.5h7"/>',
  browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>', hooks: '<path d="M8 4v8a4 4 0 1 0 8 0V7"/><path d="m13 7 3-3 3 3"/>',
  connections: '<circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="m8.7 10.7 6.6-3.4m-6.6 6 6.6 3.4"/>', git: '<circle cx="6" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="6" cy="20" r="2"/><path d="M6 6v12m0-8c4 0 4-2 10-2"/>',
  environment: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 10 2 2-2 2m5 0h5"/>', worktrees: '<path d="M5 4v14m0-8h8a4 4 0 0 0 4-4V4m-4 14h6"/><circle cx="5" cy="4" r="2"/><circle cx="5" cy="20" r="2"/><circle cx="19" cy="18" r="2"/><circle cx="17" cy="4" r="2"/>',
  authorizations: '<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3z"/><path d="m9 12 2 2 4-4"/>', models: '<path d="M8 4h8l4 4v8l-4 4H8l-4-4V8l4-4z"/><circle cx="12" cy="12" r="3"/>',
  memory: '<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>', tasks: '<path d="M9 5h10M9 12h10M9 19h10"/><path d="m4 5 1 1 2-2m-3 8 1 1 2-2m-3 8 1 1 2-2"/>',
  archive: '<path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/>',
};
const icon = id => `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[id] ?? iconPaths.settings}</svg>`;

const tone = state => ['ready', 'connected'].includes(state) ? 'ready' : ['unavailable', 'disconnected', 'disabled', '未连接'].includes(state) ? 'off' : 'warn';
const badge = (label, state) => `<span class="badge" data-tone="${tone(state)}"><span class="badge-dot"></span>${label}</span>`;
const healthLabels = {ready: 'Runtime 报告就绪', connecting: '连接中', degraded: '降级', reauth_required: '需要重新授权', disconnected: '未连接', unavailable: '不可用'};

export function taskTable(data, escape, evidenceStates = new Map(), patchStates = new Map()) {
  const rows = data.tasks.map(task => {
    const recovery = patchStates.get(task.taskId)?.result;
    const displayed = recovery && recovery.revision >= task.revision
      ? {state: recovery.taskState, revision: recovery.revision} : task;
    const steps = Array.isArray(task.steps) ? task.steps : [];
    const evidenceCount = Array.isArray(task.evidenceRefs) ? task.evidenceRefs.length : 0;
    const summary = task.resultSummary ?? (task.error?.code
      ? `错误码：${task.error.code}` : 'Runtime 未提供结果摘要');
    const stepList = steps.length
      ? `<ol>${steps.map(step => `<li>${escape(step.label)} · ${escape(step.state)}</li>`).join('')}</ol>`
      : '<p>Runtime 未提供步骤记录。</p>';
    const evidence = evidenceCount
      ? `<button class="btn btn-sm" data-evidence-task="${escape(task.taskId)}">读取执行元数据</button><div data-evidence-panel="${escape(task.taskId)}">${evidencePanelHtml(evidenceStates.get(task.taskId), escape)}</div>`
      : '<span class="muted">尚无 Evidence 引用。</span>';
    const title = task.userMessage?.trim() || task.taskId;
    const identity = `<span class="task-record-title">${escape(title)}</span>${title !== task.taskId ? `<small class="task-record-id">${escape(task.taskId)}</small>` : ''}`;
    return `<tr><td>${identity}</td><td><span class="task-record-state" data-state="${escape(displayed.state)}">${stateNames[displayed.state] ?? escape(displayed.state)}</span></td><td>${displayed.revision}</td><td>${escape(summary)}</td><td>${workspacePatchRecoveryHtml(task, recovery && recovery.revision < task.revision ? undefined : patchStates.get(task.taskId), escape)}<details data-task-details="${escape(task.taskId)}" ${evidenceStates.has(task.taskId) ? 'open' : ''}><summary>步骤 ${steps.length} 项 · Evidence 引用 ${evidenceCount} 条</summary>${stepList}${evidence}</details></td></tr>`;
  }).join('');
  return `<div class="sheet"><h2>任务记录</h2><p class="muted">只展示 Runtime 任务快照；Evidence 引用数量不代表目标系统已核实。此接口未提供任务来源或云端 trace。</p><div class="table-scroll"><table><thead><tr><th>任务</th><th>状态</th><th>版本</th><th>结果摘要</th><th>步骤与证据</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">还没有任务<br>从悬浮面板开始新的对话</td></tr>'}</tbody></table></div></div>`;
}

export function mountAdmin(root, invoke, escape) {
  let section = 'settings';
  let navigationRevision = -1;
  let modelEditorOpen = false;
  let approvalExpiryTimer;
  let current = {tasks: [], capabilities: [], health: [], approvals: []};
  const patchRecovery = createWorkspacePatchRecoveryControls({invoke, changed: () => render(current)});
  window.addEventListener('unload', () => patchRecovery.close(), {once:true});
  const evidenceStates = new Map();
  const taskDetails = new Map();
  let evidenceClosed = false;
  window.addEventListener('unload', () => { evidenceClosed = true; evidenceStates.clear(); }, {once: true});
  const revocations = new Map();
  let history = {items: [], nextBeforeRowId: undefined, loading: false, loaded: false, error: false};
  let memorySearch = {query: '', hits: [], truncated: false, status: ''};
  const memorySummaries = new Map();
  let savedMemory = {facts: [], status: ''};
  let renderedSection, memoryRenderKey;
  let historyGeneration = 0;
  async function loadHistory(reset = false) {
    if (history.loading && !reset) return;
    const generation = reset ? ++historyGeneration : historyGeneration;
    const beforeRowId = reset ? undefined : history.nextBeforeRowId;
    if (reset) history = {items: [], nextBeforeRowId: undefined, loading: false, loaded: false, error: false};
    history.loading = true;
    queueMicrotask(() => {
      if (generation === historyGeneration && section === 'authorizations') render(current);
    });
    try {
      const page = await invoke('approval.history',
        beforeRowId === undefined ? {} : {beforeRowId});
      if (generation !== historyGeneration) return;
      const next = page.nextBeforeRowId;
      if (next !== undefined && (!Number.isSafeInteger(next) || next < 1
        || (beforeRowId !== undefined && next >= beforeRowId))) throw Error('Invalid approval history cursor');
      const items = new Map(history.items.map(item => [item.approvalId, item]));
      for (const item of page.items) items.set(item.approvalId, item);
      history = {items: [...items.values()], nextBeforeRowId: next,
        loading: false, loaded: true, error: false};
    } catch {
      if (generation !== historyGeneration) return;
      history = {...history, loading: false, error: true};
    }
    if (section === 'authorizations') render(current);
  }
  const clearApprovalExpiryTimer = () => {
    if (approvalExpiryTimer === undefined) return;
    clearTimeout(approvalExpiryTimer);
    approvalExpiryTimer = undefined;
  };
  window.addEventListener('unload', clearApprovalExpiryTimer, {once: true});
  root.innerHTML = `<div class="admin"><header class="admin-bar"><span class="admin-title">PersonalAgent · 设置</span><span class="spacer"></span>${windowControlsHtml('admin')}</header><aside class="side"><div class="side-home"><span class="brand">PersonalAgent</span><span>设置与管理</span></div><label class="admin-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="admin-search" type="search" placeholder="搜索设置…" aria-label="搜索设置"></label><nav aria-label="设置导航">${navGroups.map(group => `<section class="nav-group"><h2>${group.label}</h2>${group.items.map(id => `<button data-page="${id}" title="${sections[id]}">${icon(id)}<span>${sections[id]}</span></button>`).join('')}</section>`).join('')}</nav><footer>私人助理 · Windows<br>冷光青 / 标准毛玻璃</footer></aside><section class="main"><div class="eyebrow">PERSONAL WORKSPACE</div><h1 id="page-title"></h1><div class="banner" id="connection"></div><div id="content"></div><p class="error" role="alert" id="error"></p></section></div>`;
  root.querySelector('#content').addEventListener('click', async event => {
    const button = event.target.closest('#desktop-local-settings');
    if (!button || button.disabled) return;
    button.disabled = true;
    try { await window.desktop.openSettings(); }
    catch (error) { root.querySelector('#error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  root.querySelector('#content').addEventListener('toggle', event => {
    const details = event.target;
    if (details.isConnected && details.dataset.taskDetails) taskDetails.set(details.dataset.taskDetails, details.open);
  }, true);
  const remoteMcpButton=document.createElement('button');remoteMcpButton.type='button';remoteMcpButton.id='remote-mcp-manage';remoteMcpButton.className='btn btn-sm';remoteMcpButton.hidden=true;
  remoteMcpButton.textContent='远程 MCP 管理';
  remoteMcpButton.addEventListener('click',()=>invoke('remoteMcp.open').catch(error=>{root.querySelector('#error').textContent=error.message;}));
  root.querySelector('.admin-bar').insertBefore(remoteMcpButton,root.querySelector('.window-controls'));
  let liveControls,proactiveControls,mailControls,calendarControls,layaControls,codingControls,agentArtsControls,feedsControls,notepadControls,todoControls,goalCloudControls,knowledgeControls,modelApiControls,agentArtsModelControls,referenceControls,knowledgeSourceControls,memoryLearningControls,memoryLearningRoot;
  let installedSkillsControls,sisControls,notificationControls;
  let modelApiSignature,agentArtsModelRoot,agentArtsConnectionRoot,modelApiRoot,renderedContentMarkup,renderedPreferenceKey;
  const showPage = mountPageMotion(root.querySelector('.main'));

  function capabilityTable(data) {
    const status = data.capabilityDirectory ?? {state: 'unavailable', reason: '可信宿主尚未报告能力目录状态'};
    const health = new Map(data.health.map(item => [item.id, item]));
    const rows = data.capabilities.map(item => {
      const state = health.get(item.name);
      const label = state ? healthLabels[state.state] ?? '状态未知' : '状态未报告';
      const scopes = Array.isArray(item.requiredScopes) ? item.requiredScopes.join(', ') : '—';
      return `<tr><td>${escape(item.name ?? '—')}</td><td>${escape(item.version ?? '—')}</td><td>${escape(item.sideEffect ?? '—')}</td><td>${escape(scopes || '—')}</td><td>${badge(escape(label), state?.state)}${state?.reason ? `<br><small>${escape(state.reason)}</small>` : ''}</td></tr>`;
    }).join('');
    const empty = status.state === 'loaded' ? 'Runtime 已确认返回空能力目录。' : escape(status.reason);
    return `<div class="sheet"><div class="row"><h2>已公布能力</h2><span class="spacer"></span><button class="btn btn-sm" id="refresh-capabilities">刷新</button></div><p class="muted" role="${status.state === 'error' ? 'alert' : 'status'}">${escape(status.reason)}</p><p class="muted">健康状态来自 Runtime 能力目录，不代表外部服务已经验收。</p><div class="row"><button class="btn btn-sm" data-jump="models">模型状态</button><button class="btn btn-sm" data-jump="connections">连接健康</button><button class="btn btn-sm" data-jump="authorizations">授权</button></div><div class="table-scroll"><table><thead><tr><th>名称</th><th>版本</th><th>副作用</th><th>范围</th><th>健康</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">${empty}</td></tr>`}</tbody></table></div></div>`;
  }

  function healthTable(data) {
    const rows = data.health.map(item => `<tr><td>${escape(item.id)}</td><td>${badge(escape(healthLabels[item.state] ?? '状态未知'), item.state)}</td><td>${escape(item.reason ?? '—')}</td></tr>`).join('');
    const status = data.capabilityDirectory ?? {state: 'unavailable', reason: '可信宿主尚未报告能力目录状态'};
    const empty = status.state === 'loaded' ? 'Runtime 未报告连接健康项。' : escape(status.reason);
    return `<div class="sheet"><div class="row"><h2>连接健康</h2><span class="spacer"></span><button class="btn btn-sm" data-jump="capabilities">查看能力目录</button></div><p class="muted" role="${status.state === 'error' ? 'alert' : 'status'}">${escape(status.reason)}</p><p class="muted">仅列出 Runtime 能力目录报告的健康项；未公布的外部连接不会出现在这里。</p><div class="table-scroll"><table><thead><tr><th>能力</th><th>状态</th><th>说明</th></tr></thead><tbody>${rows || `<tr><td colspan="3" class="empty">${empty}</td></tr>`}</tbody></table></div></div>`;
  }

  function modelEditor(data) {
    const model = data.model ?? {};
    const thinking = data.thinking ?? {depth: 1, fast: false, reason: 'Runtime 尚未公开思考参数契约'};
    const status = model.status === 'ready' ? '已测试' : model.status === 'configured' ? '待测试' : '未连接';
    const capabilityText = model.capabilities ? `文本：${model.capabilities.text ? '支持' : '不支持'} · 流式：${model.capabilities.streaming ? '支持' : '关闭'} · 工具调用：${model.capabilities.toolCalling ? '支持' : '关闭'}` : '能力尚未读取';
    return `<div class="model-editor"><div class="model-editor-head"><div><h2>${model.configured ? '编辑模型' : '添加模型'}</h2><p>盘古 V2 · OpenAI 兼容接口</p></div><button class="icon-btn" id="model-editor-close" aria-label="关闭模型编辑器">×</button></div><div class="settings-grid"><div class="sheet"><form id="model-config-form" class="settings-form"><label>Endpoint<input id="model-base-url" name="baseUrl" type="url" placeholder="https://api.modelarts-maas.com/openai/v1" value="${escape(model.baseUrl ?? '')}" required></label><label>模型名称<input id="model-name" name="model" value="${escape(model.model ?? 'pangu-nlp-n1-32k')}" required></label><label>部署名称<input id="model-deployment" name="deployment" value="${escape(model.deployment ?? model.model ?? 'pangu-nlp-n1-32k')}" required></label><label>API Key<input id="model-api-key" name="apiKey" type="password" autocomplete="off" placeholder="${model.keyConfigured ? '已安全保存 · 留空沿用' : '输入 API Key'}"></label><div class="form-actions"><button class="btn btn-primary" type="submit" id="model-save">保存模型</button><button class="btn" type="button" id="model-test" ${model.configured && model.enabled !== false ? '' : 'disabled'}>测试连接</button></div></form><p class="settings-status">${badge(status, model.status)} ${escape(model.reason ?? '尚未测试')}<br><span class="muted">${escape(capabilityText)}</span></p></div><div class="sheet thinking-sheet"><h2>推理偏好</h2><p class="muted">${thinking.applied ? '已传入 Runtime 任务执行契约，控制单任务最大步数及快慢模式' : '仅保存为桌面偏好；Runtime 尚未公开思考参数字段，因此不会伪装成已传入任务。'}</p><label class="range-label"><span>思考深度 <b id="thinking-depth-label">${['最低','低','平衡','深入','高','最高'][thinking.depth] ?? '低'}</b></span><input id="thinking-depth" type="range" min="0" max="5" step="1" value="${Number(thinking.depth) || 0}"></label><label class="toggle-row"><input id="thinking-fast" type="checkbox" ${thinking.fast ? 'checked' : ''}>快速模式</label><p class="settings-status" id="thinking-status">${escape(thinking.reason ?? 'Runtime 尚未公开思考参数契约')}</p></div></div></div>`;
  }

  function modelPage(data) {
    const item = data.model ?? {};
    if (item.provider === 'agentarts') return agentArtsModelPage(item, escape);
    const configured = Boolean(item.configured);
    const enabled = configured && item.enabled !== false;
    const status = item.status === 'ready' ? '连接正常' : item.status === 'configured' ? '等待测试' : item.status === 'disabled' ? '已停用' : item.status === 'error' ? '连接失败' : '未配置';
    const modelName = item.provider === 'fake' ? item.label : configured ? item.model : '盘古大模型 2.0';
    const providerLine = item.provider === 'fake' ? '离线联调 · 不调用真实服务' : configured ? `Huawei Cloud · ${item.deployment || item.model}` : '尚未配置 Endpoint 与 API Key';
    return `<div class="model-page"><div class="page-lead"><div><h2>模型</h2><p>使用自己的 API Key 管理 PersonalAgent 的模型。</p></div><button class="btn btn-primary" id="model-add">＋ ${configured ? '编辑模型' : '添加模型'}</button></div><div class="model-list" aria-label="模型列表"><div class="model-item"><span class="provider-mark" aria-hidden="true">P</span><span class="model-copy"><b>${escape(modelName)}</b><small>${escape(providerLine)}</small></span><span class="model-state">${badge(status, item.status)}</span><button class="model-more" id="model-more" aria-label="编辑模型">•••</button><label class="switch-control" title="${configured ? '启用或停用该模型' : '保存模型后可启用'}"><input id="model-enabled" type="checkbox" ${enabled ? 'checked' : ''} ${configured ? '' : 'disabled'}><span></span></label></div></div>${modelEditorOpen ? modelEditor(data) : '<p class="model-footnote">API Key 仅进入主进程，并由 Windows 安全存储加密；列表不会显示密钥内容。</p>'}</div>`;
  }

  const settingRow = (title, detail, control, extra = '') => `<div class="setting-row ${extra}" data-setting-text="${escape(`${title} ${detail}`.toLowerCase())}"><span><b>${escape(title)}</b><small>${escape(detail)}</small></span><span class="setting-control">${control}</span></div>`;
  const capabilitySummary = (data, key = 'capabilities') => data.capabilityDirectory?.state === 'loaded'
    ? `${data[key]?.length ?? 0} ${key === 'health' ? '项状态' : '项已公布'}`
    : data.capabilityDirectory?.reason ?? '能力目录状态未报告';

  function settingsPane(data, selected = 'general') {
    const agentArts = data.model?.provider === 'agentarts';
    const modelStatus = agentArts
      ? data.model?.configured && data.model?.status !== 'error' ? '由可信主进程配置；任务仍需读回验证' : '不可用'
      : data.model?.status === 'ready' ? '已测试并连接' : data.model?.configured ? '已配置，等待测试' : '未配置';
    const panes = {
      general: ['常规', '管理应用的基础行为与入口',
        settingRow('桌面与窗口', '调整语言、字体缩放和悬浮球行为，或查看窗口诊断', '<button type="button" class="btn btn-sm" id="desktop-local-settings">桌面偏好</button>') +
        settingRow('模型与 API', agentArts ? '在模型页面管理 AgentArts 运行时和本机加密凭据' : '模型、Endpoint 和密钥在独立页面管理', '<button class="btn btn-sm" data-jump="models">打开模型</button>') +
        settingRow('开机启动', '宿主能力尚未接入', '<span class="status-note">待接入</span>', 'is-unavailable') +
        settingRow('后台驻留', '关闭面板后托盘仍保持运行', '<span class="value-pill">已启用</span>') +
        settingRow('退出应用', '结束托盘、ORB 与所有桌面窗口', '<button class="btn btn-danger btn-sm" id="quit">退出应用</button>')],
      appearance: ['外观', '延续 ORB-02 冷光青与标准毛玻璃设计',
        settingRow('界面主题', '所有窗口统一使用黑白主题，支持跟随系统自动切换', '<select id="pref-theme" aria-label="界面主题"><option value="system">跟随系统</option><option value="dark">深色</option><option value="light">浅色</option></select>') +
        settingRow('降低动效', '暂停轨道脉冲并移除界面位移动效', '<label class="switch-control"><input id="pref-calm" type="checkbox" aria-label="降低动效"><span></span></label>') +
        settingRow('玻璃材质', '标准毛玻璃，由当前设计方案锁定', '<span class="value-pill">标准</span>') +
        settingRow('ORB-02', '黑核、白色规则点阵、球体模糊关闭', '<span class="value-pill">当前方案</span>')],
      interaction: ['交互', '悬浮球、面板与输入行为',
        settingRow('靠近展开', '指针进入 ORB 周围 90px 后展开面板', '<span class="value-pill">90px</span>') +
        settingRow('对话面板宽度', '桌面固定宽度，窄屏自动收缩', '<span class="value-pill">420px</span>') +
        settingRow('任务取消', '只显示 Runtime 回读后的最终状态', '<span class="value-pill">严格确认</span>') +
        settingRow('默认终端', '终端连接器尚未提供选择接口', '<span class="status-note">待接入</span>', 'is-unavailable')],
      voice: ['语音', '听写、原生实时对话和加密凭据',
        settingRow('麦克风听写', '本地 SIS 适配仅填草稿；经 AgentArts 的 SIS 适配当前不可用', `<span class="value-pill">${data.voice?.configuration?.configured ? '配置已保存' : '未配置'}</span>`) +
        settingRow('Live 实时语音', data.live?.reason ?? '在下方配置百炼北京业务空间和 API Key', `<span class="value-pill">${data.live?.active ? '通话中' : data.live?.configured ? '已配置' : '未配置'}</span>`) +
        settingRow('语音播报', '停止播报与任务取消保持独立', '<span class="value-pill">安全隔离</span>')],
      notifications: ['通知', '任务状态与需要用户处理的提醒',
        settingRow('应用内通知', '当前只显示真实 Runtime 状态', '<span class="value-pill">已启用</span>') +
        settingRow('系统通知', '按当前打扰策略投递，系统 show 回执与用户已读分别核实', `<span class="value-pill">${data.notificationCenter?.available?'宿主已装配，设备待验':'等待 Runtime'}</span>`) +
        settingRow('授权提醒', '待处理授权会出现在“授权”页面', '<button class="btn btn-sm" data-jump="authorizations">查看授权</button>')],
      privacy: ['隐私与数据', '敏感数据与本地运行边界',
        (agentArts
          ? settingRow('AgentArts 凭据', '已保存的密钥不回传界面；在模型页面配置或更换', '<button class="btn btn-sm" data-jump="models">管理配置</button>')
          : settingRow('API Key', data.model?.persisted ? '由 Windows 安全存储加密' : '尚未持久化到本机安全存储', `<span class="value-pill">${data.model?.persisted ? '已加密' : '未保存'}</span>`)) +
        settingRow('模型状态', modelStatus, `<button class="btn btn-sm" data-jump="models">${agentArts ? '查看状态' : '管理'}</button>`) +
        settingRow('任务数据', '本地 Runtime 按公共契约保存；界面不绕过 Runtime', '<span class="value-pill">本地</span>') +
        settingRow('数据导出与清除', '对应模块尚未接入，避免提供无效操作', '<span class="status-note">待接入</span>', 'is-unavailable')],
      permissions: ['权限', '所有副作用操作都由 Runtime 校验',
        settingRow('默认策略', '外部内容不能提升权限，工具声明不构成授权', '<span class="value-pill">拒绝优先</span>') +
        settingRow('一次性授权', '在执行前逐项允许或拒绝', '<button class="btn btn-sm" data-jump="authorizations">处理授权</button>') +
        settingRow('能力范围', '查看 Runtime 当前公开的能力与作用域', '<button class="btn btn-sm" data-jump="capabilities">查看能力</button>')],
      shortcuts: ['快捷键', '当前可用的桌面输入快捷键',
        settingRow('发送消息', '输入框内提交任务', '<kbd>Enter</kbd>') +
        settingRow('换行', '在输入框中插入新行', '<kbd>Shift</kbd><span class="key-plus">＋</span><kbd>Enter</kbd>') +
        settingRow('收起面板', '使用面板右上角关闭按钮', '<span class="value-pill">右上角 ✕</span>') +
        settingRow('Live 开启 / 关闭', data.live?.shortcut?.reason || '在语音设置中修改全局快捷键', `<kbd>${escape(data.live?.shortcut?.key ?? 'F8')}</kbd><button class="btn btn-sm" data-jump="voice">语音设置</button>`)],
      diagnostics: ['诊断与关于', '运行状态、版本边界与应用操作',
        settingRow('Runtime', data.connectionError ? `${data.connection} · ${data.connectionError}` : data.connection, '<button class="btn btn-sm" data-jump="connections">连接状态</button>') +
        settingRow('能力目录', capabilitySummary(data), '<button class="btn btn-sm" data-jump="capabilities">查看目录</button>') +
        settingRow('PersonalAgent Desktop', 'MOD-11 / MOD-12 / MOD-13 开发版本', '<span class="value-pill">Windows</span>') +
        settingRow('退出应用', '结束托盘、ORB 与所有桌面窗口', '<button class="btn btn-danger btn-sm" id="quit">退出</button>')],
    };
    const pane = panes[selected] ?? panes.general;
    return `<section class="settings-content settings-single"><div class="settings-heading"><h2>${pane[0]}</h2><p>${pane[1]}</p></div><div class="settings-list">${pane[2]}</div></section>`;
  }

  function featurePage(data, id) {
    const features = {
      import: ['导入', '从受支持的数据源迁移个人资料、偏好和记忆。', [['数据文件', '导入协议尚未接入', '待接入'], ['ChatGPT 数据', '当前不会读取第三方账户数据', '不可用'], ['导入记录', '完成真实导入后在此显示', '0 项']]],
      profile: ['个人资料', '管理 PersonalAgent 在本机使用的身份信息。', [['显示名称', '个人资料模块尚未接入', '待设置'], ['头像', '使用本地资源，不会自动上传', '待设置'], ['时区', '跟随 Windows 系统', 'Asia/Shanghai']]],
      configuration: ['配置', '集中查看模型、Runtime 与能力配置。', [['模型网关', data.model?.reason ?? '状态未知', 'models'], ['Runtime', data.connection, 'connections'], ['已公布能力', capabilitySummary(data), 'capabilities']]],
      personalization: ['个性化', '管理回答偏好、工作方式和长期习惯。', [['回答风格', '个性化模块尚未接入 Runtime', '待接入'], ['主动建议', '只在有依据且无需额外授权时提出', '受控'], ['长期偏好', '由记忆模块确认后保存', 'memory']]],
      pets: ['桌面宠物', '管理 ORB-02 与未来可选桌面伙伴。', [['当前伙伴', 'ORB-02 · 黑核与白色规则点阵', '已启用'], ['靠近响应', '进入 90px 范围展开对话', '90px'], ['宠物库', '额外角色资源尚未接入', '待接入']]],
      usage: ['使用情况和计费', '查看本地任务使用情况与模型供应商计费边界。', [['本次会话任务', `${data.tasks?.length ?? 0} 个`, 'tasks'], ['模型费用', '由模型供应商账户结算，本应用尚未读取账单', '不可用'], ['额度限制', 'Runtime 尚未公开统一用量接口', '待接入']]],
      analytics: ['分析', '查看任务成功率、耗时和能力调用趋势。', [['任务分析', '分析模块尚未接入真实聚合数据', '待接入'], ['模型延迟', data.model?.latencyMs == null ? '尚无真实连接测试结果' : `${data.model.latencyMs} ms`, 'models'], ['连接健康', capabilitySummary(data, 'health'), 'connections']]],
      account: ['账户', '管理本地身份与外部服务连接。', [['PersonalAgent 账户', '当前版本使用本地桌面身份', '本地'], ['外部账户', '通过连接器单独授权，不共享密钥', 'connections'], ['订阅', 'PersonalAgent 尚未提供订阅系统', '不可用']]],
      computer: ['电脑操控', '管理 Windows 桌面操作能力与安全边界。', [['电脑操作', 'Windows Host 模块尚未完成真实接入', '待接入'], ['执行策略', '串行操作，同一资源写入加锁', '受控'], ['授权', '副作用操作必须经过 Runtime 校验', 'authorizations']]],
      browser: ['浏览器', '管理网页读取、导航与浏览器自动化连接。', [['浏览器后端', '浏览器连接器尚未接入桌面 Runtime', '未连接'], ['站点权限', '按连接器和任务单独授权', 'authorizations'], ['下载', '不会在未授权时创建文件', '受控']]],
      hooks: ['钩子', '配置任务生命周期中的受控扩展点。', [['任务开始', 'Hook 契约尚未发布', '待接入'], ['工具调用前', '策略网关始终先于外部执行', '固定'], ['任务完成', '只根据 Runtime 最终状态触发', '固定']]],
      git: ['Git', '管理仓库状态、分支与协作能力。', [['Git 集成', 'Git 连接器尚未接入 Runtime', '未连接'], ['默认分支策略', '不会自行覆盖他人分支或未提交改动', '安全'], ['凭据', '不在前端保存 Git 凭据', '隔离']]],
      environment: ['环境', '管理任务运行时、终端和环境变量边界。', [['集成终端', 'Shell 选择接口尚未接入', '待接入'], ['环境变量', '不会显示或记录敏感变量值', '受保护'], ['Runtime', data.connection, 'connections']]],
      worktrees: ['Worktrees', '管理隔离工作树与共享仓库协作。', [['工作树管理', 'Worktree 连接器尚未接入桌面 Runtime', '待接入'], ['冲突保护', '不切换他人正在使用的分支', '启用'], ['项目边界', '依赖当前打开的工作区', '固定']]],
      archive: ['已归档任务', '查看和恢复已归档的任务记录。', [['归档列表', 'Runtime 尚未公开任务归档接口', '待接入'], ['自动归档', '不会在未授权时自动移动任务', '关闭'], ['保留策略', '等待归档模块定义', '未设置']]],
      memory: ['记忆', '管理经确认的偏好和工作流记忆。', [['记忆服务', '记忆模块尚未连接桌面 Runtime', '未连接'], ['写入策略', '仅保存已确认的偏好和验证过的工作流', '受控'], ['导出与清除', '等待记忆模块提供真实接口', '待接入']]],
    };
    const feature = features[id];
    if (!feature) return `<div class="sheet"><h2>${sections[id]}</h2><div class="empty">此模块尚未接入真实服务。</div></div>`;
    return `<section class="feature-page"><div class="settings-heading"><h2>${feature[0]}</h2><p>${escape(feature[1])}</p></div><div class="settings-list">${feature[2].map(([title, detail, target]) => settingRow(title, detail, sections[target] ? `<button class="btn btn-sm" data-jump="${target}">${sections[target]}</button>` : `<span class="${['待接入','不可用','未连接','待设置','未设置'].includes(target) ? 'status-note' : 'value-pill'}">${target}</span>`)).join('')}</div></section>`;
  }

  function memoryPage(data) {
    if (!data.privateMemory?.available) return featurePage(data, 'memory');
    const selected = data.privateMemory.vaultSelected;
    const citationLabel = value => {
      if (typeof value === 'string' && value.startsWith('wiki-v1:')) {
        try {
          const source = JSON.parse(value.slice(8));
          if (typeof source?.path === 'string' && Number.isSafeInteger(source.line)) return `${source.path}:${source.line}`;
        } catch { /* Preserve an unrecognized reference as text. */ }
      }
      return value;
    };
    const hits = memorySearch.hits.map((hit, index) => `<article class="sheet memory-hit">
      <p class="memory-excerpt">${escape(hit.excerpt)}</p><small>${escape(hit.source.path)}:${hit.source.line}</small>
      <label class="memory-field">拟保存的私人记忆<input data-memory-summary="${index}" maxlength="500"
        value="${escape(memorySummaries.get(index) ?? '')}" placeholder="逐条填写并确认摘要"></label>
      <button class="btn btn-sm" data-memory-save="${index}" ${data.privateMemory.writeEnabled ? '' : 'disabled'}>检查并确认</button></article>`).join('');
    const saved = savedMemory.facts.map((fact, index) => `<article class="sheet memory-hit">
      <p class="memory-excerpt">${escape(fact.summary)}</p><small>${escape(citationLabel(fact.sourceRef))}</small>
      <p class="muted">版本 ${escape(fact.ref.revision)}${fact.state === 'withdrawn' ? fact.confirmation === 'external_observation' ? ' · 来源已变化，后续任务不可消费' : ' · 已撤回，后续任务不可消费' : ''}</p>
      ${fact.state==='active' ? `<button class="btn btn-sm" data-memory-withdraw="${index}">撤回</button>` : ''}
      <button class="btn btn-sm btn-danger" data-memory-delete="${index}">删除所有版本</button></article>`).join('');
    return `<section class="feature-page"><div class="settings-heading"><h2>私人记忆</h2>
      <p>只读检索本机 Vault；每条摘录或更正都需在原生对话框中确认。不会自动发送至云端。</p></div>
      <div class="sheet memory-card"><div class="memory-actions"><button class="btn btn-sm" id="memory-select-vault">选择本机 Vault 文件夹</button></div>
      <p class="muted">${data.knowledgeSource?.pairing?.mode==='plugin'
        ? selected ? '使用已配对 Obsidian 的只读摘录；每条记忆仍需确认。' : 'Obsidian 配对已失效，请重新配对；已保存记忆仍可管理。'
        : selected ? '使用已选择的本机知识源；可在知识源设置中停用或撤销。' : '尚未选择可用知识源。'}</p>
      <form id="memory-search-form" class="memory-search"><input id="memory-query" type="search" maxlength="200"
        value="${escape(memorySearch.query)}" placeholder="搜索摘录" ${selected ? '' : 'disabled'}>
        <button class="btn btn-sm" ${selected ? '' : 'disabled'}>搜索</button></form>
      <p role="status">${escape(data.privateMemory.writeEnabled ? memorySearch.status
        : '真实私人记忆写入等待完整删除保障验收；当前可只读检索及删除已保存记录。')}</p></div>${hits}
      <div class="sheet"><button class="btn btn-sm" id="memory-list-saved">查看已保存记忆</button>
      <p id="memory-saved-status" role="status">${escape(savedMemory.status)}</p>${saved}
      ${savedMemory.nextCursor ? '<button class="btn btn-sm" id="memory-list-next">下一页</button>' : ''}</div>
      ${memorySearch.truncated ? '<p class="muted">结果已截断，请缩小搜索范围。</p>' : ''}</section>`;
  }

  function render(data, refreshMemory = false) {
    current = data;
    for (const taskId of evidenceStates.keys()) {
      if (!data.tasks.some(task => task.taskId === taskId)) evidenceStates.delete(taskId);
    }
    for (const taskId of taskDetails.keys()) {
      if (!data.tasks.some(task => task.taskId === taskId)) taskDetails.delete(taskId);
    }
    const consumableMemoryRefs = savedMemory.facts.filter(fact => fact.state === 'active'
      && Date.parse(fact.validFrom) <= Date.now() && Date.now() < Date.parse(fact.validUntil)).map(fact => fact.ref);
    clearApprovalExpiryTimer();
    if (data.adminNavigation && data.adminNavigation.revision !== navigationRevision) {
      navigationRevision = data.adminNavigation.revision;
      if (sections[data.adminNavigation.page]) section = data.adminNavigation.page;
    }
    if (root.querySelector('#profile-dialog')?.open) return;
    patchRecovery.sync(data.tasks, section === 'tasks' || section === 'overview', section);
    root.querySelector('.main').dataset.section = section;
    showPage(section);
    remoteMcpButton.hidden=!data.remoteMcp;
    if (section==='voice') {liveControls ??= mountLiveVoiceControls(root,invoke);sisControls ??= mountSisVoiceSettings(root,invoke);}
    liveControls?.render(data.live);liveControls?.showSettings(section==='voice',section==='voice');
    sisControls?.render(data.voice);sisControls?.showSettings(section==='voice');
    if(section==='notifications') notificationControls??=mountNotificationSettings(root.querySelector('.main'),invoke);
    notificationControls?.render(data.notificationCenter,data.voiceQuestion,data.approvals??[]);notificationControls?.show(section==='notifications');
    if (section==='computer') proactiveControls ??= mountProactiveControls(root.querySelector('.main'),invoke,{settings:true});
    proactiveControls?.render(data.proactive);proactiveControls?.show(section==='computer');
    if (section==='computer' && data.notepad) notepadControls ??= mountNotepadControls(root.querySelector('.main'),invoke);
    notepadControls?.render(data.notepad);notepadControls?.show(section==='computer');
    if (section==='connections' && data.mail) mailControls ??= mountMailControls(root.querySelector('.main'),invoke);
    mailControls?.render(data.mail);mailControls?.showSettings(section==='connections');
    if (section==='connections' && data.calendar) calendarControls ??= mountCalendarControls(root.querySelector('.main'),invoke);
    calendarControls?.render(data.calendar);calendarControls?.show(section==='connections');
    if (section==='connections' && data.feeds) feedsControls ??= mountFeedsControls(root.querySelector('.main'),invoke);
    feedsControls?.render(data.feeds);feedsControls?.show(section==='connections');
    if(section==='connections' && data.todo) todoControls ??= mountTodoControls(root.querySelector('.main'),invoke);
    todoControls?.render(data.todo);todoControls?.show(section==='connections');
    if(section==='connections' && data.goalCloud) goalCloudControls ??= mountGoalCloudControls(root.querySelector('.main'),invoke);
    goalCloudControls?.render(data.goalCloud);goalCloudControls?.show(section==='connections');
    if ((section==='connections' || section==='memory') && data.laya) layaControls ??= mountLayaControls(root.querySelector('.main'),invoke);
    layaControls?.render(data.laya);layaControls?.show(section==='connections' || section==='memory');
    if (section==='memory' && data.knowledge) knowledgeControls ??= mountKnowledgeControls(root.querySelector('.main'),invoke);
    knowledgeControls?.render(data.knowledge, data.knowledgeWatch);knowledgeControls?.show(section==='memory');
    if(section==='memory' && data.knowledgeSource) knowledgeSourceControls??=mountKnowledgeSourceControls(root.querySelector('.main'),invoke);
    knowledgeSourceControls?.update(data.knowledgeSource);
    if(knowledgeSourceControls) knowledgeSourceControls.element.hidden=section!=='memory';
    if(section==='memory' && data.memoryLearning && !memoryLearningControls) {
      memoryLearningRoot=document.createElement('div');memoryLearningRoot.className='memory-learning-settings';
      root.querySelector('.main').append(memoryLearningRoot);
      memoryLearningControls=mountMemoryLearningControls(memoryLearningRoot,{invoke,status:data.memoryLearning,refs:consumableMemoryRefs,
        onMemoryChanged:async()=>{
          const page=await invoke('memory.listSaved');
          savedMemory={...page,status:'已刷新当前版本，包含已撤回的记忆。'};
          render(current);
        }});
    }
    if(memoryLearningRoot) memoryLearningRoot.hidden=section!=='memory';
    memoryLearningControls?.update({status:data.memoryLearning,refs:consumableMemoryRefs});
    if (section==='worktrees' || section==='environment') codingControls ??= mountWorkspaceControls(root.querySelector('.main'),invoke);
    codingControls?.render(data);codingControls?.show(section==='worktrees' || section==='environment');
    if(section==='capabilities' && data.reference) referenceControls??=mountReferenceToolsControls(root.querySelector('.main'),invoke);
    referenceControls?.render(data.reference);referenceControls?.show(section==='capabilities');
    if(section==='capabilities' && data.installedSkills) installedSkillsControls??=mountInstalledSkillsControls(root.querySelector('.main'),invoke);
    installedSkillsControls?.render(data.installedSkills,data.tasks,data.installedSkills?.runtimeAvailable && data.model?.provider==='agentarts' && data.model?.configured && data.model?.enabled!==false);
    installedSkillsControls?.show(section==='capabilities');
    const showAgentArts=section==='models' && data.model?.provider==='agentarts';
    if (showAgentArts) {
      if(!agentArtsControls){agentArtsConnectionRoot=document.createElement('div');agentArtsConnectionRoot.dataset.modelSettingsSection='connection';agentArtsControls=mountAgentArtsControls(agentArtsConnectionRoot,invoke);}
      agentArtsControls.render(data.agentArts);
    }
    agentArtsControls?.show(showAgentArts);
    if (section === 'models' && data.modelApi) {if(!modelApiControls){modelApiRoot=document.createElement('div');modelApiRoot.dataset.modelSettingsSection='independent-api';modelApiControls=mountModelApiControls(modelApiRoot,invoke);}if(!agentArtsModelControls){agentArtsModelRoot=document.createElement('div');agentArtsModelRoot.dataset.agentartsModelMounted='true';agentArtsModelRoot.dataset.modelSettingsSection='model-selection';agentArtsModelControls=mountAgentArtsModelControls(agentArtsModelRoot,invoke);}}
    agentArtsModelControls?.update(data.agentArtsModels);
    const nextModelApiSignature = JSON.stringify(data.modelApi,(key,value)=>key==='requestBudget'?undefined:value);
    if (modelApiControls && modelApiSignature !== nextModelApiSignature) {
      modelApiControls.render(data.modelApi);modelApiSignature=nextModelApiSignature;
    }
    else if (modelApiControls && data.modelApi) modelApiControls.updateBudget(data.modelApi);
    modelApiControls?.showSettings(section === 'models');
    if(agentArtsModelRoot)agentArtsModelRoot.hidden=section!=='models';
    if(agentArtsConnectionRoot)agentArtsConnectionRoot.hidden=!showAgentArts;
    if(modelApiRoot)modelApiRoot.hidden=section!=='models';
    root.querySelector('.main').dataset.cloudConfig=String(section==='models' && data.model?.provider==='agentarts');
    const directSettings = {settings: 'general', appearance: 'appearance', voice: 'voice', notifications: 'notifications', shortcuts: 'shortcuts'};
    const featureSections = ['import', 'profile', 'configuration', 'personalization', 'pets', 'usage', 'analytics', 'account', 'computer', 'browser', 'hooks', 'git', 'environment', 'worktrees', 'archive', 'memory'];
    root.querySelector('.main').dataset.surface = section === 'models' ? 'models' : directSettings[section] || featureSections.includes(section) ? 'settings' : 'standard';
    root.querySelector('#page-title').textContent = sections[section];
    const connection = data.connectionError ? `${data.connection} · ${data.connectionError}` : data.connection;
    root.querySelector('#connection').textContent = `${connection}。未连接的能力会保持明确的不可用状态。`;
    root.querySelectorAll('[data-page]').forEach(button => button.setAttribute('aria-current', button.dataset.page === section ? 'page' : 'false'));
    const agentArts = data.model?.provider === 'agentarts';
    const modelTitle = agentArts ? 'AgentArts · Competition Profile'
      : data.model?.provider === 'fake' ? 'Fake Model · 离线测试' : '盘古大模型 2.0';
    const modelLabel = agentArts
      ? data.model?.configured && data.model?.status !== 'error' ? '已配置' : '不可用'
      : data.model?.provider === 'fake' ? '离线联调'
        : data.model?.status === 'ready' ? '已连接' : '未连接';
    const modelReason = data.model?.reason ?? '模型 Provider 状态未知';
    // The HTML and expiry selection must describe the same instant.
    const approvalNow = Date.now();
    let content = '';
    if (section === 'overview') {
      content = `<p class="muted">把注意力留给重要的事。</p><div class="cards"><div class="card"><span>本次会话任务</span><b>${data.tasks.length}</b></div><div class="card"><span>${modelTitle}</span><b>${modelLabel}</b><span>${escape(modelReason)}</span></div><div class="card"><span>麦克风</span><b>未连接</b><span>语音供应商尚未接入</span></div></div>${taskTable(data, escape, evidenceStates, patchRecovery.entries)}`;
    } else if (section === 'capabilities') {
      content = capabilityTable(data);
    } else if (section === 'models') {
      content = modelPage(data);
    } else if (section === 'connections') {
      content = healthTable(data);
    } else if (section === 'tasks') {
      content = taskTable(data, escape, evidenceStates, patchRecovery.entries);
    } else if (section === 'authorizations') {
      content = authorizationListHtml(data.approvals, escape, approvalNow, {canRevoke: true, revocations})
        + authorizationHistoryHtml(history.items, escape, history, approvalNow, {canRevoke: true, revocations});
    } else if (directSettings[section]) {
      content = settingsPane(data, directSettings[section]);
    } else if (section === 'profile') {
      content = profilePage(data, escape);
    } else if (section === 'memory') {
      content = memoryPage(data);
    } else if (section === 'computer') {
      content = '';
    } else if (featureSections.includes(section)) {
      content = featurePage(data, section);
    } else {
      content = `<div class="sheet"><h2>${sections[section]}</h2><div class="empty">尚未连接${sections[section]}服务<br>连接后将在这里显示真实数据。</div></div>`;
    }
    const nextMemoryKey = section === 'memory'
      ? JSON.stringify({state: data.privateMemory, search: memorySearch, saved: savedMemory}) : undefined;
    if (section === 'memory' && data.privateMemory?.available && renderedSection === section
      && !refreshMemory && nextMemoryKey === memoryRenderKey) return;
    // Keep interactive task/model DOM when an unrelated snapshot changes.
    const preferenceKey = section === 'appearance'
      ? `${themePreference()}/${localStorage.getItem('pa-calm')}` : undefined;
    const retainContent = (['models', 'tasks', 'overview'].includes(section)
      || ['settings', 'appearance'].includes(section) && renderedPreferenceKey === preferenceKey)
      && renderedSection === section && renderedContentMarkup === content;
    const focusedSummary = document.activeElement?.matches?.('[data-task-details] > summary')
      ? document.activeElement.parentElement.dataset.taskDetails : undefined;
    renderedSection = section; memoryRenderKey = nextMemoryKey;
    if (!retainContent) {
      root.querySelector('#content').innerHTML = content;
      root.querySelectorAll('[data-task-details]').forEach(details => {
        if (taskDetails.has(details.dataset.taskDetails)) details.open = taskDetails.get(details.dataset.taskDetails);
        if (focusedSummary === details.dataset.taskDetails && document.activeElement === document.body) {
          details.querySelector('summary').focus({preventScroll: true});
        }
      });
    }
    renderedContentMarkup = content;
    renderedPreferenceKey = preferenceKey;
    if(section==='models'){const page=root.querySelector('#content .model-page')??root.querySelector('#content');for(const card of [agentArtsConnectionRoot,agentArtsModelRoot,modelApiRoot])if(card&&card.parentElement!==page)page.append(card);}
    if (section === 'authorizations') {
      const nextExpiry = nextApprovalExpiry(data.approvals, approvalNow);
      if (nextExpiry !== undefined) {
        const delay = Math.min(Math.max(nextExpiry - Date.now() + 25, 0), 2_147_483_647);
        approvalExpiryTimer = setTimeout(() => {
          approvalExpiryTimer = undefined;
          render(current);
        }, delay);
      }
    }
    // Retained nodes already own their listeners. Rebinding would multiply IPC calls.
    if (retainContent) return;
    if (section === 'profile') bindProfile(root, escape);
    root.querySelector('#memory-select-vault')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await invoke('memory.selectVault');
        if (result.selected) {
          memorySearch = {query: '', hits: [], truncated: false, status: 'Vault 已选择，尚未保存任何摘录。'};
          memorySummaries.clear();
        }
        render(current, true);
      } catch (error) {
        button.disabled = false;
        root.querySelector('#error').textContent = error.message;
      }
    });
    root.querySelector('#memory-search-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const query = root.querySelector('#memory-query').value.trim();
      try {
        const result = await invoke('memory.search', {query});
        memorySearch = {query, hits: result.hits, truncated: result.truncated,
          status: result.hits.length ? `找到 ${result.hits.length} 条引文；尚未保存。` : '没有匹配引文。'};
        memorySummaries.clear();
        render(current, true);
      } catch (error) { root.querySelector('#error').textContent = error.message; }
    });
    root.querySelectorAll('[data-memory-summary]').forEach(input => input.addEventListener('input', () => {
      memorySummaries.set(Number(input.dataset.memorySummary), input.value);
    }));
    root.querySelector('#memory-list-saved')?.addEventListener('click', async () => {
      try {
        const page = await invoke('memory.listSaved');
        savedMemory = {...page, status: page.facts.length ? '仅显示当前版本。' : '没有已保存的私人记忆。'};
        render(current, true);
      } catch (error) { root.querySelector('#error').textContent = error.message; }
    });
    root.querySelector('#memory-list-next')?.addEventListener('click', async () => {
      try {
        const page = await invoke('memory.listSaved',
          {at: savedMemory.at, snapshot: savedMemory.snapshot, cursor: savedMemory.nextCursor});
        savedMemory = {...page, facts: [...savedMemory.facts, ...page.facts], status: '仅显示当前版本。'};
        render(current, true);
      } catch (error) { root.querySelector('#error').textContent = error.message; }
    });
    root.querySelectorAll('[data-memory-withdraw]').forEach(button => button.addEventListener('click', async () => {
      button.disabled=true;
      try {
        const result=await invoke('memory.withdraw',{ref:savedMemory.facts[Number(button.dataset.memoryWithdraw)].ref});
        savedMemory={...await invoke('memory.listSaved'),status:result.state==='withdrawn'
          ? '已撤回，后续任务不可消费；历史仍可管理和删除。' : '已取消，未撤回记忆。'};
        render(current,true);
      } catch(error) {root.querySelector('#error').textContent=error.message;button.disabled=false;}
    }));
    root.querySelectorAll('[data-memory-delete]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const result = await invoke('memory.delete', {ref: savedMemory.facts[Number(button.dataset.memoryDelete)].ref});
        if (result.state === 'deleted' || result.state === 'pending') {
          const page = await invoke('memory.listSaved');
          savedMemory = {...page, status: result.state === 'deleted' ? '已删除该记忆的全部版本并完成读回。'
            : result.pendingBackupIds?.length ? '记忆已停止引用；应用备份仍待清理或整篇笔记备份已保留，删除尚未完成。'
              : '来源已停止引用，关联任务副本仍待核实清除；删除尚未完成。'};
        } else savedMemory.status = '已取消，未删除记忆。';
        render(current, true);
      } catch (error) { root.querySelector('#error').textContent = error.message; button.disabled = false; }
    }));
    root.querySelectorAll('[data-memory-save]').forEach(button => button.addEventListener('click', async () => {
      const index = Number(button.dataset.memorySave);
      button.disabled = true;
      try {
        const source=memorySearch.hits[index].source;
        const baseline=await invoke('memory.previewSave',{source});
        memorySearch.hits[index]={...memorySearch.hits[index],excerpt:baseline.citation};
        render(current,true);
        const result = await invoke('memory.save', {source,baseline,
          summary: (memorySummaries.get(index) ?? '').trim()});
        memorySearch.status = result.state === 'saved' ? `私人记忆已保存为版本 ${result.revision}。`
          : result.state === 'unchanged' ? '这条私人记忆已经保存。' : '已取消，未写入记忆。';
        if (result.state === 'saved') savedMemory = {facts: [], status: '已保存，点击查看已保存记忆刷新列表。'};
        render(current, true);
      } catch (error) { root.querySelector('#error').textContent = error.message; button.disabled = false; }
    }));
    root.querySelector('#quit')?.addEventListener('click', () => invoke('app.quit'));
    root.querySelector('#model-add')?.addEventListener('click', () => { modelEditorOpen = true; render(current); });
    root.querySelector('#model-more')?.addEventListener('click', () => { modelEditorOpen = true; render(current); });
    root.querySelector('#model-editor-close')?.addEventListener('click', () => { modelEditorOpen = false; render(current); });
    root.querySelector('#model-enabled')?.addEventListener('change', async event => {
      const input = event.currentTarget, previous = !input.checked;
      try { await invoke('model.toggle', {enabled: input.checked}); }
      catch (error) { input.checked = previous; root.querySelector('#error').textContent = error.message; }
    });
    root.querySelectorAll('[data-jump]').forEach(button => button.addEventListener('click', () => { section = button.dataset.jump; render(current); }));
    const themeSelect = root.querySelector('#pref-theme');
    if (themeSelect) {
      themeSelect.value = themePreference();
      themeSelect.addEventListener('change', () => saveTheme(themeSelect.value));
    }
    const calmToggle = root.querySelector('#pref-calm');
    if (calmToggle) {
      calmToggle.checked = localStorage.getItem('pa-calm') === 'true';
      calmToggle.addEventListener('change', () => saveCalm(calmToggle.checked));
    }
    root.querySelector('#refresh-capabilities')?.addEventListener('click', async () => {
      try { await invoke('capability.list'); } catch (error) { root.querySelector('#error').textContent = error.message; }
    });
    const modelForm = root.querySelector('#model-config-form');
    modelForm?.addEventListener('submit', async event => {
      event.preventDefault();
      const button = root.querySelector('#model-save');
      button.disabled = true;
      try {
        const result = await invoke('model.configure', {
          baseUrl: root.querySelector('#model-base-url').value,
          model: root.querySelector('#model-name').value,
          deployment: root.querySelector('#model-deployment').value,
          apiKey: root.querySelector('#model-api-key').value,
        });
        root.querySelector('#model-api-key').value = '';
        root.querySelector('#model-test').disabled = !result?.configured;
        root.querySelector('#error').textContent = '';
      } catch (error) {
        root.querySelector('#error').textContent = error.message;
      } finally { button.disabled = false; }
    });
    root.querySelector('#model-test')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try { await invoke('model.test'); root.querySelector('#error').textContent = ''; }
      catch (error) { root.querySelector('#error').textContent = error.message; }
      finally { button.disabled = false; }
    });
    const thinkingSlider = root.querySelector('#thinking-depth');
    const thinkingFast = root.querySelector('#thinking-fast');
    thinkingSlider?.addEventListener('input', () => {
      const value = Number(thinkingSlider.value);
      root.querySelector('#thinking-depth-label').textContent = ['最低','低','平衡','深入','高','最高'][value] ?? '低';
    });
    thinkingSlider?.addEventListener('change', async () => {
      try { await invoke('thinking.update', {depth: Number(thinkingSlider.value), fast: Boolean(thinkingFast.checked)}); }
      catch (error) { root.querySelector('#error').textContent = error.message; }
    });
    thinkingFast?.addEventListener('change', async () => {
      try { await invoke('thinking.update', {depth: Number(thinkingSlider.value), fast: Boolean(thinkingFast.checked)}); }
      catch (error) { root.querySelector('#error').textContent = error.message; }
    });
    root.querySelectorAll('[data-approval]').forEach(button => button.addEventListener('click', async () => {
      // A rendered button is not an authorization or a fresh Runtime snapshot.
      const approval = current.approvals?.find(item => item.approvalId === button.dataset.id
        && item.taskId === button.dataset.task && item.revision === Number(button.dataset.revision));
      if (!approvalPresentation(approval).actionable) { render(current); return; }
      button.disabled = true;
      try {
        await invoke('authorization.respond', {approvalId: button.dataset.id, taskId: button.dataset.task, decision: button.dataset.approval, expectedRevision: Number(button.dataset.revision)});
        void loadHistory(true);
      } catch (error) {
        render(current);
        root.querySelector('#error').textContent = error.message;
      }
    }));
    root.querySelectorAll('[data-revoke]').forEach(button => button.addEventListener('click', async () => {
      const authorizationRef = button.dataset.revoke;
      const taskId = button.dataset.task;
      const expectedApprovalRevision = Number(button.dataset.revision);
      const approval = [...(current.approvals ?? []), ...history.items].find(item => item.approvalId === authorizationRef
        && item.taskId === taskId && item.revision === expectedApprovalRevision && item.state === 'allowed');
      if (!approval) { render(current); return; }
      const key = `${authorizationRef}:${expectedApprovalRevision}`;
      revocations.set(key, {state: 'checking'});
      render(current);
      try {
        const result = await invoke('authorization.revoke', {taskId, authorizationRef, expectedApprovalRevision});
        if (result?.grantPresent !== false || result.approvalRevision !== expectedApprovalRevision
          || typeof result.revoked !== 'boolean') throw Error('Authorization readback mismatch');
        revocations.set(key, {state: 'confirmed', revoked: result.revoked});
      } catch {
        revocations.set(key, {state: 'error'});
      }
      render(current);
    }));
    root.querySelector('#approval-history-more')?.addEventListener('click', () => { void loadHistory(); });
    root.querySelector('#approval-history-refresh')?.addEventListener('click', () => { void loadHistory(true); });
    root.querySelector('#approval-history-retry')?.addEventListener('click', () => {
      void loadHistory(!history.loaded);
    });
    if (section === 'authorizations' && !history.loaded && !history.loading && !history.error) {
      void loadHistory();
    }
  }

  root.querySelector('#content').addEventListener('click', event => {
    const button = event.target.closest('[data-patch-reconcile]');
    if (button && root.isConnected !== false) void patchRecovery.reconcile(button.dataset.patchReconcile);
  });
  root.querySelector('#content').addEventListener('click', async event => {
    const button = event.target.closest('[data-evidence-task], [data-evidence-id], [data-evidence-more], [data-evidence-retry]');
    if (!button || evidenceClosed || root.isConnected === false) return;
    const panel = button.closest('[data-evidence-panel]');
    const taskId = button.dataset.evidenceTask ?? panel?.dataset.evidencePanel;
    const task = current.tasks.find(task => task.taskId === taskId);
    if (!task) return;
    if (button.dataset.evidenceId) {
      const state = evidenceStates.get(taskId);
      const evidenceId = button.dataset.evidenceId;
      if (state?.status !== 'loaded' || !state.items.some(item => item.evidenceId === evidenceId)) return;
      const pending = {...state, detail: undefined, detailStatus: 'loading'};
      evidenceStates.set(taskId, pending);
      const isCurrent = () => !evidenceClosed && root.isConnected !== false
        && evidenceStates.get(taskId) === pending
        && current.tasks.some(item => item.taskId === taskId && item.conversationId === task.conversationId);
      render(current);
      try {
        const detail = await invoke('evidence.get', {taskId, evidenceId});
        if (!isCurrent()) return;
        if (detail?.evidenceId !== evidenceId) throw Error('Evidence identity mismatch');
        evidenceStates.set(taskId, {...state, detail, detailStatus: 'loaded'});
      } catch {
        if (!isCurrent()) return;
        evidenceStates.set(taskId, {...state, detail: undefined, detailStatus: 'error'});
      }
    } else {
      const beforeEvidenceId = button.hasAttribute('data-evidence-more')
        ? evidenceStates.get(taskId)?.nextBeforeEvidenceId : undefined;
      const pending = {status: 'loading'};
      evidenceStates.set(taskId, pending);
      const isCurrent = () => !evidenceClosed && root.isConnected !== false
        && evidenceStates.get(taskId) === pending
        && current.tasks.some(item => item.taskId === taskId && item.conversationId === task.conversationId);
      render(current);
      try {
        const page = await invoke('evidence.list', {taskId, limit: 10, ...(beforeEvidenceId ? {beforeEvidenceId} : {})});
        if (!isCurrent()) return;
        if (!Array.isArray(page?.items) || page.items.some(item => typeof item?.evidenceId !== 'string')) {
          throw Error('Invalid Evidence page');
        }
        evidenceStates.set(taskId, {status: 'loaded', items: page.items,
          nextBeforeEvidenceId: page.nextBeforeEvidenceId});
      } catch {
        if (!isCurrent()) return;
        evidenceStates.set(taskId, {status: 'error'});
      }
    }
    render(current);
  });
  root.querySelector('nav').addEventListener('click', event => {
    const button = event.target.closest('[data-page]');
    if (button) { section = button.dataset.page; render(current); }
  });
  const search = root.querySelector('#admin-search');
  const searchStatus = document.createElement('p');
  searchStatus.className = 'admin-search-status';searchStatus.id = 'admin-search-status';
  searchStatus.setAttribute('role', 'status');searchStatus.hidden = true;
  root.querySelector('.side')?.insertBefore(searchStatus, root.querySelector('nav'));
  search.setAttribute('aria-describedby', searchStatus.id);
  function filterSettings() {
    const query = search.value.trim();
    let total = 0;
    root.querySelectorAll('.nav-group').forEach(group => {
      let visible = 0;
      group.querySelectorAll('[data-page]').forEach(button => {
        button.hidden = !matchesSettingSearch(button.dataset.page, button.textContent, query);
        if (!button.hidden) visible += 1;
      });
      total += visible;
      group.hidden = visible === 0;
    });
    searchStatus.hidden = !query;
    searchStatus.textContent = total ? `找到 ${total} 项设置` : '没有匹配设置，试试“模型”“连接”或“任务”。';
  }
  search.addEventListener('input', filterSettings);
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault();search.value = '';filterSettings(); }
    if (event.key === 'ArrowDown') {
      const first = [...root.querySelectorAll('nav [data-page]')].find(button => !button.hidden);
      if (first) {event.preventDefault();first.focus();}
    }
  });
  return render;
}
