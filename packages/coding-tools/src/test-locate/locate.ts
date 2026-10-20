import {closeSync, constants, fstatSync, openSync, readSync, realpathSync} from 'node:fs';
import {isAbsolute, resolve, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProtocolError} from '@personal-agent/contracts';

/** Deterministic failure locator for `node --test` output; no model, no side effects. */
export interface TestFailureFrame {
  file: string;
  line: number;
  column?: number;
  snippet?: string;
  confidence: number;
}

export interface TestFailure {
  name: string;
  error: string;
  frames: TestFailureFrame[];
  timedOut: boolean;
  reporter: 'spec' | 'tap';
}

export interface TestFailureReport {
  failures: TestFailure[];
  totalFailures: number;
  /** Present only when the whole-report size budget dropped snippets. */
  snippetsTruncated?: number;
}

export interface TestLocateOptions {
  /** Repository root used to classify frames and read snippets. Defaults to process.cwd(). */
  root?: string;
  /** Context lines around each suspect frame. Default 2, max 8. */
  contextLines?: number;
  /** Maximum accepted input length. Default 2 MiB. */
  maxInputBytes?: number;
  /** Trusted posix-relative file or directory prefixes. Absent or empty denies all snippet reads. */
  allowedPaths?: readonly string[];
  /** Whole-report budget for snippet file reads. Default 64; 0 disables snippets. */
  maxSnippetReads?: number;
}

interface RawFailure {
  name: string;
  errorLines: string[];
  frames: {file: string; line: number; column?: number}[];
  timedOut: boolean;
  container?: boolean;
}

const STACK_LOCATION = /^(.+?):(\d+)(?::(\d+))?$/u;
const MAX_SOURCE_BYTES = 1024 * 1024;
const INTERNAL = /(^|\/)node:internal\//u;
const NODE_MODULES = /(^|\/)node_modules\//u;
const SOURCE_FILE = /\.m?[jt]sx?$/u;

function invalid(message: string): never { throw new ProtocolError('INVALID_ARGUMENT', message); }

function toPosix(path: string): string { return path.replace(/\\/g, '/'); }

function foreignWindowsPath(path: string): boolean {
  return process.platform !== 'win32' && /^(?:[a-z]:[\\/]|\\\\)/iu.test(path);
}

