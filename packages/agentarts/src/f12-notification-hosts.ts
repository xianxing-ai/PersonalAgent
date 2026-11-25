// F12/F06 通知策略、渠道投递与归来摘要 host 端口实现
// F12_N02 policy.quiet_hours
// F06_N05 / F12_N04 notification.deliver
// F12_N05 notification.deliver_when_due
import {createHash} from 'node:crypto';
import type {WorkflowHostPort, WorkflowNodeContext} from './owned-workflows.js';

const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function fail(state: 'unavailable' | 'failed' | 'unknown', reason: string, extra?: Record<string, unknown>) {
  return {state, value: {reason, ...(extra ?? {})}};
}

// ---------------------------------------------------------------------------
// F12_N02: policy.quiet_hours
// ---------------------------------------------------------------------------
export interface NotificationPolicyReadPort {
  readPolicy(scope: Record<string, unknown>, context: WorkflowNodeContext):
    Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
}

export interface PolicyQuietHoursHostOptions {
  readonly policyPort: NotificationPolicyReadPort;
  resolveScope?(context: WorkflowNodeContext): Record<string, unknown> | undefined;
  readonly now?: () => number;
}

export function createPolicyQuietHoursHostPort(options: PolicyQuietHoursHostOptions): WorkflowHostPort {
  if (typeof options?.policyPort?.readPolicy !== 'function') {
    throw new TypeError('createPolicyQuietHoursHostPort 需要 policyPort.readPolicy');
  }
  const clock = options.now ?? Date.now;
  return {
    capabilities: ['policy.quiet_hours'],
    async read(context: WorkflowNodeContext) {
      const scope = options.resolveScope?.(context)
        ?? (isPlainObject(context.input) && isPlainObject(context.input.scope) ? context.input.scope : {kind: 'global'});
      try {
        const policy = await options.policyPort.readPolicy(scope, context);
        if (!isPlainObject(policy)) {
          return fail('unavailable', 'notification_policy_unavailable');
        }
        const effective = isPlainObject(policy.effective) ? policy.effective : policy;
        const silentUntilUtc = typeof effective.silentUntilUtc === 'string' ? effective.silentUntilUtc : null;
        const pausedNow = silentUntilUtc !== null && Date.parse(silentUntilUtc) > clock();
        const mode = typeof effective.mode === 'string' ? effective.mode : 'normal';
        return {
          state: 'completed' as const,
          value: {
            scope,
            state: typeof policy.state === 'string' ? policy.state : 'configured',
            revision: typeof policy.revision === 'number' ? policy.revision : 0,
            mode,
            maxInterruptions: effective.maxInterruptions ?? null,
            windowMinutes: effective.windowMinutes ?? null,
            silentUntilUtc,
            preferredChannel: effective.preferredChannel ?? 'banner',
            allowUrgentBreakthrough: effective.allowUrgentBreakthrough === true,
            digestMode: effective.digestMode ?? 'on_return',
            quietHours: effective.quietHours ?? null,
            pausedNow,
            observedAt: new Date(clock()).toISOString(),
            source: 'notification_policy_readback',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= clock()) throw error;
        return fail('unavailable', 'notification_policy_unavailable');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// F06_N05 / F12_N04: notification.deliver
// ---------------------------------------------------------------------------
export interface NotificationDeliverRequest {
  readonly batchId: string;
  readonly scope?: Record<string, unknown>;
  readonly expiresAt: string;
  readonly title: string;
  readonly body: string;
  readonly source?: string;
  readonly navigation?: Record<string, unknown>;
}

export interface NotificationDeliveryChannelPort {
  deliver(request: NotificationDeliverRequest, context: WorkflowNodeContext):
    Promise<Record<string, unknown> | undefined>;
}

export interface NotificationDeliverHostOptions {
  readonly deliveryPort: NotificationDeliveryChannelPort;
  resolveRequest?(context: WorkflowNodeContext): NotificationDeliverRequest | undefined;
  readonly now?: () => number;
}

export function createNotificationDeliverHostPort(options: NotificationDeliverHostOptions): WorkflowHostPort {
  if (typeof options?.deliveryPort?.deliver !== 'function') {
    throw new TypeError('createNotificationDeliverHostPort 需要 deliveryPort.deliver');
  }
  const clock = options.now ?? Date.now;
  return {
    capabilities: ['notification.deliver'],
    async read(context: WorkflowNodeContext) {
      const req = options.resolveRequest?.(context)
        ?? (isPlainObject(context.input) ? (context.input as unknown as NotificationDeliverRequest) : undefined);
      if (!req || !text(req.batchId) || !text(req.title) || !text(req.body) || !text(req.expiresAt)) {
        return fail('unavailable', 'notification_deliver_input_unavailable');
      }
      try {
        const receipt = await options.deliveryPort.deliver(req, context);
        if (!isPlainObject(receipt)) {
          return fail('unknown', 'notification_delivery_outcome_unknown', {
            reconciliationRequired: true,
            batchId: req.batchId,
            source: 'notification_delivery_receipt',
          });
        }
        if (receipt.state === 'unavailable') {
          return fail('unavailable', typeof receipt.reason === 'string' ? receipt.reason : 'notification_channel_unavailable');
        }
        if (receipt.state === 'suppressed' || receipt.state === 'failed' || receipt.counted === false) {
          return fail('failed', typeof receipt.reason === 'string' ? receipt.reason : 'notification_delivery_suppressed', {
            batchId: req.batchId,
            ...(typeof receipt.roundId === 'string' ? {roundId: receipt.roundId} : {}),
            ...(typeof receipt.policyRevisionDigest === 'string' ? {policyRevisionDigest: receipt.policyRevisionDigest} : {}),
            source: 'notification_delivery_receipt',
          });
        }
        const attempts = isPlainObject(receipt.attempts) ? receipt.attempts : undefined;
        const banner = attempts && isPlainObject(attempts.banner) ? attempts.banner : undefined;
        const attemptState = typeof banner?.state === 'string'
          ? banner.state
          : typeof receipt.deliveryState === 'string'
            ? receipt.deliveryState
            : undefined;
        if (attemptState === 'failed') {
          return fail('failed', 'notification_channel_failed', {
            batchId: req.batchId,
            ...(typeof receipt.roundId === 'string' ? {roundId: receipt.roundId} : {}),
            source: 'notification_delivery_receipt',
          });
        }
        if (attemptState === 'withdrawn') {
          return fail('failed', 'notification_withdrawn', {
            batchId: req.batchId,
            ...(typeof receipt.roundId === 'string' ? {roundId: receipt.roundId} : {}),
            source: 'notification_delivery_receipt',
          });
        }
        if (attemptState !== 'delivered' && attemptState !== 'acknowledged') {
          return fail('unknown', 'notification_delivery_pending_receipt', {
            batchId: req.batchId,
            ...(typeof receipt.roundId === 'string' ? {roundId: receipt.roundId} : {}),
            deliveryState: attemptState ?? 'unknown',
            reconciliationRequired: true,
            source: 'notification_delivery_receipt',
          });
        }
        const evidenceRefs = Array.isArray(banner?.evidenceRefs)
          ? banner.evidenceRefs
          : Array.isArray(receipt.evidenceRefs)
            ? receipt.evidenceRefs
            : [];
        return {
          state: 'completed' as const,
          value: {
            delivered: true,
            batchId: req.batchId,
            ...(typeof receipt.roundId === 'string' ? {roundId: receipt.roundId} : {}),
            deliveryState: attemptState,
            evidenceRefs,
            receiptRef: typeof receipt.roundId === 'string' ? receipt.roundId : req.batchId,
            deliveredAt: new Date(clock()).toISOString(),
            source: 'notification_delivery_receipt',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= clock()) throw error;
        return fail('unknown', 'notification_delivery_outcome_uncertain', {
          batchId: req.batchId,
          reconciliationRequired: true,
          source: 'notification_delivery_receipt',
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// F12_N05: notification.deliver_when_due
// ---------------------------------------------------------------------------
export interface NotificationWhenDuePort {
  getDigest(query: Record<string, unknown>, context: WorkflowNodeContext): Promise<unknown> | unknown;
  acknowledgeRead?(input: Record<string, unknown>, context: WorkflowNodeContext): Promise<unknown> | unknown;
  withdraw?(input: Record<string, unknown>, context: WorkflowNodeContext): Promise<unknown> | unknown;
}

export interface NotificationWhenDueHostOptions {
  readonly ledgerPort: NotificationWhenDuePort;
  readonly now?: () => number;
}

export function createNotificationDeliverWhenDueHostPort(options: NotificationWhenDueHostOptions): WorkflowHostPort {
  if (typeof options?.ledgerPort?.getDigest !== 'function') {
    throw new TypeError('createNotificationDeliverWhenDueHostPort 需要 ledgerPort.getDigest');
  }
  const clock = options.now ?? Date.now;
  return {
    capabilities: ['notification.deliver_when_due'],
    async read(context: WorkflowNodeContext) {
      const input = isPlainObject(context.input) ? context.input : {};
      const action = typeof input.action === 'string' ? input.action : 'digest';
      try {
        if (action === 'acknowledge') {
          if (typeof options.ledgerPort.acknowledgeRead !== 'function' || !text(input.operationId) || !Array.isArray(input.itemIds)) {
            return fail('unavailable', 'notification_ack_unavailable');
          }
          const ack = await options.ledgerPort.acknowledgeRead({
            operationId: input.operationId,
            itemIds: input.itemIds,
          }, context);
          return {
            state: 'completed' as const,
            value: {
              action: 'acknowledge',
              readAck: true,
              ack,
              observedAt: new Date(clock()).toISOString(),
              source: 'notification_ledger_receipt',
            },
          };
        }
        if (action === 'withdraw') {
          if (typeof options.ledgerPort.withdraw !== 'function') {
            return fail('unavailable', 'notification_withdraw_unavailable');
          }
          const withdrawn = await options.ledgerPort.withdraw({
            id: input.id,
            roundId: input.roundId,
            reason: input.reason ?? 'withdrawn',
          }, context);
          if (!isPlainObject(withdrawn) || withdrawn.withdrawn !== true) {
            return fail('failed', isPlainObject(withdrawn) && typeof withdrawn.reason === 'string'
              ? withdrawn.reason
              : 'notification_withdraw_failed');
          }
          return {
            state: 'completed' as const,
            value: {
              action: 'withdraw',
              withdrawn: true,
              withdrawnAt: withdrawn.withdrawnAt,
              observedAt: new Date(clock()).toISOString(),
              source: 'notification_ledger_receipt',
            },
          };
        }
        const trigger = typeof input.trigger === 'string' && ['on_return', 'scheduled', 'on_demand'].includes(input.trigger)
          ? input.trigger
          : 'on_return';
        const digestResult = await options.ledgerPort.getDigest({
          trigger,
          ...(isPlainObject(input.scope) ? {scope: input.scope} : {}),
        }, context);
        const digestRef = createHash('sha256').update(JSON.stringify(digestResult ?? {})).digest('hex');
        return {
          state: 'completed' as const,
          value: {
            action: 'digest',
            digestRef,
            digest: digestResult,
            observedAt: new Date(clock()).toISOString(),
            source: 'notification_ledger_receipt',
          },
        };
      } catch (error) {
        if (context.signal.aborted || Date.parse(context.deadline) <= clock()) throw error;
        return fail('failed', 'notification_ledger_failed');
      }
    },
  };
}
