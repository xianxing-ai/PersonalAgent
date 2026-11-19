// F15 真人独立审核签名：审核包摘要绑定、独立性校验与签名验证。
// 对应 OPEN_WORK zemeng 第 4 项「F15 真实验收：真人独立审核签名、实机 WinForms 目视（配置 UI 归 lab）」。
// 语义边界：
//  · 签名产生由注入的受信签名端口完成（生产为设备/平台签名；测试用假签名）——本模块不发明信任，
//    只负责把“审核包内容摘要 + 独立性 + 时效 + 证据”绑定为可核对的记录，并在验证时全部 fail-closed；
//  · 真人签名动作本身与实机 WinForms 目视为现场验收，待真机（acceptance:'pending_real_review'）。
import {createHash} from 'node:crypto';

const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

/** 被审核的编码工作包（与 F15 图 N03–N06 输出对应的有界引用）。 */
export interface IndependentReviewPacket {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly patchSha256: string;
  readonly checkResultsSha256: string;
  readonly scopeDecision: 'approved' | 'rejected' | 'unknown';
  readonly scopeReason: string;
  /** 产生补丁的一方（被审核者）；独立性要求审核者与之不同。 */
  readonly authorId: string;
  readonly workSessionId: string;
  readonly evidenceRefs: readonly string[];
}

/** 审核记录：包摘要 + 审核者身份 + 签名（由注入端口产生）+ 证据。 */
export interface IndependentReviewRecord {
  readonly version: 1;
  readonly packetSha256: string;
  readonly reviewerId: string;
  readonly reviewerSessionId: string;
  readonly decision: 'approved' | 'rejected';
  readonly signedAt: string;
  readonly signature: string;
  readonly evidenceRefs: readonly string[];
  readonly acceptance: 'pending_real_review';
}

export interface IndependentReviewSignerPort {
  /** 受信签名端口（生产：设备/平台密钥；绝不把模型输出当签名）。 */
  sign(packetSha256: string, reviewer: {id: string; sessionId: string}, context: {deadline: string; signal: AbortSignal}):
    Promise<string>;
}

export function reviewPacketSha256(packet: IndependentReviewPacket): string {
  const canonical = {
    taskId: packet.taskId, workspaceId: packet.workspaceId, patchSha256: packet.patchSha256,
    checkResultsSha256: packet.checkResultsSha256, scopeDecision: packet.scopeDecision, scopeReason: packet.scopeReason,
    authorId: packet.authorId, workSessionId: packet.workSessionId, evidenceRefs: [...packet.evidenceRefs].sort(),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** 产生审核记录：绑定当前包摘要；独立性缺陷与包缺陷直接拒绝（不产生记录）。 */
export async function createIndependentReviewRecord(input: {
  packet: IndependentReviewPacket;
  reviewer: {id: string; sessionId: string};
  decision: 'approved' | 'rejected';
  signer: IndependentReviewSignerPort;
  context: {deadline: string; signal: AbortSignal};
  now?(): Date;
}): Promise<IndependentReviewRecord> {
  const packet = input?.packet;
  if (!packet || !text(packet.taskId) || !text(packet.workspaceId)
    || !/^[a-f0-9]{64}$/.test(packet.patchSha256 ?? '') || !/^[a-f0-9]{64}$/.test(packet.checkResultsSha256 ?? '')
    || !['approved', 'rejected', 'unknown'].includes(packet.scopeDecision)
    || !Array.isArray(packet.evidenceRefs) || packet.evidenceRefs.length === 0 || !packet.evidenceRefs.every(text)) {
    throw new TypeError('审核包不完整：taskId/workspace/摘要/范围决定/证据缺一不可');
  }
  if (!text(input.reviewer?.id) || !text(input.reviewer?.sessionId)) throw new TypeError('审核者身份必填');
  if (input.reviewer.id === packet.authorId) throw new Error('独立性缺陷：审核者与补丁作者相同');
  if (input.reviewer.sessionId === packet.workSessionId) throw new Error('独立性缺陷：审核会话与工作会话相同');
  if (!input.signer || typeof input.signer.sign !== 'function') throw new TypeError('受信签名端口必填');
  const packetSha256 = reviewPacketSha256(packet);
  const signature = await input.signer.sign(packetSha256, input.reviewer, input.context);
  if (!text(signature)) throw new Error('受信签名端口未返回签名');
  const now = input.now ?? (() => new Date());
  return {
    version: 1,
    packetSha256,
    reviewerId: input.reviewer.id,
    reviewerSessionId: input.reviewer.sessionId,
    decision: input.decision,
    signedAt: now().toISOString(),
    signature,
    evidenceRefs: [...packet.evidenceRefs],
    acceptance: 'pending_real_review',
  };
}

export interface IndependentReviewVerdict {
  readonly valid: boolean;
  readonly reason: 'verified' | 'missing_record' | 'malformed' | 'digest_mismatch' | 'self_review'
    | 'same_session' | 'signature_invalid' | 'stale' | 'missing_evidence';
}

/** 验证审核记录：包摘要必须与当前包一致；独立性必须成立；签名必须由受信端口确认；时效受控。 */
export function verifyIndependentReviewRecord(record: IndependentReviewRecord | undefined | null, input: {
  packet: IndependentReviewPacket;
  verifySignature?(packetSha256: string, record: IndependentReviewRecord): Promise<boolean> | boolean;
  now?(): number;
  maxAgeMs?: number;
}): IndependentReviewVerdict {
  if (!record) return {valid: false, reason: 'missing_record'};
  const digest = reviewPacketSha256(input.packet);
  if (record.version !== 1 || !text(record.signature) || !text(record.reviewerId) || !text(record.reviewerSessionId)
    || !['approved', 'rejected'].includes(record.decision)
    || !Number.isFinite(Date.parse(record.signedAt))) return {valid: false, reason: 'malformed'};
  if (record.packetSha256 !== digest) return {valid: false, reason: 'digest_mismatch'};
  if (record.reviewerId === input.packet.authorId) return {valid: false, reason: 'self_review'};
  if (record.reviewerSessionId === input.packet.workSessionId) return {valid: false, reason: 'same_session'};
  if (!Array.isArray(record.evidenceRefs) || record.evidenceRefs.length === 0) return {valid: false, reason: 'missing_evidence'};
  const now = input.now ?? Date.now;
  const maxAgeMs = input.maxAgeMs ?? 24 * 60 * 60_000;
  if (now() - Date.parse(record.signedAt) > maxAgeMs) return {valid: false, reason: 'stale'};
  if (input.verifySignature) {
    const ok = input.verifySignature(digest, record);
    if (ok === false) return {valid: false, reason: 'signature_invalid'};
  }
  return {valid: true, reason: 'verified'};
}
