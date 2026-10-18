/** Settings for the shared text/Live goal tools; local Goal editing remains independent. */
export function mountGoalCloudControls(root,invoke) {
  const section=document.createElement('section');section.className='sheet';
  section.setAttribute('aria-label','主智能体目标管理');
  section.innerHTML='<h2>主智能体目标管理</h2><p class="notice">开启后，可在文字或 Live 对话中让 PersonalAgent 查看、创建和修改目标。目标内容会发给华为 AgentArts，写入仍经过本地授权；受限目标内容不会发送。</p><label class="setting-row"><input type="checkbox" data-goal-cloud="consent">允许本会话将目标内容交给主智能体处理</label><button type="button" class="btn" data-goal-cloud="enable">开启目标管理</button><button type="button" class="btn" data-goal-cloud="disable">撤销目标管理许可</button><p class="notice" data-goal-cloud="status" role="status"></p>';
  root.append(section);
  const field=name=>section.querySelector(`[data-goal-cloud="${name}"]`);
  let state={},busy=false,unknown=false,hostVersion=0;
  const valid=value=>value && typeof value.available==='boolean' && typeof value.sessionAllowed==='boolean'
    && typeof value.reason==='string' && (!value.sessionAllowed || value.available);
  const buttons=()=>{field('enable').disabled=busy||unknown||!state.available||state.sessionAllowed||!field('consent').checked;
    field('disable').disabled=busy||(!state.sessionAllowed&&!unknown);};
  const display=()=>{
    field('status').textContent=unknown?'目标管理许可结果未获确认；请核对当前状态，或明确撤销本会话许可。'
      :state.reason??'目标工具将在 Runtime 连接后可用';
    field('status').setAttribute('role',unknown?'alert':'status');buttons();
  };
  const accept=value=>{
    if(state.sessionAllowed&&!value.sessionAllowed) field('consent').checked=false;
    state={available:value.available,sessionAllowed:value.sessionAllowed,reason:value.reason};
  };
  const render=value=>{
    if(valid(value)) {hostVersion++;accept(value);unknown=false;}
    display();
  };
  const run=async(name,payload)=>{
    if(busy || (name==='goalCloud.authorize'
      ? unknown || !state.available || state.sessionAllowed || payload?.goalCloudConsent!==true
      : !state.sessionAllowed && !unknown)) return;
    const version=hostVersion,expected=name==='goalCloud.authorize';
    busy=true;buttons();
    try {
      const result=await invoke(name,payload);
      // A synchronous host publication can precede the IPC reply. Keep that
      // newer readback instead of restoring a superseded session grant.
      if(hostVersion===version) {
        if(valid(result) && result.sessionAllowed===expected) {accept(result);unknown=false;}
        else unknown=true;
      }
    } catch {
      if(hostVersion===version) unknown=true;
    } finally {busy=false;display();}
  };
  field('consent').onchange=buttons;
  field('enable').onclick=()=>run('goalCloud.authorize',{goalCloudConsent:field('consent').checked});
  field('disable').onclick=()=>run('goalCloud.revoke');
  return {render,show:value=>{section.hidden=!value;}};
}
