import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {CoordinationGoalTokenBudget} from './context-binding.js';

export const CONTEXT_COMPACTION_CHECKPOINT = 'conversation-compaction:v1';

export interface CompactableContextMessage {
  readonly id:string;
  readonly role:'user'|'assistant';
  readonly content:string;
  readonly taskId?:string;
  readonly withheld?:boolean;
  readonly createdAt?:string;
  readonly taskState?:string;
  readonly answerWithheld?:true;
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
  readonly tokens:{state:'unmeasured'}|{state:'measured';tokenizerRef:string;inputTokens:number;
    contextTokens:number;reservedOutputTokens:number};
}
export interface ContextCompactionReceipt {
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
export type ContextCompactionResult =
  | {state:'unchanged';messages:readonly CompactableContextMessage[]}
  | {state:'compacted';messages:readonly CompactableContextMessage[];receipt:ContextCompactionReceipt;
      /** Reused by the final transport guard, including after credential awaits. */
      assertCurrent:()=>void};

const hash=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict=():never=>{throw new ProtocolError('REVISION_CONFLICT','Original conversation compaction source or configuration changed');};
const validText=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const identity=(message:CompactableContextMessage)=>hash([message.id,message.taskId??null]);

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
      ||Object.keys(message).some(key=>!['id','role','content','taskId','withheld','createdAt','taskState','answerWithheld'].includes(key))
      ||message.createdAt!==undefined&&(typeof message.createdAt!=='string'||!Number.isFinite(Date.parse(message.createdAt)))
      ||message.taskState!==undefined&&!['created','planning','running','waiting_approval','waiting_external',
        'waiting_reconciliation','verifying','cancelling','succeeded','failed','cancelled'].includes(message.taskState)
      ||message.answerWithheld!==undefined&&message.answerWithheld!==true
      ||(message.taskId!==undefined&&!validText(message.taskId)))
      throw new ProtocolError('UNAUTHORIZED','Compaction requires already eligible, distinct conversation messages');
    ids.add(message.id);
  }
  return structuredClone(value);
}
function measure(compiled:string,budget?:CoordinationGoalTokenBudget):CompactionMeasurement {
  if(typeof compiled!=='string')throw new ProtocolError('INVALID_ARGUMENT','Compaction compiler must return text');
  if(budget===undefined)return {characters:compiled.length,tokens:{state:'unmeasured'}};
  if(!budget||!validText(budget.tokenizerRef)||!Number.isSafeInteger(budget.contextTokens)||budget.contextTokens<1
    ||!Number.isSafeInteger(budget.reservedOutputTokens)||budget.reservedOutputTokens<0
    ||budget.reservedOutputTokens>=budget.contextTokens||typeof budget.countTokens!=='function')
    throw new ProtocolError('INVALID_ARGUMENT','Trusted compaction token budget is invalid');
  let tokens:unknown;
  try{tokens=budget.countTokens(compiled);}catch{throw new ProtocolError('INVALID_ARGUMENT','Compaction token measurement failed');}
  if(tokens&&typeof (tokens as Promise<unknown>).then==='function')void Promise.resolve(tokens).catch(()=>undefined);
  if(!Number.isSafeInteger(tokens)||(tokens as number)<0)
    throw new ProtocolError('INVALID_ARGUMENT','Compaction token measurement must be synchronous');
  return {characters:compiled.length,tokens:{state:'measured',tokenizerRef:budget.tokenizerRef,inputTokens:tokens as number,
    contextTokens:budget.contextTokens,reservedOutputTokens:budget.reservedOutputTokens}};
}
function fits(measurement:CompactionMeasurement,characters:number):boolean {
  return measurement.characters<=characters&&(measurement.tokens.state==='unmeasured'
    ||measurement.tokens.inputTokens<=measurement.tokens.contextTokens-measurement.tokens.reservedOutputTokens);
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
function baseReceipt(options:ContextCompactionOptions,current:ContextCompactionSnapshot,tail:readonly CompactableContextMessage[]) {
  return {version:1 as const,taskId:options.scope.taskId,conversationId:options.scope.conversationId,cutoff:options.scope.cutoff,
    deadline:options.scope.deadline,configurationRef:current.configurationRef,modelConfigurationRef:options.modelConfigurationRef,
    policy:structuredClone(options.policy),goalFrameDigest:hash(options.compile([])),sourceDigest:hash(current.messages),
    sourceCount:current.messages.length,sourceTasks:sourceTasks(current.messages),tailDigest:hash(tail)};
}
/** Performs one bounded pass. Summary text remains untrusted, process-local data. */
export async function compactConversationContext(options:ContextCompactionOptions):Promise<ContextCompactionResult> {
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
  if(before.characters<options.policy.triggerCharacters&&fits(before,options.policy.maxCharacters))return {state:'unchanged',messages:original.messages};
  let boundary=Math.max(0,original.messages.length-options.policy.retainMessages);
  // Keep a contiguous Runtime task's exact question/answer together at the tail boundary.
  while(boundary>0&&boundary<original.messages.length&&original.messages[boundary]?.taskId
    &&original.messages[boundary]?.taskId===original.messages[boundary-1]?.taskId)boundary--;
  const prefix=original.messages.slice(0,boundary),tail=original.messages.slice(boundary);
  if(!prefix.length)throw new ProtocolError('INVALID_ARGUMENT','Conversation budget cannot be met while retaining the required tail');
  const base=baseReceipt(options,original,tail),saved=options.loadCheckpoint?.();
  if(saved!==undefined) {
    if(!saved||typeof saved!=='object'||!isDeepStrictEqual(base,Object.fromEntries(Object.keys(base)
      .map(key=>[key,(saved as unknown as Record<string,unknown>)[key]]))))conflict();
  }
  const segments=segmentConversationContext(prefix,options.policy.segmentCharacters);
  const assertSource=()=>{
    active();validatePolicy(options.policy);
    const current=snapshot(options);
    if(!isDeepStrictEqual(base,baseReceipt(options,current,current.messages.slice(boundary)))
      ||!isDeepStrictEqual(before,measure(options.compile(current.messages),options.goalTokenBudget)))conflict();
    if(saved!==undefined&&!isDeepStrictEqual(saved,options.loadCheckpoint?.()))conflict();
  };
  const summaries:string[]=[],ranges:ContextCompactionReceipt['segments'][number][]=[];
  for(const segment of segments) {
    assertSource();
    let checked=false;
    const text=await awaitContextCompactionScope(options.scope,()=>options.summarize({scope:options.scope,segment:structuredClone(segment),
      authorizationSource:{configurationRef:base.configurationRef,sourceDigest:base.sourceDigest,sourceCount:base.sourceCount,
        tailDigest:base.tailDigest,goalFrameDigest:base.goalFrameDigest},
      maxSummaryCharacters:options.policy.maxSummaryCharacters,assertBeforeSend:()=>{assertSource();checked=true;}}),options.now);
    assertSource();
    if(!checked)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Summarizer did not attest a final synchronous source guard');
    if(!validText(text)||text.length>options.policy.maxSummaryCharacters)
      throw new ProtocolError('INVALID_ARGUMENT','Conversation summary exceeds its output bound');
    summaries.push(text);
    ranges.push({index:segment.index,rangeDigest:segment.rangeDigest,firstIdentityDigest:identity(segment.messages[0]!),
      lastIdentityDigest:identity(segment.messages.at(-1)!),sourceCharacters:JSON.stringify(segment.messages).length,
      summaryDigest:hash(text),summaryCharacters:text.length});
  }
  const derived:CompactableContextMessage[]=summaries.map((text,index)=>({id:'context-summary:'+base.sourceDigest+':'+index,
    role:'assistant',content:JSON.stringify({kind:'derived_conversation_summary',treatment:'untrusted_data',text})}));
  const messages=[...derived,...tail],after=measure(options.compile(messages),options.goalTokenBudget);
  if(after.characters>=before.characters||(after.tokens.state==='measured'&&before.tokens.state==='measured'
    &&after.tokens.inputTokens>=before.tokens.inputTokens))
    throw new ProtocolError('INVALID_ARGUMENT','Conversation summary made no measurable progress');
  if(!fits(after,options.policy.targetCharacters))throw new ProtocolError('INVALID_ARGUMENT','Conversation summary still exceeds the target budget');
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
  return {state:'compacted',messages:structuredClone(messages),receipt:structuredClone(receipt),assertCurrent:assertCommitted};
}
