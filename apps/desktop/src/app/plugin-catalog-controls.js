const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const riskLabel = {low: '低', medium: '中', high: '高'};
const typeLabel = {skill: '技能', mcp: 'MCP'};

export function pluginMarketCardsHtml(items = []) {
  return items.map(item => {
    const actions = [];
    if (!item.installed && item.oneClickInstall) actions.push(['install', '安装']);
    if (item.installed && item.updateStatus === 'update-available') actions.push(['update', '更新']);
    if (item.installed && !item.enabled) actions.push(['enable', '启用']);
    if (item.installed && item.enabled) actions.push(['disable', '停用']);
    if (item.installed) actions.push(['uninstall', '卸载']);
    const permissions = (item.permissions ?? []).map(permission => `<li>${escape(permission.statement)}</li>`).join('');
    const blocked = !item.installed && !item.oneClickInstall ? `<p class="muted">${escape(item.installBlockReason || '不能一键安装')}</p>` : '';
    const authorization = item.installed && !item.enabled && item.enableRequiresAuthorization ? '<p class="muted">启用需要授权。</p>' : '';
    return `<article class="card"><details><summary><h3>${escape(item.name)}</h3></summary>
      <p>类型：${escape(typeLabel[item.type] ?? item.type)} · 风险：${escape(riskLabel[item.riskLevel] ?? item.riskLevel)}</p>
      <p>许可证：${escape(item.license)}</p><p>来源：${escape(item.sourceRepositoryUrl)}</p>
      <ul>${permissions}</ul></details>
      <p>${escape(item.description)}</p>${blocked}${authorization}
      <div class="form-actions">${actions.map(([action, label]) => `<button class="btn btn-sm" data-plugin="${action}" data-id="${escape(item.id)}">${label}</button>`).join('')}</div></article>`;
  }).join('') || '<p>没有匹配的插件。</p>';
}

export function mountPluginCatalogControls(root, invoke) {
  const host = document.createElement('section');
  host.className = 'sheet installed-skills-settings plugin-market';
  host.innerHTML = '<h2>插件市场</h2><p class="muted">只安装目录里的固定版本，安装后停用。高风险插件启用时需要授权。插件脚本不会执行。</p><div class="settings-form"><label>搜索<input class="field" data-plugin-query></label><label>分类<select class="field" data-plugin-type><option value="">全部</option><option value="skill">技能</option><option value="mcp">MCP</option></select></label></div><div data-plugin-list></div><p data-plugin-status role="status"></p>';
  root.append(host);
  let state = {items: []}, query = '', type = '', busy = false, signature = '';
  const status = host.querySelector('[data-plugin-status]');
  const visible = () => state.items.filter(item => (!type || item.type === type) && (!query || `${item.name}\n${item.description}\n${item.id}`.toLowerCase().includes(query)));
  function paint() {
    const next = JSON.stringify([visible(), busy]);
    if (next === signature) return;
    signature = next;
    host.querySelector('[data-plugin-list]').innerHTML = pluginMarketCardsHtml(visible());
    for (const button of host.querySelectorAll('[data-plugin]')) button.disabled = busy || state.available === false;
  }
  host.querySelector('[data-plugin-query]').addEventListener('input', event => { query = event.target.value.trim().toLowerCase(); signature = ''; paint(); });
  host.querySelector('[data-plugin-type]').addEventListener('change', event => { type = event.target.value; signature = ''; paint(); });
  host.addEventListener('click', async event => {
    const button = event.target.closest('[data-plugin]');
    if (!button || button.disabled || busy) return;
    const action = button.dataset.plugin;
    const payload = action === 'enable' ? {id: button.dataset.id, enabled: true} : action === 'disable' ? {id: button.dataset.id, enabled: false} : {id: button.dataset.id};
    busy = true; paint(); status.textContent = action === 'enable' && state.items.find(item => item.id === button.dataset.id)?.enableRequiresAuthorization ? '正在请求授权…' : '正在处理…';
    try {
      const result = await invoke(action === 'enable' || action === 'disable' ? 'plugin.enable' : `plugin.${action}`, payload);
      if (!host.isConnected) return;
      status.textContent = result?.cancelled ? '已取消。' : '已更新。';
    } catch {
      if (host.isConnected) status.textContent = '操作未完成。固定版本下载失败、摘要不符或未获授权时不会安装或启用。';
    } finally { busy = false; paint(); }
  });
  return {show: visibleSection => { host.hidden = !visibleSection; }, render(value) { state = value ?? {items: []}; signature = ''; paint(); }};
}
