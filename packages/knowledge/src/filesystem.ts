import {createHash} from 'node:crypto';
import {constants, lstatSync, realpathSync} from 'node:fs';
import type {Stats} from 'node:fs';
import type {BigIntStats} from 'node:fs';
import {lstat, open, readdir, realpath} from 'node:fs/promises';
import {isAbsolute, join, relative, sep, win32} from 'node:path';
import {KnowledgeError} from './index.js';
import type {KnowledgeHit, KnowledgePort, KnowledgeSearchRequest, KnowledgeSource} from './index.js';

const MAX_FILES = 1000;
const MAX_DIRECTORIES = 1000;
const MAX_DEPTH = 16;
const MAX_FILE_BYTES = 512 * 1024;

export interface ReadOnlyVaultPort extends KnowledgePort {
  /** Host-only selected-note view. No write or cloud-export permission is implied. */
  readNote(request: {readonly path: string; readonly deadline: string; readonly signal: AbortSignal}):
    Promise<{content: string; revision: string}>;
  readCitation(request: {
    readonly source: KnowledgeSource;
    readonly deadline: string;
    readonly signal: AbortSignal;
  }): Promise<string>;
}

export interface ReadOnlyPageVaultPort extends ReadOnlyVaultPort {
  /** Host-only inventory. A missing entry is not proof of deletion. */
  scanPages(request: {readonly deadline: string; readonly signal: AbortSignal}): Promise<readonly VaultPage[]>;
  readPage(request: {readonly path: string; readonly deadline: string; readonly signal: AbortSignal}):
    Promise<VaultPage & {readonly content: string}>;
}

export interface VaultPage {
  readonly path: string;
  readonly pageId: string;
  readonly revision: string;
}

function fail(code: KnowledgeError['code']): never {
  throw new KnowledgeError(code);
}

function checkContext(value: {deadline: string; signal: AbortSignal}): number {
  if (!value || typeof value !== 'object' || typeof value.deadline !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.deadline)
    || !Number.isFinite(Date.parse(value.deadline))
    || new Date(value.deadline).toISOString() !== value.deadline
    || !value.signal || typeof value.signal.aborted !== 'boolean') fail('INVALID_ARGUMENT');
  const deadline = Date.parse(value.deadline);
  checkActive(value.signal, deadline);
  return deadline;
}

function checkActive(signal: AbortSignal, deadline: number): void {
  if (signal.aborted) fail('CANCELLED');
  if (Date.now() >= deadline) fail('TIMEOUT');
}

function checkRelativePath(path: unknown): string[] {
  if (typeof path !== 'string' || !path || path.length > 1024 || path.includes('\\')
    || path.includes(':') || path.includes('\0') || isAbsolute(path) || win32.isAbsolute(path)
    || !/\.md$/i.test(path)) fail('INVALID_ARGUMENT');
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    || part.startsWith('.'))) fail('INVALID_ARGUMENT');
  return parts;
}

