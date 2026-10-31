import {closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, writeFileSync} from 'node:fs';
import {isAbsolute, join, parse, relative, resolve, sep} from 'node:path';
import {openStorage} from '@personal-agent/storage';
import {checkWikiImportContext, validateWikiDocuments, wikiImportHash} from './compiler.js';
import {WikiImportError} from './types.js';
import type {WikiCompiledLibrary, WikiCompileCache, WikiEvidence, WikiGeneratedPage, WikiImportContext, WikiImportDocument} from './types.js';

const migrations = [{version: 1, sql: `
  CREATE TABLE wiki_sources (
    source_id TEXT PRIMARY KEY, revision TEXT NOT NULL, document TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1))
  ) STRICT;
  CREATE TABLE wiki_source_versions (
    source_id TEXT NOT NULL, revision TEXT NOT NULL, raw_path TEXT NOT NULL, byte_length INTEGER NOT NULL,
    PRIMARY KEY(source_id,revision)
  ) STRICT;
  CREATE TABLE wiki_compile_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
  CREATE TABLE wiki_generations (generation TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, manifest TEXT NOT NULL) STRICT;
  CREATE TABLE wiki_current (singleton INTEGER PRIMARY KEY CHECK(singleton=1), generation TEXT) STRICT;
  INSERT INTO wiki_current VALUES(1,NULL);
  CREATE TABLE wiki_publications (
    operation_id TEXT PRIMARY KEY, generation TEXT NOT NULL, fingerprint TEXT NOT NULL, expected_generation TEXT,
    state TEXT NOT NULL CHECK(state IN ('prepared','published','abandoned'))
  ) STRICT;
  CREATE TABLE wiki_publication_lock (singleton INTEGER PRIMARY KEY CHECK(singleton=1), operation_id TEXT) STRICT;
  INSERT INTO wiki_publication_lock VALUES(1,NULL);
  CREATE TABLE wiki_pages (
    generation TEXT NOT NULL, page_id TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL,
    sha256 TEXT NOT NULL, source_ids TEXT NOT NULL, claim_ids TEXT NOT NULL, search_text TEXT NOT NULL,
    PRIMARY KEY(generation,page_id), UNIQUE(generation,path)
  ) STRICT;
`}, {version: 2, sql: `ALTER TABLE wiki_pages ADD COLUMN evidence TEXT NOT NULL DEFAULT '[]';`}];

interface Manifest {
  sources: {sourceId: string; revision: string}[];
  pages: {id: string; path: string; sha256: string; sourceIds: readonly string[]}[];
  coverage: WikiCompiledLibrary['coverage'];
  usage: WikiCompiledLibrary['usage'];
}
interface Publication {operation_id: string; generation: string; fingerprint: string; expected_generation: string | null; state: string}
interface PageRow {page_id: string; path: string; title: string; kind: WikiGeneratedPage['kind']; sha256: string; source_ids: string; claim_ids: string; search_text: string; evidence: string}

export interface WikiPublicationReceipt {
  readonly operationId: string;
  readonly generation: string;
  readonly fingerprint: string;
  readonly pageCount: number;
  readonly complete: boolean;
  readonly issueCount: number;
  readonly usage: WikiCompiledLibrary['usage'];
  readonly verified: true;
}
export interface WikiImportStoreOptions {
  readonly rootPath: string;
  /** Checks the current selected root configuration; per-operation context checks the batch grant. */
  readonly isCurrent: () => boolean;
}

function identity(path: string): string {
  const info = lstatSync(path, {bigint: true});
  if (info.isSymbolicLink() || !info.isDirectory()) throw new WikiImportError('SCOPE_DENIED');
  return `${info.dev}:${info.ino}:${info.birthtimeNs}`;
}
function checkAncestors(path: string): void {
  const root = parse(path).root;
  let current = root;
  for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    const info = lstatSync(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new WikiImportError('SCOPE_DENIED');
  }
}
function hash(value: unknown): value is string {return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);}
function pagePath(value: unknown): value is string {
  return typeof value === 'string' && /^(index\.md|report\.md|(?:sources|pages)\/[a-f0-9]{64}\.md)$/.test(value);
}
function normalize(value: string): string {return value.normalize('NFKC').toLocaleLowerCase();}

