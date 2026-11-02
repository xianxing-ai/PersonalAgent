import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {TaskRuntime} from '../dist/index.js';
import {
  createDesktopAsyncSubagentTools,
  createLoopbackRunnerTransport,
  createMemoryRunnerSecrets,
  createRemoteAwareSubagentStarter,
  createRemoteRunnerService,
} from '../dist/application.js';
import {handleRunnerJob} from '../../../scripts/remote-runner/remote-runner-service.mjs';

const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture-key\n-----END OPENSSH PRIVATE KEY-----';
const hostKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIfixture';
const token = 'runner-token-0123456789abcdef0123456789abcdef';
const fingerprint = createHash('sha256').update(hostKey).digest('hex');
const hostInput = {name: 'ecs-1', address: '10.0.0.8', port: 22, user: 'runner', provider: 'huawei-ecs', os: 'ubuntu', arch: 'aarch64',
  limits: {maxConcurrent: 2, maxJobsPerMinute: 5}, repos: ['octo/repo'], hostKeyFingerprint: fingerprint, privateKey, runnerToken: token, hostKey, enabled: true};
const context = taskId => ({taskId, runId: 'run', signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString(), authorizationRef: 'auth', scopes: ['agent:delegate']});

function poolFor(runtime, handle, runnerOptions = {}) {
  const state = {version: 1, jobs: {}, cursors: {}, comments: {}, recent: []};
  const transport = createLoopbackRunnerTransport(async (job, runnerToken) => handle
    ? handle(job, runnerToken) : handleRunnerJob(state, job, {token: runnerToken, now: () => Date.now(), ...runnerOptions}));
  const pool = createRemoteRunnerService({getRuntime: () => runtime, secrets: createMemoryRunnerSecrets(), transport,
    idFactory: (() => {let n = 0; return () => `id-${++n}`;})(),
    localExecute: async () => ({state: 'failed', error: 'local fallback', verification: 'fixture'})});
  return {pool, state};
}

async function addHost(pool, taskId) {
  const drafted = await pool.tools.find(tool => tool.descriptor.name === 'runner.host.add').execute({host: hostInput}, context(taskId));
  const confirmed = await pool.tools.find(tool => tool.descriptor.name === 'runner.host.confirm').execute({proposalId: drafted.proposalId, digest: drafted.digest, summary: drafted.summary}, context(taskId));
  return confirmed.record;
}

function hostOptions(runtime, extra = {}) {
  return {competitionOnly: true, getRuntime: () => runtime,
    getTools: () => ({list: () => [], invoke: async () => {throw new Error('child tool');}}),
    runDefaultWorker: async () => ({resultSummary: extra.localSummary ?? '本地完成'}),
    ...extra};
}

test('spawn dispatches through the loopback host and reports completion once', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '主对话', idempotencyKey: 'remote-parent'});
  const {pool, state} = poolFor(runtime, undefined, {modelCommand: {command: ['agent', '--once'], timeoutMs: 1000},
    spawnImpl: async ({input}) => ({code: 0, stdout: `写完了 ${input}`, stderr: ''})});
  await addHost(pool, parent.taskId);
  const reports = [];
  const controller = createDesktopAsyncSubagentTools({...hostOptions(runtime),
    startChild: createRemoteAwareSubagentStarter({host: hostOptions(runtime), getRemote: () => pool}),
    onReport: report => reports.push(report),
    verifyUnknownWrite: async () => 'not_applied'});
  await controller.tools.find(tool => tool.descriptor.name === 'subagent.spawn').execute({subtasks: [{subtaskId: 'notes', role: 'researcher', goal: '写说明'}]}, context(parent.taskId));
  await controller.pump();
  const child = runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-notes`);
  assert.equal(child.state, 'succeeded');
  assert.match(child.resultSummary, /写完了 写说明/);
  assert.match(child.resultSummary, /远端执行/);
  assert.equal(reports.length, 1);
  assert.match(reports[0].summary, /远端执行/);
  assert.equal(reports[0].conversationId, 'desktop-panel');
  const job = runtime.listCheckpointKeys(runtime.findTaskByIdempotencyKey('remote-runner-registry:v1').taskId)
    .filter(key => key.startsWith('remote-runner-job:')).map(key => runtime.loadCheckpoint(runtime.findTaskByIdempotencyKey('remote-runner-registry:v1').taskId, key));
  assert.equal(job.some(item => item.location === 'remote' && item.receipt?.state === 'succeeded'), true);
  assert.equal(Object.keys(state.jobs).length, 1);
  const reopened = createDesktopAsyncSubagentTools({...hostOptions(runtime), onReport: report => reports.push(report),
    startChild: async () => {throw new Error('restart must not execute the child again');}});
  await reopened.pump();
  assert.equal(reports.length, 1);
  assert.equal(reopened.list().find(item => item.subtaskId === 'notes').reported, true);
});

test('an unknown remote receipt is read back and is not run locally', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '主对话', idempotencyKey: 'unknown-parent'});
  const {pool} = poolFor(runtime, async () => ({v: 1, state: 'unknown', redo: false}));
  await addHost(pool, parent.taskId);
  let reads = 0;
  let localRuns = 0;
  const controller = createDesktopAsyncSubagentTools({...hostOptions(runtime, {runDefaultWorker: async () => {localRuns += 1; return {resultSummary: '不应本地重跑'};}}),
    startChild: createRemoteAwareSubagentStarter({host: hostOptions(runtime), getRemote: () => pool}),
    verifyUnknownWrite: async () => {reads += 1; return 'unknown';}});
  await controller.tools.find(tool => tool.descriptor.name === 'subagent.spawn').execute({subtasks: [{subtaskId: 'write', role: 'coder', goal: '外部写入'}]}, context(parent.taskId));
  await controller.pump();
  await new Promise(resolve => setImmediate(resolve));
  const child = runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-write`);
  assert.equal(child.state, 'waiting_reconciliation');
  assert.equal(localRuns, 0);
  await controller.pump();
  assert.equal(reads, 1);
  assert.equal(runtime.loadCheckpoint(child.taskId, `async-subagent-f24-readback:${child.revision}`).redo, false);
  await controller.pump();
  assert.equal(reads, 1);
  assert.equal(runtime.getTask(child.taskId).state, 'waiting_reconciliation');
});

