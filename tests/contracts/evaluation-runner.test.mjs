// 评测 runner 契约测试：contract adapter 结构校验、runtime adapter 判分边界与 Trace 一致性。
// 运行：node --test tests/contracts/evaluation-runner.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  contractChecks,
  runEvaluation,
  writeTrace,
  parseArgs,
} from '../../scripts/competition/run-evaluation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const casesPath = join(repoRoot, 'docs', 'competition', 'evaluation', 'cases.json');
const wiringPath = join(repoRoot, 'docs', 'competition', 'workflow-wiring.json');
const caseSet = JSON.parse(readFileSync(casesPath, 'utf8'));
const wiring = JSON.parse(readFileSync(wiringPath, 'utf8'));

// parseArgs 与 CLI 共用约定：argv[0]/argv[1] 为 node/script 占位
const cli = (...rest) => ['node', 'scripts/competition/run-evaluation.mjs', ...rest];

test('题集与整图契约：22 条用例全部通过结构校验', () => {
  assert.ok(caseSet.cases.length >= 20, `用例数 ${caseSet.cases.length} 应 ≥20`);
  const results = contractChecks(caseSet, wiring);
  const failures = [...results.entries()].filter(([, r]) => !r.ok);
  assert.deepEqual(
    failures.map(([id]) => id),
    [],
    `结构校验失败用例：${failures.map(([id, r]) => `${id}: ${r.structuralChecks.filter((k) => !k.pass).map((k) => k.detail).join('; ')}`).join(' | ')}`,
  );
  // 覆盖面：至少 12 个不同工作流
  const workflows = new Set(caseSet.cases.map((c) => c.workflowId));
  assert.ok(workflows.size >= 12, `工作流覆盖 ${workflows.size} 个，应 ≥12`);
  // requiredCapabilities 全部来自对应图
  const capsByWf = new Map(
    wiring.workflows.map((w) => [w.workflowId, new Set(w.nodes.flatMap((n) => (n.capabilities ?? []).map((c) => c?.name).filter(Boolean)))]),
  );
  for (const c of caseSet.cases) {
    for (const cap of c.requiredCapabilities) {
      assert.ok(capsByWf.get(c.workflowId)?.has(cap), `${c.id} 引用了图外能力 ${cap}`);
    }
  }
});

test('contract adapter：行为判分项一律 unverified，不被伪装成通过', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'eval-'));
  const args = parseArgs(cli('--adapter', 'contract', '--filter', 'EVAL-F01-001', '--out', tmp));
  const { runId, events, summary } = await runEvaluation(args, { now: () => new Date('2026-11-05T00:00:00Z') });
  const unverified = events.filter((e) => e.type === 'check' && e.result === 'unverified');
  assert.ok(unverified.length >= 3, `EVAL-F01-001 的 3 条行为项都应 unverified（实际 ${unverified.length}）`);
  assert.ok(unverified.every((e) => /contract adapter 不评测模型行为/.test(e.detail)), 'unverified 必须注明原因');
  const structural = events.filter((e) => e.type === 'check' && ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].includes(e.checkId));
  assert.ok(structural.every((e) => e.result === 'pass'), '结构项应全 pass');
  const trace = writeTrace(tmp, { runId, events, summary }, args);
  assert.equal(trace.consistent, true);
  assert.ok(readdirSync(tmp).some((f) => f.endsWith('.events.jsonl')));
  assert.ok(readdirSync(tmp).some((f) => f.endsWith('.manifest.json')));
  const manifest = JSON.parse(readFileSync(join(tmp, `trace-${runId}.manifest.json`), 'utf8'));
  assert.equal(manifest.totals.passed, 1);
  assert.equal(manifest.totals.failed, 0);
  assert.equal(manifest.casesSha256.length, 64);
});

test('contract adapter：坏题集必须被拒绝（workflowId 不存在/能力未登记/权重和≠1）', () => {
  const broken = {
    cases: [
      { ...caseSet.cases[0], id: 'BAD-1', workflowId: 'F99' },
      { ...caseSet.cases[0], id: 'BAD-2', requiredCapabilities: ['memory.query', 'space.launch'] },
      { ...caseSet.cases[0], id: 'BAD-3', checks: [{ id: 'C1', description: 'x', weight: 0.5 }] },
    ],
  };
  const results = contractChecks(broken, wiring);
  const [bad1, bad2, bad3] = ['BAD-1', 'BAD-2', 'BAD-3'].map((id) => results.get(id));
  assert.equal(bad1.ok, false, 'F99 不存在应失败');
  assert.equal(bad2.ok, false, '未登记能力应失败');
  assert.equal(bad3.ok, false, '权重和≠1 应失败');
});

test('runtime adapter：真假账户用例均不派发，也不输出响应内容', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not dispatch'); };
  try {
    for (const extra of [[], ['--runtime-url', 'http://fake-runtime']]) {
      const args = parseArgs(cli('--adapter', 'runtime', '--filter', 'EVAL-F01-001,EVAL-F06-001', ...extra));
      const { events, summary, runId } = await runEvaluation(args);
      assert.equal(summary.unavailable, 2);
      assert.equal(summary.passed, 0);
      assert.equal(summary.score, null);
      assert.equal(events.filter((e) => e.type === 'case_finished' && e.reason === 'missing_trusted_execution_and_verifier').length, 2);
      assert.ok(events.filter((e) => e.type === 'check').every((e) => e.result === 'unverified'));
      assert.equal(events.some((e) => e.type === 'invocation'), false);
      const tmp = mkdtempSync(join(tmpdir(), 'eval-runtime-'));
      assert.equal(writeTrace(tmp, { events, summary, runId }, args).consistent, true);
      assert.equal(readFileSync(join(tmp, `trace-${runId}.events.jsonl`), 'utf8').includes('rawResponse'), false);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('runtime CLI 不可用时退出非零并保留不可用回执', () => {
  const out = mkdtempSync(join(tmpdir(), 'eval-cli-'));
  const run = spawnSync(process.execPath, [join(repoRoot, 'scripts/competition/run-evaluation.mjs'), '--adapter', 'runtime', '--filter', 'EVAL-F01-001', '--out', out], { encoding: 'utf8' });
  assert.equal(run.status, 3);
  assert.match(run.stdout, /score=unavailable/);
  const manifest = JSON.parse(readFileSync(join(out, readdirSync(out).find((f) => f.endsWith('.manifest.json'))), 'utf8'));
  assert.equal(manifest.totals.unavailable, 1);
  assert.equal(manifest.totals.score, null);
});
