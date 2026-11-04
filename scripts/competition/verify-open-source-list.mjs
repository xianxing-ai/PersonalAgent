#!/usr/bin/env node
// 校验 docs/competition/OPEN_SOURCE_LIST.md 与仓库实际第三方依赖一致：
// 1) 工作区内每个第三方直接依赖（非 @personal-agent/*）都必须登记在清单中；
// 2) 清单登记的每个依赖都必须存在于 package-lock.json（node_modules/<name>）；
// 3) 清单行上的版本必须与 lock 安装版本一致（允许 major.minor.x 前缀写法）。
// 用法：node scripts/competition/verify-open-source-list.mjs [repoRoot]
//       （node --test tests/contracts/open-source-list.test.mjs 亦调用本模块）

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUR_SCOPE = '@personal-agent/';

function listPackageJsonFiles(root, dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listPackageJsonFiles(root, full, out);
    else if (entry.name === 'package.json') out.push(full);
  }
  return out;
}

/** 扫描全部工作区 package.json，返回 { name -> Set<range> }（仅第三方直接依赖）。 */
export function collectThirdPartyDirectDeps(repoRoot) {
  const deps = new Map();
  const roots = [join(repoRoot, 'packages'), join(repoRoot, 'apps')];
  for (const r of roots) {
    let files = [];
    try {
      files = listPackageJsonFiles(repoRoot, r);
    } catch {
      continue;
    }
    for (const file of files) {
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
        for (const [name, range] of Object.entries(pkg[section] ?? {})) {
          if (name.startsWith(OUR_SCOPE)) continue;
          if (!deps.has(name)) deps.set(name, new Set());
          deps.get(name).add(String(range));
        }
      }
    }
  }
  // 根 package.json 也可能声明第三方依赖
  const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(rootPkg[section] ?? {})) {
      if (name.startsWith(OUR_SCOPE)) continue;
      if (!deps.has(name)) deps.set(name, new Set());
      deps.get(name).add(String(range));
    }
  }
  return deps;
}

// 严格的 npm 包名匹配：前后边界不能是单词字符/./@/，避免 "TypeScript" 内嵌出 "ypeScript" 这类误报。
const NPM_NAME_RE = /(?<![\w.@/-])@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*(?![\w.@/-])|(?<![\w.@/-])[a-z][\w.-]*(?![\w.@/-])/g;

/** 解析清单 markdown 表格行，返回 [{ name, row }]；跳过表头与分隔行。
 *  npm 包名可能出现在组件名列，也可能出现在版本列的括号说明里（如 `10.0.0（@types/nodemailer 8.0.1）`）。
 *  传入 knownNames（如 lock 中的包名集合）时，只保留其中的名字，滤掉 "engines" 这类普通词。 */
export function parseListedPackages(docText, knownNames = null) {
  const listed = [];
  for (const rawLine of docText.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // cells[0] 为空（行首竖线），组件名在 cells[1]，版本在 cells[2]
    const nameCell = cells[1] ?? '';
    const verCell = cells[2] ?? '';
    if (!nameCell || /^[-—:]*$/.test(nameCell.replace(/\s/g, ''))) continue;
    if (/^组件$/i.test(nameCell)) continue;
    const names = [
      ...new Set(
        [...(nameCell.match(NPM_NAME_RE) ?? []), ...(verCell.match(NPM_NAME_RE) ?? [])].filter((n) =>
          knownNames ? knownNames.has(n) : true,
        ),
      ),
    ];
    for (const name of names) listed.push({ name, versionText: verCell, row: line });
  }
  return listed;
}

function versionMentioned(versionText, installed) {
  if (versionText.includes(installed)) return true;
  // 允许 8.18.x 这种前缀写法
  const parts = installed.split('.');
  if (parts.length >= 2) return versionText.includes(`${parts[0]}.${parts[1]}.x`);
  return false;
}

/**
 * 主校验。返回 { ok, errors, warnings, scanned, listed }。
 * errors 非空 = 清单与仓库不一致；warnings 只提示不影响判定。
 */
export function verifyOpenSourceList(repoRoot) {
  const errors = [];
  const warnings = [];
  const docPath = join(repoRoot, 'docs', 'competition', 'OPEN_SOURCE_LIST.md');
  const docText = readFileSync(docPath, 'utf8');
  const lock = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'));

  const directDeps = collectThirdPartyDirectDeps(repoRoot);
  const lockNames = new Set(Object.keys(lock.packages ?? {}).map((k) => k.replace(/^node_modules\//, '')).filter((n) => n && !n.includes('/packages/') && !n.startsWith('packages/') && !n.startsWith('apps/')));
  const listed = parseListedPackages(docText, lockNames);
  const listedByName = new Map();
  for (const item of listed) {
    if (!listedByName.has(item.name)) listedByName.set(item.name, []);
    listedByName.get(item.name).push(item);
  }

  // 1) 每个第三方直接依赖必须登记
  for (const [name] of directDeps) {
    if (!listedByName.has(name)) {
      errors.push(`第三方直接依赖 ${name} 未登记进 OPEN_SOURCE_LIST.md`);
      continue;
    }
    // 2) 必须存在于 lock
    const lockEntry = lock.packages?.[`node_modules/${name}`];
    if (!lockEntry) {
      errors.push(`清单登记了 ${name}，但 package-lock.json 中没有 node_modules/${name}`);
      continue;
    }
    // 3) 版本一致（行级）
    const installed = String(lockEntry.version ?? '');
    const rows = listedByName.get(name);
    const mentioned = rows.some((r) => versionMentioned(r.versionText, installed));
    if (!mentioned) {
      errors.push(`${name} 清单版本（${rows.map((r) => r.versionText).join('; ')}）与 lock 安装版本 ${installed} 不一致`);
    }
  }

  // 4) 清单里登记但仓库未依赖的 npm 名 → 提示（可能是写错名字）
  for (const [name] of listedByName) {
    if (!directDeps.has(name)) warnings.push(`清单登记了 ${name}，但工作区 package.json 未直接依赖它`);
  }

  return { ok: errors.length === 0, errors, warnings, scanned: directDeps.size, listed: listed.length };
}

export function main(argv) {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(argv[2] ?? join(here, '..', '..'));
  const result = verifyOpenSourceList(repoRoot);
  for (const e of result.errors) console.error(`[open-source-list] ERROR: ${e}`);
  for (const w of result.warnings) console.warn(`[open-source-list] WARN: ${w}`);
  console.log(
    `[open-source-list] 第三方直接依赖 ${result.scanned} 个，清单登记条目 ${result.listed} 条，校验${result.ok ? '通过' : '未通过'}`,
  );
  return result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
