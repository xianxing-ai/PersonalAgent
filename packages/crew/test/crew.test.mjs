import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CrewError,
  CrewStore,
  CREW_PARENT_AGENT_ID,
  MAX_AUTO_DISPATCHES_PER_ROOT_REQUEST,
  MAX_CONCURRENT_TASKS_PER_AGENT,
  MAX_MESSAGE_HOP,
  isPureAcknowledgement,
  openCrewStore,
  parseCrewReceipt,
} from '../dist/index.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));
mkdirSync(root, {recursive: true});
const dbFile = () => join(mkdtempSync(join(root, 'case-')), 'crew.sqlite');

function open(options = {}) {
  let clock = 1700000000000;
  const now = () => (clock += 1000);
  return CrewStore.open(dbFile(), {...options, now: options.now ?? now});
}

function coderAgent(store, agentId = 'coder-x') {
  return store.registerAgent({
    agentId,
    displayName: '编码者',
    driver: 'codex',
    instructions: '在自有 worktree 内完成编码任务，并按固定回执格式汇报。',
    workspacePath: '/workspace/crew/coder-x',
  });
}

test('agent registry: register, list, get and duplicate rejection', () => {
  const store = open();
  try {
    const coder = coderAgent(store);
    assert.equal(coder.agentId, 'coder-x');
    assert.equal(coder.driver, 'codex');
    assert.equal(coder.concurrencyLimit, MAX_CONCURRENT_TASKS_PER_AGENT);
    store.registerAgent({agentId: 'reviewer-y', displayName: '评审者', driver: 'opencode', instructions: '独立审查 diff。', workspacePath: '/workspace/crew/reviewer-y'});
    assert.deepEqual(store.listAgents().map(a => a.agentId), ['coder-x', 'reviewer-y']);
    assert.equal(store.getAgent('reviewer-y').displayName, '评审者');
    assert.equal(store.getAgent('missing'), undefined);
    assert.throws(() => coderAgent(store), error => error instanceof CrewError && error.code === 'CONFLICT');
    assert.throws(() => store.registerAgent({agentId: CREW_PARENT_AGENT_ID, displayName: '父', driver: 'codex', instructions: 'x', workspacePath: '/w'}), /reserved/);
    assert.throws(() => store.registerAgent({agentId: 'bad-driver', displayName: 'x', driver: 'antigravity-cli', instructions: 'x', workspacePath: '/w'}), /driver/);
    assert.throws(() => store.registerAgent({agentId: 'c2', displayName: 'x', driver: 'codex', instructions: 'x', workspacePath: '/w', concurrencyLimit: 3}), /concurrencyLimit/);
  } finally { store.close(); }
});

test('task roots are dispatched by the parent and delivered through the agent mailbox', () => {
  const store = open();
  try {
    coderAgent(store);
    const task = store.dispatchTask({taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '修复 crew 包的类型错误'});
    assert.equal(task.status, 'queued');
    const inbox = store.receiveMessages('coder-x');
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].senderAgentId, CREW_PARENT_AGENT_ID);
    assert.equal(inbox[0].kind, 'task');
    assert.equal(inbox[0].taskId, 't1');
    assert.equal(inbox[0].parentRequestId, 'root-1');
    assert.equal(inbox[0].expectsReply, true);
    assert.throws(() => store.dispatchTask({taskId: 't2', rootRequestId: 'root-1', assignedAgentId: 'nobody', goal: 'x'}), error => error instanceof CrewError && error.code === 'UNKNOWN_AGENT');
    assert.throws(() => store.dispatchTask({taskId: 't1', rootRequestId: 'root-2', assignedAgentId: 'coder-x', goal: 'x'}), error => error instanceof CrewError && error.code === 'CONFLICT');
    assert.throws(() => store.dispatchTask({taskId: 't3', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '   '}), /goal/);
  } finally { store.close(); }
});

test('the 9th automatic dispatch of one root request is rejected', () => {
  const store = open();
  try {
    coderAgent(store);
    for (let i = 1; i <= MAX_AUTO_DISPATCHES_PER_ROOT_REQUEST; i++) {
      store.dispatchTask({taskId: `t${i}`, rootRequestId: 'root-busy', assignedAgentId: 'coder-x', goal: `第 ${i} 项子任务`});
    }
    assert.equal(store.listTasks({rootRequestId: 'root-busy'}).length, MAX_AUTO_DISPATCHES_PER_ROOT_REQUEST);
    assert.throws(
      () => store.dispatchTask({taskId: 't9', rootRequestId: 'root-busy', assignedAgentId: 'coder-x', goal: '第 9 次派单'}),
      error => error instanceof CrewError && error.code === 'DISPATCH_LIMIT_EXCEEDED',
    );
    store.dispatchTask({taskId: 'other-1', rootRequestId: 'root-other', assignedAgentId: 'coder-x', goal: '另一个根不受影响'});
    assert.equal(store.getTask('other-1').status, 'queued');
  } finally { store.close(); }
});

