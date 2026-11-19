import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CrewError,
  CodexAppServerDriver,
  CODEX_DRIVER_ID,
  openCrewKernel,
} from '../dist/index.js';
import {
  createFakeCodexSpawn,
  FakeDriver,
} from '../dist/testing.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));
mkdirSync(root, {recursive: true});

function openKernel() {
  let clock = 1700000000000;
  const kernel = openCrewKernel(join(mkdtempSync(join(root, 'driver-')), 'crew.sqlite'), {now: () => (clock += 1000)});
  kernel.consent.grant({driverId: 'codex', loginKind: 'local-login', termsSummary: '本人本机登录的官方 Codex CLI', grantedBy: 'user'});
  return kernel;
}

const waitFor = async predicate => {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('waitFor timed out');
};

test('codex probe is explicitly unavailable when the official CLI is missing', async () => {
  const kernel = openKernel();
  try {
    const {spawn} = createFakeCodexSpawn({missingBinary: true});
    const driver = new CodexAppServerDriver({consent: kernel.consent, spawn});
    const probe = await driver.probe();
    assert.equal(probe.status, 'unavailable');
    assert.ok(probe.reason.includes('codex'), 'the reason names the missing CLI');
    await assert.rejects(
      () => driver.start({agentId: 'coder-x', instructions: 'x', workspacePath: '/w'}),
      error => error instanceof CrewError && error.code === 'DRIVER_UNAVAILABLE' && error.message.includes('未在本机找到官方 Codex CLI'),
    );
  } finally { kernel.close(); }
});

test('codex start refuses without user consent and spawns nothing', async () => {
  const kernel = openKernel();
  try {
    // 未同意 codex 的内核。
    let clock = 1700000000000;
    const fresh = openCrewKernel(join(mkdtempSync(join(root, 'driver-')), 'crew.sqlite'), {now: () => (clock += 1000)});
    try {
      const {spawn, servers} = createFakeCodexSpawn();
      const driver = new CodexAppServerDriver({consent: fresh.consent, spawn});
      await assert.rejects(
        () => driver.start({agentId: 'coder-x', instructions: 'x', workspacePath: '/w'}),
        error => error instanceof CrewError && error.code === 'CONSENT_REQUIRED',
      );
      assert.equal(servers.length, 0, 'no process is spawned before consent');
    } finally { fresh.close(); }
    assert.ok(kernel.consent.getConsent('codex').granted);
  } finally { kernel.close(); }
});

test('codex start refuses when the CLI is not logged in, without pretending availability', async () => {
  const kernel = openKernel();
  try {
    const {spawn} = createFakeCodexSpawn({requiresLogin: true});
    const driver = new CodexAppServerDriver({consent: kernel.consent, spawn, sessionIdPrefix: 't'});
    await assert.rejects(
      () => driver.start({agentId: 'coder-x', instructions: 'x', workspacePath: '/w'}),
      error => error instanceof CrewError && error.code === 'DRIVER_UNAVAILABLE' && error.message.includes('codex login'),
    );
  } finally { kernel.close(); }
});

test('codex start refuses when login status cannot be confirmed', async () => {
  const kernel = openKernel();
  try {
    const {spawn} = createFakeCodexSpawn({loginStatusError: true});
    const driver = new CodexAppServerDriver({consent: kernel.consent, spawn});
    await assert.rejects(
      () => driver.start({agentId: 'coder-x', instructions: 'x', workspacePath: '/w'}),
      error => error instanceof CrewError && error.code === 'DRIVER_UNAVAILABLE' && error.message.includes('无法'),
    );
  } finally { kernel.close(); }
});

