import {spawn as defaultSpawn} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';

/** Encrypted secret map. The host record stores only credential refs. */
export function createRunnerSecretFile({userData, safeStorage}) {
  if (!userData || typeof safeStorage?.encryptString !== 'function' || typeof safeStorage.decryptString !== 'function') {
    throw Object.assign(new Error('本机安全存储不可用'), {code: 'UNSUPPORTED_CAPABILITY'});
  }
  const file = join(userData, 'remote-runner-secrets.json');
  let values = {};
  if (existsSync(file)) {
    try {
      const envelope = JSON.parse(readFileSync(file, 'utf8'));
      values = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64')));
    } catch {values = {};}
  }
  function persist() {
    if (!safeStorage.isEncryptionAvailable?.() && safeStorage.isEncryptionAvailable !== undefined) {
      throw Object.assign(new Error('本机安全存储不可用'), {code: 'UNSUPPORTED_CAPABILITY'});
    }
    mkdirSync(userData, {recursive: true});
    const encrypted = safeStorage.encryptString(JSON.stringify(values)).toString('base64');
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({version: 1, encrypted}), {mode: 0o600});
    renameSync(temporary, file);
  }
  return {
    put(ref, secret) {values = {...values, [ref]: secret}; persist();},
    get(ref) {return Object.hasOwn(values, ref) ? values[ref] : undefined;},
    delete(ref) {if (!Object.hasOwn(values, ref)) return; values = {...values}; delete values[ref]; persist();},
  };
}

export function sshArguments(host, keyPath, knownHostsPath) {
  return ['-i', keyPath, '-p', String(host.port), '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${knownHostsPath}`,
    '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', `${host.user}@${host.address}`, 'node', '/opt/personal-agent-runner/remote-runner-service.mjs'];
}

/** Real OpenSSH transport. Tests inject spawn; a missing binary is reported, not replaced with success. */
export function createSshTransport({spawn = defaultSpawn, writeFile = writeFileSync,
  mkdtemp = () => mkdtempSync(join(tmpdir(), 'personal-agent-runner-')), remove = directory => rmSync(directory, {recursive: true, force: true})} = {}) {
  return {async connect(host, auth) {
    const directory = mkdtemp();
    const keyPath = join(directory, 'id');
    const knownHosts = join(directory, 'known_hosts');
    try {
      writeFile(keyPath, auth.privateKey, {mode: 0o600});
      writeFile(knownHosts, `${host.port === 22 ? host.address : `[${host.address}]:${host.port}`} ${auth.hostKey}\n`, {mode: 0o600});
    } catch (error) {remove(directory); throw error;}
    const args = sshArguments(host, keyPath, knownHosts);
    let closed = false;
    let active;
    return {args, async exec(job, control = {}) {
      if (closed) throw new Error('SSH session is closed');
      const deadline = Date.parse(control.deadline ?? job.deadline ?? new Date(Date.now() + 60_000).toISOString());
      if (control.signal?.aborted || !Number.isFinite(deadline) || deadline <= Date.now()) {
        throw Object.assign(new Error('SSH dispatch is no longer active'), {code: 'CANCELLED'});
      }
      return new Promise((resolve, reject) => {
        const child = spawn('ssh', args, {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
        active = child;
        let settled = false;
        let stdout = '';
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          control.signal?.removeEventListener('abort', abort);
          if (error) child.kill();
          active = undefined;
          if (error) reject(error); else resolve(value);
        };
        const abort = () => {
          finish(Object.assign(new Error('SSH result is unknown after cancellation or deadline'), {code: 'RESULT_UNKNOWN'}));
        };
        const timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
        control.signal?.addEventListener('abort', abort, {once: true});
        child.stdout?.on('data', chunk => {stdout += chunk;});
        child.stderr?.resume();
        child.on('error', error => finish(error));
        child.stdin?.on('error', error => finish(error));
        child.on('close', code => {
          if (code !== 0) finish(Object.assign(new Error('SSH transport failed'), {code: 'RESULT_UNKNOWN'}));
          else {
            try {finish(undefined, JSON.parse(stdout));}
            catch {finish(Object.assign(new Error('SSH receipt was not JSON'), {code: 'RESULT_UNKNOWN'}));}
          }
        });
        if (control.signal?.aborted) abort();
        else child.stdin?.end(JSON.stringify(job));
      });
    }, close() {if (closed) return; closed = true; active?.kill(); remove(directory);}};
  }};
}

export function createRemoteRunnerDesktopHost({runtimeModule, getRuntime, safeStorage, userData, spawn}) {
  const secrets = createRunnerSecretFile({userData, safeStorage});
  const service = runtimeModule.createRemoteRunnerService({getRuntime, secrets, transport: createSshTransport({spawn}),
    localExecute: async () => ({state: 'failed', error: '没有健康的远端执行器，已改为本地记录', verification: 'fixture', location: 'local'})});
  return {tools: service.tools, service};
}
