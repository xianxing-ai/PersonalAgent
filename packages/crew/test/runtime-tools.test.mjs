import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CrewError,
  CREW_INTERRUPT_TOOL_NAME,
  CREW_LIST_AGENTS_TOOL_NAME,
  CREW_PARENT_AGENT_ID,
  CREW_SEND_MESSAGE_TOOL_NAME,
  CREW_DISPATCH_TOOL_NAME,
  CREW_TOOL_VERSION,
  createCrewRuntimeTools,
  openCrewDriverRuntime,
  openCrewKernel,
} from '../dist/index.js';
import { FakeDriver } from '../dist/testing.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));
mkdirSync(root, {recursive: true});
const dbFile = () => join(mkdtempSync(join(root, 'runtime-tools-')), 'crew.sqlite');

// 与 runtime.test.mjs 相同的装配方式：runtime 与 kernel 打开同一个 crew SQLite 文件。
function open(options = {}) {
  let clock = 1700000000000;
  const path = dbFile();
  const runtime = openCrewDriverRuntime(path, {...options, now: options.now ?? (() => (clock += 1000))});
  const kernel = openCrewKernel(path, {now: () => 1700000000000});
  return {runtime, kernel, path};
}

function tools(runtime, kernel, actorId = CREW_PARENT_AGENT_ID) {
  return createCrewRuntimeTools({runtime, kernel, actorId});
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

async function waitFor(predicate) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('waitFor timed out');
}

/** Gateway 传给工具的最小 ToolContext（字段名与 contracts 的 ToolContext 一致）。 */
const CONTEXT = {
  taskId: 'runtime-task-1',
  runId: 'run-1',
  signal: new AbortController().signal,
  deadline: new Date(Date.now() + 60_000).toISOString(),
  authorizationRef: 'auth-1',
  scopes: ['agent:delegate'],
};

// ── 结构兼容镜像（手工拷贝自 contracts 源码，只读核对） ─────────────────────
//
// - ToolDescriptor：packages/contracts/src/generated.ts 的 `ToolDescriptor` 接口
//   （name/version/inputSchema/outputSchema/sideEffect/requiredScopes/
//   idempotencySupport/recoverySupport/requiresPresence，共 9 个字段）。
// - RegisteredTool / ToolContext：packages/contracts/src/ports.ts
//   （RegisteredTool = descriptor + execute(input, context): Promise<unknown>）。
// crew 不能 import contracts（保持本包依赖边界），因此用镜像逐字段断言：
// 适配器产物作为 RegisteredTool 注册时，形状逐项一致。
const TOOL_DESCRIPTOR_FIELDS = [
  'name', 'version', 'inputSchema', 'outputSchema', 'sideEffect',
  'requiredScopes', 'idempotencySupport', 'recoverySupport', 'requiresPresence',
];
const SIDE_EFFECTS = ['read', 'local_write', 'external_write'];

function assertMatchesToolDescriptor(descriptor, label) {
  assert.deepEqual(
    Object.keys(descriptor).sort(),
    [...TOOL_DESCRIPTOR_FIELDS].sort(),
    `${label}: descriptor fields must match contracts ToolDescriptor exactly`,
  );
  assert.equal(typeof descriptor.name, 'string');
  assert.ok(descriptor.name.length > 0);
  assert.equal(typeof descriptor.version, 'string');
  assert.ok(descriptor.version.length > 0);
  for (const key of ['inputSchema', 'outputSchema']) {
    const schema = descriptor[key];
    assert.equal(typeof schema, 'object', `${label}: ${key} must be an object`);
    assert.ok(schema !== null && !Array.isArray(schema));
    assert.equal(schema.type, 'object', `${label}: ${key}.type must be 'object'`);
    assert.equal(schema.additionalProperties, false, `${label}: ${key} must forbid extra fields`);
  }
  assert.ok(SIDE_EFFECTS.includes(descriptor.sideEffect), `${label}: sideEffect must be in the contracts enum`);
  assert.ok(Array.isArray(descriptor.requiredScopes), `${label}: requiredScopes must be an array (mutable, as in contracts)`);
  for (const scope of descriptor.requiredScopes) {
    assert.equal(typeof scope, 'string');
    assert.ok(scope.length > 0);
  }
  for (const key of ['idempotencySupport', 'recoverySupport', 'requiresPresence']) {
    assert.equal(typeof descriptor[key], 'boolean', `${label}: ${key} must be a boolean`);
  }
}

