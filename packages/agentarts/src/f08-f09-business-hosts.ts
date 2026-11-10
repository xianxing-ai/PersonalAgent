// F08/F09 业务工作流 host 端口实现（Potatos 分区）
// F08_N03 mail.registered_archive
// F08_N07 mail.registered_send
// F09_N02 feeds.validate_and_deduplicate
import {createHash} from 'node:crypto';
import type {WorkflowHostPort, WorkflowNodeContext} from './owned-workflows.js';

const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function fail(state: 'unavailable' | 'failed' | 'unknown', reason: string, extra?: Record<string, unknown>) {
  return {state, value: {reason, ...(extra ?? {})}};
}

const mailPendingCap = (suffix: 'registered_archive' | 'registered_send'): string => `mail.${suffix}`;

// ---------------------------------------------------------------------------
// F08_N03: mail.registered_archive（host 口已就绪，待 mail 连接器落真实归档提供者）
// ---------------------------------------------------------------------------
export interface MailArchiveInput {
  readonly accountRef: string;
  readonly messageId: string;
  readonly targetFolder?: string;
}

export interface MailWorkflowArchivePort {
  execute(operation: 'mail.archive', input: Record<string, unknown>, context: WorkflowNodeContext):
    Promise<{archived: boolean; messageId: string; folder: string}>;
}

export interface MailArchiveHostOptions {
  readonly mailPort: MailWorkflowArchivePort;
  resolveArchive(context: WorkflowNodeContext): MailArchiveInput | undefined;
}

