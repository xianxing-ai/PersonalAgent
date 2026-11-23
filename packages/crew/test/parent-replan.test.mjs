import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {test} from 'node:test';
import {CrewError, CrewKernel, CREW_PARENT_AGENT_ID, parentReplanIntent} from '../dist/index.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));
mkdirSync(root, {recursive: true});
const dbFile = () => join(mkdtempSync(join(root, 'replan-')), 'crew.sqlite');

function open() {
  let clock = 1700000000000;
  return CrewKernel.open(dbFile(), {now: () => (clock += 1000)});
}

function decision(extra = {}) {
  return {
    version: 1, childTaskId: 't1', classification: 'correctable', strategy: 'request_parent_replan',
    reason: 'selector missed', effect: 'read', executable: false, requiresApproval: false, risk: 'ordinary', ...extra,
  };
}

function failChild(kernel) {
  kernel.registerAgent({agentId: 'coder-x', displayName: '编码者', driver: 'codex', instructions: '完成子任务', workspacePath: '/workspace/crew/coder-x'});
  kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', assignedAgentId: 'coder-x', goal: '读取状态'});
  kernel.claimNextTask('coder-x');
  kernel.submitReceipt({actorId: 'coder-x', taskId: 't1', receipt: {status: 'failed', result: '选择器没有命中', evidenceRefs: ['read-1'], unblock: ''}});
}

test('the parent replans a correctable failure onto a new child task and leaves the failed task intact', () => {
  const kernel = open();
  try {
    failChild(kernel);
    const result = kernel.replanChildTask({
      actorId: CREW_PARENT_AGENT_ID, childTaskId: 't1', taskId: 't1-replan', assignedAgentId: 'coder-x', decision: decision(),
    });
    assert.equal(result.intent.action, 'dispatch');
    assert.equal(result.intent.sideEffectsEmitted, 0);
    assert.equal(result.task.status, 'queued');
    assert.equal(result.task.rootRequestId, kernel.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'}).rootRequestId);
    assert.match(result.task.goal, /重新规划/);
    assert.match(result.task.goal, /不要重放未知写入/);
    assert.equal(kernel.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'}).status, 'failed');
    assert.equal(kernel.listTasks({actorId: CREW_PARENT_AGENT_ID}).length, 2);
  } finally { kernel.close(); }
});

test('a child cannot replan, and an unknown or non-idempotent write is not dispatched', () => {
  const kernel = open();
  try {
    failChild(kernel);
    assert.throws(
      () => kernel.replanChildTask({actorId: 'coder-x', childTaskId: 't1', taskId: 'nope', assignedAgentId: 'coder-x', decision: decision()}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    const unknown = kernel.replanChildTask({
      actorId: CREW_PARENT_AGENT_ID, childTaskId: 't1', taskId: 't-unknown', assignedAgentId: 'coder-x',
      decision: decision({classification: 'transient', strategy: 'backoff_retry', effect: 'write', executable: true, reason: 'timeout', writeStatus: 'unknown'}),
    });
    assert.equal(unknown.intent.action, 'reconcile');
    assert.equal(unknown.task, undefined);
    const unsafe = kernel.replanChildTask({
      actorId: CREW_PARENT_AGENT_ID, childTaskId: 't1', taskId: 't-unsafe', assignedAgentId: 'coder-x',
      decision: decision({classification: 'transient', strategy: 'backoff_retry', effect: 'write', executable: true, reason: 'timeout', writeStatus: 'not_applied', writeRetrySafe: false}),
    });
    assert.equal(unsafe.intent.action, 'stop');
    assert.match(unsafe.intent.reason, /blind retry refused/);
    assert.equal(kernel.listTasks({actorId: CREW_PARENT_AGENT_ID}).length, 1);
    const pure = parentReplanIntent(CREW_PARENT_AGENT_ID, decision({effect: 'write', strategy: 'backoff_retry', executable: true, writeStatus: 'unknown'}));
    assert.equal(pure.action, 'reconcile');
    assert.equal(pure.sideEffectsEmitted, 0);
  } finally { kernel.close(); }
});

test('high-risk replans wait for approval and do not enqueue a task', () => {
  const kernel = open();
  try {
    failChild(kernel);
    const waiting = kernel.replanChildTask({
      actorId: CREW_PARENT_AGENT_ID, childTaskId: 't1', taskId: 't-risk', assignedAgentId: 'coder-x',
      decision: decision({classification: 'transient', strategy: 'backoff_retry', effect: 'read', requiresApproval: true, risk: 'high', approved: false, reason: 'timeout'}),
    });
    assert.equal(waiting.intent.action, 'await_approval');
    assert.equal(waiting.task, undefined);
    assert.equal(kernel.listTasks({actorId: CREW_PARENT_AGENT_ID}).length, 1);
    const approved = kernel.replanChildTask({
      actorId: CREW_PARENT_AGENT_ID, childTaskId: 't1', taskId: 't-approved', assignedAgentId: 'coder-x',
      decision: decision({classification: 'transient', strategy: 'backoff_retry', effect: 'read', requiresApproval: true, risk: 'high', approved: true, reason: 'timeout'}),
    });
    assert.equal(approved.intent.action, 'dispatch');
    assert.match(approved.task.goal, /只读/);
    assert.equal(kernel.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'}).status, 'failed');
  } finally { kernel.close(); }
});

test('replan input rejects unknown fields and a task that is not failed', () => {
  const kernel = open();
  try {
    failChild(kernel);
    assert.throws(() => parentReplanIntent(CREW_PARENT_AGENT_ID, {...decision(), execute: true}), error => error instanceof CrewError && error.code === 'INVALID_INPUT');
    kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't2', assignedAgentId: 'coder-x', goal: '另一项'});
    assert.throws(
      () => kernel.replanChildTask({actorId: CREW_PARENT_AGENT_ID, childTaskId: 't2', taskId: 't2-replan', assignedAgentId: 'coder-x', decision: decision({childTaskId: 't2'})}),
      error => error instanceof CrewError && error.code === 'CONFLICT',
    );
  } finally { kernel.close(); }
});
