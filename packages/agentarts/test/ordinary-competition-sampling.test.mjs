import test from 'node:test';
import assert from 'node:assert/strict';
import {admitOrdinaryCompetitionSampling} from '../dist/ordinary-competition-sampling.js';

const resources={mainPriorityAvailable:true,shadowAllowed:true,taskValueEligible:true};
const plan={taskKey:'task-1',taskClass:'public-research',mode:'ordinary',decision:{selectedCandidateId:'main',shadowCandidateId:'shadow',shadowRequested:true,uncertain:false,decisionRef:'decision-1'}};
const unknownPolicy={action:'run',reason:'sampled_shadow_with_main_priority',mayDeliverMain:true,sampled:true,samplingRate:0.4,historySamples:0,
  comparison:{status:'unknown',reason:'missing_counterfactual'},provenance:'experience_statistics_not_training'};
const quality=(branch)=>({baselineSha256:'a'.repeat(64),qualityMetricId:'fixture-quality',qualityScore:branch==='shadow'?2:1,wallMs:10,modelCalls:1,evidenceRefs:[branch+'-evidence']});
test('an ordinary run admission records unknown benefit and is not execution',()=>{
  const record=admitOrdinaryCompetitionSampling({plan,policy:unknownPolicy,resources,isolation:{namespace:'iso',snapshotDigest:'b'.repeat(64)},main:quality('main')});
  assert.equal(record.executed,false);assert.equal(record.actualExecutionVerified,false);assert.equal(record.admissionIsNotExecution,true);
  assert.equal(record.action,'run');assert.equal(record.comparison.status,'unknown');assert.equal(record.benefit,null);
  assert.equal(record.baselineSha256,'a'.repeat(64));assert.equal(record.shadowQuality,null);
  assert.equal(record.realEnvironmentAcceptance,'not_performed');assert.equal(record.provenance,'experience_statistics_not_training');
});
test('same-baseline qualities keep the host benefit; a special serial pair is rejected',()=>{
  const comparable={...unknownPolicy,action:'skip',reason:'both_verified_no_rerun_needed',comparison:{status:'comparable',qualityDelta:1,wallMsDelta:0,modelCallsDelta:0,benefit:1,recommendedBranch:'shadow'}};
  const record=admitOrdinaryCompetitionSampling({plan,policy:comparable,resources,main:quality('main'),shadow:quality('shadow')});
  assert.equal(record.benefit,1);assert.equal(record.executed,false);assert.equal(record.comparison.status,'comparable');
  assert.throws(()=>admitOrdinaryCompetitionSampling({plan:{...plan,mode:'compare'},policy:unknownPolicy,resources,specialSerialPair:true}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>admitOrdinaryCompetitionSampling({plan,policy:{...unknownPolicy,comparison:{status:'comparable',benefit:1}},resources}),{code:'INVALID_ARGUMENT'});
});
