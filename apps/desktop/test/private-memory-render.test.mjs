import test from 'node:test';
import assert from 'node:assert/strict';

const element = () => ({dataset: {}, listeners: new Map(), textContent: '', value: '', disabled: false,
  addEventListener(name, listener) {this.listeners.set(name, listener);}, setAttribute() {}, insertBefore() {}});
async function harness(t, invoke) {
  const keys = ['window', 'document', 'matchMedia'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {for (const key of keys) {
    const original = originals.get(key);
    if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key];
  }});
  globalThis.window = {addEventListener() {}};
  globalThis.document = {createElement: element};
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}});
  const nodes = new Map(['.admin-bar', '#admin-close', 'nav', '#admin-search', '.main',
    '#page-title', '#connection', '#content', '#error'].map(key => [key, element()]));
  let html = '', memoryNodes = new Map(), replacements = 0;
  Object.defineProperty(nodes.get('#content'), 'innerHTML', {get: () => html, set(value) {
    html = value; replacements++; memoryNodes = new Map();
    for (const match of value.matchAll(/id="(memory-[^"]+)"/g)) memoryNodes.set('#' + match[1], element());
    for (const match of value.matchAll(/data-memory-summary="(\d+)"/g)) {
      const input = element(); input.dataset.memorySummary = match[1];
      memoryNodes.set('[data-memory-summary="' + match[1] + '"]', input);
    }
  }});
  const root = {innerHTML: '', querySelector: key => memoryNodes.get(key) ?? nodes.get(key) ?? null,
    querySelectorAll: key => key === '[data-memory-summary]'
      ? [...memoryNodes.entries()].filter(([key]) => key.startsWith('[data-memory-summary')).map(([, node]) => node) : []};
  const {mountAdmin} = await import('../src/features/admin/view.js');
  const render = mountAdmin(root, invoke, value => String(value ?? ''));
  const base = {tasks: [], approvals: [], capabilities: [], health: [], connection: 'fixture',
    adminNavigation: {page: 'memory', revision: 1},
    privateMemory: {available: true, vaultSelected: true, writeEnabled: true}};
  return {render, base, root, html: () => html, replacements: () => replacements};
}

test('unrelated host updates preserve memory query, summary nodes and their input listeners', async t => {
  const ui = await harness(t, async name => {
    assert.equal(name, 'memory.search');
    return {hits: [{excerpt: 'Synthetic excerpt', source: {path: 'fixture.md', line: 1}}], truncated: false};
  });
  ui.render(ui.base);
  ui.root.querySelector('#memory-query').value = 'fixture';
  await ui.root.querySelector('#memory-search-form').listeners.get('submit')({preventDefault() {}});
  const query = ui.root.querySelector('#memory-query');
  const summary = ui.root.querySelector('[data-memory-summary="0"]');
  query.value = 'unfinished query'; summary.value = 'unfinished summary';
  summary.listeners.get('input')();
  const before = ui.replacements();
  ui.render({...ui.base, connection: 'new health', tasks: [{taskId: 'unrelated'}]});
  assert.equal(ui.replacements(), before);
  assert.equal(ui.root.querySelector('#memory-query'), query);
  assert.equal(ui.root.querySelector('[data-memory-summary="0"]'), summary);
  assert.equal(query.value, 'unfinished query'); assert.equal(summary.value, 'unfinished summary');
  ui.render({...ui.base, privateMemory: {...ui.base.privateMemory, writeEnabled: false}});
  assert.ok(ui.replacements() > before);
  assert.match(ui.html(), /data-memory-save="0" disabled/);
});

test('pending Vault selection stays disabled across host ticks and cancellation restores the control', async t => {
  let release;
  const ui = await harness(t, () => new Promise(resolve => {release = resolve;}));
  ui.render(ui.base);
  const button = ui.root.querySelector('#memory-select-vault');
  const operation = button.listeners.get('click')({currentTarget: button});
  assert.equal(button.disabled, true);
  ui.render({...ui.base, connection: 'host tick'});
  assert.equal(ui.root.querySelector('#memory-select-vault'), button);
  assert.equal(button.disabled, true);
  release({selected: false}); await operation;
  assert.equal(ui.root.querySelector('#memory-select-vault').disabled, false);
});

test('Vault selection failure restores its button after the DOM event currentTarget is cleared', async t => {
  let reject;
  const ui = await harness(t, () => new Promise((_, fail) => {reject = fail;}));
  ui.render(ui.base);
  const button = ui.root.querySelector('#memory-select-vault');
  const event = {currentTarget: button};
  const operation = button.listeners.get('click')(event);
  event.currentTarget = null;
  reject(Error('Synthetic selection failure'));
  await operation;
  assert.equal(button.disabled, false);
  assert.equal(ui.root.querySelector('#error').textContent, 'Synthetic selection failure');
});
