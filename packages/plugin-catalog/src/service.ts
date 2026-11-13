import {createHash, timingSafeEqual} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import {MCP_FILESYSTEM_PACKAGE_VERSION} from '@personal-agent/mcp';
import type {PolicyPort} from '@personal-agent/policy';
import {openLocalSkillStore, readLocalSkillDirectory} from '@personal-agent/skills';
import {downloadPinnedFilesystem, materializePinnedSkill, type PinnedDownload} from './download.js';
import {CURATED_PLUGINS} from './plugins.js';
import {samePermissionGrant, snapshotPermissionGrant} from './permissions.js';
import {parsePluginCatalog, type PluginManifest, type RiskLevel} from './schema.js';

export interface SkillStorePort {
  install(input: ReturnType<typeof readLocalSkillDirectory>): {name: string; digest: string; installationId: string; enabled: boolean};
  read(name: string, digest: string): {name: string; digest: string; enabled: boolean};
  setEnabled(name: string, digest: string, enabled: boolean): void;
  uninstall(name: string, digest: string): void;
}

export interface PluginAuthorization {
  authorizationRef: string;
  taskId: string;
  now?: number;
}

export interface PluginQuery {
  type?: 'mcp' | 'skill';
  riskLevel?: PluginManifest['riskLevel'];
  maintenanceStatus?: PluginManifest['maintenanceStatus'];
  oneClickInstall?: boolean;
  query?: string;
}

export interface InstallPlan {
  id: string;
  oneClickInstall: boolean;
  installer: PluginManifest['installer'];
  enableRequiresAuthorization: boolean;
  pin: PluginManifest['pin'];
  steps: readonly string[];
  installBlockReason?: string;
}

export interface InstallationRecord {
  catalogId: string;
  type: 'mcp' | 'skill';
  installer: PluginManifest['installer'];
  enabled: boolean;
  generation: number;
  pin: {state: 'pinned'; version?: string; commit?: string; sha256?: string};
  permissionGrant?: PluginManifest['permissionManifest'];
  skill?: {name: string; digest: string; installationId: string};
  mcp?: {packageVersion: string; entrySha256: string; surface: 'readonly-filesystem'};
}

export interface UpdateStatus {
  id: string;
  status: 'not-installed' | 'current' | 'update-available' | 'catalog-removed';
  installed?: InstallationRecord['pin'];
  catalog?: PluginManifest['pin'];
}

export interface PluginActivityNotice {
  pluginId: string;
  action: 'install' | 'enable' | 'disable' | 'uninstall';
  riskLevel: RiskLevel;
  generation: number;
}

export interface PluginCatalogServiceOptions {
  catalog?: readonly PluginManifest[];
  skillStoreFile?: string;
  skillStore?: SkillStorePort;
  installationFile: string;
  policy?: PolicyPort;
  now?: () => number;
  resolveFilesystemPackage?: () => string;
  download?: PinnedDownload;
  onActivity?: (notice: PluginActivityNotice) => void;
}

const require = createRequire(import.meta.url);

export function pluginEnableArgumentsDigest(id: string, sha256: string): string {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id) || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new ProtocolError('INVALID_ARGUMENT', '启用摘要的插件身份无效');
  }
  return createHash('sha256').update(JSON.stringify({id, sha256})).digest('hex');
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function snapshotPin(pin: PluginManifest['pin']): InstallationRecord['pin'] {
  const saved: InstallationRecord['pin'] = {state: 'pinned'};
  if (pin.version) saved.version = pin.version;
  if (pin.commit) saved.commit = pin.commit;
  if (pin.sha256) saved.sha256 = pin.sha256;
  return saved;
}

function pinsMatch(installed: InstallationRecord['pin'], pin: PluginManifest['pin']): boolean {
  return installed.version === pin.version && installed.commit === pin.commit && installed.sha256 === pin.sha256;
}

function granted(entry: PluginManifest): PluginManifest['permissionManifest'] {
  return snapshotPermissionGrant(entry.permissionManifest);
}

