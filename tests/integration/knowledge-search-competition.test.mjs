import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {openReadOnlyVault} from '@personal-agent/knowledge/filesystem';
import {createKnowledgeSearchTool, KNOWLEDGE_SEARCH_TOOL_NAME, KNOWLEDGE_SEARCH_TOOL_VERSION} from '@personal-agent/knowledge/tool';
import {createAgentArtsRuntimeApplication, createRuntimeApplication} from '@personal-agent/runtime/application';

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-knowledge-competition-'));
  const root = join(base, 'vault');
  await mkdir(root);
  await writeFile(join(root, 'fixture.md'), 'synthetic knowledge answer\n', 'utf8');
  return {base, root, database: join(base, 'runtime.sqlite')};
}

async function waitForState(app, taskId, states) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const task = app.runtime.getTask(taskId);
    if (states.includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Task ${taskId} did not reach ${states.join(' or ')}`);
}

const publicQuery = '公开演示交付物';
const publicProposalId = 'public-knowledge-proposal';

function publicDemoExport() {
  return {
    toolName: KNOWLEDGE_SEARCH_TOOL_NAME,
    toolVersion: KNOWLEDGE_SEARCH_TOOL_VERSION,
    exportPolicyVersion: 'public-demo-knowledge-v1',
    accepts: ({proposalId, arguments: args}) => proposalId === publicProposalId
      && Object.keys(args).length === 2 && args.query === publicQuery && args.limit === 1,
    project: ({result}) => {
      const hit = result?.hits?.[0];
      if (result?.hits?.length !== 1 || result.truncated !== false
        || hit?.source?.vaultId !== 'public-demo-v1' || hit.source.path !== 'starbridge.md'
        || hit.excerpt !== '公开演示交付物：带来源引用的一页摘要。') {
        throw new Error('Public demo result is outside the selected source');
      }
      return {hits: [{source: {vaultId: hit.source.vaultId, path: hit.source.path,
        line: hit.source.line, revision: hit.source.revision}, excerpt: hit.excerpt}], truncated: false};
    },
  };
}

test('repository public demo knowledge requires approval before reaching Fake coordination', async t => {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-public-knowledge-'));
  const database = join(base, 'runtime.sqlite');
  const root = fileURLToPath(new URL('../../docs/demo/knowledge/vault/', import.meta.url));
  const vault = await openReadOnlyVault({vaultId: 'public-demo-v1', rootPath: root});
  let reads = 0;
  const knowledge = createKnowledgeSearchTool({search: async request => {
    reads++;
    return vault.search(request);
  }});
  const port = new FakeCoordinationPort(request => {
    if (!request.continuation) return {
      kind: 'tool_proposal', proposalId: 'knowledge-proposal',
      toolName: KNOWLEDGE_SEARCH_TOOL_NAME, toolVersion: KNOWLEDGE_SEARCH_TOOL_VERSION,
      arguments: {query: '公开演示交付物', limit: 1}, verification: 'mock',
    };
    assert.equal(request.continuation.proposalId, 'knowledge-proposal');
    assert.equal(request.continuation.state, 'confirmed');
    assert.equal(request.continuation.result.hits.length, 1);
    assert.equal(request.continuation.result.hits[0].excerpt, '公开演示交付物：带来源引用的一页摘要。');
    assert.equal(request.continuation.result.hits[0].source.path, 'starbridge.md');
    assert.equal(request.continuation.result.hits[0].source.vaultId, 'public-demo-v1');
    assert.equal(JSON.stringify(request.continuation).includes(root), false);
    return {kind: 'text', text: 'Synthetic knowledge found', verification: 'mock'};
  });
  const app = createRuntimeApplication({
    path: database, profile: 'huawei_ict_agentarts', coordination: port, tools: [knowledge],
  });
  t.after(async () => {
    app.close();
    await rm(base, {recursive: true, force: true});
  });
  const client = new Client(app, Date.now);
  await client.connect();
  const {taskId} = await client.call('task.submit', {
    goal: '星桥项目的公开演示交付物是什么', conversationId: 'knowledge-competition-public-demo',
  }, {idempotencyKey: 'knowledge-competition-approval'});
  assert.equal((await waitForState(app, taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
  assert.equal(reads, 0);
  assert.equal(port.requests.length, 1);
  const {items: [approval]} = await client.call('approval.list', {taskId, state: 'pending'});
  assert.equal(approval.action, KNOWLEDGE_SEARCH_TOOL_NAME);
  assert.equal('arguments' in approval, false);
  const decision = {approvalId: approval.approvalId, expectedRevision: approval.revision, decision: 'allow_once'};
  await client.call('authorization.respond', decision);
  const completed = await waitForState(app, taskId, ['succeeded', 'failed']);
  assert.equal(completed.state, 'succeeded');
  assert.equal(reads, 1);
  assert.equal(port.requests.length, 2);
  assert.deepEqual(completed.evidenceRefs, [approval.approvalId]);
  await client.call('authorization.respond', decision);
  assert.equal(reads, 1, 'replayed approval must not read the Vault again');
});

test('denying knowledge approval leaves the synthetic Vault unread and sends no continuation', async t => {
  const {base, root, database} = await fixture();
  const vault = await openReadOnlyVault({vaultId: 'synthetic-vault', rootPath: root});
  let reads = 0;
  const knowledge = createKnowledgeSearchTool({search: async request => {
    reads++;
    return vault.search(request);
  }});
  const port = new FakeCoordinationPort(() => ({
    kind: 'tool_proposal', proposalId: 'denied-knowledge-proposal',
    toolName: KNOWLEDGE_SEARCH_TOOL_NAME, toolVersion: KNOWLEDGE_SEARCH_TOOL_VERSION,
    arguments: {query: 'knowledge', limit: 1}, verification: 'mock',
  }));
  const app = createRuntimeApplication({
    path: database, profile: 'huawei_ict_agentarts', coordination: port, tools: [knowledge],
  });
  t.after(async () => {
    app.close();
    await rm(base, {recursive: true, force: true});
  });
  const client = new Client(app, Date.now);
  await client.connect();
  const {taskId} = await client.call('task.submit', {
    goal: 'Search synthetic knowledge', conversationId: 'knowledge-competition-synthetic',
  }, {idempotencyKey: 'knowledge-competition-denied'});
  assert.equal((await waitForState(app, taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
  const {items: [approval]} = await client.call('approval.list', {taskId, state: 'pending'});
  await client.call('authorization.respond', {
    approvalId: approval.approvalId, expectedRevision: approval.revision, decision: 'deny',
  });
  assert.equal(app.runtime.getTask(taskId).state, 'cancelled');
  assert.equal(reads, 0);
  assert.equal(port.requests.length, 1);
  assert.equal(app.runtime.readToolExecutions(taskId)[0].executionStarted, false);
});

test('unverified proposal cannot read or export synthetic knowledge', async t => {
  const {base, root, database} = await fixture();
  const vault = await openReadOnlyVault({vaultId: 'synthetic-vault', rootPath: root});
  let reads = 0;
  const knowledge = createKnowledgeSearchTool({search: async request => {
    reads++;
    return vault.search(request);
  }});
  const port = new FakeCoordinationPort(() => ({
    kind: 'tool_proposal', proposalId: 'unverified-knowledge-proposal',
    toolName: KNOWLEDGE_SEARCH_TOOL_NAME, toolVersion: KNOWLEDGE_SEARCH_TOOL_VERSION,
    arguments: {query: 'knowledge', limit: 1}, verification: 'unverified',
  }));
  const app = createRuntimeApplication({
    path: database, profile: 'huawei_ict_agentarts', coordination: port, tools: [knowledge],
  });
  t.after(async () => {
    app.close();
    await rm(base, {recursive: true, force: true});
  });
  const client = new Client(app, Date.now);
  await client.connect();
  const {taskId} = await client.call('task.submit', {
    goal: 'Search synthetic knowledge', conversationId: 'knowledge-competition-synthetic',
  }, {idempotencyKey: 'knowledge-competition-unverified'});
  const failed = await waitForState(app, taskId, ['failed']);
  assert.equal(failed.error.code, 'UNSUPPORTED_CAPABILITY');
  assert.equal(reads, 0);
  assert.equal(port.requests.length, 1);
  assert.deepEqual((await client.call('approval.list', {taskId})).items, []);
});

test('explicit public-demo export lets an unverified proposal read only after approval', async t => {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-public-knowledge-export-'));
  const root = fileURLToPath(new URL('../../docs/demo/knowledge/vault/', import.meta.url));
  const vault = await openReadOnlyVault({vaultId: 'public-demo-v1', rootPath: root});
  let reads = 0;
  const knowledge = createKnowledgeSearchTool({search: async request => {
    reads++;
    return vault.search(request);
  }});
  const port = new FakeCoordinationPort(request => request.continuation
    ? {kind: 'text', text: 'Public demo source found', verification: 'unverified'}
    : {kind: 'tool_proposal', proposalId: publicProposalId,
      toolName: KNOWLEDGE_SEARCH_TOOL_NAME, toolVersion: KNOWLEDGE_SEARCH_TOOL_VERSION,
      arguments: {query: publicQuery, limit: 1}, verification: 'unverified'});
  const app = createRuntimeApplication({path: join(base, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts', coordination: port, tools: [knowledge],
    competitionToolExports: [publicDemoExport()]});
  t.after(async () => { app.close(); await rm(base, {recursive: true, force: true}); });
  const client = new Client(app, Date.now);
  await client.connect();
  const {taskId} = await client.call('task.submit', {
    goal: '检索星桥项目公开演示交付物', conversationId: 'public-knowledge-export',
  }, {idempotencyKey: 'public-knowledge-export'});
  assert.equal((await waitForState(app, taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
  assert.equal(reads, 0);
  assert.equal(port.requests.length, 1);
  const {items: [approval]} = await client.call('approval.list', {taskId, state: 'pending'});
  await client.call('authorization.respond', {
    approvalId: approval.approvalId, expectedRevision: approval.revision, decision: 'allow_once',
  });
  const task = await waitForState(app, taskId, ['succeeded', 'failed']);
  assert.equal(task.state, 'succeeded', JSON.stringify({error:task.error,
    deadline:app.runtime.loadCheckpoint(taskId,'application-deadline')}));
  assert.equal(reads, 1);
  assert.deepEqual(task.evidenceRefs, [approval.approvalId]);
  assert.equal(port.requests.length, 2);
  assert.equal(port.requests[1].continuation.result.hits[0].source.path, 'starbridge.md');
  assert.equal(port.requests[1].continuation.result.hits[0].excerpt,
    '公开演示交付物：带来源引用的一页摘要。');
  assert.deepEqual(Object.keys(port.requests[1].continuation.result.hits[0]), ['source', 'excerpt']);
  assert.match(task.resultSummary, /verification=unverified/);
});

test('public-demo export rejects a different query before approval or Vault read', async t => {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-public-knowledge-scope-'));
  const root = fileURLToPath(new URL('../../docs/demo/knowledge/vault/', import.meta.url));
  let reads = 0;
  const vault = await openReadOnlyVault({vaultId: 'public-demo-v1', rootPath: root});
  const knowledge = createKnowledgeSearchTool({search: async request => {
    reads++;
    return vault.search(request);
  }});
  const port = new FakeCoordinationPort(() => ({kind: 'tool_proposal', proposalId: publicProposalId,
    toolName: KNOWLEDGE_SEARCH_TOOL_NAME, toolVersion: KNOWLEDGE_SEARCH_TOOL_VERSION,
    arguments: {query: '私人笔记', limit: 1}, verification: 'unverified'}));
  const app = createRuntimeApplication({path: join(base, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts', coordination: port, tools: [knowledge],
    competitionToolExports: [publicDemoExport()]});
  t.after(async () => { app.close(); await rm(base, {recursive: true, force: true}); });
  const client = new Client(app, Date.now);
  await client.connect();
  const {taskId} = await client.call('task.submit', {
    goal: '检索私人笔记', conversationId: 'public-knowledge-export',
  }, {idempotencyKey: 'public-knowledge-scope'});
  const task = await waitForState(app, taskId, ['failed', 'waiting_approval']);
  assert.equal(task.state, 'failed');
  assert.equal(task.error.code, 'UNAUTHORIZED');
  assert.equal(reads, 0);
  assert.equal(port.requests.length, 1);
  assert.deepEqual((await client.call('approval.list', {taskId})).items, []);
});

test('offline AgentArts HTTP adapter sends only the approved public knowledge projection', async t => {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-public-knowledge-http-'));
  const root = fileURLToPath(new URL('../../docs/demo/knowledge/vault/', import.meta.url));
  const vault = await openReadOnlyVault({vaultId: 'public-demo-v1', rootPath: root});
  let reads = 0;
  const knowledge = createKnowledgeSearchTool({search: async request => {
    reads++;
    return vault.search(request);
  }});
  const requests = [];
  const proposal = {kind: 'tool_proposal', proposalId: publicProposalId,
    toolName: KNOWLEDGE_SEARCH_TOOL_NAME, toolVersion: KNOWLEDGE_SEARCH_TOOL_VERSION,
    arguments: {query: publicQuery, limit: 1}};
  const app = createAgentArtsRuntimeApplication({
    path: join(base, 'runtime.sqlite'), gatewayUrl: 'https://agentarts.example.test',
    runtimeName: 'public-demo', responseMode: 'tool-proposal-json',
    authorizationProvider: {read: async () => 'Bearer synthetic-token'},
    tools: [knowledge], competitionToolExports: [publicDemoExport()],
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      const result = requests.length === 1 ? proposal
        : {kind: 'text', text: '已找到公开演示交付物'};
      return new Response(JSON.stringify({event: 'message', data: {text: JSON.stringify(result), index: 0}}), {
        status: 200, headers: {'content-type': 'application/json'},
      });
    },
  });
  t.after(async () => { app.close(); await rm(base, {recursive: true, force: true}); });
  const client = new Client(app, Date.now);
  await client.connect();
  const {taskId} = await client.call('task.submit', {
    goal: '检索星桥项目公开演示交付物', conversationId: 'public-knowledge-http',
  }, {idempotencyKey: 'public-knowledge-http'});
  assert.equal((await waitForState(app, taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
  assert.equal(reads, 0);
  assert.equal(requests.length, 1);
  const {items: [approval]} = await client.call('approval.list', {taskId, state: 'pending'});
  await client.call('authorization.respond', {
    approvalId: approval.approvalId, expectedRevision: approval.revision, decision: 'allow_once',
  });
  const task = await waitForState(app, taskId, ['succeeded', 'failed']);
  assert.equal(task.state, 'succeeded');
  assert.equal(reads, 1);
  assert.equal(requests.length, 2);
  const continuation = JSON.parse(requests[1].query).continuation;
  assert.equal(continuation.proposalId, publicProposalId);
  assert.equal(continuation.state, 'confirmed');
  assert.deepEqual(Object.keys(continuation.result), ['hits', 'truncated']);
  assert.equal(continuation.result.hits.length, 1);
  const {source, excerpt} = continuation.result.hits[0];
  assert.deepEqual(Object.keys(source), ['vaultId', 'path', 'line', 'revision']);
  assert.equal(source.vaultId, 'public-demo-v1');
  assert.equal(source.path, 'starbridge.md');
  assert.equal(source.line, 5);
  assert.match(source.revision, /^[a-f0-9]{64}$/);
  assert.equal(excerpt, '公开演示交付物：带来源引用的一页摘要。');
  assert.match(task.resultSummary, /verification=unverified/);
});
