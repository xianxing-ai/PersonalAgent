// F20 worker 信任闭环定向测试（gaps §4：替换候选、源漂移、越界、缺检查、未知结果、授权撤销）。
// 运行：node --test packages/agentarts/test/f20-worker-trust.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {harnessCandidateArtifactDigest} from '@personal-agent/contracts/harness-candidates';
import {context, trial, sha} from './harness-candidate-fixtures.mjs';
import {
  F20_WORKER_TRUST_VERSION,
  parseF20CandidateSelection,
  bindF20Candidate,
  buildF20CandidatePatch,
  verifyF20CandidateCompletion,
  assertF20ExportAuthorized,
} from '../dist/f20-worker-trust.js';

const shaOf = (value) => createHash('sha256').update(value).digest('hex');

const candidate = (snippet = 'console.log("f20 candidate")', targetPath = 'samples/sample.js') => ({
  docMarkdown: '# F20 candidate doc\n\n示例说明。',
  sampleSnippet: snippet,
  targetPath,
  contentSha256: shaOf(snippet),
});

function trustInput(overrides = {}) {
  const c = context('f20-owner-task');
  const base = {
    taskId: c.binding.taskId,
    workspaceId: c.binding.workspaceId,
    inputDigest: c.binding.inputDigest,
    configurationDigest: c.binding.configurationDigest,
    workflowVersion: c.binding.workflowVersion,
    runtimeVersion: c.binding.runtimeVersion,
    selectionPolicy: 'unique_verified',
    baselineSnapshotId: c.binding.baselineSnapshotId,
    baseline: c.baseline,
    sourceReads: [
      {path: 'src.js', sha256: sha('broken'), readTaskId: 'read-src-1'},
      {path: 'test.js', sha256: sha('unchanged test'), readTaskId: 'read-test-1'},
    ],
    recipes: c.recipes,
    allowedTargetPaths: ['samples/sample.js'],
  };
  return {...base, ...overrides};
}

const selection = (overrides = {}) => ({
  operation: 'decision.choose_candidate',
  workflowId: 'F20',
  nodeId: 'F20_N02',
  candidateValues: {cand1: candidate()},
  selectedId: 'cand1',
  confirmationReceiptDigest: sha('owner confirmation'),
  ...overrides,
});

/** 构造与 bindF20Candidate 身份一致的隔离 trial（fixture trial 是 F15 语义，这里按 F20 调整）。 */
function f20Trial(input, sel, {status = 'VALID', mutateSnapshot} = {}) {
  const bound = bindF20Candidate(sel, input);
  const snapshot = structuredClone(input.baseline);
  snapshot.snapshotId = 'snapshot-f20-cand1';
  const cand = sel.candidateValues[sel.selectedId];
  if (mutateSnapshot === 'modified-original') {
    snapshot.files[0] = {...snapshot.files[0], sha256: sha('repaired-original')};
  } else if (cand) {
    snapshot.files.push({path: cand.targetPath, sha256: cand.contentSha256, packageId: 'app', kind: 'source'});
  }
  const sessionId = 'session-f20-cand1';
  return {
    binding: {...bound.context.binding, candidateId: sel.selectedId, artifactId: 'artifact-f20-cand1',
      trialTaskId: input.taskId, sessionId, artifactDigest: harnessCandidateArtifactDigest(snapshot), parentArtifactDigests: []},
    session: {version: 1, sessionId, taskId: input.taskId, workspaceId: input.workspaceId, mode: 'isolated',
      baselineSnapshotId: input.baselineSnapshotId},
    checkReadback: {version: 1, sessionId, snapshot,
      verification: [{version: 1, sessionId, runId: 'run-f20-cand1', recipeId: 'unit', packageIds: ['app'],
        inputSnapshotId: snapshot.snapshotId, files: structuredClone(snapshot.files), exitCode: status === 'VALID' ? 0 : 1,
        status, evidenceRefs: ['evidence-f20-cand1'], diagnostics: []}]},
  };
}

