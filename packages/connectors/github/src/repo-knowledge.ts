import {createHash} from 'node:crypto';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import {detectApiDocDrift} from './developer-direction.js';

/** 默认跳过依赖、构建产物和版本库。不是完整的 gitignore 解析器。 */
export const DEFAULT_KNOWLEDGE_IGNORE = ['node_modules', 'dist', '.git', 'coverage', '.cache', '.worktrees'];

export interface KnowledgeScanPolicy {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  ignore: readonly string[];
}

export interface IndexedKnowledgeFile {
  path: string;
  digest: string;
  bytes: number;
  symbols: string[];
  convention: boolean;
  documented: string[];
  buildRecipes: string[];
  testRecipes: string[];
  reused: boolean;
}

export interface KnowledgeIndex {
  repo: string;
  files: IndexedKnowledgeFile[];
  skipped: Array<{path: string; reason: string}>;
  buildRecipes: string[];
  testRecipes: string[];
  implemented: string[];
  documented: string[];
  digest: string;
  truncated: boolean;
  evidenceLevel: 'fixture' | 'local-scan';
}

export const DEFAULT_KNOWLEDGE_POLICY: KnowledgeScanPolicy = {
  maxFileBytes: 262_144,
  maxTotalBytes: 8_000_000,
  maxFiles: 2_000,
  ignore: DEFAULT_KNOWLEDGE_IGNORE,
};

const fail = (message: string): never => {throw new ProtocolError('INVALID_ARGUMENT', message);};

export function digestText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function ignored(path: string, ignore: readonly string[]): boolean {
  const parts = path.split(/[/\\]/);
  return parts.some(part => ignore.includes(part));
}

function symbolsOf(path: string, text: string): {symbols: string[]; documented: string[]; convention: boolean; buildRecipes: string[]; testRecipes: string[]} {
  const convention = /(^|\/)(AGENTS|CONTRIBUTING)\.md$/i.test(path) || path.endsWith('ARCHITECTURE.md');
  const symbols = [...text.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)].map(match => match[1]!).filter(Boolean);
  const documented = [...text.matchAll(/^#{1,3}\s+`?([A-Za-z0-9_./:-]+)`?/gm)].map(match => match[1]!).filter(name => name.length < 80);
  let buildRecipes: string[] = [];
  let testRecipes: string[] = [];
  if (path.endsWith('package.json')) {
    try {
      const scripts = (JSON.parse(text) as {scripts?: Record<string, string>}).scripts ?? {};
      buildRecipes = Object.keys(scripts).filter(name => /build|compile/.test(name));
      testRecipes = Object.keys(scripts).filter(name => /test|check/.test(name));
    } catch { /* 非法 package.json 不产生配方。 */ }
  }
  return {symbols, documented, convention, buildRecipes, testRecipes};
}

export function indexKnowledgeFiles(input: {
  repo: string;
  files: ReadonlyArray<{path: string; text: string; bytes?: number}>;
  previous?: Pick<KnowledgeIndex, 'files'>;
  policy?: Partial<KnowledgeScanPolicy>;
  evidenceLevel?: KnowledgeIndex['evidenceLevel'];
}): KnowledgeIndex {
  if (!input.repo.trim()) fail('Repository name is required');
  const policy = {...DEFAULT_KNOWLEDGE_POLICY, ...input.policy, ignore: input.policy?.ignore ?? DEFAULT_KNOWLEDGE_POLICY.ignore};
  const previous = new Map((input.previous?.files ?? []).map(file => [file.path, file]));
  const files: IndexedKnowledgeFile[] = [];
  const skipped: KnowledgeIndex['skipped'] = [];
  let total = 0;
  let truncated = false;
  const buildRecipes = new Set<string>();
  const testRecipes = new Set<string>();
  for (const file of input.files) {
    if (files.length >= policy.maxFiles) {truncated = true; skipped.push({path: file.path, reason: 'file count'}); break;}
    if (ignored(file.path, policy.ignore)) {skipped.push({path: file.path, reason: 'ignored'}); continue;}
    const bytes = file.bytes ?? Buffer.byteLength(file.text);
    if (bytes > policy.maxFileBytes) {skipped.push({path: file.path, reason: 'file too large'}); continue;}
    if (total + bytes > policy.maxTotalBytes) {truncated = true; skipped.push({path: file.path, reason: 'total size'}); continue;}
    total += bytes;
    const digest = digestText(file.text);
    const prior = previous.get(file.path);
    if (prior && prior.digest === digest) {
      const keptBuild = prior.buildRecipes ?? [];
      const keptTest = prior.testRecipes ?? [];
      for (const name of keptBuild) buildRecipes.add(name);
      for (const name of keptTest) testRecipes.add(name);
      files.push({...prior, buildRecipes: [...keptBuild], testRecipes: [...keptTest], reused: true});
      continue;
    }
    const extracted = symbolsOf(file.path, file.text);
    for (const name of extracted.buildRecipes) buildRecipes.add(name);
    for (const name of extracted.testRecipes) testRecipes.add(name);
    files.push({path: file.path, digest, bytes, symbols: extracted.symbols, convention: extracted.convention, documented: extracted.documented, buildRecipes: extracted.buildRecipes, testRecipes: extracted.testRecipes, reused: false});
  }
  const implemented = [...new Set(files.flatMap(file => file.symbols))].sort();
  const documented = [...new Set(files.flatMap(file => file.documented))].sort();
  const digest = digestText(JSON.stringify(files.map(file => [file.path, file.digest])));
  return {repo: input.repo, files, skipped, buildRecipes: [...buildRecipes].sort(), testRecipes: [...testRecipes].sort(), implemented, documented, digest, truncated, evidenceLevel: input.evidenceLevel ?? 'fixture'};
}

export function scanKnowledgeDirectory(input: {repo: string; root: string; previous?: Pick<KnowledgeIndex, 'files' | 'buildRecipes' | 'testRecipes'>; policy?: Partial<KnowledgeScanPolicy>}): KnowledgeIndex {
  const policy = {...DEFAULT_KNOWLEDGE_POLICY, ...input.policy, ignore: input.policy?.ignore ?? DEFAULT_KNOWLEDGE_POLICY.ignore};
  const found: Array<{path: string; text: string; bytes: number}> = [];
  const walk = (directory: string) => {
    let entries: string[] = [];
    try {entries = readdirSync(directory);} catch {return;}
    for (const name of entries) {
      const absolute = join(directory, name);
      const rel = relative(input.root, absolute).split(sep).join('/');
      if (ignored(rel, policy.ignore)) continue;
      let info;
      try {info = statSync(absolute);} catch {continue;}
      if (info.isDirectory()) walk(absolute);
      else if (info.isFile()) {
        if (info.size > policy.maxFileBytes) {found.push({path: rel, text: '', bytes: info.size}); continue;}
        found.push({path: rel, text: readFileSync(absolute, 'utf8'), bytes: info.size});
      }
    }
  };
  walk(input.root);
  return indexKnowledgeFiles({repo: input.repo, files: found, ...(input.previous ? {previous: input.previous} : {}), policy, evidenceLevel: 'local-scan'});
}

export function knowledgeDrift(index: KnowledgeIndex) {
  return detectApiDocDrift({implemented: index.implemented, documented: index.documented});
}
