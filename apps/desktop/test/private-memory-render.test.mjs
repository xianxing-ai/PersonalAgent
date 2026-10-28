import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {adminAuxiliaryDocument,recordFollowingNodes} from '../test-support/admin-history-dom.mjs';
import {errorDisplayText} from '../src/shared/error-display.js';

const element = () => ({dataset: {}, listeners: new Map(), textContent: '', value: '', disabled: false,
  addEventListener(name, listener) {this.listeners.set(name, listener);}, setAttribute() {}, insertBefore() {},after:recordFollowingNodes,append:recordFollowingNodes});
async function harness(t, invoke) {
  const keys = ['window', 'document', 'matchMedia'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {for (const key of keys) {
    const original = originals.get(key);
    if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key];
  }});
  globalThis.window = {addEventListener() {}};
  globalThis.document = adminAuxiliaryDocument();
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
    knowledgeSource: {available: true},
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

test('Vault selection waits for its actual source host while saved memories remain readable',async t=>{
  const ui=await harness(t,async()=>({facts:[],hasMore:false}));
  const before={...ui.base,knowledgeSource:undefined,privateMemory:{...ui.base.privateMemory,vaultSelected:false}};
  ui.render(before);
  assert.match(ui.html(),/id="memory-select-vault" disabled/);
  assert.match(ui.html(),/受信知识源尚未就绪，请先检查模型与知识源配置/);
  assert.doesNotMatch(ui.html(),/id="memory-list-saved" disabled/);
  const replacements=ui.replacements();
  ui.render({...before,knowledgeSource:{available:false}});
  assert.ok(ui.replacements()>replacements,'The source host can become ready without changing the selected-Vault state');
  assert.doesNotMatch(ui.html(),/id="memory-select-vault" disabled/);
  assert.doesNotMatch(ui.html(),/受信知识源尚未就绪，请先检查模型与知识源配置/);
});

test('actual Main refuses a missing source host with an actionable fixed configuration reason',async()=>{
  const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let branch;
  function visit(node){if(ts.isIfStatement(node)&&node.expression.getText(ast).includes("name.startsWith('memory.')"))branch=node.getText(ast);
    ts.forEachChild(node,visit);}
  visit(ast);assert.ok(branch);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const invoke=new AsyncFunction('context','name','payload','sender','with(context){'+branch+'}');
  const admin={},context={admin,competitionMode:true,runtimeApplication:{},knowledgeSourceConfig:undefined,
    knowledgeSourceNotReadyMessage:'受信知识源尚未就绪，请先检查模型与知识源配置'};
  await assert.rejects(()=>invoke(context,'memory.selectVault',undefined,admin),error=>{
    const message=errorDisplayText(error,'ipc');
    assert.match(message,/^受信知识源尚未就绪，请先检查模型与知识源配置 \[stage=ipc; code=CONFIGURATION\]$/);return true;
  });
  const tainted=errorDisplayText(Error('受信知识源尚未就绪，请先检查模型与知识源配置 /private/Vault/SYNTHETIC_PRIVATE_DETAIL'),'ipc');
  assert.match(tainted,/code=CONFIGURATION/);assert.doesNotMatch(tainted,/SYNTHETIC_PRIVATE_DETAIL|\/private/);
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
