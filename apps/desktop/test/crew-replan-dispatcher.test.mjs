import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  planRuntimeTaskFailure,
  TASK_FAILURE_PARENT_REPLAN_CHECKPOINT,
  TASK_FAILURE_REPAIR_CHECKPOINT,
} from '@personal-agent/agentarts';
import {TaskRuntime} from '@personal-agent/runtime';
import {createCrewReplanDispatcher} from '../electron/crew-replan-dispatcher.js';
import {createFailureRepairHost} from '../electron/failure-repair-host.js';

const at = '2026-11-20T00:00:00.000Z';

test('replan dispatches a crew child and a TaskRuntime follow-up', () => {
  const root = mkdtempSync(join(tmpdir(), 'crew-replan-'));
  const runtime = new TaskRuntime(join(root, 'runtime.sqlite'));
  const crew = createCrewReplanDispatcher({
    dbPath: join(root, 'crew.sqlite'),
    workspaceRoot: join(root, 'workspace'),
  });
  try {
    const task = runtime.submitTask({goal: '读取状态后失败', conversationId: 'fixture', idempotencyKey: 'crew-replan-1'});
    runtime.transitionTask(task.taskId, 'failed', {error: {code: 'TIMEOUT', message: 'timeout', retryable: true}});
    runtime.saveCheckpoint(task.taskId, TASK_FAILURE_REPAIR_CHECKPOINT, planRuntimeTaskFailure({
      taskId: task.taskId, effect: 'read', outcome: 'failed', errorCode: 'TIMEOUT', occurredAt: at, evidenceRefs: ['e1'],
    }));
    const host = createFailureRepairHost(runtime, {dispatchParentReplan: input => crew.dispatch(input)});
    const result = host.act({taskId: task.taskId, action: 'replan'});
    assert.equal(result.accepted, true);
    assert.equal(result.replanIntent?.action, 'dispatch');
    assert.ok(result.followUpTaskId);
    assert.equal(runtime.getTask(task.taskId).state, 'failed');
    assert.match(runtime.getTask(result.followUpTaskId).goal, /重新规划/);
    assert.equal(runtime.loadCheckpoint(result.followUpTaskId, TASK_FAILURE_PARENT_REPLAN_CHECKPOINT).parentReplan, true);
    const crewTasks = crew.listTasks();
    assert.ok(crewTasks.some(item => item.taskId === task.taskId && item.status === 'failed'));
    assert.ok(crewTasks.some(item => item.status === 'queued' && /重新规划/.test(item.goal)));
  } finally {
    crew.close();
    runtime.close();
    rmSync(root, {recursive: true, force: true});
  }
});
