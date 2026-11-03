// 审阅修复（crew-p2 #565 阶段）：F1/F2/F5/F6/F8/F10/F11/F12 的回归测试。
// 每条修复一个场景，全部使用假驱动/假 CLI 与假值，不接触真实凭据。
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
import { createFakeCodexSpawn, FakeDriver } from '../dist/testing.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));
mkdirSync(root, {recursive: true});
const dbFile = () => join(mkdtempSync(join(root, 'crewfix-')), 'crew.sqlite');

function open(options = {}) {
  let clock = 1700000000000;
  const path = dbFile();
  const runtime = openCrewDriverRuntime(path, {...options, now: options.now ?? (() => (clock += 1000))});
  const kernel = openCrewKernel(path, {now: () => 1700000000000});
  return {runtime, kernel, path};
}

function setup(runtime, driver) {
  runtime.registerAgent({
    agentId: 'coder-x',
    displayName: '编码者',
    driver: 'codex',
    instructions: '在自有 worktree 内完成编码任务。',
    workspacePath: '/workspace/crew/coder-x',
  });
  runtime.grantConsent({driverId: 'codex', loginKind: 'local-login', termsSummary: '本人本机登录的官方 Codex CLI'});
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

// ── F1：回执结果超长不再卡死任务 ─────────────────────────────────────────

const LONG = '长'.repeat(9000);

test('F1: an over-long CLI result is truncated, not stuck in running', async () => {
  const driver = new FakeDriver();
  const {runtime} = open({drivers: {codex: driver}});
  try {
    setup(runtime, driver);
    dispatch(runtime);
    const runPromise = runtime.runNextTask('coder-x');
    await waitFor(() => driver.sessions.length === 1 && driver.sessions[0].prompts.length === 1);
    driver.sessions[0].complete(LONG);
    const task = await runPromise;
    assert.equal(task.status, 'succeeded', 'the task must end even with a >8192 result');
    assert.ok(task.receipt.result.length <= 8192, 'the result is capped at MAX_RECEIPT_RESULT');
    assert.ok(task.receipt.result.endsWith('…（已截断）'), 'the truncation marker is kept');
  } finally { runtime.close(); }
});

test('F1: an over-long start-failure message still maps to a short blocked receipt', async () => {
  const driver = new FakeDriver({startFailure: new CrewError('DRIVER_UNAVAILABLE', '启动失败详情：' + LONG)});
  const {runtime} = open({drivers: {codex: driver}});
  try {
    setup(runtime, driver);
    dispatch(runtime);
    const task = await runtime.runNextTask('coder-x');
    assert.equal(task.status, 'blocked');
    assert.ok(task.receipt.result.length <= 8192);
    assert.ok(task.receipt.result.endsWith('…（已截断）'));
    assert.equal(task.receipt.unblock, '在本机安装并登录 codex 对应的官方 CLI 后由父 agent 重新派单');
  } finally { runtime.close(); }
});

test('F1: a submitReceipt failure degrades to a short failed receipt and releases the slot', async () => {
  const driver = new FakeDriver();
  const {runtime} = open({drivers: {codex: driver}});
  try {
    setup(runtime, driver);
    // 让第一次 submitReceipt 抛非 CONFLICT 异常（模拟持久层意外），验证降级回执兜底。
    const kernel = runtime.kernel;
    const original = kernel.submitReceipt.bind(kernel);
    let calls = 0;
    kernel.submitReceipt = input => {
      calls += 1;
      if (calls === 1) throw new CrewError('INVALID_INPUT', 'simulated persistence failure');
      return original(input);
    };
    dispatch(runtime);
    const runPromise = runtime.runNextTask('coder-x');
    await waitFor(() => driver.sessions.length === 1 && driver.sessions[0].prompts.length === 1);
    driver.sessions[0].complete('正常完成');
    const task = await runPromise;
    assert.equal(task.status, 'failed', 'the degraded receipt marks the task failed');
    assert.equal(task.receipt.status, 'failed');
    assert.ok(task.receipt.result.includes('INVALID_INPUT'), 'the degraded receipt names the error code');
    assert.ok(task.receipt.result.length < 200, 'the degraded receipt stays short');
  } finally { runtime.close(); }
});
