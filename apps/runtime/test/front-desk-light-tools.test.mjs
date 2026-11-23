import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication} from '../dist/application.js';
import {USER_TASK_DELEGATION} from '../dist/application/user-task-delegation.js';

const weather = {
  descriptor: {
    name: 'weather.forecast', version: '1.0.0',
    inputSchema: {type: 'object', additionalProperties: false, properties: {city: {type: 'string'}}},
    outputSchema: {type: 'object', additionalProperties: true},
    sideEffect: 'read', requiredScopes: ['weather:read'],
    idempotencySupport: true, recoverySupport: true, requiresPresence: false,
  },
  execute: async () => ({city: '青岛', summary: '多云'}),
};

test('front-desk panel turn keeps light tools and skips forced user-work delegation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'front-desk-light-'));
  const port = new FakeCoordinationPort(request => {
    if (request.continuation) {
      return {kind: 'text', text: '青岛今天多云', verification: 'unverified'};
    }
    return {
      kind: 'tool_proposal', proposalId: 'weather-1',
      toolName: 'weather.forecast', toolVersion: '1.0.0',
      arguments: {city: '青岛'}, verification: 'unverified',
    };
  });
  const app = createRuntimeApplication({
    path: join(directory, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts',
    coordination: port,
    delegateUserTasks: true,
    competitionMaxSteps: 4,
    competitionToolExports: [{
      toolName: 'weather.forecast', toolVersion: '1.0.0', exportPolicyVersion: 'v1',
      accepts: () => true, project: ({result}) => result,
    }],
    tools: [weather],
    automaticTools: [{toolName: 'weather.forecast', toolVersion: '1.0.0'}],
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const {taskId} = await client.call('task.submit', {
      goal: '青岛今天天气怎么样',
      conversationId: 'panel-main-chat',
    }, {idempotencyKey: 'front-desk-weather-1'});
    for (let i = 0; i < 80; i++) {
      if (app.runtime.loadCheckpoint(taskId, 'front-desk-turn')) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(app.runtime.loadCheckpoint(taskId, 'front-desk-turn'), 'front-desk-turn checkpoint required');
    assert.equal(app.runtime.loadCheckpoint(taskId, USER_TASK_DELEGATION), undefined,
      'front-desk must not force required-subagent-delegation');
    const tools = app.tools?.list().map(item => item.name) ?? [];
    assert.ok(tools.includes('weather.forecast'));
    // Settle far enough for the first coordination step to use the front-desk catalog.
    for (let i = 0; i < 200; i++) {
      const task = app.runtime.getTask(taskId);
      if (['waiting_approval', 'succeeded', 'failed', 'cancelled'].includes(task.state)) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const task = app.runtime.getTask(taskId);
    assert.notEqual(task.state, 'failed', task.error?.message ?? task.state);
    const children = app.runtime.listTasks({conversationId: `desktop-subtask:${taskId}`, limit: 10}).items;
    assert.equal(children.length, 0, 'light front-desk weather must not spawn user-work child');
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});
