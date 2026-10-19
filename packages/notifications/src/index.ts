import { ProtocolError,validateToolValue } from '@personal-agent/contracts';
import type { RegisteredTool, StoragePort, ToolDescriptor, ToolHost,ToolContext } from '@personal-agent/contracts';
import { NotificationService } from './service.js';
import type { DrainReport, StatusReport, NotificationBatchEventsPage } from './service.js';
import { assertPolicyValid } from './policy.js';
import type { NotificationPolicy } from './policy.js';
import {notificationDigest} from './interruption.js';
import type {NotificationSettingsUpdate,NotificationAtomicStatePort,NotificationStage} from './interruption.js';
export type {InterruptionPolicy,InterruptionPolicyPatch,NotificationScope,NotificationAtomicStatePort,NotificationStage,
  InterruptionPolicyUpdate,NotificationFeedEntry,NotificationIngestContext,NotificationFeedQuery,NotificationChannel,
  InterruptionReservation,InterruptionRound,NotificationDeliveryAttempt,ResolvedInterruptionPolicy,LegacyNotificationPolicyUpdate,NotificationSettingsUpdate} from './interruption.js';

export { NotificationService } from './service.js';
export {notificationDigest,assertInterruptionPatch,assertLegacyNotificationPolicy} from './interruption.js';
export type { DrainReport, NotificationBatch, NotificationServiceOptions, PendingItem, StatusReport,
  NotificationBatchEvent, NotificationBatchEventsPage } from './service.js';
export { assertPolicyValid, localMinuteOfDay, nextQuietEndMs, quietHoursActive } from './policy.js';
export type { DigestPolicy, NotificationPolicy, QuietHours } from './policy.js';

export const NOTIFICATIONS_MODULE_VERSION = '0.1.0-alpha.1';

const UTC_PATTERN_STRING = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$';

const eventsOutputSchema: ToolDescriptor['outputSchema'] = {
  type: 'object',
  required: ['eventVersion', 'snapshotRevision', 'cursorState', 'events', 'nextCursor', 'retained'],
  additionalProperties: false,
  properties: {
    eventVersion: {type: 'integer', const: 1},
    snapshotRevision: {type: 'integer', minimum: 0, description: '同一分页快照的持久状态版本。'},
    cursorState: {type: 'string', enum: ['current', 'compacted', 'changed'],
      description: 'changed：快照已变化，必须从第一页重新读取。'},
    events: {
      type: 'array', maxItems: 100,
      items: {
        type: 'object',
        required: ['eventVersion', 'batchId', 'kind', 'itemRefs', 'decidedAt', 'heldSince', 'reason', 'state'],
        additionalProperties: false,
        properties: {
          eventVersion: {type: 'integer', const: 1},
          batchId: {type: 'string'},
          kind: {type: 'string', enum: ['immediate', 'digest']},
          itemRefs: {type: 'array', items: {type: 'string'}, description: '条目去重键引用，不复制连接器内容。'},
          decidedAt: {type: 'string', pattern: UTC_PATTERN_STRING},
          heldSince: {type: 'string', pattern: UTC_PATTERN_STRING},
          reason: {type: 'string'},
          state: {type: 'string', enum: ['ready_for_delivery', 'delivered']},
          deliveredAt: {type: 'string', pattern: UTC_PATTERN_STRING,
            description: '仅在受信桌面确认接收后出现。'},
        },
      },
    },
    nextCursor: {type: ['string', 'null'], description: '还有更多页时为下一页游标；追平为 null。'},
    retained: {
      type: 'object', required: ['readyForDelivery', 'delivered'], additionalProperties: false,
      properties: {
        readyForDelivery: {type: 'integer', minimum: 0},
        delivered: {type: 'integer', minimum: 0},
      },
    },
  },
};

const statusOutputSchema: ToolDescriptor['outputSchema'] = {
  type: 'object',
  required: ['pausedUntil', 'quietUntil', 'pending', 'nextDigestCloseAt', 'unacknowledgedBatches', 'policy'],
  additionalProperties: false,
  properties: {
    pausedUntil: {type: ['string', 'null'], pattern: UTC_PATTERN_STRING},
    quietUntil: {type: ['string', 'null'], pattern: UTC_PATTERN_STRING},
    pending: {type: 'integer', minimum: 0},
    nextDigestCloseAt: {type: ['string', 'null'], pattern: UTC_PATTERN_STRING},
    unacknowledgedBatches: {type: 'integer', minimum: 0, description: '已裁定但桌面尚未确认接收的批次数；崩溃重启后这些批次会被 drain 原样返回。'},
    interruptionQuotaSafety:{type:'string',enum:['atomic','unavailable']},
    policy: {
      type: 'object',
      required: ['quietHoursConfigured', 'pauseConfigured', 'digestConfigured'],
      additionalProperties: false,
      properties: {
        quietHoursConfigured: {type: 'boolean'},
        pauseConfigured: {type: 'boolean'},
        digestConfigured: {type: 'boolean'},
        quietStartLocal: {type: 'string'},
        quietEndLocal: {type: 'string'},
        quietTimeZone: {type: 'string'},
        digestWindowMs: {type: 'integer', minimum: 60000},
        digestMaxItems: {type: 'integer', minimum: 1, maximum: 100},
      },
    },
  },
};

