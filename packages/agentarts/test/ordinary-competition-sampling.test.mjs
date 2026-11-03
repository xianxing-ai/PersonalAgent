import test from 'node:test';
import assert from 'node:assert/strict';
import {
  admitOrdinaryCompetitionSampling,
  ordinaryCompetitionSamplingKey,
} from '../dist/ordinary-competition-sampling.js';
import {
  summarizeOrdinaryCompetitionSampling,
  collectOrdinaryCompetitionSamplingRecords,
  isOrdinaryCompetitionSamplingRecord,
} from '../dist/ordinary-competition-sampling-summary.js';

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

test('summarizeOrdinaryCompetitionSampling aggregates actions and preserves unknown counterfactual ratio', () => {
  const rRun = admitOrdinaryCompetitionSampling({plan, policy: unknownPolicy, resources, main: quality('main')});
  const rDefer = admitOrdinaryCompetitionSampling({
    plan: {...plan, taskKey: 'task-2', decision: {...plan.decision, decisionRef: 'decision-2'}},
    policy: {...unknownPolicy, action: 'defer', reason: 'main_priority_busy', sampled: false},
    resources: {...resources, mainPriorityAvailable: false},
  });
  const rSkip = admitOrdinaryCompetitionSampling({
    plan: {...plan, taskKey: 'task-3', decision: {...plan.decision, decisionRef: 'decision-3'}},
    policy: {...unknownPolicy, action: 'skip', reason: 'task_value_ineligible', sampled: false},
    resources: {...resources, taskValueEligible: false},
  });
  const rTeacher = admitOrdinaryCompetitionSampling({
    plan: {...plan, taskKey: 'task-4', decision: {...plan.decision, decisionRef: 'decision-4', uncertain: true}},
    policy: {...unknownPolicy, action: 'need_teacher', reason: 'decision_uncertain', sampled: false},
    resources,
  });

  const summary = summarizeOrdinaryCompetitionSampling([rRun, rDefer, rSkip, rTeacher]);
  assert.equal(summary.totalOpportunities, 4);
  assert.equal(summary.rawRecordCount, 4);
  assert.equal(summary.duplicateRecordCount, 0);
  assert.deepEqual(summary.actions, {run: 1, defer: 1, skip: 1, need_teacher: 1});
  assert.equal(summary.sampledCount, 1);
  assert.deepEqual(summary.comparisons, {unknown: 4, comparable: 0});
  assert.equal(summary.unknownRatio, 1);
  assert.equal(summary.totalBenefit, null, 'missing counterfactual must yield null totalBenefit');
  assert.equal(summary.averageBenefit, null, 'missing counterfactual must yield null averageBenefit');
  assert.equal(summary.comparableCount, 0);
  assert.equal(summary.executedCount, 0);
  assert.equal(summary.executed, false);
  assert.equal(summary.actualExecutionVerified, false);
  assert.equal(summary.admissionIsNotExecution, true);
});

test('deduplication is idempotent across restarts and repeated readbacks', () => {
  const r1 = admitOrdinaryCompetitionSampling({plan, policy: unknownPolicy, resources, main: quality('main')});
  const r2 = structuredClone(r1); // Exactly identical from repeated scan
  const r3 = structuredClone(r1);

  const summary = summarizeOrdinaryCompetitionSampling([r1, r2, r3]);
  assert.equal(summary.totalOpportunities, 1, 'duplicate opportunities must be deduplicated to 1');
  assert.equal(summary.rawRecordCount, 3);
  assert.equal(summary.duplicateRecordCount, 2);
  assert.equal(summary.actions.run, 1, 'action count must not duplicate');
  assert.equal(summary.comparisons.unknown, 1);
});

test('special-serial-pair and compare modes are excluded from ordinary ledger and rejected', () => {
  assert.throws(() => admitOrdinaryCompetitionSampling({
    plan: {...plan, mode: 'compare'},
    policy: unknownPolicy,
    resources,
  }), {code: 'INVALID_ARGUMENT'});

  assert.throws(() => admitOrdinaryCompetitionSampling({
    plan: {...plan, taskClass: 'special-serial-pair'},
    policy: unknownPolicy,
    resources,
  }), {code: 'INVALID_ARGUMENT'});

  const forgedSpecial = {
    version: 1,
    kind: 'ordinary_competition_sampling',
    taskKey: 'task-fake',
    taskClass: 'special-serial-pair',
    decisionRef: 'decision-fake',
    action: 'run',
    executed: false,
    actualExecutionVerified: false,
    admissionIsNotExecution: true,
  };
  assert.throws(() => summarizeOrdinaryCompetitionSampling([forgedSpecial]), {code: 'INVALID_ARGUMENT'});
});

