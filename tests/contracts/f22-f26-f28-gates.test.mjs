// F22/F26/F28 门控契约校验（main 侧可测面）。
// 范围说明：runtime 侧 F22/F26/F28 worker 工厂在 #531 堆叠链（未进 main），其门控修复在 #571；
// 本文件只校验 main 上已存在的门控面：agentarts shadow release/policy（F22/F23）与既有验收语义。
// 运行：node --test tests/contracts/f22-f26-f28-gates.test.mjs

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  parseWorkflowSelectionResult,
  verifyWorkflowShadowBranches,
} from '@personal-agent/agentarts';
import {
  createWorkflowShadowReleaseService,
  createWorkflowShadowReleaseAdapter,
  createWorkflowShadowReleaseReadbackAdapter,
} from '@personal-agent/agentarts';

const here = dirname(fileURLToPath(import.meta.url));

const context = (overrides = {}) => ({
  authorizationRef: 'grant-1',
  scopes: ['workflow:shadow_release'],
  deadline: new Date(Date.now() + 60_000).toISOString(),
  signal: new AbortController().signal,
  ...overrides,
});

const branchReceipt = (branch, overrides = {}) => ({
  receiptId: `receipt-${branch}`,
  taskKey: 'task-1',
  taskClass: 'research',
  decisionRef: 'decision-1',
  branch,
  candidateId: `cand-${branch}`,
  workspaceRef: `workspace-${branch}`,
  qualityMetricId: 'quality:demo',
  baselineSha256: 'a'.repeat(64),
  conditionsDigest: 'b'.repeat(64),
  resultSha256: 'c'.repeat(64),
  qualityScore: 0.8,
  wallMs: 100,
  modelCalls: 2,
  evidenceRefs: ['evidence-1'],
  ...overrides,
});

const acceptance = () => ({
  policyId: 'policy-1',
  revision: 1,
  configurationId: 'config-1',
  taskClass: 'research',
  validFrom: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  baseline: {revision: 3, version: 'v3', parametersDigest: 'd'.repeat(64), resultBaselineSha256: 'a'.repeat(64)},
  candidate: {version: 'v4', parametersDigest: 'e'.repeat(64)},
  conditionsDigest: 'b'.repeat(64),
  qualityMetricId: 'quality:demo',
  metricRules: [{metric: 'qualityScore', bound: 'min_delta', value: 0}],
  requiredChecks: ['check-1'],
});

const fullService = () => createWorkflowShadowReleaseService({
  requiredScopes: ['workflow:shadow_release'],
  configurationPort: {
    read: async () => undefined,
    readOperation: async () => ({state: 'not_started'}),
    compareAndSet: async () => ({state: 'not_started'}),
  },
  acceptance: acceptance(),
  verifyBranch: async () => true,
  verifyComparable: async () => true,
  verifyTestEvidence: async () => true,
});

test('F22/F23 release service：未配置齐全时一律 unavailable，并明列缺失项，不伪装成功', async () => {
  const service = createWorkflowShadowReleaseService({requiredScopes: ['workflow:shadow_release']});
  const status = service.status();
  assert.equal(status.state, 'unavailable');
  for (const missing of ['existing configuration CAS/readOperation port', 'trusted acceptance configuration',
    'branch receipt verifier', 'trusted full-context pair verifier', 'test Evidence verifier']) {
    assert.ok(status.missingConfiguration.includes(missing), `缺失项应被列出：${missing}`);
  }
  const evaluation = await service.evaluate({
    action: 'promote', operationId: 'op-1', configurationId: 'config-1',
    main: branchReceipt('main'), shadow: branchReceipt('shadow'),
    testEvidence: {evidenceId: 'e', configurationId: 'config-1', version: 'v4', parametersDigest: 'e'.repeat(64),
      policyId: 'policy-1', policyRevision: 1, baselineSha256: 'a'.repeat(64), conditionsDigest: 'b'.repeat(64),
      observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      checks: [{id: 'check-1', state: 'passed'}], proof: {}},
    candidateParameters: {},
  }, context());
  assert.equal(evaluation.ready, false);
  assert.equal(evaluation.reason, 'configuration_unavailable');
  const receipt = await service.execute({
    action: 'promote', operationId: 'op-2', configurationId: 'config-1',
    main: branchReceipt('main'), shadow: branchReceipt('shadow'),
    testEvidence: {}, candidateParameters: {},
  }, context());
  assert.equal(receipt.state, 'unavailable');
});

