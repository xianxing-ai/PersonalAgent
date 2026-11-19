import assert from 'node:assert/strict';
import test from 'node:test';
import { ProtocolError } from '@personal-agent/contracts';
import {
  assertF09CloudPrefixReceipt,
  parseF09CloudPrefixReceipt,
  planF09CloudPrefixAcceptance,
  F09_ACCEPTANCE_PENDING_REASON,
  F09_WORKFLOW_NODES,
} from '../dist/index.js';

function validReceipt(extra = {}) {
  return {
    profile: 'huawei_ict_agentarts',
    workflowId: 'F09',
    gatewayUrl: 'https://defaultgw-gztdqobzmm.cn-southwest-2.huaweicloud-agentarts.com',
    cloudPrefix: '/invocations/f09',
    runtimeName: 'pa-owned-bindings-0dae0ff5-api',
    runtimeId: '9a65747e-05f0-475c-a2dc-f24dd3ed87ae',
    deploymentVersion: 'arm64-v5-4aa8f93f-r1',
    region: 'cn-southwest-2',
    prefixVerified: true,
    sessionAuth: {
      sessionId: 'session-f09-live-001',
      authorizationRef: 'feed-source-grant:rss-ai-news-v1',
      grantedScopes: ['feeds.collect', 'feeds.validate_and_deduplicate'],
      expiresAt: '2026-11-08T00:00:00.000Z',
      sessionState: 'authorized',
      grantedAt: '2026-11-07T04:00:00.000Z',
    },
    observedAt: '2026-11-07T04:30:00.000Z',
    evidenceLevel: 'conditional',
    cloudEvidence: true,
    sourceCommit: '4aa8f93f1234567890abcdef1234567890abcdef',
    nodes: ['F09_N01', 'F09_N02', 'F09_N03', 'F09_N04'],
    ...extra,
  };
}

test('assertF09CloudPrefixReceipt validates full and minimal valid receipts', () => {
  const full = validReceipt();
  assert.doesNotThrow(() => assertF09CloudPrefixReceipt(full));

  // Minimal valid receipt
  const minimal = {
    profile: 'huawei_ict_agentarts',
    workflowId: 'F09',
    gatewayUrl: 'https://gateway.example.com',
    cloudPrefix: '/invocations/feeds',
    runtimeName: 'runtime-1',
    prefixVerified: true,
    sessionAuth: {
      sessionId: 'sess-1',
      authorizationRef: 'auth-1',
      grantedScopes: ['feeds.collect'],
      expiresAt: '2026-12-31T23:59:59.000Z',
      sessionState: 'active',
    },
  };
  assert.doesNotThrow(() => assertF09CloudPrefixReceipt(minimal));
});

test('parseF09CloudPrefixReceipt parses valid receipt and throws on invalid', () => {
  const receipt = validReceipt();
  const parsed = parseF09CloudPrefixReceipt(receipt);
  assert.equal(parsed.workflowId, 'F09');
  assert.equal(parsed.cloudPrefix, '/invocations/f09');
  assert.throws(() => parseF09CloudPrefixReceipt({}), ProtocolError);
});

test('assertF09CloudPrefixReceipt rejects non-objects', () => {
  for (const bad of [null, undefined, 42, 'string', true, []]) {
    assert.throws(
      () => assertF09CloudPrefixReceipt(bad),
      err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('must be an object')
    );
  }
});

test('assertF09CloudPrefixReceipt rejects invalid profile or workflowId', () => {
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ profile: 'local' })),
    err => err instanceof ProtocolError && err.message.includes('profile must be "huawei_ict_agentarts"')
  );

  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ workflowId: 'F10' })),
    err => err instanceof ProtocolError && err.message.includes('workflowId must be "F09"')
  );
});

test('assertF09CloudPrefixReceipt rejects invalid gatewayUrl', () => {
  const badGateways = [
    'http://insecure-gateway.example.com',
    'https://user:pass@gateway.example.com',
    'https://gateway.example.com/custom/path',
    'https://gateway.example.com?query=1',
    'https://gateway.example.com#hash',
    'not-a-url',
    12345,
  ];

  for (const gw of badGateways) {
    assert.throws(
      () => assertF09CloudPrefixReceipt(validReceipt({ gatewayUrl: gw })),
      err => err instanceof ProtocolError && err.message.includes('gatewayUrl')
    );
  }
});

