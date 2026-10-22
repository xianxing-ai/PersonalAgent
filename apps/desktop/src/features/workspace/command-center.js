import {stateNames,isTerminal} from '../conversation/state.js';
import {mountInlineSubagents} from './inline-subagents.js';
import {mountHeroStarfield} from './hero-starfield.js';

const paths={home:'m3 10 9-7 9 7v11h-7v-7h-4v7H3z',team:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7a4 4 0 0 1 0 8',tasks:'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',memory:'M12 3c5 0 8 2 8 4s-3 4-8 4-8-2-8-4 3-4 8-4m-8 4v10c0 2 3 4 8 4s8-2 8-4V7M4 12c0 2 3 4 8 4s8-2 8-4',link:'m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',settings:'M4 7h10m4 0h2M4 17h2m4 0h10M16 4v6M8 14v6',arrow:'m9 5 7 7-7 7',plus:'M12 5v14M5 12h14',search:'M21 21l-5-5M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16',history:'M3 12a9 9 0 1 0 2-6M3 3v5h5m4-1v5l3 2',close:'m6 6 12 12M6 18 18 6',send:'m4 4 17 8-17 8 4-8-4-8m4 8h13',voice:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5m-4 6a7 7 0 0 0 14 0m-7 7v4'};
export const centerIcon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]??paths.team}"/></svg>`;

// Keep source ordering inside each real state group; never manufacture workers.
export function childThreadGroups(children=[]){
  return [{label:'进行中',children:children.filter(child=>!isTerminal(child))},{label:'已结束',children:children.filter(isTerminal)}];
}
export function childThreadTitle(child){
  const goal=typeof child.goal==='string'?child.goal.replace(/^\[任务执行\]\s*/,'').trim():'';
  return goal||child.role||'分对话';
}
const agentSymbols=['✳','⌛','◉','✺','❖'];
function childSymbol(child){let hash=0;for(const character of child.taskId)hash=(hash*31+character.charCodeAt(0))>>>0;return agentSymbols[hash%agentSymbols.length];}

// Pure projection of existing records. No timers, invented workers or task states.
export function commandCenterState(data){
  const tasks=Array.isArray(data.tasks)?data.tasks:[],children=Array.isArray(data.subagentTasks)?data.subagentTasks:[];
  return {tasks,children,active:tasks.filter(t=>!isTerminal(t)&&!t.outputTruncated&&!t.cancelRequested).length,
    working:children.filter(t=>!isTerminal(t)).length,latest:tasks.findLast(t=>!isTerminal(t)&&!t.outputTruncated&&!t.cancelRequested)??tasks.at(-1),
    activity:tasks.slice(-5).reverse(),configured:(data.health??[]).filter(h=>h.state==='ready').length};
}

