import {existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  EMPTY_PLUGIN_PERMISSIONS, isDeclaredFilePath, isPluginPermissionName, pathStaysInside, pluginNetworkHost,
  type PluginPermissionManifest,
} from './permissions.js';

export type PluginAccessKind = 'network' | 'file' | 'connector' | 'secret';
export type PluginAccessReason = 'ok' | 'not-installed' | 'not-enabled' | 'catalog-removed' | 'network' | 'file' | 'connector' | 'secret' | 'invalid';

export interface PluginAccessLookup {
  state: 'missing' | 'disabled' | 'removed' | 'enabled';
  grant: PluginPermissionManifest;
}

export interface PluginSandboxViolation {
  at: string;
  pluginId: string;
  kind: PluginAccessKind | 'invalid';
  target: string;
  reason: PluginAccessReason;
}

export interface PluginAccessDecision {
  allowed: boolean;
  reason: PluginAccessReason;
  found?: boolean;
  text?: string;
  value?: string;
  status?: number | null;
}

export interface PluginSandboxOptions {
  dataRoot: string;
  violationFile: string;
  lookup(pluginId: string): PluginAccessLookup;
  readSecret?: (name: string) => string | undefined;
  fetchImpl?: (url: string) => Promise<{status: number}>;
  now?: () => string;
}

const PLUGIN_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const MAX_TEXT = 65_536;

function safeTarget(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  return text.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120);
}

function isSymlink(target: string): boolean {
  try { return lstatSync(target).isSymbolicLink(); } catch { return false; }
}

function existsOrSymlink(target: string): boolean {
  try { lstatSync(target); return true; } catch { return false; }
}

