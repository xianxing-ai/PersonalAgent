export function mountFeedsControls(root,invoke) {
  const section = document.createElement('section'); section.className = 'sheet';
  section.innerHTML = '<h2>RSS / Atom 订阅</h2><p>订阅地址在本机加密保存。主对话读取、分页或汇总时，通过该次提问卡确认所需访问与出机范围，不在这里预先允许。</p><form class="settings-form"><label>名称<input name="title" maxlength="200" required></label><label>订阅地址<input name="url" type="url" autocomplete="off" required></label><button class="btn" type="submit">添加订阅</button></form><ul data-feeds="list"></ul><button class="btn" data-feeds="disable">关闭并撤销已有访问</button><p data-feeds="status" role="status"></p>';
  root.append(section);
  const taskLabel=document.createElement('label'),taskInput=document.createElement('input');
  taskLabel.textContent='公开跟踪许可对应的原任务编号';taskInput.maxLength=256;taskInput.autocomplete='off';
  taskLabel.append(taskInput);section.querySelector('[data-feeds="list"]').before(taskLabel);
  const field = name => section.querySelector(`[data-feeds="${name}"]`);
  const form = section.querySelector('form'); let state = {}, busy = false;
  async function run(name,input) {
    busy = true; render(state);
    let error;
    try {render(await invoke(name,input));}
    catch {error = '订阅操作未完成，请检查配置和当前连接状态';}
    finally {busy = false; render(state); if (error) field('status').textContent = error;}
  }
  form.addEventListener('submit',event => {
    event.preventDefault();
    const input = {title:form.elements.title.value.trim(),url:form.elements.url.value.trim()};
    form.elements.url.value = '';
    void run('feeds.add',input).finally(() => {input.url='';});
  });
  field('disable').onclick = () => run('feeds.revoke');
  function render(value = {}) {
    state = value;
    const list = field('list'); list.replaceChildren();
    for (const item of value.subscriptions ?? []) {
      const row = document.createElement('li'), label = document.createElement('span'), remove = document.createElement('button');
      label.textContent = `${item.title} · ${item.sensitivity === 'public' ? '公开' : '私人'}`; remove.textContent = '移除'; remove.className = 'btn btn-sm';
      remove.disabled = busy; remove.onclick = () => run('feeds.remove',{id:item.id});
      const classify=document.createElement('button');classify.className='btn btn-sm';classify.textContent='来源与跟踪许可';
      classify.disabled=busy;classify.onclick=()=>run('feeds.classify',{subscriptionId:item.id,taskId:taskInput.value.trim()});
      row.append(label,' ',classify,' ',remove); list.append(row);
    }
    form.querySelector('button').disabled = busy;
    taskInput.disabled=busy;
    field('disable').disabled = busy || !value.sessionAllowed;
    field('status').textContent = value.reason || '订阅连接尚未装配';
  }
  return {render,show(visible) {section.hidden=!visible;}};
}
