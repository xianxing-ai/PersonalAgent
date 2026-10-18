export function mountNotepadControls(container, invoke) {
  const section = document.createElement('section');
  section.className = 'feature-page notepad-controls'; section.setAttribute('aria-label','记事本写入');
  section.innerHTML = `<h2>写入新记事本</h2><p class="notice">先填写内容，再新建空白窗口。确认窗口后，保持记事本在前台并按 F9，仅允许本次写入。应用会核对写入结果，不会自动保存文件。</p><form class="settings-list"><label class="setting-row notepad-text">要写入的文本<textarea name="text" maxlength="4096" rows="5" required></textarea></label><div><button class="btn btn-sm" type="submit">新建并准备写入</button> <button class="btn btn-sm" type="button" data-cancel>停止本次操作</button></div></form><p class="notice" data-status role="status"></p><p class="notice" data-task></p>`;
  container.append(section);
  const recovery=document.createElement('div'),select=document.createElement('select'),check=document.createElement('button');
  select.setAttribute('aria-label','原始待核实任务');check.type='button';check.className='btn btn-sm';check.textContent='核实执行结果';
  recovery.append(select,' ',check);section.append(recovery);
  const form = section.querySelector('form'), submit = form.querySelector('[type="submit"]');
  const cancel = section.querySelector('[data-cancel]'), status = section.querySelector('[data-status]');
  let state = {}, pending = false;
  async function run(name,payload) {
    pending = true; render(state); let failure;
    try {render(await invoke(name,payload));}
    catch {failure = '操作未受理，请检查执行组件、文本与当前任务状态。';}
    finally {pending = false; render(state); if(failure) status.textContent=failure;}
  }
  form.addEventListener('submit',event => {event.preventDefault();if(pending || submit.disabled)return;void run('notepad.start',{text:form.elements.text.value});});
  cancel.onclick = () => run('notepad.cancel');
  check.onclick = () => run('notepad.reconcile',{taskId:select.value});
  function render(value = {}) {
    state=value; submit.disabled=pending || !value.available || value.busy || value.recovering || value.pendingTasks?.length > 0;
    form.elements.text.disabled=pending || value.busy;
    cancel.disabled=pending || !value.busy;
    const selected=select.value;select.replaceChildren();
    for (const task of value.pendingTasks ?? []) {
      const option=document.createElement('option');option.value=task.taskId;option.textContent=task.taskId;select.append(option);
    }
    if ([...select.options].some(option=>option.value === selected)) select.value=selected;
    select.disabled=pending || value.recovering;
    check.disabled=pending || value.busy || value.recovering || !value.recoveryAvailable || !select.value;
    status.textContent=value.reason || '本机执行组件尚未就绪。';
    section.querySelector('[data-task]').textContent=value.taskId ? `任务：${value.taskId}${value.evidenceRefs?.length ? ' · 已记录执行证据' : ''}` : '';
  }
  return {render,show(value) {section.hidden=!value;}};
}
