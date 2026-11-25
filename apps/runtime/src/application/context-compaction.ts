import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {MAX_COORDINATION_INITIAL_QUERY_BYTES,ProtocolError} from '@personal-agent/contracts';
import {MAX_AGENTARTS_TRANSPORT_BYTES} from '@personal-agent/contracts/agentarts-transport';
import type {CoordinationGoalTokenBudget} from './context-binding.js';

export const CONTEXT_COMPACTION_CHECKPOINT = 'conversation-compaction:v1';
export const CONTEXT_COMPACTION_COMMAND = 'conversation-compaction-command:v1';
export const isContextCompactionCommand=(text:string):boolean=>/^(?:\/压缩|\/compact)$/iu.test(text.trim());

export interface CompactableContextMessage {
  readonly id:string;
  readonly role:'user'|'assistant';
  readonly content:string;
  readonly taskId?:string;
  readonly withheld?:boolean;
  readonly createdAt?:string;
  readonly taskState?:string;
  readonly answerWithheld?:true;
  /** Host-owned constraints and pending decisions are never model-summary material. */
  readonly preserveVerbatim?:true;
}
export interface ContextCompactionScope {
  readonly taskId:string;
  readonly conversationId:string;
  readonly cutoff:string;
  readonly deadline:string;
  readonly signal:AbortSignal;
}
/** Every limit is trusted composition; no model or conversation text chooses it. */
export interface ContextCompactionPolicy {
  readonly version:string;
  readonly triggerCharacters:number;
  readonly targetCharacters:number;
  readonly maxCharacters:number;
  readonly retainMessages:number;
  readonly retainTurns?:number;
  readonly maxSourceMessages:number;
  readonly segmentCharacters:number;
  readonly maxSummaryCharacters:number;
}
export interface ContextCompactionSnapshot {
  readonly configurationRef:string;
  readonly messages:readonly CompactableContextMessage[];
}
export interface ContextSummarySegment {
  readonly index:number;
  readonly rangeDigest:string;
  readonly messages:readonly CompactableContextMessage[];
}
export interface ContextSummaryRequest {
  readonly scope:ContextCompactionScope;
  readonly segment:ContextSummarySegment;
  /** Trusted whole-pass source identity. Segments never widen this authorization range. */
  readonly authorizationSource:{readonly configurationRef:string;readonly sourceDigest:string;readonly sourceCount:number;
    readonly tailDigest:string;readonly goalFrameDigest:string};
  readonly maxSummaryCharacters:number;
  /** Must run synchronously at the actual send, after credentials/egress awaits. */
  readonly assertBeforeSend:()=>void;
}
/** Optional host composition for the original Coordination caller. */
export interface RuntimeContextCompactionOptions {
  readonly policy:ContextCompactionPolicy;
  readonly modelConfigurationRef:string;
  readonly summarize:(request:ContextSummaryRequest)=>Promise<string>;
  readonly assertCurrent:(scope:ContextCompactionScope)=>void;
  /** Native subagent conversations use Runtime's own synchronous snapshot. */
  readonly readSnapshot?:(scope:ContextCompactionScope,maxMessages:number)=>readonly CompactableContextMessage[];
}
interface CompactionMeasurement {
  readonly characters:number;
  readonly queryBytes:number;
  readonly bodyBytes:number;
  readonly tokens:{state:'unmeasured'}|{state:'measured';tokenizerRef:string;inputTokens:number;
    contextTokens:number;reservedOutputTokens:number};
}
export interface ContextCompactionReceipt {
  /** Includes verbatim originals removed from summary input; older receipts summarized the entire prefix. */
  readonly prefixCount?:number;
  readonly version:1;
  readonly taskId:string;
  readonly conversationId:string;
  readonly cutoff:string;
  readonly deadline:string;
  readonly configurationRef:string;
  readonly modelConfigurationRef:string;
  readonly policy:ContextCompactionPolicy;
  readonly goalFrameDigest:string;
  readonly sourceDigest:string;
  readonly sourceCount:number;
  readonly sourceTasks:readonly {identityDigest:string;messagesDigest:string}[];
  readonly tailDigest:string;
  readonly segments:readonly {index:number;rangeDigest:string;firstIdentityDigest:string;
    lastIdentityDigest:string;sourceCharacters:number;summaryDigest:string;summaryCharacters:number}[];
  readonly summaryDigest:string;
  readonly budget:{before:CompactionMeasurement;after:CompactionMeasurement};
}
export interface ContextCompactionOptions {
  /** Explicit user command, never inferred from historical or model text. */
  readonly force?:boolean;
  /** Process-local projection, revalidated against original history on every use. */
  readonly previous?:ContextCompactionCache;
  /** Original history owner resolved by trusted Runtime delegation, not the renderer. */
  readonly cacheConversationId?:string;
  readonly remember?:(cache:ContextCompactionCache)=>void;
  readonly scope:ContextCompactionScope;
  readonly policy:ContextCompactionPolicy;
  readonly modelConfigurationRef:string;
  readonly goalTokenBudget?:CoordinationGoalTokenBudget;
  /** Synchronous original-source read, including current withholding/deletion filters. */
  readonly readSnapshot:()=>ContextCompactionSnapshot;
  /** Compiles the original goal/prepared goal around data; must not mutate a request. */
  readonly compile:(messages:readonly CompactableContextMessage[])=>string;
  readonly summarize:(request:ContextSummaryRequest)=>Promise<string>;
  readonly assertCurrent:()=>void;
  /** Metadata only. The summary and source bodies are never checkpointed here. */
  readonly saveCheckpoint:(receipt:ContextCompactionReceipt)=>void;
  readonly loadCheckpoint?:()=>unknown;
  readonly now?:()=>number;
}
export interface ContextCompactionCache {
  readonly binding:string;
  readonly prefixDigest:string;
  readonly prefixCount:number;
  readonly summaries:readonly string[];
  readonly segments:ContextCompactionReceipt['segments'];
  readonly sourceRanges?:readonly {sourceStart:number;sourceEnd:number}[];
}
export type ContextCompactionResult =
  | {state:'unchanged';messages:readonly CompactableContextMessage[]}
  | {state:'compacted';messages:readonly CompactableContextMessage[];receipt:ContextCompactionReceipt;
      /** Reused by the final transport guard, including after credential awaits. */
      assertCurrent:()=>void};

