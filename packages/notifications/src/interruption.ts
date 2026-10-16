import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {assertPolicyValid,quietHoursActive} from './policy.js';
import type {QuietHours,NotificationPolicy} from './policy.js';

export type NotificationScope={kind:'global'}|{kind:'connector';connectorId:string}
  |{kind:'responsibility';responsibilityId:string;connectorId?:string};
export interface InterruptionPolicy {
  mode:'normal'|'silent';maxInterruptions:number|null;windowMinutes:number;silentUntilUtc:string|null;
  preferredChannel:'banner'|'voice'|'auto';allowUrgentBreakthrough:boolean;
  digestMode:'on_return'|'scheduled'|'on_demand';quietHours:QuietHours|null;
}
export type InterruptionPolicyPatch=Partial<InterruptionPolicy>;
export interface NotificationAtomicStatePort {
  /** Existing state host must return detached values. Legacy unwrapped state may have revision 0. */
  read(key:string):{revision:number;value:unknown}|undefined;
  /** Atomic across processes; the host increments its envelope revision exactly once on success. */
  compareAndSet(key:string,expectedRevision:number|undefined,nextValue:unknown):boolean;
}
export interface NotificationStage {stage:string;observedAt:string;details:Readonly<Record<string,unknown>>}
export interface InterruptionPolicyUpdate {operationId:string;expectedRevision:number;scope:NotificationScope;patch:InterruptionPolicyPatch}
export interface LegacyNotificationPolicyUpdate {operationId:string;expectedRevision:number;scope:NotificationScope;legacyPolicy:NotificationPolicy}
export type NotificationSettingsUpdate=InterruptionPolicyUpdate|LegacyNotificationPolicyUpdate;
export interface NotificationFeedEntry {
  id:string;cursor:number;source:string;contentRef:string;occurredAt:string;receivedAt:string;scope:NotificationScope;
  validUntilUtc:string|null;urgent:boolean;readAt?:string;deliveredAt?:string;withdrawnAt?:string;
}
export interface NotificationIngestContext {scope?:NotificationScope;validUntilUtc?:string|null;urgent?:boolean;supersedes?:readonly string[]}
export interface NotificationFeedQuery {afterCursor?:number;unreadOnly?:boolean;scope?:NotificationScope;limit?:number}
export type NotificationChannel='banner'|'voice';
export interface InterruptionReservation {
  roundId:string;batchIds:readonly string[];scope:NotificationScope;channels:readonly NotificationChannel[];expiresAt:string;urgent?:boolean;
}
export interface NotificationDeliveryAttempt {state:'sending'|'delivered'|'unknown'|'failed';attemptedAt:string;observedAt:string;evidenceRefs:readonly string[]}
export interface InterruptionRound {
  roundId:string;inputDigest:string;batchIds:readonly string[];scope:NotificationScope;channels:readonly NotificationChannel[];
  itemIds:readonly string[];scopeKeys:readonly string[];expiresAt:string;urgent:boolean;state:'reserved'|'suppressed'|'active';
  counted:boolean;reservedAt:string;decidedAt:string;reason:string;policyRevisionDigest:string;attempts:Partial<Record<NotificationChannel,NotificationDeliveryAttempt>>;
}
export interface NotificationInterruptionState {
  version:1;policies:Record<string,{scope:NotificationScope;revision:number;patch:InterruptionPolicyPatch}>;
  operations:Record<string,{inputDigest:string;result:unknown}>;rounds:Record<string,InterruptionRound>;
  feed:NotificationFeedEntry[];nextCursor:number;
  /** Imported existing connector settings, within this original atomic state. No inferred global budget. */
  legacyPolicies?:Record<string,{scope:NotificationScope;revision:number;policy:NotificationPolicy}>;
}
export interface ResolvedInterruptionPolicy {
  state:'configured'|'unconfigured';scope:NotificationScope;revision:number;local:InterruptionPolicyPatch|null;
  effective:InterruptionPolicy|null;
  /** Differing windows cannot be flattened. Every inherited cap is independently enforced. */
  constraints:readonly {key:string;revision:number;policy:InterruptionPolicy}[];observedAt:string;
}
export const notificationDigest=(value:unknown):string=>{
  const canonical=(item:unknown):string=>{
    if(item===null||typeof item!=='object') {
      if(item===undefined||typeof item==='function'||typeof item==='symbol'||typeof item==='bigint'
        ||typeof item==='number'&&!Number.isFinite(item))throw new ProtocolError('INVALID_ARGUMENT','Notification values must be finite JSON');
      return JSON.stringify(item);
    }
    if(Array.isArray(item))return '['+item.map(canonical).join(',')+']';
    const r=item as Record<string,unknown>;return '{'+Object.keys(r).sort().map(key=>JSON.stringify(key)+':'+canonical(r[key])).join(',')+'}';
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
};
const text=(v:unknown):v is string=>typeof v==='string'&&!!v.trim();
const fail=(message:string):never=>{throw new ProtocolError('INVALID_ARGUMENT',message);};
export const validUtc=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(v)&&Number.isFinite(Date.parse(v));
export function notificationScopeKey(scope:NotificationScope):string {
  if(!scope||typeof scope!=='object')return fail('Notification scope required');
  const keys=Object.keys(scope);
  if(scope.kind==='global'&&keys.length===1)return 'global';
  if(scope.kind==='connector'&&text(scope.connectorId)&&keys.every(k=>['kind','connectorId'].includes(k)))return 'connector:'+JSON.stringify(scope.connectorId);
  if(scope.kind==='responsibility'&&text(scope.responsibilityId)&&(scope.connectorId===undefined||text(scope.connectorId))
    &&keys.every(k=>['kind','connectorId','responsibilityId'].includes(k)))return 'responsibility:'+JSON.stringify([scope.connectorId??null,scope.responsibilityId]);
  return fail('Invalid notification scope');
}
export function notificationScopePath(scope:NotificationScope):string[] {
  const leaf=notificationScopeKey(scope);return [...new Set(['global',...('connectorId' in scope&&scope.connectorId?['connector:'+JSON.stringify(scope.connectorId)]:[]),leaf])];
}
export function assertInterruptionPatch(patch:InterruptionPolicyPatch,full=false):void {
  const fields=['mode','maxInterruptions','windowMinutes','silentUntilUtc','preferredChannel','allowUrgentBreakthrough','digestMode','quietHours'];
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length||Object.keys(patch).some(k=>!fields.includes(k))
    ||full&&fields.some(k=>!Object.hasOwn(patch,k)))fail('Explicit user interruption policy fields required');
  if(Object.hasOwn(patch,'mode')&&!['normal','silent'].includes(patch.mode!))fail('Invalid notification mode');
  if(Object.hasOwn(patch,'maxInterruptions')&&patch.maxInterruptions!==null
    &&(!Number.isSafeInteger(patch.maxInterruptions)||patch.maxInterruptions!<0))fail('maxInterruptions must be nonnegative or null');
  if(Object.hasOwn(patch,'windowMinutes')&&(!Number.isFinite(patch.windowMinutes)||patch.windowMinutes!<=0))fail('Explicit positive windowMinutes required');
  if(Object.hasOwn(patch,'silentUntilUtc')&&patch.silentUntilUtc!==null&&!validUtc(patch.silentUntilUtc))fail('silentUntilUtc must be UTC or null');
  if(Object.hasOwn(patch,'preferredChannel')&&!['banner','voice','auto'].includes(patch.preferredChannel!))fail('Invalid preferred notification channel');
  if(Object.hasOwn(patch,'allowUrgentBreakthrough')&&typeof patch.allowUrgentBreakthrough!=='boolean')fail('Urgent breakthrough must be explicit boolean');
  if(Object.hasOwn(patch,'digestMode')&&!['on_return','scheduled','on_demand'].includes(patch.digestMode!))fail('Invalid digest mode');
  if(Object.hasOwn(patch,'quietHours')&&patch.quietHours!==null)assertPolicyValid({quietHours:patch.quietHours!});
}
export const emptyInterruptionState=():NotificationInterruptionState=>({version:1,policies:{},operations:{},rounds:{},feed:[],nextCursor:1});
export function assertInterruptionState(s:NotificationInterruptionState):void {
  if(!s||s.version!==1||!s.policies||typeof s.policies!=='object'||!s.operations||typeof s.operations!=='object'
    ||!s.rounds||typeof s.rounds!=='object'||!Array.isArray(s.feed)||!Number.isSafeInteger(s.nextCursor)||s.nextCursor<1)
    throw new ProtocolError('PROTOCOL_MISMATCH','Notification interruption state cannot be silently reset');
  const ids=new Set<string>(),cursors=new Set<number>();
  for(const entry of s.feed) {
    if(!entry||!text(entry.id)||!Number.isSafeInteger(entry.cursor)||entry.cursor<1||entry.cursor>=s.nextCursor
      ||ids.has(entry.id)||cursors.has(entry.cursor)||!validUtc(entry.receivedAt)||entry.validUntilUtc!==null&&!validUtc(entry.validUntilUtc))
      throw new ProtocolError('PROTOCOL_MISMATCH','Notification feed history is invalid');
    notificationScopeKey(entry.scope);ids.add(entry.id);cursors.add(entry.cursor);
  }
  for(const [key,record] of Object.entries(s.policies)) {
    if(!record||notificationScopeKey(record.scope)!==key||!Number.isSafeInteger(record.revision)||record.revision<1)
      throw new ProtocolError('PROTOCOL_MISMATCH','Notification policy revision is invalid');
    if(key==='global'||Object.keys(record.patch).length)assertInterruptionPatch(record.patch,key==='global');
  }
  for(const [key,record] of Object.entries(s.legacyPolicies??{})) {
    if(!record||key==='global'||notificationScopeKey(record.scope)!==key||!Number.isSafeInteger(record.revision)||record.revision<1)
      throw new ProtocolError('PROTOCOL_MISMATCH','Legacy notification scope/revision is invalid');
    assertLegacyNotificationPolicy(record.policy);
  }
}
export function assertLegacyNotificationPolicy(policy:NotificationPolicy):void {
  if(!policy||typeof policy!=='object'||Array.isArray(policy)||Object.keys(policy).some(key=>!['quietHours','pauseUntilUtc','digest'].includes(key)))
    fail('Existing notification policy fields required');
  assertPolicyValid(policy);
}
export function scopedLegacyPolicies(state:NotificationInterruptionState,scope:NotificationScope):NotificationPolicy[] {
  return notificationScopePath(scope).flatMap(key=>state.legacyPolicies?.[key]?[state.legacyPolicies[key]!.policy]:[]);
}
export function resolveInterruptionPolicy(state:NotificationInterruptionState,scope:NotificationScope,now:number):ResolvedInterruptionPolicy {
  const key=notificationScopeKey(scope),root=state.policies.global,leaf=state.policies[key];
  const result:ResolvedInterruptionPolicy={state:'unconfigured',scope:structuredClone(scope),revision:leaf?.revision??0,
    local:leaf?structuredClone(leaf.patch):null,effective:null,constraints:[],observedAt:new Date(now).toISOString()};
  if(!root)return result;
  assertInterruptionPatch(root.patch,true);let effective=structuredClone(root.patch) as InterruptionPolicy;
  const constraints:{key:string;revision:number;policy:InterruptionPolicy}[]=[];
  for(const ancestor of notificationScopePath(scope)) {
    const record=state.policies[ancestor];if(!record)continue;
    effective={...effective,...structuredClone(record.patch)};
    constraints.push({key:ancestor,revision:record.revision,policy:structuredClone(effective)});
  }
  // These displayed fields expose parent restrictions; enforcement uses all constraints below.
  effective.mode=constraints.some(c=>c.policy.mode==='silent'&&(c.policy.silentUntilUtc===null||Date.parse(c.policy.silentUntilUtc)>now))?'silent':'normal';
  effective.allowUrgentBreakthrough=constraints.every(c=>c.policy.allowUrgentBreakthrough);
  const silence=constraints.map(c=>c.policy.silentUntilUtc).filter((v):v is string=>v!==null&&Date.parse(v)>now).sort();
  if(silence.length)effective.silentUntilUtc=silence[silence.length-1]!;
  return {...result,state:'configured',effective,constraints};
}
export const feedEntryActive=(entry:NotificationFeedEntry,now:number):boolean=>!entry.withdrawnAt
  &&(entry.validUntilUtc===null||Date.parse(entry.validUntilUtc)>now);
