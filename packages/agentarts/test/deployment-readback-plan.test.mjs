import assert from 'node:assert/strict';
import test from 'node:test';
import { ProtocolError } from '@personal-agent/contracts';
import {
  assertDeploymentReadbackReceipt,
  parseDeploymentReadbackReceipt,
  planDeploymentAcceptance,
  DEPLOYMENT_ACCEPTANCE_PENDING_REASON,
} from '../dist/deployment-readback-plan.js';
import { getOwnedBindings } from '../dist/bindings.js';

function validReceipt(extra = {}) {
  return {
    profile: 'huawei_ict_agentarts',
    runtimeName: 'pa-owned-bindings-0dae0ff5-api',
    runtimeId: '9a65747e-05f0-475c-a2dc-f24dd3ed87ae',
    deploymentVersion: 'arm64-v5-4aa8f93f-r1',
    gatewayUrl: 'https://defaultgw-gztdqobzmm.cn-southwest-2.huaweicloud-agentarts.com',
    region: 'cn-southwest-2',
    sourceCommit: '4aa8f93f1234567890abcdef1234567890abcdef',
    runtimeStatus: 'normal',
    endpoint: 'Latest',
    image: 'swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned:workflow-v5-4aa8f93f',
    imageDigest: 'sha256:3a9b3ae236c0017ace23e89879bbdd37a8488cc2418059bb69bf5f0b4c2d3eae',
    observedAt: '2026-10-16T23:31:59.000Z',
    evidenceLevel: 'conditional',
    bindings: [
      '8004735c-cac6-4c09-9691-1a93233475ac',
      '71f3004f-faba-4487-9e6f-996194ec2b3c',
      'b74bbcd0-b8f6-4a73-b436-0676f952ac9a',
      '7d06153e-6262-4679-86ae-1914b38e11f3',
      'ed2363d9-b770-4ce5-a988-9bf0903466f7',
      '65236810-db21-41cb-928b-39af691c4cfa',
      '81bc9eb8-cf6a-4869-a1a2-e3b446349447',
      '998031d7-ec28-40ed-83e6-96667f22ff51',
      'ae641e4a-1524-4435-a132-c58fb13e288d',
      '32d4d44c-eade-4f3f-8f76-209c74609e79',
      '2f5d361c-bd85-4d2f-9903-bb35d4f55afa',
    ],
    ...extra,
  };
}

test('assertDeploymentReadbackReceipt validates full and minimal valid receipts', () => {
  const full = validReceipt();
  assert.doesNotThrow(() => assertDeploymentReadbackReceipt(full));

  // minimal receipt with required fields
  const minimal = {
    profile: 'huawei_ict_agentarts',
    runtimeName: 'runtime-1',
    runtimeId: 'id-1',
    deploymentVersion: 'v1.0.0',
    gatewayUrl: 'https://gateway.example.com',
    region: 'cn-southwest-2',
    sourceCommit: 'abcdef12',
    runtimeStatus: 'normal',
  };
  assert.doesNotThrow(() => assertDeploymentReadbackReceipt(minimal));

  // accepts gatewayOrigin
  const withOrigin = {
    ...minimal,
    gatewayUrl: undefined,
    gatewayOrigin: 'https://gateway.example.com',
  };
  delete withOrigin.gatewayUrl;
  assert.doesNotThrow(() => assertDeploymentReadbackReceipt(withOrigin));

  // accepts sourceCommitShort or sourceRevision
  const withShort = { ...minimal };
  delete withShort.sourceCommit;
  withShort.sourceCommitShort = 'abcdef12';
  assert.doesNotThrow(() => assertDeploymentReadbackReceipt(withShort));

  const withRevision = { ...minimal };
  delete withRevision.sourceCommit;
  withRevision.sourceRevision = 'rev-1234';
  assert.doesNotThrow(() => assertDeploymentReadbackReceipt(withRevision));
});

test('assertDeploymentReadbackReceipt rejects non-objects and invalid profile', () => {
  for (const bad of [null, undefined, 'receipt', 123, [], () => {}]) {
    assert.throws(
      () => assertDeploymentReadbackReceipt(bad),
      err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('object')
    );
  }

  const badProfile = validReceipt({ profile: 'local' });
  assert.throws(
    () => assertDeploymentReadbackReceipt(badProfile),
    err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('huawei_ict_agentarts')
  );

  const missingProfile = validReceipt();
  delete missingProfile.profile;
  assert.throws(
    () => assertDeploymentReadbackReceipt(missingProfile),
    err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('huawei_ict_agentarts')
  );
});

