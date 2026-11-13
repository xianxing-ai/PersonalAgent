import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {openStorage} from '@personal-agent/storage';
import {TaskRuntime, RUNTIME_MIGRATIONS} from '../dist/index.js';
import {createRuntimeApplication} from '../dist/application.js';

const catalogRevision = 'a'.repeat(64);

async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pa-user-assistant-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}

async function until(read, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    const value = read();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  return read();
}

test('a user assistant keeps its own chat across restart and can be renamed or deleted', async t => {
  const root = await directory(t);
  const file = path.join(root, 'runtime.sqlite');
  const app = createRuntimeApplication({path: file, text: {mode: 'fake'}});
  const created = app.createAssistant({displayName: '笔记助手', instructions: '把会议整理成短条目', modelId: ''});
  assert.equal(created.origin, 'user');
  assert.equal(created.conversationId, `desktop-assistant:${created.assistantId}`);
  assert.equal(created.modelId, undefined);
  assert.equal(app.listAssistants().some(item => item.assistantId === 'coder'), true);
  assert.throws(() => app.renameAssistant('coder', {displayName: '别的名字'}), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => app.deleteAssistant('coder'), {code: 'INVALID_ARGUMENT'});
  const renamed = app.renameAssistant(created.assistantId, {displayName: '会议笔记', instructions: '只保留决定和待办'});
  assert.equal(renamed.displayName, '会议笔记');
  const first = app.submitAssistantMessage({assistantId: created.assistantId, text: '记下预算', requestId: 'turn-1'});
  await until(() => app.activeTaskCount === 0);
  const second = app.submitAssistantMessage({assistantId: created.assistantId, text: '再补负责人', requestId: 'turn-2'});
  assert.notEqual(first.acceptedTaskId, second.acceptedTaskId);
  await until(() => app.activeTaskCount === 0);
  const thread = app.readAssistantThread(created.assistantId);
  assert.deepEqual(thread.turns.map(turn => turn.userText), ['记下预算', '再补负责人']);
  app.deleteAssistant(created.assistantId);
  assert.equal(app.listAssistants().some(item => item.assistantId === created.assistantId), false);
  app.close();
  const again = createRuntimeApplication({path: file, text: {mode: 'fake'}});
  assert.equal(again.listAssistants().some(item => item.assistantId === created.assistantId), false);
  assert.equal(again.runtime.getTask(first.acceptedTaskId).conversationId, created.conversationId);
  again.close();
});

test('a running user assistant accepts an interruption and still waits for tool approval', async t => {
  const root = await directory(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let executions = 0;
  const descriptor = {
    name: 'fixture.read', version: '1.0.0',
    inputSchema: {type: 'object', additionalProperties: false, required: ['path'], properties: {path: {type: 'string'}}},
    outputSchema: {type: 'object', additionalProperties: false, properties: {value: {type: 'string'}}},
    sideEffect: 'read', requiredScopes: ['fixture:read'], idempotencySupport: true, recoverySupport: true, requiresPresence: false,
  };
  const app = createRuntimeApplication({
    path: path.join(root, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts',
    tools: [{descriptor, execute: async () => { executions += 1; return {value: 'synthetic'}; }}],
    competitionToolExports: [{toolName: descriptor.name, toolVersion: descriptor.version, exportPolicyVersion: 'public-v1', accepts: () => true, project: ({result}) => result}],
    competitionToolAvailability: [{toolName: descriptor.name, toolVersion: descriptor.version, available: () => true}],
    coordination: {execute: async () => {
      await gate;
      return {kind: 'tool_proposal', proposalId: 'user-assistant-1', toolName: descriptor.name, toolVersion: descriptor.version, arguments: {path: 'notes.md'}, verification: 'unverified'};
    }},
  });
  t.after(() => app.close());
  const assistant = app.createAssistant({displayName: '审查笔记', instructions: '先指出遗漏'});
  const sent = app.submitAssistantMessage({assistantId: assistant.assistantId, text: '看一下纪要', requestId: 'busy-1'});
  const running = await until(() => {
    const task = app.runtime.getTask(sent.acceptedTaskId);
    return task.state === 'running' || task.state === 'planning' ? task : undefined;
  });
  assert.ok(running);
  assert.throws(() => app.deleteAssistant(assistant.assistantId), {code: 'REVISION_CONFLICT'});
  const injected = app.submitAssistantMessage({assistantId: assistant.assistantId, text: '先看预算那段', requestId: 'busy-2'});
  assert.equal(injected.injected, true);
  assert.equal(injected.acceptedTaskId, sent.acceptedTaskId);
  release();
  const waiting = await until(() => {
    const task = app.runtime.getTask(sent.acceptedTaskId);
    return task.state === 'waiting_approval' || task.state === 'failed' ? task : undefined;
  });
  assert.equal(waiting.state, 'waiting_approval');
  assert.equal(executions, 0);
  assert.equal(app.runtime.readToolExecutions(sent.acceptedTaskId).some(record => record.policyDecision === 'allow' && record.executionStarted), false);
});

test('an optional model is stored and bound on the assistant turn', async t => {
  const root = await directory(t);
  const seen = [];
  const app = createRuntimeApplication({
    path: path.join(root, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts',
    resolveExecutionModel: ({modelId}) => ({catalogRevision, modelId}),
    coordination: {execute: async request => { seen.push(request.executionModel?.modelId); return {kind: 'text', text: '好', verification: 'mock'}; }},
  });
  t.after(() => app.close());
  assert.throws(() => app.createAssistant({displayName: '坏模型', instructions: '说明', modelId: '有空格'}), /模型标识无效/);
  const assistant = app.createAssistant({displayName: '编码笔记', instructions: '只改测试', modelId: 'deepseek-v4-flash'});
  assert.equal(assistant.modelId, 'deepseek-v4-flash');
  const sent = app.submitAssistantMessage({assistantId: assistant.assistantId, text: '补一条测试', requestId: 'model-1'});
  await until(() => seen.length > 0 && app.activeTaskCount === 0);
  assert.equal(app.runtime.loadCheckpoint(sent.acceptedTaskId, 'execution-model').modelId, 'deepseek-v4-flash');
  assert.equal(seen[0], 'deepseek-v4-flash');
});

test('version 13 assistant rows survive the user-assistant columns', async t => {
  const root = await directory(t);
  const file = path.join(root, 'runtime.sqlite');
  const old = openStorage(file, RUNTIME_MIGRATIONS.slice(0, -1));
  old.prepare(`INSERT INTO assistants (assistant_id, display_name, role, instructions, conversation_id, status, unread_count, created_at, updated_at)
    VALUES ('coder', '编码助手', 'coder', '负责代码', 'desktop-assistant:coder', 'idle', 0, '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z')`).run();
  old.close();
  const runtime = new TaskRuntime(file);
  const coder = runtime.getAssistant('coder');
  assert.equal(coder.origin, 'builtin');
  assert.equal(coder.displayName, '编码助手');
  runtime.close();
});
