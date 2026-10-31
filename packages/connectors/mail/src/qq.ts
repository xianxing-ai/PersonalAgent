import { ImapFlow } from 'imapflow';
import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { SentMessageInfo, Transporter } from 'nodemailer';
import { ProtocolError } from '@personal-agent/contracts';
import type { ProtocolContracts } from '@personal-agent/contracts';
import type {
  MailFetchInput,
  MailArchiveInput,
  MailFolder,
  MailMarkSeenInput,
  MailMessage,
  MailOperationContext,
  MailPage,
  MailProvider,
  MailSendInput,
  MailSendResult,
} from './provider.js';
import { guardMailWrite } from './provider.js';

export interface QQMailOptions {
  /** 完整 QQ 邮箱地址，如 3468788554@qq.com。装配层从环境注入，不进仓库。 */
  user: string;
  /** QQ 邮箱「授权码」（设置 → 账号 → IMAP/SMTP 服务生成），不是登录密码。 */
  authCode: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
}

const DEFAULT_IMAP = {host: 'imap.qq.com', port: 993};
const DEFAULT_SMTP = {host: 'smtp.qq.com', port: 465};

/** imapflow envelope 的最小形状（避免把第三方类型漏到公共接口）。 */
export interface ImapEnvelopeLike {
  from?: {address?: string; name?: string}[] | null;
  to?: {address?: string}[] | null;
  subject?: string | null;
  date?: Date | string | null;
  messageId?: string | null;
}

/** 纯函数：imapflow 的 envelope+flags → 本包 MailMessage。Date 头缺失保留 null 由服务层兜底。 */
export function messageFromImap(uid: number, folder: string, envelope: ImapEnvelopeLike, seen: boolean): MailMessage {
  const from = envelope.from?.[0]?.address ?? 'unknown@unknown';
  const message: MailMessage = {
    uid,
    folder,
    from,
    to: envelope.to?.[0]?.address ?? 'unknown@unknown',
    subject: envelope.subject ?? '(无主题)',
    sentAt: envelope.date === null || envelope.date === undefined || !Number.isFinite(new Date(envelope.date).getTime())
      ? null : new Date(envelope.date).toISOString(),
    seen,
  };
  const name = envelope.from?.[0]?.name;
  if (name !== undefined && name.length > 0) message.fromName = name;
  if (typeof envelope.messageId === 'string' && envelope.messageId.length > 0) message.messageId = envelope.messageId;
  return message;
}

/** QQ 邮箱真实提供商：IMAP（imapflow）读侧 + SMTP（nodemailer）写侧。 */
export class QQMailProvider implements MailProvider {
  private readonly archiveInflight=new Map<string,{fingerprint:string;result:Promise<ProtocolContracts['connectorAction']>}>();
  readonly providerKind = 'qq';
  readonly verification = 'conditional' as const;
  private readonly options: Required<Pick<QQMailOptions, 'imapHost' | 'imapPort' | 'smtpHost' | 'smtpPort'>> & QQMailOptions;
  private client: ImapFlow | null = null;
  private transporter: Transporter | null = null;
  private readonly sendActions = new Map<string, MailSendResult>();
  private readonly sendInflight = new Map<string, {fingerprint: string; inflight: MailSendResult | Promise<MailSendResult>}>();
  private readonly draftInflight = new Map<string, {fingerprint: string; inflight: Promise<ProtocolContracts['connectorAction']>}>();

  constructor(options: QQMailOptions) {
    if (typeof options.user !== 'string' || !options.user.includes('@')) {
      throw new ProtocolError('INVALID_ARGUMENT', 'QQ mail user must be a full address');
    }
    if (typeof options.authCode !== 'string' || options.authCode.length === 0) {
      throw new ProtocolError('INVALID_ARGUMENT', 'QQ mail authCode is required (设置→账号→IMAP/SMTP 服务生成的授权码)');
    }
    this.options = {
      ...options,
      imapHost: options.imapHost ?? DEFAULT_IMAP.host,
      imapPort: options.imapPort ?? DEFAULT_IMAP.port,
      smtpHost: options.smtpHost ?? DEFAULT_SMTP.host,
      smtpPort: options.smtpPort ?? DEFAULT_SMTP.port,
    };
  }

  private async connect(): Promise<ImapFlow> {
    if (this.client !== null && this.client.usable) return this.client;
    const client = new ImapFlow({
      host: this.options.imapHost,
      port: this.options.imapPort,
      secure: true,
      auth: {user: this.options.user, pass: this.options.authCode},
      logger: false,
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 30_000,
    });
    try {
      await client.connect();
    } catch (error) {
      client.close();
      throw mapImapError(error);
    }
    this.client = client;
    return client;
  }

