import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertMod04bAgentArtsEvidence,
  parseMod04bAgentArtsEvidence,
  planMod04bAgentArtsAcceptance,
  MOD04B_AGENTARTS_PROFILE,
  MOD04B_AGENTARTS_CAPABILITY,
  MOD04B_AGENTARTS_PENDING_REASON,
  DEFAULT_MOD04B_AGENTARTS_PENDING_ITEMS,
} from '../dist/index.js';

function validEvidenceFixture(overrides = {}) {
  return {
    profile: MOD04B_AGENTARTS_PROFILE,
    capability: MOD04B_AGENTARTS_CAPABILITY,
    taskId: 'task-mod04b-001',
    sessionId: 'session-mod04b-789',
    cloudTraceId: 'trace-agentarts-hwcloud-001',
    runtimeName: 'runtime-competition-mod04b',
    gatewayUrl: 'https://agentarts.cn-north-4.myhuaweicloud.com/v1',
    invokedAt: '2026-11-07T05:00:00Z',
    completedAt: '2026-11-07T05:01:30Z',
    executionStatus: 'completed',
    multiAgent: {
      coordinator: 'lead-coordinator',
      agents: [
        { role: 'coordinator', agentName: 'lead-coordinator' },
        { role: 'specialist-coder', agentName: 'code-agent' },
        { role: 'reviewer', agentName: 'review-agent' },
      ],
      handoffCount: 2,
      routingTrace: ['coordinator -> specialist-coder', 'specialist-coder -> reviewer'],
    },
    continuation: {
      proposalId: 'prop-workspace-patch-001',
      state: 'confirmed',
      toolName: 'workspace.stage_text_patch',
      round: 1,
      resultDigest: 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    },
    evidenceLevel: 'conditional',
    cloudEvidence: true,
    sourceCommit: '0e7f3aa1633b8997fe59ce4256ad4509b4674cf3',
    ...overrides,
  };
}

test('assertMod04bAgentArtsEvidence validates complete valid evidence', () => {
  const fixture = validEvidenceFixture();
  assert.doesNotThrow(() => assertMod04bAgentArtsEvidence(fixture));
  const parsed = parseMod04bAgentArtsEvidence(fixture);
  assert.equal(parsed.taskId, 'task-mod04b-001');
  assert.equal(parsed.sessionId, 'session-mod04b-789');
  assert.equal(parsed.cloudTraceId, 'trace-agentarts-hwcloud-001');
  assert.equal(parsed.runtimeName, 'runtime-competition-mod04b');
  assert.equal(parsed.gatewayUrl, 'https://agentarts.cn-north-4.myhuaweicloud.com/v1');
});

test('assertMod04bAgentArtsEvidence validates minimal valid evidence with multiAgent only', () => {
  const minimal = {
    profile: MOD04B_AGENTARTS_PROFILE,
    taskId: 'task-min-1',
    sessionId: 'session-min-1',
    cloudTraceId: 'trace-min-1',
    multiAgent: {
      agents: ['lead-coordinator', 'worker-agent'],
    },
  };
  assert.doesNotThrow(() => assertMod04bAgentArtsEvidence(minimal));
});

test('assertMod04bAgentArtsEvidence validates minimal valid evidence with continuation only', () => {
  const minimal = {
    profile: MOD04B_AGENTARTS_PROFILE,
    taskId: 'task-min-2',
    sessionId: 'session-min-2',
    cloudTraceId: 'trace-min-2',
    continuation: {
      proposalId: 'prop-001',
      state: 'confirmed',
    },
  };
  assert.doesNotThrow(() => assertMod04bAgentArtsEvidence(minimal));
});

test('assertMod04bAgentArtsEvidence validates top-level agents array and continuations array', () => {
  const fixture = {
    profile: MOD04B_AGENTARTS_PROFILE,
    taskId: 'task-top-1',
    sessionId: 'session-top-1',
    cloudTraceId: 'trace-top-1',
    agents: ['agent-alpha', 'agent-beta'],
    continuations: [
      { proposalId: 'prop-001', state: 'confirmed' },
      { proposalId: 'prop-002', state: 'confirmed', toolName: 'test.tool' },
    ],
  };
  assert.doesNotThrow(() => assertMod04bAgentArtsEvidence(fixture));
});

test('assertMod04bAgentArtsEvidence rejects non-plain objects', () => {
  for (const invalid of [null, undefined, 'string', 123, true, [], [validEvidenceFixture()]]) {
    assert.throws(
      () => assertMod04bAgentArtsEvidence(invalid),
      (err) => err.code === 'INVALID_ARGUMENT' && /must be an object/.test(err.message)
    );
  }
});

test('assertMod04bAgentArtsEvidence rejects mock evidence explicitly', () => {
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
      () => assertMod04bAgentArtsEvidence(fixture),
      (err) => err.code === 'INVALID_ARGUMENT' && /rejects mock evidence/.test(err.message)
    );
  }
});

