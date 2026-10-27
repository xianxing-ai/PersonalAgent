export function mountMailControls(root, invoke) {
  const settings = document.createElement('details');
  settings.className = 'sis-settings';
  settings.innerHTML = '<summary>QQ 邮件本地分类</summary><div class="sis-fields"><p class="notice">只读取收件箱信头，在本机 Laya 分类；不读取正文，不发送、移动或删除邮件。保存凭据不授予读取或出机许可；发起操作后由对话提问卡确认具体范围，随时可以关闭。</p><label>QQ 邮箱<input data-mail="user" type="email" autocomplete="off" maxlength="254"></label><label>IMAP 授权码<input data-mail="key" type="password" autocomplete="off" maxlength="128" placeholder="仅在本机加密保存"></label><button data-mail="save" type="button">保存配置</button><button data-mail="read" type="button">开始批量分类</button><button data-mail="disable" type="button">关闭并撤销</button><p data-mail="status" class="notice" role="status"></p></div>';
  const anchor = root.querySelector('#error');
  if (anchor) anchor.before(settings); else root.append(settings);
  const field = name => settings.querySelector(`[data-mail="${name}"]`);
  const monitorControls=document.createElement('div');monitorControls.className='sis-fields';
  monitorControls.innerHTML='<h3>新邮件监测</h3><p class="notice">一键启动本地模型并监测新邮件：默认每2分钟检查，本次持续8小时。首次完整读取只建立基线；之后新邮件是否提醒仍由本机判断和通知设置决定。关闭应用后停止，可再次点击恢复。</p><button data-mail="monitorStart" type="button">启动邮件监测</button><button data-mail="monitorStop" type="button">停止监测</button><p data-mail="monitorStatus" class="notice" role="status"></p>';
  field('read').before(monitorControls);
  const cloudControls=document.createElement('div');
  cloudControls.className='sis-fields';
  cloudControls.innerHTML='<p class="notice">可让云端模型复核新收到的模糊邮件，仅发送信头，不含正文；历史积压不自动上传，随时可以停止。</p><button data-mail="cloudEnable" type="button">允许新模糊信头云端复核</button><button data-mail="cloudDisable" type="button">停止云端复核</button><p data-mail="cloudStatus" class="notice" role="status"></p>';
  field('status').before(cloudControls);
  let state = {}, revision=0;
  const pending=new Map();
  const buttons = () => {
    const busy=pending.size>0,monitorStarting=[...pending.values()].some(name=>name==='mail.monitor.start');
    const monitorStopping=[...pending.values()].some(name=>name==='mail.monitor.stop');
    field('save').disabled = busy||state.configurationPending===true;
    const monitoring=state.monitoring??{};
    field('monitorStart').disabled=busy||state.configurationPending===true||!state.configured||state.requiresRestart||monitoring.enabled===true
      ||['starting','created','planning','running','waiting_approval'].includes(monitoring.state);
    const canStop=monitorStarting||monitoring.enabled===true
      ||['starting','created','planning','running','waiting_approval','waiting_reconciliation'].includes(monitoring.state);
    field('monitorStop').disabled=monitorStopping||(busy&&!monitorStarting)||!canStop;
    field('read').disabled = busy || state.configurationPending===true || !state.configured || state.requiresRestart || !state.localModelReady
      || ['unavailable', 'reading', 'waiting_approval', 'classifying', 'stopping', 'stop_unconfirmed'].includes(state.status);
    // 撤销必须在任何时刻可用：sessionAllowed 只代表本会话读取许可，且不跨重启保留。
    // 以它作为撤销前置会让重启后永久无法撤销邮箱配置（2026-10-22 实测）。
    field('disable').disabled = (busy&&!monitorStarting) || !state.configured;
    field('cloudDisable').disabled = busy || !state.cloudAnalysisAllowed;
    field('cloudEnable').disabled = busy || state.configurationPending===true || !state.configured || state.requiresRestart || state.cloudAnalysisAllowed;
  };
  const run = async (name, payload) => {
    const current=++revision;
    if(name==='mail.monitor.stop'||name==='mail.disable')
      for(const [request,operation]of pending)if(operation==='mail.monitor.start')pending.delete(request);
    pending.set(current,name);buttons();
    try {
      const result = await invoke(name, payload);
      if (result&&current===revision) render(result);
    } catch(error) {if(current===revision)field('status').textContent = error?.message || '邮箱操作未完成，请查看当前状态';}
    finally {pending.delete(current);buttons();}
  };
  field('save').onclick = async () => {
    const payload = {user: field('user').value.trim(), authCode: field('key').value.trim()};
    field('key').value = '';
    try {await run('mail.configure', payload);} finally {payload.authCode = '';}
  };
  field('read').onclick = () => run('mail.read');
  field('monitorStart').onclick=()=>run('mail.monitor.start');
  field('monitorStop').onclick=()=>run('mail.monitor.stop');
  field('disable').onclick = () => run('mail.disable');
  field('cloudDisable').onclick=()=>run('mail.disableCloud');
  field('cloudEnable').onclick=()=>run('mail.review.configure',{enabled:true});
  function render(value = {}) {
    state = value;
    const counts = value.counts ?? {};
    const labels = {meeting:'会议', work:'工作', subscription:'订阅', transaction:'订单与账单', personal:'个人', other:'其他'};
    const states = {unconfigured:'未配置', enabled:'已允许', disabled:'已停止', ready:'就绪', unavailable:'不可用',
      reading:'正在读取', running:'正在读取', pending:'等待处理', classifying:'正在分类', classification_unavailable:'分类中断，可重试',
      complete:'本批处理完成', failed:'读取失败', cancelled:'已取消', stop_unconfirmed:'正在确认停止',
      resync_required:'分页已失效，点击开始批量分类重新同步'};
    const groups = Object.entries(counts.groups ?? {}).map(([key,count]) => `${labels[key] || key} ${count}`).join('，');
    const monitor=value.monitoring??{},monitorStates={stopped:'未启动',starting:'正在启动本地模型',created:'正在准备监测',planning:'正在准备监测',
      running:'正在启动监测',waiting_origin:'监测已创建，等待首次检查',monitoring:'监测中',reading:'正在检查邮件',waiting_source:'等待本地分类任务结束',
      waiting_approval:'等待授权，请查看主对话授权卡',waiting_reconciliation:'原操作结果待核实',failed:'监测启动或读取失败',cancelled:'已取消',
      classification_unavailable:'本地分类中断，请点击启动恢复',expired:'本次监测已到期',revoked:'重启或配置变更后已停止，请点击启动恢复',
      needs_reauthorization:'需要重新启动监测',disabled:'已停止',resync_required:'邮箱需要重新同步'};
    const baselineStates={waiting_first_read:'等待首次读取；首次完整读取后才开始提醒',
      establishing_baseline:'正在建立首读基线；首次完整读取后才开始提醒',
      ready:'首读基线已建立；后续提醒仍由本机判断和通知设置决定',
      epoch_pending:'邮箱状态已变化，正在重新确认首读基线；确认前暂不提醒新邮件',
      unknown:'基线状态未核实；如持续未恢复，请重新启动监测'};
    const baselineState=Object.hasOwn(baselineStates,monitor.baselineState)?monitor.baselineState:'unknown';
    const monitorLabel=monitor.state==='monitoring'&&monitor.enabled&&baselineState!=='ready'
      ?baselineState==='unknown'?'监测状态待核实':'监测计划已建立'
      :monitorStates[monitor.state]??monitor.state??'未启动';
    const displayTime=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'';
    field('monitorStatus').textContent=`${monitorLabel}${monitor.enabled?' · '+baselineStates[baselineState]:''}${monitor.lastCheckedAt?' · 最近检查 '+displayTime(monitor.lastCheckedAt):''}${monitor.enabled&&monitor.nextCheckAt?' · 下次检查 '+displayTime(monitor.nextCheckAt):''}${monitor.enabled&&monitor.expiresAt?' · 到期 '+displayTime(monitor.expiresAt):''}${monitor.errorCode?' · '+monitor.errorCode:''}`;
    field('status').textContent = `${value.account || '未配置邮箱'} · ${states[value.status] || value.status || '未配置'}${value.requiresRestart ? ' · 配置已保存，下次启动生效' : ''} · 已处理 ${counts.total ?? 0}，待核对 ${counts.needsReview ?? 0}，云复核 ${counts.cloudReviewed ?? 0}，会议候选 ${counts.meetingCandidates ?? 0}${groups ? ` · ${groups}` : ''}${value.configurationPending ? ' · 配置正在更新' : ''}${!value.localModelReady ? ' · 启动监测时自动准备本地 Laya' : ''}${value.reason ? ` · ${value.reason}` : ''}`;
    const analyses=value.analyses?.tasks ?? [];
    const reviewCounts=typeof value.analyses?.reviewed==='number'?` · 复核完成 ${value.analyses.reviewed}，处理中 ${value.analyses.pending??0}，未完成 ${value.analyses.failed??0}`
      :analyses.length?` · 已交接 ${analyses.length}，完成 ${analyses.filter(item=>item.state==='succeeded').length}`:'';
    field('cloudStatus').textContent=`${value.cloudAnalysisAllowed?'新模糊信头云复核已开启；分类结果保留在本机，重要邮件按通知策略提醒':'云复核未开启；本地分类可独立运行'}${reviewCounts}${value.analyses?.failed?' · 云复核未完成的邮件保留本地结果，不代表邮箱读取失败':''}${value.analyses?.reason?` · ${value.analyses.reason}`:''}`;
    buttons();
  }
  return {render, showSettings(show) {settings.hidden = !show;}, close() {field('key').value = ''; settings.remove();}};
}