export function createMailRegisteredArchiveHostPort(options: MailArchiveHostOptions): WorkflowHostPort {
  if (typeof options?.mailPort?.execute !== 'function' || typeof options?.resolveArchive !== 'function') {
    throw new TypeError('createMailRegisteredArchiveHostPort 需要 mailPort 与 resolveArchive');
  }
  return {
    capabilities: [mailPendingCap('registered_archive')],
    async read(context: WorkflowNodeContext) {
      const input = options.resolveArchive(context);
      if (!input || !text(input.accountRef) || !text(input.messageId)) {
        return fail('unavailable', 'mail_archive_input_unavailable');
      }
      try {
        const folder = input.targetFolder ?? 'Archive';
        const result = await options.mailPort.execute('mail.archive', {
          accountRef: input.accountRef,
          messageId: input.messageId,
          targetFolder: folder,
        }, context);
        if (!isPlainObject(result) || !result.archived) {
          return fail('failed', 'mail_archive_unconfirmed');
        }
        return {
          state: 'completed' as const,
          value: {
            messageId: input.messageId,
            archivedTo: folder,
            confirmed: true,
            archivedAt: new Date().toISOString(),
            source: 'mail_archive_receipt',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw error;
        return fail('failed', 'mail_archive_failed');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// F08_N07: mail.registered_send（host 口已就绪，对齐 MailService.send 的 externalId / messageId）
// ---------------------------------------------------------------------------
export interface MailSendInput {
  readonly accountRef: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly idempotencyKey: string;
  readonly timeoutMs?: number;
}

export interface MailWorkflowSendPort {
  execute(operation: 'mail.send', input: Record<string, unknown>, context: WorkflowNodeContext):
    Promise<{state: 'confirmed' | 'unknown'; messageId?: string; externalId?: string; actionId?: string; reason?: string}>;
}

export interface MailSendHostOptions {
  readonly mailPort: MailWorkflowSendPort;
  resolveSend(context: WorkflowNodeContext): MailSendInput | undefined;
}

export function createMailRegisteredSendHostPort(options: MailSendHostOptions): WorkflowHostPort {
  if (typeof options?.mailPort?.execute !== 'function' || typeof options?.resolveSend !== 'function') {
    throw new TypeError('createMailRegisteredSendHostPort 需要 mailPort 与 resolveSend');
  }
  return {
    capabilities: [mailPendingCap('registered_send')],
    async read(context: WorkflowNodeContext) {
      const input = options.resolveSend(context);
      if (!input || !text(input.accountRef) || !text(input.to) || !text(input.subject) || !text(input.idempotencyKey)) {
        return fail('unavailable', 'mail_send_input_unavailable');
      }
      try {
        const result = await options.mailPort.execute('mail.send', {
          accountRef: input.accountRef,
          to: input.to,
          subject: input.subject,
          text: input.text,
          idempotencyKey: input.idempotencyKey,
          timeoutMs: input.timeoutMs ?? 15_000,
        }, context);
        if (!isPlainObject(result) || !['confirmed', 'unknown'].includes(result.state)) {
          return fail('failed', 'mail_send_malformed_result');
        }
        // PA-014 规范：unknown 不是失败，严禁盲目重发，返回 unknown 态以触发对账
        if (result.state === 'unknown') {
          return {
            state: 'unknown' as const,
            value: {
              state: 'unknown',
              reason: result.reason ?? 'transport_timeout_needs_reconciliation',
              idempotencyKey: input.idempotencyKey,
              source: 'mail_send_receipt',
            },
          };
        }
        const resolvedMessageId =
          typeof result.messageId === 'string'
            ? result.messageId
            : typeof result.externalId === 'string'
              ? result.externalId
              : undefined;
        return {
          state: 'completed' as const,
          value: {
            state: 'confirmed',
            messageId: resolvedMessageId,
            externalId: resolvedMessageId,
            sentAt: new Date().toISOString(),
            idempotencyKey: input.idempotencyKey,
            source: 'mail_send_receipt',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= Date.now()) throw error;
        return fail('failed', 'mail_send_failed');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// F09_N02: feeds.validate_and_deduplicate
// ---------------------------------------------------------------------------
export interface RawFeedItem {
  readonly id?: string;
  readonly guid?: string;
  readonly feedId?: string;
  readonly url?: string;
  readonly title?: string;
  readonly publishedAt?: string;
  readonly content?: string;
}

export interface FeedsValidationOptions {
  resolveItems?(context: WorkflowNodeContext): readonly RawFeedItem[] | undefined;
  readonly knownFingerprints?: ReadonlySet<string>;
}

export function createFeedsValidateAndDeduplicateHostPort(options?: FeedsValidationOptions): WorkflowHostPort {
  return {
    capabilities: ['feeds.validate_and_deduplicate'],
    async read(context: WorkflowNodeContext) {
      let rawItems: readonly RawFeedItem[] | undefined;
      if (options?.resolveItems) {
        rawItems = options.resolveItems(context);
      } else if (Array.isArray(context.input)) {
        rawItems = context.input as readonly RawFeedItem[];
      } else if (isPlainObject(context.input) && Array.isArray((context.input as {items?: unknown}).items)) {
        rawItems = (context.input as {items: readonly RawFeedItem[]}).items;
      }
      if (!Array.isArray(rawItems)) {
        return fail('unavailable', 'feed_items_unavailable');
      }
      const known = options?.knownFingerprints ?? new Set<string>();
      const seenInBatch = new Set<string>();
      const validItems: RawFeedItem[] = [];
      const fingerprints: string[] = [];
      let invalidCount = 0;
      let duplicateCount = 0;

      for (const item of rawItems) {
        if (!isPlainObject(item) || (!text(item.url) && !text(item.id) && !text(item.guid))) {
          invalidCount++;
          continue;
        }
        const identityStr = item.guid ?? item.id ?? item.url!;
        const fp = createHash('sha256')
          .update(JSON.stringify({feedId: item.feedId ?? '', identity: identityStr}))
          .digest('hex');

        if (known.has(fp) || seenInBatch.has(fp)) {
          duplicateCount++;
          continue;
        }
        seenInBatch.add(fp);
        fingerprints.push(fp);
        validItems.push(item);
      }

      return {
        state: 'completed' as const,
        value: {
          validItems,
          totalCount: rawItems.length,
          validCount: validItems.length,
          duplicateCount,
          invalidCount,
          fingerprints,
          validatedAt: new Date().toISOString(),
          source: 'feeds_validation_receipt',
        },
      };
    },
  };
}