test('claims are FIFO and the 3rd concurrent task per agent stays queued', () => {
  const store = open();
  try {
    coderAgent(store);
    for (let i = 1; i <= 3; i++) store.dispatchTask({taskId: `t${i}`, rootRequestId: 'root-fifo', assignedAgentId: 'coder-x', goal: `子任务 ${i}`});
    const first = store.claimNextTask('coder-x');
    const second = store.claimNextTask('coder-x');
    assert.deepEqual([first.taskId, second.taskId], ['t1', 't2']);
    assert.equal(first.status, 'running');
    assert.ok(first.startedAt);
    assert.equal(store.claimNextTask('coder-x'), undefined, 'third task must stay queued');
    assert.equal(store.getTask('t3').status, 'queued');
    store.completeTask('t1', {status: 'succeeded', result: 't1 完成：修复了三处类型错误', evidenceRefs: ['commit:abc1234'], unblock: ''});
    const third = store.claimNextTask('coder-x');
    assert.equal(third.taskId, 't3');
  } finally { store.close(); }
});

test('per-agent concurrency limits are independent', () => {
  const store = open();
  try {
    coderAgent(store);
    store.registerAgent({agentId: 'solo', displayName: '单线程', driver: 'claude', instructions: '一次只跑一个任务。', workspacePath: '/workspace/crew/solo', concurrencyLimit: 1});
    store.dispatchTask({taskId: 'a1', rootRequestId: 'root-a', assignedAgentId: 'solo', goal: 'a1'});
    store.dispatchTask({taskId: 'a2', rootRequestId: 'root-a', assignedAgentId: 'solo', goal: 'a2'});
    store.dispatchTask({taskId: 'x1', rootRequestId: 'root-x', assignedAgentId: 'coder-x', goal: 'x1'});
    assert.equal(store.claimNextTask('solo').taskId, 'a1');
    assert.equal(store.claimNextTask('solo'), undefined);
    assert.equal(store.claimNextTask('coder-x').taskId, 'x1');
  } finally { store.close(); }
});

test('receipts must use the fixed Status/Result/Evidence/Unblock format', () => {
  assert.deepEqual(parseCrewReceipt({status: 'succeeded', result: '完成', evidenceRefs: [], unblock: ''}), {status: 'succeeded', result: '完成', evidenceRefs: [], unblock: ''});
  assert.deepEqual(parseCrewReceipt({status: 'blocked', result: '缺少授权', evidenceRefs: [], unblock: '需要用户提供合并 PR 的确认'}), {status: 'blocked', result: '缺少授权', evidenceRefs: [], unblock: '需要用户提供合并 PR 的确认'});
  assert.throws(() => parseCrewReceipt({status: 'done', result: 'x'}), /status/);
  assert.throws(() => parseCrewReceipt({status: 'succeeded', result: '   '}), /result/);
  assert.throws(() => parseCrewReceipt({status: 'blocked', result: '缺输入', evidenceRefs: []}), /unblock/);
  assert.throws(() => parseCrewReceipt({status: 'blocked', result: '缺输入', evidenceRefs: [], unblock: '  '}), /unblock/);
  assert.throws(() => parseCrewReceipt({status: 'succeeded', result: 'x', evidenceRefs: [], unblock: '不该有'}), /unblock/);
  assert.throws(() => parseCrewReceipt({status: 'succeeded', result: 'x', evidenceRefs: [], unblock: '', extra: 1}), /unknown field/);
  assert.throws(() => parseCrewReceipt({status: 'succeeded', result: 'x', evidenceRefs: ['']}), /evidenceRefs/);
  assert.throws(() => parseCrewReceipt('成功'), /object/);
  assert.equal(isPureAcknowledgement('收到'), true);
  assert.equal(isPureAcknowledgement('OK!'), true);
  assert.equal(isPureAcknowledgement('收到，diff 已写入附件'), false);
  assert.equal(isPureAcknowledgement('我会修复这个错误并重跑测试'), false);
});

