import {spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {lstatSync, readFileSync, realpathSync, statSync} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative, sep, win32} from 'node:path';
import type {SandboxExecutionResult, TrustedSandboxBinding, TrustedSandboxExecutionRequest,
  TrustedSandboxExecutor, WindowsNativeSandboxExecutorOptions} from './native-sandbox.js';

const shaPattern = /^[a-f0-9]{64}$/u;
const envName = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const secretName = /(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH)/iu;
const maxDuration = 120_000;
const hashFile = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
/** Capture only after the host has selected/built this trusted installed helper; not an authorization decision. */
export function readWindowsNativeHelperAttestation(helperPath: string): Pick<WindowsNativeSandboxExecutorOptions, 'helperPath' | 'helperSha256' | 'helperFilesSha256'> {
  const helper = canonical(helperPath, false);
  if (basename(helper) !== 'WindowsJobProcessHost.exe') throw Error('invalid-helper');
  const names = ['WindowsJobProcessHost.dll', 'WindowsJobProcessHost.deps.json', 'WindowsJobProcessHost.runtimeconfig.json'];
  return {helperPath: helper, helperSha256: hashFile(helper), helperFilesSha256: Object.fromEntries(
    names.map(name => [name, hashFile(canonical(join(dirname(helper), name), false))]))};
}
const inside = (root: string, path: string): boolean => {
  const tail = relative(root, path);
  return tail === '' || (tail !== '..' && !tail.startsWith(`..${sep}`) && !isAbsolute(tail));
};
const failure = (request: TrustedSandboxExecutionRequest, reason: string): SandboxExecutionResult => ({
  backend: request.profile?.backend === 'none' ? 'none' : 'windows-psec', enforced: false, outcome: 'unavailable',
  exitCode: null, signal: null, stdout: '', stderr: '', executionStarted: false, stopped: true, sideEffects: 'none', reason,
});

/** Reject links/reparse aliases at every supplied path component, including ancestors. */
function canonical(path: string, directory: boolean): string {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || path.startsWith('\\\\')
    || path.includes(':', 2) || path.length > 32760) throw Error('invalid-path');
  const resolved = realpathSync.native(path);
  if (win32.normalize(resolved).toLowerCase() !== win32.normalize(path).toLowerCase()) throw Error('path-alias');
  let current = resolved;
  for (;;) {
    const entry = lstatSync(current);
    if (entry.isSymbolicLink()) throw Error('path-reparse');
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const entry = statSync(resolved);
  if (directory ? !entry.isDirectory() : !entry.isFile()) throw Error('path-kind');
  return resolved;
}

function checkedRequest(request: TrustedSandboxExecutionRequest, now: number): TrustedSandboxExecutionRequest {
  const profile = request.profile;
  if (!profile || !['read-only', 'workspace-write', 'full-access'].includes(profile.mode)
    || profile.sandboxRef !== request.sandboxRef || profile.revision !== request.revision
    || !Number.isSafeInteger(profile.revision) || profile.revision < 1
    || ![request.sandboxRef, request.taskId, request.runId, request.authorizationRef].every(v => typeof v === 'string' && v.length > 0 && v.length <= 256)
    || !shaPattern.test(request.argumentsDigest) || !Number.isSafeInteger(request.maxOutputBytes)
    || request.maxOutputBytes < 1 || request.maxOutputBytes > 262144) throw Error('invalid-binding');
  const remaining = Date.parse(request.deadline) - now;
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > maxDuration) throw Error('invalid-deadline');
  const full = profile.mode === 'full-access';
  if (full ? profile.backend !== 'none' || profile.network.mode !== 'unrestricted'
    : profile.backend !== 'windows-psec' || profile.network.mode !== 'deny') throw Error('unsupported-policy');
  if (!Array.isArray(profile.readRoots) || !Array.isArray(profile.writeRoots) || !Array.isArray(profile.executableAllowlist)
    || profile.readRoots.length > 64 || profile.writeRoots.length > 32 || profile.executableAllowlist.length > 32
    || (profile.mode === 'read-only' && profile.writeRoots.length !== 0)
    || (profile.mode === 'workspace-write' && profile.writeRoots.length === 0)) throw Error('invalid-roots');
  const readRoots = profile.readRoots.map(path => canonical(path, true));
  const writeRoots = profile.writeRoots.map(path => canonical(path, true));
  if ([...readRoots,...writeRoots].some(root => dirname(root) === root)) throw Error('volume-root-grant');
  // PSEC gives read-only restrictions precedence. Ambiguous overlapping grants are not silently widened.
  if (readRoots.some(read => writeRoots.some(write => inside(read, write) || inside(write, read)))) throw Error('overlapping-grants');
  const cwd = canonical(request.cwd, true), executable = canonical(request.executable, false);
  const executableAllowlist = profile.executableAllowlist.map(path => canonical(path, false));
  if (!executableAllowlist.some(path => path.toLowerCase() === executable.toLowerCase())
    || (!full && ![...readRoots, ...writeRoots].some(root => inside(root, cwd)))
    || writeRoots.some(root => inside(root, executable))) throw Error('scope-mismatch');
  if (!Array.isArray(request.argv) || request.argv.length > 128
    || request.argv.some(arg => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0'))
    || request.argv.reduce((sum, arg) => sum + arg.length + 3, executable.length) > 30000) throw Error('invalid-arguments');
  if (!request.env || typeof request.env !== 'object' || Array.isArray(request.env)) throw Error('invalid-environment');
  const env: Record<string, string> = {};
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(request.env)) {
    if (keys.size >= 64 || !envName.test(key) || secretName.test(key) || keys.has(key.toUpperCase())
      || typeof value !== 'string' || value.length > 4096 || value.includes('\0')) throw Error('invalid-environment');
    keys.add(key.toUpperCase()); env[key] = value;
  }
  // Explicit environment only. PSEC requires both names; never retry with a null/inherited block.
  if (!full && (!keys.has('SYSTEMROOT') || !keys.has('LOCALAPPDATA'))) throw Error('missing-platform-environment');
  return {...request, argv: [...request.argv], env, profile: {...profile, network: {...profile.network}, readRoots, writeRoots, executableAllowlist}, cwd, executable};
}

