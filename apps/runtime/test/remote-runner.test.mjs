import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {TaskRuntime} from '../dist/index.js';
import {createLoopbackRunnerTransport, createMemoryRunnerSecrets, createRemoteRunnerService, reconcileDutyCursor, signRunnerJob} from '../dist/application.js';
import {handleRunnerJob, loadRunnerState, saveRunnerState, signJob} from '../../../scripts/remote-runner/remote-runner-service.mjs';

const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture-key\n-----END OPENSSH PRIVATE KEY-----';
const hostKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIfixture';
const token = 'runner-token-0123456789abcdef0123456789abcdef';
const fingerprint = createHash('sha256').update(hostKey).digest('hex');
const hostInput = {name: 'ecs-1', address: '10.0.0.8', port: 22, user: 'runner', provider: 'huawei-ecs', os: 'ubuntu', arch: 'aarch64',
  limits: {maxConcurrent: 2, maxJobsPerMinute: 5}, repos: ['octo/repo'], hostKeyFingerprint: fingerprint, privateKey, runnerToken: token, hostKey, enabled: true};
const parent = runtime => runtime.submitTask({conversationId: 'desktop-panel', goal: '值班', idempotencyKey: 'runner-parent-'+Math.random()});
const context = taskId => ({taskId, runId: 'run', signal: new AbortController().signal, deadline: new Date(Date.now()+60000).toISOString(), authorizationRef: 'auth', scopes: ['agent:delegate']});

function service(runtime, handle = (job, runnerToken) => handleRunnerJob({version:1, jobs:{}, cursors:{}, comments:{}, recent:[]}, job, {token: runnerToken})) {
  const state = {version: 1, jobs: {}, cursors: {}, comments: {}, recent: []};
  const secrets = createMemoryRunnerSecrets();
  const transport = createLoopbackRunnerTransport(async (job, runnerToken) => handleRunnerJob(state, job, {token: runnerToken, now: () => Date.now()}));
  const pool = createRemoteRunnerService({getRuntime: () => runtime, secrets, transport, idFactory: (() => {let n = 0; return () => `id-${++n}`;})(),
    localExecute: async () => ({state: 'failed', error: 'local fallback', verification: 'fixture'})});
  return {pool, state, secrets, handle};
}

async function addHost(pool, taskId, input = hostInput) {
  const drafted = await pool.tools.find(tool => tool.descriptor.name === 'runner.host.add').execute({host: input}, context(taskId));
  assert.equal(drafted.effect, 'none');
  assert.equal(JSON.stringify(drafted).includes(privateKey), false);
  const confirmed = await pool.tools.find(tool => tool.descriptor.name === 'runner.host.confirm').execute({proposalId: drafted.proposalId, digest: drafted.digest, summary: drafted.summary}, context(taskId));
  return confirmed.record;
}

test('signatures match the headless runner and a mismatched host key is refused', async () => {
  const message = {v: 1, id: 'job-1', idempotencyKey: 'same', kind: 'heartbeat', payload: {}, sentAt: '2026-11-02T00:00:00.000Z'};
  assert.equal(signRunnerJob(message, token), signJob(message, token));
  const runtime = new TaskRuntime(':memory:');
  const task = parent(runtime);
  const {pool} = service(runtime);
  await assert.rejects(pool.tools.find(tool => tool.descriptor.name === 'runner.host.add').execute({host: {...hostInput, hostKey: 'other-key'}}, context(task.taskId)), {code: 'UNAUTHORIZED'});
});

