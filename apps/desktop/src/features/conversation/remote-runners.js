/** Remote runner panel. Secrets never enter the DOM. */
function validConnectionAddress(address) {
  if (typeof address !== 'string' || address.length > 253) return false;
  try {
    if (address.includes(':')) return /^[a-f\d:.]+$/i.test(address) && Boolean(new URL(`http://[${address}]/`).hostname);
    return address.replace(/\.$/, '').split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))
      && new URL(`http://${address}/`).hostname === address.toLowerCase();
  } catch { return false; }
}

export function mountRemoteRunners(root, invoke) {
  const section = document.createElement('section');
  section.className = 'remote-runners';
  section.setAttribute('aria-label', '远端执行器');
  const title = document.createElement('h2');
  title.textContent = '远端执行器';
  const toolbar = document.createElement('div');
  toolbar.className = 'rr-toolbar';
  const toggleFormButton = document.createElement('button');
  toggleFormButton.type = 'button';
  toggleFormButton.className = 'btn btn-primary btn-sm';
  toggleFormButton.textContent = '添加 VPS / 云电脑';
  const refreshListButton = document.createElement('button');
  refreshListButton.type = 'button';
  refreshListButton.className = 'btn btn-sm rr-refresh-btn';
  refreshListButton.textContent = '刷新列表';
  const status = document.createElement('p');
  status.className = 'remote-runners-status';
  status.setAttribute('role', 'status');
  toolbar.append(toggleFormButton, refreshListButton, status);
  const cloudStatus = document.createElement('p');
  cloudStatus.className = 'rr-cloud-status';
  cloudStatus.setAttribute('role', 'status');
  const vpsNoteHost = document.createElement('div');
  vpsNoteHost.className = 'rr-vps-host';
  const formHost = document.createElement('div');
  const list = document.createElement('ul');
  list.className = 'rr-host-list';
  section.append(title, toolbar, cloudStatus, vpsNoteHost, formHost, list);
  root.append(section);
  let closed = false;
  let busy = false, generation = 0;
  let formOpen = false;
  let cloudButtons = [];
  const uncertain = new Map();
  const sessionKey = session => `${session.sourceTaskId}:${session.commandId}`;
  function text(tag, value, className = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  }
  function showVpsMessage(message, tunnelCmd = '') {
    if (closed) return;
    if (!message && !tunnelCmd) {
      vpsNoteHost.replaceChildren();
      return;
    }
    const box = document.createElement('div');
    box.className = 'rr-vps-result';
    box.setAttribute('role', 'status');
    const summaryEl = text('p', message, 'rr-vps-summary');
    box.append(summaryEl);
    if (tunnelCmd) {
      const cmdWrap = document.createElement('div');
      cmdWrap.className = 'rr-tunnel-row';
      const cmdCode = text('code', tunnelCmd, 'rr-tunnel-cmd');
      const copyBtn = text('button', '复制隧道命令', 'btn btn-sm');
      copyBtn.type = 'button';
      const copyStatus = text('span', '', 'rr-copy-hint');
      copyBtn.onclick = async () => {
        if (closed) return;
        try {
          if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
            await navigator.clipboard.writeText(tunnelCmd);
            if (!closed) copyStatus.textContent = '已复制隧道命令';
          } else {
            copyStatus.textContent = '当前环境不支持自动复制，请手动选中上方命令';
          }
        } catch {
          if (!closed) copyStatus.textContent = '复制未成功，请手动选中上方命令';
        }
      };
      cmdWrap.append(cmdCode, copyBtn, copyStatus);
      box.append(cmdWrap);
    }
    vpsNoteHost.replaceChildren(box);
  }
  function makeControl(labelText, ariaLabel, {tag = 'input', type = 'text', value = '', placeholder = '', options, wide = false} = {}) {
    const wrapper = document.createElement('label');
    wrapper.className = wide ? 'rr-field rr-field-wide' : 'rr-field';
    const heading = text('span', labelText, 'rr-field-label');
    const control = document.createElement(tag);
    if (tag === 'input') control.type = type;
    if (tag === 'textarea') control.rows = 4;
    if (Array.isArray(options)) {
      for (const [optValue, optLabel] of options) {
        const opt = text('option', optLabel);
        opt.value = optValue;
        control.append(opt);
      }
    }
    if (placeholder) control.placeholder = placeholder;
    control.value = value;
    control.setAttribute('aria-label', ariaLabel);
    wrapper.append(heading, control);
    return {wrapper, control};
  }
  function makeGroup(headingText, ...children) {
    const group = document.createElement('div');
    group.className = 'rr-form-group';
    const grid = document.createElement('div');
    grid.className = 'rr-form-grid';
    grid.append(...children);
    group.append(text('h4', headingText, 'rr-form-heading'), grid);
    return group;
  }
  toggleFormButton.onclick = () => {
    if (closed) return;
    formOpen = !formOpen;
    renderForm();
  };
  refreshListButton.onclick = () => {
    if (!closed) void refresh();
  };
  function renderForm() {
    if (!formOpen) {
      toggleFormButton.className = 'btn btn-primary btn-sm';
      toggleFormButton.textContent = '添加 VPS / 云电脑';
      formHost.replaceChildren();
      return;
    }
    toggleFormButton.className = 'btn btn-sm';
    toggleFormButton.textContent = '收起添加表单';
    const form = document.createElement('div');
    form.className = 'remote-runners-form';
    form.setAttribute('aria-label', '添加 VPS 表单');
    const formStatus = text('p', '私钥与执行器令牌仅通过本机安全存储加密保存，不会回显到界面或发给大模型。', 'rr-form-status');
    formStatus.setAttribute('role', 'status');
    const nameField = makeControl('主机名称（小写字母/数字/短横线）', '主机名称', {value: 'my-vps', placeholder: '例如 huawei-vps'});
    const addressField = makeControl('VPS IP 或域名', '主机地址', {placeholder: '例如 120.46.x.x'});
    const portField = makeControl('SSH 端口', 'SSH 端口', {type: 'number', value: '22'});
    const userField = makeControl('SSH 用户名', 'SSH 用户名', {value: 'root', placeholder: '例如 root 或 ubuntu'});
    const providerField = makeControl('云服务商', '服务商', {tag: 'select', value: 'vps', options: [['vps', 'VPS 云主机'], ['huawei-ecs', '华为云 ECS'], ['other', '其他 Linux']]});
    const osField = makeControl('操作系统', '系统', {tag: 'select', value: 'ubuntu', options: [['ubuntu', 'Ubuntu'], ['debian', 'Debian'], ['openeuler', 'openEuler'], ['other', '其他']]});
    const archField = makeControl('CPU 架构', '架构', {tag: 'select', value: 'x86_64', options: [['x86_64', 'x86_64 (通用)'], ['aarch64', 'aarch64 (ARM)']]});
    const hostKeyField = makeControl('SSH 主机公钥', '主机公钥', {placeholder: '点击“探测主机公钥”自动填入，或手动粘贴 ssh-ed25519 ...', wide: true});
    const fingerprintField = makeControl('SHA-256 指纹（可留空由公钥自动计算）', '公钥指纹', {placeholder: '64 位十六进制指纹', wide: true});
    const keyField = makeControl('SSH 私钥（保存后自动清空输入框）', 'SSH 私钥', {tag: 'textarea', placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----', wide: true});
    const tokenField = makeControl('执行器令牌 RUNNER_TOKEN（保存后自动清空输入框）', '执行器令牌', {type: 'password', placeholder: 'VPS /etc/personal-agent-runner/token 中的令牌', wide: true});

    const probeBtn = text('button', '探测主机公钥', 'btn btn-sm');
    probeBtn.type = 'button';
    probeBtn.onclick = async () => {
      if (closed || probeBtn.disabled) return;
      const address = addressField.control.value.trim();
      const port = Number(portField.control.value || 22);
      if (!address) { formStatus.textContent = '请先输入 VPS 的 IP 或域名。'; return; }
      probeBtn.disabled = true;
      formStatus.textContent = `正在探测 ${address}:${port} 的 SSH 主机公钥...`;
      try {
        const probed = await invoke('runner.hosts.probeKey', {address, port});
        if (closed) return;
        hostKeyField.control.value = probed?.hostKey ?? '';
        fingerprintField.control.value = probed?.hostKeyFingerprint ?? '';
        formStatus.textContent = `已读取 ${probed?.keyType ?? 'SSH'} 主机公钥，请核对指纹：${String(probed?.hostKeyFingerprint ?? '').slice(0, 16)}...`;
      } catch (error) {
        if (!closed) formStatus.textContent = `探测失败：${error?.message || '无法连接 SSH 端口'}`;
      } finally {
        if (!closed) probeBtn.disabled = false;
      }
    };

    const saveBtn = text('button', '保存并启用 VPS', 'btn btn-primary btn-sm');
    saveBtn.type = 'button';
    saveBtn.onclick = async () => {
      if (closed || saveBtn.disabled) return;
      saveBtn.disabled = true;
      const payload = {
        name: nameField.control.value.trim(),
        address: addressField.control.value.trim(),
        port: Number(portField.control.value || 22),
        user: userField.control.value.trim(),
        provider: providerField.control.value || 'vps',
        os: osField.control.value || 'ubuntu',
        arch: archField.control.value || 'x86_64',
        hostKey: hostKeyField.control.value.trim(),
        hostKeyFingerprint: fingerprintField.control.value.trim(),
        privateKey: keyField.control.value,
        runnerToken: tokenField.control.value.trim(),
        enabled: true,
      };
      try {
        await invoke('runner.hosts.add', payload);
        if (closed) return;
        formOpen = false;
        renderForm();
        showVpsMessage(`已登记主机 ${payload.name}（${payload.user}@${payload.address}:${payload.port}）。建议点击“测试连接”和“云电脑状态”确认可用。`);
        await refresh();
      } catch (error) {
        if (!closed) formStatus.textContent = `保存失败：${error?.message || '请检查输入字段'}`;
      } finally {
        keyField.control.value = '';
        tokenField.control.value = '';
        if (!closed) saveBtn.disabled = false;
      }
    };

    const cancelBtn = text('button', '取消', 'btn btn-sm');
    cancelBtn.type = 'button';
    cancelBtn.onclick = () => {
      keyField.control.value = '';
      tokenField.control.value = '';
      formOpen = false;
      renderForm();
    };

    const probeRow = document.createElement('div');
    probeRow.className = 'rr-field rr-field-wide';
    probeRow.append(probeBtn);

    const actions = document.createElement('div');
    actions.className = 'rr-form-actions';
    actions.append(saveBtn, cancelBtn);

    form.append(
      makeGroup('1. 连接与主机信息', nameField.wrapper, addressField.wrapper, portField.wrapper, userField.wrapper, providerField.wrapper, osField.wrapper, archField.wrapper),
      makeGroup('2. 锁定主机公钥（防劫持）', probeRow, hostKeyField.wrapper, fingerprintField.wrapper),
      makeGroup('3. 加密凭据（仅存本机）', keyField.wrapper, tokenField.wrapper),
      formStatus,
      actions,
    );
    formHost.replaceChildren(form);
  }
  function cloudButton(label, action, disabled = false) {
    const button = text('button', label, 'btn btn-sm');
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
    panel.className = 'rr-cloud-panel';
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
      if(reply?.todos){
        const inactive=!confirmed||['cancelled','failed','succeeded'].includes(reply.task.state)
          ||reply.todos.operations.some(value=>!['succeeded','failed','cancelled'].includes(value.state));
        const title=document.createElement('input');title.type='text';title.maxLength=200;title.setAttribute('aria-label','云待办标题');
        const remind=document.createElement('input');remind.type='datetime-local';remind.setAttribute('aria-label','云提醒时间');
        row.append(text('h4','云端待办与提醒'),title,remind,cloudButton('提交云提醒审批',()=>{
          const time=new Date(remind.value);if(!title.value.trim()||!Number.isFinite(time.getTime())){cloudStatus.textContent='请输入待办标题和有效提醒时间。';return;}
          return cloudAction('todo',{...identity(),target:reply.target,todo:{action:'create',title:title.value.trim(),remindUtc:time.toISOString(),missedPolicy:'run_once'}},session);
        },inactive));
        for(const item of reply.todos.items){
          const reminder=item.reminderState==='delivered'?'已进入云通知队列，设备尚未送达':item.reminderState==='missed'?'已错过':'等待原计划';
          row.append(text('p',`${item.title} · ${item.status} · 版本 ${item.revision}${item.remindUtc?' · '+item.remindUtc+' · '+reminder:''}`));
          if(item.status==='open')for(const [status,label]of [['done','完成云待办'],['cancelled','取消云待办']])
            row.append(cloudButton(label,()=>cloudAction('todo',{...identity(),target:reply.target,
              todo:{action:'update',id:item.id,expectedRevision:item.revision,status}},session),inactive));
        }
        for(const operation of reply.todos.operations)row.append(text('p',`待办操作 ${operation.taskId??operation.commandId} · ${operation.state}`));
        row.append(text('p','创建和修改均须原审批；结果未确认时只读回，不重复提交。提醒期限不能超过本云会话。'));
      }
      if(reply?.notifications){
        const feed=reply.notifications;
        row.append(text('h4','云端通知记录'),text('p',`当前有效未读 ${feed.unreadItemIds.length} 项 · 按原归来策略汇总 ${feed.returnItemIds.length} 项 · 主动打扰 ${feed.interruptionCount} 次`),
          text('p','记录已持久保存；横幅和声音等待设备，不代表已送达或用户已读。'));
        for(const item of feed.items){row.append(text('p',`${item.source} · ${item.contentRef} · ${item.readAt?'已读':'未读'}`));
          if(!item.readAt)row.append(cloudButton('标记此项已读',()=>cloudAction('notification',{...identity(),target:reply.target,
            notification:{action:'read',itemIds:[item.id]}},session),!confirmed));}
      }
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
    item.className = 'rr-host-card';
    const head = document.createElement('div');
    head.className = 'rr-host-head';
    const nameEl = text('strong', host.name, 'rr-host-name');
    const stateBadge = text('span', host.enabled ? '已启用' : '已停用', 'rr-badge');
    stateBadge.setAttribute('data-tone', host.enabled ? 'ready' : 'off');
    head.append(nameEl, stateBadge);
    const meta = text('p', `${host.user}@${host.address}:${host.port} · ${host.provider ?? 'vps'} · ${host.arch ?? 'x86_64'} · ${host.health ?? '未检测'}`, 'rr-host-meta');
    const actions = document.createElement('div');
    actions.className = 'rr-host-actions';
    const testBtn = text('button', '测试连接', 'btn btn-sm');
    testBtn.type = 'button';
    testBtn.onclick = () => invoke('runner.hosts.test', {id: host.id}).then(refresh)
      .catch(error => {status.textContent = error?.message ? `连接测试失败：${String(error.message).slice(0, 140)}` : '连接测试没有完成';});
    const disableBtn = text('button', host.enabled ? '停用' : '启用', 'btn btn-sm');
    disableBtn.type = 'button';
    disableBtn.onclick = () => invoke(host.enabled ? 'runner.hosts.disable' : 'runner.hosts.enable', {id: host.id}).then(refresh)
      .catch(error => {status.textContent = error?.message ? `状态没有更新：${String(error.message).slice(0, 140)}` : '状态没有更新';});
    const vpsCheck = text('button', '云电脑状态', 'btn btn-sm');
    vpsCheck.type = 'button';
    vpsCheck.disabled = !host.enabled;
    vpsCheck.onclick = async () => {
      if (closed || vpsCheck.disabled) return;
      vpsCheck.disabled = true;
      showVpsMessage(`正在查询 ${host.name} 状态...`);
      try {
        const res = await invoke('runner.hosts.vpsStatus', {id: host.id});
        if (closed) return;
        const receipt = res?.receipt ?? {};
        const desktop = receipt.desktop ?? {};
        const summary = typeof receipt.summary === 'string' && receipt.summary ? receipt.summary : `${host.name} 状态：${desktop.status ?? res?.state ?? 'unknown'}`;
        if (res?.hostId !== host.id) { showVpsMessage('云电脑状态返回的主机与所选主机不一致。'); return; }
        const {httpsPort} = desktop;
        if (res.state !== 'succeeded' || desktop.available !== true || desktop.status !== 'running'
          || !Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65535) {
          showVpsMessage(summary);
          return;
        }
        const {user, address, port} = res;
        if (!validConnectionAddress(address)
          || typeof user !== 'string' || !/^[a-z_][a-z0-9_-]{0,31}$/.test(user)
          || !Number.isInteger(port) || port < 1 || port > 65535) {
          showVpsMessage(`${summary} · 请检查设置中的主机地址、用户名和端口。`);
          return;
        }
        const portArg = port !== 22 ? `-p ${port} ` : '';
        const tunnelCmd = `ssh ${portArg}-N -L ${httpsPort}:127.0.0.1:${httpsPort} ${user}@${address}`;
        showVpsMessage(`${summary} · 本机浏览器打开 https://127.0.0.1:${httpsPort}`, tunnelCmd);
      } catch (error) {
        if (!closed) showVpsMessage(`云电脑状态查询失败：${error?.message || '请检查连接与安装状态'}`);
      } finally {
        if (!closed) vpsCheck.disabled = !host.enabled;
      }
    };
    const removeBtn = text('button', '移除主机', 'btn btn-sm btn-danger');
    removeBtn.type = 'button';
    removeBtn.onclick = () => invoke('runner.hosts.remove', {id: host.id}).then(() => {
      if (!closed) showVpsMessage('');
      return refresh();
    }).catch(error => {status.textContent = error?.message ? `移除失败：${String(error.message).slice(0, 140)}` : '移除主机失败';});
    actions.append(testBtn, vpsCheck, disableBtn, removeBtn);
    item.append(head, meta, actions);
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
