import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication, createConfiguredSubagentModelGateway} from '@personal-agent/runtime/application';
import {SyntheticWebSocket} from '../../../packages/coordination/test/fixtures/websocket.mjs';
import {createModelApiConfig} from '../electron/model-api-config.js';
import {createAgentArtsTransportConfig} from '../electron/agentarts-transport-config.js';
import {createProactiveSourceHost} from '../electron/proactive-source-host.js';
import {
  createUsageBudgetProduct,
  isAutonomousRuntimeTask,
  modelApiUsageHooks,
  PROACTIVE_SOURCE_TASK_CHECKPOINT,
} from '../electron/usage-budget-product.js';
import {mountUsageBudget} from '../src/features/admin/usage-budget.js';

const safeStorage = {isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value).reverse(),
  decryptString: value => Buffer.from(value).reverse().toString()};
const noon = () => new Date('2026-11-11T04:00:00.000Z');
const request = () => ({messages: [{role: 'user', content: 'Synthetic request'}], tools: [],
  signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString()});

function product(directory, notices) {
  return createUsageBudgetProduct({
    userData: directory, safeStorage, now: noon, candidates: () => ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    Notification: {isSupported: () => false},
    onUpdate() {},
  });
}

function bind(productInstance, notices) {
  productInstance.bindNotifier({async sendAdvisoryNotification(input) { notices.push(input); return {delivered: true}; }});
}

