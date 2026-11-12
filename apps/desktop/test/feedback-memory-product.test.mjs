import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createMemoryLearningHost} from '../electron/memory-learning-host.js';
import {memoryLearningControlsHtml, mountMemoryLearningControls} from '../src/features/admin/memory-learning-controls.js';

test('startup planning finds duplicates and consolidate withdraws only the older copy', async () => {
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
  const learned = await host.invoke('learning.feedback', {kind: 'correction', text: '回答短一些'});
  assert.equal(learned.count, 1);
  await host.invoke('learning.feedback', {kind: 'correction', text: '回答短一些'});
  assert.equal(host.snapshot().preferences.length, 1);
  const consolidated = await host.invoke('learning.consolidate');
  assert.deepEqual(withdrawn, [{id: 'old', revision: 1}]);
  assert.equal(consolidated.dropped[0].state, 'withdrawn');
  assert.equal(host.snapshot().duplicateCount, 0);
  host.close();
});

test('the existing memory panel records a correction and offers one consolidate action', async () => {
  const html = memoryLearningControlsHtml({status: {learningAvailable: true, preferences: [{kind: 'correction', text: '回答短一些'}], duplicateCount: 1}});
  assert.match(html, /纠正：回答短一些/);
  assert.match(html, /有 1 条重复记忆可整理/);
  assert.match(html, /data-ml-action="feedback"/);
  assert.match(html, /data-ml-action="consolidate"/);
  const calls = [];
  const fields = {workflow: 'reference-review', revision: '1', path: 'reference.md', summary: '摘要', feedback: '回答短一些'};
  let click;
  const root = {innerHTML: '', contains: () => true,
    querySelector: selector => ({value: fields[selector.match(/ml-(\w+)/)?.[1]] ?? ''}),
    addEventListener: (_name, handler) => { click = handler; }};
  const controls = mountMemoryLearningControls(root, {status: {learningAvailable: true, duplicateCount: 1}, refs: [], invoke: async (name, payload) => {
    calls.push({name, payload});
    if (name === 'learning.feedback') return {state: 'learned', count: 1};
    return {state: 'consolidated', dropped: [{id: 'old', state: 'withdrawn'}]};
  }});
  await click({target: {closest: () => ({dataset: {mlAction: 'feedback'}, disabled: false})}});
  await click({target: {closest: () => ({dataset: {mlAction: 'consolidate'}, disabled: false})}});
  assert.equal(calls[0].name, 'learning.feedback');
  assert.equal(calls[0].payload.text, '回答短一些');
  assert.equal(calls[1].name, 'learning.consolidate');
  assert.match(root.innerHTML, /已整理 1 条重复记忆/);
  controls.dispose();
});

test('learning actions still enter through the existing desktop action channel', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /name\.startsWith\('learning\.'\)/);
  assert.match(main, /memoryLearningHost\.invoke\(name,payload\)/);
  assert.match(main, /createMemoryLearningHost/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action'/);
});
