import { ProtocolError } from '@personal-agent/contracts';
import type {
  MailArchiveInput,
  MailArchiveResult,
  MailFetchInput,
  MailFolder,
  MailMarkSeenInput,
  MailMessage,
  MailPage,
  MailProvider,
  MailSendInput,
  MailSendResult,
} from './provider.js';

/** QQ 形状的默认夹具：收件箱 8 封（含已读与无 Date 头的边界），已发送 2 封。 */
export const defaultMailFixtures: {inbox: MailMessage[]; sent: MailMessage[]} = {
  inbox: [
    {uid: 1, folder: 'INBOX', from: 'noreply@qq.com', fromName: 'QQ邮箱团队', to: 'me@qq.com', subject: '欢迎使用QQ邮箱', sentAt: '2026-09-01T01:00:00.000Z', messageId: '<welcome@qq.com>', seen: true},
    {uid: 2, folder: 'INBOX', from: 'github@noreply.zemeng5208.local', fromName: 'zemeng5208', to: 'me@qq.com', subject: '[PersonalAgent] PR #8 已合并', sentAt: '2026-09-05T08:30:00.000Z', messageId: '<pr8@github.local>', seen: false},
    {uid: 3, folder: 'INBOX', from: 'calendar-notification@example.com', to: 'me@qq.com', subject: '提醒：架构评审 17:00', sentAt: '2026-09-06T09:00:00.000Z', messageId: '<cal-1@example.com>', seen: false},
    {uid: 4, folder: 'INBOX', from: 'ops@example.com', fromName: '值班', to: 'me@qq.com', subject: '夜班交接（跨 DST）', sentAt: '2026-11-01T05:30:00.000Z', messageId: '<ops-dst@example.com>', seen: false},
    {uid: 5, folder: 'INBOX', from: 'newsletter@open-meteo.local', to: 'me@qq.com', subject: '本周天气数据更新', sentAt: null, messageId: '<news-5@open-meteo.local>', seen: false},
    {uid: 6, folder: 'INBOX', from: 'hr@example.com', to: 'me@qq.com', subject: '报销截止提醒', sentAt: '2026-09-06T02:00:00.000Z', messageId: '<hr-6@example.com>', seen: false},
    {uid: 7, folder: 'INBOX', from: 'ads@spam.example', to: 'me@qq.com', subject: '限时优惠！！！', sentAt: '2026-09-06T12:00:00.000Z', messageId: '<ads-7@spam.example>', seen: false},
    {uid: 8, folder: 'INBOX', from: 'lead@example.com', to: 'me@qq.com', subject: '站会纪要 2026-09-07', sentAt: '2026-09-07T01:45:00.000Z', messageId: '<lead-8@example.com>', seen: false},
  ],
  sent: [
    {uid: 1, folder: 'Sent Messages', from: 'me@qq.com', to: 'lead@example.com', subject: '周报', sentAt: '2026-09-04T09:00:00.000Z', messageId: '<sent-1@qq.com>', seen: true},
    {uid: 2, folder: 'Sent Messages', from: 'me@qq.com', to: 'arch@example.com', subject: '评审意见', sentAt: '2026-09-06T10:00:00.000Z', messageId: '<sent-2@qq.com>', seen: true},
  ],
};

const INBOX_VALIDITY = 1725686400;

export interface FakeMailProviderOptions {
  pageSize?: number;
  inboxUidValidity?: number;
}

/** Fake 邮件提供商（测试专用）：增量、分页、重复投递去重语义与真实 UID 行为一致。 */
export class FakeMailProvider implements MailProvider {
  readonly providerKind = 'fixture';
  private readonly inbox: MailMessage[];
  private readonly sent: MailMessage[];
  private readonly pageSize: number;
  private uidValidity: number;
  private readonly seenActions = new Map<string, {uid: number; seen: boolean}>();
  private readonly archiveActions = new Map<string, MailArchiveResult>();
  private readonly archived: MailMessage[] = [];
  private readonly sendActions = new Map<string, MailSendResult>();
  private readonly sentOutbox: MailMessage[] = [];
  private sentUidNext = 100;

  constructor(fixtures: {inbox: MailMessage[]; sent: MailMessage[]} = defaultMailFixtures, options: FakeMailProviderOptions = {}) {
    this.inbox = structuredClone(fixtures.inbox);
    this.sent = structuredClone(fixtures.sent);
    this.pageSize = options.pageSize ?? 3;
    this.uidValidity = options.inboxUidValidity ?? INBOX_VALIDITY;
  }

  listFolders(): MailFolder[] {
    return [
      {path: 'INBOX', role: 'inbox', uidValidity: this.uidValidity},
      {path: 'Sent Messages', role: 'sent', uidValidity: 1725686401},
      {path: 'Archive', role: 'archive', uidValidity: 1725686402},
    ];
  }

