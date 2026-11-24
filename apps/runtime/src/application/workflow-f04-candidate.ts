import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {FactVersion} from '@personal-agent/memory';
import type {KnowledgeSource} from '@personal-agent/knowledge';

const text={type:'string',minLength:1,maxLength:200,pattern:'^[^\\r\\n\\u0000]+$'};
const kind={enum:['fact','preference','responsibility','inference']};
export const f04RequestSchema={type:'object',additionalProperties:false,required:['query','factId','candidateKind','updateText'],properties:{
  query:{type:'string',minLength:1,maxLength:128},factId:{type:'string',minLength:1,maxLength:128},candidateKind:kind,updateText:text}};
export const f04CandidateSchema={type:'object',additionalProperties:false,required:['version','kind','disposition','reason'],properties:{
  version:{const:1},kind,disposition:{enum:['compatible','conflict','invalid']},reason:{type:'string',minLength:1,maxLength:2048}}};
export interface F04Request {query:string;factId:string;candidateKind:'fact'|'preference'|'responsibility'|'inference';updateText:string;}
export interface F04Candidate {version:1;kind:F04Request['candidateKind'];disposition:'compatible'|'conflict'|'invalid';reason:string;}
export interface F04SourceConfiguration {sourceId:string;configRevision:number;publicQueries:string[];allowedNotePaths:string[];memoryNamespace:string;writeAvailable:boolean;}
export interface F04Input extends F04Request {configuration:F04SourceConfiguration;candidateContract:Record<string,unknown>;}
export interface F04Recall {fact:FactVersion;history:FactVersion[];source:KnowledgeSource;excerpt:string;}
export interface F04Scope {taskId:string;deadline:string;signal:AbortSignal;}

/** The model classifies an already bound candidate. It cannot choose another source, scope or write. */
export function parseF04Candidate(value:unknown,input:F04Request):F04Candidate {
  validateToolValue(f04CandidateSchema,value);const candidate=value as F04Candidate;
  if(candidate.kind!==input.candidateKind)throw new ProtocolError('UNAUTHORIZED','F04 candidate kind differs from its original request');
  return structuredClone(candidate);
}

export function assertF04Lifetime(scope:F04Scope):void {
  if(scope.signal.aborted)throw new ProtocolError('CANCELLED','F04 original request cancelled');
  if(!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline))
    throw new ProtocolError('TIMEOUT','F04 original request expired');
}

/** Exact original source ownership, never a model-declared source relationship. */
export function assertF04FactSource(recall:F04Recall,input:F04Input):void {
  const {fact,source}=recall;
  if(!fact||!source||fact.ref?.id!==input.factId||fact.state!=='active'||fact.sensitivity!=='public'
    ||source.vaultId!==input.configuration.sourceId||!input.configuration.allowedNotePaths.includes(source.path)
    ||fact.sourceRef!==`${source.vaultId}/${source.path}#L${source.line}@${source.revision}`
    ||!Number.isFinite(Date.parse(fact.validFrom))||!Number.isFinite(Date.parse(fact.validUntil))
    ||Date.parse(fact.validFrom)>Date.now()||Date.parse(fact.validUntil)<=Date.now()
    ||!recall.excerpt||recall.excerpt.length>200||/[\r\n\u0000]/.test(recall.excerpt))
    throw new ProtocolError('UNSUPPORTED_CAPABILITY','F04 requires its current public source-owned Fact and bounded original line');
}
