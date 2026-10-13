import {KnowledgeError} from './index.js';
import type {KnowledgeSearchRequest, KnowledgeSource} from './index.js';
import {openReadOnlyVault} from './filesystem.js';
import type {ReadOnlyPageVaultPort, VaultPage} from './filesystem.js';

export interface WikiBinding {
  readonly sourceId: string;
  readonly namespace: string;
  readonly configRevision: number;
  readonly dataLevel: 'private' | 'public';
  readonly validUntil: string;
  /** Trusted host checks the captured source/configuration and current read lease. */
  readonly isCurrent: () => boolean;
}

export interface WikiPage extends VaultPage {
  readonly sourceId: string;
  readonly namespace: string;
  readonly configRevision: number;
  readonly dataLevel: 'private' | 'public';
  readonly validUntil: string;
}

export interface WikiSource extends KnowledgeSource, WikiPage {}
/** Durable evidence, without a reusable read grant. Read again using a fresh host lease. */
export type WikiCitationReference = Omit<WikiSource, 'validUntil'>;

const referenceKeys = ['vaultId', 'path', 'line', 'revision', 'sourceId', 'namespace',
  'configRevision', 'dataLevel', 'pageId'] as const;

function validateReference(source: WikiCitationReference): void {
  if (!source || !['vaultId', 'sourceId', 'namespace'].every(key =>
    typeof source[key as 'vaultId' | 'sourceId' | 'namespace'] === 'string'
      && /^[A-Za-z0-9_.:-]{1,128}$/.test(source[key as 'vaultId' | 'sourceId' | 'namespace']))
    || typeof source.path !== 'string' || !source.path || source.path.length > 1024
    || !Number.isSafeInteger(source.line) || source.line < 1
    || !Number.isSafeInteger(source.configRevision) || source.configRevision < 1
    || !['private', 'public'].includes(source.dataLevel)
    || !['pageId', 'revision'].every(key => typeof source[key as 'pageId' | 'revision'] === 'string'
      && /^[0-9a-f]{64}$/.test(source[key as 'pageId' | 'revision']))) fail('INVALID_ARGUMENT');
}

/** Stable source version identity: transient lease expiry does not create another fact version. */
export function formatWikiCitationReference(source: WikiSource): string {
  validateReference(source);
  const value = Object.fromEntries(referenceKeys.map(key => [key, source[key]]));
  const result = 'wiki-v1:' + JSON.stringify(value);
  if (result.length > 2048) fail('LIMIT_EXCEEDED');
  return result;
}

export function parseWikiCitationReference(value: string): WikiCitationReference | undefined {
  if (typeof value !== 'string' || !value.startsWith('wiki-v1:')) return undefined;
  let source: WikiCitationReference;
  try { source = JSON.parse(value.slice(8)); } catch { return fail('INVALID_ARGUMENT'); }
  if (value.length > 2048 || !source || Array.isArray(source)
    || Object.keys(source).length !== referenceKeys.length
    || Object.keys(source).some(key => !referenceKeys.includes(key as typeof referenceKeys[number]))) fail('INVALID_ARGUMENT');
  validateReference(source);
  return source;
}

type ReadContext = {readonly deadline: string; readonly signal: AbortSignal};

/** Provisional host-only port. No write, Memory confirmation or egress authority. */
export interface WikiPort {
  scanPages(request: ReadContext): Promise<readonly WikiPage[]>;
  search(request: KnowledgeSearchRequest): Promise<{
    readonly hits: readonly {readonly source: WikiSource; readonly excerpt: string}[];
    readonly truncated: boolean;
  }>;
  readCitation(request: ReadContext & {readonly source: WikiSource}): Promise<string>;
  /** Requires a fresh bound host read lease; a persisted reference itself grants no access. */
  readReference(request: ReadContext & {readonly source: WikiCitationReference}): Promise<string>;
}

function fail(code: KnowledgeError['code']): never { throw new KnowledgeError(code); }

function validateBinding(options: WikiBinding & {vaultId: string}): void {
  if (!options || !['sourceId', 'namespace', 'vaultId'].every(key => {
    const value = options[key as 'sourceId' | 'namespace' | 'vaultId'];
    return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
  }) || !Number.isSafeInteger(options.configRevision) || options.configRevision < 1
    || !['private', 'public'].includes(options.dataLevel) || typeof options.isCurrent !== 'function'
    || typeof options.validUntil !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(options.validUntil)
    || !Number.isFinite(Date.parse(options.validUntil))
    || new Date(options.validUntil).toISOString() !== options.validUntil) fail('INVALID_ARGUMENT');
}

function checkLease(isCurrent: () => boolean, validUntil: string): void {
  if (Date.now() >= Date.parse(validUntil)) fail('SCOPE_DENIED');
  let current = false;
  try { current = isCurrent() === true; } catch { /* A failed lease check denies access. */ }
  if (!current) fail('SCOPE_DENIED');
}

