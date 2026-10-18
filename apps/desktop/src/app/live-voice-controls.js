const liveAudioFailureLabels=Object.freeze({PCM_FRAME_INVALID:'采集音频帧格式无效',CONNECTION_CLOSED:'实时连接已关闭',SEND_BACKPRESSURE:'网络发送阻塞',SEND_FAILED:'音频传输发送失败'});
export function liveAudioFailureText(live){const code=live?.audioSendFailure?.code;return Object.hasOwn(liveAudioFailureLabels,code)?liveAudioFailureLabels[code]+'（'+code+'）':'';}
export function liveWorkFeedbackText(live){
  const work=live?.workRequests?.at(-1);if(!work)return '';
  if(work.state==='submitting')return '正在提交工作请求，尚未确认受理';
  if(work.state==='failed')return '工作请求受理未确认；请先核实任务状态，避免重复派发';
  if(!work.taskId)return '';
  if(work.state==='result_returned')return '任务回执已返回；不代表子任务成功或已独立验证';
  return '任务已受理（'+work.taskId+'）'+(work.state==='awaiting_result'?'，结果尚待核实':'，正在等待结果')+'；受理不代表已派发子任务';
}
export function mountLiveVoiceControls(root, invoke, {compact = false} = {}) {
  if (compact) return mountCompactLiveVoiceControls(root, invoke);
  const settings = document.createElement('details');
  settings.className = 'sis-settings';
  settings.innerHTML = '<summary>Live 实时语音设置</summary><div class="sis-fields"><p class="notice">千问负责实时听说；工作由同一个 AgentArts 主智能体执行。使用百炼北京业务空间。</p><label>业务空间 ID<input id="live-workspace" autocomplete="off" maxlength="128"></label><label>百炼 API Key<input id="live-key" type="password" autocomplete="off" maxlength="4096" placeholder="仅在本机加密保存"></label><label>启停快捷键<select id="live-hotkey">'+Array.from({length:24},(_,i)=>`<option value="F${i+1}"${i===7?' selected':''}>F${i+1}</option>`).join('')+'</select></label><label><input id="live-consent" type="checkbox">开启 Live 时将麦克风音频和对话上下文发送到阿里云，用于实时对话</label><button id="live-save" type="button">保存 Live 配置</button><p class="notice" id="live-config-result" role="status"></p></div>';
  const status = document.createElement('p'); status.className = 'notice'; status.setAttribute('role', 'status');
  root.querySelector('#error').before(settings, status);
  const key = settings.querySelector('#live-key'), workspace = settings.querySelector('#live-workspace');
  const hotkey = settings.querySelector('#live-hotkey'), consent = settings.querySelector('#live-consent');
  const reserved=[...hotkey.options].find(option=>option.value === 'F9');
  if (reserved) {reserved.disabled=true;reserved.textContent='F9（记事本写入确认）';}
  const result = settings.querySelector('#live-config-result');
  let editing = false, editRevision = 0, saving = false;
  let pendingToggle, toggleRevision = 0, liveActive = false;
  let toggleErrorOwner;
  settings.addEventListener('input', () => {editing = true; editRevision++;});
  settings.querySelector('#live-save').onclick = async () => {
    if (saving) return;
    saving = true; editing = true;
    const submittedRevision = editRevision;
    const button = settings.querySelector('#live-save'); button.disabled = true;
    const request = {workspaceId: workspace.value.trim(), apiKey: key.value.trim(), hotkey: hotkey.value, audioConsent: consent.checked};
    key.value = ''; toggleErrorOwner = undefined; result.textContent = '正在加密保存…';
    try {
      await invoke('live.configure', request);
      editing = editRevision !== submittedRevision;
      toggleErrorOwner = undefined;
      result.textContent = editing ? '已保存本次提交；新修改尚未保存。' : '已保存；点圆形语音按钮或按快捷键开始 Live。';
      if (!editing) settings.open = false;
    }
    catch (error) {toggleErrorOwner = undefined; result.textContent = error.message;}
    finally {request.apiKey = ''; saving = false; button.disabled = false;}
  };
  return {
    showSettings(show, expanded = false) {
      settings.hidden = !show; status.hidden = !show;
      if (show && expanded) settings.open = true;
    },
    async toggle() {
      const action = liveActive ? 'stop' : 'start';
      if (pendingToggle && !(pendingToggle === 'start' && action === 'stop')) return;
      pendingToggle = action;
      const revision = ++toggleRevision;
      const previousErrorOwner = toggleErrorOwner;
      try {
        await invoke('live.toggle');
        if (revision === toggleRevision && previousErrorOwner && toggleErrorOwner === previousErrorOwner) {
          toggleErrorOwner = undefined; result.textContent = '';
        }
      }
      catch (error) {if (revision === toggleRevision) {toggleErrorOwner = {}; result.textContent = error.message; settings.open = true;}}
      finally {if (revision === toggleRevision) pendingToggle = undefined;}
    },
    render(live = {}) {
      liveActive = live.active === true;
      const viaAgentArts=live.provider==='agentarts';const workspaceLabel=workspace.closest?.('label'),keyLabel=key.closest?.('label');if(workspaceLabel)workspaceLabel.hidden=viaAgentArts;if(keyLabel)keyLabel.hidden=viaAgentArts;
      const routeNotice=settings.querySelector('.notice');if(routeNotice)routeNotice.textContent=viaAgentArts?'实时听说经 AgentArts WSS 转发至百炼；工作由同一个 AgentArts 主智能体执行。旧独立 API 配置保留。':'千问负责实时听说；工作由同一个 AgentArts 主智能体执行。使用百炼北京业务空间。';
      if(consent.parentElement?.lastChild)consent.parentElement.lastChild.textContent=viaAgentArts?'开启 Live 时将麦克风音频和对话上下文经 AgentArts 发送到百炼，用于实时对话':'开启 Live 时将麦克风音频和对话上下文发送到阿里云，用于实时对话';
      settings.querySelector('summary').textContent=live.configured?'Live 实时语音设置 · 已配置':'Live 实时语音设置';
      key.placeholder=live.configured?'已安全保存；留空保留现有密钥':'仅在本机加密保存';
      if (!editing) {workspace.value = live.workspaceId ?? ''; hotkey.value = live.hotkey ?? 'F8'; consent.checked = live.audioConsent??Boolean(live.configured);}
      const names = {connecting:'正在连接',reconnecting:'正在续接',listening:'正在聆听',speaking:'正在回答',working:'主智能体正在处理任务',stopping:'正在关闭',idle:live.configured?'已就绪，未开启麦克风':'未配置',error:live.audioSendFailure?'音频发送失败':'连接失败'};
      status.textContent = `Live：${names[live.status] ?? '未配置'} · ${live.shortcut?.key ?? 'F8'} 开启 / 关闭`;
      if(live.route)status.textContent+=' · '+live.route;
      const audioFailure=liveAudioFailureText(live);if(audioFailure)status.textContent+=' · '+audioFailure;
      if(live.active&&live.conversationTitle)status.textContent+=' · 通话对话：'+live.conversationTitle;
      if (live.status === 'error' || !live.configured) status.textContent += ` · ${live.reason ?? '请先配置'}`;
      if (live.shortcut?.reason) status.textContent += ` · ${live.shortcut.reason}`;
      const workFeedback=liveWorkFeedbackText(live);if(workFeedback)status.textContent+=' · '+workFeedback;
    },
  };
}

