export function mountFeedsControls(root,invoke) {
  const section=document.createElement('section');section.className='sheet';
  section.innerHTML='<h2>RSS / Atom 订阅</h2><p>订阅地址在本机加密保存。主对话读取、分页或汇总时，通过该次提问卡确认所需访问与出机范围，不在这里预先允许。</p><form class="settings-form"><label>名称<input name="title" maxlength="200" required></label><label>订阅地址<input name="url" type="url" autocomplete="off" required></label><button class="btn" type="submit">添加订阅</button><button class="btn btn-sm" type="button" data-feeds="confirm-check" hidden>已核对列表，继续编辑</button></form><ul data-feeds="list"></ul><details class="feeds-advanced"><summary>高级：来源与跟踪许可</summary><p>仅在已有真实任务需要管理公开来源跟踪时填写原任务编号。</p><label>原任务编号<input data-feeds="task" maxlength="256" autocomplete="off"></label><ul data-feeds="tracking-list"></ul></details><button class="btn" data-feeds="disable">关闭并撤销已有访问</button><p data-feeds="status" role="status"></p>';
  root.append(section);
  const field=name=>section.querySelector(`[data-feeds="${name}"]`);
  const form=section.querySelector('form'),pending=new Set();
  let state={},hostVersion=0,draftRevision=0,unknownCreate=false,feedback='',listKey,visible=true;
  const valid=value=>value && Array.isArray(value.subscriptions) && typeof value.sessionAllowed==='boolean';
  const knownFailure=error=>['INVALID_ARGUMENT','VALIDATION','UNAUTHORIZED','SCOPE_DENIED','UNSUPPORTED_CAPABILITY','CONFIGURATION'].includes(error?.code);
  const failureText=error=>{
    if(['INVALID_ARGUMENT','VALIDATION'].includes(error?.code))return '输入不符合要求，请检查名称和订阅地址。';
    if(['UNAUTHORIZED','SCOPE_DENIED'].includes(error?.code))return '操作未获授权，请检查当前权限。';
    if(['UNSUPPORTED_CAPABILITY','CONFIGURATION'].includes(error?.code))return '订阅服务尚未就绪，请检查连接状态。';
    return '操作结果尚未确认，请先核对列表；不会自动重复添加。';
  };
  async function run(name,input) {
    if(pending.has(name))return false;
    const version=hostVersion;pending.add(name);feedback='';display();
    try {
      const result=await invoke(name,input);
      if(!valid(result)) {if(name==='feeds.add')unknownCreate=true;feedback='操作结果尚未确认，请先核对列表；不会自动重复添加。';return false;}
      if(hostVersion===version) {state=result;hostVersion++;}
      return true;
    } catch(error) {
      if(name==='feeds.add'&&!knownFailure(error))unknownCreate=true;
      feedback=failureText(error);return false;
    } finally {pending.delete(name);display();}
  }
  form.addEventListener('input',()=>{draftRevision++;});
  form.addEventListener('change',()=>{draftRevision++;});
  field('confirm-check').onclick=()=>{unknownCreate=false;feedback='';display();};
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(pending.has('feeds.add')||unknownCreate)return;
    const title=form.elements.title.value,url=form.elements.url.value,revision=draftRevision;
    const input={title:title.trim(),url:url.trim()};
    const confirmed=await run('feeds.add',input);
    input.url='';
    if(confirmed && revision===draftRevision && form.elements.title.value===title && form.elements.url.value===url) {
      form.elements.title.value='';form.elements.url.value='';draftRevision++;
    }
  });
  field('disable').onclick=()=>run('feeds.revoke');
  function display() {
    if(!visible)return;
    form.querySelector('[type="submit"]').disabled=pending.has('feeds.add')||unknownCreate;
    field('confirm-check').hidden=!unknownCreate;
    field('disable').disabled=pending.has('feeds.revoke')||!state.sessionAllowed;
    field('status').textContent=feedback || state.reason || '订阅连接尚未装配';
    const nextKey=JSON.stringify([state.subscriptions??[],pending.has('feeds.remove'),pending.has('feeds.classify')]);
    if(listKey===nextKey)return;
    listKey=nextKey;field('list').replaceChildren();field('tracking-list').replaceChildren();
    for(const item of state.subscriptions??[]) {
      const row=document.createElement('li'),label=document.createElement('span'),remove=document.createElement('button');
      label.textContent=`${item.title} · ${item.sensitivity==='public'?'公开':'私人'}`;
      remove.textContent='移除';remove.className='btn btn-sm';remove.disabled=pending.has('feeds.remove');
      remove.onclick=()=>run('feeds.remove',{id:item.id});row.append(label,' ',remove);field('list').append(row);
      const tracking=document.createElement('li'),name=document.createElement('span'),classify=document.createElement('button');
      name.textContent=item.title;classify.className='btn btn-sm';classify.textContent='来源与跟踪许可';
      classify.disabled=pending.has('feeds.classify');
      classify.onclick=()=>run('feeds.classify',{subscriptionId:item.id,taskId:field('task').value.trim()});
      tracking.append(name,' ',classify);field('tracking-list').append(tracking);
    }
  }
  function render(value) {if(valid(value)){state=value;hostVersion++;}display();}
  return {render,show(value){visible=value;section.hidden=!value;if(value)display();}};
}
