// F14 原生观察端口定向测试：有界观察、fail-closed、输入锁会话绑定互斥。
// 运行：node --test packages/agentarts/test/f14-native-observation.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDesktopObservationHostPort,
  createDesktopInputLockHostPort,
} from '../dist/f14-native-observation.js';

const deadline = new Date(Date.now() + 60_000).toISOString();
const signal = new AbortController().signal;
const context = (overrides = {}) => ({
  template: {workflowId: 'F14'},
  node: {id: 'F14_N01'},
  input: {},
  predecessorOutputs: {},
  availableTools: [],
  predecessorStates: {},
  deadline, signal, requestId: 'request-1', mode: 'ordinary', namespace: 'session-1',
  ...overrides,
});

const observed = (overrides = {}) => ({
  source: 'caldav-browser://window-1',
  url: 'https://example.com/form',
  title: '示例表单',
  text: '表单文本'.repeat(10),
  elements: [{ref: 'e1', role: 'textbox', label: '姓名'}, {ref: 'e2', role: 'button', label: '提交'}],
  ...overrides,
});

test('观察口：completed 输出有界、带指纹与命名空间绑定', async () => {
  const port = createDesktopObservationHostPort({observe: async () => observed()});
  const result = await port.read(context());
  assert.equal(result.state, 'completed');
  const value = result.value;
  assert.equal(value.observationSha256.length, 64);
  assert.ok(value.elements.length <= 64);
  assert.equal(value.truncated, false);
  // 同一观察在不同 namespace 下指纹不同（会话绑定）
  const other = await port.read(context({namespace: 'session-2'}));
  assert.notEqual(other.value.observationSha256, value.observationSha256);
  // capabilities 只声明本口
  assert.deepEqual(port.capabilities, ['desktop.current_observation']);
});

test('观察口：未配置观察源 → unavailable；畸形结果 → failed；观察抛错 → failed（取消/超时仍穿透）', async () => {
  const unavailable = createDesktopObservationHostPort({observe: async () => undefined});
  assert.equal((await unavailable.read(context())).state, 'unavailable');

  const malformed = createDesktopObservationHostPort({observe: async () => ({source: '', url: '', title: '', text: '', elements: 'nope'})});
  assert.equal((await malformed.read(context())).state, 'failed');

  const throwing = createDesktopObservationHostPort({observe: async () => {throw new Error('boom');}});
  assert.equal((await throwing.read(context())).state, 'failed');

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(() => createDesktopObservationHostPort({observe: async () => {throw new Error('boom');}})
    .read(context({signal: aborted.signal})));

  const bounded = createDesktopObservationHostPort({observe: async () => observed({text: 'x'.repeat(40_000), elements: Array.from({length: 100}, (_, i) => ({ref: `e${i}`, role: 'button', label: 'b'}))}), maxTextBytes: 1000, maxElements: 5});
  const result = await bounded.read(context());
  assert.equal(result.value.truncated, true);
  assert.ok(Buffer.byteLength(result.value.textExcerpt, 'utf8') <= 1004);
  assert.equal(result.value.elements.length, 5);
});

test('输入锁：未配置租约端口 → unavailable（明确缺口，不假装持锁）', async () => {
  const port = createDesktopInputLockHostPort({});
  const result = await port.read(context());
  assert.equal(result.state, 'unavailable');
  assert.equal(result.value.reason, 'input_lease_port_unavailable');
  assert.deepEqual(port.capabilities, ['runtime.desktop_input_lock']);
});

test('输入锁：同会话可续持；他会话持有 → failed；过期 → failed；回执畸形 → failed', async () => {
  let holder = undefined;
  const lease = {
    acquire: async (h) => {
      if (holder && holder.sessionId !== h.sessionId) return undefined;
      holder = {sessionId: h.sessionId, taskId: h.taskId, expiresAt: new Date(Date.now() + 60_000).toISOString()};
      return {token: 'lock-token-1', expiresAt: holder.expiresAt};
    },
    current: async () => (holder ? {...holder} : undefined),
  };
  const port = createDesktopInputLockHostPort({lease});
  const first = await port.read(context());
  assert.equal(first.state, 'completed');
  assert.equal(first.value.sessionId, 'session-1');
  // 同会话再读：续持成功
  assert.equal((await port.read(context())).state, 'completed');
  // 其他会话 → fail-closed
  holder = {sessionId: 'session-evil', taskId: 'other', expiresAt: new Date(Date.now() + 60_000).toISOString()};
  const held = await port.read(context());
  assert.equal(held.state, 'failed');
  assert.equal(held.value.reason, 'input_lock_held_by_other_session');
  // 过期锁 → failed
  holder = {sessionId: 'session-1', taskId: 'request-1', expiresAt: new Date(Date.now() - 1000).toISOString()};
  assert.equal((await port.read(context())).value.reason, 'input_lock_expired');
  // 回执畸形 → failed
  holder = undefined;
  const badLease = {acquire: async () => ({token: '', expiresAt: 'nope'}), current: async () => undefined};
  const badPort = createDesktopInputLockHostPort({lease: badLease});
  assert.equal((await badPort.read(context())).value.reason, 'input_lock_receipt_malformed');
});
