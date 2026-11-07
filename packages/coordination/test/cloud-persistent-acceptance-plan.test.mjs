import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProtocolError } from '@personal-agent/contracts';
import {
  assertCloudPersistentEvidence,
  parseCloudPersistentEvidence,
  planCloudPersistentAcceptance,
  CLOUD_PERSISTENT_PENDING_REASON,
  CLOUD_PERSISTENT_PROFILE,
  CLOUD_PERSISTENT_PHASES,
  DEFAULT_CLOUD_PERSISTENT_PENDING_ITEMS,
} from '../dist/index.js';

function validEvidenceFixture(overrides = {}) {
  return {
    profile: CLOUD_PERSISTENT_PROFILE,
    capability: 'cloud_persistent',
    taskId: 'task-cloudpersist-001',
    sessionId: 'session-cp-789',
    deviceShutdownAt: '2026-11-07T05:00:00Z',
    cloudExecutionStartedAt: '2026-11-07T05:01:00Z',
    cloudExecutionCompletedAt: '2026-11-07T05:05:00Z',
    cloudPersistentHost: 'https://agentarts.cn-north-4.myhuaweicloud.com/persistent-host',
    executionStatus: 'completed',
    cloudTraceId: 'trace-hwcloud-persist-999',
    cloudReceiptDigests: ['sha256:1111111111111111111111111111111111111111111111111111111111111111'],
    checkpointRef: 'ckpt-step-4',
    evidenceLevel: 'conditional',
    cloudEvidence: true,
    sourceCommit: '0e7f3aa1633b8997fe59ce4256ad4509b4674cf3',
    phases: [
      'device_shutdown_detected',
      'cloud_host_handover',
      'unattended_cloud_execution',
      'cloud_checkpoint_persistence',
      'device_reconnect_reconciliation',
    ],
    ...overrides,
  };
}

test('assertCloudPersistentEvidence validates complete valid evidence', () => {
  const fixture = validEvidenceFixture();
  assert.doesNotThrow(() => assertCloudPersistentEvidence(fixture));
  const parsed = parseCloudPersistentEvidence(fixture);
  assert.equal(parsed.taskId, 'task-cloudpersist-001');
  assert.equal(parsed.cloudPersistentHost, 'https://agentarts.cn-north-4.myhuaweicloud.com/persistent-host');
});

test('assertCloudPersistentEvidence validates minimal valid evidence', () => {
  const minimal = {
    profile: 'huawei_ict_agentarts',
    capability: 'cloud_persistent',
    taskId: 'task-min-1',
    sessionId: 'sess-min-1',
    deviceShutdownAt: '2026-11-07T04:00:00Z',
    cloudExecutionStartedAt: '2026-11-07T04:00:01Z',
    cloudPersistentHost: 'agentarts-cloud-host-primary',
    cloudTraceId: 'trace-min-123',
  };
  assert.doesNotThrow(() => assertCloudPersistentEvidence(minimal));
});

test('assertCloudPersistentEvidence rejects non-plain objects', () => {
  for (const invalid of [null, undefined, 'string', 123, true, [], [validEvidenceFixture()]]) {
    assert.throws(
      () => assertCloudPersistentEvidence(invalid),
      (err) => err.code === 'INVALID_ARGUMENT' && /must be an object/.test(err.message)
    );
  }
});

test('assertCloudPersistentEvidence rejects mock evidence explicitly', () => {
  const mockCases = [
    { mock: true },
    { isMock: true },
    { synthetic: true },
    { simulated: true },
    { evidenceLevel: 'mock' },
  ];

  for (const m of mockCases) {
    const fixture = validEvidenceFixture(m);
    assert.throws(
      () => assertCloudPersistentEvidence(fixture),
      (err) => err.code === 'INVALID_ARGUMENT' && /rejects mock evidence/.test(err.message)
    );
  }
});

test('assertCloudPersistentEvidence rejects local-only execution and false cloudEvidence', () => {
  assert.throws(
    () => assertCloudPersistentEvidence(validEvidenceFixture({ localOnly: true })),
    (err) => err.code === 'INVALID_ARGUMENT' && /rejects local-only execution/.test(err.message)
  );

  assert.throws(
    () => assertCloudPersistentEvidence(validEvidenceFixture({ isLocalOnly: true })),
    (err) => err.code === 'INVALID_ARGUMENT' && /rejects local-only execution/.test(err.message)
  );

  assert.throws(
    () => assertCloudPersistentEvidence(validEvidenceFixture({ cloudEvidence: false })),
    (err) => err.code === 'INVALID_ARGUMENT' && /requires cloudEvidence/.test(err.message)
  );
});

