import assert from 'node:assert/strict';
import test from 'node:test';
import {appendAudit, verifyAudit} from '../dist/index.js';

const at = '2026-11-12T00:00:00.000Z';

test('each record links to the previous hash', () => {
  const first = appendAudit([], {at, action: 'read', subject: 'permissions'});
  const second = appendAudit(first, {at, action: 'revoke', subject: 'rule:one'});
  assert.equal(verifyAudit(second).intact, true);
  assert.equal(second[1].prev, second[0].hash);
  assert.notEqual(second[0].hash, second[1].hash);
});

test('changing an earlier record stays visible and blocks another append', () => {
  const events = appendAudit(appendAudit([], {at, action: 'tool', subject: 'mail.inbox:read'}), {at, action: 'tool', subject: 'mail.send:external_write'});
  events[0] = {...events[0], subject: 'mail.inbox:hidden'};
  const checked = verifyAudit(events);
  assert.equal(checked.intact, false);
  assert.equal(checked.brokenAt, 1);
  assert.throws(() => appendAudit(events, {at, action: 'read', subject: 'permissions'}), /拒绝在损坏的记录后追加/);
});