function assertMatchesRegisteredTool(tool, label) {
  assert.deepEqual(Object.keys(tool).sort(), ['descriptor', 'execute'], `${label}: RegisteredTool fields must match contracts exactly`);
  assertMatchesToolDescriptor(tool.descriptor, label);
  assert.equal(typeof tool.execute, 'function', `${label}: execute must be a function`);
  assert.equal(tool.execute.length, 2, `${label}: execute(input, context) must declare both parameters`);
  const probe = tool.execute({}, CONTEXT);
  assert.ok(probe instanceof Promise, `${label}: execute must return a Promise`);
  probe.catch(() => undefined); // 形状探测允许产生拒绝（例如缺参数），不能留成 unhandled rejection。
}

// ── 测试 ─────────────────────────────────────────────────────────────────

test('adapter tools match the Runtime RegisteredTool / ToolDescriptor shape exactly', () => {
  const {runtime, kernel} = open();
  try {
    registerCoders(runtime);
    const crew = tools(runtime, kernel);
    const expectedNames = ['crew.dispatch', 'crew.send_message', 'crew.list_agents', 'crew.interrupt'];
    assert.deepEqual(crew.tools.map(tool => tool.descriptor.name), expectedNames, 'the tools array is registration-ready and ordered');
    assert.deepEqual(new Set(crew.tools.map(tool => tool.descriptor.name)).size, 4, 'tool names are distinct');
    for (const [label, tool] of Object.entries({dispatch: crew.dispatch, sendMessage: crew.sendMessage, listAgents: crew.listAgents, interrupt: crew.interrupt})) {
      assertMatchesRegisteredTool(tool, label);
      assert.equal(tool.descriptor.version, CREW_TOOL_VERSION);
      assert.deepEqual(tool.descriptor.requiredScopes, ['agent:delegate'], `${label}: delegation-family scope`);
      assert.equal(tool.descriptor.requiresPresence, false);
    }
    assert.equal(crew.dispatch.descriptor.sideEffect, 'local_write');
    assert.equal(crew.sendMessage.descriptor.sideEffect, 'local_write');
    assert.equal(crew.interrupt.descriptor.sideEffect, 'local_write');
    assert.equal(crew.listAgents.descriptor.sideEffect, 'read');
    assert.equal(crew.listAgents.descriptor.idempotencySupport, true, 'a pure read is idempotent');
    assert.equal(crew.dispatch.descriptor.idempotencySupport, false, 'duplicate taskId is a CONFLICT, not a replay');
  } finally { runtime.close(); kernel.close(); }
});

test('crew.dispatch validates input before any kernel call', async () => {
  const {runtime, kernel} = open();
  try {
    registerCoders(runtime);
    grantCodex(runtime);
    const crew = tools(runtime, kernel);
    const dispatch = input => crew.dispatch.execute(input, CONTEXT);
    for (const bad of [
      undefined,
      'not-an-object',
      ['array'],
      {},
      {taskId: 't1', assignedAgentId: 'coder-x'},
      {taskId: 't1', assignedAgentId: 'coder-x', goal: '修复', extra: 1},
      {taskId: 't1', assignedAgentId: 'ghost', goal: '修复'},
      {taskId: 't1', assignedAgentId: 'coder-x', goal: '   '},
    ]) {
      await assert.rejects(() => dispatch(bad), error => error instanceof CrewError && error.code === 'INVALID_INPUT'
        || error instanceof CrewError && error.code === 'UNKNOWN_AGENT');
    }
    assert.deepEqual(runtime.listTasks({actorId: CREW_PARENT_AGENT_ID}), [], 'no task was created by rejected input');
    assert.deepEqual(kernel.receiveMessages('coder-x'), [], 'no mailbox write from rejected input');
  } finally { runtime.close(); kernel.close(); }
});

