// MOD-32 Trace 读回 helper 契约测试：只读、脱敏、manifest↔events 一致性。
// 运行：node --test tests/contracts/trace-readback.test.mjs

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {redactTraceValue, readTraceRun, listTraceRuns, truncateEvent} from '../../scripts/competition/read-trace.mjs';
import {runEvaluation, parseArgs} from '../../scripts/competition/run-evaluation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const cli = (...rest) => ['node', 'scripts/competition/run-evaluation.mjs', ...rest];

test('脱敏：敏感键值/邮箱/Bearer 替换为 [REDACTED]；sha256 证据哈希保留', () => {
  const redacted = redactTraceValue({
    gitHead: 'a'.repeat(64),
    casesSha256: 'b'.repeat(64),
    authorization: 'Bearer sk-live-abcdef123456',
    apiKey: 'plain-secret',
    contact: 'zemeng@example.com',
    nested: {password: 'hunter2', note: 'header Authorization: Bearer abc.def.ghi；邮箱 user@host.cn；哈希 ' + 'c'.repeat(64)},
    keep: {sha256: 'd'.repeat(64), path: 'docs/competition/evaluation/cases.json'},
  });
  assert.equal(redacted.gitHead, 'a'.repeat(64), '证据哈希必须保留');
  assert.equal(redacted.casesSha256, 'b'.repeat(64));
  assert.equal(redacted.authorization, '[REDACTED]', '敏感键整值替换（比字符串规则更强）');
  assert.equal(redacted.apiKey, '[REDACTED]');
  assert.ok(redacted.nested.note.includes('Bearer [REDACTED]'), '普通键里的 Bearer 凭据串也要脱敏');
  assert.equal(redacted.contact, '[EMAIL]');
  assert.equal(redacted.nested.password, '[REDACTED]');
  assert.ok(!redacted.nested.note.includes('user@host.cn'), '正文中的邮箱也必须脱敏');
  assert.ok(redacted.nested.note.includes('c'.repeat(64)), '普通 sha256 哈希保留');
  assert.equal(redacted.keep.sha256, 'd'.repeat(64));
  assert.equal(redacted.keep.path, 'docs/competition/evaluation/cases.json');
});

test('有界视图：超长事件截断并注明原文位置', () => {
  const big = {ts: 't', runId: 'r', type: 'invocation', rawResponse: 'x'.repeat(5000)};
  const view = truncateEvent(big, 1000);
  assert.equal(view.truncated, true);
  assert.ok(view.preview.length <= 1100);
  assert.match(view.preview, /原文 \d+ 字节/);
  assert.equal(truncateEvent(big, 6000).truncated, undefined);
});

test('端到端：评测 runner 产出的 Trace 可只读读回，manifest↔events 一致，摘要与判分一致', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'trace-'));
  const args = parseArgs(cli('--adapter', 'contract', '--out', tmp));
  const {runId, events, summary} = await runEvaluation(args, {now: () => new Date('2026-11-07T00:00:00Z')});
  const {writeTrace} = await import('../../scripts/competition/run-evaluation.mjs');
  const written = writeTrace(tmp, {runId, events, summary}, args);
  assert.equal(written.consistent, true);

  const run = readTraceRun(join(tmp, `trace-${runId}.manifest.json`));
  assert.equal(run.consistent, true);
  assert.equal(run.summary.adapter, 'contract');
  assert.equal(run.summary.totals.passed, summary.passed);
  assert.equal(run.summary.totals.unavailable, summary.unavailable);
  assert.equal(run.events.length, events.length);
  assert.ok(run.redactedEvents.every((e) => e && e.type), '每个事件都有脱敏后的有界视图');
  assert.ok(listTraceRuns(tmp).some((f) => f.endsWith(`trace-${runId}.manifest.json`)));
});

test('负例：manifest 与 events 汇总不一致 → consistent:false（判分无效）', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'trace-bad-'));
  const runId = 'eval-bad';
  writeFileSync(join(tmp, `trace-${runId}.events.jsonl`), [
    JSON.stringify({ts: 't', runId, type: 'run_started', caseCount: 2}),
    JSON.stringify({ts: 't', runId, type: 'case_started', caseId: 'EVAL-F01-001'}),
    JSON.stringify({ts: 't', runId, type: 'case_finished', caseId: 'EVAL-F01-001', status: 'pass', score: 1}),
    JSON.stringify({ts: 't', runId, type: 'run_finished', passed: 1, failed: 0, unavailable: 0, score: 1}),
  ].join('\n') + '\n');
  writeFileSync(join(tmp, `trace-${runId}.manifest.json`), JSON.stringify({
    runId, adapter: 'contract', totals: {passed: 9, failed: 0, unavailable: 0, score: 1},
    perCase: [{caseId: 'EVAL-F01-001', status: 'pass', score: 1}],
    files: {events: join(tmp, `trace-${runId}.events.jsonl`)},
  }));
  const run = readTraceRun(join(tmp, `trace-${runId}.manifest.json`));
  assert.equal(run.consistent, false, 'manifest 报 passed=9 而 events 只有 1 → 必须判无效');
});
