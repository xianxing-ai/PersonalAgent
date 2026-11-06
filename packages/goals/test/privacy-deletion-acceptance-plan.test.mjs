import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertPrivacyDeletionReceipt,
  parsePrivacyDeletionReceipt,
  planPrivacyDeletionAcceptance,
  PRIVACY_ACCEPTANCE_PENDING_REASON,
  PRIVACY_ACCEPTANCE_PENDING_ITEMS,
  PRIVACY_ACCEPTANCE_LIMITS,
  GraphError,
} from '../dist/index.js';

test('assertPrivacyDeletionReceipt validates valid withdrawal receipt and parse returns it', () => {
  const withdrawalReceipt = {
    receiptId: 'rcpt-withdrawal-001',
    namespace: 'user-vault',
    targetId: 'fact-meeting-notes',
    action: 'withdrawal',
    graphRevision: 5,
    nodeRevision: 2,
    physicalErasure: false,
    reason: 'user requested logical withdrawal of calendar entry',
    timestamp: '2026-11-07T04:00:00.000Z',
    evidenceLevel: 'conditional',
  };

  assertPrivacyDeletionReceipt(withdrawalReceipt);
  const parsed = parsePrivacyDeletionReceipt(withdrawalReceipt);
  assert.deepEqual(parsed, withdrawalReceipt);
  assert.equal(parsed.action, 'withdrawal');
  assert.equal(parsed.physicalErasure, false);
});

test('assertPrivacyDeletionReceipt validates valid privacy deletion receipt with erased revisions', () => {
  const deletionReceipt = {
    receiptId: 'rcpt-deletion-002',
    namespace: 'user-vault',
    targetId: 'fact-private-medical',
    action: 'privacy_deletion',
    graphRevision: 8,
    physicalErasure: true,
    erasedGraphRevisions: [3, 4, 7],
    reason: 'GDPR right to be forgotten compliance',
    timestamp: '2026-11-07T04:15:00.000Z',
    evidenceLevel: 'verified',
    realUserAuthorization: true,
    realDeletionReadback: true,
  };

  assertPrivacyDeletionReceipt(deletionReceipt);
  const parsed = parsePrivacyDeletionReceipt(deletionReceipt);
  assert.deepEqual(parsed, deletionReceipt);
  assert.equal(parsed.action, 'privacy_deletion');
  assert.equal(parsed.physicalErasure, true);
  assert.deepEqual(parsed.erasedGraphRevisions, [3, 4, 7]);
});

test('assertPrivacyDeletionReceipt strictly prohibits calling withdrawal a physical deletion', () => {
  // Prohibit physicalErasure: true on withdrawal
  assert.throws(
    () => assertPrivacyDeletionReceipt({
      receiptId: 'rcpt-003',
      namespace: 'user-vault',
      targetId: 'goal-secret',
      action: 'withdrawal',
      graphRevision: 2,
      physicalErasure: true,
    }),
    (err) => err instanceof GraphError && err.code === 'INVALID_ARGUMENT' && err.message.includes('physical deletion')
  );

  // Prohibit isPhysicalDeletion: true on withdrawal
  assert.throws(
    () => assertPrivacyDeletionReceipt({
      receiptId: 'rcpt-004',
      namespace: 'user-vault',
      targetId: 'goal-secret',
      action: 'withdrawal',
      graphRevision: 2,
      isPhysicalDeletion: true,
    }),
    (err) => err instanceof GraphError && err.code === 'INVALID_ARGUMENT'
  );

  // Prohibit physicalDeletion: true on withdrawal
  assert.throws(
    () => assertPrivacyDeletionReceipt({
      receiptId: 'rcpt-005',
      namespace: 'user-vault',
      targetId: 'goal-secret',
      action: 'withdrawal',
      graphRevision: 2,
      physicalDeletion: true,
    }),
    (err) => err instanceof GraphError && err.code === 'INVALID_ARGUMENT'
  );

  // Prohibit withdrawal claiming erasedGraphRevisions
  assert.throws(
    () => assertPrivacyDeletionReceipt({
      receiptId: 'rcpt-006',
      namespace: 'user-vault',
      targetId: 'goal-secret',
      action: 'withdrawal',
      graphRevision: 2,
      erasedGraphRevisions: [1],
    }),
    (err) => err instanceof GraphError && err.code === 'INVALID_ARGUMENT' && err.message.includes('erasedGraphRevisions')
  );
});

