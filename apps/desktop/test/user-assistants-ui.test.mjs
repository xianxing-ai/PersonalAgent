import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assistantThreadActionsHtml, bindAssistantThreadActions, mountAssistantRoster} from '../src/features/conversation/assistant-roster-ui.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

test('the roster saves a new assistant from name, description and optional model', async () => {
  const calls = [];
  const select = {tagName: 'SELECT', value: '', innerHTML: ''};
  const form = {hidden: true, dataset: {assistantCreateForm: ''}, displayName: {value: '笔记'}, instructions: {value: '整理会议'}, modelId: {value: 'deepseek-v4-flash'}, reset() { this.hidden = true; }};
  const cards = {innerHTML: '', addEventListener() {}};
  const status = {textContent: ''};
  let click, submit;
  const container = {
    classList: {add() {}}, innerHTML: '', contains: () => true,
    addEventListener(name, handler) { if (name === 'click') click = handler; if (name === 'submit') submit = handler; },
    querySelector(selector) {
      if (selector.includes('[name="modelId"]')) return select;
      if (selector.includes('create-form')) return form;
      if (selector.includes('assistant-cards')) return cards;
      if (selector.includes('form-status')) return status;
      return null;
    },
  };
  const roster = mountAssistantRoster(container, {
    invoke: async (name, payload) => { calls.push({name, payload}); return {assistantId: 'user-1'}; },
    escape, report() { throw Error('create should succeed'); }, onOpen(id) { calls.push({name: 'open', payload: id}); },
  });
  assert.match(container.innerHTML, /<select name="modelId">/);
  roster.paint([], {agentArtsModels: {catalog: {models: [{id: 'deepseek-v4-flash', displayName: 'DeepSeek V4', type: 'text', available: true}]}}});
  assert.match(select.innerHTML, /DeepSeek V4/);
  assert.match(container.innerHTML, /新建助手/);
  assert.doesNotMatch(container.innerHTML, /更多|刷新|收起/);
  await click({target: {closest: () => ({dataset: {assistantCreate: ''}})}});
  assert.equal(form.hidden, false);
  await submit({target: form, preventDefault() {}});
  assert.deepEqual(calls[0], {name: 'assistant.create', payload: {displayName: '笔记', instructions: '整理会议', modelId: 'deepseek-v4-flash'}});
  assert.equal(calls[1].payload, 'user-1');
  roster.paint([{assistantId: 'user-1', displayName: '笔记', instructions: '整理会议', status: 'idle', unreadCount: 0, origin: 'user'}]);
  assert.match(cards.innerHTML, /data-assistant-id="user-1"/);
  assert.equal(assistantThreadActionsHtml({origin: 'builtin', displayName: '编码助手'}), '');
  assert.match(assistantThreadActionsHtml({origin: 'user', displayName: '笔记'}), /data-assistant-delete/);
});

test('delete confirmation invokes assistant.delete only from the confirm control', async () => {
  const calls = [];
  const previous = globalThis.document;
  globalThis.document = {createElement(tag) {
    const node = {tag, dataset: {}, html: '',
      set innerHTML(value) { this.html = value; this.confirm = {onclick: null}; this.cancel = {onclick: null}; },
      querySelector(selector) {
        if (selector.includes('delete-confirm')) return this.confirm;
        if (selector.includes('delete-cancel') || selector.includes('rename-cancel')) return this.cancel;
        if (selector.includes('displayName')) return {value: '新名字'};
        if (selector.includes('instructions')) return {value: '新说明'};
        return null;
      },
      remove() {},
    };
    node.displayName = {value: '新名字'};
    node.instructions = {value: '新说明'};
    return node;
  }};
  const created = [];
  const buttons = {
    rename: {insertAdjacentElement(_position, node) { created.push(node); }, after(node) { created.push(node); }},
    remove: {insertAdjacentElement(_position, node) { created.push(node); }, after(node) { created.push(node); }},
  };
  const root = {
    querySelector(selector) {
      if (selector.includes('rename-form') || selector.includes('delete-ask') || selector.includes('delete-confirm')) return null;
      if (selector.includes('assistant-rename')) return buttons.rename;
      if (selector.includes('assistant-delete')) return buttons.remove;
      return null;
    },
  };
  try {
    bindAssistantThreadActions(root, {origin: 'user', assistantId: 'user-9', displayName: '笔记', instructions: '整理'}, {
      invoke: async (name, payload) => { calls.push({name, payload}); },
      escape, report(error) { throw error; }, onChanged() { calls.push({name: 'changed'}); }, onDeleted() { calls.push({name: 'deleted'}); },
    });
    buttons.remove.onclick();
    assert.equal(calls.length, 0);
    await created.at(-1).querySelector('[data-assistant-delete-confirm]').onclick();
    assert.deepEqual(calls[0], {name: 'assistant.delete', payload: {assistantId: 'user-9'}});
    assert.equal(calls[1].name, 'deleted');
    buttons.rename.onclick();
    await created.at(-1).onsubmit({preventDefault() {}});
    assert.equal(calls[2].name, 'assistant.rename');
    assert.equal(calls[2].payload.displayName, '新名字');
    assert.equal(calls[3].name, 'changed');
  } finally { globalThis.document = previous; }
});

test('create, rename and delete stay on the existing desktop action channel', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../src/app/renderer.js', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../src/features/workspace/view.js', import.meta.url), 'utf8');
  assert.match(main, /name === 'assistant.create'/);
  assert.match(main, /name === 'assistant.rename'/);
  assert.match(main, /name === 'assistant.delete'/);
  assert.match(main, /runtimeApplication\.createAssistant/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action'/);
  assert.match(renderer, /mountAssistantRoster/);
  assert.match(workspace, /bindAssistantThreadActions/);
  assert.match(workspace, /assistant\.submit/);
});
