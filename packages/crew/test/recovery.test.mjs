import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CrewError,
  CrewKernel,
  CrewStore,
  CREW_PARENT_AGENT_ID,
} from '../dist/index.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));
mkdirSync(root, {recursive: true});

function makeClock(start = 1700000000000) {
  let clock = start;
  return {now: () => (clock += 1000), advance: ms => { clock += ms; }};
}

const dbFile = () => join(mkdtempSync(join(root, 'rec-')), 'crew.sqlite');

function coderAgent(kernel) {
  kernel.registerAgent({agentId: 'coder-x', displayName: '编码者', driver: 'codex', instructions: '编码。', workspacePath: '/w/coder-x'});
}

test('a restart marks expired tasks failed and notifies the parent with the fixed receipt format', () => {
  const db = dbFile();
  const clock = makeClock();
  const first = CrewKernel.open(db, {now: clock.now});
  try {
    coderAgent(first);
    first.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't-running', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '运行中超时', timeoutMs: 5_000});
    first.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't-queued', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '排队中超时', timeoutMs: 6_000});
    first.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't-alive', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '没有期限，不受影响'});
    first.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't-fresh', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '期限未到', timeoutMs: 600_000});
    assert.equal(first.claimNextTask('coder-x').taskId, 't-running');
  } finally { first.close(); }

  clock.advance(60_000);
  const second = CrewKernel.open(db, {now: clock.now});
  try {
    const running = second.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't-running'});
    const queued = second.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't-queued'});
    assert.equal(running.status, 'failed', 'an expired running task is marked failed on reopen');
    assert.equal(queued.status, 'failed', 'an expired queued task is marked failed too');
    assert.ok(running.finishedAt && queued.finishedAt);
    assert.deepEqual(Object.keys(running.receipt).sort(), ['evidenceRefs', 'result', 'status', 'unblock'], 'the timeout receipt uses the fixed format');
    assert.equal(running.receipt.status, 'failed');
    assert.ok(running.receipt.result.includes('t-running'.length ? '超时' : ''), 'the result explains the timeout');
    assert.deepEqual([...running.receipt.evidenceRefs], []);
    assert.equal(running.receipt.unblock, '');
    assert.equal(second.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't-alive'}).status, 'queued', 'tasks without a deadline keep their state');
    assert.equal(second.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't-fresh'}).status, 'queued', 'unexpired tasks keep their state');

    const notifications = second.receiveParentNotifications({actorId: CREW_PARENT_AGENT_ID});
    assert.deepEqual(notifications.map(n => n.taskId), ['t-running', 't-queued'], 'the parent mailbox received one notification per expired task');
    for (const notification of notifications) {
      assert.deepEqual(Object.keys(notification.receipt).sort(), ['evidenceRefs', 'result', 'status', 'unblock']);
      assert.equal(notification.receipt.status, 'failed');
      assert.equal(notification.receipt.unblock, '');
      assert.equal(notification.assignedAgentId, 'coder-x');
      assert.equal(notification.rootRequestId, 'root-1');
    }
    assert.equal(second.receiveParentNotifications({actorId: CREW_PARENT_AGENT_ID, dequeue: true}).length, 2, 'notifications can be consumed FIFO');
    assert.deepEqual(second.receiveParentNotifications({actorId: CREW_PARENT_AGENT_ID}), []);

    // 超时任务腾出并发位；无期限任务照常执行。
    const claimed = second.claimNextTask('coder-x');
    assert.equal(claimed.taskId, 't-alive');
    const done = second.submitReceipt({actorId: 'coder-x', taskId: 't-alive', receipt: {status: 'succeeded', result: '重启后继续完成', evidenceRefs: ['commit:feedc0de'], unblock: ''}});
    assert.equal(done.status, 'succeeded');
  } finally { second.close(); }

  const third = CrewKernel.open(db, {now: clock.now});
  try {
    assert.deepEqual(third.receiveParentNotifications({actorId: CREW_PARENT_AGENT_ID}), [], 'recovery is idempotent: no duplicate notifications');
    assert.equal(third.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't-running'}).status, 'failed');
  } finally { third.close(); }
});

