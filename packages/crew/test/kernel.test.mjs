import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CrewError,
  CrewKernel,
  CREW_PARENT_AGENT_ID,
  MAX_AUTO_DISPATCHES_PER_ROOT_REQUEST,
  MAX_CONCURRENT_TASKS_PER_AGENT,
  MAX_MESSAGE_HOP,
  openCrewKernel,
} from '../dist/index.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));
mkdirSync(root, {recursive: true});
const dbFile = () => join(mkdtempSync(join(root, 'kernel-')), 'crew.sqlite');

function open(options = {}) {
  let clock = 1700000000000;
  const now = () => (clock += 1000);
  return CrewKernel.open(dbFile(), {...options, now: options.now ?? now});
}

function crew(kernel) {
  kernel.registerAgent({
    agentId: 'coder-x',
    displayName: '编码者',
    driver: 'codex',
    instructions: '在自有 worktree 内完成编码任务，并按固定回执格式汇报。',
    workspacePath: '/workspace/crew/coder-x',
  });
  kernel.registerAgent({
    agentId: 'reviewer-y',
    displayName: '评审者',
    driver: 'opencode',
    instructions: '独立审查补丁，不与作者共享结论。',
    workspacePath: '/workspace/crew/reviewer-y',
  });
}

const VALID_RECEIPT = {status: 'succeeded', result: '类型错误已修复并重跑通过', evidenceRefs: ['commit:abc1234'], unblock: ''};

test('the parent dispatches, the child claims and reports, the parent collects the result', () => {
  const kernel = open();
  try {
    crew(kernel);
    const task = kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '修复 crew 包的类型错误'});
    assert.equal(task.status, 'queued');
    const inbox = kernel.receiveMessages('coder-x');
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].senderAgentId, CREW_PARENT_AGENT_ID);
    assert.equal(inbox[0].kind, 'task');
    assert.equal(inbox[0].taskId, 't1');
    assert.equal(inbox[0].expectsReply, true, 'task messages expect a reply through the receipt format');
    assert.equal(kernel.claimNextTask('coder-x').taskId, 't1');
    const done = kernel.submitReceipt({actorId: 'coder-x', taskId: 't1', receipt: VALID_RECEIPT});
    assert.equal(done.status, 'succeeded');
    const collected = kernel.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'});
    assert.equal(collected.receipt.result, '类型错误已修复并重跑通过');
    assert.deepEqual([...collected.receipt.evidenceRefs], ['commit:abc1234']);
    assert.deepEqual(kernel.listTasks({actorId: CREW_PARENT_AGENT_ID, rootRequestId: 'root-t1'}).map(t => t.taskId), ['t1']);
    assert.equal(kernel.getTask({actorId: 'coder-x', taskId: 't1'}).status, 'succeeded', 'the assigned agent can read its own task');
  } finally { kernel.close(); }
});