test('crew.dispatch enqueues through the fake driver end to end', async () => {
  const driver = new FakeDriver();
  const {runtime, kernel} = open({drivers: {codex: driver}});
  try {
    registerCoders(runtime);
    grantCodex(runtime);
    const crew = tools(runtime, kernel);
    const result = await crew.dispatch.execute({
      taskId: 't1', rootRequestId: 'model-forged-root', assignedAgentId: 'coder-x', goal: '修复 crew 包的类型错误',
    }, CONTEXT);
    // F3：模型自报 rootRequestId 被忽略；store 派生 root-<taskId>。
    assert.deepEqual(result, {
      taskId: 't1',
      rootRequestId: 'root-t1',
      assignedAgentId: 'coder-x',
      goal: '修复 crew 包的类型错误',
      status: 'queued',
      createdAt: result.createdAt,
    });
    assert.notEqual(result.rootRequestId, 'model-forged-root');
    assert.match(result.createdAt, /^\d{4}-\d{2}-\d{2}T/, 'createdAt is an ISO timestamp');
    assert.deepEqual(kernel.receiveMessages('coder-x').map(m => m.kind), ['task'], 'the task message reached the mailbox');
    // 派单后的任务由 p2 的驱动运行时真实执行（假驱动）：工具派单 → 领取 → 回执。
    const runPromise = runtime.runNextTask('coder-x');
    await waitFor(() => driver.sessions.length === 1 && driver.sessions[0].prompts.length === 1);
    assert.equal(driver.sessions[0].prompts[0], '修复 crew 包的类型错误');
    driver.sessions[0].complete('类型错误已修复并重跑通过');
    const task = await runPromise;
    assert.equal(task.status, 'succeeded');
    assert.equal(task.receipt.status, 'succeeded');
  } finally { runtime.close(); kernel.close(); }
});

test('crew.dispatch refuses before enqueueing when the driver subscription has no consent', async () => {
  const {runtime, kernel} = open({drivers: {codex: new FakeDriver()}});
  try {
    registerCoders(runtime);
    const crew = tools(runtime, kernel);
    await assert.rejects(
      () => crew.dispatch.execute({taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '修复'}, CONTEXT),
      error => error instanceof CrewError && error.code === 'CONSENT_REQUIRED',
    );
    assert.deepEqual(runtime.listTasks({actorId: CREW_PARENT_AGENT_ID}), [], 'the task must not be enqueued');
    assert.deepEqual(kernel.receiveMessages('coder-x'), [], 'the mailbox must stay untouched');
    // 同意后同一调用成功；撤销后再次拒绝（撤销的同意不算同意）。
    grantCodex(runtime);
    await crew.dispatch.execute({taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '修复'}, CONTEXT);
    runtime.revokeConsent('codex', '用户撤销订阅使用同意');
    await assert.rejects(
      () => crew.dispatch.execute({taskId: 't2', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '再修一次'}, CONTEXT),
      error => error instanceof CrewError && error.code === 'CONSENT_REQUIRED',
    );
    assert.equal(runtime.listTasks({actorId: CREW_PARENT_AGENT_ID}).length, 1, 'revoked consent also refuses before enqueueing');
  } finally { runtime.close(); kernel.close(); }
});

