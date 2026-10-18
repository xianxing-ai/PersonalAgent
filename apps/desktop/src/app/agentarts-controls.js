export function mountAgentArtsControls(root,invoke) {
  const section=document.createElement('section');section.className='sheet coding-workspace';
  section.innerHTML='<h2>AgentArts 主智能体</h2><p class="notice" data-transport-state></p><form class="settings-form"><label>网关地址<input name="gatewayUrl" type="url" autocomplete="off" placeholder="https://…huaweicloud-agentarts.com" required></label><label>运行时实例名称<input name="runtimeName" autocomplete="off" required></label><label>Authorization<input name="authorization" type="password" autocomplete="off" placeholder="控制台 API 示例中的完整值；留空沿用同一实例凭据"></label><label>任务主通道<select name="transport"><option value="https">HTTPS（兼容原配置）</option><option value="wss">WSS</option></select></label><label>精确 WSS 地址<input name="websocketUrl" type="url" autocomplete="off" placeholder="wss://同一网关/runtimes/实例/ws"></label><label><input name="allowHttpsFallback" type="checkbox">允许 HTTPS 备用</label><p class="notice">通道随当前实例和部署安全保存；显式主机环境配置优先。凭据只在本机加密保存，不进入模型提示或聊天。更换运行时后需要重启应用。</p><div class="btn-group"><button type="submit" class="btn btn-primary">保存 AgentArts 配置</button><button type="button" data-revoke class="btn btn-secondary btn-danger">清除并撤销凭据</button></div><p data-status class="notice" role="status"></p></form>';
  root.append(section);const form=section.querySelector('form'),status=section.querySelector('[data-status]'),revokeBtn=section.querySelector('[data-revoke]');let dirty=false,busy=false,feedbackKind='host',lastHostReason='',feedbackMessage='';
  let originatingFocus,restoreFocus=false;
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
  form.addEventListener('input',()=>{dirty=true;if (!busy && feedbackKind!=='unconfirmed') displayFeedback(feedbackMessage);});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if (busy) return;setBusy(true);feedback('正在保存配置…');
    const input=Object.fromEntries(['gatewayUrl','runtimeName','authorization'].map(key=>[key,form.elements[key].value.trim()]));
    input.transport=form.elements.transport?.value??'https';input.websocketUrl=form.elements.websocketUrl?.value.trim()??'';input.allowHttpsFallback=form.elements.allowHttpsFallback?.checked??false;
    form.elements.authorization.value='';
    try {const result=await invoke('agentarts.configure',input);if (result?.configured!==true) throw Error();dirty=false;feedback(result.reason || '配置已保存。');}
    catch {feedback('保存结果未获确认，请检查配置状态后再操作。',true);}
    finally {input.authorization='';setBusy(false);}
  });
  revokeBtn?.addEventListener('click',async()=>{
    if (busy) return;setBusy(true);feedback('正在撤销凭据…');form.elements.authorization.value='';
    try {const result=await invoke('agentarts.revoke');if (result?.configured!==false) throw Error();dirty=false;form.reset();feedback(result.reason || '凭据已清除。');}
    catch {feedback('撤销结果未获确认，请检查配置状态和本机存储后重试。',true);}
    finally {setBusy(false);}
  });
  return {show:value=>{section.hidden=!value;if(!value) restoreFocus=false;},render(value={}){
    if (!dirty && !busy) {form.elements.gatewayUrl.value=value.gatewayUrl??'';form.elements.runtimeName.value=value.runtimeName??'';if(form.elements.transport)form.elements.transport.value=value.transport??'https';if(form.elements.websocketUrl)form.elements.websocketUrl.value=value.websocketUrl??'';if(form.elements.allowHttpsFallback)form.elements.allowHttpsFallback.checked=value.allowHttpsFallback===true;}
    const transportState=section.querySelector('[data-transport-state]');if(transportState)transportState.textContent='当前通道：'+(value.effectiveTransport??value.transport??'https').toUpperCase()+(value.transportSource==='environment'?'（主机环境覆盖）':'（本机保存）');
    const reason=typeof value.reason==='string'?value.reason:'';
    if (!busy && feedbackKind!=='unconfirmed' && (feedbackKind==='host' || reason!==lastHostReason)) {
      displayFeedback(reason);feedbackKind='host';
    }
    lastHostReason=reason;
  }};
}
