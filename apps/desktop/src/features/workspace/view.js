import {errorDisplayText} from '../../shared/error-display.js';
import {mountSessionControls} from '../conversation/session-controls.js';
import {mountModelThinkingPicker} from '../conversation/model-thinking-picker.js';
import {answerCardHtml, liveFromTranscript, rememberActivity, replaceAnswerCard, syncContainerAnswerDisclosures} from '../conversation/answer-block.js';
import {assistantThreadActionsHtml, bindAssistantThreadActions, mountAssistantRoster} from '../conversation/assistant-roster-ui.js';
import {mountFailureRepairCard} from '../conversation/failure-repair-card.js';
import {createGoalControl} from '../conversation/goal-view.js';
import {mountBriefingPanel} from '../admin/daily-briefing.js';
import {mountProactiveControls} from '../../app/proactive-controls.js';
import {mountProactiveWorkflowControls} from '../../app/proactive-workflow-controls.js';
import {Orb} from '../orb/orb.js';
import {orbVariantPreference,orbStateOverride} from '../../ui/preferences.js';
import {stateNames,isTerminal,visualOrbState} from '../conversation/state.js';
import {mountConversationRail} from '../conversation/rail.js';
import {resultText} from '../conversation/result-text.js';
import {updateConversationTurns} from '../conversation/turn-view.js';
import {connectorCards,connectorDestination} from './connectors.js';
import {windowControlsHtml} from '../../ui/window-controls.js';
import {mountTaskProgress} from '../conversation/task-progress.js';
import {mountWorkspaceComposer} from '../conversation/workspace-composer.js';
import {applyOperatorBrake} from '../conversation/operator-brake-view.js';
import {mountCommandCenter} from './command-center.js';
import {mountWorkspaceApprovals} from './workspace-approvals.js';
import {mountWorkspaceRuntimeControls} from './runtime-controls.js';

