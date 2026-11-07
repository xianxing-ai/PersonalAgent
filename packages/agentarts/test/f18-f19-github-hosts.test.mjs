// F18/F19 平台绑定读回 host 端口定向测试。
// 运行：node --test packages/agentarts/test/f18-f19-github-hosts.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGithubBoundPrDiffHostPort,
  createGithubMergeGateHostPort,
  createGithubIssueSnapshotHostPort,
  createGithubMergedRepairReadbackHostPort,
} from '../dist/f18-f19-github-hosts.js';

const deadline = new Date(Date.now() + 60_000).toISOString();
const signal = new AbortController().signal;
const context = (overrides = {}) => ({
  template: {workflowId: 'F18'},
  node: {id: 'F18_N01'},
  input: {},
  predecessorOutputs: {},
  availableTools: [],
  predecessorStates: {},
  deadline, signal, requestId: 'request-1', mode: 'ordinary', namespace: 'session-1',
  ...overrides,
});

const binding = {owner: 'xianxing-ai', repo: 'PersonalAgent', number: 585};
const fakeRead = (responses) => ({
  execute: async (operation, input) => {
    if (!['pr.get', 'pr.diff', 'issue.get'].includes(operation)) throw new Error(`非法操作 ${operation}`);
    return responses[operation](input);
  },
});

test('F18_N01 bound_pr_diff：绑定读回 + 有界 diff + 指纹；绑定不匹配 → failed', async () => {
  const port = createGithubBoundPrDiffHostPort({
    read: fakeRead({
      'pr.get': async () => ({number: 585, repository: 'xianxing-ai/PersonalAgent', headSha: 'abc123', state: 'open'}),
      'pr.diff': async () => 'diff --git a/x b/x\n',
    }),
    resolveBinding: () => ({...binding}),
  });
  const result = await port.read(context());
  assert.equal(result.state, 'completed');
  assert.equal(result.value.binding.number, 585);
  assert.equal(result.value.source, 'platform_readback');
  assert.equal(result.value.diffSha256.length, 64);
  assert.equal(result.value.truncated, false);
  assert.equal(result.value.headSha, 'abc123');

  const mismatch = createGithubBoundPrDiffHostPort({
    read: fakeRead({'pr.get': async () => ({number: 999}), 'pr.diff': async () => ''}),
    resolveBinding: () => ({...binding}),
  });
  assert.equal((await mismatch.read(context())).value.reason, 'pr_binding_mismatch');
});

test('F18_N04 merge gate：平台字段真实读回；字段缺失 → unknown，不猜测；无绑定 → unavailable', async () => {
  const port = createGithubMergeGateHostPort({
    read: fakeRead({'pr.get': async () => ({number: 585, mergeable: true, mergeStateStatus: 'CLEAN', headSha: 'abc'})}),
    resolveBinding: () => ({...binding}),
  });
  const result = await port.read(context());
  assert.equal(result.state, 'completed');
  assert.equal(result.value.mergeable, true);
  assert.equal(result.value.mergeStateStatus, 'CLEAN');
  assert.equal(result.value.source, 'platform_readback');

  const missing = createGithubMergeGateHostPort({
    read: fakeRead({'pr.get': async () => ({number: 585})}),
    resolveBinding: () => ({...binding}),
  });
  const unknownResult = await missing.read(context());
  assert.equal(unknownResult.state, 'unknown');
  assert.equal(unknownResult.value.reason, 'merge_gate_fields_missing');

  const noBinding = createGithubMergeGateHostPort({read: fakeRead({'pr.get': async () => ({})}), resolveBinding: () => undefined});
  assert.equal((await noBinding.read(context())).state, 'unavailable');
});

test('F19_N01 issue_snapshot：快照有界；F19_N04 merged_repair_readback：合并状态真实读回，未合并如实报告', async () => {
  const snapshot = createGithubIssueSnapshotHostPort({
    read: fakeRead({'issue.get': async () => ({number: 100, repository: 'xianxing-ai/PersonalAgent', state: 'open', title: 't', labels: [{name: 'bug'}, 'triage'], updatedAt: '2026-11-07T00:00:00Z'})}),
    resolveBinding: () => ({...binding, number: 100}),
  });
  const snap = await snapshot.read(context());
  assert.equal(snap.state, 'completed');
  assert.deepEqual(snap.value.labels, ['bug', 'triage']);
  assert.equal(snap.value.state, 'open');

  const repair = createGithubMergedRepairReadbackHostPort({
    read: fakeRead({'pr.get': async (_input) => ({number: 585, merged: false, state: 'open'})}),
    resolveBinding: () => ({issue: {...binding, number: 100}, repairPr: 585}),
  });
  const notMerged = await repair.read(context());
  assert.equal(notMerged.state, 'completed');
  assert.equal(notMerged.value.merged, false);
  assert.match(notMerged.value.note, /尚未合并/);

  const mergedPort = createGithubMergedRepairReadbackHostPort({
    read: fakeRead({'pr.get': async () => ({number: 585, merged: true, state: 'closed', mergedAt: '2026-11-07T01:00:00Z'})}),
    resolveBinding: () => ({issue: {...binding, number: 100}, repairPr: 585}),
  });
  assert.equal((await mergedPort.read(context())).value.merged, true);

  const wrongPr = createGithubMergedRepairReadbackHostPort({
    read: fakeRead({'pr.get': async () => ({number: 1})}),
    resolveBinding: () => ({issue: {...binding, number: 100}, repairPr: 585}),
  });
  assert.equal((await wrongPr.read(context())).value.reason, 'repair_binding_mismatch');
});

test('平台读失败 → failed；取消信号穿透；非法操作被拒绝；构造缺参 → TypeError', async () => {
  const failing = createGithubBoundPrDiffHostPort({
    read: fakeRead({'pr.get': async () => {throw new Error('net down');}, 'pr.diff': async () => ''}),
    resolveBinding: () => ({...binding}),
  });
  assert.equal((await failing.read(context())).value.reason, 'platform_read_failed');

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(() => failing.read(context({signal: aborted.signal})));

  await assert.rejects(() => fakeRead({}).execute('issue.label', {}, context()), /非法操作/);
  assert.throws(() => createGithubBoundPrDiffHostPort({resolveBinding: () => ({...binding})}), TypeError);
  assert.throws(() => createGithubIssueSnapshotHostPort({read: fakeRead({})}), TypeError);
});
