import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {createAgentArtsRuntimeApplication,createConfiguredSubagentModelGateway} from '@personal-agent/runtime/application';
import {Client} from '@personal-agent/client';
import {createModelApiConfig} from '../electron/model-api-config.js';
import {createAgentArtsTransportConfig} from '../electron/agentarts-transport-config.js';
import {createProactiveSourceHost} from '../electron/proactive-source-host.js';
import {createUsageBudgetProduct, modelApiUsageHooks} from '../electron/usage-budget-product.js';
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
  assert.match(main, /onCloudRun: info => usageBudgetProduct\.recordCloud\(/);
  assert.match(main, /onWssRun:info=>usageBudgetProduct\?\.recordCloud\(info\)/);
  assert.match(main, /runtimeApplication\.submitScheduledTextTask\(/);
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

test('trusted schedule origin blocks the cloud send and survives reopen in the same panel conversation', async () => {
  const base = new URL('../../../.cache/usage-budget-tests/', import.meta.url);
  mkdirSync(base,{recursive:true});
  const directory=mkdtempSync(base),notices=[],budget=product(directory);
  bind(budget,notices);
  budget.handleAction('usageBudget.configure',{dailyLimitYuan:1,monthlyLimitYuan:100,action:'pause'});
  budget.recordLocal({modelId:'qwen-max',usage:{totalTokens:1_000_000}});
  let sends=0,app,clock=Date.now(),mtimeMs=1;
  const binding={gatewayUrl:'https://synthetic-budget.invalid',runtimeName:'budget'};
  const transport=createAgentArtsTransportConfig({binding,environment:{},configurationProvider:{read:()=>({})},
    fetchImpl:async()=>{
      sends++;
      return new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify({kind:'text',text:'manual accepted'})}},
        {event:'task_end'},{event:'end'}]),{headers:{'content-type':'application/json'}});
    },
    onCloudRun:info=>budget.recordCloud({...info,origin:app.readTaskUsageOrigin(info.taskId)}),
  });
  const open=()=>createAgentArtsRuntimeApplication({
    path:path.join(directory,'runtime.sqlite'),...binding,now:()=>new Date(clock),
    responseMode:'tool-proposal-json',authorizationProvider:{read:async()=> 'Bearer synthetic'},
    beforeCompetitionSend:request=>budget.beforeCloudSend({userInitiated:app.readTaskUsageOrigin(request.taskId)==='user'}),
    fetchImpl:transport.fetchImpl,
  });
  const settle=async id=>{
    for(let n=0;n<400;n++){
      const task=app.runtime.getTask(id);
      if(['succeeded','failed','waiting_reconciliation'].includes(task.state))return task;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    throw Error('Budget test task did not settle');
  };
  const conversationId='desktop-panel:budget-test';
  app=open();
  try {
    let scheduled,scheduledInput;
    const sources=createProactiveSourceHost({getApplication:()=>app,getTools:()=>[],namespace:'budget-test',
      now:()=>clock,scan:async()=>[{relativePath:'public.txt',size:1,mtimeMs}],
      submitTask:async input=>{
        scheduledInput={...input,conversationId};
        scheduled=app.submitScheduledTextTask(scheduledInput,new Date(clock+30000).toISOString());
        return scheduled;
      }});
    sources.authorize(directory);
    sources.update({enabled:true,calendar:false,mail:false,quiet:false});
    await sources.tick();
    assert.equal(scheduled,undefined);
    clock+=120001;mtimeMs++;
    await sources.tick();
    assert.ok(scheduled,'the trusted directory scheduler submitted the changed file task');
    assert.equal((await settle(scheduled.taskId)).state,'failed');
    assert.equal(sends,0);
    assert.equal(app.submitScheduledTextTask(scheduledInput,new Date(clock+60000).toISOString()).taskId,scheduled.taskId);
    const client=new Client(app,()=>clock);await client.connect();
    const manual=await client.call('task.submit',{goal:'manual task',conversationId},{idempotencyKey:'manual-budget'});
    assert.equal((await settle(manual.taskId)).state,'succeeded');
    assert.equal(sends,1);
    assert.ok(notices.some(notice=>/超|上限/.test(notice.body)));
    assert.match(budget.decide({origin:'user'}).prompt,/这次仍会执行/);
    app.close();
    app=open();
    assert.equal(app.readTaskUsageOrigin(scheduled.taskId),'autonomous');
    assert.equal(app.readTaskUsageOrigin(manual.taskId),'user');
    assert.deepEqual(product(directory).snapshot(),budget.snapshot());
    assert.match(budget.snapshot().usageLine,/云端 [1-9]/);
  } finally {app.close();}
});
