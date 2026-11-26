// F08/F09 业务工作流 host 端口与生产适配器实现（Potatos 分区）
// F08_N03 mail.registered_archive
// F08_N07 mail.registered_send
// F09_N02 feeds.validate_and_deduplicate
import {createHash} from 'node:crypto';
import {ProtocolError, isProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from './workflow-adapters.js';
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
      const uncertain = (reason: string, receipt?: Record<string, unknown>) => fail('unknown', reason, {
        state: 'unknown',
        idempotencyKey: input.idempotencyKey,
        reconciliationRequired: true,
        source: 'mail_send_receipt',
        ...(text(receipt?.actionId) ? {actionId: receipt.actionId} : {}),
        ...(text(receipt?.messageId) ? {messageId: receipt.messageId} : {}),
        ...(text(receipt?.externalId) ? {externalId: receipt.externalId} : {}),
      });
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
          return uncertain('mail_send_malformed_result', isPlainObject(result) ? result : undefined);
        }
        // PA-014 规范：unknown 不是失败，严禁盲目重发，返回 unknown 态以触发对账
        if (result.state === 'unknown') {
          return uncertain(result.reason ?? 'transport_timeout_needs_reconciliation', result);
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
        if (isProtocolError(error) && ['INVALID_ARGUMENT', 'UNAUTHORIZED', 'SCOPE_DENIED'].includes(error.code)) {
          return fail('failed', 'mail_send_failed');
        }
        return uncertain('mail_send_outcome_uncertain');
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
  readonly summary?: string;
  readonly record?: {
    readonly accountRef?: string;
    readonly externalId?: string;
    readonly dedupeKey?: string;
    readonly contentRef?: string;
    readonly occurredAt?: string;
    readonly source?: string;
  };
}

export interface FeedsSourceGrantCheck {
  readonly granted: boolean;
  readonly authorizationRef?: string;
  readonly reason?: string;
}

export interface FeedsValidationResult {
  readonly validItems: readonly RawFeedItem[];
  readonly uniqueCount: number;
  readonly duplicateDiscarded: number;
  readonly totalCount: number;
  readonly validCount: number;
  readonly duplicateCount: number;
  readonly invalidCount: number;
  readonly fingerprints: readonly string[];
  readonly validatedAt: string;
  readonly authorizationRef?: string;
  readonly source: 'feeds_validation_receipt';
}

export interface FeedsValidationOptions {
  resolveItems?(context: WorkflowNodeContext): readonly RawFeedItem[] | undefined;
  readonly knownFingerprints?: ReadonlySet<string> | undefined;
  authorizeSource?: ((
    context: WorkflowNodeContext,
    items: readonly RawFeedItem[],
  ) => FeedsSourceGrantCheck | Promise<FeedsSourceGrantCheck>) | undefined;
  readKnownFingerprints?: ((
    context: WorkflowNodeContext,
  ) => ReadonlySet<string> | readonly string[] | Promise<ReadonlySet<string> | readonly string[]>) | undefined;
  commitValidation?: ((entry: {
    fingerprints: readonly string[];
    validItems: readonly RawFeedItem[];
    result: FeedsValidationResult;
    context: WorkflowNodeContext;
  }) => void | Promise<void>) | undefined;
  now?: (() => number) | undefined;
}

function extractRawItems(input: unknown): readonly RawFeedItem[] | undefined {
  if (Array.isArray(input)) return input as readonly RawFeedItem[];
  if (!isPlainObject(input)) return undefined;
  if (Array.isArray(input.items)) return input.items as readonly RawFeedItem[];
  if (Array.isArray(input.events)) return input.events as readonly RawFeedItem[];
  return undefined;
}

function feedIdentityOf(item: unknown): {feedId: string; identity: string} | null {
  if (!isPlainObject(item)) return null;
  const record = isPlainObject(item.record) ? item.record : undefined;
  const identity =
    (text(item.guid) ? item.guid.trim() : undefined)
    ?? (text(item.id) ? item.id.trim() : undefined)
    ?? (text(item.url) ? item.url.trim() : undefined)
    ?? (record && text(record.dedupeKey) ? record.dedupeKey.trim() : undefined)
    ?? (record && text(record.externalId) ? record.externalId.trim() : undefined)
    ?? (record && text(record.contentRef) ? record.contentRef.trim() : undefined);
  if (!identity) return null;
  const feedId =
    (text(item.feedId) ? item.feedId.trim() : undefined)
    ?? (record && text(record.accountRef) ? record.accountRef.trim() : undefined)
    ?? '';
  return {feedId, identity};
}

