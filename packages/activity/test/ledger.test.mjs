import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  createActivityLedger, fromAutonomyAudit, fromPluginAction, fromProactiveOutcome, fromRepairDecision,
} from '../dist/index.js';

function ids(start = 0) {
  let n = start;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
}

function ledger(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'activity-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  let clock = Date.parse('2026-11-11T04:15:00.000Z');
  return createActivityLedger({
    file: path.join(root, 'ledger.jsonl'),
    now: () => new Date(clock++),
    idFactory: ids(),
  });
}

test('plugin install and enable can be undone, and the original line stays', async t => {
  const book = ledger(t);
  const installed = book.append(fromPluginAction({pluginId: 'skill.notes', action: 'install', risk: 'low', result: 'succeeded', generation: 1}));
  book.append(fromPluginAction({pluginId: 'skill.notes', action: 'enable', risk: 'high', result: 'succeeded', generation: 2}));
  const failed = book.append(fromPluginAction({pluginId: 'skill.notes', action: 'install', risk: 'low', result: 'failed'}));
  assert.equal(failed.compensation, undefined);
  const page = book.list(new Set(['plugin']));
  assert.equal(page.items[0].undoable, false);
  assert.equal(page.items[1].summary, '启用插件 skill.notes');
  assert.equal(page.items[1].undoable, true);
  assert.equal(page.items[2].undoable, true);
  const calls = [];
  await book.undo(installed.id, compensation => { calls.push(compensation); });
  const after = book.list(new Set(['plugin']));
  assert.deepEqual(calls, [{action: 'uninstall', ref: 'skill.notes'}]);
  assert.equal(after.items[0].result, 'compensated');
  assert.equal(after.items[0].undoable, false);
  assert.equal(after.items.at(-1).undoable, false);
  assert.equal(after.items.at(-1).summary, '安装插件 skill.notes');
  await assert.rejects(book.undo(installed.id, () => {}), {code: 'REVISION_CONFLICT'});
  await assert.rejects(book.undo(failed.id, () => {}), {code: 'UNSUPPORTED_CAPABILITY'});
});

test('the same plugin generation is not appended twice', t => {
  const book = ledger(t);
  const first = book.append(fromPluginAction({pluginId: 'mcp.files', action: 'install', risk: 'medium', result: 'succeeded', generation: 1}));
  const second = book.append(fromPluginAction({pluginId: 'mcp.files', action: 'install', risk: 'medium', result: 'succeeded', generation: 1}));
  assert.equal(second.id, first.id);
  assert.equal(book.list(new Set(['plugin'])).items.length, 1);
});

test('undo stays hidden until that source can actually compensate', t => {
  const book = ledger(t);
  book.append(fromAutonomyAudit({
    auditId: 'audit-1', toolName: 'todo.create', tier: 'medium', disposition: 'execute_and_notify',
    compensatable: true, rollback: 'available', reason: '有补偿的本地修改', compensationToolName: 'todo.update',
  }));
  assert.equal(book.list(new Set(['plugin'])).items[0].undoable, false);
  assert.equal(book.list(new Set(['autonomy'])).items[0].undoable, true);
  assert.equal(book.list(new Set(['autonomy'])).items[0].why.basis.includes('todo.update'), true);
  assert.equal(JSON.stringify(book.list(new Set(['autonomy']))).includes('arguments'), false);
});

test('adapters reject message bodies and argument plaintext', t => {
  const book = ledger(t);
  assert.throws(() => fromAutonomyAudit({
    auditId: 'audit-2', toolName: 'todo.create', tier: 'low', disposition: 'execute',
    compensatable: false, rollback: 'unavailable', reason: '低风险只读', arguments: {title: 'secret'},
  }), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => fromProactiveOutcome({
    eventId: 'event-1', source: 'mail', kind: 'mail.arrived', status: 'submitted', risk: 'low', summary: '会议改到三点，正文见内文',
  }), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => fromRepairDecision({
    fingerprint: 'a'.repeat(64), strategy: 'backoff_retry', classification: 'transient', risk: 'ordinary',
    attemptResult: 'selected', reason: '用户邮件正文：请把附件发给对方',
  }), {code: 'INVALID_ARGUMENT'});
  const proactive = book.append(fromProactiveOutcome({
    eventId: 'event-1', source: 'calendar', kind: 'calendar.rescheduled', status: 'waiting_approval',
    ruleId: 'calendar.reschedule', risk: 'high',
  }));
  assert.equal(proactive.summary, '主动触发：日历改期');
  assert.equal(proactive.result, 'asked');
  assert.equal(proactive.why.trigger, '日历 · calendar.rescheduled');
  const repair = book.append(fromRepairDecision({
    fingerprint: 'b'.repeat(64), strategy: 'backoff_retry', classification: 'transient', risk: 'ordinary',
    attemptResult: 'selected', reason: 'transient: backoff retry', compensationRef: 'comp-1',
  }));
  assert.equal(repair.summary, '失败自愈：指数退避重试');
  assert.equal(repair.compensation.action, 'stop_retry');
  assert.equal(repair.why.basis, 'transient: backoff retry');
  const irreversible = book.append(fromAutonomyAudit({
    auditId: 'audit-3', toolName: 'mail.send', tier: 'high', irreversible: true, disposition: 'execute',
    compensatable: false, rollback: 'unavailable', reason: '不可逆，先问',
  }));
  assert.equal(irreversible.risk, 'irreversible');
  assert.equal(irreversible.compensation, undefined);
});

test('reloading the file keeps every line and does not rewrite earlier ones', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'activity-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const file = path.join(root, 'ledger.jsonl');
  const first = createActivityLedger({file, now: () => new Date('2026-11-11T04:15:00.000Z'), idFactory: ids()});
  first.append(fromPluginAction({pluginId: 'skill.notes', action: 'enable', risk: 'low', result: 'succeeded', generation: 2}));
  const before = readFileSync(file, 'utf8');
  const second = createActivityLedger({file, now: () => new Date('2026-11-11T05:00:00.000Z'), idFactory: ids(10)});
  await second.undo(second.list(new Set(['plugin'])).items[0].id, () => {});
  assert.equal(readFileSync(file, 'utf8').startsWith(before), true);
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2);
});
