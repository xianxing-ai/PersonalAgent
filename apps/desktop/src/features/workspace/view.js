import {mountSessionControls} from '../conversation/session-controls.js';
import {mountModelThinkingPicker} from '../conversation/model-thinking-picker.js';
import {mountSubagentConversations} from '../conversation/subagent-conversations.js';
import {Orb} from '../orb/orb.js';
import {stateNames,isTerminal,visualOrbState} from '../conversation/state.js';
import {mountConversationRail} from '../conversation/rail.js';
import {resultText} from '../conversation/result-text.js';
import {updateConversationTurns} from '../conversation/turn-view.js';
import {connectorCards,connectorDestination} from './connectors.js';
import {windowControlsHtml} from '../../ui/window-controls.js';
import {mountTaskProgress} from '../conversation/task-progress.js';
import {mountWorkspaceComposer} from '../conversation/workspace-composer.js';
import {mountCommandCenter} from './command-center.js';
import {mountWorkspaceApprovals} from './workspace-approvals.js';
import {mountWorkspaceRuntimeControls} from './runtime-controls.js';

const paths={settings:'M4 7h10m4 0h2M4 17h2m4 0h10M16 4v6M8 14v6',connectors:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zm11 3h7m-3-3v7',close:'m6 6 12 12M6 18 18 6',maximize:'M5 5h14v14H5z',minimize:'M5 12h14',copy:'M8 8h12v12H8zM16 8V4H4v12h4',view:'M3 5h18v14H3zM9 5v14'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
export function mountWorkspace(root,invoke,escape,{flushBeforeClose}={}){
  let current={tasks:[]},lastSignature='',cardsSignature='',inspected=null;
  let updateRevision=0;
  let connectorsRequested=true;
  const pendingCancelIds=new Set();
  root.innerHTML=`<section class="workspace focused-workspace">
    <header class="workspace-titlebar"><span class="workspace-app-title">PersonalAgent</span><span class="spacer"></span>${windowControlsHtml('workspace')}</header>
    <main class="workspace-main"><header class="workspace-top"><strong>悬浮球对话</strong><span class="spacer"></span><button class="icon-btn" id="connectors-toggle" aria-label="显示或隐藏连接器" aria-expanded="true">${icon('connectors')}</button><button class="icon-btn" data-open-settings="settings" aria-label="打开设置">${icon('settings')}</button></header>
    <div class="workspace-layout"><section class="workspace-chat"><p class="workspace-error" id="workspace-error" role="alert"></p><div class="workspace-stage" id="workspace-stage"><div class="workspace-welcome" id="workspace-welcome"><button class="workspace-orb" id="workspace-orb" aria-label="激活助手" aria-pressed="false"><canvas aria-hidden="true"></canvas></button><h1 id="workspace-greeting">从一个想法开始</h1><p id="workspace-intro"></p></div><div class="workspace-conversation" id="workspace-conversation" aria-live="polite"></div></div></section>
      <aside class="connector-board" aria-label="连接器信息"><header><div><h2>连接器</h2></div><button class="icon-btn" id="connectors-refresh" aria-label="刷新连接器">↻</button></header><div id="connector-cards"></div></aside>
      <aside class="conversation-inspector" id="conversation-inspector" aria-label="对话详情" hidden><header><h2>对话详情</h2><button class="icon-btn" id="inspector-close" aria-label="关闭对话详情">${icon('close')}</button></header><div id="inspector-content"></div></aside></div>
    </main></section>`;
  const subagents=mountSubagentConversations(root.querySelector('#workspace-stage'),invoke,escape);
  const conversation=root.querySelector('#workspace-conversation'),stage=root.querySelector('#workspace-stage');
  const updateProgress=mountTaskProgress(root.querySelector('.workspace-chat'),stage);
  const preferences=document.createElement('div');preferences.className='conversation-preferences';
  root.querySelector('.workspace-top').after(preferences);
  let feedbackRevision=0;
  const updateRail=mountConversationRail(root.querySelector('.workspace-chat'),stage);
  const orbButton=root.querySelector('#workspace-orb');
  const orb=new Orb(orbButton.querySelector('canvas'),{variant:'matrix',layout:'shell',count:520,luminous:true});
  orb.setBreathing({min:.52,max:.76,rate:.7});
  const syncMotion=()=>{if(document.hidden)orb.stop();else orb.setCalm(document.documentElement.dataset.calm==='true');};syncMotion();window.addEventListener('preferences-changed',syncMotion);
  const visibility=()=>{if(document.hidden)orb.stop();else syncMotion();};document.addEventListener('visibilitychange',visibility);
  let activationTimer;
  window.addEventListener('unload',()=>{clearTimeout(activationTimer);orb.dispose();window.removeEventListener('preferences-changed',syncMotion);document.removeEventListener('visibilitychange',visibility);});
  orbButton.onclick=()=>{
    clearTimeout(activationTimer);orbButton.setAttribute('aria-pressed','true');orb.playBreath(3.2);
    activationTimer=setTimeout(()=>{activationTimer=0;orbButton.setAttribute('aria-pressed','false');},3200);
  };
  const report=error=>{feedbackRevision++;root.querySelector('#workspace-error').textContent=error.message||String(error);};
  const composer=mountWorkspaceComposer(root.querySelector('.workspace-chat'),invoke,report);
  const draftInput=composer.input;
  const sessionRoot=document.createElement('div');sessionRoot.className='conversation-session-root';root.querySelector('.workspace-chat').prepend(sessionRoot);const sessionControls=mountSessionControls(sessionRoot,draftInput,invoke,report,{flushBeforeClose});
  const nativeReasoning=mountModelThinkingPicker(preferences,invoke,report,{readFeedbackRevision:()=>feedbackRevision,clearFeedback:()=>report('')});
  composer.beforeSubmit=async()=>{await nativeReasoning.flush();return sessionControls.flush();};
  composer.onAccepted=token=>sessionControls.submitted(token);
  const center=mountCommandCenter(root,{sessionRoot,preferences,input:draftInput,invoke,report,escape});
  const runtimeControls=mountWorkspaceRuntimeControls(root,invoke,report);
  const workspaceApprovals=mountWorkspaceApprovals(conversation,invoke,report,()=>feedbackRevision);
  window.addEventListener('pagehide',()=>nativeReasoning.dispose(),{once:true});
  syncAuxiliaryPanels();
  const syncCancelButtons=()=>conversation.querySelectorAll('[data-cancel],[data-reconcile]').forEach(button=>{button.disabled=Boolean(button.dataset.reconcile&&current.tasks.find(task=>task.taskId===button.dataset.reconcile)?.reconciliationStatus?.blockedReason)||pendingCancelIds.has(button.dataset.cancel??button.dataset.reconcile)||current.tasks.some(task=>task.taskId===(button.dataset.cancel??button.dataset.reconcile)&&task.state==='cancelling');});
  const restoreTaskActionFocus=focused=>{
    if(!focused||focused.disabled||document.activeElement!==document.body)return;
    const action=['view','copy','cancel','reconcile'].find(key=>focused.dataset[key]);if(!action)return;
    const button=[...conversation.querySelectorAll('button')].find(item=>item.dataset[action]===focused.dataset[action]);
    if(button&&!button.disabled)button.focus({preventScroll:true});
  };
  root.querySelectorAll('[data-open-settings]').forEach(button=>button.onclick=()=>invoke('admin.open',{page:button.dataset.openSettings}).catch(report));
  function syncAuxiliaryPanels(restoreTaskFocus=true){
    const showConnectors=connectorsRequested&&!inspected;
    const inspector=root.querySelector('#conversation-inspector');
    const restoreFocus=!inspected&&inspector.contains(document.activeElement);
    root.querySelector('.connector-board').hidden=!showConnectors;
    root.querySelector('#connectors-toggle').setAttribute('aria-expanded',String(showConnectors));
    inspector.hidden=!inspected;
    if(restoreFocus){
      const trigger=restoreTaskFocus?[...conversation.querySelectorAll('[data-view]')].find(button=>button.dataset.view===inspector.dataset.taskId):null;
      (trigger??root.querySelector('.cc-tools')??root.querySelector('#connectors-toggle')).focus({preventScroll:true});
    }
  }
  root.querySelector('#connectors-toggle').onclick=()=>{
    if(inspected){inspected=null;connectorsRequested=true;}else connectorsRequested=!connectorsRequested;
    syncAuxiliaryPanels();
  };
  root.querySelector('#connectors-refresh').onclick=async event=>{event.currentTarget.disabled=true;const operationRevision=updateRevision;let readRevision;try{await invoke('capability.list');readRevision=updateRevision;const data=await invoke('snapshot');if(readRevision===updateRevision)update(data);}catch(error){if((readRevision??operationRevision)===updateRevision)report(error);}finally{root.querySelector('#connectors-refresh').disabled=false;}};
  root.querySelector('#inspector-close').onclick=()=>{inspected=null;syncAuxiliaryPanels();};
  // 天气卡片此前没有任何配置入口：weather.configure 只存在于主进程 IPC，渲染层从未调用。
  // 这里补一个内联输入框，配置后由宿主自己查询并每 10 分钟刷新。
  const askWeatherCity = () => {
    const existing = root.querySelector('.cc-city-dialog');
    if (existing) { existing.querySelector('input')?.focus(); return; }
    const overlay = document.createElement('div');
    overlay.className = 'cc-city-dialog';
    overlay.innerHTML = '<form role="dialog" aria-label="设置天气城市">'
      + '<label>天气城市<input name="city" maxlength="60" autocomplete="off" placeholder="例如 青岛"></label>'
      + '<div class="cc-city-actions"><button type="submit">确定</button><button type="button" data-cancel>取消</button></div>'
      + '<p class="cc-city-status" role="status"></p></form>';
    const form = overlay.querySelector('form');
    const status = overlay.querySelector('.cc-city-status');
    const close = () => overlay.remove();
    overlay.querySelector('[data-cancel]').onclick = close;
    form.onsubmit = async event => {
      event.preventDefault();
      const city = String(new FormData(form).get('city') ?? '').trim();
      if (!city) { status.textContent = '请输入城市名'; return; }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      status.textContent = '正在查询…';
      try {
        await invoke('weather.configure', {location: city});
        close();
        update(await invoke('snapshot'));
      } catch (error) {
        submit.disabled = false;
        status.textContent = String(error?.message ?? '城市无效或天气服务不可用');
      }
    };
    root.appendChild(overlay);
    overlay.querySelector('input').focus();
  };
  root.querySelector('#connector-cards').onclick=event=>{
    const card=event.target.closest('[data-connector]');if(!card)return;
    const destination=connectorDestination(card.dataset.connector,current);
    if(destination.action){invoke(destination.action).catch(report);return;}
    if(destination.configure==='weather'){askWeatherCity();return;}
    if(destination.draft){
      root.querySelector('.cc-team-lead')?.click();
      if(!draftInput.value.trim()){draftInput.value=destination.draft;draftInput.dispatchEvent(new Event('input',{bubbles:true}));}
      draftInput.focus();
    }else invoke('admin.open',{page:destination.page}).catch(report);
  };
  root.querySelector('#connector-cards').onkeydown=event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-connector]')){event.preventDefault();event.target.click();}};
  conversation.onclick=async event=>{
    const button=event.target.closest('[data-cancel],[data-reconcile],[data-view],[data-copy]');if(!button)return;
    try{if(button.dataset.view){inspected=button.dataset.view;renderInspector();}else if(button.dataset.copy){await invoke('clipboard.writeText',resultText(current.tasks.find(task=>task.taskId===button.dataset.copy)?.resultSummary,current.tasks.find(task=>task.taskId===button.dataset.copy)?.resultMetadata));button.title='已复制';}else{const id=button.dataset.cancel??button.dataset.reconcile;if(button.disabled||pendingCancelIds.has(id))return;pendingCancelIds.add(id);syncCancelButtons();try{await invoke(button.dataset.reconcile?'task.reconcile.finish':'task.cancel',id);}finally{pendingCancelIds.delete(id);syncCancelButtons();}}}catch(error){report(error);syncCancelButtons();}
  };
  function renderInspector(){
    const task=current.tasks.find(item=>item.taskId===inspected);
    if(!task){inspected=null;syncAuxiliaryPanels();return;}
    root.querySelector('#conversation-inspector').dataset.taskId=task.taskId;
    syncAuxiliaryPanels();
    root.querySelector('#inspector-content').innerHTML=`<h3>你的消息</h3><p>${escape(task.userMessage||'历史对话')}</p><h3>回答</h3><p>${escape(resultText(task.resultSummary,task.resultMetadata)||task.error?.message||stateNames[task.state])}</p>${task.resultMetadata?`<h3>模型与验证</h3><p>${escape(task.resultMetadata.profile)} · ${escape(task.resultMetadata.verification)}</p>`:'' }<h3>执行状态</h3><p>${escape(stateNames[task.state]||task.state)}</p>${(task.steps||[]).map(step=>`<p class="inspector-step">${escape(step.label)} · ${escape(step.state)}</p>`).join('')}`;
  }
  function update(data){
    updateRevision++;
    const sessionChanged=current?.conversationState?.activeId!==data.conversationState?.activeId;if(sessionChanged){inspected=null;syncAuxiliaryPanels(false);}
    current=data;current.tasks ||= [];
    subagents.update(data.subagentTasks??[]);
    sessionControls.update(data);nativeReasoning.update(data);
    orb.setLevel(data.audioLevel??0);
    orb.setState(visualOrbState(data));
    if(document.hidden)orb.stop();
    composer.update(data);
    updateProgress(data.tasks);
    root.querySelector('#workspace-greeting').hidden=current.tasks.length>0;root.querySelector('#workspace-intro').hidden=current.tasks.length>0;root.querySelector('#workspace-welcome').classList.toggle('compact',current.tasks.length>0);
    const signature=JSON.stringify(data.tasks);
    if(signature!==lastSignature){
      const focused=conversation.contains(document.activeElement)?document.activeElement:null;
      const atBottom=stage.scrollHeight-stage.scrollTop-stage.clientHeight<90;lastSignature=signature;
      updateConversationTurns(conversation,data.tasks.map(task=>`<article class="workspace-turn" data-turn="${escape(task.taskId)}"><div class="user-message">${escape(task.userMessage||'历史对话')}</div><div class="assistant-message">${escape(resultText(task.resultSummary,task.resultMetadata)||task.error?.message||stateNames[task.state]||task.state)}</div><div class="response-actions"><button type="button" data-view="${escape(task.taskId)}" title="在对话内查看" aria-label="查看这轮对话">${icon('view')}</button>${task.resultSummary?`<button type="button" data-copy="${escape(task.taskId)}" title="复制回答" aria-label="复制回答">${icon('copy')}</button>`:''}${task.state==='waiting_reconciliation'?`<p class="notice">${escape(task.reconciliationStatus?.blockedReason??'原任务结果待核实，未确认前保留当前状态。核实并结束只检查原记录，不重发操作。')}</p><button type="button" class="turn-action" data-reconcile="${escape(task.taskId)}" ${task.reconciliationStatus?.blockedReason?'disabled':''}>核实并结束</button>`:''}${!isTerminal(task)?`<button class="turn-action" data-cancel="${escape(task.taskId)}" ${task.state==='cancelling'?'disabled':''}>${task.state==='cancelling'?'正在停止':'停止'}</button>`:''}</div></article>`).join(''),{tasks:data.tasks,pendingCancelIds,cancelSelector:'[data-cancel]',cancelAttribute:'cancel'});
      syncCancelButtons();restoreTaskActionFocus(focused);
      requestAnimationFrame(()=>{if(atBottom)stage.scrollTop=stage.scrollHeight;updateRail();});if(inspected)renderInspector();
    }
    for(const turn of conversation.querySelectorAll('[data-turn]')){if(!turn.querySelector('[data-workspace-approvals]')){const slot=document.createElement('div');slot.dataset.workspaceApprovals=turn.dataset.turn;turn.querySelector('.response-actions').before(slot);}}
    workspaceApprovals.update(data);center.update(data);runtimeControls.update(data);
    const nextCards=JSON.stringify([data.capabilities,data.health,data.notifications,data.todo,data.feeds,data.mail,data.knowledge,data.weather]);if(cardsSignature!==nextCards){cardsSignature=nextCards;root.querySelector('#connector-cards').innerHTML=connectorCards(data,escape);}
  }
  update.setAudioLevel=level=>orb.setLevel(level);
  return update;
}
