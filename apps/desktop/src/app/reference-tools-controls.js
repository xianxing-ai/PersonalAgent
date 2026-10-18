export function mountReferenceToolsControls(root,invoke) {
  const host=document.createElement('section');host.className='sheet reference-tools-settings';
  host.innerHTML='<h2>工作区参考工具</h2><p class="muted">使用已许可的工作区读取参考文件。依照本会话读取许可执行；撤销许可会停止旧任务。</p><p data-reference-state></p><div class="setting-row"><button class="btn" data-reference="mcp">连接只读服务</button><button class="btn" data-reference="skill">启用参考摘要</button></div><div class="settings-form"><label>参考文件的相对路径<input class="field" data-reference-path placeholder="docs/reference.md" autocomplete="off"></label></div><button class="btn" data-reference="run">生成参考摘要</button><p class="notice" role="status" data-reference-result></p>';
  root.append(host);let state;const pending=new Set();
  const result=host.querySelector('[data-reference-result]');
  const syncButtons=()=>{
    if(!host.isConnected)return;
    for(const action of ['mcp','skill','run'])host.querySelector(`[data-reference="${action}"]`).disabled=
      pending.has(action)||(action==='run'&&(pending.has('mcp')||pending.has('skill')||state?.skill?.health?.state!=='ready'))
      ||(action==='skill'&&state?.skill?.health?.enabled!==true&&state?.mcp?.connected!==true);
  };
  host.addEventListener('click',async event=>{
    const button=event.target.closest('[data-reference]');if(!button)return;
    const action=button.dataset.reference;
    if(button.disabled||pending.has(action)||!host.isConnected)return;
    pending.add(action);syncButtons();result.textContent='';
    try {
      const value=await invoke('reference.'+action,action==='run'?{path:host.querySelector('[data-reference-path]').value}
        :{enabled:action==='mcp'?!state?.mcp?.connected:!state?.skill?.health?.enabled});
      if(!host.isConnected)return;
      if(action==='run')result.textContent='已创建任务 '+value.taskId+'；授权与结果可在任务和安全页面查看。';
    } catch {if(host.isConnected)result.textContent='操作未完成，请检查工作区许可、服务状态及任务授权。';}
    finally {pending.delete(action);syncButtons();}
  });
  syncButtons();
  return {show:visible=>{host.hidden=!visible;},render(value){state=value;
    host.querySelector('[data-reference-state]').textContent='只读服务：'+(value?.mcp?.state??'unavailable')+'；参考摘要：'+(value?.skill?.health?.state??'unavailable');
    host.querySelector('[data-reference="mcp"]').textContent=value?.mcp?.connected?'停止只读服务':'连接只读服务';
    host.querySelector('[data-reference="skill"]').textContent=value?.skill?.health?.enabled?'停用参考摘要':'启用参考摘要';
    syncButtons();
  }};
}
