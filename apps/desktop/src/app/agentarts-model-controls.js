export function mountAgentArtsModelControls(root,invoke){
  const box=document.createElement('section');
  box.className='sheet sis-settings agentarts-model-settings';
  box.innerHTML='<h3>AgentArts 主思考与子思考模型</h3><p class="notice">模型请求均经当前 AgentArts 部署；目录存在不代表真实调用已验证。全局默认用于选择“使用默认主思考模型”的会话；已有会话的独立模型与原生推理强度选择保留。</p><div class="sis-fields"><label>默认主模型<select data-role="primary"></select></label><label>主模型原生推理强度<select data-role="primary-effort"></select></label><label>默认子模型<select data-role="subagent"></select></label><label>子模型原生推理强度<select data-role="subagent-effort"></select></label></div><div class="form-actions"><button type="button" data-refresh>读取当前目录</button><button type="button" data-save>保存模型选择</button></div><p class="notice" role="status"></p>';
  root.append(box);
  const field=role=>box.querySelector('[data-role="'+role+'"]');
  const status=box.querySelector('[role=status]'),save=box.querySelector('[data-save]'),refresh=box.querySelector('[data-refresh]');
  let state,closed=false,dirty=false,busy=false,revision=0,hostRevision=0,projectedSignature,operationError='';
  function controls(){box.setAttribute('aria-busy',String(busy));box.querySelectorAll('select,button').forEach(control=>{control.disabled=busy;});save.disabled=busy||!state?.available;}
  function efforts(role,value=''){
    const model=state?.catalog?.models.find(item=>item.id===field(role).value);
    field(role+'-effort').replaceChildren(new Option('供应商默认',''),...(model?.reasoningEfforts??[]).map(effort=>new Option(effort,effort)));
    field(role+'-effort').value=(model?.reasoningEfforts??[]).includes(value)?value:'';
  }
  const signature=value=>JSON.stringify([value?.catalog?.revision,value?.preferences]);
  function project(value){
    projectedSignature=signature(value);
    for(const role of ['primary','subagent']){
      field(role).replaceChildren(...(value.catalog?.models??[]).map(model=>{
        const option=new Option(model.displayName+'（'+(model.availability==='available'?'目录可用':model.availability==='unavailable'?'不可用':'真实调用未验证')+'）'+(model.type!=='text'?'（'+model.type+'，非文本）':''),model.id);
        option.disabled=model.availability==='unavailable'||model.type!=='text';return option;
      }));
      field(role).value=value.preferences?.[role==='primary'?'defaultModelId':'defaultSubmodelId']??value.catalog?.defaultModelId??'';
      efforts(role,value.preferences?.[role==='primary'?'reasoningEffort':'submodelReasoningEffort']??'');
    }
  }
  function update(value){
    if(closed||!value)return;
    hostRevision++;state=value;
    if(!dirty&&!busy){if(projectedSignature!==signature(value))project(value);status.textContent=operationError||value.reason||'';}
    else if(dirty&&!busy)status.textContent=operationError||'有未保存的模型选择；后台更新不会覆盖当前输入。';
    controls();
  }
  const edit=()=>{dirty=true;revision++;operationError='';status.textContent='有未保存的模型选择。';};
  for(const role of ['primary','subagent']){
    field(role).onchange=()=>{edit();efforts(role);};
    field(role+'-effort').onchange=edit;
  }
  async function run(name,payload){
    if(busy||closed)return;
    operationError='';
    const submittedRevision=revision,startedHostRevision=hostRevision;busy=true;controls();
    try{
      const value=await invoke(name,payload);
      if(closed)return;
      if(name==='agentartsModels.state'&&hostRevision!==startedHostRevision){if(!dirty)project(state);return;}
      state=value;
      if(name==='agentartsModels.configure'&&revision===submittedRevision)dirty=false;
      if(!dirty)project(value);
      status.textContent=dirty?'有未保存的模型选择；当前输入已保留。':value.reason??'已更新';
    }catch(error){if(!closed){operationError=error.message??'目录操作未完成';status.textContent=operationError;}}
    finally{busy=false;if(!closed)controls();}
  }
  refresh.onclick=()=>run('agentartsModels.refresh');
  save.onclick=()=>run('agentartsModels.configure',{catalogRevision:state?.catalog?.revision,defaultModelId:field('primary').value,defaultSubmodelId:field('subagent').value,...(field('primary-effort').value?{reasoningEffort:field('primary-effort').value}:{}),...(field('subagent-effort').value?{submodelReasoningEffort:field('subagent-effort').value}:{})});
  void run('agentartsModels.state');
  return {update,destroy(){closed=true;box.remove();}};
}