export function createPluginCatalogService(options: PluginCatalogServiceOptions) {
  const catalog = parsePluginCatalog([...(options.catalog ?? CURATED_PLUGINS)]);
  const byId = new Map(catalog.map(entry => [entry.id, entry]));
  const now = options.now ?? Date.now;
  const opened = options.skillStore ?? openLocalSkillStore(options.skillStoreFile ?? '');
  function notify(record: InstallationRecord, action: PluginActivityNotice['action']) {
    options.onActivity?.({
      pluginId: record.catalogId,
      action,
      riskLevel: byId.get(record.catalogId)?.riskLevel ?? 'high',
      generation: record.generation,
    });
  }
  const skillStore = () => opened;

  function readInstallations(): InstallationRecord[] {
    const file = options.installationFile;
    if (!existsSync(file)) return [];
    if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile() || lstatSync(file).size > 1_048_576) {
      throw new ProtocolError('INVALID_ARGUMENT', '插件安装记录不可用');
    }
    const saved = JSON.parse(readFileSync(file, 'utf8')) as {version?: unknown; entries?: unknown};
    if (saved.version !== 1 || !Array.isArray(saved.entries) || saved.entries.length > 32) {
      throw new ProtocolError('INVALID_ARGUMENT', '插件安装记录版本不受支持');
    }
    return saved.entries.map(entry => {
      if (!entry || typeof entry !== 'object') throw new ProtocolError('INVALID_ARGUMENT', '插件安装记录无效');
      return entry as InstallationRecord;
    });
  }

  function writeInstallations(entries: InstallationRecord[]) {
    const file = options.installationFile;
    mkdirSync(path.dirname(file), {recursive: true});
    const temporary = `${file}.tmp-${process.pid}`;
    if ((existsSync(file) && lstatSync(file).isSymbolicLink()) || (existsSync(temporary) && lstatSync(temporary).isSymbolicLink())) {
      throw new ProtocolError('INVALID_ARGUMENT', '插件安装记录不可用');
    }
    writeFileSync(temporary, JSON.stringify({version: 1, entries}), 'utf8');
    renameSync(temporary, file);
  }

  function retainGrant(record: InstallationRecord, entry: PluginManifest): InstallationRecord {
    const permissionGrant = granted(entry);
    if (samePermissionGrant(record.permissionGrant, permissionGrant)) return record;
    const next = {...record, permissionGrant};
    writeInstallations(readInstallations().map(item => item.catalogId === record.catalogId ? next : item));
    return next;
  }

  function requireEntry(id: string): PluginManifest {
    const entry = byId.get(id);
    if (!entry) throw new ProtocolError('NOT_FOUND', '插件不在精选目录中');
    return entry;
  }

  function list(query: PluginQuery = {}): PluginManifest[] {
    const needle = query.query?.trim().toLowerCase();
    return catalog.filter(entry => {
      if (query.type && entry.type !== query.type) return false;
      if (query.riskLevel && entry.riskLevel !== query.riskLevel) return false;
      if (query.maintenanceStatus && entry.maintenanceStatus !== query.maintenanceStatus) return false;
      if (query.oneClickInstall !== undefined && entry.oneClickInstall !== query.oneClickInstall) return false;
      if (!needle) return true;
      const haystack = [entry.id, entry.name, entry.description, entry.author, entry.admissionReason, ...entry.capabilities.map(item => item.name)].join('\n').toLowerCase();
      return haystack.includes(needle);
    }).map(entry => structuredClone(entry));
  }

  function planInstall(id: string): InstallPlan {
    const entry = requireEntry(id);
    const grantStep = '记录本次确认的权限清单；运行时只放行清单中的网络主机、文件范围、连接器和密钥';
    const steps = entry.installer === 'local-skill'
      ? ['接收本机技能目录', '用现有 readLocalSkillDirectory 做快照', '比对目录 sha256', '调用 openLocalSkillStore.install，保持停用', '不执行目录中的脚本', grantStep]
      : entry.installer === 'pinned-filesystem-readonly'
        ? ['解析已安装的官方 filesystem 包', '核验 MCP_FILESYSTEM_PACKAGE_VERSION 与入口 sha256', '写入停用安装记录', '不启动服务器，不注册写工具', grantStep]
        : ['拒绝一键安装'];
    const plan: InstallPlan = {id: entry.id, oneClickInstall: entry.oneClickInstall, installer: entry.installer, enableRequiresAuthorization: entry.enableRequiresAuthorization, pin: structuredClone(entry.pin), steps};
    if (entry.installBlockReason) plan.installBlockReason = entry.installBlockReason;
    return plan;
  }

  function assertFilesystemPin(entry: PluginManifest): {packageVersion: string; entrySha256: string} {
    if (entry.pin.version !== MCP_FILESYSTEM_PACKAGE_VERSION || entry.pin.sha256Subject !== 'npm-entry' || !entry.pin.sha256) {
      throw new ProtocolError('PROTOCOL_MISMATCH', '目录中的 filesystem 针与现有 Host 不一致');
    }
    const packageJsonPath = options.resolveFilesystemPackage?.() ?? require.resolve('@modelcontextprotocol/server-filesystem/package.json');
    if (lstatSync(packageJsonPath).isSymbolicLink()) throw new ProtocolError('INVALID_ARGUMENT', 'filesystem 包路径不可用');
    const directory = path.dirname(packageJsonPath);
    const metadata = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {version?: unknown; bin?: {'mcp-server-filesystem'?: unknown}};
    if (metadata.version !== MCP_FILESYSTEM_PACKAGE_VERSION) throw new ProtocolError('PROTOCOL_MISMATCH', 'filesystem 包版本与钉死版本不一致');
    const relativeEntry = metadata.bin?.['mcp-server-filesystem'];
    if (typeof relativeEntry !== 'string' || path.isAbsolute(relativeEntry)) throw new ProtocolError('INVALID_ARGUMENT', 'filesystem 包入口无效');
    const entryPath = path.resolve(directory, relativeEntry);
    const root = path.resolve(directory);
    if (entryPath !== root && !entryPath.startsWith(root + path.sep)) throw new ProtocolError('INVALID_ARGUMENT', 'filesystem 包入口无效');
    const bytes = readFileSync(entryPath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (!sameHash(digest, entry.pin.sha256)) throw new ProtocolError('INVALID_ARGUMENT', 'filesystem 包入口摘要与目录不一致');
    return {packageVersion: MCP_FILESYSTEM_PACKAGE_VERSION, entrySha256: digest};
  }

  async function installPinned(id: string, replace = false): Promise<InstallationRecord> {
    const entry = requireEntry(id);
    if (!options.download) throw new ProtocolError('UNSUPPORTED_CAPABILITY', '固定版本下载未配置');
    if (entry.archive?.kind === 'github-directory') {
      const materialized = await materializePinnedSkill(entry, options.download);
      try {
        const bundle = readLocalSkillDirectory(materialized.directory);
        if (!entry.pin.sha256 || !sameHash(bundle.digest, entry.pin.sha256)) throw new ProtocolError('INVALID_ARGUMENT', '下载内容与录取摘要不一致');
        const current = readInstallations().find(item => item.catalogId === id);
        if (current?.skill && current.skill.digest !== bundle.digest) {
          if (!replace) throw new ProtocolError('REVISION_CONFLICT', '已安装其他版本，需先卸载');
          skillStore().uninstall(current.skill.name, current.skill.digest);
        }
        return install({id, sourceDirectory: materialized.directory});
      } finally { materialized.remove(); }
    }
    if (entry.archive?.kind === 'npm-tarball') {
      const downloaded = await downloadPinnedFilesystem(entry, options.download);
      const verified = assertFilesystemPin(entry);
      if (verified.entrySha256 !== downloaded.entrySha256 || verified.packageVersion !== downloaded.packageVersion) {
        throw new ProtocolError('INVALID_ARGUMENT', '下载内容与本机钉死包不一致');
      }
      return install({id});
    }
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', entry.installBlockReason ?? '该插件不能一键安装');
  }

  function install(input: {id: string; sourceDirectory?: string}): InstallationRecord {
    const entry = requireEntry(input.id);
    if (!entry.oneClickInstall || !entry.pin.sha256) throw new ProtocolError('UNSUPPORTED_CAPABILITY', entry.installBlockReason ?? '该插件不能一键安装');
    const existing = readInstallations().find(item => item.catalogId === entry.id);
    if (entry.installer === 'local-skill') {
      if (!input.sourceDirectory) throw new ProtocolError('INVALID_ARGUMENT', '技能安装需要本机目录');
      const bundle = readLocalSkillDirectory(input.sourceDirectory);
      if (bundle.name !== entry.skillName || !sameHash(bundle.digest, entry.pin.sha256)) {
        throw new ProtocolError('INVALID_ARGUMENT', '技能目录摘要与录取针不一致');
      }
      if (existing?.skill?.digest === bundle.digest) return structuredClone(retainGrant(existing, entry));
      const installed = skillStore().install(bundle);
      if (installed.enabled || installed.digest !== bundle.digest) throw new ProtocolError('PROTOCOL_MISMATCH', '技能安装结果与停用快照不一致');
      const record: InstallationRecord = {
        catalogId: entry.id, type: 'skill', installer: 'local-skill', enabled: false, generation: 1,
        pin: snapshotPin(entry.pin), permissionGrant: granted(entry),
        skill: {name: installed.name, digest: installed.digest, installationId: installed.installationId},
      };
      writeInstallations([...readInstallations().filter(item => item.catalogId !== entry.id), record]);
      notify(record, 'install');
      return structuredClone(record);
    }
    if (entry.installer === 'pinned-filesystem-readonly') {
      if (input.sourceDirectory) throw new ProtocolError('INVALID_ARGUMENT', 'filesystem 钉死安装不接收外部目录');
      const verified = assertFilesystemPin(entry);
      if (existing?.mcp?.entrySha256 === verified.entrySha256 && existing.pin.sha256 === entry.pin.sha256) return structuredClone(retainGrant(existing, entry));
      const record: InstallationRecord = {
        catalogId: entry.id, type: 'mcp', installer: 'pinned-filesystem-readonly', enabled: false, generation: 1,
        pin: snapshotPin(entry.pin), permissionGrant: granted(entry), mcp: {...verified, surface: 'readonly-filesystem'},
      };
      writeInstallations([...readInstallations().filter(item => item.catalogId !== entry.id), record]);
      notify(record, 'install');
      return structuredClone(record);
    }
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', '没有可用的现有安装器');
  }

  function installations(): InstallationRecord[] {
    return readInstallations().map(entry => structuredClone(entry));
  }

  function setEnabled(id: string, enabled: boolean, authorization?: PluginAuthorization): InstallationRecord {
    if (typeof enabled !== 'boolean') throw new ProtocolError('INVALID_ARGUMENT', '启用状态无效');
    const current = readInstallations();
    const record = current.find(item => item.catalogId === id);
    if (!record) throw new ProtocolError('NOT_FOUND', '插件尚未安装');
    const entry = byId.get(id);
    if (!entry) throw new ProtocolError('UNSUPPORTED_CAPABILITY', '已安装插件已不在目录中，不能改变启用状态');
    if (record.enabled === enabled) return structuredClone(record);
    if (enabled && record.installer === 'pinned-filesystem-readonly') {
      const verified = assertFilesystemPin(entry);
      if (!record.mcp || !sameHash(record.mcp.entrySha256, verified.entrySha256)) throw new ProtocolError('INVALID_ARGUMENT', '已安装 filesystem 包摘要已变化');
    }
    if (enabled && record.skill) {
      const saved = skillStore().read(record.skill.name, record.skill.digest);
      if (!entry.pin.sha256 || !sameHash(saved.digest, entry.pin.sha256)) throw new ProtocolError('INVALID_ARGUMENT', '已安装技能摘要与目录不一致');
    }
    if (enabled && entry.enableRequiresAuthorization) {
      if (!authorization || !entry.pin.sha256) throw new ProtocolError('UNAUTHORIZED', '高风险插件启用需要用户授权');
      if (!options.policy) throw new ProtocolError('UNAUTHORIZED', '高风险插件启用需要 Policy');
      const requiredScopes = entry.permissionDeclarations.filter(item => item.requiredForEnable).map(item => item.scope);
      options.policy.authorize({
        authorizationRef: authorization.authorizationRef,
        taskId: authorization.taskId,
        toolName: 'plugin-catalog.enable',
        requiredScopes,
        now: authorization.now ?? now(),
        argumentsDigest: pluginEnableArgumentsDigest(entry.id, entry.pin.sha256),
      });
    }
    if (record.skill) skillStore().setEnabled(record.skill.name, record.skill.digest, enabled);
    const next: InstallationRecord = {...record, enabled, generation: record.generation + 1};
    writeInstallations(current.map(item => item.catalogId === id ? next : item));
    notify(next, enabled ? 'enable' : 'disable');
    return structuredClone(next);
  }

  function checkUpdate(id: string): UpdateStatus {
    const installed = readInstallations().find(item => item.catalogId === id);
    const entry = byId.get(id);
    if (!installed) return {id, status: 'not-installed', ...(entry ? {catalog: structuredClone(entry.pin)} : {})};
    if (!entry) return {id, status: 'catalog-removed', installed: structuredClone(installed.pin)};
    const status = pinsMatch(installed.pin, entry.pin) ? 'current' : 'update-available';
    return {id, status, installed: structuredClone(installed.pin), catalog: structuredClone(entry.pin)};
  }

  function uninstall(id: string): void {
    const current = readInstallations();
    const record = current.find(item => item.catalogId === id);
    if (!record) throw new ProtocolError('NOT_FOUND', '插件尚未安装');
    if (record.skill) skillStore().uninstall(record.skill.name, record.skill.digest);
    writeInstallations(current.filter(item => item.catalogId !== id));
    notify(record, 'uninstall');
  }

  return {
    list,
    search: (query: string) => list({query}),
    get: (id: string) => structuredClone(requireEntry(id)),
    planInstall,
    install,
    installPinned,
    installations,
    setEnabled,
    checkUpdate,
    checkUpdates: () => {
      const ids = [...catalog.map(entry => entry.id), ...readInstallations().map(entry => entry.catalogId)];
      return [...new Set(ids)].map(id => checkUpdate(id));
    },
    uninstall,
  };
}
