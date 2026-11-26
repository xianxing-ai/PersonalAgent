#!/usr/bin/env node
/** Headless executor. One job in, one receipt out. It is not a scheduler. */
import {createHmac, createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync, openSync, closeSync, fsyncSync, renameSync, statSync} from 'node:fs';
import {arch as osArch, freemem, hostname, loadavg, platform as osPlatform, totalmem, uptime as osUptime} from 'node:os';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describeRepoTaskExecutor} from './local-repo-executor.mjs';
import {forwardCloudPersistentJob} from './cloud-runtime-transport.mjs';

export const RUNNER_VERSION = '1.2.0';
const MODEL_COMMAND_FILE = process.env.RUNNER_MODEL_COMMAND_FILE || '/etc/personal-agent-runner/model-command.json';
const VPS_CONTROL_FILE = process.env.RUNNER_VPS_CONTROL_FILE || '/etc/personal-agent-runner/vps-control.json';
const KINDS = new Set(['developer-duty', 'async-subagent', 'repo-task', 'cloud-persistent', 'vps-ops', 'heartbeat', 'status', 'cancel']);
const MARKER = '<!-- personal-agent:duty-status -->';

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function signJob(message, token) {
  const {signature: _ignored, ...body} = message;
  return createHmac('sha256', token).update(canonical(body)).digest('hex');
}

export function verifyJob(message, token) {
  if (!message || message.v !== 1 || typeof message.signature !== 'string' || !/^[a-f0-9]{64}$/.test(message.signature)) return false;
  const expected = signJob(message, token);
  const left = Buffer.from(message.signature, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function redact(value, secrets = []) {
  const patterns = secrets.filter(item => typeof item === 'string' && item.length >= 6);
  const walk = item => {
    if (typeof item === 'string') {
      let text = item;
      for (const secret of patterns) text = text.split(secret).join('[redacted]');
      return text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-key]')
        .replace(/ghp_[A-Za-z0-9]+/g, '[redacted-token]')
        .replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted-token]');
    }
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === 'object') {
      const copy = {};
      for (const [key, inner] of Object.entries(item)) {
        if (/token|privateKey|secret|authorization/i.test(key)) continue;
        copy[key] = walk(inner);
      }
      return copy;
    }
    return item;
  };
  return walk(value);
}

function emptyState() {return {version: 1, jobs: {}, cursors: {}, comments: {}, recent: []};}

export function loadRunnerState(file) {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    if (state?.version !== 1 || !state.jobs || typeof state.jobs !== 'object' || Array.isArray(state.jobs)
      || !state.cursors || !state.comments || !Array.isArray(state.recent)) throw new Error('Invalid runner state');
    return state;
  } catch (error) {if (error.code === 'ENOENT') return emptyState(); throw error;}
}

