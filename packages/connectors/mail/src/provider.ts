/** 邮件提供商端口：实现方负责真实协议（QQ IMAP/SMTP）或 Fake 夹具，本包只做规范化。 */
import { ProtocolError } from '@personal-agent/contracts';
import type { ProtocolContracts } from '@personal-agent/contracts';

export interface MailFolder {
  path: string;
  role: 'inbox' | 'sent' | 'drafts' | 'archive' | 'other';
  uidValidity: number;
}

/** 提供商侧邮件：UID 是文件夹内稳定标识，uidValidity 变化意味着 UID 全部失效。 */
export interface MailMessage {
  uid: number;
  folder: string;
  /** 所属文件夹的 UIDVALIDITY；参与 dedupeKey，文件夹重建后同一 UID 不会撞车。 */
  uidValidity?: number;
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  /** 邮件 Date 头的 UTC 瞬间；缺失时由服务层回退 fetchedAt 并在 contentRef 标注。 */
  sentAt: string | null;
  messageId?: string;
  seen: boolean;
}

/** 增量游标：`uidValidity:lastUid`——只返回 UID 更大的邮件；uidValidity 变化 → CURSOR_EXPIRED。 */
export interface MailCursor {
  uidValidity: number;
  lastUid: number;
}

export interface MailFetchInput {
  folder?: string;
  cursor?: MailCursor;
  limit: number;
  signal?: AbortSignal;
}

export interface MailPage {
  messages: MailMessage[];
  uidValidity: number;
  nextCursor: MailCursor;
  hasMore: boolean;
}

export interface MailSendInput {
  to: string;
  subject: string;
  text: string;
  timeoutMs: number;
}

/** 发送结果：超时/未知 ≠ 失败——必须先核对结果（PA-014），重试须携带同一幂等键。 */
export interface MailSendResult {
  state: 'confirmed' | 'unknown';
  messageId?: string;
  reason?: string;
}

export interface MailMarkSeenInput {
  folder: string;
  uid: number;
  idempotencyKey: string;
}

/** Exact original message epoch and identity; the server must advertise an Archive mailbox. */
export interface MailArchiveInput extends MailMarkSeenInput {
  uidValidity:number;
  messageId:string;
}

/** Trusted execution context; kept separate from mail content and idempotency fingerprints. */
export interface MailOperationContext {
  signal?: AbortSignal;
  deadline?: string;
  now?: () => number;
}

export function guardMailWrite(context?: MailOperationContext): void {
  if (context?.signal?.aborted) throw new ProtocolError('CANCELLED', 'Mail write cancelled before execution');
  if (context?.deadline !== undefined) {
    const deadline = Date.parse(context.deadline);
    if (!Number.isFinite(deadline)) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid mail write deadline');
    if ((context.now ?? Date.now)() >= deadline) throw new ProtocolError('TIMEOUT', 'Mail write deadline expired before execution', false);
  }
}

export interface MailProvider {
  /** 提供商标识（进 manifest.accountTypes），Fake 为 'fixture'，QQ 为 'qq'。 */
  readonly providerKind: string;
  listFolders(accountRef: string): MailFolder[] | Promise<MailFolder[]>;
  fetchPage(accountRef: string, input: MailFetchInput): MailPage | Promise<MailPage>;
  getMessage(accountRef: string, folder: string, uid: number): MailMessage | undefined | Promise<MailMessage | undefined>;
  markSeen(accountRef: string, input: MailMarkSeenInput, context?: MailOperationContext): {uid: number; seen: boolean} | Promise<{uid: number; seen: boolean}>;
  send(accountRef: string, input: MailSendInput & {idempotencyKey: string}, context?: MailOperationContext): MailSendResult | Promise<MailSendResult>;
  archive?(accountRef:string,input:MailArchiveInput,context?:MailOperationContext):Promise<ProtocolContracts['connectorAction']>;
  /** Optional real draft capability; absent providers remain unsupported. No SMTP delivery. */
  saveDraft?(accountRef: string, input: MailSendInput & {idempotencyKey: string}, context?: MailOperationContext): Promise<ProtocolContracts['connectorAction']>;
  /** Synchronous trusted binding check, needed when the service has no original send record. */
  assertSendIdentity?(accountRef: string, messageId: string, idempotencyKey: string): void;
  /** Validate original key/Message-ID binding before any Sent read. Missing matches remain unknown. */
  reconcileSend?(accountRef: string, messageId: string, idempotencyKey: string): Promise<MailSendResult>;
}

export function encodeMailCursor(cursor: MailCursor): string {
  return `${cursor.uidValidity}:${cursor.lastUid}`;
}

export function decodeMailCursor(value: string): MailCursor {
  const match = /^(\d+):(\d+)$/.exec(value);
  const uidValidity = match === null ? Number.NaN : Number(match[1]);
  const lastUid = match === null ? Number.NaN : Number(match[2]);
  if (!Number.isSafeInteger(uidValidity) || !Number.isSafeInteger(lastUid)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Malformed mail cursor; expected uidValidity:lastUid');
  }
  return {uidValidity, lastUid};
}
