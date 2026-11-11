import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {ToolGateway} from '@personal-agent/tool-gateway';
import {RuntimeError, TaskRuntime} from '@personal-agent/runtime';
import {createDesktopOperatorBrake, OPERATOR_BRAKE_ACTION, operatorBrakeTrayLabel} from '../electron/operator-brake-host.js';
import {createDesktopProactiveRuntimePump} from '../electron/proactive-runtime-pump.js';

const deadline = new Date(Date.now() + 60_000).toISOString();

function schedule(runtime, id) {
  runtime.createSchedule({
    scheduleId: id, goal: 'remind the user', conversationId: 'desktop-panel',
    runAt: new Date(Date.now() - 1000).toISOString(), timeZone: 'Asia/Shanghai',
    missedRunPolicy: 'run_once', taskIdempotencyKey: 'schedule-' + id,
  });
}

test('desktop brake, IPC handler, scheduler and in-flight tool share one pause', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'operator-brake-'));
  const database = join(directory, 'runtime.sqlite');
  const policy = new InMemoryAuthorizationPolicy();
  let calls = 0;
  let toolEntered;
  const toolEnteredPromise = new Promise(resolve => {toolEntered = resolve;});
  const gateway = new ToolGateway({policy, now: () => Date.now()});
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
  const runtime = new TaskRuntime(database, {toolGateway: gateway});
  const continued = [];
  const host = createDesktopOperatorBrake({
    getRuntime: () => runtime,
    continueTask: taskId => {
      continued.push(taskId);
      const taskDeadline = runtime.loadCheckpoint(taskId, 'application-deadline');
      return runtime.runTask(taskId, async context => {
        assert.equal(context.loadCheckpoint('agent-loop').step, 1);
        return {resultSummary: 'continued:1'};
      }, {deadline: taskDeadline, resume: true});
    },
  });
  host.attach();
  const pump = createDesktopProactiveRuntimePump({
    getApplication: () => {throw Error('paused pump must not read the application');},
    getWorkflow: () => {throw Error('paused pump must not read the workflow');},
    resolveUserConversation: () => {throw Error('paused pump must not resolve a conversation');},
    isPaused: () => host.isPaused(),
  });
  let heldId = '';
  try {
    const client = new Client(runtime, Date.now);
    await client.connect();
    const task = runtime.submitTask({goal: 'read then continue', conversationId: 'desktop-panel', idempotencyKey: 'brake-task'});
    heldId = task.taskId;
    runtime.saveCheckpoint(task.taskId, 'application-deadline', deadline);
    policy.grant({
      authorizationRef: 'auth-read', taskId: task.taskId, toolName: 'fixture.read', scopes: ['fixture:read'],
      expiresAt: deadline,
    });
    schedule(runtime, 'reminder-1');
    const running = runtime.runTask(task.taskId, async context => {
      context.saveCheckpoint('agent-loop', {step: 1});
      await client.call('tool.invoke', {
        toolName: 'fixture.read', toolVersion: '1.0.0', arguments: {}, scopeRef: 'auth-read',
      }, {taskId: task.taskId, signal: context.signal, timeoutMs: 20000});
      return {resultSummary: 'should-not-finish'};
    }, {deadline});
    await toolEnteredPromise;
    assert.equal(operatorBrakeTrayLabel(host.snapshot()), '暂停全部');
    const paused = await host.handleAction(OPERATOR_BRAKE_ACTION, {paused: true});
    assert.equal(paused.paused, true);
    assert.equal(host.triggersHeld(), true);
    assert.deepEqual(await pump.tick(), {state: 'paused', sessions: []});
    assert.throws(() => runtime.submitTask({goal: 'new work', conversationId: 'desktop-panel', idempotencyKey: 'new-task'}),
      error => error instanceof RuntimeError && error.message.includes('总暂停'));
    assert.deepEqual(runtime.dispatchDueSchedules('desktop-panel'), []);
    assert.equal(runtime.getSchedule('reminder-1').status, 'pending');
    const stopped = await running;
    assert.equal(stopped.state, 'waiting_reconciliation');
    assert.notEqual(stopped.state, 'cancelled');
    assert.equal(calls, 1);
    assert.equal(runtime.loadCheckpoint(task.taskId, 'agent-loop').step, 1);
    let execution;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      execution = runtime.readToolExecutions(task.taskId).find(record => record.toolName === 'fixture.read');
      if (execution?.state === 'failed' && !runtime.isToolExecutionActive(execution)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(execution.errorCode, 'CANCELLED');

    const resumed = await host.handleAction(OPERATOR_BRAKE_ACTION, {paused: false});
    assert.equal(resumed.paused, false);
    assert.deepEqual(continued, [task.taskId]);
    assert.equal(runtime.getTask(task.taskId).state, 'succeeded');
    assert.equal(runtime.getTask(task.taskId).resultSummary, 'continued:1');
    assert.equal(calls, 1);
    assert.equal(runtime.dispatchDueSchedules('desktop-panel')[0].status, 'fired');
    assert.equal(operatorBrakeTrayLabel(host.snapshot()), '暂停全部');

    await host.handleAction(OPERATOR_BRAKE_ACTION, {paused: true});
    schedule(runtime, 'reminder-2');
  } finally {
    runtime.close();
  }

  const restartedRuntime = new TaskRuntime(database);
  const restarted = createDesktopOperatorBrake({
    getRuntime: () => restartedRuntime,
    continueTask: () => {throw Error('restart must not resume while the pause is still stored');},
  });
  try {
    restarted.attach();
    assert.equal(restarted.isPaused(), true);
    assert.equal(restarted.triggersHeld(), true);
    assert.equal(operatorBrakeTrayLabel(restarted.snapshot()), '恢复运行');
    assert.throws(() => restartedRuntime.submitTask({goal: 'after restart', conversationId: 'desktop-panel', idempotencyKey: 'after-restart'}),
      error => error instanceof RuntimeError && error.message.includes('总暂停'));
    assert.deepEqual(restartedRuntime.dispatchDueSchedules('desktop-panel'), []);
    assert.equal(restartedRuntime.getSchedule('reminder-2').status, 'pending');
    assert.equal(restartedRuntime.loadCheckpoint(heldId, 'agent-loop').step, 1);
    assert.equal(restartedRuntime.loadCheckpoint(heldId, 'operator-brake:v1').version, '1.0');
  } finally {
    restartedRuntime.close();
  }
});

test('startup wiring exposes the brake through preload, IPC and resumeTask', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../src/app/renderer.js', import.meta.url), 'utf8');
  assert.match(main, /createDesktopOperatorBrake\(\{/);
  assert.match(main, /continueTask: taskId => runtimeApplication\.resumeTask\(taskId\)/);
  assert.match(main, /operatorBrake\.attach\(\)/);
  assert.match(main, /operatorBrake\.handleAction\(name, payload\)/);
  assert.match(main, /isPaused:\(\)=>typeof operatorBrake!=='undefined'&&operatorBrake\.isPaused\(\)/);
  assert.match(main, /typeof operatorBrake !== 'undefined' && operatorBrake\.isPaused\(\)/);
  assert.match(preload, /setOperatorBrake: paused => ipcRenderer\.invoke\('desktop:action', 'operator\.brake'/);
  assert.match(renderer, /bridge\.setOperatorBrake\(paused\)/);
  assert.match(renderer, /id='operator-brake'/);
});
