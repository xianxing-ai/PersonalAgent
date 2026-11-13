import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDryRunProduct, isHighRiskTool, verifyToolResult} from '../electron/dry-run-product.js';
import {renderDryRun} from '../src/features/workspace/dry-run-status.js';

function tool(name, sideEffect, execute) {
  return {descriptor: {name, sideEffect}, execute};
}
const context = () => ({taskId: 'task-1', deadline: new Date(Date.now() + 5_000).toISOString(), signal: new AbortController().signal});

test('a high-risk send waits for the preview and then verifies the tool result', async () => {
  assert.equal(isHighRiskTool({name: 'workspace.custom_action', sideEffect: 'local_write'}), true);
  assert.equal(isHighRiskTool({name: 'mail.compose_draft', sideEffect: 'external_write'}), true);
  assert.equal(isHighRiskTool({name: 'mail.reconcile_send', sideEffect: 'external_write'}), false);
  assert.equal(isHighRiskTool({name: 'mail.inbox', sideEffect: 'read'}), false);

  const calls = [];
  const product = createDryRunProduct();
  const [send, read] = product.wrapTools([
    tool('mail.send', 'external_write', async () => { calls.push('send'); return {id: 'sent-1'}; }),
    tool('mail.inbox', 'read', async () => { calls.push('read'); return {id: 'm1'}; }),
  ]);
  assert.deepEqual(await read.execute({}, context()), {id: 'm1'});
  const running = send.execute({to: 'person'}, context());
  const preview = product.snapshot().pending[0];
  assert.match(preview.summary, /发送操作/);
  assert.doesNotMatch(preview.summary, /mail\.send/);
  assert.equal(preview.argumentKeys.includes('to'), true);
  assert.doesNotMatch(JSON.stringify(preview), /person/);
  assert.deepEqual(calls, ['read']);
  product.handleAction('dryRun.confirm', {id: preview.id});
  assert.deepEqual(await running, {id: 'sent-1'});
  assert.deepEqual(calls, ['read', 'send']);
  assert.match(product.snapshot().recent.at(-1).reason, /未做外部系统读回/);
});

test('a failed, pending or unknown verification never passes and does not retry the side effect', async () => {
  assert.equal(verifyToolResult({state: 'pending'}).ok, false);
  assert.equal(verifyToolResult({state: 'unknown'}).ok, false);
  assert.equal(verifyToolResult({status: 'pending'}).ok, false);
  assert.equal(verifyToolResult({status: 'unknown'}).ok, false);

  let count = 0;
  const product = createDryRunProduct();
  const [pay] = product.wrapTools([tool('wallet.pay', 'external_write', async () => { count += 1; return {state: 'unknown'}; })]);
  const running = pay.execute({}, context());
  product.handleAction('dryRun.confirm', {id: product.snapshot().pending[0].id});
  await assert.rejects(running, /操作可能已经发生/);
  assert.equal(count, 1);
});

test('cancellation before confirmation does not run the tool', async () => {
  const controller = new AbortController();
  let count = 0;
  const product = createDryRunProduct();
  const [remove] = product.wrapTools([tool('files.delete', 'external_write', async () => { count += 1; return {removed: true}; })]);
  const running = remove.execute({}, {...context(), signal: controller.signal});
  controller.abort();
  await assert.rejects(running, /未执行/);
  assert.equal(count, 0);
  assert.equal(product.snapshot().pending.length, 0);
});

