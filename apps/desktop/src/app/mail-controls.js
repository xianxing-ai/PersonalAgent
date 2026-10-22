export function mountMailControls(root, invoke) {
  const settings = document.createElement('details');
  settings.className = 'sis-settings';
  settings.innerHTML = '<summary>QQ 邮件本地分类</summary><div class="sis-fields"><p class="notice">只读取收件箱信头，在本机 Laya 分类；不读取正文，不发送、移动或删除邮件。保存凭据不授予读取或出机许可；发起操作后由对话提问卡确认具体范围，随时可以关闭。</p><label>QQ 邮箱<input data-mail="user" type="email" autocomplete="off" maxlength="254"></label><label>IMAP 授权码<input data-mail="key" type="password" autocomplete="off" maxlength="128" placeholder="仅在本机加密保存"></label><button data-mail="save" type="button">保存配置</button><button data-mail="read" type="button">开始批量分类</button><button data-mail="disable" type="button">关闭并撤销</button><p data-mail="status" class="notice" role="status"></p></div>';
  const anchor = root.querySelector('#error');
  if (anchor) anchor.before(settings); else root.append(settings);
  const field = name => settings.querySelector(`[data-mail="${name}"]`);
  const cloudControls=document.createElement('div');
  cloudControls.className='sis-fields';
  cloudControls.innerHTML='<p class="notice">需要主智能体分析时，在主对话发起请求；该次卡片会列出所需邮件访问与 AgentArts 出机范围。</p><button data-mail="cloudDisable" type="button">停止已有云端分析</button><p data-mail="cloudStatus" class="notice" role="status"></p>';
  field('status').before(cloudControls);
  let busy = false, state = {};
  const buttons = () => {
    field('save').disabled = busy;
    field('read').disabled = busy || !state.configured || state.requiresRestart || !state.localModelReady
      || ['unavailable', 'reading', 'waiting_approval', 'classifying', 'stopping', 'stop_unconfirmed'].includes(state.status);
    // 撤销必须在任何时刻可用：sessionAllowed 只代表本会话读取许可，且不跨重启保留。
    // 以它作为撤销前置会让重启后永久无法撤销邮箱配置（2026-10-22 实测）。
    field('disable').disabled = busy || !state.configured;
    field('cloudDisable').disabled = busy || !state.cloudAnalysisAllowed;
  };
  const run = async (name, payload) => {
    busy = true; buttons();
    try {
      const result = await invoke(name, payload);
      if (result) render(result);
    } catch {field('status').textContent = '邮箱操作未完成，请查看本地状态或重新配置';}
    finally {busy = false; buttons();}
  };
  field('save').onclick = async () => {
    const payload = {user: field('user').value.trim(), authCode: field('key').value.trim()};
    field('key').value = '';
    try {await run('mail.configure', payload);} finally {payload.authCode = '';}
  };
  field('read').onclick = () => run('mail.read');
  field('disable').onclick = () => run('mail.disable');
  field('cloudDisable').onclick=()=>run('mail.disableCloud');
  function render(value = {}) {
    state = value;
    const counts = value.counts ?? {};
    const labels = {meeting:'会议', work:'工作', subscription:'订阅', transaction:'订单与账单', personal:'个人', other:'其他'};
    const states = {unconfigured:'未配置', enabled:'已允许', disabled:'已停止', ready:'就绪', unavailable:'不可用',
      reading:'正在读取', running:'正在读取', pending:'等待处理', classifying:'正在分类', classification_unavailable:'分类中断，可重试',
      complete:'本批分类完成', failed:'读取失败', cancelled:'已取消', stop_unconfirmed:'正在确认停止',
      resync_required:'分页已失效，点击开始批量分类重新同步'};
    const groups = Object.entries(counts.groups ?? {}).map(([key,count]) => `${labels[key] || key} ${count}`).join('，');
    field('status').textContent = `${value.account || '未配置邮箱'} · ${states[value.status] || value.status || '未配置'}${value.requiresRestart ? ' · 配置已保存，下次启动生效' : ''} · 已分类 ${counts.total ?? 0}，待核对 ${counts.needsReview ?? 0}，会议候选 ${counts.meetingCandidates ?? 0}${groups ? ` · ${groups}` : ''}${!value.localModelReady ? ' · 请先启动本地 Laya' : ''}${value.reason ? ` · ${value.reason}` : ''}`;
    const analyses=value.analyses?.tasks ?? [];
    field('cloudStatus').textContent=`${value.cloudAnalysisAllowed?'主智能体分析已开启，结果保留在主对话':'云端分析未开启；本地分类可独立运行'}${analyses.length?` · 已交接 ${analyses.length}，完成 ${analyses.filter(item=>item.state==='succeeded').length}`:''}${value.analyses?.reason?` · ${value.analyses.reason}`:''}`;
    buttons();
  }
  return {render, showSettings(show) {settings.hidden = !show;}, close() {field('key').value = ''; settings.remove();}};
}
