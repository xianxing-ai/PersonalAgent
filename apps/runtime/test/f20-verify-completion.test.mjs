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
const candidate={version:1,docMarkdown:'# API',sampleSnippet:'export const example = true;'};
const samplePath='examples/api.ts';
const checked={...structuredClone(baseline),snapshotId:'checked',files:[...structuredClone(baseline.files),
  {path:samplePath,sha256:createHash('sha256').update(candidate.sampleSnippet).digest('hex'),packageId:'app',kind:'source'}]};
const trial=()=>({binding:{version:1,candidateId:'candidate-1',artifactId:'artifact-1',taskId:'owner',trialTaskId:'check-task',workspaceId:'workspace',
  sessionId:'session',baselineSnapshotId:'baseline',inputDigest:sourceDigest,configurationDigest:sourceDigest,workflowVersion:'F20-v1',
  runtimeVersion:'runtime',recipeFingerprint:harnessCandidateRecipeFingerprint(recipes),
  artifactDigest:harnessCandidateArtifactDigest(checked),parentArtifactDigests:[],executionKind:'real_host'},
  session:{version:1,sessionId:'session',taskId:'check-task',workspaceId:'workspace',mode:'isolated',baselineSnapshotId:'baseline'},
  checkReadback:{version:1,sessionId:'session',snapshot:structuredClone(checked),verification:[{
    version:1,recipeId:caseInput.recipeId,status:'VALID',exitCode:0,sessionId:'session',inputSnapshotId:'checked',runId:'trial-run',
    packageIds:['app'],files:checked.files,evidenceRefs:['check-run'],diagnostics:[]}]}});
const expected=()=>({candidateId:'candidate-1',candidate:structuredClone(candidate),samplePath,context:{
  binding:{version:1,taskId:'owner',workspaceId:'workspace',baselineSnapshotId:'baseline',inputDigest:sourceDigest,
    configurationDigest:sourceDigest,workflowVersion:'F20-v1',runtimeVersion:'runtime',executionKind:'real_host',
    recipeFingerprint:harnessCandidateRecipeFingerprint(recipes)},baseline:structuredClone(baseline),recipes:structuredClone(recipes),selectionPolicy:'unique_verified'}});
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
    'workspace.run_allowed_command'),sourceReads:sources,expected:expected()}),{code:'UNAUTHORIZED'});
  assert.throws(()=>verifyF20HarnessCompletion({input:caseInput,read,check:checkReadback(undefined),sourceReads:sources,expected:expected()}),{code:'UNAUTHORIZED'});
});
test('verifyF20HarnessCompletion rejects digest drift and accepts bound trials',()=>{
  const read=readback('schema-task',caseInput.schemaFile,schemaContent);
  const sources=[read,readback('code-task',caseInput.codeFile,codeContent)];
  const bad=trial();bad.binding.inputDigest='a'.repeat(64);
  assert.throws(()=>verifyF20HarnessCompletion({input:caseInput,read,check:checkReadback(bad),sourceReads:sources,expected:expected()}),{code:'UNAUTHORIZED'});
  const drift=trial();drift.checkReadback.snapshot.files[0].sha256='c'.repeat(64);
  assert.throws(()=>verifyF20HarnessCompletion({input:caseInput,read,check:checkReadback(drift),sourceReads:sources,expected:expected()}),{code:'UNAUTHORIZED'});
  const verified=verifyF20HarnessCompletion({input:caseInput,read,check:checkReadback(trial()),sourceReads:sources,expected:expected()});
  assert.deepEqual(verified,{additionalSourceTaskIds:['code-task']});
  const sourceText=expected();sourceText.context.baseline.files[0].content=schemaContent;
  assert.deepEqual(verifyF20HarnessCompletion({input:caseInput,read,check:checkReadback(trial()),sourceReads:sources,expected:sourceText}),verified);
});

test('F20 refuses foreign trials, substituted candidates and unbound verification receipts',()=>{
  const read=readback('schema-task',caseInput.schemaFile,schemaContent),sources=[read,readback('code-task',caseInput.codeFile,codeContent)];
  const verify=(value,binding=expected())=>verifyF20HarnessCompletion({input:caseInput,read,check:checkReadback(value),sourceReads:sources,expected:binding});
  for(const mutate of [
    value=>{value.binding.trialTaskId='foreign';},value=>{value.session.taskId='foreign';},
    value=>{value.binding.taskId='foreign';},value=>{value.binding.candidateId='another';},
    value=>{value.checkReadback.snapshot.files=value.checkReadback.snapshot.files.filter(file=>file.path!==samplePath);
      value.binding.artifactDigest=harnessCandidateArtifactDigest(value.checkReadback.snapshot);},
    value=>{value.checkReadback.verification[0].evidenceRefs=['foreign-run'];},
    value=>{value.checkReadback.verification[0].files=baseline.files;},
    value=>{value.checkReadback.verification[0].files=structuredClone(checked.files);value.checkReadback.verification[0].files[0].sha256='f'.repeat(64);},
    value=>{value.checkReadback.verification=[];},
  ]) {const value=trial();mutate(value);assert.throws(()=>verify(value),{code:'UNAUTHORIZED'});}
  const replaced=expected();replaced.candidate.sampleSnippet='export const replaced = true;';
  assert.throws(()=>verify(trial(),replaced),{code:'UNAUTHORIZED'});
  const unsafe=expected();unsafe.samplePath='../outside.ts';
  assert.throws(()=>verify(trial(),unsafe),{code:'UNAUTHORIZED'});
  assert.throws(()=>verifyF20HarnessCompletion({input:caseInput,read,check:checkReadback(trial()),sourceReads:sources}),{code:'UNAUTHORIZED'});
  assert.throws(()=>verifyF20HarnessCompletion({input:caseInput,read,check:checkReadback(trial()),
    sourceReads:[...sources,readback('extra','private.txt','unrelated')],expected:expected()}),{code:'UNAUTHORIZED'});
});
