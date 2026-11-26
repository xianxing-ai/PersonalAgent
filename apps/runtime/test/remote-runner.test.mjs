import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {TaskRuntime} from '../dist/index.js';
import {createLoopbackRunnerTransport, createMemoryRunnerSecrets, reconcileDutyCursor, signRunnerJob} from '../dist/application.js';
import {createSyntheticRemoteRunnerService as createRemoteRunnerService} from '../../../tests/helpers/synthetic-remote-runner.mjs';
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

test('host addresses are validated on registration and again when reading older records', async () => {
  const runtime = new TaskRuntime(':memory:');
  const task = parent(runtime);
  const {pool} = service(runtime);
  for (const address of ['invalid host', '-option', 'example.test/path', '300.0.0.1']) {
    assert.throws(() => pool.propose('add', {...hostInput, address}), {code: 'INVALID_ARGUMENT'});
  }
  const host = await addHost(pool, task.taskId, {...hostInput, address: '[2001:db8::8]'});
  assert.equal(host.address, '2001:db8::8');
  const registry = runtime.findTaskByIdempotencyKey('remote-runner-registry:v1');
  runtime.saveCheckpoint(registry.taskId, 'remote-runner-host:' + host.id, {...host, address:'legacy invalid host'});
  await assert.rejects(pool.vpsStatus(host.id), {code:'INVALID_ARGUMENT'});
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
  const pollJob = {kind: 'developer-duty', idempotencyKey: 'poll-1', taskId: task.taskId, repo: 'octo/repo',
    payload: {action: 'poll', repo: 'octo/repo', page: {connected: true, gap: false, events: [{id: 'd2', deliveryId: 'd2'}], next: {deliveryId: 'd2'}}}};
  const poll = await pool.submit(pollJob);
  assert.equal(runtime.loadCheckpoint(task.taskId, 'developer-duty-cursor:v1').deliveryId, 'd2');
  const again = await pool.submit(pollJob);
  assert.equal(again.receipt.state, poll.receipt.state);
  assert.equal(again.receipt.cursor.deliveryId, 'd2');
  assert.equal(again.redo, false);
  const unknownJob = {kind: 'developer-duty', idempotencyKey: 'comment-1', taskId: task.taskId, repo: 'octo/repo',
    payload: {action: 'comment', repo: 'octo/repo', number: 4, body: 'CI red', existing: [], writeState: 'unknown'}};
  const unknown = await pool.submit(unknownJob);
  assert.equal(unknown.receipt.state, 'unknown');
  const reread = await pool.submit(unknownJob);
  assert.equal(reread.redo, false);
  assert.equal(reread.receipt.state, 'unknown');
  assert.equal(state.comments['octo/repo#4'].outcome, 'unknown');
  await assert.rejects(pool.submit({...unknownJob, payload: {...unknownJob.payload, body: 'replacement'}}), {code: 'REVISION_CONFLICT'});
  assert.equal(reconcileDutyCursor({repo: 'octo/repo', deliveryId: 'd2'}, {repo: 'octo/repo', deliveryId: 'd9', basedOnDeliveryId: 'other'}).conflict, true);
});

test('an unhealthy host falls back locally and merge stays forbidden', async () => {
  const runtime = new TaskRuntime(':memory:');
  const task = parent(runtime);
  const secrets = createMemoryRunnerSecrets();
  const transport = {connect: async () => {throw new Error('connection preparation failed '+token);}};
  const pool = createRemoteRunnerService({getRuntime: () => runtime, secrets, transport, localExecute: async () => ({state: 'failed', error: 'local fallback', verification: 'fixture'})});
  await addHost(pool, task.taskId);
  const result = await pool.submit({kind: 'developer-duty', idempotencyKey: 'down', taskId: task.taskId, repo: 'octo/repo', payload: {action: 'poll', repo: 'octo/repo'}});
  assert.equal(result.location, 'local');
  assert.equal(JSON.stringify(result).includes(token), false);
  await assert.rejects(pool.submit({kind: 'developer-duty', idempotencyKey: 'merge', taskId: task.taskId, repo: 'octo/repo', payload: {action: 'merge', repo: 'octo/repo'}}), {code: 'SCOPE_DENIED'});
});

test('a dispatched job is reserved across concurrency and restart and never retries or falls back', async () => {
  const runtime = new TaskRuntime(':memory:');
  const task = parent(runtime);
  const secrets = createMemoryRunnerSecrets();
  let executions = 0;
  let localRuns = 0;
  let release;
  let entered;
  const started = new Promise(resolve => {entered = resolve;});
  const transport = createLoopbackRunnerTransport(async () => {
    executions += 1; entered();
    await new Promise(resolve => {release = resolve;});
    throw new Error('receipt lost after side effect');
  });
  const makePool = () => createRemoteRunnerService({getRuntime: () => runtime, secrets, transport,
    localExecute: async () => {localRuns += 1; return {state: 'succeeded'};}});
  const pool = makePool();
  await addHost(pool, task.taskId);
  await addHost(pool, task.taskId, {...hostInput, name: 'ecs-2'});
  const job = {kind: 'async-subagent', idempotencyKey: 'at-most-once', taskId: task.taskId, payload: {goal: 'write'}};
  const first = pool.submit(job);
  await started;
  assert.equal((await makePool().submit(job)).receipt.state, 'unknown');
  release();
  assert.equal((await first).receipt.state, 'unknown');
  assert.equal((await makePool().submit(job)).receipt.state, 'unknown');
  await assert.rejects(pool.submit({...job, taskId: 'another-task'}), {code: 'REVISION_CONFLICT'});
  assert.equal(executions, 1);
  assert.equal(localRuns, 0);
});

