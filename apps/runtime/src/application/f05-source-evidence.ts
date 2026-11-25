import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {parseF05AnswerCandidate} from '@personal-agent/contracts/f05-answer';
import type {F05AnswerCandidate} from '@personal-agent/contracts/f05-answer';
import type {FactVersion} from '@personal-agent/memory';
import type {KnowledgeSource} from '@personal-agent/knowledge';

export interface F05KnowledgeEvidence {id:string;source:KnowledgeSource;excerpt:string;}
export interface F05SourceEvidence {facts:FactVersion[];sources:F05KnowledgeEvidence[];}
export interface F05SourceReadScope {taskId:string;deadline:string;signal:AbortSignal;}
export interface F05SourceReader {
  readCurrentFact(ref:FactVersion['ref']):FactVersion|undefined;
  readCitation(source:KnowledgeSource,scope:F05SourceReadScope):Promise<string>;
  assertCitationCurrent(source:KnowledgeSource,scope:F05SourceReadScope):void;
  assertCurrent(scope:F05SourceReadScope):void;
}
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function fail(message:string):never {throw new ProtocolError('REVISION_CONFLICT',message);}

/** IDs are positions in an original checked receipt; a candidate cannot introduce another source. */
export function f05KnowledgeEvidence(value:unknown,prefix:'initial'|'expanded',sourceId:string,limit:number):F05KnowledgeEvidence[] {
  if(!plain(value)||Object.keys(value).sort().join(',')!=='hits,truncated'||!Array.isArray(value.hits)
    ||typeof value.truncated!=='boolean'||value.hits.length>limit)fail('Original F05 knowledge receipt is invalid');
  return value.hits.map((hit,index)=>{
    if(!plain(hit)||Object.keys(hit).sort().join(',')!=='excerpt,source'||!plain(hit.source)
      ||Object.keys(hit.source).sort().join(',')!=='line,path,revision,vaultId'||hit.source.vaultId!==sourceId
      ||typeof hit.source.path!=='string'||!hit.source.path||hit.source.path.includes('\\')||hit.source.path.includes(':')
      ||hit.source.path.split('/').some(part=>!part||part==='.'||part==='..')
      ||!Number.isSafeInteger(hit.source.line)||(hit.source.line as number)<1||typeof hit.source.revision!=='string'
      ||!/^[a-f0-9]{64}$/.test(hit.source.revision)||typeof hit.excerpt!=='string'||!hit.excerpt.trim()||hit.excerpt.length>8192)
      fail('Original F05 citation is outside its source binding');
    return {id:prefix+':'+index,source:structuredClone(hit.source) as unknown as KnowledgeSource,excerpt:hit.excerpt};
  });
}

export function assertF05SourcesCurrent(evidence:F05SourceEvidence,reader:F05SourceReader,scope:F05SourceReadScope):void {
    if(scope.signal.aborted)throw new ProtocolError('CANCELLED','F05 source read cancelled');
    if(!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline))throw new ProtocolError('TIMEOUT','F05 source read expired');
    reader.assertCurrent(scope);
    for(const fact of evidence.facts) {
      const current=reader.readCurrentFact(fact.ref);
      if(!isDeepStrictEqual(current,fact)||fact.sensitivity!=='public'||fact.state!=='active'
        ||!Number.isFinite(Date.parse(fact.validFrom))||!Number.isFinite(Date.parse(fact.validUntil))
        ||Date.parse(fact.validFrom)>Date.now()||Date.parse(fact.validUntil)<=Date.now())fail('Original F05 Fact version is no longer current');
    }
  for(const item of evidence.sources){
    const result=reader.assertCitationCurrent(structuredClone(item.source),scope);
    if(result!==undefined){void Promise.resolve(result).catch(()=>{});fail('F05 final citation guard must be synchronous');}
  }
}

export async function assertF05Sources(evidence:F05SourceEvidence,reader:F05SourceReader,scope:F05SourceReadScope):Promise<void> {
  const active=()=>assertF05SourcesCurrent(evidence,reader,scope);active();
  for(const item of evidence.sources){
    const original=await reader.readCitation(structuredClone(item.source),scope);active();
    if(typeof original!=='string'||!original.includes(item.excerpt))fail('Original F05 citation text or version changed');
  }
}

/** This checks exact quotation provenance; semantic support remains the original model review's advisory judgment. */
export function bindF05Answer(value:unknown,evidence:F05SourceEvidence):F05AnswerCandidate {
  const candidate=parseF05AnswerCandidate(value),ids=new Set<string>();
  for(const claim of candidate.claims){
    if(ids.has(claim.id)||!candidate.answer.includes(claim.text))fail('F05 answer claim mapping is incomplete');ids.add(claim.id);
    const citations=new Set<string>();
    for(const citation of claim.citations){
      const source=evidence.sources.find(item=>item.id===citation.sourceId);
      if(!source||citations.has(citation.sourceId)||!source.excerpt.includes(citation.quote))fail('F05 quote is not in the original retrieved excerpt');
      citations.add(citation.sourceId);
    }
  }
  if(!candidate.claims.length&&!candidate.unresolved.length)fail('F05 answer without evidence must state what remains unknown');
  return candidate;
}
