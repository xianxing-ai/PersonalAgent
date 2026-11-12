import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createDryRunProduct} from '../electron/dry-run-product.js';
import {renderDryRun} from '../src/features/workspace/dry-run-status.js';

function tool(name, sideEffect, execute) {
  return {descriptor: {name, sideEffect}, execute};
}
const context = () => ({taskId: 'task-1', deadline: new Date(Date.now() + 5_000).toISOString(), signal: new AbortController().signal});

test('a high-risk send waits for the preview and then verifies the tool result', async () => {
  const calls = [];
  const product = createDryRunProduct();
  const [send, read] = product.wrapTools([
    tool('mail.send', 'external_write', async () => { calls.push('send'); return {id: 'sent-1'}; }),
    tool('mail.inbox', 'read', async () => { calls.push('read'); return {id: 'm1'}; }),
  ]);
  assert.deepEqual(await read.execute({}, context()), {id: 'm1'});
  const running = send.execute({to: 'person'}, context());
  const preview = product.snapshot().pending[0];
  assert.match(preview.summary, /将执行 mail\.send/);
  assert.equal(preview.argumentKeys.includes('to'), true);
  assert.doesNotMatch(JSON.stringify(preview), /person/);
  assert.deepEqual(calls, ['read']);
  product.handleAction('dryRun.confirm', {id: preview.id});
  assert.deepEqual(await running, {id: 'sent-1'});
  assert.deepEqual(calls, ['read', 'send']);
  assert.match(product.snapshot().recent.at(-1).reason, /未做外部系统读回/);
});

test('a failed verification does not retry the side effect', async () => {
  let count = 0;
  const product = createDryRunProduct();
  const [pay] = product.wrapTools([tool('wallet.pay', 'external_write', async () => { count += 1; return {ok: false}; })]);
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

test('the workspace line confirms the pending preview through the same action', () => {
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
    renderDryRun(node, {pending: [{id: 'preview-1', summary: '将执行 mail.send，参数字段 to。尚未产生外部副作用。'}], recent: []}, (name, payload) => calls.push({name, payload}));
    assert.equal(node.hidden, false);
    node.children[1].onclick();
    assert.deepEqual(calls, [{name: 'dryRun.confirm', payload: {id: 'preview-1'}}]);
  } finally {
    if (original) globalThis.document = original;
    else delete globalThis.document;
  }
});

test('startup wraps tools and preload still carries desktop actions', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /dryRun=createDryRunProduct/);
  assert.match(main, /dryRun\.wrapTools\(conversationTools\)/);
  assert.match(main, /name === 'dryRun\.confirm'/);
  assert.match(main, /dryRun:dryRun\?\.snapshot\(\)/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action'/);
});