test('a host without a model command falls back locally and does not report remote success', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '主对话', idempotencyKey: 'needs-config-parent'});
  const {pool} = poolFor(runtime);
  await addHost(pool, parent.taskId);
  let localRuns = 0;
  const reports = [];
  const controller = createDesktopAsyncSubagentTools({...hostOptions(runtime, {runDefaultWorker: async () => {localRuns += 1; return {resultSummary: '本地完成'};}}),
    startChild: createRemoteAwareSubagentStarter({host: hostOptions(runtime), getRemote: () => pool}),
    onReport: report => reports.push(report)});
  await controller.tools.find(tool => tool.descriptor.name === 'subagent.spawn').execute({subtasks: [{subtaskId: 'bare', role: 'coder', goal: '补配置'}]}, context(parent.taskId));
  await controller.pump();
  await new Promise(resolve => setImmediate(resolve));
  await controller.pump();
  assert.equal(localRuns, 1);
  assert.match(reports[0].summary, /远端主机没有配置模型命令/);
  assert.equal(reports[0].summary.includes('succeeded'), false);
});

test('a configured model command that fails is not rerun locally', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '主对话', idempotencyKey: 'remote-fail-parent'});
  const {pool} = poolFor(runtime, undefined, {modelCommand: {command: ['agent'], timeoutMs: 1000}, spawnImpl: async () => ({code: 2, stdout: '', stderr: 'model exploded'})});
  await addHost(pool, parent.taskId);
  let localRuns = 0;
  const controller = createDesktopAsyncSubagentTools({...hostOptions(runtime, {runDefaultWorker: async () => {localRuns += 1; return {resultSummary: '不应本地重跑'};}}),
    startChild: createRemoteAwareSubagentStarter({host: hostOptions(runtime), getRemote: () => pool})});
  await controller.tools.find(tool => tool.descriptor.name === 'subagent.spawn').execute({subtasks: [{subtaskId: 'boom', role: 'coder', goal: '会失败'}]}, context(parent.taskId));
  await controller.pump();
  await new Promise(resolve => setImmediate(resolve));
  const child = runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-boom`);
  assert.equal(child.state, 'failed');
  assert.match(child.error.message, /model exploded/);
  assert.equal(localRuns, 0);
});

test('no enabled host keeps local execution and records the reason', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '主对话', idempotencyKey: 'local-parent'});
  const {pool} = poolFor(runtime);
  const reports = [];
  const controller = createDesktopAsyncSubagentTools({...hostOptions(runtime),
    startChild: createRemoteAwareSubagentStarter({host: hostOptions(runtime), getRemote: () => pool}),
    onReport: report => reports.push(report)});
  await controller.tools.find(tool => tool.descriptor.name === 'subagent.spawn').execute({subtasks: [{subtaskId: 'local', role: 'planner', goal: '本地'}]}, context(parent.taskId));
  await controller.pump();
  await new Promise(resolve => setImmediate(resolve));
  await controller.pump();
  const child = runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-local`);
  assert.equal(child.state, 'succeeded');
  assert.match(reports[0].summary, /本地执行：no healthy remote host/);
  assert.equal(JSON.stringify(reports).includes(token), false);
});
