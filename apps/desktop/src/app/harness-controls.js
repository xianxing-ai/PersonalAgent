const budgetFields=[['maxOutputTokens','摘要输出 Token 预算',1],['triggerCharacters','触发摘要的字符数',1],
  ['targetCharacters','摘要后的目标字符数',1],['retainMessages','完整保留的近期消息数',0],
  ['maxSourceMessages','历史来源消息范围',1],['segmentCharacters','每段历史的字符预算',1],['maxSummaryCharacters','每段摘要的字符预算',1]];

/** Existing model settings surface; all validation and persistence stay in main. */
export function mountHarnessControls(root,invoke) {
  const settings=document.createElement('details');settings.className='sis-settings';
  settings.innerHTML=`<summary>开发者 Harness</summary><div class="sis-fields">
    <p class="notice">主对话负责交互、澄清与汇总，子智能体执行实际工作。工作区沿用「电脑操控」中已选择的编程工作区与原工具权限。</p>
    <label><input data-harness="enabled" type="checkbox">启用子智能体开发任务规划</label>
    <label>执行子智能体的总步骤预算<input data-harness="maxExecutorSteps" type="number" min="1" step="1" inputmode="numeric" placeholder="明确填写本次配置的总预算"></label>
    <fieldset><legend>执行会话的历史摘要</legend>
      <label><input data-harness="contextEnabled" type="checkbox">启用有界上下文摘要</label>
      <label>摘要模型<select data-harness="modelId"><option value="">请选择已保存的辅助模型</option></select></label>
      <p class="notice">只使用这里明确选定的模型版本。每段历史发送前显示实际目的地和完整内容，取消确认就停止；不会自动继承私人记忆许可。</p>
      ${budgetFields.map(([name,label,min])=>`<label>${label}<input data-harness="${name}" type="number" min="${min}" step="1" inputmode="numeric" placeholder="明确填写预算"></label>`).join('')}
      <p class="notice">原最终输入上限保留为 16000 字符。目标字符数 ≤ 触发字符数 ≤ 16000，完整尾部数量须小于来源范围。保存不会调用模型；真实连接以实际任务回执为准。</p>
    </fieldset>
    <fieldset><legend>持续责任的事件接入</legend>
      <label><input data-harness="eventsEnabled" type="checkbox">将原持续工作流的来源变化与唤醒交给执行子智能体</label>
      <label><input data-harness="eventsQuiet" type="checkbox">静默期间不接入新事件</label>
      <p class="notice">需要原用户责任、公开来源跟踪许可或原日程的有效回执。停用或静默期间的事件不会在恢复后补发；原任务结果仍可核实。</p>
    </fieldset>
    <div class="form-actions"><button class="btn" data-harness="save" type="button">保存 Harness 设置</button><button class="btn" data-harness="disable" type="button">停用规划、摘要与事件接入</button></div>
    <p data-harness="status" class="notice" role="status"></p></div>`;
  root.append(settings);
  const field=name=>settings.querySelector(`[data-harness="${name}"]`);
  let state={},busy=false,closed=false,signature;
  const controls=()=>{
    settings.setAttribute('aria-busy',String(busy));
    settings.querySelectorAll('input,select,button').forEach(input=>{input.disabled=busy;});
  };
  function render(value={}) {
    if(closed)return;state=value;
    const next=JSON.stringify([value.harness,(value.models??[]).map(({id,configurationRef,available})=>({id,configurationRef,available}))]);
    if(next===signature)return;signature=next;
    const config=value.harness??{},context=config.context??{};
    field('enabled').checked=config.enabled===true;field('contextEnabled').checked=context.enabled===true;
    field('eventsEnabled').checked=config.events?.enabled===true;field('eventsQuiet').checked=config.events?.quiet===true;
    field('maxExecutorSteps').value=config.maxExecutorSteps??'';
    field('modelId').replaceChildren();
    for(const model of [{id:'',displayName:'请选择已保存的辅助模型'},...(value.models??[])]) {
      const option=document.createElement('option');option.value=model.id;
      option.textContent=model.id?`${model.displayName} · ${model.provider} · ${model.configurationRef.slice(-8)}${model.available?'':'（不可用）'}`:model.displayName;
      option.disabled=Boolean(model.id&&!model.available);field('modelId').append(option);
    }
    field('modelId').value=context.modelId??'';
    for(const [name]of budgetFields)field(name).value=(name==='maxOutputTokens'?context.maxOutputTokens:context.policy?.[name])??'';
    field('status').textContent=config.enabled||context.enabled
      ?`设置已保存；${config.executionReason??(config.enabled?'子智能体规划按当前工作区许可启用':'开发任务规划未启用')}；${context.enabled?(config.contextAvailable===false?(config.contextReason||'摘要宿主或模型版本不可用，请检查设置')
        :config.contextModelAvailable?'摘要模型版本已绑定，真实模型尚未验证':'摘要模型版本不可用，请重新选择并保存'):'历史摘要未启用'}。`
      :'开发任务规划与历史摘要均未启用。';
    field('status').textContent+=config.events?.enabled
      ?config.events.quiet?' 事件接入处于静默状态，期间不补发新事件。':config.enabled?' 事件接入已保存，按原持续责任与来源许可逐条检查。':' 事件设置已保存，需先启用子智能体开发任务规划。'
      :' 事件接入未启用。';controls();
  }
  const integer=name=>{
    const value=field(name).valueAsNumber;
    if(field(name).value.trim()===''||!Number.isSafeInteger(value)||value<(name==='retainMessages'?0:1))throw Error('budget');
    return value;
  };
  async function save(disable=false) {
    if(busy||closed)return;
    let payload;
    try {
      payload={expectedRevision:state.harness?.revision??'unconfigured',enabled:disable?false:field('enabled').checked,
        context:{enabled:disable?false:field('contextEnabled').checked},
        events:{enabled:disable?false:field('eventsEnabled').checked,quiet:field('eventsQuiet').checked}};
      if(!disable&&(payload.enabled||field('maxExecutorSteps').value.trim()))payload.maxExecutorSteps=integer('maxExecutorSteps');
      if(payload.context.enabled) {
        const selected=state.models?.find(model=>model.id===field('modelId').value&&model.available);
        if(!selected)throw Error('model');
        payload.context={enabled:true,modelId:selected.id,configurationRef:selected.configurationRef,maxOutputTokens:integer('maxOutputTokens'),
          policy:Object.fromEntries(budgetFields.filter(([name])=>name!=='maxOutputTokens').map(([name])=>[name,integer(name)]))};
        payload.context.policy.maxCharacters=16000;
        const policy=payload.context.policy;
        if(policy.targetCharacters>policy.triggerCharacters||policy.triggerCharacters>16000||policy.retainMessages>=policy.maxSourceMessages)throw Error('policy');
      }
    }catch{field('status').textContent='请明确选择可用摘要模型并填写有效预算；原设置尚未更改。';return;}
    busy=true;controls();
    try{const value=await invoke('modelApi.harness.configure',payload);if(!closed)render(value);}
    catch{if(!closed)field('status').textContent='设置未保存；配置可能已变化，请刷新后检查当前模型版本与预算。';}
    finally{busy=false;if(!closed)controls();}
  }
  field('save').onclick=()=>save();field('disable').onclick=()=>save(true);
  render();
  return {render,showSettings(show){settings.hidden=!show;},close(){closed=true;settings.remove();}};
}
