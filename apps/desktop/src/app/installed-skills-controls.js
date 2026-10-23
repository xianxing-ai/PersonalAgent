const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function installedSkillRowsHtml(items=[],canRun=false) {
  return items.map(item=>`<article class="card"><h3>${escape(item.name)} · ${escape(item.version)}</h3>
    <p>${escape(item.description)}</p><p>${item.enabled?'已启用':'已停用'} · ${item.fileCount} 个文件</p>
    <small>SHA256：${escape(item.digest)}</small><div class="form-actions">
    ${[['preview','查看说明',false],['enable',item.enabled?'停用':'启用',false],['run','使用此 Skill',!item.enabled||!canRun],['uninstall','卸载',false]].map(([action,label,disabled])=>
      `<button class="btn btn-sm" data-skill="${action}" data-name="${escape(item.name)}" data-digest="${escape(item.digest)}" ${disabled?'disabled':''}>${label}</button>`).join('')}</div></article>`).join('') || '<p>尚未安装 Skill。选择包含 SKILL.md 的本机文件夹开始安装。</p>';
}

export function mountInstalledSkillsControls(root,invoke) {
  const host=document.createElement('section');host.className='sheet installed-skills-settings';
  host.innerHTML='<h2>本机 Skills</h2><p class="muted">安装后默认停用。查看说明不调用云端；使用时须确认本任务和完整说明发送至 AgentArts，可能计费。附带脚本不自动执行。</p><button class="btn" data-skill="install">安装本机 Skill</button><div data-skill-list></div><div class="settings-form"><label>本次任务<textarea class="field" data-skill-goal maxlength="4096" placeholder="描述要使用 Skill 完成的任务"></textarea></label></div><p data-skill-status role="status"></p><details><summary>Skill 说明预览</summary><div data-skill-resources hidden><div class="settings-form"><label>安装资源（仅本地预览）<select class="field" data-skill-resource></select></label></div><button class="btn" data-skill="resource">查看资源</button></div><pre data-skill-preview></pre></details>';
  root.append(host);let state={items:[]},canRun=false,busy=false,signature='',taskId='';
  const status=host.querySelector('[data-skill-status]');
  const resources=host.querySelector('[data-skill-resources]'),resourceButton=resources.querySelector('button');
  function buttons() {
    for(const button of host.querySelectorAll('[data-skill]')) {
      const entry=state.items.find(item=>item.name===button.dataset.name && item.digest===button.dataset.digest);
      button.disabled=busy || state.available!==true || (button.dataset.skill==='resource' && !entry) || (button.dataset.skill==='run' && (!entry?.enabled || !canRun));
    }
  }
  host.addEventListener('click',async event=>{
    const button=event.target.closest('[data-skill]');
    if(!button || !host.contains(button) || button.disabled || busy || !host.isConnected) return;
    const action=button.dataset.skill,selected={name:button.dataset.name,digest:button.dataset.digest};
    taskId='';
    busy=true;buttons();status.textContent='正在处理…';
    try {
      const entry=state.items.find(item=>item.name===selected.name && item.digest===selected.digest);
      const payload=action==='install'?undefined:action==='enable'?{...selected,enabled:!entry.enabled}
        :action==='run'?{...selected,goal:host.querySelector('[data-skill-goal]').value}
        :action==='resource'?{...selected,path:host.querySelector('[data-skill-resource]').value}:selected;
      const result=await invoke('skill.'+action,payload);
      if(!host.isConnected)return;
      if(result.cancelled) {status.textContent='已取消，未开始新操作。';return;}
      if(action==='preview') {
        host.querySelector('[data-skill-preview]').textContent=result.instructions+'\n\n资源（不自动执行）：\n'+result.resources.join('\n');
        const paths=result.resources.filter(path=>path!=='SKILL.md');
        host.querySelector('[data-skill-resource]').innerHTML=paths.map(path=>`<option value="${escape(path)}">${escape(path)}</option>`).join('');
        Object.assign(resourceButton.dataset,selected);resources.hidden=!paths.length;
        host.querySelector('details').open=true;
        status.textContent='说明已显示；没有调用云端。';
      } else if(action==='resource') {
        host.querySelector('[data-skill-preview]').textContent=result.path+'\nSHA256：'+result.digest+'\n\n'+result.text;
        status.textContent='资源已在本地显示；未执行、未发送云端。';
      } else if(action==='run') {
        taskId=result.taskId;status.textContent='任务已受理：'+taskId+'。请在任务监控查看状态、审批或停止。';
      } else {
        if(action==='uninstall') {host.querySelector('[data-skill-preview]').textContent='';resources.hidden=true;}
        status.textContent=action==='install'?(result.enabled?'此版本已安装且已启用。':'已安装，当前停用。'):action==='enable'?'启停已更新；旧使用许可不会恢复。':'已卸载应用副本，原目录保留。';
      }
    } catch(error) {if(host.isConnected)status.textContent=action==='run' && /(?:Skill 与任务合并后|任务、Skill 与对话上下文合并后)超过 128000 字符限制/.test(String(error?.message??error))?'任务、Skill 与对话上下文超过 128000 字符限制；请缩短内容或减少对话历史。':action==='resource'?'资源未显示。仅支持安装快照中最多 64 KiB 的普通 UTF-8 文本；二进制、控制字符或已卸载资源不可预览。':'操作未完成。请检查 Skill 格式、版本、启用状态及模型配置；不同版本请先卸载再安装。';}
    finally {busy=false;buttons();}
  });
  return {show:visible=>{host.hidden=!visible;},render(value,tasks=[],ready=false){
    state=value??{available:false,items:[]};canRun=ready;
    const next=JSON.stringify([state,canRun]);
    if(next!==signature) {signature=next;host.querySelector('[data-skill-list]').innerHTML=installedSkillRowsHtml(state.items,canRun);}
    if(resourceButton.dataset.name && !state.items.some(item=>item.name===resourceButton.dataset.name && item.digest===resourceButton.dataset.digest)) {
      resources.hidden=true;host.querySelector('[data-skill-preview]').textContent='';
    }
    const task=tasks.find(task=>task.taskId===taskId);
    if(task && ['succeeded','failed','cancelled'].includes(task.state))status.textContent='任务 '+taskId+'：'+({succeeded:'已完成',failed:'失败',cancelled:'已取消'}[task.state]);
    buttons();
  }};
}