test('confirmed host heartbeats, polls without treating a gap as no change, and does not redo an unknown comment', async () => {
  const runtime = new TaskRuntime(':memory:');
  const task = parent(runtime);
  const {pool, state} = service(runtime);
  assert.equal(pool.list().length, 0);
  const record = await addHost(pool, task.taskId);
  assert.equal(record.provider, 'huawei-ecs');
  assert.equal(JSON.stringify(pool.list()).includes(privateKey), false);
  assert.equal(JSON.stringify(pool.list()).includes(token), false);
  const health = await pool.test(record.id);
  assert.equal(health.state, 'succeeded');
  const gap = await pool.submit({kind: 'developer-duty', idempotencyKey: 'poll-gap', taskId: task.taskId, repo: 'octo/repo',
    payload: {action: 'poll', repo: 'octo/repo', page: {connected: false, gap: true, events: []}}});
  assert.equal(gap.location, 'remote');
  assert.equal(gap.receipt.gap, true);
  assert.equal(gap.receipt.noChange, false);
  assert.equal(runtime.loadCheckpoint(task.taskId, 'developer-duty-cursor:v1'), undefined);
  const poll = await pool.submit({kind: 'developer-duty', idempotencyKey: 'poll-1', taskId: task.taskId, repo: 'octo/repo',
    payload: {action: 'poll', repo: 'octo/repo', page: {connected: true, gap: false, events: [{id: 'd2', deliveryId: 'd2'}], next: {deliveryId: 'd2'}}}});
  assert.equal(runtime.loadCheckpoint(task.taskId, 'developer-duty-cursor:v1').deliveryId, 'd2');
  const again = await pool.submit({kind: 'developer-duty', idempotencyKey: 'poll-1', taskId: task.taskId, repo: 'octo/repo', payload: {action: 'poll', repo: 'octo/repo'}});
  assert.equal(again.receipt.state, poll.receipt.state);
  assert.equal(again.receipt.cursor.deliveryId, 'd2');
  assert.equal(again.redo, false);
  const unknown = await pool.submit({kind: 'developer-duty', idempotencyKey: 'comment-1', taskId: task.taskId, repo: 'octo/repo',
    payload: {action: 'comment', repo: 'octo/repo', number: 4, body: 'CI red', existing: [], writeState: 'unknown'}});
  assert.equal(unknown.receipt.state, 'unknown');
  const reread = await pool.submit({kind: 'developer-duty', idempotencyKey: 'comment-1', taskId: task.taskId, repo: 'octo/repo',
    payload: {action: 'comment', repo: 'octo/repo', number: 4, body: 'CI red again', existing: []}});
  assert.equal(reread.redo, false);
  assert.equal(reread.receipt.state, 'unknown');
  assert.equal(state.comments['octo/repo#4'].outcome, 'unknown');
  assert.equal(reconcileDutyCursor({repo: 'octo/repo', deliveryId: 'd2'}, {repo: 'octo/repo', deliveryId: 'd9', basedOnDeliveryId: 'other'}).conflict, true);
});

test('an unhealthy host falls back locally and merge stays forbidden', async () => {
  const runtime = new TaskRuntime(':memory:');
  const task = parent(runtime);
  const secrets = createMemoryRunnerSecrets();
  const transport = createLoopbackRunnerTransport(async () => {throw new Error('ssh down token '+token);});
  const pool = createRemoteRunnerService({getRuntime: () => runtime, secrets, transport, localExecute: async () => ({state: 'failed', error: 'local fallback', verification: 'fixture'})});
  await addHost(pool, task.taskId);
  const result = await pool.submit({kind: 'developer-duty', idempotencyKey: 'down', taskId: task.taskId, repo: 'octo/repo', payload: {action: 'poll', repo: 'octo/repo'}});
  assert.equal(result.location, 'local');
  assert.equal(JSON.stringify(result).includes(token), false);
  await assert.rejects(pool.submit({kind: 'developer-duty', idempotencyKey: 'merge', taskId: task.taskId, repo: 'octo/repo', payload: {action: 'merge', repo: 'octo/repo'}}), {code: 'SCOPE_DENIED'});
});

test('the headless process returns one receipt and the installer script parses', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'runner-'));
  const state = path.join(directory, 'state.json');
  const servicePath = fileURLToPath(new URL('../../../scripts/remote-runner/remote-runner-service.mjs', import.meta.url));
  const message = {v: 1, id: 'proc-1', idempotencyKey: 'proc', kind: 'heartbeat', payload: {}, sentAt: '2026-11-02T00:00:00.000Z'};
  message.signature = signJob(message, token);
  const child = spawn(process.execPath, [servicePath], {env: {...process.env, RUNNER_STATE: state, RUNNER_TOKEN: token}});
  let stdout = '';
  child.stdout.on('data', chunk => {stdout += chunk;});
  child.stdin.end(JSON.stringify(message));
  const code = await new Promise(resolve => child.on('close', resolve));
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).state, 'succeeded');
  assert.equal(loadRunnerState(state).jobs.proc, undefined);
  const verify = spawn(process.execPath, [servicePath, '--verify']);
  let verified = '';
  verify.stdout.on('data', chunk => {verified += chunk;});
  assert.equal(await new Promise(resolve => verify.on('close', resolve)), 0);
  assert.match(verified, /personal-agent-runner 1.1.0/);
  const syntax = spawn('sh', ['-n', fileURLToPath(new URL('../../../scripts/remote-runner/install-remote-runner.sh', import.meta.url))]);
  assert.equal(await new Promise(resolve => syntax.on('close', resolve)), 0);
  saveRunnerState(state, {version: 1, jobs: {}, cursors: {}, comments: {}, recent: []});
  assert.equal(readFileSync(state, 'utf8').includes('PRIVATE KEY'), false);
  rmSync(directory, {recursive: true, force: true});
});
