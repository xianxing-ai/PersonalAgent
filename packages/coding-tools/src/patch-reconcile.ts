import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {realpathSync, statSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {lstat, readFile, unlink} from 'node:fs/promises';
import {basename, isAbsolute, relative, resolve, sep} from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import {checkedSource} from './patch-stage.js';

const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_RELATIVE_PATH_LENGTH = 1024;
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu;
const PROCESS_START_TICKS = /^[1-9]\d{0,19}$/u;
const PROCESS_QUERY_TIMEOUT_MS = 2_000;
const MAX_PROCESS_QUERY_OUTPUT_BYTES = 256;

export interface WorkspacePatchReconcileOptions {
  /** Trusted workspace root used when the apply marker was created. */
  rootPath: string;
  /** Trusted, access-controlled directory outside the workspace. */
  recoveryRootPath: string;
  /** Canonical relative source path used by the original preview. */
  relativePath: string;
  /** Trusted process identity check. It must bind both PID and start-time token. */
  isProcessAlive?: (identity: WorkspacePatchProcessIdentity) => WorkspacePatchProcessState | Promise<WorkspacePatchProcessState>;
  /** Absolute trusted pwsh/powershell path used when no checker is injected. */
  powerShellPath?: string;
  /** Original Runtime execution identity, checked before returning or clearing a marker. */
  expectedRunId?: string;
  expectedArgumentsDigest?: string;
  expectedBeforeSha256?: string;
  /** Keep the marker until Runtime has persisted the reconciliation outcome. */
  retainMarker?: boolean;
}

export interface WorkspacePatchProcessIdentity {
  pid: number;
  /** Decimal .NET DateTime.Ticks captured from the helper process. */
  startTimeTicks: string;
}

export type WorkspacePatchProcessState = 'running' | 'exited' | 'unknown';

export type WorkspacePatchReconciliationResult =
  | {path: string; state: 'clear'}
  | {path: string; state: 'in_progress'; runId: string; argumentsDigest: string;
    pid: number; beforeSha256: string; afterSha256: string}
  | {path: string; state: 'reconciled'; runId: string; argumentsDigest: string;
    outcome: 'applied' | 'not_applied' | 'unknown'; beforeSha256: string; afterSha256: string; currentSha256: string;
    byteLength?: number};

interface InFlightMarker {
  runId: string;
  argumentsDigest: string;
  pid: number;
  startTimeTicks: string;
  beforeSha256: string;
  afterSha256: string;
}

interface FileIdentity {
  dev: number | bigint;
  ino: number | bigint;
  size: number | bigint;
  mtimeMs: number | bigint;
  ctimeMs: number | bigint;
}

function invalid(message: string): never {
  throw new ProtocolError('INVALID_ARGUMENT', message);
}

function unknown(message: string): never {
  throw new ProtocolError('RESULT_UNKNOWN', message);
}

function canonicalRoot(path: string, label: string): string {
  if (typeof path !== 'string' || !path.trim()) invalid(`${label} must not be empty`);
  try {
    const root = realpathSync.native(path);
    if (!statSync(root).isDirectory()) invalid(`${label} must identify a directory`);
    return root;
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    invalid(`${label} is not an accessible directory`);
  }
}

function canonicalRelativePath(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_RELATIVE_PATH_LENGTH
    || value.includes('\0') || value.includes('\\') || value.startsWith('/') || value.includes(':')) {
    invalid('Workspace patch relativePath is not canonical');
  }
  const segments = value.split('/');
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..'
    || /[. ]$/u.test(segment)
    || WINDOWS_RESERVED_NAME.test(segment.split('.')[0] ?? segment))) {
    invalid('Workspace patch relativePath is not canonical');
  }
  return segments.join('/');
}

