import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, statSync, writeSync} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {basename, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext, ToolDescriptor} from '@personal-agent/contracts';
import type {WorkspacePatchPreviewResult} from './patch-preview.js';
import {checkedSource} from './patch-stage.js';
import {
  parseWorkspacePatchProcessReady,
  workspacePatchInflightPathFromCanonical,
} from './patch-reconcile.js';

export const WORKSPACE_PATCH_APPLY_TOOL_NAME = 'workspace.apply_text_patch';
export const WORKSPACE_PATCH_APPLY_TOOL_VERSION = '1.0.0';
export const WORKSPACE_PATCH_APPLY_SCOPE = 'workspace:apply';

const helperPath = fileURLToPath(new URL('../scripts/locked-apply.ps1', import.meta.url));
const MAX_HELPER_OUTPUT_BYTES = 8192;
const STOP_GRACE_MS = 2000;
const INPUT_DIGEST = /^[a-f0-9]{64}$/u;

export interface WorkspacePatchApplyResult {
  path: string;
  beforeSha256: string;
  afterSha256: string;
  byteLength: number;
  changed: boolean;
  applied: boolean;
  recoveryId?: string;
}

export interface WorkspacePatchApplyHostOptions {
  /** Pre-created trusted, access-controlled directory outside the user workspace. */
  recoveryRootPath: string;
  /** Absolute path to the trusted Windows PowerShell executable. */
  powerShellPath: string;
  /** Optional absolute path to the trusted WindowsJobProcessHost executable for identity queries. */
  processIdentityHelperPath?: string;
  /** Optional absolute path to a host-installed, byte-identical bundled helper outside workspace and recovery roots. */
  helperScriptPath?: string;
}

interface ApplyOptions extends WorkspacePatchApplyHostOptions {
  rootPath: string;
  preview: RegisteredTool;
  now: () => number;
}

export interface LockedApplyRequest {
  operation?: 'replace' | 'create';
  rootPath: string;
  sourcePath: string;
  backupPath?: string;
  beforeSha256?: string;
  afterSha256: string;
  afterBase64: string;
}

export interface LockedApplyResponse {
  state: 'applied' | 'created' | 'conflict' | 'exists' | 'unknown';
  backupRetained?: boolean;
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function atOrWithin(root: string, candidate: string): boolean {
  const part = relative(root, candidate);
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}

function check(context: ToolContext, now: () => number,
  requiredScopes: readonly string[] = ['workspace:read', 'workspace:write', WORKSPACE_PATCH_APPLY_SCOPE]): number {
  if (requiredScopes.some(scope => !context.scopes.includes(scope))) {
    throw new ProtocolError('SCOPE_DENIED', 'Workspace write requires read, write and operation scopes');
  }
  if (typeof context.runId !== 'string' || !context.runId.trim()
    || !INPUT_DIGEST.test(context.argumentsDigest ?? '')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Workspace patch execution identity is unavailable');
  }
  if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'Workspace patch apply was cancelled');
  const deadline = Date.parse(context.deadline);
  const remaining = deadline - now();
  if (!Number.isFinite(deadline) || remaining <= 0) {
    throw new ProtocolError('TIMEOUT', 'Workspace patch apply deadline expired');
  }
  return remaining;
}