test('F22/F23 release service：无原 Runtime 授权/超时/取消分别 SCOPE_DENIED/TIMEOUT/CANCELLED，不静默放行', async () => {
  const service = fullService();
  const request = {action: 'promote', operationId: 'op-3', configurationId: 'config-1',
    main: branchReceipt('main'), shadow: branchReceipt('shadow'), testEvidence: {}, candidateParameters: {}};
  await assert.rejects(() => service.execute(request, context({authorizationRef: undefined})),
    (err) => err.code === 'SCOPE_DENIED');
  await assert.rejects(() => service.execute(request, context({scopes: ['other:scope']})),
    (err) => err.code === 'SCOPE_DENIED');
  await assert.rejects(() => service.execute(request, context({deadline: new Date(Date.now() - 1000).toISOString()})),
    (err) => err.code === 'TIMEOUT');
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(() => service.execute(request, context({signal: aborted.signal})),
    (err) => err.code === 'CANCELLED');
});

test('F22 shadow 分支回执：畸形/未受信验证一律 UNAUTHORIZED，模型自证不构成验证', async () => {
  await assert.rejects(() => verifyWorkflowShadowBranches([branchReceipt('main'), branchReceipt('shadow')], async () => false),
    (err) => err.code === 'UNAUTHORIZED');
  const malformed = branchReceipt('main', {qualityScore: '0.9'});
  await assert.rejects(() => verifyWorkflowShadowBranches([malformed, branchReceipt('shadow')], async () => true),
    (err) => err.code === 'UNAUTHORIZED');
  const noEvidence = branchReceipt('shadow', {evidenceRefs: []});
  await assert.rejects(() => verifyWorkflowShadowBranches([branchReceipt('main'), noEvidence], async () => true),
    (err) => err.code === 'UNAUTHORIZED');
});

test('F22 shadow 选取结果：严格解析，畸形 metadata/未知字段 fail-closed；advisory 语义不变', () => {
  assert.throws(() => parseWorkflowSelectionResult({selectedId: ''}));
  assert.throws(() => parseWorkflowSelectionResult({selectedId: 'a', metadata: {shadowPlan: {nope: 1}}}));
  assert.throws(() => parseWorkflowSelectionResult({selectedId: 'a', extra: 1}));
  const legacy = parseWorkflowSelectionResult('candidate-a', ['candidate-a', 'candidate-b']);
  assert.equal(legacy.selectedId, 'candidate-a');
});

test('F23_N04/N05 adapter：必须声明真实写副作用；N04 写、N05 只读，输出状态枚举含 unavailable', () => {
  const service = fullService();
  assert.throws(() => createWorkflowShadowReleaseAdapter(service, undefined));
  assert.throws(() => createWorkflowShadowReleaseAdapter(service, {sideEffect: 'read'}), /side effect/);
  const writeAdapter = createWorkflowShadowReleaseAdapter(service, {sideEffect: 'local_write'});
  assert.equal(writeAdapter.descriptor.name, 'workflow.host.f23_n04');
  assert.equal(writeAdapter.descriptor.sideEffect, 'local_write');
  const readAdapter = createWorkflowShadowReleaseReadbackAdapter(service);
  assert.equal(readAdapter.descriptor.name, 'workflow.host.f23_n05');
  assert.equal(readAdapter.descriptor.sideEffect, 'read');
  for (const adapter of [writeAdapter, readAdapter]) {
    assert.ok(JSON.stringify(adapter.descriptor.outputSchema).includes('unavailable'), '输出 Schema 必须保留 unavailable 状态');
  }
});

// runtime 侧 F22/F26/F28 工厂门控（unavailable/端口抛错/畸形数据/导出拒绝/读回漂移/READY 与探针分离/取消码保留）
// 在 #531 堆叠链 + #571 修复中覆盖（apps/desktop/test/f22-f26-f28-readback-gates.test.mjs，64/64）。
// 合并顺序由仓库合并队列决定；真实 shadow 服务、AgentArts 真实部署读回与真实模型原生能力读回仍待真云验收。
