import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import test from 'node:test';
import {TaskRuntime, RUNTIME_MIGRATIONS} from '../dist/index.js';
import {openStorage} from '@personal-agent/storage';
import {createRuntimeApplication} from '../dist/application.js';
import {FakeModelProvider} from '@personal-agent/models';
import {ToolGateway, toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {FakeWeatherProvider, register} from '@personal-agent/weather';

const root = fileURLToPath(new URL('../../../.cache/mod-04-05-tests/', import.meta.url));
mkdirSync(root, {recursive: true});
const database = () => join(mkdtempSync(join(root, 'case-')), 'runtime.sqlite');
const future = () => new Date(Date.now() + 60_000).toISOString();
const signal = () => new AbortController().signal;
const request = (operation, payload, extra = {}) => ({kind: 'request', protocolVersion: '1.0.0', requestId: crypto.randomUUID(), deadline: future(), operation, payload, ...extra});
const waitFor = async predicate => {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Task did not reach expected state');
};
const descriptor = {name: 'test.read', version: '1', inputSchema: {type: 'object'}, outputSchema: {type: 'object'}, sideEffect: 'read', requiredScopes: ['test:read'], idempotencySupport: true, recoverySupport: true, requiresPresence: false};
const proposal = {kind: 'tool_proposal', proposal: {toolName: descriptor.name, toolVersion: descriptor.version, arguments: {}}};

test('upgrade from the pre-authorization database preserves existing tasks', () => {
  const path = database();
  const old = openStorage(path, RUNTIME_MIGRATIONS.slice(0, 1));
  old.prepare('INSERT INTO tasks (task_id, goal, conversation_id, attachment_refs_json, state, revision, updated_at, steps_json, evidence_refs_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('old-task', 'preserve', 'old-conversation', '[]', 'created', 1, new Date().toISOString(), '[]', '[]');
  old.close();
  const runtime = new TaskRuntime(path);
  assert.equal(runtime.getTask('old-task').state, 'created');
  runtime.policy.grant({authorizationRef: 'new-grant', taskId: 'old-task', toolName: descriptor.name, scopes: descriptor.requiredScopes, expiresAt: future()});
  assert.ok(runtime.policy.get('new-grant'));
  runtime.close();
});

test('grants survive restart, consume once atomically, and remain revoked', () => {
  const path = database();
  let runtime = new TaskRuntime(path);
  runtime.policy.grant({authorizationRef: 'once', taskId: 'task', toolName: 'test.read', scopes: ['test:read'], expiresAt: future(), maxUses: 1});
  runtime.close();
  runtime = new TaskRuntime(path);
  const input = {authorizationRef: 'once', taskId: 'task', toolName: 'test.read', requiredScopes: ['test:read'], now: Date.now()};
  assert.throws(() => runtime.policy.authorize({...input, taskId: 'wrong'}), /bound/);
  runtime.policy.authorize(input);
  runtime.close();
  runtime = new TaskRuntime(path);
  assert.throws(() => runtime.policy.authorize(input), /exhausted/);
  runtime.policy.revoke('once');
  runtime.close();
  runtime = new TaskRuntime(path);
  assert.equal(runtime.policy.get('once'), undefined);
  runtime.close();
});

test('tool results and failure records survive restart; repeated runs never re-execute', async () => {
  const path = database();
  let calls = 0;
  const create = () => new TaskRuntime(path, {createToolGateway: policy => {
    const gateway = new ToolGateway({policy});
    gateway.register({descriptor, execute: async () => { calls++; return {answer: 42}; }});
    return gateway;
  }});
  let runtime = create();
  const task = runtime.submitTask({goal: 'test', conversationId: 'test', idempotencyKey: 'test'});
  runtime.transitionTask(task.taskId, 'planning'); runtime.transitionTask(task.taskId, 'running');
  runtime.policy.grant({authorizationRef: 'grant', taskId: task.taskId, toolName: descriptor.name, scopes: descriptor.requiredScopes, expiresAt: future(), maxUses: 1});
  const invoke = request('tool.invoke', {toolName: descriptor.name, toolVersion: '1', arguments: {}, scopeRef: 'grant'}, {taskId: task.taskId, idempotencyKey: 'stable-run'});
  assert.equal((await runtime.send(invoke, signal())).outcome, 'ok');
  runtime.close(); runtime = create();
  const replay = await runtime.send(invoke, signal());
  assert.equal(replay.outcome, 'ok'); assert.deepEqual(replay.data.result, {answer: 42}); assert.equal(calls, 1);
  const denied = await runtime.send({...invoke, idempotencyKey: 'denied-run', payload: {...invoke.payload, scopeRef: 'missing'}}, signal());
  assert.equal(denied.outcome, 'error');
  assert.deepEqual(runtime.readToolExecutions(task.taskId).map(item => item.state), ['confirmed', 'failed']);
  assert.equal(runtime.getTask(task.taskId).evidenceRefs.length, 2);
  runtime.close();
});

test('parameter-bound grant rejects changed arguments without consuming the permitted use', () => {
  const runtime = new TaskRuntime(database());
  const input = {authorizationRef: 'bound', taskId: 'task', toolName: descriptor.name, scopes: descriptor.requiredScopes, expiresAt: future(), maxUses: 1, argumentsDigest: toolArgumentsDigest({city: 'Beijing', units: 'metric'})};
  runtime.policy.grant(input);
  const authorization = {authorizationRef: input.authorizationRef, taskId: input.taskId, toolName: input.toolName, requiredScopes: input.scopes, now: Date.now()};
  assert.throws(() => runtime.policy.authorize({...authorization, argumentsDigest: toolArgumentsDigest({city: 'Shanghai', units: 'metric'})}), {code: 'SCOPE_DENIED'});
  assert.equal(runtime.policy.get('bound').usesRemaining, 1);
  runtime.policy.authorize({...authorization, argumentsDigest: toolArgumentsDigest({units: 'metric', city: 'Beijing'})});
  assert.equal(runtime.policy.get('bound').usesRemaining, 0);
  runtime.close();
});

test('write errors require reconciliation and generic connector errors do not leak details', async () => {
  for (const sideEffect of ['read', 'external_write']) {
    const runtime = new TaskRuntime(database(), {createToolGateway: policy => {
      const gateway = new ToolGateway({policy});
      gateway.register({descriptor: {...descriptor, sideEffect}, execute: async () => { throw new Error('Bearer secret-key'); }});
      return gateway;
    }});
    const task = runtime.submitTask({goal: 'test', conversationId: 'test', idempotencyKey: 'test'});
    runtime.transitionTask(task.taskId, 'planning'); runtime.transitionTask(task.taskId, 'running');
    runtime.policy.grant({authorizationRef: 'grant', taskId: task.taskId, toolName: descriptor.name, scopes: descriptor.requiredScopes, expiresAt: future()});
    const response = await runtime.send(request('tool.invoke', {toolName: descriptor.name, toolVersion: '1', arguments: {}, scopeRef: 'grant'}, {taskId: task.taskId}), signal());
    assert.doesNotMatch(JSON.stringify(response), /secret-key/);
    assert.doesNotMatch(JSON.stringify(runtime.readEvidence(task.taskId)), /secret-key/);
    if (sideEffect === 'external_write') assert.equal(runtime.getTask(task.taskId).state, 'waiting_reconciliation');
    else assert.equal(response.error.code, 'EXTERNAL_FAILURE');
    runtime.close();
  }
});

test('Application persists approval and resumes the exact proposal after restart', async () => {
  const path = database(); let calls = 0;
  const tool = {descriptor, execute: async () => { calls++; return {answer: 42}; }};
  let model = new FakeModelProvider([proposal]);
  let app = createRuntimeApplication({path, tools: [tool], text: {provider: model}});
  const submitted = await app.send(request('task.submit', {goal: 'test', conversationId: 'test'}, {idempotencyKey: 'task'}), signal());
  const taskId = submitted.data.taskId;
  await waitFor(() => app.activeTaskCount === 0);
  assert.equal(app.runtime.getTask(taskId).state, 'waiting_approval'); assert.equal(calls, 0);
  const approval = app.readEvents().find(event => event.type === 'approval.requested').payload;
  app.close();
  model = new FakeModelProvider([request => { assert.match(request.messages.at(-1).content, /42/); return {kind: 'final', text: 'verified fixture answer'}; }]);
  app = createRuntimeApplication({path, tools: [tool], text: {provider: model}});
  const allow = request('authorization.respond', {approvalId: approval.approvalId, decision: 'allow_once', expectedRevision: 1});
  assert.equal((await app.send(allow, signal())).outcome, 'ok');
  await waitFor(() => app.activeTaskCount === 0);
  assert.equal(app.runtime.getTask(taskId).state, 'succeeded'); assert.equal(calls, 1);
  assert.equal((await app.send(allow, signal())).outcome, 'ok');
  assert.equal(calls, 1); assert.equal(model.requests.length, 1);
  app.close();
});

test('approval denial never executes the connector', async () => {
  let calls = 0;
  const app = createRuntimeApplication({path: database(), tools: [{descriptor, execute: async () => { calls++; return {}; }}], text: {provider: new FakeModelProvider([proposal])}});
  await app.send(request('task.submit', {goal: 'deny', conversationId: 'test'}, {idempotencyKey: 'deny'}), signal());
  await waitFor(() => app.activeTaskCount === 0);
  const approval = app.readEvents().find(event => event.type === 'approval.requested').payload;
  assert.equal((await app.send(request('authorization.respond', {approvalId: approval.approvalId, decision: 'deny', expectedRevision: 1}), signal())).outcome, 'ok');
  assert.equal(app.runtime.getTask(approval.taskId).state, 'cancelled'); assert.equal(calls, 0);
  assert.equal(app.runtime.readEvidence(approval.taskId).length, 1);
  assert.equal(app.runtime.readToolExecutions(approval.taskId)[0].executionStarted, false);
  app.close();
});

test('expired approvals and conflicting revisions do not grant access; cancellation preserves the expired task', async () => {
  let now = new Date();
  const app = createRuntimeApplication({path: database(), now: () => now, tools: [{descriptor, execute: async () => ({})}], text: {provider: new FakeModelProvider([proposal])}});
  await app.send(request('task.submit', {goal: 'test', conversationId: 'test'}, {idempotencyKey: 'expire'}), signal());
  await waitFor(() => app.activeTaskCount === 0);
  const approval = app.readEvents().find(event => event.type === 'approval.requested').payload;
  assert.throws(() => app.resumeTask(approval.taskId), {code: 'UNAUTHORIZED'});
  assert.throws(() => app.runtime.respondApproval(approval.approvalId, 'allow_once', 0), {code: 'REVISION_CONFLICT'});
  now = new Date(Date.now() + 660_000);
  assert.throws(() => app.runtime.respondApproval(approval.approvalId, 'allow_once', 1), {code: 'TIMEOUT'});
  assert.equal(app.runtime.policy.get(approval.approvalId), undefined);
  const expired = app.runtime.getTask(approval.taskId);
  assert.equal(expired.state, 'failed');
  assert.equal(expired.error.code, 'TIMEOUT');
  assert.deepEqual(app.runtime.requestCancel(approval.taskId), {
    taskId: approval.taskId, state: 'failed', cancelAccepted: false,
  });
  assert.deepEqual(app.runtime.getTask(approval.taskId), expired);
  app.close();
});

test('Fake weather goes through Application, approval, gateway, evidence and final answer', async () => {
  const tools = [];
  const registration = register({register(tool) { tools.push(tool); return () => {}; }}, {provider: new FakeWeatherProvider()});
  const tool = tools[0].descriptor;
  const model = new FakeModelProvider([
    {kind: 'tool_proposal', proposal: {toolName: tool.name, toolVersion: tool.version, arguments: {location: 'Beijing', date: '2026-09-06'}}},
    request => { assert.equal(request.messages.at(-1).role, 'tool'); return {kind: 'final', text: '天气查询已返回，数据为测试夹具。'}; },
  ]);
  const app = createRuntimeApplication({path: database(), tools, text: {provider: model}});
  await app.send(request('task.submit', {goal: '北京天气', conversationId: 'weather'}, {idempotencyKey: 'weather'}), signal());
  await waitFor(() => app.activeTaskCount === 0);
  const approval = app.readEvents().find(event => event.type === 'approval.requested').payload;
  await app.send(request('authorization.respond', {approvalId: approval.approvalId, decision: 'allow_once', expectedRevision: 1}), signal());
  await waitFor(() => app.activeTaskCount === 0);
  const task = app.runtime.getTask(approval.taskId);
  assert.equal(task.state, 'succeeded'); assert.equal(task.evidenceRefs.length, 1);
  assert.equal(app.runtime.readToolExecutions(task.taskId)[0].state, 'confirmed');
  app.close(); registration();
});