test('child agents have no entry point for task roots or interrupts', () => {
  const kernel = open();
  try {
    crew(kernel);
    assert.throws(
      () => kernel.dispatchTask({actorId: 'coder-x', taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'reviewer-y', goal: '子不能派任务根'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    assert.throws(
      () => kernel.dispatchTask({actorId: 'ghost', taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'reviewer-y', goal: '未知身份也不行'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '正常任务'});
    assert.throws(
      () => kernel.interruptTask({actorId: 'reviewer-y', taskId: 't1', reason: '子不能打断'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    assert.equal(kernel.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'}).status, 'queued', 'rejected calls must not create or change tasks');
    assert.throws(
      () => kernel.getTask({actorId: 'reviewer-y', taskId: 't1'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
  } finally { kernel.close(); }
});

test('the parent neither claims tasks nor owns a mailbox; results arrive through receipts', () => {
  const kernel = open();
  try {
    crew(kernel);
    kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: 'x'});
    assert.throws(() => kernel.claimNextTask(CREW_PARENT_AGENT_ID), error => error instanceof CrewError && error.code === 'NOT_PERMITTED');
    assert.throws(() => kernel.receiveMessages(CREW_PARENT_AGENT_ID), error => error instanceof CrewError && error.code === 'NOT_PERMITTED');
    assert.throws(() => kernel.claimNextTask('nobody'), error => error instanceof CrewError && error.code === 'UNKNOWN_AGENT');
    assert.throws(() => kernel.receiveMessages('nobody'), error => error instanceof CrewError && error.code === 'UNKNOWN_AGENT');
  } finally { kernel.close(); }
});

test('only the assigned agent can submit a receipt for its task', () => {
  const kernel = open();
  try {
    crew(kernel);
    kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: 'x'});
    kernel.claimNextTask('coder-x');
    assert.throws(
      () => kernel.submitReceipt({actorId: 'reviewer-y', taskId: 't1', receipt: VALID_RECEIPT}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    assert.throws(
      () => kernel.submitReceipt({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', receipt: VALID_RECEIPT}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    assert.throws(
      () => kernel.submitReceipt({actorId: 'coder-x', taskId: 'missing', receipt: VALID_RECEIPT}),
      error => error instanceof CrewError && error.code === 'NOT_FOUND',
    );
    assert.equal(kernel.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'}).status, 'running', 'rejected submissions leave the task untouched');
    const done = kernel.submitReceipt({actorId: 'coder-x', taskId: 't1', receipt: VALID_RECEIPT});
    assert.equal(done.status, 'succeeded');
  } finally { kernel.close(); }
});

test('the 9th automatic dispatch of one root is rejected with a clear error', () => {
  const kernel = open();
  try {
    crew(kernel);
    kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', assignedAgentId: 'coder-x', goal: '根任务'});
    for (let i = 2; i <= MAX_AUTO_DISPATCHES_PER_ROOT_REQUEST; i++) {
      kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: `t${i}`, parentTaskId: 't1', assignedAgentId: 'coder-x', goal: `第 ${i - 1} 项子任务`});
    }
    assert.throws(
      () => kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't9', parentTaskId: 't1', rootRequestId: 'brand-new-display-root', assignedAgentId: 'coder-x', goal: '第 9 次派单'}),
      error => error instanceof CrewError && error.code === 'DISPATCH_LIMIT_EXCEEDED',
    );
    kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 'other', assignedAgentId: 'coder-x', goal: '新根预算独立'});
  } finally { kernel.close(); }
});

test('the 3rd concurrent task per agent stays queued until capacity frees up', () => {
  const kernel = open();
  try {
    crew(kernel);
    for (let i = 1; i <= 3; i++) {
      kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: `t${i}`, rootRequestId: 'root-cap', assignedAgentId: 'coder-x', goal: `子任务 ${i}`});
    }
    assert.equal(kernel.claimNextTask('coder-x').taskId, 't1');
    assert.equal(kernel.claimNextTask('coder-x').taskId, 't2');
    assert.equal(kernel.claimNextTask('coder-x'), undefined, 'system concurrency limit is 2');
    assert.equal(kernel.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't3'}).status, 'queued');
    kernel.submitReceipt({actorId: 'coder-x', taskId: 't1', receipt: VALID_RECEIPT});
    assert.equal(kernel.claimNextTask('coder-x').taskId, 't3');
    assert.throws(
      () => kernel.registerAgent({agentId: 'greedy', displayName: '超限', driver: 'claude', instructions: 'x', workspacePath: '/w', concurrencyLimit: MAX_CONCURRENT_TASKS_PER_AGENT + 1}),
      /concurrencyLimit/,
    );
  } finally { kernel.close(); }
});

test('interrupt lands in the task table and survives a restart', () => {
  const path = dbFile();
  let clock = 1700000000000;
  const first = CrewKernel.open(path, {now: () => (clock += 1000)});
  try {
    crew(first);
    first.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '长任务'});
    first.claimNextTask('coder-x');
    const interrupted = first.interruptTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', reason: '父 agent 打断：需求变更'});
    assert.equal(interrupted.status, 'cancelled');
    assert.equal(interrupted.cancelReason, '父 agent 打断：需求变更');
    assert.ok(interrupted.finishedAt);
  } finally { first.close(); }

  const second = CrewKernel.open(path, {now: () => (clock += 1000)});
  try {
    const task = second.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'});
    assert.equal(task.status, 'cancelled', 'cancel state survives restart');
    assert.equal(task.cancelReason, '父 agent 打断：需求变更');
    assert.equal(task.receipt, undefined, 'an interrupted task has no receipt');
    const inbox = second.receiveMessages('coder-x', {dequeue: true});
    assert.deepEqual(inbox.map(m => m.kind), ['task', 'interrupt'], 'the interrupt message is persisted too');
    assert.equal(inbox[1].taskId, 't1');
    assert.equal(second.claimNextTask('coder-x'), undefined, 'cancelled tasks are not claimable');
    assert.throws(
      () => second.interruptTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', reason: '重复打断'}),
      error => error instanceof CrewError && error.code === 'CONFLICT',
    );
  } finally { second.close(); }
});

