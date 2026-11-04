import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CrewError,
  CREW_PARENT_AGENT_ID,
  openCrewDriverRuntime,
  openCrewKernel,
} from '../dist/index.js';
import {
  createFakeCodexSpawn,
  FakeDriver,
} from '../dist/testing.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));
mkdirSync(root, {recursive: true});
const dbFile = () => join(mkdtempSync(join(root, 'runtime-')), 'crew.sqlite');

const VALID_UNBLOCK = '在本机安装并登录 codex 对应的官方 CLI 后由父 agent 重新派单';

function open(options = {}) {
  let clock = 1700000000000;
  const path = dbFile();
  const runtime = openCrewDriverRuntime(path, {...options, now: options.now ?? (() => (clock += 1000))});
  // 断言用内核：与 runtime 共享同一 SQLite 文件（只读信箱/任务即可，个别写用例顺序执行）。
  const kernel = openCrewKernel(path, {now: () => 1700000000000});
  return {runtime, kernel};
}

function grantCodex(runtime) {
  runtime.grantConsent({driverId: 'codex', loginKind: 'local-login', termsSummary: '本人本机登录的官方 Codex CLI（Sign in with ChatGPT）'});
}

function registerCoders(runtime) {
  runtime.registerAgent({
    agentId: 'coder-x',
    displayName: '编码者',
    driver: 'codex',
    instructions: '在自有 worktree 内完成编码任务，并按固定回执格式汇报。',
    workspacePath: '/workspace/crew/coder-x',
  });
  runtime.registerAgent({
    agentId: 'reviewer-y',
    displayName: '评审者',
    driver: 'claude',
    instructions: '独立审查补丁。',
    workspacePath: '/workspace/crew/reviewer-y',
  });
}

const dispatch = (runtime, overrides = {}) => runtime.dispatchTask({
  actorId: CREW_PARENT_AGENT_ID,
  taskId: 't1',
  rootRequestId: 'root-1',
  assignedAgentId: 'coder-x',
  goal: '修复 crew 包的类型错误',
  ...overrides,
});

async function waitFor(predicate) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('waitFor timed out');
}

test('runNextTask refuses before claiming when the driver has no user consent', async () => {
  const {runtime} = open({drivers: {codex: new FakeDriver()}});
  try {
    registerCoders(runtime);
    dispatch(runtime);
    await assert.rejects(
      () => runtime.runNextTask('coder-x'),
      error => error instanceof CrewError && error.code === 'CONSENT_REQUIRED',
    );
    const task = runtime.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'});
    assert.equal(task.status, 'queued', 'the refusal must not claim the task');
    assert.deepEqual(runtime.listAgents(CREW_PARENT_AGENT_ID).map(a => a.driver), ['codex', 'claude']);
  } finally { runtime.close(); }
});

test('runNextTask reports DRIVER_UNAVAILABLE for drivers left to later PRs', async () => {
  const {runtime} = open();
  try {
    registerCoders(runtime);
    grantCodex(runtime);
    dispatch(runtime, {taskId: 't2', assignedAgentId: 'reviewer-y', goal: '审查补丁'});
    await assert.rejects(
      () => runtime.runNextTask('reviewer-y'),
      error => error instanceof CrewError && error.code === 'DRIVER_UNAVAILABLE' && error.message.includes('留后续 PR'),
    );
    const task = runtime.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't2'});
    assert.equal(task.status, 'queued', 'the refusal must not claim the task');
  } finally { runtime.close(); }
});