export function createFeedsValidateAndDeduplicateHostPort(options?: FeedsValidationOptions): WorkflowHostPort {
  const clock = options?.now ?? Date.now;
  return {
    capabilities: ['feeds.validate_and_deduplicate'],
    async read(context: WorkflowNodeContext) {
      let rawItems: readonly RawFeedItem[] | undefined;
      if (options?.resolveItems) {
        rawItems = options.resolveItems(context);
      } else {
        rawItems = extractRawItems(context.input)
          ?? extractRawItems(context.predecessorOutputs?.F09_N01);
      }
      if (!Array.isArray(rawItems)) {
        return fail('unavailable', 'feed_items_unavailable');
      }

      let authorizationRef: string | undefined;
      if (options?.authorizeSource) {
        const auth = await options.authorizeSource(context, rawItems);
        if (!auth?.granted) {
          return fail('unavailable', auth?.reason ?? 'feed_source_grant_unavailable', {
            source: 'feeds_validation_receipt',
          });
        }
        if (text(auth.authorizationRef)) authorizationRef = auth.authorizationRef;
      }

      const known = new Set<string>(options?.knownFingerprints ?? []);
      if (options?.readKnownFingerprints) {
        const persisted = await options.readKnownFingerprints(context);
        for (const fp of persisted ?? []) {
          if (text(fp)) known.add(fp);
        }
      }

      const seenInBatch = new Set<string>();
      const validItems: RawFeedItem[] = [];
      const fingerprints: string[] = [];
      let invalidCount = 0;
      let duplicateCount = 0;

      for (const item of rawItems) {
        const identity = feedIdentityOf(item);
        if (!identity) {
          invalidCount++;
          continue;
        }
        const fp = createHash('sha256')
          .update(JSON.stringify(identity))
          .digest('hex');

        if (known.has(fp) || seenInBatch.has(fp)) {
          duplicateCount++;
          continue;
        }
        seenInBatch.add(fp);
        fingerprints.push(fp);
        validItems.push(item);
      }

      const value: FeedsValidationResult = {
        validItems,
        uniqueCount: validItems.length,
        duplicateDiscarded: duplicateCount,
        totalCount: rawItems.length,
        validCount: validItems.length,
        duplicateCount,
        invalidCount,
        fingerprints,
        validatedAt: new Date(clock()).toISOString(),
        ...(authorizationRef ? {authorizationRef} : {}),
        source: 'feeds_validation_receipt',
      };

      if (options?.commitValidation) {
        await options.commitValidation({fingerprints, validItems, result: value, context});
      }

      return {
        state: 'completed' as const,
        value,
      };
    },
  };
}

export function createFeedsValidateAndDeduplicateAdapter(options?: {
  requiredScopes?: readonly string[] | undefined;
  authorizeSource?: FeedsValidationOptions['authorizeSource'];
  readKnownFingerprints?: FeedsValidationOptions['readKnownFingerprints'];
  commitValidation?: FeedsValidationOptions['commitValidation'];
  knownFingerprints?: ReadonlySet<string> | undefined;
  now?: (() => number) | undefined;
}): RegisteredTool {
  const hostPort = createFeedsValidateAndDeduplicateHostPort({
    knownFingerprints: options?.knownFingerprints,
    authorizeSource: options?.authorizeSource,
    readKnownFingerprints: options?.readKnownFingerprints,
    commitValidation: options?.commitValidation,
    now: options?.now,
  });
  return createOwnedWorkflowAdapter({
    nodeId: 'F09_N02',
    kind: 'host',
    sideEffect: 'read',
    requiredScopes: [...(options?.requiredScopes ?? ['feeds:read'])],
    inputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        events: {type: 'array', items: {type: 'object'}},
        items: {type: 'array', items: {type: 'object'}},
        subscriptionId: {type: 'string', minLength: 1},
      },
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['uniqueCount', 'duplicateDiscarded', 'validCount', 'duplicateCount', 'invalidCount', 'totalCount', 'validItems', 'fingerprints', 'validatedAt', 'source'],
      properties: {
        validItems: {type: 'array'},
        uniqueCount: {type: 'integer', minimum: 0},
        duplicateDiscarded: {type: 'integer', minimum: 0},
        totalCount: {type: 'integer', minimum: 0},
        validCount: {type: 'integer', minimum: 0},
        duplicateCount: {type: 'integer', minimum: 0},
        invalidCount: {type: 'integer', minimum: 0},
        fingerprints: {type: 'array', items: {type: 'string'}},
        validatedAt: {type: 'string', minLength: 1},
        authorizationRef: {type: 'string', minLength: 1},
        source: {const: 'feeds_validation_receipt'},
      },
    },
    execute: async (input, context) => {
      const nodeContext = {
        input,
        taskId: context.taskId,
        signal: context.signal,
        deadline: context.deadline,
        requestId: context.runId ?? context.taskId,
        mode: 'main',
        predecessorStates: {F09_N01: 'completed'},
        predecessorOutputs: {},
      } as unknown as WorkflowNodeContext;
      const observation = await hostPort.read(nodeContext);
      if (observation.state !== 'completed') {
        const reason = isPlainObject(observation.value) && text(observation.value.reason)
          ? observation.value.reason
          : 'feeds_validation_unavailable';
        const code = /grant|auth|revoked/.test(reason) ? 'UNAUTHORIZED' : 'UNSUPPORTED_CAPABILITY';
        throw new ProtocolError(code, reason);
      }
      return observation.value;
    },
  });
}