const hash=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict=():never=>{throw new ProtocolError('REVISION_CONFLICT','Original conversation compaction source or configuration changed');};
const validText=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const identity=(message:CompactableContextMessage)=>hash([message.id,message.taskId??null]);
/** Conservative retention: keep the whole original message, including qualifiers and punctuation. */
export function mustPreserveContextMessage(message:CompactableContextMessage):boolean {
  return message.preserveVerbatim===true||message.answerWithheld===true
    ||Boolean(message.taskState&&!['succeeded','failed','cancelled'].includes(message.taskState))
    ||/不|勿|禁止|不得|不能|别|未|否定|如果|若|只要|除非|条件|必须|仅|只在|之前|之后|直到|截至|截止|期限|到期|待决|待确认|等待|结果未知|回收站|\d{4}[-/]\d{1,2}|\d+(?:年|月|日|时|点|分钟|小时|天)|今天|明天|后天|星期|周[一二三四五六日天]|\b(?:no|not|never|cannot|can't|don't|won't|without|unless|until|before|after|deadline|expires?|only|must|if|pending|unknown)\b/iu.test(message.content);
}

/** Observes the original cancellation/deadline even if a supplied port is slow to settle. */
export async function awaitContextCompactionScope<T>(scope:ContextCompactionScope,work:()=>Promise<T>,now:()=>number=Date.now):Promise<T> {
  if(!Number.isFinite(Date.parse(scope.deadline)))throw new ProtocolError('INVALID_ARGUMENT','Invalid compaction deadline');
  if(scope.signal.aborted)throw new ProtocolError('CANCELLED','Conversation compaction cancelled');
  if(now()>=Date.parse(scope.deadline))throw new ProtocolError('TIMEOUT','Conversation compaction expired');
  let timer:ReturnType<typeof setTimeout>|undefined,abort=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{
    abort=()=>reject(new ProtocolError('CANCELLED','Conversation compaction cancelled'));
    const expire=()=>{
      const remaining=Date.parse(scope.deadline)-now();
      if(remaining<=0)reject(new ProtocolError('TIMEOUT','Conversation compaction expired'));
      else timer=setTimeout(expire,Math.min(remaining,2_147_483_647));
    };
    scope.signal.addEventListener('abort',abort,{once:true});
    if(scope.signal.aborted)abort();
    expire();
  });
  try{return await Promise.race([Promise.resolve().then(work),interrupted]);}
  finally{if(timer!==undefined)clearTimeout(timer);scope.signal.removeEventListener('abort',abort);}
}

