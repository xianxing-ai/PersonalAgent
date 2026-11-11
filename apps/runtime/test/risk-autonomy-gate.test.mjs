import assert from 'node:assert/strict';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {AutonomyPolicyConfig, createRiskAutonomyGate} from '@personal-agent/autonomy';
import {createRuntimeApplication} from '../dist/application.js';

const schema = {type: 'object', additionalProperties: false, required: ['note'],
  properties: {note: {type: 'string', minLength: 1, maxLength: 40}}};
const output = {type: 'object', additionalProperties: false, required: ['value'], properties: {value: {type: 'string'}}};

function descriptor(name, sideEffect, extra = {}) {
  return {name, version: '1.0.0', inputSchema: schema, outputSchema: output, sideEffect,
    requiredScopes: ['fixture:use'], idempotencySupport: true, recoverySupport: false, requiresPresence: false, ...extra};
}

function application(tools, options = {}) {
  const executions = [];
  const registered = tools.map(item => ({descriptor: item, execute: async () => {
    executions.push(item.name);
    return {value: item.name};
  }}));
  const app = createRuntimeApplication({
    path: ':memory:',
    profile: 'huawei_ict_agentarts',
    tools: registered,
    competitionToolExports: tools.map(item => ({
      toolName: item.name, toolVersion: item.version, exportPolicyVersion: 'fixture-v1',
      accepts: () => true, project: ({result}) => ({value: result.value}),
    })),
    competitionToolAvailability: tools.map(item => ({toolName: item.name, toolVersion: item.version, available: () => true})),
    coordination: {execute: async request => request.continuation
      ? {kind: 'text', text: 'Synthetic result', verification: 'unverified'}
      : {kind: 'tool_proposal', proposalId: 'proposal-1', toolName: tools[0].name, toolVersion: '1.0.0',
        arguments: {note: 'ok'}, verification: 'unverified'}},
    ...options,
  });
  return {app, executions};
}

async function submit(app) {
  const client = new Client(app, Date.now);
  await client.connect();
  const {taskId} = await client.call('task.submit', {goal: 'Synthetic risk autonomy', conversationId: 'risk'},
    {idempotencyKey: crypto.randomUUID()});
  for (let attempt = 0; attempt < 200; attempt++) {
    const task = app.runtime.getTask(taskId);
    if (['succeeded', 'failed', 'waiting_approval', 'waiting_reconciliation'].includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Synthetic task did not settle');
}

test('without a risk gate, a read that is not in automaticTools still waits for approval', async () => {
  const {app, executions} = application([descriptor('weather.forecast', 'read')]);
  try {
    const task = await submit(app);
    assert.equal(task.state, 'waiting_approval');
    assert.deepEqual(executions, []);
  } finally {app.close();}
});

test('the autonomous gate executes a low-risk read and a compensatable write, then records the audit', async () => {
  const config = new AutonomyPolicyConfig();
  const read = descriptor('weather.forecast', 'read');
  const write = descriptor('todo.update', 'local_write', {recoverySupport: true});
  const {app, executions} = application([read, write], {riskAutonomy: createRiskAutonomyGate(config)});
  try {
    const readTask = await submit(app);
    assert.equal(readTask.state, 'succeeded', readTask.error?.message);
    assert.deepEqual(executions, ['weather.forecast']);
    const readAudit = config.listAudits().find(item => item.toolName === 'weather.forecast');
    assert.equal(readAudit?.disposition, 'execute');
    assert.equal(config.listNotifications().find(item => item.auditId === readAudit.auditId)?.immediate, false);
    const auditKey = app.runtime.listCheckpointKeys(readTask.taskId).find(key => key.startsWith('risk-autonomy-audit:'));
    assert.equal(app.runtime.loadCheckpoint(readTask.taskId, auditKey)?.disposition, 'execute');
  } finally {app.close();}

  const second = application([write], {riskAutonomy: createRiskAutonomyGate(config)});
  try {
    const task = await submit(second.app);
    assert.equal(task.state, 'succeeded', task.error?.message);
    assert.deepEqual(second.executions, ['todo.update']);
    const audit = config.listAudits().find(item => item.toolName === 'todo.update');
    assert.equal(audit?.immediate, true);
    assert.equal(audit?.rollback, 'available');
    assert.equal(config.requestUndo(audit.auditId).compensation.action, 'todo.update');
  } finally {second.app.close();}
});

test('irreversible and external writes still wait, and a revoked gate stops later automatic reads', async () => {
  const config = new AutonomyPolicyConfig();
  const send = descriptor('mail.send', 'external_write');
  const {app, executions} = application([send], {riskAutonomy: createRiskAutonomyGate(config)});
  try {
    const task = await submit(app);
    assert.equal(task.state, 'waiting_approval');
    assert.deepEqual(executions, []);
    assert.equal(config.listAudits().length, 0);
  } finally {app.close();}

  const buggy = application([descriptor('payment.pay', 'external_write')], {riskAutonomy: {
    review: () => ({disposition: 'execute', irreversible: false, compensatable: true}),
  }});
  try {
    const task = await submit(buggy.app);
    assert.equal(task.state, 'waiting_approval');
    assert.deepEqual(buggy.executions, []);
  } finally {buggy.app.close();}

  const uncompensated = application([descriptor('notes.rewrite', 'local_write')], {riskAutonomy: {
    review: () => ({disposition: 'execute', irreversible: false, compensatable: false}),
  }});
  try {
    const task = await submit(uncompensated.app);
    assert.equal(task.state, 'waiting_approval');
    assert.deepEqual(uncompensated.executions, []);
  } finally {uncompensated.app.close();}

  config.revoke();
  const revoked = application([descriptor('weather.forecast', 'read')], {
    automaticTools: [{toolName: 'weather.forecast', toolVersion: '1.0.0'}],
    riskAutonomy: createRiskAutonomyGate(config),
  });
  try {
    const task = await submit(revoked.app);
    assert.equal(task.state, 'waiting_approval');
    assert.deepEqual(revoked.executions, []);
  } finally {revoked.app.close();}
});

test('a conservative gate can force an automaticTools read back to approval', async () => {
  const config = new AutonomyPolicyConfig({stance: 'conservative'});
  const {app, executions} = application([descriptor('weather.forecast', 'read')], {
    automaticTools: [{toolName: 'weather.forecast', toolVersion: '1.0.0'}],
    riskAutonomy: createRiskAutonomyGate(config),
  });
  try {
    const task = await submit(app);
    assert.equal(task.state, 'waiting_approval');
    assert.deepEqual(executions, []);
    assert.equal(config.listAudits().length, 0);
  } finally {app.close();}
});