test('assertF09CloudPrefixReceipt rejects invalid cloudPrefix', () => {
  const badPrefixes = [
    'no-leading-slash',
    '/has space/path',
    '/has?query=1',
    '/has#hash',
    '',
    123,
    null,
  ];

  for (const prefix of badPrefixes) {
    assert.throws(
      () => assertF09CloudPrefixReceipt(validReceipt({ cloudPrefix: prefix })),
      err => err instanceof ProtocolError && err.message.includes('cloudPrefix')
    );
  }
});

test('assertF09CloudPrefixReceipt rejects invalid runtimeName or prefixVerified', () => {
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ runtimeName: 'invalid space name' })),
    err => err instanceof ProtocolError && err.message.includes('runtimeName')
  );

  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ runtimeName: '' })),
    err => err instanceof ProtocolError && err.message.includes('runtimeName')
  );

  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ prefixVerified: 'true' })),
    err => err instanceof ProtocolError && err.message.includes('prefixVerified')
  );
});

test('assertF09CloudPrefixReceipt validates sessionAuth structure strictly', () => {
  // sessionAuth not object
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ sessionAuth: null })),
    err => err instanceof ProtocolError && err.message.includes('sessionAuth must be an object')
  );

  // Missing or empty sessionId
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ sessionAuth: { ...validReceipt().sessionAuth, sessionId: '' } })),
    err => err instanceof ProtocolError && err.message.includes('sessionId')
  );

  // Missing or empty authorizationRef
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ sessionAuth: { ...validReceipt().sessionAuth, authorizationRef: '  ' } })),
    err => err instanceof ProtocolError && err.message.includes('authorizationRef')
  );

  // Empty or invalid grantedScopes
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ sessionAuth: { ...validReceipt().sessionAuth, grantedScopes: [] } })),
    err => err instanceof ProtocolError && err.message.includes('grantedScopes')
  );
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ sessionAuth: { ...validReceipt().sessionAuth, grantedScopes: [''] } })),
    err => err instanceof ProtocolError && err.message.includes('grantedScopes')
  );

  // Invalid expiresAt
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ sessionAuth: { ...validReceipt().sessionAuth, expiresAt: 'invalid-date' } })),
    err => err instanceof ProtocolError && err.message.includes('expiresAt')
  );

  // Invalid sessionState
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ sessionAuth: { ...validReceipt().sessionAuth, sessionState: 'revoked' } })),
    err => err instanceof ProtocolError && err.message.includes('sessionState')
  );

  // Invalid grantedAt
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ sessionAuth: { ...validReceipt().sessionAuth, grantedAt: 'not-a-date' } })),
    err => err instanceof ProtocolError && err.message.includes('grantedAt')
  );
});

test('assertF09CloudPrefixReceipt strictly rejects mock readback and mock session auth', () => {
  // Reject mock: true on receipt
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ mock: true })),
    err => err instanceof ProtocolError && err.message.includes('rejects mock evidence')
  );

  // Reject isMock: true on receipt
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ isMock: true })),
    err => err instanceof ProtocolError && err.message.includes('rejects mock evidence')
  );

  // Reject evidenceLevel: 'mock' on receipt
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ evidenceLevel: 'mock' })),
    err => err instanceof ProtocolError && err.message.includes('rejects mock evidence')
  );

  // Reject mock: true on sessionAuth
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({
      sessionAuth: { ...validReceipt().sessionAuth, mock: true },
    })),
    err => err instanceof ProtocolError && err.message.includes('rejects mock authorization')
  );

  // Reject isMock: true on sessionAuth
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({
      sessionAuth: { ...validReceipt().sessionAuth, isMock: true },
    })),
    err => err instanceof ProtocolError && err.message.includes('rejects mock authorization')
  );
});

test('assertF09CloudPrefixReceipt validates optional fields correctly', () => {
  // Invalid deploymentVersion
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ deploymentVersion: 'bad version with spaces!' })),
    err => err instanceof ProtocolError && err.message.includes('deploymentVersion')
  );

  // Invalid observedAt
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ observedAt: 'invalid-date' })),
    err => err instanceof ProtocolError && err.message.includes('observedAt')
  );

  // Invalid evidenceLevel
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ evidenceLevel: 'fake' })),
    err => err instanceof ProtocolError && err.message.includes('evidenceLevel')
  );

  // Invalid cloudEvidence
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ cloudEvidence: 'yes' })),
    err => err instanceof ProtocolError && err.message.includes('cloudEvidence')
  );

  // Invalid nodes
  assert.throws(
    () => assertF09CloudPrefixReceipt(validReceipt({ nodes: ['F09_N01', 123] })),
    err => err instanceof ProtocolError && err.message.includes('nodes')
  );
});

