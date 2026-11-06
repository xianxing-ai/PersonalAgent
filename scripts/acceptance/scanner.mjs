import fs from 'node:fs';
import path from 'node:path';
import { parseMarkdownPlan } from './parsers/markdown-plan-parser.mjs';
import { parseCodePlan } from './parsers/code-plan-parser.mjs';
import { parseJsonPlan } from './parsers/json-plan-parser.mjs';
import { REQUIRED_ENVIRONMENTS } from './types.mjs';

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.worktrees',
  'coverage',
  'build',
  'tmp',
  'artifacts',
  '.gemini',
]);

// 默认全库扫描时跳过测试夹具，避免样例规划污染真实待验收总表。
// 若调用方传入 includeGlobs/--globs，则允许显式扫到这些目录（供单测使用）。
const TEST_FIXTURE_DIRS = new Set(['__tests__', '__fixtures__']);

const SUPPORTED_EXTS = new Set(['.md', '.mjs', '.js', '.ts', '.json']);

/**
 * 简易 glob 匹配器
 */
export function matchGlob(relPath, pattern) {
  const normalizedRel = relPath.split(path.sep).join('/');
  const normalizedPattern = pattern.trim().split(path.sep).join('/');

  if (!normalizedPattern || normalizedPattern === '*') {
    return true;
  }

  // 转换 glob 为正则
  const regexString = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLE_STAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLE_STAR___/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexString}$`);
  return regex.test(normalizedRel);
}

/**
 * 递归收集工作树文件（忽略指定大目录）
 */
function collectFiles(dirPath, rootPath, globs = null, skipTestFixtures = true) {
  const entries = [];

  let dirents = [];
  try {
    dirents = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return entries;
  }

  for (const dirent of dirents) {
    const fullPath = path.join(dirPath, dirent.name);
    const relPath = path.relative(rootPath, fullPath).split(path.sep).join('/');

    if (dirent.isDirectory()) {
      if (IGNORED_DIRS.has(dirent.name)) {
        continue;
      }
      if (skipTestFixtures && TEST_FIXTURE_DIRS.has(dirent.name)) {
        continue;
      }
      entries.push(...collectFiles(fullPath, rootPath, globs, skipTestFixtures));
    } else if (dirent.isFile()) {
      const ext = path.extname(dirent.name).toLowerCase();
      if (!SUPPORTED_EXTS.has(ext)) {
        continue;
      }

      if (globs && globs.length > 0) {
        const matchesAny = globs.some((g) => matchGlob(relPath, g));
        if (!matchesAny) {
          continue;
        }
      }

      entries.push({ fullPath, relPath, ext });
    }
  }

  return entries;
}

/**
 * 执行扫描与聚合（全静态文本解析，绝无动态代码执行）
 */
export async function scanAcceptancePlans(options = {}) {
  const rootPath = path.resolve(options.root || '.');
  const rawGlobs = options.includeGlobs || options.globs || null;
  const globs = rawGlobs
    ? (Array.isArray(rawGlobs) ? rawGlobs : String(rawGlobs).split(',')).map((s) => s.trim()).filter(Boolean)
    : null;

  // 有显式 globs 时允许扫测试夹具；默认全库扫描则跳过
  const skipTestFixtures = !(globs && globs.length > 0);
  const fileEntries = collectFiles(rootPath, rootPath, globs, skipTestFixtures);

  const records = [];
  const errors = [];
  const skipped = [];

  for (const file of fileEntries) {
    let result = null;

    if (file.ext === '.md') {
      result = parseMarkdownPlan(file.fullPath, rootPath);
    } else if (file.ext === '.mjs' || file.ext === '.js' || file.ext === '.ts') {
      result = parseCodePlan(file.fullPath, rootPath);
    } else if (file.ext === '.json') {
      result = parseJsonPlan(file.fullPath, rootPath);
    }

    if (!result) continue;

    if (result.isPlan === true) {
      if (result.ok === true) {
        records.push(result.record);
      } else {
        errors.push({
          sourcePath: result.sourcePath,
          title: result.title || path.basename(file.fullPath),
          missingFields: result.missingFields || [],
          errors: result.errors || [],
          cannotConfirm: result.cannotConfirm || {},
          rawRecord: result.rawRecord || null,
        });
      }
    } else if (result.skippedReason && result.skippedReason !== 'not_acceptance_related') {
      skipped.push({
        sourcePath: result.sourcePath || file.relPath,
        reason: result.skippedReason,
      });
    }
  }

  // 按环境统计
  const byEnvironment = {};
  for (const env of REQUIRED_ENVIRONMENTS) {
    byEnvironment[env] = 0;
  }

  for (const record of records) {
    if (Array.isArray(record.requiredEnvironments)) {
      for (const env of record.requiredEnvironments) {
        if (byEnvironment[env] !== undefined) {
          byEnvironment[env]++;
        } else {
          byEnvironment[env] = 1;
        }
      }
    }
  }

  const summary = {
    totalFilesScanned: fileEntries.length,
    validPlans: records.length,
    errorsCount: errors.length,
    skippedCount: skipped.length,
    byEnvironment,
  };

  return {
    scanRoots: [rootPath],
    records,
    errors,
    skipped,
    summary,
  };
}