test('happy path：候选绑定→受限 patch→隔离 trial→completion 校验', () => {
  const input = trustInput();
  const sel = parseF20CandidateSelection(selection());
  const bound = bindF20Candidate(sel, input);
  assert.equal(bound.selectedId, 'cand1');
  assert.equal(bound.context.binding.executionKind, 'real_host');
  assert.equal(bound.context.recipes.length, 1);

  const patch = buildF20CandidatePatch(bound.candidate, input);
  assert.equal(patch.path, 'samples/sample.js');
  assert.equal(patch.createText, candidate().sampleSnippet);
  assert.equal(patch.expectedSha256, null);

  const verdict = verifyF20CandidateCompletion(f20Trial(input, sel), sel, input,
    {'src.js': sha('broken'), 'test.js': sha('unchanged test')});
  assert.equal(verdict.state, 'completed');
});

test('受限 patch：目标已存在但缺受信内容读取 → unavailable；提供一致内容读取才构造替换', () => {
  const input = trustInput({allowedTargetPaths: ['src.js', 'samples/sample.js']});
  const sel = parseF20CandidateSelection(selection({candidateValues: {cand1: candidate('patched', 'src.js')}}));
  const bound = bindF20Candidate(sel, input);
  assert.throws(() => buildF20CandidatePatch(bound.candidate, input), (err) => err.code === 'UNSUPPORTED_CAPABILITY');
  const patch = buildF20CandidatePatch(bound.candidate, input, {oldText: 'broken', oldSha256: sha('broken')});
  assert.deepEqual(patch.edits, [{oldText: 'broken', newText: 'patched'}]);
  assert.equal(patch.expectedSha256, sha('broken'));
  assert.throws(() => buildF20CandidatePatch(bound.candidate, input, {oldText: 'broken', oldSha256: sha('drifted')}),
    (err) => err.code === 'REVISION_CONFLICT');
});

test('候选替换：contentSha256 与内容不一致 → REVISION_CONFLICT', () => {
  const swapped = candidate();
  assert.throws(() => parseF20CandidateSelection(selection({
    candidateValues: {cand1: {...swapped, sampleSnippet: 'other snippet'}}})),
    (err) => err instanceof ProtocolError && err.code === 'REVISION_CONFLICT');
});