function within(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function sameIdentity(left: {dev: number; ino: number}, right: {dev: number; ino: number}): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function fileKey(info: BigIntStats): string {
  if (info.ino === 0n) fail('SOURCE_UNAVAILABLE');
  return [info.dev, info.ino, info.birthtimeNs].map(String).join(':');
}

function unchanged(
  left: {dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number},
  right: {dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number}
): boolean {
  return sameIdentity(left, right) && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function safeError(error: unknown): never {
  if (error instanceof KnowledgeError) throw error;
  return fail('SOURCE_UNAVAILABLE');
}

/** Detached, read-only filesystem path. A trusted host must explicitly bind the Vault root. */
export async function openReadOnlyVault(options: {vaultId: string; rootPath: string}): Promise<ReadOnlyPageVaultPort> {
  if (!options || typeof options.vaultId !== 'string' || !options.vaultId.trim()
    || options.vaultId.length > 128 || typeof options.rootPath !== 'string'
    || !isAbsolute(options.rootPath) || options.rootPath.startsWith('\\\\')) fail('INVALID_ARGUMENT');
  let root: string;
  let rootIdentity: Stats;
  let rootKey: string;
  try {
    const info = lstatSync(options.rootPath);
    if (info.isSymbolicLink()) fail('SCOPE_DENIED');
    if (!info.isDirectory()) fail('INVALID_ARGUMENT');
    root = realpathSync.native(options.rootPath);
    rootIdentity = lstatSync(root);
    if (!sameIdentity(info, rootIdentity)) fail('SOURCE_CHANGED');
    rootKey = fileKey(lstatSync(root, {bigint: true}));
  } catch (error) {
    safeError(error);
  }
  const vaultId = options.vaultId;

  async function checkRoot(): Promise<void> {
    const current = await lstat(root);
    if (current.isSymbolicLink() || !current.isDirectory()
      || !sameIdentity(rootIdentity, current) || current.birthtimeMs !== rootIdentity.birthtimeMs) {
      fail('SCOPE_DENIED');
    }
    if (fileKey(await lstat(root, {bigint: true})) !== rootKey) fail('SCOPE_DENIED');
  }

  async function readNote(path: string, signal: AbortSignal, deadline: number): Promise<VaultPage & {content: string}> {
    const parts = checkRelativePath(path);
    const candidate = join(root, ...parts);
    if (!within(root, candidate)) fail('SCOPE_DENIED');
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let expectedFile: Stats | undefined;
    try {
      await checkRoot();
      for (let count = 1; count <= parts.length; count++) {
        checkActive(signal, deadline);
        const info = await lstat(join(root, ...parts.slice(0, count)));
        if (info.isSymbolicLink()) fail('SCOPE_DENIED');
        if (count < parts.length && !info.isDirectory()) fail('SOURCE_UNAVAILABLE');
        if (count === parts.length && !info.isFile()) fail('SOURCE_UNAVAILABLE');
        if (count === parts.length) expectedFile = info;
      }
      const beforePath = await realpath(candidate);
      if (!within(root, beforePath) || !samePath(candidate, beforePath)) fail('SCOPE_DENIED');
      const flags = process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
      handle = await open(beforePath, flags);
      const before = await handle.stat();
      const identity = fileKey(await handle.stat({bigint: true}));
      if (!before.isFile() || !unchanged(expectedFile!, before)) fail('SCOPE_DENIED');
      if (before.nlink !== 1) fail('SCOPE_DENIED');
      if (before.size > MAX_FILE_BYTES) fail('LIMIT_EXCEEDED');
      const buffer = Buffer.allocUnsafe(before.size);
      let offset = 0;
      while (offset < buffer.length) {
        checkActive(signal, deadline);
        const {bytesRead} = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (bytesRead === 0) fail('SOURCE_CHANGED');
        offset += bytesRead;
      }
      checkActive(signal, deadline);
      const after = await handle.stat();
      const pathAfter = await lstat(candidate);
      const afterPath = await realpath(candidate);
      if (pathAfter.isSymbolicLink() || !samePath(beforePath, afterPath)
        || !sameIdentity(before, pathAfter)) fail('SCOPE_DENIED');
      if (!unchanged(before, after)) fail('SOURCE_CHANGED');
      if (after.nlink !== 1 || pathAfter.nlink !== 1) fail('SCOPE_DENIED');
      if (fileKey(await lstat(candidate, {bigint: true})) !== identity) fail('SOURCE_CHANGED');
      await checkRoot();
      checkActive(signal, deadline);
      let content: string;
      try {
        content = new TextDecoder('utf-8', {fatal: true}).decode(buffer);
      } catch {
        fail('SOURCE_UNAVAILABLE');
      }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(content)) fail('SOURCE_UNAVAILABLE');
      const pageId = createHash('sha256').update(JSON.stringify([
        vaultId, rootKey, identity
      ])).digest('hex');
      return {path, pageId, content, revision: createHash('sha256').update(buffer).digest('hex')};
    } catch (error) {
      return safeError(error);
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  async function scan(signal: AbortSignal, deadline: number,
    consume: (page: VaultPage & {content: string}) => void): Promise<void> {
    let files = 0;
    let directories = 0;
    async function visit(parts: string[]): Promise<void> {
      checkActive(signal, deadline);
      if (++directories > MAX_DIRECTORIES || parts.length > MAX_DEPTH) fail('LIMIT_EXCEEDED');
      const directory = join(root, ...parts);
      try {
        await checkRoot();
        const before = await lstat(directory);
        const resolved = await realpath(directory);
        if (before.isSymbolicLink() || !within(root, resolved) || !samePath(directory, resolved)) fail('SCOPE_DENIED');
        if (!before.isDirectory()) fail('SOURCE_UNAVAILABLE');
        const entries = await readdir(directory, {withFileTypes: true});
        entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        for (const entry of entries) {
          checkActive(signal, deadline);
          if (entry.name.startsWith('.')) continue;
          if (entry.isSymbolicLink()) fail('SCOPE_DENIED');
          if (entry.isDirectory()) await visit([...parts, entry.name]);
          else if (entry.isFile() && /\.md$/i.test(entry.name)) {
            if (++files > MAX_FILES) fail('LIMIT_EXCEEDED');
            consume(await readNote([...parts, entry.name].join('/'), signal, deadline));
          }
        }
        const after = await lstat(directory);
        if (!unchanged(before, after)) fail('SOURCE_CHANGED');
        await checkRoot();
        checkActive(signal, deadline);
      } catch (error) { safeError(error); }
    }
    await visit([]);
  }

  return Object.freeze({
    scanPages: async (request: {deadline: string; signal: AbortSignal}) => {
      const deadline = checkContext(request);
      const pages: VaultPage[] = [];
      await scan(request.signal, deadline, ({path, pageId, revision}) => { pages.push({path, pageId, revision}); });
      return pages;
    },
    readPage: async (request: {path: string; deadline: string; signal: AbortSignal}) => {
      const deadline = checkContext(request);
      return readNote(request.path, request.signal, deadline);
    },
    readNote: async (request: {path: string; deadline: string; signal: AbortSignal}) => {
      const deadline = checkContext(request);
      const {content, revision} = await readNote(request.path, request.signal, deadline);
      return {content, revision};
    },
    search: async (request: KnowledgeSearchRequest) => {
      const deadline = checkContext(request);
      if (typeof request.query !== 'string' || !request.query.trim() || request.query.length > 128
        || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 20) fail('INVALID_ARGUMENT');
      const query = request.query.trim().toLowerCase();
      const hits: KnowledgeHit[] = [];
      let truncated = false;
      // Bounded rescan is shared with the Wiki inventory; no second index or watcher.
      await scan(request.signal, deadline, ({path, content, revision}) => {
        for (const [index, line] of content.split(/\r?\n/).entries()) {
          checkActive(request.signal, deadline);
          const offset = line.toLowerCase().indexOf(query);
          if (offset < 0) continue;
          if (hits.length === request.limit) {
            truncated = true;
            continue;
          }
          hits.push({
            source: {vaultId, path, line: index + 1, revision},
            excerpt: line.slice(Math.max(0, offset - 80), Math.max(0, offset - 80) + 320)
          });
        }
      });
      return {hits, truncated};
    },
    readCitation: async (request: {source: KnowledgeSource; deadline: string; signal: AbortSignal}) => {
      const deadline = checkContext(request);
      const source = request.source;
      if (!source || source.vaultId !== vaultId || !Number.isSafeInteger(source.line)
        || source.line < 1 || typeof source.revision !== 'string'
        || !/^[0-9a-f]{64}$/.test(source.revision)) fail('INVALID_ARGUMENT');
      const {content, revision} = await readNote(source.path, request.signal, deadline);
      if (revision !== source.revision) fail('SOURCE_CHANGED');
      const line = content.split(/\r?\n/)[source.line - 1];
      if (line === undefined) fail('SOURCE_CHANGED');
      checkActive(request.signal, deadline);
      return line;
    }
  });
}
