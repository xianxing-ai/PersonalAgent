import {randomUUID} from 'node:crypto';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {createPluginCatalogService, pluginEnableArgumentsDigest, projectEnabledPlugins} from '@personal-agent/plugin-catalog';

function networkDownload() {
  return {async get(url) {
    const response = await fetch(url, {redirect: 'manual'});
    if (response.status !== 200) return {status: response.status, bytes: new Uint8Array()};
    return {status: 200, bytes: new Uint8Array(await response.arrayBuffer())};
  }};
}

/** Main-process owner. Downloads only catalog pins, then uses the existing installers. */
export function createPluginCatalogHost({skillStore, installationFile, confirm, catalog, download = networkDownload(), onUpdate = () => {}}) {
  const policy = new InMemoryAuthorizationPolicy();
  const service = createPluginCatalogService({skillStore, installationFile, policy, download, ...(catalog ? {catalog} : {})});
  let closed = false;
  const guard = () => { if (closed) throw Error('插件目录已关闭'); };
  function projection() {
    return projectEnabledPlugins(service.installations(), service.list());
  }
  function items() {
    const installed = new Map(service.installations().map(item => [item.catalogId, item]));
    return service.list().map(entry => {
      const record = installed.get(entry.id);
      return {
        id: entry.id, name: entry.name, type: entry.type, riskLevel: entry.riskLevel, description: entry.description,
        license: entry.license, sourceRepositoryUrl: entry.sourceRepositoryUrl,
        permissions: entry.permissionDeclarations.map(item => ({scope: item.scope, admitted: item.admitted, statement: item.statement})),
        oneClickInstall: entry.oneClickInstall, installBlockReason: entry.installBlockReason,
        enableRequiresAuthorization: entry.enableRequiresAuthorization,
        installed: Boolean(record), enabled: record?.enabled === true, updateStatus: service.checkUpdate(entry.id).status,
      };
    });
  }
  function snapshot() {
    guard();
    const cloud = projection();
    return {available: true, items: items(), proposalCount: cloud.proposals.length, readbackClosedLoop: cloud.acceptance.closedLoop};
  }
  async function install(id, replace = false) {
    guard();
    const entry = service.get(id);
    if (!entry.oneClickInstall) throw Error(entry.installBlockReason ?? '该插件不能一键安装');
    const allowed = await confirm({action: 'install', id, detail: `${entry.name}\n将下载固定版本并核对摘要，安装后停用。不执行插件脚本。`});
    if (!allowed) return {cancelled: true};
    const record = await service.installPinned(id, replace);
    onUpdate();
    return {installed: true, enabled: record.enabled};
  }
  return {
    snapshot,
    async invoke(name, payload) {
      guard();
      if (name === 'plugin.list' || name === 'plugin.search') {
        const query = payload?.query ?? payload;
        return service.list({query: typeof query === 'string' ? query : payload?.query, type: payload?.type});
      }
      if (name === 'plugin.detail') return service.get(payload?.id);
      if (name === 'plugin.plan') return service.planInstall(payload?.id);
      if (name === 'plugin.install') return install(payload?.id, false);
      if (name === 'plugin.update') return install(payload?.id, true);
      if (name === 'plugin.enable') {
        const id = payload?.id;
        const enabled = payload?.enabled;
        const entry = service.get(id);
        if (enabled && entry.enableRequiresAuthorization) {
          const scopes = entry.permissionDeclarations.filter(item => item.requiredForEnable).map(item => item.scope);
          const allowed = await confirm({action: 'enable', id, detail: `${entry.name} 是高风险插件。启用需要授权。声明范围：${scopes.join('、') || '无'}。这不授予写文件、联网写入或执行代码。`});
          if (!allowed) return {cancelled: true};
          const authorizationRef = randomUUID();
          policy.grant({
            authorizationRef, taskId: `desktop-plugin-${id}`, toolName: 'plugin-catalog.enable', scopes,
            expiresAt: new Date(Date.now() + 180000).toISOString(), maxUses: 1,
            argumentsDigest: pluginEnableArgumentsDigest(id, entry.pin.sha256),
          });
          const record = service.setEnabled(id, true, {authorizationRef, taskId: `desktop-plugin-${id}`});
          onUpdate();
          return {enabled: record.enabled};
        }
        const record = service.setEnabled(id, enabled);
        onUpdate();
        return {enabled: record.enabled};
      }
      if (name === 'plugin.uninstall') {
        const allowed = await confirm({action: 'uninstall', id: payload?.id, detail: '移除已安装快照。不撤销已经发生的外部操作。'});
        if (!allowed) return {cancelled: true};
        service.uninstall(payload?.id);
        onUpdate();
        return {uninstalled: true};
      }
      if (name === 'plugin.proposals') return projection();
      throw Error('不支持的插件操作');
    },
    close() { closed = true; },
  };
}
