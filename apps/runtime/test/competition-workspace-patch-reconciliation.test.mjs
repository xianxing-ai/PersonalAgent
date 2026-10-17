import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {createWorkspaceReadTool, createWorkspacePatchPreviewTool} from '@personal-agent/coding-tools';
import {createRuntimeApplication} from '../dist/application.js';

const before = '\ufeffexport const value = "before";\r\n';
const after = before.replace('before', 'after_中文');
const sha = value => createHash('sha256').update(value).digest('hex');
const patchArguments = {path: 'demo.mjs', expectedSha256: sha(before), edits: [{oldText: 'before', newText: 'after_中文'}]};
const patchDescriptor = {name: 'workspace.apply_text_patch', version: '1.0.0',
  inputSchema: {type: 'object', required: ['path', 'expectedSha256', 'edits'], additionalProperties: false,
    properties: {path: {type: 'string'}, expectedSha256: {type: 'string'}, edits: {type: 'array'}}},
  outputSchema: {type: 'object', required: ['path', 'beforeSha256', 'afterSha256', 'byteLength', 'changed', 'applied'],
    additionalProperties: false, properties: {path: {type: 'string'}, beforeSha256: {type: 'string'},
      afterSha256: {type: 'string'}, byteLength: {type: 'integer'}, changed: {type: 'boolean'}, applied: {type: 'boolean'}}},
  sideEffect: 'local_write', requiredScopes: ['workspace:read', 'workspace:write', 'workspace:apply'],
  idempotencySupport: false, recoverySupport: false, requiresPresence: false};
const expectedOutput = {path: 'demo.mjs', beforeSha256: sha(before), afterSha256: sha(after),
  byteLength: Buffer.byteLength(after), changed: true, applied: true};
const proposal = (id, toolName, args) => ({kind: 'tool_proposal', proposalId: id,
  toolName, toolVersion: '1.0.0', arguments: args, verification: 'unverified'});

async function until(check, label) {
  for (let i = 0; i < 500; i++) { const result = check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw Error('Did not settle: ' + label);
}
function latch() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }

