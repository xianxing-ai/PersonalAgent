import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assistantThreadActionsHtml, bindAssistantThreadActions, mountAssistantRoster} from '../src/features/conversation/assistant-roster-ui.js';
import {answerCardHtml, rememberActivity, replaceAnswerCard, syncContainerAnswerDisclosures} from '../src/features/conversation/answer-block.js';

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

test('streaming increments preserve expanded thinking/tool disclosures and summary focus across replaceAnswerCard and snapshot re-renders', () => {
  function parseCard(html, doc) {
    const detailsList = [];
    const detailsRegex = /<details class="([^"]+)" data-disclosure-key="([^"]+)"( open)?><summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
    let match;
    while ((match = detailsRegex.exec(html)) !== null) {
      const [, className, key, openAttr] = match;
      const summary = {
        focus() { doc.activeElement = this; },
        closest(selector) { return selector.includes('details[data-disclosure-key]') ? detailsNode : null; },
      };
      const detailsNode = {
        className,
        open: Boolean(openAttr),
        dataset: {disclosureKey: key},
        hasAttribute(attr) { return attr === 'open' ? this.open : false; },
        setAttribute(attr) { if (attr === 'open') this.open = true; },
        querySelector(selector) { return selector === 'summary' ? summary : null; },
        closest(selector) { return selector.includes('details[data-disclosure-key]') ? this : null; },
      };
      detailsList.push(detailsNode);
    }
    const taskIdMatch = /data-answer-for="([^"]*)"/.exec(html);
    const card = {
      html,
      dataset: {answerFor: taskIdMatch?.[1] ?? ''},
      detailsList,
      contains(target) { return detailsList.some(d => d === target || d.querySelector('summary') === target); },
      querySelectorAll(selector) {
        if (selector === 'details[data-disclosure-key]') return detailsList;
        return [];
      },
      replaceWith(next) {
        this.replacedBy = next;
        if (container.currentCard === this) container.currentCard = next;
      },
    };
    return card;
  }

  const doc = {
    activeElement: null,
    createElement() {
      return {
        _html: '',
        set innerHTML(value) {
          this._html = value;
          this.firstElementChild = parseCard(value, doc);
        },
      };
    },
  };
  const container = {
    currentCard: null,
    querySelectorAll(selector) {
      if (selector === '[data-answer-for]') return this.currentCard ? [this.currentCard] : [];
      return [];
    },
  };

  const store = new Map();
  const task = {taskId: 'task-stream-1', state: 'running'};
  rememberActivity(store, {taskId: 'task-stream-1', kind: 'reasoning', text: '第一步思考'});
  rememberActivity(store, {taskId: 'task-stream-1', kind: 'tool_call', stepId: 'step-a', label: '读取文件', argsSummary: 'README.md'});

  container.currentCard = parseCard(answerCardHtml(task, store.get('task-stream-1'), escape), doc);
  const initialThinking = container.currentCard.detailsList.find(d => d.dataset.disclosureKey === 'thinking');
  const initialStep = container.currentCard.detailsList.find(d => d.dataset.disclosureKey === 'step:step-a');
  assert.equal(initialThinking.open, false);
  assert.equal(initialStep.open, false);

  // User opens thinking and step-a, and focuses step-a's summary
  initialThinking.open = true;
  initialStep.open = true;
  initialStep.querySelector('summary').focus();

  // Next streaming increments arrive
  rememberActivity(store, {taskId: 'task-stream-1', kind: 'reasoning', text: '，继续推导'});
  replaceAnswerCard(container.currentCard, task, store.get('task-stream-1'), escape, doc);

  const afterReasoningThinking = container.currentCard.detailsList.find(d => d.dataset.disclosureKey === 'thinking');
  const afterReasoningStep = container.currentCard.detailsList.find(d => d.dataset.disclosureKey === 'step:step-a');
  assert.equal(afterReasoningThinking.open, true, 'thinking disclosure stays open across reasoning delta');
  assert.equal(afterReasoningStep.open, true, 'tool step disclosure stays open across reasoning delta');
  assert.equal(doc.activeElement, afterReasoningStep.querySelector('summary'), 'focus stays on the active tool step summary');

  rememberActivity(store, {taskId: 'task-stream-1', kind: 'tool_result', stepId: 'step-a', resultSummary: '成功', durationMs: 18});
  rememberActivity(store, {taskId: 'task-stream-1', kind: 'answer_delta', text: '最终回答片段'});
  replaceAnswerCard(container.currentCard, task, store.get('task-stream-1'), escape, doc);

  assert.equal(container.currentCard.detailsList.find(d => d.dataset.disclosureKey === 'thinking').open, true);
  assert.equal(container.currentCard.detailsList.find(d => d.dataset.disclosureKey === 'step:step-a').open, true);
  assert.equal(doc.activeElement, container.currentCard.detailsList.find(d => d.dataset.disclosureKey === 'step:step-a').querySelector('summary'));

  // Even a full snapshot re-render via answerCardHtml preserves open disclosures synced from the container
  syncContainerAnswerDisclosures(container, store);
  const snapshotHtml = answerCardHtml(task, store.get('task-stream-1'), escape);
  assert.match(snapshotHtml, /<details class="thinking-block" data-disclosure-key="thinking" open>/);
  assert.match(snapshotHtml, /<details class="tool-step" data-disclosure-key="step:step-a" open>/);
});
