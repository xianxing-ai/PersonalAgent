import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import test from 'node:test';
import {AgentArtsCloudAgentPort} from '@personal-agent/coordination';
import {createPrivateMemoryController} from '../electron/private-memory.js';
import {createPrivateMemoryConsumptionHost} from '../electron/private-memory-consumption-host.js';
import {createMemoryLearningHost} from '../electron/memory-learning-host.js';

async function fixture(t) {
  const parent = fileURLToPath(new URL('../../../.cache/private-memory-consumption/', import.meta.url));
  await mkdir(parent, {recursive: true});
  const base = await mkdtemp(join(parent, 'case-'));
  const vault = join(base, 'vault');
  await mkdir(vault);
  await writeFile(join(vault, 'note.md'), 'Synthetic preference: read plan first.\n');
  let allow = true;
  let onConsent;
  let configuration = 'synthetic-cloud-v1';
  let copyManaged = true;
  const privateMemory = createPrivateMemoryController(join(base, 'private.sqlite'), async () => true,
    async () => true, {confirmWithdraw: async () => true, authorizeConsumption: async request => {
      assert.equal(request.destination, 'agentarts');
      assert.equal(request.configurationRef, configuration);
      await onConsent?.();
      return allow;
    }});
  await privateMemory.selectVault(vault);
  const source = (await privateMemory.search('Synthetic preference')).hits[0].source;
  await privateMemory.save(source, 'First confirmed preference');
  const tasks = new Map();
  const markers = new Map();
  const options = {profile: 'huawei_ict_agentarts', privateMemory,
    readTask: id => tasks.get(id), readTaskBinding: id => markers.get(id),
    writeTaskBinding: (id, binding) => markers.set(id, structuredClone(binding)),
    readConfigurationRef: () => configuration, assertCopyManagement: () => {
      if(!copyManaged) throw Error('Synthetic managed-copy inventory changed');
    }};
  const host = createPrivateMemoryConsumptionHost(options);
  const task = id => {
    tasks.set(id, {taskId: id, conversationId: 'synthetic-conversation', state: 'created'});
    return {taskId: id, conversationId: 'synthetic-conversation', goal: 'Use my confirmed preference',
      deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal};
  };
  t.after(async () => {host.close(); privateMemory.close(); await rm(base, {recursive: true, force: true});});
  return {privateMemory, host, source, vault, tasks, markers, task, options,
    setAllow: value => {allow = value;}, setConsent: value => {onConsent = value;},
    setCopyManaged: value => {copyManaged = value;},
    setConfiguration: value => {configuration = value;}};
}

test('corrected private preference reaches actual adapter body without persisting content; deny sends public goal only', async t => {
  const f = await fixture(t);
  await f.privateMemory.save(f.source, 'Corrected confirmed preference');
  const ref = (await f.privateMemory.listSaved()).facts[0].ref;
  f.host.select({conversationId: 'synthetic-conversation', ref});
  const request = f.task('corrected-task');
  const prepared = await f.host.prepare(request);
  assert.equal(prepared.state, 'authorized');
  const bodies = [];
  const cloud = new AgentArtsCloudAgentPort({gatewayUrl: 'https://agentarts.example.test', runtimeName: 'synthetic-runtime'},
    {read: async () => 'Bearer synthetic-token'}, async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({event: 'message', data: {text: 'Synthetic response'}}),
        {headers: {'content-type': 'application/json'}});
    }, request => f.host.assertCloudSend(request));
  await cloud.invoke({...request, revision: 1, goal: prepared.goal});
  assert.deepEqual(JSON.parse(bodies[0].query), {goal: request.goal,
    userConfirmedMemory: {treatment: 'user_confirmed_data', summary: 'Corrected confirmed preference'}});
  assert.equal(JSON.stringify(bodies).includes('First confirmed preference'), false);
  assert.equal(JSON.stringify(bodies).includes(f.source.path), false);
  const marker = JSON.stringify(f.markers.get(request.taskId));
  assert.equal(marker.includes('Corrected confirmed preference'), false);
  assert.equal(marker.includes(f.source.path), false);
  assert.equal(marker.includes(f.vault), false);
  f.setAllow(false);
  const denied = f.task('denied-task');
  const result = await f.host.prepare(denied);
  assert.deepEqual(result, {state: 'declined', goal: denied.goal});
  assert.equal(f.markers.has(denied.taskId), false);
  await cloud.invoke({...denied, revision: 1, goal: result.goal});
  assert.deepEqual(bodies[1], {query: denied.goal});
});

