import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {TaskRuntime} from '../dist/index.js';
import {createDeveloperDutyTools, createLoopbackRunnerTransport, createMemoryRunnerSecrets, createRemoteRunnerService, developerDutyRemoteRunner} from '../dist/application.js';
import {DUTY_STATUS_MARKER} from '@personal-agent/github';
import {handleRunnerJob} from '../../../scripts/remote-runner/remote-runner-service.mjs';

const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture-key\n-----END OPENSSH PRIVATE KEY-----';
const hostKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIfixture';
const token = 'runner-token-0123456789abcdef0123456789abcdef';
const fingerprint = createHash('sha256').update(hostKey).digest('hex');
const hostInput = {name: 'ecs-1', address: '10.0.0.8', port: 22, user: 'runner', provider: 'huawei-ecs', os: 'ubuntu', arch: 'aarch64',
  limits: {maxConcurrent: 2, maxJobsPerMinute: 5}, repos: ['octo/repo'], hostKeyFingerprint: fingerprint, privateKey, runnerToken: token, hostKey, enabled: true};
const context = taskId => ({taskId, runId: 'run', signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString(), authorizationRef: 'auth', scopes: ['agent:delegate']});
const event = {id: 'd2', repo: 'octo/repo', type: 'pull_request', deliveryId: 'd2', receivedAt: '2026-11-02T00:00:00.000Z', number: 4, headSha: 'a'.repeat(40)};

function runner(runtime) {
  const state = {version: 1, jobs: {}, cursors: {}, comments: {}, recent: []};
  const transport = createLoopbackRunnerTransport(async (job, runnerToken) => handleRunnerJob(state, job, {token: runnerToken, now: () => Date.now()}));
  const pool = createRemoteRunnerService({getRuntime: () => runtime, secrets: createMemoryRunnerSecrets(), transport,
    idFactory: (() => {let n = 0; return () => `duty-${++n}`;})(),
    localExecute: async () => ({state: 'failed', error: 'local fallback', verification: 'fixture'})});
  return {pool, state};
}

test('the no-argument duty runner stays the stub and a service uses the remote protocol', async () => {
  const stub = developerDutyRemoteRunner();
  assert.equal(stub.implementation, 'stub');
  assert.equal((await stub.submit({repo: 'octo/repo'})).reason, 'stub');
  const runtime = new TaskRuntime(':memory:');
  const {pool} = runner(runtime);
  const wired = developerDutyRemoteRunner(pool);
  assert.equal(wired.implementation, 'remote');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '登记', idempotencyKey: 'duty-runner-parent'});
  const drafted = await pool.tools.find(tool => tool.descriptor.name === 'runner.host.add').execute({host: hostInput}, context(parent.taskId));
  await pool.tools.find(tool => tool.descriptor.name === 'runner.host.confirm').execute({proposalId: drafted.proposalId, digest: drafted.digest, summary: drafted.summary}, context(parent.taskId));
  const receipt = await wired.submit({repo: 'octo/repo', cursor: {deliveryId: 'start'}});
  assert.equal(receipt.location, 'remote');
  assert.equal(receipt.receipt.gap, true);
  assert.equal(receipt.receipt.noChange, false);
});

