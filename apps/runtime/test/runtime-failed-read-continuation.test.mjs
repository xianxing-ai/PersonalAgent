import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ProtocolError} from '@personal-agent/contracts';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {ToolGateway, toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {TaskRuntime} from '../dist/index.js';

mkdirSync(join(process.cwd(), '.cache'), {recursive: true});
async function failedOperation({sideEffect = 'read', errorCode = 'EXTERNAL_FAILURE', authorize = true} = {}) {
  const path = join(mkdtempSync(join(process.cwd(), '.cache', 'failed-read-continuation-')), 'runtime.sqlite');
  const now = Date.now(), deadline = new Date(now + 60_000).toISOString();
  const policy = new InMemoryAuthorizationPolicy(), gateway = new ToolGateway({policy, now: () => now});
  let calls = 0;
  const descriptor = {name: 'fixture.failed_operation', version: '1.0.0', inputSchema: {type: 'object'}, outputSchema: {type: 'object'},
    sideEffect, requiredScopes: ['fixture:operation'], idempotencySupport: true, recoverySupport: true, requiresPresence: false};
  const unregister = gateway.register({descriptor, execute: async () => {calls++; throw new ProtocolError(errorCode, 'Explicit fixture failure');}});
  const runtime = new TaskRuntime(path, {now: () => new Date(now), toolGateway: gateway});
  const task = runtime.submitTask({goal: 'Continue after a settled read failure only', conversationId: 'fixture-read-recovery', idempotencyKey: 'original'});
  runtime.saveCheckpoint(task.taskId, 'application-deadline', deadline);
  runtime.transitionTask(task.taskId, 'planning'); runtime.transitionTask(task.taskId, 'running');
  if (authorize) policy.grant({authorizationRef: 'original-authorization', taskId: task.taskId, toolName: descriptor.name,
    scopes: descriptor.requiredScopes, expiresAt: deadline, maxUses: 1, argumentsDigest: toolArgumentsDigest({})});
  await runtime.send({kind: 'request', protocolVersion: '1.0.0', requestId: 'original-request', taskId: task.taskId,
    idempotencyKey: 'original-run', deadline, operation: 'tool.invoke', payload: {toolName: descriptor.name, toolVersion: descriptor.version,
      arguments: {}, scopeRef: 'original-authorization'}}, new AbortController().signal);
  if (runtime.getTask(task.taskId).state === 'running') runtime.transitionTask(task.taskId, 'waiting_reconciliation');
  return {path, now, deadline, runtime, task, policy, gateway, descriptor, unregister, calls: () => calls};
}

test('a settled authorized failed read permits the same continuation without changing its failure, cache or consumed grant', async () => {
  const f = await failedOperation();
  try {
    const records = f.runtime.readToolExecutions(f.task.taskId), original = records[0], grant = f.policy.get('original-authorization');
    assert.equal(original.state, 'failed'); assert.equal(original.executionStarted, true); assert.equal(original.policyDecision, 'allow');
    assert.ok(original.finishedAt); assert.equal(f.runtime.loadCheckpoint(f.task.taskId, 'tool-result-original-run'), undefined);
    const continuation = f.runtime.prepareVerifiedContinuation(f.task.taskId, f.runtime.getTask(f.task.taskId).revision);
    assert.equal(continuation.state, 'waiting_approval'); assert.equal(continuation.taskId, f.task.taskId);
    assert.deepEqual(f.runtime.readToolExecutions(f.task.taskId), records);
    assert.equal(f.runtime.loadCheckpoint(f.task.taskId, 'tool-result-original-run'), undefined);
    assert.deepEqual(f.policy.get('original-authorization'), grant); assert.equal(f.calls(), 1);
    const completed = await f.runtime.runTask(f.task.taskId, async () => ({resultSummary: 'An existing deterministic branch consumed the failed read'}),
      {deadline: f.deadline, sideEffect: 'read', resume: true});
    assert.equal(completed.state, 'succeeded'); assert.equal(f.calls(), 1);
    assert.equal(f.runtime.readToolExecutions(f.task.taskId)[0].state, 'failed');
  } finally {f.runtime.close();}
});

test('uncertain reads, failed writes and missing or changed trusted read descriptors cannot pass continuation', async t => {
  for (const scenario of [
    {name: 'timed out read', errorCode: 'TIMEOUT'}, {name: 'cancelled read', errorCode: 'CANCELLED'},
    {name: 'unknown read', errorCode: 'RESULT_UNKNOWN'},
    {name: 'unauthorized read', authorize: false}, {name: 'executed write failure', sideEffect: 'local_write'},
    {name: 'denied write failure', sideEffect: 'local_write', authorize: false},
    {name: 'missing original descriptor', descriptor: 'missing'}, {name: 'different original version', descriptor: 'version'},
    {name: 'current descriptor writes', descriptor: 'write'},
  ]) await t.test(scenario.name, async () => {
    const f = await failedOperation(scenario);
    try {
      if (scenario.descriptor) {
        f.unregister();
        if (scenario.descriptor !== 'missing') f.gateway.register({descriptor: {...f.descriptor,
          ...(scenario.descriptor === 'version' ? {version: '2.0.0'} : {sideEffect: 'local_write'})}, execute: async () => {throw Error('Never re-execute');}});
      }
      const before = f.runtime.getTask(f.task.taskId), records = f.runtime.readToolExecutions(f.task.taskId);
      assert.throws(() => f.runtime.prepareVerifiedContinuation(before.taskId, before.revision), {code: 'UNAUTHORIZED'});
      assert.deepEqual(f.runtime.getTask(before.taskId), before); assert.deepEqual(f.runtime.readToolExecutions(before.taskId), records);
      assert.equal(f.runtime.loadCheckpoint(before.taskId, 'tool-result-original-run'), undefined);
      assert.equal(f.calls(), scenario.authorize === false ? 0 : 1);
    } finally {f.runtime.close();}
  });
});

test('interrupted or incomplete persisted read evidence cannot be mistaken for a settled failure', async t => {
  for (const [name, change] of [
    ['missing completion', record => {delete record.finishedAt;}],
    ['unfinished original run', record => {record.state = 'started'; delete record.finishedAt;}],
    ['uncertain reconciliation', record => {record.reconciliationOutcome = 'unknown';}],
    ['unconfirmed legacy read evidence', record => {record.errorCode = 'NOT_CONFIRMED';}],
  ]) await t.test(name, async () => {
    const f = await failedOperation();
    try {
      // Controlled fixture damage models a persisted interrupted/legacy record; no production database is touched.
      const record = f.runtime.readToolExecutions(f.task.taskId)[0]; change(record);
      const database = new DatabaseSync(f.path);
      try {database.prepare('UPDATE tool_execution_records SET record_json = ? WHERE evidence_id = ?').run(JSON.stringify(record), record.evidenceId);}
      finally {database.close();}
      const task = f.runtime.getTask(f.task.taskId);
      assert.throws(() => f.runtime.prepareVerifiedContinuation(task.taskId, task.revision), {code: 'UNAUTHORIZED'});
      assert.deepEqual(f.runtime.readToolExecutions(task.taskId), [record]); assert.equal(f.calls(), 1);
    } finally {f.runtime.close();}
  });
});
