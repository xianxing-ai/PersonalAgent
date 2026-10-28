const fields=['enabled','source','baseUrl','model','apiKey'];
function safeDetail(value,secrets=[]){
  let text=typeof value==='string'&&value.trim()?value:'宿主未提供具体错误原因。';
  for(const secret of secrets)if(secret)text=text.replaceAll(secret,'[凭据已遮蔽]');
  return text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,'[凭据已遮蔽]')
    .replace(/\b((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]+/giu,'$1[凭据已遮蔽]')
    .replace(/\bsk-[\w-]{8,}/gu,'[凭据已遮蔽]')
    .replace(/(?:\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|authorization|password|secret|cookie|set-cookie)|("?(?:密钥|密码|令牌)"?))(["']?\s*[:=：]\s*)(?!\[(?:凭据|正文|路径)已遮蔽\](?=[\s,&;，；}\]]|$))(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,&;，；]+)/giu,(_all,key,chinese,separator)=>`${key??chinese}${separator}[凭据已遮蔽]`)
    .replace(/(?:\b((?:response[ _-]?|request[ _-]?|email[ _-]?)?body|content|text|prompt|stdout|stderr|html|page[_-]?text|window[_-]?text)|((?:邮件)?正文))(["']?\s*[:=：]\s*)(?!\[(?:凭据|正文|路径)已遮蔽\](?=[\s,&;，；}\]]|$))(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s;；][^;；\r\n]*)/giu,(_all,key,chinese,separator)=>`${key??chinese}${separator}[正文已遮蔽]`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu,'$1[凭据已遮蔽]@')
    .replace(/\bfile:\/\/[^\s"'<>，；。！？,;)\]}]+/giu,'[路径已遮蔽]')
    .replace(/(["'])(?:[A-Za-z]:[\\/]|\\\\|\/)[^\r\n]*?\1/gu,'[路径已遮蔽]')
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>，；。！？,;)\]}]+/gu,'[路径已遮蔽]')
    .replace(/\\\\[^\s\\]+\\[^\s"'<>，；。！？,;)\]}]+/gu,'[路径已遮蔽]')
    .replace(/(?<![:/\w])\/(?:[^/\s"'<>，；。！？,;)\]}]+\/)*[^/\s"'<>，；。！？,;)\]}]+/gu,'[路径已遮蔽]');
}
function failureText(error,secrets=[]){
  let data={};try{for(const key of ['code','stage','message']){const field=Object.getOwnPropertyDescriptor(error??{},key);if(field&&Object.hasOwn(field,'value'))data[key]=field.value;}}catch{}
  const code=typeof data.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/u.test(data.code)?data.code:'EXTERNAL_FAILURE';
  const stage=typeof data.stage==='string'&&/^[A-Za-z0-9_.-]{1,64}$/u.test(data.stage)?data.stage:'computer.vision.configure';
  return `视觉设置失败 [${code}]（阶段：${stage}）：${safeDetail(typeof error==='string'?error:data.message,secrets)}`;
}
const snapshotValue=value=>{
  const state=value?.computerControl?.vision??value?.vision??value;
  return state&&typeof state==='object'&&typeof state.revision==='string'
    &&['agentarts-proxy','openai-compatible'].includes(state.source)&&typeof state.baseUrl==='string'&&typeof state.model==='string'
    &&['enabled','configured','available','keyConfigured'].every(key=>typeof state[key]==='boolean')?state:undefined;
};

/** Only Main's exact-action safe diagnostic may bypass generic IPC error classification. */
export function readComputerVisionDiagnostic(value,action){
  if(action!=='computer.vision.configure'||value?.kind!=='computer-vision'||value.stage!==action
    ||typeof value.code!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(value.code)
    ||typeof value.message!=='string'||!value.message.trim()||value.message.length>8192)return;
  return {code:value.code,stage:value.stage,message:safeDetail(value.message)};
}

/** Optional vision settings only: no model request, device action or browser persistence. */
export function mountComputerVisionControls(root,invoke){
  const document=root.ownerDocument??globalThis.document,section=document.createElement('section');
  section.className='sheet computer-vision-controls';section.setAttribute('aria-label','可选视觉模型');
  section.innerHTML=`<h2>可选视觉模型</h2>
    <p>默认使用 AgentArts 进行文本规划。启用后，经本次任务的精确图像许可，目标截图原图会发送到下方选定模型；视觉分析只是观察，不代表操作成功。</p>
    <p>可以使用 AgentArts 视觉代理或添加自己的兼容模型；这里不会替换默认 AgentArts 规划模型。保存仅更新配置，不会发起付费模型请求。</p>
    <form>
      <label class="computer-vision-toggle"><input type="checkbox" data-vision="enabled"><span>启用可选视觉分析</span></label>
      <label>视觉模型来源<select data-vision="source"><option value="agentarts-proxy">AgentArts 云端视觉代理（默认）</option><option value="openai-compatible">自定义 OpenAI 兼容模型</option></select></label>
      <label>模型 Endpoint<input type="url" data-vision="baseUrl" maxlength="2048" autocomplete="off" placeholder="https://项目.huaweicloud-agentarts.com/inference/v1"></label>
      <label>模型名称<input type="text" data-vision="model" maxlength="200" autocomplete="off"></label>
      <label>API Key<input type="password" data-vision="apiKey" maxlength="8192" autocomplete="new-password" spellcheck="false"></label>
      <p data-vision="keyHint"></p><p data-vision="destinationHint"></p>
      <div class="form-actions"><button type="submit" class="btn btn-primary" data-vision="save" disabled>保存视觉设置</button><button type="button" class="btn" data-vision="reload" disabled>重新载入当前设置</button></div>
    </form><p data-vision="status" role="status" aria-live="polite"></p><p data-vision="feedback" role="alert" aria-live="polite"></p>`;
  root.append(section);
  const field=name=>section.querySelector(`[data-vision="${name}"]`),form=section.querySelector('form');
  let state,draftRevision,closed=false,pending=false,dirty=false,edits=0,publication=0,operation=0,feedback='';
  function paint(){
    if(closed)return;
    section.setAttribute('aria-busy',String(pending));field('save').disabled=field('reload').disabled=!state||pending;
    for(const name of fields)field(name).disabled=!state;
    const destinationChanged=state&&['source','baseUrl','model'].some(name=>field(name).value!==state[name]);
    field('keyHint').textContent=destinationChanged?'目的地已更改，请重新填写 API Key；旧目的地凭据不会自动转移。'
      :state?.keyConfigured?'已保存加密凭据，不回显；同一目的地留空保留。更换来源、Endpoint 或模型需要重新填 Key。':'尚未保存视觉凭据；启用时需要填写 Key。';
    field('destinationHint').textContent=field('source').value==='openai-compatible'?'自定义地址须为 HTTPS；明确的本机 localhost 服务可用 HTTP。':'AgentArts 地址须为 HTTPS 的 *.huaweicloud-agentarts.com/inference/v1。';
    field('status').textContent=!state?'正在等待可信宿主报告视觉配置。':state.failure?failureText(state.failure)
      :safeDetail(state.reason,state?.keyConfigured?[field('apiKey').value]:[]);
    field('feedback').textContent=feedback;
    field('feedback').setAttribute('data-error',String(feedback.startsWith('视觉设置失败 [')));
  }
  function fill(){
    if(!state)return;
    draftRevision=state.revision;
    field('enabled').checked=state.enabled;
    for(const name of ['source','baseUrl','model'])field(name).value=state[name];
    // The key input is write-only; snapshots are never a source for it.
  }
  function render(value){
    if(closed)return;const next=snapshotValue(value);if(!next)return;
    state={...next};publication++;if(!dirty&&!pending)fill();paint();
  }
  function edit(event){
    if(closed||!fields.some(name=>field(name)===event.target)||event.target.disabled)return;
    if(['source','baseUrl','model'].some(name=>field(name)===event.target))field('apiKey').value='';
    dirty=true;edits++;paint();
  }
  async function submit(event){
    event.preventDefault?.();if(closed||pending||!state)return;
    const payload={expectedRevision:draftRevision??state.revision,enabled:field('enabled').checked,source:field('source').value,
      baseUrl:field('baseUrl').value,model:field('model').value,apiKey:field('apiKey').value};
    const id=++operation,atEdits=edits,atPublication=publication;pending=true;feedback='正在加密保存视觉设置。';paint();
    try{
      const reply=await invoke('computer.vision.configure',payload);if(closed||id!==operation)return;
      const next=snapshotValue(reply);
      if(!next)throw Object.assign(Error('宿主未返回视觉配置回执，保存结果尚未确认。'),{code:'PROTOCOL_MISMATCH'});
      const superseded=publication!==atPublication&&state.revision!==payload.expectedRevision&&state.revision!==next.revision;
      if(!superseded)state={...next};
      if(edits===atEdits&&!superseded){dirty=false;field('apiKey').value='';fill();}
      feedback=superseded?'当前已显示更新的宿主配置；较早保存回执没有覆盖它。':'视觉设置已保存；端点识别能力仍需真实验证。';
    }catch(error){if(!closed&&id===operation)feedback=failureText(error,[payload.apiKey,field('apiKey').value]);}
    finally{payload.apiKey='';if(!closed&&id===operation){pending=false;paint();}}
  }
  function reload(event){
    if(closed||pending||event.target!==field('reload'))return;
    dirty=false;edits++;field('apiKey').value='';fill();feedback='已重新载入当前设置；未保存的草稿已放弃。';paint();
  }
  form.addEventListener('input',edit);form.addEventListener('change',edit);form.addEventListener('submit',submit);
  section.addEventListener('click',reload);
  field('source').value='agentarts-proxy';paint();
  return {render,show(visible){if(!closed)section.hidden=!visible;},dispose(){
    if(closed)return;closed=true;operation++;field('apiKey').value='';
    form.removeEventListener('input',edit);form.removeEventListener('change',edit);form.removeEventListener('submit',submit);section.remove();
    section.removeEventListener('click',reload);
  }};
}