// Explicit Fake cloud and patch helper; read tool and independent file readback are real.
// The proposal is unverified so production catalog/export validation still executes.
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'competition-patch-recovery-'));
  const source = path.join(directory, 'demo.mjs');
  await writeFile(source, before);
  const config = {bindingId: 'd'.repeat(64), configurationRef: 'cloud-fixture-v1', namespace: 'synthetic-user',
    write: true, exportAllowed: true, marker: true, length: true, now: Date.now(), ...overrides};
  const calls = {read: 0, patch: 0, cloud: [], reconciliation: []};
  const completion = latch();
  const f = {directory, source, config, calls, completion};
  const createApp = () => {
    const readTool = createWorkspaceReadTool({rootPath: directory});
    const patchToolDescriptor = {...patchDescriptor,
      inputSchema: createWorkspacePatchPreviewTool({rootPath: directory}).descriptor.inputSchema};
    const descriptors = [readTool.descriptor, patchToolDescriptor];
    return createRuntimeApplication({path: path.join(directory, 'runtime.sqlite'), profile: 'huawei_ict_agentarts',
      now: () => new Date(config.now), hostUserNamespace: config.namespace, coordinationBinding: config.configurationRef,
      tools: [{descriptor: readTool.descriptor, execute: (input, context) => { calls.read++; return readTool.execute(input, context); }},
        {descriptor: patchToolDescriptor, async execute() {
          calls.patch++;
          if (config.write) await writeFile(source, after);
          throw new ProtocolError('RESULT_UNKNOWN', 'Explicit Fake helper lost its completion receipt');
        }}],
      competitionToolAvailability: descriptors.map(descriptor => ({toolName: descriptor.name,
        toolVersion: descriptor.version, available: () => true})),
      competitionToolExports: descriptors.map(descriptor => ({toolName: descriptor.name,
        toolVersion: descriptor.version, exportPolicyVersion: 'synthetic-v1', accepts: () => config.exportAllowed,
        project: ({result}) => {
          if (descriptor.name === patchDescriptor.name) assert.deepEqual(result, expectedOutput);
          return result;
        }})),
      coordination: {async execute(request) {
        calls.cloud.push({taskId: request.taskId, continuation: request.continuation});
        if (!request.continuation) return proposal('read-1', readTool.descriptor.name, {path: 'demo.mjs'});
        if (request.continuation.proposalId === 'read-1') {
          assert.equal(request.continuation.result.sha256, sha(before));
          return proposal('patch-2', patchDescriptor.name, patchArguments);
        }
        assert.deepEqual(request.continuation, {proposalId: 'patch-2', state: 'confirmed', result: expectedOutput});
        if (config.holdCompletion) await completion.promise;
        return {kind: 'text', text: 'Explicit Fake cloud received the recovered patch', verification: 'unverified'};
      }},
      workspacePatchReconciliation: {get bindingId() { return config.bindingId; }, async reconcile(input) {
        calls.reconciliation.push(input);
        if (!config.marker) return {path: input.relativePath, state: 'clear'};
        const bytes = await readFile(source);
        const currentSha256 = sha(bytes);
        const result = {path: input.relativePath, state: 'reconciled', runId: input.expectedRunId,
          argumentsDigest: input.expectedArgumentsDigest, beforeSha256: input.expectedBeforeSha256,
          afterSha256: sha(after), currentSha256,
          outcome: currentSha256 === sha(after) ? 'applied' : currentSha256 === sha(before) ? 'not_applied' : 'unknown',
          ...(config.length ? {byteLength: bytes.length} : {}), ...(config.overrideResult ?? {})};
        if (input.retainMarker && config.onReadback) await config.onReadback();
        if (!input.retainMarker) {
          const record = f.app.runtime.readToolExecutions(f.taskId).find(item => item.evidenceId === f.runId);
          assert.equal(record.reconciliationOutcome, result.outcome, 'persist outcome before marker acknowledgement');
          if (result.outcome === 'applied') assert.deepEqual(f.app.runtime.loadCheckpoint(f.taskId, 'tool-result-' + f.runId).result, expectedOutput);
          if (config.onAcknowledge) await config.onAcknowledge();
          config.marker = false;
        }
        return result;
      }},
    });
  };
  f.app = createApp();
  f.restart = () => { f.app.close(); f.app = createApp(); };
  f.start = async () => {
    const client = new Client(f.app); await client.connect();
    const submitted = await client.call('task.submit', {goal: 'Patch the public fixture after reading it', conversationId: 'patch-recovery'},
      {timeoutMs: 60_000, idempotencyKey: 'competition-patch-fixture'});
    f.taskId = submitted.taskId; f.runId = `competition-tool-${f.taskId}-2`;
    for (let step = 1; step <= 2; step++) {
      await until(() => {
        const task = f.app.runtime.getTask(f.taskId);
        if (['failed', 'cancelled', 'succeeded'].includes(task.state)) throw Error('Unexpected fixture task: ' + JSON.stringify(task));
        return f.app.activeTaskCount === 0 && task.state === 'waiting_approval'
          && f.app.runtime.loadCheckpoint(f.taskId, 'competition-loop').step === step;
      }, 'approval ' + step);
      const approval = (await client.call('approval.list', {taskId: f.taskId, state: 'pending'})).items[0];
      await client.call('authorization.respond', {approvalId: approval.approvalId, expectedRevision: approval.revision, decision: 'allow_once'});
    }
    await until(() => f.app.activeTaskCount === 0 && f.app.runtime.getTask(f.taskId).state === 'waiting_reconciliation', 'unknown patch');
  };
  t.after(async () => {
    completion.resolve();
    await until(() => f.app.activeTaskCount === 0, 'cleanup');
    f.app.close(); await rm(directory, {recursive: true, force: true});
  });
  return f;
}

