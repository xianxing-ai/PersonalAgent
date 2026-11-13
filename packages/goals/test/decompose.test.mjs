import assert from 'node:assert/strict';
import test from 'node:test';
import {decomposeGoal} from '../dist/index.js';

test('a multi-part goal becomes ordered subtasks with existing roles', () => {
  const steps = decomposeGoal('先收集材料；再写出提纲；最后复核');
  assert.deepEqual(steps.map(step => step.assignee), ['plan', 'fast', 'review']);
  assert.deepEqual(steps.map(step => step.summary), ['先收集材料', '再写出提纲', '最后复核']);
  assert.equal(decomposeGoal('只做一件事').length, 1);
  assert.throws(() => decomposeGoal('  '), /Invalid goal summary/);
});
