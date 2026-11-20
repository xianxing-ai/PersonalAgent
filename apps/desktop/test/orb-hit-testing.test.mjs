import test from 'node:test';
import assert from 'node:assert/strict';
import {orbShapeRects} from '../electron/orb-hit-testing.js';

test('the native orb region includes its core and surrounding particles while the corners pass through', () => {
  const rects = orbShapeRects(112, 112);
  const hits = (x, y) => rects.some(rect =>
    x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);
  assert.equal(hits(56, 56), true);
  for (const point of [[56, 4], [56, 107], [4, 56], [107, 56]]) assert.equal(hits(...point), true);
  for (const point of [[8, 8], [103, 8], [8, 103], [103, 103]]) assert.equal(hits(...point), false);
});