export interface NotificationsModuleOptions {
  storage: StoragePort;
  policy: NotificationPolicy;
  now?: () => number;
  idFactory?: () => string;
  atomicState?:NotificationAtomicStatePort;
  onStage?:(event:NotificationStage)=>void;
}

/**
 * 注册只读状态工具 `notifications.status`。裁定由宿主在 Runtime 调度点调用
 * `service.drain()`（调度建议见 `service.planSchedules`）；展示归 `zemeng` 的桌面端。
 * 策略是装配期注入的用户规则，本包不提供运行期改写工具。
 */
export function register(host: ToolHost, options: NotificationsModuleOptions): () => void {
  if (!options?.storage) throw new ProtocolError('INVALID_ARGUMENT', 'Notification storage must be explicitly provided');
  if (!options?.policy) throw new ProtocolError('INVALID_ARGUMENT', 'Notification policy must be explicitly provided');
  assertPolicyValid(options.policy);
  let counter = 0;
  const service = new NotificationService(options.storage, options.policy, {
    now: options.now ?? Date.now,
    idFactory: options.idFactory ?? (() => `notif_${Date.now().toString(36)}_${(++counter).toString(36)}`),
    ...(options.atomicState?{atomicState:options.atomicState}:{}),...(options.onStage?{onStage:options.onStage}:{}),
  });

  const tool: RegisteredTool = {
    descriptor: {
      name: 'notifications.status',
      version: NOTIFICATIONS_MODULE_VERSION,
      inputSchema: {
        type: 'object',
        description: '查询通知策略的当前状态：暂停/安静时段是否生效、待裁定条数、下一个聚合窗口关闭时刻。只读，不触发裁定。',
        additionalProperties: false,
        properties: {},
      },
      outputSchema: statusOutputSchema,
      sideEffect: 'read',
      requiredScopes: ['notifications:read'],
      idempotencySupport: true,
      recoverySupport: true,
      requiresPresence: false,
    },
    execute: async (): Promise<StatusReport & {policy: Record<string, unknown>}> => {
      const status = service.status();
      const policy: Record<string, unknown> = {
        quietHoursConfigured: options.policy.quietHours !== undefined,
        pauseConfigured: options.policy.pauseUntilUtc !== undefined,
        digestConfigured: options.policy.digest !== undefined,
      };
      if (options.policy.quietHours !== undefined) {
        policy.quietStartLocal = options.policy.quietHours.startLocal;
        policy.quietEndLocal = options.policy.quietHours.endLocal;
        policy.quietTimeZone = options.policy.quietHours.timeZone;
      }
      if (options.policy.digest !== undefined) {
        policy.digestWindowMs = options.policy.digest.windowMs;
        policy.digestMaxItems = options.policy.digest.maxItems;
      }
      return {...status, policy};
    },
  };

  const eventsTool: RegisteredTool = {
    descriptor: {
      name: 'notifications.events',
      version: NOTIFICATIONS_MODULE_VERSION,
      inputSchema: {
        type: 'object',
        description: '版本化批次状态快照（F12 消费端口）：按裁定顺序分页返回最小投影，条目只引用 dedupeKey。'
          + '续页须回传 snapshotRevision；changed 时从头重读。只读，不触发裁定或代替接收确认。',
        additionalProperties: false,
        properties: {
          sinceBatchId: {type: 'string', minLength: 1, maxLength: 128,
            description: '同一快照内续页的上一页最后一条 batchId。'},
          snapshotRevision: {type: 'integer', minimum: 0, description: '续页须回传首屏返回的版本；不匹配时 cursorState=changed。'},
          limit: {type: 'integer', minimum: 1, maximum: 100, description: '单页上限，默认 20。'},
        },
      },
      outputSchema: eventsOutputSchema,
      sideEffect: 'read',
      requiredScopes: ['notifications:read'],
      idempotencySupport: true,
      recoverySupport: true,
      requiresPresence: false,
    },
    execute: async (input: unknown): Promise<NotificationBatchEventsPage> => {
      const request = input as {sinceBatchId?: string; snapshotRevision?: number; limit?: number};
      return service.readBatchEvents({...(request?.sinceBatchId === undefined ? {} : {sinceBatchId: request.sinceBatchId}),
        ...(request?.snapshotRevision === undefined ? {} : {snapshotRevision: request.snapshotRevision}),
        ...(request?.limit === undefined ? {} : {limit: request.limit})});
    },
  };

  const disposeStatus = host.register(tool);
  const disposeEvents = host.register(eventsTool);
  return () => {disposeEvents(); disposeStatus();};
}

