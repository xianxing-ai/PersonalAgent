// Consolidated public/synthetic acceptance for BUSINESS-CONSUMERS (#354 缺口 4).
// Part A drives the real business hosts directly (in-memory storage, public synthetic data):
// event dedup, same-resource CAS write queuing, branch partial delivery, modification
// invalidation via the #391 snapshot-revision protocol. Part B re-runs the existing
// targeted suites that own the deep lifecycle semantics (task cancel outcomes, unknown
// no-replay) and records their tallies. No credentials, no network, no cloud calls.
import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {NotificationService} from '@personal-agent/notifications';
import {TodoService} from '@personal-agent/productivity';
import {FakeStorage} from '@personal-agent/testkit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checks = [];
const record = (id, family, detail) => checks.push({id, family, ...detail, at: new Date().toISOString()});
const item = (key, at = '2026-10-19T10:00:00.000Z') => ({source: 'acceptance', accountRef: 'acceptance', externalId: key,
  occurredAt: at, fetchedAt: at, contentRef: 'public synthetic only', sensitivity: 'public', dedupeKey: `acceptance:${key}`});

// A1 事件去重：同一 dedupeKey 重复投递只裁一次；事件读回仅一条。
{
  const storage = new FakeStorage().namespace('a1');
  let time = Date.parse('2026-10-19T10:00:00.000Z');
  const service = new NotificationService(storage, {}, {now: () => time, idFactory: () => 'a1-batch'});
  const first = service.ingest([item('one')]);
  const second = service.ingest([item('one')]);
  const batches = service.drain().batches;
  const page = service.readBatchEvents();
  record('A1-dedup', '事件去重', {passed: first.accepted === 1 && second.accepted === 0 && second.duplicates === 1
    && batches.length === 1 && page.events.length === 1 && page.events[0].batchId === 'a1-batch',
    detail: `accepted=${first.accepted}/${second.accepted} duplicates=${second.duplicates} batches=${batches.length} events=${page.events.length}`});
}

// A2 同资源写入串行与 CAS：todo 保存路径拒绝旧 revision，不丢失更新。
{
  const storage = new FakeStorage().namespace('a2');
  let time = Date.parse('2026-10-19T10:00:00.000Z');
  const service = new TodoService(storage, {now: () => time, idFactory: () => 'a2-todo'});
  const created = service.create({title: '原始待办'});
  const updated = service.update(created.id, {title: '第一次修改'});
  const stale = {...created, title: '基于旧版本的迟到写入'};
  let staleRejected = false;
  try { service.save(stale); } catch (error) { staleRejected = error.code === 'INVALID_ARGUMENT' && /Revision must increase/.test(error.message); }
  const after = service.get(created.id);
  record('A2-write-cas', '同资源写回CAS（过期修订拒绝）', {passed: updated.revision === created.revision + 1 && staleRejected
    && after.title === '第一次修改' && after.revision === updated.revision,
    detail: `created.r${created.revision}→updated.r${updated.revision} staleRejected=${staleRejected} final="${after.title}"`});
}

// A3 分支部分成功：两条独立批次，仅确认其一，另一分支不受阻塞。
{
  const storage = new FakeStorage().namespace('a3');
  let time = Date.parse('2026-10-19T10:00:00.000Z');
  let ids = 0;
  const service = new NotificationService(storage, {}, {now: () => time, idFactory: () => `a3-batch-${++ids}`});
  service.ingest([item('branch-a')]);
  const first = service.drain().batches;
  time += 1000;
  service.ingest([item('branch-b')]);
  const second = service.drain().batches;
  // drain re-returns unacknowledged batches by design; dedupe by identity.
  const seen = new Set();
  const batches = [...first, ...second].filter(batch => !seen.has(batch.id) && seen.add(batch.id));
  assert.equal(batches.length, 2);
  service.acknowledge(batches[0].id);
  const status = service.status();
  const page = service.readBatchEvents();
  record('A3-partial-branch', '批次部分确认（一交付一待办）', {passed: status.unacknowledgedBatches === 1
    && page.events.filter(event => event.state === 'delivered').length === 1
    && page.events.filter(event => event.state === 'ready_for_delivery').length === 1,
    detail: `unacknowledged=${status.unacknowledgedBatches} delivered=${page.events.filter(e => e.state === 'delivered').length} pending=${page.events.filter(e => e.state === 'ready_for_delivery').length}`});
}