test('crew.dispatch and crew.interrupt stay parent-only through the kernel gates', async () => {
  const driver = new FakeDriver();
  const {runtime, kernel} = open({drivers: {codex: driver}});
  try {
    registerCoders(runtime);
    grantCodex(runtime);
    const childTools = tools(runtime, kernel, 'coder-x');
    await assert.rejects(
      () => childTools.dispatch.execute({taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '子不能派任务根'}, CONTEXT),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    await assert.rejects(
      () => childTools.interrupt.execute({taskId: 't1', reason: '子不能打断'}, CONTEXT),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    // 父身份工具照常工作（先派一个可打断的任务）。
    const crew = tools(runtime, kernel);
    await crew.dispatch.execute({taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '修复'}, CONTEXT);
    const interrupted = await crew.interrupt.execute({taskId: 't1', reason: '父 agent 打断：需求变更'}, CONTEXT);
    assert.deepEqual(interrupted, {
      taskId: 't1',
      status: 'cancelled',
      cancelReason: '父 agent 打断：需求变更',
      finishedAt: interrupted.finishedAt,
    });
  } finally { runtime.close(); kernel.close(); }
});

test('crew.interrupt forwards to the running CLI session and reports conflicts for terminal tasks', async () => {
  const driver = new FakeDriver();
  const {runtime, kernel} = open({drivers: {codex: driver}});
  try {
    registerCoders(runtime);
    grantCodex(runtime);
    const crew = tools(runtime, kernel);
    await crew.dispatch.execute({taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '修复'}, CONTEXT);
    const runPromise = runtime.runNextTask('coder-x');
    await waitFor(() => driver.sessions.length === 1 && driver.sessions[0].prompts.length === 1);
    const result = await crew.interrupt.execute({taskId: 't1', reason: '父 agent 打断：需求变更'}, CONTEXT);
    assert.equal(result.status, 'cancelled');
    const task = await runPromise;
    assert.equal(task.status, 'cancelled', 'the running task settles as cancelled');
    assert.deepEqual(driver.sessions[0].interrupts, ['父 agent 打断：需求变更'], 'the interrupt reached the CLI session');
    assert.equal(driver.sessions[0].closed, true, 'the session is closed after the interrupt');
    // 打断消息持久在信箱（P1 语义不变）。
    assert.deepEqual(kernel.receiveMessages('coder-x').map(m => m.kind), ['interrupt']);
    // 已终态任务再次打断：CONFLICT；不存在任务：NOT_FOUND。
    await assert.rejects(
      () => crew.interrupt.execute({taskId: 't1', reason: '重复打断'}, CONTEXT),
      error => error instanceof CrewError && error.code === 'CONFLICT',
    );
    await assert.rejects(
      () => crew.interrupt.execute({taskId: 'missing', reason: 'x'}, CONTEXT),
      error => error instanceof CrewError && error.code === 'NOT_FOUND',
    );
  } finally { runtime.close(); kernel.close(); }
});

test('crew.send_message delivers to the target mailbox; hop is store-derived and pure acks drop', async () => {
  const {runtime, kernel} = open();
  try {
    registerCoders(runtime);
    const crew = tools(runtime, kernel, 'coder-x');
    const sent = await crew.sendMessage.execute({toAgentId: 'reviewer-y', text: '请独立审查补丁 diff:abc123', expectsReply: true, attachmentRefs: ['diff:abc123']}, CONTEXT);
    assert.equal(sent.delivered, true);
    assert.equal(sent.message.senderAgentId, 'coder-x');
    assert.equal(sent.message.mailboxAgentId, 'reviewer-y');
    assert.equal(sent.message.kind, 'message');
    assert.equal(sent.message.hop, 0, 'fresh messages are hop 0; hop is derived by the store, not the tool layer');
    const mailbox = kernel.receiveMessages('reviewer-y');
    assert.equal(mailbox.length, 1);
    assert.equal(mailbox[0].messageId, sent.message.messageId);
    assert.equal(mailbox[0].expectsReply, true);
    assert.deepEqual([...mailbox[0].attachmentRefs], ['diff:abc123']);
    // 纯确认防死循环：连续第二条纯确认被丢弃，返回 {delivered: false} 且信箱不变。
    const ack1 = await crew.sendMessage.execute({toAgentId: 'reviewer-y', text: '收到'}, CONTEXT);
    assert.equal(ack1.delivered, true);
    const ack2 = await crew.sendMessage.execute({toAgentId: 'reviewer-y', text: '收到'}, CONTEXT);
    assert.deepEqual(ack2, {delivered: false});
    assert.equal(kernel.receiveMessages('reviewer-y').length, 2, 'the dropped ack left no mailbox write');
    // 父身份发送：同样 hop 0（新消息）；回复链通过 replyToMessageId 递增。
    const parentTools = tools(runtime, kernel);
    const fromParent = await parentTools.sendMessage.execute({toAgentId: 'coder-x', text: '补充上下文'}, CONTEXT);
    assert.equal(fromParent.message.hop, 0);
    // 只有当前信箱持有人才能回复：reviewer-y 回复 coder-x 刚发来的消息。
    const reviewerTools = tools(runtime, kernel, 'reviewer-y');
    const reply = await reviewerTools.sendMessage.execute({toAgentId: 'coder-x', text: '回一跳', replyToMessageId: sent.message.messageId}, CONTEXT);
    assert.equal(reply.delivered, true);
    assert.equal(reply.message.hop, 1, 'replyToMessageId makes the store derive hop+1');
    // 参数校验与未知收件人；模型自报 hop 被拒绝（additionalProperties:false）。
    await assert.rejects(
      () => crew.sendMessage.execute({toAgentId: 'reviewer-y'}, CONTEXT),
      error => error instanceof CrewError && error.code === 'INVALID_INPUT',
    );
    await assert.rejects(
      () => crew.sendMessage.execute({toAgentId: 'ghost', text: 'hello'}, CONTEXT),
      error => error instanceof CrewError && error.code === 'UNKNOWN_AGENT',
    );
    await assert.rejects(
      () => crew.sendMessage.execute({toAgentId: 'reviewer-y', text: 'hello', hop: 3}, CONTEXT),
      error => error instanceof CrewError && error.code === 'INVALID_INPUT',
      'hop is never accepted from model input',
    );
  } finally { runtime.close(); kernel.close(); }
});

test('crew.list_agents exposes only addressing fields and accepts an empty input', async () => {
  const {runtime, kernel} = open();
  try {
    registerCoders(runtime);
    const childTools = tools(runtime, kernel, 'coder-x');
    const result = await childTools.listAgents.execute({}, CONTEXT);
    assert.deepEqual(result.agents, [
      {agentId: 'coder-x', displayName: '编码者', driver: 'codex', concurrencyLimit: 2},
      {agentId: 'reviewer-y', displayName: '评审者', driver: 'claude', concurrencyLimit: 2},
    ], 'the view carries the minimal addressing fields only');
    for (const agent of result.agents) {
      assert.ok(!('instructions' in agent) && !('workspacePath' in agent), 'instructions and workspace paths stay hidden');
    }
    // undefined 输入与 {} 等价；任何字段都拒绝。
    await assert.deepEqual(await childTools.listAgents.execute(undefined, CONTEXT), result);
    await assert.rejects(
      () => childTools.listAgents.execute({filter: 'x'}, CONTEXT),
      error => error instanceof CrewError && error.code === 'INVALID_INPUT',
    );
  } finally { runtime.close(); kernel.close(); }
});

test('adapter errors keep the CrewError shape ([CODE] message + code) and the factory validates actorId', async () => {
  const {runtime, kernel} = open();
  try {
    registerCoders(runtime);
    assert.throws(() => createCrewRuntimeTools({runtime, kernel, actorId: '  '}), error => error instanceof CrewError && error.code === 'INVALID_INPUT');
    const crew = tools(runtime, kernel);
    const error = await crew.dispatch.execute({taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'ghost', goal: 'x'}, CONTEXT).catch(e => e);
    assert.ok(error instanceof CrewError);
    assert.equal(error.code, 'UNKNOWN_AGENT');
    assert.ok(error.message.startsWith('[UNKNOWN_AGENT]'), 'CrewError message keeps the [CODE] prefix');
  } finally { runtime.close(); kernel.close(); }
});