/** Library data only; task state and execution authority remain in TaskRuntime/Policy. */
export function openWikiImportStore(options: WikiImportStoreOptions) {
  if (!options || !isAbsolute(options.rootPath) || typeof options.isCurrent !== 'function') throw new WikiImportError('INVALID_ARGUMENT');
  const root = resolve(options.rootPath), directories = new Map<string, string>();
  checkAncestors(root);
  directories.set(root, identity(root));
  let closed = false;
  function check(context?: WikiImportContext): void {
    if (closed) throw new WikiImportError('SOURCE_UNAVAILABLE');
    if (context) checkWikiImportContext(context);
    if (options.isCurrent() !== true) throw new WikiImportError('SCOPE_DENIED');
    for (const [path, expected] of directories) {
      try {if (identity(path) !== expected) throw new WikiImportError('SOURCE_CHANGED');}
      catch (error) {if (error instanceof WikiImportError) throw error; throw new WikiImportError('SOURCE_CHANGED');}
    }
  }
  function directory(path: string, create = true): string {
    const absolute = resolve(root, path), rel = relative(root, absolute);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new WikiImportError('SCOPE_DENIED');
    let current = root;
    for (const part of rel.split(sep)) {
      current = join(current, part);
      if (!existsSync(current)) {
        if (!create) throw new WikiImportError('SOURCE_UNAVAILABLE');
        mkdirSync(current, {mode: 0o700});
      }
      const actual = identity(current), previous = directories.get(current);
      if (previous !== undefined && actual !== previous) throw new WikiImportError('SOURCE_CHANGED');
      directories.set(current, actual);
    }
    check(); return absolute;
  }
  function regular(path: string): void {
    const info = lstatSync(path, {bigint: true});
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1n) throw new WikiImportError('SCOPE_DENIED');
  }
  function read(path: string): Buffer {
    check(); regular(path);
    const descriptor = openSync(path, 'r');
    try {
      const opened = fstatSync(descriptor, {bigint: true}), actual = lstatSync(path, {bigint: true});
      if (opened.nlink !== 1n || opened.dev !== actual.dev || opened.ino !== actual.ino || opened.size > 64n * 1024n * 1024n) {
        throw new WikiImportError('SCOPE_DENIED');
      }
      const content = readFileSync(descriptor), after = fstatSync(descriptor, {bigint: true});
      regular(path); check();
      const final = lstatSync(path, {bigint: true});
      if (after.size !== opened.size || after.mtimeNs !== opened.mtimeNs
        || final.dev !== opened.dev || final.ino !== opened.ino || final.birthtimeNs !== opened.birthtimeNs) {
        throw new WikiImportError('SOURCE_CHANGED');
      }
      return content;
    } finally {closeSync(descriptor);}
  }
  function writeNew(path: string, bytes: Uint8Array, expected: string): void {
    check();
    if (existsSync(path)) {
      if (wikiImportHash(read(path)) !== expected) throw new WikiImportError('MANUAL_EDIT_CONFLICT');
      return;
    }
    const descriptor = openSync(path, 'wx', 0o600);
    try {
      writeFileSync(descriptor, bytes); fsyncSync(descriptor);
      if (fstatSync(descriptor, {bigint: true}).nlink !== 1n) throw new WikiImportError('SCOPE_DENIED');
    } finally {closeSync(descriptor);}
    if (wikiImportHash(read(path)) !== expected) throw new WikiImportError('SOURCE_CHANGED');
  }
  check();
  const privateRoot = directory('.personalagent'), generationsRoot = directory('wiki/generations');
  directory('raw');
  const databasePath = join(privateRoot, 'wiki.sqlite');
  for (const suffix of ['', '-wal', '-shm', '-journal']) if (existsSync(databasePath + suffix)) regular(databasePath + suffix);
  const db = openStorage(databasePath, migrations);
  regular(databasePath); check();
  const current = (): string | null => (db.prepare('SELECT generation FROM wiki_current WHERE singleton=1').get() as {generation: string | null}).generation;
  const publication = (id: string): Publication | undefined => db.prepare('SELECT * FROM wiki_publications WHERE operation_id=?').get(id) as unknown as Publication | undefined;
  function manifest(generation: string): Manifest {
    const row = db.prepare('SELECT manifest FROM wiki_generations WHERE generation=?').get(generation) as {manifest: string} | undefined;
    if (!row) throw new WikiImportError('SOURCE_UNAVAILABLE');
    try {return JSON.parse(row.manifest) as Manifest;} catch {throw new WikiImportError('SOURCE_CHANGED');}
  }
  function sourceCurrent(source: {sourceId: string; revision: string}): boolean {
    const row = db.prepare('SELECT revision,active FROM wiki_sources WHERE source_id=?').get(source.sourceId);
    return row?.active === 1 && row.revision === source.revision;
  }
  function ensureSources(value: Manifest, subset?: readonly string[]): void {
    if (value.sources.some(source => (!subset || subset.includes(source.sourceId)) && !sourceCurrent(source))) {
      throw new WikiImportError('SOURCE_CHANGED');
    }
  }
  function verifyGeneration(generation: string, context: WikiImportContext, checkSources = true): void {
    if (!hash(generation)) throw new WikiImportError('INVALID_ARGUMENT');
    const value = manifest(generation); if (checkSources) ensureSources(value);
    const base = directory(`wiki/generations/${generation}`, false);
    for (const page of value.pages) {
      check(context);
      if (!pagePath(page.path) || !hash(page.sha256)) throw new WikiImportError('SOURCE_CHANGED');
      const path = join(base, ...page.path.split('/'));
      if (page.path.includes('/')) directory(`wiki/generations/${generation}/${page.path.split('/')[0]}`, false);
      if (!existsSync(path)) throw new WikiImportError('SOURCE_UNAVAILABLE');
      if (wikiImportHash(read(path)) !== page.sha256) throw new WikiImportError('MANUAL_EDIT_CONFLICT');
    }
    check(context);
  }
  function receipt(entry: Publication): WikiPublicationReceipt {
    const value = manifest(entry.generation);
    return {operationId: entry.operation_id, generation: entry.generation, fingerprint: entry.fingerprint,
      pageCount: value.pages.length, complete: value.coverage.issues.length === 0 && value.coverage.processed === value.coverage.total,
      issueCount: value.coverage.issues.length, usage: value.usage, verified: true};
  }
  function transaction<T>(action: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {const value = action(); db.exec('COMMIT'); return value;} catch (error) {db.exec('ROLLBACK'); throw error;}
  }
  function validateCompiled(compiled: WikiCompiledLibrary): void {
    if (!compiled || !hash(compiled.fingerprint) || !Array.isArray(compiled.pages) || !compiled.pages.length
      || !Array.isArray(compiled.claims) || !compiled.coverage) throw new WikiImportError('INVALID_ARGUMENT');
    validateWikiDocuments(compiled.sources);
    const sources = new Set(compiled.sources.map(source => source.sourceId)), paths = new Set<string>();
    for (const page of compiled.pages as readonly WikiGeneratedPage[]) {
      if (!page || !pagePath(page.path) || page.id !== wikiImportHash(page.path) || paths.has(page.path)
        || typeof page.markdown !== 'string' || page.markdown.length > 16_000_000 || typeof page.title !== 'string'
        || !Array.isArray(page.sourceIds) || page.sourceIds.some(id => !sources.has(id)) || !Array.isArray(page.claimIds)
        || !Array.isArray(page.evidence)) {
        throw new WikiImportError('INVALID_ARGUMENT');
      }
      for (const evidence of page.evidence) {
        const source = compiled.sources.find(document => document.sourceId === evidence.sourceId);
        const unit = source?.units.find(value => value.id === evidence.unitId);
        if (!source || !unit || source.revision !== evidence.revision || typeof evidence.quote !== 'string'
          || !unit.text.includes(evidence.quote) || !page.sourceIds.includes(evidence.sourceId)) throw new WikiImportError('INVALID_ARGUMENT');
      }
      paths.add(page.path);
    }
    if (!paths.has('index.md') || !paths.has('report.md')) throw new WikiImportError('INVALID_ARGUMENT');
  }

  const cache: WikiCompileCache = {
    get(key) {
      check(); if (!hash(key)) throw new WikiImportError('INVALID_ARGUMENT');
      const row = db.prepare('SELECT payload FROM wiki_compile_cache WHERE cache_key=?').get(key) as {payload: string} | undefined;
      return row ? JSON.parse(row.payload) : undefined;
    },
    set(key, value) {
      check(); const payload = JSON.stringify(value);
      if (!hash(key) || !payload || payload.length > 256_000) throw new WikiImportError('INVALID_ARGUMENT');
      db.prepare('INSERT INTO wiki_compile_cache VALUES(?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload').run(key, payload);
    }
  };

  return Object.freeze({
    cache,
    close() {if (!closed) {db.close(); closed = true;}},
    status() {
      check(); const generation = current(), value = generation ? manifest(generation) : undefined;
      const sources = db.prepare('SELECT source_id,revision,active,document FROM wiki_sources ORDER BY source_id').all();
      return {generation, sourceCount: sources.filter(source => source.active === 1).length, pageCount: value?.pages.length ?? 0,
        stale: value?.sources.some(source => !sourceCurrent(source)) ?? false,
        sources: sources.map(source => ({sourceId: String(source.source_id), revision: String(source.revision),
          active: source.active === 1, name: (JSON.parse(String(source.document)) as WikiImportDocument).name})),
        pages: generation ? (db.prepare('SELECT page_id,path,title,kind,source_ids,claim_ids FROM wiki_pages WHERE generation=? ORDER BY path').all(generation) as unknown as PageRow[])
          .map(page => ({id: page.page_id, path: page.path, title: page.title, kind: page.kind,
            sourceIds: JSON.parse(page.source_ids) as string[], claimIds: JSON.parse(page.claim_ids) as string[]})) : [],
        pendingOperations: (db.prepare("SELECT operation_id FROM wiki_publications WHERE state='prepared' ORDER BY operation_id").all()).map(row => String(row.operation_id))};
    },
    saveSource(document: WikiImportDocument, bytes: Uint8Array, context: WikiImportContext) {
      check(context); validateWikiDocuments([document]);
      if (!(bytes instanceof Uint8Array) || bytes.length > 64 * 1024 * 1024 || wikiImportHash(bytes) !== document.revision) {
        throw new WikiImportError('SOURCE_CHANGED');
      }
      const dir = directory(`raw/${wikiImportHash(document.sourceId)}`), path = join(dir, `${document.revision}.bin`);
      writeNew(path, bytes, document.revision); check(context);
      transaction(() => {
        db.prepare('INSERT OR IGNORE INTO wiki_source_versions VALUES(?,?,?,?)').run(document.sourceId, document.revision,
          relative(root, path).split(sep).join('/'), bytes.length);
        db.prepare('INSERT INTO wiki_sources VALUES(?,?,?,1) ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision,document=excluded.document,active=1')
          .run(document.sourceId, document.revision, JSON.stringify(document));
      });
      return {sourceId: document.sourceId, revision: document.revision, byteLength: bytes.length};
    },
    documents(context: WikiImportContext): readonly WikiImportDocument[] {
      check(context);
      return (db.prepare('SELECT document FROM wiki_sources WHERE active=1 ORDER BY source_id').all() as {document: string}[])
        .map(row => JSON.parse(row.document) as WikiImportDocument);
    },
    readRawSource(sourceId: string, revision: string, context: WikiImportContext): Uint8Array {
      check(context); if (!sourceCurrent({sourceId, revision})) throw new WikiImportError('SOURCE_CHANGED');
      const row = db.prepare('SELECT raw_path FROM wiki_source_versions WHERE source_id=? AND revision=?').get(sourceId, revision);
      if (!row || typeof row.raw_path !== 'string' || !/^raw\/[a-f0-9]{64}\/[a-f0-9]{64}\.bin$/.test(row.raw_path)) throw new WikiImportError('SOURCE_UNAVAILABLE');
      directory(`raw/${wikiImportHash(sourceId)}`, false);
      const bytes = read(join(root, ...row.raw_path.split('/')));
      if (wikiImportHash(bytes) !== revision) throw new WikiImportError('SOURCE_CHANGED');
      check(context); return bytes;
    },
    readSource(request: {sourceId: string; revision: string; unitId: string; generation?: string}, context: WikiImportContext) {
      check(context);
      const {sourceId, revision, unitId} = request, generation = current();
      if (!sourceCurrent({sourceId, revision})) throw new WikiImportError('SOURCE_CHANGED');
      if (request.generation !== undefined) {
        if (request.generation !== generation) throw new WikiImportError('REVISION_CONFLICT');
        if (!manifest(request.generation).sources.some(source => source.sourceId === sourceId && source.revision === revision)) {
          throw new WikiImportError('SOURCE_CHANGED');
        }
      }
      const row = db.prepare('SELECT document FROM wiki_sources WHERE source_id=?').get(sourceId) as {document: string} | undefined;
      if (!row) throw new WikiImportError('SOURCE_UNAVAILABLE');
      const document = JSON.parse(row.document) as WikiImportDocument;
      validateWikiDocuments([document]);
      const unit = document.units.find(value => value.id === unitId);
      if (!unit) throw new WikiImportError('SOURCE_UNAVAILABLE');
      const path = join(directory(`raw/${wikiImportHash(sourceId)}`, false), `${revision}.bin`);
      if (wikiImportHash(read(path)) !== revision) throw new WikiImportError('SOURCE_CHANGED');
      check(context); return {sourceId, revision, name: document.name, unit, generation};
    },
    revokeSource(sourceId: string, context: WikiImportContext) {
      check(context);
      db.prepare('UPDATE wiki_sources SET active=0 WHERE source_id=?').run(sourceId);
    },
    publish(request: {operationId: string; expectedGeneration: string | null; compiled: WikiCompiledLibrary}, context: WikiImportContext): WikiPublicationReceipt {
      check(context);
      const {operationId, expectedGeneration, compiled} = request;
      if (typeof operationId !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}$/.test(operationId)
        || (expectedGeneration !== null && !hash(expectedGeneration))) throw new WikiImportError('INVALID_ARGUMENT');
      validateCompiled(compiled);
      const generation = wikiImportHash(`${operationId}\n${compiled.fingerprint}`);
      const value: Manifest = {sources: compiled.sources.map(source => ({sourceId: source.sourceId, revision: source.revision})),
        pages: compiled.pages.map(page => ({id: page.id, path: page.path, sha256: wikiImportHash(page.markdown), sourceIds: page.sourceIds})),
        coverage: compiled.coverage, usage: compiled.usage};
      ensureSources(value);
      const previous = publication(operationId);
      if (previous && (previous.fingerprint !== compiled.fingerprint || previous.expected_generation !== expectedGeneration
        || previous.generation !== generation || previous.state === 'abandoned')) throw new WikiImportError('REVISION_CONFLICT');
      if (previous?.state === 'published') {
        verifyGeneration(generation, context); return receipt(previous);
      }
      const active = current();
      if (active !== expectedGeneration) throw new WikiImportError('REVISION_CONFLICT');
      if (active) verifyGeneration(active, context, false);
      transaction(() => {
        check(context);
        const lock = db.prepare('SELECT operation_id FROM wiki_publication_lock WHERE singleton=1').get()?.operation_id;
        if (lock !== null && lock !== operationId) throw new WikiImportError('PUBLICATION_PENDING');
        if (current() !== expectedGeneration) throw new WikiImportError('REVISION_CONFLICT');
        db.prepare('INSERT OR IGNORE INTO wiki_generations VALUES(?,?,?)').run(generation, compiled.fingerprint, JSON.stringify(value));
        db.prepare("INSERT OR IGNORE INTO wiki_publications VALUES(?,?,?,?,'prepared')").run(operationId, generation, compiled.fingerprint, expectedGeneration);
        db.prepare('UPDATE wiki_publication_lock SET operation_id=? WHERE singleton=1').run(operationId);
      });
      const base = directory(`wiki/generations/${generation}`);
      for (const page of compiled.pages) {
        check(context);
        if (page.path.includes('/')) directory(`wiki/generations/${generation}/${page.path.split('/')[0]}`);
        writeNew(join(base, ...page.path.split('/')), Buffer.from(page.markdown, 'utf8'), wikiImportHash(page.markdown));
      }
      verifyGeneration(generation, context);
      transaction(() => {
        check(context); ensureSources(value);
        if (current() !== expectedGeneration) throw new WikiImportError('REVISION_CONFLICT');
        const insert = db.prepare('INSERT OR REPLACE INTO wiki_pages (generation,page_id,path,title,kind,sha256,source_ids,claim_ids,search_text,evidence) VALUES(?,?,?,?,?,?,?,?,?,?)');
        for (const page of compiled.pages) insert.run(generation, page.id, page.path, page.title, page.kind,
          wikiImportHash(page.markdown), JSON.stringify(page.sourceIds), JSON.stringify(page.claimIds), normalize(`${page.title}\n${page.markdown}`), JSON.stringify(page.evidence));
        db.prepare('UPDATE wiki_current SET generation=? WHERE singleton=1').run(generation);
        db.prepare("UPDATE wiki_publications SET state='published' WHERE operation_id=?").run(operationId);
        db.prepare('UPDATE wiki_publication_lock SET operation_id=NULL WHERE singleton=1').run();
      });
      verifyGeneration(generation, context); return receipt(publication(operationId)!);
    },
    reconcile(operationId: string, context: WikiImportContext) {
      check(context); const entry = publication(operationId);
      if (!entry) return {state: 'not_found' as const};
      if (entry.state === 'abandoned') return {state: 'abandoned' as const};
      try {verifyGeneration(entry.generation, context);} catch (error) {
        if (error instanceof WikiImportError && error.code === 'SOURCE_UNAVAILABLE') return {state: 'incomplete' as const, generation: entry.generation};
        throw error;
      }
      return entry.state === 'published' ? {state: 'published' as const, receipt: receipt(entry)}
        : {state: 'ready' as const, generation: entry.generation};
    },
    abandonPublication(operationId: string, context: WikiImportContext) {
      check(context); transaction(() => {
        const entry = publication(operationId);
        if (!entry || entry.state !== 'prepared' || current() === entry.generation) throw new WikiImportError('REVISION_CONFLICT');
        db.prepare("UPDATE wiki_publications SET state='abandoned' WHERE operation_id=?").run(operationId);
        db.prepare('UPDATE wiki_publication_lock SET operation_id=NULL WHERE singleton=1 AND operation_id=?').run(operationId);
      });
    },
    readPage(path: string, context: WikiImportContext, expectedGeneration?: string) {
      check(context); if (!pagePath(path)) throw new WikiImportError('INVALID_ARGUMENT');
      const generation = current();
      if (!generation) throw new WikiImportError('SOURCE_UNAVAILABLE');
      if (expectedGeneration !== undefined && generation !== expectedGeneration) throw new WikiImportError('REVISION_CONFLICT');
      const page = db.prepare('SELECT * FROM wiki_pages WHERE generation=? AND path=?').get(generation, path) as unknown as PageRow | undefined;
      if (!page) throw new WikiImportError('SOURCE_UNAVAILABLE');
      const sourceIds = JSON.parse(page.source_ids) as string[]; ensureSources(manifest(generation), sourceIds);
      directory(`wiki/generations/${generation}`, false);
      if (path.includes('/')) directory(`wiki/generations/${generation}/${path.split('/')[0]}`, false);
      const markdown = read(join(generationsRoot, generation, ...path.split('/'))).toString('utf8');
      if (wikiImportHash(markdown) !== page.sha256) throw new WikiImportError('MANUAL_EDIT_CONFLICT');
      check(context);
      return {generation, page: {id: page.page_id, path, title: page.title, kind: page.kind, markdown,
        sourceIds, claimIds: JSON.parse(page.claim_ids) as string[], evidence: JSON.parse(page.evidence) as WikiEvidence[]}};
    },
    search(query: string, context: WikiImportContext, limit = 10) {
      check(context);
      if (typeof query !== 'string' || !query.trim() || query.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new WikiImportError('INVALID_ARGUMENT');
      }
      const generation = current();
      if (!generation) return {generation: null, hits: [], truncated: false};
      const normalized = normalize(query.trim()), terms = new Set(normalized.split(/\s+/).filter(Boolean));
      for (const match of normalized.matchAll(/[\p{Script=Han}]{2,}/gu)) {
        for (let index = 0; index < match[0].length - 1 && terms.size < 24; index++) terms.add(match[0].slice(index, index + 2));
      }
      const words = [...terms].slice(0, 24), pattern = (word: string) => `%${word.replace(/[\\%_]/g, '\\$&')}%`;
      // ponytail: bounded SQLite substring search; add an index when measured library size warrants it.
      const rows = db.prepare(`SELECT * FROM wiki_pages WHERE generation=? AND (${words.map(() => "search_text LIKE ? ESCAPE '\\'").join(' OR ')}) LIMIT 501`)
        .all(generation, ...words.map(pattern)) as unknown as PageRow[];
      const value = manifest(generation), hits = [];
      for (const row of rows.slice(0, 500)) {
        check(context);
        const sourceIds = JSON.parse(row.source_ids) as string[];
        if (value.sources.some(source => sourceIds.includes(source.sourceId) && !sourceCurrent(source))) continue;
        const title = normalize(row.title), score = words.reduce((sum, word) => sum + (title.includes(word) ? 8 : row.search_text.includes(word) ? 1 : 0), 0)
          + (title === normalized ? 30 : 0) + (row.kind === 'source' ? 0 : 3);
        const at = Math.max(0, row.search_text.indexOf(words[0]!));
        hits.push({id: row.page_id, path: row.path, title: row.title, kind: row.kind,
          excerpt: row.search_text.slice(Math.max(0, at - 80), at + 240), sourceIds, score});
      }
      hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
      for (const hit of hits.slice(0, limit)) {
        const page = rows.find(row => row.page_id === hit.id)!;
        if (!pagePath(page.path)) throw new WikiImportError('SOURCE_CHANGED');
        directory(`wiki/generations/${generation}`, false);
        if (page.path.includes('/')) directory(`wiki/generations/${generation}/${page.path.split('/')[0]}`, false);
        if (wikiImportHash(read(join(generationsRoot, generation, ...page.path.split('/')))) !== page.sha256) {
          throw new WikiImportError('MANUAL_EDIT_CONFLICT');
        }
      }
      check(context);
      return {generation, hits: hits.slice(0, limit), truncated: rows.length > 500 || hits.length > limit};
    },
    rollback(generation: string, expectedGeneration: string | null, context: WikiImportContext) {
      check(context); if (!hash(generation)) throw new WikiImportError('INVALID_ARGUMENT');
      const published = db.prepare("SELECT operation_id FROM wiki_publications WHERE generation=? AND state='published'").get(generation);
      if (!published) throw new WikiImportError('SOURCE_UNAVAILABLE');
      verifyGeneration(generation, context);
      transaction(() => {
        check(context);
        if (current() !== expectedGeneration || db.prepare('SELECT operation_id FROM wiki_publication_lock WHERE singleton=1').get()?.operation_id !== null) {
          throw new WikiImportError('REVISION_CONFLICT');
        }
        ensureSources(manifest(generation));
        db.prepare('UPDATE wiki_current SET generation=? WHERE singleton=1').run(generation);
      });
      return {generation, verified: true as const};
    }
  });
}

export type WikiImportStore = ReturnType<typeof openWikiImportStore>;
