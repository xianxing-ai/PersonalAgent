export function mountTodoControls(root,invoke) {
  const section=document.createElement('section');section.className='sheet';
  section.innerHTML='<h2>待办与提醒</h2><p>在主对话中创建、改期、完成或取消待办。已保存的提醒会在应用运行时自动出现，重启后按原提醒策略恢复。</p><label><input type="checkbox" data-todo="consent">允许本会话向 AgentArts 提供待办内容并管理待办；具体修改仍经过授权</label><div><button class="btn" data-todo="enable">允许本会话</button> <button class="btn" data-todo="disable">撤销云端访问</button></div><p data-todo="status" role="status"></p><form class="settings-form" data-todo="create-form"><input name="title" maxlength="200" placeholder="新建待办事项…" required><button class="btn" type="submit">添加待办</button></form><ul data-todo="items"></ul><h3>通知</h3><form class="settings-form" data-todo="policy-form"><label>暂停提醒至（留空取消暂停）<input name="pause" type="datetime-local"></label><button class="btn" type="submit">保存通知设置</button></form><ul data-todo="notifications"></ul>';
  root.append(section);const field=name=>section.querySelector(`[data-todo="${name}"]`);
  let state={},busy=false;
  async function run(name,input){busy=true;render(state);let error;
    try{render(await invoke(name,input));}catch{error='操作未完成，请检查 Runtime 连接和本机存储';}
    finally{busy=false;render(state);if(error)field('status').textContent=error;}}
  field('enable').onclick=()=>run('todo.authorize',{readAndCloudConsent:field('consent').checked});
  field('disable').onclick=()=>run('todo.revoke');
  const createForm=section.querySelector('[data-todo="create-form"]');
  createForm.onsubmit=event=>{
    event.preventDefault();
    const title=createForm.elements.title.value.trim();
    if(!title)return;
    createForm.elements.title.value='';
    void run('todo.create',{title});
  };
  section.querySelector('[data-todo="policy-form"]').onsubmit=event=>{event.preventDefault();const value=event.target.elements.pause.value;
    const next={...state.policy};delete next.pauseUntilUtc;if(value)next.pauseUntilUtc=new Date(value).toISOString();
    void run('todo.configureNotifications',next);};
  function render(value={}) {
    const wasAllowed=state.sessionAllowed;state=value;
    field('enable').disabled=busy || !value.available;field('disable').disabled=busy || !value.sessionAllowed;
    if(value.sessionAllowed)field('consent').checked=true;else if(wasAllowed)field('consent').checked=false;
    field('status').textContent=value.reason || '待办尚未连接';
    field('items').replaceChildren();for(const item of value.items ?? []) {
      const row=document.createElement('li'),text=document.createElement('span'),action=document.createElement('button');
      text.textContent=`${item.title} · ${{open:'待完成',done:'已完成',cancelled:'已取消'}[item.status] ?? item.status}${item.reminder?' · '+new Date(item.reminder.remindAt.utc).toLocaleString():''}`;
      action.className='btn btn-sm';action.disabled=busy;
      if(item.status==='open') {
        action.textContent='标为完成';action.onclick=()=>run('todo.update',{id:item.id,status:'done'});
      }
      row.append(text);if(item.status==='open')row.append(' ',action);field('items').append(row);
    }
    field('notifications').replaceChildren();for(const item of value.notifications ?? []) {
      const row=document.createElement('li'),text=document.createElement('span'),dismiss=document.createElement('button');
      text.textContent=item.summary;dismiss.className='btn btn-sm';dismiss.textContent='已读';dismiss.disabled=busy;
      dismiss.onclick=()=>run('todo.dismiss',{id:item.notificationId});row.append(text,' ',dismiss);field('notifications').append(row);
    }
  }
  return {render,show(visible){section.hidden=!visible;}};
}