test('completeTask stores a valid receipt and rejects invalid ones without writes', () => {
  const store = open();
  try {
    coderAgent(store);
    store.dispatchTask({taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '实现任务表'});
    assert.throws(() => store.completeTask('missing', {status: 'succeeded', result: 'x', evidenceRefs: [], unblock: ''}), error => error instanceof CrewError && error.code === 'NOT_FOUND');
    assert.throws(() => store.completeTask('t1', {status: 'succeeded', result: 'x', evidenceRefs: [], unblock: ''}), error => error instanceof CrewError && error.code === 'CONFLICT');
    const claimed = store.claimNextTask('coder-x');
    assert.equal(claimed.taskId, 't1');
    assert.throws(() => store.completeTask('t1', {status: 'succeeded', result: 'x', evidenceRefs: [], unblock: '不该有'}), /unblock/);
    assert.equal(store.getTask('t1').status, 'running', 'failed receipt must not change task state');
    const done = store.completeTask('t1', {status: 'succeeded', result: '任务表与迁移已实现并测试', evidenceRefs: ['evidence:crew-task-table', 'commit:feedc0de'], unblock: ''});
    assert.equal(done.status, 'succeeded');
    assert.deepEqual([...done.receipt.evidenceRefs], ['evidence:crew-task-table', 'commit:feedc0de']);
    assert.ok(done.finishedAt);
    assert.throws(() => store.completeTask('t1', {status: 'succeeded', result: 'x', evidenceRefs: [], unblock: ''}), /only running tasks can be completed/);
  } finally { store.close(); }
});

test('blocked receipts keep the unblock condition on the task', () => {
  const store = open();
  try {
    coderAgent(store);
    store.dispatchTask({taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '合并前需要用户确认'});
    store.claimNextTask('coder-x');
    const blocked = store.completeTask('t1', {status: 'blocked', result: '需要 force push 授权', evidenceRefs: [], unblock: '用户确认后重新派单'});
    assert.equal(blocked.status, 'blocked');
    assert.equal(store.getTask('t1').receipt.unblock, '用户确认后重新派单');
    assert.equal(store.claimNextTask('coder-x'), undefined, 'blocked tasks are not claimable');
  } finally { store.close(); }
});

test('cancel interrupts a queued or running task and notifies the mailbox', () => {
  const store = open();
  try {
    coderAgent(store);
    store.dispatchTask({taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '长任务'});
    const cancelled = store.cancelTask('t1', '父 agent 打断：需求变更');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancelReason, '父 agent 打断：需求变更');
    const inbox = store.receiveMessages('coder-x', {dequeue: true});
    assert.deepEqual(inbox.map(m => m.kind), ['task', 'interrupt']);
    assert.equal(inbox[1].taskId, 't1');
    assert.ok(inbox[1].dequeuedAt);
    assert.equal(store.claimNextTask('coder-x'), undefined);
    assert.throws(() => store.cancelTask('t1', 'again'), /already cancelled/);
    assert.throws(() => store.cancelTask('missing', 'x'), error => error instanceof CrewError && error.code === 'NOT_FOUND');
  } finally { store.close(); }
});

test('agent-to-agent messages are FIFO, keep metadata and survive dequeue + restart', () => {
  const path = dbFile();
  let clock = 1700000000000;
  const store = CrewStore.open(path, {now: () => (clock += 1000)});
  try {
    coderAgent(store);
    store.registerAgent({agentId: 'reviewer-y', displayName: '评审者', driver: 'opencode', instructions: '独立审查。', workspacePath: '/workspace/crew/reviewer-y'});
    store.sendMessage({fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: '请审查第一个补丁', parentRequestId: 'root-1', rootRequestId: 'root-1', taskId: 't1', expectsReply: true, attachmentRefs: ['handoff:diff-0001'], hop: 1});
    store.sendMessage({fromAgentId: 'reviewer-y', toAgentId: 'coder-x', text: '补丁有一处未处理的空指针'});
    store.sendMessage({fromAgentId: CREW_PARENT_AGENT_ID, toAgentId: 'coder-x', text: '父 agent 转达：优先修复空指针'});
    const first = store.receiveMessages('reviewer-y');
    assert.deepEqual(first.map(m => m.senderAgentId), ['coder-x']);
    assert.deepEqual([...first[0].attachmentRefs], ['handoff:diff-0001']);
    assert.equal(first[0].hop, 1);
    assert.equal(first[0].expectsReply, true);
    const consumed = store.receiveMessages('reviewer-y', {dequeue: true});
    assert.deepEqual(consumed.map(m => m.senderAgentId), ['coder-x']);
    assert.ok(consumed[0].dequeuedAt);
    assert.deepEqual(store.receiveMessages('reviewer-y'), []);
  } finally { store.close(); }

  const reopened = CrewStore.open(path, {now: () => (clock += 1000)});
  try {
    assert.deepEqual(reopened.listAgents().map(a => a.agentId), ['coder-x', 'reviewer-y']);
    assert.deepEqual(reopened.receiveMessages('reviewer-y'), [], 'dequeued messages stay consumed after restart');
    assert.deepEqual(reopened.receiveMessages('coder-x').map(m => m.text), ['补丁有一处未处理的空指针', '父 agent 转达：优先修复空指针']);
    assert.deepEqual(reopened.receiveMessages('coder-x', {limit: 1}).map(m => m.text), ['补丁有一处未处理的空指针']);
  } finally { reopened.close(); }
});

