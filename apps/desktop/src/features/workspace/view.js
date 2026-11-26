import {errorDisplayText} from '../../shared/error-display.js';
import {mountSessionControls} from '../conversation/session-controls.js';
import {conflictDecisionMarkup,conflictDecisionPayload} from '../conversation/conflict-decision.js';
import {mountModelThinkingPicker} from '../conversation/model-thinking-picker.js';
import {DISPATCH_ACK, answerCardHtml, assistantStatusLabel, assistantVisualSpec, createDelegatedDeliveryTracker, delegatedDeliveryHtml, liveFromTranscript, rememberActivity, replaceAnswerCard, replaceTraceBlock, stripProfileMetadata, syncContainerAnswerDisclosures, syncTraceDisclosures, traceBlockHtml} from '../conversation/answer-block.js';
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
import {resultText,mainChatReplies} from '../conversation/result-text.js';
import {conversationTimeline} from '../conversation/timeline.js';
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
function publicLiveTranscript(transcript){
  const segments=(transcript?.segments??[])
    .map(segment=>segment.kind==='reasoning_summary'?{...segment,kind:'reasoning'}:segment);
  return liveFromTranscript({segments});
}

const WORKER_ROLE_LABELS={researcher:'资料工人',coder:'编码工人',reviewer:'审查工人',planner:'规划工人',coordinator:'协作工人'};
const WORKER_STATE_LABELS={created:'排队中',planning:'规划中',running:'执行中',verifying:'核验中',waiting_approval:'待确认',waiting_reconciliation:'待核实',succeeded:'已完成',failed:'失败',cancelled:'已取消'};
function formatAssistantUserMessage(raw,escape){
  const text=String(raw||'').trim();
  const handoff=/^来自(主对话|[^：:\n]{1,24})[：:]\s*([\s\S]+)$/.exec(text);
  if(handoff){
    const badge=handoff[1]==='主对话'?'主对话转交':`来自 ${handoff[1]}`;
    return `<div class="user-message is-handoff"><span class="assistant-turn-source">${escape(badge)}</span><span class="assistant-turn-text">${escape(handoff[2].trim())}</span></div>`;
  }
  return `<div class="user-message"><span class="assistant-turn-text">${escape(text)}</span></div>`;
}
function workerBadgeKind(state){
  if(['running','planning','verifying','created'].includes(state))return 'running';
  if(state==='succeeded')return 'done';
  if(state==='waiting_approval'||state==='waiting_reconciliation')return 'waiting';
  if(state==='failed'||state==='cancelled')return 'failed';
  return 'idle';
}

