import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {openStorage} from '@personal-agent/storage';
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

test('P2 v2 data survives the P3 v3 additive migration without changing prior checksums', () => {
  // Frozen SQL from P2 commit 6cabc9eda950f3bea491ce5c0feaa30521c7a5f1.
  // Do not derive this fixture from the current production migration array.
  const legacy = [
    {version: 1, sql: `
    CREATE TABLE crew_agents (
      agent_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      driver TEXT NOT NULL CHECK (driver IN ('codex', 'claude', 'opencode', 'grok', 'gemini', 'acp-generic')),
      instructions TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      concurrency_limit INTEGER NOT NULL CHECK (concurrency_limit BETWEEN 1 AND 2),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE crew_tasks (
      task_id TEXT PRIMARY KEY,
      root_request_id TEXT NOT NULL,
      assigned_agent_id TEXT NOT NULL REFERENCES crew_agents(agent_id),
      goal TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled')),
      receipt_json TEXT,
      cancel_reason TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    ) STRICT;
    CREATE INDEX crew_tasks_root_idx ON crew_tasks(root_request_id);
    CREATE INDEX crew_tasks_claim_idx ON crew_tasks(assigned_agent_id, status);
    CREATE TABLE crew_messages (
      message_id INTEGER PRIMARY KEY AUTOINCREMENT,
      mailbox_agent_id TEXT NOT NULL REFERENCES crew_agents(agent_id),
      sender_agent_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('task', 'message', 'interrupt')),
      parent_request_id TEXT,
      root_request_id TEXT,
      task_id TEXT,
      text TEXT NOT NULL,
      attachment_refs_json TEXT NOT NULL,
      expects_reply INTEGER NOT NULL CHECK (expects_reply IN (0, 1)),
      hop INTEGER NOT NULL CHECK (hop BETWEEN 0 AND 8),
      pure_ack INTEGER NOT NULL CHECK (pure_ack IN (0, 1)),
      enqueued_at TEXT NOT NULL,
      dequeued_at TEXT
    ) STRICT;
    CREATE INDEX crew_messages_mailbox_idx ON crew_messages(mailbox_agent_id, message_id);
    CREATE INDEX crew_messages_pair_idx ON crew_messages(sender_agent_id, mailbox_agent_id, message_id DESC);
  `},
    {version: 2, sql: `
    CREATE TABLE crew_consents (
      driver_id TEXT PRIMARY KEY CHECK (driver_id IN ('codex', 'claude', 'opencode', 'grok', 'gemini', 'acp-generic')),
      granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
      login_kind TEXT NOT NULL CHECK (login_kind IN ('local-login', 'api-key')),
      terms_summary TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      granted_at TEXT NOT NULL,
      revoked_at TEXT,
      revoke_reason TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;
  `},
  ];
  const file = dbFile(), at = '2026-11-04T00:00:00.000Z';
  const queries = [
    'SELECT * FROM crew_agents',
    'SELECT task_id, root_request_id, assigned_agent_id, goal, status, receipt_json, cancel_reason, created_at, started_at, finished_at FROM crew_tasks',
    'SELECT * FROM crew_messages',
    'SELECT * FROM crew_consents',
  ];
  const old = openStorage(file, legacy);
  let rows, checksums;
  try {
    old.prepare("INSERT INTO crew_agents VALUES ('coder-x', 'Original coder', 'codex', 'Original instructions', '/w/coder-x', 1, ?)").run(at);
    old.prepare("INSERT INTO crew_tasks VALUES ('old-task', 'root-old-task', 'coder-x', 'Original running task', 'running', NULL, NULL, ?, ?, NULL)").run(at, at);
    old.prepare("INSERT INTO crew_messages VALUES (1, 'coder-x', 'parent', 'task', NULL, 'root-old-task', 'old-task', 'Original pending message', '[]', 0, 0, 0, ?, NULL)").run(at);
    old.prepare("INSERT INTO crew_consents VALUES ('codex', 1, 'local-login', 'Original consent terms', 'fixture-user', ?, NULL, NULL, ?)").run(at, at);
    rows = queries.map(query => old.prepare(query).all());
    checksums = old.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
  } finally { old.close(); }

  const store = CrewStore.open(file, {now: () => Date.parse(at)});
  try {
    assert.equal(store.getAgent('coder-x').workspacePath, '/w/coder-x');
    assert.equal(store.getTask('old-task').status, 'running');
    assert.equal(store.getTask('old-task').deadlineAt, undefined);
    assert.equal(store.getConsentRecord('codex').granted, true);
    assert.deepEqual(store.receiveParentNotifications(), [], 'Existing non-deadline task is not marked failed');
    const migrated = new DatabaseSync(file, {readOnly: true});
    try {
      for (let index = 0; index < queries.length; index++) assert.deepEqual(migrated.prepare(queries[index]).all(), rows[index]);
      const applied = migrated.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
      assert.deepEqual(applied.slice(0, 2), checksums, 'Original migration records retain exact checksums');
      assert.deepEqual(applied.map(value => value.version), [1, 2, 3]);
      assert.equal(migrated.prepare('SELECT count(*) AS count FROM crew_handoff').get().count, 0);
      assert.equal(migrated.prepare('SELECT count(*) AS count FROM crew_parent_inbox').get().count, 0);
    } finally { migrated.close(); }
    const newTask = store.dispatchTask({taskId: 'new-v3-task', assignedAgentId: 'coder-x', goal: 'New deadline support', timeoutMs: 1000});
    assert.equal(newTask.deadlineAt, '2026-11-04T00:00:01.000Z');
    assert.equal(store.receiveMessages('coder-x').filter(message => message.taskId === 'old-task').length, 1, 'Original mailbox identity survives');
  } finally { store.close(); }
});


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
      assert.equal(notification.rootRequestId, `root-${notification.taskId}`, 'the root is derived by the store as root-<taskId>');
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