test('message input validation', () => {
  const store = open();
  try {
    coderAgent(store);
    store.registerAgent({agentId: 'reviewer-y', displayName: '评审者', driver: 'opencode', instructions: '独立审查。', workspacePath: '/workspace/crew/reviewer-y'});
    assert.throws(() => store.sendMessage({fromAgentId: 'ghost', toAgentId: 'coder-x', text: 'x'}), error => error instanceof CrewError && error.code === 'UNKNOWN_AGENT');
    assert.throws(() => store.sendMessage({fromAgentId: 'coder-x', toAgentId: 'ghost', text: 'x'}), error => error instanceof CrewError && error.code === 'UNKNOWN_AGENT');
    assert.throws(() => store.sendMessage({fromAgentId: 'coder-x', toAgentId: 'coder-x', text: '自言自语'}), /must differ/);
    assert.throws(() => store.sendMessage({fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: 'x', hop: MAX_MESSAGE_HOP + 1}), /hop/);
    assert.throws(() => store.sendMessage({fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: 'x', attachmentRefs: ['    ']}), /attachmentRefs/);
  } finally { store.close(); }
});

test('a second consecutive pure acknowledgement is dropped to break confirmation loops', () => {
  const store = open();
  try {
    coderAgent(store);
    store.registerAgent({agentId: 'reviewer-y', displayName: '评审者', driver: 'opencode', instructions: '独立审查。', workspacePath: '/workspace/crew/reviewer-y'});
    assert.equal(store.sendMessage({fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: '收到'}).pureAck, true, 'first ack is kept');
    assert.equal(store.sendMessage({fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: '好的'}), undefined, 'second consecutive ack is dropped');
    assert.equal(store.sendMessage({fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: '明白'}), undefined, 'further consecutive acks keep being dropped');
    assert.deepEqual(store.receiveMessages('reviewer-y').map(m => m.text), ['收到']);
    assert.equal(store.sendMessage({fromAgentId: 'reviewer-y', toAgentId: 'coder-x', text: '收到'}).messageId > 0, true, 'the reverse direction has its own chain');
    assert.equal(store.sendMessage({fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: '修改意见见附件'}).pureAck, false, 'content-bearing reply breaks the chain');
    assert.equal(store.sendMessage({fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: '收到'}).pureAck, true, 'ack after real content is kept again');
    assert.deepEqual(store.receiveMessages('reviewer-y').map(m => m.text), ['收到', '修改意见见附件', '收到']);
  } finally { store.close(); }
});

test('tasks, agents and mailbox survive a close/reopen cycle', () => {
  const path = dbFile();
  let clock = 1700000000000;
  const first = CrewStore.open(path, {now: () => (clock += 1000)});
  try {
    coderAgent(first);
    first.dispatchTask({taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '重启不丢'});
    first.claimNextTask('coder-x');
  } finally { first.close(); }

  const second = CrewStore.open(path, {now: () => (clock += 1000)});
  try {
    const task = second.getTask('t1');
    assert.equal(task.status, 'running', 'running state survives restart');
    assert.deepEqual(second.receiveMessages('coder-x').map(m => m.kind), ['task']);
    const receipt = second.completeTask('t1', {status: 'failed', result: '重启后继续失败：缺依赖', evidenceRefs: [], unblock: ''});
    assert.equal(receipt.status, 'failed');
  } finally { second.close(); }

  const third = CrewStore.open(path, {now: () => (clock += 1000)});
  try {
    const task = third.getTask('t1');
    assert.equal(task.status, 'failed');
    assert.equal(task.receipt.result, '重启后继续失败：缺依赖');
  } finally { third.close(); }
});

test('openCrewStore is the public factory and claims reject unknown agents', () => {
  const store = openCrewStore(dbFile(), {now: () => 1700000000000});
  try {
    assert.ok(store instanceof CrewStore);
    assert.throws(() => store.claimNextTask('nobody'), error => error instanceof CrewError && error.code === 'UNKNOWN_AGENT');
  } finally { store.close(); }
});