test('assertCloudPersistentEvidence rejects localhost and mock/fake hosts', () => {
  const invalidHosts = [
    'https://localhost:8080/host',
    'https://127.0.0.1:443/host',
    'wss://[::1]:9000/ws',
    'https://fake-cloud.huawei.com/host',
    'https://mock-agentarts.cloud.com/host',
    'http://agentarts.myhuaweicloud.com/insecure',
    'ws://agentarts.myhuaweicloud.com/insecure',
    'https://user:pass@agentarts.myhuaweicloud.com/host',
    'localhost-host-runner',
    'fake-cloud-host-id',
    'mock-cloud-persistent-host',
  ];

  for (const cloudPersistentHost of invalidHosts) {
    const fixture = validEvidenceFixture({ cloudPersistentHost });
    assert.throws(
      () => assertCloudPersistentEvidence(fixture),
      (err) => err.code === 'INVALID_ARGUMENT' && (/localhost|mock|fake|protocol|credentials/.test(err.message))
    );
  }
});

test('assertCloudPersistentEvidence enforces profile and capability', () => {
  assert.throws(
    () => assertCloudPersistentEvidence(validEvidenceFixture({ profile: 'local_generic' })),
    (err) => err.code === 'INVALID_ARGUMENT' && /profile must be "huawei_ict_agentarts"/.test(err.message)
  );

  assert.throws(
    () => assertCloudPersistentEvidence(validEvidenceFixture({ capability: 'local_device' })),
    (err) => err.code === 'INVALID_ARGUMENT' && /capability must be "cloud_persistent"/.test(err.message)
  );
});

test('assertCloudPersistentEvidence validates taskId, sessionId, and cloudTraceId bounds', () => {
  for (const empty of ['', '   ', 'a'.repeat(129)]) {
    assert.throws(
      () => assertCloudPersistentEvidence(validEvidenceFixture({ taskId: empty })),
      (err) => err.code === 'INVALID_ARGUMENT' && /taskId/.test(err.message)
    );
    assert.throws(
      () => assertCloudPersistentEvidence(validEvidenceFixture({ sessionId: empty })),
      (err) => err.code === 'INVALID_ARGUMENT' && /sessionId/.test(err.message)
    );
    assert.throws(
      () => assertCloudPersistentEvidence(validEvidenceFixture({ cloudTraceId: empty })),
      (err) => err.code === 'INVALID_ARGUMENT' && /cloudTraceId/.test(err.message)
    );
  }
});

test('assertCloudPersistentEvidence validates ISO timestamps and enforces causality', () => {
  // Invalid format or impossible date
  for (const invalidDate of ['not-a-date', '2026-02-31T00:00:00Z', '2026/11/07 05:00:00']) {
    assert.throws(
      () => assertCloudPersistentEvidence(validEvidenceFixture({ deviceShutdownAt: invalidDate })),
      (err) => err.code === 'INVALID_ARGUMENT' && /deviceShutdownAt/.test(err.message)
    );
    assert.throws(
      () => assertCloudPersistentEvidence(validEvidenceFixture({ cloudExecutionStartedAt: invalidDate })),
      (err) => err.code === 'INVALID_ARGUMENT' && /cloudExecutionStartedAt/.test(err.message)
    );
  }

  // Causality: cloud start cannot precede device shutdown
  assert.throws(
    () =>
      assertCloudPersistentEvidence(
        validEvidenceFixture({
          deviceShutdownAt: '2026-11-07T05:00:00Z',
          cloudExecutionStartedAt: '2026-11-07T04:59:59Z',
        })
      ),
    (err) => err.code === 'INVALID_ARGUMENT' && /cannot precede device shutdown time/.test(err.message)
  );

  // Causality: cloud completion cannot precede cloud start
  assert.throws(
    () =>
      assertCloudPersistentEvidence(
        validEvidenceFixture({
          cloudExecutionStartedAt: '2026-11-07T05:01:00Z',
          cloudExecutionCompletedAt: '2026-11-07T05:00:30Z',
        })
      ),
    (err) => err.code === 'INVALID_ARGUMENT' && /cannot precede cloud start time/.test(err.message)
  );
});

