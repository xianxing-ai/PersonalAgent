// F3 / F4 审阅问题的回归测试：派单预算不再信任调用方自报的 rootRequestId，
// sendMessage 的 hop 由 store 依据 replyToMessageId 推导，并新增消息条数与速率上限。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CrewError,
  CrewStore,
  CREW_PARENT_AGENT_ID,
  MAX_MESSAGE_HOP,
} from '../dist/index.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));
mkdirSync(root, {recursive: true});
const dbFile = () => join(mkdtempSync(join(root, 'mb-')), 'crew.sqlite');

function open(options = {}) {
  let clock = 1700000000000;
  const now = () => (clock += 1000);
  return CrewStore.open(dbFile(), {...options, now: options.now ?? now});
}

function twoAgents(store) {
  store.registerAgent({agentId: 'a', displayName: '甲', driver: 'codex', instructions: 'x', workspacePath: '/w/a'});
  store.registerAgent({agentId: 'b', displayName: '乙', driver: 'claude', instructions: 'x', workspacePath: '/w/b'});
  return ['a', 'b'];
}

// ── F3：派单预算按 crew 自己维护的根计数 ─────────────────────────────────────

test('dispatch derives its own root: no parentTaskId means a fresh root per task', () => {
  const store = open();
  try {
    store.registerAgent({agentId: 'a', displayName: '甲', driver: 'codex', instructions: 'x', workspacePath: '/w/a'});
    const task = store.dispatchTask({taskId: 't1', assignedAgentId: 'a', goal: '第一个根'});
    assert.equal(task.rootRequestId, 'root-t1');
    const inbox = store.receiveMessages('a');
    assert.equal(inbox[0].parentRequestId, 'root-t1');
    assert.equal(inbox[0].rootRequestId, 'root-t1');
    // 调用方自报的 rootRequestId 只是展示/关联字段：不影响派单预算与归属。
    const other = store.dispatchTask({taskId: 't2', rootRequestId: 'whatever-display', assignedAgentId: 'a', goal: '自报根不参与计数'});
    assert.equal(other.rootRequestId, 'root-t2');
    const viaParent = store.dispatchTask({taskId: 't3', parentTaskId: 't1', rootRequestId: 'display-rotated', assignedAgentId: 'a', goal: '父任务派生'});
    assert.equal(viaParent.rootRequestId, 'root-t1');
  } finally { store.close(); }
});

test('rotating the caller-supplied rootRequestId cannot bypass the 8-dispatch budget', () => {
  const store = open();
  try {
    store.registerAgent({agentId: 'a', displayName: '甲', driver: 'codex', instructions: 'x', workspacePath: '/w/a'});
    store.dispatchTask({taskId: 't1', assignedAgentId: 'a', goal: '根任务'});
    for (let i = 2; i <= 9; i++) {
      if (i < 9) store.dispatchTask({taskId: `t${i}`, parentTaskId: 't1', assignedAgentId: 'a', goal: `第 ${i - 1} 次派单`});
    }
    // 第 9 次派单：换一个全新的自报 rootRequestId 也无法绕过。
    assert.throws(
      () => store.dispatchTask({taskId: 't9', parentTaskId: 't1', rootRequestId: 'brand-new-root-x', assignedAgentId: 'a', goal: '换根也绕不过'}),
      error => error instanceof CrewError && error.code === 'DISPATCH_LIMIT_EXCEEDED',
    );
  } finally { store.close(); }
});

test('the per-parent-agent active (queued/running) task cap is enforced and configurable', () => {
  const store = open({maxActiveTasksPerParentAgent: 3});
  try {
    store.registerAgent({agentId: 'a', displayName: '甲', driver: 'codex', instructions: 'x', workspacePath: '/w/a'});
    for (let i = 1; i <= 3; i++) store.dispatchTask({taskId: `t${i}`, assignedAgentId: 'a', goal: `任务 ${i}`});
    assert.throws(
      () => store.dispatchTask({taskId: 't4', assignedAgentId: 'a', goal: '第 4 个非终态任务'}),
      error => error instanceof CrewError && error.code === 'DISPATCH_LIMIT_EXCEEDED',
    );
    // 完成一个任务后腾出名额。
    store.claimNextTask('a');
    store.completeTask('t1', {status: 'succeeded', result: 'done', evidenceRefs: [], unblock: ''});
    store.dispatchTask({taskId: 't4', assignedAgentId: 'a', goal: '腾出名额后可以派'});
  } finally { store.close(); }
});

// ── F4：hop 由 store 依据 replyToMessageId 推导 ─────────────────────────────

test('hop is derived by the store: fresh messages are hop 0, replies are hop+1 and bounded', () => {
  const store = open();
  try {
    const [, b] = twoAgents(store);
    const first = store.sendMessage({fromAgentId: 'a', toAgentId: 'b', text: '开始对话'});
    assert.equal(first.hop, 0);
    const reply = store.sendMessage({fromAgentId: 'b', toAgentId: 'a', text: '回复', replyToMessageId: first.messageId});
    assert.equal(reply.hop, 1);
    assert.equal(reply.taskId, undefined);
    // 回复目标必须存在，且回信人必须是那条消息的当前持有者。
    assert.throws(() => store.sendMessage({fromAgentId: 'a', toAgentId: 'b', text: 'x', replyToMessageId: 999999}), error => error instanceof CrewError && error.code === 'NOT_FOUND');
    assert.throws(() => store.sendMessage({fromAgentId: 'a', toAgentId: 'b', text: 'x', replyToMessageId: first.messageId}), error => error instanceof CrewError && error.code === 'INVALID_INPUT');
    // 调用方不能再自填 hop：hop 字段被忽略，不再存在。
    const direct = store.sendMessage({fromAgentId: 'a', toAgentId: 'b', text: 'hop 由 store 决定', hop: 5});
    assert.equal(direct.hop, 0);
  } finally { store.close(); }
});

