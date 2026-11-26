import {spawn as defaultSpawn, execFile as defaultExecFile, execFileSync as defaultExecFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {promisify} from 'node:util';

const execFileAsync = promisify(defaultExecFile);
let cachedWindowsSid;

function synchronousGuard(result){
  if(result===undefined)return;
  void Promise.resolve(result).catch(()=>{});
  throw Object.assign(new Error('Remote send guard must be synchronous'),{code:'UNAUTHORIZED'});
}

function getWindowsCurrentPrincipal(execFileSyncImpl = defaultExecFileSync) {
  if (cachedWindowsSid) return cachedWindowsSid;
  try {
    const out = execFileSyncImpl('whoami', ['/user', '/fo', 'csv', '/nh'], {encoding: 'utf8', windowsHide: true, timeout: 5000});
    const match = /S-1-[0-9-]+/u.exec(String(out || ''));
    if (match) {
      cachedWindowsSid = `*${match[0]}`;
      return cachedWindowsSid;
    }
  } catch { /* Fall back to current USERNAME only when SID query is unavailable. */ }
  const username = process.env.USERNAME;
  if (typeof username === 'string' && /^[A-Za-z0-9._-]+$/u.test(username)) {
    cachedWindowsSid = username;
    return cachedWindowsSid;
  }
  throw Object.assign(new Error('无法识别当前 Windows 用户权限主体，拒绝写入 SSH 私钥'), {code: 'UNSUPPORTED_CAPABILITY'});
}

/** Tighten NTFS ACL on Windows so OpenSSH ssh.exe does not reject temp key files with inherited permissions. */
export function secureWindowsSshPath(targetPath, {isDirectory = false, execFileSync = defaultExecFileSync} = {}) {
  if (process.platform !== 'win32') return;
  const principal = getWindowsCurrentPrincipal(execFileSync);
  const grant = isDirectory ? `${principal}:(OI)(CI)F` : `${principal}:F`;
  execFileSync('icacls', [targetPath, '/inheritance:r', '/grant:r', grant], {encoding: 'utf8', windowsHide: true, timeout: 5000});
}

function redactSshSecrets(text, secrets = []) {
  let clean = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 6) clean = clean.split(secret).join('[redacted]');
  }
  return clean
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-key]')
    .replace(/ghp_[A-Za-z0-9]+/g, '[redacted-token]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted-token]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted-token]');
}

function summarizeSshFailure(code, stderr, secrets = []) {
  const sanitized = redactSshSecrets(stderr, secrets).replace(/\r/g, '').trim().slice(0, 600);
  let hint = '';
  if (/permission denied|publickey|authentication failed/i.test(sanitized)) {
    hint = 'SSH 认证被拒绝（请检查私钥、用户名与远端 authorized_keys）';
  } else if (/host key verification failed|remote host identification has changed|offending key/i.test(sanitized)) {
    hint = 'SSH 主机公钥指纹不匹配（请重新探测并确认主机指纹）';
  } else if (/permissions .* are too open|unprotected private key/i.test(sanitized)) {
    hint = 'SSH 私钥权限过宽被 OpenSSH 拒绝';
  } else if (/node:\s*(?:not found|command not found)|no such file or directory/i.test(sanitized)) {
    hint = '远端缺少 node 或 /opt/personal-agent-runner/remote-runner-service.mjs（请先运行安装脚本）';
  } else if (/connection refused|timed out|no route to host|could not resolve hostname|name or service not known/i.test(sanitized)) {
    hint = '无法连接 VPS SSH 端口（请检查公网 IP、端口、安全组与 sshd）';
  }
  const suffix = sanitized ? ` | ${sanitized.replace(/\n+/g, ' / ').slice(0, 280)}` : '';
  return {
    message: `SSH transport failed (exit ${code}${hint ? `: ${hint}` : ''})${suffix}`,
    sanitized,
    hint,
  };
}

