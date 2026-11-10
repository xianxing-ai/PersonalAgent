// F06/F07/F08/F09/F11/F16 业务与开发工作流 host 端口定向测试
// 运行：node --test packages/agentarts/test/business-workflow-hosts.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTodoRegisteredWriteHostPort,
  createReminderClockRevisionHostPort,
  createCalendarFreshnessCheckHostPort,
  createCalendarRegisteredWriteHostPort,
  createCalendarUpdateAndInvalidateReminderHostPort,
} from '../dist/f06-f07-f11-business-hosts.js';
import {
  createMailRegisteredArchiveHostPort,
  createMailRegisteredSendHostPort,
  createFeedsValidateAndDeduplicateHostPort,
} from '../dist/f08-f09-business-hosts.js';
import {
  createGithubBoundCiFailureHostPort,
  createWorkspaceTestIntentCheckHostPort,
} from '../dist/f16-dev-workflows-hosts.js';

const deadline = new Date(Date.now() + 60_000).toISOString();
const signal = new AbortController().signal;
const context = (overrides = {}) => ({
  template: {workflowId: 'F06'},
  node: {id: 'F06_N03'},
  input: {},
  predecessorOutputs: {},
  availableTools: [],
  predecessorStates: {},
  deadline, signal, requestId: 'req-biz-1', mode: 'ordinary', namespace: 'ns-1',
  ...overrides,
});

test('F06_N03 todo.registered_write：注册待办写口、schema 对齐与宿主侧幂等账本', async () => {
  const calls = [];
  let currentInput = {title: '买牛奶', dueUtc: '2026-11-10T10:00:00.000Z', idempotencyKey: 'idem-1', listId: 'inbox'};
  const port = createTodoRegisteredWriteHostPort({
    write: {
      execute: async (op, input) => {
        calls.push({op, input});
        return {id: 'todo-1', title: input.title, state: 'created'};
      },
    },
    resolveWrite: () => currentInput,
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.idempotencyKey, 'idem-1');
  assert.equal(res.value.replayed, false);
  assert.equal(res.value.source, 'todo_write_receipt');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.title, '买牛奶');
  // 确保未向底层 todo.create 透传 schema 外字段 idempotencyKey / listId
  assert.equal('idempotencyKey' in calls[0].input, false);
  assert.equal('listId' in calls[0].input, false);

  // 同幂等键同载荷再次调用：直接重放，不重复调用底层连接器
  const replayRes = await port.read(context());
  assert.equal(replayRes.state, 'completed');
  assert.equal(replayRes.value.replayed, true);
  assert.equal(calls.length, 1);

  // 同幂等键不同载荷：报错 todo_idempotency_conflict
  currentInput = {title: '买咖啡', dueUtc: '2026-11-10T10:00:00.000Z', idempotencyKey: 'idem-1', listId: 'inbox'};
  const conflictRes = await port.read(context());
  assert.equal(conflictRes.state, 'failed');
  assert.equal(conflictRes.value.reason, 'todo_idempotency_conflict');

  // 缺输入报错 unavailable
  const unavail = createTodoRegisteredWriteHostPort({
    write: {execute: async () => ({})},
    resolveWrite: () => undefined,
  });
  assert.equal((await unavail.read(context())).state, 'unavailable');
});

