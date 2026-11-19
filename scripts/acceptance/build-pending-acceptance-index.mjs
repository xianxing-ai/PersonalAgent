#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanAcceptancePlans } from './scanner.mjs';
import { formatMarkdownReport, formatJsonReport } from './formatter.mjs';

function printUsage() {
  process.stdout.write(`
真环境待验收总表离线索引生成工具

用法:
  node scripts/acceptance/build-pending-acceptance-index.mjs [选项]

选项:
  --root <dir>              指定扫描根目录（默认：当前目录 .）
  --out-dir <dir>           输出目录（默认：docs/modules）
  --include-globs <globs>   限定扫描文件模式（逗号分隔，如 "scripts/acceptance/__tests__/**"）
  --globs <globs>           同 --include-globs
  --report-errors           若存在校验错误，仍输出报告文件，但以非 0 退出
  --exit-zero               强制 exit 0（仅用于特殊脚本包装，默认错误时 exit 1）
  --help, -h                显示帮助说明
\n`);
}

export async function runAcceptanceIndexCli(argv = process.argv.slice(2)) {
  let root = '.';
  let outDir = 'docs/modules';
  let globs = null;
  let reportErrors = false;
  let exitZero = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      return 0;
    }
    if (arg === '--root' && i + 1 < argv.length) {
      root = argv[++i];
    } else if (arg.startsWith('--root=')) {
      root = arg.slice('--root='.length);
    } else if (arg === '--out-dir' && i + 1 < argv.length) {
      outDir = argv[++i];
    } else if (arg.startsWith('--out-dir=')) {
      outDir = arg.slice('--out-dir='.length);
    } else if ((arg === '--include-globs' || arg === '--globs') && i + 1 < argv.length) {
      globs = argv[++i];
    } else if (arg.startsWith('--include-globs=')) {
      globs = arg.slice('--include-globs='.length);
    } else if (arg.startsWith('--globs=')) {
      globs = arg.slice('--globs='.length);
    } else if (arg === '--report-errors') {
      reportErrors = true;
    } else if (arg === '--exit-zero') {
      exitZero = true;
    }
  }

  const generatedAt = new Date().toISOString();
  const scanResult = await scanAcceptancePlans({
    root,
    globs,
  });

  const { records, errors, skipped, summary } = scanResult;

  process.stdout.write(`[Acceptance Index] 扫描完成: ${summary.totalFilesScanned} 个文件，${summary.validPlans} 个合规规划，${errors.length} 个错误，${skipped.length} 个跳过\n`);
  for (const [env, count] of Object.entries(summary.byEnvironment)) {
    process.stdout.write(`  - ${env}: ${count} 项\n`);
  }

  const hasErrors = errors.length > 0;
  if (hasErrors) {
    process.stderr.write(`\n[Acceptance Index] 发现 ${errors.length} 处规范校验异常：\n`);
    for (const err of errors) {
      const missing = err.missingFields?.length > 0 ? err.missingFields.join(', ') : 'none';
      process.stderr.write(`  [ERROR] 路径: ${err.sourcePath}\n`);
      process.stderr.write(`          标题: ${err.title || '（未显式声明标题）'}\n`);
      process.stderr.write(`          缺失字段: [${missing}]\n`);
      process.stderr.write(`          原因: ${err.errors.join('; ')}\n\n`);
    }
  }

  // 决定是否写入报告
  const shouldWrite = !hasErrors || reportErrors;
  if (shouldWrite) {
    const resolvedOutDir = path.resolve(root, outDir);
    fs.mkdirSync(resolvedOutDir, { recursive: true });

    const mdReport = formatMarkdownReport({
      records,
      errors,
      skipped,
      summary,
      generatedAt,
    });
    const jsonReport = formatJsonReport({
      records,
      errors,
      skipped,
      summary,
      generatedAt,
      scanRoots: scanResult.scanRoots,
    });

    const mdPath = path.join(resolvedOutDir, 'pending-acceptance-by-env.md');
    const jsonPath = path.join(resolvedOutDir, 'pending-acceptance-index.json');

    fs.writeFileSync(mdPath, mdReport, 'utf8');
    fs.writeFileSync(jsonPath, jsonReport, 'utf8');

    process.stdout.write(`[Acceptance Index] 报告已输出到:\n  - ${path.relative(process.cwd(), mdPath)}\n  - ${path.relative(process.cwd(), jsonPath)}\n`);
  } else {
    process.stderr.write(`[Acceptance Index] 由于存在 ${errors.length} 处校验错误，未写入输出文件。使用 --report-errors 可在报错时仍输出报告。\n`);
  }

  if (hasErrors && !exitZero) {
    return 1;
  }

  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runAcceptanceIndexCli().then((code) => {
    process.exit(code);
  }).catch((err) => {
    process.stderr.write(`[Acceptance Index] 致命异常: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