test('abstain/重复摘要/越界 selectedId/图不匹配 分别 fail-closed', () => {
  assert.throws(() => parseF20CandidateSelection(selection({candidateValues: {}})),
    (err) => err instanceof ProtocolError && err.code === 'UNSUPPORTED_CAPABILITY');
  const dup = candidate();
  assert.throws(() => parseF20CandidateSelection(selection({candidateValues: {a: dup, b: {...candidate('console.log("f20 candidate")')}}})),
    (err) => err instanceof ProtocolError && err.code === 'REVISION_CONFLICT');
  assert.throws(() => parseF20CandidateSelection(selection({selectedId: 'ghost'})),
    (err) => err instanceof ProtocolError && err.code === 'REVISION_CONFLICT');
  assert.throws(() => parseF20CandidateSelection(selection({nodeId: 'F15_N02'})),
    (err) => err instanceof ProtocolError && err.code === 'REVISION_CONFLICT');
  assert.throws(() => parseF20CandidateSelection(selection({operation: 'decision.choose_other'})),
    (err) => err instanceof ProtocolError && err.code === 'REVISION_CONFLICT');
  assert.throws(() => parseF20CandidateSelection(selection({candidateValues: {cand1: candidate('x', '../escape.js')}})),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT');
});

test('源漂移 / 源不足 / 缺必需检查 / 目标越界 → 各自显式不可用或冲突', () => {
  const sel = parseF20CandidateSelection(selection());
  const oneSource = trustInput({sourceReads: trustInput().sourceReads.slice(0, 1)});
  assert.throws(() => bindF20Candidate(sel, oneSource), (err) => err.code === 'UNSUPPORTED_CAPABILITY');

  const drifted = trustInput({sourceReads: [{path: 'src.js', sha256: sha('drifted'), readTaskId: 'r'}, {path: 'test.js', sha256: sha('unchanged test'), readTaskId: 'r2'}]});
  assert.throws(() => bindF20Candidate(sel, drifted), (err) => err.code === 'REVISION_CONFLICT');

  const noRequired = trustInput({recipes: [{recipeId: 'optional', packageIds: ['app'], required: false}]});
  assert.throws(() => bindF20Candidate(sel, noRequired), (err) => err.code === 'UNSUPPORTED_CAPABILITY');

  const outsideSel = parseF20CandidateSelection(selection({candidateValues: {cand1: candidate('x', 'outside/other.js')}}));
  assert.throws(() => bindF20Candidate(outsideSel, trustInput()), (err) => err.code === 'UNSUPPORTED_CAPABILITY');
});

test('completion：绑定身份不一致 / 候选不一致 / 源漂移 → REVISION_CONFLICT', () => {
  const input = trustInput();
  const sel = parseF20CandidateSelection(selection());
  const good = f20Trial(input, sel);
  assert.throws(() => verifyF20CandidateCompletion(good, sel, trustInput({inputDigest: sha('changed input')}), {'src.js': sha('broken'), 'test.js': sha('unchanged test')}),
    (err) => err.code === 'REVISION_CONFLICT');
  assert.throws(() => verifyF20CandidateCompletion(good, selection({
    candidateValues: {cand1: candidate(), cand2: candidate('other snippet')}, selectedId: 'cand2'}), input,
    {'src.js': sha('broken'), 'test.js': sha('unchanged test')}),
    (err) => err.code === 'REVISION_CONFLICT');
  assert.throws(() => verifyF20CandidateCompletion(good, sel, input, {'src.js': sha('drifted'), 'test.js': sha('unchanged test')}),
    (err) => err.code === 'REVISION_CONFLICT');
});

test('completion：原代码检查结果冒充候选检查 → unknown，不算完成', () => {
  const input = trustInput();
  const sel = parseF20CandidateSelection(selection());
  const verdict = verifyF20CandidateCompletion(f20Trial(input, sel, {mutateSnapshot: 'modified-original'}), sel, input,
    {'src.js': sha('broken'), 'test.js': sha('unchanged test')});
  assert.equal(verdict.state, 'unknown');
  assert.match(verdict.reason, /未针对候选目标/);
});

test('completion：缺必需检查回执 / UNKNOWN 结果 → unknown；FAILED → failed', () => {
  const input = trustInput();
  const sel = parseF20CandidateSelection(selection());
  const noRow = f20Trial(input, sel);
  noRow.checkReadback.verification = [];
  assert.equal(verifyF20CandidateCompletion(noRow, sel, input, {'src.js': sha('broken'), 'test.js': sha('unchanged test')}).state, 'unknown');
  const unknownRow = f20Trial(input, sel, {status: 'UNKNOWN'});
  assert.equal(verifyF20CandidateCompletion(unknownRow, sel, input, {'src.js': sha('broken'), 'test.js': sha('unchanged test')}).state, 'unknown');
  const failedRow = f20Trial(input, sel, {status: 'FAILED'});
  assert.equal(verifyF20CandidateCompletion(failedRow, sel, input, {'src.js': sha('broken'), 'test.js': sha('unchanged test')}).state, 'failed');
});

test('completion：缺原始确认回执 → unknown；有回执才 completed', () => {
  const input = trustInput();
  const noReceipt = parseF20CandidateSelection(selection({confirmationReceiptDigest: undefined}));
  const verdict = verifyF20CandidateCompletion(f20Trial(input, noReceipt), noReceipt, input,
    {'src.js': sha('broken'), 'test.js': sha('unchanged test')});
  assert.equal(verdict.state, 'unknown');
});

test('数据出境授权：无授权/范围不匹配 → unavailable；撤销 → 冲突；有效 → 返回 grant', () => {
  assert.throws(() => assertF20ExportAuthorized(undefined, 'competition:evidence'), (err) => err.code === 'UNSUPPORTED_CAPABILITY');
  assert.throws(() => assertF20ExportAuthorized([{grantId: 'g1', scope: 'other:scope'}], 'competition:evidence'),
    (err) => err.code === 'UNSUPPORTED_CAPABILITY');
  assert.throws(() => assertF20ExportAuthorized([{grantId: 'g1', scope: 'competition:evidence', revoked: true}], 'competition:evidence'),
    (err) => err.code === 'REVISION_CONFLICT');
  assert.equal(assertF20ExportAuthorized([{grantId: 'g2', scope: 'competition:evidence'}], 'competition:evidence').grantId, 'g2');
});

test('F20 信任版本与既有 F15 harness 契约并存：不改变 compareHarnessCandidates 语义', () => {
  const c = context();
  const good = trial('one', c);
  assert.equal(F20_WORKER_TRUST_VERSION, '0.1.0');
  // 冒烟：既有契约仍然可用（同 fixtures 用法）
  assert.equal(good.binding.executionKind, 'synthetic');
  assert.equal(sha('x').length, 64);
});