test('read then unknown patch survives restart, resumes the same loop and never reexecutes the write', async t => {
  const f = await fixture(t, {holdCompletion: true}); await f.start();
  const beforeRecord = f.app.runtime.readToolExecutions(f.taskId).find(item => item.evidenceId === f.runId);
  f.restart();
  const result = await f.app.reconcileWorkspacePatchTask(f.taskId);
  assert.equal(result.runId, f.runId);
  await until(() => f.calls.cloud.length === 3, 'recovered continuation');
  assert.notEqual(f.app.runtime.getTask(f.taskId).state, 'succeeded', 'patch success is not workflow success');
  assert.equal(f.calls.patch, 1); assert.equal(f.calls.read, 1);
  assert.equal(f.config.marker, false);
  const record = f.app.runtime.readToolExecutions(f.taskId).find(item => item.evidenceId === f.runId);
  assert.equal(record.state, 'confirmed'); assert.equal(record.inputDigest, beforeRecord.inputDigest);
  assert.equal(f.app.runtime.policy.get(f.runId).usesRemaining, 0);
  f.completion.resolve();
  await until(() => f.app.activeTaskCount === 0 && f.app.runtime.getTask(f.taskId).state === 'succeeded', 'final cloud response');
  f.restart();
  const probes = f.calls.reconciliation.length;
  f.config.marker = true;
  f.config.overrideResult = {runId: 'later-unrelated-run'};
  await f.app.reconcileWorkspacePatchTask(f.taskId);
  assert.equal(f.calls.reconciliation.length, probes, 'an acknowledged old run must not touch a later marker');
  assert.equal(f.calls.patch, 1); assert.equal(f.calls.cloud.length, 3);
  assert.deepEqual(await readFile(f.source), Buffer.from(after));
});

test('unproven and incomplete applied readbacks keep the original task waiting', async t => {
  for (const mode of ['unknown', 'missing-marker', 'missing-length', 'in-progress', 'false-not-applied']) {
    await t.test(mode, async t => {
      const f = await fixture(t); await f.start();
      if (mode === 'unknown') await writeFile(f.source, 'a later user edit');
      if (mode === 'missing-marker') f.config.marker = false;
      if (mode === 'missing-length') f.config.length = false;
      if (mode === 'in-progress') f.config.overrideResult = {state: 'in_progress', pid: 1234};
      if (mode === 'false-not-applied') f.config.overrideResult = {outcome: 'not_applied'};
      if (['missing-marker', 'false-not-applied'].includes(mode)) await assert.rejects(f.app.reconcileWorkspacePatchTask(f.taskId));
      else await f.app.reconcileWorkspacePatchTask(f.taskId);
      assert.equal(f.app.runtime.getTask(f.taskId).state, 'waiting_reconciliation');
      assert.equal(f.app.runtime.readToolExecutions(f.taskId).find(item => item.evidenceId === f.runId).state, 'unknown');
      assert.equal(f.calls.patch, 1); assert.equal(f.calls.cloud.length, 2);
      if (mode !== 'missing-marker') assert.equal(f.config.marker, true);
    });
  }
});

test('cancelled applied patch finishes cancellation only after durable readback and acknowledgement', async t => {
  for (const mode of ['before-recovery', 'during-acknowledgement', 'acknowledgement-failure', 'cache-failure']) {
    await t.test(mode, async t => {
      const f = await fixture(t); await f.start();
      const original = f.app.runtime.readToolExecutions(f.taskId).find(item => item.evidenceId === f.runId);
      if (mode !== 'during-acknowledgement') f.app.runtime.requestCancel(f.taskId);
      f.config.onAcknowledge = () => {
        assert.equal(f.app.runtime.getTask(f.taskId).state, 'waiting_reconciliation');
        if (mode === 'during-acknowledgement') f.app.runtime.requestCancel(f.taskId);
        if (mode === 'acknowledgement-failure') throw Error('injected cancelled acknowledgement failure');
      };
      if (mode === 'cache-failure') {
        const save = f.app.runtime.saveCheckpoint.bind(f.app.runtime);
        f.app.runtime.saveCheckpoint = (taskId, key, value) => {
          if (key === 'tool-result-' + f.runId) throw Error('injected cancelled cache failure');
          return save(taskId, key, value);
        };
      }
      if (['acknowledgement-failure', 'cache-failure'].includes(mode)) {
        await assert.rejects(f.app.reconcileWorkspacePatchTask(f.taskId), /cancelled .* failure/);
        assert.equal(f.app.runtime.getTask(f.taskId).state, 'waiting_reconciliation');
        assert.equal(f.config.marker, true);
        f.restart(); f.config.onAcknowledge = undefined;
      }
      const result = await f.app.reconcileWorkspacePatchTask(f.taskId);
      assert.equal(result.task.state, 'cancelled');
      assert.equal(result.task.cancelRequested, true);
      assert.equal(f.config.marker, false);
      const record = f.app.runtime.readToolExecutions(f.taskId).find(item => item.evidenceId === f.runId);
      assert.equal(record.state, 'confirmed'); assert.equal(record.reconciliationOutcome, 'applied');
      assert.equal(record.inputDigest, original.inputDigest);
      assert.deepEqual(f.app.runtime.loadCheckpoint(f.taskId, 'tool-result-' + f.runId).result, expectedOutput);
      assert.equal(f.app.runtime.policy.get(f.runId).usesRemaining, 0);
      const probes = f.calls.reconciliation.length;
      f.restart();
      assert.equal((await f.app.reconcileWorkspacePatchTask(f.taskId)).task.state, 'cancelled');
      assert.equal(f.calls.reconciliation.length, probes);
      assert.equal(f.calls.patch, 1); assert.equal(f.calls.cloud.length, 2);
      assert.deepEqual(await readFile(f.source), Buffer.from(after));
    });
  }
});

