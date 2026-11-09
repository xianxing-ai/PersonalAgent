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

test('F06_N03 todo.registered_write：注册待办写口与幂等键透传', async () => {
  let invoked = null;
  const port = createTodoRegisteredWriteHostPort({
    write: {
      execute: async (op, input) => {
        invoked = {op, input};
        return {id: 'todo-1', title: input.title, state: 'created'};
      },
    },
    resolveWrite: () => ({title: '买牛奶', dueUtc: '2026-11-10T10:00:00.000Z', idempotencyKey: 'idem-1'}),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.idempotencyKey, 'idem-1');
  assert.equal(res.value.source, 'todo_write_receipt');
  assert.equal(invoked.input.title, '买牛奶');

  // 缺输入报错 unavailable
  const unavail = createTodoRegisteredWriteHostPort({
    write: {execute: async () => ({})},
    resolveWrite: () => undefined,
  });
  assert.equal((await unavail.read(context())).state, 'unavailable');
});

test('F06_N04 reminder.current_clock_and_revision：实际时钟与版本到期核对', async () => {
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
});

test('F07_N04 calendar.freshness_check：单条 Sequence 与窗口新鲜度校验', async () => {
  const port = createCalendarFreshnessCheckHostPort({
    calendarPort: {
      execute: async (op, input) => {
        if (op === 'calendar.get') return {externalId: 'evt-1', sequence: 3, title: '晨会'};
        if (op === 'calendar.events') return {items: [{externalId: 'evt-1'}]};
        throw new Error('bad op');
      },
    },
    resolveTarget: () => ({accountRef: 'cal-acc', externalId: 'evt-1', expectedSequence: 3}),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.fresh, true);
  assert.equal(res.value.currentSequence, 3);
  assert.equal(res.value.source, 'calendar_readback');
});

test('F07_N05 calendar.registered_write：注册日历创建写口', async () => {
  const port = createCalendarRegisteredWriteHostPort({
    calendarPort: {
      execute: async (op, input) => ({item: {externalId: input.externalId ?? 'evt-new', title: input.summary}, state: 'created'}),
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
  assert.equal(res.value.source, 'calendar_write_receipt');
});

test('F11_N05 calendar.update_and_invalidate_reminder：改期与提醒作废联动', async () => {
  let invalidatedId = null;
  const port = createCalendarUpdateAndInvalidateReminderHostPort({
    calendarPort: {
      execute: async (op, input) => ({item: {externalId: input.externalId, sequence: 4}, state: 'updated'}),
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
    }),
  });
  const res = await port.read(context({template: {workflowId: 'F11'}, node: {id: 'F11_N05'}}));
  assert.equal(res.state, 'completed');
  assert.equal(invalidatedId, 'rem-old-1');
  assert.equal(res.value.invalidationReceipt.reminderId, 'rem-old-1');
  assert.equal(res.value.source, 'calendar_reminder_sync');
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

test('F08_N07 mail.registered_send：稳定操作 ID 发送与 unknown 态保真', async () => {
  const port = createMailRegisteredSendHostPort({
    mailPort: {
      execute: async (op, input) => ({state: 'confirmed', messageId: 'msg-sent-1'}),
    },
    resolveSend: () => ({accountRef: 'mail', to: 'a@b.com', subject: 'hi', text: 'body', idempotencyKey: 'k1'}),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.state, 'confirmed');
  assert.equal(res.value.messageId, 'msg-sent-1');

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

test('F16_N01 github.bound_ci_failure：提交绑定与失败日志读回', async () => {
  const port = createGithubBoundCiFailureHostPort({
    read: {
      execute: async (op) => {
        if (op === 'actions.run.get') return {id: 1001, conclusion: 'failure'};
        if (op === 'actions.job.list') return [{id: 2001, name: 'build-and-test', conclusion: 'failure'}];
        if (op === 'actions.log.read') return 'Error: Test failed at line 42\nStack trace...';
        throw new Error('unsupported');
      },
    },
    resolveBinding: () => ({owner: 'xianxing-ai', repo: 'PersonalAgent', commitSha: 'c0ffee'}),
  });
  const res = await port.read(context());
  assert.equal(res.state, 'completed');
  assert.equal(res.value.conclusion, 'failure');
  assert.equal(res.value.failedJobCount, 1);
  assert.match(res.value.logExcerpt, /Test failed/);
  assert.equal(res.value.source, 'ci_failure_readback');
});

test('F16_N04 workspace.test_intent_check：审查修复补丁是否保留真实验收意图', async () => {
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
+++ b/test/a.test.mjs
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
});
