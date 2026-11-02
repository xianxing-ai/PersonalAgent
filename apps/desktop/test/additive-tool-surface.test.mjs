import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {Conversations} from '../electron/conversations.js';
import {ADDITIVE_CONVERSATION_TOOL_NAMES, additiveConversationBindings} from '../electron/additive-conversation-tools.js';
import {createAsyncSubagentHost} from '../electron/async-subagent-host.js';
import {createConversationToolSurface} from '../electron/conversation-tool-surface.js';
import {TaskRuntime} from '@personal-agent/runtime';
import {
  createDeveloperDutyTools,
  createDesktopAsyncSubagentTools,
  createLoopbackRunnerTransport,
  createMemoryRunnerSecrets,
  createRemoteRunnerService,
  createRuntimeApplication,
} from '@personal-agent/runtime/application';
import {handleRunnerJob} from '../../../scripts/remote-runner/remote-runner-service.mjs';

const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture-key\n-----END OPENSSH PRIVATE KEY-----';
const hostKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIfixture';
const token = 'runner-token-0123456789abcdef0123456789abcdef';
const fingerprint = createHash('sha256').update(hostKey).digest('hex');
const hostInput = {name: 'ecs-1', address: '10.0.0.8', port: 22, user: 'runner', provider: 'huawei-ecs', os: 'ubuntu', arch: 'aarch64',
  limits: {maxConcurrent: 2, maxJobsPerMinute: 5}, repos: ['octo/repo'], hostKeyFingerprint: fingerprint, privateKey, runnerToken: token, hostKey, enabled: true};
const context = taskId => ({taskId, runId: 'run', signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString(), authorizationRef: 'auth', scopes: ['agent:delegate']});

function registeredTools(runtime) {
  const pool = createRemoteRunnerService({getRuntime: () => runtime, secrets: createMemoryRunnerSecrets(),
    transport: createLoopbackRunnerTransport(async () => ({v: 1, state: 'succeeded'})),
    localExecute: async () => ({state: 'failed', error: 'local fallback', verification: 'fixture'})});
  const duty = createDeveloperDutyTools({getRuntime: () => runtime});
  const subagents = createDesktopAsyncSubagentTools({competitionOnly: true, getRuntime: () => runtime,
    getTools: () => ({list: () => [], invoke: async () => ({})}),
    runDefaultWorker: async () => ({resultSummary: 'local'})});
  return [...subagents.tools, ...pool.tools, ...duty.tools];
}

test('every additive tool is on the model-visible surface and hidden from child conversations', async () => {
  const runtime = new TaskRuntime(':memory:');
  const tools = registeredTools(runtime);
  const names = tools.map(tool => tool.descriptor.name);
  for (const name of ADDITIVE_CONVERSATION_TOOL_NAMES) assert.equal(names.includes(name), true, name);
  const bindings = additiveConversationBindings(tools, () => runtime);
  assert.equal(bindings.availability.length, ADDITIVE_CONVERSATION_TOOL_NAMES.length);
  assert.equal(bindings.exports.length, ADDITIVE_CONVERSATION_TOOL_NAMES.length);
  const surface = createConversationToolSurface({profile: 'huawei_ict_agentarts', tools, competitionToolAvailability: bindings.availability});
  assert.deepEqual(surface.map(item => item.toolName).sort(), [...ADDITIVE_CONVERSATION_TOOL_NAMES].sort());
  const app = createRuntimeApplication({path: ':memory:', profile: 'huawei_ict_agentarts', hostUserNamespace: 'synthetic-user', tools,
    competitionToolAvailability: bindings.availability, competitionToolExports: bindings.exports});
  const visible = app.readConversationToolCapabilities().map(tool => tool.name);
  for (const name of ADDITIVE_CONVERSATION_TOOL_NAMES) assert.equal(visible.includes(name), true, name);
  assert.equal(app.readConversationToolCapabilities().find(tool => tool.name === 'runner.host.confirm').requiresPresence, true);
  assert.equal(app.readConversationToolCapabilities().find(tool => tool.name === 'subagent.type.confirm').requiresPresence, true);
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '主对话', idempotencyKey: 'surface-parent'});
  const child = runtime.submitTask({conversationId: `desktop-subtask:${parent.taskId}`, goal: '子任务', idempotencyKey: 'surface-child'});
  for (const binding of bindings.availability) {
    assert.equal(await binding.available({taskId: parent.taskId}), true, binding.toolName);
    assert.equal(await binding.available({taskId: child.taskId}), false, binding.toolName);
  }
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(main, /\.\.\.\(additiveSurface\?\.availability\?\?\[\]\)/);
  assert.match(main, /\.\.\.\(additiveSurface\?\.exports\?\?\[\]\)/);
  assert.match(main, /createConversationToolSurface\(/);
  app.close();
});