test('cancellation does not discard incomplete patch or outstanding cloud outcomes', async t => {
  for (const mode of ['unknown', 'missing-length', 'missing-marker', 'cloud-unknown', 'cloud-inflight']) {
    await t.test(mode, async t => {
      const f = await fixture(t); await f.start(); f.app.runtime.requestCancel(f.taskId);
      if (mode === 'unknown') await writeFile(f.source, 'a later user edit');
      if (mode === 'missing-length') f.config.length = false;
      if (mode === 'missing-marker') f.config.marker = false;
      if (mode === 'cloud-unknown') f.app.runtime.saveCheckpoint(f.taskId, 'competition-cloud-unknown', {unknown: true});
      if (mode === 'cloud-inflight') f.app.runtime.saveCheckpoint(f.taskId, 'competition-cloud-inflight', {pending: true});
      if (mode === 'missing-marker') await assert.rejects(f.app.reconcileWorkspacePatchTask(f.taskId));
      else await f.app.reconcileWorkspacePatchTask(f.taskId);
      assert.equal(f.app.runtime.getTask(f.taskId).state, 'waiting_reconciliation');
      assert.equal(f.calls.patch, 1); assert.equal(f.calls.cloud.length, 2);
      if (['unknown', 'missing-length'].includes(mode)) assert.equal(f.config.marker, true);
    });
  }
});

test('only independently verified not_applied fails the original task without retry', async t => {
  const f = await fixture(t, {write: false}); await f.start();
  const result = await f.app.reconcileWorkspacePatchTask(f.taskId);
  assert.equal(result.task.state, 'failed');
  assert.equal(result.result.outcome, 'not_applied');
  assert.equal(f.calls.patch, 1); assert.equal(f.calls.cloud.length, 2);
});

test('original workspace, cloud configuration, input and revision cannot change during recovery', async t => {
  for (const mode of ['workspace', 'cloud-config', 'input', 'proposal-revision', 'revision-during-readback', 'source-hash', 'run-id']) {
    await t.test(mode, async t => {
      const f = await fixture(t); await f.start();
      if (mode === 'workspace') f.config.bindingId = 'e'.repeat(64);
      if (mode === 'cloud-config') { f.config.configurationRef = 'other-cloud'; f.restart(); }
      if (mode === 'input' || mode === 'proposal-revision') {
        const loop = f.app.runtime.loadCheckpoint(f.taskId, 'competition-loop');
        if (mode === 'input') loop.pending.arguments.path = 'other.mjs'; else loop.pendingRevision++;
        f.app.runtime.saveCheckpoint(f.taskId, 'competition-loop', loop);
      }
      if (mode === 'revision-during-readback') f.config.onReadback = () => { f.app.runtime.requestCancel(f.taskId); };
      if (mode === 'source-hash') f.config.overrideResult = {beforeSha256: 'a'.repeat(64)};
      if (mode === 'run-id') f.config.overrideResult = {runId: 'other-run'};
      await assert.rejects(f.app.reconcileWorkspacePatchTask(f.taskId), {code: 'REVISION_CONFLICT'});
      assert.equal(f.app.runtime.getTask(f.taskId).state, 'waiting_reconciliation');
      assert.equal(f.config.marker, true); assert.equal(f.calls.patch, 1); assert.equal(f.calls.cloud.length, 2);
    });
  }
});

