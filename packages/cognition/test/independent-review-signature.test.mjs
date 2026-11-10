// F15 真人独立审核签名定向测试。
// 真人签名动作与实机 WinForms 目视为现场验收（待真机）；本文件只验绑定/验证语义。
// 运行：node --test packages/cognition/test/independent-review-signature.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {
  reviewPacketSha256,
  createIndependentReviewRecord,
  verifyIndependentReviewRecord,
} from '../dist/independent-review-signature.js';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const deadline = '2026-11-07T08:01:00Z';
const signal = new AbortController().signal;
const nowMs = () => Date.parse('2026-11-07T08:00:00Z');
const now = () => new Date('2026-11-07T08:00:00Z');

const packet = {
  taskId: 'task-1',
  workspaceId: 'ws-1',
  patchSha256: sha('patch bytes'),
  checkResultsSha256: sha('check results'),
  scopeDecision: 'approved',
  scopeReason: 'patch 只限声明文件',
  authorId: 'agent-session-1',
  workSessionId: 'session-1',
  evidenceRefs: ['evidence-patch-1', 'evidence-checks-1'],
};

const signer = {
  sign: async (packetSha256, reviewer) => `sig:${reviewer.id}:${packetSha256.slice(0, 12)}`,
};

test('happy path：产生审核记录且包摘要绑定；验证通过', async () => {
  const record = await createIndependentReviewRecord({
    packet, reviewer: {id: 'human-reviewer-1', sessionId: 'review-session-1'},
    decision: 'approved', signer, context: {deadline, signal}, now,
  });
  assert.equal(record.acceptance, 'pending_real_review');
  assert.equal(record.packetSha256, reviewPacketSha256(packet));
  assert.equal(verifyIndependentReviewRecord(record, {packet, now: nowMs}).valid, true);
  assert.equal(verifyIndependentReviewRecord(record, {packet, now: nowMs}).reason, 'verified');
  // 验证签名端口口径：摘要变了签名必须失效
  const rejected = verifyIndependentReviewRecord(record, {packet, now, verifySignature: (d, r) => r.signature.startsWith('sig:human-reviewer-1:') && d === r.packetSha256});
  assert.equal(rejected.valid, true);
  const badSigner = verifyIndependentReviewRecord(record, {packet, now, verifySignature: () => false});
  assert.equal(badSigner.valid, false);
  assert.equal(badSigner.reason, 'signature_invalid');
});

test('独立性：审核者=作者、审核会话=工作会话 → 产生阶段直接拒绝，无记录', async () => {
  await assert.rejects(() => createIndependentReviewRecord({
    packet, reviewer: {id: packet.authorId, sessionId: 'review-session-1'},
    decision: 'approved', signer, context: {deadline, signal}, now,
  }), /审核者与补丁作者相同/);
  await assert.rejects(() => createIndependentReviewRecord({
    packet, reviewer: {id: 'human-reviewer-1', sessionId: packet.workSessionId},
    decision: 'approved', signer, context: {deadline, signal}, now,
  }), /审核会话与工作会话相同/);
});

test('验证期 fail-closed：摘要漂移/自审/同会话/缺证据/过期/缺失记录/畸形', async () => {
  const record = await createIndependentReviewRecord({
    packet, reviewer: {id: 'human-reviewer-1', sessionId: 'review-session-1'},
    decision: 'approved', signer, context: {deadline, signal}, now,
  });
  const drifted = {...packet, patchSha256: sha('other patch')};
  assert.equal(verifyIndependentReviewRecord(record, {packet: drifted, now}).reason, 'digest_mismatch');
  const selfReview = {...record, reviewerId: packet.authorId};
  assert.equal(verifyIndependentReviewRecord(selfReview, {packet, now: nowMs}).reason, 'self_review');
  const sameSession = {...record, reviewerSessionId: packet.workSessionId};
  assert.equal(verifyIndependentReviewRecord(sameSession, {packet, now: nowMs}).reason, 'same_session');
  const noEvidence = {...record, evidenceRefs: []};
  assert.equal(verifyIndependentReviewRecord(noEvidence, {packet, now: nowMs}).reason, 'missing_evidence');
  const stale = verifyIndependentReviewRecord(record, {packet, now: () => nowMs() + 25 * 60 * 60_000});
  assert.equal(stale.reason, 'stale');
  assert.equal(verifyIndependentReviewRecord(undefined, {packet, now: nowMs}).reason, 'missing_record');
  assert.equal(verifyIndependentReviewRecord({...record, version: 2}, {packet, now: nowMs}).reason, 'malformed');
  assert.equal(verifyIndependentReviewRecord({...record, signature: ''}, {packet, now: nowMs}).reason, 'malformed');
});

test('构造期包缺陷：缺证据/摘要非 sha256/scopeDecision 非法 → TypeError，不产生记录', async () => {
  for (const broken of [
    {...packet, evidenceRefs: []},
    {...packet, patchSha256: 'not-a-hash'},
    {...packet, scopeDecision: 'maybe'},
  ]) {
    await assert.rejects(() => createIndependentReviewRecord({
      packet: broken, reviewer: {id: 'human-reviewer-1', sessionId: 'review-session-1'},
      decision: 'approved', signer, context: {deadline, signal}, now,
    }), TypeError);
  }
});