test('interrupt also reaches queued tasks and interrupts can interrupt them before claim', () => {
  const kernel = open();
  try {
    crew(kernel);
    kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '排队任务'});
    const interrupted = kernel.interruptTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', reason: '派错了目标'});
    assert.equal(interrupted.status, 'cancelled');
    assert.equal(kernel.claimNextTask('coder-x'), undefined);
    assert.deepEqual(kernel.receiveMessages('coder-x').map(m => m.kind), ['task', 'interrupt']);
  } finally { kernel.close(); }
});

test('receipts that violate the fixed Status/Result/Evidence/Unblock format are rejected without writes', () => {
  const kernel = open();
  try {
    crew(kernel);
    kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: 'x'});
    kernel.claimNextTask('coder-x');
    const bad = [
      ['missing status', {result: 'x', evidenceRefs: [], unblock: ''}],
      ['missing result', {status: 'succeeded', evidenceRefs: [], unblock: ''}],
      ['empty result', {status: 'succeeded', result: '  ', evidenceRefs: [], unblock: ''}],
      ['missing unblock', {status: 'succeeded', result: 'x', evidenceRefs: []}],
      ['blocked without unblock', {status: 'blocked', result: '缺输入', evidenceRefs: [], unblock: ''}],
      ['unblock on a terminal receipt', {status: 'succeeded', result: 'x', evidenceRefs: [], unblock: '不该有'}],
      ['unknown field', {status: 'succeeded', result: 'x', evidenceRefs: [], unblock: '', summary: '多余字段'}],
      ['bad status value', {status: 'done', result: 'x', evidenceRefs: [], unblock: ''}],
      ['non-object', '成功'],
      ['evidenceRefs not an array', {status: 'succeeded', result: 'x', evidenceRefs: 'commit:abc', unblock: ''}],
    ];
    for (const [label, receipt] of bad) {
      assert.throws(() => kernel.submitReceipt({actorId: 'coder-x', taskId: 't1', receipt}), error => error instanceof CrewError && error.code === 'INVALID_INPUT', label);
    }
    assert.equal(kernel.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'}).status, 'running', 'invalid receipts must not change task state');
    const blocked = kernel.submitReceipt({actorId: 'coder-x', taskId: 't1', receipt: {status: 'blocked', result: '缺合并授权', evidenceRefs: [], unblock: '用户确认后重新派单'}});
    assert.equal(blocked.status, 'blocked');
    assert.equal(kernel.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'}).receipt.unblock, '用户确认后重新派单');
  } finally { kernel.close(); }
});

test('list_agents returns the addressing view only, with no instructions or workspace paths', () => {
  const kernel = open();
  try {
    crew(kernel);
    for (const actor of [CREW_PARENT_AGENT_ID, 'coder-x', 'reviewer-y']) {
      const agents = kernel.listAgents(actor);
      assert.deepEqual(agents.map(a => a.agentId), ['coder-x', 'reviewer-y']);
      for (const summary of agents) {
        assert.deepEqual(Object.keys(summary).sort(), ['agentId', 'concurrencyLimit', 'displayName', 'driver']);
        assert.ok(!('instructions' in summary) && !('workspacePath' in summary));
      }
    }
    assert.equal(kernel.listAgents('coder-x')[0].driver, 'codex');
    assert.throws(() => kernel.listAgents('nobody'), error => error instanceof CrewError && error.code === 'UNKNOWN_AGENT');
  } finally { kernel.close(); }
});