test('startup hooks record a real gateway call, survive restart, drive settings, and block the next autonomous call', async () => {
  const base = new URL('../../../.cache/usage-budget-tests/', import.meta.url);
  mkdirSync(base, {recursive: true});
  const directory = mkdtempSync(base);
  const notices = [];
  const calls = [];
  let current = product(directory);
  bind(current, notices);
  current.handleAction('usageBudget.configure', {dailyLimitYuan: 10, monthlyLimitYuan: 100, action: 'degrade'});
  const fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body).model);
    return new Response(JSON.stringify({choices: [{message: {content: 'Synthetic answer'}, finish_reason: 'stop'}],
      usage: {prompt_tokens: 600_000, completion_tokens: 400_000, total_tokens: 1_000_000}}),
    {status: 200, headers: {'content-type': 'application/json'}});
  };
  const host = createModelApiConfig({userData: directory, safeStorage, ...modelApiUsageHooks(current),
    createGateway: config => createConfiguredSubagentModelGateway({...config, fetch}),
    createGuardedGateway: config => createConfiguredSubagentModelGateway({...config, fetch})});
  const expensive = host.configure({provider: 'openai-compatible', baseUrl: 'https://synthetic.invalid/v1', model: 'qwen-max', displayName: 'Max', apiKey: 'synthetic-secret', id: 'max'}).models[0];
  host.configure({provider: 'openai-compatible', baseUrl: 'https://synthetic.invalid/v1', model: 'qwen-turbo', displayName: 'Turbo', apiKey: 'synthetic-secret', id: 'turbo'});
  await host.getModelGateway(expensive.id, expensive.configurationRef).complete(request());
  assert.deepEqual(calls, ['qwen-max']);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, 'PersonalAgent 用量');
  assert.match(notices[0].body, /接近上限/);
  assert.match(notices[0].id, /^usage-budget-approach-/);

  const restarted = product(directory);
  const restartedNotices = [];
  bind(restarted, restartedNotices);
  assert.match(restarted.snapshot().usageLine, /1000000 token/);
  assert.match(restarted.snapshot().usageLine, /8\.00\/10\.00 元/);
  const envelope = JSON.parse(readFileSync(path.join(directory, 'usage-budget.json'), 'utf8'));
  const stored = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64')));
  assert.equal(envelope.version, 1);
  assert.equal(stored.ledger[0].modelId, 'qwen-max');
  assert.equal(stored.ledger[0].tokens, 1_000_000);
  assert.equal(stored.ledger.length, 1);

  const fields = {};
  for (const name of ['daily', 'monthly', 'action', 'line']) fields[name] = {value: '', textContent: ''};
  const previousDocument = globalThis.document;
  globalThis.document = {activeElement: null, createElement: () => ({className: '', hidden: false, innerHTML: '',
    querySelector: selector => fields[selector.match(/data-usage="([^"]+)"/)?.[1]]})};
  for (const field of Object.values(fields)) field.addEventListener = (type, fn) => { field['on' + type] = fn; };
  const invoked = [];
  const controls = mountUsageBudget({append() {}}, async (name, payload) => {
    invoked.push({name, payload});
    return restarted.handleAction(name, payload);
  });
  controls.update(restarted.snapshot());
  controls.show(true);
  assert.match(fields.line.textContent, /1000000 token/);
  assert.equal(fields.daily.value, '10');
  assert.equal(fields.action.value, 'degrade');
  const ui = readFileSync(new URL('../src/features/admin/usage-budget.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /保存|刷新|图表/);
  assert.match(ui, /usageBudget\.configure/);
  fields.action.value = 'pause';
  fields.daily.value = '1';
  await fields.action.onchange();
  assert.equal(invoked[0].name, 'usageBudget.configure');
  assert.equal(invoked[0].payload.action, 'pause');
  assert.equal(restarted.snapshot().action, 'pause');
  globalThis.document = previousDocument;

  const blocked = createModelApiConfig({userData: directory, safeStorage, ...modelApiUsageHooks(restarted),
    createGateway: config => createConfiguredSubagentModelGateway({...config, fetch}),
    createGuardedGateway: config => createConfiguredSubagentModelGateway({...config, fetch})});
  const gateway = blocked.getModelGateway(expensive.id, expensive.configurationRef);
  await assert.rejects(restarted.withOrigin('autonomous', () => gateway.complete(request())), /暂停/);
  assert.deepEqual(calls, ['qwen-max']);
  await gateway.complete(request());
  assert.deepEqual(calls, ['qwen-max', 'qwen-max']);

  restarted.handleAction('usageBudget.configure', {dailyLimitYuan: 1, monthlyLimitYuan: 100, action: 'degrade'});
  const downgraded = createModelApiConfig({userData: directory, safeStorage, ...modelApiUsageHooks(restarted),
    createGateway: config => createConfiguredSubagentModelGateway({...config, fetch}),
    createGuardedGateway: config => createConfiguredSubagentModelGateway({...config, fetch})});
  await downgraded.getModelGateway(expensive.id, expensive.configurationRef).complete(request());
  assert.deepEqual(calls.at(-1), 'qwen-turbo');
  const finalBudget = product(directory);
  assert.match(finalBudget.snapshot().usageLine, /qwen-turbo|token/);
  assert.ok(finalBudget.snapshot().usageLine.includes('token'));

  const binding = {gatewayUrl: 'https://synthetic.huaweicloud-agentarts.com', runtimeName: 'owned-preview'};
  const transport = createAgentArtsTransportConfig({binding, environment: {PA_AGENTARTS_TRANSPORT: 'https'},
    configurationProvider: {read: () => ({})}, fetchImpl: async () => { await new Promise(resolve => setTimeout(resolve, 20)); return new Response('ok', {status: 200}); },
    onCloudRun: info => finalBudget.recordCloud(info)});
  await transport.fetchImpl(`${binding.gatewayUrl}/runtimes/${binding.runtimeName}/invocations`,
    {method: 'POST', redirect: 'error', headers: {}, body: '{}'});
  assert.match(product(directory).snapshot().usageLine, /云端 [1-9]/);

  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /createUsageBudgetProduct\(/);
  assert.match(main, /modelApiUsageHooks\(usageBudgetProduct\)/);
  assert.match(main, /usageBudgetProduct\.handleAction\(name, payload\)/);
  assert.match(main, /usageBudgetProduct\?\.bindNotifier\(channel\)/);
  assert.match(main, /usageBudgetProduct\?\.beforeCloudSend\(/);
  assert.match(main, /usageBudgetProduct\?\.degradeSelection\(/);
  assert.match(main, /usageBudgetProduct\?\.noteUserSubmit\(\)/);
  assert.match(main, /onCloudRun: info => usageBudgetProduct\.recordCloud\(info\)/);
  assert.match(preload, /invoke: \(action, payload\) => ipcRenderer\.invoke\('desktop:action', action, payload\)/);
  const degraded = finalBudget.degradeSelection(
    {modelId: 'qwen-max', reasoningEffort: 'high'},
    selection => {
      if (selection.reasoningEffort) throw new Error('unsupported reasoningEffort');
      return selection;
    },
  );
  assert.equal(degraded.modelId, 'qwen-turbo');
  assert.equal(degraded.reasoningEffort, undefined);
  host.dispose(); blocked.dispose(); downgraded.dispose();
});

async function waitForTaskSettlement(app, taskId) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const task = app.runtime.getTask(taskId);
    if (['succeeded', 'failed', 'waiting_reconciliation'].includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Synthetic cloud task did not settle');
}

function readUsageLedger(directory) {
  const envelope = JSON.parse(readFileSync(path.join(directory, 'usage-budget.json'), 'utf8'));
  return JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64'))).ledger;
}

test('WSS cloud runs record duration to usage-budget.json across restart without double-counting HTTPS fallback (L-04)', async () => {
  const base = new URL('../../../.cache/usage-budget-tests/', import.meta.url);
  mkdirSync(base, {recursive: true});
  const directory = mkdtempSync(base);
  const current = product(directory);
  const binding = {gatewayUrl: 'https://synthetic.huaweicloud-agentarts.com', runtimeName: 'owned-preview'};
  const wssUrl = 'wss://synthetic.huaweicloud-agentarts.com/runtimes/owned-preview/ws';
  const appToken = 'synthetic-inner-token-for-wss-usage-test-123456';
  const outer = {read: async () => 'Bearer synthetic-outer-no-real-credential'};
  const transport = createAgentArtsTransportConfig({
    binding,
    environment: {PA_AGENTARTS_TRANSPORT: 'wss', PA_AGENTARTS_WSS_URL: wssUrl, PA_AGENTARTS_HTTPS_FALLBACK: '1'},
    configurationProvider: {read: () => ({appToken})},
    fetchImpl: async () => {
      await new Promise(resolve => setTimeout(resolve, 15));
      return new Response(JSON.stringify([{event: 'message', data: {text: 'HTTPS fallback ok'}}, {event: 'task_end'}, {event: 'end'}]),
        {status: 200, headers: {'content-type': 'application/json'}});
    },
    onCloudRun: info => current.recordCloud(info),
  });
  assert.equal(typeof transport.onWebSocketCloudRun, 'function');
  assert.doesNotMatch(JSON.stringify(transport), /synthetic-inner|Bearer/);

  let mode = 'wss_ok';
  const app = createAgentArtsRuntimeApplication({
    ...binding,
    ...transport,
    path: ':memory:',
    authorizationProvider: outer,
    websocketFactory: () => {
      if (mode === 'fallback') {
        const socket = new SyntheticWebSocket(undefined, {autoReady: false});
        queueMicrotask(() => socket.emit('unexpected-response', undefined, {statusCode: 404, resume() {}}));
        return socket;
      }
      return new SyntheticWebSocket((frame, socket) => {
        if (frame.type !== 'invoke') return;
        socket.accepted(frame);
        setTimeout(() => {
          if (mode === 'wss_disconnect') socket.disconnect();
          else socket.result(frame, 'Synthetic WSS usage ok');
        }, 15);
      });
    },
  });
  current.bindRuntime(() => app.runtime);
  const client = new Client(app);
  await client.connect();
  try {
    const first = await client.call('task.submit', {goal: 'WSS normal task', conversationId: 'desktop-panel'}, {idempotencyKey: 'l04-wss-1'});
    assert.equal((await waitForTaskSettlement(app, first.taskId)).state, 'succeeded');
    let ledger = readUsageLedger(directory);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].kind, 'cloud_runtime');
    assert.equal(ledger[0].origin, 'user');
    assert.ok(ledger[0].durationMs >= 1);

    mode = 'fallback';
    const second = await client.call('task.submit', {goal: 'WSS fallback task', conversationId: 'desktop-panel'}, {idempotencyKey: 'l04-wss-2'});
    assert.equal((await waitForTaskSettlement(app, second.taskId)).state, 'succeeded');
    ledger = readUsageLedger(directory);
    assert.equal(ledger.length, 2, 'HTTPS fallback after before-invoke WSS failure must record once, not twice');

    mode = 'wss_disconnect';
    const third = await client.call('task.submit', {goal: 'WSS disconnect task', conversationId: 'desktop-panel'}, {idempotencyKey: 'l04-wss-3'});
    assert.equal((await waitForTaskSettlement(app, third.taskId)).state, 'waiting_reconciliation');
    ledger = readUsageLedger(directory);
    assert.equal(ledger.length, 3, 'Dispatched WSS run that disconnects must still record duration');

    const restarted = product(directory);
    assert.match(restarted.snapshot().usageLine, /云端 [1-9]/);
  } finally {
    app.close();
  }
});

test('proactive directory schedule keeps autonomous origin and is blocked before cloud send when over limit (L-04)', async () => {
  const base = new URL('../../../.cache/usage-budget-tests/', import.meta.url);
  mkdirSync(base, {recursive: true});
  const directory = mkdtempSync(base);
  const current = product(directory);
  current.handleAction('usageBudget.configure', {dailyLimitYuan: 0.01, monthlyLimitYuan: 100, action: 'pause'});
  current.recordCloud({durationMs: 120_000, origin: 'user'});

  const binding = {gatewayUrl: 'https://synthetic.huaweicloud-agentarts.com', runtimeName: 'owned-preview'};
  const wssUrl = 'wss://synthetic.huaweicloud-agentarts.com/runtimes/owned-preview/ws';
  const appToken = 'synthetic-inner-token-for-wss-proactive-gate-123';
  const outer = {read: async () => 'Bearer synthetic-outer-no-real-credential'};
  const transport = createAgentArtsTransportConfig({
    binding,
    environment: {PA_AGENTARTS_TRANSPORT: 'wss', PA_AGENTARTS_WSS_URL: wssUrl},
    configurationProvider: {read: () => ({appToken})},
    onCloudRun: info => current.recordCloud(info),
  });

  const sentGoals = [];
  const app = createAgentArtsRuntimeApplication({
    ...binding,
    ...transport,
    path: ':memory:',
    authorizationProvider: outer,
    beforeCompetitionSend: request => {
      const proactive = isAutonomousRuntimeTask(app.runtime, request.taskId);
      current.beforeCloudSend({userInitiated: !proactive, modelId: request.executionModel?.modelId});
    },
    websocketFactory: () => new SyntheticWebSocket((frame, socket) => {
      if (frame.type === 'invoke') {
        sentGoals.push(frame.payload?.query ?? '');
        socket.accepted(frame);
        socket.result(frame, 'Allowed manual task');
      }
    }),
  });
  current.bindRuntime(() => app.runtime);
  const client = new Client(app);
  await client.connect();
  try {
    let clock = Date.parse('2026-11-11T08:00:00.000Z');
    let files = [{relativePath: 'notes.md', size: 10, mtimeMs: 1}];
    const submittedIds = [];
    const proactiveHost = createProactiveSourceHost({
      getApplication: () => app,
      getTools: () => [],
      scan: async () => files,
      namespace: 'desktop',
      now: () => clock,
      submitTask: async input => {
        const conversationId = input.conversationId;
        return current.withOrigin('autonomous', async () => {
          const result = await client.call('task.submit', {goal: input.goal, conversationId}, {idempotencyKey: input.idempotencyKey});
          app.runtime.saveCheckpoint(result.taskId, PROACTIVE_SOURCE_TASK_CHECKPOINT, {version: 1, source: 'proactive-source', conversationId});
          submittedIds.push(result.taskId);
          return {taskId: result.taskId, state: result.state ?? 'created'};
        });
      },
    });
    proactiveHost.authorize(path.resolve(directory));
    proactiveHost.update({enabled: true, calendar: false, mail: false, quiet: false});
    await proactiveHost.tick();
    files = [{relativePath: 'notes.md', size: 20, mtimeMs: 2}];
    clock += 300_000;
    await proactiveHost.tick();

    assert.equal(submittedIds.length, 1);
    const autonomousTask = await waitForTaskSettlement(app, submittedIds[0]);
    assert.equal(autonomousTask.state, 'failed');
    assert.equal(isAutonomousRuntimeTask(app.runtime, submittedIds[0]), true);
    assert.equal(sentGoals.length, 0, 'Over-limit autonomous directory task must send zero cloud requests');

    const manual = await client.call('task.submit', {goal: 'Manual user task', conversationId: 'desktop-panel'}, {idempotencyKey: 'l04-manual-1'});
    assert.equal((await waitForTaskSettlement(app, manual.taskId)).state, 'succeeded');
    assert.equal(sentGoals.length, 1);
    assert.equal(readUsageLedger(directory).length, 2, 'Manual WSS run appends one ledger entry while blocked autonomous run adds none');

    const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
    assert.match(main, /isAutonomousRuntimeTask\(runtimeApplication\.runtime,\s*request\.taskId\)/);
    assert.match(main, /usageBudgetProduct\?\.bindRuntime\?\.\(/);
    assert.doesNotMatch(main, /createProactiveSourceHost\(\{[\s\S]{0,400}conversations\?\.activeConversationId\('panel'\)/);
  } finally {
    app.close();
  }
});
