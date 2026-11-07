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
    realAuthorizationEvidence: { humanAuthorized: true, onSiteDeletionReadback: true },
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

test('planPrivacyDeletionAcceptance retains all 5 pending gates even with self-reported options (no on-site verification mechanism)', () => {
  const receipt = {
    receiptId: 'rcpt-partial-01',
    namespace: 'test',
    targetId: 't1',
    action: 'privacy_deletion',
    graphRevision: 2,
    physicalErasure: true,
  };

  // Case 1: Caller claims human authorized - cannot clear pending gate without trusted verification mechanism
  const planAuthClaim = planPrivacyDeletionAcceptance({
    receipt,
    realUserAuthorization: true,
    realDeletionReadback: false,
  });
  assert.equal(planAuthClaim.closedLoop, false);
  assert.equal(planAuthClaim.status, 'unavailable');
  assert.ok(planAuthClaim.pending.some((p) => p.item === 'human_user_privacy_authorization'));
  assert.ok(planAuthClaim.pending.some((p) => p.item === 'on_site_deletion_readback'));
  assert.ok(planAuthClaim.verified.some((v) => v.includes('调用方声明：提供自报真人授权字段')));

  // Case 2: Caller claims on-site deletion readback - cannot clear pending gate without durable storage audit
  const planReadbackClaim = planPrivacyDeletionAcceptance({
    receipt,
    realUserAuthorization: false,
    realDeletionReadback: true,
  });
  assert.equal(planReadbackClaim.closedLoop, false);
  assert.equal(planReadbackClaim.status, 'unavailable');
  assert.ok(planReadbackClaim.pending.some((p) => p.item === 'human_user_privacy_authorization'));
  assert.ok(planReadbackClaim.pending.some((p) => p.item === 'on_site_deletion_readback'));
  assert.ok(planReadbackClaim.verified.some((v) => v.includes('调用方声明：提供自报删除读回字段')));
});

test('planPrivacyDeletionAcceptance keeps closedLoop=false even with self-reported verified options (no hardware durable erasure audit)', () => {
  // 依据 AGENTS.md 与隐私安全规范：内存自报 verified 对象不构成独立于调用方的真人现场授权或硬件持久存储物理抹除证明。
  // 旧测试将自报对象等同于闭环属于不可信结论，收紧为 closedLoop: false，保留为严格负例。
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

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.reason, PRIVACY_ACCEPTANCE_PENDING_REASON);
  assert.ok(plan.pending.length > 0);
  assert.ok(plan.verified.length > 0);
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

test('planPrivacyDeletionAcceptance cross-review blockers: rejects boolean realAuthorizationEvidence and prevents withdrawal from claiming physical deletion', () => {
  const withdrawalReceipt = {
    receiptId: 'rcpt-withdrawal-99',
    namespace: 'user-vault',
    targetId: 'fact-01',
    action: 'withdrawal',
    graphRevision: 2,
    physicalErasure: false,
  };

  // Blocker 1: boolean realAuthorizationEvidence must be rejected
  assert.throws(
    () => planPrivacyDeletionAcceptance({ receipt: withdrawalReceipt, realAuthorizationEvidence: true }),
    err => err instanceof GraphError && err.code === 'INVALID_ARGUMENT' && err.message.includes('boolean is not supported')
  );

  // Blocker 2: withdrawal receipt must never claim physical deletion readback
  const simulatedAuth = {
    humanAuthorized: true,
    onSiteDeletionReadback: true,
    evidenceLevel: 'verified',
  };
  const planWithdrawal = planPrivacyDeletionAcceptance({
    receipt: withdrawalReceipt,
    realAuthorizationEvidence: simulatedAuth,
  });

  assert.equal(planWithdrawal.closedLoop, false);
  assert.equal(planWithdrawal.status, 'unavailable');
  assert.ok(planWithdrawal.verified.some(v => v.includes('结构告警：撤回回执（withdrawal）不可关联物理删除读回证据')));
  // on_site_deletion_readback is not claimed for withdrawal
  assert.ok(!planWithdrawal.verified.some(v => v.includes('调用方声明：提供自报删除读回字段')));
  assert.equal(planWithdrawal.structuralVerification?.isPhysicalDeletion, false);
  assert.ok(planWithdrawal.structuralVerification?.missingRequirements.includes('action_must_be_privacy_deletion_with_physical_erasure'));

  // Valid physical deletion with simulated authorization
  const physicalReceipt = {
    receiptId: 'rcpt-del-99',
    namespace: 'user-vault',
    targetId: 'fact-01',
    action: 'privacy_deletion',
    graphRevision: 2,
    physicalErasure: true,
  };
  const planPhysical = planPrivacyDeletionAcceptance({
    receipt: physicalReceipt,
    realAuthorizationEvidence: simulatedAuth,
  });
  assert.equal(planPhysical.structuralVerification?.isPhysicalDeletion, true);
  assert.equal(planPhysical.structuralVerification?.hasHumanAuth, true);
  assert.equal(planPhysical.structuralVerification?.hasDeletionReadback, true);
  assert.equal(planPhysical.structuralVerification?.fullyCovered, true);
  assert.deepEqual(planPhysical.structuralVerification?.missingRequirements, []);
  assert.equal(planPhysical.pending.length, 5);
});
