import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication} from '../dist/application.js';
import {isUserToolAuthorizationDenied, userDeniedToolContinuationResult} from '../dist/application/coordination.js';
import {ProtocolError} from '@personal-agent/contracts';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';

const descriptor = {
  name: 'fixture.note', version: '1.0.0',
  inputSchema: {type: 'object', required: ['text'], additionalProperties: false,
    properties: {text: {type: 'string'}}},
  outputSchema: {type: 'object', required: ['ok'], additionalProperties: false,
    properties: {ok: {type: 'boolean'}}},
  sideEffect: 'read', requiredScopes: ['fixture:read'],
  idempotencySupport: true, recoverySupport: true, requiresPresence: false,
};
const proposal = {
  kind: 'tool_proposal', proposalId: 'note-1', toolName: descriptor.name,
  toolVersion: descriptor.version, arguments: {text: 'draft'}, verification: 'unverified',
};

async function settle(app, taskId, states) {
  for (let i = 0; i < 400; i++) {
    const task = app.runtime.getTask(taskId);
    if (states.includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw Error('Task did not settle');
}

test('isUserToolAuthorizationDenied only matches explicit user denial messages', () => {
  assert.equal(isUserToolAuthorizationDenied(new ProtocolError('UNAUTHORIZED', 'User denied this operation')), true);
  assert.equal(isUserToolAuthorizationDenied(new ProtocolError('UNAUTHORIZED', 'Tool approval was denied')), true);
  assert.equal(isUserToolAuthorizationDenied(new ProtocolError('UNAUTHORIZED', 'Competition result export denied')), false);
  assert.equal(isUserToolAuthorizationDenied(new ProtocolError('CANCELLED', 'User denied this operation')), false);
});

test('userDeniedToolContinuationResult is a stable not_performed payload', () => {
  assert.equal(userDeniedToolContinuationResult(proposal).reason, 'user_denied');
  assert.equal(userDeniedToolContinuationResult(proposal).toolName, 'fixture.note');
});

test('denying a conversation tool keeps the task recoverable and feeds not_performed to the next cloud turn', async () => {
  const base = new URL('../../../.cache/user-deny-recovery/', import.meta.url);
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(new URL('case-', base));
  let executions = 0;
  const port = new FakeCoordinationPort(request => request.continuation
    ? {kind: 'text', text: '已根据拒绝改用已有信息作答', verification: 'unverified'}
    : proposal);
  const app = createRuntimeApplication({
    path: directory + '/runtime.sqlite', profile: 'huawei_ict_agentarts', coordination: port,
    competitionToolExports: [{
      toolName: descriptor.name, toolVersion: descriptor.version, exportPolicyVersion: 'v1',
      accepts: () => true, project: ({result}) => result,
    }],
    tools: [{descriptor, execute: async () => { executions++; return {ok: true}; }}],
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const {taskId} = await client.call('task.submit', {goal: '查一条笔记', conversationId: 'deny-chat'},
      {idempotencyKey: 'deny-1'});
    const waiting = await settle(app, taskId, ['waiting_approval', 'failed', 'cancelled']);
    assert.equal(waiting.state, 'waiting_approval', `expected approval wait, got ${waiting.state} ${waiting.error?.code ?? ''}`);
    const approval = (await client.call('approval.list', {taskId})).items[0];
    await client.call('authorization.respond', {
      approvalId: approval.approvalId, expectedRevision: approval.revision, decision: 'deny',
    });
    const task = await settle(app, taskId, ['succeeded', 'failed', 'cancelled']);
    assert.equal(task.state, 'succeeded', '偶发拒绝不得取消整段对话任务');
    assert.equal(executions, 0, '拒绝后不得执行工具');
    assert.equal(port.requests.length, 2);
    assert.equal(port.requests[1].continuation.result.kind, 'not_performed');
    assert.equal(port.requests[1].continuation.result.reason, 'user_denied');
    assert.match(task.resultSummary, /已根据拒绝改用已有信息作答/);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});
