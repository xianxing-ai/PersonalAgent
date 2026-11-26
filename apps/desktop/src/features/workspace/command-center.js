import {updateAssistantPicker} from './assistant-picker.js';
import {stateNames,isTerminal} from '../conversation/state.js';
import {mountInlineSubagents} from './inline-subagents.js';
import {mountHeroStarfield} from './hero-starfield.js';
import {mountContextSidebar} from './context-sidebar.js';
import {createRecentConversations} from './recent-conversations.js';
import {bindCompactButton} from '../conversation/compact-command.js';
import {createStarterDraft} from '../conversation/starter-draft.js';

const paths={home:'m3 10 9-7 9 7v11h-7v-7h-4v7H3z',team:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7a4 4 0 0 1 0 8',tasks:'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',memory:'M12 3c5 0 8 2 8 4s-3 4-8 4-8-2-8-4 3-4 8-4m-8 4v10c0 2 3 4 8 4s8-2 8-4V7M4 12c0 2 3 4 8 4s8-2 8-4',link:'m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',settings:'M4 7h10m4 0h2M4 17h2m4 0h10M16 4v6M8 14v6',arrow:'m9 5 7 7-7 7',plus:'M12 5v14M5 12h14',search:'M21 21l-5-5M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16',history:'M3 12a9 9 0 1 0 2-6M3 3v5h5m4-1v5l3 2',close:'m6 6 12 12M6 18 18 6',send:'m4 4 17 8-17 8 4-8-4-8m4 8h13',voice:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5m-4 6a7 7 0 0 0 14 0m-7 7v4'};
export const centerIcon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]??paths.team}"/></svg>`;

const isActiveChild=child=>!isTerminal(child)&&child?.state!=='waiting_reconciliation';

// Keep source ordering inside each real state group; never manufacture workers.
export function childThreadGroups(children=[]){
  const inactive=children.filter(child=>!isActiveChild(child));
  const label=inactive.some(child=>child.state==='waiting_reconciliation')?'待核实或已结束':'已结束';
  return [{label:'进行中',children:children.filter(isActiveChild)},{label,collapsed:true,children:inactive}];
}
export function childThreadTitle(child){
  const goal=typeof child.goal==='string'?child.goal.replace(/^\[任务执行\]\s*/,'').trim():'';
  return goal||child.role||'分对话';
}
function avatarHash(taskId){
  let hash=0;
  for(const letter of String(taskId??''))hash=(hash*31+letter.charCodeAt(0))>>>0;
  return hash;
}
function avatarColor(taskId){
  return ['mint','amber','blue','rose','ochre'][avatarHash(taskId)%5];
}
function avatarShape(taskId){
  return ['squircle','circle','soft'][Math.floor(avatarHash(taskId)/5)%3];
}
function leadAvatarSvg(){
  return `<svg viewBox="0 0 32 32" aria-hidden="true" fill="currentColor">
    <path opacity=".48" d="M13 5h11a4 4 0 0 1 4 4v11l-4-3h-3v-3a5 5 0 0 0-5-5H9a4 4 0 0 1 4-4Z"/>
    <path fill-rule="evenodd" d="M8 11h10a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-6l-6.1 4v-4.5A4 4 0 0 1 3.8 20v-5A4.2 4.2 0 0 1 8 11Zm1.3 4.3a.9.9 0 0 0 0 1.8h7.2a.9.9 0 0 0 0-1.8Zm0 3.7a.9.9 0 0 0 0 1.8h3.6a.9.9 0 0 0 0-1.8Z"/>
  </svg>`;
}
const agentGlyphPaths=[
  '<circle cx="10" cy="10" r="6" stroke="currentColor" stroke-width="1.5" opacity=".7"/><circle cx="10" cy="10" r="2.1" fill="currentColor"/>',
  '<rect x="5.8" y="5.8" width="8.4" height="8.4" rx="1.6" transform="rotate(45 10 10)" stroke="currentColor" stroke-width="1.5"/>',
  '<polygon points="10,3.2 15.8,6.6 15.8,13.4 10,16.8 4.2,13.4 4.2,6.6" stroke="currentColor" stroke-width="1.45"/><circle cx="10" cy="10" r="1.8" fill="currentColor"/>',
  '<circle cx="7" cy="7" r="1.6" fill="currentColor"/><circle cx="13" cy="7" r="1.6" fill="currentColor"/><circle cx="7" cy="13" r="1.6" fill="currentColor"/><circle cx="13" cy="13" r="1.6" fill="currentColor"/>',
  '<path d="M10 3.5 11.8 8.2 16.5 10 11.8 11.8 10 16.5 8.2 11.8 3.5 10 8.2 8.2Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>',
  '<path d="M4.5 7.5 10 4.5l5.5 3L10 10.5 4.5 7.5ZM4.5 11.5 10 14.5l5.5-3M4.5 14.5 10 17.5l5.5-3" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>',
];
function agentGlyphSvg(taskId){
  const body=agentGlyphPaths[avatarHash(taskId)%agentGlyphPaths.length];
  return `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">${body}</svg>`;
}

