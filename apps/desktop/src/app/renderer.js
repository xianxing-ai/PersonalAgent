import {mountSessionControls} from '../features/conversation/session-controls.js';
import {readDeveloperSettingsDiagnostic} from '../../shared/developer-settings-diagnostics.js';
import {mountSubagentConversationPage} from '../features/conversation/subagent-conversations.js';
import {mountSubagentCompletionNotice} from '../features/conversation/subagent-completion-notice.js';
import {mountSubagentConversationList} from '../features/conversation/subagent-conversation-list.js';
import {mountNativeReasoning} from '../features/conversation/native-reasoning.js';
import {mountInputPin} from './input-pin.js';
import {conversationTimeline} from '../features/conversation/timeline.js';
import {updateConversationTurns} from '../features/conversation/turn-view.js';
import {mountTaskProgress} from '../features/conversation/task-progress.js';
import {Orb} from '../features/orb/orb.js';
import {stateNames,isTerminal,currentTask,visualOrbState,orbStatusLabel} from '../features/conversation/state.js';
import {sisStatusLine} from '../features/conversation/sis-status.js';
import {createFollowLock} from '../features/conversation/follow-lock.js';
import {mountAdmin} from '../features/admin/view.js';
import {mountWorkspace} from '../features/workspace/view.js';
import {applyPreferences} from '../ui/preferences.js';
import {mountConversationRail} from '../features/conversation/rail.js';
import {resultText} from '../features/conversation/result-text.js';
import {createGoalControl} from '../features/conversation/goal-view.js';
import {mountDesktopShell} from '../ui/desktop-shell.js';
import {mountWindowControls} from '../ui/window-controls.js';
import {mountLiveVoiceControls} from './live-voice-controls.js';
import {mountProactiveControls} from './proactive-controls.js';
import {approvalCards,approvalResponse,nextApprovalExpiry} from '../features/conversation/approval-card.js';
import {isStopRequest} from '../features/conversation/stop-request.js';
import {mountAuthorizationQuestionCards,approvalsWithoutQuestionCards} from '../features/conversation/authorization-question-card.js';

applyPreferences();
mountDesktopShell();
const root = document.querySelector('#root');
const mode = new URLSearchParams(location.search).get('mode');
const bridge = window.desktop;
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const voiceFailureStages = Object.freeze({pcm_acquire:'麦克风就绪',session_start:'会话启动',
  pcm_release:'麦克风释放',audio_buffer:'音频缓冲',recognition:'语音识别',
  consumption:'请求回答',dictation:'填写文字',playback:'云端合成或播报',auto_finish:'自动结束',cleanup:'资源释放',
  initialization:'适配器启动'});
