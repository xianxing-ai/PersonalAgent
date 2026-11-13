import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {ToolGateway} from '@personal-agent/tool-gateway';
import {OPERATOR_BRAKE_CHECKPOINT, RuntimeError, TaskRuntime} from '../dist/index.js';

const root = fileURLToPath(new URL('../../../.cache/runtime-tests/', import.meta.url));
mkdirSync(root, {recursive: true});
const file = () => join(mkdtempSync(join(root, 'brake-')), 'runtime.sqlite');

function fixture() {
  let current = Date.parse('2026-11-11T00:00:00.000Z');
  let sequence = 0;
  const options = {now: () => new Date(current), idFactory: () => 'brake-' + ++sequence};
  return {path: file(), options, setNow(value) {current = Date.parse(value);}};
}

const deadline = '2026-11-11T01:00:00.000Z';

function schedule(runtime, id = 'reminder-1') {
  runtime.createSchedule({
    scheduleId: id, goal: 'send the reminder', conversationId: 'desktop-panel',
    runAt: '2026-11-11T00:00:00.000Z', timeZone: 'Asia/Shanghai', missedRunPolicy: 'run_once',
    taskIdempotencyKey: 'schedule-' + id,
  });
}

test('operator pause blocks new tasks and schedules, holds the running tool, resumes, and survives restart', async () => {
  const setup = fixture();
  const policy = new InMemoryAuthorizationPolicy();
  let calls = 0;
  let toolEntered;
  const toolEnteredPromise = new Promise(resolve => {toolEntered = resolve;});
  const gateway = new ToolGateway({policy, now: () => setup.options.now().getTime()});
  gateway.register({
    descriptor: {
      name: 'fixture.read', version: '1.0.0',
      inputSchema: {type: 'object', additionalProperties: false},
      outputSchema: {type: 'object', additionalProperties: false},
      sideEffect: 'read', requiredScopes: ['fixture:read'], idempotencySupport: true,
      recoverySupport: true, requiresPresence: false,
    },
    execute: async (_input, context) => {
      calls += 1;
      toolEntered();
      if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'stopped');
      await new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(new ProtocolError('CANCELLED', 'stopped')), {once: true});
      });
    },
  });
  const runtime = new TaskRuntime(setup.path, {...setup.options, toolGateway: gateway});
  let heldId = '';
  try {
    const client = new Client(runtime, () => setup.options.now().getTime());
    await client.connect();
    const task = runtime.submitTask({goal: 'read then continue', conversationId: 'desktop-panel', idempotencyKey: 'brake-task'});
    heldId = task.taskId;
    runtime.saveCheckpoint(task.taskId, 'application-deadline', deadline);
    policy.grant({
      authorizationRef: 'auth-read', taskId: task.taskId, toolName: 'fixture.read', scopes: ['fixture:read'],
      expiresAt: deadline,
    });
    schedule(runtime);
    const running = runtime.runTask(task.taskId, async context => {
      context.saveCheckpoint('agent-loop', {step: 1});
      await client.call('tool.invoke', {
        toolName: 'fixture.read', toolVersion: '1.0.0', arguments: {}, scopeRef: 'auth-read',
      }, {taskId: task.taskId, signal: context.signal, timeoutMs: 20000});
      return {resultSummary: 'should-not-finish'};
    }, {deadline});
    await toolEnteredPromise;
    assert.equal(calls, 1);
    runtime.setOperatorPause(true);
    assert.throws(() => runtime.submitTask({goal: 'new work', conversationId: 'desktop-panel', idempotencyKey: 'new-task'}),
      error => error instanceof RuntimeError && error.code === 'CANCELLED' && error.message.includes('总暂停'));
    assert.deepEqual(runtime.dispatchDueSchedules('desktop-panel'), []);
    assert.equal(runtime.getSchedule('reminder-1').status, 'pending');
    assert.equal(runtime.submitTask({goal: 'read then continue', conversationId: 'desktop-panel', idempotencyKey: 'brake-task'}).taskId, task.taskId);
    const held = runtime.holdForOperatorPause(task.taskId);
    assert.equal(held.state, 'waiting_reconciliation');
    assert.equal(held.cancelRequested, undefined);
    const marker = runtime.loadCheckpoint(task.taskId, OPERATOR_BRAKE_CHECKPOINT);
    assert.equal(marker.version, '1.0');
    assert.equal(marker.originalState, 'running');
    assert.equal(marker.cursor.step, 1);
    runtime.holdForOperatorPause(task.taskId);
    assert.equal(runtime.loadCheckpoint(task.taskId, OPERATOR_BRAKE_CHECKPOINT).originalState, 'running');
    await assert.rejects(
      client.call('tool.invoke', {
        toolName: 'fixture.read', toolVersion: '1.0.0', arguments: {}, scopeRef: 'auth-read',
      }, {taskId: task.taskId, idempotencyKey: 'paused-tool-call', timeoutMs: 20000}),
      error => error.code === 'CANCELLED',
    );
    const deniedWhilePaused = runtime.readToolExecutions(task.taskId).find(record => record.evidenceId === 'paused-tool-call');
    assert.equal(deniedWhilePaused?.state, 'failed');
    assert.equal(deniedWhilePaused?.errorCode, 'CANCELLED');
    assert.equal(deniedWhilePaused?.policyDecision, 'deny');
    assert.equal(deniedWhilePaused?.executionStarted, false);
    assert.equal(runtime.loadCheckpoint(task.taskId, 'agent-loop').step, 1);
    const stopped = await running;
    assert.equal(stopped.state, 'waiting_reconciliation');
    assert.equal(calls, 1);
    let execution;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      execution = runtime.readToolExecutions(task.taskId).find(record => record.toolName === 'fixture.read');
      if (execution?.state === 'failed' && !runtime.isToolExecutionActive(execution)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(execution.state, 'failed');
    assert.equal(execution.errorCode, 'CANCELLED');

    runtime.setOperatorPause(false);
    const reopened = runtime.resumeOperatorHold(task.taskId);
    assert.equal(reopened.state, 'waiting_approval');
    const continued = await runtime.runTask(task.taskId, async context => {
      const loop = context.loadCheckpoint('agent-loop');
      assert.equal(loop.step, 1);
      return {resultSummary: 'continued:1'};
    }, {deadline, resume: true});
    assert.equal(continued.state, 'succeeded');
    assert.equal(continued.resultSummary, 'continued:1');
    assert.equal(calls, 1);
    const fired = runtime.dispatchDueSchedules('desktop-panel');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].status, 'fired');
    assert.equal(runtime.getSchedule('reminder-1').status, 'fired');

    schedule(runtime, 'reminder-2');
    runtime.setOperatorPause(true);
  } finally {
    runtime.close();
  }

  const reopened = new TaskRuntime(setup.path, setup.options);
  try {
    assert.equal(reopened.isOperatorPaused(), true);
    assert.throws(() => reopened.submitTask({goal: 'after restart', conversationId: 'desktop-panel', idempotencyKey: 'after-restart'}),
      error => error instanceof RuntimeError && error.message.includes('总暂停'));
    assert.deepEqual(reopened.dispatchDueSchedules('desktop-panel'), []);
    assert.equal(reopened.getSchedule('reminder-2').status, 'pending');
    assert.equal(reopened.loadCheckpoint(heldId, 'agent-loop').step, 1);
  } finally {
    reopened.close();
  }
});