  fetchPage(_accountRef: string, input: MailFetchInput): MailPage {
    const folder = input.folder ?? 'INBOX';
    const pool = folder === 'INBOX' ? this.inbox : this.sent;
    const validity = folder === 'INBOX' ? this.uidValidity : 1725686401;
    if (input.cursor !== undefined && input.cursor.uidValidity !== validity) {
      throw new ProtocolError('CURSOR_EXPIRED', `Folder ${folder} was recreated (uidValidity changed); restart sync from scratch`);
    }
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new ProtocolError('INVALID_ARGUMENT', 'limit must be 1..100');
    }
    const lastUid = input.cursor?.lastUid ?? 0;
    const fresh = pool.filter(message => message.uid > lastUid).sort((left, right) => left.uid - right.uid);
    const size = Math.min(this.pageSize, input.limit);
    const page = fresh.slice(0, size);
    const consumed = page.map(message => message.uid).reduce((max, uid) => Math.max(max, uid), lastUid);
    const stamped = page.map(message => ({...message, uidValidity: validity}));
    return {
      messages: structuredClone(stamped),
      uidValidity: validity,
      nextCursor: {uidValidity: validity, lastUid: consumed},
      hasMore: fresh.length > page.length,
    };
  }

  getMessage(_accountRef: string, folder: string, uid: number): MailMessage | undefined {
    const pool = folder === 'INBOX' ? this.inbox : this.sent;
    const message = pool.find(entry => entry.uid === uid && entry.folder === folder);
    if (message === undefined) return undefined;
    const validity = folder === 'INBOX' ? this.uidValidity : 1725686401;
    return structuredClone({...message, uidValidity: validity});
  }

  markSeen(_accountRef: string, input: MailMarkSeenInput): {uid: number; seen: boolean} {
    if (input.idempotencyKey.length === 0) throw new ProtocolError('INVALID_ARGUMENT', 'idempotencyKey is required');
    const prior = this.seenActions.get(input.idempotencyKey);
    if (prior !== undefined) return prior;
    const message = this.inbox.find(entry => entry.uid === input.uid && entry.folder === input.folder);
    if (message === undefined) throw new ProtocolError('NOT_FOUND', `No message uid=${input.uid} in ${input.folder}`);
    message.seen = true;
    const result = {uid: input.uid, seen: true};
    this.seenActions.set(input.idempotencyKey, result);
    return result;
  }

  archiveMessage(_accountRef: string, input: MailArchiveInput): MailArchiveResult {
    if (input.idempotencyKey.length === 0) throw new ProtocolError('INVALID_ARGUMENT', 'idempotencyKey is required');
    const prior = this.archiveActions.get(input.idempotencyKey);
    if (prior !== undefined) return structuredClone(prior);
    const sourceFolder = input.folder ?? 'INBOX';
    const targetFolder = input.targetFolder?.trim() || 'Archive';
    const pool = sourceFolder === 'INBOX' ? this.inbox : this.sent;
    const idx = pool.findIndex(entry =>
      (input.uid !== undefined && entry.uid === input.uid)
      || (input.messageId !== undefined && (entry.messageId === input.messageId || String(entry.uid) === input.messageId || `${entry.folder}:${entry.uid}` === input.messageId)));
    if (idx < 0) throw new ProtocolError('NOT_FOUND', `No message to archive in ${sourceFolder}`);
    const [message] = pool.splice(idx, 1);
    const archivedMessage: MailMessage = {...message!, folder: targetFolder};
    this.archived.push(archivedMessage);
    const result: MailArchiveResult = {
      archived: true,
      messageId: archivedMessage.messageId ?? `${sourceFolder}:${archivedMessage.uid}`,
      folder: targetFolder,
    };
    this.archiveActions.set(input.idempotencyKey, result);
    return structuredClone(result);
  }

  send(_accountRef: string, input: MailSendInput & {idempotencyKey: string}): MailSendResult {
    if (input.idempotencyKey.length === 0) throw new ProtocolError('INVALID_ARGUMENT', 'idempotencyKey is required');
    const prior = this.sendActions.get(input.idempotencyKey);
    if (prior !== undefined) return prior;
    let result: MailSendResult;
    if (input.timeoutMs === 0) {
      // 模拟超时：无法确认是否已发出——必须先核对结果，绝不当作失败重发。
      result = {state: 'unknown', reason: 'simulated send timeout; verify outbox before retrying'};
      this.sentOutbox.push({uid: -1, folder: 'Sent Messages', from: 'me@qq.com', to: input.to, subject: input.subject, sentAt: null, messageId: `<pending-${input.idempotencyKey}>`, seen: false});
    } else {
      this.sentUidNext += 1;
      const messageId = `<fake-${this.sentUidNext}@qq.com>`;
      this.sentOutbox.push({uid: this.sentUidNext, folder: 'Sent Messages', from: 'me@qq.com', to: input.to, subject: input.subject, sentAt: '2026-09-07T02:00:00.000Z', messageId, seen: true});
      result = {state: 'confirmed', messageId};
    }
    this.sendActions.set(input.idempotencyKey, result);
    return result;
  }

  /** 测试辅助：已投递的出站邮件（含超时未确认那封）。 */
  outbox(): MailMessage[] {
    return structuredClone(this.sentOutbox);
  }

  /** 测试辅助：模拟文件夹重建（uidValidity 轮换）。 */
  rotateUidValidity(): void {
    this.uidValidity += 1;
  }
}
