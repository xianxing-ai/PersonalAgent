import {renderCostRoute} from './cost-route-status.js';

/** Entry points for existing host permissions and the original panel-owned Live session. */
export function mountWorkspaceRuntimeControls(root,invoke,report){
  const actions=root.querySelector('.workspace-composer-actions');
  const controls=document.createElement('div');controls.className='cc-runtime-controls';
  controls.innerHTML='<button type="button" class="cc-access" aria-label="沙箱与访问权限" title="管理应用内权限、完全访问和批准规则"><span data-access-mode>低风险自动</span><span>请求批准</span><span aria-hidden="true">⌄</span></button><button type="button" class="cc-approval" hidden>查看待批准</button><span class="cc-runtime-spacer"></span><button type="button" class="cc-live" aria-label="实时语音" aria-pressed="false" title="在原语音面板开启实时语音">▥ <span>实时语音</span></button><button type="button" class="cc-live-settings" aria-label="实时语音设置" title="实时语音设置">⌄</button>';
  actions.after(controls);
  const costRouteStatus=document.createElement('div');costRouteStatus.className='notice';costRouteStatus.hidden=true;costRouteStatus.dataset.costRoute='';
  controls.append(costRouteStatus);
  const access=controls.querySelector('.cc-access'),approval=controls.querySelector('.cc-approval'),live=controls.querySelector('.cc-live');
  let current={},pending=false,closed=false;
  access.onclick=()=>invoke('admin.open',{page:'authorizations'}).catch(report);
  controls.querySelector('.cc-live-settings').onclick=()=>invoke('admin.open',{page:'voice'}).catch(report);
  approval.onclick=()=>{
    const card=[...root.querySelectorAll('[data-question-id]')].find(node=>node.querySelector('[data-authorization-decision]:not(:disabled)'))
      ??root.querySelector('[data-approval-decision]:not(:disabled)')?.closest('.approval-card');
    if(card){card.scrollIntoView({block:'center',behavior:'instant'});(card.querySelector('button:not(:disabled)')??card).focus({preventScroll:true});}
    else invoke('admin.open',{page:'authorizations'}).catch(report);
  };
  const update=data=>{
    current=data;const selected=data.authorizationSandbox;
    controls.querySelector('[data-access-mode]').textContent=selected?.label==='低风险自动'?'低风险自动':({'read-only':'只读','workspace-write':'工作区写入','full-access':'完全访问'})[selected?.mode]??'权限';
    access.title=selected?.label??'管理应用内权限、完全访问和批准规则';
    const count=(data.authorizationQuestions??[]).filter(q=>q.state==='pending').length+(data.approvals??[]).filter(q=>q.state==='pending').length;
    approval.hidden=count===0;approval.textContent=`待批准 · ${count}`;
    live.disabled=pending;live.setAttribute('aria-pressed',String(data.live?.active===true));
    live.querySelector('span').textContent=data.live?.active?'结束语音':'实时语音';
    renderCostRoute(costRouteStatus,data.costRoute,invoke,report);
    live.title=data.live?.active?'结束当前实时语音通话':data.live?.configured?'在原语音面板开启实时语音':'打开语音设置，确认音频用途后启用实时语音';
  };
  live.onclick=async()=>{if(pending||closed)return;pending=true;update(current);try{await invoke('workspace.live.toggle');}catch(error){if(!closed)report(error);}finally{pending=false;if(!closed)update(current);}};
  window.addEventListener('unload',()=>{closed=true;},{once:true});
  return {update};
}