test('a crash before normalized cache persistence blocks resume and restart only finishes acknowledgement', async t => {
  const f = await fixture(t); await f.start();
  const save = f.app.runtime.saveCheckpoint.bind(f.app.runtime);
  f.app.runtime.saveCheckpoint = (taskId, key, value) => {
    if (key === 'tool-result-' + f.runId) throw Error('injected normalized persistence failure');
    return save(taskId, key, value);
  };
  await assert.rejects(f.app.reconcileWorkspacePatchTask(f.taskId), /normalized persistence/);
  assert.equal(f.config.marker, true);
  assert.throws(() => f.app.resumeConfirmedTask(f.taskId), {code: 'RESULT_UNKNOWN'});
  assert.equal(f.app.runtime.getTask(f.taskId).state, 'waiting_reconciliation');
  f.restart();
  await f.app.reconcileWorkspacePatchTask(f.taskId);
  await until(() => f.app.activeTaskCount === 0, 'resumed worker');
  assert.equal(f.app.runtime.getTask(f.taskId).state, 'succeeded');
  assert.equal(f.calls.patch, 1); assert.equal(f.calls.cloud.length, 3);
});

test('resume and close cannot race marker acknowledgement', async t => {
  const f = await fixture(t); await f.start();
  const acknowledged = latch(), release = latch();
  f.config.onAcknowledge = async () => { acknowledged.resolve(); await release.promise; };
  const recovery = f.app.reconcileWorkspacePatchTask(f.taskId);
  await acknowledged.promise;
  try {
    assert.throws(() => f.app.resumeConfirmedTask(f.taskId), {code: 'REVISION_CONFLICT'});
    assert.throws(() => f.app.close(), {code: 'REVISION_CONFLICT'});
    assert.equal(f.calls.cloud.length, 2);
  } finally { release.resolve(); }
  await recovery; await until(() => f.app.activeTaskCount === 0, 'resumed after acknowledgement');
  assert.equal(f.app.runtime.getTask(f.taskId).state, 'succeeded');
  assert.equal(f.calls.patch, 1);
});

test('failed marker acknowledgement cannot be bypassed through direct resume after recovery returns', async t => {
  const f = await fixture(t); await f.start();
  f.config.onAcknowledge = () => { throw Error('injected acknowledgement failure'); };
  await assert.rejects(f.app.reconcileWorkspacePatchTask(f.taskId), /acknowledgement failure/);
  assert.equal(f.config.marker, true);
  assert.throws(() => f.app.resumeConfirmedTask(f.taskId), {code: 'RESULT_UNKNOWN'});
  assert.equal(f.calls.cloud.length, 2);
  f.restart(); f.config.onAcknowledge = undefined;
  await f.app.reconcileWorkspacePatchTask(f.taskId);
  await until(() => f.app.activeTaskCount === 0, 'retry only original acknowledgement');
  assert.equal(f.app.runtime.getTask(f.taskId).state, 'succeeded');
  assert.equal(f.calls.patch, 1);
});

test('expired deadline, unknown cloud invocation and revoked export prevent cloud continuation', async t => {
  for (const mode of ['deadline', 'cloud-unknown', 'export-revoked']) {
    await t.test(mode, async t => {
      const f = await fixture(t); await f.start();
      if (mode === 'deadline') f.config.now = Date.now() + 120_000;
      if (mode === 'cloud-unknown') f.app.runtime.saveCheckpoint(f.taskId, 'competition-cloud-unknown', {unknown: true});
      if (mode === 'export-revoked') f.config.exportAllowed = false;
      await f.app.reconcileWorkspacePatchTask(f.taskId);
      await until(() => f.app.activeTaskCount === 0, 'held continuation');
      assert.equal(f.app.runtime.getTask(f.taskId).state, 'waiting_reconciliation');
      assert.equal(f.app.runtime.readToolExecutions(f.taskId).find(item => item.evidenceId === f.runId).state, 'confirmed');
      assert.equal(f.calls.patch, 1); assert.equal(f.calls.cloud.length, 2);
    });
  }
});
