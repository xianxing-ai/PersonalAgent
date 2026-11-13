import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createMemoryLearningHost} from '../electron/memory-learning-host.js';
import {memoryLearningControlsHtml, mountMemoryLearningControls} from '../src/features/admin/memory-learning-controls.js';

test('startup planning finds duplicates without auto-withdrawing and confirms one item at a time', async () => {
  const facts = [
    {ref: {id: 'old', revision: 1}, summary: '喜欢简短', state: 'active'},
    {ref: {id: 'new', revision: 3}, summary: '喜欢简短', state: 'active'},
  ];
  const withdrawn = [];
  const host = createMemoryLearningHost({
    profile: 'huawei_ict_agentarts',
    managedPrivateCopies: [],
    privateMemory: {
      configurationRevision: 1,
      prepareWrite() {},
      async listSaved() { return {facts: facts.filter(fact => fact.state === 'active')}; },
      async withdraw(ref) {
        withdrawn.push(ref);
        const fact = facts.find(item => item.ref.id === ref.id);
        if (fact) fact.state = 'withdrawn';
        return {state: 'withdrawn', revision: ref.revision};
      },
    },
  });
  await host.planDuplicates();
  assert.equal(host.snapshot().duplicateCount, 1);
  assert.deepEqual(host.snapshot().duplicateSuggestions, [{keep: {id: 'new', revision: 3}, drop: [{id: 'old', revision: 1}]}]);
  const learned = await host.invoke('learning.feedback', {kind: 'correction', text: '回答短一些'});
  assert.equal(learned.count, 1);
  await host.invoke('learning.feedback', {kind: 'correction', text: '回答短一些'});
  assert.equal(host.snapshot().preferences.length, 1);
  const planned = await host.invoke('learning.consolidate');
  assert.equal(planned.state, 'planned');
  assert.equal(planned.duplicateCount, 1);
  assert.deepEqual(withdrawn, []);
  const confirmed = await host.invoke('learning.confirmConsolidate', {ref: {id: 'old', revision: 1}});
  assert.deepEqual(withdrawn, [{id: 'old', revision: 1}]);
  assert.equal(confirmed.state, 'withdrawn');
  assert.equal(host.snapshot().duplicateCount, 0);
  host.close();
});

test('the existing memory panel lists duplicate suggestions and confirms withdrawal per item', async () => {
  const html = memoryLearningControlsHtml({status: {learningAvailable: true, preferences: [{kind: 'correction', text: '回答短一些'}], duplicateCount: 1,
    duplicateSuggestions: [{keep: {id: 'new', revision: 3}, drop: [{id: 'old', revision: 1}]}]}});
  assert.match(html, /纠正：回答短一些/);
  assert.match(html, /有 1 条重复记忆可整理/);
  assert.match(html, /data-ml-action="feedback"/);
  assert.match(html, /data-ml-action="consolidate"/);
  assert.match(html, /data-ml-consolidate-id="old"/);
  const calls = [];
  const fields = {workflow: 'reference-review', revision: '1', path: 'reference.md', summary: '摘要', feedback: '回答短一些'};
  let click;
  const root = {innerHTML: '', contains: () => true,
    querySelector: selector => ({value: fields[selector.match(/ml-(\w+)/)?.[1]] ?? ''}),
    addEventListener: (_name, handler) => { click = handler; }};
  const controls = mountMemoryLearningControls(root, {status: {learningAvailable: true, duplicateCount: 1}, refs: [], invoke: async (name, payload) => {
    calls.push({name, payload});
    if (name === 'learning.feedback') return {state: 'learned', count: 1};
    if (name === 'learning.consolidate') return {state: 'planned', duplicateCount: 1, suggestions: [{keep: {id: 'new', revision: 3}, drop: [{id: 'old', revision: 1}]}]};
    return {state: 'withdrawn', revision: 1, suggestions: []};
  }});
  await click({target: {closest: () => ({dataset: {mlAction: 'feedback'}, disabled: false})}});
  await click({target: {closest: () => ({dataset: {mlAction: 'consolidate'}, disabled: false})}});
  assert.match(root.innerHTML, /已列出 1 条重复记忆建议/);
  await click({target: {closest: () => ({dataset: {mlConsolidateId: 'old', mlConsolidateRevision: '1'}, disabled: false})}});
  assert.equal(calls[0].name, 'learning.feedback');
  assert.equal(calls[0].payload.text, '回答短一些');
  assert.equal(calls[1].name, 'learning.consolidate');
  assert.equal(calls[2].name, 'learning.confirmConsolidate');
  assert.deepEqual(calls[2].payload, {ref: {id: 'old', revision: 1}});
  assert.match(root.innerHTML, /已撤回，后续任务不可消费/);
  controls.dispose();
});

