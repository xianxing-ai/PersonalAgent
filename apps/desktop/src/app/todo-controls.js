export function mountTodoControls(root,invoke) {
  const section=document.createElement('section');section.className='sheet';
  section.innerHTML='<h2>待办与提醒</h2><p>在主对话中创建、改期、完成或取消待办。需要访问或出机时，在该次对话提问卡选择授权，无需先在设置允许。已保存的提醒会在应用运行时自动出现，重启后按原提醒策略恢复。</p><button class="btn" data-todo="disable">撤销已有云端访问</button><p data-todo="status" role="status"></p><form class="settings-form" data-todo="create-form"><input name="title" maxlength="200" placeholder="新建待办事项…" required><label>提醒（可选）<input name="remind" type="datetime-local"></label><button class="btn" type="submit">添加待办</button><button class="btn btn-sm" type="button" data-todo="confirm-check" hidden>已核对列表，继续编辑</button></form><ul data-todo="items"></ul><h3>通知</h3><form class="settings-form" data-todo="policy-form"><label>暂停提醒至（留空取消暂停）<input name="pause" type="datetime-local"></label><button class="btn" type="submit">保存通知设置</button></form><ul data-todo="notifications"></ul>';
  root.append(section);const field=name=>section.querySelector(`[data-todo="${name}"]`);
  const createForm=field('create-form'),pending=new Set();
  let state={},hostVersion=0,draftRevision=0,unknownCreate=false,feedback='',itemsKey,notificationsKey,visible=true;
  const valid=value=>value && Array.isArray(value.items) && Array.isArray(value.notifications);
  const knownFailure=error=>['INVALID_ARGUMENT','VALIDATION','UNAUTHORIZED','SCOPE_DENIED','UNSUPPORTED_CAPABILITY','CONFIGURATION'].includes(error?.code);
  const failureText=error=>{
    if(['INVALID_ARGUMENT','VALIDATION'].includes(error?.code))return '输入不符合要求，请检查待办内容和时间。';
    if(['UNAUTHORIZED','SCOPE_DENIED'].includes(error?.code))return '操作未获授权，请检查当前权限。';
    if(['UNSUPPORTED_CAPABILITY','CONFIGURATION'].includes(error?.code))return '待办服务尚未就绪，请检查连接状态。';
    return '操作结果尚未确认，请先核对列表；不会自动重复添加。';
  };
  async function run(name,input) {
    if(pending.has(name))return false;
    const version=hostVersion;pending.add(name);feedback='';display();
    try {
      const result=await invoke(name,input);
      if(!valid(result)) {if(name==='todo.create')unknownCreate=true;feedback='操作结果尚未确认，请先核对列表；不会自动重复添加。';return false;}
      if(hostVersion===version) {state=result;hostVersion++;}
      return true;
    } catch(error) {
      if(name==='todo.create'&&!knownFailure(error))unknownCreate=true;
      feedback=failureText(error);return false;
    } finally {pending.delete(name);display();}
  }
  field('disable').onclick=()=>run('todo.revoke');
  createForm.addEventListener('input',()=>{draftRevision++;});
  createForm.addEventListener('change',()=>{draftRevision++;});
  field('confirm-check').onclick=()=>{unknownCreate=false;feedback='';display();};
  createForm.onsubmit=async event=>{
    event.preventDefault();
    if(pending.has('todo.create')||unknownCreate)return;
    const titleValue=createForm.elements.title.value,remind=createForm.elements.remind.value;
    const title=titleValue.trim();if(!title)return;
    const revision=draftRevision,payload={title};
    if(remind)payload.remindUtc=new Date(remind).toISOString();
    const confirmed=await run('todo.create',payload);
    if(confirmed && revision===draftRevision && createForm.elements.title.value===titleValue && createForm.elements.remind.value===remind) {
      createForm.elements.title.value='';createForm.elements.remind.value='';draftRevision++;
    }
  };
  section.querySelector('[data-todo="policy-form"]').onsubmit=event=>{event.preventDefault();const value=event.target.elements.pause.value;
    const next={...state.policy};delete next.pauseUntilUtc;if(value)next.pauseUntilUtc=new Date(value).toISOString();
    void run('todo.configureNotifications',next);};
  function display() {
    if(!visible)return;
    field('disable').disabled=pending.has('todo.revoke') || !state.sessionAllowed;
    createForm.querySelector('[type="submit"]').disabled=pending.has('todo.create')||unknownCreate;
    field('confirm-check').hidden=!unknownCreate;
    field('status').textContent=feedback || state.reason || '待办尚未连接';
    const nextItemsKey=JSON.stringify([state.items??[],pending.has('todo.update')]);
    if(itemsKey!==nextItemsKey) {
      itemsKey=nextItemsKey;field('items').replaceChildren();for(const item of state.items ?? []) {
        const row=document.createElement('li'),text=document.createElement('span'),action=document.createElement('button');
        text.textContent=`${item.title} · ${{open:'待完成',done:'已完成',cancelled:'已取消'}[item.status] ?? item.status}${item.reminder?' · '+new Date(item.reminder.remindAt.utc).toLocaleString():''}`;
        action.className='btn btn-sm';action.disabled=pending.has('todo.update');
        if(item.status==='open') {action.textContent='标为完成';action.onclick=()=>run('todo.update',{id:item.id,status:'done'});}
        row.append(text);if(item.status==='open')row.append(' ',action);field('items').append(row);
      }
    }
    const nextNotificationsKey=JSON.stringify([state.notifications??[],pending.has('todo.dismiss')]);
    if(notificationsKey!==nextNotificationsKey) {
      notificationsKey=nextNotificationsKey;field('notifications').replaceChildren();for(const item of state.notifications ?? []) {
        const row=document.createElement('li'),text=document.createElement('span'),dismiss=document.createElement('button');
        text.textContent=item.summary;dismiss.className='btn btn-sm';dismiss.textContent='已读';dismiss.disabled=pending.has('todo.dismiss');
        dismiss.onclick=()=>run('todo.dismiss',{id:item.notificationId});row.append(text,' ',dismiss);field('notifications').append(row);
      }
    }
  }
  function render(value) {if(valid(value)){state=value;hostVersion++;}display();}
  return {render,show(value){visible=value;section.hidden=!value;if(value)display();}};
}
