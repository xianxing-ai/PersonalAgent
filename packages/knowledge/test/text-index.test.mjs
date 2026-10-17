import assert from 'node:assert/strict';
import test from 'node:test';
import {createTextIndex} from '../dist/text-index.js';

test('volatile full-text index preserves line order and truncation, replaces changed/moved/deleted pages', () => {
  const index = createTextIndex('vault'), check = () => {};
  const page = {path: 'a.md', revision: 'a'.repeat(64), content: 'Needle first\nneedle second'};
  let result = index.search([page], 'needle', 1, check);
  assert.equal(result.hits[0].source.line, 1); assert.equal(result.truncated, true);
  result = index.search([{...page, path: 'b.md'}], 'needle', 20, check);
  assert.ok(result.hits.every(hit => hit.source.path === 'b.md'));
  result = index.search([{...page, revision: 'b'.repeat(64), content: 'replacement'}], 'needle', 20, check);
  assert.deepEqual(result.hits, []);
  assert.deepEqual(index.search([], 'replacement', 20, check).hits, []);
  index.clear();
  assert.equal(index.search([page], 'needle', 20, check).hits.length, 2);
});

test('index over capacity or cancelled mid-search fails without a partial result and can rebuild', () => {
  const index = createTextIndex('vault');
  const page = {path: 'a.md', revision: 'a'.repeat(64), content: 'needle'};
  assert.throws(() => index.search([{...page, content: 'x'.repeat(8 * 1024 * 1024 + 1)}], 'x', 20, () => {}),
    error => error.code === 'LIMIT_EXCEEDED');
  let calls = 0;
  assert.throws(() => index.search([page], 'needle', 20, () => {if (++calls === 2) throw Error('cancelled');}), /cancelled/);
  assert.equal(index.search([page], 'needle', 20, () => {}).hits.length, 1);
});
