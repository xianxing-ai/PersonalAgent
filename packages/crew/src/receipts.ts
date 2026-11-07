import { CrewError } from './errors.js';

/**
 * 固定回执格式：Status / Result / Evidence / Unblock。
 * 每个任务回执都必须用同一形状表达，防止自由文本造成确认死循环：
 * `blocked` 必须给出 Unblock（如何才能继续）；终态不得携带 Unblock。
 */
export type CrewReceiptStatus = 'succeeded' | 'failed' | 'blocked' | 'cancelled';

export interface CrewReceipt {
  readonly status: CrewReceiptStatus;
  /** 面向父 agent 的一句话结果摘要，不允许只写“已完成”。 */
  readonly result: string;
  /** 指向可信执行路径产物的引用（例如 Runtime evidenceRef），不是模型自报成功。 */
  readonly evidenceRefs: readonly string[];
  /** 仅 `blocked` 时必填：说明需要什么输入/授权才能继续。 */
  readonly unblock: string;
}

export const MAX_RECEIPT_RESULT = 8192;
export const MAX_RECEIPT_UNBLOCK = 4096;
export const MAX_RECEIPT_EVIDENCE_REFS = 32;
export const MAX_EVIDENCE_REF = 256;

const RECEIPT_STATUSES: readonly CrewReceiptStatus[] = ['succeeded', 'failed', 'blocked', 'cancelled'];

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new CrewError('INVALID_INPUT', `receipt.${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new CrewError('INVALID_INPUT', `receipt.${field} must not be empty`);
  if (trimmed.length > max) throw new CrewError('INVALID_INPUT', `receipt.${field} exceeds ${max} characters`);
  return trimmed;
}

/**
 * 运行时校验外部回执。回执来自子 agent，属于不可信外部输入；
 * 只接受恰好含四个字段的固定形状，未知字段一律拒绝。
 */
export function parseCrewReceipt(input: unknown): CrewReceipt {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new CrewError('INVALID_INPUT', 'receipt must be an object');
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'status' && key !== 'result' && key !== 'evidenceRefs' && key !== 'unblock') {
      throw new CrewError('INVALID_INPUT', `receipt has unknown field ${key}`);
    }
  }
  const statusValue = record['status'];
  if (typeof statusValue !== 'string' || !RECEIPT_STATUSES.includes(statusValue as CrewReceiptStatus)) {
    throw new CrewError('INVALID_INPUT', `receipt.status must be one of ${RECEIPT_STATUSES.join(', ')}`);
  }
  const status = statusValue as CrewReceiptStatus;
  const result = requiredText(record['result'], 'result', MAX_RECEIPT_RESULT);
  const rawRefs = record['evidenceRefs'] ?? [];
  if (!Array.isArray(rawRefs)) throw new CrewError('INVALID_INPUT', 'receipt.evidenceRefs must be an array');
  if (rawRefs.length > MAX_RECEIPT_EVIDENCE_REFS) {
    throw new CrewError('INVALID_INPUT', `receipt.evidenceRefs exceeds ${MAX_RECEIPT_EVIDENCE_REFS} entries`);
  }
  const evidenceRefs = rawRefs.map(ref => requiredText(ref, 'evidenceRefs entry', MAX_EVIDENCE_REF));
  const unblockValue = record['unblock'];
  if (unblockValue === undefined && status === 'blocked') {
    throw new CrewError('INVALID_INPUT', 'receipt.unblock is required when status is blocked');
  }
  if (unblockValue === undefined) {
    if (status !== 'cancelled') throw new CrewError('INVALID_INPUT', 'receipt.unblock must be provided (use an empty string for terminal receipts)');
    return {status, result, evidenceRefs, unblock: ''};
  }
  if (typeof unblockValue !== 'string') throw new CrewError('INVALID_INPUT', 'receipt.unblock must be a string');
  const unblock = unblockValue.trim();
  if (status === 'blocked' && !unblock) {
    throw new CrewError('INVALID_INPUT', 'receipt.unblock must not be empty when status is blocked');
  }
  if (status !== 'blocked' && unblock) {
    throw new CrewError('INVALID_INPUT', 'receipt.unblock must be empty unless status is blocked');
  }
  if (unblock.length > MAX_RECEIPT_UNBLOCK) {
    throw new CrewError('INVALID_INPUT', `receipt.unblock exceeds ${MAX_RECEIPT_UNBLOCK} characters`);
  }
  return {status, result, evidenceRefs, unblock};
}

/**
 * 纯确认消息白名单：只有整条消息在去标点后恰好等于这些固定短语时才算纯确认。
 * 刻意收窄，避免把带内容的回复（例如“收到，结果是 X”）误判成确认而丢弃。
 */
const PURE_ACK_PHRASES: readonly string[] = [
  'ack',
  'ok',
  'okay',
  'roger',
  '收到',
  '好的',
  '了解',
  '明白',
  '明白了',
  '知道了',
  '确认',
  'will do',
  'on it',
  'understood',
];

/** 判断一条文本是否只包含确认、不含任何新内容。 */
export function isPureAcknowledgement(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[\s.,!?;:、。！？；：~～]+/gu, '');
  return PURE_ACK_PHRASES.includes(normalized);
}