function bind(request: TrustedSandboxExecutionRequest): TrustedSandboxBinding {
  return {sandboxRef: request.sandboxRef, revision: request.revision, taskId: request.taskId, runId: request.runId,
    authorizationRef: request.authorizationRef, argumentsDigest: request.argumentsDigest, deadline: request.deadline};
}

/** Native boundary plus JobObject lifecycle. No constrained-to-plain-spawn fallback. */
export function createWindowsNativeSandboxExecutor(options: WindowsNativeSandboxExecutorOptions): TrustedSandboxExecutor {
  const pins = {...options.helperFilesSha256};
  const helperPath = options.helperPath, helperSha256 = options.helperSha256, assertCurrent = options.assertCurrent;
  const now = options.now ?? Date.now;
  return {async execute(raw): Promise<SandboxExecutionResult> {
    if (process.platform !== 'win32') return failure(raw, 'unsupported-platform');
    let request: TrustedSandboxExecutionRequest, helper: string;
    let identities: {path: string; dev: bigint; ino: bigint}[];
    try {
      request = checkedRequest(raw, now());
      if (request.signal.aborted) return {...failure(request, 'cancelled-before-start'), outcome: 'cancelled'};
      helper = canonical(helperPath, false);
      if (basename(helper) !== 'WindowsJobProcessHost.exe' || !shaPattern.test(helperSha256)
        || hashFile(helper) !== helperSha256) throw Error('helper-integrity');
      const required = ['WindowsJobProcessHost.dll', 'WindowsJobProcessHost.deps.json', 'WindowsJobProcessHost.runtimeconfig.json'];
      for (const name of required) {
        const pin = pins[name];
        if (!pin || !shaPattern.test(pin) || hashFile(canonical(join(dirname(helper), name), false)) !== pin) throw Error('helper-integrity');
      }
      if (request.profile.writeRoots.some(root => inside(root, helper) || inside(root, dirname(helper)))) throw Error('helper-writable');
      identities = [...request.profile.readRoots, ...request.profile.writeRoots, request.cwd, request.executable, helper].map(path => {
        const stat = statSync(path, {bigint: true}); return {path, dev: stat.dev, ino: stat.ino};
      });
      await assertCurrent(bind(request));
      checkedRequest(request, now());
    } catch { return failure(raw, 'invalid-or-unavailable-trusted-configuration'); }
    return new Promise(resolve => {
      let child: ReturnType<typeof spawn>;
      const nonce = randomBytes(32).toString('hex');
      let result: SandboxExecutionResult | undefined, ready = false, go = false, closed = false, protocolError = false;
      let pending = '', captured = 0, stdout = '', stderr = '';
      const chunks: {stdout: Buffer[]; stderr: Buffer[]} = {stdout: [], stderr: []};
      let stopTimer: ReturnType<typeof setTimeout> | undefined;
      const deadline = Date.parse(request.deadline);
      const unknown = (): SandboxExecutionResult => ({...failure(request, 'native-stop-or-protocol-unconfirmed'), outcome: go ? 'unknown' : 'unavailable',
        executionStarted: go, stopped: false, sideEffects: go ? 'unknown' : 'none', stdout, stderr});
      const finish = (value: SandboxExecutionResult): void => {
        if (closed) return;
        closed = true; clearTimeout(timer); if (stopTimer) clearTimeout(stopTimer);
        request.signal.removeEventListener('abort', cancel); resolve(value);
      };
      const stop = (): void => {
        if (closed) return;
        child.stdin?.write(`STOP ${nonce}\n`, () => {});
        if (!stopTimer) stopTimer = setTimeout(() => {
          // Closing the helper closes its JobObject; absence of trusted stop readback stays unknown.
          child.kill(); finish(unknown());
        }, 4500);
      };
      const cancel = (): void => stop();
      const consume = async (frame: Record<string, unknown>): Promise<void> => {
        if (frame.nonce !== nonce || typeof frame.type !== 'string') throw Error('invalid-frame');
        if (frame.type === 'ready') {
          if (ready || result || frame.backend !== request.profile.backend || frame.enforced !== (request.profile.mode !== 'full-access')
            || frame.appContainer !== (request.profile.mode !== 'full-access')) throw Error('invalid-ready');
          ready = true;
          try {
            await assertCurrent(bind(request));
            checkedRequest(request, now());
            for (const identity of identities) {
              const stat = statSync(identity.path, {bigint: true});
              if (stat.dev !== identity.dev || stat.ino !== identity.ino) throw Error('path-identity-changed');
            }
          } catch { stop(); return; }
          if (request.signal.aborted || now() >= deadline || protocolError || closed) { stop(); return; }
          // Helper holds the target suspended and has not inherited this control pipe.
          go = true; child.stdin?.write(`GO ${nonce}\n`);
        } else if (frame.type === 'data') {
          if (!go || result || (frame.stream !== 'stdout' && frame.stream !== 'stderr') || typeof frame.data !== 'string'
            || !/^[A-Za-z0-9+/]*={0,2}$/u.test(frame.data) || frame.data.length > 5464) throw Error('invalid-data');
          const data = Buffer.from(frame.data, 'base64'); captured += data.length;
          if (captured > request.maxOutputBytes) { protocolError = true; stop(); return; }
          chunks[frame.stream].push(data);
        } else if (frame.type === 'result') {
          if (result || !['exited', 'cancelled', 'timeout', 'unknown', 'unavailable'].includes(String(frame.outcome))
            || frame.backend !== request.profile.backend || typeof frame.executionStarted !== 'boolean' || typeof frame.stopped !== 'boolean'
            || typeof frame.enforced !== 'boolean' || (frame.exitCode !== null && !Number.isSafeInteger(frame.exitCode))
            || !['none', 'possible', 'unknown'].includes(String(frame.sideEffects))) throw Error('invalid-result');
          if (frame.executionStarted && !go) throw Error('unauthorized-start');
          const decoder = new TextDecoder('utf-8', {fatal: true});
          stdout = decoder.decode(Buffer.concat(chunks.stdout)); stderr = decoder.decode(Buffer.concat(chunks.stderr));
          result = {backend: request.profile.backend, enforced: frame.enforced && ready && go,
            outcome: frame.outcome as SandboxExecutionResult['outcome'], exitCode: frame.exitCode as number | null,
            signal: null, stdout, stderr, executionStarted: frame.executionStarted, stopped: frame.stopped,
            sideEffects: frame.sideEffects as SandboxExecutionResult['sideEffects'],
            ...(typeof frame.stage === 'string' ? {reason: `native-${frame.stage}:${String(frame.win32 ?? frame.hresult ?? 'unknown')}`} : {})};
        } else throw Error('unknown-frame');
      };
      let queue = Promise.resolve();
      try {
        child = spawn(helper, ['--sandbox-launch'], {env: {}, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe']});
      } catch { resolve(failure(request, 'helper-start-failed')); return; }
      const timer = setTimeout(stop, Math.max(1, deadline - now()));
      request.signal.addEventListener('abort', cancel, {once: true});
      child.stdin?.on('error', () => {});
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (data: string) => {
        pending += data;
        for (;;) {
          const end = pending.indexOf('\n'); if (end < 0) break;
          const line = pending.slice(0, end); pending = pending.slice(end + 1);
          queue = queue.then(() => consume(JSON.parse(line) as Record<string, unknown>)).catch(() => { protocolError = true; stop(); });
        }
        if (pending.length > 8192) { protocolError = true; stop(); }
      });
      child.stderr?.on('data', () => { protocolError = true; stop(); });
      child.once('error', () => finish(failure(request, 'helper-start-failed')));
      child.once('close', () => { void queue.then(() => {
        if (!result || protocolError || pending.trim()) finish(unknown());
        else if (!result.stopped && result.executionStarted) finish({...result, outcome: 'unknown', sideEffects: 'unknown'});
        else if (request.signal.aborted && result.executionStarted) finish({...result, outcome: 'cancelled'});
        else if (now() >= deadline && result.executionStarted) finish({...result, outcome: 'timeout'});
        else finish(result);
      }); });
      child.stdin?.write(JSON.stringify({Nonce: nonce, Mode: request.profile.mode, ReadRoots: request.profile.readRoots,
        WriteRoots: request.profile.writeRoots, Executable: request.executable, Argv: request.argv, Env: request.env,
        Cwd: request.cwd, Deadline: request.deadline, MaxOutputBytes: request.maxOutputBytes}) + '\n');
      if (request.signal.aborted) stop();
    });
  }};
}
