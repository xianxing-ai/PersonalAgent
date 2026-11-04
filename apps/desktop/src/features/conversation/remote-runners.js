/** Remote runner panel. Secrets never enter the DOM. */
export function mountRemoteRunners(root, invoke) {
  const section = document.createElement('section');
  section.className = 'remote-runners';
  section.setAttribute('aria-label', '远端执行器');
  const title = document.createElement('h2');
  title.textContent = '远端执行器';
  const status = document.createElement('p');
  status.className = 'remote-runners-status';
  const list = document.createElement('ul');
  const cloudStatus = document.createElement('p');
  cloudStatus.setAttribute('role', 'status');
  section.append(title, status, cloudStatus, list);
  root.append(section);
  let closed = false;
  let busy = false, generation = 0;
  let cloudButtons = [];
  const uncertain = new Map();
  const sessionKey = session => `${session.sourceTaskId}:${session.commandId}`;
  function text(tag, value) {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  }
  function cloudButton(label, action, disabled = false) {
    const button = text('button', label);
    button.type = 'button';
    button.disabled = busy || disabled;
    button.onclick = () => {if (!closed && !button.disabled && !busy) return action();};
    cloudButtons.push(button);
    return button;
  }
  async function cloudAction(operation, payload, session) {
    if (closed || busy) return;
    busy = true;
    generation++;
    for (const button of cloudButtons) button.disabled = true;
    uncertain.set(sessionKey(session), {...session, transportState: 'unknown'});
    let confirmed = false;
    try {
      const result = await invoke(`proactive.workflow.cloud.${operation}`, payload);
      confirmed = result?.state === 'confirmed';
      if (confirmed) uncertain.delete(sessionKey(session));
      else uncertain.set(sessionKey(session), {...session, transportState: result?.state ?? 'unknown'});
    } catch { /* A lost reply must be read back with the original submission identity. */ }
    finally {
      busy = false;
      await refresh();
      if (!closed && !confirmed) cloudStatus.textContent = '本次云操作结果未确认，请读回原会话；不会自动重试。';
    }
  }
  function cloudPanel(snapshot) {
    const panel = document.createElement('section');
    panel.setAttribute('aria-label', '云持续会话');
    panel.append(text('h3', '云持续会话'), text('p', '按原任务目标新建独立云会话，不迁移已有会话。配置不代表真实验收通过。'));
    const sources = Array.isArray(snapshot.sourceTasks) ? snapshot.sourceTasks : [];
    const sessions = new Map((snapshot.sessions ?? []).map(session => [sessionKey(session), {...session, hostId: snapshot.hostId}]));
    for (const [key, session] of uncertain) if (session.hostId === snapshot.hostId) sessions.set(key, {...sessions.get(key), ...session});
    if (sources.length) {
      const source = document.createElement('select');
      source.setAttribute('aria-label', '原任务目标');
      for (const task of sources) {
        const option = text('option', task.goal);
        option.value = task.taskId;
        source.append(option);
      }
      source.value = sources[0].taskId;
      const minutes = document.createElement('input');
      minutes.type = 'number'; minutes.min = '1'; minutes.step = '1'; minutes.value = '30';
      minutes.setAttribute('aria-label', '云会话期限（分钟）');
      const pending = () => [...sessions.values()].some(session => session.sourceTaskId === source.value && session.transportState !== 'confirmed');
      const start = cloudButton('新建云持续会话', () => {
        const duration = Number(minutes.value), deadline = Date.now() + duration * 60_000;
        if (pending() || !sources.some(task => task.taskId === source.value)) return;
        if (!Number.isSafeInteger(duration) || duration < 1 || !Number.isFinite(new Date(deadline).getTime())) {
          cloudStatus.textContent = '请输入有效的正整数分钟期限。'; return;
        }
        const session = {sourceTaskId: source.value, commandId: crypto.randomUUID(), hostId: snapshot.hostId};
        return cloudAction('start', {sourceTaskId: session.sourceTaskId, commandId: session.commandId, taskDeadline: new Date(deadline).toISOString()}, session);
      }, pending());
      source.onchange = () => {start.disabled = busy || pending();};
      panel.append(source, minutes, start);
    } else panel.append(text('p', '云持续会话不可用：没有可用的原用户任务。'));
    for (const session of sessions.values()) {
      const row = document.createElement('article'), reply = session.lastReply;
      const goal = sources.find(task => task.taskId === session.sourceTaskId)?.goal ?? '原任务';
      row.append(text('h4', goal), text('p', `原提交 ${session.commandId} · 传输 ${session.transportState ?? 'unknown'}`));
      if (reply) row.append(text('p', `云任务 ${reply.target.taskId} · ${reply.task.state} · 控制版本 ${reply.controlRevision}`));
      const identity = () => ({sourceTaskId: session.sourceTaskId, originCommandId: session.commandId, commandId: crypto.randomUUID()});
      row.append(cloudButton('读回原会话', () => cloudAction('read', identity(), session)));
      const confirmed = session.transportState === 'confirmed' && reply && Number.isInteger(reply.controlRevision);
      if (confirmed && !['cancelled', 'failed', 'succeeded'].includes(reply.task.state)) {
        for (const [action, label] of [['pause', '暂停'], ['resume', '继续'], ['cancel', '取消'], ['return', '返回有人值守'], ['enter_unattended', '进入无人值守']]) {
          row.append(cloudButton(label, () => cloudAction('control', {...identity(), target: reply.target,
            control: {action, expectedControlRevision: reply.controlRevision}}, session)));
        }
      }
      const selected=(reply?.sources??[]).some(value=>value.revision>0);
      for(const source of reply?.sources??[]){
        row.append(text('p', `${source.title} · ${source.url} · ${source.state} · 每 ${source.intervalSeconds} 秒检查`));
        if(source.state==='available'&&!selected)row.append(cloudButton('同意公开订阅跟踪与云端分析',()=>cloudAction('source',{
          ...identity(),target:reply.target,source:{action:'track',sourceId:source.sourceId,configurationRef:source.configurationRef,
            expectedRevision:source.revision,readAndCloudConsent:true}},session),!confirmed||['cancelled','failed','succeeded'].includes(reply.task.state)));
        if(source.revision>0&&source.state!=='revoked')row.append(cloudButton('撤销跟踪并取消云会话',()=>cloudAction('source',{
          ...identity(),target:reply.target,source:{action:'revoke',sourceId:source.sourceId,configurationRef:source.configurationRef,
            expectedRevision:source.revision}},session),!confirmed));
      }
      if(reply?.sources?.length)row.append(text('p','跟踪期限与本云会话一致；每次实际读取仍需审批，结果未确认时不会重新采集。'));
      for (const approval of reply?.approvals ?? []) {
        if (approval.state !== 'pending') continue;
        const validArguments = approval.arguments && typeof approval.arguments === 'object' && !Array.isArray(approval.arguments);
        row.append(text('p', `待审批操作：${approval.action} · 摘要 ${approval.argumentsDigest} · 到期 ${approval.expiresAt}`),
          text('pre', validArguments ? JSON.stringify(approval.arguments, null, 2) : '审批参数未读回，不能批准。'));
        for (const [decision, label] of [['allow_once', '允许一次'], ['deny', '拒绝']]) {
          row.append(cloudButton(label, () => cloudAction('approval', {...identity(), target: reply.target,
            approval: {approvalId: approval.approvalId, expectedRevision: approval.revision, argumentsDigest: approval.argumentsDigest,
              expiresAt: approval.expiresAt, decision,...(approval.taskId?{taskId:approval.taskId}:{})}}, session), !confirmed || !validArguments || !(Date.parse(approval.expiresAt) > Date.now())));
        }
      }
      panel.append(row);
    }
    return panel;
  }
  function row(host, cloud) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${host.name} · ${host.user}@${host.address}:${host.port} · ${host.provider} · ${host.enabled ? '启用' : '停用'} · ${host.health ?? '未检测'}`;
    const test = document.createElement('button');
    test.type = 'button';
    test.textContent = '测试连接';
    test.onclick = () => invoke('runner.hosts.test', {id: host.id}).then(refresh).catch(() => {status.textContent = '连接测试没有完成';});
    const disable = document.createElement('button');
    disable.type = 'button';
    disable.textContent = host.enabled ? '停用' : '启用';
    disable.onclick = () => invoke(host.enabled ? 'runner.hosts.disable' : 'runner.hosts.enable', {id: host.id}).then(refresh).catch(() => {status.textContent = '状态没有更新';});
    item.append(label, test, disable);
    if (host.enabled && cloud?.state === 'configured_not_verified' && cloud.hostId === host.id) item.append(cloudPanel(cloud));
    return item;
  }
  function refresh() {
    if (closed) return Promise.resolve();
    const current = ++generation;
    return Promise.all([Promise.resolve().then(() => invoke('runner.hosts.list', {})),
      Promise.resolve().then(() => invoke('proactive.workflow.cloud.status', {})).catch(() => ({state: 'unavailable'}))]).then(([result, cloud]) => {
      if (closed || current !== generation) return;
      const hosts = Array.isArray(result?.hosts) ? result.hosts : [];
      const jobs = Array.isArray(result?.jobs) ? result.jobs : [];
      cloudButtons = [];
      list.replaceChildren(...hosts.map(host => row(host, cloud)));
      status.textContent = hosts.length ? `主机 ${hosts.length} 台，任务记录 ${jobs.length} 条` : '还没有远端执行器';
      cloudStatus.textContent = cloud?.state === 'configured_not_verified' && hosts.some(host => host.enabled && host.id === cloud.hostId)
        ? '云持续宿主已配置，尚未完成真实验收。' : '云持续会话不可用：尚未配置可用宿主。';
    }).catch(() => {
      if (!closed && current === generation) {
        status.textContent = '远端执行器读取失败';
        for (const button of cloudButtons) button.disabled = true;
      }
    });
  }
  return {refresh, dispose() {closed = true;}};
}