function inside(root: string, candidate: string): boolean {
  const part = relative(root, candidate);
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

function atOrWithin(root: string, candidate: string): boolean {
  const part = relative(root, candidate);
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}

function sourceKey(root: string, relativePath: string): string {
  return createHash('sha256').update(`${root}\n${relativePath}`, 'utf8').digest('hex').slice(0, 32);
}

/**
 * Returns the marker location used by the apply helper. Both callers use the
 * same canonical root/path tuple so a reconciler cannot accidentally clear a
 * marker belonging to a different workspace source.
 */
export function workspacePatchInflightPath(
  rootPath: string,
  recoveryRootPath: string,
  relativePath: string,
): string {
  const root = canonicalRoot(rootPath, 'Workspace rootPath');
  const recoveryRoot = canonicalRoot(recoveryRootPath, 'Recovery rootPath');
  const path = canonicalRelativePath(relativePath);
  return workspacePatchInflightPathFromCanonical(root, recoveryRoot, path);
}

/** Internal companion for an apply tool that already captured canonical roots. */
export function workspacePatchInflightPathFromCanonical(
  root: string,
  recoveryRoot: string,
  relativePath: string,
): string {
  const path = canonicalRelativePath(relativePath);
  const marker = resolve(recoveryRoot, `${sourceKey(root, path)}.inflight`);
  if (atOrWithin(root, recoveryRoot) || atOrWithin(recoveryRoot, root) || !inside(recoveryRoot, marker)) {
    invalid('Patch recovery directory must be outside the workspace');
  }
  return marker;
}

function parseMarker(value: string): InFlightMarker {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { unknown('Workspace patch in-flight record is invalid'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    unknown('Workspace patch in-flight record is invalid');
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const runId = record.runId;
  const argumentsDigest = record.argumentsDigest;
  const pid = record.pid;
  const startTimeTicks = record.startTimeTicks;
  if (keys.length !== 6 || keys[0] !== 'afterSha256' || keys[1] !== 'argumentsDigest'
    || keys[2] !== 'beforeSha256' || keys[3] !== 'pid' || keys[4] !== 'runId' || keys[5] !== 'startTimeTicks'
    || typeof runId !== 'string' || !runId.trim() || runId.length > 256
    || typeof argumentsDigest !== 'string' || !SHA256.test(argumentsDigest)
    || (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid < 1)
    || typeof startTimeTicks !== 'string' || !PROCESS_START_TICKS.test(startTimeTicks)
    || BigInt(startTimeTicks).toString() !== startTimeTicks
    || typeof record.beforeSha256 !== 'string' || !SHA256.test(record.beforeSha256)
    || typeof record.afterSha256 !== 'string' || !SHA256.test(record.afterSha256)) {
    unknown('Workspace patch in-flight record is invalid');
  }
  return {
    runId,
    argumentsDigest,
    pid,
    startTimeTicks,
    beforeSha256: record.beforeSha256 as string,
    afterSha256: record.afterSha256 as string,
  };
}

function sameFile(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as {code?: unknown}).code) : undefined;
}

function canonicalPowerShellPath(powerShellPath: string): string {
  if (typeof powerShellPath !== 'string' || !isAbsolute(powerShellPath)) {
    invalid('Workspace patch process checker requires an absolute PowerShell path');
  }
  let resolved: string;
  try { resolved = realpathSync.native(powerShellPath); }
  catch { invalid('Workspace patch process checker PowerShell path is unavailable'); }
  if (!statSync(resolved).isFile() || !['pwsh.exe', 'powershell.exe'].includes(basename(resolved).toLowerCase())) {
    invalid('Workspace patch process checker requires pwsh.exe or powershell.exe');
  }
  return resolved;
}

type ProcessQueryFailure = 'spawn_failed' | 'query_timeout' | 'output_limit' | 'query_failed' | 'invalid_output';
type ProcessStartQuery =
  | {state: 'found'; startTimeTicks: string}
  | {state: 'not_found'; elapsedMs: number}
  | {state: 'unknown'; reason: ProcessQueryFailure; elapsedMs: number};

function queryProcessStartTime(pid: number, powerShellPath: string): Promise<ProcessStartQuery> {
  const executable = canonicalPowerShellPath(powerShellPath);
  const command = `$ErrorActionPreference='Stop'; try { $p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -eq $p) { [Console]::Out.Write('NOT_FOUND'); exit 3 }; [Console]::Out.Write($p.StartTime.ToUniversalTime().Ticks) } catch { exit 4 }`;
  const startedAt = performance.now();
  const elapsedMs = (): number => Math.max(0, Math.round(performance.now() - startedAt));
  return new Promise(resolveResult => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      resolveResult({state: 'unknown', reason: 'spawn_failed', elapsedMs: elapsedMs()});
      return;
    }
    let settled = false;
    let output = '';
    const timer = setTimeout(() => finish({state: 'unknown', reason: 'query_timeout', elapsedMs: elapsedMs()}), PROCESS_QUERY_TIMEOUT_MS);
    const finish = (result: ProcessStartQuery): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.removeAllListeners('data');
      child.removeAllListeners('close');
      if (child.exitCode === null) {
        try { child.kill('SIGKILL'); } catch { /* query cleanup is best effort */ }
      }
      resolveResult(result);
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (Buffer.byteLength(output, 'utf8') > MAX_PROCESS_QUERY_OUTPUT_BYTES) {
        finish({state: 'unknown', reason: 'output_limit', elapsedMs: elapsedMs()});
      }
    });
    child.once('error', () => finish({state: 'unknown', reason: 'spawn_failed', elapsedMs: elapsedMs()}));
    child.once('close', code => {
      const value = output.trim();
      if (code === 0 && PROCESS_START_TICKS.test(value) && BigInt(value).toString() === value) {
        finish({state: 'found', startTimeTicks: value});
      } else if (code === 3 && value === 'NOT_FOUND') {
        finish({state: 'not_found', elapsedMs: elapsedMs()});
      } else {
        finish({state: 'unknown', reason: code === 0 ? 'invalid_output' : 'query_failed', elapsedMs: elapsedMs()});
      }
    });
  });
}

