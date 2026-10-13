import {createHash} from 'node:crypto';
import {KnowledgeError} from './index.js';
import type {KnowledgeHit, KnowledgePort, KnowledgeSearchRequest} from './index.js';
import {createWikiPort} from './wiki.js';
import type {WikiBinding, WikiPort} from './wiki.js';

export interface FakeKnowledgeDocument {
  readonly path: string;
  readonly content: string;
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new KnowledgeError('INVALID_ARGUMENT');
  }
  return value;
}

function checkRequest(request: KnowledgeSearchRequest): string {
  if (!request || typeof request !== 'object'
    || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 20
    || !request.signal || typeof request.signal.aborted !== 'boolean') {
    throw new KnowledgeError('INVALID_ARGUMENT');
  }
  const query = boundedText(request.query, 128).trim().toLowerCase();
  if (typeof request.deadline !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(request.deadline)
    || !Number.isFinite(Date.parse(request.deadline))
    || new Date(request.deadline).toISOString() !== request.deadline) {
    throw new KnowledgeError('INVALID_ARGUMENT');
  }
  if (request.signal.aborted) throw new KnowledgeError('CANCELLED');
  if (Date.now() >= Date.parse(request.deadline)) throw new KnowledgeError('TIMEOUT');
  return query;
}

function checkPath(value: unknown): string {
  const path = boundedText(value, 1024);
  if (path.includes('\\') || path.startsWith('/') || !path.endsWith('.md')
    || path.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new KnowledgeError('INVALID_ARGUMENT');
  }
  return path;
}

/** Explicit fixture only. It reads no Vault files, runs no model, and never writes. */
export function createFakeKnowledgePort(vaultIdValue: string, documents: readonly FakeKnowledgeDocument[]): KnowledgePort {
  const vaultId = boundedText(vaultIdValue, 128);
  if (!Array.isArray(documents) || documents.length > 100) throw new KnowledgeError('INVALID_ARGUMENT');
  const seen = new Set<string>();
  const fixed = documents.map(document => {
    if (!document || typeof document !== 'object') throw new KnowledgeError('INVALID_ARGUMENT');
    const path = checkPath(document.path);
    if (seen.has(path.toLowerCase()) || typeof document.content !== 'string'
      || Buffer.byteLength(document.content, 'utf8') > 256 * 1024) throw new KnowledgeError('INVALID_ARGUMENT');
    seen.add(path.toLowerCase());
    return {
      path,
      revision: createHash('sha256').update(document.content).digest('hex'),
      lines: document.content.split(/\r?\n/)
    };
  });
  return Object.freeze({
    search: async (request: KnowledgeSearchRequest) => {
      const query = checkRequest(request);
      const hits: KnowledgeHit[] = [];
      for (const document of fixed) {
        for (let index = 0; index < document.lines.length; index++) {
          if (request.signal.aborted) throw new KnowledgeError('CANCELLED');
          if (Date.now() >= Date.parse(request.deadline)) throw new KnowledgeError('TIMEOUT');
          const line = document.lines[index]!;
          const offset = line.toLowerCase().indexOf(query);
          if (offset < 0) continue;
          if (hits.length === request.limit) return {hits, truncated: true};
          const start = Math.max(0, offset - 80);
          hits.push({
            source: {vaultId, path: document.path, line: index + 1, revision: document.revision},
            excerpt: line.slice(start, start + 320)
          });
        }
      }
      return {hits, truncated: false};
    }
  });
}

/** Explicit synthetic Wiki fixture. Path-based fixture identities are not native file identities. */
export function createFakeWikiPort(options: WikiBinding & {
  readonly vaultId: string; readonly documents: readonly FakeKnowledgeDocument[];
}): WikiPort {
  const searchPort = createFakeKnowledgePort(options.vaultId, options.documents);
  const documents = options.documents.map(({path, content}) => ({path, content,
    pageId: createHash('sha256').update(JSON.stringify([options.vaultId, path])).digest('hex'),
    revision: createHash('sha256').update(content).digest('hex')}));
  return createWikiPort({...options, reader: {
    search: request => searchPort.search(request),
    scanPages: async () => documents.map(({path, pageId, revision}) => ({path, pageId, revision})),
    readPage: async request => {
      const page = documents.find(page => page.path === request.path);
      if (!page) throw new KnowledgeError('SOURCE_UNAVAILABLE');
      return {...page};
    }
  }});
}
