import {ProtocolError} from '@personal-agent/contracts';
import type {PinnedDeploymentIdentity} from './pinned-version-readonly.js';

export interface EvaluationOutputRef {id:string;branch:'main'|'shadow';outputDigest:string;}
export interface PlatformEvaluationItem extends EvaluationOutputRef {score:number;}
export interface PlatformEvaluationReadback {
  evaluationId:string;revision:string;deploymentVersion:string;items:readonly PlatformEvaluationItem[];
}
export interface PlatformEvaluationBinding {
  state:'unavailable'|'rejected'|'bound';reason:string;deploymentVersion:string|null;evaluationId:string|null;revision:string|null;
  boundCount:number;scores:PlatformEvaluationItem[]|null;promotionReady:false;published:false;localTaskCompleted:false;
  realEnvironmentAcceptance:'not_performed';
}
export interface CompetitionPublishRecord {
  state:'not_published';published:false;routingChanged:false;promotionReady:false;prerequisitesRecorded:boolean;reason:string;
  realEnvironmentAcceptance:'not_performed';
}
const fail=(message:string):never=>{throw new ProtocolError('INVALID_ARGUMENT',message);};
const text=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
const sha=/^[a-f0-9]{64}$/;
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function output(value:EvaluationOutputRef,index:number):EvaluationOutputRef {
  if(!value||!id.test(value.id??'')||!['main','shadow'].includes(value.branch)||!sha.test(value.outputDigest??''))
    fail('Evaluation item '+index+' must bind id, branch and sha256 output');
  return {id:value.id,branch:value.branch,outputDigest:value.outputDigest};
}

/** Bind platform scores to original outputs. Missing platform data stays unavailable and never receives a default score. */
export function bindPlatformEvaluationToOutputs(input:{deployment:PinnedDeploymentIdentity;outputs:readonly EvaluationOutputRef[];platform?:PlatformEvaluationReadback}):PlatformEvaluationBinding {
  const outputs=input?.outputs;
  const base={deploymentVersion:input?.deployment?.version??null,evaluationId:null,revision:null,boundCount:0,scores:null,
    promotionReady:false as const,published:false as const,localTaskCompleted:false as const,realEnvironmentAcceptance:'not_performed' as const};
  if(!Array.isArray(outputs))return {...base,state:'unavailable',reason:'original_outputs_missing'};
  if(outputs.length<1||outputs.length>100)fail('Evaluation binding requires 1 to 100 original outputs');
  const originals=outputs.map(output);
  if(new Set(originals.map(item=>item.branch+':'+item.id)).size!==originals.length)fail('Duplicate evaluation item id');
  if(input.platform==null)return {...base,state:'unavailable',reason:'platform_evaluation_reader_missing'};
  const platform=input.platform;
  if(!platform||!id.test(platform.evaluationId??'')||!id.test(platform.revision??'')||!text(platform.deploymentVersion)||!Array.isArray(platform.items))
    fail('Platform evaluation readback identity is incomplete');
  if(platform.deploymentVersion!==input.deployment?.version)return {...base,state:'rejected',reason:'deployment_version_mismatch',evaluationId:platform.evaluationId,revision:platform.revision};
  if(platform.items.length!==originals.length)return {...base,state:'rejected',reason:'item_count_mismatch',evaluationId:platform.evaluationId,revision:platform.revision,deploymentVersion:platform.deploymentVersion};
  const scores=platform.items.map((item,index)=>{
    const bound=output(item,index);
    if(!Number.isFinite(item.score))fail('Platform score must be a finite number supplied by the reader');
    return {...bound,score:item.score};
  });
  const byKey=new Map(scores.map(item=>[item.branch+':'+item.id,item]));
  for(const item of originals) {
    const found=byKey.get(item.branch+':'+item.id);
    if(!found||found.outputDigest!==item.outputDigest)return {...base,state:'rejected',reason:'output_digest_mismatch',evaluationId:platform.evaluationId,revision:platform.revision,deploymentVersion:platform.deploymentVersion};
  }
  return {...base,state:'bound',reason:'scores_bound_to_original_output_digests',deploymentVersion:platform.deploymentVersion,
    evaluationId:platform.evaluationId,revision:platform.revision,boundCount:scores.length,scores};
}

/** Checklist only. The existing F23 CAS service remains the only writer; this function never publishes or changes routing. */
export function recordCompetitionPublishChain(input:{deployment:PinnedDeploymentIdentity;evaluation:PlatformEvaluationBinding;consumerReadback?:{version:string;parametersDigest:string;revision:number}}):CompetitionPublishRecord {
  const consumer=input?.consumerReadback,evaluation=input?.evaluation;
  const versionMatches=!!consumer&&consumer.version===input?.deployment?.version&&evaluation?.state==='bound'&&evaluation.deploymentVersion===input.deployment.version
    &&text(consumer.parametersDigest)&&sha.test(consumer.parametersDigest)&&Number.isSafeInteger(consumer.revision)&&consumer.revision>=1;
  const reason=evaluation?.state!=='bound'?'evaluation_not_bound':!consumer?'consumer_readback_required':consumer.version!==input.deployment?.version?'consumer_version_mismatch':'existing_f23_cas_required';
  return {state:'not_published',published:false,routingChanged:false,promotionReady:false,prerequisitesRecorded:versionMatches,reason,realEnvironmentAcceptance:'not_performed'};
}