test('runNextTask reports DRIVER_UNAVAILABLE when the probe fails, with the probe reason', async () => {
  const {runtime} = open({drivers: {codex: new FakeDriver({available: false, unavailableReason: '本机未找到官方 Codex CLI'})}});
  try {
    registerCoders(runtime);
    grantCodex(runtime);
    dispatch(runtime);
    await assert.rejects(
      () => runtime.runNextTask('coder-x'),
      error => error instanceof CrewError && error.code === 'DRIVER_UNAVAILABLE' && error.message.includes('本机未找到官方 Codex CLI'),
    );
    assert.equal(runtime.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'}).status, 'queued');
  } finally { runtime.close(); }
});

test('runNextTask returns undefined without opening a session when nothing is queued', async () => {
  const driver = new FakeDriver();
  const {runtime} = open({drivers: {codex: driver}});
  try {
    registerCoders(runtime);
    grantCodex(runtime);
    assert.equal(await runtime.runNextTask('coder-x'), undefined);
    assert.deepEqual(driver.sessions, [], 'no session is opened for an empty queue');
  } finally { runtime.close(); }
});

test('the driver run consumes a dispatched task end to end: claim, prompt, receipt, mailbox', async () => {
  const driver = new FakeDriver();
  const {runtime, kernel} = open({drivers: {codex: driver}});
  try {
    registerCoders(runtime);
    grantCodex(runtime);
    dispatch(runtime);
    assert.deepEqual(kernel.receiveMessages('coder-x').map(m => m.kind), ['task'], 'dispatch enqueues the task message');
    const runPromise = runtime.runNextTask('coder-x');
    await waitFor(() => driver.sessions.length === 1 && driver.sessions[0].prompts.length === 1);
    assert.equal(driver.startInputs[0].agentId, 'coder-x');
    assert.equal(driver.startInputs[0].instructions, '在自有 worktree 内完成编码任务，并按固定回执格式汇报。');
    assert.equal(driver.startInputs[0].workspacePath, '/workspace/crew/coder-x');
    assert.equal(driver.sessions[0].prompts[0], '修复 crew 包的类型错误', 'the task goal is the prompt');
    // 领取后信箱里的 task 消息已被消费（保留行供审计，不再出现在未读里）。
    assert.deepEqual(kernel.receiveMessages('coder-x'), []);
    driver.sessions[0].emitOutput('正在修改 index.ts');
    driver.sessions[0].complete('类型错误已修复并重跑通过');
    const task = await runPromise;
    assert.equal(task.status, 'succeeded');
    assert.equal(task.receipt.status, 'succeeded');
    assert.equal(task.receipt.result, '类型错误已修复并重跑通过');
    assert.deepEqual([...task.receipt.evidenceRefs], [], 'driver receipts carry no evidence refs (model self-report only)');
    assert.equal(task.receipt.unblock, '');
    assert.equal(driver.sessions[0].closed, true, 'the session closes after the task settles');
    const collected = runtime.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'});
    assert.equal(collected.status, 'succeeded');
  } finally { runtime.close(); }
});

test('driver failure and process exit map to failed receipts', async () => {
  const driver = new FakeDriver();
  const {runtime} = open({drivers: {codex: driver}});
  try {
    registerCoders(runtime);
    grantCodex(runtime);
    dispatch(runtime, {taskId: 't1'});
    const run1 = runtime.runNextTask('coder-x');
    await waitFor(() => driver.sessions.length === 1);
    driver.sessions[0].fail('模型返回了错误');
    const failed = await run1;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.receipt.status, 'failed');
    assert.equal(failed.receipt.result, '模型返回了错误');

    dispatch(runtime, {taskId: 't2', rootRequestId: 'root-2'});
    const run2 = runtime.runNextTask('coder-x');
    await waitFor(() => driver.sessions.length === 2);
    driver.sessions[1].exit(1, 'spawn failed');
    const exited = await run2;
    assert.equal(exited.status, 'failed');
    assert.ok(exited.receipt.result.includes('exit=1'), 'the exit receipt carries the exit code');
  } finally { runtime.close(); }
});

test('a failed driver start maps to a blocked receipt with unblock guidance', async () => {
  const driver = new FakeDriver({startFailure: new CrewError('DRIVER_UNAVAILABLE', 'Codex CLI 未登录')});
  const {runtime} = open({drivers: {codex: driver}});
  try {
    registerCoders(runtime);
    grantCodex(runtime);
    dispatch(runtime);
    const task = await runtime.runNextTask('coder-x');
    assert.equal(task.status, 'blocked');
    assert.equal(task.receipt.status, 'blocked');
    assert.ok(task.receipt.result.includes('Codex CLI 未登录'));
    assert.equal(task.receipt.unblock, VALID_UNBLOCK);
    assert.deepEqual(driver.sessions, [], 'no session was opened');
  } finally { runtime.close(); }
});

test('interrupt cancels the task, forwards to the CLI session and survives a restart', async () => {
  const path = dbFile();
  let clock = 1700000000000;
  const driver = new FakeDriver();
  const first = openCrewDriverRuntime(path, {drivers: {codex: driver}, now: () => (clock += 1000)});
  try {
    registerCoders(first);
    grantCodex(first);
    dispatch(first);
    const runPromise = first.runNextTask('coder-x');
    await waitFor(() => driver.sessions.length === 1 && driver.sessions[0].prompts.length === 1);
    const interrupted = await first.interruptTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', reason: '父 agent 打断：需求变更'});
    assert.equal(interrupted.status, 'cancelled');
    const task = await runPromise;
    assert.equal(task.status, 'cancelled');
    assert.equal(task.receipt, undefined, 'an interrupted task has no driver receipt');
    assert.deepEqual(driver.sessions[0].interrupts, ['父 agent 打断：需求变更']);
    assert.equal(driver.sessions[0].closed, true, 'interrupt closes the CLI session');
    const audit = openCrewKernel(path, {now: () => 1700000000000});
    try {
      // task 消息已消费、interrupt 消息留在信箱供审计。
      assert.deepEqual(audit.receiveMessages('coder-x').map(m => m.kind), ['interrupt']);
    } finally { audit.close(); }
  } finally { first.close(); }

  const second = openCrewDriverRuntime(path, {drivers: {codex: new FakeDriver()}, now: () => (clock += 1000)});
  try {
    const task = second.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'});
    assert.equal(task.status, 'cancelled', 'the interrupt survives a restart');
    assert.equal(task.cancelReason, '父 agent 打断：需求变更');
  } finally { second.close(); }
});

