#!/usr/bin/env node
// 构建在线 Web Demo 的数据文件 demo-data.json。
// 数据全部来自仓库真实文件（不编造）：
//   - docs/competition/workflow-wiring.json  → 28 张工作流图 / 节点 / 能力 / 证据要求
//   - docs/demo/web-demo/capability-status.json → F01–F28 状态快照（含来源文档）
//   - git HEAD、输入文件 sha256 → 可追溯性
// 用法：node docs/demo/web-demo/build-demo-data.mjs [--out <path>] [--repo-root <path>]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function git(repoRoot, args) {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function buildDemoData(repoRoot = resolve(join(here, '..', '..', '..')), now = new Date()) {
  const wiringPath = join(repoRoot, 'docs', 'competition', 'workflow-wiring.json');
  const statusPath = join(repoRoot, 'docs', 'demo', 'web-demo', 'capability-status.json');
  const wiring = JSON.parse(readFileSync(wiringPath, 'utf8'));
  const status = JSON.parse(readFileSync(statusPath, 'utf8'));

  if (!Array.isArray(wiring.workflows) || wiring.workflows.length === 0) {
    throw new Error('workflow-wiring.json 缺少 workflows 数组');
  }

  const statusById = new Map(status.capabilities.map((c) => [c.id, c]));

  const workflows = wiring.workflows.map((w) => {
    const capabilityNames = new Set();
    const effects = new Set();
    for (const node of w.nodes ?? []) {
      effects.add(node.effect ?? 'none');
      for (const cap of node.capabilities ?? []) {
        if (cap?.name) capabilityNames.add(cap.name);
      }
    }
    const st = statusById.get(w.workflowId);
    return {
      workflowId: w.workflowId,
      name: w.name,
      version: w.version,
      bindingId: w.bindingId,
      nodeCount: (w.nodes ?? []).length,
      nodes: (w.nodes ?? []).map((n) => ({
        id: n.id,
        label: n.label,
        kind: n.kind ?? n.designKind,
        effect: n.effect ?? 'none',
        dependencies: (n.dependencies ?? []).map((d) => d.nodeId),
        capabilityNames: (n.capabilities ?? []).map((c) => c?.name).filter(Boolean),
        evidenceRequirement: n.evidenceRequirement ?? '',
      })),
      capabilityNames: [...capabilityNames].sort(),
      effects: [...effects],
      status: st
        ? {
            owners: st.owners,
            status: st.status,
            summary: st.summary,
            openGaps: st.openGaps,
            inFlightPrs: st.inFlightPrs,
            sources: st.sources,
          }
        : { owners: [], status: 'unknown', summary: 'capability-status.json 缺少该图状态条目', openGaps: [], inFlightPrs: [], sources: [] },
    };
  });

  const statuses = workflows.map((w) => w.status.status);
  const data = {
    schemaVersion: '1.0.0',
    generatedAt: now.toISOString(),
    profile: wiring.profile,
    wiringSchemaVersion: wiring.schemaVersion,
    verification: wiring.verification,
    git: {
      head: git(repoRoot, ['rev-parse', 'HEAD']),
      branch: git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
      subject: git(repoRoot, ['log', '-1', '--format=%s']),
    },
    sources: [
      { path: 'docs/competition/workflow-wiring.json', sha256: sha256File(wiringPath) },
      { path: 'docs/demo/web-demo/capability-status.json', sha256: sha256File(statusPath) },
    ],
    stats: {
      workflowCount: workflows.length,
      designNodeCount: workflows.reduce((s, w) => s + w.nodeCount, 0),
      hostGuardChecklistTotal: status.global?.hostGuardChecklistTotal ?? null,
      hostGuardChecklistDone: status.global?.hostGuardChecklistDone ?? null,
      configuredCount: status.global?.workflowsConfigured ?? null,
      configuredTotal: workflows.length,
      statusCounts: statuses.reduce((acc, s) => ((acc[s] = (acc[s] ?? 0) + 1), acc), {}),
      snapshotDate: status.snapshotDate,
    },
    globalRule: status.global?.rule ?? '',
    highlights: status.highlights ?? [],
    workflows,
    liveDemo: {
      runtimeConfigured: false,
      reason:
        '构建期未提供已部署 AgentArts Runtime 地址。页面支持在“运行时健康探测”区输入地址进行只读探测，不执行任务；未部署或探测失败时一律显示 unavailable，不提供模拟数据。',
      probeHint: 'GET {runtimeUrl}/healthz 与 GET {runtimeUrl}/api/demo-data，只读，不发任何写请求。',
    },
  };
  return data;
}

function main(argv) {
  let out = join(here, 'demo-data.json');
  let repoRoot = resolve(join(here, '..', '..', '..'));
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') out = resolve(argv[++i]);
    else if (argv[i] === '--repo-root') repoRoot = resolve(argv[++i]);
  }
  const data = buildDemoData(repoRoot);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
  console.log(`[web-demo] 已生成 ${out}（图 ${data.stats.workflowCount}，节点 ${data.stats.designNodeCount}，HEAD ${data.git.head ?? '未知'}）`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