export function saveRunnerState(file, state) {
  mkdirSync(dirname(file), {recursive: true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {writeFileSync(fd, JSON.stringify(redact(state))); fsyncSync(fd);}
  finally {closeSync(fd);}
  renameSync(temporary, file);
  // The service runs on Linux; persist the rename as well as the file contents.
  if (process.platform !== 'win32') {
    const directory = openSync(dirname(file), 'r');
    try {fsyncSync(directory);} finally {closeSync(directory);}
  }
}

function receipt(message, extra) {
  return redact({v: 1, jobId: message.id, idempotencyKey: message.idempotencyKey, kind: message.kind, ...extra}, [message.payload?.githubToken]);
}

async function runDuty(state, message, fetchImpl) {
  const payload = message.payload ?? {};
  if (payload.action === 'merge') return receipt(message, {state: 'failed', error: 'merge is forbidden by default', mergeInvoked: false});
  if (!payload.repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(payload.repo)) return receipt(message, {state: 'failed', error: 'repository is invalid'});
  if (payload.action === 'comment') {
    const key = `${payload.repo}#${payload.number}`;
    const previous = state.comments[key];
    if (previous?.outcome === 'unknown') {
      const seen = payload.existing === 'unknown' ? 'unknown' : payload.existing;
      if (seen === 'unknown' || !Array.isArray(seen) || !seen.some(item => String(item.body).includes(MARKER))) {
        return receipt(message, {state: 'unknown', comment: previous, redo: false});
      }
    }
    const body = `${MARKER}\n${String(payload.body ?? '').trim()}`;
    const existing = Array.isArray(payload.existing) ? payload.existing : [];
    const marked = existing.filter(item => String(item.body).includes(MARKER));
    if (marked.length > 1) return receipt(message, {state: 'unknown', error: 'more than one status comment', redo: false});
    const commentId = marked[0]?.id;
    state.comments[key] = {outcome: payload.writeState === 'unknown' ? 'unknown' : 'confirmed', commentId, body};
    if (payload.writeState === 'unknown') return receipt(message, {state: 'unknown', comment: state.comments[key], redo: false});
    return receipt(message, {state: 'succeeded', comment: state.comments[key], redo: false});
  }
  const page = payload.page ?? await fetchEvents(payload, fetchImpl);
  if (!page || page.gap || page.connected === false || page.rateLimited) {
    return receipt(message, {state: 'succeeded', noChange: false, cursor: state.cursors[payload.repo], gap: true});
  }
  const current = state.cursors[payload.repo];
  if (current && page.previousDeliveryId && page.previousDeliveryId !== current.deliveryId) {
    return receipt(message, {state: 'succeeded', noChange: false, gap: true, cursor: current});
  }
  if (page.events?.length && page.next?.deliveryId) {
    state.cursors[payload.repo] = {repo: payload.repo, deliveryId: page.next.deliveryId, basedOnDeliveryId: current?.deliveryId};
  }
  return receipt(message, {state: 'succeeded', noChange: !page.events?.length, gap: false, cursor: state.cursors[payload.repo], events: page.events ?? []});
}

async function fetchEvents(payload, fetchImpl) {
  if (payload.page) return payload.page;
  if (!payload.githubToken || typeof fetchImpl !== 'function') return {connected: false, gap: true, events: []};
  const response = await fetchImpl(`https://api.github.com/repos/${payload.repo}/events?per_page=20`, {
    headers: {Authorization: `Bearer ${payload.githubToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'personal-agent-runner'}});
  if (!response.ok) return {connected: false, gap: true, rateLimited: response.status === 403 || response.status === 429, events: []};
  const body = await response.json();
  const events = Array.isArray(body) ? body.slice(0, 20).map(item => ({id: String(item.id), deliveryId: String(item.id), type: 'pull_request', repo: payload.repo, receivedAt: item.created_at})) : [];
  return {connected: true, gap: false, events, previousDeliveryId: payload.cursor?.deliveryId, next: events.at(-1) ? {deliveryId: events.at(-1).deliveryId} : undefined};
}

export function readModelCommand(file = MODEL_COMMAND_FILE) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || !Array.isArray(parsed.command) || parsed.command.length === 0 || parsed.command.length > 16) return undefined;
    if (!parsed.command.every(part => typeof part === 'string' && part.length > 0 && part.length <= 200 && !/[\r\n\u0000]/.test(part))) return undefined;
    const timeoutMs = Number.isInteger(parsed.timeoutMs) && parsed.timeoutMs >= 1000 && parsed.timeoutMs <= 600_000 ? parsed.timeoutMs : 120_000;
    return {command: parsed.command, timeoutMs};
  } catch { return undefined; }
}

function runnerEnvironment(extra = {}) {
  const env = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'USER', 'TMPDIR']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

function runArgv(command, opts = {}, spawnImpl) {
  const [executable, ...args] = command;
  const timeoutMs = Number.isInteger(opts.timeoutMs) && opts.timeoutMs >= 100 ? opts.timeoutMs : 30_000;
  if (typeof spawnImpl === 'function') {
    return spawnImpl({command, input: opts.input ?? '', cwd: opts.cwd, timeoutMs, envExtra: opts.envExtra});
  }
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(executable, args, {
      shell: false,
      env: runnerEnvironment(opts.envExtra),
      ...(opts.cwd ? {cwd: opts.cwd} : {}),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const finish = result => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({code: null, stdout, stderr, timedOut: true}); }, timeoutMs);
    child.stdout?.on('data', chunk => { stdout = (stdout + chunk).slice(0, 8000); });
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(0, 4000); });
    child.on('error', error => finish({code: 127, stdout, stderr: error instanceof Error ? error.message : 'command failed', timedOut: false}));
    child.on('close', code => finish({code, stdout, stderr, timedOut: false}));
    child.stdin?.end(opts.input ?? '');
  });
}

function runCommand(configured, input, spawnImpl) {
  return runArgv(configured.command, {input, timeoutMs: configured.timeoutMs}, spawnImpl);
}

/** Fail-closed VPS/cloud-desktop control policy installed explicitly on authorized runner hosts. */
export function readVpsControlPolicy(file = VPS_CONTROL_FILE) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || parsed.enabled !== true) return undefined;
    const allowedExecutables = Array.isArray(parsed.allowedExecutables)
      ? parsed.allowedExecutables.filter(part => typeof part === 'string' && part.length > 0 && part.length <= 128 && !/[\s\r\n\u0000]/u.test(part) && !part.includes('..'))
      : [];
    const container = typeof parsed.desktopContainer === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(parsed.desktopContainer)
      ? parsed.desktopContainer : 'personal-agent-webtop';
    const webtopHttpPort = Number.isInteger(parsed.webtopHttpPort) && parsed.webtopHttpPort >= 1 && parsed.webtopHttpPort <= 65535
      ? parsed.webtopHttpPort : 3000;
    const webtopHttpsPort = Number.isInteger(parsed.webtopHttpsPort) && parsed.webtopHttpsPort >= 1 && parsed.webtopHttpsPort <= 65535
      ? parsed.webtopHttpsPort : 3001;
    const maxTimeoutMs = Number.isInteger(parsed.maxTimeoutMs) && parsed.maxTimeoutMs >= 1000 && parsed.maxTimeoutMs <= 120_000
      ? parsed.maxTimeoutMs : 60_000;
    return {
      enabled: true,
      allowExec: parsed.allowExec === true,
      allowDesktop: parsed.allowDesktop === true,
      allowedExecutables,
      desktopContainer: container,
      webtopHttpPort,
      webtopHttpsPort,
      maxTimeoutMs,
    };
  } catch { return undefined; }
}

function validateSafeArgv(command, policy) {
  if (!Array.isArray(command) || command.length < 1 || command.length > 32) {
    return {error: 'command must be an array of 1..32 strings'};
  }
  if (!command.every(part => typeof part === 'string' && part.length > 0 && part.length <= 1000 && !part.includes('\u0000'))) {
    return {error: 'command arguments contain empty or invalid strings'};
  }
  const executable = command[0];
  if (/[\r\n\s]/u.test(executable) || executable.includes('..')) {
    return {error: 'executable path is invalid'};
  }
  if (!policy.allowedExecutables.includes(executable)) {
    return {error: `executable "${executable}" is not in allowedExecutables`};
  }
  return {command};
}

function validateSafeCwd(cwd) {
  if (cwd === undefined) return {cwd: undefined};
  if (typeof cwd !== 'string' || !cwd.startsWith('/') || cwd.length > 512 || /[\r\n\u0000]/u.test(cwd) || cwd.split('/').includes('..')) {
    return {error: 'cwd must be a safe absolute Linux path'};
  }
  return {cwd};
}

async function inspectDesktopContainer(container, spawnImpl) {
  const result = await runArgv(['docker', 'inspect', '-f', '{{.State.Status}}', container], {timeoutMs: 5000}, spawnImpl);
  const rawStatus = String(result.stdout || '').trim();
  if (result.code === 0 && rawStatus) return {status: rawStatus, available: true};
  const err = String(result.stderr || '').trim();
  if (result.code === 127 || /enoent|not found/i.test(err)) return {status: 'docker_unavailable', available: false, detail: err.slice(0, 200)};
  if (/no such (?:object|container)/i.test(err)) return {status: 'not_installed', available: false};
  return {status: 'unknown', available: false, detail: err.slice(0, 200)};
}

async function runVpsOps(message, options) {
  const payload = message.payload ?? {};
  const action = String(payload.action || 'status');
  const policy = options.vpsControlPolicy === undefined ? readVpsControlPolicy(options.vpsControlFile) : (options.vpsControlPolicy || undefined);
  const secrets = [message.payload?.githubToken];

  if (action === 'status') {
    const desktop = policy?.enabled && policy.allowDesktop
      ? {...await inspectDesktopContainer(policy.desktopContainer, options.spawnImpl), container: policy.desktopContainer,
        httpPort: policy.webtopHttpPort, httpsPort: policy.webtopHttpsPort}
      : {status: policy?.enabled ? 'disabled' : 'unconfigured', available: false};
    const hostInfo = {
      hostname: hostname(),
      platform: osPlatform(),
      arch: osArch(),
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(osUptime()),
      loadavg: loadavg(),
      memoryTotalMb: Math.round(totalmem() / (1024 * 1024)),
      memoryFreeMb: Math.round(freemem() / (1024 * 1024)),
    };
    return receipt(message, redact({
      state: 'succeeded',
      verification: 'executed',
      redo: false,
      vpsControlEnabled: Boolean(policy?.enabled),
      allowExec: Boolean(policy?.allowExec),
      allowDesktop: Boolean(policy?.allowDesktop),
      host: hostInfo,
      desktop,
      summary: `VPS ${hostInfo.hostname} (${hostInfo.arch}) 运行中；云桌面状态：${desktop.status}`,
    }, secrets));
  }

  if (!policy?.enabled) {
    return receipt(message, {
      state: 'failed',
      needsConfig: true,
      verification: 'needs-config',
      redo: false,
      error: 'vps control is not enabled on this host',
      summary: '远端 VPS 尚未启用受控操作，请在 VPS 运行 install-cloud-desktop.sh 并配置 /etc/personal-agent-runner/vps-control.json。',
    });
  }

  const remaining = message.deadline === undefined ? policy.maxTimeoutMs : Date.parse(message.deadline) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return receipt(message, {state: 'rejected', error: 'deadline', redo: false});
  }
  const requestedTimeout = Number.isInteger(payload.timeoutMs) && payload.timeoutMs >= 1000 ? payload.timeoutMs : policy.maxTimeoutMs;
  const timeoutMs = Math.max(1000, Math.min(policy.maxTimeoutMs, requestedTimeout, remaining));

  if (action === 'exec') {
    if (!policy.allowExec) {
      return receipt(message, {state: 'failed', needsConfig: true, verification: 'needs-config', redo: false,
        error: 'vps control exec is disabled', summary: '该 VPS 主机的 vps-control.json 未开启 allowExec。'});
    }
    const target = payload.target === undefined ? 'host' : String(payload.target);
    if (target !== 'host' && target !== 'desktop') {
      return receipt(message, {state: 'failed', redo: false, error: 'target must be host or desktop'});
    }
    if (target === 'desktop' && !policy.allowDesktop) {
      return receipt(message, {state: 'failed', needsConfig: true, verification: 'needs-config', redo: false,
        error: 'vps desktop target is disabled', summary: '该 VPS 主机未开启云桌面控制。'});
    }
    const checkCmd = validateSafeArgv(payload.command, policy);
    if (checkCmd.error) return receipt(message, {state: 'failed', redo: false, error: checkCmd.error});
    const checkCwd = validateSafeCwd(payload.cwd);
    if (checkCwd.error) return receipt(message, {state: 'failed', redo: false, error: checkCwd.error});
    const execArgs = target === 'desktop'
      ? ['docker', 'exec', '-e', 'DISPLAY=:1', ...(checkCwd.cwd ? ['-w', checkCwd.cwd] : []), policy.desktopContainer, ...checkCmd.command]
      : checkCmd.command;
    const result = await runArgv(execArgs, {cwd: target === 'host' ? checkCwd.cwd : undefined, timeoutMs}, options.spawnImpl);
    const stdout = String(result.stdout || '').trim().slice(0, 6000);
    const stderr = String(result.stderr || '').trim().slice(0, 2000);
    const summary = (stdout || stderr || (result.timedOut ? 'VPS command timed out' : `exit ${result.code}`)).slice(0, 4000);
    if (result.timedOut) {
      return receipt(message, redact({state: 'unknown', needsConfig: false, verification: 'executed', redo: false,
        exitCode: null, stdout, stderr, error: 'vps command timed out', summary}, secrets));
    }
    if (result.code !== 0) {
      return receipt(message, redact({state: 'failed', needsConfig: false, verification: 'executed', redo: false,
        exitCode: result.code, stdout, stderr, error: summary, summary}, secrets));
    }
    return receipt(message, redact({state: 'succeeded', needsConfig: false, verification: 'executed', redo: false,
      exitCode: 0, stdout, stderr, summary: stdout || 'VPS 命令执行成功（无输出）'}, secrets));
  }

  if (action === 'desktop') {
    if (!policy.allowDesktop) {
      return receipt(message, {state: 'failed', needsConfig: true, verification: 'needs-config', redo: false,
        error: 'vps desktop control is disabled', summary: '该 VPS 主机的 vps-control.json 未开启 allowDesktop。'});
    }
    const desktopAction = String(payload.desktopAction || '');
    if (desktopAction === 'status') {
      const inspected = await inspectDesktopContainer(policy.desktopContainer, options.spawnImpl);
      return receipt(message, redact({
        state: 'succeeded',
        verification: 'executed',
        redo: false,
        desktop: {...inspected, container: policy.desktopContainer, httpPort: policy.webtopHttpPort, httpsPort: policy.webtopHttpsPort},
        summary: `云桌面容器 ${policy.desktopContainer} 状态：${inspected.status}`,
      }, secrets));
    }
    if (desktopAction === 'start' || desktopAction === 'stop' || desktopAction === 'restart') {
      const result = await runArgv(['docker', desktopAction, policy.desktopContainer], {timeoutMs}, options.spawnImpl);
      if (result.timedOut) {
        return receipt(message, redact({state: 'unknown', verification: 'executed', redo: false,
          error: `docker ${desktopAction} timed out`, summary: '云桌面容器操作超时，状态未知'}, secrets));
      }
      if (result.code !== 0) {
        const err = String(result.stderr || result.stdout || '').trim().slice(0, 1000);
        return receipt(message, redact({state: 'failed', verification: 'executed', redo: false,
          exitCode: result.code, error: err || `docker ${desktopAction} failed`, summary: err || `容器 ${desktopAction} 失败`}, secrets));
      }
      const inspected = await inspectDesktopContainer(policy.desktopContainer, options.spawnImpl);
      return receipt(message, redact({
        state: 'succeeded',
        verification: 'executed',
        redo: false,
        desktop: {...inspected, container: policy.desktopContainer, httpPort: policy.webtopHttpPort, httpsPort: policy.webtopHttpsPort},
        summary: `云桌面容器 ${policy.desktopContainer} 已执行 ${desktopAction}，当前状态：${inspected.status}`,
      }, secrets));
    }
    if (desktopAction === 'open_url') {
      const rawUrl = typeof payload.url === 'string' ? payload.url.trim() : '';
      if (!rawUrl || rawUrl.length > 2048 || /[\r\n\u0000]/u.test(rawUrl)) {
        return receipt(message, {state: 'failed', redo: false, error: 'url is invalid'});
      }
      let parsedUrl;
      try { parsedUrl = new URL(rawUrl); } catch { return receipt(message, {state: 'failed', redo: false, error: 'url is invalid'}); }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return receipt(message, {state: 'failed', redo: false, error: 'only http and https URLs are allowed'});
      }
      const result = await runArgv(['docker', 'exec', '-e', 'DISPLAY=:1', policy.desktopContainer, 'xdg-open', rawUrl], {timeoutMs}, options.spawnImpl);
      if (result.timedOut) return receipt(message, {state: 'unknown', verification: 'executed', redo: false, error: 'open_url timed out'});
      if (result.code !== 0) {
        const err = String(result.stderr || result.stdout || '').trim().slice(0, 1000);
        return receipt(message, redact({state: 'failed', verification: 'executed', redo: false, error: err || `exit ${result.code}`}, secrets));
      }
      return receipt(message, redact({state: 'succeeded', verification: 'executed', redo: false,
        summary: `已在云桌面内打开网址 ${rawUrl}`}, secrets));
    }
    if (desktopAction === 'exec') {
      const checkCmd = validateSafeArgv(payload.command, policy);
      if (checkCmd.error) return receipt(message, {state: 'failed', redo: false, error: checkCmd.error});
      const checkCwd = validateSafeCwd(payload.cwd);
      if (checkCwd.error) return receipt(message, {state: 'failed', redo: false, error: checkCwd.error});
      const result = await runArgv(
        ['docker', 'exec', '-e', 'DISPLAY=:1', ...(checkCwd.cwd ? ['-w', checkCwd.cwd] : []), policy.desktopContainer, ...checkCmd.command],
        {timeoutMs}, options.spawnImpl);
      const stdout = String(result.stdout || '').trim().slice(0, 6000);
      const stderr = String(result.stderr || '').trim().slice(0, 2000);
      if (result.timedOut) return receipt(message, redact({state: 'unknown', verification: 'executed', redo: false, stdout, stderr, error: 'desktop exec timed out'}, secrets));
      if (result.code !== 0) return receipt(message, redact({state: 'failed', verification: 'executed', redo: false, exitCode: result.code, stdout, stderr, error: stderr || stdout || `exit ${result.code}`}, secrets));
      return receipt(message, redact({state: 'succeeded', verification: 'executed', redo: false, exitCode: 0, stdout, stderr, summary: stdout || '云桌面命令执行成功'}, secrets));
    }
    return receipt(message, {state: 'failed', redo: false, error: 'desktopAction is not supported'});
  }

  return receipt(message, {state: 'failed', redo: false, error: 'vps-ops action is not supported'});
}

async function runSubagent(message, options) {
  if (message.payload?.command) return receipt(message, {state: 'failed', error: 'the job cannot choose its own command', redo: false, needsConfig: false});
  const configured = options.modelCommand === undefined ? readModelCommand(options.modelCommandFile) : options.modelCommand || undefined;
  if (!configured?.command?.length) {
    return receipt(message, {state: 'failed', needsConfig: true, verification: 'needs-config', redo: false,
      error: 'model command is not configured', summary: '远端主机没有配置模型命令，子任务没有执行。'});
  }
  const goal = String(message.payload?.goal ?? '').slice(0, 8000);
  const remaining = message.deadline === undefined ? configured.timeoutMs : Date.parse(message.deadline) - Date.now();
  if (remaining <= 0) return receipt(message, {state: 'rejected', error: 'deadline', redo: false});
  const result = await runCommand({...configured, timeoutMs: Math.min(configured.timeoutMs, remaining)}, goal, options.spawnImpl);
  const summary = String(result.stdout || result.stderr || '').trim().slice(0, 4000);
  if (result.timedOut) return receipt(message, {state: 'unknown', needsConfig: false, verification: 'executed', redo: false, error: 'model command timed out', summary: summary || 'model command timed out'});
  if (result.code !== 0) return receipt(message, {state: 'failed', needsConfig: false, verification: 'executed', redo: false, error: summary || `model command exited ${result.code}`, summary: summary || `model command exited ${result.code}`});
  return receipt(message, {state: 'succeeded', needsConfig: false, verification: 'executed', summary: summary || '远端模型命令没有输出'});
}

export function createConcurrencyGate(maxConcurrent) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 32) throw new Error('maxConcurrent is invalid');
  let active = 0;
  const waiters = [];
  return {maxConcurrent, snapshot: () => ({active, waiting: waiters.length, maxConcurrent}),
    async run(work) {
      if (active >= maxConcurrent) await new Promise(resolve => waiters.push(resolve));
      active += 1;
      try {return await work();}
      finally {active -= 1; waiters.shift()?.();}
    }};
}

async function runRepoTask(message, options) {
  const payload = message.payload ?? {};
  if (payload.command) return receipt(message, {state: 'failed', error: 'the job cannot choose its own command', redo: false});
  if (!payload.repo || !/^[0-9a-f]{40}$/i.test(String(payload.baseSha ?? '')) || typeof payload.branch !== 'string' || !Array.isArray(payload.recipeIds)) {
    return receipt(message, {state: 'failed', error: 'repo-task payload is invalid', redo: false, evidenceLevel: 'fixture'});
  }
  if (typeof options.executeRepoTask !== 'function') {
    const described = describeRepoTaskExecutor(options.repoExecutor);
    return receipt(message, {state: 'failed', needsConfig: true, verification: 'needs-config', redo: false, evidenceLevel: 'fixture',
      error: 'repo task executor is not configured', summary: described.summary, steps: described.steps});
  }
  let heartbeats = 0;
  const heartbeat = () => {heartbeats += 1; options.onHeartbeat?.(message.id);};
  const work = () => options.executeRepoTask({repo: payload.repo, baseSha: payload.baseSha, branch: payload.branch, recipeIds: payload.recipeIds, heartbeat, deadline: message.deadline});
  const result = await (options.concurrencyGate ? options.concurrencyGate.run(work) : work());
  return receipt(message, {state: result?.ok === false ? 'failed' : 'succeeded', needsConfig: false, verification: 'executed', redo: false,
    evidenceLevel: result?.evidenceLevel ?? 'fixture', diffSummary: result?.diffSummary ?? '', testReport: result?.testReport ?? '',
    artifactSummary: result?.artifactSummary ?? '', heartbeats, leaseExtended: heartbeats > 0,
    summary: result?.summary || '仓库任务已在执行器工作区回传'});
}

export async function handleRunnerJob(state, message, options = {}) {
  const token = options.token ?? '';
  const now = options.now ? options.now() : Date.now();
  if (!verifyJob(message, token)) return {v: 1, state: 'rejected', error: 'signature', jobId: message?.id};
  if (!KINDS.has(message.kind) || typeof message.idempotencyKey !== 'string' || typeof message.id !== 'string') {
    return {v: 1, state: 'rejected', error: 'kind', jobId: message.id};
  }
  if (message.payload?.action === 'merge') return receipt(message, {state: 'failed', error: 'merge is forbidden by default', mergeInvoked: false});
  const limit = Number.isInteger(options.maxJobsPerMinute) ? options.maxJobsPerMinute : 30;
  state.recent = (state.recent ?? []).filter(at => now - at < 60_000);
  if (message.kind !== 'heartbeat' && message.kind !== 'status' && state.recent.length >= limit) {
    return receipt(message, {state: 'rejected', error: 'rate_limited'});
  }
  if (message.kind === 'heartbeat') return receipt(message, {state: 'succeeded', heartbeatAt: new Date(now).toISOString()});
  const saved = state.jobs[message.idempotencyKey];
  if (message.kind === 'status' || message.kind === 'cancel') {
    // A cancellation request cannot prove that an already dispatched command stopped.
    return receipt(message, {state: saved?.state === 'leased' ? 'unknown' : saved?.state ?? 'absent', prior: saved?.receipt, redo: false});
  }
  const requestDigest = createHash('sha256').update(canonical({kind: message.kind, payload: message.payload})).digest('hex');
  if (saved) {
    if (saved.requestDigest !== requestDigest) return receipt(message, {state: 'rejected', error: 'original job binding differs or is unavailable', redo: false});
    return saved.receipt ?? receipt(message, {state: 'unknown', error: 'original job has no terminal receipt', redo: false});
  }
  if (message.deadline !== undefined && (!Number.isFinite(Date.parse(message.deadline)) || now >= Date.parse(message.deadline))) {
    return receipt(message, {state: 'rejected', error: 'deadline', redo: false});
  }
  state.recent.push(now);
  state.jobs[message.idempotencyKey] = {jobId: message.id, requestDigest, state: 'unknown', kind: message.kind,
    receipt: receipt(message, {state: 'unknown', error: 'job has been admitted; execution result is unknown', redo: false})};
  // The production file host persists this reservation before any external operation.
  options.persist?.(state);
  try {
    const result = message.kind === 'cloud-persistent' ? receipt(message, await forwardCloudPersistentJob(message, {socketPath: options.cloudRuntimeSocketPath}))
      : message.kind === 'developer-duty' ? await runDuty(state, message, options.fetchImpl)
      : message.kind === 'repo-task' ? await runRepoTask(message, options)
      : message.kind === 'vps-ops' ? await runVpsOps(message, options)
      : await runSubagent(message, options);
    const terminal = result.state;
    state.jobs[message.idempotencyKey] = {jobId: message.id, requestDigest, state: terminal, kind: message.kind, receipt: result};
    options.persist?.(state);
    return result;
  } catch (error) {
    const failed = receipt(message, {state: 'unknown', error: 'runner exception', redo: false});
    state.jobs[message.idempotencyKey] = {jobId: message.id, requestDigest, state: 'unknown', kind: message.kind, receipt: failed};
    options.persist?.(state);
    return failed;
  }
}

/** One file owner at a time, including independent SSH processes. Never expire a crashed writer's lock. */
export async function handleRunnerFileJob(file, message, options = {}) {
  if (!verifyJob(message, options.token ?? '')) return {v: 1, state: 'rejected', error: 'signature', jobId: message?.id};
  mkdirSync(dirname(file), {recursive: true});
  const lock = `${file}.lock`;
  let fd;
  try {fd = openSync(lock, 'wx', 0o600);}
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const saved = loadRunnerState(file).jobs[message.idempotencyKey];
    // Read-only status remains available. An unowned/stale lock is never permission to execute.
    if (message.kind === 'status' || message.kind === 'cancel') {
      return receipt(message, {state: saved?.state === 'leased' ? 'unknown' : saved?.state ?? 'absent', prior: saved?.receipt, redo: false});
    }
    if (saved) {
      const digest = createHash('sha256').update(canonical({kind: message.kind, payload: message.payload})).digest('hex');
      if (saved.requestDigest !== digest) return receipt(message, {state: 'rejected', error: 'original job binding differs or is unavailable', redo: false});
      return saved.receipt ?? receipt(message, {state: 'unknown', error: 'original job has no terminal receipt', redo: false});
    }
    return receipt(message, {state: 'rejected', error: 'runner state is locked; this job was not dispatched', redo: false});
  }
  try {
    const state = loadRunnerState(file);
    return await handleRunnerJob(state, message, {...options, persist: next => saveRunnerState(file, next)});
  } finally {closeSync(fd); unlinkSync(lock);}
}

export function fingerprintHostKey(hostKey) {
  return createHash('sha256').update(hostKey).digest('hex');
}

async function serve(file, token) {
  const root = dirname(file);
  const inbox = `${root}/inbox`;
  const outbox = `${root}/outbox`;
  mkdirSync(inbox, {recursive: true});
  mkdirSync(outbox, {recursive: true});
  for (;;) {
    for (const name of readdirSync(inbox).filter(item => item.endsWith('.json')).sort()) {
      const message = JSON.parse(readFileSync(`${inbox}/${name}`, 'utf8'));
      const result = await handleRunnerFileJob(file, message, {token, maxJobsPerMinute: Number(process.env.RUNNER_MAX_PER_MINUTE || 30), modelCommandFile: MODEL_COMMAND_FILE, vpsControlFile: VPS_CONTROL_FILE});
      writeFileSync(`${outbox}/${name}`, JSON.stringify(result), {mode: 0o600});
      unlinkSync(`${inbox}/${name}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function main() {
  if (process.argv.includes('--verify')) {
    process.stdout.write(`personal-agent-runner ${RUNNER_VERSION}\n`);
    return;
  }
  const file = process.env.RUNNER_STATE || '/var/lib/personal-agent-runner/state.json';
  // A non-interactive SSH command does not inherit systemd's EnvironmentFile.
  // Read only the existing fixed host credential file; never accept a path/token from a job.
  let token = process.env.RUNNER_TOKEN;
  if(!token){
    const credentialFile=process.env.RUNNER_TOKEN_FILE||'/etc/personal-agent-runner/token';
    const stat=statSync(credentialFile);
    if(!stat.isFile()||process.platform!=='win32'&&(stat.mode&0o007)!==0)throw Error('Runner credential file is not private');
    const value=readFileSync(credentialFile,'utf8').trim(),match=/^RUNNER_TOKEN=([^\s]+)$/u.exec(value);
    if(!match)throw Error('Runner credential file is unavailable');token=match[1];
  }
  if (process.argv.includes('--serve')) return serve(file, token);
  const raw = readFileSync(0, 'utf8');
  const message = JSON.parse(raw);
  const result = await handleRunnerFileJob(file, message, {token, maxJobsPerMinute: Number(process.env.RUNNER_MAX_PER_MINUTE || 30), modelCommandFile: MODEL_COMMAND_FILE, vpsControlFile: VPS_CONTROL_FILE});
  process.stdout.write(JSON.stringify(result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stderr.write('runner failed\n');
    process.exitCode = 1;
  });
}
