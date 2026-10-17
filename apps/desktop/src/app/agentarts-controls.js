export function mountAgentArtsControls(root,invoke) {
  const section=document.createElement('section');section.className='sheet coding-workspace agentarts-settings';
  section.innerHTML='<h2>AgentArts 主智能体</h2><p class="notice" data-transport-state></p><form class="settings-form"><label>网关地址<input name="gatewayUrl" type="url" autocomplete="off" placeholder="https://…huaweicloud-agentarts.com" required></label><label>运行时实例名称<input name="runtimeName" autocomplete="off" required></label><label>平台 Authorization<input name="authorization" type="password" autocomplete="off" placeholder="控制台 API 示例中的完整值；留空沿用同一实例凭据"></label><label>任务主通道<select name="transport"><option value="wss">WSS 实时连接</option><option value="https">HTTPS 兼容连接</option></select></label><div data-wss><label>精确 WSS 地址<input name="websocketUrl" type="url" autocomplete="off" placeholder="wss://同一网关/runtimes/实例/ws"></label><label>独立镜像访问令牌<input name="appToken" type="password" autocomplete="off" placeholder="仅填写令牌；留空沿用同一实例凭据"></label><label><input name="allowHttpsFallback" type="checkbox">允许 HTTPS 备用连接</label><p class="notice">仅在尚未发送调用时允许切换备用连接；结果未知时不会自动重发。</p></div><p class="notice">两种凭据只在本机加密保存。通道随当前实例和部署安全保存；显式保存传输配置后，以本机加密记录为准。更换运行时、连接方式或地址后需要重启应用。旧 HTTPS 配置保持兼容。</p><div class="btn-group"><button type="submit" class="btn btn-primary">保存 AgentArts 配置</button><button type="button" data-revoke class="btn btn-secondary btn-danger">清除并撤销凭据</button></div><p data-status class="notice" role="status"></p></form>';
  root.append(section);const form=section.querySelector('form'),status=section.querySelector('[data-status]'),revokeBtn=section.querySelector('[data-revoke]');let dirty=false,busy=false,feedbackKind='host',lastHostReason='',feedbackMessage='';
  let originatingFocus,restoreFocus=false;
  const updateTransport=()=>{const wss=form.elements.transport.value==='wss';
    section.querySelector('[data-wss]').hidden=!wss;form.elements.websocketUrl.required=wss;};
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
  form.addEventListener('input',()=>{dirty=true;updateTransport();if (!busy && feedbackKind!=='unconfirmed') displayFeedback(feedbackMessage);});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if (busy) return;setBusy(true);feedback('正在保存配置…');
    const input=Object.fromEntries(['gatewayUrl','runtimeName','authorization'].map(key=>[key,form.elements[key].value.trim()]));
    input.transport=form.elements.transport?.value??'https';input.websocketUrl=form.elements.websocketUrl?.value.trim()??'';input.allowHttpsFallback=form.elements.allowHttpsFallback?.checked??false;
    if(input.transport==='wss') input.appToken=form.elements.appToken.value;
    clearSecrets();
    try {const result=await invoke('agentarts.configure',input);if (result?.configured!==true) throw Error();dirty=false;feedback(result.reason || '配置已保存。');}
    catch {feedback('保存结果未获确认，请检查配置状态后再操作。',true);}
    finally {input.authorization='';if('appToken' in input) input.appToken='';setBusy(false);}
  });
  revokeBtn?.addEventListener('click',async()=>{
    if (busy) return;setBusy(true);feedback('正在撤销凭据…');clearSecrets();
    try {const result=await invoke('agentarts.revoke');if (result?.configured!==false) throw Error();dirty=false;form.reset();updateTransport();feedback(result.reason || '凭据已清除。');}
    catch {feedback('撤销结果未获确认，请检查配置状态和本机存储后重试。',true);}
    finally {setBusy(false);}
  });
  return {show:value=>{section.hidden=!value;if(!value) restoreFocus=false;},render(value={}){
    if (!dirty && !busy) {form.elements.gatewayUrl.value=value.gatewayUrl??'';form.elements.runtimeName.value=value.runtimeName??'';
      form.elements.transport.value=value.transport??'wss';form.elements.websocketUrl.value=value.websocketUrl??'';
      form.elements.allowHttpsFallback.checked=value.allowHttpsFallback===true;updateTransport();}
    const transportState=section.querySelector('[data-transport-state]');if(transportState)transportState.textContent='当前通道：'+(value.effectiveTransport??value.transport??'https').toUpperCase()+(value.transportSource==='environment'?'（主机环境覆盖）':value.transportSource==='saved'?'（本机保存）':'（默认）');
    const reason=typeof value.reason==='string'?value.reason:'';
    if (!busy && feedbackKind!=='unconfirmed' && (feedbackKind==='host' || reason!==lastHostReason)) {
      displayFeedback(reason);feedbackKind='host';
    }
    lastHostReason=reason;
  }};
}
