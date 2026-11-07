#!/usr/bin/env node
// 本地评测 runner：跑 docs/competition/evaluation/cases.json，输出 Trace 记录。
// 两档 adapter（见 RUBRIC.md）：
//   contract（默认，离线）：校验题集与整图契约的结构一致性（不评测模型行为，行为判分项一律 unverified）
//   runtime：缺少可信隔离和逐项验证器，禁止调用并标记 unavailable
// 用法：
//   node scripts/competition/run-evaluation.mjs [--adapter contract|runtime] [--runtime-url URL]
//        [--cases <cases.json>] [--wiring <workflow-wiring.json>] [--filter EVAL-F01-001,EVAL-F02-001]
//        [--out <dir>] [--timeout-ms 20000]
// 退出码：0=完成；1=参数/文件错误（含空过滤结果）；2=manifest 与 events 汇总不一致；3=runtime 不可用；4=contract 结构检查失败。

import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
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

export async function runEvaluation(args, { now = () => new Date() } = {}) {
  const caseSet = JSON.parse(readFileSync(args.cases, 'utf8'));
  const wiring = JSON.parse(readFileSync(args.wiring, 'utf8'));
  const cases = args.filter ? caseSet.cases.filter((c) => args.filter.includes(c.id)) : caseSet.cases;
  if (args.filter && cases.length === 0) throw new Error('过滤条件未匹配任何评测用例');
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

  // ponytail: runtime dispatch stays unavailable until isolated authorization and per-check verification exist.
  let fail = 0; let unavailable = 0;
  for (const c of cases) {
    emit('case_started', { caseId: c.id, workflowId: c.workflowId });
    const structural = contractResults.get(c.id);
    if (!structural.ok) {
      for (const k of structural.structuralChecks) if (!k.pass) emit('check', { caseId: c.id, checkId: k.id, result: 'fail', detail: k.detail });
      emit('case_finished', { caseId: c.id, status: 'fail', score: 0, reason: 'structural_check_failed' });
      fail++; continue;
    }
    for (const k of c.checks ?? []) emit('check', { caseId: c.id, checkId: k.id, result: 'unverified', detail: '缺少可信隔离授权和逐项证据验证器' });
    emit('case_finished', { caseId: c.id, status: 'unavailable', reason: 'missing_trusted_execution_and_verifier' });
    unavailable++;
  }
  emit('run_finished', { passed: 0, failed: fail, unavailable, score: null });
  return { runId, events, summary: { passed: 0, failed: fail, unavailable, score: null, adapter: 'runtime' } };

}

/** 写出 trace 文件并做 manifest↔events 一致性自检。 */
export function writeTrace(outDir, { runId, events, summary }, args) {
  if (!outDir) return { consistent: true, files: [] };
  const eventsPath = join(outDir, `trace-${runId}.events.jsonl`);
  const manifestPath = join(outDir, `trace-${runId}.manifest.json`);

  const finished = events.find((e) => e.type === 'run_finished');
  const caseFinishes = events.filter((e) => e.type === 'case_finished');
  const manifest = {
    runId,
    adapter: args.adapter,
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
      score: finished?.score === null ? null : (finished?.score ?? summary.score),
    },
    perCase: caseFinishes.map((e) => ({ caseId: e.caseId, status: e.status, score: e.score })),
    files: { events: eventsPath, manifest: manifestPath },
  };

  const starts = events.filter((e) => e.type === 'case_started');
  const startIds = new Set(starts.map((e) => e.caseId));
  const finishIds = new Set(caseFinishes.map((e) => e.caseId));
  const counts = { pass: 0, fail: 0, unavailable: 0 };
  let validCases = true;
  for (const event of caseFinishes) {
    if (!Object.hasOwn(counts, event.status)) { validCases = false; continue; }
    counts[event.status]++;
    if (args.adapter === 'contract' && (event.status === 'unavailable' || event.score !== (event.status === 'pass' ? 1 : 0))) validCases = false;
    if (args.adapter === 'runtime' && (event.status === 'pass' || (event.status === 'fail' && event.score !== 0) || (event.status === 'unavailable' && event.score !== undefined))) validCases = false;
  }
  const expectedScore = args.adapter === 'contract' ? (starts.length ? counts.pass / starts.length : 0) : null;
  const totalsMatch =
    events.filter((e) => e.type === 'run_started').length === 1 &&
    events.filter((e) => e.type === 'run_finished').length === 1 &&
    events[0]?.type === 'run_started' && events[events.length - 1]?.type === 'run_finished' &&
    summary.adapter === args.adapter && ['contract', 'runtime'].includes(args.adapter) &&
    validCases && starts.every((e) => typeof e.caseId === 'string' && e.caseId.length > 0) &&
    startIds.size === starts.length && finishIds.size === caseFinishes.length &&
    startIds.size === finishIds.size && [...finishIds].every((id) => startIds.has(id)) &&
    events[0]?.caseCount === starts.length &&
    finished.passed === counts.pass && finished.failed === counts.fail && finished.unavailable === counts.unavailable && finished.score === expectedScore &&
    manifest.totals.passed === counts.pass && summary.passed === counts.pass &&
    manifest.totals.failed === counts.fail && summary.failed === counts.fail &&
    manifest.totals.unavailable === counts.unavailable && summary.unavailable === counts.unavailable &&
    manifest.totals.score === expectedScore && summary.score === expectedScore;
  if (!totalsMatch) return { consistent: false, files: [], manifest };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(eventsPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n', { flag: 'wx' });
  try {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  } catch (err) {
    unlinkSync(eventsPath);
    throw err;
  }
  return { consistent: true, files: [eventsPath, manifestPath], manifest };
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
  console.log(`[evaluation] runId=${runId} adapter=${summary.adapter} passed=${summary.passed} failed=${summary.failed} unavailable=${summary.unavailable} score=${summary.score === null ? 'unavailable' : `${(summary.score * 100).toFixed(1)}%`}`);
  for (const f of files ?? []) console.log(`[evaluation] trace: ${f}`);
  return summary.adapter === 'runtime' ? 3 : (summary.failed > 0 ? 4 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv));
}