test('duty tools poll a gap without advancing, then a remote page notifies once and comments are read back', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '主对话', idempotencyKey: 'duty-tools-parent'});
  const {pool} = runner(runtime);
  const drafted = await pool.tools.find(tool => tool.descriptor.name === 'runner.host.add').execute({host: hostInput}, context(parent.taskId));
  await pool.tools.find(tool => tool.descriptor.name === 'runner.host.confirm').execute({proposalId: drafted.proposalId, digest: drafted.digest, summary: drafted.summary}, context(parent.taskId));
  let now = Date.parse('2026-11-02T00:00:00.000Z');
  let page = {connected: false, gap: true, events: []};
  const notices = [];
  let creates = 0;
  const comments = [];
  const duty = createDeveloperDutyTools({getRuntime: () => runtime, now: () => now, onNotify: notice => notices.push(notice),
    readPage: async repo => ({repo, ...page}),
    submitRemote: job => pool.submit(job),
    comments: {listComments: async () => comments.map(item => ({...item})),
      createComment: async body => {creates += 1; comments.push({id: 7, body}); return {state: 'unknown'};},
      editComment: async () => ({state: 'confirmed'})}});
  const tool = name => duty.tools.find(item => item.descriptor.name === name);
  await tool('duty.watch').execute({repo: 'octo/repo'}, context(parent.taskId));
  await assert.rejects(tool('duty.policy.set').execute({repo: 'octo/repo', allowed: true, comment: true, merge: true}, context(parent.taskId)), {code: 'SCOPE_DENIED'});
  const policy = await tool('duty.policy.set').execute({repo: 'octo/repo', allowed: true, comment: true}, context(parent.taskId));
  assert.equal(policy.merge, false);
  const gap = await duty.poll();
  assert.equal(gap[0].location, 'remote');
  assert.equal(gap[0].gap, true);
  assert.equal(gap[0].noChange, false);
  const owner = runtime.findTaskByIdempotencyKey('developer-duty-registry:v1');
  assert.equal(runtime.loadCheckpoint(owner.taskId, 'developer-duty-cursor:v1'), undefined);
  page = {connected: true, gap: false, events: [event], previousDeliveryId: undefined, next: {repo: 'octo/repo', deliveryId: 'd2'},
    statusComment: {number: 4, body: 'CI red', existing: [], writeState: 'unknown'}};
  now += 60_000;
  const advanced = await duty.poll();
  assert.equal(advanced[0].location, 'remote');
  assert.equal(advanced[0].noChange, false);
  assert.equal(runtime.loadCheckpoint(owner.taskId, 'developer-duty-cursor:v1').deliveryId, 'd2');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].delivered, false);
  assert.equal(notices[0].duplicate, false);
  await duty.poll();
  assert.equal(notices.filter(notice => notice.duplicate !== true).length, 1);
  assert.equal(creates, 0, 'unknown remote comment is not also created locally');
  const listed = await tool('duty.personal.list').execute({}, context(parent.taskId));
  assert.equal(listed.evidenceLevel, 'fixture');
  const triage = await tool('duty.ci.triage').execute({logExcerpt: 'AssertionError: expected 1 to be 2'}, context(parent.taskId));
  assert.equal(triage.class, 'code');
  assert.equal(triage.evidenceLevel, 'fixture');
  const status = await tool('duty.status').execute({}, context(parent.taskId));
  assert.equal(status.evidenceLevel, 'fixture');
  assert.equal(JSON.stringify(status).includes(token), false);
});

test('fixture comments are edited in place and a local gap is not no change', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '主对话', idempotencyKey: 'duty-fixture-parent'});
  const duty = createDeveloperDutyTools({getRuntime: () => runtime, useFixtureComments: true,
    readPage: async repo => ({repo, connected: true, gap: false, events: [], statusComment: {body: '排队中'}})});
  const tool = name => duty.tools.find(item => item.descriptor.name === name);
  await tool('duty.watch').execute({repo: 'octo/repo'}, context(parent.taskId));
  await tool('duty.policy.set').execute({repo: 'octo/repo', allowed: true, comment: true}, context(parent.taskId));
  await duty.poll();
  await duty.poll();
  const owner = runtime.findTaskByIdempotencyKey('developer-duty-registry:v1');
  const stored = runtime.loadCheckpoint(owner.taskId, 'developer-duty-fixture-comments:v1');
  assert.equal(stored.items.length, 1);
  assert.equal(stored.items[0].body, `${DUTY_STATUS_MARKER}\n排队中`);
  assert.equal(stored.evidenceLevel, 'fixture');
  const gapDuty = createDeveloperDutyTools({getRuntime: () => runtime,
    readPage: async repo => ({repo, connected: false, gap: true, events: []})});
  const local = await gapDuty.poll();
  assert.equal(local[0].location, 'local');
  assert.equal(local[0].gap, true);
  assert.equal(local[0].noChange, false);
  assert.match(local[0].reason, /gap is not no change|no healthy remote host/);
});

test('duty policy cannot replace the original content authorization and poll retains a pending intent', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '值班', idempotencyKey: 'duty-pending-content'});
  let writes = 0;
  const duty = createDeveloperDutyTools({getRuntime: () => runtime,
    readPage: async repo => ({repo, connected: true, gap: false, events: [], statusComment: {number: 4, body: '原完整正文'}}),
    createComments: () => ({writeAvailable: false, listComments: async () => [],
      createComment: async () => {writes += 1; return {state: 'confirmed', id: 4};},
      editComment: async () => {writes += 1; return {state: 'confirmed'};}})});
  const tool = name => duty.tools.find(item => item.descriptor.name === name);
  await tool('duty.watch').execute({repo: 'octo/repo'}, context(parent.taskId));
  await tool('duty.policy.set').execute({repo: 'octo/repo', allowed: true, comment: true}, context(parent.taskId));
  const result = await duty.poll();
  assert.match(result[0].reason, /content authorization/);
  const owner = runtime.findTaskByIdempotencyKey('developer-duty-registry:v1');
  assert.deepEqual(runtime.loadCheckpoint(owner.taskId, 'developer-duty-comment-intent:v1:octo/repo#4'), {
    repo: 'octo/repo', number: 4, body: `${DUTY_STATUS_MARKER}\n原完整正文`, state: 'requires_authorization',
  });
  assert.equal(runtime.loadCheckpoint(owner.taskId, 'developer-duty-comment:v1'), undefined);
  assert.equal(writes, 0);
});