test('the workspace line confirms or cancels the pending preview without showing English tool names', () => {
  const created = [];
  const original = globalThis.document;
  globalThis.document = {createElement(tag) {
    const node = {tag, textContent: '', type: '', hidden: false, children: [], dataset: {}};
    node.append = (...children) => node.children.push(...children);
    node.replaceChildren = () => { node.children = []; };
    created.push(node);
    return node;
  }};
  try {
    const node = document.createElement('div');
    const calls = [];
    renderDryRun(node, {pending: [{id: 'preview-1', summary: '将执行发送操作（包含 1 项参数）。尚未产生实际写入或外部副作用。'}], recent: []}, (name, payload) => calls.push({name, payload}));
    assert.equal(node.hidden, false);
    assert.equal(node.children[1].textContent, '按预览执行');
    assert.equal(node.children[2].textContent, '取消预览');
    node.children[1].onclick();
    node.children[2].onclick();
    assert.deepEqual(calls, [
      {name: 'dryRun.confirm', payload: {id: 'preview-1'}},
      {name: 'dryRun.cancel', payload: {id: 'preview-1'}},
    ]);
    renderDryRun(node, {pending: [], recent: [{toolName: 'mail.send', label: '发送操作', reason: '已核对'}]}, () => {});
    assert.doesNotMatch(node.children[0].textContent, /mail\.send/);
    assert.match(node.children[0].textContent, /发送操作/);
  } finally {
    if (original) globalThis.document = original;
    else delete globalThis.document;
  }
});

test('startup wraps tools and preload still carries desktop actions', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /dryRun=createDryRunProduct/);
  assert.match(main, /beforeToolAuthorize: input => dryRun\?\.beforeAuthorize\(input\)/);
  assert.match(main, /assertToolPrechecked: input => dryRun\?\.assertAuthorized\(input\)/);
  assert.match(main, /dryRun\.wrapTools\(conversationTools\)/);
  assert.match(main, /name === 'dryRun\.confirm' \|\| name === 'dryRun\.cancel'/);
  assert.match(main, /dryRun:dryRun\?\.snapshot\(\)/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action'/);
});

test('cancelling preview stops before RuntimeApplication requests Policy authorization', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pa-dryrun-'));
  t.after(() => rm(dir, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}));
  let authCalls = 0;
  let executions = 0;
  const dryRun = createDryRunProduct();
  const writeTool = {
    descriptor: {
      name: 'notepad.save_note', version: '1.0.0',
      inputSchema: {type: 'object', additionalProperties: false, properties: {text: {type: 'string'}}},
      outputSchema: {type: 'object', additionalProperties: false, properties: {saved: {type: 'boolean'}}},
      sideEffect: 'local_write', requiredScopes: ['notepad:write'], idempotencySupport: true, recoverySupport: true, requiresPresence: false,
    },
    execute: async () => { executions += 1; return {saved: true}; },
  };
  const app = createRuntimeApplication({
    path: path.join(dir, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts',
    tools: dryRun.wrapTools([writeTool]),
    beforeToolAuthorize: input => dryRun.beforeAuthorize(input),
    assertToolPrechecked: input => dryRun.assertAuthorized(input),
    requestToolAuthorization: async () => { authCalls += 1; return 'allow_once'; },
    requiresToolAuthorization: () => true,
    competitionToolAvailability: [{toolName: 'notepad.save_note', toolVersion: '1.0.0', available: () => true}],
    competitionToolExports: [{toolName: 'notepad.save_note', toolVersion: '1.0.0', exportPolicyVersion: 'public-v1', accepts: () => true, project: ({result}) => result}],
    coordination: {
      execute: async () => ({kind: 'tool_proposal', proposalId: 'p-1', toolName: 'notepad.save_note', toolVersion: '1.0.0', arguments: {text: 'hi'}, verification: 'unverified'}),
    },
  });
  try {
    const client = new Client(app);
    await client.connect();
    const submitted = await client.call('task.submit', {goal: '保存一条笔记', conversationId: 'c-dryrun'}, {idempotencyKey: 'dry-cancel-1'});
    const started = Date.now();
    while (dryRun.snapshot().pending.length === 0 && Date.now() - started < 3000) {
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    const preview = dryRun.snapshot().pending[0];
    assert.ok(preview);
    dryRun.handleAction('dryRun.cancel', {id: preview.id});
    while (app.activeTaskCount > 0 && Date.now() - started < 3000) {
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    assert.equal(authCalls, 0);
    assert.equal(executions, 0);
    assert.equal(app.runtime.listApprovals({taskId: submitted.taskId}).items.length, 0);
  } finally {
    app.close();
  }
});
