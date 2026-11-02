import {spawn as defaultSpawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync, renameSync} from 'node:fs';
import {join} from 'node:path';
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
export function createSshTransport({spawn = defaultSpawn, writeFile = writeFileSync, mkdtemp} = {}) {
  return {async connect(host, auth) {
    const directory = mkdtemp ? mkdtemp() : `/tmp/personal-agent-runner-${randomUUID()}`;
    const keyPath = `${directory}/id`;
    const knownHosts = `${directory}/known_hosts`;
    writeFile(keyPath, auth.privateKey, {mode: 0o600});
    writeFile(knownHosts, `${host.address} ${auth.hostKey}\n`, {mode: 0o600});
    const args = sshArguments(host, keyPath, knownHosts);
    return {args, async exec(job) {
      return new Promise((resolve, reject) => {
        const child = spawn('ssh', args, {stdio: ['pipe', 'pipe', 'pipe']});
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', chunk => {stdout += chunk;});
        child.stderr?.on('data', chunk => {stderr += chunk;});
        child.on('error', reject);
        child.on('close', code => {
          if (code !== 0) reject(Object.assign(new Error('SSH transport failed'), {code: 'EXTERNAL_FAILURE'}));
          else {
            try {resolve(JSON.parse(stdout));}
            catch {reject(Object.assign(new Error('SSH receipt was not JSON'), {code: 'RESULT_UNKNOWN'}));}
          }
          void stderr;
        });
        child.stdin?.end(JSON.stringify(job));
      });
    }, close() {}};
  }};
}

export function createRemoteRunnerDesktopHost({runtimeModule, getRuntime, safeStorage, userData, spawn}) {
  const secrets = createRunnerSecretFile({userData, safeStorage});
  const service = runtimeModule.createRemoteRunnerService({getRuntime, secrets, transport: createSshTransport({spawn}),
    localExecute: async () => ({state: 'failed', error: '没有健康的远端执行器，已改为本地记录', verification: 'fixture', location: 'local'})});
  return {tools: service.tools, service};
}
