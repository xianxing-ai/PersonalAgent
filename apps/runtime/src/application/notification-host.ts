import {randomUUID} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {ProtocolContracts,ToolContext} from '@personal-agent/contracts';
import {NotificationService,createNotificationSettingsTool} from '@personal-agent/notifications';
import type {NotificationSettingsUpdate,InterruptionReservation,NotificationChannel,NotificationFeedQuery,
  NotificationIngestContext,NotificationPolicy,NotificationScope,NotificationStage} from '@personal-agent/notifications';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createRuntimeAtomicStatePort} from '../atomic-host-state.js';
import type {TaskRuntime} from '../index.js';

export interface NotificationUserSettingsCommand {
  settings:NotificationSettingsUpdate;source:'structured'|'voice';phase:'final'|'partial';origin:'user'|'echo'|'model';echo:boolean;
  issuedAt:string;expiresAt:string;argumentsDigest:string;
  /** Final voice identity/digest, not raw microphone audio or a model's self-attestation. */
  utteranceId?:string;transcriptDigest?:string;proof:unknown;
}
export interface RuntimeNotificationHostOptions {
  policy:NotificationPolicy;settingsScopes:readonly string[];
  /** Existing host verifies original UI/voice origin, finality, echo filter, lease and signed payload.
   * Model fields saying final/user are insufficient. The callback is mandatory and has no default. */
  verifyUserCommand:(command:NotificationUserSettingsCommand,context:ToolContext)=>boolean|Promise<boolean>;
  /** Original host binding lookup for calls through the static ToolGateway tool. */
  resolveUserCommand?:(settings:NotificationSettingsUpdate,context:ToolContext)=>NotificationUserSettingsCommand|undefined|Promise<NotificationUserSettingsCommand|undefined>;
  now?:()=>number;idFactory?:()=>string;onStage?:(event:NotificationStage)=>void;
}
const utc=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(v)&&Number.isFinite(Date.parse(v));
/** One device-wide NotificationService over the original Runtime SQLite host-state namespace.
 * Methods below are trusted-host composition, not new REST/wire capabilities or authorization.
 * Device/channel execution still requires its original Runtime Policy/ToolGateway operation.
 */
export function createRuntimeNotificationHost(runtime:Pick<TaskRuntime,'bindTrustedHostState'>,options:RuntimeNotificationHostOptions) {
  if(!options||typeof options.verifyUserCommand!=='function'||!Array.isArray(options.settingsScopes)||!options.settingsScopes.length)
    throw new ProtocolError('INVALID_ARGUMENT','Explicit user-command verifier and existing settings scopes required');
  const now=options.now??Date.now,namespace='device-notifications',atomic=createRuntimeAtomicStatePort(runtime,namespace);
  const service=new NotificationService(atomic.storage,options.policy,{now,idFactory:options.idFactory??randomUUID,atomicState:atomic,
    ...(options.onStage?{onStage:options.onStage}:{})});
  async function verify(command:NotificationUserSettingsCommand|undefined,input:NotificationSettingsUpdate,context:ToolContext):Promise<boolean> {
    const time=now();
    if(!command||!['structured','voice'].includes(command.source)||command.phase!=='final'||command.origin!=='user'||command.echo!==false
      ||!utc(command.issuedAt)||!utc(command.expiresAt)||Date.parse(command.issuedAt)>time||Date.parse(command.expiresAt)<=time
      ||!command.argumentsDigest||command.argumentsDigest!==toolArgumentsDigest(input)||toolArgumentsDigest(command.settings)!==toolArgumentsDigest(input)
      ||command.source==='voice'&&(typeof command.utteranceId!=='string'||!command.utteranceId.trim()
        ||typeof command.transcriptDigest!=='string'||!/^[a-f0-9]{64}$/u.test(command.transcriptDigest)))return false;
    const accepted=await options.verifyUserCommand(structuredClone(command),context);
    // An asynchronous trusted verification may outlive the utterance lease. Never persist it late.
    return accepted===true&&Date.parse(command.expiresAt)>now();
  }
  const settingsTool=createNotificationSettingsTool(service,{requiredScopes:options.settingsScopes,
    verifyUserCommand:async(input,context)=>verify(await options.resolveUserCommand?.(structuredClone(input),context),input,context)});
  return {namespace,settingsTool,
    async applyUserCommand(command:NotificationUserSettingsCommand,context:ToolContext) {
      const original=structuredClone(command);
      const bound=createNotificationSettingsTool(service,{requiredScopes:options.settingsScopes,
        verifyUserCommand:(input,toolContext)=>verify(original,input,toolContext)});
      // Reuses the exact settings tool's scope, arguments digest, schema, deadline and policy CAS.
      return bound.execute(original.settings,context);
    },
    ingest:(items:readonly ProtocolContracts['connectorItem'][],metadata:NotificationIngestContext={})=>service.ingest(items,metadata),
    drain:()=>service.drain(),status:(scope?:NotificationScope)=>service.status(scope),
    importLegacyPolicy:(scope:NotificationScope,policy:NotificationPolicy)=>service.importLegacyPolicy(scope,policy),
    getLegacyPolicy:(scope:NotificationScope)=>service.getLegacyPolicy(scope),
    getInterruptionPolicy:(scope:NotificationScope)=>service.getInterruptionPolicy(scope),
    notificationFeed:(query:NotificationFeedQuery={})=>service.notificationFeed(query),
    acknowledgeRead:(input:{operationId:string;itemIds:readonly string[]})=>service.acknowledgeRead(input),
    withdrawNotifications:(input:{operationId:string;itemIds:readonly string[]})=>service.withdrawNotifications(input),
    getDigest:(input:{trigger:'on_return'|'scheduled'|'on_demand';scope?:NotificationScope})=>service.getDigest(input),
    reserveInterruption:(input:InterruptionReservation)=>service.reserveInterruption(input),
    beginDelivery:(input:{roundId:string;channel:NotificationChannel})=>service.beginDelivery(input),
    completeDelivery:(input:{roundId:string;channel:NotificationChannel;state:'delivered'|'unknown'|'failed';evidenceRefs:readonly string[]})=>service.completeDelivery(input),
    getInterruptionRound:(roundId:string)=>service.getInterruptionRound(roundId),
    acknowledge:(batchId:string)=>service.acknowledge(batchId),planSchedules:(conversationId:string)=>service.planSchedules(conversationId),
  };
}
export type RuntimeNotificationHost=ReturnType<typeof createRuntimeNotificationHost>;
