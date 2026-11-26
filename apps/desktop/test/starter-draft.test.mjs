import assert from 'node:assert/strict';
import test from 'node:test';
import {createStarterDraft} from '../src/features/conversation/starter-draft.js';

test('only the untouched card inserted in this conversation may be replaced', () => {
  const input = Object.assign(new EventTarget(), {
    value:'手写草稿\n今日计划', focus() {}, setSelectionRange() {},
  });
  const starters = createStarterDraft(input);
  starters.select('写周报');
  assert.equal(input.value, '手写草稿\n今日计划\n写周报');
  starters.select('看订阅');
  starters.select('看订阅');
  assert.equal(input.value, '手写草稿\n今日计划\n看订阅');

  // Even edits that restore the original text release the inserted card.
  input.value += '。';
  input.dispatchEvent(new Event('input'));
  input.value = input.value.slice(0, -1);
  input.dispatchEvent(new Event('input'));
  starters.select('写周报');
  assert.equal(input.value, '手写草稿\n今日计划\n看订阅\n写周报');

  // Another conversation can restore a byte-identical draft.
  starters.reset();
  starters.select('今日计划');
  assert.equal(input.value, '手写草稿\n今日计划\n看订阅\n写周报\n今日计划');
});
