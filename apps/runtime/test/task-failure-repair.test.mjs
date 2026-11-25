import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskRuntime} from '../dist/index.js';
import {TASK_FAILURE_REPAIR_CHECKPOINT, planRuntimeTaskFailure} from '@personal-agent/agentarts';

test('a committed task failure notifies the host and stays failed', async () => {
  const runtime = new TaskRuntime(join(mkdtempSync(join(tmpdir(), 'repair-')), 'runtime.sqlite'), {
    onTaskFailed(notice) {
      runtime.saveCheckpoint(notice.taskId, TASK_FAILURE_REPAIR_CHECKPOINT, planRuntimeTaskFailure(notice));
    },
  });
  try {
    const task = runtime.submitTask({goal: '读取状态', conversationId: 'fixture', idempotencyKey: 'original'});
    runtime.transitionTask(task.taskId, 'failed', {error: {code: 'TIMEOUT', message: 'timeout', retryable: true}});
    await Promise.resolve();
    const saved = runtime.loadCheckpoint(task.taskId, TASK_FAILURE_REPAIR_CHECKPOINT);
    assert.equal(saved.version, 1);
    assert.equal(saved.recovery.taskResumed, false);
    assert.equal(saved.trace.attempts[0].sideEffectsEmitted, 0);
    assert.equal(runtime.getTask(task.taskId).state, 'failed');
  } finally { runtime.close(); }
});

test('a hook exception does not roll back the failure', async () => {
  const runtime = new TaskRuntime(':memory:', {onTaskFailed() { throw Error('repair hook failed'); }});
  try {
    const task = runtime.submitTask({goal: '读取状态', conversationId: 'fixture', idempotencyKey: 'original'});
    runtime.transitionTask(task.taskId, 'failed', {error: {code: 'EXTERNAL_FAILURE', message: 'down', retryable: false}});
    await Promise.resolve();
    assert.equal(runtime.getTask(task.taskId).state, 'failed');
  } finally { runtime.close(); }
});

test('runtime task failure propagates retryable flag to repair planning', async () => {
  const notices = [];
  const runtime = new TaskRuntime(':memory:', {
    onTaskFailed(notice) {
      notices.push(notice);
      runtime.saveCheckpoint(notice.taskId, TASK_FAILURE_REPAIR_CHECKPOINT, planRuntimeTaskFailure(notice));
    },
  });
  try {
    const transient = runtime.submitTask({goal: '查询天气', conversationId: 'fixture', idempotencyKey: 'weather-transient'});
    runtime.transitionTask(transient.taskId, 'failed', {error: {code: 'EXTERNAL_FAILURE', message: 'upstream 503', retryable: true}});
    const fatal = runtime.submitTask({goal: '查询天气', conversationId: 'fixture', idempotencyKey: 'weather-fatal'});
    runtime.transitionTask(fatal.taskId, 'failed', {error: {code: 'EXTERNAL_FAILURE', message: 'bad cert', retryable: false}});
    await Promise.resolve();
    assert.equal(notices[0].retryable, true);
    assert.equal(runtime.loadCheckpoint(transient.taskId, TASK_FAILURE_REPAIR_CHECKPOINT).trace.attempts[0].classification, 'transient');
    assert.equal(notices[1].retryable, false);
    assert.equal(runtime.loadCheckpoint(fatal.taskId, TASK_FAILURE_REPAIR_CHECKPOINT).trace.attempts[0].classification, 'unrecoverable');
  } finally { runtime.close(); }
});