test('assertDeploymentReadbackReceipt rejects invalid runtimeName, runtimeId, deploymentVersion, region', () => {
  // bad runtimeName
  for (const badName of ['', '   ', 'invalid/name', 'name with spaces', 'a'.repeat(65), 123]) {
    assert.throws(
      () => assertDeploymentReadbackReceipt(validReceipt({ runtimeName: badName })),
      err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('runtimeName')
    );
  }

  // bad runtimeId
  for (const badId of ['', '   ', 123, null]) {
    assert.throws(
      () => assertDeploymentReadbackReceipt(validReceipt({ runtimeId: badId })),
      err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('runtimeId')
    );
  }

  // bad deploymentVersion
  for (const badVer of ['', 'bad version with space', 'v/1', 'a'.repeat(129), 123]) {
    assert.throws(
      () => assertDeploymentReadbackReceipt(validReceipt({ deploymentVersion: badVer })),
      err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('deploymentVersion')
    );
  }

  // bad region
  for (const badRegion of ['', '   ', 123]) {
    assert.throws(
      () => assertDeploymentReadbackReceipt(validReceipt({ region: badRegion })),
      err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('region')
    );
  }
});

test('assertDeploymentReadbackReceipt rejects invalid gatewayUrl', () => {
  // not HTTPS, has query, credentials, or path
  const badGateways = [
    'http://insecure-gateway.com',
    'https://user:pass@gateway.com',
    'https://gateway.com/some/path',
    'https://gateway.com?query=1',
    'https://gateway.com#hash',
    'not a url',
    123,
    null,
  ];

  for (const badUrl of badGateways) {
    assert.throws(
      () => assertDeploymentReadbackReceipt(validReceipt({ gatewayUrl: badUrl })),
      err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('gatewayUrl')
    );
  }
});

test('assertDeploymentReadbackReceipt rejects missing commit, invalid observedAt, imageDigest, bindings', () => {
  // missing commit
  const noCommit = validReceipt();
  delete noCommit.sourceCommit;
  delete noCommit.sourceRevision;
  delete noCommit.sourceCommitShort;
  assert.throws(
    () => assertDeploymentReadbackReceipt(noCommit),
    err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('sourceCommit')
  );

  // bad runtimeStatus
  assert.throws(
    () => assertDeploymentReadbackReceipt(validReceipt({ runtimeStatus: '' })),
    err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('runtimeStatus')
  );

  // bad observedAt
  assert.throws(
    () => assertDeploymentReadbackReceipt(validReceipt({ observedAt: 'not-a-date' })),
    err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('observedAt')
  );

  // bad imageDigest
  assert.throws(
    () => assertDeploymentReadbackReceipt(validReceipt({ imageDigest: 'md5:12345' })),
    err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('imageDigest')
  );

  // bad bindings
  assert.throws(
    () => assertDeploymentReadbackReceipt(validReceipt({ bindings: 'not-an-array' })),
    err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('bindings')
  );
  assert.throws(
    () => assertDeploymentReadbackReceipt(validReceipt({ bindings: [123] })),
    err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('bindings')
  );
});

test('parseDeploymentReadbackReceipt returns typed object or throws', () => {
  const receipt = validReceipt();
  const parsed = parseDeploymentReadbackReceipt(receipt);
  assert.equal(parsed.profile, 'huawei_ict_agentarts');
  assert.equal(parsed.deploymentVersion, 'arm64-v5-4aa8f93f-r1');

  assert.throws(() => parseDeploymentReadbackReceipt({ invalid: true }), ProtocolError);
});

test('planDeploymentAcceptance without real cloud evidence returns closedLoop=false and pending items with reason "待真云验收"', () => {
  const receipt = validReceipt();
  const plan = planDeploymentAcceptance(receipt);

  assert.equal(plan.profile, 'huawei_ict_agentarts');
  assert.equal(plan.closedLoop, false, 'Without real cloud evidence, closedLoop MUST be false');
  assert.equal(plan.status, 'unavailable', 'Status must be unavailable');
  assert.equal(plan.reason, DEPLOYMENT_ACCEPTANCE_PENDING_REASON);
  assert.equal(plan.reason, '待真云验收');

  assert.ok(Array.isArray(plan.pending) && plan.pending.length >= 6);
  for (const item of plan.pending) {
    assert.equal(item.status, 'unavailable');
    assert.equal(item.reason, '待真云验收', `Pending item ${item.item} must have reason "待真云验收"`);
  }

  const pendingItemKeys = plan.pending.map(p => p.item);
  assert.ok(pendingItemKeys.includes('huawei_cloud_credentials_readback'));
  assert.ok(pendingItemKeys.includes('runtime_head_deployment_verified'));
  assert.ok(pendingItemKeys.includes('owned_bindings_invocation_readback'));
  assert.ok(pendingItemKeys.includes('multi_agent_routing_and_inference'));
  assert.ok(pendingItemKeys.includes('platform_independent_trace_and_cost'));
  assert.ok(pendingItemKeys.includes('local_policy_evidence_closed_loop'));

  assert.ok(plan.verified.length >= 3);
  assert.ok(plan.limits.some(l => l.includes('未连接华为云')));
  assert.ok(plan.limits.some(l => l.includes('closedLoop=false')));
});

