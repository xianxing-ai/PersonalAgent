import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {
  createPluginCatalogService, createPluginSandbox, describePluginPermissions, intersectPermissionGrants,
  pluginEnableArgumentsDigest, pluginInstallSummary, projectEnabledPlugins, readStoredPermissionGrant,
} from '@personal-agent/plugin-catalog';

function networkDownload() {
  return {async get(url) {
    const response = await fetch(url, {redirect: 'manual'});
    if (response.status !== 200) return {status: response.status, bytes: new Uint8Array()};
    return {status: 200, bytes: new Uint8Array(await response.arrayBuffer())};
  }};
}

const GUARD_KEYS = new Set(['id', 'kind', 'target', 'fileMode', 'body']);

/** Main-process owner. Downloads only catalog pins, then uses the existing installers. */
export function createPluginCatalogHost({
  skillStore, installationFile, confirm, catalog, download = networkDownload(), onUpdate = () => {},
  dataRoot, violationFile, readSecret = () => undefined, fetchImpl,
}) {
  const policy = new InMemoryAuthorizationPolicy();
  const service = createPluginCatalogService({skillStore, installationFile, policy, download, ...(catalog ? {catalog} : {})});
  const sandbox = createPluginSandbox({
    dataRoot: dataRoot ?? path.join(path.dirname(installationFile), 'plugin-data'),
    violationFile: violationFile ?? path.join(path.dirname(installationFile), 'plugin-sandbox-violations.json'),
    lookup: lookupGrant,
    readSecret,
    ...(fetchImpl ? {fetchImpl} : {}),
  });
  let closed = false;
  const guardClosed = () => { if (closed) throw Error('插件目录已关闭'); };

  function lookupGrant(pluginId) {
    let record;
    try { record = service.installations().find(item => item.catalogId === pluginId); }
    catch { return {state: 'missing', grant: readStoredPermissionGrant(undefined)}; }
    if (!record) return {state: 'missing', grant: readStoredPermissionGrant(undefined)};
    let entry;
    try { entry = service.get(pluginId); }
    catch { return {state: 'removed', grant: readStoredPermissionGrant(undefined)}; }
    const grant = intersectPermissionGrants(readStoredPermissionGrant(record.permissionGrant), entry.permissionManifest);
    return {state: record.enabled ? 'enabled' : 'disabled', grant};
  }

  function projection() {
    return projectEnabledPlugins(service.installations(), service.list());
  }

  function items() {
    const installed = new Map(service.installations().map(item => [item.catalogId, item]));
    const latestByPlugin = new Map(sandbox.violations().map(violation => [violation.pluginId, violation]));
    return service.list().map(entry => {
      const record = installed.get(entry.id);
      const blocked = latestByPlugin.get(entry.id);
      const effective = record
        ? intersectPermissionGrants(readStoredPermissionGrant(record.permissionGrant), entry.permissionManifest)
        : entry.permissionManifest;
      return {
        id: entry.id, name: entry.name, type: entry.type, riskLevel: entry.riskLevel, description: entry.description,
        license: entry.license, sourceRepositoryUrl: entry.sourceRepositoryUrl,
        permissions: entry.permissionDeclarations.map(item => ({scope: item.scope, admitted: item.admitted, statement: item.statement})),
        permissionSummary: describePluginPermissions(effective),
        oneClickInstall: entry.oneClickInstall, installBlockReason: entry.installBlockReason,
        enableRequiresAuthorization: entry.enableRequiresAuthorization,
        installed: Boolean(record), enabled: record?.enabled === true, updateStatus: service.checkUpdate(entry.id).status,
        ...(blocked ? {lastBlocked: {kind: blocked.kind, reason: blocked.reason}} : {}),
      };
    });
  }

  function snapshot() {
    guardClosed();
    const cloud = projection();
    return {available: true, items: items(), proposalCount: cloud.proposals.length, readbackClosedLoop: cloud.acceptance.closedLoop};
  }

  async function install(id, replace = false) {
    guardClosed();
    const entry = service.get(id);
    if (!entry.oneClickInstall) throw Error(entry.installBlockReason ?? '该插件不能一键安装');
    const summary = pluginInstallSummary(replace ? '更新' : '安装', entry.name, entry.permissionManifest);
    const allowed = await confirm({
      action: 'install', id, summary,
      detail: `${entry.name}\n将下载固定版本并核对摘要，安装后停用。不执行插件脚本。\n${describePluginPermissions(entry.permissionManifest).join('\n')}`,
    });
    if (!allowed) return {cancelled: true};
    const record = await service.installPinned(id, replace);
    onUpdate();
    return {installed: true, enabled: record.enabled};
  }

  function guard(payload) {
    guardClosed();
    const denyInvalid = () => {
      const denied = sandbox.denyInvalid(payload?.id, payload?.kind, payload?.target);
      onUpdate();
      return {allowed: false, reason: denied.reason};
    };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !GUARD_KEYS.has(key))) {
      return denyInvalid();
    }
    const {id, kind, target, fileMode, body} = payload;
    if (typeof id !== 'string' || typeof target !== 'string' || !['network', 'file', 'connector', 'secret'].includes(kind)) {
      return denyInvalid();
    }
    if (kind === 'file' && fileMode === 'write') {
      const written = sandbox.writeFile(id, target, body);
      if (!written.allowed) onUpdate();
      return {allowed: written.allowed, reason: written.reason};
    }
    if (kind === 'file' && fileMode === 'read') {
      if (body !== undefined) return denyInvalid();
      const read = sandbox.readFile(id, target);
      if (!read.allowed) onUpdate();
      return {allowed: read.allowed, reason: read.reason, ...(read.found !== undefined ? {found: read.found} : {})};
    }
    if (kind === 'secret') {
      if (body !== undefined || fileMode !== undefined) return denyInvalid();
      const secret = sandbox.readSecret(id, target);
      if (!secret.allowed) onUpdate();
      return {allowed: secret.allowed, reason: secret.reason, ...(secret.found !== undefined ? {found: secret.found} : {})};
    }
    if (body !== undefined || fileMode !== undefined) return denyInvalid();
    const decision = sandbox.decide(id, kind, target);
    if (!decision.allowed) onUpdate();
    return {allowed: decision.allowed, reason: decision.reason};
  }

  return {
    snapshot,
    async fetchWithinGrant(id, url) {
      const result = await sandbox.fetch(id, url);
      if (!result.allowed) onUpdate();
      return result;
    },
    readGrantedSecret(id, name) {
      const result = sandbox.readSecret(id, name);
      if (!result.allowed) onUpdate();
      return result;
    },
    readPluginFile(id, relative) {
      const result = sandbox.readFile(id, relative);
      if (!result.allowed) onUpdate();
      return result;
    },
    async invoke(name, payload) {
      guardClosed();
      if (name === 'plugin.list' || name === 'plugin.search') {
        const query = payload?.query ?? payload;
        return service.list({query: typeof query === 'string' ? query : payload?.query, type: payload?.type});
      }
      if (name === 'plugin.detail') return service.get(payload?.id);
      if (name === 'plugin.plan') return service.planInstall(payload?.id);
      if (name === 'plugin.install') return install(payload?.id, false);
      if (name === 'plugin.update') return install(payload?.id, true);
      if (name === 'plugin.guard') return guard(payload);
      if (name === 'plugin.enable') {
        const id = payload?.id;
        const enabled = payload?.enabled;
        const entry = service.get(id);
        if (enabled && entry.enableRequiresAuthorization) {
          const requiredDeclarations = entry.permissionDeclarations.filter(item => item.requiredForEnable);
          const scopes = requiredDeclarations.map(item => item.scope);
          const statements = requiredDeclarations.map(item => item.statement || item.scope);
          const allowed = await confirm({action: 'enable', id, detail: `${entry.name} 是高风险插件。启用需要授权。声明范围：${statements.join('、') || '无'}。这不授予写文件、联网写入或执行代码。`});
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
