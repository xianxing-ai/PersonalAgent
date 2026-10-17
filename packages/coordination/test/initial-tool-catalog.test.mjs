import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AgentArtsCloudAgentPort, CompetitionCoordinator} from '../dist/index.js';

const config = {gatewayUrl: 'https://agentarts.example.test', runtimeName: 'synthetic',
  responseMode: 'tool-proposal-json', initialRequestMode: 'goal-with-tools-json'};
const availableTools = [{name: 'fixture.read', version: '1.0.0',
  inputSchema: {type: 'object', properties: {id: {type: 'string'}}, required: ['id']}}];
const request = (overrides = {}) => ({taskId: 'private-task', revision: 2, goal: 'Read synthetic item',
  deadline: new Date(Date.now() + 5000).toISOString(), signal: new AbortController().signal, ...overrides});
const response = () => new Response(JSON.stringify({event: 'message',
  data: {text: JSON.stringify({kind: 'text', text: 'Ready'})}}),
{headers: {'content-type': 'application/json'}});

test('opt-in sends only goal and selected descriptor fields; continuation keeps existing projection', async () => {
  const calls = [];
  const guarded = [];
  const cloud = new AgentArtsCloudAgentPort(config, {read: async () => 'Bearer synthetic'},
    async (_url, init) => { calls.push(JSON.parse(init.body)); return response(); }, () => {},
    async selected => { guarded.push(selected.availableTools); });
  const coordinator = new CompetitionCoordinator(cloud);
  const directory = [{...availableTools[0], description: 'must not leave host'}];
  await assert.rejects(coordinator.execute(request({availableTools: directory})), {code: 'INVALID_ARGUMENT'});
  assert.equal(calls.length, 0);
  await coordinator.execute(request({availableTools}));
  assert.deepEqual(calls[0], {query: JSON.stringify({goal: 'Read synthetic item', availableTools})});
  assert.deepEqual(guarded, [availableTools]);
  assert.equal(Object.isFrozen(guarded[0]), true);
  await coordinator.execute(request({continuation: {proposalId: 'p', state: 'confirmed', result: {id: 'x'}}}));
  assert.deepEqual(calls[1], {query: JSON.stringify({continuation: {
    proposalId: 'p', state: 'confirmed', result: {id: 'x'}}})});
  assert.equal(guarded.length, 1);
});

test('missing, empty and malformed directories fail before credentials or network', async () => {
  let reads = 0;
  let sends = 0;
  const cloud = new AgentArtsCloudAgentPort(config, {read: async () => { reads++; return 'Bearer synthetic'; }},
    async () => { sends++; return response(); }, () => {}, async () => {});
  for (const directory of [undefined, []]) {
    await assert.rejects(cloud.invoke(request(directory === undefined ? {} : {availableTools: directory})),
      {code: 'UNSUPPORTED_CAPABILITY'});
  }
  for (const directory of [[{...availableTools[0], secret: 'x'}],
    [availableTools[0], availableTools[0]], [{...availableTools[0], inputSchema: []}]]) {
    await assert.rejects(cloud.invoke(request({availableTools: directory})), {code: 'INVALID_ARGUMENT'});
  }
  await assert.rejects(cloud.invoke(request({availableTools, continuation: {
    proposalId: 'p', state: 'confirmed', result: {id: 'x'}}})), {code: 'INVALID_ARGUMENT'});
  assert.equal(reads, 0);
  assert.equal(sends, 0);
});

test('catalog mode requires async host guard and rejects revocation after credential read', async () => {
  let sends = 0;
  const withoutGuard = new AgentArtsCloudAgentPort(config, {read: async () => 'Bearer synthetic'},
    async () => { sends++; return response(); });
  await assert.rejects(withoutGuard.invoke(request({availableTools})), {code: 'UNAUTHORIZED'});
  let releaseCredential;
  const credential = new Promise(resolve => { releaseCredential = resolve; });
  let allowed = true;
  const cloud = new AgentArtsCloudAgentPort(config, {read: () => credential},
    async () => { sends++; return response(); }, undefined,
    async () => { if (!allowed) throw new Error('private reason'); });
  const pending = cloud.invoke(request({availableTools}));
  allowed = false;
  releaseCredential('Bearer synthetic');
  await assert.rejects(pending, error => error.code === 'UNAUTHORIZED'
    && !error.message.includes('private reason'));
  assert.equal(sends, 0);
});

test('legacy initial request remains raw goal and rejects supplied directory', async () => {
  const calls = [];
  const cloud = new AgentArtsCloudAgentPort({...config, initialRequestMode: undefined},
    {read: async () => 'Bearer synthetic'}, async (_url, init) => { calls.push(JSON.parse(init.body)); return response(); });
  await cloud.invoke(request());
  assert.deepEqual(calls, [{query: 'Read synthetic item'}]);
  await assert.rejects(cloud.invoke(request({availableTools})), {code: 'INVALID_ARGUMENT'});
  assert.equal(calls.length, 1);
});

test('trusted text-only selection preserves the same export guard and denies mixed request modes',async()=>{
  let sends=0,guards=0;
  const cloud=new AgentArtsCloudAgentPort(config,{read:async()=> 'Bearer synthetic'},async(_url,init)=>{
    sends++;assert.deepEqual(JSON.parse(init.body),{query:'Read synthetic item'});return response();
  },selected=>{guards++;assert.equal(selected.textOnly,true);});
  const coordinator=new CompetitionCoordinator(cloud);
  assert.equal((await coordinator.execute(request({textOnly:true}))).kind,'text');
  for(const extra of [{textOnly:false},{textOnly:true,availableTools:[]},{textOnly:true,continuation:{proposalId:'p',state:'confirmed',result:{}}}]) {
    await assert.rejects(coordinator.execute(request(extra)),{code:'INVALID_ARGUMENT'});
    await assert.rejects(cloud.invoke(request(extra)),{code:'INVALID_ARGUMENT'});
  }
  assert.equal(sends,1);assert.equal(guards,1);cloud.close();
});