/** Captures the helper's OS start token before any candidate bytes are sent. */
export async function captureWorkspacePatchProcessIdentity(
  pid: number,
  powerShellPath: string,
): Promise<WorkspacePatchProcessIdentity> {
  if (!Number.isSafeInteger(pid) || pid < 1) unknown('Workspace patch helper identity is unavailable (invalid_pid, 0ms)');
  const result = await queryProcessStartTime(pid, powerShellPath);
  if (result.state !== 'found') {
    const reason = result.state === 'not_found' ? 'process_not_found' : result.reason;
    unknown(`Workspace patch helper identity is unavailable (${reason}, ${result.elapsedMs}ms)`);
  }
  return {pid, startTimeTicks: result.startTimeTicks};
}

async function inspectWorkspacePatchProcess(
  identity: WorkspacePatchProcessIdentity,
  powerShellPath: string,
): Promise<WorkspacePatchProcessState> {
  const result = await queryProcessStartTime(identity.pid, powerShellPath);
  if (result.state === 'not_found') return 'exited';
  if (result.state !== 'found' || result.startTimeTicks !== identity.startTimeTicks) return 'unknown';
  return 'running';
}

async function readCurrentSource(root: string, path: string): Promise<{sha256: string; byteLength: number; identity: FileIdentity}> {
  let before: Awaited<ReturnType<typeof checkedSource>>;
  try { before = await checkedSource(root, path); }
  catch (error) { if (error instanceof ProtocolError) throw error; unknown('Workspace patch source could not be checked'); }
  const sourcePath = resolve(root, ...path.split('/'));
  let bytes: Buffer;
  try { bytes = await readFile(sourcePath); }
  catch { unknown('Workspace patch source could not be read back'); }
  let after: Awaited<ReturnType<typeof checkedSource>>;
  try { after = await checkedSource(root, path); }
  catch (error) { if (error instanceof ProtocolError) throw error; unknown('Workspace patch source changed during reconciliation'); }
  const beforeIdentity: FileIdentity = {
    dev: before.dev, ino: before.ino, size: before.size, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs,
  };
  const afterIdentity: FileIdentity = {
    dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs,
  };
  if (!sameFile(beforeIdentity, afterIdentity) || bytes.length !== after.size) {
    unknown('Workspace patch source changed during reconciliation');
  }
  return {sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, identity: afterIdentity};
}

/**
 * Reconciles one stale apply marker after a trusted host confirms the helper
 * exited. It never starts, stops, retries, or rolls back a process. A marker
 * is removed only after process exit and a readback of the protected source;
 * an unexpected source hash is reported as `unknown` and remains non-success.
 */
