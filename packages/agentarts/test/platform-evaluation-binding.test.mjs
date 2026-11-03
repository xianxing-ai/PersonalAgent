import test from 'node:test';
import assert from 'node:assert/strict';
import {bindPlatformEvaluationToOutputs,recordCompetitionPublishChain} from '../dist/platform-evaluation-binding.js';

const deployment={runtimeId:'runtime-1',runtimeName:'pa-owned',endpointId:'endpoint-1',endpointName:'v1',version:'v1',imageDigest:'sha256:'+'a'.repeat(64)};
const output={id:'case-1',branch:'main',outputDigest:'b'.repeat(64)};
test('missing platform scores stay unavailable and a digest mismatch is rejected',()=>{
  const missing=bindPlatformEvaluationToOutputs({deployment,outputs:[output]});
  assert.equal(missing.state,'unavailable');assert.equal(missing.scores,null);assert.equal(missing.promotionReady,false);
  const mismatched=bindPlatformEvaluationToOutputs({deployment,outputs:[output],platform:{evaluationId:'eval-1',revision:'r1',deploymentVersion:'v1',items:[{...output,outputDigest:'c'.repeat(64),score:1}]}});
  assert.equal(mismatched.state,'rejected');assert.equal(mismatched.reason,'output_digest_mismatch');assert.equal(mismatched.scores,null);
  assert.equal(recordCompetitionPublishChain({deployment,evaluation:missing}).published,false);
  assert.equal(recordCompetitionPublishChain({deployment,evaluation:missing}).reason,'evaluation_not_bound');
});
test('bound scores still do not publish or change routing without the existing F23 CAS',()=>{
  const bound=bindPlatformEvaluationToOutputs({deployment,outputs:[output],platform:{evaluationId:'eval-1',revision:'r1',deploymentVersion:'v1',items:[{...output,score:0.5}]}});
  assert.equal(bound.state,'bound');assert.equal(bound.scores[0].score,0.5);assert.equal(bound.published,false);assert.equal(bound.localTaskCompleted,false);
  const waiting=recordCompetitionPublishChain({deployment,evaluation:bound});
  assert.equal(waiting.published,false);assert.equal(waiting.routingChanged,false);assert.equal(waiting.reason,'consumer_readback_required');
  const ready=recordCompetitionPublishChain({deployment,evaluation:bound,consumerReadback:{version:'v1',parametersDigest:'d'.repeat(64),revision:2}});
  assert.equal(ready.prerequisitesRecorded,true);assert.equal(ready.published,false);assert.equal(ready.promotionReady,false);
  assert.equal(ready.reason,'existing_f23_cas_required');assert.equal(ready.realEnvironmentAcceptance,'not_performed');
});