test('a finished remote child is posted into the parent conversation once', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '主对话', idempotencyKey: 'report-parent'});
  const state = {version: 1, jobs: {}, cursors: {}, comments: {}, recent: []};
  const pool = createRemoteRunnerService({getRuntime: () => runtime, secrets: createMemoryRunnerSecrets(),
    transport: createLoopbackRunnerTransport(async (job, runnerToken) => handleRunnerJob(state, job, {token: runnerToken, now: () => Date.now()})),
    idFactory: (() => {let n = 0; return () => `msg-${++n}`;})(),
    localExecute: async () => ({state: 'failed', error: 'local fallback', verification: 'fixture'})});
  const drafted = await pool.tools.find(tool => tool.descriptor.name === 'runner.host.add').execute({host: hostInput}, context(parent.taskId));
  await pool.tools.find(tool => tool.descriptor.name === 'runner.host.confirm').execute({proposalId: drafted.proposalId, digest: drafted.digest, summary: drafted.summary}, context(parent.taskId));
  const conversations = new Conversations();
  const runtimeModule = await import('@personal-agent/runtime/application');
  const host = createAsyncSubagentHost({runtimeModule, getRuntime: () => runtime,
    getRemoteSubmit: () => pool,
    subagentOptions: {competitionOnly: true, getRuntime: () => runtime,
      getTools: () => ({list: () => [], invoke: async () => ({})}),
      runDefaultWorker: async () => ({resultSummary: '不应走本地'})},
    deliverReport: report => {
      const conversationId = conversations.activeConversationId('panel');
      const session = conversations.session(conversationId, 'panel');
      conversations.addLiveMessage({id: report.messageId, sessionId: session.id, role: 'assistant', text: String(report.summary || '后台子任务已结束'),
        createdAt: '2026-11-02T00:00:00.000Z', surface: 'panel', conversationId});
    }});
  await host.tools.find(tool => tool.descriptor.name === 'subagent.spawn').execute({subtasks: [{subtaskId: 'notes', role: 'researcher', goal: '写说明'}]}, context(parent.taskId));
  await host.pump();
  await new Promise(resolve => setImmediate(resolve));
  await host.pump();
  const messages = [...conversations.messages.values()];
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /远端执行/);
  assert.match(messages[0].id, /^async-report:[0-9a-f]{40}$/);
  const reopened = new Conversations();
  const again = createAsyncSubagentHost({runtimeModule, getRuntime: () => runtime, getRemoteSubmit: () => pool,
    subagentOptions: {competitionOnly: true, getRuntime: () => runtime, getTools: () => ({list: () => [], invoke: async () => ({})}),
      runDefaultWorker: async () => ({resultSummary: '不应走本地'})},
    deliverReport: report => {
      const conversationId = reopened.activeConversationId('panel');
      const session = reopened.session(conversationId, 'panel');
      reopened.addLiveMessage({id: report.messageId, sessionId: session.id, role: 'assistant', text: String(report.summary || '后台子任务已结束'),
        createdAt: '2026-11-02T00:00:00.000Z', surface: 'panel', conversationId});
    }});
  await again.pump();
  assert.equal([...reopened.messages.values()].length, 1);
  assert.equal([...reopened.messages.values()][0].id, messages[0].id);
});
