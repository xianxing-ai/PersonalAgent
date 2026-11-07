import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROFILE = 'huawei_ict_agentarts';
export const PLAN_ID = 'sqlite-packaged-electron-smoke';
export const PLAN_TITLE = 'MOD-19 打包后 Electron SQLite 烟测规划与占位';
const PLACEHOLDER_RELATIVE_PATH = 'tests/manual/release/windows-electron-sqlite.json';

/**
 * 必需环境声明（依据 docs/modules/MOD-19-PACKAGED-SQLITE-SMOKE-PLAN-20261107.md §1/§3）
 */
export const REQUIRED_ENVIRONMENTS = ['windows_real_machine'];

/**
 * 验收证据要求声明（依据 docs/modules/MOD-19-PACKAGED-SQLITE-SMOKE-PLAN-20261107.md §2.2/§3）
 */
export const EVIDENCE_REQUIREMENTS = [
  'tests/manual/release/windows-electron-sqlite.json 验收占位文件保持 pending/unverified 无篡改',
  '打包后 Electron 主进程 SQLite 建库、WAL 模式、读写事务与重启读回独立回执',
];

/**
 * 挂起原因声明（依据 docs/modules/MOD-19-PACKAGED-SQLITE-SMOKE-PLAN-20261107.md §1）
 */
export const PENDING_REASON = '待真机环境执行打包后 Electron SQLite 烟测';

const REQUIRED_CHECKLIST_KEYWORDS = [
  'node:sqlite',
  '建库',
  'WAL',
  '读写',
  '重启读回',
];

const DEFAULT_CHECKLIST = Object.freeze([
  '在打包后的 Electron 主进程环境中加载内置 node:sqlite 模块',
  '在隔离 userData 目录下创建 SQLite 数据库并执行 schema 建库与迁移',
  '配置并验证 WAL 模式（PRAGMA journal_mode=WAL）与忙超时（PRAGMA busy_timeout）生效',
  '执行基础数据写入与事务读写验证（Task/State 表写入与查询）',
  '正常关闭数据库连接以确保 WAL 检查点与文件落盘',
  '重启打包后的应用主进程实例，执行重启读回与数据一致性验证',
]);

function normalizeRelative(value) {
  return value.split(path.sep).join('/');
}

function isSafeRelative(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\0')) {
    return false;
  }
  if (path.posix.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return normalized !== '..' && !normalized.startsWith('../');
}

function resolveContainedPath(root, relativePath) {
  if (!isSafeRelative(relativePath)) {
    return { status: 'invalid' };
  }
  const absolute = path.resolve(root, relativePath);
  const back = path.relative(root, absolute);
  if (back === '..' || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) {
    return { status: 'invalid' };
  }
  try {
    const realRoot = fs.realpathSync(root);
    const realTarget = fs.realpathSync(absolute);
    const rel = path.relative(realRoot, realTarget);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      return { status: 'invalid' };
    }
    return { status: 'ok', absolute: realTarget };
  } catch (error) {
    if (error && typeof error === 'object' && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return { status: 'missing' };
    }
    return { status: 'invalid' };
  }
}

function readJsonFile(root, relativePath) {
  const resolved = resolveContainedPath(root, relativePath);
  if (resolved.status !== 'ok') {
    return resolved;
  }
  try {
    const raw = fs.readFileSync(resolved.absolute, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 'invalid', raw };
    }
    return { status: 'ok', value: parsed, raw };
  } catch {
    return { status: 'invalid' };
  }
}

function findPackagedArtifact(projectRoot, customPath) {
  if (customPath) {
    if (typeof customPath !== 'string' || customPath.trim().length === 0) {
      return { exists: false, path: null };
    }
    const resolved = path.isAbsolute(customPath) ? customPath : path.resolve(projectRoot, customPath);
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        const rel = path.relative(projectRoot, resolved);
        return {
          exists: true,
          path: normalizeRelative(rel),
          absolute: resolved,
        };
      }
    } catch {
      // ignore
    }
    return { exists: false, path: customPath };
  }

  const candidateRelativePaths = [
    'apps/desktop/dist/win-unpacked/personal-agent.exe',
    'apps/desktop/dist/win-unpacked/PersonalAgent.exe',
  ];

  for (const candidate of candidateRelativePaths) {
    const resolved = resolveContainedPath(projectRoot, candidate);
    if (resolved.status === 'ok') {
      try {
        if (fs.statSync(resolved.absolute).isFile()) {
          return { exists: true, path: candidate, absolute: resolved.absolute };
        }
      } catch {}
    }
  }

  return { exists: false, path: null };
}

