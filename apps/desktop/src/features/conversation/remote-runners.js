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
  section.append(title, status, list);
  root.append(section);
  let closed = false;
  function row(host) {
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
    return item;
  }
  function refresh() {
    if (closed) return Promise.resolve();
    return Promise.resolve().then(() => invoke('runner.hosts.list', {})).then(result => {
      if (closed) return;
      const hosts = Array.isArray(result?.hosts) ? result.hosts : [];
      const jobs = Array.isArray(result?.jobs) ? result.jobs : [];
      list.replaceChildren(...hosts.map(row));
      status.textContent = hosts.length ? `主机 ${hosts.length} 台，任务记录 ${jobs.length} 条` : '还没有远端执行器';
    }).catch(() => {if (!closed) status.textContent = '远端执行器读取失败';});
  }
  return {refresh, dispose() {closed = true;}};
}
