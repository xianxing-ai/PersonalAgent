import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {FactRef,FactVersion} from '@personal-agent/memory';
import type {KnowledgeSource} from '@personal-agent/knowledge';
import type {CompetitionFactHost} from './competition-fact-host.js';
import type {F04Scope} from './workflow-f04-candidate.js';
import {assertF04Lifetime} from './workflow-f04-candidate.js';

export interface F04ProjectionIntent {
  version:1;source:KnowledgeSource;before:FactVersion;summary:string;observedAt:string;
  sourceTaskId:string;sourceRunId:string;sourceOperationId:string;
}
export interface F04ProjectionReadback {
  state:'updated';fact:FactRef;sourceRevision:string;batchToken:string;graphRevision:number;
}
export type F04FactPort=Pick<CompetitionFactHost,'publicMemory'|'readCurrentPublicFact'|'readPublicSourceHead'|'recordPublicSource'
  |'drain'|'processImpacts'|'listImpactReceipts'|'readCompletedImpact'>;

const fail=(message:string):never=>{throw new ProtocolError('RESULT_UNKNOWN',message);};
function expected(intent:F04ProjectionIntent):FactVersion {
  const {source,before}=intent;
  return {ref:{id:before.ref.id,revision:before.ref.revision+1},summary:intent.summary,
    sourceRef:`${source.vaultId}/${source.path}#L${source.line}@${source.revision}`,observedAt:intent.observedAt,
    validFrom:before.validFrom,validUntil:before.validUntil,sensitivity:'public',state:'active',
    confirmation:'external_observation',corrects:before.ref};
}

/** Source revisions own public-source idempotency. Observation time is not part of
 * that identity; another existing observer may already have projected this same source. */
export function readF04ProjectedFact(facts:F04FactPort,intent:F04ProjectionIntent):FactVersion|undefined {
  const target=expected(intent),current=facts.readCurrentPublicFact(target.ref);
  if(!current||facts.readPublicSourceHead({vaultId:intent.source.vaultId,path:intent.source.path,factId:target.ref.id})!==target.ref.revision)return;
  return isDeepStrictEqual({...current,observedAt:target.observedAt},target)?current:undefined;
}

/** Read only the original target Fact and the existing namespace's durable
 * projection receipts. No write, feed consumption, retry or index mutation. */
export function readF04Projection(facts:F04FactPort,intent:F04ProjectionIntent,scope:F04Scope):F04ProjectionReadback|undefined {
  assertF04Lifetime(scope);const current=readF04ProjectedFact(facts,intent);if(!current)return;
  let afterGraphRevision=0;
  for(let page=0;page<10;page++){
    assertF04Lifetime(scope);const receipts=facts.listImpactReceipts({afterGraphRevision,limit:100});
    for(const receipt of receipts){
      const matching=receipt.projection.links.some(link=>isDeepStrictEqual(link.fact,current.ref));
      if(!matching)continue;
      const completed=facts.readCompletedImpact(receipt.projection.batchToken);
      if(!completed||!isDeepStrictEqual(receipt.completed,completed))return;
      return {state:'updated',fact:current.ref,sourceRevision:intent.source.revision,
        batchToken:receipt.projection.batchToken,graphRevision:receipt.projection.graphRevision};
    }
    if(receipts.length<100)return;
    const next=receipts.at(-1)!.projection.graphRevision;if(next<=afterGraphRevision)return;afterGraphRevision=next;
  }
  return;
}

/** Called only inside the original N04 ToolGateway operation, after its own
 * local_write policy grant. A known source write is never repeated here. */
export async function applyF04Projection(facts:F04FactPort,intent:F04ProjectionIntent,scope:F04Scope,
  assertCurrent:()=>void):Promise<F04ProjectionReadback> {
  assertF04Lifetime(scope);assertCurrent();
  if(!readF04ProjectedFact(facts,intent)){
    if(!isDeepStrictEqual(facts.readCurrentPublicFact(intent.before.ref),intent.before))
      throw new ProtocolError('REVISION_CONFLICT','F04 original Fact changed before source projection');
    facts.recordPublicSource({vaultId:intent.source.vaultId,path:intent.source.path,factId:intent.before.ref.id,
      sourceRevision:intent.source.revision,line:intent.source.line,summary:intent.summary,
      observedAt:intent.observedAt,validFrom:intent.before.validFrom,validUntil:intent.before.validUntil,
      expectedFactRevision:intent.before.ref.revision},scope);
  }
  assertCurrent();const drained=await facts.drain({...scope,limit:100,maxBatches:10});assertCurrent();
  if(!drained.atWatermark)fail('F04 original source projection has not reached its existing feed watermark');
  facts.processImpacts({...scope,at:new Date().toISOString(),limit:100});assertCurrent();
  return readF04Projection(facts,intent,scope)??fail('F04 original source projection still lacks its durable impact receipt');
}
