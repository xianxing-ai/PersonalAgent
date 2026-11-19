export function mountAgentArtsControls(root,invoke) {
  const section=document.createElement('section');section.className='sheet coding-workspace agentarts-settings';
  section.innerHTML='<h2>AgentArts 主智能体</h2><p class="notice" data-transport-state></p><form class="settings-form"><label>网关地址<input name="gatewayUrl" type="url" autocomplete="off" placeholder="https://…huaweicloud-agentarts.com" required></label><label>运行时实例名称<input name="runtimeName" autocomplete="off" required></label><label>平台 Authorization<input name="authorization" type="password" autocomplete="new-password" spellcheck="false" placeholder="控制台 API 示例中的完整值；留空沿用同一实例凭据"></label><p class="notice">普通连接默认使用 HTTPS 和 Latest 部署版本；实际版本以服务读回为准。</p><details class="connection-advanced" data-connection-advanced><summary>高级连接设置（可选）</summary><label>固定部署版本<input name="deploymentVersion" autocomplete="off" maxlength="128" placeholder="与当前部署 endpoint 版本一致"></label><label>任务主通道<select name="transport"><option value="https">HTTPS 兼容连接</option><option value="wss">WSS 实时连接</option></select></label><div data-wss><label>精确 WSS 地址<input name="websocketUrl" type="url" autocomplete="off" spellcheck="false" placeholder="wss://同一网关/runtimes/实例/ws?endpoint=版本"></label><label>独立镜像访问令牌<input name="appToken" type="password" autocomplete="new-password" spellcheck="false" placeholder="至少 32 位可见字符；已有凭据时留空沿用"></label><p class="notice" data-token-hint></p><label><input name="allowHttpsFallback" type="checkbox">允许 HTTPS 备用连接</label><p class="notice">仅在尚未发送调用时允许切换备用连接；结果未知时不会自动重发。</p></div></details><p class="notice">凭据只在本机加密保存。更换运行时、连接方式或地址后需要重启应用。</p><div class="btn-group"><button type="submit" class="btn btn-primary">保存 AgentArts 配置</button><button type="button" data-revoke class="btn btn-secondary btn-danger">清除并撤销凭据</button></div><p data-status class="notice" role="status"></p></form>';
  section.querySelector('.btn-group').insertAdjacentHTML('beforeend','<button type="button" data-restore-default class="btn btn-secondary">恢复默认连接（HTTPS / Latest）</button>');
  section.querySelector('[data-status]').insertAdjacentHTML('beforebegin','<p class="notice">恢复默认连接只使用当前已保存的实例，保留本机凭据，不保存表单草稿、不重放原任务。Latest 表示未钉版，实际版本以服务读回为准。Live 实时音频仍需支持原生实时协议的固定版本 WSS，HTTPS 不能代替。</p>');
  section.insertAdjacentHTML?.('beforeend','<details class="connection-advanced" data-observation-controls><summary>平台观测读回凭据（AK / SK / Application ID）</summary><p class="notice" data-observation-state>未配置观测 AK/SK；平台观测读回保持显式 unavailable。</p><form class="settings-form" data-observation-form><label>Access Key (AK)<input name="accessKey" autocomplete="off" spellcheck="false" minlength="10" maxlength="128" placeholder="华为云 IAM AK（10-128 位字母数字）" required></label><label>Secret Key (SK)<input name="secretKey" type="password" autocomplete="new-password" spellcheck="false" minlength="16" maxlength="256" placeholder="至少 16 位；仅在本机加密保存" required></label><label>Security Token（可选临时令牌）<input name="securityToken" type="password" autocomplete="new-password" spellcheck="false" maxlength="4096" placeholder="临时 AK/SK 时选填"></label><label>Application ID（可选）<input name="applicationId" autocomplete="off" maxlength="64" placeholder="AgentArts 应用 ID（1-64 位字母数字/下划线/连字符）"></label><div class="btn-group"><button type="submit" class="btn btn-sm">保存观测凭据</button><button type="button" class="btn btn-sm btn-danger" data-observation-revoke>清除并撤销观测凭据</button></div><p class="notice" data-observation-status role="status"></p></form></details>');
  root.append(section);const form=section.querySelector('form'),status=section.querySelector('[data-status]'),revokeBtn=section.querySelector('[data-revoke]'),restoreBtn=section.querySelector('[data-restore-default]');let dirty=false,busy=false,canRestoreDefault=false,feedbackKind='host',lastHostReason='',feedbackMessage='';
  const observationBox=section.querySelector('[data-observation-controls]'),observationForm=observationBox?.querySelector?.('[data-observation-form]'),observationState=observationBox?.querySelector?.('[data-observation-state]'),observationStatus=observationBox?.querySelector?.('[data-observation-status]'),observationRevoke=observationBox?.querySelector?.('[data-observation-revoke]');
  let observationBusy=false,observationDirty=false,lastObservation={};
  const displayObservation=(obs={},confirmed=false)=>{
    obs=obs??{};lastObservation=obs;
    if(!observationState)return;
    observationState.textContent=typeof obs.reason==='string'&&obs.reason?obs.reason:(obs.configured?'观测 AK/SK 已配置（需重启应用生效）':'未配置观测 AK/SK；平台观测读回保持显式 unavailable，不复用 invoke Bearer');
    if(observationForm?.elements?.applicationId&&(confirmed||(!observationBusy&&!observationDirty)))observationForm.elements.applicationId.value=obs.applicationId??'';
    if(observationRevoke)observationRevoke.disabled=observationBusy||(!obs.configured&&!obs.applicationIdConfigured);
  };
  if(observationForm&&observationStatus){
    observationForm.addEventListener('input',()=>{observationDirty=true;});
    const clearObservationSecrets=()=>{
      if(observationForm.elements.secretKey)observationForm.elements.secretKey.value='';
      if(observationForm.elements.securityToken)observationForm.elements.securityToken.value='';
    };
    const setObservationBusy=next=>{
      observationBusy=next;
      observationForm.querySelectorAll?.('input,button')?.forEach?.(node=>{node.disabled=next;});
      if(!next&&observationRevoke)observationRevoke.disabled=!lastObservation.configured&&!lastObservation.applicationIdConfigured;
    };
    observationForm.addEventListener('submit',async event=>{
      event.preventDefault();if(observationBusy)return;
      const ak=(observationForm.elements.accessKey?.value??'').trim();
      const sk=observationForm.elements.secretKey?.value??'';
      const st=(observationForm.elements.securityToken?.value??'').trim();
      const appId=(observationForm.elements.applicationId?.value??'').trim();
      const payload={accessKey:ak,secretKey:sk,...(st?{securityToken:st}:{}),...(appId?{applicationId:appId}:{})};
      const pendingSecrets={secretKey:sk,securityToken:observationForm.elements.securityToken?.value??''};
      clearObservationSecrets();
      setObservationBusy(true);observationStatus.textContent='正在保存观测凭据…';observationStatus.setAttribute('role','status');
      try{
        const result=await invoke('agentarts.observation.configure',payload);
        if(result?.configured!==true)throw Error('观测凭据配置未获确认');
        observationDirty=false;displayObservation(result,true);
        observationStatus.textContent=result.reason||'观测凭据已加密保存；请重启应用以注入 observationAuthorization。';
      }catch(error){
        if(observationForm.elements.secretKey&&!observationForm.elements.secretKey.value)observationForm.elements.secretKey.value=pendingSecrets.secretKey;
        if(observationForm.elements.securityToken&&!observationForm.elements.securityToken.value)observationForm.elements.securityToken.value=pendingSecrets.securityToken;
        observationStatus.textContent=typeof error?.message==='string'&&/观测|重启|安全存储|任务/.test(error.message)?error.message:'观测凭据保存未获确认，请检查 AK（10-128 位）、SK（16-256 位）和 Application ID 格式。';
        observationStatus.setAttribute('role','alert');
      }finally{payload.secretKey='';if('securityToken'in payload)payload.securityToken='';pendingSecrets.secretKey='';pendingSecrets.securityToken='';setObservationBusy(false);}
    });
    observationRevoke?.addEventListener('click',async()=>{
      if(observationBusy)return;
      clearObservationSecrets();setObservationBusy(true);observationStatus.textContent='正在清除观测凭据…';observationStatus.setAttribute('role','status');
      try{
        const result=await invoke('agentarts.observation.revoke');
        if(result?.configured!==false)throw Error('撤销结果未获确认');
        observationForm.reset?.();observationDirty=false;displayObservation(result,true);
        observationStatus.textContent=result.reason||'已清除本机观测 AK/SK。';
      }catch(error){
        observationStatus.textContent=typeof error?.message==='string'&&/观测|撤销|任务/.test(error.message)?error.message:'观测凭据撤销未获确认，请检查状态后重试。';
        observationStatus.setAttribute('role','alert');
      }finally{setObservationBusy(false);}
    });
  }
  let savedBinding;
  let originatingFocus,restoreFocus=false;
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
  return {show:value=>{section.hidden=!value;if(!value) restoreFocus=false;},render(value={}){
    canRestoreDefault=(value.canRestoreDefaultConnection??value.configured)===true;
    savedBinding={gatewayUrl:value.gatewayUrl,runtimeName:value.runtimeName};restoreBtn.disabled=busy||!canRestoreDefault;
    if (!dirty && !busy) {form.elements.gatewayUrl.value=value.gatewayUrl??'';form.elements.runtimeName.value=value.runtimeName??'';
      form.elements.transport.value=value.transport??'https';form.elements.websocketUrl.value=value.websocketUrl??'';
      form.elements.allowHttpsFallback.checked=value.allowHttpsFallback===true;updateTransport();}
    displayTransport(value);
    displayObservation(value.observation);
    if(!dirty&&!busy&&form.elements.deploymentVersion)form.elements.deploymentVersion.value=value.deploymentVersion??'';
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