test('assertPrivacyDeletionReceipt rejects invalid privacy deletion claims', () => {
  // Privacy deletion with physicalErasure: false is invalid
  assert.throws(
    () => assertPrivacyDeletionReceipt({
      receiptId: 'rcpt-007',
      namespace: 'user-vault',
      targetId: 'fact-sensitive',
      action: 'privacy_deletion',
      graphRevision: 5,
      physicalErasure: false,
    }),
    (err) => err instanceof GraphError && err.code === 'INVALID_ARGUMENT'
  );

  // Privacy deletion with unsorted or non-integer erasedGraphRevisions
  assert.throws(
    () => assertPrivacyDeletionReceipt({
      receiptId: 'rcpt-008',
      namespace: 'user-vault',
      targetId: 'fact-sensitive',
      action: 'privacy_deletion',
      graphRevision: 5,
      physicalErasure: true,
      erasedGraphRevisions: [4, 2], // unsorted
    }),
    (err) => err instanceof GraphError && err.code === 'INVALID_ARGUMENT'
  );

  assert.throws(
    () => assertPrivacyDeletionReceipt({
      receiptId: 'rcpt-009',
      namespace: 'user-vault',
      targetId: 'fact-sensitive',
      action: 'privacy_deletion',
      graphRevision: 5,
      physicalErasure: true,
      erasedGraphRevisions: [0], // non-positive
    }),
    (err) => err instanceof GraphError && err.code === 'INVALID_ARGUMENT'
  );

  assert.throws(
    () => assertPrivacyDeletionReceipt({
      receiptId: 'rcpt-010',
      namespace: 'user-vault',
      targetId: 'fact-sensitive',
      action: 'privacy_deletion',
      graphRevision: 5,
      physicalErasure: true,
      erasedGraphRevisions: [2, 2], // duplicate
    }),
    (err) => err instanceof GraphError && err.code === 'INVALID_ARGUMENT'
  );
});