test('runtime events carry the task id and the parent-only gates stay enforced', async () => {
  const driver = new FakeDriver();
  const {runtime} = open({drivers: {codex: driver}});
  try {
    registerCoders(runtime);
    grantCodex(runtime);
    const seen = [];
    runtime.onEvent(event => seen.push(event));
    dispatch(runtime);
    const runPromise = runtime.runNextTask('coder-x');
    await waitFor(() => driver.sessions[0]?.prompts.length === 1);
    driver.sessions[0].complete('完成');
    await runPromise;
    assert.deepEqual(seen.map(e => `${e.type}:${e.taskId}`), ['started:t1', 'completed:t1'], 'runtime events are tagged with the task id');
    assert.throws(
      () => runtime.dispatchTask({actorId: 'coder-x', taskId: 't3', rootRequestId: 'root-3', assignedAgentId: 'coder-x', goal: '子不能派任务根'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    await assert.rejects(() => runtime.runNextTask('ghost'), error => error instanceof CrewError && error.code === 'UNKNOWN_AGENT');
  } finally { runtime.close(); }
});

test('the runtime drives the real codex driver over a fake protocol process end to end', async () => {
  const {spawn, servers} = createFakeCodexSpawn({answers: ['类型错误已修复，补丁见 commit:abc1234']});
  const {runtime} = open({codexSpawn: spawn});
  try {
    registerCoders(runtime);
    runtime.grantConsent({driverId: 'codex', loginKind: 'local-login', termsSummary: '本人本机登录的官方 Codex CLI'});
    dispatch(runtime);
    const task = await runtime.runNextTask('coder-x');
    assert.equal(task.status, 'succeeded', 'the codex app-server protocol run completes the task');
    assert.equal(task.receipt.result, '类型错误已修复，补丁见 commit:abc1234');
    assert.equal(servers[0].prompts[0], '修复 crew 包的类型错误');
    assert.ok(servers[0].exited, 'the CLI process is closed after the task');
    assert.deepEqual(runtime.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'}).receipt.evidenceRefs, []);
  } finally { runtime.close(); }
});

test('consent operations persist and invalid drivers are rejected', () => {
  const path = dbFile();
  const runtime = openCrewDriverRuntime(path, {now: () => 1700000000000});
  try {
    registerCoders(runtime);
    runtime.grantConsent({driverId: 'codex', loginKind: 'local-login', termsSummary: 'x'});
    runtime.revokeConsent('codex', '撤销检查');
    assert.equal(runtime.getConsent('codex').granted, false);
    assert.throws(
      () => runtime.grantConsent({driverId: 'not-a-driver', loginKind: 'api-key', termsSummary: 'x'}),
      error => error instanceof CrewError && error.code === 'INVALID_INPUT',
    );
  } finally { runtime.close(); }
  const reopened = openCrewDriverRuntime(path, {now: () => 1700000000000});
  try {
    assert.equal(reopened.getConsent('codex').granted, false, 'consent records persist across restart');
  } finally { reopened.close(); }
});

test('kernel.dequeueTaskMessage only lets the assigned agent consume its own task message', () => {
  const {runtime, kernel} = open({drivers: {codex: new FakeDriver()}});
  try {
    registerCoders(runtime);
    grantCodex(runtime);
    dispatch(runtime);
    assert.throws(
      () => kernel.dequeueTaskMessage(CREW_PARENT_AGENT_ID, 't1'),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    const consumed = kernel.dequeueTaskMessage('coder-x', 't1');
    assert.equal(consumed.kind, 'task');
    assert.ok(consumed.dequeuedAt);
    assert.equal(kernel.dequeueTaskMessage('coder-x', 't1'), undefined, 'already consumed');
    assert.throws(
      () => kernel.dequeueTaskMessage('coder-x', 'missing'),
      error => error instanceof CrewError && error.code === 'NOT_FOUND',
    );
  } finally { runtime.close(); }
});
