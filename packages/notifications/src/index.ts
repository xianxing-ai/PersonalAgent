import { ProtocolError,validateToolValue } from '@personal-agent/contracts';
import type { RegisteredTool, StoragePort, ToolDescriptor, ToolHost,ToolContext } from '@personal-agent/contracts';
import { NotificationService } from './service.js';
import type { DrainReport, StatusReport } from './service.js';
import { assertPolicyValid } from './policy.js';
import type { NotificationPolicy } from './policy.js';
import {notificationDigest} from './interruption.js';
import type {InterruptionPolicyUpdate,NotificationAtomicStatePort,NotificationStage} from './interruption.js';
export type {InterruptionPolicy,InterruptionPolicyPatch,NotificationScope,NotificationAtomicStatePort,NotificationStage,
  InterruptionPolicyUpdate,NotificationFeedEntry,NotificationIngestContext,NotificationFeedQuery,NotificationChannel,
  InterruptionReservation,InterruptionRound,NotificationDeliveryAttempt,ResolvedInterruptionPolicy} from './interruption.js';

export { NotificationService } from './service.js';
export type { DrainReport, NotificationBatch, NotificationServiceOptions, PendingItem, StatusReport } from './service.js';
export { assertPolicyValid, localMinuteOfDay, nextQuietEndMs, quietHoursActive } from './policy.js';
export type { DigestPolicy, NotificationPolicy, QuietHours } from './policy.js';

export const NOTIFICATIONS_MODULE_VERSION = '0.1.0-alpha.1';

const UTC_PATTERN_STRING = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$';

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

  return host.register(tool);
}

/** Trusted UI/voice command only. The callback consults the existing host user-command binding;
 * a model proposal or a receipt is not permission to edit settings. ToolGateway still owns Policy.
 */
export function createNotificationSettingsTool(service:NotificationService,options:{requiredScopes:readonly string[];
  verifyUserCommand:(input:InterruptionPolicyUpdate,context:ToolContext)=>boolean|Promise<boolean>}):RegisteredTool {
  if(!options?.requiredScopes?.length||options.requiredScopes.some(scope=>typeof scope!=='string'||!scope)
    ||typeof options.verifyUserCommand!=='function')throw new ProtocolError('INVALID_ARGUMENT','Trusted user-command verifier and existing settings scopes required');
  const descriptor:ToolDescriptor={name:'notifications.interruption_policy.set',version:NOTIFICATIONS_MODULE_VERSION,
    sideEffect:'local_write',requiredScopes:[...options.requiredScopes],idempotencySupport:true,recoverySupport:true,requiresPresence:false,
    inputSchema:{type:'object',additionalProperties:false,required:['operationId','expectedRevision','scope','patch'],properties:{
      operationId:{type:'string',minLength:1},expectedRevision:{type:'integer',minimum:0},scope:{type:'object',additionalProperties:false,
        required:['kind'],properties:{kind:{type:'string',enum:['global','connector','responsibility']},connectorId:{type:'string',minLength:1},responsibilityId:{type:'string',minLength:1}}},
      patch:{type:'object',additionalProperties:false,properties:{mode:{type:'string',enum:['normal','silent']},
        maxInterruptions:{type:['integer','null'],minimum:0},windowMinutes:{type:'number',minimum:0},silentUntilUtc:{type:['string','null']},
        preferredChannel:{type:'string',enum:['banner','voice','auto']},allowUrgentBreakthrough:{type:'boolean'},
        digestMode:{type:'string',enum:['on_return','scheduled','on_demand']},quietHours:{type:['object','null']}}}}},
    outputSchema:{type:'object',required:['operationId','revision','state','decidedAt'],properties:{operationId:{type:'string'},revision:{type:'integer'},
      state:{type:'string',enum:['configured','unconfigured']},decidedAt:{type:'string'}}}};
  const check=(context:ToolContext)=>{
    if(!context?.authorizationRef||!descriptor.requiredScopes.every(scope=>context.scopes.includes(scope)))throw new ProtocolError('SCOPE_DENIED','Notification settings scope required');
    if(!(context.signal instanceof AbortSignal)||context.signal.aborted)throw new ProtocolError('CANCELLED','Notification settings command cancelled');
    if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=Date.now())throw new ProtocolError('TIMEOUT','Notification settings command expired');
  };
  return {descriptor,async execute(input,context) {
    check(context);validateToolValue(descriptor.inputSchema,input);
    if(!context.argumentsDigest||context.argumentsDigest!==notificationDigest(input))throw new ProtocolError('UNAUTHORIZED','Original settings argument/version binding required');
    const command=structuredClone(input) as InterruptionPolicyUpdate;
    if(await options.verifyUserCommand(structuredClone(command),context)!==true)throw new ProtocolError('UNAUTHORIZED','Explicit trusted user settings command required');
    check(context);const result=service.updateInterruptionPolicy(command);validateToolValue(descriptor.outputSchema!,result);return result;
  }};
}
