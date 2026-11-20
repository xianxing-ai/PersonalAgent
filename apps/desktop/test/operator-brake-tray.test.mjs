import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {ToolGateway} from '@personal-agent/tool-gateway';
import {RuntimeError, TaskRuntime} from '@personal-agent/runtime';
import {
  createDesktopOperatorBrake,
  createOperatorBrakeTrayController,
  operatorBrakeTrayLabel,
  operatorBrakeTrayTooltip,
} from '../electron/operator-brake-host.js';

const deadline = new Date(Date.now() + 60_000).toISOString();

function addDueSchedule(runtime, scheduleId) {
  runtime.createSchedule({
    scheduleId,
    goal: 'scheduled check',
    conversationId: 'desktop-panel',
    runAt: new Date(Date.now() - 1000).toISOString(),
    timeZone: 'Asia/Shanghai',
    missedRunPolicy: 'run_once',
    taskIdempotencyKey: 'schedule-' + scheduleId,
  });
}

test('native tray brake controller synchronizes menu/panel, deduplicates concurrent toggles, and refuses replaying unknown writes or cloud-unknown tasks', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pa-z10-tray-brake-'));
  const database = join(directory, 'runtime.sqlite');
  const policy = new InMemoryAuthorizationPolicy();
  let readCalls = 0;
  let writeCalls = 0;
  let readEntered;
  let writeEntered;
  const readEnteredPromise = new Promise(resolve => { readEntered = resolve; });
  const writeEnteredPromise = new Promise(resolve => { writeEntered = resolve; });

  const gateway = new ToolGateway({policy, now: () => Date.now()});
  gateway.register({
    descriptor: {
      name: 'fixture.read',
      version: '1.0.0',
      inputSchema: {type: 'object', additionalProperties: false},
      outputSchema: {type: 'object', additionalProperties: false},
      sideEffect: 'read',
      requiredScopes: ['fixture:read'],
      idempotencySupport: true,
      recoverySupport: true,
      requiresPresence: false,
    },
    execute: async (_input, context) => {
      readCalls += 1;
      readEntered();
      if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'stopped');
      await new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(new ProtocolError('CANCELLED', 'stopped')), {once: true});
      });
    },
  });
  gateway.register({
    descriptor: {
      name: 'fixture.write',
      version: '1.0.0',
      inputSchema: {type: 'object', additionalProperties: false},
      outputSchema: {type: 'object', additionalProperties: false},
      sideEffect: 'local_write',
      requiredScopes: ['fixture:write'],
      idempotencySupport: true,
      recoverySupport: true,
      requiresPresence: false,
    },
    execute: async (_input, context) => {
      writeCalls += 1;
      writeEntered();
      if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'write outcome unknown');
      await new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(new ProtocolError('CANCELLED', 'write outcome unknown')), {once: true});
      });
    },
  });

  const runtime = new TaskRuntime(database, {toolGateway: gateway});
  const continued = [];
  const publishedSnapshots = [];
  let lastTooltip = '';
  let lastLabel = '';

  const brake = createDesktopOperatorBrake({
    getRuntime: () => runtime,
    continueTask: taskId => {
      continued.push(taskId);
      const taskDeadline = runtime.loadCheckpoint(taskId, 'application-deadline');
      return runtime.runTask(taskId, async context => {
        assert.equal(context.loadCheckpoint('agent-loop').step, 'read-resumable');
        return {resultSummary: 'resumed-from-checkpoint'};
      }, {deadline: taskDeadline, resume: true});
    },
  });
  brake.attach();
  const trayController = createOperatorBrakeTrayController({
    operatorBrake: brake,
    setToolTip: text => { lastTooltip = text; },
    setMenu: (_snapshot, label) => { lastLabel = label; },
    publish: () => { publishedSnapshots.push(brake.snapshot()); },
    onError: error => { throw error; },
  });

  const initial = trayController.refresh();
  assert.equal(initial.label, '暂停全部');
  assert.equal(initial.tooltip, 'PersonalAgent');
  assert.equal(lastLabel, '暂停全部');
  assert.equal(lastTooltip, 'PersonalAgent');

  let readRun;
  let writeRun;
  try {
    const client = new Client(runtime, Date.now);
    await client.connect();

    // Task A: in-flight read-only task (resumable on release)
    const readTask = runtime.submitTask({goal: 'in-flight read', conversationId: 'desktop-panel', idempotencyKey: 'tray-read'});
    runtime.saveCheckpoint(readTask.taskId, 'application-deadline', deadline);
    policy.grant({
      authorizationRef: 'auth-read',
      taskId: readTask.taskId,
      toolName: 'fixture.read',
      scopes: ['fixture:read'],
      expiresAt: deadline,
    });
    readRun = runtime.runTask(readTask.taskId, async context => {
      context.saveCheckpoint('agent-loop', {step: 'read-resumable'});
      await client.call('tool.invoke', {
        toolName: 'fixture.read', toolVersion: '1.0.0', arguments: {}, scopeRef: 'auth-read',
      }, {taskId: readTask.taskId, signal: context.signal, timeoutMs: 20_000});
      return {resultSummary: 'should-not-finish'};
    }, {deadline});

    // Task B: in-flight write task whose execution started before abort (must stay waiting_reconciliation)
    const writeTask = runtime.submitTask({goal: 'in-flight write', conversationId: 'desktop-panel', idempotencyKey: 'tray-write'});
    runtime.saveCheckpoint(writeTask.taskId, 'application-deadline', deadline);
    policy.grant({
      authorizationRef: 'auth-write',
      taskId: writeTask.taskId,
      toolName: 'fixture.write',
      scopes: ['fixture:write'],
      expiresAt: deadline,
    });
    writeRun = runtime.runTask(writeTask.taskId, async context => {
      context.saveCheckpoint('agent-loop', {step: 'write-started'});
      await client.call('tool.invoke', {
        toolName: 'fixture.write', toolVersion: '1.0.0', arguments: {}, scopeRef: 'auth-write',
      }, {taskId: writeTask.taskId, signal: context.signal, timeoutMs: 20_000});
      return {resultSummary: 'should-not-finish'};
    }, {deadline});

    // Task C: active task marked with competition-cloud-unknown checkpoint (must never replay on release)
    const cloudTask = runtime.submitTask({goal: 'cloud unknown', conversationId: 'desktop-panel', idempotencyKey: 'tray-cloud'});
    runtime.saveCheckpoint(cloudTask.taskId, 'application-deadline', deadline);
    runtime.transitionTask(cloudTask.taskId, 'planning');
    runtime.saveCheckpoint(cloudTask.taskId, 'competition-cloud-unknown', {requestId: 'cloud-req-1'});

    await Promise.all([readEnteredPromise, writeEnteredPromise]);
    addDueSchedule(runtime, 'tray-due-1');

    // Rapid double click on tray menu engage must share one single-flight toggle promise.
    const t1 = trayController.toggle();
    const t2 = trayController.toggle();
    assert.equal(trayController.isToggling(), true);
    const [engaged1, engaged2] = await Promise.all([t1, t2]);
    assert.equal(trayController.isToggling(), false);
    assert.equal(engaged1.paused, true);
    assert.equal(engaged2.paused, true);
    assert.equal(lastLabel, '恢复运行');
    assert.equal(lastTooltip, 'PersonalAgent · 已暂停');
    assert.equal(publishedSnapshots.at(-1).paused, true);

    assert.throws(() => runtime.submitTask({goal: 'blocked', conversationId: 'desktop-panel', idempotencyKey: 'tray-blocked'}),
      error => error instanceof RuntimeError && error.message.includes('总暂停'));
    assert.deepEqual(runtime.dispatchDueSchedules('desktop-panel'), []);

    const [stoppedRead, stoppedWrite] = await Promise.all([readRun, writeRun]);
    assert.equal(stoppedRead.state, 'waiting_reconciliation');
    assert.equal(stoppedWrite.state, 'waiting_reconciliation');
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const writeExec = runtime.readToolExecutions(writeTask.taskId).find(r => r.toolName === 'fixture.write');
      if (writeExec && !runtime.isToolExecutionActive(writeExec)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Tray release resumes only safe read task; unknown write and cloud-unknown tasks remain in waiting_reconciliation.
    const released = await trayController.toggle();
    assert.equal(released.paused, false);
    assert.equal(lastLabel, '暂停全部');
    assert.equal(lastTooltip, 'PersonalAgent');
    assert.equal(publishedSnapshots.at(-1).paused, false);
    assert.deepEqual(continued, [readTask.taskId]);
    assert.equal(runtime.getTask(readTask.taskId).state, 'succeeded');
    assert.equal(runtime.getTask(writeTask.taskId).state, 'waiting_reconciliation');
    assert.equal(runtime.getTask(cloudTask.taskId).state, 'waiting_reconciliation');
    assert.equal(readCalls, 1);
    assert.equal(writeCalls, 1);
    assert.equal(runtime.dispatchDueSchedules('desktop-panel')[0].status, 'fired');

    // Re-engage from tray before closing runtime and verify restart preserves paused tray presentation.
    await trayController.toggle();
    addDueSchedule(runtime, 'tray-due-2');
  } finally {
    await Promise.allSettled([readRun, writeRun].filter(Boolean));
    runtime.close();
  }

  const restarted = new TaskRuntime(database);
  try {
    const restartedBrake = createDesktopOperatorBrake({
      getRuntime: () => restarted,
      continueTask: () => { throw Error('restarted paused runtime must not auto-continue'); },
    });
    const attached = restartedBrake.attach();
    assert.equal(attached.paused, true);
    assert.equal(operatorBrakeTrayLabel(attached), '恢复运行');
    assert.equal(operatorBrakeTrayTooltip(attached), 'PersonalAgent · 已暂停');
    assert.deepEqual(restarted.dispatchDueSchedules('desktop-panel'), []);
  } finally {
    restarted.close();
    rmSync(directory, {recursive: true, force: true});
  }
});

test('main.js delegates tray brake refresh/toggle to createOperatorBrakeTrayController', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(main, /createOperatorBrakeTrayController\(/);
  assert.match(main, /operatorBrakeTray\.refresh\(\)/);
  assert.match(main, /operatorBrakeTray\.toggle\(\)/);
  assert.match(main, /if \(name === 'operator\.brake'\)/);
});
