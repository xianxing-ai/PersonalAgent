#!/usr/bin/env node
// 28 图能力覆盖校验：workflow-wiring.json 里声明的每个能力名（tool/host），
// 必须能在仓库源码的已发布能力面（packages/*/src、packages/connectors/*/src、apps/*/src）
// 中找到同名提供者，或在 docs/competition/evidence/graph-capability-gaps.json 的缺口登记中
// 找到归属（domain/owner/status）。两者都不满足 → 校验失败。
// 这是“每个缺口都有登记、每个登记都能对上”的防漂移契约，不是完成度声明。
// 用法：node scripts/competition/verify-graph-capability-coverage.mjs [--domain business|foundation|device-cloud] [--json]
//       node scripts/competition/verify-graph-capability-coverage.mjs --json  （供测试导入使用 export）

import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(join(here, '..', '..'));
const CAP_RE = /['"](?:([a-z_]+)\.([a-z_.0-9]+))['"]/g;

const DOMAIN_PREFIXES = {
  business: ['todo.', 'reminder.', 'calendar.', 'mail.', 'feeds.', 'notification.', 'research.', 'weather.'],
  foundation: ['memory.', 'knowledge.', 'model.', 'policy.', 'mcp_skill.', 'configuration.', 'system.', 'workspace.', 'github.', 'runtime.'],
  'device-cloud': ['voice.', 'desktop.', 'executor.', 'responsibility.', 'deployment.', 'evaluation.', 'shadow.'],
};

export function domainOf(name) {
  for (const [domain, prefixes] of Object.entries(DOMAIN_PREFIXES)) {
    if (prefixes.some((p) => name.startsWith(p))) return domain;
  }
  return null;
}

function listSources(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, {withFileTypes: true});
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listSources(full, out);
    else if (/\.(ts|mts|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 声明文件与测试文件不算提供者：模板/内嵌数据本身会写出全部能力名，测试夹具只是引用。 */
const DECLARATION_FILES = /owned-workflow-(templates|data)\.ts$|workflow-wiring\.json$/;
const TEST_FILES = /(^|[\\/])(test|tests)[\\/]/;

/** 扫描仓库源码中出现的引用能力名（提供者证据；排除声明与测试文件）。 */
export function scanProvidedCapabilities(repo = repoRoot) {
  const provided = new Map(); // name -> [file]
  const roots = [join(repo, 'packages'), join(repo, 'apps')];
  for (const root of roots) {
    for (const file of listSources(root)) {
      if (DECLARATION_FILES.test(file) || TEST_FILES.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(CAP_RE)) {
        const name = `${match[1]}.${match[2]}`;
        if (!domainOf(name) && !['decision.', 'knowledge.', 'runtime.'].some((p) => name.startsWith(p))) continue;
        if (!provided.has(name)) provided.set(name, []);
        const files = provided.get(name);
        if (files.length < 3 && !files.some((f) => f === file)) files.push(file);
      }
    }
  }
  return provided;
}

/** 图声明的能力名（去重、含 kind）。 */
export function graphCapabilities(repo = repoRoot) {
  const wiring = JSON.parse(readFileSync(join(repo, 'docs', 'competition', 'workflow-wiring.json'), 'utf8'));
  const declared = new Map(); // name -> {kind, workflowIds}
  for (const workflow of wiring.workflows) {
    for (const node of workflow.nodes ?? []) {
      for (const cap of node.capabilities ?? []) {
        if (!cap?.name) continue;
        const kind = cap.kind ?? 'tool';
        if (!declared.has(cap.name)) declared.set(cap.name, {kind, workflowIds: []});
        const entry = declared.get(cap.name);
        if (!entry.workflowIds.includes(workflow.workflowId)) entry.workflowIds.push(workflow.workflowId);
        if (kind === 'tool') entry.kind = 'tool'; // 任一图以 tool 使用则按 tool 记
      }
    }
  }
  return declared;
}

/** 缺口登记（graph-capability-gaps.json）：name → entry。 */
export function loadGapRegistry(repo = repoRoot) {
  const path = join(repo, 'docs', 'competition', 'evidence', 'graph-capability-gaps.json');
  const registry = JSON.parse(readFileSync(path, 'utf8'));
  const byName = new Map();
  for (const entry of registry.gaps ?? []) {
    if (byName.has(entry.name)) throw new Error(`缺口登记重复：${entry.name}`);
    byName.set(entry.name, entry);
  }
  return {registry, byName, path};
}

/** 主校验。domain 过滤时只检查该域的图能力。 */
export function verifyCapabilityCoverage({domain = null, repo = repoRoot} = {}) {
  const provided = scanProvidedCapabilities(repo);
  const declared = graphCapabilities(repo);
  const {byName, registry} = loadGapRegistry(repo);
  const errors = [];
  const warnings = [];
  const rows = [];
  for (const [name, info] of declared) {
    if (domain && domainOf(name) !== domain) continue;
    const isProvided = provided.has(name);
    const gap = byName.get(name);
    if (isProvided) {
      rows.push({name, kind: info.kind, workflowIds: info.workflowIds, status: 'provided'});
      if (gap) warnings.push(`${name} 已有提供者但仍在缺口登记（应更新登记）：${gap.status}`);
      continue;
    }
    if (gap) {
      if (gap.domain !== (domain ?? domainOf(name))) {
        errors.push(`${name} 登记域 ${gap.domain} 与前缀域 ${domainOf(name)} 不一致`);
      }
      if (!['open', 'in-flight-pr', 'needs-real-environment'].includes(gap.status)) {
        errors.push(`${name} 登记状态非法：${gap.status}`);
      }
      if (!Array.isArray(gap.owners) || gap.owners.length === 0 || !gap.note
        || !Array.isArray(gap.sources) || gap.sources.length === 0) {
        errors.push(`${name} 登记缺 owners/note/sources`);
      }
      rows.push({name, kind: info.kind, workflowIds: info.workflowIds, status: `registered:${gap.status}`});
      continue;
    }
    errors.push(`图能力 ${name}（${info.kind}，用于 ${info.workflowIds.join('/')}）既无提供者也无缺口登记`);
  }
  // 登记里有但图里没有的名字 → 提示（可能是拼写漂移）
  for (const [name] of byName) {
    if (!declared.has(name)) warnings.push(`缺口登记 ${name} 未被任何图引用（检查拼写或过期登记）`);
  }
  const scoped = rows.filter((r) => !domain || domainOf(r.name) === domain);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      declaredTotal: declared.size,
      checked: scoped.length,
      provided: rows.filter((r) => r.status === 'provided').length,
      registeredOpen: rows.filter((r) => r.status === 'registered:open').length,
      registeredInFlight: rows.filter((r) => r.status === 'registered:in-flight-pr').length,
      registeredNeedsReal: rows.filter((r) => r.status === 'registered:needs-real-environment').length,
      registryVersion: registry.version,
    },
    rows: scoped,
  };
}

export function main(argv) {
  let domain = null;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--domain') domain = args[++i];
  }
  const result = verifyCapabilityCoverage({domain});
  for (const e of result.errors) console.error(`[capability-coverage] ERROR: ${e}`);
  for (const w of result.warnings) console.warn(`[capability-coverage] WARN: ${w}`);
  console.log(`[capability-coverage] 声明 ${result.stats.declaredTotal}，检查 ${result.stats.checked}，有提供者 ${result.stats.provided}，登记缺口 open=${result.stats.registeredOpen} in-flight=${result.stats.registeredInFlight} needs-real=${result.stats.registeredNeedsReal} → ${result.ok ? '通过' : '未通过'}`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