test('agent-to-agent messaging goes through mailboxes and rejects impersonation (F9)', () => {
  const kernel = open();
  try {
    crew(kernel);
    // F9：actorId 必须等于 fromAgentId，冒充 parent 或他人一律 NOT_PERMITTED。
    assert.throws(
      () => kernel.sendMessage({actorId: 'coder-x', fromAgentId: CREW_PARENT_AGENT_ID, toAgentId: 'reviewer-y', text: '冒充 parent 发信'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
      'a child cannot impersonate the parent',
    );
    assert.throws(
      () => kernel.sendMessage({actorId: 'reviewer-y', fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: '冒充他人发信'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    assert.deepEqual(kernel.receiveMessages('reviewer-y'), [], 'rejected messages must not reach the mailbox');
    // 子发起的新消息 hop=0（hop 由 store 推导，不再由调用方自填）。
    const sent = kernel.sendMessage({actorId: 'coder-x', fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: '请审查第一个补丁', expectsReply: true, attachmentRefs: ['handoff:diff-0001']});
    assert.equal(sent.hop, 0);
    assert.equal(sent.senderAgentId, 'coder-x');
    assert.equal(sent.expectsReply, true);
    assert.deepEqual(kernel.receiveMessages('reviewer-y').map(m => m.messageId), [sent.messageId]);
  } finally { kernel.close(); }
});

test('replyToMessage routes back to the sender, carries routing metadata and increments hop', () => {
  const kernel = open();
  try {
    crew(kernel);
    const request = kernel.sendMessage({actorId: 'coder-x', fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: '请审查第一个补丁', expectsReply: true});
    const reply = kernel.replyToMessage({actorId: 'reviewer-y', inReplyToMessageId: request.messageId, text: '补丁有一处未处理的空指针'});
    assert.equal(reply.senderAgentId, 'reviewer-y');
    assert.equal(reply.mailboxAgentId, 'coder-x');
    assert.equal(reply.hop, 1);
    assert.deepEqual(kernel.receiveMessages('coder-x').map(m => m.messageId), [reply.messageId]);
    assert.throws(
      () => kernel.replyToMessage({actorId: 'coder-x', inReplyToMessageId: request.messageId, text: '不是持有者也能回？'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    assert.throws(
      () => kernel.replyToMessage({actorId: 'reviewer-y', inReplyToMessageId: 99999, text: 'x'}),
      error => error instanceof CrewError && error.code === 'NOT_FOUND',
    );
  } finally { kernel.close(); }
});

test('replies to parent-sent messages are refused in favour of the receipt channel', () => {
  const kernel = open();
  try {
    crew(kernel);
    kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '长任务'});
    const taskMessage = kernel.receiveMessages('coder-x')[0];
    assert.throws(
      () => kernel.replyToMessage({actorId: 'coder-x', inReplyToMessageId: taskMessage.messageId, text: '收到，正在做'}),
      error => error instanceof CrewError && error.code === 'UNSUPPORTED',
    );
    assert.equal(kernel.claimNextTask('coder-x').taskId, 't1');
    const done = kernel.submitReceipt({actorId: 'coder-x', taskId: 't1', receipt: VALID_RECEIPT});
    assert.equal(done.status, 'succeeded', 'results to the parent travel through the fixed receipt format');
  } finally { kernel.close(); }
});

test('reply hop budget is enforced and pure acknowledgements stay suppressed on the reply path', () => {
  const kernel = open();
  try {
    crew(kernel);
    // 沿回复链推进 hop 到预算上限，下一跳被拒绝。
    let current = kernel.sendMessage({actorId: 'coder-x', fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: '深层链'});
    let holder = 'reviewer-y';
    let depth = 0;
    let rejected = false;
    while (depth <= MAX_MESSAGE_HOP) {
      let next;
      try {
        next = kernel.replyToMessage({actorId: holder, inReplyToMessageId: current.messageId, text: `第 ${depth + 1} 跳`});
      } catch (error) {
        assert.ok(error instanceof CrewError && error.code === 'INVALID_INPUT');
        rejected = true;
        break;
      }
      current = next;
      holder = holder === 'reviewer-y' ? 'coder-x' : 'reviewer-y';
      depth += 1;
    }
    assert.equal(rejected, true, 'the reply chain is cut at the hop budget');
    assert.equal(current.hop, MAX_MESSAGE_HOP);
    // 清空链路消息后单独验证纯确认窗口。
    kernel.receiveMessages('coder-x', {dequeue: true});
    kernel.receiveMessages('reviewer-y', {dequeue: true});
    const first = kernel.sendMessage({actorId: 'coder-x', fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: '收到'});
    assert.equal(first.pureAck, true, 'first ack is kept');
    const ackReply = kernel.replyToMessage({actorId: 'reviewer-y', inReplyToMessageId: first.messageId, text: '好的'});
    assert.equal(ackReply.pureAck, true, 'the ack reply is kept as the first message of the reverse direction');
    assert.equal(kernel.replyToMessage({actorId: 'reviewer-y', inReplyToMessageId: first.messageId, text: '了解'}), undefined, 'a second consecutive ack in the same direction is dropped');
    assert.deepEqual(kernel.receiveMessages('coder-x').map(m => m.text), ['好的'], 'the dropped ack never reached the mailbox');
    const real = kernel.replyToMessage({actorId: 'reviewer-y', inReplyToMessageId: first.messageId, text: '审查发现两处问题，见附件'});
    assert.ok(real, 'content-bearing replies pass');
  } finally { kernel.close(); }
});

test('openCrewKernel is the public factory', () => {
  const kernel = openCrewKernel(dbFile(), {now: () => 1700000000000});
  try {
    assert.ok(kernel instanceof CrewKernel);
    assert.deepEqual(kernel.listAgents(CREW_PARENT_AGENT_ID), []);
  } finally { kernel.close(); }
});
