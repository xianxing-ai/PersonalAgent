import {mountRemoteRunners} from '../conversation/remote-runners.js';

export function mountContextSidebar(side, hero, board, invoke) {
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = new URL('./context-sidebar.css', import.meta.url).href;
  document.head.append(style);

  const navigation = document.createElement('div');
  navigation.className = 'cc-context-switch';
  navigation.setAttribute('role', 'group');
  navigation.setAttribute('aria-label', '工作区侧栏');
  for (const [view, label] of [['activity', '动态'], ['library', '资料库']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.contextView = view;
    button.onclick = () => select(view);
    navigation.append(button);
  }
  const computer = document.createElement('section');
  computer.className = 'cc-computer';
  computer.innerHTML = '<div class="cc-computer-header"><h2>电脑</h2><div class="cc-computer-quickbar"><button type="button" class="cc-quick-btn" data-quick-computer="settings">电脑设置与扩展检测</button><span role="status" data-settings-status></span></div></div><details><summary><strong>VPS 电脑</strong><small role="status">读取主机中…</small></summary><div data-runner-controls><button type="button" class="btn btn-sm" data-refresh>刷新主机</button></div></details>';
  const details = computer.querySelector('details');
  const status = computer.querySelector('small');
  const controls = computer.querySelector('[data-runner-controls]');
  const refreshButton = controls.querySelector('[data-refresh]');
  const quickSettings = computer.querySelector('[data-quick-computer="settings"]');
  const settingsStatus = computer.querySelector('[data-settings-status]');
  const heartbeat = document.createElement('p');
  heartbeat.setAttribute('role', 'status');
  controls.append(heartbeat);
  quickSettings.onclick = async () => {
    if (disposed || quickSettings.disabled) return;
    quickSettings.disabled = true;
    try {
      await invoke('admin.open', {page: 'computer'});
      if (!disposed) settingsStatus.textContent = '在电脑设置中点击“检测现有浏览器扩展”。';
    } catch (error) {
      if (!disposed) settingsStatus.textContent = error?.message ? `打开设置失败：${String(error.message).slice(0, 140)}` : '打开电脑设置失败';
    } finally {
      if (!disposed) quickSettings.disabled = false;
    }
  };
  let hosts = [], disposed = false, hostsRead;
  function readHosts() {
    if (!hostsRead) hostsRead = invoke('runner.hosts.list', {}).finally(() => { hostsRead = undefined; });
    return hostsRead;
  }
  async function runnerAction(action, payload) {
    try {
      const result = action === 'runner.hosts.list' ? await readHosts() : await invoke(action, payload);
      if (disposed) return result;
      if (action === 'runner.hosts.list') {
        if (!Array.isArray(result?.hosts)) throw Error('主机列表读取失败');
        hosts = result.hosts;
        status.textContent = hosts.length === 0 ? '尚未登记主机'
          : hosts.length === 1 ? hosts[0].name + (hosts[0].enabled ? ' · 已启用' : ' · 已停用')
          : hosts.length + ' 台主机 · ' + hosts.filter(host => host.enabled).length + ' 台启用';
      } else if (action === 'runner.hosts.test') {
        const name = hosts.find(host => host.id === payload.id)?.name ?? 'VPS';
        const at = Date.parse(result?.heartbeatAt);
        heartbeat.textContent = result?.hostId === payload.id && result.state === 'succeeded' && Number.isFinite(at)
          ? name + ' · ' + new Date(at).toLocaleTimeString() + ' 收到心跳'
          : name + ' · 未收到有效心跳';
      } else if (action === 'runner.hosts.vpsStatus') {
        const summary = result?.receipt?.summary;
        heartbeat.textContent = typeof summary === 'string' && summary
          ? summary.slice(0, 180)
          : `${result?.hostName ?? 'VPS'} · 状态：${result?.state ?? 'unknown'}`;
      }
      return result;
    } catch (error) {
      const reason = typeof error?.message === 'string' ? error.message.trim().slice(0, 160) : '';
      if (!disposed && action === 'runner.hosts.list') status.textContent = '主机列表读取失败';
      if (!disposed && action === 'runner.hosts.test') heartbeat.textContent = reason ? `连接测试失败：${reason}` : '连接测试失败';
      if (!disposed && action === 'runner.hosts.vpsStatus') heartbeat.textContent = reason ? `云电脑状态查询失败：${reason}` : '云电脑状态查询失败';
      throw error;
    }
  }
  const runners = mountRemoteRunners(controls, runnerAction);
  const refresh = async () => {
    if (refreshButton.disabled) return;
    refreshButton.disabled = true;
    try { await runners.refresh(); }
    finally { if (!disposed) refreshButton.disabled = false; }
  };
  refreshButton.onclick = refresh;
  details.addEventListener('toggle', () => { if (details.open) void refresh(); });
  side.prepend(hero, navigation, computer, board);
  function select(view) {
    side.dataset.contextView = view;
    for (const button of navigation.children) {
      button.setAttribute('aria-pressed', String(button.dataset.contextView === view));
    }
  }
  select('activity');
  // The collapsed tile needs only the registered hosts. Read cloud sessions on expand.
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    if (!details.open) void runnerAction('runner.hosts.list', {}).catch(() => {});
  });
  observer.observe(computer);
  window.addEventListener('unload', () => {
    disposed = true;
    observer.disconnect();
    runners.dispose();
  }, {once: true});
}
