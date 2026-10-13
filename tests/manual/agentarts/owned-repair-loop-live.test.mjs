import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {ProtocolError} from '@personal-agent/contracts';
import {runOwnedRepairLoop, validateRepairConfiguration, sanitizeRepairDiagnostic} from './owned-repair-loop-live.mjs';

const cacheRoot = fileURLToPath(new URL('../../../.cache/owned-repair-loop-tests/', import.meta.url));
const sourceProposal = {kind: 'tool_proposal', proposalId: 'synthetic-read', toolName: 'workspace.read_text',
  toolVersion: '1.0.0', arguments: {path: 'meeting-update.json'}, verification: 'unverified'};
const candidate = request => {
  const context = request.continuation.result.repairContext;
  return {kind: 'repair_candidate', candidateVersion: '1.0', verification: 'unverified',
    candidate: {expectedGraphRevision: context.expectedGraphRevision,
      changes: context.targets.map(target => ({node: target.node, summary: target.requestedSummary,
        dependencies: target.requestedDependencies, reason: 'Explicit Fake echoes synthetic host constraints'}))}};
};
async function fixture(t, reply) {
  await mkdir(cacheRoot, {recursive: true});
  const outputRoot = await mkdtemp(path.join(cacheRoot, 'run-'));
  t.after(async () => {
    assert.equal(path.dirname(outputRoot), path.resolve(cacheRoot));
    await rm(outputRoot, {recursive: true, force: true});
  });
  const coordination = new FakeCoordinationPort(reply);
  const result = await runOwnedRepairLoop({mode: 'fake', coordination,
    deadline: new Date(Date.now() + 30_000).toISOString(), signal: new AbortController().signal,
    approveSyntheticFixture: true, outputRoot});
  return {...result, coordination};
}

test('explicit Fake cloud drives real local read, Fact projection, approved repair CAS and SQLite restart', async t => {
  const {receipt, directory, coordination} = await fixture(t, request => request.continuation ? candidate(request) : sourceProposal);
  assert.equal(receipt.status, 'passed', JSON.stringify(receipt));
  assert.equal(receipt.mode, 'fake'); assert.equal(receipt.verification, 'mock');
  assert.equal(receipt.sourcePendingWithoutRead, true);
  assert.equal(receipt.repairPendingWithoutWrite, true);
  assert.equal(receipt.approvalActor, 'authorized-synthetic-acceptance-harness');
  assert.equal(receipt.candidateReceived, true);
  assert.deepEqual([receipt.sourceExecutions, receipt.repairExecutions, receipt.sourceEvidence, receipt.repairEvidence], [1, 1, 1, 1]);
  assert.deepEqual([receipt.graphRevisionBefore, receipt.graphRevisionAfter], [6, 9]);
  assert.equal(receipt.unchangedPlanPreserved, true);
  assert.equal(receipt.persistedReadbackVerified, true);
  assert.equal(receipt.noReplayAfterRestart, true);
  assert.equal(receipt.hostCleanupVerified, true);
  assert.equal(receipt.httpsApplicationRequests, 0);
  assert.equal(coordination.requests.length, 2, 'restart never repeats the cloud requests');
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'receipt.json'), 'utf8')), receipt);
});

test('a cloud candidate outside fixed synthetic constraints is rejected before repair approval or write', async t => {
  const {receipt} = await fixture(t, request => {
    if (!request.continuation) return sourceProposal;
    const result = candidate(request); result.candidate.changes[2].dependencies = [];
    return result;
  });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.stage, 'source_candidate');
  assert.equal(receipt.sourceState, 'succeeded');
  assert.equal(receipt.sourceExecutions, 1);
  assert.equal(receipt.sourceEvidence, 1);
  assert.equal(receipt.currentGraphRevision, 6);
  assert.equal(receipt.repairTaskId, null);
  assert.equal(receipt.repairExecutions, 0);
  assert.equal(receipt.repairPendingWithoutWrite, false);
  assert.equal(receipt.hostCleanupVerified, true);
});

