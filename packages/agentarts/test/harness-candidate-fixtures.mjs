import {createHash} from 'node:crypto';
import {harnessCandidateArtifactDigest,harnessCandidateRecipeFingerprint} from '@personal-agent/contracts/harness-candidates';
export const sha=value=>createHash('sha256').update(value).digest('hex');
export function context(taskId='synthetic-owner') {
  const recipes=[{recipeId:'unit',packageIds:['app'],required:true}];
  return {binding:{version:1,taskId,workspaceId:'synthetic-workspace',baselineSnapshotId:'baseline',inputDigest:sha('original input'),
    configurationDigest:sha('trusted recipe command/model/environment'),workflowVersion:'F15-v6',runtimeVersion:'source-9eb2fb08',
    recipeFingerprint:harnessCandidateRecipeFingerprint(recipes),executionKind:'synthetic'},
    baseline:{snapshotId:'baseline',packages:[{id:'app',path:'',dependencies:[]}],files:[
      {path:'src.js',sha256:sha('broken'),packageId:'app',kind:'source'},
      {path:'test.js',sha256:sha('unchanged test'),packageId:'app',kind:'test'}]},recipes,selectionPolicy:'unique_verified'};
}
export function trial(candidateId='one',c=context(),status='VALID',runId='trial-'+candidateId) {
  const snapshot=structuredClone(c.baseline);snapshot.snapshotId='snapshot-'+candidateId;snapshot.files[0].sha256=sha(candidateId);
  const sessionId='session-'+candidateId;
  return {binding:{...c.binding,candidateId,artifactId:'artifact-'+candidateId,trialTaskId:c.binding.taskId,sessionId,
    artifactDigest:harnessCandidateArtifactDigest(snapshot),parentArtifactDigests:[]},
    session:{version:1,sessionId,taskId:c.binding.taskId,workspaceId:c.binding.workspaceId,mode:'isolated',baselineSnapshotId:'baseline'},
    checkReadback:{version:1,sessionId,snapshot,verification:[{version:1,sessionId,runId:'verification-'+candidateId,recipeId:'unit',packageIds:['app'],
      inputSnapshotId:snapshot.snapshotId,files:structuredClone(snapshot.files),exitCode:status==='VALID'?0:status==='FAILED'?1:null,status,
      evidenceRefs:[runId],diagnostics:[]}]}};
}