export async function reconcileWorkspacePatchApply(
  options: WorkspacePatchReconcileOptions,
): Promise<WorkspacePatchReconciliationResult> {
  if (!options || typeof options !== 'object') invalid('Workspace patch reconciliation options are required');
  // Keep the original execution binding, checker and retention policy across awaits.
  options = {...options};
  const path = canonicalRelativePath(options?.relativePath);
  const root = canonicalRoot(options.rootPath, 'Workspace rootPath');
  const recoveryRoot = canonicalRoot(options.recoveryRootPath, 'Recovery rootPath');
  if (atOrWithin(root, recoveryRoot) || atOrWithin(recoveryRoot, root)) {
    invalid('Patch recovery directory must be outside the workspace');
  }
  // checkedSource performs the final canonical containment and regular-file checks.
  const markerPath = resolve(recoveryRoot, `${sourceKey(root, path)}.inflight`);
  let markerStat: Awaited<ReturnType<typeof lstat>>;
  let markerBytes: string;
  try {
    markerStat = await lstat(markerPath);
    if (!markerStat.isFile() || markerStat.nlink !== 1) unknown('Workspace patch in-flight record is not a regular file');
    markerBytes = await readFile(markerPath, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return {path, state: 'clear'};
    if (error instanceof ProtocolError) throw error;
    unknown('Workspace patch in-flight record could not be read');
  }
  const marker = parseMarker(markerBytes!);
  if ((options.expectedRunId !== undefined && options.expectedRunId !== marker.runId)
    || (options.expectedArgumentsDigest !== undefined && options.expectedArgumentsDigest !== marker.argumentsDigest)
    || (options.expectedBeforeSha256 !== undefined && options.expectedBeforeSha256 !== marker.beforeSha256)) {
    unknown('Workspace patch in-flight record does not match the original authorized operation');
  }
  const identity: WorkspacePatchProcessIdentity = {pid: marker.pid, startTimeTicks: marker.startTimeTicks};
  const isAlive = options.isProcessAlive
    ?? (options.powerShellPath ? (value: WorkspacePatchProcessIdentity) => inspectWorkspacePatchProcess(value, options.powerShellPath!) : undefined);
  if (!isAlive) unknown('Workspace patch helper identity checker is unavailable');
  let state: WorkspacePatchProcessState;
  try {
    state = await isAlive(identity);
    if (!['running', 'exited', 'unknown'].includes(state)) unknown('Workspace patch helper exit is unconfirmed');
  }
  catch { unknown('Workspace patch helper exit is unconfirmed'); }
  if (state === 'unknown') unknown('Workspace patch helper identity is unconfirmed');
  if (state === 'running') {
    return {path, state: 'in_progress', runId: marker.runId, argumentsDigest: marker.argumentsDigest,
      pid: marker.pid, beforeSha256: marker.beforeSha256, afterSha256: marker.afterSha256};
  }

  const current = await readCurrentSource(root, path);
  const outcome = (current.sha256 === marker.afterSha256 ? 'applied'
    : current.sha256 === marker.beforeSha256 ? 'not_applied' : 'unknown') as 'applied' | 'not_applied' | 'unknown';
  const reconciled = {path, state: 'reconciled' as const, runId: marker.runId,
    argumentsDigest: marker.argumentsDigest, outcome, beforeSha256: marker.beforeSha256,
    afterSha256: marker.afterSha256, currentSha256: current.sha256, byteLength: current.byteLength};
  let currentMarker: Awaited<ReturnType<typeof lstat>>;
  try { currentMarker = await lstat(markerPath); }
  catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return reconciled;
    }
    unknown('Workspace patch in-flight record changed during reconciliation');
  }
  const markerIdentity: FileIdentity = {
    dev: markerStat!.dev, ino: markerStat!.ino, size: markerStat!.size,
    mtimeMs: markerStat!.mtimeMs, ctimeMs: markerStat!.ctimeMs,
  };
  const currentMarkerIdentity: FileIdentity = {
    dev: currentMarker!.dev, ino: currentMarker!.ino, size: currentMarker!.size,
    mtimeMs: currentMarker!.mtimeMs, ctimeMs: currentMarker!.ctimeMs,
  };
  if (!sameFile(markerIdentity, currentMarkerIdentity)) unknown('Workspace patch in-flight record changed during reconciliation');
  if (options.retainMarker === true) return reconciled;
  try { await unlink(markerPath); }
  catch (error) {
    if (errorCode(error) !== 'ENOENT') unknown('Workspace patch in-flight record could not be cleared');
  }
  if (await lstat(markerPath).then(() => true, error => errorCode(error) !== 'ENOENT')) {
    unknown('Workspace patch in-flight record remains after reconciliation');
  }
  return reconciled;
}