test('cloud errors are sanitized and cannot become live success', async t => {
  const marker = 'synthetic-secret-that-must-never-enter-receipts';
  const {receipt, directory} = await fixture(t, () => {throw new Error(marker);});
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.verification, 'mock');
  assert.equal(receipt.sourceExecutions, 0); assert.equal(receipt.repairExecutions, 0);
  assert.equal(receipt.hostCleanupVerified, true);
  assert.ok(!(await readFile(path.join(directory, 'receipt.json'), 'utf8')).includes(marker));
});

test('pre-approval failure preserves its sanitized task error and bounded cloud diagnostics', async t => {
  const privateText = 'synthetic-private-error-body';
  const {receipt, directory} = await fixture(t, () => {throw new ProtocolError('EXTERNAL_FAILURE', privateText);});
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.stage, 'source_approval');
  assert.equal(receipt.sourceState, 'failed');
  assert.equal(receipt.sourceErrorCode, 'EXTERNAL_FAILURE');
  assert.equal(receipt.sourcePendingWithoutRead, false);
  assert.equal(receipt.sourceExecutions, 0);
  assert.equal(receipt.sourceEvidence, 0);
  assert.equal(receipt.currentGraphRevision, 5);
  assert.equal(receipt.hostCleanupVerified, true);
  const saved = await readFile(path.join(directory, 'receipt.json'), 'utf8');
  assert.equal(JSON.parse(saved).sourceErrorCode, 'EXTERNAL_FAILURE');
  assert.ok(!saved.includes(privateText));
  const requestId = '12345678-1234-4234-8234-123456789abc';
  assert.deepEqual(sanitizeRepairDiagnostic({stage: 'application_schema', code: 'EXTERNAL_FAILURE',
    schemaCategory: 'application_contract', httpStatus: 200, requestId,
    body: privateText, url: 'https://synthetic-private.invalid', error: privateText}),
  {stage: 'application_schema', code: 'EXTERNAL_FAILURE', schemaCategory: 'application_contract', httpStatus: 200, requestId});
  assert.deepEqual(sanitizeRepairDiagnostic({stage: 'transport', code: 'EXTERNAL_FAILURE',
    schemaCategory: privateText, httpStatus: 599, requestId: privateText}), {stage: 'transport', code: 'EXTERNAL_FAILURE'});
  assert.equal(sanitizeRepairDiagnostic({stage: privateText, code: 'EXTERNAL_FAILURE'}), undefined);
  assert.equal(sanitizeRepairDiagnostic({stage: 'transport', code: privateText}), undefined);
  let getterCalls = 0;
  assert.deepEqual(sanitizeRepairDiagnostic({stage: 'transport', code: 'EXTERNAL_FAILURE',
    get requestId() {getterCalls++; return privateText;}}), {stage: 'transport', code: 'EXTERNAL_FAILURE'});
  assert.equal(getterCalls, 0);
});

test('live credentials are explicit, Huawei-only and cannot be mixed with a Fake port', async () => {
  const config = {gatewayUrl: 'https://fixture.cn-southwest-2.huaweicloud-agentarts.com',
    runtimeName: 'synthetic-owned', inboundAuthorization: 'Bearer synthetic-platform',
    wssToken: 'synthetic-owned-websocket-token-32-characters'};
  assert.equal(validateRepairConfiguration(config).runtimeName, 'synthetic-owned');
  for (const changed of [{gatewayUrl: 'http://127.0.0.1'}, {gatewayUrl: config.gatewayUrl + '/secret'},
    {runtimeName: '../other'}, {extra: 'unsupported'}]) {
    assert.throws(() => validateRepairConfiguration({...config, ...changed}), {code: 'INVALID_ARGUMENT'});
  }
  const options = {mode: 'live', configuration: config, deadline: new Date(Date.now() + 30_000).toISOString(),
    signal: new AbortController().signal, approveSyntheticFixture: true};
  await assert.rejects(() => runOwnedRepairLoop({...options, coordination: new FakeCoordinationPort(() => 'fake')}), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(() => runOwnedRepairLoop({...options, approveSyntheticFixture: false}), {code: 'INVALID_ARGUMENT'});
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => runOwnedRepairLoop({...options, signal: controller.signal}), {code: 'CANCELLED'});
});