test('assertCloudPersistentEvidence validates executionStatus and optional fields', () => {
  assert.throws(
    () => assertCloudPersistentEvidence(validEvidenceFixture({ executionStatus: 'aborted' })),
    (err) => err.code === 'INVALID_ARGUMENT' && /executionStatus/.test(err.message)
  );

  assert.throws(
    () => assertCloudPersistentEvidence(validEvidenceFixture({ evidenceLevel: 'unknown' })),
    (err) => err.code === 'INVALID_ARGUMENT' && /evidenceLevel/.test(err.message)
  );

  assert.throws(
    () => assertCloudPersistentEvidence(validEvidenceFixture({ cloudReceiptDigests: [''] })),
    (err) => err.code === 'INVALID_ARGUMENT' && /cloudReceiptDigests/.test(err.message)
  );
});

test('planCloudPersistentAcceptance without arguments generates default unavailable plan', () => {
  const plan = planCloudPersistentAcceptance();
  assert.equal(plan.profile, 'huawei_ict_agentarts');
  assert.equal(plan.capability, 'cloud_persistent');
  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.reason, CLOUD_PERSISTENT_PENDING_REASON);
  assert.equal(plan.pending.length, DEFAULT_CLOUD_PERSISTENT_PENDING_ITEMS.length);

  for (const item of plan.pending) {
    assert.equal(item.status, 'unavailable');
    assert.equal(item.reason, CLOUD_PERSISTENT_PENDING_REASON);
  }

  assert.equal(plan.phasesStatus.expectedPhases.length, CLOUD_PERSISTENT_PHASES.length);
  assert.equal(plan.phasesStatus.missingPhases.length, CLOUD_PERSISTENT_PHASES.length);
  assert.ok(plan.limits.length > 0);
  assert.ok(plan.limits.some(l => l.includes('待真云关机验收')));
});

test('planCloudPersistentAcceptance with options wrapper reflects taskId and headCommit', () => {
  const plan = planCloudPersistentAcceptance({
    taskId: 'custom-task-42',
    headCommit: '0e7f3aa1633b',
    customPendingItems: ['extra_custom_check'],
  });

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.taskId, 'custom-task-42');
  assert.equal(plan.headCommit, '0e7f3aa1633b');
  assert.equal(plan.pending.length, DEFAULT_CLOUD_PERSISTENT_PENDING_ITEMS.length + 1);
  const extra = plan.pending.find(p => p.item === 'extra_custom_check');
  assert.ok(extra);
  assert.equal(extra.status, 'unavailable');
  assert.equal(extra.reason, CLOUD_PERSISTENT_PENDING_REASON);
});

test('planCloudPersistentAcceptance with valid evidence but without real cloud shutdown evidence stays unavailable', () => {
  const evidence = validEvidenceFixture();
  const plan = planCloudPersistentAcceptance({
    evidence,
    headCommit: '0e7f3aa1633b8997fe59ce4256ad4509b4674cf3',
  });

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.reason, CLOUD_PERSISTENT_PENDING_REASON);
  assert.equal(plan.taskId, 'task-cloudpersist-001');
  assert.equal(plan.cloudPersistentHost, 'https://agentarts.cn-north-4.myhuaweicloud.com/persistent-host');
  assert.ok(plan.verified.some(v => v.includes('task-cloudpersist-001')));
  assert.ok(plan.verified.some(v => v.includes('2026-11-07T05:00:00Z')));
  assert.equal(plan.pending.length, DEFAULT_CLOUD_PERSISTENT_PENDING_ITEMS.length);
  for (const item of plan.pending) {
    assert.equal(item.status, 'unavailable');
    assert.equal(item.reason, CLOUD_PERSISTENT_PENDING_REASON);
  }
});