/** Trusted UI/voice command only. The callback consults the existing host user-command binding;
 * a model proposal or a receipt is not permission to edit settings. ToolGateway still owns Policy.
 */
export function createNotificationSettingsTool(service:NotificationService,options:{requiredScopes:readonly string[];
  verifyUserCommand:(input:NotificationSettingsUpdate,context:ToolContext)=>boolean|Promise<boolean>}):RegisteredTool {
  if(!options?.requiredScopes?.length||options.requiredScopes.some(scope=>typeof scope!=='string'||!scope)
    ||typeof options.verifyUserCommand!=='function')throw new ProtocolError('INVALID_ARGUMENT','Trusted user-command verifier and existing settings scopes required');
  const descriptor=createNotificationSettingsDescriptor(options.requiredScopes);
  const check=(context:ToolContext)=>{
    if(!context?.authorizationRef||!descriptor.requiredScopes.every(scope=>context.scopes.includes(scope)))throw new ProtocolError('SCOPE_DENIED','Notification settings scope required');
    if(!(context.signal instanceof AbortSignal)||context.signal.aborted)throw new ProtocolError('CANCELLED','Notification settings command cancelled');
    if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=Date.now())throw new ProtocolError('TIMEOUT','Notification settings command expired');
  };
  return {descriptor,async execute(input,context) {
    check(context);validateToolValue(descriptor.inputSchema,input);
    if(!context.argumentsDigest||context.argumentsDigest!==notificationDigest(input))throw new ProtocolError('UNAUTHORIZED','Original settings argument/version binding required');
    const command=structuredClone(input) as NotificationSettingsUpdate;
    if(await options.verifyUserCommand(structuredClone(command),context)!==true)throw new ProtocolError('UNAUTHORIZED','Explicit trusted user settings command required');
    check(context);const result='legacyPolicy' in command?service.updateLegacyPolicy(command):service.updateInterruptionPolicy(command);
    validateToolValue(descriptor.outputSchema!,result);return result;
  }};
}

/** Public descriptor for late-bound application composition; it grants no settings authority. */
export function createNotificationSettingsDescriptor(requiredScopes:readonly string[]):ToolDescriptor {
  if(!Array.isArray(requiredScopes)||!requiredScopes.length||requiredScopes.some(scope=>typeof scope!=='string'||!scope))
    throw new ProtocolError('INVALID_ARGUMENT','Explicit notification settings scopes required');
  return {name:'notifications.interruption_policy.set',version:NOTIFICATIONS_MODULE_VERSION,
    sideEffect:'local_write',requiredScopes:[...requiredScopes],idempotencySupport:true,recoverySupport:true,requiresPresence:false,
    inputSchema:{type:'object',additionalProperties:false,required:['operationId','expectedRevision','scope'],
      oneOf:[{required:['patch'],not:{required:['legacyPolicy']}},{required:['legacyPolicy'],not:{required:['patch']}}],properties:{
      operationId:{type:'string',minLength:1},expectedRevision:{type:'integer',minimum:0},scope:{type:'object',additionalProperties:false,
        required:['kind'],properties:{kind:{type:'string',enum:['global','connector','responsibility']},connectorId:{type:'string',minLength:1},responsibilityId:{type:'string',minLength:1}}},
      patch:{type:'object',additionalProperties:false,properties:{mode:{type:'string',enum:['normal','silent']},
        maxInterruptions:{type:['integer','null'],minimum:0},windowMinutes:{type:'number',minimum:0},silentUntilUtc:{type:['string','null']},
        preferredChannel:{type:'string',enum:['banner','voice','auto']},allowUrgentBreakthrough:{type:'boolean'},
        digestMode:{type:'string',enum:['on_return','scheduled','on_demand']},quietHours:{type:['object','null']}}},
      legacyPolicy:{type:'object',additionalProperties:false,properties:{pauseUntilUtc:{type:'string',pattern:UTC_PATTERN_STRING},
        quietHours:{type:'object',additionalProperties:false,required:['startLocal','endLocal','timeZone'],properties:{
          startLocal:{type:'string'},endLocal:{type:'string'},timeZone:{type:'string'}}},
        digest:{type:'object',additionalProperties:false,required:['windowMs','maxItems'],properties:{windowMs:{type:'integer',minimum:60000},
          maxItems:{type:'integer',minimum:1,maximum:100},sources:{type:'array',items:{type:'string',minLength:1}}}}}}}},
    outputSchema:{type:'object',required:['operationId','revision','state','decidedAt'],properties:{operationId:{type:'string'},revision:{type:'integer'},
      state:{type:'string',enum:['configured','unconfigured']},decidedAt:{type:'string'}}}};
}