test('planF09CloudPrefixAcceptance without receipt generates default offline unavailable plan', () => {
  const plan = planF09CloudPrefixAcceptance();

  assert.equal(plan.profile, 'huawei_ict_agentarts');
  assert.equal(plan.workflowId, 'F09');
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.closedLoop, false);
  assert.equal(plan.reason, F09_ACCEPTANCE_PENDING_REASON);
  assert.equal(plan.reason, '待真云验收');

  // Must have all default pending items with status 'unavailable' and reason '待真云验收'
  assert.ok(plan.pending.length >= 6);
  for (const item of plan.pending) {
    assert.equal(item.status, 'unavailable');
    assert.equal(item.reason, '待真云验收');
  }

  const items = plan.pending.map(p => p.item);
  assert.ok(items.includes('huawei_cloud_prefix_route_readback'));
  assert.ok(items.includes('cloud_session_auth_and_source_grant'));
  assert.ok(items.includes('real_feeds_provider_binding'));
  assert.ok(items.includes('agentarts_decision_model_inference'));
  assert.ok(items.includes('enqueue_research_cross_workflow_handoff'));
  assert.ok(items.includes('platform_independent_trace_and_cost'));

  assert.deepEqual(plan.nodesStatus.expectedNodes, [...F09_WORKFLOW_NODES]);
  assert.equal(plan.nodesStatus.missingNodes.length, 4);
});

test('planF09CloudPrefixAcceptance with valid receipt but no realCloudEvidence fails closed', () => {
  const receipt = validReceipt();
  const plan = planF09CloudPrefixAcceptance(receipt);

  assert.equal(plan.profile, 'huawei_ict_agentarts');
  assert.equal(plan.workflowId, 'F09');
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.closedLoop, false);
  assert.equal(plan.reason, '待真云验收');
  assert.equal(plan.cloudPrefix, '/invocations/f09');
  assert.equal(plan.runtimeName, 'pa-owned-bindings-0dae0ff5-api');

  // Pending items exist
  assert.ok(plan.pending.length >= 6);
  for (const p of plan.pending) {
    assert.equal(p.status, 'unavailable');
    assert.equal(p.reason, '待真云验收');
  }

  // Verified items reflect receipt structural checks
  assert.ok(plan.verified.some(v => v.includes('契约结构')));
  assert.ok(plan.verified.some(v => v.includes('云端前缀')));
  assert.ok(plan.verified.some(v => v.includes('会话授权')));
  assert.ok(plan.verified.some(v => v.includes('节点核验：覆盖 4/4')));
  assert.equal(plan.nodesStatus.missingNodes.length, 0);
});

test('planF09CloudPrefixAcceptance fails closed if cloudEvidence is false or prefixVerified is false', () => {
  const simulatedCloud = {
    authenticated: true,
    apiCallVerified: true,
    prefixRouteVerified: true,
    sessionAuthVerified: true,
    traceReadbackVerified: true,
  };

  // Even if realCloudEvidence is provided, receipt with cloudEvidence=false fails closed
  const plan1 = planF09CloudPrefixAcceptance({
    receipt: validReceipt({ cloudEvidence: false }),
    realCloudEvidence: simulatedCloud,
  });
  assert.equal(plan1.closedLoop, false);
  assert.equal(plan1.status, 'unavailable');

  // Even if realCloudEvidence is provided, receipt with prefixVerified=false fails closed
  const plan2 = planF09CloudPrefixAcceptance({
    receipt: validReceipt({ prefixVerified: false }),
    realCloudEvidence: simulatedCloud,
  });
  assert.equal(plan2.closedLoop, false);
  assert.equal(plan2.status, 'unavailable');
});