test('F06_N04 reminder.current_clock_and_revision：实际时钟、版本到期核对与非法时间失败', async () => {
  const port = createReminderClockRevisionHostPort({
    reminderPort: {
      getReminder: async () => ({reminderId: 'rem-1', revision: 2, dueUtc: '2026-11-09T12:00:00.000Z', state: 'active'}),
      nowUtc: () => '2026-11-09T13:00:00.000Z',
    },
    resolveTarget: () => ({reminderId: 'rem-1', expectedRevision: 2}),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.isDue, true);
  assert.equal(res.value.revisionMatch, true);
  assert.equal(res.value.source, 'reminder_clock_readback');

  // 非法 dueUtc 必须返回 failed（严禁伪装成 completed + isDue: false）
  const badPort = createReminderClockRevisionHostPort({
    reminderPort: {
      getReminder: async () => ({reminderId: 'rem-bad', revision: 1, dueUtc: 'not-a-valid-date', state: 'active'}),
      nowUtc: () => '2026-11-09T13:00:00.000Z',
    },
    resolveTarget: () => ({reminderId: 'rem-bad'}),
  });
  const badRes = await badPort.read(context());
  assert.equal(badRes.state, 'failed');
  assert.equal(badRes.value.reason, 'reminder_due_utc_invalid');
});

test('F07_N04 calendar.freshness_check：基于 calendar.events 的单条 Sequence 与缺失 sequence 未知态校验', async () => {
  const port = createCalendarFreshnessCheckHostPort({
    calendarPort: {
      execute: async (op) => {
        if (op === 'calendar.events') return {items: [{externalId: 'evt-1', sequence: 3, title: '晨会'}]};
        throw new Error(`unexpected op: ${op}`);
      },
    },
    resolveTarget: () => ({accountRef: 'cal-acc', externalId: 'evt-1', expectedSequence: 3}),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.fresh, true);
  assert.equal(res.value.currentSequence, 3);
  assert.equal(res.value.source, 'calendar_readback');

  // 缺失 sequence 字段时返回 unknown（不回退为 0）
  const noSeqPort = createCalendarFreshnessCheckHostPort({
    calendarPort: {
      execute: async () => ({items: [{externalId: 'evt-1', title: '无序列号日程'}]}),
    },
    resolveTarget: () => ({accountRef: 'cal-acc', externalId: 'evt-1', expectedSequence: 0}),
  });
  const noSeqRes = await noSeqPort.read(context());
  assert.equal(noSeqRes.state, 'unknown');
  assert.equal(noSeqRes.value.reason, 'calendar_sequence_unavailable');
});

test('F07_N05 calendar.registered_write：注册日历创建/更新写口并透传 accountRef', async () => {
  let receivedInput = null;
  const port = createCalendarRegisteredWriteHostPort({
    calendarPort: {
      execute: async (op, input) => {
        receivedInput = {op, input};
        return {item: {externalId: input.externalId ?? 'evt-new', title: input.summary}, state: 'created'};
      },
    },
    resolveWrite: () => ({
      accountRef: 'cal',
      summary: '产品评审',
      startUtc: '2026-11-10T09:00:00.000Z',
      endUtc: '2026-11-10T10:00:00.000Z',
      externalId: 'evt-pre-1',
    }),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.externalId, 'evt-pre-1');
  assert.equal(res.value.accountRef, 'cal');
  assert.equal(receivedInput.input.accountRef, 'cal');
  assert.equal(res.value.source, 'calendar_write_receipt');
});

test('F11_N05 calendar.update_and_invalidate_reminder：改期与提醒作废联动及部分写成功 unknown 对账保真', async () => {
  let invalidatedId = null;
  let calendarInput = null;
  const port = createCalendarUpdateAndInvalidateReminderHostPort({
    calendarPort: {
      execute: async (op, input) => {
        calendarInput = input;
        return {item: {externalId: input.externalId}, sequence: 4, state: 'updated'};
      },
    },
    invalidationPort: {
      invalidateReminder: async (id) => {
        invalidatedId = id;
        return {reminderId: id, invalidated: true, state: 'invalidated'};
      },
    },
    resolveInput: () => ({
      accountRef: 'cal',
      externalId: 'evt-1',
      summary: '推迟到下午',
      startUtc: '2026-11-10T14:00:00.000Z',
      endUtc: '2026-11-10T15:00:00.000Z',
      reminderId: 'rem-old-1',
      previousSequence: 3,
    }),
  });
  const res = await port.read(context({template: {workflowId: 'F11'}, node: {id: 'F11_N05'}}));
  assert.equal(res.state, 'completed');
  assert.equal(calendarInput.accountRef, 'cal');
  assert.equal(invalidatedId, 'rem-old-1');
  assert.equal(res.value.invalidationReceipt.reminderId, 'rem-old-1');
  assert.equal(res.value.source, 'calendar_reminder_sync');

  // 日历更新已成功但作废提醒失败：返回 unknown 并保留 calendarReceipt 供对账
  const partialPort = createCalendarUpdateAndInvalidateReminderHostPort({
    calendarPort: {
      execute: async (_op, input) => ({externalId: input.externalId, sequence: 5, state: 'updated'}),
    },
    invalidationPort: {
      invalidateReminder: async () => ({reminderId: 'rem-old-1', invalidated: false, state: 'active'}),
    },
    resolveInput: () => ({
      accountRef: 'cal',
      externalId: 'evt-1',
      summary: '推迟到下午',
      reminderId: 'rem-old-1',
      previousSequence: 4,
    }),
  });
  const partialRes = await partialPort.read(context({template: {workflowId: 'F11'}, node: {id: 'F11_N05'}}));
  assert.equal(partialRes.state, 'unknown');
  assert.equal(partialRes.value.reason, 'reminder_invalidation_failed');
  assert.equal(partialRes.value.calendarReceipt.externalId, 'evt-1');
});

test('F08_N03 mail.registered_archive：受控归档并读回核验', async () => {
  const port = createMailRegisteredArchiveHostPort({
    mailPort: {
      execute: async (op, input) => ({archived: true, messageId: input.messageId, folder: input.targetFolder}),
    },
    resolveArchive: () => ({accountRef: 'mail-work', messageId: 'msg-123', targetFolder: 'Archive'}),
  });
  const res = await port.read(context({template: {workflowId: 'F08'}, node: {id: 'F08_N03'}}));
  assert.equal(res.state, 'completed');
  assert.equal(res.value.messageId, 'msg-123');
  assert.equal(res.value.confirmed, true);
  assert.equal(res.value.source, 'mail_archive_receipt');
});

test('F08_N07 mail.registered_send：兼容 externalId/messageId 发送回执与 unknown 态保真', async () => {
  const port = createMailRegisteredSendHostPort({
    mailPort: {
      execute: async () => ({state: 'confirmed', externalId: '<msg-sent-1@local>'}),
    },
    resolveSend: () => ({accountRef: 'mail', to: 'a@b.com', subject: 'hi', text: 'body', idempotencyKey: 'k1'}),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.state, 'confirmed');
  assert.equal(res.value.messageId, '<msg-sent-1@local>');
  assert.equal(res.value.externalId, '<msg-sent-1@local>');

  // unknown 态核对触发
  const unknownPort = createMailRegisteredSendHostPort({
    mailPort: {
      execute: async () => ({state: 'unknown', reason: 'timeout'}),
    },
    resolveSend: () => ({accountRef: 'mail', to: 'a@b.com', subject: 'hi', text: 'body', idempotencyKey: 'k2'}),
  });
  const unk = await unknownPort.read(context());
  assert.equal(unk.state, 'unknown');
  assert.equal(unk.value.state, 'unknown');
  assert.equal(unk.value.idempotencyKey, 'k2');
});

test('F09_N02 feeds.validate_and_deduplicate：哈希去重与格式校验', async () => {
  const port = createFeedsValidateAndDeduplicateHostPort();
  const items = [
    {feedId: 'tech', id: '1', title: '新闻1', url: 'https://news.com/1'},
    {feedId: 'tech', id: '1', title: '新闻1重复', url: 'https://news.com/1'},
    {feedId: 'tech', id: '2', title: '新闻2', url: 'https://news.com/2'},
    {invalid: true}, // 无效条目
  ];
  const res = await port.read(context({input: items}));
  assert.equal(res.state, 'completed');
  assert.equal(res.value.totalCount, 4);
  assert.equal(res.value.validCount, 2);
  assert.equal(res.value.duplicateCount, 1);
  assert.equal(res.value.invalidCount, 1);
  assert.equal(res.value.source, 'feeds_validation_receipt');
});

test('F16_N01 github.bound_ci_failure：对齐 actions.run.list/job.list/log.read 并严格核对 headSha 与 conclusion', async () => {
  let logInput = null;
  const port = createGithubBoundCiFailureHostPort({
    read: {
      execute: async (op, input) => {
        if (op === 'actions.run.list') {
          return {items: [{id: 1001, headSha: 'c0ffee', status: 'completed', conclusion: 'failure'}]};
        }
        if (op === 'actions.job.list') {
          return {items: [{id: 2001, name: 'build-and-test', status: 'completed', conclusion: 'failure'}]};
        }
        if (op === 'actions.log.read') {
          logInput = input;
          return {text: 'Error: Test failed at line 42\nStack trace...', offset: 0, nextOffset: null, truncated: false};
        }
        throw new Error(`unsupported op: ${op}`);
      },
    },
    resolveBinding: () => ({owner: 'xianxing-ai', repo: 'PersonalAgent', commitSha: 'c0ffee', runId: 1001}),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.conclusion, 'failure');
  assert.equal(res.value.headSha, 'c0ffee');
  assert.equal(res.value.failedJobCount, 1);
  assert.equal(logInput.jobId, 2001);
  assert.equal(logInput.repo, 'xianxing-ai/PersonalAgent');
  assert.match(res.value.logExcerpt, /Test failed/);
  assert.equal(res.value.source, 'ci_failure_readback');

  // 负例 1：runId 对应的 headSha 与绑定 commitSha 不一致 -> 必须报错 ci_run_head_sha_mismatch
  const mismatchPort = createGithubBoundCiFailureHostPort({
    read: {
      execute: async (op) => {
        if (op === 'actions.run.list') {
          return {items: [{id: 1001, headSha: 'other-sha', status: 'completed', conclusion: 'failure'}]};
        }
        return {};
      },
    },
    resolveBinding: () => ({owner: 'xianxing-ai', repo: 'PersonalAgent', commitSha: 'c0ffee', runId: 1001}),
  });
  const mismatchRes = await mismatchPort.read(context());
  assert.equal(mismatchRes.state, 'failed');
  assert.equal(mismatchRes.value.reason, 'ci_run_head_sha_mismatch');

  // 负例 2：run.conclusion 缺失或为 success -> 严禁伪造 failure，必须报错 ci_run_not_failed
  const notFailedPort = createGithubBoundCiFailureHostPort({
    read: {
      execute: async (op) => {
        if (op === 'actions.run.list') {
          return {items: [{id: 1001, headSha: 'c0ffee', status: 'in_progress', conclusion: null}]};
        }
        return {};
      },
    },
    resolveBinding: () => ({owner: 'xianxing-ai', repo: 'PersonalAgent', commitSha: 'c0ffee', runId: 1001}),
  });
  const notFailedRes = await notFailedPort.read(context());
  assert.equal(notFailedRes.state, 'failed');
  assert.equal(notFailedRes.value.reason, 'ci_run_not_failed');
});

test('F16_N04 workspace.test_intent_check：审查修复补丁是否保留真实验收意图（含整文件删除与 skip/only 检测）', async () => {
  const port = createWorkspaceTestIntentCheckHostPort();

  // 正例：正常修复代码逻辑，保留并增加测试断言
  const cleanPatch = `
diff --git a/packages/core/src/service.ts b/packages/core/src/service.ts
--- a/packages/core/src/service.ts
+++ b/packages/core/src/service.ts
@@ -10,1 +10,1 @@
-return false;
+return true;
diff --git a/packages/core/test/service.test.mjs b/packages/core/test/service.test.mjs
--- a/packages/core/test/service.test.mjs
+++ b/packages/core/test/service.test.mjs
@@ -20,1 +20,2 @@
 assert.equal(result, true);
+assert.equal(extraCheck, 1);
`;
  const cleanRes = await port.read(context({input: cleanPatch}));
  assert.equal(cleanRes.state, 'completed');
  assert.equal(cleanRes.value.preserved, true);

  // 负例 1：删除了测试断言
  const deletedPatch = `
diff --git a/test/a.test.mjs b/test/a.test.mjs
--- a/test/a.test.mjs
+++ a/test/a.test.mjs
@@ -10,2 +10,0 @@
-assert.equal(foo, bar);
-assert.ok(valid);
`;
  const delRes = await port.read(context({input: deletedPatch}));
  assert.equal(delRes.state, 'failed');
  assert.equal(delRes.value.preserved, false);
  assert.match(delRes.value.violations[0], /Deleted test or assertion/);

  // 负例 2：新增跳过 test.skip
  const skipPatch = `
diff --git a/test/a.test.mjs b/test/a.test.mjs
--- a/test/a.test.mjs
+++ b/test/a.test.mjs
@@ -10,1 +10,1 @@
+test.skip('flaky test', () => {});
`;
  const skipRes = await port.read(context({input: skipPatch}));
  assert.equal(skipRes.state, 'failed');
  assert.equal(skipRes.value.preserved, false);
  assert.match(skipRes.value.violations[0], /Added test skip/);

  // 负例 3：直接删除整个测试文件（+++ /dev/null 不得覆盖 inTestFile）
  const deleteFilePatch = `
diff --git a/test/foo.test.mjs b/test/foo.test.mjs
deleted file mode 100644
--- a/test/foo.test.mjs
+++ /dev/null
@@ -1,3 +0,0 @@
-test('must pass', () => {
-  assert.equal(1 + 1, 2);
-});
`;
  const deleteFileRes = await port.read(context({input: deleteFilePatch}));
  assert.equal(deleteFileRes.state, 'failed');
  assert.equal(deleteFileRes.value.preserved, false);
  assert.ok(deleteFileRes.value.violations.some((v) => v.includes('Deleted entire test file')));

  // 负例 4：使用 {skip: true} 或 describe.only 绕过测试
  const optionSkipPatch = `
diff --git a/test/bar.spec.ts b/test/bar.spec.ts
--- a/test/bar.spec.ts
+++ b/test/bar.spec.ts
@@ -5,1 +5,2 @@
+test('bypass', {skip: true}, () => {});
+describe.only('focused suite', () => {});
`;
  const optionSkipRes = await port.read(context({input: optionSkipPatch}));
  assert.equal(optionSkipRes.state, 'failed');
  assert.equal(optionSkipRes.value.preserved, false);
  assert.equal(optionSkipRes.value.violations.length, 2);
});