/**
 * 纯静态规划器：规划打包后的 Electron SQLite 烟测。
 * 绝不执行 Electron 进程（有假路径也不执行）。
 * 在非 Windows 或无安装包产物时输出 { ready: false, reason: 'unavailable', pending: true }。
 */
export function planPackagedSqliteSmoke(options = {}) {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const platform = options.platform ?? process.platform;
  const customArtifact = options.artifactPath ?? null;

  const artifactInfo = findPackagedArtifact(projectRoot, customArtifact);

  const basePlan = {
    schemaVersion: 1,
    profile: PROFILE,
    planId: PLAN_ID,
    title: PLAN_TITLE,
    status: 'unavailable',
    closedLoop: false,
    requiredEnvironments: REQUIRED_ENVIRONMENTS,
    evidenceRequirements: EVIDENCE_REQUIREMENTS,
    reason: 'unavailable',
    pending: true,
    executed: false,
    verified: false,
    evidenceLevel: 'unverified',
    checklist: DEFAULT_CHECKLIST,
  };

  if (platform !== 'win32') {
    return Object.freeze({
      ...basePlan,
      ready: false,
      platform,
      artifact: artifactInfo.exists ? artifactInfo.path : null,
      notes: '非 Windows 环境无法执行 Windows 打包后 Electron SQLite 烟测；当前输出静态规划，明确不可当作已验收。即使提供路径也不执行 Electron。',
    });
  }

  if (!artifactInfo.exists) {
    return Object.freeze({
      ...basePlan,
      ready: false,
      platform,
      artifact: null,
      notes: 'Windows 环境未检测到打包后的 Electron 安装产物（.exe 或 win-unpacked 目录）；当前仅为静态规划，明确不可当作已验收。',
    });
  }

  return Object.freeze({
    ...basePlan,
    ready: true,
    reason: 'planned_manual_acceptance_required',
    platform,
    artifact: artifactInfo.path,
    notes: '已发现 Windows 打包产物，静态规划就绪；本规划器绝不执行 Electron 进程，仍须人工在真实 Windows 主机隔离环境中执行并读回验收证据。',
  });
}

/**
 * 校验静态规划与占位文件的完整性。
 */