test('confirmed preferences enter the prompt, and a withdrawn one cannot return', async () => {
  const saved = [];
  const host = createMemoryLearningHost({
    profile: 'huawei_ict_agentarts',
    managedPrivateCopies: [],
    preferenceStore: {load: () => saved, save(notes) { saved.splice(0, saved.length, ...notes); }},
    privateMemory: {configurationRevision: 1, prepareWrite() {}, async listSaved() { return {facts: []}; }, async withdraw() { return {state: 'withdrawn'}; }},
  });
  await host.invoke('learning.feedback', {kind: 'correction', text: '天气用摄氏度', about: '天气'});
  await host.invoke('learning.feedback', {kind: 'correction', text: '回答短一些'});
  assert.match(host.preferencePrompt('今天天气'), /天气用摄氏度/);
  assert.match(host.preferencePrompt('今天天气'), /回答短一些/);
  assert.doesNotMatch(host.preferencePrompt('今天天气'), /代码/);
  const active = host.snapshot().preferences.find(note => note.text === '天气用摄氏度');
  await host.invoke('learning.preference.disable', {id: active.id});
  assert.doesNotMatch(host.preferencePrompt('今天天气'), /天气用摄氏度/);
  await host.invoke('learning.preference.withdraw', {id: active.id});
  await assert.rejects(host.invoke('learning.preference.enable', {id: active.id}), /不能再注入/);
  assert.doesNotMatch(host.preferencePrompt('今天天气'), /天气用摄氏度/);
  const reloaded = createMemoryLearningHost({
    profile: 'huawei_ict_agentarts',
    managedPrivateCopies: [],
    preferenceStore: {load: () => saved, save() {}},
    privateMemory: {configurationRevision: 1, prepareWrite() {}, async listSaved() { return {facts: []}; }},
  });
  assert.equal(reloaded.snapshot().preferences.find(note => note.id === active.id).withdrawn, true);
  assert.doesNotMatch(reloaded.preferencePrompt('今天天气'), /天气用摄氏度/);
  host.close();
  reloaded.close();
});

test('the memory panel shows the active preference and can turn it off', async () => {
  const html = memoryLearningControlsHtml({status: {preferences: [{id: 'p1', kind: 'correction', text: '回答短一些', enabled: true, active: true}]}});
  assert.match(html, /正在生效/);
  assert.match(html, /data-ml-preference="p1"/);
  assert.match(html, /data-ml-preference-action="disable"/);
  const calls = [];
  let click;
  const root = {innerHTML: '', contains: () => true, querySelector: () => ({value: ''}), addEventListener: (_name, handler) => { click = handler; }};
  const controls = mountMemoryLearningControls(root, {status: {preferences: [{id: 'p1', kind: 'correction', text: '回答短一些', enabled: true, active: true}]}, refs: [], invoke: async (name, payload) => {
    calls.push({name, payload});
    return {preferences: [{id: 'p1', kind: 'correction', text: '回答短一些', enabled: false, active: false}]};
  }});
  await click({target: {closest: () => ({dataset: {mlPreference: 'p1', mlPreferenceAction: 'disable'}, disabled: false})}});
  assert.deepEqual(calls[0], {name: 'learning.preference.disable', payload: {id: 'p1'}});
  assert.match(root.innerHTML, /已关掉/);
  controls.dispose();
});

test('learning actions still enter through the existing desktop action channel', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /name\.startsWith\('learning\.'\)/);
  assert.match(main, /memoryLearningHost\.invoke\(name,payload\)/);
  assert.match(main, /createMemoryLearningHost/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action'/);
  assert.match(main, /readPromptPreferences/);
  assert.match(main, /filePreferenceStore/);
  assert.match(main, /preferencePrompt/);
  assert.match(main, /privateConsumption\.assertCloudSend\(request,\s*scope\)/);
});

test('confirming duplicate consolidation never withdraws matching preferences and sendGoal passes privateConsumption check', async () => {
  const facts = [
    {ref: {id: 'old', revision: 1}, summary: '喜欢简短', state: 'active'},
    {ref: {id: 'new', revision: 3}, summary: '喜欢简短', state: 'active'},
  ];
  const host = createMemoryLearningHost({
    profile: 'huawei_ict_agentarts',
    managedPrivateCopies: [],
    privateMemory: {
      configurationRevision: 1,
      prepareWrite() {},
      async listSaved() { return {facts: facts.filter(fact => fact.state === 'active')}; },
      async withdraw(ref) {
        const fact = facts.find(item => item.ref.id === ref.id);
        if (fact) fact.state = 'withdrawn';
        return {state: 'withdrawn', revision: ref.revision};
      },
    },
  });
  await host.invoke('learning.feedback', {kind: 'correction', text: '喜欢简短'});
  await host.invoke('learning.consolidate');
  await host.invoke('learning.confirmConsolidate', {ref: {id: 'old', revision: 1}});
  assert.equal(host.snapshot().preferences[0].withdrawn, false);
  host.close();
});
