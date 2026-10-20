import assert from 'node:assert/strict';
import test from 'node:test';
import {parseHarnessCandidateTrial,harnessCandidateRecipeFingerprint,harnessCandidateArtifactDigest} from '../dist/harness-candidates.js';
const recipes=[{recipeId:'unit',packageIds:['app'],required:true}];
const baseline={snapshotId:'baseline',packages:[{id:'app',path:'',dependencies:[]}],files:[
  {path:'src.js',sha256:'a'.repeat(64),packageId:'app',kind:'source'},
  {path:'test.js',sha256:'b'.repeat(64),packageId:'app',kind:'test'}]};
const context=()=>({baseline:structuredClone(baseline),recipes, binding:{recipeFingerprint:harnessCandidateRecipeFingerprint(recipes)}});
const trial=()=>({binding:{version:1,candidateId:'one',artifactId:'artifact-one',taskId:'owner',trialTaskId:'owner',workspaceId:'workspace',sessionId:'session',
  baselineSnapshotId:'baseline',inputDigest:'a'.repeat(64),configurationDigest:'b'.repeat(64),workflowVersion:'F15-v6',runtimeVersion:'runtime',
  recipeFingerprint:harnessCandidateRecipeFingerprint(recipes),artifactDigest:harnessCandidateArtifactDigest(baseline),parentArtifactDigests:[],executionKind:'synthetic'},
  session:{version:1,sessionId:'session',taskId:'owner',workspaceId:'workspace',mode:'isolated',baselineSnapshotId:'baseline'},
  checkReadback:{version:1,sessionId:'session',snapshot:structuredClone(baseline),verification:[]}});
test('unique provisional contract rejects extra fields, missing executor and malformed digest',()=>{
  assert.deepEqual(parseHarnessCandidateTrial(trial()),trial());
  for(const change of [t=>{delete t.binding.trialTaskId;},t=>{t.binding.artifactDigest='not-a-digest';},
    t=>{t.binding.grant=true;},t=>{t.extra={};}]){
    const t=trial();change(t);assert.throws(()=>parseHarnessCandidateTrial(t),{code:'INVALID_ARGUMENT'});
  }
});
test('shared artifact fingerprint preserves existing F15 ordering and test/recipe identities',()=>{
  const c=context(),reversed=structuredClone(c.baseline);reversed.files.reverse();
  assert.equal(harnessCandidateArtifactDigest(c.baseline),harnessCandidateArtifactDigest(reversed));
  reversed.files[0].sha256='b'.repeat(64);assert.notEqual(harnessCandidateArtifactDigest(c.baseline),harnessCandidateArtifactDigest(reversed));
  assert.equal(harnessCandidateRecipeFingerprint(c.recipes),c.binding.recipeFingerprint);
  assert.notEqual(harnessCandidateRecipeFingerprint([{...c.recipes[0],required:false}]),c.binding.recipeFingerprint);
});
