const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const key=entry=>JSON.stringify([entry.workflowId,entry.revision]);

/** Metadata only. No patches, source bodies, workspace paths, grants or credentials enter this component. */
export function harnessExperienceControlsHtml({status={available:false,entries:[]},selected='',busy=false,message=''}={}) {
  const entries=Array.isArray(status.entries)?status.entries:[];
  const chosen=entries.find(entry=>key(entry)===selected);
  const disabled=busy||!status.available||!chosen;
  const options=entries.map((entry,index)=>`<option value="${index}" ${key(entry)===selected?'selected':''}>${escape(entry.workflowId)} · v${escape(entry.revision)}</option>`).join('');
  return `<section class="setting-group" aria-label="开发经验">
    <h3>开发经验</h3><p>采用并验证后的经验可用于后续开发任务；停用后不再继续使用。</p>
    ${!status.available?`<p>${escape(status.reason||'开发经验尚未接通')}</p>`:''}
    <div class="setting-row"><label>经验版本 <select data-he-select ${busy||!entries.length?'disabled':''}>
      ${entries.length?options:'<option>尚无开发经验候选</option>'}</select></label>
      <button class="btn btn-sm" data-he-action="list" ${busy?'disabled':''}>刷新</button></div>
    ${chosen?`<p>${escape(chosen.summary)}</p><p>v${escape(chosen.revision)} · ${escape({candidate:'待验证',passed:'验证通过',failed:'验证失败'}[chosen.validation]||'状态未知')}
      · ${chosen.activeRevision===null?'未启用':`当前启用 v${escape(chosen.activeRevision)}`}</p>`:''}
    <div class="setting-row setting-control">
      <button class="btn btn-sm" data-he-action="validate" ${disabled?'disabled':''}>验证</button>
      <button class="btn btn-sm" data-he-action="activate" ${disabled||chosen?.validation!=='passed'||chosen?.activeRevision===chosen?.revision?'disabled':''}>启用</button>
      <button class="btn btn-sm" data-he-action="stop" ${disabled||chosen?.activeRevision==null?'disabled':''}>停用</button>
    </div><p role="status" aria-live="polite">${escape(message)}</p></section>`;
}

/** Mount once from H2's existing memory/harness settings surface; dispose when that surface is replaced. */
export function mountHarnessExperienceControls(root,{invoke,status={available:false,entries:[]},onChanged}={}) {
  if(!root||typeof invoke!=='function')throw Error('需要开发经验管理入口');
  const events=new AbortController();let disposed=false,busy=false,sequence=0,selected='',message='';
  let current=structuredClone(status);
  const render=()=>{
    if(disposed)return;
    const entries=Array.isArray(current.entries)?current.entries:[];
    if(!entries.some(entry=>key(entry)===selected))selected=entries[0]?key(entries[0]):'';
    root.innerHTML=harnessExperienceControlsHtml({status:current,selected,busy,message});
  };
  const perform=async(action,payload={})=>{
    if(disposed||busy)return;
    const token=++sequence;busy=true;message='';render();
    try {
      const result=await invoke(`harness.experience.${action}`,payload);
      if(disposed||token!==sequence)return;
      if(!result||typeof result.available!=='boolean'||!Array.isArray(result.entries))throw Error('开发经验状态读取失败');
      current=structuredClone(result);message=action==='list'?'已刷新':action==='validate'?'已重新读取验证结果':action==='activate'?'已重新读取启用状态':'已重新读取停用状态';
      try {await onChanged?.(structuredClone(current));} catch { /* The authoritative state was already read successfully. */ }
    } catch {if(!disposed&&token===sequence)message='操作未完成，请刷新状态后重试。';}
    finally {if(!disposed&&token===sequence){busy=false;render();}}
  };
  root.addEventListener('change',event=>{
    if(disposed||busy||!event.target.matches?.('[data-he-select]'))return;
    const entry=current.entries?.[Number(event.target.value)];if(entry){selected=key(entry);render();}
  },{signal:events.signal});
  root.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-he-action]');
    if(disposed||busy||!button||!root.contains(button)||button.disabled)return;
    const action=button.dataset.heAction;
    if(!['list','validate','activate','stop'].includes(action))return;
    if(action==='list'){void perform(action);return;}
    const entry=current.entries?.find(value=>key(value)===selected);if(!entry)return;
    const payload={workflowId:entry.workflowId};
    if(action!=='stop')payload.revision=entry.revision;
    if(action!=='validate')payload.expectedActiveRevision=entry.activeRevision??null;
    void perform(action,payload);
  },{signal:events.signal});
  render();
  void perform('list');
  return Object.freeze({refresh:()=>perform('list'),dispose(){disposed=true;sequence++;events.abort();},update(status){
    if(disposed||busy)return;current=structuredClone(status);render();
  }});
}