const responseIcons={copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',share:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></svg>',like:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v10H4V10h3Zm3 10h7.2a2 2 0 0 0 1.9-1.4l1.5-5A2 2 0 0 0 18.7 11H15l.6-3.1A3.2 3.2 0 0 0 12.5 4L10 10v10Z"/></svg>'};
let activeDesktopConversationId;
async function invoke(action,payload) {
  if(activeDesktopConversationId&&['task.submit','conversation.model','thinking.update'].includes(action))payload=action==='task.submit'?{...(typeof payload==='string'?{text:payload}:payload),conversationId:payload?.conversationId??activeDesktopConversationId}:{...payload,conversationId:payload?.conversationId??activeDesktopConversationId};
  if(!bridge) throw Error('桌面桥未连接，请从 PersonalAgent 桌面应用启动');
  const response=await bridge.invoke(action,payload);
  if(!response.ok){
    const error=Error(response.error),diagnostic=readDeveloperSettingsDiagnostic(response.diagnostic);
    if(diagnostic)error.diagnostic=diagnostic;
    throw error;
  }
  return response.value;
}
let render, orb, reportSnapshotFailure, clearSnapshotFailure;
if(mode==='orb') {
  root.innerHTML='<button class="orb-button" aria-label="打开 PersonalAgent"><canvas aria-hidden="true"></canvas></button>';
  orb=new Orb(root.querySelector('canvas'),{variant:'matrix',layout:'shell',count:170});
  const syncMotion=()=>{if(document.hidden)orb.stop();else orb.setCalm(document.documentElement.dataset.calm==='true');};syncMotion();
  window.addEventListener('preferences-changed',syncMotion);
  document.addEventListener('visibilitychange',syncMotion);
  window.addEventListener('unload',()=>{window.removeEventListener('preferences-changed',syncMotion);document.removeEventListener('visibilitychange',syncMotion);},{once:true});
  let start,drag=false;
  const button=root.querySelector('button');
  let operationGeneration=0,operationSequence=0,feedbackOwner=0,operationError='',orbLabel='打开 PersonalAgent',operationClosed=false,snapshotError='';
  const syncOperationFeedback=()=>{
    const feedback=operationError?`操作失败：${operationError}`:snapshotError?`状态读取失败：${snapshotError}`:'';
    button.setAttribute('aria-label',feedback?`${orbLabel} · ${feedback}`:orbLabel);
    if(feedback)button.title=feedback;else button.removeAttribute('title');
  };
  reportSnapshotFailure=error=>{snapshotError=error.message;syncOperationFeedback();};
  clearSnapshotFailure=()=>{if(snapshotError){snapshotError='';syncOperationFeedback();}};
  const orbOperation=async (action,payload)=>{
    const explicit=action!=='orb.dragEnd',generation=explicit?++operationGeneration:operationGeneration,sequence=++operationSequence;
    try{await invoke(action,payload);if(!operationClosed&&explicit&&generation===operationGeneration&&sequence>=feedbackOwner){feedbackOwner=sequence;operationError='';syncOperationFeedback();}}
    catch(error){if(!operationClosed&&generation===operationGeneration&&sequence>=feedbackOwner){feedbackOwner=sequence;operationError=error.message||String(error);syncOperationFeedback();}}
  };
  window.addEventListener('unload',()=>{operationClosed=true;},{once:true});
  button.addEventListener('pointerdown',e=>{if(e.button!==0)return;start={x:e.screenX,y:e.screenY,offset:{x:e.clientX,y:e.clientY}};button.setPointerCapture(e.pointerId);});
  button.addEventListener('pointermove',e=>{if(start&&!drag&&Math.hypot(e.screenX-start.x,e.screenY-start.y)>4){drag=true;orbOperation('orb.dragStart',start.offset);}});
  function finish(){if(drag)orbOperation('orb.dragEnd');else if(start)orbOperation('orb.open');start=null;drag=false;}
  button.addEventListener('pointerup',finish);button.addEventListener('pointercancel',()=>{if(drag)orbOperation('orb.dragEnd');start=null;drag=false;});
  button.addEventListener('lostpointercapture',()=>{if(drag)orbOperation('orb.dragEnd');start=null;drag=false;});
  button.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();orbOperation('orb.open');}});
  button.addEventListener('click',e=>{if(e.detail===0)orbOperation('orb.open');});
  render=data=>{orb.setLevel(data.audioLevel??0);orb.setState(visualOrbState(data));if(document.hidden)orb.stop();orbLabel=`PersonalAgent · ${orbStatusLabel(data)}`;syncOperationFeedback();};
} else if(mode==='admin') render=mountAdmin(root,invoke,escape);
else if(mode==='workspace') render=mountWorkspace(root,invoke,escape,{flushBeforeClose:bridge?.flushDrafts});
else if(mode==='subagent') {const page=mountSubagentConversationPage(root,invoke);render=()=>page.refresh();}
else if(mode==='subagent-list') {const page=mountSubagentConversationList(root,invoke);render=()=>page.refresh();}
else {
  root.innerHTML=`<section class="panel"><header><span class="dot"></span><strong>PersonalAgent</strong><span class="status" id="state">待机</span><span class="spacer"></span><button class="icon-btn hdr-btn" id="admin" title="设置" aria-label="设置"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0-.73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></button><span class="bell-box"><button class="icon-btn hdr-btn" id="bell" title="通知" aria-label="通知" aria-haspopup="true" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></button><span class="bell-menu" id="bell-menu" role="menu" hidden><div class="notice">无新通知。通知能力尚未连接。</div></span></span><button class="icon-btn hdr-btn" id="close" title="收起面板" aria-label="收起面板"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg></button></header><div class="thread"><div class="who" id="connection"></div><div class="bubble">有什么可以帮你？</div><div class="quick-start" id="quick-start" hidden></div><div class="notice" id="connection-notice">正在读取模型连接状态…</div><div id="tasks"></div><p class="error" role="alert" id="error"></p></div><form class="composer"><textarea aria-label="任务内容" placeholder="说要做什么…"></textarea><div class="composer-bar"><button class="icon-btn" type="button" id="stop" disabled title="停止播报" aria-label="停止播报"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="m16 9.5 5 5"/><path d="m21 9.5-5 5"/></svg></button><span class="spacer"></span><span class="model-box"><button class="model-select" type="button" id="model" aria-haspopup="true" aria-expanded="false" title="模型与思考深度"><span id="model-label">正在读取模型…</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><span class="model-menu" id="model-menu" role="menu" hidden><span class="mm-card"><span class="mm-top"><button class="icon-btn mm-fast" type="button" id="mm-fast" title="快速模式" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg></button><span class="mm-depth"><span id="mm-depth-label">供应商默认</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></span><button class="icon-btn" type="button" disabled title="思考设置待 Runtime 支持"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg></button></span><span class="mm-model"><span id="mm-model-label">正在读取模型…</span><span class="model-tag" id="model-tag">未测试</span></span><input class="mm-slider" id="mm-slider" type="range" min="0" max="5" step="1" value="1" aria-label="模型原生思考深度"></span><span class="notice" id="model-notice">模型未完成真实连接测试；思考参数暂未传入 Runtime。</span></span></span><button class="icon-btn" type="button" id="talk" disabled title="语音转文字未连接" aria-label="语音转文字"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg></button><button class="send-btn" id="send" type="submit" data-mode="voice" title="语音模式（语音模型未连接）" aria-label="发送或语音模式"><svg class="icon-voice" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 10.5v3"/><path d="M10.5 8v8"/><path d="M14 9.5v5"/><path d="M17.5 11v2"/></svg><svg class="icon-send" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg><svg class="icon-stop" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="4.5" y="4.5" width="11" height="11" rx="1.25"/></svg></button></div><div class="notice mic-state"></div></form></section>`;
  const expand = document.createElement('button');
  expand.id='panel-expand';expand.className='icon-btn hdr-btn';expand.type='button';
  expand.title='放大到工作区';expand.setAttribute('aria-label','放大到工作区');
  expand.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6m0-6-7 7M10 20H4v-6m0 6 7-7"/></svg>';
  root.querySelector('#close').before(expand);
  expand.onclick=()=>invoke('workspace.open').catch(error=>{setFeedback(error.message);});
  let current,pending=false,submitGeneration=0,lastTaskSignature='',draftRevision=0;const likedTasks=new Set();
  // Bounded UI state: these collections only serve the current session and must not grow for the
  // lifetime of a long-running panel (#435).
  const capCollection=(collection,limit)=>{while(collection.size>limit){collection.delete(collection.keys().next().value);}};
  const locateFeedback=new Map();let locateClosed=false;
  const approvalDecisions=new Map();
  const pendingCancelIds=new Set();
  // Tasks the user explicitly stopped. They stop counting as "busy" the moment the stop is
  // requested, so the composer is usable again without waiting for the runtime to unwind.
  const truncatedTaskIds=new Set();
  const activeTasks=()=>(current?.tasks??[]).filter(task=>!isTerminal(task)&&!truncatedTaskIds.has(task.taskId));
  let approvalExpiryTimer;
  let errorFeedbackRevision=0;
  const setFeedback=value=>{errorFeedbackRevision++;root.querySelector('#error').textContent=value;};
  let hostFeedback='',hostFeedbackRevision=-1;
  const syncHostFeedback=(value,{preserveFeedback=false}={})=>{
    if(preserveFeedback){hostFeedback=value;return;}
    if(value&&(value!==hostFeedback||root.querySelector('#error').textContent!==value)){
      setFeedback(value);hostFeedbackRevision=errorFeedbackRevision;
    }else if(!value&&hostFeedback&&errorFeedbackRevision===hostFeedbackRevision)setFeedback('');
    hostFeedback=value;
  };
  const report=e=>setFeedback(typeof e==='string'?e:e.message);
  const form=root.querySelector('form'),input=root.querySelector('textarea'),thread=root.querySelector('.thread'),tasksNode=root.querySelector('#tasks');
  const subagents=mountSubagentCompletionNotice(thread,invoke);
  window.addEventListener('unload',()=>subagents.dispose(),{once:true});
  const updateProgress=mountTaskProgress(thread,tasksNode);
  const quickStart=root.querySelector('#quick-start');
  const quickStartItems=[['整理今日计划','列出今天的日程、待办和昨天未完成的事项，整理成一份今日计划。'],['写本周周报','根据最近完成的任务，起草一份本周周报草稿。'],['查看天气提醒','查询明天天气，并给出出行与穿着提醒。'],['起草邮件回复','根据最近收到的邮件，起草一份回复草稿。']];
  quickStart.innerHTML=quickStartItems.map(([label,fill])=>`<button type="button" data-fill="${escape(fill)}">${escape(label)}</button>`).join('');
  quickStart.onclick=e=>{const chip=e.target.closest('button[data-fill]');if(!chip)return;input.value=chip.dataset.fill;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();};
  const sessionRoot=document.createElement('div');sessionRoot.className='conversation-session-root';root.querySelector('.panel header').after(sessionRoot);const sessionControls=mountSessionControls(sessionRoot,input,invoke,report,{singleMain:true,flushBeforeClose:bridge?.flushDrafts});
  const syncCancelButtons=()=>tasksNode.querySelectorAll('[data-action="task.cancel"],[data-action="task.reconcile.finish"]').forEach(button=>{button.disabled=pendingCancelIds.has(button.dataset.id)||current?.tasks.some(task=>task.taskId===button.dataset.id&&task.state==='cancelling');});
  const restoreTaskActionFocus=focused=>{
    if(!focused||focused.disabled||document.activeElement!==document.body||focused.dataset.approvalDecision)return;
    const action=focused.dataset.action??focused.dataset.uiAction;if(!action)return;
    const button=[...tasksNode.querySelectorAll('[data-action],[data-ui-action]')].find(item=>(item.dataset.action??item.dataset.uiAction)===action&&item.dataset.id===focused.dataset.id&&item.dataset.messageId===focused.dataset.messageId&&item.dataset.locateId===focused.dataset.locateId);
    if(button&&!button.disabled)button.focus({preventScroll:true});
  };
  const currentLocateFailure=(id,request)=>{
    const task=current?.tasks.find(item=>item.taskId===id);
    return task&&isTerminal(task)&&task.state===request.taskState&&task.error?.message===request.text
      &&!resultText(task.resultSummary,task.resultMetadata);
  };
  const projectLocateFeedback=()=>{
    for(const [id,request] of locateFeedback) if(!currentLocateFailure(id,request))locateFeedback.delete(id);
    for(const button of tasksNode.querySelectorAll('[data-locate-id]')) {
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
    if(locateClosed||!task)return;
    const request={text,taskState:task.state,message:'定位中…'};
    if(!currentLocateFailure(id,request))return;
    locateFeedback.set(id,request);capCollection(locateFeedback,20);projectLocateFeedback();
    const isCurrent=()=>!locateClosed&&locateFeedback.get(id)===request&&currentLocateFailure(id,request);
    try {
      const response=await invoke('task.locate',{text});
      if(!isCurrent())return;
      const report=response&&typeof response==='object'&&'failures' in response?response:null;
      const failures=report&&Array.isArray(report.failures)?report.failures:[];
      if(!failures.length)request.message='未能从错误输出定位到源码位置';
      else request.html=failures.slice(0,3).map(f=>{
        const top=f.frames&&f.frames[0];
        const head=`<div class="locate-head">${escape(f.name)}${f.timedOut?'（超时）':''}</div>`;
        const frames=top?`<div class="locate-frame">${escape(top.file)}:${top.line}${top.column?':'+top.column:''}<span class="locate-conf">置信度 ${(top.confidence*100).toFixed(0)}%</span></div>${top.snippet?`<pre class="locate-snippet">${escape(top.snippet)}</pre>`:''}`:'';
        return head+frames;
      }).join('');
    } catch(err) {if(!isCurrent())return;request.message='定位失败：'+(err&&err.message?err.message:'未知错误');}
    if(isCurrent())projectLocateFeedback();
  };
  const liveControls=mountLiveVoiceControls(root,invoke,{compact:true});
  const proactiveControls=mountProactiveControls(root.querySelector('.thread'),invoke);
  const wakeControls=document.createElement('div');
  wakeControls.className='wake-controls';
  wakeControls.innerHTML='<div class="wake-control-row"><span>唤醒词：你好小派</span><button type="button" id="wake-toggle" disabled aria-pressed="false">开启 10 分钟</button></div><p id="wake-state" role="status" aria-live="polite">唤醒未开启</p><p class="wake-hint">本次最多 10 分钟；关闭面板停止。唤醒后语音发送到华为 SIS 转文字，仅填草稿，需手动发送。</p>';
  form.append(wakeControls);
  const wakeButton=wakeControls.querySelector('#wake-toggle'),wakeStatus=wakeControls.querySelector('#wake-state');
  let wakePending=false,wakeClosed=false,updateVersion=0;
  const wakeBlocksCapture=data=>['enabling','disabling','release_unconfirmed','disposed'].includes(data?.wake?.phase);
  const renderWake=data=>{
    const wake=data?.wake,phase=wake?.phase??'unavailable';
    const listening=phase==='listening';
    const labels={disabled:'唤醒已关闭',enabling:'正在准备唤醒检测与麦克风',listening:'正在聆听“你好小派”',
      disabling:'正在关闭并核实音频释放',unavailable:'唤醒尚未就绪',release_unconfirmed:'音频释放未确认，无法重新开启',disposed:'唤醒已停止'};
    wakeButton.textContent=listening?'关闭唤醒':phase==='unavailable'?'重试开启 10 分钟':'开启 10 分钟';
    wakeButton.setAttribute('aria-pressed',String(listening));
    wakeButton.disabled=wakePending || Boolean(data?.live?.active) || !data?.voice?.experimental
      || !['disabled','unavailable','listening'].includes(phase)
      || (!listening && !['unavailable','error','awaiting_speech'].includes(data?.voice?.status));
    const expiry=listening&&Number.isFinite(wake?.expiresAtMs)
      ? ` · 本次至 ${new Date(wake.expiresAtMs).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:'';
    wakeStatus.textContent=(labels[phase]??'唤醒未开启')+expiry
      + (['unavailable','release_unconfirmed'].includes(phase)&&wake?.reason?` · ${wake.reason}`:'');
  };
  wakeButton.onclick=async()=>{
    if(wakePending||wakeButton.disabled)return;
    const operation=current?.wake?.phase==='listening'?'voice.wake.disable':'voice.wake.enable';
    wakePending=true;renderWake(current);
    const operationVersion=updateVersion;
    const feedbackRevision=errorFeedbackRevision;
    let readVersion;
    try{
      await invoke(operation);
      if(wakeClosed)return;
      readVersion=updateVersion;
      const data=await invoke('snapshot');
      if(wakeClosed||readVersion!==updateVersion)return;
      render(data,{preserveFeedback:feedbackRevision!==errorFeedbackRevision});
    }catch(error){if(!wakeClosed&&(readVersion??operationVersion)===updateVersion
      && feedbackRevision===errorFeedbackRevision)report(error);}
    finally{wakePending=false;if(!wakeClosed)renderWake(current);}
  };
  const removeDictation=bridge?.onDictation?.(result=>{
    if(typeof result?.text!=='string'||!result.text.trim())return;
    void sessionControls.appendDictation(result).catch(()=>report('原对话听写草稿读取失败；未填入其他对话。'));
  });
  window.addEventListener('unload',()=>{wakeClosed=true;locateClosed=true;locateFeedback.clear();clearTimeout(approvalExpiryTimer);approvalExpiryTimer=undefined;removeDictation?.();});
  const sisStatus=document.createElement('p');sisStatus.className='notice';sisStatus.setAttribute('role','status');
  root.querySelector('#error').before(sisStatus);
  const goalControl=createGoalControl(invoke,()=>input.value);
  root.querySelector('.composer-bar .spacer').before(goalControl.button);
  root.querySelector('.panel').append(goalControl.dialog);
  const updateRail=mountConversationRail(root.querySelector('.panel'),thread);
  const sendBtn=root.querySelector('#send'),modelBtn=root.querySelector('#model'),modelMenu=root.querySelector('#model-menu');
  const bellBtn=root.querySelector('#bell'),bellMenu=root.querySelector('#bell-menu');
  const slider=root.querySelector('#mm-slider'),depthLabel=root.querySelector('#mm-depth-label'),fastBtn=root.querySelector('#mm-fast');
  const closeModel=()=>{modelMenu.hidden=true;modelBtn.setAttribute('aria-expanded','false');};
  const closeBell=()=>{bellMenu.hidden=true;bellBtn.setAttribute('aria-expanded','false');};
  const header=root.querySelector('header');let panelDragStart,panelDragging=false,panelDragReady,panelDragGeneration=0,panelDragOwner=0,panelDragClosed=false;
  const panelDragCurrent=generation=>!panelDragClosed&&generation===panelDragGeneration;
  const panelDragReport=(generation,error)=>{if(panelDragCurrent(generation))report(error);};
  window.addEventListener('unload',()=>{panelDragClosed=true;});
  header.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button'))return;panelDragGeneration++;panelDragStart={x:e.screenX,y:e.screenY};header.setPointerCapture(e.pointerId);});
  header.addEventListener('pointermove',e=>{
    if(!panelDragStart)return;
    const generation=panelDragGeneration;
    if(!panelDragging&&Math.hypot(e.screenX-panelDragStart.x,e.screenY-panelDragStart.y)>4){
      panelDragging=true;
      panelDragOwner++;
      panelDragReady=invoke('panel.dragStart',panelDragStart).then(()=>true,error=>{panelDragReport(generation,error);return false;});
    }
    if(panelDragging)panelDragReady?.then(ready=>{if(ready&&panelDragging&&panelDragCurrent(generation))return invoke('panel.dragMove',{x:e.screenX,y:e.screenY}).catch(error=>panelDragReport(generation,error));});
  });
  const finishPanelDrag=()=>{
    const generation=panelDragGeneration,owner=panelDragOwner,ready=panelDragReady;
    if(panelDragging)ready?.then(()=>{if(!panelDragClosed&&owner===panelDragOwner)return invoke('panel.dragEnd').catch(error=>panelDragReport(generation,error));});
    panelDragStart=undefined;panelDragging=false;panelDragReady=undefined;
  };
  header.addEventListener('pointerup',finishPanelDrag);header.addEventListener('pointercancel',finishPanelDrag);header.addEventListener('lostpointercapture',finishPanelDrag);
  const budgetLabel=document.createElement('label');budgetLabel.textContent='执行步骤预算';
  const budget=document.createElement('input');budget.type='range';budget.min='0';budget.max='5';budget.step='1';budget.setAttribute('aria-label','模型执行步骤预算');budgetLabel.append(budget);modelMenu.querySelector('.mm-card').append(budgetLabel);
  const panelPreferenceRequests={thinking:0},panelPreferencePending={thinking:null},panelPreferenceErrors={thinking:null};
  let panelPreferenceEditing=null,panelPreferenceConversationId;
  const syncPanelPreferenceBusy=()=>{for(const control of [budget,fastBtn])control.setAttribute('aria-busy',String(Boolean(panelPreferencePending.thinking)));};
  const projectPanelPreferences=()=>{
    if(panelPreferenceConversationId!==current?.conversationState?.activeId){
      panelPreferenceConversationId=current?.conversationState?.activeId;panelPreferenceEditing=null;
    }
    const thinking=panelPreferenceEditing??panelPreferencePending.thinking??current?.thinking??current?.conversationPreference;
    if(thinking){budget.value=String(thinking.depth??1);fastBtn.setAttribute('aria-pressed',String(Boolean(thinking.fast)));modelMenu.classList.toggle('fast',Boolean(thinking.fast));}
    syncPanelPreferenceBusy();
  };
  const requestPanelPreference=async(group,name,payload)=>{
    if(current?.conversationState?.activeId)payload={...payload,conversationId:current.conversationState.activeId};
    const request=++panelPreferenceRequests[group];panelPreferencePending[group]=payload;syncPanelPreferenceBusy();
    try{await invoke(name,payload);if(request===panelPreferenceRequests[group]&&panelPreferenceErrors[group]===errorFeedbackRevision){setFeedback(hostFeedback);if(hostFeedback)hostFeedbackRevision=errorFeedbackRevision;}}
    catch(error){if(request===panelPreferenceRequests[group]){panelPreferencePending[group]=null;projectPanelPreferences();report(error);panelPreferenceErrors[group]=errorFeedbackRevision;}}
    finally{if(request===panelPreferenceRequests[group]){panelPreferencePending[group]=null;syncPanelPreferenceBusy();}}
  };
  const setSendMode=hasText=>{
    const stopping=pendingCancelIds.size>0,stop=stopping||activeTasks().length>0;
    sendBtn.dataset.mode=stop?'stop':hasText?'send':'live';
    sendBtn.title=stop?'停止当前任务并打断回答':hasText?'发送':current?.live?.active?'关闭 Live 实时语音':'开启 Live 实时语音';
    sendBtn.setAttribute('aria-label',sendBtn.title);sendBtn.setAttribute('aria-pressed',String(!stop&&!hasText&&Boolean(current?.live?.active)));
    sendBtn.setAttribute('aria-busy',String(stopping||pending));sendBtn.disabled=stop?stopping:hasText&&pending;
  };
  root.querySelector('#admin').onclick=()=>invoke('admin.open').catch(report);
  root.querySelector('#close').onclick=()=>invoke('panel.hide').catch(report);
  modelBtn.onclick=e=>{e.stopPropagation();const open=modelMenu.hidden;closeModel();closeBell();if(open){modelMenu.hidden=false;modelBtn.setAttribute('aria-expanded','true');}};
  const modelChoice = document.createElement('input');modelChoice.type='range';
  modelChoice.className='conversation-model-choice';modelChoice.setAttribute('aria-label','当前对话的主思考模型');
  const modelChoiceLabel=document.createElement('label');modelChoiceLabel.textContent='主思考模型';
  const modelOutput=document.createElement('output');modelChoiceLabel.append(modelOutput,modelChoice);modelMenu.querySelector('.mm-card').append(modelChoiceLabel);
  const moreModels=document.createElement('button');moreModels.type='button';moreModels.className='turn-action';moreModels.textContent='更多模型与默认设置';moreModels.onclick=()=>invoke('admin.open',{page:'models'}).catch(report);modelMenu.querySelector('.mm-card').append(moreModels);
  const nativeReasoning=mountNativeReasoning(modelMenu.querySelector('.mm-card'),invoke,report,{slider,output:depthLabel,modelChoice,modelOutput,readFeedbackRevision:()=>errorFeedbackRevision,clearFeedback:()=>{setFeedback(hostFeedback);if(hostFeedback)hostFeedbackRevision=errorFeedbackRevision;}});
  // Sticky bottom-follow (审点 #62): only real user scrolls change the belief;
  // content growth / pre-judgment reflow never unlock, conversation switch resets.
  const followLock=createFollowLock();
  thread.addEventListener('scroll',()=>followLock.onScroll(thread.scrollHeight-thread.scrollTop-thread.clientHeight),{passive:true});
  let modelChoiceSignature;
  bellBtn.onclick=e=>{e.stopPropagation();const open=bellMenu.hidden;closeBell();closeModel();if(open){bellMenu.hidden=false;bellBtn.setAttribute('aria-expanded','true');}};
  document.addEventListener('click',e=>{if(!modelMenu.hidden&&!e.target.closest('.model-box'))closeModel();if(!bellMenu.hidden&&!e.target.closest('.bell-box'))closeBell();});
  budget.addEventListener('input',()=>{panelPreferenceEditing={depth:Number(budget.value),fast:fastBtn.getAttribute('aria-pressed')==='true'};});
  budget.addEventListener('change',()=>{const thinking={depth:Number(budget.value),fast:fastBtn.getAttribute('aria-pressed')==='true'};panelPreferenceEditing=null;return requestPanelPreference('thinking','thinking.update',thinking);});
  fastBtn.onclick=()=>{const on=fastBtn.getAttribute('aria-pressed')!=='true';panelPreferenceEditing=null;fastBtn.setAttribute('aria-pressed',String(on));modelMenu.classList.toggle('fast',on);return requestPanelPreference('thinking','thinking.update',{depth:Number(budget.value),fast:on});};
  mountInputPin(input,invoke,()=>current?.pinned===true,report);
  input.addEventListener('input',e=>{draftRevision++;setSendMode(Boolean(e.target.value.trim()));});
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(input.value.trim()&&!pending)form.requestSubmit();}});
  sendBtn.addEventListener('click',e=>{e.preventDefault();if(sendBtn.disabled)return;if(sendBtn.dataset.mode==='stop'){
    void stopButton.onclick();
  }else if(sendBtn.dataset.mode==='live'){
    void liveControls.toggle();
  }else if(!pending)form.requestSubmit();});
  document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!modelMenu.hidden){const restore=modelMenu.contains(document.activeElement);closeModel();if(restore)modelBtn.focus({preventScroll:true});return;}if(!bellMenu.hidden){closeBell();return;}invoke('panel.hide').catch(report);});
  const stopActiveTasks=async running=>{
    for(const task of running){truncatedTaskIds.add(task.taskId);pendingCancelIds.add(task.taskId);}
    setSendMode(Boolean(input.value.trim()));syncCancelButtons();
    try{
      // Both channels must run: cancelling Runtime does not interrupt host Live/SIS playback.
      const results=await Promise.allSettled([invoke('voice.stop'),...running.map(task=>invoke('task.cancel',task.taskId))]);
      for(let index=0;index<running.length;index++)if(results[index+1].status==='rejected')truncatedTaskIds.delete(running[index].taskId);
      const errors=results.flatMap(result=>result.status==='rejected'?[result.reason?.message??String(result.reason)]:[]);
      if(results[0].status==='fulfilled'&&!results[0].value?.stopped)errors.push(results[0].value?.reason??'语音供应商尚未连接');
      if(errors.length)report(errors.join('；'));
      else setFeedback(`已请求停止 ${running.length} 个正在执行的任务；是否停止以任务状态为准。`);
    }finally{for(const task of running)pendingCancelIds.delete(task.taskId);syncCancelButtons();setSendMode(Boolean(input.value.trim()));}
  };
  form.onsubmit=async e=>{
    e.preventDefault();if(pending||sendBtn.disabled||!input.value.trim())return;
    // A bare stop instruction targets the running task, not the model.
    if(isStopRequest(input.value)){
      const running=activeTasks();
      if(!running.length){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));setFeedback('当前没有正在执行的任务。');return;}
      const stopText=input.value;pending=true;
      try{
        window.speechSynthesis?.cancel();
        await stopActiveTasks(running);
        if(input.value===stopText){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}
      }finally{pending=false;setSendMode(Boolean(input.value.trim()));}
      return;
    }
    if(activeTasks().length>0)return;
    const draftToken=sessionControls.capture(),submittedText=input.value,submittedGeneration=++submitGeneration,submittedConversation=current?.conversationState?.activeId,submittedRevision=draftRevision,feedbackRevision=errorFeedbackRevision;pending=true;setSendMode(true);try{await nativeReasoning.flush();await sessionControls.flush(draftToken);await invoke('task.submit',{text:submittedText,conversationId:submittedConversation});await sessionControls.submitted(draftToken);if(draftRevision===submittedRevision&&current?.conversationState?.activeId===submittedConversation&&input.value===submittedText){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}requestAnimationFrame(()=>{thread.scrollTop=thread.scrollHeight;});if(submittedGeneration===submitGeneration&&feedbackRevision===errorFeedbackRevision){setFeedback(hostFeedback);if(hostFeedback)hostFeedbackRevision=errorFeedbackRevision;}}catch(err){if(submittedGeneration===submitGeneration)report(err);}finally{if(submittedGeneration===submitGeneration){pending=false;setSendMode(Boolean(input.value.trim()));}}};
  const stopButton=root.querySelector('#stop');
  // With a running task this control truncates it locally first, then asks Runtime to stop;
  // with nothing running it only stops playback.
  stopButton.onclick=async()=>{
    window.speechSynthesis?.cancel();
    const running=activeTasks();
    if(running.length){
      await stopActiveTasks(running);
      return;
    }
    try{const result=await invoke('voice.stop');if(!result?.stopped)report(result?.reason??'语音供应商尚未连接');}catch(err){report(err);}
  };
  const talkButton=root.querySelector('#talk');
  let talkFeedbackRevision=0;
  talkButton.onclick=async()=>{
    if(wakeClosed)return;
    const feedbackRevision=++talkFeedbackRevision;
    const state=current?.voice?.status;
    const action=state==='listening'?'voice.record.finish':'voice.record.start';
    talkButton.disabled=true;
    try{await invoke(action);if(!wakeClosed&&feedbackRevision===talkFeedbackRevision&&current?.voice?.status!=='error')setFeedback('');}
    catch(err){if(!wakeClosed&&feedbackRevision===talkFeedbackRevision)report(err);}
    finally{if(!wakeClosed&&feedbackRevision===talkFeedbackRevision)talkButton.disabled=Boolean(current?.live?.active)||wakeBlocksCapture(current)||!current?.voice?.experimental||!['unavailable','error','listening','awaiting_speech'].includes(current?.voice?.status);}
  };
  root.querySelector('#tasks').onclick=async e=>{const b=e.target.closest('[data-action],[data-ui-action]');if(!b)return;const uiAction=b.dataset.uiAction;if(uiAction==='like'){const on=!likedTasks.has(b.dataset.id);if(on){likedTasks.add(b.dataset.id);capCollection(likedTasks,200);}else likedTasks.delete(b.dataset.id);for(const button of tasksNode.querySelectorAll('[data-ui-action="like"]')){const active=likedTasks.has(button.dataset.id);button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}return;}if(uiAction==='locate'){await locateFailure(b);return;}if(uiAction==='copy'||uiAction==='share'){const task=current?.tasks.find(item=>item.taskId===b.dataset.id);const message=current?.messages?.find(item=>item.id===b.dataset.messageId);const text=b.dataset.messageId?message?.text:resultText(task?.resultSummary,task?.resultMetadata);if(!text)return;try{if(uiAction==='share'&&navigator.share){await navigator.share({text});}else{await invoke('clipboard.writeText',text);b.title=uiAction==='copy'?'已复制':'已复制分享文本';b.setAttribute('aria-label',b.title);setTimeout(()=>{b.title=uiAction==='copy'?'复制':'分享';b.setAttribute('aria-label',`${b.title}回答`);},1600);}}catch(err){if(err?.name!=='AbortError')report(err);}return;}const cancelling=['task.cancel','task.reconcile.finish'].includes(b.dataset.action),id=b.dataset.id;if(b.disabled||(cancelling&&pendingCancelIds.has(id)))return;if(cancelling)pendingCancelIds.add(id);if(b.dataset.action==='task.cancel'){truncatedTaskIds.add(id);setSendMode(Boolean(input.value.trim()));}b.disabled=true;try{await invoke(b.dataset.action,id);}catch(err){report(err);}finally{if(cancelling){pendingCancelIds.delete(id);syncCancelButtons();}else b.disabled=false;}};
  const syncApprovalButtons=()=>{
    for(const [id,phase] of approvalDecisions)if(phase==='submitted' && !(current?.approvals??[]).some(item=>
      item.approvalId===id && item.state==='pending' && current?.tasks.some(task=>task.taskId===item.taskId && task.state==='waiting_approval')))approvalDecisions.delete(id);
    for(const button of tasksNode.querySelectorAll('[data-approval-decision]'))button.disabled=approvalDecisions.has(button.dataset.approvalId);
  };
  function refreshApprovalCards() {
    if(wakeClosed||!current)return;
    const now=Date.now();
    for(const task of current.tasks) {
      const article=tasksNode.querySelector(`[data-turn="${CSS.escape(task.taskId)}"]`);
      if(!article)continue;
      const visibleApprovals=approvalsWithoutQuestionCards(current.approvals,current.authorizationQuestions,
        current.conversationState?.activeId);
      const markup=approvalCards(task,visibleApprovals,now);
      if(article.approvalMarkup===markup)continue;
      for(const card of article.querySelectorAll('.approval-card'))card.remove();
      if(markup)article.insertAdjacentHTML('beforeend',markup);
      article.approvalMarkup=markup;
    }
    syncApprovalButtons();
  }
  function scheduleApprovalExpiry() {
    clearTimeout(approvalExpiryTimer);approvalExpiryTimer=undefined;
    if(wakeClosed||!current)return;
    const now=Date.now(),expiry=nextApprovalExpiry(current.tasks,current.approvals,now);
    if(expiry===undefined)return;
    approvalExpiryTimer=setTimeout(()=>{
      approvalExpiryTimer=undefined;
      if(wakeClosed)return;
      refreshApprovalCards();scheduleApprovalExpiry();
    },Math.min(Math.max(expiry-now+25,0),2_147_483_647));
  }
  root.querySelector('#tasks').addEventListener('click',async event=>{
    const button=event.target.closest('[data-approval-decision]');if(!button||button.disabled)return;
    const id=button.dataset.approvalId;if(approvalDecisions.has(id))return;
    approvalDecisions.set(id,'pending');syncApprovalButtons();
    try{await invoke('authorization.respond',approvalResponse(id,
      button.dataset.approvalDecision,current?.tasks??[],current?.approvals??[]));
      approvalDecisions.set(id,'submitted');syncApprovalButtons();}
    catch(error){approvalDecisions.delete(id);report(error);syncApprovalButtons();}
  });
  render=(data,{preserveFeedback}={})=>{updateVersion++;const changed=current?.conversationState?.activeId!==data.conversationState?.activeId;if(changed){submitGeneration++;pending=false;for(const group of ['thinking']){panelPreferenceRequests[group]++;panelPreferencePending[group]=null;panelPreferenceErrors[group]=null;}draftRevision++;locateFeedback.clear();setFeedback('');followLock.reset();}activeDesktopConversationId=data.conversationState?.activeId;current=data;sessionControls.update(data);nativeReasoning.update(data);const task=currentTask(data.tasks);const connectionNode=root.querySelector('#connection');connectionNode.textContent=data.fakeModel?data.connection+' · Fake Model':data.connection;const liveStates={connecting:'正在连接',reconnecting:'正在续接',listening:'正在聆听',speaking:'正在回答',working:'正在处理任务',stopping:'正在关闭',error:'连接失败'};root.querySelector('#state').textContent=data.live?.active?(liveStates[data.live.status]??'Live 已开启'):task?stateNames[task.state]:'待机';
    subagents.update(data.subagentTasks??[]);
    liveControls.render({...data.live,conversationTitle:data.conversationState?.sessions.find(s=>s.id===data.live?.conversationId)?.title});
    renderWake(data);
    updateProgress(data.tasks);
    if(!data.live?.active&&!task&&data.wake?.phase==='listening')root.querySelector('#state').textContent='唤醒聆听中';
    proactiveControls.render(data.proactive);
    const notifs=Array.isArray(data.notifications)?data.notifications:[];
    if(notifs.length>0){
      bellMenu.innerHTML=notifs.slice(0,5).map(n=>`<div class="notice bell-notice"><strong>${escape(n.summary)}</strong><br><small>${escape(new Date(n.occurredAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</small></div>`).join('');
      bellBtn.title=`通知 (${notifs.length})`;bellBtn.setAttribute('aria-label',bellBtn.title);
    }else{
      bellMenu.innerHTML='<div class="notice">暂无新通知</div>';
      bellBtn.title='通知';bellBtn.setAttribute('aria-label','通知');
    }
    const sisConfiguration=data.voice?.configuration;
    sisStatus.textContent=sisStatusLine(data.voice,sisConfiguration);
    const voiceFailure=data.voice?.status==='error'?data.voice.failure:null;
    const voiceFailureStage=voiceFailureStages[voiceFailure?.stage]??'处理';
    const voiceError=data.voice?.status==='error'?`语音${voiceFailureStage}失败：${voiceFailure?.message??data.voice.reason??'语音处理失败'}`:'';
    if(preserveFeedback===false)setFeedback(data.connectionError||voiceError);
    syncHostFeedback(data.connectionError||voiceError,{preserveFeedback:preserveFeedback!==undefined});
    if(preserveFeedback===false&&hostFeedback)hostFeedbackRevision=errorFeedbackRevision;
    const modelReady=data.model?.status==='ready';
    // Thinking controls are a local test surface.  They must remain draggable
    // even while the provider is unconfigured or its connection test failed;
    // Runtime support is reported separately instead of disabling the control.
    fastBtn.disabled=false;
    const modelIdentity=data.fakeModel?(data.model?.label??'Fake Model · 离线测试'):(data.model?.configured&&data.model?.model?data.model.model:(data.model?.label||'模型未配置'));
    root.querySelector('#model-label').textContent=modelIdentity;root.querySelector('#mm-model-label').textContent=modelIdentity;
    const modelConnected=modelReady||(data.model?.configured===true&&data.model?.status!=='error');const connectionNotice=root.querySelector('#connection-notice');connectionNode.hidden=modelConnected;if(connectionNotice){connectionNotice.hidden=modelConnected;connectionNotice.textContent=data.fakeModel?'当前使用 Fake Model，仅用于离线测试。':modelReady?`当前使用 ${modelIdentity}；语音尚未连接。`:`${data.model?.reason??'模型尚未连接'}；语音尚未连接。`;}
    modelBtn.title=modelReady?`${modelIdentity} · 模型与思考深度`:'思考设置可调整；模型尚未完成真实连接测试';
    modelChoiceLabel.hidden=!data.modelChoices?.length;
    projectPanelPreferences();
    nativeReasoning.update(data);
    const tag=root.querySelector('#model-tag');if(tag)tag.textContent=modelReady?'已测试':data.model?.status==='configured'?'待测试':'未配置';
    const modelNotice=root.querySelector('#model-notice');if(modelNotice)modelNotice.textContent='思考深度控制当前模型的原生推理强度；供应商默认不发送强度覆盖。步骤预算与快速模式单独控制执行预算，实际能力以模型目录和任务回执为准。';
    const voiceState=data.voice?.status;
    const voiceReady=Boolean(data.voice?.experimental);
    talkButton.disabled=Boolean(data.live?.active)||wakeBlocksCapture(data)||!voiceReady||!['unavailable','error','listening','awaiting_speech'].includes(voiceState);
    talkButton.title=voiceState==='listening'?'结束录音并填入文字':voiceReady?'语音转文字（不自动发送）':'语音转文字未连接';
    talkButton.setAttribute('aria-label',talkButton.title);
    const micStatus=voiceError || (voiceState==='listening'?'麦克风：正在采集，点击结束':voiceState==='acquiring'?'麦克风：等待设备就绪':voiceState==='recognizing'?'语音：正在转成文字':'');
    root.querySelector('.mic-state').textContent=micStatus;
    for(const id of [...truncatedTaskIds])if(data.tasks.some(item=>item.taskId===id&&isTerminal(item)))truncatedTaskIds.delete(id);
    const hasActiveTask=activeTasks().length>0;
    stopButton.hidden=hasActiveTask||pendingCancelIds.size>0;
    stopButton.disabled=!hasActiveTask&&voiceState!=='speaking'&&!data.live?.active;stopButton.title=hasActiveTask?(data.live?.active?'停止当前任务并打断回答':'停止当前任务'):data.live?.active?'打断回答（保持 Live）':voiceState==='speaking'?'停止播报':'停止播报（当前未播放）';stopButton.setAttribute('aria-label',stopButton.title);
    const emptyThread=!(data.tasks.length>0||Boolean(data.messages?.length));
    root.querySelector('.bubble').hidden=!emptyThread;quickStart.hidden=!emptyThread;
    const taskSignature=JSON.stringify([data.tasks.map(t=>[t.taskId,t.createdAt,t.state,t.revision,t.userMessage,t.resultSummary,t.error?.message,t.steps?.map(s=>[s.stepId,s.status,s.label])]),data.messages,data.approvals]);
    const thinkingGrid='<span class="thinking-grid" aria-hidden="true">'+[0,1,2,3,4,5,6,7,8].map(index=>`<i data-cell="${index}"></i>`).join('')+'</span>';
    const focused=tasksNode.contains(document.activeElement)?document.activeElement:null;
    if(taskSignature!==lastTaskSignature) updateConversationTurns(tasksNode,conversationTimeline(data.tasks,data.messages).map(entry=>{if(entry.kind==='message'){const m=entry.value;const body=`<div class="${m.role==='user'?'user-message':'assistant-message'}">${escape(m.text)}</div><div class="response-actions"><button type="button" data-ui-action="copy" data-message-id="${escape(m.id)}" title="复制" aria-label="复制语音消息">${responseIcons.copy}</button></div>`;return `<article class="task turn" data-turn="live:${escape(m.id)}">${m.role==='assistant'?`<div class="assistant-turn">${body}</div>`:body}</article>`;}const t=entry.value;const terminal=isTerminal(t);const waiting=['waiting_approval','waiting_external','waiting_reconciliation','cancelling'].includes(t.state);const activeStep=Array.isArray(t.steps)&&t.steps.length?t.steps[t.steps.length-1]:null;const activity=waiting?stateNames[t.state]:activeStep?.label?activeStep.label:t.state==='verifying'?'整理回答':t.state==='running'?'执行中':'思考中';const answer=resultText(t.resultSummary,t.resultMetadata);const failure=t.error?.message;const answerActions=answer?`<div class="response-actions"><button type="button" data-ui-action="copy" data-id="${escape(t.taskId)}" title="复制" aria-label="复制回答">${responseIcons.copy}</button><button type="button" data-ui-action="share" data-id="${escape(t.taskId)}" title="分享" aria-label="分享回答">${responseIcons.share}</button><button type="button" data-ui-action="like" data-id="${escape(t.taskId)}" title="点赞" aria-label="点赞回答" aria-pressed="${likedTasks.has(t.taskId)}" class="${likedTasks.has(t.taskId)?'active':''}">${responseIcons.like}</button></div>`:'';return `<article class="task turn" data-turn="${escape(t.taskId)}">${t.userMessage?`<div class="user-message">${escape(t.userMessage)}</div>`:''}<div class="assistant-turn">${!terminal?`<div class="thinking-line">${thinkingGrid}<span>${escape(activity)}</span></div>`:answer?`<div class="assistant-message">${escape(answer)}</div>${answerActions}`:failure?`<div class="assistant-error">${escape(failure)}</div><div class="locate-block" data-locate-for="${escape(t.taskId)}"><button type="button" class="turn-action" data-ui-action="locate" data-locate-id="${escape(t.taskId)}" data-locate-text="${escape(failure)}" aria-label="定位失败原因">定位失败原因</button><div class="locate-result" hidden></div></div>`:''}</div>${t.state==='waiting_reconciliation'?`<p class="notice">原任务结果尚未核实，当前对话需等待实际终态。核实并结束只检查已记录的执行结果；无法确认时会保留待核实状态，不重发操作。</p><button type="button" class="turn-action" data-action="task.reconcile.finish" data-id="${escape(t.taskId)}">核实并结束</button>`:''}${!terminal?`<div class="turn-actions"><button class="turn-action" data-action="task.cancel" data-id="${escape(t.taskId)}" ${t.state==='cancelling'?'disabled':''}>停止</button>${data.fake?`<button class="turn-action" data-action="test.advance" data-id="${escape(t.taskId)}">推进联调</button>`:''}</div>`:''}</article>`;}).join(''),{tasks:data.tasks,pendingCancelIds,cancelSelector:'[data-action="task.cancel"]',cancelAttribute:'id'});
    projectLocateFeedback();syncCancelButtons();restoreTaskActionFocus(focused);
    refreshApprovalCards();scheduleApprovalExpiry();setSendMode(Boolean(input.value.trim()));
    if(taskSignature!==lastTaskSignature){lastTaskSignature=taskSignature;updateRail();requestAnimationFrame(()=>{if(followLock.atBottom){followLock.markProgrammatic();thread.scrollTop=thread.scrollHeight;}});}};
}
// These cards belong to the canonical user conversation, including requests from its workers.
// Keep their DOM outside the task projection so unrelated progress snapshots preserve focus.
const authorizationThread=root.querySelector(mode==='workspace'?'#workspace-stage':'.thread');
if(bridge&&authorizationThread) {
  const questionRoot=document.createElement('div');authorizationThread.append(questionRoot);
  const previousRender=render;
  let questionClosed=false,questionSnapshotRevision=0;
  const questions=mountAuthorizationQuestionCards(questionRoot,{invoke,onPending:({questionId})=>{
    // Run after the ordinary task projection's follow-to-bottom callback. A new
    // question must be discoverable at its heading, without repeatedly moving
    // history or taking keyboard focus on unrelated progress snapshots.
    requestAnimationFrame(()=>{if(questionClosed)return;
      const element=[...questionRoot.querySelectorAll('[data-question-id]')].find(node=>node.dataset.questionId===questionId);
      if(element?.isConnected&&element.querySelector('[data-authorization-decision]:not(:disabled)'))
        element.querySelector('.authorization-question-title')?.scrollIntoView({block:'start',behavior:'instant'});});
  },onChanged:async()=>{
    const revision=questionSnapshotRevision,snapshot=await invoke('snapshot');
    if(!questionClosed&&questionSnapshotRevision===revision)render(snapshot);
  }});
  render=(data,...options)=>{
    questionSnapshotRevision++;
    previousRender(data,...options);
    // Missing conversation identity must not widen the view to another conversation's questions.
    const conversationId=data.conversationState?.activeId;
    questions.update(conversationId?data.authorizationQuestions:[],{conversationId});
  };
  render.setAudioLevel=previousRender.setAudioLevel;
  window.addEventListener('unload',()=>{questionClosed=true;questions.dispose();},{once:true});
}
if(bridge&&['admin','workspace'].includes(mode)) {
  mountWindowControls(root,invoke,mode,error=>{
    root.querySelector(mode==='admin'?'#error':'#workspace-error').textContent=error.message;
  });
}
if(bridge&&['subagent','subagent-list'].includes(mode)){
  const unsubscribe=bridge.subscribe(()=>{void render();});
  window.addEventListener('unload',unsubscribe,{once:true});
}
else if(bridge){
  let receivedUpdate=false,closed=false;
  if(mode!=='orb') {
    const snapshotFeedback=document.createElement('p');snapshotFeedback.className='error';
    snapshotFeedback.setAttribute('role','alert');snapshotFeedback.setAttribute('data-snapshot-error','');snapshotFeedback.hidden=true;
    root.querySelector('.thread,.workspace-chat,.admin .main').prepend(snapshotFeedback);
    reportSnapshotFailure=error=>{snapshotFeedback.textContent=`状态读取失败：${error.message}`;snapshotFeedback.hidden=false;};
    clearSnapshotFailure=()=>{snapshotFeedback.textContent='';snapshotFeedback.hidden=true;};
  }
  const unsubscribeLevel=bridge.onAudioLevel?.(value=>{if(closed)return;orb?.setLevel(value);render?.setAudioLevel?.(value);})??(()=>{});
  const unsubscribe=bridge.subscribe(data=>{if(closed)return;activeDesktopConversationId=data.conversationState?.activeId;render(data);receivedUpdate=true;clearSnapshotFailure();});
  invoke('snapshot').then(data=>{if(!closed&&!receivedUpdate){activeDesktopConversationId=data.conversationState?.activeId;render(data);clearSnapshotFailure();}}).catch(e=>{
    if(closed||receivedUpdate)return;
    reportSnapshotFailure(e);
  });
  window.addEventListener('unload',()=>{closed=true;unsubscribe();unsubscribeLevel();orb?.dispose();});
}
else root.textContent='桌面桥未连接，请从 PersonalAgent 桌面应用启动。';
