import {execFile} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const safeText = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

export function normalizeRepositories(input) {
  if (input === undefined || input === null) return ['*'];
  const rawList = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\s,;\n\r]+/)
      : (() => { throw Error('仓库范围格式无效'); })();
  const normalized = [];
  const seen = new Set();
  for (const item of rawList) {
    if (typeof item !== 'string') throw Error('仓库范围格式无效');
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed === '*') return ['*'];
    if (!REPO_PATTERN.test(trimmed)) {
      throw Error(`仓库格式无效：${trimmed}（应为 owner/repo 或 *）`);
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }
  return normalized.length ? normalized : ['*'];
}

function validSaved(value) {
  if (!value || typeof value !== 'object') return false;
  if (!UUID_PATTERN.test(value.accountRef ?? '') || !UUID_PATTERN.test(value.secretRef ?? '')) return false;
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) return false;
  if (!['pat', 'gh_cli'].includes(value.authMode)) return false;
  if (!safeText(value.login ?? '', 120)) return false;
  if (!safeText(value.token, 4096) || !value.token) return false;
  try {
    const repos = normalizeRepositories(value.repositories);
    return Array.isArray(value.repositories) && repos.length === value.repositories.length;
  } catch {
    return false;
  }
}

async function verifyGitHubToken(token, fetchImpl) {
  let response;
  try {
    response = await fetchImpl('https://api.github.com/user', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'PersonalAgent-GitHubConnector/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw Error('无法连接 GitHub API 验证凭据，请检查网络后重试');
  }
  if (response.status === 401) throw Error('GitHub Token 无效或已过期，请检查后重试');
  if (response.status === 403) throw Error('GitHub Token 权限受限或触发速率限制，请检查权限范围');
  if (!response.ok) throw Error(`GitHub 验证失败（HTTP ${response.status}）`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Error('GitHub 返回了无效响应');
  }
  if (!payload || typeof payload.login !== 'string' || !payload.login) {
    throw Error('未能从 GitHub 获取登录账号名');
  }
  return payload.login;
}

/** Main-process only. Encrypts GitHub tokens with OS safeStorage and never leaks credentials in snapshots. */
export function createGitHubConfig({
  userData,
  safeStorage,
  question,
  execFileImpl = execFileAsync,
  fetchImpl = globalThis.fetch,
}) {
  const target = path.join(userData, 'github-config.json');
  let saved, failure = '';

  if (existsSync(target)) {
    try {
      const raw = readFileSync(target);
      if (raw.length > 32_768 || !safeStorage.isEncryptionAvailable()) throw Error();
      const stored = JSON.parse(raw.toString('utf8'));
      if (stored.version !== 1 || typeof stored.encrypted !== 'string') throw Error();
      const value = JSON.parse(safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64')));
      if (!validSaved(value)) throw Error();
      saved = value;
    } catch {
      failure = 'GitHub 加密配置无法读取，原文件已保留，请重新保存';
    }
  }

  const snapshot = () => ({
    configured: Boolean(saved),
    authMode: saved?.authMode ?? 'pat',
    login: saved?.login ?? '',
    repositories: saved ? [...saved.repositories] : ['*'],
    hasCredentials: Boolean(saved?.token),
    status: failure ? 'unavailable' : saved ? 'enabled' : 'unconfigured',
    reason: failure || (saved
      ? `已连接 GitHub 账号 @${saved.login || 'authenticated'}（范围：${saved.repositories.includes('*') ? '全部有权限仓库' : saved.repositories.join(', ')}）；具体读写仍受任务授权卡控制`
      : '请连接 GitHub（可一键导入本机 gh 登录状态，或粘贴 GitHub PAT）；连接器工具在对话中受最小权限与确认门控约束'),
  });

  const authorizationResource = () => saved
    ? createHash('sha256').update(JSON.stringify({
      kind: 'github-connector',
      accountRef: saved.accountRef,
      secretRef: saved.secretRef,
      revision: saved.revision,
      repositories: saved.repositories,
    })).digest('hex')
    : undefined;

  const rotateAuthorization = () => {
    const resource = authorizationResource();
    if (question && resource) {
      const previous = question.readResourceGeneration(resource);
      question.rotateResourceGeneration(resource, previous);
    }
  };

  const requireBinding = binding => {
    if (!saved || !binding || binding.accountRef !== saved.accountRef
      || binding.secretRef !== saved.secretRef || binding.revision !== saved.revision) {
      throw Error('GitHub 配置已变更或撤销');
    }
  };

  const persist = next => {
    if (!safeStorage.isEncryptionAvailable()) throw Error('当前系统安全存储不可用，无法保存 GitHub Token');
    mkdirSync(path.dirname(target), {recursive: true});
    const encrypted = safeStorage.encryptString(JSON.stringify(next)).toString('base64');
    const tmp = `${target}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify({version: 1, encrypted}));
    renameSync(tmp, target);
    rotateAuthorization();
    saved = next;
    failure = '';
  };

  const configure = async (input, {verify = true} = {}) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['token', 'repositories', 'authMode', 'login'].includes(key))) {
      throw Error('GitHub 配置参数不受支持');
    }
    const rawToken = typeof input.token === 'string' ? input.token.trim() : '';
    const token = rawToken || saved?.token || '';
    if (!safeText(token, 4096) || !token || /\s/.test(token)) {
      throw Error('请填写有效的 GitHub Token，或先使用本机 gh CLI 登录');
    }
    const authMode = input.authMode === 'gh_cli' ? 'gh_cli' : (rawToken ? 'pat' : (saved?.authMode ?? 'pat'));
    const repositories = input.repositories !== undefined
      ? normalizeRepositories(input.repositories)
      : (saved?.repositories ?? ['*']);
    let login = typeof input.login === 'string' && safeText(input.login, 120) ? input.login.trim() : '';
    if (verify) {
      login = await verifyGitHubToken(token, fetchImpl);
    } else if (!login && !rawToken && saved?.login) {
      login = saved.login;
    }
    const next = {
      accountRef: saved?.accountRef ?? randomUUID(),
      secretRef: rawToken ? randomUUID() : (saved?.secretRef ?? randomUUID()),
      revision: (saved?.revision ?? 0) + 1,
      authMode,
      login,
      repositories,
      token,
    };
    if (!validSaved(next)) throw Error('GitHub 配置无效');
    persist(next);
    return snapshot();
  };

  const detectLocalGh = async (input = {}) => {
    const importToken = input?.importToken === true;
    const repositories = input?.repositories;
    let tokenResult;
    try {
      tokenResult = await execFileImpl('gh', ['auth', 'token', '--hostname', 'github.com'], {
        timeout: 5000,
        windowsHide: true,
        maxBuffer: 64 * 1024,
      });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {installed: false, authenticated: false, login: '', message: '未检测到本机 gh CLI，请粘贴 GitHub Personal Access Token'};
      }
      return {installed: true, authenticated: false, login: '', message: '本机 gh CLI 尚未登录（可运行 gh auth login，或直接粘贴 Token）'};
    }
    const token = typeof tokenResult?.stdout === 'string' ? tokenResult.stdout.trim() : '';
    if (!token || /\s/.test(token)) {
      return {installed: true, authenticated: false, login: '', message: '未能从本机 gh CLI 读取有效凭据，请运行 gh auth login 或粘贴 Token'};
    }
    const login = await verifyGitHubToken(token, fetchImpl);
    if (!importToken) {
      return {installed: true, authenticated: true, login, message: `检测到本机 gh 已登录 @${login}`};
    }
    const nextSnapshot = await configure({token, authMode: 'gh_cli', login, ...(repositories === undefined ? {} : {repositories})}, {verify: false});
    return {installed: true, authenticated: true, login, snapshot: nextSnapshot};
  };

  const revoke = () => {
    rotateAuthorization();
    saved = undefined;
    failure = '';
    if (existsSync(target)) unlinkSync(target);
    return snapshot();
  };

  return Object.freeze({
    snapshot,
    authorizationResource,
    binding: () => saved ? {
      accountRef: saved.accountRef,
      secretRef: saved.secretRef,
      revision: saved.revision,
      authMode: saved.authMode,
      login: saved.login,
      repositories: [...saved.repositories],
    } : undefined,
    readToken(binding) {
      requireBinding(binding);
      return saved.token;
    },
    configure,
    detectLocalGh,
    revoke,
  });
}