test('assertPrivacyDeletionReceipt rejects malformed receipt shapes and invalid values', () => {
  assert.throws(() => assertPrivacyDeletionReceipt(null), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => assertPrivacyDeletionReceipt('not-an-object'), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => assertPrivacyDeletionReceipt([]), { code: 'INVALID_ARGUMENT' });

  // Missing or empty required fields
  const base = { receiptId: 'r1', namespace: 'ns', targetId: 't1', action: 'withdrawal', graphRevision: 1 };
  assert.throws(() => assertPrivacyDeletionReceipt({ ...base, receiptId: '' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => assertPrivacyDeletionReceipt({ ...base, namespace: '   ' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => assertPrivacyDeletionReceipt({ ...base, targetId: '' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => assertPrivacyDeletionReceipt({ ...base, action: 'unknown_action' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => assertPrivacyDeletionReceipt({ ...base, graphRevision: -1 }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => assertPrivacyDeletionReceipt({ ...base, graphRevision: 1.5 }), { code: 'INVALID_ARGUMENT' });

  // Invalid optional fields
  assert.throws(() => assertPrivacyDeletionReceipt({ ...base, nodeRevision: 0 }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => assertPrivacyDeletionReceipt({ ...base, timestamp: 'invalid-time' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => assertPrivacyDeletionReceipt({ ...base, evidenceLevel: 'fake' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => assertPrivacyDeletionReceipt({ ...base, reason: 123 }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => assertPrivacyDeletionReceipt({ ...base, realUserAuthorization: 'yes' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => assertPrivacyDeletionReceipt({ ...base, realDeletionReadback: 1 }), { code: 'INVALID_ARGUMENT' });
});

test('planPrivacyDeletionAcceptance returns closedLoop=false and status=unavailable by default', () => {
  const plan = planPrivacyDeletionAcceptance();

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.reason, PRIVACY_ACCEPTANCE_PENDING_REASON);
  assert.equal(plan.reason, '待真人/真机验收');
  assert.ok(Array.isArray(plan.pending));
  assert.equal(plan.pending.length, 5);
  for (const item of plan.pending) {
    assert.equal(item.status, 'unavailable');
    assert.equal(item.reason, '待真人/真机验收');
  }
  assert.ok(plan.limits.length > 0);
  assert.deepEqual(plan.limits, PRIVACY_ACCEPTANCE_LIMITS);
});

test('planPrivacyDeletionAcceptance with receipt but no real evidence marks closedLoop=false', () => {
  const receipt = {
    receiptId: 'rcpt-offline-01',
    namespace: 'offline-test',
    targetId: 'fact-1',
    action: 'withdrawal',
    graphRevision: 3,
    physicalErasure: false,
  };

  const plan = planPrivacyDeletionAcceptance({ receipt });

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.reason, '待真人/真机验收');
  assert.equal(plan.deletionKind, 'withdrawal');
  assert.deepEqual(plan.receipt, receipt);
  assert.ok(plan.verified.some((msg) => msg.includes('逻辑撤回')));
  assert.ok(plan.verified.some((msg) => msg.includes('禁止把撤回称为物理删除')));
});

test('planPrivacyDeletionAcceptance strictly prohibits mock from claiming closedLoop', () => {
  const receipt = {
    receiptId: 'rcpt-mock-01',
    namespace: 'test',
    targetId: 't1',
    action: 'privacy_deletion',
    graphRevision: 4,
    physicalErasure: true,
    evidenceLevel: 'mock',
  };

  // Even if caller claims realUserAuthorization and realDeletionReadback, mock flag forces unavailable
  const plan1 = planPrivacyDeletionAcceptance({
    receipt,
    realUserAuthorization: true,
    realDeletionReadback: true,
  });
  assert.equal(plan1.closedLoop, false);
  assert.equal(plan1.status, 'unavailable');
  assert.equal(plan1.reason, '待真人/真机验收');

  // Explicit mock option
  const plan2 = planPrivacyDeletionAcceptance({
    mock: true,
    realAuthorizationEvidence: true,
    receipt: { ...receipt, evidenceLevel: 'verified' },
  });
  assert.equal(plan2.closedLoop, false);
  assert.equal(plan2.status, 'unavailable');
  assert.equal(plan2.reason, '待真人/真机验收');

  // evidenceLevel: 'mock' in options
  const plan3 = planPrivacyDeletionAcceptance({
    evidenceLevel: 'mock',
    realUserAuthorization: true,
    realDeletionReadback: true,
    receipt: { ...receipt, evidenceLevel: 'verified' },
  });
  assert.equal(plan3.closedLoop, false);
  assert.equal(plan3.status, 'unavailable');
});

test('planPrivacyDeletionAcceptance handles partial evidence correctly', () => {
  const receipt = {
    receiptId: 'rcpt-partial-01',
    namespace: 'test',
    targetId: 't1',
    action: 'privacy_deletion',
    graphRevision: 2,
    physicalErasure: true,
  };

  // Case 1: human authorized but no on-site deletion readback
  const planNoReadback = planPrivacyDeletionAcceptance({
    receipt,
    realUserAuthorization: true,
    realDeletionReadback: false,
  });
  assert.equal(planNoReadback.closedLoop, false);
  assert.equal(planNoReadback.status, 'unavailable');
  assert.ok(planNoReadback.pending.some((p) => p.item === 'on_site_deletion_readback'));
  assert.ok(!planNoReadback.pending.some((p) => p.item === 'human_user_privacy_authorization'));

  // Case 2: on-site deletion readback but no human authorization
  const planNoAuth = planPrivacyDeletionAcceptance({
    receipt,
    realUserAuthorization: false,
    realDeletionReadback: true,
  });
  assert.equal(planNoAuth.closedLoop, false);
  assert.equal(planNoAuth.status, 'unavailable');
  assert.ok(!planNoAuth.pending.some((p) => p.item === 'on_site_deletion_readback'));
  assert.ok(planNoAuth.pending.some((p) => p.item === 'human_user_privacy_authorization'));
});

test('planPrivacyDeletionAcceptance completes closedLoop only with genuine verified human and deletion evidence', () => {
  const receipt = {
    receiptId: 'rcpt-verified-01',
    namespace: 'user-vault',
    targetId: 'fact-private-calendar',
    action: 'privacy_deletion',
    graphRevision: 10,
    physicalErasure: true,
    erasedGraphRevisions: [2, 5],
    evidenceLevel: 'verified',
    realUserAuthorization: true,
    realDeletionReadback: true,
  };

  const plan = planPrivacyDeletionAcceptance({
    receipt,
    realAuthorizationEvidence: {
      humanAuthorized: true,
      onSiteDeletionReadback: true,
      evidenceLevel: 'verified',
    },
    evidenceLevel: 'verified',
  });

  assert.equal(plan.closedLoop, true);
  assert.equal(plan.status, 'verified');
  assert.equal(plan.reason, '真人授权与真机删除现场读回已核验');
  assert.deepEqual(plan.pending, []);
  assert.ok(plan.verified.length > 0);
  assert.ok(plan.verified.some((v) => v.includes('现场核验')));
});

test('planPrivacyDeletionAcceptance rejects invalid receipt passed in options', () => {
  assert.throws(
    () => planPrivacyDeletionAcceptance({
      receipt: {
        receiptId: 'r1',
        namespace: 'ns',
        targetId: 't1',
        action: 'withdrawal',
        graphRevision: 1,
        physicalErasure: true, // violation!
      },
    }),
    (err) => err instanceof GraphError && err.code === 'INVALID_ARGUMENT'
  );
});
