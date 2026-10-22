export function mountCalendarControls(root, invoke) {
  const settings = document.createElement('details');
  settings.className = 'sis-settings';
  settings.innerHTML = '<summary>CalDAV 日历配置</summary><div class="sis-fields"><p class="notice">凭据仅在本机加密保存。保存配置不会自动读取或修改日历；需要访问时在当前对话提问卡确认本次范围，不在此重复授权。非本机地址必须 HTTPS；本机地址（localhost/127.0.0.1/[::1]）允许 HTTP（如本地 Radicale 验收服务器）。</p><label>日历名称<input data-calendar="name" autocomplete="off" maxlength="120"></label><label>日历集合地址<input data-calendar="url" type="url" autocomplete="off" maxlength="2048" placeholder="https://server/calendars/user/default/"></label><label>账号<input data-calendar="user" autocomplete="off" maxlength="256"></label><label>应用密码<input data-calendar="password" type="password" autocomplete="off" maxlength="4096" placeholder="原地址及账号未变时留空可保留已存凭据"></label><button data-calendar="save" type="button">保存配置</button><button data-calendar="revoke" type="button">撤销并清除配置</button><p data-calendar="status" class="notice" role="status"></p><div data-calendar="read-controls"><label>日历事件标识（UID）<input data-calendar="event" autocomplete="off" maxlength="512" placeholder="从日历事件获取 UID"></label><button data-calendar="read" type="button">读取此事件</button><button data-calendar="cancel" type="button">停止读取</button><p data-calendar="read-status" class="notice" role="status"></p><p data-calendar="read-result" class="notice"></p></div></div>';
  const anchor = root.querySelector('#error');
  if (anchor) anchor.before(settings); else root.append(settings);
  const field = name => settings.querySelector(`[data-calendar="${name}"]`);
  let busy = false, state = {};
  const buttons = () => {
    const task = state.readTask;
    const active = task && !['succeeded','failed','cancelled','unavailable'].includes(task.state);
    field('save').disabled = busy;
    field('revoke').disabled = busy || (!state.configured && state.status !== 'unavailable');
    field('read-controls').hidden = !state.readAvailable;
    field('read').disabled = busy || active || !state.readAvailable;
    field('cancel').disabled = busy || !active;
  };
  const run = async (action, payload) => {
    busy = true; buttons();
    try {render(await invoke(action, payload));}
    catch {field('status').textContent = '日历配置操作未完成，请检查输入及本机安全存储';}
    finally {busy = false; buttons();}
  };
  field('save').onclick = async () => {
    const payload = {providerKind: 'caldav', calendarUrl: field('url').value.trim(),
      calendarName: field('name').value.trim(), username: field('user').value.trim(),
      password: field('password').value};
    field('password').value = '';
    try {await run('calendar.configure', payload);} finally {payload.password = '';}
  };
  field('revoke').onclick = async () => {
    await run('calendar.revoke');
    if (state.status === 'unconfigured' && !state.configured) {
      for (const name of ['name', 'url', 'user', 'password']) field(name).value = '';
    }
  };
  const readAction = async (action, payload) => {
    busy = true; buttons();
    try {
      const result = await invoke(action,payload);
      if (action === 'calendar.read') state = {...state, readTask: result};
      else if (state.readTask?.taskId) state = {...state, readTask: await invoke('calendar.readTask',state.readTask.taskId)};
      render(state);
    } catch {field('read-status').textContent = '本次读取未完成，请检查事件标识、审批与当前配置';}
    finally {busy = false; buttons();}
  };
  field('read').onclick = () => readAction('calendar.read',{externalId:field('event').value.trim()});
  field('cancel').onclick = () => state.readTask?.taskId && readAction('calendar.cancel',state.readTask.taskId);
  function render(value = {}) {
    state = value ?? {};
    field('status').textContent = `${state.calendarName || 'CalDAV 日历'} · ${state.configured ? '已保存配置' : '未配置'} · ${state.reason ?? '日历读取能力尚未接入'}`;
    const task = state.readTask;
    const messages = {created:'读取任务已受理',planning:'正在准备读取',running:'正在读取日历',
      verifying:'正在核对结果',waiting_approval:'等待本次读取确认',waiting_reconciliation:'结果待核实，请勿重复读取',
      succeeded:'已读取并记录本地执行回执',failed:'读取失败，请检查配置或事件标识',cancelled:'已停止读取',unavailable:'当前读取不可用'};
    field('read-status').textContent = task ? messages[task.state] ?? '读取结果尚未确认' : '选择一条事件读取；结果仅在本机展示';
    field('read-result').textContent = task?.item?.summary ?? '';
    buttons();
  }
  return {render, show(show) {
    settings.hidden = !show;
    if (!show) field('password').value = '';
  }, close() {field('password').value = ''; settings.remove();}};
}