function withinRoot(root: string, candidate: string): boolean {
  const part = relative(root, candidate);
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

function absoluteOf(raw: string, root: string): string {
  let candidate = raw;
  if (candidate.startsWith('file://')) {
    try { candidate = fileURLToPath(candidate); } catch { return raw; }
  }
  if (foreignWindowsPath(candidate)) return candidate;
  if (!isAbsolute(candidate)) candidate = resolve(root, candidate);
  return candidate;
}

/** Repo-relative when inside root; otherwise the normalized original path. */
function displayPath(raw: string, root: string): string {
  let absolute = absoluteOf(raw, root);
  if (foreignWindowsPath(absolute)) return toPosix(raw);
  // Windows file URLs may use an 8.3 alias while root is already canonical.
  // Do not resolve remote UNC frames; canonical containment still decides access.
  if (process.platform === 'win32' && /^[a-z]:[\\/]/iu.test(absolute)) {
    try { absolute = realpathSync.native(absolute); } catch { /* Keep unresolved frames without snippets. */ }
  }
  const rel = relative(root, absolute);
  if (withinRoot(root, absolute)) return toPosix(rel);
  return toPosix(raw);
}

function extractFrames(lines: readonly string[], root: string): {file: string; line: number; column?: number}[] {
  const frames = [];
  for (const rawLine of lines) {
    const frame = rawLine.trim().replace(/^at\s+/u, '').replace(/^async\s+/u, '');
    const location = frame.endsWith(')') && frame.includes('(')
      ? frame.slice(frame.lastIndexOf('(') + 1, -1) : frame;
    const match = STACK_LOCATION.exec(location);
    if (!match) continue;
    const file = match[1]!.trim();
    const normalized = toPosix(file);
    if (!file || INTERNAL.test(normalized) || NODE_MODULES.test(normalized) || !SOURCE_FILE.test(file)) continue;
    const line = Number(match[2]);
    if (!Number.isSafeInteger(line) || line < 1) continue;
    const column = match[3] === undefined ? undefined : Number(match[3]);
    frames.push({file: displayPath(file, root), line,
      ...(column !== undefined && Number.isSafeInteger(column) && column >= 0 ? {column} : {})});
  }
  return frames.slice(0, 32);
}

function classifyTimeout(name: string, errorText: string): boolean {
  return /timed?[ -]?out|Test timed out|operation timed out/i.test(`${name} ${errorText}`);
}

/** spec reporter: run summary "✖ name (12ms)" plus trailing "✖ failing tests:" detail blocks. */
function parseSpec(output: string, root: string): RawFailure[] {
  const byName = new Map<string, RawFailure>();
  const failures: RawFailure[] = [];
  const summaryName = /^✖\s+(.+?)(?:\s+\([\d.]+m?s\))?\s*$/u;
  const detailName = /^✖\s+(.+?)(?:\s+\([\d.]+m?s\))?\s*\((?:[\d.]+m?s)\)\s*$/u;
  const lines = output.split('\n');
  let inDetail = false;
  let current: RawFailure | undefined;
  let atLines: string[] = [];

  const flushFrames = () => {
    if (current && atLines.length) {
      const frames = extractFrames(atLines, root);
      if (frames.length) current.frames = frames;
      atLines = [];
    } else atLines = [];
  };
  const open = (name: string) => {
    flushFrames();
    const key = name;
    let failure = byName.get(key);
    if (!failure) { failure = {name, errorLines: [], frames: [], timedOut: false}; byName.set(key, failure); failures.push(failure); }
    current = failure;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (/^✖ failing tests:/u.test(line)) { flushFrames(); inDetail = true; current = undefined; continue; }
    const header = inDetail ? detailName.exec(line) ?? summaryName.exec(line) : summaryName.exec(line);
    if (/^✖\s+/u.test(line) && header) { open(header[1]!.trim()); continue; }
    if (!current) continue;
    if (/^\s*at\s/u.test(line)) { atLines.push(line); continue; }
    flushFrames();
    if (current.errorLines.length < 4 && line.trim() && !/^(ℹ|✔|✖|#)/u.test(line)) {
      current.errorLines.push(line.trim());
    }
  }
  flushFrames();
  for (const failure of failures) failure.timedOut = classifyTimeout(failure.name, failure.errorLines.join(' '));
  return failures;
}

/** TAP: "not ok 1 - name" with YAML-ish indented error and stack. */
function parseTap(output: string, root: string): RawFailure[] {
  const failures: RawFailure[] = [];
  let current: RawFailure | undefined;
  let block: 'error' | 'stack' | undefined;
  let fieldIndent = 0;
  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const notOk = /^\s*not ok\s+(?:\d+\s+-\s+)?(.+)$/u.exec(line);
    if (notOk) {
      current = {name: notOk[1]!.replace(/ # Timeouts?$/u, '').trim(), errorLines: [], frames: [], timedOut: false};
      failures.push(current);
      block = undefined;
      continue;
    }
    if (!current) continue;
    if (/^\s*(?:ok\s|\.\.\.\s*$|# Subtest:)/u.test(line)) {
      current = undefined; block = undefined; continue;
    }
    if (/^\s*failureType:\s*['"]?subtestsFailed/u.test(line)) current.container = true;
    const field = /^(\s*)(error|stack):\s*(.*)$/u.exec(line);
    if (field) {
      fieldIndent = field[1]!.length;
      block = field[2] as 'error' | 'stack';
      if (block === 'error' && !/^[|>][+-]?$/u.test(field[3]!)) {
        current.errorLines.push(field[3]!.replace(/^(['"])(.*)\1$/u, '$2'));
      }
      continue;
    }
    const indent = /^\s*/u.exec(line)![0].length;
    if (line.trim() && indent <= fieldIndent) block = undefined;
    if (block === 'error' && current.errorLines.length < 32) current.errorLines.push(line.trim());
    if ((block === 'stack' || /^\s+at\s/u.test(line)) && current.frames.length < 32) {
      const frame = extractFrames([line], root)[0];
      if (frame && !current.frames.some(f => f.file === frame.file && f.line === frame.line)) current.frames.push(frame);
    }
  }
  for (const failure of failures) failure.timedOut = classifyTimeout(failure.name, failure.errorLines.join(' '));
  return failures.filter(failure => !failure.container);
}

function readSnippet(file: string, line: number, context: number, root: string, allowedPaths: readonly string[]): string | undefined {
  let fd: number | undefined;
  try {
    const candidate = absoluteOf(file, root);
    if (foreignWindowsPath(candidate) || !withinRoot(root, candidate)) return undefined;
    const canonical = realpathSync.native(candidate);
    if (!withinRoot(root, canonical)) return undefined;
    const canonicalRelative = toPosix(relative(root, canonical));
    if (!allowedPaths.some(prefix => canonicalRelative === prefix || canonicalRelative.startsWith(`${prefix}/`))) return undefined;
    fd = openSync(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_SOURCE_BYTES || realpathSync.native(candidate) !== canonical) return undefined;
    const buffer = Buffer.alloc(MAX_SOURCE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = readSync(fd, buffer, size, buffer.length - size, null);
      if (!read) break;
      size += read;
    }
    if (size > MAX_SOURCE_BYTES) return undefined;
    const content = buffer.subarray(0, size).toString('utf8');
    const lines = content.split('\n');
    if (line > lines.length || line < 1) return undefined;
    const from = Math.max(1, line - context);
    const to = Math.min(lines.length, line + context);
    const parts = [];
    for (let i = from; i <= to; i++) parts.push(`${i === line ? '>' : ' '} ${i} ${lines[i - 1]}`);
    return parts.join('\n').slice(0, 4000);
  } catch { return undefined; }
  finally { if (fd !== undefined) closeSync(fd); }
}

function scoreFrame(index: number, total: number, file: string, timedOut: boolean): number {
  let score = Math.max(0.1, 1 - index * 0.15);
  if (total === 1) score = Math.max(score, 0.6);
  if (/\.test\.m?js$/u.test(file) || /\/test\//u.test(file)) score *= 0.85;
  if (timedOut) score *= 0.7;
  return Math.round(Math.min(1, score) * 100) / 100;
}

export function locateTestFailures(output: string, options: TestLocateOptions = {}): TestFailureReport {
  if (typeof output !== 'string') invalid('Test output must be a string');
  const maxBytes = options.maxInputBytes ?? 2 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) invalid('Invalid input byte limit');
  if (Buffer.byteLength(output) > maxBytes) invalid('Test output exceeds the configured byte limit');
  const contextLines = options.contextLines ?? 2;
  if (!Number.isSafeInteger(contextLines) || contextLines < 0 || contextLines > 8) invalid('Invalid context line count');
  const maxSnippetReads = options.maxSnippetReads ?? 64;
  if (!Number.isSafeInteger(maxSnippetReads) || maxSnippetReads < 0 || maxSnippetReads > 64) invalid('Invalid snippet read budget');
  const allowedPaths = options.allowedPaths ?? [];
  if (allowedPaths !== undefined) {
    if (!Array.isArray(allowedPaths) || allowedPaths.some(value => typeof value !== 'string' || !value.trim()
      || value.includes('\\') || value.startsWith('/') || value.split('/').some(part => part === '..' || part === ''))) {
      invalid('Allowed path prefixes must be relative posix paths');
    }
  }
  const readAllowed = (file: string): boolean => allowedPaths.some(prefix => file === prefix || file.startsWith(`${prefix}/`));
  let snippetReads = 0;
  const root = realpathSync.native(options.root ?? process.cwd());
  const isTap = /^TAP version/mu.test(output) || /^not ok /mu.test(output);
  const parsed = isTap ? parseTap(output, root) : parseSpec(output, root);
  const seen = new Set<string>();
  const failures: TestFailure[] = parsed
    .filter(f => f.name.length > 0 && f.name.length <= 4096)
    .filter(f => { const key = `${f.name}#${f.frames[0]?.file ?? ''}:${f.frames[0]?.line ?? 0}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, 64)
    .map(f => ({
      name: f.name,
      error: f.errorLines.join('\n').slice(0, 2000) || '(no error message captured)',
      timedOut: f.timedOut,
      reporter: isTap ? 'tap' as const : 'spec' as const,
      frames: f.frames.map((frame, index): TestFailureFrame => {
        // Being inside the workspace root is not read permission: only trusted
        // prefixes open files, within one whole-report read budget.
        const snippet = readAllowed(frame.file) && snippetReads < maxSnippetReads
          ? (snippetReads++, readSnippet(frame.file, frame.line, contextLines, root, allowedPaths)) : undefined;
        return {...frame, ...(snippet === undefined ? {} : {snippet}),
          confidence: scoreFrame(index, f.frames.length, frame.file, f.timedOut)};
      }),
    }));
  const report: TestFailureReport = {failures, totalFailures: failures.length};
  // Keep the exported report inside the bounded continuation envelope; drop
  // snippets from the least-confident end when the projection overflows.
  let truncated = 0;
  while (Buffer.byteLength(JSON.stringify(report), 'utf8') > 240_000) {
    const frame = [...report.failures].reverse().flatMap(failure => [...failure.frames].reverse())
      .find(candidate => candidate.snippet !== undefined);
    if (!frame) break;
    delete frame.snippet;
    truncated++;
  }
  if (Buffer.byteLength(JSON.stringify(report), 'utf8') > 240_000) invalid('Test failure report exceeds the configured output budget');
  return truncated ? {...report, snippetsTruncated: truncated} : report;
}