test('planDeploymentAcceptance enforces closedLoop=false when receipt indicates mock or cloudEvidence=false', () => {
  // mock evidenceLevel
  const mockPlan = planDeploymentAcceptance({
    receipt: validReceipt({ evidenceLevel: 'mock' }),
    realCloudEvidence: true, // caller cannot override mock receipt
  });
  assert.equal(mockPlan.closedLoop, false);
  assert.equal(mockPlan.status, 'unavailable');
  assert.equal(mockPlan.reason, '待真云验收');

  // cloudEvidence: false
  const noCloudPlan = planDeploymentAcceptance({
    receipt: validReceipt({ cloudEvidence: false }),
    realCloudEvidence: true,
  });
  assert.equal(noCloudPlan.closedLoop, false);
  assert.equal(noCloudPlan.status, 'unavailable');
  assert.equal(noCloudPlan.reason, '待真云验收');

  // realCloudEvidence: false explicitly
  const explicitFalsePlan = planDeploymentAcceptance({
    receipt: validReceipt(),
    realCloudEvidence: false,
  });
  assert.equal(explicitFalsePlan.closedLoop, false);
  assert.equal(explicitFalsePlan.status, 'unavailable');
  assert.equal(explicitFalsePlan.reason, '待真云验收');
});

test('planDeploymentAcceptance verifies HEAD commit alignment', () => {
  const receipt = validReceipt({
    sourceCommit: '4aa8f93f1234567890abcdef1234567890abcdef',
  });

  // Matching HEAD commit (short prefix or exact)
  const matchPlan = planDeploymentAcceptance({
    receipt,
    headCommit: '4aa8f93f',
  });
  assert.equal(matchPlan.headMatches, true);
  assert.ok(matchPlan.verified.some(v => v.includes('代码对齐')));

  // Mismatched HEAD commit
  const mismatchPlan = planDeploymentAcceptance({
    receipt,
    headCommit: '0e7f3aa1differentcommit',
    realCloudEvidence: true, // even if cloud was claimed, commit mismatch prevents closed loop
  });
  assert.equal(mismatchPlan.headMatches, false);
  assert.equal(mismatchPlan.closedLoop, false);
  assert.equal(mismatchPlan.status, 'unavailable');
  assert.equal(mismatchPlan.reason, '待真云验收');
  assert.ok(mismatchPlan.pending.some(p => p.item === 'head_commit_alignment'));
});

test('planDeploymentAcceptance checks owned bindings coverage', () => {
  const allBindings = getOwnedBindings();
  assert.equal(allBindings.length, 11, 'Expected 11 owned bindings (8 workflows + 3 controllers)');

  // All 11 bindings present
  const fullPlan = planDeploymentAcceptance(validReceipt());
  assert.equal(fullPlan.bindingsStatus.expectedCount, 11);
  assert.equal(fullPlan.bindingsStatus.verifiedCount, 11);
  assert.deepEqual(fullPlan.bindingsStatus.missingBindings, []);

  // Partial bindings
  const partialReceipt = validReceipt({
    bindings: ['8004735c-cac6-4c09-9691-1a93233475ac'],
  });
  const partialPlan = planDeploymentAcceptance(partialReceipt);
  assert.equal(partialPlan.bindingsStatus.expectedCount, 11);
  assert.equal(partialPlan.bindingsStatus.verifiedCount, 1);
  assert.equal(partialPlan.bindingsStatus.missingBindings.length, 10);
});

test('planDeploymentAcceptance supports options object and two-argument form', () => {
  const receipt = validReceipt();

  // Single options object
  const planA = planDeploymentAcceptance({
    receipt,
    headCommit: '4aa8f93f',
    customPendingItems: ['custom_probe_item'],
  });
  assert.equal(planA.closedLoop, false);
  assert.ok(planA.pending.some(p => p.item === 'custom_probe_item' && p.reason === '待真云验收'));

  // Two arguments form
  const planB = planDeploymentAcceptance(receipt, {
    headCommit: '4aa8f93f',
    customPendingItems: ['custom_probe_item'],
  });
  assert.equal(planB.closedLoop, false);
  assert.ok(planB.pending.some(p => p.item === 'custom_probe_item' && p.reason === '待真云验收'));
});

test('planDeploymentAcceptance rejects invalid receipt with ProtocolError', () => {
  assert.throws(
    () => planDeploymentAcceptance({ bad: true }),
    err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT'
  );

  assert.throws(
    () => planDeploymentAcceptance({ receipt: { bad: true } }),
    err => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT'
  );
});

test('planDeploymentAcceptance marks closedLoop=true only when authenticated real cloud evidence is simulated', () => {
  const receipt = validReceipt({
    sourceCommit: '4aa8f93f1234567890abcdef1234567890abcdef',
  });
  const plan = planDeploymentAcceptance({
    receipt,
    headCommit: '4aa8f93f',
    realCloudEvidence: {
      authenticated: true,
      apiCallVerified: true,
      accountBound: true,
      traceReadbackVerified: true,
    },
  });

  assert.equal(plan.closedLoop, true);
  assert.equal(plan.status, 'verified');
  assert.equal(plan.reason, '已验证真实云端读回');
  assert.deepEqual(plan.pending, []);
});
