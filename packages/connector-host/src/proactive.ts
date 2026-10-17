import {createHash} from 'node:crypto';
import {ProtocolError,validateContract} from '@personal-agent/contracts';
import type {ConnectorPort,ProtocolContracts} from '@personal-agent/contracts';
import type {ConnectorHost} from './index.js';

export type ProactiveSourceMode='push'|'watch'|'poll-only'|'manual-only'|'unavailable';
export type ProactiveSourceKind='mail'|'calendar'|'todo'|'feeds'|'research'|'weather'|'file'|'wiki'|'git'|'ci'|'model_progress'|'other';
export interface ProactiveContext {signal:AbortSignal;deadline:string}
export interface ProactivePage {items:ProtocolContracts['connectorItem'][];nextCursor:string;hasMore:boolean;
  /** Optional native revisions supplied by the actual public adapter, keyed by ConnectorItem.dedupeKey. */
  revisions?:Readonly<Record<string,string>>}
export interface ProactiveReconciliation {state:'verified'|'unknown';evidenceRefs:readonly string[];cursor?:string;resetCursor?:true}
export interface ProactiveSourceDefinition {
  sourceId:string;accountRef:string;kind:ProactiveSourceKind;mode:ProactiveSourceMode;configurationRevision:string;
  read?:(connector:ConnectorPort,input:{cursor?:string;limit:number},context:ProactiveContext)=>Promise<ProactivePage>;
  /** Adapter must resume from input.cursor and await accept's durable acknowledgement, or disclose a gap. */
  watch?:(connector:ConnectorPort,input:{cursor?:string},accept:(page:ProactivePage)=>Promise<void>,context:ProactiveContext)=>Promise<()=>void|Promise<void>>;
  reconcile?:(connector:ConnectorPort,reason:string,context:ProactiveContext)=>Promise<ProactiveReconciliation>;
}
export interface ProactiveSourceBinding {
  descriptor:{sourceId:string;connectorId:string;connectorVersion:string;accountRef:string;sourceKind:ProactiveSourceKind;
    configurationRevision:string;declaredMode:ProactiveSourceMode;mode:ProactiveSourceMode;reason?:string;verification:'mock'|'conditional'|'verified'};
  read(input:{cursor?:string;limit:number},context:ProactiveContext):Promise<ProactivePage>;
  watch?:(input:{cursor?:string},accept:(page:ProactivePage)=>Promise<void>,context:ProactiveContext)=>Promise<()=>void|Promise<void>>;
  reconcile?:(reason:string,context:ProactiveContext)=>Promise<ProactiveReconciliation>;
}
export interface ProactiveEvent {
  eventId:string;kind:'source.changed';sourceId:string;connectorId:string;accountRef:string;sourceKind:ProactiveSourceKind;
  sourceRevision:string;sourceRevisionKind:'provider_revision'|'item_projection_digest';item:ProtocolContracts['connectorItem'];cursor:string;observedAt:string;
}
export interface ProactiveBatch {batchId:string;sourceId:string;cursor:string;hasMore:boolean;events:readonly ProactiveEvent[];observedAt:string}
export type ProactiveState='registered'|'active'|'changed'|'no_changes'|'offline'|'authorization_expired'|'cursor_expired'|'reconciliation_required'|'unavailable'|'stopped'|'cancelled';
export interface ProactiveCheckpoint {
  version:1;sourceId:string;bindingDigest:string;revision:number;cursor?:string|undefined;seen:Record<string,true>;
  pending?:ProactiveBatch|undefined;state:ProactiveState;updatedAt:string;errorCode?:string|undefined;
}
export interface ProactiveCheckpointPort {
  read(sourceId:string):ProactiveCheckpoint|undefined|Promise<ProactiveCheckpoint|undefined>;
  /** Existing transactional checkpoint adapter. Expected revision undefined means never written. */
  compareAndSet(sourceId:string,expectedRevision:number|undefined,next:ProactiveCheckpoint):boolean|Promise<boolean>;
}
export interface ProactiveEventSink {
  /** Must durably persist the original batch idempotently before returning, including previously accepted batch IDs. */
  persist(batch:ProactiveBatch,context:ProactiveContext):Promise<{batchId:string;durable:true}>;
}
export interface ProactiveStage {
  sourceId:string;stage:'connect'|'read'|'pending_persist'|'event_sink'|'cursor_commit'|'recover'|'next_wake';
  startedAt:string;endedAt:string;durationMs:number;outcome:'completed'|'failed';
}
const canonical=(value:unknown):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)
  ?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