test('missing shadow and missing resources keep comparison unknown without inferred benefit', () => {
  const noShadow = admitOrdinaryCompetitionSampling({
    plan,
    policy: unknownPolicy,
    resources,
    main: quality('main'),
    shadow: null,
  });
  assert.equal(noShadow.comparison.status, 'unknown');
  assert.equal(noShadow.benefit, null);

  const summary = summarizeOrdinaryCompetitionSampling([noShadow]);
  assert.equal(summary.totalBenefit, null);
  assert.equal(summary.averageBenefit, null);
  assert.equal(summary.unknownRatio, 1);
});

test('summary accurately aggregates verified benefit only when comparable evidence exists', () => {
  const comparablePolicy1 = {
    ...unknownPolicy,
    action: 'skip',
    reason: 'verified_shadow_better',
    comparison: {status: 'comparable', qualityDelta: 1, wallMsDelta: -2, modelCallsDelta: 0, benefit: 1.2, recommendedBranch: 'shadow'},
  };
  const comparablePolicy2 = {
    ...unknownPolicy,
    action: 'skip',
    reason: 'verified_shadow_better',
    comparison: {status: 'comparable', qualityDelta: 0.5, wallMsDelta: 0, modelCallsDelta: 0, benefit: 0.8, recommendedBranch: 'shadow'},
  };

  const rec1 = admitOrdinaryCompetitionSampling({
    plan: {...plan, taskKey: 'task-1', decision: {...plan.decision, decisionRef: 'decision-1'}},
    policy: comparablePolicy1,
    resources,
    main: quality('main'),
    shadow: quality('shadow'),
  });
  const rec2 = admitOrdinaryCompetitionSampling({
    plan: {...plan, taskKey: 'task-2', decision: {...plan.decision, decisionRef: 'decision-2'}},
    policy: comparablePolicy2,
    resources,
    main: quality('main'),
    shadow: quality('shadow'),
  });
  const recUnknown = admitOrdinaryCompetitionSampling({
    plan: {...plan, taskKey: 'task-3', decision: {...plan.decision, decisionRef: 'decision-3'}},
    policy: unknownPolicy,
    resources,
    main: quality('main'),
  });

  const summary = summarizeOrdinaryCompetitionSampling([rec1, rec2, recUnknown]);
  assert.equal(summary.totalOpportunities, 3);
  assert.equal(summary.comparableCount, 2);
  assert.equal(summary.comparisons.comparable, 2);
  assert.equal(summary.comparisons.unknown, 1);
  assert.equal(summary.unknownRatio, 0.333333);
  assert.equal(summary.totalBenefit, 2.0);
  assert.equal(summary.averageBenefit, 1.0);
});

test('forged execution claims in records are strictly rejected by summary', () => {
  const forgedRun = {
    version: 1,
    kind: 'ordinary_competition_sampling',
    taskKey: 'task-evil',
    taskClass: 'coding',
    decisionRef: 'dec-evil',
    action: 'run',
    executed: true, // Forged claim
    actualExecutionVerified: true,
    admissionIsNotExecution: false,
  };
  assert.throws(() => summarizeOrdinaryCompetitionSampling([forgedRun]), {code: 'INVALID_ARGUMENT'});
});

test('collectOrdinaryCompetitionSamplingRecords safely retrieves records from checkpoint port', () => {
  const rec = admitOrdinaryCompetitionSampling({plan, policy: unknownPolicy, resources, main: quality('main')});
  const key = ordinaryCompetitionSamplingKey('decision-1', rec);
  const fakeCheckpoints = {
    store: new Map([
      [key, rec],
      ['other:random:key', {some: 'other-data'}],
    ]),
    read(taskId, k) {
      assert.equal(taskId, 'task-1');
      return this.store.get(k);
    },
  };

  const collected = collectOrdinaryCompetitionSamplingRecords(fakeCheckpoints, 'task-1', [key, 'other:random:key', 'not-exists']);
  assert.equal(collected.length, 1);
  assert.deepEqual(collected[0], rec);

  const summary = summarizeOrdinaryCompetitionSampling(collected);
  assert.equal(summary.totalOpportunities, 1);
  assert.equal(summary.actions.run, 1);
  assert.equal(summary.executedCount, 0);
  assert.equal(summary.totalBenefit, null);
});