export function checkPackagedSqliteSmokePlan(options = {}) {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const checks = [];
  const errors = [];

  const placeholder = readJsonFile(projectRoot, PLACEHOLDER_RELATIVE_PATH);
  if (placeholder.status !== 'ok') {
    checks.push({ id: 'placeholder-file', status: 'fail', code: 'PLACEHOLDER_MISSING_OR_INVALID' });
    errors.push(`Placeholder file ${PLACEHOLDER_RELATIVE_PATH} is missing or invalid JSON`);
  } else {
    checks.push({ id: 'placeholder-file', status: 'pass', code: 'PLACEHOLDER_FILE_PARSED' });
    const data = placeholder.value;

    const isPending = data.status === 'pending';
    if (isPending) {
      checks.push({ id: 'placeholder-status', status: 'pass', code: 'STATUS_PENDING' });
    } else {
      checks.push({ id: 'placeholder-status', status: 'fail', code: 'STATUS_NOT_PENDING' });
      errors.push(`Expected status=pending, got status=${data.status}`);
    }

    const unexecuted = data.executed === false;
    if (unexecuted) {
      checks.push({ id: 'placeholder-unexecuted', status: 'pass', code: 'EXECUTED_FALSE' });
    } else {
      checks.push({ id: 'placeholder-unexecuted', status: 'fail', code: 'EXECUTED_NOT_FALSE' });
      errors.push(`Expected executed=false, got executed=${data.executed}`);
    }

    const unverified = data.evidenceLevel === 'unverified' && data.verified === false;
    if (unverified) {
      checks.push({ id: 'placeholder-unverified', status: 'pass', code: 'EVIDENCE_UNVERIFIED' });
    } else {
      checks.push({ id: 'placeholder-unverified', status: 'fail', code: 'EVIDENCE_NOT_UNVERIFIED' });
      errors.push(`Expected evidenceLevel=unverified and verified=false`);
    }

    // 绝对禁止写成 passed
    const rawText = placeholder.raw ?? '';
    const containsPassedWord = /"status"\s*:\s*"passed"/i.test(rawText) || /"verified"\s*:\s*true/i.test(rawText);
    if (!containsPassedWord) {
      checks.push({ id: 'placeholder-no-passed', status: 'pass', code: 'NO_PASSED_FLAG' });
    } else {
      checks.push({ id: 'placeholder-no-passed', status: 'fail', code: 'ILLEGAL_PASSED_CLAIM' });
      errors.push('Placeholder must NEVER declare passed or verified=true');
    }

    // checklist 须写明在打包后的 Electron 主进程做建库/WAL/读写/重启读回
    const checklist = Array.isArray(data.checklist) ? data.checklist : [];
    const checklistText = checklist.join(' ');
    const missingKeywords = REQUIRED_CHECKLIST_KEYWORDS.filter(
      (keyword) => !checklistText.includes(keyword),
    );

    if (missingKeywords.length === 0) {
      checks.push({ id: 'checklist-completeness', status: 'pass', code: 'CHECKLIST_KEYWORDS_PRESENT' });
    } else {
      checks.push({ id: 'checklist-completeness', status: 'fail', code: 'CHECKLIST_KEYWORDS_MISSING' });
      errors.push(`Checklist is missing required keywords: ${missingKeywords.join(', ')}`);
    }
  }

  // 验证规划器在非 Windows 或无产物时的纯静态行为
  const nonWinPlan = planPackagedSqliteSmoke({ platform: 'linux', projectRoot });
  if (nonWinPlan.ready === false && nonWinPlan.reason === 'unavailable' && nonWinPlan.pending === true) {
    checks.push({ id: 'plan-non-windows-unavailable', status: 'pass', code: 'PLAN_UNAVAILABLE_CORRECT' });
  } else {
    checks.push({ id: 'plan-non-windows-unavailable', status: 'fail', code: 'PLAN_UNAVAILABLE_INVALID' });
    errors.push('planPackagedSqliteSmoke on non-Windows must return ready:false, reason:"unavailable", pending:true');
  }

  const ok = errors.length === 0;

  return Object.freeze({
    schemaVersion: 1,
    profile: PROFILE,
    ok,
    summary: Object.freeze({
      pass: checks.filter((c) => c.status === 'pass').length,
      fail: checks.filter((c) => c.status === 'fail').length,
    }),
    checks: Object.freeze(checks),
    errors: Object.freeze(errors),
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const args = process.argv.slice(2);
  const isCheck = args.includes('--check');

  let projectRoot = process.cwd();
  let artifactPath = null;
  let rootSet = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') {
      continue;
    }
    if (arg === '--project-root' && i + 1 < args.length) {
      projectRoot = args[++i];
      rootSet = true;
    } else if (arg.startsWith('--project-root=')) {
      projectRoot = arg.slice('--project-root='.length);
      rootSet = true;
    } else if (arg === '--artifact' && i + 1 < args.length) {
      artifactPath = args[++i];
    } else if (arg.startsWith('--artifact=')) {
      artifactPath = arg.slice('--artifact='.length);
    } else if (!arg.startsWith('--') && !rootSet) {
      projectRoot = arg;
      rootSet = true;
    }
  }

  if (isCheck) {
    const report = checkPackagedSqliteSmokePlan({ projectRoot });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) {
      process.exit(1);
    }
    process.exit(0);
  }

  const plan = planPackagedSqliteSmoke({ projectRoot, artifactPath });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  // exit 非 0 表示“不可当作已验收”
  process.exit(1);
}