/** Probe an SSH server host key via ssh-keyscan and compute its pinned SHA-256 fingerprint. */
export async function probeHostKey({address, port = 22, timeoutMs = 8000, execFile} = {}) {
  if (typeof address !== 'string') throw Object.assign(new Error('主机地址格式无效'), {code: 'INVALID_ARGUMENT'});
  let cleanAddress = address.trim();
  if (cleanAddress.startsWith('[') && cleanAddress.endsWith(']')) cleanAddress = cleanAddress.slice(1, -1);
  if (!cleanAddress || cleanAddress.length > 253 || cleanAddress.startsWith('-') || !/^[A-Za-z0-9.:_-]+$/u.test(cleanAddress)) {
    throw Object.assign(new Error('主机地址包含非法字符或格式无效'), {code: 'INVALID_ARGUMENT'});
  }
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw Object.assign(new Error('SSH 端口必须是 1 到 65535 的整数'), {code: 'INVALID_ARGUMENT'});
  }
  const timeoutSec = Math.max(2, Math.min(30, Math.ceil((Number.isFinite(timeoutMs) ? timeoutMs : 8000) / 1000)));
  const runExec = typeof execFile === 'function' ? execFile : execFileAsync;
  let result;
  try {
    result = await runExec('ssh-keyscan', ['-T', String(timeoutSec), '-t', 'ed25519,ecdsa,rsa', '-p', String(numericPort), cleanAddress],
      {encoding: 'utf8', timeout: timeoutSec * 1000 + 2000, maxBuffer: 64 * 1024, windowsHide: true});
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw Object.assign(new Error('本机未找到 ssh-keyscan 命令，请确认已启用 Windows OpenSSH 客户端'), {code: 'UNSUPPORTED_CAPABILITY'});
    }
    const detail = redactSshSecrets(error?.stderr || error?.message || '').trim().slice(0, 200);
    throw Object.assign(new Error(`探测主机公钥失败${detail ? `：${detail}` : ''}`), {code: 'EXTERNAL_FAILURE'});
  }
  const stdout = String(result?.stdout ?? '');
  const candidates = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/u);
    if (parts.length < 3) continue;
    const [, keyType, keyData] = parts;
    if (!/^(?:ssh-ed25519|ecdsa-sha2-nistp(?:256|384|521)|ssh-rsa)$/u.test(keyType) || !/^[A-Za-z0-9+/=]+$/u.test(keyData)) continue;
    const hostKey = `${keyType} ${keyData}`;
    const hostKeyFingerprint = createHash('sha256').update(hostKey).digest('hex');
    candidates.push({keyType, hostKey, hostKeyFingerprint});
  }
  if (!candidates.length) {
    const errOut = redactSshSecrets(result?.stderr ?? '').trim().slice(0, 200);
    throw Object.assign(new Error(`未能从 ${cleanAddress}:${numericPort} 读取到 SSH 主机公钥${errOut ? `（${errOut}）` : '（请检查 IP、端口和防火墙）'}`), {code: 'EXTERNAL_FAILURE'});
  }
  const priority = type => type === 'ssh-ed25519' ? 0 : type.startsWith('ecdsa-') ? 1 : 2;
  candidates.sort((left, right) => priority(left.keyType) - priority(right.keyType));
  return {
    ok: true,
    address: cleanAddress,
    port: numericPort,
    keyType: candidates[0].keyType,
    hostKey: candidates[0].hostKey,
    hostKeyFingerprint: candidates[0].hostKeyFingerprint,
    candidates,
  };
}

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
  mkdtemp = () => mkdtempSync(join(tmpdir(), 'personal-agent-runner-')), remove = directory => rmSync(directory, {recursive: true, force: true}),
  securePath} = {}) {
  const applyAcl = typeof securePath === 'function'
    ? securePath
    : (target, opts) => { if (existsSync(target)) secureWindowsSshPath(target, opts); };
  return {async connect(host, auth) {
    const directory = mkdtemp();
    const keyPath = join(directory, 'id');
    const knownHosts = join(directory, 'known_hosts');
    try {
      applyAcl(directory, {isDirectory: true});
      writeFile(keyPath, auth.privateKey, {mode: 0o600});
      applyAcl(keyPath, {isDirectory: false});
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
        let stderr = '';
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
        child.stderr?.on('data', chunk => {if (stderr.length < 4096) stderr = (stderr + chunk).slice(0, 4096);});
        child.on('error', error => {
          if (error?.code === 'ENOENT') {
            finish(Object.assign(new Error('本机未找到 OpenSSH ssh 命令，请检查 Windows OpenSSH 客户端'), {code: 'ENOENT'}));
            return;
          }
          finish(error);
        });
        child.stdin?.on('error', error => finish(error));
        child.on('close', code => {
          if (code !== 0) {
            const diag = summarizeSshFailure(code, stderr, [auth.privateKey, auth.runnerToken]);
            finish(Object.assign(new Error(diag.message), {code: 'RESULT_UNKNOWN', exitCode: code, diagnostic: diag.sanitized, hint: diag.hint}));
          } else {
            try {finish(undefined, JSON.parse(stdout));}
            catch {
              const cleanStderr = redactSshSecrets(stderr, [auth.privateKey, auth.runnerToken]).replace(/\s+/g, ' ').trim().slice(0, 200);
              const detail = cleanStderr ? ` (${cleanStderr})` : '';
              finish(Object.assign(new Error(`SSH receipt was not JSON${detail}`), {code: 'RESULT_UNKNOWN'}));
            }
          }
        });
        if (control.signal?.aborted) abort();
        else {
          try {
            if(job.kind!=='heartbeat'&&typeof control.assertBeforeSend!=='function')throw Object.assign(new Error('Original remote payload authorization is unavailable'),{code:'UNAUTHORIZED'});
            synchronousGuard(control.assertBeforeSend?.(job));
            child.stdin?.end(JSON.stringify(job));
          } catch(error) {finish(error);}
        }
      });
    }, close() {if (closed) return; closed = true; active?.kill(); remove(directory);}};
  }};
}

export function createRemoteRunnerDesktopHost({runtimeModule, getRuntime, safeStorage, userData, spawn, egressHost}) {
  const secrets = createRunnerSecretFile({userData, safeStorage});
  const service = runtimeModule.createRemoteRunnerService({getRuntime, secrets, transport: createSshTransport({spawn}),
    async prepareDispatch({host,taskId,message,signal,deadline,assertCurrent}) {
      if(!egressHost)throw Object.assign(new Error('Original remote egress host is unavailable'),{code:'UNSUPPORTED_CAPABILITY'});
      const runtime=getRuntime(),epoch=runtime.readExecutionEpoch(taskId);
      const address=host.address.includes(':')?`[${host.address}]`:host.address;
      const destination=`ssh://${encodeURIComponent(host.user)}@${address}:${host.port}/`,payload=JSON.stringify(message);
      const isCurrent=()=>{assertCurrent();runtime.assertExecutionEpoch(taskId,epoch);return getRuntime()===runtime;};
      const lease=await egressHost.prepare({requestId:'remote-runner:'+message.id,destination,payload,signal,deadline,isCurrent});
      return {assertBeforeSend(){if(!isCurrent())throw Object.assign(new Error('Original Runtime changed'),{code:'UNAUTHORIZED'});
        synchronousGuard(lease.assertBeforeSend({destination,payload}));}};
    },
    localExecute: async () => ({state: 'failed', error: '没有健康的远端执行器，已改为本地记录', verification: 'fixture', location: 'local'})});
  return {tools: service.tools, service, probeHostKey};
}
