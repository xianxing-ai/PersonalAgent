import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyF20HarnessCompletion,HARNESS_CANDIDATE_TRIAL_TOOL} from '../dist/application.js';
import {harnessCandidateArtifactDigest,harnessCandidateRecipeFingerprint} from '@personal-agent/contracts/harness-candidates';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const caseInput={schemaFile:'schema.json',codeFile:'api.ts',recipeId:'check-api',docTemplate:'t',targetDoc:'docs/api.md',sourceVersion:'fixture-v1'};
const schemaContent='{"schema":true}',codeContent='export const api=true;';
const sourceDigest=digest({sourceVersion:caseInput.sourceVersion,schemaFile:caseInput.schemaFile,codeFile:caseInput.codeFile,
  schemaSha256:createHash('sha256').update(schemaContent).digest('hex'),codeSha256:createHash('sha256').update(codeContent).digest('hex')});
const recipes=[{recipeId:caseInput.recipeId,packageIds:['app'],required:true}];
const baseline={snapshotId:'baseline',packages:[{id:'app',path:'',dependencies:[]}],files:[
  {path:caseInput.schemaFile,sha256:createHash('sha256').update(schemaContent).digest('hex'),packageId:'app',kind:'source'},
  {path:caseInput.codeFile,sha256:createHash('sha256').update(codeContent).digest('hex'),packageId:'app',kind:'source'}]};
const trial=()=>({binding:{version:1,candidateId:'candidate-1',artifactId:'artifact-1',taskId:'owner',trialTaskId:'owner',workspaceId:'workspace',
  sessionId:'session',baselineSnapshotId:'baseline',inputDigest:sourceDigest,configurationDigest:sourceDigest,workflowVersion:'F20-v1',
  runtimeVersion:'runtime',recipeFingerprint:harnessCandidateRecipeFingerprint(recipes),
  artifactDigest:harnessCandidateArtifactDigest(baseline),parentArtifactDigests:[],executionKind:'real_host'},
  session:{version:1,sessionId:'session',taskId:'owner',workspaceId:'workspace',mode:'isolated',baselineSnapshotId:'baseline'},
  checkReadback:{version:1,sessionId:'session',snapshot:structuredClone(baseline),verification:[{
    version:1,recipeId:caseInput.recipeId,status:'VALID',exitCode:0,sessionId:'session',inputSnapshotId:'baseline',runId:'trial-run',
    packageIds:['app'],files:baseline.files,evidenceRefs:['trial-run'],diagnostics:[]}]}});
function readback(taskId,path,content){
  return {commandId:'cmd',toolName:'workspace.read_text',toolVersion:'1.0.0',task:{taskId,state:'succeeded'},
    confirmed:{runId:'run-'+taskId,result:{path,content},evidenceRefs:['run-'+taskId]}};
}
function checkReadback(result,toolName=HARNESS_CANDIDATE_TRIAL_TOOL){
  return {commandId:'check',toolName,toolVersion:'1.0.0',task:{taskId:'check-task',state:'succeeded'},
    confirmed:{runId:'check-run',result,evidenceRefs:['check-run']}};
}
test('verifyF20HarnessCompletion rejects exit-code-only checks and missing trials',()=>{
  const read=readback('schema-task',caseInput.schemaFile,schemaContent);
  const sources=[read,readback('code-task',caseInput.codeFile,codeContent)];
  assert.throws(()=>verifyF20HarnessCompletion({input:caseInput,read,check:checkReadback({recipeId:caseInput.recipeId,exitCode:0,stdout:'',stderr:''},
    'workspace.run_allowed_command'),sourceReads:sources}),{code:'UNAUTHORIZED'});
  assert.throws(()=>verifyF20HarnessCompletion({input:caseInput,read,check:checkReadback(undefined),sourceReads:sources}),{code:'UNAUTHORIZED'});
});
test('verifyF20HarnessCompletion rejects digest drift and accepts bound trials',()=>{
  const read=readback('schema-task',caseInput.schemaFile,schemaContent);
  const sources=[read,readback('code-task',caseInput.codeFile,codeContent)];
  const bad=trial();bad.binding.inputDigest='a'.repeat(64);
  assert.throws(()=>verifyF20HarnessCompletion({input:caseInput,read,check:checkReadback(bad),sourceReads:sources}),{code:'UNAUTHORIZED'});
  const drift=trial();drift.checkReadback.snapshot.files[0].sha256='c'.repeat(64);
  assert.throws(()=>verifyF20HarnessCompletion({input:caseInput,read,check:checkReadback(drift),sourceReads:sources}),{code:'UNAUTHORIZED'});
  const verified=verifyF20HarnessCompletion({input:caseInput,read,check:checkReadback(trial()),sourceReads:sources});
  assert.deepEqual(verified,{additionalSourceTaskIds:['code-task']});
});