test('codex session speaks the app-server protocol: handshake, send, output events, completion', async () => {
  const kernel = openKernel();
  try {
    const {spawn, servers} = createFakeCodexSpawn({answers: ['类型错误已修复，补丁见 commit:abc1234']});
    const driver = new CodexAppServerDriver({consent: kernel.consent, spawn});
    const session = await driver.start({agentId: 'coder-x', instructions: '按固定回执格式汇报', workspacePath: '/workspace/crew/coder-x'});
    try {
      assert.equal(session.driver, CODEX_DRIVER_ID);
      assert.ok(session.sessionId.startsWith('codex-session-'));
      const handshakeMethods = servers[0].requests.map(r => r.method).slice(0, 3);
      assert.deepEqual(handshakeMethods, ['initialize', 'loginStatus', 'newConversation'], 'initialize → loginStatus → newConversation');
      const newConversation = servers[0].requests[2];
      assert.equal(newConversation.params.cwd, '/workspace/crew/coder-x');
      assert.equal(newConversation.params.baseInstructions, '按固定回执格式汇报');
      const events = [];
      session.onEvent(event => events.push(event));
      await session.send('修复 crew 包的类型错误');
      await waitFor(() => servers[0].prompts.length === 1);
      assert.equal(servers[0].prompts[0], '修复 crew 包的类型错误');
      await waitFor(() => events.some(e => e.type === 'completed'));
      const outputTexts = events.filter(e => e.type === 'output').map(e => e.text);
      assert.ok(outputTexts.some(t => t.startsWith('类型错')), 'delta/message notifications surface as output events');
      const completed = events.find(e => e.type === 'completed');
      assert.equal(completed.result, '类型错误已修复，补丁见 commit:abc1234');
      assert.equal(completed.agentId, 'coder-x');
      assert.ok(events.some(e => e.type === 'started'), 'the session emits started once ready');
    } finally { await session.close(); }
    assert.ok(servers[0].exited, 'close terminates the CLI process');
  } finally { kernel.close(); }
});

test('codex session interrupt forwards interruptConversation and emits interrupted', async () => {
  const kernel = openKernel();
  try {
    const {spawn, servers} = createFakeCodexSpawn({answers: []});
    const driver = new CodexAppServerDriver({consent: kernel.consent, spawn});
    const session = await driver.start({agentId: 'coder-x', instructions: 'x', workspacePath: '/w'});
    try {
      const events = [];
      session.onEvent(event => events.push(event));
      await session.interrupt('父 agent 打断：需求变更');
      await waitFor(() => events.some(e => e.type === 'interrupted'));
      assert.equal(servers[0].interrupts.length, 1, 'interruptConversation reached the CLI');
      assert.equal(events.find(e => e.type === 'interrupted').reason, '父 agent 打断：需求变更');
    } finally { await session.close(); }
  } finally { kernel.close(); }
});

test('codex handshake timeout is a clear TIMEOUT failure, not a hang', async () => {
  const kernel = openKernel();
  try {
    const {spawn} = createFakeCodexSpawn({silent: true});
    const driver = new CodexAppServerDriver({consent: kernel.consent, spawn, requestTimeoutMs: 50});
    await assert.rejects(
      () => driver.start({agentId: 'coder-x', instructions: 'x', workspacePath: '/w'}),
      error => error instanceof CrewError && error.code === 'TIMEOUT',
    );
  } finally { kernel.close(); }
});

test('the fake driver follows the same contract: consent gate, availability, scripted events', async () => {
  const kernel = openKernel();
  try {
    const driver = new FakeDriver({driverId: 'grok', available: false, unavailableReason: '本机未安装 grok CLI'});
    const probe = await driver.probe();
    assert.equal(probe.status, 'unavailable');
    await assert.rejects(
      () => driver.start({agentId: 'a', instructions: 'x', workspacePath: '/w'}),
      error => error instanceof CrewError && error.code === 'DRIVER_UNAVAILABLE',
    );
    // 未同意时假驱动同样必须拒绝（与真实驱动同契约）。
    const unconsentedKernel = (() => {
      let clock = 1700000000000;
      return openCrewKernel(join(mkdtempSync(join(root, 'driver-')), 'crew.sqlite'), {now: () => (clock += 1000)});
    })();
    try {
      const gated = new FakeDriver({driverId: 'codex', consent: unconsentedKernel.consent});
      await assert.rejects(
        () => gated.start({agentId: 'a', instructions: 'x', workspacePath: '/w'}),
        error => error instanceof CrewError && error.code === 'CONSENT_REQUIRED',
      );
    } finally { unconsentedKernel.close(); }
    const consenting = new FakeDriver({driverId: 'codex', consent: kernel.consent});
    const session = await consenting.start({agentId: 'coder-x', instructions: 'x', workspacePath: '/w'});
    await session.send('hello');
    assert.deepEqual(session.prompts, ['hello']);
    const events = [];
    session.onEvent(e => events.push(e));
    session.emitOutput('部分输出');
    session.complete('完成');
    assert.deepEqual(events.map(e => e.type), ['started', 'output', 'completed'], 'the buffered started event replays to the first subscriber');
    await session.close();
    assert.equal(session.closed, true);
  } finally { kernel.close(); }
});
