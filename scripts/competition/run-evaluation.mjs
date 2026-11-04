#!/usr/bin/env node
// 本地评测 runner：跑 docs/competition/evaluation/cases.json，输出 Trace 记录。
// 两档 adapter（见 RUBRIC.md）：
//   contract（默认，离线）：校验题集与整图契约的结构一致性（不评测模型行为，行为判分项一律 unverified）
//   runtime：对已部署 AgentArts Runtime POST /invocations 真实调用并判分；不可达时 unavailable，绝不模拟
// 用法：
//   node scripts/competition/run-evaluation.mjs [--adapter contract|runtime] [--runtime-url URL]
//        [--cases <cases.json>] [--wiring <workflow-wiring.json>] [--filter EVAL-F01-001,EVAL-F02-001]
//        [--out <dir>] [--timeout-ms 20000]
// 退出码：0=完成；2=manifest 与 events 汇总不一致（内部自检失败）；1=参数/文件错误。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(join(here, '..', '..'));

function gitHead(repoRoot) {
  try {
    return execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function parseArgs(argv) {
  const args = {
    adapter: 'contract',
    runtimeUrl: process.env.PA_EVAL_RUNTIME_URL ?? null,
    cases: join(repoRoot, 'docs', 'competition', 'evaluation', 'cases.json'),
    wiring: join(repoRoot, 'docs', 'competition', 'workflow-wiring.json'),
    filter: null,
    out: null,
    timeoutMs: 20000,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--adapter': args.adapter = argv[++i]; break;
      case '--runtime-url': args.runtimeUrl = argv[++i]; break;
      case '--cases': args.cases = resolve(argv[++i]); break;
      case '--wiring': args.wiring = resolve(argv[++i]); break;
      case '--filter': args.filter = String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--out': args.out = resolve(argv[++i]); break;
      case '--timeout-ms': args.timeoutMs = Number(argv[++i]); break;
      default: throw new Error(`未知参数 ${argv[i]}`);
    }
  }
  if (!['contract', 'runtime'].includes(args.adapter)) throw new Error(`--adapter 只支持 contract|runtime，收到 ${args.adapter}`);
  return args;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** contract adapter：题集↔整图契约结构校验。返回每条 case 的 { structuralChecks, ok }。 */
export function contractChecks(caseSet, wiring) {
  const graphById = new Map(wiring.workflows.map((w) => [w.workflowId, w]));
  const graphCaps = new Map(
    wiring.workflows.map((w) => [
      w.workflowId,
      new Set((w.nodes ?? []).flatMap((n) => (n.capabilities ?? []).map((c) => c?.name).filter(Boolean))),
    ]),
  );
  const caseIds = new Set(caseSet.cases.map((c) => c.id));
  const results = new Map();
  for (const c of caseSet.cases) {
    const checks = [];
    const add = (id, description, pass, detail) => checks.push({ id, description, pass, detail });

    add('S1', 'workflowId 属于 28 图', graphById.has(c.workflowId), `workflowId=${c.workflowId}`);
    const caps = graphCaps.get(c.workflowId);
    const missingCaps = (c.requiredCapabilities ?? []).filter((cap) => !caps?.has(cap));
    add('S2', 'requiredCapabilities ⊆ 该图登记能力', missingCaps.length === 0, missingCaps.length ? `未登记：${missingCaps.join(', ')}` : '全部登记');
    const weightSum = (c.checks ?? []).reduce((s, k) => s + (k.weight ?? 0), 0);
    add('S3', 'checks 权重和为 1', Math.abs(weightSum - 1) < 1e-9, `sum=${weightSum}`);
    add('S4', 'input 非空且为字符串', typeof c.input === 'string' && c.input.trim().length > 0, `len=${c.input?.length ?? 0}`);
    add('S5', 'expectedEvidence 非空', Array.isArray(c.expectedEvidence) && c.expectedEvidence.length > 0, `${c.expectedEvidence?.length ?? 0} 项`);
    const missingDeps = (c.dependsOn ?? []).filter((id) => !caseIds.has(id));
    add('S6', 'dependsOn 用例存在', missingDeps.length === 0, missingDeps.length ? `缺失：${missingDeps.join(', ')}` : '无依赖或全部存在');

    results.set(c.id, { structuralChecks: checks, ok: checks.every((k) => k.pass) });
  }
  return results;
}

/** runtime adapter：真实调用已部署 Runtime。返回 { status, invocation, capabilitiesSeen, evidenceSeen } 或 { status:'unavailable', reason }。 */
export async function invokeRuntime(runtimeUrl, testCase, timeoutMs, { fetchImpl = fetch } = {}) {
  const deadline = new Date(Date.now() + timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${runtimeUrl.replace(/\/+$/, '')}/invocations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pa-deadline': `${new Date(deadline).toISOString().replace(/\.000Z$/, 'Z')}`,
      },
      body: JSON.stringify({ query: testCase.input }),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (!res.ok) {
      return { status: 'unavailable', reason: `runtime_http_${res.status}`, rawResponse: text.slice(0, 4000) };
    }
    // 事件里可能出现的能力与证据字段（尽力提取；提取不到时判 unverified，不判 pass）
    const events = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.events) ? parsed.events : [];
    const capsSeen = new Set();
    const evidenceSeen = new Set();
    const walk = (node, depth = 0) => {
      if (depth > 8 || node === null || typeof node !== 'object') return;
      if (typeof node.name === 'string' && /\.(query|search|deliver|write|send|check|read|collect|probe|snapshot|update|register|apply|merge|close|enable|promote|readback)$/.test(node.name)) capsSeen.add(node.name);
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          if (testCase.expectedEvidence.some((e) => key.toLowerCase().includes(e.toLowerCase().slice(0, 8)))) evidenceSeen.add(key);
        } else if (value && typeof value === 'object') {
          walk(value, depth + 1);
        }
      }
    };
    walk({ events, parsed });
    return { status: 'invoked', httpStatus: res.status, events, rawResponse: text.slice(0, 4000), capabilitiesSeen: [...capsSeen], evidenceSeen: [...evidenceSeen] };
  } catch (err) {
    return { status: 'unavailable', reason: err.name === 'AbortError' ? 'runtime_timeout' : `runtime_unreachable:${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 组装单条用例的判分（runtime adapter 行为项按 RUBRIC 第 5 节边界执行）。 */
export function scoreRuntimeCase(testCase, invocation) {
  if (invocation.status === 'unavailable') {
    return { status: 'unavailable', reason: invocation.reason, checks: [] };
  }
  const capsSet = new Set(invocation.capabilitiesSeen ?? []);
  const evidenceSet = new Set(invocation.evidenceSeen ?? []);
  const checks = (testCase.checks ?? []).map((k) => {
    // 行为判分项不能只凭模型自述；以能力出现与证据字段为准，缺证据时 unverified
    const capCovered = (testCase.requiredCapabilities ?? []).every((c) => capsSet.has(c));
    const evidenceCovered = (testCase.expectedEvidence ?? []).every((e) => [...evidenceSet].some((s) => s.toLowerCase().includes(e.toLowerCase().slice(0, 8))));
    const result = capCovered && evidenceCovered ? 'pass' : evidenceCovered || capCovered ? 'unverified' : 'fail';
    return { id: k.id, description: k.description, weight: k.weight, result, detail: `capabilities=${invocation.capabilitiesSeen?.join(',') ?? ''} evidence=${invocation.evidenceSeen?.join(',') ?? ''}` };
  });
  const judgeable = checks.filter((k) => k.result !== 'unverified');
  const status = judgeable.length === 0 ? 'unavailable' : judgeable.every((k) => k.result === 'pass') ? 'pass' : 'fail';
  const denominator = judgeable.reduce((s, k) => s + k.weight, 0);
  const score = denominator === 0 ? 0 : judgeable.filter((k) => k.result === 'pass').reduce((s, k) => s + k.weight, 0) / denominator;
  return { status, score, checks };
}

export async function runEvaluation(args, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const caseSet = JSON.parse(readFileSync(args.cases, 'utf8'));
  const wiring = JSON.parse(readFileSync(args.wiring, 'utf8'));
  const cases = args.filter ? caseSet.cases.filter((c) => args.filter.includes(c.id)) : caseSet.cases;
  const runId = `eval-${now().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const events = [];
  const emit = (type, data) => events.push({ ts: now().toISOString(), runId, type, ...data });

  emit('run_started', { adapter: args.adapter, caseCount: cases.length, gitHead: gitHead(repoRoot), casesFile: args.cases, casesSha256: sha256(readFileSync(args.cases, 'utf8')) });

  const contractResults = contractChecks(caseSet, wiring);
  if (args.adapter === 'contract') {
    // contract adapter：判“题集结构质量”；行为项一律 unverified（RUBRIC §5）
    let pass = 0; let fail = 0;
    for (const c of cases) {
      emit('case_started', { caseId: c.id, workflowId: c.workflowId });
      const structural = contractResults.get(c.id);
      for (const k of structural.structuralChecks) emit('check', { caseId: c.id, checkId: k.id, result: k.pass ? 'pass' : 'fail', detail: k.detail });
      for (const k of c.checks ?? []) emit('check', { caseId: c.id, checkId: k.id, result: 'unverified', detail: 'contract adapter 不评测模型行为（RUBRIC §5）' });
      const status = structural.ok ? 'pass' : 'fail';
      if (status === 'pass') pass++; else fail++;
      emit('case_finished', { caseId: c.id, status, score: structural.ok ? 1 : 0, structuralOk: structural.ok });
    }
    emit('run_finished', { passed: pass, failed: fail, unavailable: 0, score: cases.length ? pass / cases.length : 0 });
    return { runId, events, summary: { passed: pass, failed: fail, unavailable: 0, score: cases.length ? pass / cases.length : 0, adapter: 'contract' } };
  }

  // runtime adapter
  if (!args.runtimeUrl) {
    emit('run_finished', { passed: 0, failed: 0, unavailable: cases.length, score: 0, note: '未提供 --runtime-url：全部用例 unavailable（RUBRIC：不做本地模拟替代）' });
    return { runId, events, summary: { passed: 0, failed: 0, unavailable: cases.length, score: 0, adapter: 'runtime' } };
  }
  let pass = 0; let fail = 0; let unavailable = 0; let scoreSum = 0; let judgeableCases = 0;
  for (const c of cases) {
    emit('case_started', { caseId: c.id, workflowId: c.workflowId });
    const structural = contractResults.get(c.id);
    if (!structural.ok) {
      // 题集结构坏了先修题集，不能带病跑 runtime
      for (const k of structural.structuralChecks) if (!k.pass) emit('check', { caseId: c.id, checkId: k.id, result: 'fail', detail: k.detail });
      emit('case_finished', { caseId: c.id, status: 'fail', score: 0, reason: 'structural_check_failed' });
      fail++; continue;
    }
    const invocation = await invokeRuntime(args.runtimeUrl, c, args.timeoutMs, { fetchImpl });
    emit('invocation', { caseId: c.id, status: invocation.status, httpStatus: invocation.httpStatus, rawResponse: invocation.rawResponse, reason: invocation.reason });
    const scored = scoreRuntimeCase(c, invocation);
    for (const k of scored.checks ?? []) emit('check', { caseId: c.id, checkId: k.id, result: k.result, detail: k.detail });
    emit('case_finished', { caseId: c.id, status: scored.status, score: scored.score, reason: scored.reason });
    if (scored.status === 'pass') { pass++; scoreSum += scored.score; judgeableCases++; }
    else if (scored.status === 'fail') { fail++; scoreSum += scored.score; judgeableCases++; }
    else unavailable++;
  }
  const score = judgeableCases ? scoreSum / judgeableCases : 0;
  emit('run_finished', { passed: pass, failed: fail, unavailable, score });
  return { runId, events, summary: { passed: pass, failed: fail, unavailable, score, adapter: 'runtime' } };
}

/** 写出 trace 文件并做 manifest↔events 一致性自检。 */
export function writeTrace(outDir, { runId, events, summary }, args) {
  if (!outDir) return { consistent: true, files: [] };
  mkdirSync(outDir, { recursive: true });
  const eventsPath = join(outDir, `trace-${runId}.events.jsonl`);
  const manifestPath = join(outDir, `trace-${runId}.manifest.json`);
  writeFileSync(eventsPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');

  const finished = events.find((e) => e.type === 'run_finished');
  const caseFinishes = events.filter((e) => e.type === 'case_finished');
  const manifest = {
    runId,
    adapter: args.adapter,
    runtimeUrl: args.runtimeUrl,
    startedAt: events[0]?.ts,
    finishedAt: events[events.length - 1]?.ts,
    gitHead: events[0]?.gitHead ?? null,
    casesFile: args.cases,
    casesSha256: events[0]?.casesSha256,
    caseCount: events[0]?.caseCount,
    totals: {
      passed: finished?.passed ?? summary.passed,
      failed: finished?.failed ?? summary.failed,
      unavailable: finished?.unavailable ?? summary.unavailable,
      score: finished?.score ?? summary.score,
    },
    perCase: caseFinishes.map((e) => ({ caseId: e.caseId, status: e.status, score: e.score })),
    files: { events: eventsPath, manifest: manifestPath },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const totalsMatch =
    manifest.totals.passed === summary.passed &&
    manifest.totals.failed === summary.failed &&
    manifest.totals.unavailable === summary.unavailable &&
    manifest.perCase.length === events.filter((e) => e.type === 'case_started').length;
  return { consistent: totalsMatch, files: [eventsPath, manifestPath], manifest };
}

async function main(argv) {
  const args = parseArgs(argv);
  const { runId, events, summary } = await runEvaluation(args);
  const outDir = args.out ?? join(repoRoot, 'docs', 'competition', 'evaluation', 'runs');
  const { consistent, files, manifest } = writeTrace(outDir, { runId, events, summary }, args);
  if (!consistent) {
    console.error('[evaluation] manifest 与 events 汇总不一致，判分无效');
    return 2;
  }
  console.log(`[evaluation] runId=${runId} adapter=${summary.adapter} passed=${summary.passed} failed=${summary.failed} unavailable=${summary.unavailable} score=${(summary.score * 100).toFixed(1)}%`);
  for (const f of files ?? []) console.log(`[evaluation] trace: ${f}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv));
}
