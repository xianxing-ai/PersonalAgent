import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskRuntime} from '@personal-agent/runtime';
import {
  planRuntimeTaskFailure,
  TASK_FAILURE_READONLY_RETRY_CHECKPOINT,
  TASK_FAILURE_REPAIR_CHECKPOINT,
} from '@personal-agent/agentarts';
import {
  failureRepairModel,
  formatLocatedFailureLines,
  mountFailureRepairCard,
} from '../src/features/conversation/failure-repair-card.js';
import {createFailureRepairHost} from '../electron/failure-repair-host.js';

const at = '2026-11-11T00:00:00.000Z';

test('the failure card keeps only the actions that can run', () => {
  const read = planRuntimeTaskFailure({taskId: 't', effect: 'read', outcome: 'failed', errorCode: 'TIMEOUT', occurredAt: at, evidenceRefs: ['e']});
  const model = failureRepairModel([{taskId: 't', state: 'failed', repair: {
    classification: 'transient', effect: 'read', risk: 'ordinary', awaitingApproval: false, abandoned: false,
    canRetryRead: true, canReplan: true, canAbandon: true, recovery: read.recovery, attempts: read.trace.attempts.map(item => ({
      attempt: item.attempt, observedAt: item.observedAt, strategy: item.strategy, reason: item.reason, result: item.result,
    })),
  }}]);
  assert.deepEqual(model.buttons.map(button => button.label), ['重试', '交给父 agent', '放弃']);
  assert.equal(model.replayNote, '这次查看只重放决策，没有重新执行。');
  assert.equal(JSON.stringify(model).includes('预算'), false);
  assert.equal(JSON.stringify(model).includes('统计'), false);
  const risky = failureRepairModel([{taskId: 't', state: 'failed', repair: {
    classification: 'transient', risk: 'high', abandoned: false, canRetryRead: false, canReplan: false, canAbandon: true,
    recovery: {reason: '宿主确认没有写上，可以另作规划'}, attempts: [],
  }}]);
  assert.deepEqual(risky.buttons.map(button => button.label), ['放弃']);
  assert.match(risky.reason, /原有授权/);
  assert.equal(failureRepairModel([{taskId: 't', state: 'succeeded', repair: read}]), undefined);
});

test('manual retry submits a new read and leaves the failed task failed', () => {
  const runtime = new TaskRuntime(join(mkdtempSync(join(tmpdir(), 'repair-ui-')), 'runtime.sqlite'));
  try {
    const task = runtime.submitTask({goal: '读取状态', conversationId: 'fixture', idempotencyKey: 'original'});
    runtime.transitionTask(task.taskId, 'failed', {error: {code: 'TIMEOUT', message: 'timeout', retryable: true}});
    runtime.saveCheckpoint(task.taskId, TASK_FAILURE_REPAIR_CHECKPOINT, planRuntimeTaskFailure({
      taskId: task.taskId, effect: 'read', outcome: 'failed', errorCode: 'TIMEOUT', occurredAt: at, evidenceRefs: ['read-1'],
    }));
    const host = createFailureRepairHost(runtime);
    assert.throws(() => host.act({taskId: task.taskId, action: 'retry', approved: true}), /额外字段/);
    const retried = host.act({taskId: task.taskId, action: 'retry'});
    assert.equal(retried.accepted, true);
    assert.equal(runtime.getTask(task.taskId).state, 'failed');
    assert.equal(runtime.getTask(retried.followUpTaskId).goal, '读取状态');
    assert.notEqual(retried.followUpTaskId, task.taskId);
    assert.deepEqual(runtime.loadCheckpoint(retried.followUpTaskId, TASK_FAILURE_READONLY_RETRY_CHECKPOINT), {
      version: 1,
      sourceTaskId: task.taskId,
      readOnly: true,
    });

    const mixedGoalTask = runtime.submitTask({goal: '读取后更新文件', conversationId: 'fixture', idempotencyKey: 'mixed-goal'});
    runtime.transitionTask(mixedGoalTask.taskId, 'failed', {error: {code: 'TIMEOUT', message: 'timeout', retryable: true}});
    runtime.saveCheckpoint(mixedGoalTask.taskId, TASK_FAILURE_REPAIR_CHECKPOINT, planRuntimeTaskFailure({
      taskId: mixedGoalTask.taskId, effect: 'read', outcome: 'failed', errorCode: 'TIMEOUT', occurredAt: at, evidenceRefs: ['read-2'],
    }));
    assert.equal(host.view(mixedGoalTask.taskId).canRetryRead, false);
    const rejectedMixed = host.act({taskId: mixedGoalTask.taskId, action: 'retry'});
    assert.equal(rejectedMixed.accepted, false);
    assert.equal(rejectedMixed.followUpTaskId, undefined);
    assert.match(rejectedMixed.reason, /包含写入或修改操作/);

    const priorSideEffectTask = runtime.submitTask({goal: '读取状态', conversationId: 'fixture', idempotencyKey: 'prior-side-effect'});
    runtime.transitionTask(priorSideEffectTask.taskId, 'failed', {error: {code: 'TIMEOUT', message: 'timeout', retryable: true}});
    runtime.saveCheckpoint(priorSideEffectTask.taskId, TASK_FAILURE_REPAIR_CHECKPOINT, planRuntimeTaskFailure({
      taskId: priorSideEffectTask.taskId, effect: 'read', priorSideEffects: true, outcome: 'failed', errorCode: 'TIMEOUT', occurredAt: at, evidenceRefs: ['read-3'],
    }));
    assert.equal(host.view(priorSideEffectTask.taskId).canRetryRead, false);
    const rejectedPrior = host.act({taskId: priorSideEffectTask.taskId, action: 'retry'});
    assert.equal(rejectedPrior.accepted, false);
    assert.equal(rejectedPrior.followUpTaskId, undefined);
    assert.match(rejectedPrior.reason, /此前步骤已有执行或副作用/);

    const risky = planRuntimeTaskFailure({taskId: task.taskId, effect: 'write', outcome: 'failed', risk: 'high', reconciliationOutcome: 'not_applied', occurredAt: at, evidenceRefs: ['write-1']});
    runtime.saveCheckpoint(task.taskId, TASK_FAILURE_REPAIR_CHECKPOINT, risky);
    const blocked = host.act({taskId: task.taskId, action: 'replan'});
    assert.equal(blocked.accepted, false);
    assert.equal(blocked.followUpTaskId, undefined);
    assert.equal(runtime.getTask(task.taskId).state, 'failed');
  } finally { runtime.close(); }
});