export function mountWorkspace(root,invoke,escape,{flushBeforeClose}={}){
  const liveTurns=new Map();
  const delegatedTracker=createDelegatedDeliveryTracker();
  const locateFeedback=new Map();
  const pruneMap=(map,limit=40)=>{
    if(map.size<=limit)return;
    for(const key of map.keys()){
      if(map.size<=limit)break;
      if(key!==inspected)map.delete(key);
    }
  };
  let roster,rosterSignature,selectedAssistant;
  const paintAssistants=data=>{
    const signature=JSON.stringify([data.assistants,data.agentArtsModels?.catalog?.revision]);
    if(signature===rosterSignature)return;
    rosterSignature=signature;
    roster?.paint(data.assistants,data);
    if(selectedAssistant)assistantRoster.querySelector(`[data-assistant-id="${CSS.escape(selectedAssistant)}"]`)?.setAttribute('aria-current','true');
  };
  let current={tasks:[]},lastSignature='',cardsSignature='',inspected=null;
  let updateRevision=0;
  let connectorsRequested=true;
  const pendingCancelIds=new Set();
  root.innerHTML=`<section class="workspace focused-workspace">
    <header class="workspace-titlebar"><span class="workspace-app-title">Synstar</span><span class="spacer"></span>${windowControlsHtml('workspace')}</header>
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
    if(!event||typeof event.taskId!=='string')return;
    if(event.kind==='reasoning_summary')event={...event,kind:'reasoning'};
    const task=current.tasks.find(item=>item.taskId===event.taskId);
    const assistantSlot=assistantThread.querySelector(`[data-answer-for="${CSS.escape(event.taskId)}"]`);
    if(task?.bodyWithheld||task?.outputTruncated||!task&&!assistantSlot)return;
    const live=rememberActivity(liveTurns,event);
    pruneMap(liveTurns);
    if(assistantSlot)replaceAnswerCard(assistantSlot,task??{taskId:event.taskId},live,escape);
    if(task){
      const children=current.subagentTasks?.filter(child=>child.parentTaskId===task.taskId)??[];
      const traceSlot=conversation.querySelector(`[data-trace-for="${CSS.escape(task.taskId)}"]`);
      if(traceSlot)replaceTraceBlock(traceSlot,task,live,children,escape);
      if(event.kind==='answer_delta'&&!isTerminal(task)){
        const bubble=conversation.querySelector(`[data-streaming-reply="${CSS.escape(task.taskId)}"]`);
        if(bubble){bubble.textContent=live.answer;bubble.classList.remove('cc-typing','cc-dispatch-ack');}
      }
    }
  });
  conversation.addEventListener?.('toggle',()=>syncTraceDisclosures(conversation,liveTurns),true);
  window.addEventListener('pagehide',()=>unsubscribeActivity?.(),{once:true});
  stage.append(assistantThread);
  let assistantRequest=0;
  function browserThread(assistantId,force=false) {
    const shell=root.querySelector('.workspace');
    if(!shell?.dataset || (!force&&shell.dataset.browserAssistantId===assistantId))return;
    if(assistantId)shell.dataset.browserAssistantId=assistantId;else delete shell.dataset.browserAssistantId;
    shell.dispatchEvent(new Event('browser-thread-changed'));
  }
  function returnToMain(){
    assistantRequest++;selectedAssistant=undefined;assistantThread.hidden=true;conversation.hidden=false;
    browserThread(undefined);
    root.querySelector('.workspace-chat').classList.remove('cc-showing-assistant');
    for(const button of assistantRoster.querySelectorAll('[aria-current]'))button.removeAttribute('aria-current');
  }
  assistantThread.addEventListener?.('toggle',()=>syncContainerAnswerDisclosures(assistantThread,liveTurns),true);
  const showAssistant=async assistantId=>{
    center.main();
    const request=++assistantRequest;
    const thread=await invoke('assistant.thread',{assistantId});
    if(request!==assistantRequest)return;
    await invoke('assistant.read',{assistantId}).catch(()=>{});
    if(request!==assistantRequest)return;
    selectedAssistant=assistantId;
    browserThread(assistantId);
    root.querySelector('.workspace-chat').classList.add('cc-showing-assistant');
    assistantRoster.querySelector(`[data-assistant-id="${CSS.escape(assistantId)}"]`)?.setAttribute('aria-current','true');
    conversation.hidden=true;assistantThread.hidden=false;
    for(const item of [...(thread.turns??[]),...(thread.dispatched?[thread.dispatched]:[])]){
      if(item?.taskId&&item.transcript&&!liveTurns.has(item.taskId))liveTurns.set(item.taskId,publicLiveTranscript(item.transcript));
    }
    const liveWorkers=await invoke('workers.list',{assistantId}).catch(()=>({workers:thread.workers??[]}));
    const workerItems=liveWorkers.workers??thread.workers??[];
    const activeWorkerCount=workerItems.filter(w=>!['succeeded','failed','cancelled'].includes(w.state)).length;
    const workers=workerItems.map(worker=>{
      const roleTitle=WORKER_ROLE_LABELS[worker.role]||worker.role||'工人';
      const stateTitle=WORKER_STATE_LABELS[worker.state]||worker.state||'';
      const kind=workerBadgeKind(worker.state);
      const summary=stripProfileMetadata(worker.resultSummary||'')||'听从当前助手调度执行';
      return `<li class="assistant-worker-card" data-worker-state="${escape(kind)}" data-worker-task="${escape(worker.taskId||'')}" data-worker-role="${escape(worker.role||'')}"><div class="assistant-worker-top"><strong>${escape(roleTitle)}</strong><span class="assistant-worker-badge" data-kind="${escape(kind)}">${escape(stateTitle)}</span>${!['succeeded','failed','cancelled'].includes(worker.state)?`<button type="button" class="assistant-worker-btn" data-worker-instruct>插话</button>`:''}</div><p class="assistant-worker-summary">${escape(summary)}</p></li>`;
    }).join('');
    const turns=(thread.turns??[]).map(turn=>`<article class="assistant-turn">${formatAssistantUserMessage(turn.userText||turn.goal||'',escape)}${answerCardHtml({...turn,resultSummary:turn.replyText}, liveTurns.get(turn.taskId)??publicLiveTranscript(turn.transcript), escape)}</article>`).join('');
    const dispatched=thread.dispatched?`<article class="assistant-turn">${formatAssistantUserMessage(thread.dispatched.goal||'',escape)}${answerCardHtml({...thread.dispatched,resultSummary:thread.dispatched.replyText}, liveTurns.get(thread.dispatched.taskId)??publicLiveTranscript(thread.dispatched.transcript), escape)}</article>`:'';
    const assistantStatus=thread.assistant.status||'idle';
    const avatarSpec=assistantVisualSpec(thread.assistant);
    const workerSummaryText=workerItems.length?`${workerItems.length} 名工人${activeWorkerCount?` · ${activeWorkerCount} 运行中`:''}`:'暂无工人';
    const workersOpen=activeWorkerCount>0||(workerItems.length>0&&workerItems.length<=3)?' open':'';
    const turnsHtml=(dispatched||turns)
      ?`${dispatched}${turns}`
      :`<div class="assistant-empty"><strong>开始和「${escape(thread.assistant.displayName)}」对话</strong><p>你可以直接在这里发消息，它会自动复用或新建自己的工人来干活。</p></div>`;
    assistantThread.innerHTML=`<header class="assistant-thread-head"><div class="assistant-thread-identity"><span class="assistant-thread-avatar" data-status="${escape(assistantStatus)}" data-tone="${avatarSpec.tone}" aria-hidden="true">${avatarSpec.svg}</span><div class="assistant-thread-meta"><div class="assistant-thread-title-row"><strong>${escape(thread.assistant.displayName)}</strong><span class="assistant-status-pill" data-status="${escape(assistantStatus)}">${escape(assistantStatusLabel(assistantStatus))}</span></div><span class="assistant-thread-desc">${escape(thread.assistant.instructions||'只和你、主对话交流，重活交给自己的工人')}</span></div></div><div class="assistant-thread-actions">${assistantThreadActionsHtml(thread.assistant)}<button type="button" class="assistant-action-btn is-stop" data-assistant-stop ${thread.assistant.activeTaskId?'':'disabled'}>停止</button><button type="button" class="assistant-action-btn is-back" data-assistant-back>返回主对话</button></div></header><details class="assistant-workers"${workersOpen}><summary class="assistant-workers-head"><h3>这个助手的工人</h3><span class="assistant-workers-count">${escape(workerSummaryText)}</span><span class="trace-chevron" aria-hidden="true"></span></summary><div class="assistant-workers-body"><p class="assistant-workers-hint">可插话复用已有工人；没有合适工人时助手会自动用 subagent.dispatch 新建。</p>${workers?`<ul class="assistant-worker-list">${workers}</ul>`:'<p class="assistant-workers-empty">还没有派过工人。直接给这个助手下达任务，它会按需创建并管理工人。</p>'}</div></details><div class="assistant-thread-turns">${turnsHtml}</div><form class="assistant-compose" data-assistant-compose><textarea rows="2" aria-label="给这个助手发消息" placeholder="和「${escape(thread.assistant.displayName)}」说话…（Enter 发送，Shift+Enter 换行）"></textarea><button type="submit" class="assistant-send-btn" aria-label="发送" title="发送"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg></button></form>`;
    const turnsBox=assistantThread.querySelector('.assistant-thread-turns');
    if(turnsBox)turnsBox.scrollTop=turnsBox.scrollHeight;
    for(const button of assistantThread.querySelectorAll('[data-worker-instruct]')){
      button.onclick=async()=>{
        const row=button.closest('li');
        const text=window.prompt('给这个工人插话');
        if(!text?.trim())return;
        const assistantTaskId=thread.assistant.activeTaskId||thread.turns?.at(-1)?.taskId;
        if(!assistantTaskId){report(Error('当前没有可代表这个助手下指令的进行中任务'));return;}
        button.disabled=true;
        try{
          const result=await invoke('workers.instruct',{
            assistantTaskId,text:text.trim(),
            ...(row?.dataset.workerTask?{workerTaskId:row.dataset.workerTask}:{}),
            ...(row?.dataset.workerRole?{role:row.dataset.workerRole}:{}),
          });
          if(result?.action==='needs_dispatch')report(Error(result.reason||'需要新建工人'));
          if(request===assistantRequest)await showAssistant(assistantId);
        }catch(error){report(error);}
        finally{button.disabled=false;}
      };
    }
    assistantThread.querySelector('[data-assistant-back]').onclick=()=>center.main();
    assistantThread.querySelector('[data-assistant-stop]').onclick=()=>{if(thread.assistant.activeTaskId)invoke('task.cancel',thread.assistant.activeTaskId).catch(report);};
    bindAssistantThreadActions(assistantThread, thread.assistant, {invoke, escape, report, onChanged:()=>showAssistant(assistantId), onDeleted:()=>center.main()});
    const composeForm=assistantThread.querySelector('[data-assistant-compose]');
    assistantThread.querySelector('textarea')?.addEventListener?.('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();composeForm?.requestSubmit?.();}});
    composeForm.onsubmit=async event=>{
      event.preventDefault();
      const input=assistantThread.querySelector('textarea'),submit=assistantThread.querySelector('button[type="submit"]');
      const text=input.value.trim();
      if(!text||submit?.disabled)return;
      if(submit)submit.disabled=true;
      try{await invoke('assistant.submit',{assistantId,text,requestId:crypto.randomUUID()});input.value='';if(request===assistantRequest)await showAssistant(assistantId);}
      catch(error){report(error);}
      finally{if(submit)submit.disabled=false;}
    };
  };
  roster=mountAssistantRoster(assistantRoster,{invoke,escape,report,onOpen:id=>showAssistant(id).catch(report)});
  window.desktop?.onOpenAssistant?.(value=>{if(value?.assistantId)showAssistant(value.assistantId).catch(report);});
  const updateProgress=mountTaskProgress(root.querySelector('.workspace-chat'),stage,taskId=>invoke('computer.control.confirm',{taskId}));
  const updateRepair=mountFailureRepairCard(root.querySelector('#conversation-inspector'),root.querySelector('#inspector-content'),invoke);
  const briefingPanel=mountBriefingPanel(stage,invoke);
  const proactiveControls=mountProactiveControls(stage,invoke);
  const proactiveWorkflowControls=mountProactiveWorkflowControls(stage,invoke);
  const preferences=document.createElement('div');preferences.className='conversation-preferences';
  root.querySelector('.workspace-top').after(preferences);
  const updateRail=mountConversationRail(root.querySelector('.workspace-chat'),stage);
  const orbButton=root.querySelector('#workspace-orb');
  const orb=new Orb(orbButton.querySelector('canvas'),{variant:orbVariantPreference(),layout:'shell',count:340,luminous:true});
  orb.setBreathing({min:.52,max:.76,rate:.7});
  const syncMotion=()=>{const variant=typeof orbVariantPreference==='function'?orbVariantPreference():(document.documentElement?.dataset?.orbVariant||'matrix');const override=typeof orbStateOverride==='function'?orbStateOverride():((document.documentElement?.dataset?.orbStateOverride&&document.documentElement.dataset.orbStateOverride!=='auto')?document.documentElement.dataset.orbStateOverride:null);orb.setVariant?.(variant);if(override){orb.setState(override);if(override==='listening')orb.setLevel(Math.max((typeof current!=='undefined'?current?.audioLevel:0)??0,0.68));}else if(typeof current!=='undefined'&&current&&(current.tasks?.length||current.live))orb.setState(visualOrbState(current));if(document.hidden)orb.stop();else orb.setCalm(document.documentElement.dataset.calm==='true');};syncMotion();window.addEventListener('preferences-changed',syncMotion);
  const visibility=()=>{if(document.hidden)orb.stop();else syncMotion();};document.addEventListener('visibilitychange',visibility);
  let activationTimer;
  window.addEventListener('unload',()=>{clearTimeout(activationTimer);orb.dispose();window.removeEventListener('preferences-changed',syncMotion);document.removeEventListener('visibilitychange',visibility);});
  orbButton.onclick=()=>{
    clearTimeout(activationTimer);orbButton.setAttribute('aria-pressed','true');orb.playBreath(3.2);
    activationTimer=setTimeout(()=>{activationTimer=0;orbButton.setAttribute('aria-pressed','false');},3200);
  };
  let heroIntersecting=true;
  const heroObserver=typeof IntersectionObserver==='function'
    ? new IntersectionObserver(entries=>{
      const visible=entries.some(entry=>entry.isIntersecting);
      if(visible===heroIntersecting)return;
      heroIntersecting=visible;
      if(!visible)orb.stop();
      else if(!document.hidden)syncMotion();
    },{threshold:0.01})
    : undefined;
  heroObserver?.observe(orbButton);
  window.addEventListener('pagehide',()=>heroObserver?.disconnect(),{once:true});
  const composer=mountWorkspaceComposer(root.querySelector('.workspace-chat'),invoke,report);
  const draftInput=composer.input;
  const prohibitionsRoot=document.createElement('aside');prohibitionsRoot.setAttribute('aria-label','本对话禁止项');
  const sessionRoot=document.createElement('div');sessionRoot.className='conversation-session-root';root.querySelector('.workspace-chat').prepend(sessionRoot);const sessionControls=mountSessionControls(sessionRoot,draftInput,invoke,report,{flushBeforeClose,prohibitionsRoot});
  const unsubscribeDictation=window.desktop?.onDictation?.(result=>{
    if(result?.conversationId)void sessionControls.appendDictation(result).catch(report);
  });
  window.addEventListener('pagehide',()=>unsubscribeDictation?.(),{once:true});
  const nativeReasoning=mountModelThinkingPicker(preferences,invoke,report,{readFeedbackRevision:()=>feedbackRevision,clearFeedback:()=>report('')});
  composer.beforeSubmit=async()=>{await nativeReasoning.flush();return sessionControls.flush();};
  composer.onAccepted=token=>sessionControls.submitted(token);
  const center=mountCommandCenter(root,{sessionRoot,assistantRoster,switchConversation:sessionControls.switchTo,preferences,input:draftInput,invoke,report,escape,onThreadChange:returnToMain});
  root.querySelector('.cc-rail').append(prohibitionsRoot);
  const goalControl=createGoalControl(invoke,()=>draftInput.value);
  goalControl.button.className='cc-goals';
  preferences.before(goalControl.button);
  root.querySelector('.workspace')?.append(goalControl.dialog);
  const runtimeControls=mountWorkspaceRuntimeControls(root,invoke,report);
  const actions=root.querySelector('.workspace-composer-actions');
  const runtimeStrip=root.querySelector('.cc-runtime-controls');
  actions.querySelector('[data-send]').before(runtimeStrip.querySelector('.cc-live'));
  const more=document.createElement('details');
  const moreLabel=document.createElement('summary');
  moreLabel.textContent='权限与语音设置';
  more.append(moreLabel,runtimeStrip);
  root.querySelector('.cc-context').append(more);
  const dictate=actions.querySelector('.cc-voice');
  let requestingDictation=false;
  function updateDictation(){
    const voice=current.voice,recording=voice?.status==='listening';
    dictate.disabled=requestingDictation||Boolean(current.live?.active)||!voice?.experimental
      ||['enabling','listening','disabling','release_unconfirmed','disposed'].includes(current.wake?.phase)
      ||(recording?!voice.ownsCapture:!['unavailable','error','awaiting_speech'].includes(voice.status));
    dictate.title=!voice?.experimental?'请先在语音设置中配置 SIS 听写':recording?'结束听写并填入原对话':'语音转文字';
    dictate.setAttribute('aria-label',dictate.title);dictate.setAttribute('aria-pressed',String(recording&&voice.ownsCapture));
  }
  dictate.onclick=async()=>{
    if(dictate.disabled)return;
    const action=current.voice.status==='listening'?'voice.record.finish':'voice.record.start';
    requestingDictation=true;updateDictation();
    try{await invoke(action,{conversationId:current.conversationState.activeId});}
    catch(error){report(error);}
    finally{requestingDictation=false;updateDictation();}
  };
  updateDictation();
  const workspaceApprovals=mountWorkspaceApprovals(conversation,invoke,report,()=>feedbackRevision);
  window.addEventListener('pagehide',()=>nativeReasoning.dispose(),{once:true});
  syncAuxiliaryPanels();
  const syncCancelButtons=()=>conversation.querySelectorAll('[data-cancel],[data-reconcile],[data-skip-conflict]').forEach(button=>{button.disabled=Boolean(button.dataset.reconcile&&current.tasks.find(task=>task.taskId===button.dataset.reconcile)?.reconciliationStatus?.blockedReason)||pendingCancelIds.has(button.dataset.cancel??button.dataset.reconcile??button.dataset.skipConflict)||current.tasks.some(task=>task.taskId===(button.dataset.cancel??button.dataset.reconcile??button.dataset.skipConflict)&&task.state==='cancelling');});
  const restoreTaskActionFocus=focused=>{
    if(!focused||focused.disabled||document.activeElement!==document.body)return;
    const action=['view','copy','cancel','reconcile'].find(key=>focused.dataset[key]);if(!action)return;
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
  root.querySelector('#connector-cards').onkeydown=event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-connector], .notification-card')){event.preventDefault();event.target.click();}};
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
    locateFeedback.set(id,request);pruneMap(locateFeedback);projectLocateFeedback();
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
    const button=event.target.closest('[data-cancel],[data-reconcile],[data-skip-conflict],[data-view],[data-copy],[data-locate-id],[data-jump-turn]');if(!button)return;
    if(button.dataset.jumpTurn){
      [...conversation.querySelectorAll('[data-turn]')].find(item=>item.dataset.turn===button.dataset.jumpTurn)?.scrollIntoView?.({behavior:'smooth',block:'center'});
      return;
    }
    if(button.dataset.locateId){await locateFailure(button);return;}
    try{
      if(button.dataset.view){
        const taskId=button.dataset.view;
        inspected=taskId;renderInspector();
        if(!current.fake){
          const transcript=await invoke('task.transcript',{taskId});
          const task=current.tasks.find(item=>item.taskId===taskId);
          if(task&&!task.bodyWithheld&&!task.outputTruncated&&inspected===taskId&&transcript?.segments?.length){
            const live=publicLiveTranscript(transcript);
            live.openDisclosures=liveTurns.get(taskId)?.openDisclosures??live.openDisclosures;
            liveTurns.set(taskId,live);renderInspector();
          }
        }
        return;
      }
      if(button.dataset.copy){
        const task=current.tasks.find(item=>item.taskId===button.dataset.copy);
        if(!task)return;
        const children=current.subagentTasks?.filter(child=>child.parentTaskId===task.taskId);
        const text=mainChatReplies(task,children,liveTurns.get(task.taskId)?.answer).join('\n\n');
        if(text){await invoke('clipboard.writeText',text);button.title='已复制';}
        return;
      }
      const id=button.dataset.cancel??button.dataset.reconcile??button.dataset.skipConflict;
      if(button.disabled||pendingCancelIds.has(id))return;
      const isCancel=Boolean(button.dataset.cancel);
      pendingCancelIds.add(id);if(isCancel)button.textContent='正在停止…';syncCancelButtons();
      try{
        const action=button.dataset.skipConflict?'task.reconcile.skip':button.dataset.reconcile?'task.reconcile.finish':'task.cancel';
        await invoke(action,button.dataset.skipConflict?conflictDecisionPayload(current.tasks.find(task=>task.taskId===id)):id);
      }finally{pendingCancelIds.delete(id);syncCancelButtons();}
    }catch(error){if(button.dataset.cancel)button.textContent='停止';report(error);syncCancelButtons();}
  };
  function renderInspector(){
    const task=current.tasks.find(item=>item.taskId===inspected);
    if(!task){inspected=null;syncAuxiliaryPanels();return;}
    root.querySelector('#conversation-inspector').dataset.taskId=task.taskId;
    updateRepair(task.outputTruncated?[]:[task]);
    syncAuxiliaryPanels();
    root.querySelector('#inspector-content').innerHTML=`<h3>你的消息</h3><p>${escape(task.userMessage||'历史对话')}</p><h3>回答与执行过程</h3>${answerCardHtml(task,liveTurns.get(task.taskId),escape)}<p>${escape(resultText(task.resultSummary,task.resultMetadata)||task.error?.message||stateNames[task.state])}</p>${task.resultMetadata?`<h3>模型与验证</h3><p>${escape(task.resultMetadata.profile)} · ${escape(task.resultMetadata.verification)}</p>`:'' }<h3>执行状态</h3><p>${escape(stateNames[task.state]||task.state)}</p>${(task.steps||[]).map(step=>`<p class="inspector-step">${escape(step.label)} · ${escape(step.state)}</p>`).join('')}`;
    const candidateButton=document.createElement('button'),candidateBody=document.createElement('div');
    candidateButton.type='button';candidateButton.textContent='查看候选答案';
    candidateButton.onclick=async()=>{
      if(candidateButton.disabled)return;candidateButton.disabled=true;
      try{
        const value=await invoke('workflow.modelCandidates.read',{taskId:task.taskId});
        if(inspected!==task.taskId||!root.contains(candidateBody))return;
        candidateBody.replaceChildren();
        const note=document.createElement('p');note.textContent='以下为模型候选，尚未核实。';candidateBody.append(note);
        const candidates=value.results.flatMap(result=>result.candidates);
        if(!candidates.length)note.textContent='这轮对话暂无已完成的候选答案。';
        for(const candidate of candidates){
          const heading=document.createElement('h3'),body=document.createElement('p');
          heading.textContent=candidate.modelId;body.textContent=candidate.text;body.style.whiteSpace='pre-wrap';
          candidateBody.append(heading,body);
        }
      }catch(error){if(inspected===task.taskId&&root.contains(candidateBody))candidateBody.textContent=errorDisplayText(error);}
      finally{candidateButton.disabled=false;}
    };
    root.querySelector('#inspector-content').append(candidateButton,candidateBody);
  }
  let brakePending=false;
  function update(data){
    updateRevision++;
    const sessionChanged=current?.conversationState?.activeId!==data.conversationState?.activeId;if(sessionChanged){returnToMain();inspected=null;syncAuxiliaryPanels(false);}
    current=data;current.tasks ||= [];
    if(sessionChanged){delegatedTracker.reset();browserThread(undefined,true);}
    paintAssistants(data);
    for(const task of data.tasks)if(task.bodyWithheld||task.outputTruncated)liveTurns.delete(task.taskId);
    sessionControls.update(data);nativeReasoning.update(data);
    orb.setVariant?.(typeof orbVariantPreference==='function'?orbVariantPreference():(document.documentElement?.dataset?.orbVariant||'matrix'));
    orb.setLevel((typeof orbStateOverride==='function'?orbStateOverride():null)==='listening'?Math.max(data.audioLevel??0,0.68):(data.audioLevel??0));
    orb.setState((typeof orbStateOverride==='function'?orbStateOverride():null)??visualOrbState(data));
    if(document.hidden)orb.stop();
    composer.update(data);
    updateDictation();
    let brakeStatus=root.querySelector('#operator-brake-status');
    let brakeButton=root.querySelector('#workspace-operator-brake');
    if(!brakeStatus){brakeStatus=document.createElement('p');brakeStatus.id='operator-brake-status';brakeStatus.className='notice';brakeStatus.hidden=true;root.querySelector('.workspace-top')?.after(brakeStatus);}
    if(!brakeButton&&root.querySelector('.cc-chat-heading')){
      brakeButton=document.createElement('button');brakeButton.id='workspace-operator-brake';brakeButton.type='button';brakeButton.className='operator-brake';
      brakeButton.onclick=()=>{if(brakePending||!window.desktop?.setOperatorBrake)return;brakePending=true;brakeButton.disabled=true;window.desktop.setOperatorBrake(current?.operatorBrake?.paused!==true).then(res=>{if(!res?.ok)report(res?.error||'总暂停切换未确认');},report).finally(()=>{brakePending=false;brakeButton.disabled=false;});};
      root.querySelector('.cc-chat-heading').append(brakeButton);
    }
    applyOperatorBrake({button:brakeButton,status:brakeStatus,snapshot:data.operatorBrake});
    updateProgress(data.computerControl?.waitingConfirmation?data.tasks:[],data.computerControl,
      {questions:data.authorizationQuestions,workflowQuestions:data.workflowQuestions,conversationId:data.conversationState?.activeId});
    updateRepair(data.tasks.filter(task=>task.taskId===inspected&&!task.outputTruncated));
    briefingPanel.render(data.dailyBriefing,{open:data.briefingOpen===true});
    proactiveControls.render(data.proactive);
    proactiveWorkflowControls.render(data.proactiveWorkflow);
    root.querySelector('#workspace-greeting').hidden=current.tasks.length>0;root.querySelector('#workspace-intro').hidden=current.tasks.length>0;root.querySelector('#workspace-welcome').classList.toggle('compact',current.tasks.length>0);
    const childrenByParent=new Map();
    for(const child of data.subagentTasks??[]){
      if(!childrenByParent.has(child.parentTaskId))childrenByParent.set(child.parentTaskId,[]);
      childrenByParent.get(child.parentTaskId).push(child);
    }
    const timeline=conversationTimeline(data.tasks,data.messages);
    delegatedTracker.observe(timeline,childrenByParent,mainChatReplies);
    const deliveries=delegatedTracker.list();
    const signature=JSON.stringify([data.tasks.map(task=>[task.taskId,task.createdAt,task.userMessage,task.state,task.resultSummary,task.resultMetadata,
      task.error,task.bodyWithheld,task.outputTruncated,task.conflictOnly,task.backgroundDelegation,task.reconciliationStatus,task.revision,
      task.steps?.map(s=>[s.stepId,s.label,s.state])]),
      data.subagentTasks?.map(child=>[child.taskId,child.parentTaskId,child.state,child.finalReply,child.steps?.map(s=>[s.stepId,s.label,s.state])]),
      data.messages,deliveries.map(d=>[d.taskId,d.state,d.reply])]);
    if(signature!==lastSignature){
      const focused=conversation.contains(document.activeElement)?document.activeElement:null;
      const atBottom=stage.scrollHeight-stage.scrollTop-stage.clientHeight<90;lastSignature=signature;
      syncTraceDisclosures(conversation,liveTurns);
      const turnsMarkup=timeline.map(entry=>{
        if(entry.kind==='message'){
          const message=entry.value;
          return `<article class="workspace-turn" data-turn="live:${escape(message.id)}"><div class="${message.role==='user'?'user-message':'assistant-message'}">${escape(message.text)}</div></article>`;
        }
        const task=entry.value,children=childrenByParent.get(task.taskId)??[];
        const live=liveTurns.get(task.taskId);
        const traceHtml=traceBlockHtml(task,live,children,escape);
        const replies=mainChatReplies(task,children,live?.answer);
        const failure=task.bodyWithheld||task.outputTruncated?undefined:task.error?.message;
        const streaming=!isTerminal(task)&&!task.bodyWithheld&&!task.outputTruncated;
        const streamAttr=streaming?` data-streaming-reply="${escape(task.taskId)}"`:'';
        const streamedChild=children.length?live?.answer:'';
        const delegated=children.length>0||task.backgroundDelegation===true;
        const bubbles=task.conflictOnly?'':replies.length
          ?replies.map(text=>`<div class="assistant-message"${streamAttr}>${escape(text)}</div>`).join('')
          :streamedChild
            ?`<div class="assistant-message"${streamAttr}>${escape(streamedChild)}</div>`
            :isTerminal(task)||task.outputTruncated||task.bodyWithheld?'':delegated
              ?`<div class="assistant-message cc-dispatch-ack"${streamAttr}>${DISPATCH_ACK}</div>`
              :`<div class="assistant-message cc-typing"${streamAttr}>正在回复…</div>`;
        const locateHtml=failure&&!task.resultSummary?`<div class="locate-block" data-locate-for="${escape(task.taskId)}"><button type="button" class="turn-action" data-locate-id="${escape(task.taskId)}" data-locate-text="${escape(failure)}" aria-label="定位失败原因">定位失败原因</button><div class="locate-result" hidden></div></div>`:'';
        return `<article class="workspace-turn" data-turn="${escape(task.taskId)}">${task.conflictOnly?'':`<div class="user-message">${escape(task.userMessage||'历史对话')}</div>`}${traceHtml}${bubbles}${locateHtml}<div data-workspace-approvals="${escape(task.taskId)}"></div><div class="response-actions">${!task.conflictOnly?`<button type="button" data-view="${escape(task.taskId)}" title="在对话内查看" aria-label="查看这轮对话">${icon('view')}</button>${replies.length?`<button type="button" data-copy="${escape(task.taskId)}" title="复制回答" aria-label="复制回答">${icon('copy')}</button>`:''}`:''}${task.state==='waiting_reconciliation'?`<p class="notice">${escape(task.reconciliationStatus?.blockedReason??task.reconciliationStatus?.notice??(task.reconciliationStatus?.actionLabel?'仅检查原任务已有回执，不会重新执行原操作；能否结束以检查结果为准。':'当前没有该操作的自动核查入口。'))}</p>${!task.conflictOnly&&task.reconciliationStatus?.actionLabel?`<button type="button" class="turn-action" data-reconcile="${escape(task.taskId)}">${escape(task.reconciliationStatus.actionLabel)}</button>`:''}`:''}${conflictDecisionMarkup(task,escape,true)}</div></article>`;
      }).join('')+delegatedDeliveryHtml(deliveries,escape,'workspace');
      updateConversationTurns(conversation,turnsMarkup,{tasks:data.tasks,pendingCancelIds,cancelSelector:'[data-cancel]',cancelAttribute:'cancel'});
      projectLocateFeedback();syncCancelButtons();restoreTaskActionFocus(focused);
      requestAnimationFrame(()=>{if(atBottom)stage.scrollTop=stage.scrollHeight;updateRail();});if(inspected)renderInspector();
    }
    workspaceApprovals.update(data);center.update(data);runtimeControls.update(data);
    const nextCards=JSON.stringify([data.capabilities,data.health,data.notifications,data.todo,data.calendar,data.feeds,data.mail,data.knowledge,data.weather]);if(cardsSignature!==nextCards){cardsSignature=nextCards;root.querySelector('#connector-cards').innerHTML=connectorCards(data,escape);}
  }
  update.setAudioLevel=level=>orb.setLevel(level);
  update.setResourceBudget=budget=>orb.setResourceBudget(budget);
  return update;
}