test('assertMod04bAgentArtsEvidence rejects local-only execution and false cloudEvidence', () => {
  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({ localOnly: true })),
    (err) => err.code === 'INVALID_ARGUMENT' && /rejects local-only execution/.test(err.message)
  );

  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({ isLocalOnly: true })),
    (err) => err.code === 'INVALID_ARGUMENT' && /rejects local-only execution/.test(err.message)
  );

  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({ cloudEvidence: false })),
    (err) => err.code === 'INVALID_ARGUMENT' && /requires cloudEvidence/.test(err.message)
  );
});

test('assertMod04bAgentArtsEvidence rejects localhost and mock/fake hosts', () => {
  const invalidHosts = [
    'https://localhost:8080/v1',
    'https://127.0.0.1:443/v1',
    'wss://[::1]:9000/ws',
    'https://fake-cloud.huawei.com/v1',
    'https://mock-agentarts.cloud.com/v1',
    'http://agentarts.myhuaweicloud.com/insecure',
    'ws://agentarts.myhuaweicloud.com/insecure',
    'https://user:pass@agentarts.myhuaweicloud.com/v1',
    'not-a-valid-url',
  ];

  for (const gatewayUrl of invalidHosts) {
    const fixture = validEvidenceFixture({ gatewayUrl });
    assert.throws(
      () => assertMod04bAgentArtsEvidence(fixture),
      (err) => err.code === 'INVALID_ARGUMENT' && /localhost|mock|fake|protocol|credentials|URL/.test(err.message)
    );
  }
});

test('assertMod04bAgentArtsEvidence enforces profile and capability', () => {
  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({ profile: 'local_generic' })),
    (err) => err.code === 'INVALID_ARGUMENT' && /profile must be "huawei_ict_agentarts"/.test(err.message)
  );

  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({ capability: 'local_device' })),
    (err) => err.code === 'INVALID_ARGUMENT' && /capability must be "competition_coordination"/.test(err.message)
  );
});

test('assertMod04bAgentArtsEvidence validates taskId, sessionId, and cloudTraceId bounds', () => {
  for (const empty of ['', '   ', 'a'.repeat(129)]) {
    assert.throws(
      () => assertMod04bAgentArtsEvidence(validEvidenceFixture({ taskId: empty })),
      (err) => err.code === 'INVALID_ARGUMENT' && /taskId/.test(err.message)
    );
    assert.throws(
      () => assertMod04bAgentArtsEvidence(validEvidenceFixture({ sessionId: empty })),
      (err) => err.code === 'INVALID_ARGUMENT' && /sessionId/.test(err.message)
    );
    assert.throws(
      () => assertMod04bAgentArtsEvidence(validEvidenceFixture({ cloudTraceId: empty })),
      (err) => err.code === 'INVALID_ARGUMENT' && /cloudTraceId/.test(err.message)
    );
  }
});

test('assertMod04bAgentArtsEvidence validates runtimeName boundaries', () => {
  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({ runtimeName: 'invalid name with spaces' })),
    (err) => err.code === 'INVALID_ARGUMENT' && /runtimeName/.test(err.message)
  );
  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({ runtimeName: 'a'.repeat(65) })),
    (err) => err.code === 'INVALID_ARGUMENT' && /runtimeName/.test(err.message)
  );
});

test('assertMod04bAgentArtsEvidence validates ISO timestamps and enforces causality', () => {
  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({ invokedAt: '2026-02-31T00:00:00Z' })),
    (err) => err.code === 'INVALID_ARGUMENT' && /invokedAt must be a valid ISO timestamp/.test(err.message)
  );

  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({ completedAt: 'not-a-date' })),
    (err) => err.code === 'INVALID_ARGUMENT' && /completedAt must be a valid ISO timestamp/.test(err.message)
  );

  // Causality: completedAt before invokedAt
  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({
      invokedAt: '2026-11-07T05:02:00Z',
      completedAt: '2026-11-07T05:01:00Z',
    })),
    (err) => err.code === 'INVALID_ARGUMENT' && /Completed time cannot precede invocation time/.test(err.message)
  );
});

test('assertMod04bAgentArtsEvidence validates multi-agent constraints', () => {
  // Less than 2 agents
  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({
      multiAgent: { agents: ['solo-agent'] },
    })),
    (err) => err.code === 'INVALID_ARGUMENT' && /at least 2 distinct agents/.test(err.message)
  );

  // Duplicate agents
  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({
      multiAgent: { agents: ['agent-a', 'agent-a'] },
    })),
    (err) => err.code === 'INVALID_ARGUMENT' && /Duplicate agent detected/.test(err.message)
  );

  // Mock agent name
  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({
      multiAgent: { agents: ['real-agent', 'mock-agent'] },
    })),
    (err) => err.code === 'INVALID_ARGUMENT' && /mock or fake agents/.test(err.message)
  );
});