  async listFolders(_accountRef?: string, context?: MailOperationContext): Promise<MailFolder[]> {
    guardMailWrite(context);
    const client = await this.connect();
    guardMailWrite(context);
    try {
      const boxes = await client.list();
      guardMailWrite(context);
      return boxes
        .map(box => ({path: box.path, role: roleOf(box.specialUse), uidValidity: 0}))
        .filter(folder => folder.role !== 'other' || !folder.path.includes('.'));
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      throw mapImapError(error);
    }
  }

  async fetchPage(accountRef: string, input: MailFetchInput): Promise<MailPage> {
    if (input.signal?.aborted) throw new ProtocolError('CANCELLED', 'Mail fetch cancelled');
    void accountRef;
    const folder = input.folder ?? 'INBOX';
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new ProtocolError('INVALID_ARGUMENT', 'limit must be 1..100');
    }
    const client = await this.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const mailbox = client.mailbox;
      const uidValidity = typeof mailbox === 'object' && mailbox !== null && mailbox.uidValidity ? Number(mailbox.uidValidity) : 0;
      if (input.cursor !== undefined && input.cursor.uidValidity !== uidValidity) {
        throw new ProtocolError('CURSOR_EXPIRED', `Folder ${folder} uidValidity changed; restart sync from scratch`);
      }
      const lastUid = input.cursor?.lastUid ?? 0;
      const uids = await client.search({uid: `${lastUid + 1}:*`}, {uid: true});
      if(input.signal?.aborted)throw new ProtocolError('CANCELLED','Mail fetch cancelled');
      if(!Array.isArray(uids))throw new ProtocolError('EXTERNAL_FAILURE','Mail UID search did not return a confirmed result');
      const available = uids
        .map(uid => Number(uid))
        .filter(uid => uid > lastUid)
        .sort((left, right) => left - right);
      const fresh = available.slice(0, input.limit);
      const messages: MailMessage[] = [];
      if (fresh.length > 0) {
        for await (const message of client.fetch(fresh, {uid: true, envelope: true, flags: true}, {uid: true})) {
          const stamped = messageFromImap(message.uid, folder, message.envelope ?? {}, message.flags?.has('\\Seen') ?? false);
          stamped.uidValidity = uidValidity;
          messages.push(stamped);
        }
      }
      if (input.signal?.aborted) throw new ProtocolError('CANCELLED', 'Mail fetch cancelled');
      const received=new Set(messages.map(message=>message.uid));
      if(messages.length!==fresh.length||received.size!==fresh.length||fresh.some(uid=>!received.has(uid)))
        throw new ProtocolError('EXTERNAL_FAILURE','Mail UID fetch did not return the complete requested page');
      const consumed = messages.map(entry => entry.uid).reduce((max, uid) => Math.max(max, uid), lastUid);
      return {
        messages: messages.sort((a, b) => a.uid - b.uid),
        uidValidity,
        nextCursor: {uidValidity, lastUid: consumed},
        hasMore: available.length > fresh.length,
      };
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      throw mapImapError(error);
    } finally {
      lock.release();
    }
  }

  async getMessage(_accountRef: string, folder: string, uid: number): Promise<MailMessage | undefined> {
    const client = await this.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      for await (const message of client.fetch(String(uid), {uid: true, envelope: true, flags: true}, {uid: true})) {
        const stamped = messageFromImap(message.uid, folder, message.envelope ?? {}, message.flags?.has('\\Seen') ?? false);
        stamped.uidValidity = typeof client.mailbox === 'object' && client.mailbox !== null && client.mailbox.uidValidity ? Number(client.mailbox.uidValidity) : 0;
        return stamped;
      }
      return undefined;
    } catch (error) {
      throw mapImapError(error);
    } finally {
      lock.release();
    }
  }

  async markSeen(_accountRef: string, input: MailMarkSeenInput, context?: MailOperationContext): Promise<{uid: number; seen: boolean}> {
    guardMailWrite(context);
    if (input.idempotencyKey.length === 0) throw new ProtocolError('INVALID_ARGUMENT', 'idempotencyKey is required');
    const client = await this.connect();
    guardMailWrite(context);
    const lock = await client.getMailboxLock(input.folder);
    let storeStarted = false;
    try {
      guardMailWrite(context);
      storeStarted = true;
      await client.messageFlagsAdd(String(input.uid), ['\\Seen'], {uid: true});
      const readback = await client.fetchOne(String(input.uid), {flags: true}, {uid: true});
      if (!readback || !readback.flags?.has('\\Seen')) {
        throw new ProtocolError('RESULT_UNKNOWN', 'Mail seen flag could not be verified; reconcile before continuing', false);
      }
      return {uid: input.uid, seen: true};
    } catch (error) {
      if (storeStarted) throw new ProtocolError('RESULT_UNKNOWN', 'Mail seen write result unknown; reconcile before continuing', false);
      if (error instanceof ProtocolError) throw error;
      throw mapImapError(error);
    } finally {
      lock.release();
    }
  }

  async send(_accountRef: string, input: MailSendInput & {idempotencyKey: string},context?:MailOperationContext): Promise<MailSendResult> {
    guardMailWrite(context);
    if (input.idempotencyKey.length === 0) throw new ProtocolError('INVALID_ARGUMENT', 'idempotencyKey is required');
    // Provider 层同样单飞 + 输入绑定（goo122 2026-09-13 复审 P1）：在途 Promise 先登记再 await，
    // 并发同键只触发一次 sendMail；键换输入直接拒绝。持久化的最终责任在 Runtime，
    // 此表只覆盖进程内窗口（与 Service 层互为纵深，不互为替代）。
    const fingerprint = JSON.stringify([input.to, input.subject, input.text]);
    const prior = this.sendInflight.get(input.idempotencyKey);
    if (prior !== undefined) {
      if (prior.fingerprint !== fingerprint) {
        throw new ProtocolError('INVALID_ARGUMENT', `idempotencyKey "${input.idempotencyKey}" was used with different content at the provider; refusing`);
      }
      return prior.inflight;
    }
    const inflight = this.sendViaTransporter(input,context);
    this.sendInflight.set(input.idempotencyKey, {fingerprint, inflight});
    const result = await inflight;
    this.sendActions.set(input.idempotencyKey, result);
    return result;
  }

  private async sendViaTransporter(input: MailSendInput & {idempotencyKey: string},context?:MailOperationContext): Promise<MailSendResult> {
    guardMailWrite(context);
    const messageId = this.operationMessageId('send', input.idempotencyKey);
    if (this.transporter === null) {
      this.transporter = nodemailer.createTransport({
        host: this.options.smtpHost,
        port: this.options.smtpPort,
        secure: true,
        auth: {user: this.options.user, pass: this.options.authCode},
        socketTimeout: Math.max(input.timeoutMs, 1_000),
      });
    }
    let result: MailSendResult;
    let abort:()=>void=()=>{};
    const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>reject(new Error('SMTP result unknown after cancellation'));
      context?.signal?.addEventListener('abort',abort,{once:true});});
    try {
      const info: SentMessageInfo = await Promise.race([
        this.transporter.sendMail({from: this.options.user, to: input.to, subject: input.subject, text: input.text, messageId}),
        rejectAfter(input.timeoutMs),
        cancelled,
      ]);
      result = {state: 'confirmed', messageId};
      if (typeof info.messageId === 'string') result.messageId = info.messageId;
    } catch (error) {
      // 超时或连接中断都意味着「结果未知」，不是失败：绝不盲重试（PA-014）。
      result = {state: 'unknown', messageId, reason: 'SMTP result unknown; reconcile the Message-ID before any retry'};
    } finally {context?.signal?.removeEventListener('abort',abort);}
    return result;
  }

  async archive(_accountRef:string,input:MailArchiveInput,context?:MailOperationContext):Promise<ProtocolContracts['connectorAction']> {
    guardMailWrite(context);
    if(!input.idempotencyKey||!input.folder||!Number.isSafeInteger(input.uid)||input.uid<1
      ||!Number.isSafeInteger(input.uidValidity)||input.uidValidity<1||!/^<[^<>\s]+>$/u.test(input.messageId))
      throw new ProtocolError('INVALID_ARGUMENT','Archive requires the original folder, UID epoch and Message-ID');
    const fingerprint=JSON.stringify([input.folder,input.uid,input.uidValidity,input.messageId]),prior=this.archiveInflight.get(input.idempotencyKey);
    if(prior){if(prior.fingerprint!==fingerprint)throw new ProtocolError('INVALID_ARGUMENT','Archive key belongs to different input');return prior.result;}
    const result=this.moveToArchive(input,context);this.archiveInflight.set(input.idempotencyKey,{fingerprint,result});return result;
  }

  private async moveToArchive(input:MailArchiveInput,context?:MailOperationContext):Promise<ProtocolContracts['connectorAction']> {
    const folder=(await this.listFolders(undefined,context)).find(value=>value.role==='archive');guardMailWrite(context);
    if(!folder||folder.path===input.folder)throw new ProtocolError('UNSUPPORTED_CAPABILITY','A distinct advertised Archive mailbox is required');
    const client=await this.connect();guardMailWrite(context);
    // imapflow otherwise emulates MOVE with COPY + EXPUNGE. Do not broaden an archive into that fallback.
    if(!client.capabilities.has('MOVE')||!client.capabilities.has('UIDPLUS'))
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Verified archive requires native MOVE and UIDPLUS');
    let lock:{release():void}|undefined=await client.getMailboxLock(input.folder),started=false;
    const actionId='mail-archive:'+input.idempotencyKey,unknown=():ProtocolContracts['connectorAction']=>({actionId,state:'unknown',externalId:input.messageId,evidenceRefs:[]});
    try {
      guardMailWrite(context);
      if(!client.mailbox||Number(client.mailbox.uidValidity)!==input.uidValidity)
        throw new ProtocolError('CURSOR_EXPIRED','Original mail UID epoch changed');
      const original=await client.fetchOne(String(input.uid),{envelope:true},{uid:true});guardMailWrite(context);
      if(!original||original.envelope?.messageId!==input.messageId)throw new ProtocolError('REVISION_CONFLICT','Original message identity changed');
      started=true;
      const moved=await client.messageMove(String(input.uid),folder.path,{uid:true});
      guardMailWrite(context);
      const destinationUid=moved&&moved.uidMap?.get(input.uid);
      // The move may already have taken effect. Never repeat it or invent a receipt when UIDPLUS/readback is absent.
      if(!destinationUid||!moved||moved.destination!==folder.path||moved.uidValidity===undefined)return unknown();
      const remaining=await client.fetchOne(String(input.uid),{uid:true},{uid:true});
      if(remaining)return unknown();
      lock.release();lock=undefined;lock=await client.getMailboxLock(folder.path);guardMailWrite(context);
      if(!client.mailbox||client.mailbox.uidValidity!==moved.uidValidity)return unknown();
      const archived=await client.fetchOne(String(destinationUid),{envelope:true},{uid:true});
      if(!archived||archived.envelope?.messageId!==input.messageId)return unknown();
      return {actionId,state:'confirmed',externalId:folder.path+':'+destinationUid,evidenceRefs:[]};
    }catch(error){if(started)return unknown();if(error instanceof ProtocolError)throw error;throw mapImapError(error);}
    finally {lock?.release();}
  }

  private operationMessageId(kind: string, key: string): string {
    const digest = createHash('sha256').update(JSON.stringify([this.options.user, kind, key])).digest('hex');
    return `<pa-${digest}@personalagent.local>`;
  }

  assertSendIdentity(_accountRef: string, messageId: string, idempotencyKey: string): void {
    if (typeof messageId !== 'string' || !/^<[^<>\s]+>$/u.test(messageId)
      || typeof idempotencyKey !== 'string' || !idempotencyKey) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Original send key and valid Message-ID are required');
    }
    const expected = this.sendActions.get(idempotencyKey)?.messageId ?? this.operationMessageId('send', idempotencyKey);
    if (messageId !== expected) throw new ProtocolError('INVALID_ARGUMENT', 'Message-ID does not belong to the original send key');
  }

  async reconcileSend(accountRef: string, messageId: string, idempotencyKey: string): Promise<MailSendResult> {
    this.assertSendIdentity(accountRef, messageId, idempotencyKey);
    const folder = (await this.listFolders()).find(entry => entry.role === 'sent');
    if (!folder) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Mailbox does not advertise a Sent folder');
    const client = await this.connect();
    const lock = await client.getMailboxLock(folder.path);
    try {
      const uids = await client.search({header: {'message-id': messageId}}, {uid: true});
      if (Array.isArray(uids) && uids.length > 0) {
        // SEARCH may be fuzzy on a server. Require exact envelope identity.
        for await (const message of client.fetch(uids, {envelope: true}, {uid: true})) {
          if (message.envelope?.messageId === messageId) return {state: 'confirmed', messageId};
        }
      }
      return {state: 'unknown', messageId, reason: 'No exact Sent-folder match; absence does not prove non-delivery'};
    } catch (error) { throw mapImapError(error); }
    finally { lock.release(); }
  }

  async saveDraft(_accountRef: string, input: MailSendInput & {idempotencyKey: string}, context?: MailOperationContext): Promise<ProtocolContracts['connectorAction']> {
    guardMailWrite(context);
    if (!input.idempotencyKey) throw new ProtocolError('INVALID_ARGUMENT', 'idempotencyKey is required');
    const fingerprint = JSON.stringify([input.to, input.subject, input.text]);
    const prior = this.draftInflight.get(input.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ProtocolError('INVALID_ARGUMENT', 'Draft key was used with different content');
      return prior.inflight;
    }
    const inflight = this.appendDraft(input, context);
    this.draftInflight.set(input.idempotencyKey, {fingerprint, inflight});
    return inflight;
  }

  private async appendDraft(input: MailSendInput & {idempotencyKey: string}, context?: MailOperationContext): Promise<ProtocolContracts['connectorAction']> {
    const folder = (await this.listFolders(undefined, context)).find(entry => entry.role === 'drafts');
    guardMailWrite(context);
    if (!folder) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Mailbox does not advertise a Drafts folder');
    const messageId = this.operationMessageId('draft', input.idempotencyKey);
    const client = await this.connect();
    guardMailWrite(context);
    const lock = await client.getMailboxLock(folder.path);
    const actionId = `mail-draft:${input.idempotencyKey}`;
    let appendStarted = false;
    try {
      guardMailWrite(context);
      const existing = await client.search({header: {'message-id': messageId}}, {uid: true});
      guardMailWrite(context);
      if (Array.isArray(existing) && existing.length > 0) {
        for await (const message of client.fetch(existing, {envelope: true}, {uid: true})) {
          guardMailWrite(context);
          if (message.envelope?.messageId === messageId) {
            return {actionId, state: 'confirmed', externalId: `${folder.path}:${message.uid}`, evidenceRefs: []};
          }
        }
        guardMailWrite(context);
        throw new ProtocolError('EXTERNAL_FAILURE', 'Draft identity search could not be verified', false);
      }
      // streamTransport generates MIME in memory; it never connects to SMTP.
      const composer = nodemailer.createTransport({streamTransport: true, buffer: true, newline: 'windows'});
      const mime = await composer.sendMail({from: this.options.user, to: input.to,
        subject: input.subject, text: input.text, messageId});
      guardMailWrite(context);
      if (!Buffer.isBuffer(mime.message)) throw new ProtocolError('EXTERNAL_FAILURE', 'Draft MIME was not buffered', false);
      guardMailWrite(context);
      appendStarted = true;
      const appended = await client.append(folder.path, mime.message, ['\\Draft']);
      if (!appended || appended.uid === undefined) return {actionId, state: 'unknown', externalId: messageId, evidenceRefs: []};
      const readback = await client.fetchOne(String(appended.uid), {envelope: true}, {uid: true});
      if (!readback || readback.envelope?.messageId !== messageId) {
        return {actionId, state: 'unknown', externalId: messageId, evidenceRefs: []};
      }
      return {actionId, state: 'confirmed', externalId: `${folder.path}:${appended.uid}`, evidenceRefs: []};
    } catch (error) {
      if (!appendStarted) {
        if (error instanceof ProtocolError) throw error;
        throw mapImapError(error);
      }
      // APPEND may have succeeded before disconnection: do not reappend automatically.
      return {actionId, state: 'unknown', externalId: messageId, evidenceRefs: []};
    } finally { lock.release(); }
  }

  async dispose(): Promise<void> {
    this.client?.close();
    this.client = null;
    this.transporter?.close();
    this.transporter = null;
  }
}

function rejectAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`send timed out after ${ms}ms`)), ms).unref?.();
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapImapError(error: unknown): ProtocolError {
  const message = describe(error);
  if (/authentication|auth|login/i.test(message)) {
    return new ProtocolError('UNAUTHORIZED', 'QQ mail rejected the credentials (check 授权码)', false);
  }
  if (/timeout|etimedout/i.test(message)) {
    return new ProtocolError('TIMEOUT', 'QQ mail IMAP timed out', true);
  }
  if (/econnrefused|econnreset|enotfound|ehostunreach|certificate/i.test(message)) {
    return new ProtocolError('EXTERNAL_FAILURE', 'QQ mail IMAP connection failed', true);
  }
  return new ProtocolError('EXTERNAL_FAILURE', 'QQ mail IMAP request failed', true);
}

function roleOf(specialUse: string | undefined): MailFolder['role'] {
  if (specialUse === '\\Inbox') return 'inbox';
  if (specialUse === '\\Sent') return 'sent';
  if (specialUse === '\\Drafts') return 'drafts';
  if (specialUse === '\\Archive' || specialUse === '\\All') return 'archive';
  return 'other';
}
