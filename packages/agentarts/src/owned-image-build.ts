import {ProtocolError} from '@personal-agent/contracts';
import type {PinnedDeploymentIdentity} from './pinned-version-readonly.js';

/** Plan only. No Docker, SWR or AgentArts call is made here. */
export interface OwnedImageBuildPlan {
  version:1;state:'planned_not_built';architecture:'arm64';sourceRevision:string;sourceDigest:string;recipeId:string;imageTag:string;
  registryRepository:string;scriptDigest:string;imageDigest:null;containerExecution:'unverified';readinessProbe:'unverified';
  runtimeReady:'not_read';routingChanged:false;realEnvironmentAcceptance:'not_performed';
}
export interface OwnedImageControlPlaneReadback extends PinnedDeploymentIdentity {imageTag:string;architecture:string;runtimeReady?:boolean;containerExecution?:string;readinessProbe?:string;}
export interface OwnedImageControlPlaneCorrelation {
  state:'unavailable'|'rejected'|'control_plane_matched';reason:string;runtimeReady:boolean|'not_read';containerExecution:'unverified';
  readinessProbe:'unverified';imageDigest:string|null;routingChanged:false;realEnvironmentAcceptance:'not_performed';
}
const fail=(message:string):never=>{throw new ProtocolError('INVALID_ARGUMENT',message);};
const text=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
const sha40=/^[a-f0-9]{40}$/;
const sha64=/^[a-f0-9]{64}$/;
const imageDigest=/^sha256:[a-f0-9]{64}$/;
const tag=/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const repo=/^[a-z0-9][a-z0-9./_-]{1,200}$/;
const recipe=/^[a-z0-9][a-z0-9-]{0,80}$/;

export function planOwnedImageBuild(input:{sourceRevision:string;sourceDigest:string;recipeId:string;imageTag:string;registryRepository:string;scriptDigest:string;architecture:'arm64'}):OwnedImageBuildPlan {
  if(!input||input.architecture!=='arm64'||!sha40.test(input.sourceRevision??'')||!sha64.test(input.sourceDigest??'')||!sha64.test(input.scriptDigest??'')
    ||!recipe.test(input.recipeId??'')||!tag.test(input.imageTag??'')||/latest/i.test(input.imageTag)||!repo.test(input.registryRepository??'')
    ||input.registryRepository.includes('@')||input.registryRepository.includes('sha256'))
    fail('ARM64 build plan requires exact source, script, recipe, tag and repository; Latest is rejected');
  return {version:1,state:'planned_not_built',architecture:'arm64',sourceRevision:input.sourceRevision,sourceDigest:input.sourceDigest,
    recipeId:input.recipeId,imageTag:input.imageTag,registryRepository:input.registryRepository,scriptDigest:input.scriptDigest,
    imageDigest:null,containerExecution:'unverified',readinessProbe:'unverified',runtimeReady:'not_read',routingChanged:false,
    realEnvironmentAcceptance:'not_performed'};
}

/** Control-plane identity match. A READY flag never fills container execution or the readiness probe. */
export function correlateOwnedImageControlPlane(plan:OwnedImageBuildPlan,expected:PinnedDeploymentIdentity,readback?:OwnedImageControlPlaneReadback):OwnedImageControlPlaneCorrelation {
  const unverified={containerExecution:'unverified' as const,readinessProbe:'unverified' as const,routingChanged:false as const,realEnvironmentAcceptance:'not_performed' as const};
  if(!plan||plan.state!=='planned_not_built'||plan.architecture!=='arm64')fail('Control-plane correlation requires the original ARM64 build plan');
  if(!expected?.version||expected.endpointName!==expected.version||!imageDigest.test(expected.imageDigest??''))fail('Expected deployment pin is incomplete');
  if(readback===undefined)return {...unverified,state:'unavailable',reason:'control_plane_reader_missing',runtimeReady:'not_read',imageDigest:null};
  const identityMatches=readback.runtimeId===expected.runtimeId&&readback.runtimeName===expected.runtimeName&&readback.endpointId===expected.endpointId
    &&readback.endpointName===expected.endpointName&&readback.version===expected.version&&readback.imageDigest===expected.imageDigest
    &&readback.imageTag===plan.imageTag&&readback.architecture==='arm64';
  if(!identityMatches)return {...unverified,state:'rejected',reason:'pinned_identity_mismatch',runtimeReady:'not_read',imageDigest:null};
  return {...unverified,state:'control_plane_matched',reason:'control_plane_identity_matched_probe_unverified',
    runtimeReady:readback.runtimeReady===true,imageDigest:readback.imageDigest};
}