test('a receipt for another job cannot advance the original task cursor or cause local replay', async () => {
  const runtime = new TaskRuntime(':memory:');
  const task = parent(runtime);
  let executions = 0;
  let localRuns = 0;
  const pool = createRemoteRunnerService({getRuntime: () => runtime, secrets: createMemoryRunnerSecrets(),
    transport: createLoopbackRunnerTransport(async job => {
      executions += 1;
      return {v: 1, jobId: 'other-job', kind: job.kind, idempotencyKey: job.idempotencyKey, state: 'succeeded', cursor: {repo: 'octo/repo', deliveryId: 'wrong'}};
    }), localExecute: async () => {localRuns += 1; return {state: 'succeeded'};}});
  await addHost(pool, task.taskId);
  const job = {kind: 'developer-duty', idempotencyKey: 'wrong-receipt', taskId: task.taskId, repo: 'octo/repo', payload: {action: 'poll'}};
  assert.equal((await pool.submit(job)).receipt.state, 'unknown');
  assert.equal((await pool.submit(job)).receipt.state, 'unknown');
  assert.equal(runtime.loadCheckpoint(task.taskId, 'developer-duty-cursor:v1'), undefined);
  assert.equal(executions, 1);
  assert.equal(localRuns, 0);
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
  assert.match(verified, /personal-agent-runner 1.2.0/);
  const syntax = spawn('sh', ['-n', fileURLToPath(new URL('../../../scripts/remote-runner/install-remote-runner.sh', import.meta.url))]);
  assert.equal(await new Promise(resolve => syntax.on('close', resolve)), 0);
  saveRunnerState(state, {version: 1, jobs: {}, cursors: {}, comments: {}, recent: []});
  assert.equal(readFileSync(state, 'utf8').includes('PRIVATE KEY'), false);
  rmSync(directory, {recursive: true, force: true});
});

