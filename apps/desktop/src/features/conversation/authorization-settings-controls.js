import {ensureAuthorizationStyles,escapeAuthorizationText as escape} from './authorization-question-card.js';

const isSelected=(profile,value)=>Boolean(value?.selected?.ref
  ?profile.ref===value.selected.ref
  :value?.selected?.label&&profile.label===value.selected.label&&profile.mode===value.selected.mode);

export function authorizationSettingsMarkup(value,{busy=false,message=''}={}) {
  const profiles=Array.isArray(value?.profiles)?value.profiles:[],rules=Array.isArray(value?.rules)?value.rules:[];
  const ready=Number.isSafeInteger(value?.selected?.revision);
  return `<section class="authorization-sandbox-panel" aria-label="沙箱与授权规则"><h2>沙箱与授权规则</h2>
    <p class="auth-simple-summary">默认是「低风险自动」：查看、搜索这类只读操作及正常对话出机不再每次询问；写入、发送、删除和执行仍会请你确认。「每次都询问」逐项确认（支持本任务不再问）；「受限写入」自动放行工作区改文件和本地待办，外部发送与删除仍先确认；「完全访问会自动同意，不弹卡」，但检测到真实密钥、密码或凭据泄露仍会强行弹授权卡询问，支持加入白名单放行。决定后的卡片会自动移除。</p>
    <p>当前权限模式：<strong>${escape(value?.selected?.label||'尚未装配')}</strong> · ${escape(value?.selected?.mode||'不可用')}</p>
    <p data-pro-only="true">应用内工具不启动外部进程，无需先配置 Node 或原生隔离组件。外部进程隔离另行检查，不以应用内权限代替。</p>
    <p data-pro-only="true">外部进程后端：<strong>${escape(value?.nativeExecution?.backend||'未提供')}</strong> · ${value?.nativeExecution?.available===true?'可用':'不可用'} · ${value?.nativeExecution?.enforced===true?'执行边界已启用':'执行边界尚未确认'}${value?.nativeExecution?.reason?` · ${escape(value.nativeExecution.reason)}`:''}</p>
    <label>权限模式 <select data-authorization-profile ${!ready||busy?'disabled':''}><option value="">选择权限模式…</option>${profiles.map(profile=>
      `<option value="${escape(profile.ref)}" ${isSelected(profile,value)?'selected':''} ${profile.available!==true?'disabled':''}>${escape(profile.label)}${profile.mode==='full-access'&&!String(profile.label).includes('自动同意')?'（自动同意）':''}${profile.available===true?'':'（不可用）'}</option>`).join('')}</select></label>
    <ul class="authorization-question-hint" data-pro-only="true">${profiles.filter(profile=>profile.available!==true).map(profile=>`<li>${escape(profile.label)}：${escape(profile.reason||'宿主尚未提供此能力')}</li>`).join('')}</ul>
    <h3>已保存的受限规则</h3><p class="authorization-question-hint" data-pro-only="true">规则由可信宿主保存，仅匹配列出的沙箱和范围；撤销单条规则只影响该条，不影响其他已保存规则。账号和凭据仍在各自原配置入口管理。</p>
    ${rules.length?rules.map(rule=>{
      const status=rule.status??(rule.active===true?'active':'revoked');
      const statusLabel=status==='active'?'有效':status==='inactive_profile'?'已保存（切回原模式生效）':'已撤销';
      return `<div class="authorization-sandbox-rule"><div><p>${escape(rule.summary)}</p><small>${escape(rule.sandboxLabel)} · ${statusLabel}</small></div><button type="button" data-authorization-rule="${escape(rule.ruleId)}" ${status==='revoked'||busy?'disabled':''}>撤销规则</button></div>`;
    }).join(''):'<p class="auth-empty-rules">当前没有已保存规则。</p>'}
    <button type="button" data-authorization-refresh data-pro-only="true" ${busy?'disabled':''}>刷新状态</button><p role="status" aria-live="polite">${escape(message||(!value?'正在读取可信宿主状态…':''))}</p></section>`;
}

/** Read/select/revoke only. This settings view cannot issue an operation grant. */
export function mountAuthorizationSettings(root,invoke) {
  ensureAuthorizationStyles(root.ownerDocument??globalThis.document);
  let current,busy=false,closed=false,visible=false,readGeneration=0,message='';
  const render=()=>{if(!closed)root.innerHTML=authorizationSettingsMarkup(current,{busy,message});};
  async function refresh() {
    const generation=++readGeneration;
    try {
      const value=await invoke('authorization.sandbox.read');
      if(closed||generation!==readGeneration)return;
      current=value;message='';render();
    } catch {
      if(closed||generation!==readGeneration)return;
      message='沙箱与规则暂不可用，请刷新；没有改变授权';render();
    }
  }
  async function change(name,body) {
    if(closed||busy)return;
    busy=true;message='正在提交…';render();
    try {await invoke(name,body);if(!closed)await refresh();}
    catch (error) {if(!closed)message=error?.code==='REVISION_CONFLICT'?'权限设置刚刚已更新，请刷新后再试；没有在界面假定已保存':'变更未确认，请刷新查看；没有在界面假定已保存';}
    finally {if(!closed){busy=false;render();}}
  }
  function select(event) {
    if(closed||busy||!event.target.matches('[data-authorization-profile]'))return;
    const profile=current?.profiles?.find(item=>item.ref===event.target.value);
    if(profile?.available!==true||!Number.isSafeInteger(current?.selected?.revision)){render();return;}
    return change('authorization.sandbox.select',{profileRef:profile.ref,expectedRevision:current.selected.revision});
  }
  function click(event) {
    const button=event.target.closest('button');if(closed||busy||!button||!root.contains(button)||button.disabled)return;
    if(button.hasAttribute('data-authorization-refresh'))return refresh();
    const rule=current?.rules?.find(item=>item.ruleId===button.dataset.authorizationRule);
    const canRevoke=rule&&(rule.status?rule.status!=='revoked':rule.active===true);
    if(!canRevoke||!Number.isSafeInteger(rule.revision))return;
    return change('authorization.rule.revoke',{ruleId:rule.ruleId,expectedRevision:rule.revision});
  }
  root.addEventListener('change',select);root.addEventListener('click',click);render();
  return {refresh,show(next){if(closed)return;root.hidden=!next;if(next&&!visible)void refresh();visible=next;},
    dispose(){closed=true;readGeneration++;root.removeEventListener('change',select);root.removeEventListener('click',click);root.replaceChildren();}};
}