// Pure projection of existing records. No timers, invented workers or task states.
export function commandCenterState(data){
  const tasks=Array.isArray(data.tasks)?data.tasks:[],children=Array.isArray(data.subagentTasks)?data.subagentTasks:[];
  return {tasks,children,active:tasks.filter(t=>!isTerminal(t)&&!t.outputTruncated&&!t.cancelRequested).length,
    working:children.filter(isActiveChild).length,latest:tasks.findLast(t=>!isTerminal(t)&&!t.outputTruncated&&!t.cancelRequested)??tasks.at(-1),
    activity:tasks.slice(-5).reverse(),configured:(data.health??[]).filter(h=>h.state==='ready').length};
}

/** Layout only: reuse the actual session, model picker, composer and child controls. */
export function mountCommandCenter(root,{sessionRoot,assistantRoster,switchConversation,preferences,input,invoke,report,escape,onThreadChange}){
  const starterDraft=createStarterDraft(input);
  const shell=root.querySelector('.workspace'),bar=root.querySelector('.workspace-titlebar'),main=root.querySelector('.workspace-main'),layout=root.querySelector('.workspace-layout');
  shell.classList.add('command-center');
  const rail=document.createElement('aside');rail.className='cc-rail';rail.setAttribute('aria-label','主导航');
  const pages = [['home', '工作台', '工作台'], ['tasks', '任务', '任务记录'], ['memory', '知识', '知识与记忆']];
  rail.innerHTML=`<div class="cc-brand"><span class="cc-brand-orb" aria-hidden="true"></span><strong>Synstar</strong><button type="button" class="cc-history-toggle" aria-label="对话历史" title="对话历史">${centerIcon('search')}</button><button type="button" class="cc-new-chat" aria-label="新对话" title="新对话">${centerIcon('plus')}</button></div><div class="cc-thread-scroll"></div><div class="cc-rail-spacer"></div>
    <nav aria-label="工作台导航">
      ${pages.map(([id, label, name]) => `<button type="button" data-cc-nav="${id}" aria-label="${name}" title="${name}">${centerIcon(id)}<span>${label}</span></button>`).join('')}
      <button type="button" class="cc-settings" aria-label="设置与偏好" title="设置与偏好">${centerIcon('settings')}<span>设置</span></button>
    </nav>`;
  shell.prepend(rail);
  bar.querySelector('.workspace-app-title').textContent='工作台';
  const search=rail.querySelector('.cc-history-toggle');
  const themeButton=document.createElement('button');themeButton.type='button';themeButton.className='cc-theme-toggle';themeButton.setAttribute('aria-label','切换黑白主题');themeButton.title='切换黑白主题';themeButton.textContent='◐';themeButton.onclick=async()=>{const {saveTheme}=await import('../../ui/preferences.js');saveTheme(document.documentElement.dataset.theme==='light'?'dark':'light');};bar.querySelector('.window-controls').before(themeButton);
  const railToggle=document.createElement('button');railToggle.type='button';railToggle.className='cc-sidebar-toggle';railToggle.setAttribute('aria-label','显示或隐藏侧栏');railToggle.setAttribute('aria-expanded','false');railToggle.innerHTML=centerIcon('tasks');bar.prepend(railToggle);
  const cardToggle=document.createElement('button');cardToggle.type='button';cardToggle.className='cc-connectors-toggle';cardToggle.setAttribute('aria-label','显示或隐藏连接器卡片');cardToggle.setAttribute('aria-expanded','false');cardToggle.innerHTML=centerIcon('link');themeButton.before(cardToggle);
  const syncAppearance=async()=>{try{const {themePreference}=await import('../../ui/preferences.js');await invoke('workspace.appearance',{theme:themePreference()});}catch(error){report(error);}};
  window.addEventListener('preferences-changed',syncAppearance);window.addEventListener('unload',()=>window.removeEventListener('preferences-changed',syncAppearance),{once:true});syncAppearance();
  const top=root.querySelector('.workspace-top');
  top.hidden=true;
  const hero=document.createElement('section');hero.className='cc-hero';hero.setAttribute('aria-label','工作台概览');
  hero.innerHTML='<div class="cc-hero-copy"><h1>Synstar</h1><p class="cc-hero-tagline">把想法变成现实。</p><p>交代目标，保持掌控，让每一步进展清晰可见。</p><small data-cc-preview></small></div><div class="cc-hero-visual"><div class="cc-orbit cc-orbit-a"><i></i></div><div class="cc-orbit cc-orbit-b"><i></i></div><div class="cc-orbit cc-orbit-c"><i></i></div><div class="cc-orb-halo"></div></div>';
  hero.querySelector('.cc-hero-visual').append(root.querySelector('#workspace-orb'));
  const chat=root.querySelector('.workspace-chat'),heading=document.createElement('header');heading.className='cc-chat-heading';
  heading.innerHTML='<div><strong>主对话</strong><p><span data-cc-session></span></p></div>';
  chat.prepend(heading);heading.append(preferences);
  const stage=root.querySelector('#workspace-stage');stage.querySelector('#workspace-welcome').hidden=true;
  const welcome=document.createElement('section');welcome.className='cc-empty';welcome.innerHTML='<h2>有什么可以帮你？</h2><p>描述任务，或者选择一个快捷操作。</p>';
  stage.prepend(welcome);
  const side=document.createElement('aside');side.className='cc-context';side.setAttribute('aria-label','协作与活动');side.innerHTML=`<section class="cc-team"><header><h2>${centerIcon('team')}智能体协作</h2><span data-cc-team-count>暂无工人</span></header><div class="cc-team-lead"><span class="cc-agent-avatar">${centerIcon('home')}</span><div><strong>主对话</strong><p>日程、订阅和天气都在这里处理</p></div><span class="cc-state" data-cc-coordinator>待机</span></div><div class="cc-children"></div><div class="cc-team-hint"><span class="cc-constellation">✧</span><strong>工人负责重活</strong><p>主对话自己处理日程、订阅和天气。真正派工之后，工人会显示在这里。助手是另一类，用来聊天，不在这列。</p></div><div class="cc-child-actions"></div></section><section class="cc-activity"><header><h2>${centerIcon('history')}最近活动</h2><button type="button" data-cc-records>全部记录 ${centerIcon('arrow')}</button></header><div class="cc-activity-list"></div></section><div class="cc-trust"><span>◇</span><p>每一次行动，都由你掌控。<br><small>涉及外部操作时，沿用原有授权流程。</small></p></div>`;
  layout.append(side);
  const leadButton = document.createElement('button');
  leadButton.type = 'button';
  leadButton.className = 'cc-team-lead';
  leadButton.setAttribute('aria-label', '切换到主对话');
  leadButton.innerHTML = `<span class="cc-avatar-lead" aria-hidden="true">${leadAvatarSvg()}</span>
    <span class="cc-lead-copy"><span class="cc-lead-heading"><strong>主对话</strong><span class="cc-state" data-cc-coordinator>待机</span></span><small>日程 · 订阅 · 天气</small></span>`;
  side.querySelector('.cc-team-lead').replaceWith(leadButton);
  side.querySelector('.cc-team h2').textContent='工人';side.querySelector('.cc-team-hint').innerHTML='<p>主对话只处理日程、订阅和天气。邮件、知识库和其他连接器交给助手自己的工人。工人可插话复用，不必一句话一个。</p>';side.querySelector('.cc-trust').hidden=true;
  const team=side.querySelector('.cc-team');team.querySelector('h2').textContent='工人';team.prepend(leadButton);rail.querySelector('.cc-thread-scroll').append(team);
  const internal=document.createElement('section');internal.className='cc-internal-chat';internal.setAttribute('aria-label','内部群聊');
  internal.innerHTML=`<header><h2>内部群聊</h2><span>主对话 ↔ 助手</span></header><div class="cc-internal-list" data-internal-list></div><form class="cc-internal-compose" data-internal-compose><label>交给助手<select class="cc-assistant-picker" name="assistantId" required><button type="button"><selectedcontent></selectedcontent></button></select></label><textarea name="text" maxlength="2000" required placeholder="在后台交付工作，例如：处理邮件并回贴结论"></textarea><button type="submit">交付</button><p class="cc-internal-status" role="status"></p></form>`;
  side.querySelector('.cc-activity')?.before(internal);
  const internalList=internal.querySelector('[data-internal-list]');
  const internalForm=internal.querySelector('[data-internal-compose]');
  const internalStatus=internal.querySelector('.cc-internal-status');
  const paintInternalChat=(data)=>{
    const assistants=Array.isArray(data?.assistants)?data.assistants:[];
    updateAssistantPicker(internalForm.elements.namedItem('assistantId'), assistants);
    const messages=Array.isArray(data?.internalChat?.messages)?data.internalChat.messages:[];
    internalList.innerHTML=messages.length
      ? messages.map(item=>{
          const from=item.fromAssistantId==='front-desk'?'主对话':(assistants.find(a=>a.assistantId===item.fromAssistantId)?.displayName||item.fromAssistantId);
          const to=item.toAssistantId==='front-desk'?'主对话':(assistants.find(a=>a.assistantId===item.toAssistantId)?.displayName||item.toAssistantId);
          return `<article><strong>${escape(from)} → ${escape(to)}</strong><p>${escape(item.body||'')}</p><small>${escape(item.createdAt?new Date(item.createdAt).toLocaleString():'')}</small></article>`;
        }).join('')
      : '<p class="cc-internal-empty">还没有内部消息。主对话可用 assistant.message 或这里交付给助手。</p>';
  };
  internalForm.onsubmit=async event=>{
    event.preventDefault();
    const assistantId=String(internalForm.elements.namedItem('assistantId').value||'').trim();
    const text=String(internalForm.elements.namedItem('text').value||'').trim();
    if(!assistantId||!text){internalStatus.textContent='请选择助手并填写内容';return;}
    const submit=internalForm.querySelector('button[type="submit"]');
    submit.disabled=true;internalStatus.textContent='正在交付…';
    try{
      await invoke('internalChat.send',{assistantId,text,requestId:crypto.randomUUID()});
      internalForm.elements.namedItem('text').value='';
      const next=await invoke('internalChat.list',{limit:40});
      paintInternalChat({assistants:lastData?.assistants??[],internalChat:next});
      internalStatus.textContent='已交付';
    }catch(error){internalStatus.textContent=error?.message||'交付失败';report(error);}
    finally{submit.disabled=false;}
  };
  const board=root.querySelector('.connector-board');board.setAttribute('aria-label','主页连接器卡片');
  mountContextSidebar(side,hero,board,invoke);
  mountHeroStarfield(hero);
  const allCapabilities=document.createElement('button');allCapabilities.type='button';allCapabilities.className='cc-capabilities';allCapabilities.textContent='全部能力';allCapabilities.title='查看 Runtime 当前公布的工具和连接状态';allCapabilities.onclick=()=>invoke('admin.open',{page:'capabilities'}).catch(report);board.querySelector('header').append(allCapabilities);
  function setRailOpen(open) {
    shell.classList.toggle('cc-sidebar-open', open);
    railToggle.setAttribute('aria-expanded', String(open));
  }
  function setCardsOpen(open) {
    side.classList.toggle('cc-mobile-open', open);
    cardToggle.setAttribute('aria-expanded', String(open));
  }
  railToggle.onclick = () => {
    const opening = !shell.classList.contains('cc-sidebar-open');
    setCardsOpen(false);
    setRailOpen(opening);
    if (opening) rail.querySelector('[aria-current="page"]')?.focus();
  };
  cardToggle.onclick = () => {
    const opening = !side.classList.contains('cc-mobile-open');
    setRailOpen(false);
    setCardsOpen(opening);
  };
  const inline=mountInlineSubagents(chat,invoke,report,binding=>{starterDraft.reset();onThreadChange?.();leadButton.setAttribute('aria-pressed',String(!binding));for(const button of team.querySelectorAll('[data-child-task]'))button.setAttribute('aria-pressed',String(Boolean(binding&&button.dataset.childTask===binding.taskId&&button.dataset.parentTask===binding.parentTaskId)));});
  const closeSidebar = () => setRailOpen(false);
  leadButton.setAttribute('aria-pressed','true');leadButton.onclick=()=>{showHome();inline.main();closeSidebar();};
  const originalChildren=root.querySelector('.subagent-conversations');if(originalChildren)team.querySelector('.cc-child-actions').append(originalChildren);
  const history=document.createElement('aside');history.className='cc-history';history.id='cc-history';history.hidden=true;history.setAttribute('aria-label','历史会话');history.innerHTML=`<header><h2>对话历史</h2><button type="button" aria-label="关闭历史会话">${centerIcon('close')}</button></header>`;history.append(sessionRoot);layout.append(history);
  const recent = createRecentConversations(async id => {
    if (await switchConversation(id)) {
      setHistoryOpen(false);
      showHome();
      inline.main();
      closeSidebar();
      input.focus();
    }
  });
  rail.querySelector('.cc-thread-scroll').append(assistantRoster, recent.element);
  let historyOpener = search;
  search.setAttribute('aria-controls', history.id);
  search.setAttribute('aria-expanded', 'false');
  function setHistoryOpen(open, opener = search) {
    history.hidden = !open;
    search.setAttribute('aria-expanded', String(open));
    recent.allButton.setAttribute('aria-expanded', String(open));
    if (open) {
      historyOpener = opener;
      showHome();
      closeSidebar();
      history.querySelector('[data-session-list]').focus();
    }
  }
  function dismissHistory() {
    setHistoryOpen(false);
    (historyOpener.getClientRects().length ? historyOpener : railToggle).focus();
  }
  search.onclick = () => history.hidden ? setHistoryOpen(true) : dismissHistory();
  recent.allButton.onclick = () => setHistoryOpen(true, recent.allButton);
  history.querySelector('header button').onclick = dismissHistory;
  const openAdmin=page=>invoke('admin.open',{page}).catch(report);
  const local=document.createElement('section');local.className='cc-local';local.hidden=true;local.setAttribute('aria-label','工作台内容');
  local.innerHTML='<header><h2 data-cc-local-title tabindex="-1"></h2><button type="button" data-cc-local-back>返回对话</button></header><div data-cc-local-body></div>';
  main.append(local);
  let localView='home',lastData={};
  const pageButtons = rail.querySelectorAll('[data-cc-nav]');
  function setPage(page) {
    localView = page;
    const home = page === 'home';
    local.hidden = home;
    hero.hidden = !home;
    layout.hidden = !home;
    cardToggle.hidden = !home;
    if (!home) setCardsOpen(false);
    for (const button of pageButtons) {
      if (button.dataset.ccNav === page) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }
  const showHome = () => setPage('home');
  showHome();
  const paintLocal=data=>{
    const body=local.querySelector('[data-cc-local-body]');
    local.querySelector('[data-cc-local-title]').textContent=localView==='memory'?'知识与记忆':'任务记录';
    if(localView==='tasks'){
      const tasks=Array.isArray(data.tasks)?data.tasks:[];
      const tasksHtml=tasks.length?`<ul class="cc-local-list">${tasks.slice().reverse().map(task=>`<li><button type="button" data-local-task="${escape(task.taskId)}"><strong>${escape(task.userMessage?.trim()||'未命名任务')}</strong><small>${escape(stateNames[task.state]??task.state)}</small></button></li>`).join('')}</ul>`:'<p>还没有任务。回到对话发出第一条消息。</p>';
      const tasksSlot=body.querySelector('[data-cc-local-tasks]');
      if(tasksSlot){tasksSlot.innerHTML=tasksHtml;return;}
      const navBar='<div class="cc-local-actions"><button type="button" data-cc-admin-page="tasks">任务监控与证据</button><button type="button" data-cc-admin-page="activity">活动记录与撤销</button><button type="button" data-cc-admin-page="dashboard">个人数据看板</button><button type="button" data-cc-admin-page="usage">用量与预算</button><button type="button" data-cc-admin-page="pets">桌面宠物</button><button type="button" data-cc-open-goals>目标与计划图</button><button type="button" data-cc-workflow-catalog>28 图工作流目录</button></div>';
      body.innerHTML=`${navBar}<div data-cc-catalog-result></div><div data-cc-local-tasks>${tasksHtml}</div>`;
      return;
    }
    const knowledge=data.knowledge;
    const statusText=knowledge?.reason||(knowledge?'知识库已连接。':'知识库还没有连接。');
    const status=body.querySelector('[data-cc-memory-status]');
    if(status){status.textContent=statusText;return;}
    body.innerHTML=`<div class="cc-local-actions"><button type="button" data-cc-admin-page="memory">私人记忆与知识源设置</button><button type="button" data-cc-watch-check>查看知识关注</button><button type="button" data-cc-cognition-check>查看认知提议与回执</button></div><p data-cc-memory-status>${escape(statusText)}</p><form class="cc-local-search"><label>查找笔记<input name="query" type="search" maxlength="200" placeholder="输入要找的内容"></label><button type="submit">查找</button></form><div data-cc-memory-result></div><div data-cc-watch-result></div><div data-cc-cognition-result></div>`;
  };
  const showLocal = key => {
    const fromDrawer = shell.classList.contains('cc-sidebar-open') || side.classList.contains('cc-mobile-open');
    setHistoryOpen(false);
    setPage(key);
    paintLocal(lastData);
    closeSidebar();
    if (fromDrawer) local.querySelector('[data-cc-local-title]').focus();
  };
  local.querySelector('[data-cc-local-back]').onclick=()=>{showHome();input.focus();};
  let catalogReq=0,watchReq=0,cognitionReq=0;
  const loadCognition=async(button,feedback='')=>{
    const out=local.querySelector('[data-cc-cognition-result]');if(!out)return;
    const req=++cognitionReq;
    if(button)button.disabled=true;
    out.textContent='正在读取认知提议与回执…';
    try{
      const status=await invoke('cognition.status');
      const proposals=await invoke('cognition.proposals.list').catch(()=>[]);
      const receipts=await invoke('cognition.receipts.list').catch(()=>[]);
      if(req!==cognitionReq)return;
      const proposalRows=(Array.isArray(proposals)?proposals:[]).map(p=>`<div class="notice"><span>${escape(p.summary||p.eventId||'待处理提议')}</span> <button type="button" data-cc-cognition-apply="${escape(p.eventId||'')}" data-cc-cognition-source="${escape(p.source||'')}">应用提议</button></div>`).join('');
      const prefix=feedback?`<p class="notice" role="status">${escape(feedback)}</p>`:'';
      out.innerHTML=`${prefix}<p>${escape(status?.reason??'认知状态已读取')} · 待处理提议 ${Array.isArray(proposals)?proposals.length:0} 项 · 会议回执 ${Array.isArray(receipts)?receipts.length:0} 条</p>${proposalRows}`;
    }catch(error){if(req===cognitionReq)out.textContent=error?.message??'认知组合尚未就绪';}
    finally{if(button&&button.isConnected)button.disabled=false;}
  };
  local.addEventListener('click',async event=>{
    const adminBtn=event.target.closest('[data-cc-admin-page]');
    if(adminBtn){openAdmin(adminBtn.dataset.ccAdminPage);return;}
    if(event.target.closest('[data-cc-open-goals]')){root.querySelector('.cc-goals')?.click();return;}
    const catalogBtn=event.target.closest('[data-cc-workflow-catalog]');
    if(catalogBtn){
      if(catalogBtn.disabled)return;
      const out=local.querySelector('[data-cc-catalog-result]');if(!out)return;
      const req=++catalogReq;
      catalogBtn.disabled=true;
      out.textContent='正在读取 28 图工作流目录…';
      try{
        const catalog=await invoke('workflow.image.catalog');
        if(req!==catalogReq)return;
        const workflows=Array.isArray(catalog?.workflows)?catalog.workflows:[];
        out.innerHTML=`<p class="notice">设计工作流 ${escape(catalog?.designWorkflowCount??28)} 项 · 节点 ${escape(catalog?.designNodeCount??185)} 个 · 适配器要求 ${escape(catalog?.adapterRequirementCount??152)} 项</p>`+
          (workflows.length?`<ul class="cc-local-list">${workflows.map(w=>`<li><div><strong>${escape(w.workflowId)} · ${escape(w.name)}</strong><br><small>${escape(w.nodeCount)} 节点 · 状态：${escape(w.state)} · 不可用原因：${escape((w.unavailableReasons??[]).join('、')||'无')}</small></div></li>`).join('')}</ul>`:`<p class="notice">${escape(catalog?.unavailableReason||'当前模式未返回工作流列表')}</p>`);
      }catch(error){if(req===catalogReq)out.textContent=error?.message??'工作流目录读取失败';}
      finally{if(catalogBtn.isConnected)catalogBtn.disabled=false;}
      return;
    }
    const watchBtn=event.target.closest('[data-cc-watch-check]');
    if(watchBtn){
      if(watchBtn.disabled)return;
      const out=local.querySelector('[data-cc-watch-result]');if(!out)return;
      const req=++watchReq;
      watchBtn.disabled=true;
      out.textContent='正在读取知识关注状态…';
      try{
        const status=await invoke('knowledge.watch.status');
        const watches=status?.state!=='unavailable'?await invoke('knowledge.watch.list').catch(()=>[]):[];
        const pending=status?.state!=='unavailable'?await invoke('knowledge.watch.pending').catch(()=>[]):[];
        if(req!==watchReq)return;
        out.textContent=`关注状态：${status?.health?.reason??status?.reason??(status?.running?'运行中':'未运行')} · 关注项 ${Array.isArray(watches)?watches.length:0} 个 · 待确认 ${Array.isArray(pending)?pending.length:0} 条`;
      }catch(error){if(req===watchReq)out.textContent=error?.message??'知识关注尚未就绪';}
      finally{if(watchBtn.isConnected)watchBtn.disabled=false;}
      return;
    }
    const cognitionBtn=event.target.closest('[data-cc-cognition-check]');
    if(cognitionBtn){
      if(cognitionBtn.disabled)return;
      await loadCognition(cognitionBtn);
      return;
    }
    const applyBtn=event.target.closest('[data-cc-cognition-apply]');
    if(applyBtn){
      if(applyBtn.disabled)return;
      applyBtn.disabled=true;
      try{
        await invoke('cognition.proposals.apply',{eventId:applyBtn.dataset.ccCognitionApply,source:applyBtn.dataset.ccCognitionSource});
        await loadCognition(local.querySelector('[data-cc-cognition-check]'),'已提交该认知提议并刷新当前状态。');
      }
      catch(error){report(error);}
      finally{if(applyBtn.isConnected)applyBtn.disabled=false;}
      return;
    }
    const button=event.target.closest('[data-local-task]');if(!button)return;showHome();const turn=[...root.querySelectorAll('[data-turn]')].find(item=>item.dataset.turn===button.dataset.localTask);turn?.scrollIntoView({block:'center'});
  });
  local.addEventListener('submit',event=>{
    const form=event.target.closest('.cc-local-search');if(!form)return;event.preventDefault();
    const query=form.elements.namedItem('query').value.trim();const result=local.querySelector('[data-cc-memory-result]');
    if(!query){result.textContent='请先输入要找的内容。';return;}
    result.textContent='正在查找…';
    invoke('knowledge.search',{query,limit:5}).then(value=>{
      const hits=Array.isArray(value?.hits)?value.hits:Array.isArray(value)?value:[];
      result.textContent=hits.length?hits.slice(0,5).map(hit=>hit.title||hit.path||hit.excerpt||'找到一条笔记').join('\n'):'没有找到匹配的笔记。';
    }).catch(error=>{result.textContent=error?.message||'没有找到。';});
  });
  rail.querySelector('.cc-new-chat').onclick=()=>{showHome();inline.main();closeSidebar();sessionRoot.querySelector('[data-session-new]').click();input.focus();};
  rail.querySelector('.cc-settings').onclick=()=>openAdmin('settings');side.querySelector('[data-cc-records]').onclick=()=>showLocal('tasks');
  rail.querySelector('nav').onclick=event=>{const button=event.target.closest('[data-cc-nav]');if(!button)return;const key=button.dataset.ccNav;if(key==='tasks'||key==='memory')showLocal(key);else{setHistoryOpen(false);showHome();inline.main();closeSidebar();input.focus();}};
  const form=root.querySelector('.workspace-composer'),actions=form.querySelector('.workspace-composer-actions');
  input.placeholder='跟主对话说，例如查天气、看今天的日程、看订阅';actions.prepend(preferences);
  const compact=document.createElement('button');compact.className='cc-compact';
  bindCompactButton(compact,input,root.querySelector('#workspace-error'));
  actions.prepend(compact);
  const voice=document.createElement('button');voice.type='button';voice.className='cc-voice';voice.setAttribute('aria-label','语音转文字');voice.innerHTML=centerIcon('voice');actions.insertBefore(voice,actions.querySelector('[data-send]'));
  const send=actions.querySelector('[data-send]');send.textContent='↑';send.setAttribute('aria-label','发送任务');
  const starters=document.createElement('div');starters.className='cc-starters';starters.innerHTML=[['查天气','查一下当前天气，直接告诉我气温和是否适合出门。'],['今日日程','看一下今天的日程，直接在主对话里回答。'],['看订阅','看一下当前订阅，直接在主对话里告诉我有什么更新。'],['整理今日计划','结合今天的日程和待办，整理成今日计划。']].map(([label,text],i)=>`<button type="button" data-cc-starter="${escape(text)}"><span>${['◈','⌕','▤','✧'][i]}</span>${label}</button>`).join('');form.after(starters);
  starters.onclick=event=>{const button=event.target.closest('[data-cc-starter]');if(button)starterDraft.select(button.dataset.ccStarter);};
  const openChild=binding=>{showHome();inline.select(binding);closeSidebar();};
  let teamSignature='',activitySignature='',mainConversationId;
  const pendingStops=new Set();
  team.querySelector('.cc-children').onclick=async event=>{
    const stop=event.target.closest('[data-stop-child]');
    if(stop){
      const binding={taskId:stop.dataset.stopChild,parentTaskId:stop.dataset.parentTask},key=JSON.stringify(binding),owner=mainConversationId;
      if(stop.disabled||pendingStops.has(key))return;pendingStops.add(key);stop.disabled=true;
      try{
        const detail=await invoke('workspace.subagent.snapshot',{binding});
        if(mainConversationId!==owner)throw Error('主会话已切换，请重新核对要停止的分对话');
        if(!detail.activeTaskId)throw Error('此分对话当前没有正在执行的任务');
        await invoke('workspace.subagent.cancel',{binding,request:{taskId:detail.activeTaskId}});
        inline.update();
      }catch(error){if(mainConversationId===owner)report(error);}
      finally{pendingStops.delete(key);if(stop.isConnected)stop.disabled=false;}
      return;
    }
    const button=event.target.closest('[data-child-task]');if(button)openChild({taskId:button.dataset.childTask,parentTaskId:button.dataset.parentTask});
  };
  side.querySelector('.cc-activity-list').onclick=event=>{const button=event.target.closest('[data-activity-task]');if(button){const turn=[...root.querySelectorAll('[data-turn]')].find(turn=>turn.dataset.turn===button.dataset.activityTask);turn?.querySelector('[data-view],[data-delegated-child]')?.click();}};
  const onKey=event=>{if(event.key!=='Escape')return;if(!history.hidden){dismissHistory();}else if(shell.classList.contains('cc-sidebar-open')){closeSidebar();railToggle.focus();}else if(side.classList.contains('cc-mobile-open')){setCardsOpen(false);cardToggle.focus();}};document.addEventListener('keydown',onKey);window.addEventListener('unload',()=>document.removeEventListener('keydown',onKey),{once:true});
  return {openChild,main(){showHome();inline.main();closeSidebar();},update(data){
    lastData=data;paintInternalChat(data);
    recent.update(data.conversationState?.recentSessions);
    if(mainConversationId!==data.conversationState?.activeId){
      starterDraft.reset();
      if(mainConversationId)inline.main();
      mainConversationId=data.conversationState?.activeId;
    }
    const state=commandCenterState(data),hasMessages=Boolean(state.tasks.length||data.messages?.length);
    welcome.hidden=hasMessages;shell.classList.toggle('cc-has-tasks',hasMessages);
    const runtime=data.runtime?.mode??data.runtime?.state??data.runtime;const fake=runtime==='fake'||data.fakeMode===true||String(data.connection??'').startsWith('Fake Runtime');
    hero.querySelector('[data-cc-preview]').textContent=fake?'本地预览':'';
    lastData=data;if(localView!=='home')paintLocal(data);
    heading.querySelector('[data-cc-session]').textContent=data.conversationState?.sessions?.find(s=>s.id===data.conversationState?.activeId)?.title??'当前会话';
    const coordinator=leadButton.querySelector('[data-cc-coordinator]');
    if(coordinator){
      coordinator.dataset.active=String(state.active>0);
      coordinator.textContent=state.active>0?(stateNames[state.latest?.state]??'运行中'):'待机';
    }
    team.querySelector('[data-cc-team-count]').textContent=String(state.children.length);
    const rows=state.children.map(child=>({
      taskId:child.taskId,parentTaskId:child.parentTaskId,title:childThreadTitle(child),state:child.state,
      preview:child.preview||child.finalReply||stateNames[child.state]||child.state,
    }));
    const nextTeam=JSON.stringify(rows);
    if(nextTeam!==teamSignature){
      teamSignature=nextTeam;team.querySelector('.cc-team-hint').hidden=Boolean(rows.length);
      const list=team.querySelector('.cc-children'),focused=list.contains(document.activeElement)?document.activeElement:null;
      list.innerHTML=childThreadGroups(rows).filter(group=>group.children.length).map(group=>{
        const itemsHtml=group.children.map(child=>{
          const id=escape(child.taskId),parent=escape(child.parentTaskId),title=escape(child.title);
          const selected=inline.selected?.taskId===child.taskId&&inline.selected?.parentTaskId===child.parentTaskId;
          const pending=pendingStops.has(JSON.stringify({taskId:child.taskId,parentTaskId:child.parentTaskId}));
          return `<div class="cc-child-row"><button type="button" class="cc-child" data-child-task="${id}" data-parent-task="${parent}" title="${title}" aria-pressed="${selected}"><span class="cc-agent-symbol cc-avatar" data-color="${avatarColor(child.taskId)}" data-shape="${avatarShape(child.taskId)}" aria-hidden="true">${agentGlyphSvg(child.taskId)}</span><span><strong>${title}</strong><small>${escape(child.preview)}</small></span></button>${isActiveChild(child)?`<button type="button" class="cc-child-stop" data-stop-child="${id}" data-parent-task="${parent}" aria-label="停止工人：${title}" title="停止这个工人的当前执行" ${pending?'disabled':''}>■</button>`:''}</div>`;
        }).join('');
        if(group.collapsed){
          const endedOpen=group.children.some(child=>inline.selected?.taskId===child.taskId&&inline.selected?.parentTaskId===child.parentTaskId)?' open':'';
          return `<details class="cc-agent-group cc-agent-ended" aria-label="${group.label}"${endedOpen}><summary class="cc-agent-ended-summary"><h3>${group.label}<span> · ${group.children.length}</span></h3></summary>${itemsHtml}</details>`;
        }
        return `<section class="cc-agent-group" aria-label="${group.label}"><h3>${group.label}<span> · ${group.children.length}</span></h3>${itemsHtml}</section>`;
      }).join('');
      if(focused&&!focused.isConnected){
        const field=focused.dataset.stopChild?'stopChild':'childTask';
        [...list.querySelectorAll('button')].find(button=>button.dataset[field]===focused.dataset[field])?.focus({preventScroll:true});
      }
    }
    const activeChild=inline.selected;
    if(activeChild)inline.update(state.children.find(child=>child.taskId===activeChild.taskId&&child.parentTaskId===activeChild.parentTaskId)??null);
    const nextActivity=JSON.stringify(state.activity);if(nextActivity!==activitySignature){activitySignature=nextActivity;side.querySelector('.cc-activity-list').innerHTML=state.activity.length?state.activity.map(task=>`<button type="button" data-activity-task="${escape(task.taskId)}"><span class="cc-activity-dot" data-state="${escape(task.state)}"></span><span><strong>${escape(task.userMessage||'历史任务')}</strong><small>${escape(stateNames[task.state]??task.state)}</small></span>${centerIcon('arrow')}</button>`).join(''):'<div class="cc-activity-empty"><span>⌁</span><strong>新的进展，会留在这里。</strong><p>发送第一条消息，开始积累你的工作记录。</p></div>';}
  }};
}
