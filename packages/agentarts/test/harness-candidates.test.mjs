import assert from 'node:assert/strict';
import test from 'node:test';
import {compareHarnessCandidates} from '../dist/harness-candidates.js';
import {harnessCandidateArtifactDigest} from '@personal-agent/contracts/harness-candidates';
import {context,trial,sha} from './harness-candidate-fixtures.mjs';
test('only current verified artifact is recommended; no automatic main publication or quality claim',()=>{
  const c=context(),good=trial('one',c),bad=trial('two',c,'FAILED');
  const result=compareHarnessCandidates(c,[bad,good]);
  assert.equal(result.state,'selected');assert.equal(result.recommendation.artifactId,'artifact-one');
  assert.equal(result.candidates[0].status,'failed');assert.equal(result.verification,'unverified');
  assert.deepEqual(result.recommendation.publishRequest.paths,['src.js']);
  assert.equal(result.recommendation.publishRequest.sessionId,good.session.sessionId);
  assert.ok(!JSON.stringify(result).includes('unchanged test'));
});
test('ties, absent trials, missing verification and unknown results abstain',()=>{
  const c=context();assert.equal(compareHarnessCandidates(c,[]).state,'abstained');
  assert.equal(compareHarnessCandidates(c,[trial('one'),trial('two')]).reason,'ambiguous_verified_candidates');
  for(const status of ['FAILED','UNKNOWN','STALE'])assert.equal(compareHarnessCandidates(c,[trial('one',c,status)]).state,'abstained');
  const missing=trial();missing.checkReadback.verification=[];
  assert.equal(compareHarnessCandidates(c,[missing]).state,'abstained');
});
test('trusted change-count criterion is explicit and cannot break a tie by arbitrary input order',()=>{
  const c=context();c.selectionPolicy='fewest_changed_files';const a=trial('one',c),b=trial('two',c);
  b.checkReadback.snapshot.files.push({path:'extra.js',sha256:sha('extra'),packageId:'app',kind:'source'});
  b.checkReadback.verification[0].files=structuredClone(b.checkReadback.snapshot.files);
  b.binding.artifactDigest=harnessCandidateArtifactDigest(b.checkReadback.snapshot);
  assert.equal(compareHarnessCandidates(c,[b,a]).recommendation.candidateId,'one');
  assert.equal(compareHarnessCandidates(c,[a,trial('three',c)]).state,'abstained');
});
test('task/workspace/input/config/baseline/runtime/workflow/test recipe and surface mismatches reject',()=>{
  for(const field of ['taskId','workspaceId','inputDigest','configurationDigest','baselineSnapshotId','runtimeVersion','workflowVersion','recipeFingerprint','executionKind']) {
    const t=trial();t.binding[field]=['inputDigest','configurationDigest','recipeFingerprint'].includes(field)?'b'.repeat(64):field==='executionKind'?'real_host':'other';
    assert.throws(()=>compareHarnessCandidates(context(),[t]));
  }
});
test('artifact/source swaps, foreign/main sessions, changed tests/graph and plaintext content reject',()=>{
  const mutations=[t=>{t.binding.artifactDigest=sha('swapped');},t=>{t.session.taskId='foreign';},t=>{t.session.mode='main';},
    t=>{t.checkReadback.sessionId='foreign';},t=>{t.checkReadback.snapshot.files[1].sha256=sha('test disabled');},
    t=>{t.checkReadback.snapshot.packages[0].path='changed';},t=>{t.checkReadback.snapshot.files[0].content='private source';}];
  for(const change of mutations){const t=trial();change(t);
    if(t.binding.artifactDigest!==sha('swapped'))t.binding.artifactDigest=harnessCandidateArtifactDigest(t.checkReadback.snapshot);
    assert.throws(()=>compareHarnessCandidates(context(),[t]));}
});
test('stale snapshot/files and absent Evidence cannot make a valid candidate',()=>{
  for(const change of [t=>{t.checkReadback.verification[0].inputSnapshotId='old';},t=>{t.checkReadback.verification[0].files[0].sha256=sha('old');},
    t=>{t.checkReadback.verification[0].evidenceRefs=[];}]){
    const t=trial();change(t);assert.equal(compareHarnessCandidates(context(),[t]).candidates[0].status,'unknown');
  }
});
test('duplicate artifact/session/candidate or inherited verification run is rejected',()=>{
  for(const field of ['artifactId','sessionId','candidateId','runId']){
    const a=trial('one'),b=trial('two');
    if(field==='runId')b.checkReadback.verification[0].runId=a.checkReadback.verification[0].runId;
    else b.binding[field]=a.binding[field];
    assert.throws(()=>compareHarnessCandidates(context(),[a,b]));
  }
});
test('combination requires independent fresh verification and observed parents; parent success is never inherited',()=>{
  const a=trial('one'),b=trial('two'),combined=trial('combined',context(),'FAILED');
  combined.binding.parentArtifactDigests=[a.binding.artifactDigest,b.binding.artifactDigest];
  assert.equal(compareHarnessCandidates(context(),[a,b,combined]).candidates[2].status,'failed');
  combined.checkReadback.verification=[];
  assert.equal(compareHarnessCandidates(context(),[a,b,combined]).candidates[2].status,'unknown');
  assert.throws(()=>compareHarnessCandidates(context(),[a,combined]));
  combined.checkReadback.verification=structuredClone(a.checkReadback.verification);
  assert.throws(()=>compareHarnessCandidates(context(),[a,b,combined]));
  const fresh=trial('combined');fresh.binding.parentArtifactDigests=[a.binding.artifactDigest,b.binding.artifactDigest];
  assert.equal(compareHarnessCandidates(context(),[a,b,fresh]).candidates[2].status,'verified');
});
test('cyclic combination provenance rejects rather than manufacturing ancestral validation',()=>{
  const a=trial('one'),b=trial('two'),c=trial('three');
  a.binding.parentArtifactDigests=[b.binding.artifactDigest,c.binding.artifactDigest];
  b.binding.parentArtifactDigests=[a.binding.artifactDigest,c.binding.artifactDigest];
  assert.throws(()=>compareHarnessCandidates(context(),[a,b,c]),{code:'REVISION_CONFLICT'});
});
