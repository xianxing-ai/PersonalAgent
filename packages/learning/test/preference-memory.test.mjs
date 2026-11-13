import assert from 'node:assert/strict';
import test from 'node:test';
import {consolidateFacts, formatPreferenceSystemPrompt, learnPreference, selectPromptPreferences, setPreferenceEnabled, withdrawPreference} from '../dist/index.js';

test('corrections are kept once and identical memories keep the newest revision', () => {
  const once = learnPreference([], {id: '1', kind: 'correction', text: '回答短一些', at: '2026-11-12T00:00:00.000Z'});
  const again = learnPreference(once, {id: '2', kind: 'correction', text: '回答短一些', at: '2026-11-12T00:00:01.000Z'});
  assert.equal(again.length, 1);
  const comment = learnPreference(again, {id: '3', kind: 'comment', text: '回答短一些', at: '2026-11-12T00:00:02.000Z'});
  assert.equal(comment.length, 2);
  const groups = consolidateFacts([
    {id: 'old', revision: 1, summary: '喜欢简短', state: 'active'},
    {id: 'new', revision: 3, summary: '喜欢简短', state: 'active'},
    {id: 'other', revision: 1, summary: '另一件事', state: 'active'},
    {id: 'gone', revision: 2, summary: '喜欢简短', state: 'withdrawn'},
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].keep.id, 'new');
  assert.deepEqual(groups[0].drop.map(item => item.id), ['old']);
});

test('prompt selection keeps relevant enabled notes and drops withdrawn ones', () => {
  const notes = [
    {id: 'general', kind: 'correction', text: '回答短一些', about: '', at: '2026-11-12T00:00:00.000Z', enabled: true, withdrawn: false},
    {id: 'weather', kind: 'correction', text: '天气用摄氏度', about: '天气', at: '2026-11-12T00:00:01.000Z', enabled: true, withdrawn: false},
    {id: 'code', kind: 'comment', text: '代码先写测试', about: '代码', at: '2026-11-12T00:00:02.000Z', enabled: true, withdrawn: false},
    {id: 'off', kind: 'correction', text: '多用列表', about: '', at: '2026-11-12T00:00:03.000Z', enabled: false, withdrawn: false},
    {id: 'gone', kind: 'correction', text: '不要表情', about: '', at: '2026-11-12T00:00:04.000Z', enabled: true, withdrawn: true},
  ];
  const selected = selectPromptPreferences(notes, '今天天气怎么样', 6);
  assert.deepEqual(selected.map(note => note.id), ['weather', 'general']);
  assert.equal(selectPromptPreferences(setPreferenceEnabled(notes, 'general', false), '今天天气怎么样').some(note => note.id === 'general'), false);
  assert.equal(selectPromptPreferences(withdrawPreference(notes, 'weather'), '今天天气怎么样').some(note => note.id === 'weather'), false);
  assert.throws(() => setPreferenceEnabled(withdrawPreference(notes, 'weather'), 'weather', true), /不能再注入/);
  const prompt = formatPreferenceSystemPrompt(selected);
  assert.match(prompt, /天气用摄氏度/);
  assert.match(prompt, /不是新的工具授权/);
  assert.doesNotMatch(prompt, /不要表情|多用列表|代码先写测试/);
  assert.equal(formatPreferenceSystemPrompt(withdrawPreference(notes, 'weather').filter(note => note.id === 'weather')), '');
});

test('withdrawn preferences do not crowd out the 30-item cap for active preferences', () => {
  let notes = [];
  for (let i = 1; i <= 5; i += 1) {
    notes = withdrawPreference(learnPreference(notes, {id: `w-${i}`, kind: 'correction', text: `已撤回-${i}`, at: '2026-11-12T00:00:00.000Z'}), `w-${i}`);
  }
  for (let i = 1; i <= 30; i += 1) {
    notes = learnPreference(notes, {id: `a-${i}`, kind: 'correction', text: `有效-${i}`, at: '2026-11-12T00:00:00.000Z'});
  }
  assert.equal(notes.filter(note => !note.withdrawn).length, 30);
  assert.equal(notes.filter(note => note.withdrawn).length, 5);
  assert.equal(notes.some(note => note.id === 'a-1'), true);
  notes = learnPreference(notes, {id: 'a-31', kind: 'correction', text: '有效-31', at: '2026-11-12T00:00:00.000Z'});
  assert.equal(notes.filter(note => !note.withdrawn).length, 30);
  assert.equal(notes.some(note => note.id === 'a-1'), false);
  assert.equal(notes.some(note => note.id === 'a-31'), true);
});