/** Layout only: reuse the actual session, model picker, composer and child controls. */
export function mountCommandCenter(root,{sessionRoot,preferences,input,invoke,report,escape}){
  const shell=root.querySelector('.workspace'),bar=root.querySelector('.workspace-titlebar'),main=root.querySelector('.workspace-main'),layout=root.querySelector('.workspace-layout');
  shell.classList.add('command-center');
  const rail=document.createElement('aside');rail.className='cc-rail';rail.setAttribute('aria-label','主导航');
  rail.innerHTML=`<div class="cc-brand"><strong>PersonalAgent</strong><button type="button" class="cc-history-toggle" aria-label="对话历史" title="对话历史">${centerIcon('search')}</button></div><button type="button" class="cc-new-chat">${centerIcon('plus')}<span>新对话</span></button><div class="cc-thread-scroll"></div><div class="cc-rail-spacer"></div><section class="cc-system"><strong data-cc-runtime>正在读取状态</strong><p data-cc-count>等待任务快照</p></section><nav>${[['home','工作台'],['tasks','任务记录'],['memory','知识与记忆']].map(([id,label])=>`<button type="button" data-cc-nav="${id}" ${id==='home'?'aria-current="page"':''} title="${label}">${centerIcon(id)}<span>${label}</span></button>`).join('')}<button type="button" class="cc-settings" aria-label="设置与偏好" title="设置与偏好">${centerIcon('settings')}<span>设置与偏好</span></button></nav>`;
  shell.prepend(rail);
  for(const button of rail.querySelectorAll('button')){const label=button.querySelector('span')?.textContent;if(label){button.setAttribute('aria-label',label);button.title=label;}}
  bar.querySelector('.workspace-app-title').textContent='工作台';
  const search=document.createElement('button');search.type='button';search.className='cc-search';search.innerHTML=`${centerIcon('search')}<span>查找对话</span><kbd>历史</kbd>`;bar.querySelector('.window-controls').before(search);
  const themeButton=document.createElement('button');themeButton.type='button';themeButton.className='cc-theme-toggle';themeButton.setAttribute('aria-label','切换黑白主题');themeButton.title='切换黑白主题';themeButton.textContent='◐';themeButton.onclick=async()=>{const {saveTheme}=await import('../../ui/preferences.js');saveTheme(document.documentElement.dataset.theme==='light'?'dark':'light');};search.before(themeButton);
  const railToggle=document.createElement('button');railToggle.type='button';railToggle.className='cc-sidebar-toggle';railToggle.setAttribute('aria-label','显示或隐藏侧栏');railToggle.setAttribute('aria-expanded','false');railToggle.innerHTML=centerIcon('tasks');bar.prepend(railToggle);railToggle.onclick=()=>{const open=shell.classList.toggle('cc-sidebar-open');railToggle.setAttribute('aria-expanded',String(open));};
  const cardToggle=document.createElement('button');cardToggle.type='button';cardToggle.className='cc-connectors-toggle';cardToggle.setAttribute('aria-label','显示或隐藏连接器卡片');cardToggle.setAttribute('aria-expanded','false');cardToggle.innerHTML=centerIcon('link');themeButton.before(cardToggle);
  const syncAppearance=async()=>{try{const {themePreference}=await import('../../ui/preferences.js');await invoke('workspace.appearance',{theme:themePreference()});}catch(error){report(error);}};
  window.addEventListener('preferences-changed',syncAppearance);window.addEventListener('unload',()=>window.removeEventListener('preferences-changed',syncAppearance),{once:true});syncAppearance();
  const top=root.querySelector('.workspace-top');
  top.hidden=true;
  const hero=document.createElement('section');hero.className='cc-hero';hero.setAttribute('aria-label','工作台概览');
  hero.innerHTML='<div class="cc-hero-copy"><h1>PersonalAgent</h1><p class="cc-hero-tagline">把想法变成现实。</p><p>交代目标，保持掌控，让每一步进展清晰可见。</p><small data-cc-preview></small></div><div class="cc-hero-visual"><div class="cc-orbit cc-orbit-a"><i></i></div><div class="cc-orbit cc-orbit-b"><i></i></div><div class="cc-orbit cc-orbit-c"><i></i></div><div class="cc-orb-halo"></div></div>';
  main.insertBefore(hero,layout);hero.querySelector('.cc-hero-visual').append(root.querySelector('#workspace-orb'));
  mountHeroStarfield(hero);
  const chat=root.querySelector('.workspace-chat'),heading=document.createElement('header');heading.className='cc-chat-heading';
  heading.innerHTML='<div><strong>主对话</strong><p><span data-cc-session></span></p></div>';
  chat.prepend(heading);heading.append(preferences);
  const stage=root.querySelector('#workspace-stage');stage.querySelector('#workspace-welcome').hidden=true;
  const welcome=document.createElement('section');welcome.className='cc-empty';welcome.innerHTML='<h2>有什么可以帮你？</h2><p>描述任务，或者选择一个快捷操作。</p>';
  stage.prepend(welcome);
  const side=document.createElement('aside');side.className='cc-context';side.setAttribute('aria-label','协作与活动');side.innerHTML=`<section class="cc-team"><header><h2>${centerIcon('team')}智能体协作</h2><span data-cc-team-count>暂无委派</span></header><div class="cc-team-lead"><span class="cc-agent-avatar">${centerIcon('home')}</span><div><strong>主对话</strong><p>你的目标与执行上下文</p></div><span class="cc-state" data-cc-coordinator>待机</span></div><div class="cc-children"></div><div class="cc-team-hint"><span class="cc-constellation">✧</span><strong>协作随任务展开</strong><p>发生真实委派后，子智能体的角色、状态和独立对话会显示在这里。</p></div><div class="cc-child-actions"></div></section><section class="cc-activity"><header><h2>${centerIcon('history')}最近活动</h2><button type="button" data-cc-records>全部记录 ${centerIcon('arrow')}</button></header><div class="cc-activity-list"></div></section><div class="cc-trust"><span>◇</span><p>每一次行动，都由你掌控。<br><small>涉及外部操作时，沿用原有授权流程。</small></p></div>`;
  layout.append(side);
  const lead=side.querySelector('.cc-team-lead'),leadButton=document.createElement('button');leadButton.type='button';leadButton.className='cc-team-lead';leadButton.setAttribute('aria-label','切换到主对话');leadButton.innerHTML='<span class="cc-thread-symbol">○</span><span><strong>主对话</strong></span><span class="cc-state" data-cc-coordinator>待机</span>';lead.replaceWith(leadButton);
  side.querySelector('.cc-team h2').innerHTML='对话';side.querySelector('.cc-team-hint').innerHTML='<p>子智能体会在实际委派后显示。</p>';side.querySelector('.cc-trust').hidden=true;
  const team=side.querySelector('.cc-team');team.querySelector('h2').textContent='主对话的分对话';rail.querySelector('.cc-thread-scroll').append(team);
  const board=root.querySelector('.connector-board');side.prepend(board);board.setAttribute('aria-label','主页连接器卡片');
  const allCapabilities=document.createElement('button');allCapabilities.type='button';allCapabilities.className='cc-capabilities';allCapabilities.textContent='全部能力';allCapabilities.title='查看 Runtime 当前公布的工具和连接状态';allCapabilities.onclick=()=>invoke('admin.open',{page:'capabilities'}).catch(report);board.querySelector('header').append(allCapabilities);
  const showCards=()=>{side.classList.add('cc-mobile-open');cardToggle.setAttribute('aria-expanded','true');board.scrollIntoView({block:'nearest'});};
  cardToggle.onclick=()=>{const open=side.classList.toggle('cc-mobile-open');cardToggle.setAttribute('aria-expanded',String(open));};
  const inline=mountInlineSubagents(chat,invoke,report,binding=>{leadButton.setAttribute('aria-pressed',String(!binding));for(const button of team.querySelectorAll('[data-child-task]'))button.setAttribute('aria-pressed',String(Boolean(binding&&button.dataset.childTask===binding.taskId&&button.dataset.parentTask===binding.parentTaskId)));});
  const closeSidebar=()=>{shell.classList.remove('cc-sidebar-open');railToggle.setAttribute('aria-expanded','false');};
  leadButton.setAttribute('aria-pressed','true');leadButton.onclick=()=>{inline.main();closeSidebar();};
  const originalChildren=root.querySelector('.subagent-conversations');team.querySelector('.cc-child-actions').append(originalChildren);
  const history=document.createElement('aside');history.className='cc-history';history.id='cc-history';history.hidden=true;history.setAttribute('aria-label','历史会话');history.innerHTML=`<header><h2>对话历史</h2><button type="button" aria-label="关闭历史会话">${centerIcon('close')}</button></header>`;history.append(sessionRoot);layout.append(history);
  rail.querySelector('.cc-history-toggle').setAttribute('aria-controls','cc-history');rail.querySelector('.cc-history-toggle').setAttribute('aria-expanded','false');
  const toggleHistory=()=>{history.hidden=!history.hidden;rail.querySelector('.cc-history-toggle').setAttribute('aria-expanded',String(!history.hidden));};
  rail.querySelector('.cc-history-toggle').onclick=toggleHistory;search.onclick=()=>{if(history.hidden)toggleHistory();history.querySelector('[data-session-list]').focus();};history.querySelector('header button').onclick=()=>{history.hidden=true;rail.querySelector('.cc-history-toggle').setAttribute('aria-expanded','false');search.focus();};
  const openAdmin=page=>invoke('admin.open',{page}).catch(report);
  rail.querySelector('.cc-new-chat').onclick=()=>{inline.main();closeSidebar();sessionRoot.querySelector('[data-session-new]').click();input.focus();};
  rail.querySelector('.cc-settings').onclick=()=>openAdmin('settings');side.querySelector('[data-cc-records]').onclick=()=>openAdmin('tasks');
  rail.querySelector('nav').onclick=event=>{const button=event.target.closest('[data-cc-nav]');if(!button)return;const key=button.dataset.ccNav;if(key==='tasks'||key==='memory')openAdmin(key);else{history.hidden=true;inline.main();input.focus();}};
  const form=root.querySelector('.workspace-composer'),actions=form.querySelector('.workspace-composer-actions');
  input.placeholder='给 PersonalAgent 发送消息…';actions.prepend(preferences);
  const tools=document.createElement('button');tools.type='button';tools.className='cc-tools';tools.setAttribute('aria-label','连接器与工具');tools.title='连接器与工具';tools.innerHTML=centerIcon('plus');tools.onclick=()=>{showCards();board.querySelector('#connectors-refresh').focus({preventScroll:true});};actions.prepend(tools);
  const voice=document.createElement('button');voice.type='button';voice.className='cc-voice';voice.setAttribute('aria-label','打开语音设置');voice.title='语音设置';voice.innerHTML=centerIcon('voice');voice.onclick=()=>openAdmin('voice');actions.insertBefore(voice,actions.querySelector('[data-send]'));
  const send=actions.querySelector('[data-send]');send.textContent='↑';send.setAttribute('aria-label','发送任务');
  const starters=document.createElement('div');starters.className='cc-starters';starters.innerHTML=[['整理今日计划','列出今天的日程、待办和未完成的事项，整理成今日计划。'],['研究一个主题','帮我研究一个主题，先向我确认研究范围。'],['梳理待办','整理我当前的待办，并给出优先级建议。'],['起草一份内容','帮我起草一份内容，先确认用途、读者和要求。']].map(([label,text],i)=>`<button type="button" data-cc-starter="${escape(text)}"><span>${['◈','⌕','▤','✧'][i]}</span>${label}</button>`).join('');form.after(starters);
  starters.onclick=event=>{const button=event.target.closest('[data-cc-starter]');if(button){input.value=button.dataset.ccStarter;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}};
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
    const button=event.target.closest('[data-child-task]');if(button){inline.select({taskId:button.dataset.childTask,parentTaskId:button.dataset.parentTask});closeSidebar();}
  };
  side.querySelector('.cc-activity-list').onclick=event=>{const button=event.target.closest('[data-activity-task]');if(button){const turn=[...root.querySelectorAll('[data-turn]')].find(turn=>turn.dataset.turn===button.dataset.activityTask);turn?.querySelector('[data-view]')?.click();}};
  const onKey=event=>{if(event.key!=='Escape')return;if(!history.hidden){history.hidden=true;rail.querySelector('.cc-history-toggle').setAttribute('aria-expanded','false');search.focus();}else if(shell.classList.contains('cc-sidebar-open')){closeSidebar();railToggle.focus();}else if(side.classList.contains('cc-mobile-open')){side.classList.remove('cc-mobile-open');cardToggle.setAttribute('aria-expanded','false');cardToggle.focus();}};document.addEventListener('keydown',onKey);window.addEventListener('unload',()=>document.removeEventListener('keydown',onKey),{once:true});
  return {update(data){
    if(mainConversationId&&mainConversationId!==data.conversationState?.activeId)inline.main();mainConversationId=data.conversationState?.activeId;
    const state=commandCenterState(data);welcome.hidden=Boolean(state.tasks.length);shell.classList.toggle('cc-has-tasks',Boolean(state.tasks.length));
    const runtime=data.runtime?.mode??data.runtime?.state??data.runtime;const fake=runtime==='fake'||data.fakeMode===true||String(data.connection??'').startsWith('Fake Runtime');
    hero.querySelector('[data-cc-preview]').textContent=fake?'本地效果预览 · 模拟运行':'';
    rail.querySelector('[data-cc-runtime]').textContent=fake?'模拟预览环境':data.agentArtsConfigured===false?'等待配置比赛 Runtime':'本地工作台';
    rail.querySelector('[data-cc-count]').textContent=`${state.active} 项进行中 · ${state.children.length} 条协作记录`;
    const active=state.latest&&!isTerminal(state.latest)&&!state.latest.outputTruncated&&!state.latest.cancelRequested;
    heading.querySelector('[data-cc-session]').textContent=data.conversationState?.sessions?.find(s=>s.id===data.conversationState?.activeId)?.title??'当前会话';
    team.querySelector('[data-cc-team-count]').textContent=String(state.children.length);team.querySelector('[data-cc-coordinator]').textContent=active?(stateNames[state.latest.state]??state.latest.state):'待机';
    const nextTeam=JSON.stringify(state.children);if(nextTeam!==teamSignature){teamSignature=nextTeam;team.querySelector('.cc-team-hint').hidden=Boolean(state.children.length);team.querySelector('.cc-children').innerHTML=childThreadGroups(state.children).filter(group=>group.children.length).map(group=>`<section class="cc-agent-group"><h3>${group.label}<span> · ${group.children.length}</span></h3>${group.children.map(child=>`<div class="cc-child-row"><button type="button" class="cc-child" data-child-task="${escape(child.taskId)}" data-parent-task="${escape(child.parentTaskId)}" title="${escape(childThreadTitle(child))}" aria-pressed="${Boolean(inline.selected?.taskId===child.taskId&&inline.selected?.parentTaskId===child.parentTaskId)}"><span class="cc-agent-symbol" aria-hidden="true">${childSymbol(child)}</span><span><strong>${escape(childThreadTitle(child))}</strong><small>${escape(stateNames[child.state]??child.state)}</small></span></button>${!isTerminal(child)?`<button type="button" class="cc-child-stop" data-stop-child="${escape(child.taskId)}" data-parent-task="${escape(child.parentTaskId)}" aria-label="停止分对话：${escape(childThreadTitle(child))}" title="停止此分对话的当前执行" ${pendingStops.has(JSON.stringify({taskId:child.taskId,parentTaskId:child.parentTaskId}))?'disabled':''}>■</button>`:''}</div>`).join('')}</section>`).join('');}
    inline.update();
    const nextActivity=JSON.stringify(state.activity);if(nextActivity!==activitySignature){activitySignature=nextActivity;side.querySelector('.cc-activity-list').innerHTML=state.activity.length?state.activity.map(task=>`<button type="button" data-activity-task="${escape(task.taskId)}"><span class="cc-activity-dot" data-state="${escape(task.state)}"></span><span><strong>${escape(task.userMessage||'历史任务')}</strong><small>${escape(stateNames[task.state]??task.state)}</small></span>${centerIcon('arrow')}</button>`).join(''):'<div class="cc-activity-empty"><span>⌁</span><strong>新的进展，会留在这里。</strong><p>发送第一条消息，开始积累你的工作记录。</p></div>';}
    for(const turn of root.querySelectorAll('[data-turn]')){const task=state.tasks.find(t=>t.taskId===turn.dataset.turn);let timeline=turn.querySelector('.cc-timeline');if(!timeline){timeline=document.createElement('section');timeline.className='cc-timeline';turn.querySelector('.response-actions').before(timeline);}const steps=Array.isArray(task?.steps)?task.steps:[],signature=JSON.stringify(steps);timeline.hidden=!steps.length;if(timeline.dataset.signature!==signature){timeline.dataset.signature=signature;timeline.innerHTML=steps.length?`<header>${centerIcon('team')}执行轨迹 <span>${steps.length} 个步骤</span></header><ol>${steps.map(step=>`<li data-state="${escape(step.state)}"><i></i><span><strong>${escape(step.label||'执行步骤')}</strong><small>${escape(stateNames[step.state]??step.state)}</small></span></li>`).join('')}</ol>`:'';}}
  }};
}