test('planCloudPersistentAcceptance detects HEAD commit mismatch and adds pending item', () => {
  const evidence = validEvidenceFixture({ sourceCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  const plan = planCloudPersistentAcceptance({
    evidence,
    headCommit: '0e7f3aa1633b8997fe59ce4256ad4509b4674cf3',
  });

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.headMatches, false);
  const mismatchItem = plan.pending.find(p => p.item === 'source_head_commit_alignment');
  assert.ok(mismatchItem);
  assert.equal(mismatchItem.status, 'unavailable');
});

test('planCloudPersistentAcceptance keeps closedLoop=false even with simulated real cloud shutdown evidence (no online cloud persistent host attestation)', () => {
  // 依据 AGENTS.md 与可信验收规范：内存自报对象不构成华为云在线关机接管与持续执行凭证。
  // 旧测试将纯 JS 形状等同于真云闭环属于不可信结论，收紧为 closedLoop: false，保留为严格负例。
  const evidence = validEvidenceFixture({ sourceCommit: '0e7f3aa1633b8997fe59ce4256ad4509b4674cf3' });
  const realCloudEvidence = {
    authenticated: true,
    shutdownVerified: true,
    cloudHostActive: true,
    checkpointVerified: true,
  };

  const plan = planCloudPersistentAcceptance({
    evidence,
    headCommit: '0e7f3aa1633b',
    realCloudEvidence,
  });

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.reason, CLOUD_PERSISTENT_PENDING_REASON);
  assert.equal(plan.headMatches, true);
  assert.ok(plan.pending.length >= DEFAULT_CLOUD_PERSISTENT_PENDING_ITEMS.length);
  assert.ok(plan.verified.some(v => v.includes('代码对齐')));
});

test('planCloudPersistentAcceptance preserves custom pending items even with real cloud evidence', () => {
  const evidence = validEvidenceFixture({ sourceCommit: '0e7f3aa1' });
  const plan = planCloudPersistentAcceptance({
    evidence,
    headCommit: '0e7f3aa1',
    realCloudEvidence: {
      authenticated: true,
      shutdownVerified: true,
      cloudHostActive: true,
      checkpointVerified: true,
      unattendedExecutionVerified: true,
      reconciliationVerified: true,
    },
    customPendingItems: ['pending_third_party_audit'],
  });

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.structuralVerification?.fullyCovered, true);
  assert.deepEqual(plan.structuralVerification?.missingFields, []);
  assert.ok(plan.pending.some(p => p.item === 'pending_third_party_audit'));
  const text = plan.limits.join('\n');
  assert.ok(text.includes('closedLoop=true'));
  assert.ok(text.includes('closedLoop=false'));
});

test('planCloudPersistentAcceptance cross-review blockers: rejects boolean realCloudEvidence, enforces missingPhases and headCommit (simulated fixture)', () => {
  const evidence = validEvidenceFixture({
    sourceCommit: '0e7f3aa1',
    phases: ['device_shutdown_signal'], // missing takeover, checkpoint, completion
  });

  // Blocker 1: boolean realCloudEvidence must be rejected
  assert.throws(
    () => planCloudPersistentAcceptance({ evidence, realCloudEvidence: true }),
    err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('boolean is not supported')
  );

  // Blocker 2: missing unattendedExecutionVerified/reconciliationVerified produces warning
  const planIncomplete = planCloudPersistentAcceptance({
    evidence,
    headCommit: '0e7f3aa1',
    realCloudEvidence: {
      authenticated: true,
      shutdownVerified: true,
      cloudHostActive: true,
      checkpointVerified: true,
      // missing unattendedExecutionVerified & reconciliationVerified
    },
  });
  assert.ok(planIncomplete.verified.some(v => v.includes('结构告警：自报云端关机证据对象未完整包含全部结构字段')));
  assert.equal(planIncomplete.structuralVerification?.fullyCovered, false);
  assert.ok(planIncomplete.structuralVerification?.missingFields.includes('unattendedExecutionVerified'));
  assert.ok(planIncomplete.structuralVerification?.missingFields.includes('reconciliationVerified'));

  // Blocker 2 (cont): missing phases must be tracked in pending
  assert.ok(planIncomplete.pending.some(p => p.item === 'cloud_phases_coverage' && p.description.includes('缺失阶段')));

  // Blocker 2 (cont): missing headCommit must keep source_head_commit_alignment pending
  const planNoHead = planCloudPersistentAcceptance({ evidence });
  assert.ok(planNoHead.pending.some(p => p.item === 'source_head_commit_alignment' && p.description.includes('未提供当前 HEAD 提交')));
});