function contained(root: string, target: string): boolean {
  const base = path.resolve(root);
  if (!pathStaysInside(base, target)) return false;
  if (isSymlink(base)) return false;
  let cursor = target;
  while (!existsOrSymlink(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return false;
    if (path.resolve(parent) === base) { cursor = parent; break; }
    if (!pathStaysInside(base, parent)) return false;
    cursor = parent;
  }
  if (!existsOrSymlink(cursor) && path.resolve(cursor) === base) return !isSymlink(base);
  let current = cursor;
  while (true) {
    if (isSymlink(current) || !pathStaysInside(base, current)) return false;
    if (path.resolve(current) === base) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function grantedFile(grant: PluginPermissionManifest, relative: string): boolean {
  return isDeclaredFilePath(relative) && grant.filePaths.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`));
}

export function createPluginSandbox(options: PluginSandboxOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  const readSecret = options.readSecret ?? (() => undefined);
  const fetchImpl = options.fetchImpl ?? (async url => {
    const response = await fetch(url, {redirect: 'manual'});
    return {status: response.status};
  });

  function readViolations(): PluginSandboxViolation[] {
    const file = options.violationFile;
    try {
      if (!existsSync(file) || isSymlink(file) || !lstatSync(file).isFile() || lstatSync(file).size > 262_144) return [];
      const saved = JSON.parse(readFileSync(file, 'utf8')) as {version?: unknown; events?: unknown};
      if (saved.version !== 1 || !Array.isArray(saved.events)) return [];
      return saved.events.filter((event): event is PluginSandboxViolation => Boolean(event) && typeof event === 'object'
        && typeof (event as PluginSandboxViolation).pluginId === 'string'
        && typeof (event as PluginSandboxViolation).reason === 'string').slice(-32);
    } catch { return []; }
  }

  function log(event: PluginSandboxViolation) {
    const file = options.violationFile;
    const temporary = `${file}.tmp-${process.pid}`;
    try {
      if (isSymlink(file) || isSymlink(temporary)) return;
      mkdirSync(path.dirname(file), {recursive: true});
      const events = [...readViolations(), event].slice(-32);
      writeFileSync(temporary, JSON.stringify({version: 1, events}), 'utf8');
      renameSync(temporary, file);
    } catch { /* The denial still stands when the log cannot be written. */ }
  }

  function deny(pluginId: string, kind: PluginSandboxViolation['kind'], target: unknown, reason: PluginAccessReason): PluginAccessDecision {
    log({at: now(), pluginId: PLUGIN_ID.test(pluginId) ? pluginId : 'unknown', kind, target: safeTarget(target), reason});
    return {allowed: false, reason};
  }

  function resolveGrant(pluginId: string, kind: PluginSandboxViolation['kind'], target: unknown): {grant: PluginPermissionManifest} | PluginAccessDecision {
    if (!PLUGIN_ID.test(pluginId)) return deny(pluginId, 'invalid', target, 'invalid');
    const found = options.lookup(pluginId);
    if (found.state === 'missing') return deny(pluginId, kind, target, 'not-installed');
    if (found.state === 'removed') return deny(pluginId, kind, target, 'catalog-removed');
    if (found.state === 'disabled') return deny(pluginId, kind, target, 'not-enabled');
    return {grant: found.grant ?? EMPTY_PLUGIN_PERMISSIONS};
  }

  function pluginDirectory(pluginId: string): string | undefined {
    if (!PLUGIN_ID.test(pluginId)) return undefined;
    const root = path.resolve(options.dataRoot);
    if (isSymlink(root)) return undefined;
    const directory = path.resolve(root, pluginId);
    return pathStaysInside(root, directory) && !isSymlink(directory) ? directory : undefined;
  }

  function fileTarget(pluginId: string, relative: string): string | undefined {
    const directory = pluginDirectory(pluginId);
    if (!directory || !isDeclaredFilePath(relative)) return undefined;
    const target = path.resolve(directory, ...relative.split('/'));
    if (!pathStaysInside(directory, target) || !contained(directory, target)) return undefined;
    return target;
  }

  function decide(pluginId: string, kind: PluginAccessKind, target: string, fileMode?: 'read' | 'write'): PluginAccessDecision {
    const resolved = resolveGrant(pluginId, kind, target);
    if ('allowed' in resolved) return resolved;
    const grant = resolved.grant;
    if (kind === 'network') {
      const host = pluginNetworkHost(target);
      if (!host || !grant.networkHosts.includes(host)) return deny(pluginId, 'network', host ?? 'invalid-url', 'network');
      return {allowed: true, reason: 'ok'};
    }
    if (kind === 'file') {
      if (fileMode !== 'read' && fileMode !== 'write') return deny(pluginId, 'file', target, 'invalid');
      if (!grantedFile(grant, target) || !fileTarget(pluginId, target)) return deny(pluginId, 'file', target, 'file');
      return {allowed: true, reason: 'ok'};
    }
    if (kind === 'connector') {
      if (!isPluginPermissionName(target) || !grant.connectors.includes(target)) return deny(pluginId, 'connector', target, 'connector');
      return {allowed: true, reason: 'ok'};
    }
    if (!isPluginPermissionName(target) || !grant.secrets.includes(target)) return deny(pluginId, 'secret', target, 'secret');
    return {allowed: true, reason: 'ok'};
  }

  return {
    violations: readViolations,
    lastViolation(): PluginSandboxViolation | undefined {
      const events = readViolations();
      return events.at(-1);
    },
    denyInvalid(pluginId: unknown, kind: unknown, target: unknown): PluginAccessDecision {
      const normalizedKind: PluginSandboxViolation['kind'] =
        kind === 'network' || kind === 'file' || kind === 'connector' || kind === 'secret' ? kind : 'invalid';
      return deny(typeof pluginId === 'string' ? pluginId : 'unknown', normalizedKind, target, 'invalid');
    },
    decide,
    readFile(pluginId: string, relative: string): PluginAccessDecision {
      const decision = decide(pluginId, 'file', relative, 'read');
      if (!decision.allowed) return decision;
      const target = fileTarget(pluginId, relative);
      if (!target) return deny(pluginId, 'file', relative, 'file');
      if (!existsOrSymlink(target)) return {allowed: true, reason: 'ok', found: false};
      if (isSymlink(target) || !lstatSync(target).isFile() || lstatSync(target).size > MAX_TEXT) return deny(pluginId, 'file', relative, 'file');
      let text: string;
      try { text = new TextDecoder('utf-8', {fatal: true}).decode(readFileSync(target)); }
      catch { return deny(pluginId, 'file', relative, 'file'); }
      if (text.includes('\u0000')) return deny(pluginId, 'file', relative, 'file');
      return {allowed: true, reason: 'ok', found: true, text};
    },
    writeFile(pluginId: string, relative: string, body: string): PluginAccessDecision {
      const decision = decide(pluginId, 'file', relative, 'write');
      if (!decision.allowed) return decision;
      if (typeof body !== 'string' || body.length > MAX_TEXT || body.includes('\u0000')) return deny(pluginId, 'file', relative, 'invalid');
      const directory = pluginDirectory(pluginId);
      const target = directory ? fileTarget(pluginId, relative) : undefined;
      if (!directory || !target) return deny(pluginId, 'file', relative, 'file');
      if (isSymlink(options.dataRoot) || isSymlink(directory)) {
        return deny(pluginId, 'file', relative, 'file');
      }
      mkdirSync(path.dirname(target), {recursive: true});
      const temporary = `${target}.tmp-${process.pid}`;
      if (!contained(directory, target) || isSymlink(temporary) || (existsOrSymlink(target) && (isSymlink(target) || !lstatSync(target).isFile()))) {
        return deny(pluginId, 'file', relative, 'file');
      }
      writeFileSync(temporary, body, 'utf8');
      renameSync(temporary, target);
      return {allowed: true, reason: 'ok'};
    },
    async fetch(pluginId: string, url: string): Promise<PluginAccessDecision> {
      const decision = decide(pluginId, 'network', url);
      if (!decision.allowed) return decision;
      try {
        const response = await fetchImpl(url);
        if (response.status >= 300 && response.status < 400) return deny(pluginId, 'network', pluginNetworkHost(url) ?? url, 'network');
        return {allowed: true, reason: 'ok', status: response.status};
      } catch {
        return {allowed: true, reason: 'ok', status: null};
      }
    },
    readSecret(pluginId: string, name: string): PluginAccessDecision {
      const decision = decide(pluginId, 'secret', name);
      if (!decision.allowed) return decision;
      let value: string | undefined;
      try { value = readSecret(name); } catch { value = undefined; }
      if (typeof value !== 'string' || value.length > 4096) return {allowed: true, reason: 'ok', found: false};
      return {allowed: true, reason: 'ok', found: true, value};
    },
  };
}
