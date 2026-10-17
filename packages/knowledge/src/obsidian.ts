import {createHash} from 'node:crypto';
import {KnowledgeError} from './index.js';
import {createTextIndex} from './text-index.js';
import type {KnowledgePort, KnowledgeSearchRequest, KnowledgeSource} from './index.js';

const MAX_FILES = 1000;
const MAX_FILE_BYTES = 512 * 1024;

/** Structural subset of Obsidian's Vault/TFile API; no plugin runtime is loaded here. */
export interface ObsidianMarkdownFile {
  readonly path: string;
  readonly stat: {readonly mtime: number; readonly size: number};
}

export interface ObsidianVaultReader<TFile extends ObsidianMarkdownFile> {
  getMarkdownFiles(): TFile[];
  getAbstractFileByPath(path: string): unknown;
  read(file: TFile): Promise<string>;
}

export interface ObsidianReadOnlyPort extends KnowledgePort {
  clearIndex(): void;
  readCitation(request: {
    readonly source: KnowledgeSource;
    readonly deadline: string;
    readonly signal: AbortSignal;
  }): Promise<string>;
}

function fail(code: KnowledgeError['code']): never {
  throw new KnowledgeError(code);
}

function active(signal: AbortSignal, deadline: number): void {
  if (signal.aborted) fail('CANCELLED');
  if (Date.now() >= deadline) fail('TIMEOUT');
}

function context(value: {deadline: string; signal: AbortSignal}): number {
  if (!value || typeof value !== 'object' || typeof value.deadline !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.deadline)
    || !Number.isFinite(Date.parse(value.deadline))
    || new Date(value.deadline).toISOString() !== value.deadline
    || !value.signal || typeof value.signal.aborted !== 'boolean') fail('INVALID_ARGUMENT');
  const deadline = Date.parse(value.deadline);
  active(value.signal, deadline);
  return deadline;
}

function safePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024
    && !value.startsWith('/') && !value.includes('\\') && !value.includes(':')
    && !value.includes('\0') && value.split('/').every(part =>
      part.length > 0 && !part.startsWith('.') && !/[. ]$/.test(part));
}

/** The trusted plugin host binds one Vault and an explicit folder ('/' means the whole Vault). */
export function createObsidianVaultPort<TFile extends ObsidianMarkdownFile>(options: {
  readonly vaultId: string;
  readonly allowedFolder: string;
  readonly vault: ObsidianVaultReader<TFile>;
}): ObsidianReadOnlyPort {
  if (!options || typeof options.vaultId !== 'string' || !options.vaultId.trim()
    || options.vaultId.length > 128
    || (options.allowedFolder !== '/' && !safePath(options.allowedFolder))
    || !options.vault || typeof options.vault.getMarkdownFiles !== 'function'
    || typeof options.vault.getAbstractFileByPath !== 'function'
    || typeof options.vault.read !== 'function') fail('INVALID_ARGUMENT');

  const {vault, vaultId} = options;
  const index = createTextIndex(vaultId);
  const prefix = options.allowedFolder === '/' ? '' : options.allowedFolder + '/';
  const inScope = (path: string): boolean => !prefix || path.startsWith(prefix);

  function files(): {file: TFile; path: string}[] {
    let listed: TFile[];
    try {
      listed = vault.getMarkdownFiles();
    } catch {
      return fail('SOURCE_UNAVAILABLE');
    }
    if (!Array.isArray(listed)) fail('SOURCE_UNAVAILABLE');
    const selected: {file: TFile; path: string}[] = [];
    for (const file of listed) {
      const path = file?.path;
      if (!safePath(path) || !/\.md$/i.test(path) || !inScope(path)) continue;
      if (selected.length === MAX_FILES) fail('LIMIT_EXCEEDED');
      selected.push({file, path});
    }
    return selected.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  }

  async function readNote(file: TFile, path: string, signal: AbortSignal, deadline: number):
    Promise<{content: string; revision: string}> {
    active(signal, deadline);
    const before = file.stat && {mtime: file.stat.mtime, size: file.stat.size};
    if (file.path !== path || !before || !Number.isFinite(before.mtime)
      || !Number.isSafeInteger(before.size) || before.size < 0) fail('SOURCE_UNAVAILABLE');
    if (before.size > MAX_FILE_BYTES) fail('LIMIT_EXCEEDED');
    let content: string;
    try {
      content = await vault.read(file);
    } catch {
      active(signal, deadline);
      return fail('SOURCE_UNAVAILABLE');
    }
    active(signal, deadline);
    try {
      if (file.path !== path || file.stat.mtime !== before.mtime || file.stat.size !== before.size
        || vault.getAbstractFileByPath(path) !== file) fail('SOURCE_CHANGED');
    } catch (error) {
      if (error instanceof KnowledgeError) throw error;
      return fail('SOURCE_UNAVAILABLE');
    }
    if (typeof content !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(content)) {
      fail('SOURCE_UNAVAILABLE');
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) fail('LIMIT_EXCEEDED');
    return {content, revision: createHash('sha256').update(content).digest('hex')};
  }

  return Object.freeze({
    clearIndex: () => index.clear(),
    search: async (request: KnowledgeSearchRequest) => {
      const deadline = context(request);
      if (typeof request.query !== 'string' || !request.query.trim() || request.query.length > 128
        || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 20) {
        fail('INVALID_ARGUMENT');
      }
      const query = request.query.trim().toLowerCase();
      const pages: {path: string; content: string; revision: string}[] = [];
      let bytes = 0;
      try {
        for (const {file, path} of files()) {
          active(request.signal, deadline);
          const {content, revision} = await readNote(file, path, request.signal, deadline);
          bytes += Buffer.byteLength(content, 'utf8');
          if (bytes > 8 * 1024 * 1024) fail('LIMIT_EXCEEDED');
          pages.push({path, content, revision});
        }
        return index.search(pages, query, request.limit, () => active(request.signal, deadline));
      } catch (error) {index.clear(); throw error;}
    },
    readCitation: async (request: {source: KnowledgeSource; deadline: string; signal: AbortSignal}) => {
      const deadline = context(request);
      const source = request.source;
      if (!source || source.vaultId !== vaultId || !Number.isSafeInteger(source.line)
        || source.line < 1 || typeof source.revision !== 'string'
        || !/^[0-9a-f]{64}$/.test(source.revision) || !safePath(source.path)
        || !/\.md$/i.test(source.path)) fail('INVALID_ARGUMENT');
      if (!inScope(source.path)) fail('SCOPE_DENIED');
      const match = files().find(item => item.path === source.path);
      if (!match) fail('SOURCE_CHANGED');
      const {content, revision} = await readNote(match.file, match.path, request.signal, deadline);
      if (revision !== source.revision) fail('SOURCE_CHANGED');
      const line = content.split(/\r?\n/)[source.line - 1];
      if (line === undefined) fail('SOURCE_CHANGED');
      active(request.signal, deadline);
      return line;
    }
  });
}