test('vps-ops enforces fail-closed policy, allowlisted argv/desktop actions, secret redaction, and no local fallback', async () => {
  const mkMsg = (id, payload) => {
    const msg = {v: 1, id, idempotencyKey: `key-${id}`, kind: 'vps-ops', payload, sentAt: '2026-11-25T00:00:00.000Z'};
    return {...msg, signature: signJob(msg, token)};
  };
  let spawned = [];
  const state = {version: 1, jobs: {}, cursors: {}, comments: {}, recent: []};

  // 1. Without vpsControlPolicy: status succeeds read-only, while exec & desktop fail closed with zero commands spawned.
  const statusRes = await handleRunnerJob(state, mkMsg('st-1', {action: 'status'}), {
    token,
    vpsControlPolicy: null,
    spawnImpl: async args => { spawned.push(args); return {code: 0, stdout: 'should-not-run'}; },
  });
  assert.equal(statusRes.state, 'succeeded');
  assert.equal(statusRes.vpsControlEnabled, false);
  assert.equal(spawned.length, 0);

  const deniedExec = await handleRunnerJob(state, mkMsg('ex-no-policy', {action: 'exec', command: ['node', '-v']}), {
    token,
    vpsControlPolicy: null,
    spawnImpl: async args => { spawned.push(args); return {code: 0, stdout: ''}; },
  });
  assert.equal(deniedExec.state, 'failed');
  assert.equal(deniedExec.needsConfig, true);
  assert.equal(spawned.length, 0);

  // 2. With valid policy: non-allowlisted command rejected; allowlisted command runs & redacts secrets; desktop open_url validates URL & uses DISPLAY=:1.
  const policy = {
    enabled: true,
    allowExec: true,
    allowDesktop: true,
    desktopContainer: 'personal-agent-webtop',
    webtopHttpPort: 3000,
    webtopHttpsPort: 3001,
    maxTimeoutMs: 10000,
    allowedExecutables: ['node', 'xdg-open'],
    allowedCommands: [['node','-v']],
  };
  const blockedBin = await handleRunnerJob(state, mkMsg('ex-rm', {action: 'exec', command: ['rm', '-rf', '/']}), {
    token,
    vpsControlPolicy: policy,
    spawnImpl: async args => { spawned.push(args); return {code: 0, stdout: ''}; },
  });
  assert.equal(blockedBin.state, 'failed');
  assert.match(blockedBin.error, /not in allowedExecutables/);
  assert.equal(spawned.length, 0);

  const okExec = await handleRunnerJob(state, mkMsg('ex-node', {action: 'exec', command: ['node', '-v']}), {
    token,
    vpsControlPolicy: policy,
    spawnImpl: async args => {
      spawned.push(args);
      return {code: 0, stdout: 'v24.15.0 -----BEGIN OPENSSH PRIVATE KEY-----\nTOPSECRET\n-----END OPENSSH PRIVATE KEY-----', stderr: ''};
    },
  });
  assert.equal(okExec.state, 'succeeded');
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].command, ['node', '-v']);
  assert.equal(okExec.stdout.includes('TOPSECRET'), false);
  assert.match(okExec.stdout, /\[redacted-key\]/);

  const badUrl = await handleRunnerJob(state, mkMsg('dk-badurl', {action: 'desktop', desktopAction: 'open_url', url: 'file:///etc/passwd'}), {
    token,
    vpsControlPolicy: policy,
    spawnImpl: async args => { spawned.push(args); return {code: 0, stdout: ''}; },
  });
  assert.equal(badUrl.state, 'failed');
  assert.equal(spawned.length, 1);

  const okOpen = await handleRunnerJob(state, mkMsg('dk-open', {action: 'desktop', desktopAction: 'open_url', url: 'https://example.com/'}), {
    token,
    vpsControlPolicy: policy,
    spawnImpl: async args => { spawned.push(args); return {code: 0, stdout: 'opened', stderr: ''}; },
  });
  assert.equal(okOpen.state, 'succeeded');
  assert.deepEqual(spawned[1].command, ['docker', 'exec', '-e', 'DISPLAY=:1', 'personal-agent-webtop', 'xdg-open', 'https://example.com/']);

  // 3. Through createRemoteRunnerService tools: requiresPresence/sideEffect, end-to-end vps.status/vps.exec, and no local fallback when host is down.
  const runtime = new TaskRuntime(':memory:');
  const task = parent(runtime);
  const secrets = createMemoryRunnerSecrets();
  let localRuns = 0;
  const fakePrepareDispatch = async scope => {
    scope.assertCurrent();
    return {assertBeforeSend() { scope.assertCurrent(); }};
  };
  const downPool = createRemoteRunnerService({
    getRuntime: () => runtime,
    secrets,
    prepareDispatch: fakePrepareDispatch,
    transport: {connect: async () => { throw new Error('ssh unreachable ' + token); }},
    localExecute: async () => { localRuns += 1; return {state: 'succeeded'}; },
  });
  await addHost(downPool, task.taskId);
  assert.equal(downPool.tools.find(t => t.descriptor.name === 'runner.vps.status').descriptor.sideEffect, 'read');
  assert.equal(downPool.tools.find(t => t.descriptor.name === 'runner.vps.exec').descriptor.requiresPresence, true);
  assert.equal(downPool.tools.find(t => t.descriptor.name === 'runner.vps.exec').descriptor.sideEffect, 'external_write');
  assert.equal(downPool.tools.find(t => t.descriptor.name === 'runner.vps.desktop').descriptor.requiresPresence, true);
  assert.equal(downPool.tools.find(t => t.descriptor.name === 'runner.vps.desktop').descriptor.sideEffect, 'external_write');

  const execRes = await downPool.tools.find(t => t.descriptor.name === 'runner.vps.exec').execute({command: ['node', '-v']}, context(task.taskId));
  assert.equal(execRes.accepted, false);
  assert.equal(execRes.location, 'remote');
  assert.equal(execRes.receipt.state, 'rejected');
  assert.equal(localRuns, 0);
  assert.equal(JSON.stringify(execRes).includes(token), false);

  const liveRuntime = new TaskRuntime(':memory:');
  const liveTask = parent(liveRuntime);
  const liveState = {version: 1, jobs: {}, cursors: {}, comments: {}, recent: []};
  const livePool = createRemoteRunnerService({
    getRuntime: () => liveRuntime,
    secrets: createMemoryRunnerSecrets(),
    prepareDispatch: fakePrepareDispatch,
    transport: createLoopbackRunnerTransport(async (job, runnerToken) => handleRunnerJob(liveState, job, {
      token: runnerToken,
      vpsControlPolicy: policy,
      spawnImpl: async args => ({code: 0, stdout: `ran:${args.command.join(' ')}`, stderr: ''}),
    })),
  });
  const liveHost = await addHost(livePool, liveTask.taskId);
  const liveStatus = await livePool.vpsStatus(liveHost.id);
  assert.equal(liveStatus.state, 'succeeded');
  assert.equal(liveStatus.receipt.desktop.status, 'ran:docker inspect -f {{.State.Status}} personal-agent-webtop');
  const toolExec = await livePool.tools.find(t => t.descriptor.name === 'runner.vps.exec').execute({command: ['node', '-v']}, {...context(liveTask.taskId), runId: 'run-exec'});
  assert.equal(toolExec.accepted, true);
  assert.equal(toolExec.receipt.state, 'succeeded');
  assert.equal(toolExec.receipt.stdout, 'ran:node -v');
});
