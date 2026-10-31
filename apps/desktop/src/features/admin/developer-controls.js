import {developerSettingsError,developerSettingsFeedback} from '../../../shared/developer-settings-diagnostics.js';

const escape=value=>String(value??'').replace(/[&<>"']/gu,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/** Admin-only product settings. No credentials are placed in snapshots or browser storage. */
export function mountDeveloperControls(root,invoke){
  const view=document.createElement('section');view.className='sheet developer-settings';
  view.innerHTML='<h2>代码开发工具设置</h2><p class="notice">主对话和语音可在选定工作区读代码、隔离试改、运行允许的命令，并按权限提交改动。复用已选择的编程工作区和模型；保存配置不授予执行、推送或出机权限。</p>'+
    '<p data-developer-status role="status"></p><p data-developer-workspace class="notice"></p>'+
    '<details class="sis-advanced"><summary>开发工具配置（可选）</summary><label><input type="checkbox" data-developer-enabled>启用代码开发工具</label><button type="button" class="btn btn-sm" data-developer-refresh>刷新状态</button>'+
    '<form class="settings-form" data-developer-form><label>GitHub 仓库<input name="repository" placeholder="owner/repository" required maxlength="201"></label>'+
    '<label>受信 gh 可执行文件<input name="executable" placeholder="选择工作区外的 gh.exe 绝对路径" required></label>'+
    '<label><input name="repairLinks" type="checkbox">启用 GitHub 修复链接工具（仍需原任务审批）</label>'+
    '<label>GitHub 凭据<input name="token" type="password" autocomplete="new-password" maxlength="4096" placeholder="仅原宿主加密保存；留空保留已有凭据"></label>'+
    '<label>源分支<input name="sourceBranch" required maxlength="200"></label><label>远程名称<input name="remoteName" required maxlength="64"></label>'+
    '<label>允许提交的现有文件（每行一个相对路径）<textarea name="allowedPaths" required rows="3"></textarea></label>'+
    '<label>提交作者姓名<input name="authorName" required></label><label>提交作者邮箱<input name="authorEmail" type="email" required></label>'+
    '<label><input name="workflows" type="checkbox">启用原开发工作流</label><label>原模型绑定<select name="modelId"></select></label>'+
    '<label>任务步骤预算<input name="maxSteps" type="number" min="1" max="64"></label><label>任务 token 预算<input name="maxTokens" type="number" min="1" max="131072"></label>'+
    '<label>审查规则（每行一条）<textarea name="reviewRules" rows="3"></textarea></label>'+
    '<details><summary>可选 Issue/CI 规则</summary><p class="notice">沿原工作流的 issueTriage / ciFix 配置；不会自动创建真实 Issue 或重跑 CI。</p><textarea name="advanced" rows="4" placeholder="{}"></textarea></details>'+
    '<button class="btn btn-sm" type="submit" data-developer-save>保存开发配置</button></form><p data-developer-feedback class="notice" role="status"></p></details>';
  root.append(view);
  const form=view.querySelector('form'),field=name=>form.elements.namedItem(name);
  const feedback=view.querySelector('[data-developer-feedback]'),enabled=view.querySelector('[data-developer-enabled]');
  let current={},editing=false,busy=false,revision=0;
  const setBusy=value=>{busy=value;view.querySelector('[data-developer-save]').disabled=value;enabled.disabled=value;};
  function render(value={}){
    current=value;
    view.querySelector('[data-developer-status]').textContent=`${value.available?'代码开发工具已就绪':'代码开发工具未就绪'} · ${value.reason??''}`;
    view.querySelector('[data-developer-workspace]').textContent=value.workspace?.selected
      ?`原工作区：${value.workspace.rootPath}；可用命令：${(value.workspace.recipeIds??[]).join('、')||'未配置'}`
      :value.workspace?.requiresRestart?'工作区设置已保存但未完成装配，请到「开发 → 环境 / Worktrees」核对并重启应用。'
        :'请先到「开发 → 环境 / Worktrees」选择本地工作区并重启装配；仓库字段只填写 GitHub owner/repo。';
    enabled.checked=value.enabled===true;
    if(editing||busy)return;
    const configuration=value.configuration??{},git=configuration.git??{},workflow=configuration.workflows;
    field('repository').value=configuration.repository??'';field('executable').value=configuration.github?.executable??'';
    field('repairLinks').checked=configuration.github?.repairLinks===true;
    for(const key of ['sourceBranch','remoteName','authorName','authorEmail'])field(key).value=git[key]??'';
    field('allowedPaths').value=(git.allowedPaths??[]).join('\n');
    field('workflows').checked=Boolean(workflow);
    field('modelId').innerHTML='<option value="">选择已启用模型</option>'+(value.models??[]).map(model=>`<option value="${escape(model.id)}">${escape(model.displayName)}</option>`).join('');
    field('modelId').value=workflow?.modelId??'';
    field('maxSteps').value=workflow?.maxSteps??'';field('maxTokens').value=workflow?.maxTokens??'';
    field('reviewRules').value=(workflow?.reviewRules??[]).map(rule=>rule.text).join('\n');
    const advanced={};if(workflow?.issueTriage)advanced.issueTriage=workflow.issueTriage;if(workflow?.ciFix)advanced.ciFix=workflow.ciFix;
    field('advanced').value=JSON.stringify(advanced,null,2);
  }
  form.addEventListener('input',()=>{editing=true;revision++;});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const token=field('token').value;field('token').value='';
    const submitted=revision;setBusy(true);let request;
    try{
      const repository=field('repository').value.trim();
      const configuration={version:1,repository,github:{executable:field('executable').value.trim(),
        environment:structuredClone(current.configuration?.github?.environment??{}),repairLinks:field('repairLinks').checked},git:{
        sourceBranch:field('sourceBranch').value.trim(),remoteName:field('remoteName').value.trim(),remoteUrl:`https://github.com/${repository}.git`,
        authorName:field('authorName').value.trim(),authorEmail:field('authorEmail').value.trim(),
        allowedPaths:field('allowedPaths').value.split(/\r?\n/u).map(value=>value.trim()).filter(Boolean)}};
      if(field('workflows').checked){
        const model=(current.models??[]).find(item=>item.id===field('modelId').value);
        if(!model)throw developerSettingsError('DEV_SETTINGS_MODEL_REQUIRED');
        let advanced;try{advanced=JSON.parse(field('advanced').value||'{}');}catch{throw developerSettingsError('DEV_SETTINGS_WORKFLOW_INVALID');}
        if(!advanced||typeof advanced!=='object'||Array.isArray(advanced)||Object.keys(advanced).some(key=>!['issueTriage','ciFix'].includes(key)))throw developerSettingsError('DEV_SETTINGS_WORKFLOW_INVALID');
        const rules=field('reviewRules').value.split(/\r?\n/u).map(text=>text.trim()).filter(Boolean).map((text,index)=>({id:`rule-${index+1}`,text}));
        configuration.workflows={...advanced,modelId:model.id,configurationRef:model.configurationRef,
          maxSteps:Number(field('maxSteps').value),maxTokens:Number(field('maxTokens').value),
          ...(rules.length?{reviewRules:rules}:{})};
      }
      request={enabled:enabled.checked,configuration,token};
      const result=await invoke('developer.settings.configure',request);
      editing=revision!==submitted;setBusy(false);render(result);
      feedback.textContent=editing?'本次提交已保存；新修改尚未保存':'已保存，按原任务授权读回开发能力；未执行外部写入';
    }catch(cause){feedback.textContent=developerSettingsFeedback(cause);}
    finally{if(request)request.token='';setBusy(false);}
  });
  enabled.addEventListener('change',async()=>{
    if(busy)return;setBusy(true);
    try{const result=await invoke('developer.settings.toggle',{enabled:enabled.checked});setBusy(false);render(result);feedback.textContent='启停状态已保存；原任务/工具授权保持独立';}
    catch(cause){enabled.checked=current.enabled===true;feedback.textContent=developerSettingsFeedback(cause);}
    finally{setBusy(false);}
  });
  view.querySelector('[data-developer-refresh]').addEventListener('click',async()=>{
    try{render(await invoke('developer.settings.read'));feedback.textContent='已读取原宿主当前状态';}
    catch(cause){feedback.textContent=developerSettingsFeedback(cause);}
  });
  return {render,update:render,showSettings(show){view.hidden=!show;if(!show)field('token').value='';},
    close(){field('token').value='';view.remove();}};
}
