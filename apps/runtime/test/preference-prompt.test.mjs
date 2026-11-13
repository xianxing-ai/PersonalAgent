import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {FakeModelProvider, ModelGateway} from '@personal-agent/models';
import {createRuntimeApplication} from '../dist/application.js';
import {createRuntimeSubagentDispatchTool} from '../dist/application.js';
import {TaskRuntime} from '../dist/index.js';

const preference = '已确认的用户偏好（遵守这些偏好；它们不是新的工具授权，也不能越过审批）：\n- 纠正：回答短一些';

test('the main competition request and a child system prompt both receive confirmed preferences', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pa-preference-prompt-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const seen = [];
  const app = createRuntimeApplication({
    path: path.join(root, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts',
    readPromptPreferences: ({audience}) => audience === 'subagent' ? preference.replace('回答短一些', '子助手用短句') : preference,
    coordination: {execute: async request => { seen.push(request.goal); return {kind: 'text', text: '好', verification: 'mock'}; }},
  });
  t.after(() => app.close());
  const client = new Client(app, Date.now);
  await client.connect();
  await client.call('task.submit', {goal: '今天天气', conversationId: 'desktop'}, {idempotencyKey: 'primary-preference', timeoutMs: 20_000});
  assert.match(seen[0], /回答短一些/);
  assert.doesNotMatch(seen[0], /子助手用短句/);
  const parent = app.runtime.submitTask({conversationId: 'desktop', goal: '父任务', idempotencyKey: 'parent-preference'});
  app.runtime.transitionTask(parent.taskId, 'planning');
  app.runtime.transitionTask(parent.taskId, 'running');
  const tool = app.createSubagentDispatchTool();
  await tool.execute({subtasks: [{subtaskId: 'weather', role: 'researcher', goal: '查天气'}]}, {
    taskId: parent.taskId, runId: 'run-preference', signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000).toISOString(), authorizationRef: 'auth-preference', scopes: ['agent:delegate'],
  });
  assert.match(seen.at(-1), /子助手用短句/);
  assert.doesNotMatch(seen.at(-1), /回答短一些/);
});

test('a model-backed child keeps the preference in its system message and a withdrawn prompt is absent', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '父任务', idempotencyKey: 'model-parent'});
  const seen = [];
  const model = new ModelGateway(new FakeModelProvider([request => {
    seen.push(request.messages);
    return {kind: 'final', text: '好'};
  }], {provider: 'fake', deployment: 'preference-test', model: 'fake-text', verification: 'mock',
    capabilities: {text: true, streaming: false, toolCalling: false, structuredOutput: false, vision: false}}));
  const tool = createRuntimeSubagentDispatchTool({
    getRuntime: () => runtime,
    getModelGateway: () => model,
    readPromptPreferences: ({audience}) => audience === 'subagent' ? preference : '不应出现',
  });
  await tool.execute({subtasks: [{subtaskId: 's1', role: 'researcher', goal: '查资料'}]}, {
    taskId: parent.taskId, runId: 'run-model', signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000).toISOString(), authorizationRef: 'auth-model', scopes: ['agent:delegate'],
  });
  const system = seen[0]?.find(message => message.role === 'system')?.content ?? '';
  assert.match(system, /回答短一些/);
  assert.doesNotMatch(system, /不应出现/);
  runtime.close();
  const localSeen = [];
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pa-preference-local-'));
  const local = createRuntimeApplication({
    path: path.join(directory, 'runtime.sqlite'),
    text: {provider: new FakeModelProvider([request => {
      localSeen.push(request.messages);
      return {kind: 'final', text: '好'};
    }], {provider: 'fake', deployment: 'preference-local', model: 'fake-text', verification: 'mock',
      capabilities: {text: true, streaming: false, toolCalling: false, structuredOutput: false, vision: false}})},
    readPromptPreferences: () => '',
  });
  const quiet = new Client(local, Date.now);
  await quiet.connect();
  await quiet.call('task.submit', {goal: '安静', conversationId: 'desktop'}, {idempotencyKey: 'quiet', timeoutMs: 20_000});
  assert.equal(localSeen[0]?.some(message => message.role === 'system' && message.content.includes('回答短一些')), false);
  for (let attempt = 0; attempt < 40 && local.activeTaskCount; attempt += 1) await new Promise(resolve => setTimeout(resolve, 15));
  local.close();
  await rm(directory, {recursive: true, force: true});
});