test('final adapter send rejects a new unmanaged copy after consent and credential await', async t => {
  const f=await fixture(t);
  const ref=(await f.privateMemory.listSaved()).facts[0].ref;
  f.host.select({conversationId:'synthetic-conversation',ref});
  const request=f.task('copy-inventory-task');
  const prepared=await f.host.prepare(request);
  assert.equal(prepared.state,'authorized');
  let sends=0;
  const cloud=new AgentArtsCloudAgentPort({gatewayUrl:'https://agentarts.example.test',runtimeName:'synthetic-runtime'},
    {read:async()=>{await new Promise(resolve=>setImmediate(resolve));f.setCopyManaged(false);return 'Bearer synthetic-token';}},
    async()=>{sends++;throw Error('Must not send after the copy inventory changed');},
    request=>f.host.assertCloudSend(request));
  await assert.rejects(cloud.invoke({...request,revision:1,goal:prepared.goal}),/AgentArts export permission denied/);
  assert.equal(sends,0);
  assert.ok(f.markers.has(request.taskId));
});

test('final adapter send rejects withdrawal during credential wait; restart, config and altered goal never reuse the lease', async t => {
  const f = await fixture(t);
  const ref = (await f.privateMemory.listSaved()).facts[0].ref;
  f.host.select({conversationId: 'synthetic-conversation', ref});
  const request = f.task('revocation-task');
  const prepared = await f.host.prepare(request);
  const outgoing = {...request, revision: 1, goal: prepared.goal};
  assert.throws(() => f.host.assertCloudSend({...outgoing, goal: `${prepared.goal} changed`}), /范围/);
  f.setConfiguration('synthetic-cloud-v2');
  assert.throws(() => f.host.assertCloudSend(outgoing), /范围/);
  f.setConfiguration('synthetic-cloud-v1');
  const restarted = createPrivateMemoryConsumptionHost(f.options);
  assert.throws(() => restarted.assertCloudSend(outgoing), /失效/);
  await assert.rejects(restarted.prepare(request), /重启/);
  restarted.close();
  let calls = 0;
  const cloud = new AgentArtsCloudAgentPort({gatewayUrl: 'https://agentarts.example.test', runtimeName: 'synthetic-runtime'},
    {read: async () => {await f.privateMemory.withdraw(ref); return 'Bearer synthetic-token';}},
    async () => {calls++; throw Error('Must never send withdrawn summary');},
    request => f.host.assertCloudSend(request));
  await assert.rejects(cloud.invoke(outgoing), {code: 'UNAUTHORIZED'});
  assert.equal(calls, 0);
});

test('native consent cannot survive Vault change or cancellation; managed-copy inventory is checked live', async t => {
  const f = await fixture(t);
  const ref = (await f.privateMemory.listSaved()).facts[0].ref;
  f.host.select({conversationId: 'synthetic-conversation', ref});
  f.setConsent(async () => {await f.privateMemory.selectVault(f.vault);});
  await assert.rejects(f.host.prepare(f.task('changed-vault')), /绑定已变化/);
  assert.equal(f.markers.size, 0);
  f.host.select({conversationId: 'synthetic-conversation', ref});
  const cancelled = f.task('cancelled-consent');
  f.setConsent(async () => {f.tasks.get(cancelled.taskId).cancelRequested = true;});
  await assert.rejects(f.host.prepare(cancelled), /任务绑定/);
  assert.equal(f.markers.size, 0);
  const copies = [];
  const bridge = createMemoryLearningHost({profile: 'huawei_ict_agentarts', privateMemory: f.privateMemory,
    managedPrivateCopies: () => copies});
  assert.equal(bridge.snapshot().writeEnabled, true);
  copies.push({id: 'new-managed-copy'});
  assert.equal(bridge.snapshot().writeEnabled, false);
  await assert.rejects(bridge.invoke('memory.previewSave', {source: f.source}), /副本/);
  await assert.rejects(bridge.invoke('memory.delete', {ref}), /副本/);
  assert.equal((await f.privateMemory.listSaved()).facts.length, 1);
  bridge.close();
});

test('assertCloudSend with scope validates sendGoal carrying appended preferences and rejects stripped scope', async t => {
  const f = await fixture(t);
  const ref = (await f.privateMemory.listSaved()).facts[0].ref;
  f.host.select({conversationId: 'synthetic-conversation', ref});
  const request = f.task('scope-check');
  const prepared = await f.host.prepare(request);
  assert.equal(prepared.state, 'authorized');
  const scope = {publicGoal: request.goal, preparedGoal: prepared.goal};
  const sendGoal = `${prepared.goal}\n\n已确认的用户偏好：\n- 纠正：回答短一些`;
  assert.doesNotThrow(() => f.host.assertCloudSend({...request, goal: sendGoal}, scope));
  assert.throws(() => f.host.assertCloudSend({...request, goal: 'tampered without prepared goal'}, scope), /范围/);
});