/** Inject only a trusted, already scoped reader. Fake readers use this same binding boundary. */
export function createWikiPort(options: WikiBinding & {
  readonly reader: Pick<ReadOnlyPageVaultPort, 'scanPages' | 'search' | 'readPage'>;
  readonly vaultId: string;
}): WikiPort {
  validateBinding(options);
  if (!options.reader || !['scanPages', 'search', 'readPage'].every(key =>
      typeof options.reader[key as 'scanPages' | 'search' | 'readPage'] === 'function')) fail('INVALID_ARGUMENT');
  const {sourceId, namespace, configRevision, dataLevel, validUntil, isCurrent, reader, vaultId} = options;
  const binding = Object.freeze({sourceId, namespace, configRevision, dataLevel, validUntil});

  function check(request: ReadContext): void {
    if (!request || typeof request.deadline !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(request.deadline)
      || !Number.isFinite(Date.parse(request.deadline))
      || new Date(request.deadline).toISOString() !== request.deadline
      || !request.signal || typeof request.signal.aborted !== 'boolean') fail('INVALID_ARGUMENT');
    if (request.signal.aborted) fail('CANCELLED');
    if (Date.now() >= Date.parse(request.deadline)) fail('TIMEOUT');
    checkLease(isCurrent, validUntil);
  }

  async function readCitation(request: ReadContext & {source: WikiSource}): Promise<string> {
    request = {...request, source: request?.source && {...request.source}};
    check(request);
    const source = request.source;
    if (!source || source.sourceId !== sourceId || source.namespace !== namespace
      || source.configRevision !== configRevision || source.dataLevel !== dataLevel
      || source.vaultId !== vaultId) fail('SCOPE_DENIED');
    if (Object.keys(source).some(key => key !== 'validUntil'
      && !referenceKeys.includes(key as typeof referenceKeys[number]))) fail('INVALID_ARGUMENT');
    validateReference(source);
    if (typeof source.validUntil !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(source.validUntil)
      || !Number.isFinite(Date.parse(source.validUntil))
      || new Date(source.validUntil).toISOString() !== source.validUntil) fail('INVALID_ARGUMENT');
    if (Date.parse(source.validUntil) > Date.parse(validUntil) || Date.now() >= Date.parse(source.validUntil)) fail('SCOPE_DENIED');
    const page = await reader.readPage({...request, path: source.path});
    check(request);
    if (Date.now() >= Date.parse(source.validUntil)) fail('SCOPE_DENIED');
    if (page.pageId !== source.pageId || page.revision !== source.revision) fail('SOURCE_CHANGED');
    const line = page.content.split(/\r?\n/)[source.line - 1];
    if (line === undefined) fail('SOURCE_CHANGED');
    return line;
  }

  return Object.freeze({
    scanPages: async (request: ReadContext) => {
      request = {...request};
      check(request);
      const pages = await reader.scanPages(request);
      check(request);
      return pages.map(page => ({...page, ...binding}));
    },
    search: async (request: KnowledgeSearchRequest) => {
      request = {...request};
      check(request);
      const result = await reader.search(request);
      check(request);
      const hits = [];
      for (const hit of result.hits) {
        check(request);
        const page = await reader.readPage({...request, path: hit.source.path});
        check(request);
        if (hit.source.vaultId !== vaultId || page.revision !== hit.source.revision) fail('SOURCE_CHANGED');
        hits.push({source: {...hit.source, pageId: page.pageId, ...binding}, excerpt: hit.excerpt});
      }
      check(request);
      return {hits, truncated: result.truncated};
    },
    readCitation,
    readReference: (request: ReadContext & {source: WikiCitationReference}) => {
      if (!request?.source || Object.keys(request.source).some(key =>
        !referenceKeys.includes(key as typeof referenceKeys[number]))) return Promise.reject(new KnowledgeError('INVALID_ARGUMENT'));
      return readCitation({...request, source: {...request.source, validUntil}});
    }
  });
}

/** Local Markdown adapter. The host grants read access to this entire bound root. */
export async function openReadOnlyWiki(options: WikiBinding & {
  readonly vaultId: string; readonly rootPath: string;
}): Promise<WikiPort> {
  options = {...options};
  validateBinding(options);
  checkLease(options.isCurrent, options.validUntil);
  const reader = await openReadOnlyVault(options);
  checkLease(options.isCurrent, options.validUntil);
  return createWikiPort({...options, reader});
}

/** Explicit unavailable dependency; never falls back to a fixture. */
export function createUnavailableWikiPort(): WikiPort {
  const unavailable = async (): Promise<never> => fail('SOURCE_UNAVAILABLE');
  return Object.freeze({scanPages: unavailable, search: unavailable, readCitation: unavailable, readReference: unavailable});
}