test('a 1000-message ping-pong between two agents is rejected', () => {
  const store = open();
  try {
    twoAgents(store);
    let current = store.sendMessage({fromAgentId: 'a', toAgentId: 'b', text: '乒乓开始', expectsReply: true});
    let from = 'b';
    let hops = [current.hop];
    let rejected = false;
    for (let i = 1; i < 1000; i++) {
      let next;
      try {
        next = store.sendMessage({fromAgentId: from, toAgentId: from === 'a' ? 'b' : 'a', text: `乒乓 ${i}`, replyToMessageId: current.messageId});
      } catch (error) {
        assert.ok(error instanceof CrewError);
        rejected = true;
        break;
      }
      current = next;
      hops.push(next.hop);
      from = from === 'a' ? 'b' : 'a';
    }
    assert.equal(rejected, true, 'the ping-pong loop must be rejected before 1000 messages');
    assert.equal(Math.max(...hops), MAX_MESSAGE_HOP, 'hops climb to the budget before rejection');
    assert.equal(hops.length < 1000, true);
  } finally { store.close(); }
});

test('message budget per root and per-pair rate limit are enforced and configurable', () => {
  const store = open({maxMessagesPerRoot: 3, maxMessagesPerMinutePerPair: 10});
  try {
    store.registerAgent({agentId: 'a', displayName: '甲', driver: 'codex', instructions: 'x', workspacePath: '/w/a'});
    store.registerAgent({agentId: 'b', displayName: '乙', driver: 'claude', instructions: 'x', workspacePath: '/w/b'});
    store.dispatchTask({taskId: 't1', assignedAgentId: 'a', goal: '根任务'});
    // 每根消息条数上限（含派单消息）：root-t1 已有 1 条 task 消息。
    store.sendMessage({fromAgentId: CREW_PARENT_AGENT_ID, toAgentId: 'a', text: '1', rootRequestId: 'root-t1'});
    store.sendMessage({fromAgentId: CREW_PARENT_AGENT_ID, toAgentId: 'a', text: '2', rootRequestId: 'root-t1'});
    assert.throws(
      () => store.sendMessage({fromAgentId: CREW_PARENT_AGENT_ID, toAgentId: 'a', text: '3', rootRequestId: 'root-t1'}),
      error => error instanceof CrewError && error.code === 'RATE_LIMIT_EXCEEDED',
    );
    // 不带 root 的新消息不受根预算约束，但受每对速率约束（同一分钟内最多 10 条）。
    for (let i = 1; i <= 10; i++) store.sendMessage({fromAgentId: 'a', toAgentId: 'b', text: `r${i}`});
    assert.throws(
      () => store.sendMessage({fromAgentId: 'a', toAgentId: 'b', text: 'r11'}),
      error => error instanceof CrewError && error.code === 'RATE_LIMIT_EXCEEDED',
    );
  } finally { store.close(); }
});

test('spoofed rootRequestId/taskId that the sender does not participate in is rejected', () => {
  const store = open();
  try {
    const [a] = twoAgents(store);
    store.registerAgent({agentId: 'c', displayName: '丙', driver: 'opencode', instructions: 'x', workspacePath: '/w/c'});
    store.dispatchTask({taskId: 't1', assignedAgentId: 'a', goal: 'a 的任务'});
    assert.throws(
      () => store.sendMessage({fromAgentId: 'b', toAgentId: 'c', text: '冒用别人的任务', taskId: 't1'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    assert.throws(
      () => store.sendMessage({fromAgentId: 'b', toAgentId: 'c', text: '冒用别人的根', rootRequestId: 'root-t1'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    assert.throws(
      () => store.sendMessage({fromAgentId: 'b', toAgentId: 'c', text: '不存在的任务', taskId: 'missing-task'}),
      error => error instanceof CrewError && error.code === 'NOT_FOUND',
    );
    // 参与者本人可以带上自己的 taskId/rootRequestId。
    store.sendMessage({fromAgentId: a, toAgentId: 'c', text: '我自己的任务上下文', taskId: 't1', rootRequestId: 'root-t1'});
  } finally { store.close(); }
});

test('pure-ack suppression resists the ok/content/ok alternation within a conversation', () => {
  const store = open();
  try {
    const [a, b] = twoAgents(store);
    assert.equal(store.sendMessage({fromAgentId: a, toAgentId: b, text: 'ok'}).pureAck, true, 'first ack is kept');
    store.sendMessage({fromAgentId: a, toAgentId: b, text: '实质内容：修改意见见附件'});
    assert.equal(store.sendMessage({fromAgentId: a, toAgentId: b, text: 'ok'}), undefined, 'ack after content in the same conversation is still suppressed');
    // 收到对方的新消息后，确认窗口重置，可以再次确认。
    store.sendMessage({fromAgentId: b, toAgentId: a, text: '反向实质回复'});
    assert.equal(store.sendMessage({fromAgentId: a, toAgentId: b, text: '好的'}).pureAck, true, 'ack after receiving a new peer message is allowed');
    assert.deepEqual(store.receiveMessages('b').map(m => m.text), ['ok', '实质内容：修改意见见附件', '好的']);
  } finally { store.close(); }
});