const hash=(value:unknown):string=>createHash('sha256').update(canonical(value)).digest('hex');
const valid=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const error=(code:string,message:string):never=>{throw new ProtocolError(code,message);};
function check(context:ProactiveContext,now:()=>number) {
  if(!(context.signal instanceof AbortSignal))error('INVALID_ARGUMENT','Proactive source cancellation signal required');
  if(context.signal.aborted)error('CANCELLED','Proactive source request cancelled');
  if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=now())error('TIMEOUT','Proactive source deadline expired');
}
const sourceRevision=(item:ProtocolContracts['connectorItem'])=>{
  const {fetchedAt:_,...original}=item;return hash(original);
};

/** Host-only adapter over the original ConnectorHost registry and existing durable ports. No timer or model calls. */
export function createProactiveConnectorHost(options:{host:ConnectorHost;checkpoints:ProactiveCheckpointPort;events:ProactiveEventSink;
  authorize:(source:ProactiveSourceBinding['descriptor'],context:ProactiveContext)=>boolean|Promise<boolean>;
  now?:()=>number;onStage?:(stage:ProactiveStage)=>void}) {
  const {host,checkpoints,events}=options,now=options.now??Date.now;
  if(!host?.listProactiveSources||!checkpoints?.read||!checkpoints.compareAndSet||!events?.persist||typeof options.authorize!=='function')
    error('INVALID_ARGUMENT','Existing connector/checkpoint/event sink/authorization ports required');
  // Lifecycle/in-flight locks only. Source declarations remain exclusively in ConnectorHost.registrations.
  const sessions=new Map<string,{controller:AbortController;dispose?:()=>void|Promise<void>}>(),busy=new Set<string>(),lifetime=new AbortController();let disposed=false;
  const stamp=()=>new Date(now()).toISOString();
  async function stage<T>(sourceId:string,name:ProactiveStage['stage'],fn:()=>T|Promise<T>):Promise<T> {
    const startedAt=stamp(),start=performance.now();let outcome:ProactiveStage['outcome']='failed';
    try{const result=await fn();outcome='completed';return result;}finally{
      try{options.onStage?.({sourceId,stage:name,startedAt,endedAt:stamp(),durationMs:performance.now()-start,outcome});}catch{/* diagnostics never alter a committed ingestion */}
    }
  }
  const source=(sourceId:string)=>{if(disposed)error('CANCELLED','Proactive host disposed');return host.proactiveSource(sourceId);};
  async function allowed(binding:ProactiveSourceBinding,context:ProactiveContext) {
    check(context,now);if(await options.authorize(binding.descriptor,context)!==true)error('UNAUTHORIZED','Source read/watch lease is not active');check(context,now);
  }
  async function load(binding:ProactiveSourceBinding):Promise<ProactiveCheckpoint|undefined> {
    const state=await checkpoints.read(binding.descriptor.sourceId);
    if(state&&(state.version!==1||state.sourceId!==binding.descriptor.sourceId||!Number.isSafeInteger(state.revision)||state.revision<1
      ||state.bindingDigest!==hash(binding.descriptor)||!valid(state.seen)))error('REVISION_CONFLICT','Original source/account/configuration checkpoint requires reconciliation');
    return state?structuredClone(state):undefined;
  }
  async function save(binding:ProactiveSourceBinding,prior:ProactiveCheckpoint|undefined,fields:Partial<ProactiveCheckpoint>) {
    const next:ProactiveCheckpoint={version:1,sourceId:binding.descriptor.sourceId,bindingDigest:hash(binding.descriptor),
      seen:{},state:'registered',...prior,...fields,revision:(prior?.revision??0)+1,updatedAt:stamp()};
    if(next.pending===undefined)delete next.pending;if(next.cursor===undefined)delete next.cursor;if(next.errorCode===undefined)delete next.errorCode;
    if(!await checkpoints.compareAndSet(next.sourceId,prior?.revision,next))error('REVISION_CONFLICT','Proactive checkpoint changed; original cursor retained');
    return next;
  }
  async function drain(binding:ProactiveSourceBinding,state:ProactiveCheckpoint,context:ProactiveContext) {
    const batch=state.pending!;
    await allowed(binding,context);
    const acknowledgement=await stage(batch.sourceId,'event_sink',()=>events.persist(structuredClone(batch),context));
    if(acknowledgement?.batchId!==batch.batchId||acknowledgement.durable!==true)error('RESULT_UNKNOWN','Event batch has no durable acknowledgement; cursor retained');
    await allowed(binding,context);
    const seen={...state.seen};batch.events.forEach(event=>{seen[event.eventId]=true;});
    return stage(batch.sourceId,'cursor_commit',()=>save(binding,state,{cursor:batch.cursor,seen,pending:undefined,
      state:batch.events.length?'changed':'no_changes',errorCode:undefined}));
  }
  async function accept(binding:ProactiveSourceBinding,page:ProactivePage,context:ProactiveContext,state?:ProactiveCheckpoint) {
    await allowed(binding,context);state=state??await load(binding);
    if(state?.pending)state=await drain(binding,state,context);
    if(!page||!Array.isArray(page.items)||typeof page.nextCursor!=='string'||typeof page.hasMore!=='boolean'
      ||page.hasMore&&(!page.nextCursor||page.nextCursor===state?.cursor))error('INVALID_ARGUMENT','Source page did not provide a valid advancing cursor');
    const unique=new Map<string,ProactiveEvent>(),observedAt=stamp();
    for(const original of page.items) {
      validateContract('connectorItem',original);
      if(original.accountRef!==binding.descriptor.accountRef)error('SCOPE_DENIED','Source page crossed its bound account');
      const item=structuredClone(original),native=page.revisions?.[item.dedupeKey];
      if(native!==undefined&&(typeof native!=='string'||!native.trim()))error('INVALID_ARGUMENT','Native source revision must be explicit and nonempty');
      const projection=sourceRevision(item),revision=native??projection,eventId='source-event-'+hash([binding.descriptor.sourceId,item.dedupeKey,revision,projection]);
      if(!state?.seen[eventId])unique.set(eventId,{eventId,kind:'source.changed',sourceId:binding.descriptor.sourceId,
        connectorId:binding.descriptor.connectorId,accountRef:binding.descriptor.accountRef,sourceKind:binding.descriptor.sourceKind,
        sourceRevision:revision,sourceRevisionKind:native===undefined?'item_projection_digest':'provider_revision',item,cursor:page.nextCursor,observedAt});
    }
    const batch:ProactiveBatch={batchId:'source-batch-'+hash([binding.descriptor.sourceId,state?.revision??0,page.nextCursor,[...unique.keys()]]),
      sourceId:binding.descriptor.sourceId,cursor:page.nextCursor,hasMore:page.hasMore,events:[...unique.values()],observedAt};
    const pending=await stage(batch.sourceId,'pending_persist',()=>save(binding,state,{pending:batch,state:'active',errorCode:undefined}));
    return drain(binding,pending,context);
  }
  async function recordFailure(binding:ProactiveSourceBinding,cause:unknown) {
    const code=cause instanceof ProtocolError?cause.code:'EXTERNAL_FAILURE';
    if(code==='UNAUTHORIZED'||code==='SCOPE_DENIED')sessions.get(binding.descriptor.sourceId)?.controller.abort();
    const state:ProactiveState=code==='UNAUTHORIZED'||code==='SCOPE_DENIED'?'authorization_expired':code==='CURSOR_EXPIRED'?'cursor_expired'
      :code==='UNSUPPORTED_CAPABILITY'?'unavailable':code==='CANCELLED'?'cancelled':code==='RESULT_UNKNOWN'||code==='REVISION_CONFLICT'?'reconciliation_required':'offline';
    try{const previous=await load(binding);await save(binding,previous,{state,errorCode:code});}catch{/* preserve any original pending batch / concurrent checkpoint */}
    return {sourceId:binding.descriptor.sourceId,state,errorCode:code};
  }
  const combined=(sourceId:string,context:ProactiveContext):ProactiveContext=>({...context,
    signal:AbortSignal.any([context.signal,lifetime.signal,...(sessions.has(sourceId)?[sessions.get(sourceId)!.controller.signal]:[])])});
  async function tick(sourceId:string,input:ProactiveContext&{limit:number}) {
    const binding=source(sourceId);
    if(busy.has(sourceId))error('REVISION_CONFLICT','Source read is already in flight');
    busy.add(sourceId);const context=combined(sourceId,input);
    try {
      await allowed(binding,context);
      if(!Number.isSafeInteger(input.limit)||input.limit<1)error('INVALID_ARGUMENT','Explicit source page limit required');
      if(binding.descriptor.mode==='unavailable')error('UNSUPPORTED_CAPABILITY','Source has no public active adapter');
      const state=await load(binding);
      if(state?.pending){const committed=await drain(binding,state,context);return {sourceId,state:committed.state,cursor:committed.cursor,recoveredPending:true};}
      if(state?.state==='cursor_expired'||state?.state==='reconciliation_required')return {sourceId,state:state.state,errorCode:state.errorCode,reason:'Original source cursor needs explicit reconciliation'};
      const page=await stage(sourceId,'read',()=>binding.read({...(state?.cursor===undefined?{}:{cursor:state.cursor}),limit:input.limit},context));
      check(context,now);const committed=await accept(binding,page,context,state);
      return {sourceId,state:committed.state,cursor:committed.cursor,hasMore:page.hasMore};
    }catch(cause){return recordFailure(binding,cause);}finally{busy.delete(sourceId);}
  }
  async function start(sourceId:string,context:ProactiveContext) {
    const binding=source(sourceId);await allowed(binding,context);
    if(busy.has(sourceId))error('REVISION_CONFLICT','Source lifecycle/read is already in flight');
    if(sessions.has(sourceId))error('REVISION_CONFLICT','Source monitoring is already active');
    if(binding.descriptor.mode==='unavailable'||binding.descriptor.mode==='manual-only')error('UNSUPPORTED_CAPABILITY','Source cannot begin automatic monitoring');
    const session={controller:new AbortController()} as {controller:AbortController;dispose?:()=>void|Promise<void>};sessions.set(sourceId,session);
    busy.add(sourceId);let initialLock=true;
    const bounded=combined(sourceId,context);
    try {
      const connection=await stage(sourceId,'connect',()=>host.connect(binding.descriptor.connectorId,bounded.signal));
      await allowed(binding,bounded);
      if(connection.interactionRequired)error('UNAUTHORIZED','Source connection needs user interaction');
      let previous=await load(binding);
      if(previous?.pending)previous=await drain(binding,previous,bounded);
      if(previous?.state==='cursor_expired'||previous?.state==='reconciliation_required')error('RESULT_UNKNOWN','Original source needs explicit recovery before monitoring');
      previous=await load(binding);await save(binding,previous,{state:'active',errorCode:undefined});
      busy.delete(sourceId);initialLock=false;
      if(binding.watch&&(binding.descriptor.mode==='watch'||binding.descriptor.mode==='push')) {
        session.dispose=await binding.watch({...(previous?.cursor===undefined?{}:{cursor:previous.cursor})},async page=>{
          if(busy.has(sourceId))error('REVISION_CONFLICT','Watch source callback must await original batch acknowledgement');
          busy.add(sourceId);try{await accept(binding,page,bounded);}catch(cause){await recordFailure(binding,cause);throw cause;}finally{busy.delete(sourceId);}
        },bounded);
      }
      return {sourceId,state:'active' as const,mode:binding.descriptor.mode};
    }catch(cause){sessions.delete(sourceId);session.controller.abort();return recordFailure(binding,cause);}finally{if(initialLock)busy.delete(sourceId);}
  }
  async function stop(sourceId:string) {
    const session=sessions.get(sourceId);session?.controller.abort();await session?.dispose?.();sessions.delete(sourceId);
    const binding=host.proactiveSource(sourceId),state=await load(binding);await save(binding,state,{state:'stopped'});
  }
  async function recover(sourceId:string,reason:'reconnect'|'authorization_restored'|'cursor_expired'|'device_resume',context:ProactiveContext) {
    const binding=source(sourceId);
    if(busy.has(sourceId))error('REVISION_CONFLICT','Source lifecycle/read is already in flight');
    // Recovery is a fresh explicit host request; an expired watch lease must not poison its new signal.
    busy.add(sourceId);context={...context,signal:AbortSignal.any([context.signal,lifetime.signal])};
    try{return await stage(sourceId,'recover',async()=>{
      await allowed(binding,context);let original=await load(binding);
      if(original?.pending)original=await drain(binding,original,context);
      if(!binding.reconcile){await save(binding,original,{state:'reconciliation_required'});return {sourceId,state:'reconciliation_required' as const,reason:'Public source reconciliation adapter unavailable; original cursor retained'};}
      const connection=await stage(sourceId,'connect',()=>host.connect(binding.descriptor.connectorId,context.signal));
      await allowed(binding,context);
      if(connection.interactionRequired)error('UNAUTHORIZED','Source recovery needs user interaction');
      const verified=await binding.reconcile(reason,context);await allowed(binding,context);
      if(verified.state!=='verified'||!verified.evidenceRefs.length){await save(binding,original,{state:'reconciliation_required'});return {sourceId,state:'reconciliation_required' as const,reason:'Source recovery has no verified readback'};}
      if(verified.cursor!==undefined&&verified.resetCursor)error('INVALID_ARGUMENT','Recovery cannot both replace and reset its original cursor');
      if((original?.state==='cursor_expired'||original?.errorCode==='CURSOR_EXPIRED')&&verified.cursor===undefined&&!verified.resetCursor)
        return {sourceId,state:'reconciliation_required' as const,reason:'Expired cursor requires explicit source reset/replacement readback'};
      return save(binding,original,{state:'active',errorCode:undefined,
        ...(verified.resetCursor?{cursor:undefined}:verified.cursor===undefined?{}:{cursor:verified.cursor})});
    });}finally{busy.delete(sourceId);}
  }
  return {sources:()=>host.listProactiveSources(),status:async(sourceId:string)=>({descriptor:source(sourceId).descriptor,checkpoint:await load(source(sourceId)),monitoring:sessions.has(sourceId)&&!sessions.get(sourceId)!.controller.signal.aborted,inFlight:busy.has(sourceId)}),
    start,tick,tickMany:(requests:readonly {sourceId:string;limit:number}[],context:ProactiveContext)=>Promise.all(requests.map(input=>tick(input.sourceId,{...context,limit:input.limit}))),
    recover,wake:recover,
    planWake:async(sourceId:string,at:string)=>stage(sourceId,'next_wake',()=>{
      source(sourceId);if(!Number.isFinite(Date.parse(at)))error('INVALID_ARGUMENT','Explicit Scheduler wake time required');
      return {sourceId,dueAt:at,idempotencyKey:'proactive-wake-'+hash([sourceId,at]),missedRunPolicy:'run_once' as const,reason:'Host-requested read; register this suggestion in the existing Scheduler'};
    }),stop,dispose:async()=>{lifetime.abort();for(const sourceId of [...sessions.keys()])await stop(sourceId);disposed=true;}};
}