test('planF09CloudPrefixAcceptance checks head commit alignment', () => {
  const receipt = validReceipt({ sourceCommit: 'abcdef1234567890abcdef1234567890abcdef12' });

  // Matching head commit
  const planMatch = planF09CloudPrefixAcceptance({
    receipt,
    headCommit: 'abcdef12',
  });
  assert.equal(planMatch.headMatches, true);
  assert.ok(planMatch.verified.some(v => v.includes('代码对齐')));

  // Mismatched head commit
  const planMismatch = planF09CloudPrefixAcceptance({
    receipt,
    headCommit: '11223344',
  });
  assert.equal(planMismatch.headMatches, false);
  assert.ok(planMismatch.pending.some(p => p.item === 'head_commit_alignment'));
});

test('planF09CloudPrefixAcceptance supports custom pending items', () => {
  const plan = planF09CloudPrefixAcceptance({
    customPendingItems: ['custom_feed_topic_filter'],
  });
  assert.ok(plan.pending.some(p => p.item === 'custom_feed_topic_filter'));
});

test('planF09CloudPrefixAcceptance keeps closedLoop=false even when simulated real cloud evidence is provided (no online token attestation)', () => {
  // 依据 AGENTS.md 与可信验收规范：内存自报对象不构成华为云在线前缀端点映射与真实会话凭据。
  // 旧测试将纯 JS 形状等同于真云闭环属于不可信结论，收紧为 closedLoop: false，保留为严格负例。
  const receipt = validReceipt({
    sourceCommit: '4aa8f93f1234567890abcdef1234567890abcdef',
    cloudEvidence: true,
    prefixVerified: true,
    evidenceLevel: 'verified',
  });

  const plan = planF09CloudPrefixAcceptance({
    receipt,
    headCommit: '4aa8f93f',
    realCloudEvidence: {
      authenticated: true,
      apiCallVerified: true,
      prefixRouteVerified: true,
      sessionAuthVerified: true,
    },
  });

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.reason, '待真云验收');
  assert.ok(plan.pending.length >= 6);
  assert.equal(plan.headMatches, true);
  assert.ok(plan.limits.some(l => l.includes('closedLoop=false')));
});

test('planF09CloudPrefixAcceptance stays unavailable if partial realCloudEvidence provided', () => {
  const receipt = validReceipt();

  const plan = planF09CloudPrefixAcceptance({
    receipt,
    realCloudEvidence: {
      authenticated: true,
      apiCallVerified: true,
      prefixRouteVerified: false, // Incomplete!
      sessionAuthVerified: true,
    },
  });

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.reason, '待真云验收');
  assert.ok(plan.pending.length >= 6);
});

test('planF09CloudPrefixAcceptance cross-review blockers: rejects boolean realCloudEvidence, enforces prefixVerified and missingNodes coverage (simulated fixture)', () => {
  const receipt = validReceipt({
    sourceCommit: '4aa8f93f1234567890abcdef1234567890abcdef',
    nodes: ['F09_N01'], // missing F09_N02, F09_N03, F09_N04
    prefixVerified: false,
  });

  // Blocker 1: boolean realCloudEvidence must be rejected
  assert.throws(
    () => planF09CloudPrefixAcceptance({ receipt, realCloudEvidence: true }),
    err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('boolean is not supported')
  );

  // Blocker 2: prefixVerified !== true generates structural warning
  const planIncomplete = planF09CloudPrefixAcceptance({
    receipt,
    headCommit: '4aa8f93f',
    realCloudEvidence: {
      authenticated: true,
      apiCallVerified: true,
      prefixRouteVerified: true,
      sessionAuthVerified: true,
      // missing traceReadbackVerified
    },
  });
  assert.ok(planIncomplete.verified.some(v => v.includes('结构告警：回执中前缀路由尚未经端到端验证')));
  assert.ok(planIncomplete.verified.some(v => v.includes('结构告警：自报云证据对象未完整包含全部结构字段')));
  assert.equal(planIncomplete.structuralVerification?.fullyCovered, false);
  assert.ok(planIncomplete.structuralVerification?.missingFields.includes('prefixVerified'));
  assert.ok(planIncomplete.structuralVerification?.missingFields.includes('traceReadbackVerified'));

  // Blocker 3: missingNodes must be tracked in pending workflow_nodes_coverage
  assert.ok(planIncomplete.pending.some(p => p.item === 'workflow_nodes_coverage' && p.description.includes('缺失节点')));

  // Blocker 4: missing headCommit must keep head_commit_alignment pending
  const planNoHead = planF09CloudPrefixAcceptance({ receipt });
  assert.ok(planNoHead.pending.some(p => p.item === 'head_commit_alignment' && p.description.includes('未提供当前 HEAD 提交')));
});
