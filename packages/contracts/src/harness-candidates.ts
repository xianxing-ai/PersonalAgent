import {ProtocolError,validateToolValue} from './index.js';
import {createHash} from 'node:crypto';
import schema from './harness-candidates.schema.js';
import type {HarnessCandidateBinding} from './harness-candidates.generated.js';
import {parseCodingRepairSession,parseCodingRepairCheckReadback} from './coding-repair.js';
import type {CodingRepairSession,CodingRepairCheckReadback,CodingRepairSnapshot,CodingRepairRecipe,CodingRepairPublishRequest} from './coding-repair.js';
export type {HarnessCandidateBinding} from './harness-candidates.generated.js';
const digest=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const harnessCandidateRecipeFingerprint=(recipes:readonly CodingRepairRecipe[]):string=>digest(recipes
  .map(r=>({recipeId:r.recipeId,packageIds:[...r.packageIds].sort(),required:r.required})).sort((a,b)=>a.recipeId.localeCompare(b.recipeId)));
/** Exact existing F15 metadata fingerprint. Snapshot ID/content text are not artifact bytes. */
export function harnessCandidateArtifactDigest(snapshot:CodingRepairSnapshot):string {
  return digest({files:snapshot.files.map(f=>({path:f.path,sha256:f.sha256,packageId:f.packageId,kind:f.kind})).sort((a,b)=>a.path.localeCompare(b.path)),
    packages:snapshot.packages.map(p=>({id:p.id,path:p.path,dependencies:[...p.dependencies].sort()})).sort((a,b)=>a.id.localeCompare(b.id))});
}

/** The only cross-package trial envelope; existing F15 receipts keep their meanings. */
export interface HarnessCandidateTrial {
  binding:HarnessCandidateBinding;
  session:CodingRepairSession;
  checkReadback:CodingRepairCheckReadback;
}
export interface HarnessCandidateContext {
  binding:Pick<HarnessCandidateBinding,'version'|'taskId'|'workspaceId'|'baselineSnapshotId'|'inputDigest'|'configurationDigest'
    |'workflowVersion'|'runtimeVersion'|'recipeFingerprint'|'executionKind'>;
  baseline:CodingRepairSnapshot;
  recipes:CodingRepairRecipe[];
  /** A trusted user/experiment criterion, never model-supplied. Cost is not semantic quality. */
  selectionPolicy:'unique_verified'|'fewest_changed_files';
}
export interface HarnessCandidateComparison {
  version:1;state:'selected'|'abstained';reason:string;
  candidates:{candidateId:string;artifactId:string;status:'verified'|'failed'|'unknown';changedFiles:number}[];
  recommendation?:{candidateId:string;artifactId:string;artifactDigest:string;trialRunId?:string;publishRequest:CodingRepairPublishRequest};
  verification:'unverified';
}
export function parseHarnessCandidateBinding(value:unknown):HarnessCandidateBinding {
  validateToolValue(schema,value);return structuredClone(value) as HarnessCandidateBinding;
}
export function parseHarnessCandidateTrial(value:unknown):HarnessCandidateTrial {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new ProtocolError('INVALID_ARGUMENT','Invalid harness trial');
  const v=value as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!=='binding,checkReadback,session')throw new ProtocolError('INVALID_ARGUMENT','Invalid harness trial fields');
  return {binding:parseHarnessCandidateBinding(v.binding),session:parseCodingRepairSession(v.session),checkReadback:parseCodingRepairCheckReadback(v.checkReadback)};
}
