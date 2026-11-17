import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';

/** Runtime grant confirmed at install. Empty lists mean the plugin gets none of that kind. */
export interface PluginPermissionManifest {
  networkHosts: readonly string[];
  filePaths: readonly string[];
  connectors: readonly string[];
  secrets: readonly string[];
}

export const EMPTY_PLUGIN_PERMISSIONS: PluginPermissionManifest = Object.freeze({
  networkHosts: Object.freeze([]),
  filePaths: Object.freeze([]),
  connectors: Object.freeze([]),
  secrets: Object.freeze([]),
});

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const NAME = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const FILE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const KEYS = ['networkHosts', 'filePaths', 'connectors', 'secrets'] as const;

function fail(message: string): never {
  throw new ProtocolError('INVALID_ARGUMENT', message);
}

export function isPluginPermissionName(value: string): boolean {
  return NAME.test(value) && value.length <= 80;
}

/** Relative plugin-data path. Rejects drives, UNC, URL schemes, and parent segments. */
export function isDeclaredFilePath(value: string): boolean {
  if (value.length < 1 || value.length > 120) return false;
  if (value.includes('\\') || value.includes(':') || value.startsWith('/') || value.includes('//')) return false;
  return value.split('/').every(part => FILE_SEGMENT.test(part));
}

function stringList(value: unknown, label: string, accept: (item: string) => boolean): string[] {
  if (!Array.isArray(value) || value.length > 8) fail(`${label} is invalid`);
  const items = value.map(item => {
    if (typeof item !== 'string' || !accept(item)) fail(`${label} is invalid`);
    return item;
  });
  if (new Set(items).size !== items.length) fail(`${label} contains duplicates`);
  return items;
}

export function parsePermissionManifest(value: unknown): PluginPermissionManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('permissionManifest is invalid');
  const data = value as Record<string, unknown>;
  for (const key of Object.keys(data)) if (!KEYS.includes(key as typeof KEYS[number])) fail(`permissionManifest contains unknown field ${key}`);
  return {
    networkHosts: stringList(data.networkHosts, 'networkHosts', item => HOST.test(item)),
    filePaths: stringList(data.filePaths, 'filePaths', isDeclaredFilePath),
    connectors: stringList(data.connectors, 'connectors', isPluginPermissionName),
    secrets: stringList(data.secrets, 'secrets', isPluginPermissionName),
  };
}

export function snapshotPermissionGrant(manifest: PluginPermissionManifest): PluginPermissionManifest {
  return {
    networkHosts: [...manifest.networkHosts],
    filePaths: [...manifest.filePaths],
    connectors: [...manifest.connectors],
    secrets: [...manifest.secrets],
  };
}

export function readStoredPermissionGrant(value: unknown): PluginPermissionManifest {
  try { return parsePermissionManifest(value); } catch { return EMPTY_PLUGIN_PERMISSIONS; }
}

export function samePermissionGrant(left: PluginPermissionManifest | undefined, right: PluginPermissionManifest): boolean {
  if (!left) return false;
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item, index) => item === b[index]);
  return same(left.networkHosts, right.networkHosts) && same(left.filePaths, right.filePaths)
    && same(left.connectors, right.connectors) && same(left.secrets, right.secrets);
}

/** Catalog entries removed after install disappear. Stored extras never widen the catalog. */
export function intersectPermissionGrants(stored: PluginPermissionManifest, catalog: PluginPermissionManifest): PluginPermissionManifest {
  const keep = (granted: readonly string[], allowed: readonly string[]) => allowed.filter(item => granted.includes(item));
  return {
    networkHosts: keep(stored.networkHosts, catalog.networkHosts),
    filePaths: keep(stored.filePaths, catalog.filePaths),
    connectors: keep(stored.connectors, catalog.connectors),
    secrets: keep(stored.secrets, catalog.secrets),
  };
}

function short(item: string): string {
  return item.length > 24 ? `${item.slice(0, 23)}…` : item;
}

function clip(items: readonly string[]): string {
  const shown = items.slice(0, 3).map(short);
  return items.length <= 3 ? shown.join('、') : `${shown.join('、')}等${items.length}项`;
}

export function describePluginPermissions(manifest: PluginPermissionManifest): readonly string[] {
  return [
    manifest.networkHosts.length ? `网络只允许${clip(manifest.networkHosts)}。` : '不访问网络。',
    manifest.filePaths.length ? `文件只允许插件数据中的${clip(manifest.filePaths)}。` : '不读写文件。',
    manifest.connectors.length ? `连接器只允许${clip(manifest.connectors)}。` : '不使用连接器。',
    manifest.secrets.length ? `密钥只允许${clip(manifest.secrets)}。` : '不读取密钥。',
  ];
}

/** One install card. Authorization summaries cannot exceed 512 characters. */
export function pluginInstallSummary(verb: '安装' | '更新', name: string, manifest: PluginPermissionManifest): string {
  const lead = `${verb}「${name}」。核对固定版本后停用，不执行脚本。`;
  const text = lead + describePluginPermissions(manifest).join('');
  if (text.length <= 512) return text;
  return lead + describePluginPermissions(manifest).join('').slice(0, Math.max(0, 512 - lead.length));
}

export function pluginNetworkHost(target: string): string | undefined {
  if (typeof target !== 'string' || target.length < 1 || target.length > 300) return undefined;
  if (HOST.test(target)) return target;
  let url: URL;
  try { url = new URL(target); } catch { return undefined; }
  if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 300) return undefined;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return HOST.test(host) ? host : undefined;
}

export function pathStaysInside(root: string, target: string, pathApi: Pick<path.PlatformPath, 'relative' | 'resolve' | 'sep' | 'isAbsolute'> = path): boolean {
  const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(target));
  return relative === '' || (!relative.startsWith(`..${pathApi.sep}`) && relative !== '..' && !pathApi.isAbsolute(relative));
}