const paths={settings:'M4 7h10m4 0h2M4 17h2m4 0h10M16 4v6M8 14v6',connectors:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zm11 3h7m-3-3v7',close:'m6 6 12 12M6 18 18 6',maximize:'M5 5h14v14H5z',minimize:'M5 12h14',copy:'M8 8h12v12H8zM16 8V4H4v12h4',view:'M3 5h18v14H3zM9 5v14'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
const operationStates={started:'已开始',completed:'已完成',confirmed:'已确认',pending:'等待中',returned:'已返回',
  allowed:'已授权',denied:'已拒绝',expired:'已过期',revoked:'已撤销'};
const operationKinds={tool_call:'工具调用',tool_result:'工具返回',approval_wait:'等待授权',approval_result:'授权决定'};

function delegationCard(child,openSteps,escape){
  const role=child.role==='coordinator'?'任务执行':child.role||'子智能体';
  const steps=child.steps??[],tools=child.toolActivity??[];
  const rows=[...steps.filter(step=>step.label&&!tools.some(tool=>tool.label===step.label)),...tools];
  const occurrences=new Map();
  const activity=rows.length?`<ul>${rows.map(row=>{
    const label=row.label||row.toolName,state=stateNames[row.state]??operationStates[row.state]??row.state;
    const type=operationKinds[row.kind]??'执行步骤';
    const identity=JSON.stringify([child.taskId,row.stepId??row.toolName??label,row.kind??'step']);
    const occurrence=occurrences.get(identity)??0;
    occurrences.set(identity,occurrence+1);
    const key=JSON.stringify([identity,occurrence]);
    return `<li><details data-delegation-step="${escape(key)}"${openSteps.has(key)?' open':''}>
      <summary><span>${escape(label)}</span><small>${escape(state??type)}</small></summary>
      <p>${escape(type)}${row.toolName&&row.toolName!==label?` · ${escape(row.toolName)}`:''}</p>
    </details></li>`;
  }).join('')}</ul>`:'';
  const evidence=child.evidenceRefCount>0?`<small>${escape(child.evidenceRefCount)} 条证据</small>`:'';
  return `<section class="cc-delegation-card" aria-label="已委派的子智能体">
    <header><strong>已委派 · ${escape(role)}</strong><span>${escape(stateNames[child.state]??child.state)}</span></header>
    ${activity}
    <footer>${evidence}<button class="turn-action" type="button" data-delegated-child="${escape(child.taskId)}"
      data-parent-task="${escape(child.parentTaskId)}">打开子对话</button></footer>
  </section>`;
}

function publicLiveTranscript(transcript){
  const segments=transcript?.segments?.filter(segment=>segment.kind!=='reasoning')
    .map(segment=>segment.kind==='reasoning_summary'?{...segment,kind:'reasoning'}:segment);
  return liveFromTranscript({segments});
}

export function mountWorkspace(root,invoke,escape,{flushBeforeClose}={}){
  const liveTurns=new Map();
  const locateFeedback=new Map();
  let roster;const paintAssistants=data=>roster?.paint(data?.assistants,data);
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
  const conversation=root.querySelector('#workspace-conversation'),stage=root.querySelector('#workspace-stage');
  let feedbackRevision=0;
  const report=error=>{feedbackRevision++;root.querySelector('#workspace-error').textContent=errorDisplayText(error);};
  const assistantRoster=document.createElement('section');
  const assistantThread=document.createElement('section');assistantThread.className='assistant-thread';assistantThread.hidden=true;
  const unsubscribeActivity=window.desktop?.onTaskActivity?.(event=>{
    if(event.kind==='reasoning')return;
    if(event.kind==='reasoning_summary')event={...event,kind:'reasoning'};
    const selector=`[data-answer-for="${CSS.escape(event.taskId)}"]`;
    const task=current.tasks.find(item=>item.taskId===event.taskId);
    const slots=[...conversation.querySelectorAll(selector),...assistantThread.querySelectorAll(selector)];
    if(task?.bodyWithheld||task?.outputTruncated||!task&&!slots.length)return;
    const live=rememberActivity(liveTurns,event);
    for(const slot of slots)replaceAnswerCard(slot,task??{taskId:event.taskId},live,escape);
  });
  window.addEventListener('unload',()=>unsubscribeActivity?.(),{once:true});
  conversation.after(assistantRoster);stage.append(assistantThread);
  conversation.addEventListener?.('toggle',()=>syncContainerAnswerDisclosures(conversation,liveTurns),true);
  assistantThread.addEventListener?.('toggle',()=>syncContainerAnswerDisclosures(assistantThread,liveTurns),true);
  const showAssistant=async assistantId=>{
    const thread=await invoke('assistant.thread',{assistantId});
    await invoke('assistant.read',{assistantId}).catch(()=>{});
    conversation.hidden=true;assistantThread.hidden=false;
    for(const item of [...(thread.turns??[]),...(thread.dispatched?[thread.dispatched]:[])]){
      if(item?.taskId&&item.transcript&&!liveTurns.has(item.taskId))liveTurns.set(item.taskId,publicLiveTranscript(item.transcript));
    }
    const turns=(thread.turns??[]).map(turn=>`<article class="assistant-turn"><div class="user-message">${escape(turn.userText||turn.goal||'')}</div>${answerCardHtml({...turn,resultSummary:turn.replyText}, liveTurns.get(turn.taskId)??publicLiveTranscript(turn.transcript), escape)}</article>`).join('');
    const dispatched=thread.dispatched?`<article class="assistant-turn"><div class="user-message">${escape(thread.dispatched.goal||'')}</div>${answerCardHtml({...thread.dispatched,resultSummary:thread.dispatched.replyText}, liveTurns.get(thread.dispatched.taskId)??publicLiveTranscript(thread.dispatched.transcript), escape)}</article>`:'';
    assistantThread.innerHTML=`<header><strong>${escape(thread.assistant.displayName)}</strong><span>${escape(thread.assistant.instructions||'')}</span>${assistantThreadActionsHtml(thread.assistant)}<button type="button" data-assistant-back>返回</button><button type="button" data-assistant-stop ${thread.assistant.activeTaskId?'':'disabled'}>停止</button></header><div>${dispatched}${turns}</div><form data-assistant-compose><textarea aria-label="给这个助手发消息" placeholder="直接和这个助手聊天，运行中发送就是插话"></textarea><button type="submit">发送</button></form>`;
    assistantThread.querySelector('[data-assistant-back]').onclick=()=>{assistantThread.hidden=true;conversation.hidden=false;};
    assistantThread.querySelector('[data-assistant-stop]').onclick=()=>{if(thread.assistant.activeTaskId)invoke('task.cancel',thread.assistant.activeTaskId).catch(report);};
    bindAssistantThreadActions(assistantThread, thread.assistant, {invoke, escape, report, onChanged:()=>showAssistant(assistantId), onDeleted:()=>{assistantThread.hidden=true;conversation.hidden=false;}});
    const composeForm=assistantThread.querySelector('[data-assistant-compose]');
    assistantThread.querySelector('textarea')?.addEventListener?.('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();composeForm?.requestSubmit?.();}});
    composeForm.onsubmit=async event=>{
      event.preventDefault();
      const input=assistantThread.querySelector('textarea'),submit=assistantThread.querySelector('button[type="submit"]');
      const text=input.value.trim();
      if(!text||submit?.disabled)return;
      if(submit)submit.disabled=true;
      try{await invoke('assistant.submit',{assistantId,text,requestId:crypto.randomUUID()});input.value='';await showAssistant(assistantId);}
      catch(error){report(error);}
      finally{if(submit)submit.disabled=false;}
    };
  };
  roster=mountAssistantRoster(assistantRoster,{invoke,escape,report,onOpen:id=>showAssistant(id).catch(report)});
  window.desktop?.onOpenAssistant?.(value=>{if(value?.assistantId)showAssistant(value.assistantId).catch(report);});
  const updateProgress=mountTaskProgress(root.querySelector('.workspace-chat'),stage,taskId=>invoke('computer.control.confirm',{taskId}));
  const updateRepair=mountFailureRepairCard(root.querySelector('.workspace-chat'),stage,invoke);
  const briefingPanel=mountBriefingPanel(stage,invoke);
  const proactiveControls=mountProactiveControls(stage,invoke);
  const proactiveWorkflowControls=mountProactiveWorkflowControls(stage,invoke);
  const preferences=document.createElement('div');preferences.className='conversation-preferences';
  root.querySelector('.workspace-top').after(preferences);
  const updateRail=mountConversationRail(root.querySelector('.workspace-chat'),stage);
  const orbButton=root.querySelector('#workspace-orb');
  const orb=new Orb(orbButton.querySelector('canvas'),{variant:orbVariantPreference(),layout:'shell',count:520,luminous:true});
  orb.setBreathing({min:.52,max:.76,rate:.7});
  const syncMotion=()=>{const variant=typeof orbVariantPreference==='function'?orbVariantPreference():(document.documentElement?.dataset?.orbVariant||'matrix');const override=typeof orbStateOverride==='function'?orbStateOverride():((document.documentElement?.dataset?.orbStateOverride&&document.documentElement.dataset.orbStateOverride!=='auto')?document.documentElement.dataset.orbStateOverride:null);orb.setVariant?.(variant);if(override){orb.setState(override);if(override==='listening')orb.setLevel(Math.max((typeof current!=='undefined'?current?.audioLevel:0)??0,0.68));}else if(typeof current!=='undefined'&&current&&(current.tasks?.length||current.live))orb.setState(visualOrbState(current));if(document.hidden)orb.stop();else orb.setCalm(document.documentElement.dataset.calm==='true');};syncMotion();window.addEventListener('preferences-changed',syncMotion);
  const visibility=()=>{if(document.hidden)orb.stop();else syncMotion();};document.addEventListener('visibilitychange',visibility);
  let activationTimer;
  window.addEventListener('unload',()=>{clearTimeout(activationTimer);orb.dispose();window.removeEventListener('preferences-changed',syncMotion);document.removeEventListener('visibilitychange',visibility);});
  orbButton.onclick=()=>{
    clearTimeout(activationTimer);orbButton.setAttribute('aria-pressed','true');orb.playBreath(3.2);
    activationTimer=setTimeout(()=>{activationTimer=0;orbButton.setAttribute('aria-pressed','false');},3200);
  };
  const composer=mountWorkspaceComposer(root.querySelector('.workspace-chat'),invoke,report);
  const draftInput=composer.input;
  const sessionRoot=document.createElement('div');sessionRoot.className='conversation-session-root';root.querySelector('.workspace-chat').prepend(sessionRoot);const sessionControls=mountSessionControls(sessionRoot,draftInput,invoke,report,{flushBeforeClose});
  const nativeReasoning=mountModelThinkingPicker(preferences,invoke,report,{readFeedbackRevision:()=>feedbackRevision,clearFeedback:()=>report('')});
  composer.beforeSubmit=async()=>{await nativeReasoning.flush();return sessionControls.flush();};
  composer.onAccepted=token=>sessionControls.submitted(token);
  const center=mountCommandCenter(root,{sessionRoot,preferences,input:draftInput,invoke,report,escape});
  const goalControl=createGoalControl(invoke,()=>draftInput.value);
  goalControl.button.className='cc-goals';
  root.querySelector('.cc-chat-heading')?.append(goalControl.button);
  root.querySelector('.workspace')?.append(goalControl.dialog);
  const runtimeControls=mountWorkspaceRuntimeControls(root,invoke,report);
  const workspaceApprovals=mountWorkspaceApprovals(conversation,invoke,report,()=>feedbackRevision);
  window.addEventListener('pagehide',()=>nativeReasoning.dispose(),{once:true});
  syncAuxiliaryPanels();
  const syncCancelButtons=()=>conversation.querySelectorAll('[data-cancel],[data-reconcile]').forEach(button=>{button.disabled=Boolean(button.dataset.reconcile&&current.tasks.find(task=>task.taskId===button.dataset.reconcile)?.reconciliationStatus?.blockedReason)||pendingCancelIds.has(button.dataset.cancel??button.dataset.reconcile)||current.tasks.some(task=>task.taskId===(button.dataset.cancel??button.dataset.reconcile)&&task.state==='cancelling');});
  const restoreTaskActionFocus=focused=>{
    if(!focused||focused.disabled||document.activeElement!==document.body)return;
    const step=focused.parentElement?.dataset.delegationStep;
    if(step){
      const entry=[...conversation.querySelectorAll('details[data-delegation-step]')].find(item=>item.dataset.delegationStep===step);
      entry?.querySelector('summary')?.focus({preventScroll:true});
      return;
    }
    const action=['view','copy','cancel','reconcile','delegatedChild'].find(key=>focused.dataset[key]);if(!action)return;
    const button=[...conversation.querySelectorAll('button')].find(item=>item.dataset[action]===focused.dataset[action]
      &&item.dataset.parentTask===focused.dataset.parentTask);
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
        const readRevision = updateRevision;
        const data = await invoke('snapshot');
        if (readRevision === updateRevision) update(data);
      } catch (error) {
        submit.disabled = false;
        status.textContent = String(error?.message ?? '城市无效或天气服务不可用');
      }
    };
    root.appendChild(overlay);
    overlay.querySelector('input').focus();
  };
  root.querySelector('#connector-cards').onclick=event=>{
    if(event.target.closest('[data-weather-city]')){event.preventDefault();askWeatherCity();return;}
    if(event.target.closest('.notification-card')){invoke('admin.open',{page:'notifications'}).catch(report);return;}
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
  const projectLocateFeedback=()=>{
    for(const button of conversation.querySelectorAll('[data-locate-id]')) {
      const request=locateFeedback.get(button.dataset.locateId);
      const resultNode=button.closest('.locate-block')?.querySelector('.locate-result');
      if(!resultNode)continue;
      if(!request||request.text!==button.dataset.locateText){resultNode.hidden=true;resultNode.textContent='';continue;}
      resultNode.hidden=false;
      if(request.html!==undefined)resultNode.innerHTML=request.html;else resultNode.textContent=request.message;
    }
  };
  const locateFailure=async button=>{
    const id=button.dataset.locateId,text=button.dataset.locateText||'';
    const task=current?.tasks.find(item=>item.taskId===id);
    if(!task||!text)return;
    const request={text,taskState:task.state,message:'定位中…'};
    locateFeedback.set(id,request);projectLocateFeedback();
    try {
      const response=await invoke('task.locate',{text});
      if(locateFeedback.get(id)!==request)return;
      const reportData=response&&typeof response==='object'&&'failures' in response?response:null;
      const failures=reportData&&Array.isArray(reportData.failures)?reportData.failures:[];
      if(!failures.length)request.message='未能从错误输出定位到源码位置';
      else request.html=failures.slice(0,3).map(f=>{
        const top=f.frames&&f.frames[0];
        const head=`<div class="locate-head">${escape(f.name)}${f.timedOut?'（超时）':''}</div>`;
        const frames=top?`<div class="locate-frame">${escape(top.file)}:${top.line}${top.column?':'+top.column:''}<span class="locate-conf">置信度 ${(top.confidence*100).toFixed(0)}%</span></div>${top.snippet?`<pre class="locate-snippet">${escape(top.snippet)}</pre>`:''}`:'';
        return head+frames;
      }).join('');
    } catch(err) {
      if(locateFeedback.get(id)!==request)return;
      request.message='定位失败：'+(err&&err.message?err.message:'未知错误');
    }
    projectLocateFeedback();
  };
  conversation.onclick=async event=>{
    const childLink=event.target.closest('[data-delegated-child]');
    if(childLink){
      const child=current.subagentTasks?.find(item=>item.taskId===childLink.dataset.delegatedChild
        &&item.parentTaskId===childLink.dataset.parentTask);
      if(child)center.openChild({taskId:child.taskId,parentTaskId:child.parentTaskId});
      return;
    }
    const button=event.target.closest('[data-cancel],[data-reconcile],[data-view],[data-copy],[data-locate-id]');if(!button)return;
    if(button.dataset.locateId){await locateFailure(button);return;}
    try{if(button.dataset.view){inspected=button.dataset.view;renderInspector();if(!liveTurns.has(inspected)&&!current.fake){invoke('task.transcript',{taskId:inspected}).then(transcript=>{if(transcript?.segments?.length){const existing=liveTurns.get(inspected);const merged=publicLiveTranscript(transcript);if(existing?.openDisclosures)merged.openDisclosures=existing.openDisclosures;liveTurns.set(inspected,merged);const slot=conversation.querySelector(`[data-answer-for="${inspected}"]`),task=current.tasks.find(item=>item.taskId===inspected);if(slot&&task)replaceAnswerCard(slot,task,merged,escape);if(inspected)renderInspector();}}).catch(()=>{});}}else if(button.dataset.copy){await invoke('clipboard.writeText',resultText(current.tasks.find(task=>task.taskId===button.dataset.copy)?.resultSummary,current.tasks.find(task=>task.taskId===button.dataset.copy)?.resultMetadata));button.title='已复制';}else{const id=button.dataset.cancel??button.dataset.reconcile;if(button.disabled||pendingCancelIds.has(id))return;pendingCancelIds.add(id);syncCancelButtons();try{await invoke(button.dataset.reconcile?'task.reconcile.finish':'task.cancel',id);}finally{pendingCancelIds.delete(id);syncCancelButtons();}}}catch(error){report(error);syncCancelButtons();}
  };
  function renderInspector(){
    const task=current.tasks.find(item=>item.taskId===inspected);
    if(!task){inspected=null;syncAuxiliaryPanels();return;}
    root.querySelector('#conversation-inspector').dataset.taskId=task.taskId;
    syncAuxiliaryPanels();
    root.querySelector('#inspector-content').innerHTML=`<h3>你的消息</h3><p>${escape(task.userMessage||'历史对话')}</p><h3>回答与执行过程</h3>${answerCardHtml(task,liveTurns.get(task.taskId),escape)}<p>${escape(resultText(task.resultSummary,task.resultMetadata)||task.error?.message||stateNames[task.state])}</p>${task.resultMetadata?`<h3>模型与验证</h3><p>${escape(task.resultMetadata.profile)} · ${escape(task.resultMetadata.verification)}</p>`:'' }<h3>执行状态</h3><p>${escape(stateNames[task.state]||task.state)}</p>${(task.steps||[]).map(step=>`<p class="inspector-step">${escape(step.label)} · ${escape(step.state)}</p>`).join('')}`;
  }
  let brakePending=false;
  function update(data){
    updateRevision++;
    const sessionChanged=current?.conversationState?.activeId!==data.conversationState?.activeId;if(sessionChanged){inspected=null;syncAuxiliaryPanels(false);}
    current=data;current.tasks ||= [];
    paintAssistants(data);
    for(const task of data.tasks)if(task.bodyWithheld||task.outputTruncated)liveTurns.delete(task.taskId);
    sessionControls.update(data);nativeReasoning.update(data);
    orb.setVariant?.(typeof orbVariantPreference==='function'?orbVariantPreference():(document.documentElement?.dataset?.orbVariant||'matrix'));
    orb.setLevel((typeof orbStateOverride==='function'?orbStateOverride():null)==='listening'?Math.max(data.audioLevel??0,0.68):(data.audioLevel??0));
    orb.setState((typeof orbStateOverride==='function'?orbStateOverride():null)??visualOrbState(data));
    if(document.hidden)orb.stop();
    composer.update(data);
    let brakeStatus=root.querySelector('#operator-brake-status');
    let brakeButton=root.querySelector('#workspace-operator-brake');
    if(!brakeStatus){brakeStatus=document.createElement('p');brakeStatus.id='operator-brake-status';brakeStatus.className='notice';brakeStatus.hidden=true;root.querySelector('.workspace-top')?.after(brakeStatus);}
    if(!brakeButton&&root.querySelector('.cc-chat-heading')){
      brakeButton=document.createElement('button');brakeButton.id='workspace-operator-brake';brakeButton.type='button';brakeButton.className='operator-brake';
      brakeButton.onclick=()=>{if(brakePending||!window.desktop?.setOperatorBrake)return;brakePending=true;brakeButton.disabled=true;window.desktop.setOperatorBrake(current?.operatorBrake?.paused!==true).then(res=>{if(!res?.ok)report(res?.error||'总暂停切换未确认');},report).finally(()=>{brakePending=false;brakeButton.disabled=false;});};
      root.querySelector('.cc-chat-heading').append(brakeButton);
    }
    applyOperatorBrake({button:brakeButton,status:brakeStatus,snapshot:data.operatorBrake});
    updateProgress(data.tasks,data.computerControl,
      {questions:data.authorizationQuestions,conversationId:data.conversationState?.activeId});
    updateRepair(data.tasks.filter(task=>!task.outputTruncated));
    briefingPanel.render(data.dailyBriefing,{open:data.briefingOpen===true});
    proactiveControls.render(data.proactive);
    proactiveWorkflowControls.render(data.proactiveWorkflow);
    root.querySelector('#workspace-greeting').hidden=current.tasks.length>0;root.querySelector('#workspace-intro').hidden=current.tasks.length>0;root.querySelector('#workspace-welcome').classList.toggle('compact',current.tasks.length>0);
    const childrenByParent=new Map();
    for(const child of data.subagentTasks??[]){
      if(!childrenByParent.has(child.parentTaskId))childrenByParent.set(child.parentTaskId,[]);
      childrenByParent.get(child.parentTaskId).push(child);
    }
    const signature=JSON.stringify([data.tasks,data.subagentTasks]);
    if(signature!==lastSignature){
      const focused=conversation.contains(document.activeElement)?document.activeElement:null;
      const atBottom=stage.scrollHeight-stage.scrollTop-stage.clientHeight<90;lastSignature=signature;
      syncContainerAnswerDisclosures(conversation,liveTurns);
      const openSteps=new Set([...conversation.querySelectorAll('details[data-delegation-step][open]')].map(item=>item.dataset.delegationStep));
      updateConversationTurns(conversation,data.tasks.map(task=>{
        const children=childrenByParent.get(task.taskId)??[];
        const childCards=children.map(child=>delegationCard(child,openSteps,escape)).join('');
        const failure=task.outputTruncated?undefined:task.error?.message;
        const answer=resultText(task.resultSummary,task.resultMetadata);
        const activity=!childCards&&!isTerminal(task)&&!task.outputTruncated
          ?`<p class="notice">${escape(task.steps?.at(-1)?.label??stateNames[task.state])}</p>`:'';
        const locateHtml=!childCards&&failure&&!answer?`<div class="locate-block" data-locate-for="${escape(task.taskId)}"><button type="button" class="turn-action" data-locate-id="${escape(task.taskId)}" data-locate-text="${escape(failure)}" aria-label="定位失败原因">定位失败原因</button><div class="locate-result" hidden></div></div>`:'';
        return `<article class="workspace-turn" data-turn="${escape(task.taskId)}"><div class="user-message">${escape(task.userMessage||'历史对话')}</div>${activity}${childCards||answerCardHtml({...task,resultSummary:answer},liveTurns.get(task.taskId),escape)}${locateHtml}<div class="response-actions">${!childCards?`<button type="button" data-view="${escape(task.taskId)}" title="在对话内查看" aria-label="查看这轮对话">${icon('view')}</button>${task.resultSummary?`<button type="button" data-copy="${escape(task.taskId)}" title="复制回答" aria-label="复制回答">${icon('copy')}</button>`:''}`:''}${task.state==='waiting_reconciliation'?`<p class="notice">${escape(task.reconciliationStatus?.blockedReason??task.reconciliationStatus?.notice??(task.reconciliationStatus?.actionLabel?'仅检查原任务已有回执，不会重新执行原操作；能否结束以检查结果为准。':'当前没有该操作的自动核查入口。'))}</p>${task.reconciliationStatus?.actionLabel?`<button type="button" class="turn-action" data-reconcile="${escape(task.taskId)}">${escape(task.reconciliationStatus.actionLabel)}</button>`:''}`:''}${!isTerminal(task)?`<button class="turn-action" data-cancel="${escape(task.taskId)}" ${task.state==='cancelling'?'disabled':''}>${task.state==='cancelling'?'正在停止':'停止'}</button>`:''}</div></article>`;
      }).join(''),{tasks:data.tasks,pendingCancelIds,cancelSelector:'[data-cancel]',cancelAttribute:'cancel'});
      projectLocateFeedback();syncCancelButtons();restoreTaskActionFocus(focused);
      requestAnimationFrame(()=>{if(atBottom)stage.scrollTop=stage.scrollHeight;updateRail();});if(inspected)renderInspector();
    }
    for(const turn of conversation.querySelectorAll('[data-turn]')){if(!turn.querySelector('[data-workspace-approvals]')){const slot=document.createElement('div');slot.dataset.workspaceApprovals=turn.dataset.turn;turn.querySelector('.response-actions').before(slot);}}
    workspaceApprovals.update(data);center.update(data);runtimeControls.update(data);
    const nextCards=JSON.stringify([data.capabilities,data.health,data.notifications,data.todo,data.feeds,data.mail,data.knowledge,data.weather]);if(cardsSignature!==nextCards){cardsSignature=nextCards;root.querySelector('#connector-cards').innerHTML=connectorCards(data,escape);}
  }
  update.setAudioLevel=level=>orb.setLevel(level);
  update.setResourceBudget=budget=>orb.setResourceBudget(budget);
  return update;
}