test('a task within its deadline survives a restart and finishes normally', () => {
  const db = dbFile();
  const clock = makeClock();
  const first = CrewKernel.open(db, {now: clock.now});
  try {
    coderAgent(first);
    first.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '长期任务', timeoutMs: 60_000});
    first.claimNextTask('coder-x');
  } finally { first.close(); }

  clock.advance(10_000);
  const second = CrewKernel.open(db, {now: clock.now});
  try {
    assert.equal(second.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'}).status, 'running', 'the running state is picked up from SQLite');
    assert.deepEqual(second.receiveParentNotifications({actorId: CREW_PARENT_AGENT_ID}), []);
    const done = second.submitReceipt({actorId: 'coder-x', taskId: 't1', receipt: {status: 'succeeded', result: '重启前领取、重启后完成', evidenceRefs: [], unblock: ''}});
    assert.equal(done.status, 'succeeded');
  } finally { second.close(); }
});

test('recoverExpiredTasks can also run as a periodic sweep in a long-lived process', () => {
  const clock = makeClock();
  const kernel = CrewKernel.open(dbFile(), {now: clock.now});
  try {
    coderAgent(kernel);
    kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '先领取后超时', timeoutMs: 5_000});
    kernel.claimNextTask('coder-x');
    assert.deepEqual(kernel.recoverExpiredTasks(), [], 'before the deadline nothing is recovered');
    clock.advance(6_000);
    const recovered = kernel.recoverExpiredTasks();
    assert.deepEqual(recovered.map(t => t.taskId), ['t1']);
    assert.equal(recovered[0].status, 'failed');
    assert.equal(kernel.claimNextTask('coder-x'), undefined, 'a timed-out task is no longer claimable');
    assert.deepEqual(kernel.receiveParentNotifications({actorId: CREW_PARENT_AGENT_ID}).map(n => n.taskId), ['t1']);
  } finally { kernel.close(); }
});

test('dispatch input rules: timeoutMs must be a positive integer', () => {
  const kernel = CrewKernel.open(dbFile(), {now: makeClock().now});
  try {
    coderAgent(kernel);
    for (const timeoutMs of [0, -1, 1.5, Number.NaN, '5000']) {
      assert.throws(
        () => kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: 'x', timeoutMs}),
        error => error instanceof CrewError && error.code === 'INVALID_INPUT',
        `timeoutMs ${String(timeoutMs)} must be rejected`,
      );
    }
    assert.deepEqual(kernel.listTasks({actorId: CREW_PARENT_AGENT_ID}), [], 'rejected dispatches create no tasks');
    const task = kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: 'x', timeoutMs: 5_000});
    assert.ok(task.deadlineAt, 'the deadline is derived from the dispatch time');
  } finally { kernel.close(); }
});

test('only the parent can read the parent inbox', () => {
  const kernel = CrewKernel.open(dbFile(), {now: makeClock().now});
  try {
    coderAgent(kernel);
    assert.throws(
      () => kernel.receiveParentNotifications({actorId: 'coder-x'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    assert.throws(
      () => kernel.receiveParentNotifications({actorId: 'ghost'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
  } finally { kernel.close(); }
});

test('the store-level factory recovers expired tasks on open as well', () => {
  const db = dbFile();
  const clock = makeClock();
  const first = CrewStore.open(db, {now: clock.now});
  try {
    first.registerAgent({agentId: 'coder-x', displayName: '编码者', driver: 'codex', instructions: 'x', workspacePath: '/w'});
    first.dispatchTask({taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: 'x', timeoutMs: 1_000});
  } finally { first.close(); }
  clock.advance(5_000);
  const second = CrewStore.open(db, {now: clock.now});
  try {
    assert.equal(second.getTask('t1').status, 'failed');
    assert.deepEqual(second.receiveParentNotifications().map(n => n.taskId), ['t1']);
  } finally { second.close(); }
});
