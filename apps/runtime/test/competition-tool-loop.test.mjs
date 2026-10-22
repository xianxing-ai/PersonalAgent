import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {test} from 'node:test';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication} from '../dist/application.js';

const tool = {
  descriptor: {
    name: 'fixture.echo',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      required: ['value'],
      additionalProperties: false,
      properties: {value: {type: 'string'}},
    },
    outputSchema: {
      type: 'object',
      required: ['value'],
      additionalProperties: false,
      properties: {value: {type: 'string'}},
    },
    sideEffect: 'read',
    requiredScopes: ['fixture:read'],
    idempotencySupport: true,
    recoverySupport: true,
    requiresPresence: false,
  },
  execute: async input => input,
};

async function waitForState(app, taskId, states) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const task = app.runtime.getTask(taskId);
    if (states.includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('Task did not reach expected state');
}

test('competition tool proposal waits for local approval, executes once and resumes cloud answer', async () => {
  const base = new URL('../../../.cache/competition-tool-loop/', import.meta.url);
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(new URL('case-', base));
  let executions = 0;
  const registeredTool = {...tool, execute: async input => {
    executions++;
    return input;
  }};
  const port = new FakeCoordinationPort(request => {
    if (!request.continuation) {
      return {
        kind: 'tool_proposal',
        proposalId: 'proposal-1',
        toolName: 'fixture.echo',
        toolVersion: '1.0.0',
        arguments: {value: 'Beijing'},
        verification: 'mock',
      };
    }
    assert.deepEqual(request.continuation, {
      proposalId: 'proposal-1',
      state: 'confirmed',
      result: {value: 'Beijing'},
    });
    return {kind: 'text', text: '工具结果已核实', verification: 'mock'};
  });
  const app = createRuntimeApplication({
    path: directory + '/runtime.sqlite',
    profile: 'huawei_ict_agentarts',
    coordination: port,
    tools: [registeredTool],
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const {taskId} = await client.call(
      'task.submit',
      {goal: '查询北京天气', conversationId: 'competition'},
      {idempotencyKey: 'competition-tool'},
    );
    const waiting = await waitForState(app, taskId, ['waiting_approval', 'failed']);
    assert.equal(waiting.state, 'waiting_approval');
    assert.equal(executions, 0);
    assert.equal(port.requests.length, 1);

    const approvals = await client.call('approval.list', {taskId});
    assert.equal(approvals.items.length, 1);
    assert.equal(approvals.items[0].action, 'fixture.echo');
    assert.equal('arguments' in approvals.items[0], false);
    await client.call('authorization.respond', {
      approvalId: approvals.items[0].approvalId,
      expectedRevision: approvals.items[0].revision,
      decision: 'allow_once',
    });

    const task = await waitForState(app, taskId, ['succeeded', 'failed']);
    assert.equal(task.state, 'succeeded');
    assert.match(task.resultSummary, /工具结果已核实/);
    assert.equal(executions, 1);
    assert.equal(port.requests.length, 2);
    assert.deepEqual(task.evidenceRefs, [approvals.items[0].approvalId]);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});
test('competition proposal fails explicitly when the trusted host has no tools', async () => {
  const base = new URL('../../../.cache/competition-tool-loop/', import.meta.url);
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(new URL('case-', base));
  const port = new FakeCoordinationPort(() => ({
    kind: 'tool_proposal',
    proposalId: 'proposal-no-tools',
    toolName: 'fixture.echo',
    toolVersion: '1.0.0',
    arguments: {value: 'Beijing'},
    verification: 'mock',
  }));
  const app = createRuntimeApplication({
    path: directory + '/runtime.sqlite',
    profile: 'huawei_ict_agentarts',
    coordination: port,
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const {taskId} = await client.call(
      'task.submit',
      {goal: '查询北京天气', conversationId: 'competition'},
      {idempotencyKey: 'competition-no-tools'},
    );
    const task = await waitForState(app, taskId, ['succeeded', 'failed']);
    assert.equal(task.state, 'failed');
    assert.equal(task.error.code, 'UNSUPPORTED_CAPABILITY');
    assert.equal(port.requests.length, 1);
    assert.deepEqual(task.evidenceRefs, []);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});
test('unverified cloud proposal cannot export a local tool result', async () => {
  const base = new URL('../../../.cache/competition-tool-loop/', import.meta.url);
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(new URL('case-', base));
  let executions = 0;
  const port = new FakeCoordinationPort(() => ({
    kind: 'tool_proposal',
    proposalId: 'proposal-real',
    toolName: 'fixture.echo',
    toolVersion: '1.0.0',
    arguments: {value: 'private'},
    verification: 'unverified',
  }));
  const app = createRuntimeApplication({
    path: directory + '/runtime.sqlite',
    profile: 'huawei_ict_agentarts',
    coordination: port,
    tools: [{...tool, execute: async input => {
      executions++;
      return input;
    }}],
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const {taskId} = await client.call(
      'task.submit',
      {goal: '读取本地数据', conversationId: 'competition'},
      {idempotencyKey: 'competition-unverified'},
    );
    const task = await waitForState(app, taskId, ['succeeded', 'failed']);
    assert.equal(task.state, 'failed');
    assert.equal(task.error.code, 'UNSUPPORTED_CAPABILITY');
    assert.equal(executions, 0);
    assert.equal(port.requests.length, 1);
    assert.deepEqual((await client.call('approval.list', {taskId})).items, []);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});
test('competition approval resumes from the persisted proposal after Runtime restart', async () => {
  const base = new URL('../../../.cache/competition-tool-loop/', import.meta.url);
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(new URL('case-', base));
  const path = directory + '/runtime.sqlite';
  let executions = 0;
  const registeredTool = {...tool, execute: async input => {
    executions++;
    return input;
  }};
  const port = new FakeCoordinationPort(request => request.continuation
    ? {kind: 'text', text: '重启后续跑成功', verification: 'mock'}
    : {
        kind: 'tool_proposal',
        proposalId: 'proposal-restart',
        toolName: 'fixture.echo',
        toolVersion: '1.0.0',
        arguments: {value: 'persisted'},
        verification: 'mock',
      });

  let app = createRuntimeApplication({
    path,
    profile: 'huawei_ict_agentarts',
    coordination: port,
    tools: [registeredTool],
  });
  try {
    let client = new Client(app, Date.now);
    await client.connect();
    const {taskId} = await client.call(
      'task.submit',
      {goal: '重启恢复', conversationId: 'competition'},
      {idempotencyKey: 'competition-restart'},
    );
    assert.equal((await waitForState(app, taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
    const deadline = app.runtime.loadCheckpoint(taskId, 'application-deadline');
    app.close();

    app = createRuntimeApplication({
      path,
      profile: 'huawei_ict_agentarts',
      coordination: port,
      tools: [registeredTool],
    });
    client = new Client(app, Date.now);
    await client.connect();
    const approval = (await client.call('approval.list', {taskId})).items[0];
    assert.equal(approval.expiresAt, deadline);
    await client.call('authorization.respond', {
      approvalId: approval.approvalId,
      expectedRevision: approval.revision,
      decision: 'allow_once',
    });
    const task = await waitForState(app, taskId, ['succeeded', 'failed']);
    assert.equal(task.state, 'succeeded');
    assert.match(task.resultSummary, /重启后续跑成功/);
    assert.equal(executions, 1);
    assert.equal(port.requests.length, 2);
    assert.equal(port.requests[1].deadline, deadline);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('competition approval after original deadline times out without executing the tool', async () => {
  const base = new URL('../../../.cache/competition-tool-loop/', import.meta.url);
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(new URL('case-', base));
  let currentTime = Date.now();
  const now = () => currentTime;
  let executions = 0;
  const port = new FakeCoordinationPort(() => ({
    kind: 'tool_proposal',
    proposalId: 'proposal-expired',
    toolName: 'fixture.echo',
    toolVersion: '1.0.0',
    arguments: {value: 'expired'},
    verification: 'mock',
  }));
  const app = createRuntimeApplication({
    path: directory + '/runtime.sqlite',
    now: () => new Date(now()),
    profile: 'huawei_ict_agentarts',
    coordination: port,
    tools: [{...tool, execute: async input => { executions++; return input; }}],
  });
  try {
    const client = new Client(app, now);
    await client.connect();
    const {taskId} = await client.call(
      'task.submit',
      {goal: '过期审批', conversationId: 'competition'},
      {idempotencyKey: 'competition-expired', timeoutMs: 30_000},
    );
    assert.equal((await waitForState(app, taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
    const deadline = app.runtime.loadCheckpoint(taskId, 'application-deadline');
    const approval = (await client.call('approval.list', {taskId})).items[0];
    assert.equal(approval.expiresAt, deadline);
    currentTime = Date.parse(deadline) + 1;
    await assert.rejects(client.call('authorization.respond', {
      approvalId: approval.approvalId,
      expectedRevision: approval.revision,
      decision: 'allow_once',
    }), {code: 'TIMEOUT'});
    const task = await waitForState(app, taskId, ['failed']);
    assert.equal(task.error.code, 'TIMEOUT');
    assert.equal(executions, 0);
    assert.equal(port.requests.length, 1);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});
