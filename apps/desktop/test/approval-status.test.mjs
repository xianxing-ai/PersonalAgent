import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalPresentation,
  authorizationListHtml,
  nextApprovalExpiry,
} from '../src/features/admin/approval-status.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const now = Date.parse('2026-09-17T12:00:00.000Z');

function approval(overrides = {}) {
  return {
    approvalId: 'approval-1',
    taskId: 'task-1',
    revision: 3,
    action: 'workspace.read_text',
    scopes: ['workspace:read'],
    expiresAt: '2026-09-17T12:05:00.000Z',
    state: 'pending',
    argumentsDigest: 'digest-not-for-display',
    argumentSummary: 'redacted',
    arguments: {path: 'C:\\Users\\private\\secret.txt', token: 'do-not-render'},
    ...overrides,
  };
}

test('approval presentation uses only the public redacted snapshot fields', () => {
  const item = approval();
  Object.defineProperty(item, 'arguments', {
    get() { throw new Error('raw arguments must never be read'); },
  });
  const presentation = approvalPresentation(item, now);
  assert.deepEqual(presentation, {
    action: 'workspace.read_text',
    scopesLabel: 'workspace:read',
    argumentLabel: '已由 Runtime 脱敏',
    expiresAtLabel: '2026-09-17T12:05:00.000Z',
    state: 'pending',
    stateLabel: '待处理',
    actionable: true,
    expiresAtMillis: Date.parse(item.expiresAt),
  });
  const html = authorizationListHtml([item], escape, now);
  assert.match(html, /workspace\.read_text/);
  assert.match(html, /workspace:read/);
  assert.match(html, /已由 Runtime 脱敏/);
  assert.match(html, /2026-09-17T12:05:00\.000Z/);
  assert.match(html, /允许一次/);
  assert.doesNotMatch(html, /private|secret\.txt|do-not-render|digest-not-for-display/);
});

test('expired or invalid approvals are visibly inactive and fail closed', () => {
  for (const [item, label] of [
    [approval({expiresAt: '2026-09-17T11:59:59.000Z'}), '已失效'],
    [approval({expiresAt: 'not-a-date'}), '期限无效'],
    [approval({state: 'allowed'}), '已允许'],
    [approval({state: 'denied'}), '已拒绝'],
    [approval({state: 'denied', systemExpired: true}), '已失效'],
  ]) {
    const presentation = approvalPresentation(item, now);
    assert.equal(presentation.actionable, false);
    assert.equal(presentation.stateLabel, label);
    const html = authorizationListHtml([item], escape, now);
    assert.match(html, new RegExp(label));
    assert.match(html, /不可操作/);
    assert.doesNotMatch(html, /data-approval=/);
  }
});

test('next approval refresh is scheduled from the earliest actionable expiry', () => {
  const earliest = '2026-09-17T12:01:00.000Z';
  assert.equal(nextApprovalExpiry([
    approval({approvalId: 'late', expiresAt: '2026-09-17T12:10:00.000Z'}),
    approval({approvalId: 'expired', expiresAt: '2026-09-17T11:00:00.000Z'}),
    approval({approvalId: 'early', expiresAt: earliest}),
    approval({approvalId: 'denied', state: 'denied', expiresAt: '2026-09-17T12:00:30.000Z'}),
  ], now), Date.parse(earliest));
});
