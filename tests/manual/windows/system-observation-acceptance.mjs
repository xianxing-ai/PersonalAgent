// Opt-in, one real aggregate sample through Runtime/Policy/ToolGateway.
// No cloud, desktop automation, private file enumeration or injected probe.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@personal-agent/client';
import {validateToolValue} from '@personal-agent/contracts';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createSystemObservationTool, SYSTEM_OBSERVATION_SCOPE} from '@personal-agent/windows-client';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
let app;
async function until(predicate) {
  const deadline = Date.now() + 30_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw Error('Acceptance deadline expired');
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}

try {
  assert.equal(process.platform, 'win32');
  assert.equal(process.argv.length, 2);
  await mkdir(path.join(repository, '.cache'), {recursive: true});
  const directory = await mkdtemp(path.join(repository, '.cache', 'mod17-runtime-'));
  const provider = createSystemObservationTool();
  let executions = 0;
  const tool = {descriptor: provider.descriptor, execute: (input, context) => {
    assert.deepEqual(context.scopes, [SYSTEM_OBSERVATION_SCOPE]);
    assert.equal(executions, 0, 'This acceptance permits only one real sample');
    executions++;
    return provider.execute(input, context);
  }};
  const options = {path: path.join(directory, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts', hostUserNamespace: 'mod17-manual-acceptance', tools: [tool]};
  app = createRuntimeApplication(options);
  const client = new Client(app);
  await client.connect();
  const capabilities = await client.call('capability.list', {});
  assert.ok(capabilities.manifests.some(item => item.name === provider.descriptor.name));
  const request = () => ({commandId: randomUUID(), toolName: provider.descriptor.name,
    toolVersion: provider.descriptor.version, arguments: {}, deadline: new Date(Date.now() + 30_000).toISOString()});

  // Without a session lease, even read-only sampling must await Policy approval.
  const denied = app.submitHostToolTask(request()).task;
  await until(() => app.runtime.getTask(denied.taskId).state === 'waiting_approval');
  assert.equal(executions, 0);
  const pending = app.readHostToolTask(denied.taskId);
  await client.call('authorization.respond', {approvalId: pending.approval.approvalId,
    expectedRevision: pending.approval.revision, decision: 'deny'});
  await until(() => app.activeTaskCount === 0);
  assert.equal(executions, 0);
  assert.equal(app.readHostToolTask(denied.taskId).confirmed, undefined);
  assert.ok(app.runtime.readToolExecutions(denied.taskId).every(item => !item.executionStarted));

  const cancelled = app.submitHostToolTask(request()).task;
  await until(() => app.runtime.getTask(cancelled.taskId).state === 'waiting_approval');
  await client.call('task.cancel', {taskId: cancelled.taskId, reason: 'Manual acceptance cancellation'});
  await until(() => app.activeTaskCount === 0);
  assert.equal(app.runtime.getTask(cancelled.taskId).state, 'cancelled');
  assert.equal(executions, 0);

  const session = app.startSystemObservationSession({
    expiresAt: new Date(Date.now() + 60_000).toISOString(), intervalMs: 30_000,
  });
  const first = app.sampleSystemObservationSession(session.sessionId);
  assert.equal(first.state, 'sampled');
  await until(() => app.activeTaskCount === 0);
  const taskId = first.sample.task.taskId;
  const readback = app.readHostToolTask(taskId);
  assert.equal(readback.task.state, 'succeeded');
  const observation = readback.confirmed.result;
  validateToolValue(provider.descriptor.outputSchema, observation);
  assert.equal(observation.source, 'node:os');
  assert.ok(app.readCurrentSystemObservationSample(taskId));
  assert.equal(executions, 1);
  const records = app.runtime.readToolExecutions(taskId);
  assert.equal(records.length, 1);
  assert.equal(records[0].state, 'confirmed');
  assert.equal(records[0].policyDecision, 'allow');
  assert.equal(records[0].executionStarted, true);
  assert.equal(app.runtime.policy.get(readback.confirmed.runId).usesRemaining, 0);
  const evidence = app.runtime.readEvidence(taskId);
  assert.equal(evidence.length, 1);
  assert.ok(readback.confirmed.evidenceRefs.includes(evidence[0].evidenceId));
  assert.equal(app.sampleSystemObservationSession(session.sessionId).state, 'not_due');
  assert.equal(app.stopSystemObservationSession(session.sessionId).stopped, true);
  assert.throws(() => app.sampleSystemObservationSession(session.sessionId), {code: 'UNAUTHORIZED'});
  assert.equal(app.readCurrentSystemObservationSample(taskId), undefined);

  // A still-active but unused lease must not survive a Runtime/SQLite reopen.
  const unused = app.startSystemObservationSession({
    expiresAt: new Date(Date.now() + 60_000).toISOString(), intervalMs: 30_000,
  });
  app.close();
  app = createRuntimeApplication(options);
  assert.deepEqual(app.readHostToolTask(taskId).confirmed, readback.confirmed);
  assert.deepEqual(app.runtime.readToolExecutions(taskId), records);
  assert.deepEqual(app.runtime.readEvidence(taskId), evidence);
  assert.throws(() => app.sampleSystemObservationSession(unused.sessionId), {code: 'UNAUTHORIZED'});
  assert.equal(app.readCurrentSystemObservationSample(taskId), undefined);
  assert.equal(executions, 1);
  app.close();
  app = createRuntimeApplication({...options, tools: []});
  assert.throws(() => app.submitHostToolTask(request()), {code: 'UNSUPPORTED_CAPABILITY'});
  assert.equal(executions, 1);

  // Raw metrics stay in this local SQLite database. Share only this allowlist.
  const receipt = {profile: 'huawei_ict_agentarts', nodeVersion: process.version,
    platform: process.platform, taskId, runId: readback.confirmed.runId,
    source: observation.source, capturedAt: observation.capturedAt,
    sampledFrom: observation.sampledFrom, sampledUntil: observation.sampledUntil,
    requestedSampleWindowMs: observation.requestedSampleWindowMs,
    actualSampleWindowMs: observation.actualSampleWindowMs, unavailable: observation.unavailable,
    schemaValid: true, realProviderExecutions: executions, policyDecision: records[0].policyDecision,
    grantConsumed: true, executionState: records[0].state,
    evidence: evidence.map(item => ({evidenceId: item.evidenceId, verification: item.verification})),
    deniedWithoutSampling: true, cancelledWithoutSampling: true, unregisteredRejected: true,
    stoppedLeaseRejected: true, runtimeReopenLeaseRejected: true, runtimeReopenHistoryUnchanged: true,
    desktopVerified: false, agentArtsVerified: false};
  await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({state: 'passed', receiptDirectory: path.relative(repository, directory), ...receipt}));
} catch {
  // Assertion errors can embed actual metrics; never print their messages.
  console.error('MOD17_ACCEPTANCE_FAILED: inspect the isolated local database; no successful receipt was saved');
  process.exitCode = 1;
} finally {
  if (app) { try { await until(() => app.activeTaskCount === 0); } finally { app.close(); } }
}