export function interruptionBlock(state:NotificationInterruptionState,scope:NotificationScope,now:number,urgent:boolean):string|undefined {
  const legacy=scopedLegacyPolicies(state,scope);
  if(legacy.some(policy=>policy.pauseUntilUtc!==undefined&&Date.parse(policy.pauseUntilUtc)>now
    ||policy.quietHours!==undefined&&quietHoursActive(policy.quietHours,now)))return 'legacy_pause_or_quiet';
  const resolved=resolveInterruptionPolicy(state,scope,now);if(!resolved.effective)return legacy.length?undefined:'interruption_policy_unconfigured';
  for(const {policy} of resolved.constraints) {
    const silent=policy.mode==='silent'&&policy.silentUntilUtc===null||policy.silentUntilUtc!==null&&Date.parse(policy.silentUntilUtc)>now
      ||policy.quietHours!==null&&quietHoursActive(policy.quietHours,now);
    if(silent&&!(urgent&&policy.allowUrgentBreakthrough))return 'silent_or_quiet_policy';
  }
  return undefined;
}
export function notificationOperation<T>(state:NotificationInterruptionState,operationId:string,input:unknown,run:()=>T):T {
  if(!text(operationId))fail('Stable notification operationId required');const digest=notificationDigest(input),saved=state.operations[operationId];
  if(saved){if(saved.inputDigest!==digest)throw new ProtocolError('REVISION_CONFLICT','Notification operation parameters changed');return structuredClone(saved.result) as T;}
  const result=run();state.operations[operationId]={inputDigest:digest,result:structuredClone(result)};return result;
}
export function updateNotificationPolicy(state:NotificationInterruptionState,input:InterruptionPolicyUpdate,now:number) {
  const scope=notificationScopeKey(input.scope);assertInterruptionPatch(input.patch);
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('Expected notification policy revision required');
  return notificationOperation(state,input.operationId,{kind:'update_policy',...input},()=>{
    const prior=state.policies[scope];if((prior?.revision??0)!==input.expectedRevision)throw new ProtocolError('REVISION_CONFLICT','Notification policy changed');
    if(scope!=='global'&&!state.policies.global)fail('Configure the full global user policy first');
    const patch={...prior?.patch,...structuredClone(input.patch)};assertInterruptionPatch(patch,scope==='global');
    state.policies[scope]={scope:structuredClone(input.scope),revision:input.expectedRevision+1,patch};
    const legacy=state.legacyPolicies?.[scope];
    if(legacy) {
      const before=notificationDigest(legacy.policy);
      if(Object.hasOwn(input.patch,'mode')||Object.hasOwn(input.patch,'silentUntilUtc'))delete legacy.policy.pauseUntilUtc;
      if(Object.hasOwn(input.patch,'quietHours'))delete legacy.policy.quietHours;
      if(Object.hasOwn(input.patch,'digestMode'))delete legacy.policy.digest;
      if(before!==notificationDigest(legacy.policy))legacy.revision++;
    }
    return {operationId:input.operationId,...resolveInterruptionPolicy(state,input.scope,now),decidedAt:new Date(now).toISOString()};
  });
}
export function updateLegacyNotificationPolicy(state:NotificationInterruptionState,input:LegacyNotificationPolicyUpdate,now:number) {
  const key=notificationScopeKey(input.scope);assertLegacyNotificationPolicy(input.legacyPolicy);
  if(key==='global'||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('Existing connector scope and revision required');
  return notificationOperation(state,input.operationId,{kind:'update_legacy_policy',...input},()=>{
    const prior=state.legacyPolicies?.[key];
    if((prior?.revision??0)!==input.expectedRevision)throw new ProtocolError('REVISION_CONFLICT','Existing notification policy changed');
    state.legacyPolicies??={};state.legacyPolicies[key]={scope:structuredClone(input.scope),revision:input.expectedRevision+1,policy:structuredClone(input.legacyPolicy)};
    const modern=state.policies[key];
    if(modern) {
      const patch={...modern.patch};for(const field of ['mode','silentUntilUtc','quietHours','digestMode'] as const)delete patch[field];
      if(notificationDigest(patch)!==notificationDigest(modern.patch)){modern.patch=patch;modern.revision++;}
    }
    return {operationId:input.operationId,scope:structuredClone(input.scope),revision:input.expectedRevision+1,
      state:'configured' as const,legacyPolicy:structuredClone(input.legacyPolicy),decidedAt:new Date(now).toISOString()};
  });
}
export function queryNotificationFeed(state:NotificationInterruptionState,input:NotificationFeedQuery,now:number) {
  const after=input.afterCursor??0;
  if(!Number.isSafeInteger(after)||after<0||input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1)
    ||input.unreadOnly!==undefined&&typeof input.unreadOnly!=='boolean')fail('Invalid notification feed cursor/query');
  const scope=input.scope?notificationScopeKey(input.scope):undefined;
  const all=state.feed.filter(e=>e.cursor>after&&(!input.unreadOnly||!e.readAt)&&(!scope||notificationScopePath(e.scope).includes(scope)));
  const entries=all.slice(0,input.limit??all.length).map(e=>({...structuredClone(e),unread:!e.readAt,
    validity:feedEntryActive(e,now)?'active' as const:e.withdrawnAt?'withdrawn' as const:'expired' as const}));
  return {items:entries,cursor:entries[entries.length-1]?.cursor??after,hasMore:entries.length<all.length,observedAt:new Date(now).toISOString()};
}
export function markNotificationFeed(state:NotificationInterruptionState,input:{operationId:string;itemIds:readonly string[]},now:number,kind:'read'|'withdraw') {
  if(!Array.isArray(input.itemIds)||!input.itemIds.length||input.itemIds.some(id=>!text(id))||new Set(input.itemIds).size!==input.itemIds.length)fail('Unique notification item IDs required');
  return notificationOperation(state,input.operationId,{kind,...input},()=>{
    const entries=input.itemIds.map(id=>{const entry=state.feed.find(e=>e.id===id);if(!entry)throw new ProtocolError('NOT_FOUND','Notification feed item not found');return entry;});
    const at=new Date(now).toISOString();for(const entry of entries){if(kind==='read')entry.readAt??=at;else entry.withdrawnAt??=at;}
    return {operationId:input.operationId,itemIds:[...input.itemIds],state:kind==='read'?'read' as const:'withdrawn' as const,observedAt:at};
  });
}
export function reserveNotificationRound(state:NotificationInterruptionState,input:InterruptionReservation,itemIds:readonly string[],now:number) {
  notificationScopeKey(input.scope);
  if(!text(input.roundId)||!Array.isArray(input.batchIds)||!input.batchIds.length||input.batchIds.some(id=>!text(id))
    ||new Set(input.batchIds).size!==input.batchIds.length||!Array.isArray(input.channels)||!input.channels.length
    ||input.channels.some(channel=>!['banner','voice'].includes(channel))||new Set(input.channels).size!==input.channels.length
    ||!validUtc(input.expiresAt)||input.urgent!==undefined&&typeof input.urgent!=='boolean')fail('Explicit bound notification round/channels/deadline required');
  const inputDigest=notificationDigest(input),prior=state.rounds[input.roundId];
  if(prior){if(prior.inputDigest!==inputDigest)throw new ProtocolError('REVISION_CONFLICT','Notification round parameters changed');return structuredClone(prior);}
  if(Date.parse(input.expiresAt)<=now)fail('New notification round deadline expired');
  const entries=itemIds.map(id=>state.feed.find(e=>e.id===id));
  if(!entries.length||entries.some(e=>!e||notificationScopeKey(e.scope)!==notificationScopeKey(input.scope)))fail('Notification round scope does not match original feed items');
  const resolved=resolveInterruptionPolicy(state,input.scope,now),scopeKeys=notificationScopePath(input.scope);
  let reason=interruptionBlock(state,input.scope,now,input.urgent===true);
  const preferred=resolved.effective?.preferredChannel;
  if(preferred&&preferred!=='auto'&&input.channels.some(channel=>channel!==preferred))reason='preferred_channel_not_selected';
  if(Object.values(state.rounds).some(round=>round.itemIds.some(id=>itemIds.includes(id))
    &&(round.state==='reserved'||Object.keys(round.attempts).length>0)))reason='original_round_requires_readback_or_is_terminal';
  if(entries.some(e=>!e||!feedEntryActive(e,now)||!!e.readAt))reason='no_longer_valid_unread_changes';
  if(!reason)reason=quotaBlock(state,input.scope,now);
  const at=new Date(now).toISOString();
  const round:InterruptionRound={...structuredClone(input),batchIds:[...input.batchIds],channels:[...input.channels],urgent:input.urgent===true,
    inputDigest,itemIds:[...itemIds],scopeKeys,state:reason?'suppressed':'reserved',counted:!reason,reservedAt:at,decidedAt:at,
    reason:reason??'quota_reserved',policyRevisionDigest:notificationDigest(resolved.constraints),attempts:{}};
  state.rounds[input.roundId]=round;return structuredClone(round);
}
function quotaBlock(state:NotificationInterruptionState,scope:NotificationScope,now:number,excludeRound?:string):string|undefined {
  for(const {key,policy} of resolveInterruptionPolicy(state,scope,now).constraints) {
    if(policy.maxInterruptions===null)continue;
    const count=Object.values(state.rounds).filter(r=>r.counted&&r.roundId!==excludeRound&&r.scopeKeys.includes(key)
      &&Date.parse(r.reservedAt)>now-policy.windowMinutes*60000).length;
    if(count>=policy.maxInterruptions)return 'interruption_limit_reached';
  }
  return undefined;
}
export function beginNotificationDelivery(state:NotificationInterruptionState,input:{roundId:string;channel:NotificationChannel},now:number,legacyBlocked=false) {
  const round=state.rounds[input.roundId];if(!round)throw new ProtocolError('NOT_FOUND','Notification round not found');
  if(!round.channels.includes(input.channel))fail('Notification channel is outside original round');
  const at=new Date(now).toISOString();const existing=round.attempts[input.channel];
  if(existing||Object.values(round.attempts).some(a=>a?.state==='sending'||a?.state==='unknown'))
    return {maySend:false,reason:'original_attempt_requires_readback_or_is_terminal',round:structuredClone(round),observedAt:at};
  if(round.state==='suppressed')return {maySend:false,reason:round.reason,round:structuredClone(round),observedAt:at};
  const attempted=Object.keys(round.attempts).length>0;
  let blocked=legacyBlocked?'legacy_pause_or_quiet':Date.parse(round.expiresAt)<=now?'round_expired':interruptionBlock(state,round.scope,now,round.urgent);
  const preferred=resolveInterruptionPolicy(state,round.scope,now).effective?.preferredChannel;
  if(!blocked&&preferred&&preferred!=='auto'&&input.channel!==preferred)blocked='preferred_channel_not_selected';
  if(round.itemIds.some(id=>{const e=state.feed.find(item=>item.id===id);return !e||!feedEntryActive(e,now)||!!e.readAt;}))blocked='no_longer_valid_unread_changes';
  if(!blocked)blocked=quotaBlock(state,round.scope,now,round.roundId);
  if(blocked) {
    // A reservation never attempted may be released. Sending/unknown/failed outcomes never refund.
    if(!attempted){round.counted=false;round.state='suppressed';round.reason=blocked;round.decidedAt=at;}
    return {maySend:false,reason:blocked,round:structuredClone(round),observedAt:at};
  }
  if(!attempted)round.reservedAt=at;
  round.state='active';round.policyRevisionDigest=notificationDigest(resolveInterruptionPolicy(state,round.scope,now).constraints);
  round.attempts[input.channel]={state:'sending',attemptedAt:at,observedAt:at,evidenceRefs:[]};
  return {maySend:true,reason:'latest_policy_checked_and_attempt_persisted',round:structuredClone(round),observedAt:at};
}
export function completeNotificationDelivery(state:NotificationInterruptionState,input:{roundId:string;channel:NotificationChannel;
  state:'delivered'|'unknown'|'failed';evidenceRefs:readonly string[]},now:number) {
  const round=state.rounds[input.roundId],attempt=round?.attempts[input.channel];
  if(!round||!attempt)throw new ProtocolError('NOT_FOUND','Original notification attempt not found');
  if(!['delivered','unknown','failed'].includes(input.state)||!Array.isArray(input.evidenceRefs)||input.evidenceRefs.some(ref=>!text(ref))
    ||input.state==='delivered'&&!input.evidenceRefs.length)fail('Delivery success requires trusted channel Evidence');
  if(attempt.state!=='sending'&&attempt.state!=='unknown') {
    if(attempt.state!==input.state||notificationDigest(attempt.evidenceRefs)!==notificationDigest(input.evidenceRefs))throw new ProtocolError('REVISION_CONFLICT','Notification terminal delivery receipt changed');
    return structuredClone(round);
  }
  if(attempt.state===input.state&&notificationDigest(attempt.evidenceRefs)===notificationDigest(input.evidenceRefs))return structuredClone(round);
  const at=new Date(now).toISOString();round.attempts[input.channel]={...attempt,state:input.state,evidenceRefs:[...input.evidenceRefs],observedAt:at};
  if(input.state==='delivered')for(const id of round.itemIds){const entry=state.feed.find(e=>e.id===id);if(entry)entry.deliveredAt??=at;}
  return structuredClone(round);
}
