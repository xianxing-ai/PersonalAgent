import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication} from '../dist/application.js';

test('front-desk and assistants expose callable internal chat and worker instruct interfaces', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pa-internal-chat-workers-'));
  t.after(async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
    await rm(directory, {recursive: true, force: true}).catch(() => undefined);
  });

  const app = createRuntimeApplication({
    path: path.join(directory, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts',
    coordination: new FakeCoordinationPort(() => ({kind: 'text', text: '完成', verification: 'mock'})),
    competitionToolAvailability: [],
    automaticTools: [
      {toolName: 'assistant.list', toolVersion: '1.0.0'},
      {toolName: 'assistant.create', toolVersion: '1.0.0'},
      {toolName: 'assistant.message', toolVersion: '1.0.0'},
      {toolName: 'worker.list', toolVersion: '1.0.0'},
      {toolName: 'worker.instruct', toolVersion: '1.0.0'},
    ],
  });

  const assistant = app.createAssistant({displayName: '资料复核', instructions: '只和主对话、用户交流'});
  assert.equal(typeof app.listInternalChat, 'function');
  assert.equal(typeof app.listWorkersOwnedByAssistant, 'function');
  assert.equal(typeof app.instructOwnedWorker, 'function');
  assert.deepEqual(app.listInternalChat(10).messages, []);

  const toolNames = new Set((app.tools?.list() ?? []).map(tool => tool.name));
  assert.equal(toolNames.has('assistant.list'), true);
  assert.equal(toolNames.has('assistant.create'), true);
  assert.equal(toolNames.has('assistant.message'), true);
  assert.equal(toolNames.has('worker.list'), true);
  assert.equal(toolNames.has('worker.instruct'), true);

  const front = app.runtime.submitTask({goal: '查天气', conversationId: 'desktop', idempotencyKey: 'fd-1'});
  app.runtime.transitionTask(front.taskId, 'planning');
  app.runtime.transitionTask(front.taskId, 'running');
  app.runtime.saveCheckpoint(front.taskId, 'front-desk-turn', {version: '1.0', at: new Date().toISOString()});

  const roster = await app.tools.invoke({
    taskId: front.taskId,
    toolName: 'assistant.list',
    toolVersion: '1.0.0',
    arguments: {},
    runId: 'fd-list-1',
    authorizationRef: 'fd-list-1',
    deadline: new Date(Date.now() + 30_000).toISOString(),
    signal: new AbortController().signal,
  });
  const listedAssistants = roster?.assistants ?? roster?.result?.assistants ?? app.listAssistants();
  assert.equal(Array.isArray(listedAssistants), true);
  assert.equal(listedAssistants.some(item => item.displayName === '资料复核'), true);

  const created = await app.tools.invoke({
    taskId: front.taskId,
    toolName: 'assistant.create',
    toolVersion: '1.0.0',
    arguments: {displayName: '临时助手', instructions: '只和主对话交流'},
    runId: 'fd-create-1',
    authorizationRef: 'fd-create-1',
    deadline: new Date(Date.now() + 30_000).toISOString(),
    signal: new AbortController().signal,
  });
  assert.equal(created?.created ?? created?.result?.created, true);

  const delivered = await app.tools.invoke({
    taskId: front.taskId,
    toolName: 'assistant.message',
    toolVersion: '1.0.0',
    arguments: {assistantId: '邮件助手', text: '请处理今天的收件箱并回贴结论'},
    runId: 'fd-msg-1',
    authorizationRef: 'fd-msg-1',
    deadline: new Date(Date.now() + 30_000).toISOString(),
    signal: new AbortController().signal,
  });
  assert.ok(delivered);
  assert.equal(delivered.created ?? delivered.result?.created, true);
  assert.equal(delivered.completed ?? delivered.result?.completed, true);
  assert.equal(delivered.replyText ?? delivered.result?.replyText, '完成');
  assert.equal(app.listAssistants().some(item => item.displayName === '邮件助手'), true);
  assert.equal(app.listInternalChat(20).messages.some(item =>
    item.fromAssistantId === 'front-desk' && String(item.body ?? '').includes('收件箱')), true);

  const turn = app.submitAssistantMessage({
    assistantId: assistant.assistantId,
    text: '先盘点工人',
    requestId: 'as-1',
  });
  app.runtime.saveCheckpoint(turn.acceptedTaskId, 'assistant-turn', {
    version: '1.0',
    assistantId: assistant.assistantId,
    at: new Date().toISOString(),
  });
  if (!['planning', 'running', 'waiting_approval', 'succeeded', 'failed'].includes(app.runtime.getTask(turn.acceptedTaskId).state)) {
    try {
      app.runtime.transitionTask(turn.acceptedTaskId, 'planning');
      app.runtime.transitionTask(turn.acceptedTaskId, 'running');
    } catch {
      // submitAssistantMessage may already have advanced the task
    }
  }

  const listed = await app.tools.invoke({
    taskId: turn.acceptedTaskId,
    toolName: 'worker.list',
    toolVersion: '1.0.0',
    arguments: {},
    runId: 'as-list-1',
    authorizationRef: 'as-list-1',
    deadline: new Date(Date.now() + 30_000).toISOString(),
    signal: new AbortController().signal,
  });
  const workers = listed?.workers ?? listed?.result?.workers ?? app.listWorkersOwnedByAssistant(assistant.assistantId);
  assert.equal(Array.isArray(workers), true);

  const instruct = app.instructOwnedWorker(turn.acceptedTaskId, {text: '继续整理未读邮件'});
  assert.equal(instruct.instructed, false);
  assert.equal(instruct.action, 'needs_dispatch');
  assert.match(instruct.reason ?? '', /subagent\.dispatch|新建工人/);

  const deadline = new Date(Date.now() + 30_000).toISOString();
  const signal = new AbortController().signal;

  const fdWorkers = await app.tools.invoke({
    taskId: front.taskId,
    toolName: 'worker.list',
    toolVersion: '1.0.0',
    arguments: {},
    runId: 'fd-worker-list-1',
    authorizationRef: 'fd-worker-list-1',
    deadline,
    signal,
  });
  assert.equal(Array.isArray(fdWorkers?.workers ?? fdWorkers?.result?.workers), true);

  const fdInstruct = app.instructOwnedWorker(front.taskId, {text: '核对前台工人状态'});
  assert.equal(fdInstruct.instructed, false);
  assert.equal(fdInstruct.action, 'needs_dispatch');

  // Active peer assistant turn can also call assistant.create directly.
  const activePeer = app.runtime.submitTask({goal: '创建协作者', conversationId: assistant.conversationId, idempotencyKey: 'as-active-1'});
  app.runtime.transitionTask(activePeer.taskId, 'planning');
  app.runtime.transitionTask(activePeer.taskId, 'running');
  app.runtime.saveCheckpoint(activePeer.taskId, 'assistant-turn', {version: '1.0', assistantId: assistant.assistantId, at: new Date().toISOString()});

  const peerCreated = await app.tools.invoke({
    taskId: activePeer.taskId,
    toolName: 'assistant.create',
    toolVersion: '1.0.0',
    arguments: {displayName: '同行新建助手', instructions: '同级助手协同'},
    runId: 'as-create-1',
    authorizationRef: 'as-create-1',
    deadline,
    signal,
  });
  assert.equal(peerCreated?.created ?? peerCreated?.result?.created, true);

  // Peer-tainted turn (woken from front-desk mail) can still reply via assistant.message without false fence block.
  app.runtime.saveCheckpoint(activePeer.taskId, 'assistant-external-fence', {
    tainted: true, sources: ['peer_mail'], updatedAt: new Date().toISOString(),
  });
  const peerReply = await app.tools.invoke({
    taskId: activePeer.taskId,
    toolName: 'assistant.message',
    toolVersion: '1.0.0',
    arguments: {assistantId: '同行新建助手', text: '收到，同步下进展'},
    runId: 'as-peer-reply-1',
    authorizationRef: 'as-peer-reply-1',
    deadline,
    signal,
  });
  assert.equal(peerReply?.delivered ?? peerReply?.result?.delivered, true);

  // Peer assistant can also post a conclusion back to front-desk / 主对话 without NOT_FOUND.
  const backToFront = await app.tools.invoke({
    taskId: activePeer.taskId,
    toolName: 'assistant.message',
    toolVersion: '1.0.0',
    arguments: {assistantId: '主对话', text: '工人计算完成，结果是 0'},
    runId: 'as-peer-front-1',
    authorizationRef: 'as-peer-front-1',
    deadline,
    signal,
  });
  assert.equal(backToFront?.delivered ?? backToFront?.result?.delivered, true);
  assert.equal(backToFront?.assistantId ?? backToFront?.result?.assistantId, 'front-desk');

  // Verify end-to-end front-desk & peer assistant competition catalogs match identically.
  const seenByRole = {frontDesk: null, peerAssistant: null};
  const catalogDir = await mkdtemp(path.join(os.tmpdir(), 'pa-front-peer-catalog-'));
  t.after(() => rm(catalogDir, {recursive: true, force: true}).catch(() => undefined));
  const weatherTool = {
    descriptor: {
      name: 'weather.forecast', version: '1.0.0',
      inputSchema: {type: 'object', additionalProperties: false, properties: {city: {type: 'string'}}},
      outputSchema: {type: 'object', additionalProperties: true},
      sideEffect: 'read', requiredScopes: ['weather:read'],
      idempotencySupport: true, recoverySupport: true, requiresPresence: false,
    },
    execute: async () => ({summary: '晴'}),
  };
  const heavyTool = {
    descriptor: {
      name: 'mail.read', version: '1.0.0',
      inputSchema: {type: 'object', additionalProperties: false, properties: {}},
      outputSchema: {type: 'object', additionalProperties: true},
      sideEffect: 'read', requiredScopes: ['mail:read'],
      idempotencySupport: true, recoverySupport: true, requiresPresence: false,
    },
    execute: async () => ({items: []}),
  };
  const catalogApp = createRuntimeApplication({
    path: path.join(catalogDir, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts',
    delegateUserTasks: true,
    frontDeskUserTurns: true,
    coordination: new FakeCoordinationPort(req => {
      const names = (req.availableTools ?? []).map(item => item.name).sort();
      if (catalogApp.runtime.loadCheckpoint(req.taskId, 'front-desk-turn')) {
        seenByRole.frontDesk = names;
      } else if (catalogApp.runtime.loadCheckpoint(req.taskId, 'assistant-turn')) {
        seenByRole.peerAssistant = names;
      }
      return {kind: 'text', text: '完成', verification: 'mock'};
    }),
    tools: [weatherTool, heavyTool],
    competitionToolAvailability: [
      {toolName: 'weather.forecast', toolVersion: '1.0.0', available: () => true},
      {toolName: 'mail.read', toolVersion: '1.0.0', available: () => true},
    ],
    competitionToolExports: [
      {toolName: 'weather.forecast', toolVersion: '1.0.0', exportPolicyVersion: 'v1', accepts: () => true, project: ({result}) => result},
      {toolName: 'mail.read', toolVersion: '1.0.0', exportPolicyVersion: 'v1', accepts: () => true, project: ({result}) => result},
    ],
    automaticTools: [
      {toolName: 'weather.forecast', toolVersion: '1.0.0'},
      {toolName: 'assistant.list', toolVersion: '1.0.0'},
      {toolName: 'assistant.create', toolVersion: '1.0.0'},
      {toolName: 'assistant.message', toolVersion: '1.0.0'},
      {toolName: 'worker.list', toolVersion: '1.0.0'},
      {toolName: 'worker.instruct', toolVersion: '1.0.0'},
    ],
  });
  try {
    const client = new Client(catalogApp, Date.now);
    await client.connect();
    const fdSubmitted = await client.call('task.submit', {
      goal: '你好', conversationId: 'panel-main',
    }, {idempotencyKey: 'fd-cat-1'});
    for (let i = 0; i < 80 && !seenByRole.frontDesk; i++) await new Promise(r => setTimeout(r, 15));
    const peerCreatedInCat = catalogApp.createAssistant({displayName: '聊天助手', instructions: '同级聊天'});
    const peerSubmitted = catalogApp.submitAssistantMessage({
      assistantId: peerCreatedInCat.assistantId,
      text: '你好',
      requestId: 'peer-cat-1',
    });
    for (let i = 0; i < 80 && !seenByRole.peerAssistant; i++) await new Promise(r => setTimeout(r, 15));
    assert.ok(seenByRole.frontDesk, 'front-desk coordination call must receive availableTools');
    assert.ok(seenByRole.peerAssistant, 'peer assistant coordination call must receive availableTools');
    assert.deepEqual(seenByRole.frontDesk, seenByRole.peerAssistant);
    for (const name of ['assistant.list', 'assistant.create', 'assistant.message', 'worker.list', 'worker.instruct', 'weather.forecast']) {
      assert.equal(seenByRole.frontDesk.includes(name), true, `missing ${name} on shared assistant catalog`);
    }
    assert.equal(seenByRole.frontDesk.includes('mail.read'), false, 'heavy connectors stay on workers only');
    for (let i = 0; i < 40 && catalogApp.activeTaskCount > 0; i++) await new Promise(r => setTimeout(r, 15));
    assert.ok(fdSubmitted && peerSubmitted);
  } finally {
    try { catalogApp.close(); } catch { /* settle */ }
  }

  try { app.runtime.transitionTask(turn.acceptedTaskId, 'cancelled'); } catch { /* best-effort */ }
  try { app.runtime.transitionTask(activePeer.taskId, 'cancelled'); } catch { /* best-effort */ }
  try { app.close(); } catch { /* workers may still settle in fake coordination */ }
});