// A4 修改失效：写入使快照版本前进后，旧版本续页读到 changed 空页（#391 协议）。
{
  const storage = new FakeStorage().namespace('a4');
  let time = Date.parse('2026-10-19T10:00:00.000Z');
  let ids = 0;
  const service = new NotificationService(storage, {}, {now: () => time, idFactory: () => `a4-batch-${++ids}`});
  service.ingest([item('first')]);
  service.drain();
  const firstPage = service.readBatchEvents({limit: 1});
  assert.equal(firstPage.events.length, 1);
  time += 1000;
  service.ingest([item('second')]);
  service.drain();
  const stalePage = service.readBatchEvents({sinceBatchId: firstPage.events[0].batchId,
    snapshotRevision: firstPage.snapshotRevision, limit: 1});
  const freshPage = service.readBatchEvents({limit: 10});
  record('A4-modification-invalidation', '旧快照版本续页拒绝（分页层修改失效）', {passed: stalePage.cursorState === 'changed' && stalePage.events.length === 0
    && freshPage.cursorState === 'current' && freshPage.events.length === 2,
    detail: `staleCursor=${stalePage.cursorState} staleEvents=${stalePage.events.length} freshEvents=${freshPage.events.length}`});
}

// Part B：定向用例断言——按名过滤运行，并断言目标用例确实执行且通过（非套件泛跑）。
const delegated = [
  {id: 'B1-cancel-terminal', family: '取消终态语义（定向用例）', file: 'apps/runtime/test/runtime.test.mjs',
   pattern: 'cancel', mustRun: /cancel/i},
  {id: 'B2-unknown-no-retry', family: '未知结果不自动重试（定向用例）', file: 'packages/coding-tools/test/ci-fix.test.mjs',
   pattern: 'unknown patch is persisted and never automatically retried', mustRun: /never automatically retried/i},
];
for (const suite of delegated) {
  let output = '';
  try {
    output = execFileSync(process.execPath, ['--test', '--test-name-pattern', suite.pattern, path.join(root, suite.file)],
      {encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024, shell: false, env: {...process.env}});
  } catch (error) { output = String(error.stdout ?? '') + String(error.stderr ?? ''); }
  const normalized = output.replace(/ℹ/g, '');
  const tally = /tests (\d+)[\s\S]*?pass (\d+)[\s\S]*?fail (\d+)[\s\S]*?skipped (\d+)/.exec(normalized);
  // 定向判定：过滤后确有用例被执行（tests>0 且 skipped<tests），目标名出现在执行清单，
  // 且全部执行用例通过、零失败。
  const executedNames = (output.match(/^\u2714 [^\n]*$/gm) ?? []).join('\n');
  const passed = !!tally && Number(tally[1]) > 0 && Number(tally[3]) === 0
    && Number(tally[4]) < Number(tally[1])
    && suite.mustRun.test(executedNames);
  record(suite.id, suite.family, {passed,
    detail: tally ? `pattern="${suite.pattern}" tests=${tally[1]} pass=${tally[2]} fail=${tally[3]} skip=${tally[4]} suite=${suite.file}` : `tally missing for ${suite.file}`});
}

const failed = checks.filter(check => !check.passed);
const report = {generatedAt: new Date().toISOString(), scope: 'BUSINESS-CONSUMERS #354 缺口4 汇总验收（公开合成数据，无凭据/网络/云端调用）',
  summary: {total: checks.length, passed: checks.length - failed.length, failed: failed.length}, checks};
const out = path.join(root, 'docs/competition/evidence/business-consumers-20261019/acceptance-checks.json');
mkdirSync(path.dirname(out), {recursive: true});
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({summary: report.summary, output: out}));
process.exitCode = failed.length ? 1 : 0;
