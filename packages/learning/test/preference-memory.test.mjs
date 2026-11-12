import assert from 'node:assert/strict';
import test from 'node:test';
import {consolidateFacts, learnPreference} from '../dist/index.js';

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