test('assertMod04bAgentArtsEvidence validates continuation constraints', () => {
  // Empty proposalId
  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({
      continuation: { proposalId: '', state: 'confirmed' },
    })),
    (err) => err.code === 'INVALID_ARGUMENT' && /proposalId/.test(err.message)
  );

  // Mock proposalId
  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({
      continuation: { proposalId: 'mock-proposal-1', state: 'confirmed' },
    })),
    (err) => err.code === 'INVALID_ARGUMENT' && /mock or fake proposals/.test(err.message)
  );

  // Unconfirmed continuation state
  assert.throws(
    () => assertMod04bAgentArtsEvidence(validEvidenceFixture({
      continuation: { proposalId: 'prop-123', state: 'unconfirmed' },
    })),
    (err) => err.code === 'INVALID_ARGUMENT' && /state must be "confirmed"/.test(err.message)
  );
});

test('assertMod04bAgentArtsEvidence rejects evidence missing both multiAgent and continuation', () => {
  const missingBoth = {
    profile: MOD04B_AGENTARTS_PROFILE,
    taskId: 'task-none-1',
    sessionId: 'session-none-1',
    cloudTraceId: 'trace-none-1',
  };
  assert.throws(
    () => assertMod04bAgentArtsEvidence(missingBoth),
    (err) => err.code === 'INVALID_ARGUMENT' && /must contain multiAgent or continuation details/.test(err.message)
  );
});

test('planMod04bAgentArtsAcceptance with no arguments returns offline plan with closedLoop=false', () => {
  const plan = planMod04bAgentArtsAcceptance();
  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.reason, MOD04B_AGENTARTS_PENDING_REASON);
  assert.equal(plan.profile, 'huawei_ict_agentarts');
  assert.equal(plan.capability, 'competition_coordination');
  assert.equal(plan.pending.length, DEFAULT_MOD04B_AGENTARTS_PENDING_ITEMS.length);
  for (const item of plan.pending) {
    assert.equal(item.status, 'unavailable');
    assert.equal(item.reason, MOD04B_AGENTARTS_PENDING_REASON);
  }
  assert.equal(plan.multiAgentStatus.isMultiAgent, false);
  assert.equal(plan.continuationStatus.hasContinuation, false);
});

test('planMod04bAgentArtsAcceptance with valid evidence but no real cloud evidence remains unavailable', () => {
  const fixture = validEvidenceFixture();
  const plan = planMod04bAgentArtsAcceptance({ evidence: fixture });
  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.reason, MOD04B_AGENTARTS_PENDING_REASON);
  assert.equal(plan.taskId, fixture.taskId);
  assert.equal(plan.cloudTraceId, fixture.cloudTraceId);
  assert.equal(plan.multiAgentStatus.isMultiAgent, true);
  assert.equal(plan.multiAgentStatus.agentCount, 3);
  assert.equal(plan.continuationStatus.hasContinuation, true);
  assert.equal(plan.continuationStatus.proposalId, 'prop-workspace-patch-001');
  assert.equal(plan.pending.length, DEFAULT_MOD04B_AGENTARTS_PENDING_ITEMS.length);
});

test('planMod04bAgentArtsAcceptance detects HEAD commit mismatch and adds pending item', () => {
  const fixture = validEvidenceFixture({ sourceCommit: 'abcdef1234567890' });
  const plan = planMod04bAgentArtsAcceptance({
    evidence: fixture,
    headCommit: '9999999999999999',
  });
  assert.equal(plan.closedLoop, false);
  assert.equal(plan.headMatches, false);
  const mismatchItem = plan.pending.find((p) => p.item === 'source_head_commit_alignment');
  assert.ok(mismatchItem, 'Expected source_head_commit_alignment in pending');
  assert.equal(mismatchItem.status, 'unavailable');
});

test('planMod04bAgentArtsAcceptance resolves to verified when real cloud evidence is provided', () => {
  const fixture = validEvidenceFixture({ sourceCommit: '0e7f3aa1633b8997fe59ce4256ad4509b4674cf3' });
  const plan = planMod04bAgentArtsAcceptance({
    evidence: fixture,
    headCommit: '0e7f3aa1633b8997fe59ce4256ad4509b4674cf3',
    realCloudEvidence: {
      authenticated: true,
      multiAgentRoutingVerified: true,
      continuationVerified: true,
      traceReadbackVerified: true,
    },
  });
  assert.equal(plan.closedLoop, true);
  assert.equal(plan.status, 'verified');
  assert.equal(plan.reason, '真云多Agent与continuation已验收');
  assert.equal(plan.pending.length, 0);
  assert.equal(plan.headMatches, true);
});

test('planMod04bAgentArtsAcceptance preserves custom pending items', () => {
  const plan = planMod04bAgentArtsAcceptance({
    customPendingItems: ['custom_huawei_billing_check'],
  });
  assert.ok(plan.pending.some((p) => p.item === 'custom_huawei_billing_check'));
});

test('planMod04bAgentArtsAcceptance rejects mock evidence passed via options', () => {
  assert.throws(
    () => planMod04bAgentArtsAcceptance({ evidence: validEvidenceFixture({ mock: true }) }),
    (err) => err.code === 'INVALID_ARGUMENT' && /rejects mock evidence/.test(err.message)
  );
});