async function invokeHelper(
  executable: string,
  script: string,
  processIdentityHelperPath: string | undefined,
  request: LockedApplyRequest,
  inflightPath: string,
  context: ToolContext,
  now: () => number,
  options: {requiredScopes?: readonly string[]} = {},
): Promise<LockedApplyResponse> {
  void processIdentityHelperPath;
  let remaining = check(context, now, options.requiredScopes);
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(executable, ['-NoProfile', '-NonInteractive', '-File', script], {
      cwd: request.rootPath,
      env: {
        SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
        TEMP: process.env.TEMP ?? '',
        TMP: process.env.TMP ?? '',
      },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper could not start');
  }

  let childClosed = false;
  let closeCode: number | null = null;
  let childError: ProtocolError | undefined;
  let stdoutBuffer = '';
  let outputBytes = 0;
  let readyIdentity: Awaited<ReturnType<typeof parseWorkspacePatchProcessReady>> | undefined;
  let readyResolve: (() => void) | undefined;
  let readyReject: ((error: unknown) => void) | undefined;
  let readySettled = false;
  let requestSent = false;
  let preflightFailure: ProtocolError | undefined;
  const responseFrames: unknown[] = [];
  let stopCurrent: ((error: ProtocolError) => void) | undefined;
  const readyPromise = new Promise<void>((resolveResult, rejectResult) => {
    readyResolve = resolveResult;
    readyReject = rejectResult;
  });
  const closed = new Promise<void>(resolveResult => {
    child.once('close', (code: number | null) => {
      childClosed = true;
      closeCode = code;
      if (!readyIdentity && !readySettled) {
        readySettled = true;
        readyReject?.(new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper exited before READY'));
      }
      resolveResult();
    });
  });
  const rejectReady = (error: ProtocolError): void => {
    if (readySettled) return;
    readySettled = true;
    readyReject?.(error);
  };
  const failBeforeMarker = (error: ProtocolError): void => {
    if (!preflightFailure) preflightFailure = error;
    rejectReady(error);
    try { child.kill('SIGKILL'); } catch { /* close or grace timeout reports the outcome */ }
  };
  const parseFrame = (line: string): void => {
    if (preflightFailure) return;
    const value = line.trim();
    if (!value) return;
    let frame: unknown;
    try { frame = JSON.parse(value) as unknown; }
    catch {
      const error = new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper emitted an invalid frame');
      if (!readyIdentity || !requestSent) failBeforeMarker(error);
      else stopCurrent?.(error);
      return;
    }
    if (!readyIdentity) {
      try {
        readyIdentity = parseWorkspacePatchProcessReady(frame, child.pid ?? 0);
        readySettled = true;
        readyResolve?.();
      } catch (error) {
        failBeforeMarker(error instanceof ProtocolError
          ? error : new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper READY frame is invalid'));
      }
      return;
    }
    if (!requestSent) {
      failBeforeMarker(new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper emitted data before request'));
      return;
    }
    responseFrames.push(frame);
  };
  const onStdout = (chunk: Buffer): void => {
    outputBytes += chunk.length;
    if (outputBytes > MAX_HELPER_OUTPUT_BYTES) {
      const error = new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper output exceeded limit');
      if (!readyIdentity || !requestSent) failBeforeMarker(error);
      else stopCurrent?.(error);
      return;
    }
    stdoutBuffer += chunk.toString('utf8');
    let newline = stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).replace(/\r$/u, '');
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      parseFrame(line);
      newline = stdoutBuffer.indexOf('\n');
    }
  };
  child.stdout?.on('data', onStdout);
  child.stderr?.on('data', (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > MAX_HELPER_OUTPUT_BYTES) {
      const error = new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper output exceeded limit');
      if (!readyIdentity || !requestSent) failBeforeMarker(error);
      else stopCurrent?.(error);
    }
  });
  child.once('error', () => {
    childError = new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper could not start');
    if (!readyIdentity || !requestSent) failBeforeMarker(childError);
    else stopCurrent?.(childError);
  });

  const waitAfterKill = async (): Promise<void> => {
    if (childClosed) return;
    await Promise.race([closed, new Promise<void>(resolveResult => setTimeout(resolveResult, STOP_GRACE_MS))]);
    if (!childClosed) {
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
  };

  const onReadyAbort = (): void => failBeforeMarker(new ProtocolError('RESULT_UNKNOWN', 'Workspace patch apply was interrupted'));
  context.signal.addEventListener('abort', onReadyAbort, {once: true});
  const readyTimer = setTimeout(
    () => failBeforeMarker(new ProtocolError('TIMEOUT', 'Workspace patch apply deadline expired')),
    Math.min(remaining, 2_147_483_647),
  );
  try {
    await readyPromise;
  } catch (error) {
    clearTimeout(readyTimer);
    context.signal.removeEventListener('abort', onReadyAbort);
    await waitAfterKill();
    throw error instanceof ProtocolError ? error : new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper READY was not confirmed');
  }
  if (preflightFailure) {
    clearTimeout(readyTimer);
    context.signal.removeEventListener('abort', onReadyAbort);
    await waitAfterKill();
    throw preflightFailure;
  }
  clearTimeout(readyTimer);
  context.signal.removeEventListener('abort', onReadyAbort);
  if (!readyIdentity || childClosed || childError) {
    await waitAfterKill();
    throw childError ?? new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper identity is unavailable');
  }

  try {
    remaining = check(context, now, options.requiredScopes);
  } catch (error) {
    try { child.kill('SIGKILL'); } catch { /* no candidate bytes were sent */ }
    await waitAfterKill();
    throw error instanceof ProtocolError ? error : new ProtocolError('RESULT_UNKNOWN', 'Workspace patch apply preflight failed');
  }

  let markerFd: number | undefined;
  try {
    markerFd = openSync(inflightPath, 'wx', 0o600);
    // Replace keeps the historical six-key marker; create has no "before" bytes.
    writeSync(markerFd, JSON.stringify(request.operation === 'create'
      ? {operation: 'create', runId: context.runId, argumentsDigest: context.argumentsDigest,
        pid: readyIdentity.pid, startTimeTicks: readyIdentity.startTimeTicks, afterSha256: request.afterSha256}
      : {runId: context.runId, argumentsDigest: context.argumentsDigest,
        pid: readyIdentity.pid, startTimeTicks: readyIdentity.startTimeTicks,
        beforeSha256: request.beforeSha256, afterSha256: request.afterSha256}));
    fsyncSync(markerFd);
    closeSync(markerFd);
    markerFd = undefined;
  } catch {
    if (markerFd !== undefined) {
      try { closeSync(markerFd); } catch { /* a durable marker may remain */ }
    }
    try { child.kill('SIGKILL'); } catch { /* no candidate was sent */ }
    await waitAfterKill();
    throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch in-flight record could not be persisted');
  }

  let stopReason: ProtocolError | undefined;
  let stopResolve: (() => void) | undefined;
  const stopStarted = new Promise<void>(resolveResult => { stopResolve = resolveResult; });
  const stop = (error: ProtocolError): void => {
    if (stopReason) return;
    stopReason = error;
    try { child.kill('SIGKILL'); } catch { /* finish on close or grace timeout */ }
    stopResolve?.();
  };
  stopCurrent = stop;
  if (preflightFailure) stop(preflightFailure);
  const onAbort = (): void => stop(new ProtocolError('RESULT_UNKNOWN', 'Workspace patch apply was interrupted'));
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const stopInput = (): void => stop(new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper input failed'));
  child.stdin?.on('error', stopInput);
  context.signal.addEventListener('abort', onAbort, {once: true});
  try {
    remaining = check(context, now, options.requiredScopes);
  } catch (error) {
    stop(error instanceof ProtocolError ? error : new ProtocolError('RESULT_UNKNOWN', 'Workspace patch apply preflight failed'));
  }
  if (!stopReason) {
    deadlineTimer = setTimeout(
      () => stop(new ProtocolError('RESULT_UNKNOWN', 'Workspace patch apply deadline expired')),
      Math.min(remaining, 2_147_483_647),
    );
    requestSent = true;
    try { child.stdin?.end(JSON.stringify(request)); }
    catch { stop(new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper input failed')); }
  }
  if (context.signal.aborted) onAbort();

  await Promise.race([closed, stopStarted]);
  if (!childClosed) {
    await waitAfterKill();
    if (!childClosed) {
      context.signal.removeEventListener('abort', onAbort);
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper stop is unconfirmed');
    }
  }
  context.signal.removeEventListener('abort', onAbort);
  if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  if (stdoutBuffer.trim()) parseFrame(stdoutBuffer);
  if (childError && !stopReason) stopReason = childError;
  if (stopReason) {
    if (!requestSent) { try { await unlink(inflightPath); } catch { /* no candidate was sent */ } }
    throw stopReason;
  }
  if (closeCode !== 0) {
    throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper did not complete');
  }
  if (responseFrames.length !== 1) {
    throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper returned an invalid receipt');
  }
  const response = responseFrames[0];
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper returned an invalid receipt');
  }
  const parsed = response as Record<string, unknown>;
  if (!['applied', 'created', 'conflict', 'exists', 'unknown'].includes(String(parsed.state))
    || (parsed.backupRetained !== undefined && typeof parsed.backupRetained !== 'boolean')) {
    throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper returned an invalid receipt');
  }
  if (parsed.state === 'unknown') {
    throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper returned an unknown receipt');
  }
  try {
    await unlink(inflightPath);
  } catch {
    throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper exited but in-flight record remains');
  }
  return parsed as unknown as LockedApplyResponse;
}


export function createWorkspacePatchApplyToolFromPreview(options: ApplyOptions): RegisteredTool {
  if (process.platform !== 'win32') throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Locked patch apply requires Windows');
  const root = realpathSync.native(options.rootPath);
  const recoveryRoot = realpathSync.native(options.recoveryRootPath);
  const powerShell = realpathSync.native(options.powerShellPath);
  let processIdentityHelper: string | undefined;
  if (options.processIdentityHelperPath !== undefined) {
    if (typeof options.processIdentityHelperPath !== 'string' || !isAbsolute(options.processIdentityHelperPath)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Process identity helper path must be an absolute trusted location');
    }
    try { processIdentityHelper = realpathSync.native(options.processIdentityHelperPath); }
    catch { throw new ProtocolError('INVALID_ARGUMENT', 'Process identity helper is unavailable'); }
    if (!statSync(processIdentityHelper).isFile()
      || basename(processIdentityHelper).toLowerCase() !== 'windowsjobprocesshost.exe') {
      throw new ProtocolError('INVALID_ARGUMENT', 'Process identity helper must be WindowsJobProcessHost.exe');
    }
  }
  const scriptPath = options.helperScriptPath ?? helperPath;
  if (typeof scriptPath !== 'string' || !isAbsolute(scriptPath)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Patch helper path must be an absolute trusted location');
  }
  const script = realpathSync.native(scriptPath);
  if (!statSync(root).isDirectory() || !statSync(recoveryRoot).isDirectory()
    || !statSync(powerShell).isFile() || !statSync(script).isFile()
    || atOrWithin(root, recoveryRoot) || atOrWithin(recoveryRoot, root)
    || atOrWithin(root, powerShell) || atOrWithin(root, script) || atOrWithin(recoveryRoot, script)
    || (processIdentityHelper !== undefined
      && (atOrWithin(root, processIdentityHelper) || atOrWithin(recoveryRoot, processIdentityHelper)))) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Patch apply host paths must be distinct trusted locations');
  }
  // Explicit relocation may use only the reviewed bundled helper, never arbitrary host/model script contents.
  const bundledScript = readFileSync(helperPath);
  const scriptDigest = digest(bundledScript);
  const checkScript = (): void => {
    try {
      const info = lstatSync(scriptPath);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== bundledScript.length
        || realpathSync.native(scriptPath) !== script || digest(readFileSync(script)) !== scriptDigest) {
        throw new Error('changed helper');
      }
    } catch {
      throw new ProtocolError('INVALID_ARGUMENT', 'Patch helper must remain the trusted bundled script');
    }
  };
  checkScript();
  const descriptor: ToolDescriptor = {
    name: WORKSPACE_PATCH_APPLY_TOOL_NAME,
    version: WORKSPACE_PATCH_APPLY_TOOL_VERSION,
    inputSchema: options.preview.descriptor.inputSchema,
    outputSchema: {
      type: 'object',
      required: ['path', 'beforeSha256', 'afterSha256', 'byteLength', 'changed', 'applied'],
      additionalProperties: false,
      properties: {
        path: {type: 'string'},
        beforeSha256: {type: 'string', pattern: '^[a-f0-9]{64}$'},
        afterSha256: {type: 'string', pattern: '^[a-f0-9]{64}$'},
        byteLength: {type: 'integer', minimum: 0},
        changed: {type: 'boolean'},
        applied: {type: 'boolean'},
        recoveryId: {type: 'string'},
      },
    },
    sideEffect: 'local_write',
    requiredScopes: ['workspace:read', 'workspace:write', WORKSPACE_PATCH_APPLY_SCOPE],
    idempotencySupport: false,
    recoverySupport: false,
    requiresPresence: false,
  };

  return {
    descriptor,
    execute: async (input: unknown, context: ToolContext): Promise<WorkspacePatchApplyResult> => {
      check(context, options.now);
      checkScript();
      const preview = await options.preview.execute(input, context) as WorkspacePatchPreviewResult;
      check(context, options.now);
      await checkedSource(root, preview.path);
      const after = Buffer.from(preview.previewText, 'utf8');
      if (digest(after) !== preview.afterSha256) {
        throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch candidate digest changed');
      }
      const result: WorkspacePatchApplyResult = {
        path: preview.path,
        beforeSha256: preview.beforeSha256,
        afterSha256: preview.afterSha256,
        byteLength: after.length,
        changed: preview.changed,
        applied: false,
      };
      if (!preview.changed) return result;
      const recoveryId = `${digest(Buffer.from(`${context.taskId}\n${context.runId}`)).slice(0, 32)}-${randomUUID()}.bak`;
      const sourcePath = resolve(root, ...preview.path.split('/'));
      checkScript();
      // One durable marker per source, not per attempt: an unknown prior helper
      // blocks a second apply until a trusted reconciler confirms its process exited.
      const response = await invokeHelper(powerShell, script, processIdentityHelper, {
        rootPath: root,
        sourcePath,
        backupPath: resolve(recoveryRoot, recoveryId),
        beforeSha256: preview.beforeSha256,
        afterSha256: preview.afterSha256,
        afterBase64: after.toString('base64'),
      }, workspacePatchInflightPathFromCanonical(root, recoveryRoot, preview.path), context, options.now);
      if (response.state === 'conflict') throw new ProtocolError('REVISION_CONFLICT', 'Workspace source changed or is busy');
      if (response.state !== 'applied') throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch apply requires reconciliation');
      result.applied = true;
      if (response.backupRetained) result.recoveryId = recoveryId;
      return result;
    },
  };
}

export {invokeHelper as invokeLockedApplyHelper};
