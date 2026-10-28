/** Goal actions use the existing per-operation conversation authorization. */
export function mountGoalCloudControls(root,invoke) {
  const section=document.createElement('section');section.className='sheet';
  section.setAttribute('aria-label','主智能体目标管理');
  section.innerHTML='<h2>主智能体目标管理</h2><p class="notice">在对话中提出查看或修改目标的请求。需要发送目标内容或执行写入时，在该次操作的提问卡中确认；受限目标不会发送。</p><button type="button" class="btn" data-goal-cloud="open">打开对话</button><button type="button" class="btn" data-goal-cloud="disable">撤销已有目标管理许可</button><p class="notice" data-goal-cloud="status" role="status"></p>';
  root.append(section);
  const field=name=>section.querySelector(`[data-goal-cloud="${name}"]`);
  let state={},revoking=false,opening=false,unknown=false,hostVersion=0,message='';
  const valid=value=>value && typeof value.available==='boolean' && typeof value.sessionAllowed==='boolean'
    && typeof value.reason==='string' && (!value.sessionAllowed || value.available);
  const display=()=>{
    field('open').disabled=opening;
    field('disable').disabled=revoking||(!state.sessionAllowed&&!unknown);
    field('status').textContent=message || (unknown?'目标管理许可撤销结果未获确认；请核对当前状态，或再次明确撤销。'
      :state.reason??'目标工具将在 Runtime 连接后可用');
    field('status').setAttribute('role',unknown||message?'alert':'status');
  };
  const accept=value=>{state={available:value.available,sessionAllowed:value.sessionAllowed,reason:value.reason};};
  const render=value=>{
    if(valid(value)) {hostVersion++;accept(value);unknown=false;}
    display();
  };
  field('open').onclick=async()=>{
    if(opening)return;
    opening=true;message='';display();
    try {await invoke('conversation.open');}
    catch {message='无法打开对话，请从悬浮球进入。';}
    finally {opening=false;display();}
  };
  field('disable').onclick=async()=>{
    if(revoking||(!state.sessionAllowed&&!unknown))return;
    const version=hostVersion;revoking=true;message='';display();
    try {
      const result=await invoke('goalCloud.revoke');
      // A host publication can arrive before the reply; never restore older state.
      if(hostVersion===version) {
        if(valid(result)&&!result.sessionAllowed) {accept(result);unknown=false;}
        else unknown=true;
      } else if(state.sessionAllowed) unknown=true;
    } catch {if(hostVersion===version || state.sessionAllowed)unknown=true;}
    finally {revoking=false;display();}
  };
  return {render,show:value=>{section.hidden=!value;}};
}