function mountCompactLiveVoiceControls(root, invoke) {
  const controls=document.createElement('div');controls.className='voice-runtime-controls';
  controls.innerHTML='<p class="notice" role="status" id="live-runtime-status"></p><button type="button" class="btn btn-sm" id="live-open-settings">语音设置</button>';
  root.querySelector('#error').before(controls);
  const status=controls.querySelector('#live-runtime-status');
  let liveActive=false,pendingToggle,toggleRevision=0;
  controls.querySelector('#live-open-settings').onclick=()=>invoke('admin.open',{page:'voice'}).catch(error=>{status.textContent=error.message;});
  return {
    showSettings(){},
    async toggle(){
      const action=liveActive?'stop':'start';
      if(pendingToggle&&!(pendingToggle==='start'&&action==='stop'))return;
      pendingToggle=action;const revision=++toggleRevision;
      try{await invoke('live.toggle');}
      catch(error){if(revision===toggleRevision)status.textContent=error.message;}
      finally{if(revision===toggleRevision)pendingToggle=undefined;}
    },
    render(live={}){
      liveActive=live.active===true;
      const names={connecting:'正在连接',reconnecting:'正在续接',listening:'正在聆听',speaking:'正在回答',working:'主智能体正在处理任务',stopping:'正在关闭',
        idle:live.configured?'配置已保存，未开启麦克风':'未配置',error:live.audioSendFailure?'音频发送失败':'连接失败'};
      status.textContent=`Live：${names[live.status]??'状态未报告'} · ${live.shortcut?.key??live.hotkey??'F8'} 开启 / 关闭`;
      if(live.route)status.textContent+=' · '+live.route;
      const audioFailure=liveAudioFailureText(live);if(audioFailure)status.textContent+=' · '+audioFailure;
      if(live.active&&live.conversationTitle)status.textContent+=' · 通话对话：'+live.conversationTitle;
      if(live.status==='error'||!live.configured)status.textContent+=` · ${live.reason??'请到语音设置配置'}`;
      if(live.shortcut?.reason)status.textContent+=` · ${live.shortcut.reason}`;
      const workFeedback=liveWorkFeedbackText(live);if(workFeedback)status.textContent+=' · '+workFeedback;
    },
  };
}
