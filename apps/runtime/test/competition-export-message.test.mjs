import assert from 'node:assert/strict';
import test from 'node:test';
import {withheldExportMessage} from '../dist/application.js';
import {createRuntimeApplication} from '../dist/application.js';
import {Client} from '@personal-agent/client';

/**
 * 2026-10-21 现场：`calendar.cancel` 已在本地确认成功，但云端续答失败后任务进入
 * waiting_reconciliation，错误只说"没有可读回执"。调用方据此认为取消没发生，又重复取消了一次。
 * 只能确认工具执行及本地结果保留，不能把通用执行回执等同于业务写入成功。
 */
test('扣留导出时说明执行已确认而不宣称业务写入成功', () => {
  assert.match(withheldExportMessage('calendar.cancel'), /calendar\.cancel execution confirmed; result retained locally/);
  assert.match(withheldExportMessage('calendar.cancel'), /fresh host check/);
  assert.match(withheldExportMessage('mail.save_draft'), /mail\.save_draft execution confirmed/);
  // 无当前回执绑定时既不能宣称成功，也不能断言什么都没有发生。
  assert.match(withheldExportMessage(undefined), /Current local tool execution and result require verification/);
  assert.doesNotMatch(withheldExportMessage(undefined), /confirmed|retained|applied/i);
  assert.doesNotMatch(withheldExportMessage('calendar.events'), /applied|write/i);
});