function assertSynchronous(value:unknown):void {
  if(value!==undefined) {
    if(value&&typeof (value as Promise<unknown>).then==='function')void Promise.resolve(value).catch(()=>undefined);
    throw new ProtocolError('INVALID_ARGUMENT','Compaction guards and checkpoint commits must be synchronous');
  }
}
function validatePolicy(policy:ContextCompactionPolicy):void {
  if(!policy||!validText(policy.version)
    || !['triggerCharacters','targetCharacters','maxCharacters','maxSourceMessages','segmentCharacters','maxSummaryCharacters']
      .every(key=>Number.isSafeInteger(policy[key as keyof ContextCompactionPolicy])&&(policy[key as keyof ContextCompactionPolicy] as number)>0)
    ||!Number.isSafeInteger(policy.retainMessages)||policy.retainMessages<0
    ||policy.retainTurns!==undefined&&(!Number.isSafeInteger(policy.retainTurns)||policy.retainTurns<1||policy.retainTurns>=policy.maxSourceMessages)
    ||policy.retainMessages>=policy.maxSourceMessages||policy.targetCharacters>policy.maxCharacters
    ||policy.targetCharacters>policy.triggerCharacters||policy.triggerCharacters>policy.maxCharacters) {
    throw new ProtocolError('INVALID_ARGUMENT','Trusted conversation compaction policy is invalid');
  }
}
function snapshot(options:ContextCompactionOptions):ContextCompactionSnapshot {
  const value=options.readSnapshot();
  if(!value||!validText(value.configurationRef)||!Array.isArray(value.messages)
    ||value.messages.length>options.policy.maxSourceMessages)
    throw new ProtocolError('INVALID_ARGUMENT','Conversation compaction source exceeds its trusted range');
  const ids=new Set<string>();
  for(const message of value.messages) {
    if(!message||!validText(message.id)||ids.has(message.id)||!['user','assistant'].includes(message.role)
      ||typeof message.content!=='string'||message.withheld===true
      ||Object.keys(message).some(key=>!['id','role','content','taskId','withheld','createdAt','taskState','answerWithheld','preserveVerbatim'].includes(key))
      ||message.createdAt!==undefined&&(typeof message.createdAt!=='string'||!Number.isFinite(Date.parse(message.createdAt)))
      ||message.taskState!==undefined&&!['created','planning','running','waiting_approval','waiting_external',
        'waiting_reconciliation','verifying','cancelling','succeeded','failed','cancelled'].includes(message.taskState)
      ||message.answerWithheld!==undefined&&message.answerWithheld!==true
      ||message.preserveVerbatim!==undefined&&message.preserveVerbatim!==true
      ||(message.taskId!==undefined&&!validText(message.taskId)))
      throw new ProtocolError('UNAUTHORIZED','Compaction requires already eligible, distinct conversation messages');
    ids.add(message.id);
  }
  return structuredClone(value);
}
function measure(compiled:string,budget?:CoordinationGoalTokenBudget):CompactionMeasurement {
  if(typeof compiled!=='string')throw new ProtocolError('INVALID_ARGUMENT','Compaction compiler must return text');
  const query=JSON.stringify({goal:compiled,availableTools:[]});
  const queryBytes=Buffer.byteLength(query);
  const bodyBytes=Buffer.byteLength(JSON.stringify({query}));
  if(budget===undefined)return {characters:compiled.length,queryBytes,bodyBytes,tokens:{state:'unmeasured'}};
  if(!budget||!validText(budget.tokenizerRef)||!Number.isSafeInteger(budget.contextTokens)||budget.contextTokens<1
    ||!Number.isSafeInteger(budget.reservedOutputTokens)||budget.reservedOutputTokens<0
    ||budget.reservedOutputTokens>=budget.contextTokens||typeof budget.countTokens!=='function')
    throw new ProtocolError('INVALID_ARGUMENT','Trusted compaction token budget is invalid');
  let tokens:unknown;
  try{tokens=budget.countTokens(compiled);}catch{throw new ProtocolError('INVALID_ARGUMENT','Compaction token measurement failed');}
  if(tokens&&typeof (tokens as Promise<unknown>).then==='function')void Promise.resolve(tokens).catch(()=>undefined);
  if(!Number.isSafeInteger(tokens)||(tokens as number)<0)
    throw new ProtocolError('INVALID_ARGUMENT','Compaction token measurement must be synchronous');
  return {characters:compiled.length,queryBytes,bodyBytes,tokens:{state:'measured',tokenizerRef:budget.tokenizerRef,inputTokens:tokens as number,
    contextTokens:budget.contextTokens,reservedOutputTokens:budget.reservedOutputTokens}};
}
function fits(measurement:CompactionMeasurement,characters:number,fraction=1):boolean {
  return measurement.characters<=characters&&measurement.queryBytes<=MAX_COORDINATION_INITIAL_QUERY_BYTES*fraction
    &&measurement.bodyBytes<=MAX_AGENTARTS_TRANSPORT_BYTES*fraction
    &&(measurement.tokens.state==='unmeasured'
    ||measurement.tokens.inputTokens<=Math.floor((measurement.tokens.contextTokens-measurement.tokens.reservedOutputTokens)*fraction));
}
function exceededBudget(measurement:CompactionMeasurement,characters:number):string {
  if(measurement.characters>characters)return 'character limit';
  if(measurement.queryBytes>MAX_COORDINATION_INITIAL_QUERY_BYTES)return 'AgentArts UTF-8 query byte limit';
  if(measurement.bodyBytes>MAX_AGENTARTS_TRANSPORT_BYTES)return 'AgentArts UTF-8 JSON body byte limit';
  return 'model token limit including reserved output';
}
export function retainedContextBoundary(messages:readonly CompactableContextMessage[],policy:ContextCompactionPolicy):number {
  let boundary=Math.max(0,messages.length-policy.retainMessages);
  if(policy.retainTurns!==undefined){
    const turns=messages.flatMap((message,index)=>message.role==='user'?[index]:[]);
    const activeTurn=turns.at(-1);
    const active=activeTurn!==undefined&&messages.slice(activeTurn).some(message=>
      message.taskState&&!['succeeded','failed','cancelled'].includes(message.taskState));
    boundary=turns.at(-policy.retainTurns-(active?1:0))??0;
  }
  const tasks=new Set(messages.slice(boundary).map(message=>message.taskId).filter(Boolean));
  for(let i=boundary-1;i>=0;i--){
    const taskId=messages[i]!.taskId;
    if(taskId&&tasks.has(taskId)){
      for(const message of messages.slice(i,boundary))if(message.taskId)tasks.add(message.taskId);
      boundary=i;
    }
  }
  if(policy.retainTurns!==undefined)while(boundary>0&&messages[boundary]?.role!=='user')boundary--;
  return boundary;
}
function sourceTasks(messages:readonly CompactableContextMessage[]) {
  const groups=new Map<string,CompactableContextMessage[]>();
  for(const message of messages)if(message.taskId)groups.set(message.taskId,[...(groups.get(message.taskId)??[]),message]);
  return [...groups].map(([taskId,group])=>({identityDigest:hash(taskId),messagesDigest:hash(group)}));
}
/** Segments never split a message or infer a native tool pair from its prose. */
export function segmentConversationContext(messages:readonly CompactableContextMessage[],maxCharacters:number):ContextSummarySegment[] {
  if(!Number.isSafeInteger(maxCharacters)||maxCharacters<1)throw new ProtocolError('INVALID_ARGUMENT','Invalid compaction segment limit');
  const groups:CompactableContextMessage[][]=[];
  let group:CompactableContextMessage[]=[];
  for(const message of messages) {
    if(JSON.stringify([message]).length>maxCharacters)throw new ProtocolError('INVALID_ARGUMENT','One conversation message exceeds the compaction segment limit');
    if(group.length&&JSON.stringify([...group,message]).length>maxCharacters){groups.push(group);group=[];}
    group.push(structuredClone(message));
  }
  if(group.length)groups.push(group);
  return groups.map((messages,index)=>({index,rangeDigest:hash(messages),messages}));
}
/** A summary's provenance never spans a protected original which was not sent to the model. */
export function segmentSummarizableContext(messages:readonly CompactableContextMessage[],maxCharacters:number,
  preserve=mustPreserveContextMessage) {
  const result:(ContextSummarySegment&{sourceStart:number;sourceEnd:number})[]=[];
  let start=0;
  for(let end=0;end<=messages.length;end++)if(end===messages.length||preserve(messages[end]!)){
    let offset=start;
    for(const segment of segmentConversationContext(messages.slice(start,end),maxCharacters)){
      result.push({...segment,index:result.length,sourceStart:offset,sourceEnd:offset+segment.messages.length});offset+=segment.messages.length;
    }
    start=end+1;
  }
  return result;
}
function baseReceipt(options:ContextCompactionOptions,current:ContextCompactionSnapshot,tail:readonly CompactableContextMessage[]) {
  return {version:1 as const,taskId:options.scope.taskId,conversationId:options.scope.conversationId,cutoff:options.scope.cutoff,
    deadline:options.scope.deadline,configurationRef:current.configurationRef,modelConfigurationRef:options.modelConfigurationRef,
    policy:structuredClone(options.policy),goalFrameDigest:hash(options.compile([])),sourceDigest:hash(current.messages),
    sourceCount:current.messages.length,prefixCount:current.messages.length-tail.length,sourceTasks:sourceTasks(current.messages),tailDigest:hash(tail)};
}
/** Performs one bounded pass. Summary text remains untrusted, process-local data. */
export async function compactConversationContext(options:ContextCompactionOptions, regroup=false):Promise<ContextCompactionResult> {
  validatePolicy(options.policy);
  if(!validText(options.modelConfigurationRef)||!validText(options.scope.taskId)||!validText(options.scope.conversationId)
    ||!validText(options.scope.cutoff)||!Number.isFinite(Date.parse(options.scope.deadline)))
    throw new ProtocolError('INVALID_ARGUMENT','Conversation compaction scope is invalid');
  const active=()=>{
    if(options.scope.signal.aborted)throw new ProtocolError('CANCELLED','Conversation compaction cancelled');
    if((options.now?.()??Date.now())>=Date.parse(options.scope.deadline))throw new ProtocolError('TIMEOUT','Conversation compaction expired');
    assertSynchronous(options.assertCurrent());
  };
  active();
  const original=snapshot(options),before=measure(options.compile(original.messages),options.goalTokenBudget);
  const cacheBinding=hash([options.cacheConversationId??options.scope.conversationId,
    original.configurationRef,options.modelConfigurationRef,options.policy,'verbatim-constraints:v2']);
  const previous=regroup?undefined:options.previous;
  const validCache=previous?.binding===cacheBinding&&previous.prefixCount>0
    &&previous.prefixDigest===hash(original.messages.slice(0,previous.prefixCount));
  const modern=options.policy.retainTurns!==undefined;
  const triggerFraction=modern?0.75:1;
  const goalFraction=modern?0.5:1;
  if(!options.force&&!validCache&&fits(before,options.policy.triggerCharacters-1,triggerFraction))
    return {state:'unchanged',messages:original.messages};
  let boundary=retainedContextBoundary(original.messages,options.policy);
  const activeTasks=new Set(original.messages.filter(message=>message.taskState
    &&!['succeeded','failed','cancelled'].includes(message.taskState)).map(message=>message.taskId).filter(Boolean));
  const preserve=(message:CompactableContextMessage)=>mustPreserveContextMessage(message)
    ||(modern&&!!message.taskId&&activeTasks.has(message.taskId));
  const plan=(source:readonly CompactableContextMessage[],cached?:ContextCompactionCache)=>{
    const offset=cached?.sourceRanges?cached.prefixCount:0;
    const starts=[offset,...(modern?source.flatMap((message,index)=>index>offset&&message.role==='user'?[index]:[]):[]),source.length];
    const ranges=starts.slice(0,-1).flatMap((start,index)=>{
      const pieces=segmentSummarizableContext(source.slice(start,starts[index+1]),options.policy.segmentCharacters,preserve);
      if(modern&&pieces.some((piece,i)=>i>0&&pieces[i-1]!.sourceEnd===piece.sourceStart))
        throw new ProtocolError('INVALID_ARGUMENT','One historical turn exceeds the summary segment character limit');
      return pieces.map(segment=>({sourceStart:start+segment.sourceStart,sourceEnd:start+segment.sourceEnd}));
    });
    const selected:typeof ranges=[];
    for(const range of ranges){
      const last=selected.at(-1);
      if(modern&&last?.sourceEnd===range.sourceStart
        &&JSON.stringify(source.slice(last.sourceStart,range.sourceEnd)).length<=options.policy.segmentCharacters)
        last.sourceEnd=range.sourceEnd;
      else selected.push(range);
    }
    return [...(cached?.sourceRanges??[]),...selected].map((range,index)=>{
      const messages=source.slice(range.sourceStart,range.sourceEnd);
      return {...range,index,messages,rangeDigest:hash(messages)};
    });
  };
  const derive=(summaries:readonly string[],digest:string):CompactableContextMessage[]=>summaries.map((text,index)=>({
    id:'context-summary:'+digest+':'+index,role:'assistant',
    content:JSON.stringify({kind:'derived_conversation_summary',treatment:'untrusted_data',text})}));
  const assemble=(source:readonly CompactableContextMessage[],summaries:readonly string[],segments:ReturnType<typeof plan>)=>{
    const derived=derive(summaries,hash(source));
    if(segments.length!==derived.length)conflict();
    const result:CompactableContextMessage[]=[];let next=0;
    for(let i=0;i<source.length;){
      const segment=segments[next];
      if(segment?.sourceStart===i){result.push(derived[next]!);i=segment.sourceEnd;next++;}
      else {result.push(source[i]!);i++;}
    }
    return result;
  };
  const reuse=validCache&&previous.prefixCount<=boundary
    &&(!options.force||previous.prefixCount===boundary)
    &&fits(measure(options.compile([...assemble(original.messages.slice(0,previous.prefixCount),previous.summaries,
      plan(original.messages.slice(0,previous.prefixCount),previous)),
      ...original.messages.slice(previous.prefixCount)]),
      options.goalTokenBudget),options.policy.triggerCharacters-1,triggerFraction);
  if(reuse)boundary=previous.prefixCount;
  const prefix=original.messages.slice(0,boundary),tail=original.messages.slice(boundary);
  const preserved=prefix.filter(preserve),summarizable=prefix.filter(message=>!preserve(message));
  if(!prefix.length){
    if((modern||options.force)&&fits(before,options.policy.maxCharacters))return {state:'unchanged',messages:original.messages};
    throw new ProtocolError('INVALID_ARGUMENT','Required recent turns exceed the '+exceededBudget(before,options.policy.maxCharacters));
  }
  if(!summarizable.length){
    if(fits(before,options.policy.maxCharacters))return {state:'unchanged',messages:original.messages};
    throw new ProtocolError('INVALID_ARGUMENT','Verbatim constraints and pending operations exceed the '+exceededBudget(before,options.policy.maxCharacters));
  }
  const required=measure(options.compile([...preserved,...tail]),options.goalTokenBudget);
  if(!reuse&&!fits(required,options.policy.maxCharacters))
    throw new ProtocolError('INVALID_ARGUMENT','Current goal and protected history exceed the '+exceededBudget(required,options.policy.maxCharacters));
  if(!modern&&!reuse&&required.characters>=options.policy.targetCharacters)
    throw new ProtocolError('INVALID_ARGUMENT','Current goal and retained history exceed the compaction target; original history is unchanged');
  const base=baseReceipt(options,original,tail),saved=options.loadCheckpoint?.();
  if(saved!==undefined) {
    if(!saved||typeof saved!=='object'||!isDeepStrictEqual(base,Object.fromEntries(Object.keys(base)
      .map(key=>[key,(saved as unknown as Record<string,unknown>)[key]]))))conflict();
  }
  const cachedCount=validCache&&previous.prefixCount<=boundary&&(modern||reuse)?previous.summaries.length:0;
  const segments=plan(prefix,cachedCount?previous:undefined);
  const assertSource=()=>{
    active();validatePolicy(options.policy);
    const current=snapshot(options);
    if(!isDeepStrictEqual(base,baseReceipt(options,current,current.messages.slice(boundary)))
      ||!isDeepStrictEqual(before,measure(options.compile(current.messages),options.goalTokenBudget)))conflict();
    if(saved!==undefined&&!isDeepStrictEqual(saved,options.loadCheckpoint?.()))conflict();
  };
  const summaries:string[]=cachedCount?[...previous!.summaries]:[],ranges:ContextCompactionReceipt['segments'][number][]=
    cachedCount?structuredClone([...previous!.segments]):[];
  for(const segment of segments.slice(cachedCount)) {
    assertSource();
    let checked=false;
    const text=await awaitContextCompactionScope(options.scope,()=>options.summarize({scope:options.scope,segment:structuredClone(segment),
      authorizationSource:{configurationRef:base.configurationRef,sourceDigest:base.sourceDigest,sourceCount:base.sourceCount,
        tailDigest:base.tailDigest,goalFrameDigest:base.goalFrameDigest},
      maxSummaryCharacters:regroup?Math.max(1,Math.floor(options.policy.maxSummaryCharacters/2)):options.policy.maxSummaryCharacters,
      assertBeforeSend:()=>{assertSource();checked=true;}}),options.now);
    assertSource();
    if(!checked)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Summarizer did not attest a final synchronous source guard');
    if(!validText(text)||text.length>options.policy.maxSummaryCharacters)
      throw new ProtocolError('INVALID_ARGUMENT','Conversation summary exceeds its output bound');
    summaries.push(text);
    ranges.push({index:segment.index,rangeDigest:segment.rangeDigest,firstIdentityDigest:identity(segment.messages[0]!),
      lastIdentityDigest:identity(segment.messages.at(-1)!),sourceCharacters:JSON.stringify(segment.messages).length,
      summaryDigest:hash(text),summaryCharacters:text.length});
  }
  const messages=[...assemble(prefix,summaries,segments),...tail],after=measure(options.compile(messages),options.goalTokenBudget);
  if(modern&&!regroup&&segments.length>1
    &&!fits(after,options.policy.targetCharacters,goalFraction)
    &&fits(required,options.policy.targetCharacters,goalFraction))
    return compactConversationContext(options,true);
  if(after.characters>=before.characters||(after.tokens.state==='measured'&&before.tokens.state==='measured'
    &&after.tokens.inputTokens>=before.tokens.inputTokens))
    throw new ProtocolError('INVALID_ARGUMENT','Conversation summary made no measurable progress');
  if(!fits(after,options.policy.maxCharacters))
    throw new ProtocolError('INVALID_ARGUMENT','Conversation summary still exceeds the '+exceededBudget(after,options.policy.maxCharacters));
  if(!modern&&!fits(after,reuse?options.policy.triggerCharacters-1:options.policy.targetCharacters,goalFraction))
    throw new ProtocolError('INVALID_ARGUMENT','Conversation summary still exceeds the target budget');
  const receipt:ContextCompactionReceipt={...base,segments:ranges,summaryDigest:hash(summaries),budget:{before,after}};
  assertSource();
  if(saved!==undefined&&!isDeepStrictEqual(saved,receipt))conflict();
  assertSynchronous(options.saveCheckpoint(structuredClone(receipt)));
  // The checkpoint stores metadata only. A restart must revalidate all sources;
  // differing regenerated text cannot replace the original compiled binding.
  const assertCommitted=()=>{
    active();
    const current=snapshot(options);
    if(!isDeepStrictEqual(base,baseReceipt(options,current,current.messages.slice(boundary)))
      ||!isDeepStrictEqual(before,measure(options.compile(current.messages),options.goalTokenBudget))
      ||!isDeepStrictEqual(after,measure(options.compile(messages),options.goalTokenBudget))
      ||(options.loadCheckpoint!==undefined&&!isDeepStrictEqual(receipt,options.loadCheckpoint())))conflict();
  };
  assertCommitted();
  options.remember?.({binding:cacheBinding,prefixDigest:hash(prefix),prefixCount:prefix.length,
    summaries:structuredClone(summaries),segments:structuredClone(ranges),
    sourceRanges:segments.map(({sourceStart,sourceEnd})=>({sourceStart,sourceEnd}))});
  return {state:'compacted',messages:structuredClone(messages),receipt:structuredClone(receipt),assertCurrent:assertCommitted};
}
