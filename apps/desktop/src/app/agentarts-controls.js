import {mountF23EvaluationControls} from './f23-evaluation-controls.js';
export function mountAgentArtsControls(root,invoke) {
  const section=document.createElement('section');section.className='sheet coding-workspace agentarts-settings';
  section.innerHTML='<h2>AgentArts 主智能体</h2><p class="notice" data-transport-state></p><form class="settings-form"><label>网关地址<input name="gatewayUrl" type="url" autocomplete="off" placeholder="https://…huaweicloud-agentarts.com" required></label><label>运行时实例名称<input name="runtimeName" autocomplete="off" required></label><label>平台 Authorization<input name="authorization" type="password" autocomplete="new-password" spellcheck="false" placeholder="控制台 API 示例中的完整值；留空沿用同一实例凭据"></label><p class="notice">普通连接默认使用 HTTPS 和 Latest 部署版本；实际版本以服务读回为准。</p><details class="connection-advanced" data-connection-advanced><summary>高级连接设置（可选）</summary><label>固定部署版本<input name="deploymentVersion" autocomplete="off" maxlength="128" placeholder="与当前部署 endpoint 版本一致"></label><label>任务主通道<select name="transport"><option value="https">HTTPS 兼容连接</option><option value="wss">WSS 实时连接</option></select></label><div data-wss><label>精确 WSS 地址<input name="websocketUrl" type="url" autocomplete="off" spellcheck="false" placeholder="wss://同一网关/runtimes/实例/ws?endpoint=版本"></label><label>独立镜像访问令牌<input name="appToken" type="password" autocomplete="new-password" spellcheck="false" placeholder="至少 32 位可见字符；已有凭据时留空沿用"></label><p class="notice" data-token-hint></p><label><input name="allowHttpsFallback" type="checkbox">允许 HTTPS 备用连接</label><p class="notice">仅在尚未发送调用时允许切换备用连接；结果未知时不会自动重发。</p></div></details><p class="notice">凭据只在本机加密保存。更换运行时、连接方式或地址后需要重启应用。</p><div class="btn-group"><button type="submit" class="btn btn-primary">保存 AgentArts 配置</button><button type="button" data-revoke class="btn btn-secondary btn-danger">清除并撤销凭据</button></div><p data-status class="notice" role="status"></p></form>';
  section.querySelector('.btn-group').insertAdjacentHTML('beforeend','<button type="button" data-restore-default class="btn btn-secondary">恢复默认连接（HTTPS / Latest）</button>');
  section.querySelector('[data-status]').insertAdjacentHTML('beforebegin','<p class="notice">恢复默认连接只使用当前已保存的实例，保留本机凭据，不保存表单草稿、不重放原任务。Latest 表示未钉版，实际版本以服务读回为准。Live 实时音频仍需支持原生实时协议的固定版本 WSS，HTTPS 不能代替。</p>');
  root.append(section);const form=section.querySelector('form'),status=section.querySelector('[data-status]'),revokeBtn=section.querySelector('[data-revoke]'),restoreBtn=section.querySelector('[data-restore-default]');let dirty=false,busy=false,canRestoreDefault=false,feedbackKind='host',lastHostReason='',feedbackMessage='';
  const evaluationControls=mountF23EvaluationControls(section,invoke);
  let savedBinding;
  const releaseFields=['runtimeId','endpointId','endpointName','registryRepository','imageReference'];
  form.insertAdjacentHTML('beforeend','<details class="connection-advanced"><summary>固定镜像验收</summary><p>填写平台固定版本对应的运行时与端点。构建产生镜像摘要后核对部署；不会自动更改路由。</p>'+[
    ['runtimeId','运行时 ID'],['endpointId','端点 ID'],['endpointName','端点名称'],
    ['registryRepository','SWR 仓库地址（不含标签）'],['imageReference','期望镜像摘要（可选）']
  ].map(([name,label])=>'<label>'+label+'<input name="'+name+'" autocomplete="off"></label>').join('')+'</details>');
  form.insertAdjacentHTML('afterend','<details class="connection-advanced"><summary>历史任务回放</summary><p class="notice">仅查看同一对话中已经结束的原执行记录，不重新调用模型或执行工具。其他任务执行期间暂停回放；发送回放结果仍需单独确认。</p><button type="button" class="btn" data-trace-replay>开启历史回放</button><p class="notice" role="status" data-trace-replay-state></p></details>');
  const traceReplayButton=section.querySelector('[data-trace-replay]'),traceReplayState=section.querySelector('[data-trace-replay-state]');
  let traceReplay;
  function renderTraceReplay(){
    traceReplayButton.disabled=busy||traceReplay?.available!==true||!Number.isSafeInteger(traceReplay?.revision);
    traceReplayButton.textContent=traceReplay?.enabled?'关闭历史回放':'开启历史回放';
    traceReplayState.textContent=traceReplay?.available!==true?'配置固定 AgentArts 部署后可用。':traceReplay.enabled?'已开启；每次只读原记录。':'当前关闭。';
  }
  form.insertAdjacentHTML('afterend','<details class="connection-advanced"><summary>知识数据范围</summary><p class="notice">暂存当前知识源的范围提案，再在对话中请求应用数据范围。实际修改前会单独确认；保存配置不表示服务已连通。</p><form data-data-scope class="settings-form"><label>数据分类<select name="dataLevel"><option value="private">私密</option><option value="public">公开</option></select></label><label><input name="cloudExportAllowed" type="checkbox">允许选定公开查询用于云任务</label><label>公开查询（每行一条，最多 16 条）<textarea name="publicQueries" rows="3" maxlength="2063" autocomplete="off" placeholder="仅填写明确可以公开的查询"></textarea></label><button type="submit" class="btn">暂存范围提案</button><p class="notice" role="status" data-data-scope-state></p></form></details>');
  const scopeForm=section.querySelector('[data-data-scope]'),scopeState=section.querySelector('[data-data-scope-state]');
  let dataScope,scopeDirty=false;
  function renderDataScope(){
    scopeForm.querySelectorAll('input,select,textarea,button').forEach(control=>{control.disabled=busy||dataScope?.available!==true||dataScope?.accountConfigured!==true;});
    if(!scopeDirty&&!busy){scopeForm.elements.dataLevel.value=dataScope?.dataLevel??'private';scopeForm.elements.cloudExportAllowed.checked=dataScope?.cloudExportAllowed===true;}
    scopeState.textContent=dataScope?.available!==true?'请先配置固定 AgentArts 部署与知识源。':dataScope.accountConfigured!==true?'请先保存 AgentArts 账户配置。':
      dataScope.configured?(dataScope.stage==='saved'?'范围已保存并读回；':'提案已暂存，尚未应用；')+'服务连通性与模型能力尚未验证。':'尚未暂存范围提案。';
  }
  let originatingFocus,restoreFocus=false;
  form.insertAdjacentHTML('afterend','<details class="connection-advanced"><summary>决策评估基线</summary><p class="notice">将已保存的当前主模型作为后续重新规划的评估基线。初始化需要单独确认，后续候选须通过评测才能晋升。</p><button type="button" class="btn" data-decision-initialize>初始化当前模型基线</button><p class="notice" role="status" data-decision-state></p></details>');
  const decisionButton=section.querySelector('[data-decision-initialize]'),decisionState=section.querySelector('[data-decision-state]');
  let decisionConfiguration,decisionPending=false;
  function renderDecision(){
    if(decisionConfiguration?.initialization)decisionPending=!['succeeded','failed','cancelled'].includes(decisionConfiguration.initialization.state);
    decisionButton.disabled=busy||decisionPending||decisionConfiguration?.available!==true||decisionConfiguration?.initialized===true;
    if(decisionConfiguration?.initialized)decisionState.textContent=`已读回基线版本 ${decisionConfiguration.binding.configuration.revision}，模型 ${decisionConfiguration.binding.executionModel.modelId}；评测尚未通过。`;
    else if(!decisionPending)decisionState.textContent=decisionConfiguration?.available?'尚未初始化。':'请先配置固定部署并读取模型目录。';
  }
  decisionButton.addEventListener('click',async()=>{
    if(decisionButton.disabled)return;decisionPending=true;setBusy(true);decisionState.textContent='正在提交原确认请求…';
    try{const result=await invoke('workflow.decisionConfiguration.initialize',{commandId:crypto.randomUUID(),catalogRevision:decisionConfiguration.catalogRevision});
      decisionState.textContent=result?.taskId?'已受理，请处理原任务授权卡；受理不表示基线已保存。':'结果尚未确认，请查看原任务。';}
    catch{decisionState.textContent='结果尚未确认，请查看原任务及已保存基线。';}
    finally{setBusy(false);}
  });
  const tokenHint=section.querySelector('[data-token-hint]');
  const updateTransport=()=>{const wss=form.elements.transport.value==='wss';
    section.querySelector('[data-wss]').hidden=!wss;form.elements.websocketUrl.required=wss;
    const advanced=section.querySelector('[data-connection-advanced]');if(wss&&!form.elements.websocketUrl.value.trim()&&advanced)advanced.open=true;};
  // A pasted pinned address already carries the deployment version; filling it here keeps the
  // form from rejecting a URL the console hands out verbatim.
  const syncDeploymentFromUrl=()=>{const field=form.elements.deploymentVersion;if(!field)return;
    const match=/[?&]endpoint=([A-Za-z0-9_.-]{1,128})/.exec(form.elements.websocketUrl?.value??'');
    if(match&&!field.value.trim())field.value=match[1];};
  // Host validation messages are the actionable part of a failed save; anything else stays generic
  // so an unexpected path or diagnostic never reaches the screen.
  const safeMessage=(error,fallback)=>{const message=typeof error?.message==='string'?error.message.trim():'';
    return message&&message.length<=240&&/^(请填写|请从|请先|首次配置|目的地或部署|本机安全存储|WSS 地址|AgentArts|“独立镜像访问令牌”|“固定部署版本”)/.test(message)?message:fallback;};
  const clearSecrets=()=>{form.elements.authorization.value='';form.elements.appToken.value='';};
  const trackFocus=event=>{if(!form.contains(event.target) && event.target!==document.body) restoreFocus=false;};
  function setBusy(value) {
    if(value) {
      originatingFocus=form.contains(document.activeElement)?document.activeElement:undefined;
      restoreFocus=Boolean(originatingFocus);
      document.addEventListener('focusin',trackFocus,true);
    }
    busy=value;form.setAttribute('aria-busy',String(value));
    form.querySelectorAll('input,select,button').forEach(control=>{control.disabled=value;});
    restoreBtn.disabled=value||!canRestoreDefault;
    renderTraceReplay();
    renderDataScope();
    renderDecision();
    if(!value) {
      document.removeEventListener('focusin',trackFocus,true);
      if(restoreFocus && document.activeElement===document.body && section.isConnected && !section.hidden
        && section.getClientRects().length && originatingFocus?.isConnected && form.contains(originatingFocus)
        && !originatingFocus.disabled) originatingFocus.focus();
      originatingFocus=undefined;restoreFocus=false;
    }
  }
  function displayFeedback(message,error=false) {
    feedbackMessage=message;
    status.textContent=dirty&&!busy&&!error ? '配置有未保存的修改。'+(message?' 当前已保存配置状态：'+message:'') : message;
    status.setAttribute('role',error?'alert':'status');
  }
  function feedback(message,error=false) {feedbackKind=error?'unconfirmed':'operation';displayFeedback(message,error);}
  const displayTransport=value=>{
    const transportState=section.querySelector('[data-transport-state]');if(!transportState)return;
    const deployment=typeof value.deploymentVersion==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(value.deploymentVersion)
      ?'固定部署 '+value.deploymentVersion:'默认 Latest（未钉版，实际版本未读回）';
    transportState.textContent='当前通道：'+(value.effectiveTransport??value.transport??'https').toUpperCase()
      +(value.transportSource==='environment'?'（主机环境覆盖）':value.transportSource==='saved'?'（本机保存）':'（默认）')+'；'+deployment;
  };
  form.addEventListener('input',()=>{dirty=true;syncDeploymentFromUrl();updateTransport();if (!busy && feedbackKind!=='unconfirmed') displayFeedback(feedbackMessage);});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if (busy) return;setBusy(true);feedback('正在保存配置…');
    syncDeploymentFromUrl();
    const input=Object.fromEntries(['gatewayUrl','runtimeName','authorization'].map(key=>[key,form.elements[key].value.trim()]));
    input.transport=form.elements.transport?.value??'https';input.websocketUrl=form.elements.websocketUrl?.value.trim()??'';input.allowHttpsFallback=form.elements.allowHttpsFallback?.checked??false;
    if(form.elements.deploymentVersion)input.deploymentVersion=form.elements.deploymentVersion.value.trim();
    if(form.elements.registryRepository){
      const release=Object.fromEntries(releaseFields.map(key=>[key,form.elements[key].value.trim()]).filter(([,value])=>value));
      input.releaseBinding=Object.keys(release).length?release:null;
    }
    if(input.transport==='wss') input.appToken=form.elements.appToken.value;
    const pendingSecrets={authorization:form.elements.authorization.value,appToken:form.elements.appToken.value};
    clearSecrets();
    try {const result=await invoke('agentarts.configure',input);if (result?.configured!==true) throw Error();dirty=false;feedback(result.reason || '配置已保存。');}
    catch (error) {
      // The typed credentials are still valid input; losing them on a rejected save forced a retype.
      if(!form.elements.authorization.value) form.elements.authorization.value=pendingSecrets.authorization;
      if(!form.elements.appToken.value) form.elements.appToken.value=pendingSecrets.appToken;
      feedback(safeMessage(error,'保存结果未获确认，请检查配置状态后再操作。'),true);
    }
    finally {input.authorization='';if('appToken' in input) input.appToken='';setBusy(false);}
  });
  revokeBtn?.addEventListener('click',async()=>{
    if (busy) return;setBusy(true);feedback('正在撤销凭据…');clearSecrets();
    try {const result=await invoke('agentarts.revoke');if (result?.configured!==false) throw Error();dirty=false;form.reset();updateTransport();feedback(result.reason || '凭据已清除。');}
    catch {feedback('撤销结果未获确认，请检查配置状态和本机存储后重试。',true);}
    finally {setBusy(false);}
  });
  restoreBtn.addEventListener('click',async()=>{
    if(busy||!canRestoreDefault)return;
    const originalBinding=savedBinding;setBusy(true);feedback('正在保存默认连接…');clearSecrets();
    try {
      const result=await invoke('agentarts.restoreDefaultConnection');
      if(result?.configured!==true||(result.effectiveTransport??result.transport)!=='https'
        ||result.deploymentVersion!==''||result.websocketUrl!==''||result.allowHttpsFallback!==false
        ||result.gatewayUrl!==originalBinding?.gatewayUrl||result.runtimeName!==originalBinding?.runtimeName)throw Error();
      dirty=false;form.elements.gatewayUrl.value=result.gatewayUrl;form.elements.runtimeName.value=result.runtimeName;
      form.elements.transport.value='https';form.elements.websocketUrl.value='';form.elements.deploymentVersion.value='';
      form.elements.allowHttpsFallback.checked=false;updateTransport();displayTransport(result);
      feedback('已保存默认连接：HTTPS / Latest（未钉版，实际版本未读回）。'+(result.reason||'请按应用提示重新绑定；不会自动重放原任务。'));
    }catch{feedback('恢复结果未获确认，请检查当前已保存配置后再操作。',true);}
    finally{setBusy(false);}
  });
  traceReplayButton.addEventListener('click',async()=>{
    if(busy||traceReplayButton.disabled)return;
    const original=traceReplay,enabled=!original.enabled;let message;
    setBusy(true);
    try{
      const result=await invoke('workflow.traceReplay.configure',{enabled,expectedRevision:original.revision});
      if(result?.traceReplay?.enabled!==enabled||result.traceReplay.revision!==original.revision+1)throw Error();
      traceReplay=result.traceReplay;message=enabled?'历史回放已开启。':'历史回放已关闭。';
    }catch{message='设置变更尚未确认，请查看最新状态后再操作。';}
    finally{setBusy(false);traceReplayState.textContent=message;}
  });
  scopeForm.addEventListener('input',()=>{scopeDirty=true;});
  scopeForm.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||dataScope?.available!==true||dataScope?.accountConfigured!==true)return;
    const original=dataScope,input={expectedRevision:original.revision,dataLevel:scopeForm.elements.dataLevel.value,
      cloudExportAllowed:scopeForm.elements.cloudExportAllowed.checked,
      publicQueries:scopeForm.elements.publicQueries.value.split(/\r?\n/u).map(value=>value.trim()).filter(Boolean)};
    let message;setBusy(true);
    try{
      const result=await invoke('workflow.dataScope.configure',input),saved=result?.dataScope;
      if(saved?.configured!==true||saved.stage!=='selected'||saved.revision!==original.revision+1
        ||saved.dataLevel!==input.dataLevel||saved.cloudExportAllowed!==input.cloudExportAllowed)throw Error();
      dataScope=saved;scopeDirty=false;scopeForm.elements.publicQueries.value='';message='提案已暂存。请在对话中请求应用数据范围；实际修改仍需确认。';
    }catch{message='范围提案未获确认，请检查当前账户、知识源及公开查询后再操作。';}
    finally{setBusy(false);scopeState.textContent=message;}
  });
  return {show:value=>{section.hidden=!value;if(!value) restoreFocus=false;},render(value={}){
    evaluationControls.render(value.evaluation);
    traceReplay=value.traceReplay;renderTraceReplay();
    dataScope=value.dataScope;renderDataScope();
    decisionConfiguration=value.decisionConfiguration;renderDecision();
    canRestoreDefault=(value.canRestoreDefaultConnection??value.configured)===true;
    savedBinding={gatewayUrl:value.gatewayUrl,runtimeName:value.runtimeName};restoreBtn.disabled=busy||!canRestoreDefault;
    if (!dirty && !busy) {form.elements.gatewayUrl.value=value.gatewayUrl??'';form.elements.runtimeName.value=value.runtimeName??'';
      form.elements.transport.value=value.transport??'https';form.elements.websocketUrl.value=value.websocketUrl??'';
      form.elements.allowHttpsFallback.checked=value.allowHttpsFallback===true;updateTransport();}
    displayTransport(value);
    if(!dirty&&!busy&&form.elements.deploymentVersion)form.elements.deploymentVersion.value=value.deploymentVersion??'';
    if(!dirty&&!busy)for(const key of releaseFields)if(form.elements[key])form.elements[key].value=value.releaseBinding?.[key]??'';
    if(form.elements.appToken)form.elements.appToken.placeholder=value.appTokenConfigured?'已安全保存；同一实例留空保留':'WSS 必需；仅在本机加密保存';
    if(tokenHint) tokenHint.textContent=value.appTokenConfigured===true
      ? '独立镜像访问令牌已在本机加密保存；留空沿用，填写则覆盖。'
      : '首次配置 WSS 主通道必填：至少 32 位可见字符。';
    const reason=typeof value.reason==='string'?value.reason:'';
    if (!busy && feedbackKind!=='unconfirmed' && (feedbackKind==='host' || reason!==lastHostReason)) {
      displayFeedback(reason);feedbackKind='host';
    }
    lastHostReason=reason;
  }};
}