function createFakeDomElement(tagName) {
  const listeners = new Map();
  const node = {
    tagName: String(tagName).toUpperCase(),
    className: '',
    dataset: {},
    hidden: false,
    disabled: false,
    type: '',
    textContent: '',
    childNodes: [],
    parentNode: null,
    append(...children) {
      for (const child of children) {
        child.parentNode = node;
        node.childNodes.push(child);
      }
    },
    insertBefore(child) {
      child.parentNode = node;
      node.childNodes.push(child);
      return child;
    },
    replaceChildren() {
      node.childNodes = [];
    },
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    dispatchClick(target) {
      listeners.get('click')?.({target});
    },
    closest(selector) {
      let cursor = node;
      while (cursor) {
        if (selector === 'button[data-repair-locate]' && cursor.tagName === 'BUTTON' && cursor.dataset.repairLocate) return cursor;
        if (selector === 'button[data-repair]' && cursor.tagName === 'BUTTON' && cursor.dataset.repair) return cursor;
        cursor = cursor.parentNode;
      }
      return null;
    },
    querySelector(selector) {
      const queue = [...node.childNodes];
      while (queue.length) {
        const current = queue.shift();
        if (selector === '[data-repair-locate-result]' && current.dataset?.repairLocateResult) return current;
        if (selector === 'button[data-repair-locate]' && current.tagName === 'BUTTON' && current.dataset?.repairLocate) return current;
        queue.push(...(current.childNodes ?? []));
      }
      return null;
    },
  };
  return node;
}

test('failure repair card mounts locate button and renders task.locate file:line as plain text (L-06 #649)', async () => {
  const read = planRuntimeTaskFailure({taskId: 't-loc', effect: 'read', outcome: 'failed', errorCode: 'COMMAND_FAILED', occurredAt: at, evidenceRefs: ['e-1']});
  const model = failureRepairModel([{
    taskId: 't-loc',
    state: 'failed',
    hasCommandDiagnostic: true,
    error: {message: '语法检查未通过'},
    repair: {
      classification: 'correctable', effect: 'read', risk: 'ordinary', awaitingApproval: false, abandoned: false,
      canRetryRead: false, canReplan: true, canAbandon: true, recovery: read.recovery, attempts: [],
    },
  }]);
  assert.equal(model.hasDiagnostic, true);
  assert.equal(model.errorMessage, '语法检查未通过');
  assert.deepEqual(formatLocatedFailureLines({failures: []}), ['未能从错误输出定位到源码位置']);

  const previousDocument = globalThis.document;
  globalThis.document = {createElement: createFakeDomElement};
  try {
    const container = createFakeDomElement('div');
    const calls = [];
    const paint = mountFailureRepairCard(container, null, async (name, payload) => {
      calls.push({name, payload});
      return {
        totalFailures: 1,
        failures: [{
          name: 'SyntaxError',
          frames: [{file: 'broken<img onerror=1>.js', line: 3, column: 18, confidence: 0.95}],
        }],
      };
    });
    paint([{
      taskId: 't-loc',
      state: 'failed',
      hasCommandDiagnostic: true,
      error: {message: '语法检查未通过'},
      repair: {
        classification: 'correctable', effect: 'read', risk: 'ordinary', awaitingApproval: false, abandoned: false,
        canRetryRead: false, canReplan: true, canAbandon: true, recovery: read.recovery, attempts: [],
      },
    }]);
    const section = container.childNodes[0];
    const locateButton = section.querySelector('button[data-repair-locate]');
    const resultNode = section.querySelector('[data-repair-locate-result]');
    assert.ok(locateButton);
    assert.ok(resultNode);
    assert.equal(locateButton.textContent, '定位源码位置');
    assert.equal(resultNode.hidden, true);

    section.dispatchClick(locateButton);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [{name: 'task.locate', payload: {taskId: 't-loc', text: '语法检查未通过'}}]);
    assert.equal(resultNode.hidden, false);
    assert.equal(resultNode.textContent, 'SyntaxError · broken<img onerror=1>.js:3:18（置信度 95%）');
    assert.equal(resultNode.childNodes.length, 0);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