async function transportFailure(t, {sideEffect = 'read', replay = false, damageReceipt} = {}) {
  const read = {name: 'fixture.read', version: '1.0.0',
    inputSchema: {type: 'object', required: ['id'], additionalProperties: false, properties: {id: {type: 'string'}}},
    outputSchema: {type: 'object', required: ['value'], additionalProperties: false, properties: {value: {type: 'string'}}},
    sideEffect, requiredScopes: ['fixture:run'], idempotencySupport: true, recoverySupport: true, requiresPresence: false};
  const write = {...read, name: 'fixture.write', sideEffect: 'local_write'};
  const descriptors = replay ? [read, write] : [read];
  const proposal = item => ({kind: 'tool_proposal', proposalId: item.name + '-proposal', toolName: item.name,
    toolVersion: item.version, arguments: {id: 'synthetic'}, verification: 'unverified'});
  const executions = [], requests = [];
  let fail = true;
  const app = createRuntimeApplication({path: ':memory:', profile: 'huawei_ict_agentarts', competitionMaxSteps: 6,
    tools: descriptors.map(descriptor => ({descriptor, execute: async () => {
      executions.push(descriptor.name);
      return {value: descriptor.name};
    }})),
    competitionToolAvailability: descriptors.map(item => ({toolName: item.name, toolVersion: item.version, available: () => true})),
    competitionToolExports: descriptors.map(item => ({toolName: item.name, toolVersion: item.version,
      exportPolicyVersion: 'fixture-v1', accepts: () => true, project: ({result}) => result})),
    coordination: {execute: async request => {
      requests.push(request);
      if (!request.continuation) return proposal(read);
      if (replay && requests.length === 2) return proposal(write);
      if (replay && requests.length === 3) return proposal(read);
      if (fail) {
        if (damageReceipt) {
          const loop = app.runtime.loadCheckpoint(request.taskId, 'competition-loop');
          damageReceipt(loop);
          app.runtime.saveCheckpoint(request.taskId, 'competition-loop', loop);
        }
        throw Error('synthetic ordinary continuation transport failure');
      }
      return {kind: 'text', text: 'Confirmed result consumed', verification: 'unverified'};
    }},
  });
  t.after(() => app.close());
  const client = new Client(app, Date.now);
  await client.connect();
  const {taskId} = await client.call('task.submit', {goal: 'Synthetic confirmed execution', conversationId: 'receipt-message'},
    {idempotencyKey: 'receipt-message', timeoutMs: 30_000});
  async function settle(expected) {
    for (let i = 0; i < 400; i++) {
      const task = app.runtime.getTask(taskId);
      if (expected.includes(task.state) && app.activeTaskCount === 0) return task;
      for (const approval of (await client.call('approval.list', {taskId})).items) {
        if (approval.state === 'pending') await client.call('authorization.respond', {approvalId: approval.approvalId,
          expectedRevision: approval.revision, decision: 'allow_once'});
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail('Task did not settle: ' + app.runtime.getTask(taskId).state);
  }
  const task = await settle(['waiting_reconciliation', 'failed']);
  assert.equal(task.state, 'waiting_reconciliation');
  assert.equal(task.error.code, 'UNAUTHORIZED');
  assert.equal(task.error.retryable, false);
  assert.deepEqual(app.runtime.loadCheckpoint(taskId, 'competition-export-withheld'), {withheld: true});
  assert.equal(requests.length, replay ? 4 : 2); // Failure was after real continuation handoff, not projection.
  assert.equal(requests.at(-1).continuation.proposalId, proposal(read).proposalId);
  assert.deepEqual(executions, descriptors.map(item => item.name));
  const records = app.runtime.readToolExecutions(taskId);
  assert.ok(records.every(record => record.state === 'confirmed' && record.executionStarted && record.policyDecision === 'allow'));
  assert.equal(records.length, executions.length);
  return {task, app, taskId, records, executions, settle, recover: () => {fail = false; app.resumeConfirmedTask(taskId);}};
}

for (const sideEffect of ['read', 'local_write']) test(`${sideEffect} continuation transport failure retains execution without claiming a write`, async t => {
  const f = await transportFailure(t, {sideEffect});
  assert.equal(f.task.error.message, withheldExportMessage('fixture.read'));
  assert.doesNotMatch(f.task.error.message, /applied|write/i);
  f.recover();
  assert.equal((await f.settle(['succeeded', 'failed'])).state, 'succeeded');
  assert.equal(f.executions.length, 1); // Recovery must consume the receipt, not repeat the tool.
});

test('replayed continuation names its original receipt rather than the latest confirmed write', async t => {
  const f = await transportFailure(t, {replay: true});
  assert.equal(f.records.at(-1).toolName, 'fixture.write');
  assert.equal(f.task.error.message, withheldExportMessage('fixture.read'));
  f.recover();
  assert.equal((await f.settle(['succeeded', 'failed'])).state, 'succeeded');
  assert.deepEqual(f.executions, ['fixture.read', 'fixture.write']);
});

for (const [name, damageReceipt] of [
  ['missing run', loop => {delete loop.receipts[0].runId;}],
  ['wrong run', loop => {loop.receipts[0].runId = loop.receipts[1].runId;}],
  ['different arguments', loop => {loop.receipts[0].proposal.arguments.id = 'different';}],
  ['different continuation', loop => {loop.receipts[0].continuation.result = {value: 'different'};}],
  ['ambiguous receipt', loop => {loop.receipts.push(structuredClone(loop.receipts[0]));}],
  ['unconfirmed pending run with older confirmed executions', loop => {
    loop.pending = {...structuredClone(loop.receipts[0].proposal), proposalId: 'not-executed'};
    loop.step = 99;
    delete loop.continuation;
  }],
]) test(`unbound ${name} stays generic after continuation transport failure`, async t => {
  const f = await transportFailure(t, {replay: true, damageReceipt});
  assert.equal(f.task.error.message, withheldExportMessage(undefined));
  assert.doesNotMatch(f.task.error.message, /fixture\.(read|write)|applied|confirmed|retained/i);
  const loop = f.app.runtime.loadCheckpoint(f.taskId, 'competition-loop');
  if (loop.pending) {
    assert.equal(loop.pending.proposalId, 'not-executed');
    assert.equal(loop.continuation, undefined);
    assert.equal(f.records.some(record => record.evidenceId === `competition-tool-${f.taskId}-${loop.step}`), false);
    assert.equal(f.records.length, 2); // Older confirmed executions do not confirm the pending run.
  }
});
