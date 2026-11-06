import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROFILE = 'huawei_ict_agentarts';
const PLAN_ID = 'release-install-upgrade-uninstall';

export const ACCEPTANCE_ITEMS = Object.freeze([
  {
    acceptanceId: 'release-install-start',
    relativePath: 'tests/manual/release/windows-install-start.json',
    target: 'Windows 11 x64 NSIS standalone installer',
    requiredKeywords: Object.freeze(['安装', '快捷方式', '启动', 'userData']),
    defaultChecklist: Object.freeze([
      '执行安装包（无管理员提权要求，asInvoker）',
      '自定义安装路径成功安装',
      '桌面及开始菜单快捷方式正确生成',
      '首次启动正常，主进程正确初始化 userData 目录',
      '打包后 Electron 主进程 SQLite 正常读写',
    ]),
  },
  {
    acceptanceId: 'release-upgrade-data',
    relativePath: 'tests/manual/release/windows-upgrade-data-retention.json',
    target: 'Windows 11 x64 NSIS upgrade across versions',
    requiredKeywords: Object.freeze(['覆盖', 'userData', '保留']),
    defaultChecklist: Object.freeze([
      '预先写入测试版本 userData（含 SQLite 任务表与会话记录）',
      '运行新版本安装程序覆盖安装',
      '启动新版本应用，检查 userData 数据库完好保留',
      '会话历史可正常读回，无数据丢失或表重建',
    ]),
  },
  {
    acceptanceId: 'release-uninstall',
    relativePath: 'tests/manual/release/windows-uninstall.json',
    target: 'Windows 11 x64 NSIS uninstaller',
    requiredKeywords: Object.freeze(['卸载', '移除', 'userData', '保留']),
    defaultChecklist: Object.freeze([
      '通过控制面板/Windows设置或卸载快捷方式触发卸载',
      '安装目录及程序二进制文件被干净移除',
      '桌面及开始菜单快捷方式被干净移除',
      '用户数据（userData，含 SQLite 与凭据）按策略默认保留，不被意外清除',
    ]),
  },
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

function findInstallerArtifact(projectRoot, customPath) {
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
    'apps/desktop/release/PersonalAgent-Setup.exe',
    'apps/desktop/release/PersonalAgent Setup.exe',
    'apps/desktop/dist/PersonalAgent-Setup.exe',
    'apps/desktop/dist/PersonalAgent Setup.exe',
    'release/PersonalAgent-Setup.exe',
    'dist/PersonalAgent-Setup.exe',
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

  for (const dirRel of ['apps/desktop/release', 'apps/desktop/dist', 'release', 'dist']) {
    const dirResolved = resolveContainedPath(projectRoot, dirRel);
    if (dirResolved.status === 'ok') {
      try {
        const stat = fs.statSync(dirResolved.absolute);
        if (stat.isDirectory()) {
          const files = fs.readdirSync(dirResolved.absolute);
          const exeFile = files.find((f) => f.toLowerCase().endsWith('.exe') && !f.toLowerCase().includes('blockmap'));
          if (exeFile) {
            const relPath = `${dirRel}/${exeFile}`;
            const targetAbs = path.join(dirResolved.absolute, exeFile);
            if (fs.statSync(targetAbs).isFile()) {
              return { exists: true, path: relPath, absolute: targetAbs };
            }
          }
        }
      } catch {}
    }
  }

  return { exists: false, path: null };
}

/**
 * 纯静态规划器：规划 Windows 独立安装/启动、覆盖升级数据保留、卸载验收。
 * 绝不拉起安装器或 Electron 进程。
 * 非 Windows、无安装包产物或缺占位文件/占位非法时，固定输出 { ready: false, reason: 'unavailable', pending: true }。
 */
export function planReleaseInstallUpgradeUninstall(options = {}) {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const platform = options.platform ?? process.platform;
  const customArtifact = options.artifactPath ?? null;

  const missingPlaceholders = [];
  const invalidPlaceholders = [];
  const items = [];

  for (const item of ACCEPTANCE_ITEMS) {
    const placeholder = readJsonFile(projectRoot, item.relativePath);
    if (placeholder.status !== 'ok') {
      missingPlaceholders.push(item.relativePath);
      items.push({
        id: item.acceptanceId,
        placeholder: item.relativePath,
        target: item.target,
        status: 'pending',
        checklist: item.defaultChecklist,
      });
    } else {
      const data = placeholder.value;
      const rawText = placeholder.raw ?? '';
      const containsPassedClaim = data.status === 'passed'
        || data.verified === true
        || data.executed === true
        || /"status"\s*:\s*"passed"/i.test(rawText)
        || /"verified"\s*:\s*true/i.test(rawText);

      if (containsPassedClaim || data.status !== 'pending' || data.verified !== false || data.executed !== false || data.evidenceLevel !== 'unverified') {
        invalidPlaceholders.push(item.relativePath);
      }

      items.push({
        id: item.acceptanceId,
        placeholder: item.relativePath,
        target: typeof data.target === 'string' ? data.target : item.target,
        status: 'pending', // 纯静态规划阶段固定为 pending，绝不继承外部虚假 passed
        checklist: Array.isArray(data.checklist) ? data.checklist : item.defaultChecklist,
      });
    }
  }

  const artifactInfo = findInstallerArtifact(projectRoot, customArtifact);

  // 1. 缺占位文件或占位文件非法（含伪造 passed 假成功）时固定 unavailable
  if (missingPlaceholders.length > 0 || invalidPlaceholders.length > 0) {
    return Object.freeze({
      schemaVersion: 1,
      profile: PROFILE,
      planId: PLAN_ID,
      ready: false,
      reason: 'unavailable',
      pending: true,
      executed: false,
      verified: false,
      evidenceLevel: 'unverified',
      platform,
      artifact: artifactInfo.exists ? artifactInfo.path : null,
      missingPlaceholders: Object.freeze([...missingPlaceholders, ...invalidPlaceholders]),
      notes: '缺少必要的人工验收占位文件或占位文件非法（占位文件必须为 pending 且绝不可声明 passed 或 verified=true）；规划处于 unavailable 状态。',
      items: Object.freeze(items),
    });
  }

  // 2. 非 Windows 平台时固定 unavailable
  if (platform !== 'win32') {
    return Object.freeze({
      schemaVersion: 1,
      profile: PROFILE,
      planId: PLAN_ID,
      ready: false,
      reason: 'unavailable',
      pending: true,
      executed: false,
      verified: false,
      evidenceLevel: 'unverified',
      platform,
      artifact: artifactInfo.exists ? artifactInfo.path : null,
      notes: '非 Windows 环境无法执行 Windows 安装/覆盖升级/卸载验收；当前输出静态规划，明确不可当作已验收。即使提供安装包路径也绝不拉起安装器或 Electron。',
      items: Object.freeze(items),
    });
  }

  // 3. Windows 环境无安装包产物时固定 unavailable
  if (!artifactInfo.exists) {
    return Object.freeze({
      schemaVersion: 1,
      profile: PROFILE,
      planId: PLAN_ID,
      ready: false,
      reason: 'unavailable',
      pending: true,
      executed: false,
      verified: false,
      evidenceLevel: 'unverified',
      platform,
      artifact: null,
      notes: 'Windows 环境未检测到打包后的 Windows 安装包产物（NSIS .exe）；当前仅为静态规划，明确不可当作已验收。',
      items: Object.freeze(items),
    });
  }

  // 4. Windows 环境且产物及占位文件齐全：输出待执行的人工规划，绝不宣称已验收
  return Object.freeze({
    schemaVersion: 1,
    profile: PROFILE,
    planId: PLAN_ID,
    ready: true,
    reason: 'planned_manual_acceptance_required',
    pending: true,
    executed: false,
    verified: false,
    evidenceLevel: 'unverified',
    platform,
    artifact: artifactInfo.path,
    notes: '已发现 Windows 安装包产物，静态规划就绪；本规划器绝不执行安装器或 Electron 进程，仍须人工在真实 Windows 主机隔离环境中执行并读回验收证据。',
    items: Object.freeze(items),
  });
}

/**
 * 校验静态规划与占位文件的完整性及安全性。
 */
export function checkReleaseInstallUpgradeUninstallPlan(options = {}) {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const checks = [];
  const errors = [];

  for (const item of ACCEPTANCE_ITEMS) {
    const placeholder = readJsonFile(projectRoot, item.relativePath);
    if (placeholder.status !== 'ok') {
      checks.push({
        id: `placeholder-${item.acceptanceId}`,
        status: 'fail',
        code: 'PLACEHOLDER_MISSING_OR_INVALID',
      });
      errors.push(`Placeholder file ${item.relativePath} is missing or invalid JSON`);
      continue;
    }

    checks.push({
      id: `placeholder-${item.acceptanceId}`,
      status: 'pass',
      code: 'PLACEHOLDER_FILE_PARSED',
    });

    const data = placeholder.value;

    if (data.schemaVersion === 1) {
      checks.push({ id: `${item.acceptanceId}-schema`, status: 'pass', code: 'SCHEMA_VERSION_MATCHED' });
    } else {
      checks.push({ id: `${item.acceptanceId}-schema`, status: 'fail', code: 'SCHEMA_VERSION_MISMATCH' });
      errors.push(`${item.relativePath} expected schemaVersion=1, got ${data.schemaVersion}`);
    }

    if (data.acceptanceId === item.acceptanceId) {
      checks.push({ id: `${item.acceptanceId}-id`, status: 'pass', code: 'ACCEPTANCE_ID_MATCHED' });
    } else {
      checks.push({ id: `${item.acceptanceId}-id`, status: 'fail', code: 'ACCEPTANCE_ID_MISMATCH' });
      errors.push(`${item.relativePath} expected acceptanceId=${item.acceptanceId}, got ${data.acceptanceId}`);
    }

    if (data.status === 'pending') {
      checks.push({ id: `${item.acceptanceId}-status`, status: 'pass', code: 'STATUS_PENDING' });
    } else {
      checks.push({ id: `${item.acceptanceId}-status`, status: 'fail', code: 'STATUS_NOT_PENDING' });
      errors.push(`${item.relativePath} expected status=pending, got status=${data.status}`);
    }

    if (data.executed === false) {
      checks.push({ id: `${item.acceptanceId}-unexecuted`, status: 'pass', code: 'EXECUTED_FALSE' });
    } else {
      checks.push({ id: `${item.acceptanceId}-unexecuted`, status: 'fail', code: 'EXECUTED_NOT_FALSE' });
      errors.push(`${item.relativePath} expected executed=false, got executed=${data.executed}`);
    }

    if (data.verified === false && data.evidenceLevel === 'unverified') {
      checks.push({ id: `${item.acceptanceId}-unverified`, status: 'pass', code: 'EVIDENCE_UNVERIFIED' });
    } else {
      checks.push({ id: `${item.acceptanceId}-unverified`, status: 'fail', code: 'EVIDENCE_NOT_UNVERIFIED' });
      errors.push(`${item.relativePath} expected evidenceLevel=unverified and verified=false`);
    }

    // 绝对禁止写成 passed
    const rawText = placeholder.raw ?? '';
    const containsPassedWord = /"status"\s*:\s*"passed"/i.test(rawText) || /"verified"\s*:\s*true/i.test(rawText);
    if (!containsPassedWord) {
      checks.push({ id: `${item.acceptanceId}-no-passed`, status: 'pass', code: 'NO_PASSED_FLAG' });
    } else {
      checks.push({ id: `${item.acceptanceId}-no-passed`, status: 'fail', code: 'ILLEGAL_PASSED_CLAIM' });
      errors.push(`${item.relativePath} must NEVER declare passed or verified=true`);
    }

    // checklist 须包含真实环境步骤关键词
    const checklist = Array.isArray(data.checklist) ? data.checklist : [];
    const checklistText = checklist.join(' ');
    const missingKeywords = item.requiredKeywords.filter((kw) => !checklistText.includes(kw));

    if (missingKeywords.length === 0 && checklist.length >= 3) {
      checks.push({ id: `${item.acceptanceId}-checklist`, status: 'pass', code: 'CHECKLIST_KEYWORDS_PRESENT' });
    } else {
      checks.push({ id: `${item.acceptanceId}-checklist`, status: 'fail', code: 'CHECKLIST_KEYWORDS_MISSING' });
      errors.push(`${item.relativePath} checklist is missing required keywords: ${missingKeywords.join(', ')}`);
    }

    // notes 明确声明未验收
    const notes = typeof data.notes === 'string' ? data.notes : '';
    if (notes.includes('未验收') || notes.includes('MANUAL_EVIDENCE_NOT_EXECUTED')) {
      checks.push({ id: `${item.acceptanceId}-notes`, status: 'pass', code: 'NOTES_UNVERIFIED_EXPLICIT' });
    } else {
      checks.push({ id: `${item.acceptanceId}-notes`, status: 'fail', code: 'NOTES_MISSING_UNVERIFIED' });
      errors.push(`${item.relativePath} notes must explicitly state unverified`);
    }
  }

  // 验证规划器在非 Windows 时的纯静态行为：固定输出 unavailable 与 pending
  const nonWinPlan = planReleaseInstallUpgradeUninstall({ platform: 'linux', projectRoot });
  if (nonWinPlan.ready === false && nonWinPlan.reason === 'unavailable' && nonWinPlan.pending === true) {
    checks.push({ id: 'plan-non-windows-unavailable', status: 'pass', code: 'PLAN_UNAVAILABLE_CORRECT' });
  } else {
    checks.push({ id: 'plan-non-windows-unavailable', status: 'fail', code: 'PLAN_UNAVAILABLE_INVALID' });
    errors.push('planReleaseInstallUpgradeUninstall on non-Windows must return ready:false, reason:"unavailable", pending:true');
  }

  // 验证规划器在 Windows 但无安装包产物时的纯静态行为：固定输出 unavailable 与 pending
  const winNoArtifactPlan = planReleaseInstallUpgradeUninstall({
    platform: 'win32',
    projectRoot,
    artifactPath: '__mod19_nonexistent_artifact__.exe',
  });
  if (winNoArtifactPlan.ready === false && winNoArtifactPlan.reason === 'unavailable' && winNoArtifactPlan.pending === true) {
    checks.push({ id: 'plan-windows-no-artifact-unavailable', status: 'pass', code: 'PLAN_UNAVAILABLE_CORRECT' });
  } else {
    checks.push({ id: 'plan-windows-no-artifact-unavailable', status: 'fail', code: 'PLAN_UNAVAILABLE_INVALID' });
    errors.push('planReleaseInstallUpgradeUninstall on Windows without artifact must return ready:false, reason:"unavailable", pending:true');
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
    const report = checkReleaseInstallUpgradeUninstallPlan({ projectRoot });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) {
      process.exit(1);
    }
    process.exit(0);
  }

  const plan = planReleaseInstallUpgradeUninstall({ projectRoot, artifactPath });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  // CLI 固定非 0 退出，表示“纯静态规划就绪，不可当作已验收”
  process.exit(1);
}
