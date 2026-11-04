import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash, createHmac} from 'node:crypto';
import {
  createOwnedWorkflowReceiptVerifier,
  createWorkflowDecisionTool,
  summarizeOrdinaryCompetitionSampling,
  collectOrdinaryCompetitionSamplingRecords,
  admitOrdinaryCompetitionSampling,
  ordinaryCompetitionSamplingKey,
} from '@personal-agent/agentarts';
import {createRuntimeApplication} from '../dist/application.js';
import {runRuntimeOwnedWorkflowDriver} from '../dist/application/owned-workflow-driver.js';

const secret = 'synthetic-host-secret-at-least-32-characters-key';
const branchKey = 'explicit-fixture-branch-signature-key-32';
const branchSign = body => createHmac('sha256', branchKey).update(JSON.stringify(body)).digest('hex');
const verifyBranch = async receipt => {
  const {signature, ...context} = receipt.proof ?? {};
  return signature === branchSign({...receipt, proof: context});
};

test('owned workflow driver wiring invokes readReceiptWithShadow, checkpoints ordinary sampling into SQLite, and summarizes truthfully', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pa-sampling-integration-'));
  const dbPath = join(directory, 'runtime.sqlite');
  t.after(async () => {
    await rm(directory, {recursive: true, force: true});
  });

  const metadata = {
    shadowPlan: {
      taskClass: 'fixture-sampling',
      mode: 'ordinary',
      tier: 'isolated',
      shadowRequested: true,
      shadowCandidateId: 'candidate-b',
      uncertain: false,
      provenance: {
        decidedBy: 'deepseek',
        deepseekProposalRef: 'proposal-1',
        layaDecisionRef: 'laya-ref-1',
        layaQualified: false,
        uncertaintyResolved: true,
      },
    },
  };

  const decisionTool = createWorkflowDecisionTool({
    selector: {
      select: async () => ({selectedId: 'candidate-a', metadata}),
    },
  });

  const tools = [decisionTool];
  const catalog = [{
    name: decisionTool.descriptor.name,
    version: decisionTool.descriptor.version,
    inputSchema: decisionTool.descriptor.inputSchema,
  }];

  const shadowPolicyConfig = {
    sampling: {base: 1, min: 0, max: 1, adjustmentRate: 0.2, minimumVerifiedSamples: 1},
    comparison: {qualityWeight: 1, wallMsWeight: 0.1, modelCallWeight: 0.1},
  };

  const isolation = {namespace: 'iso', snapshotDigest: createHash('sha256').update('snapshot').digest('hex')};
  const shadowPolicy = {
    policyConfig: shadowPolicyConfig,
    verifyReceipt: verifyBranch,
    readSnapshot: () => ({
      advancedEnabled: true,
      comparisonRequested: false,
      resources: {mainPriorityAvailable: true, shadowAllowed: true, taskValueEligible: true},
      isolation,
      observedBranches: [],
    }),
  };

  let app = createRuntimeApplication({
    path: dbPath,
    profile: 'huawei_ict_agentarts',
    hostUserNamespace: 'sampling-user',
    tools,
    automaticTools: [{toolName: decisionTool.descriptor.name, toolVersion: decisionTool.descriptor.version}],
  });

  const deadline = new Date(Date.now() + 60000).toISOString();
  const task = app.runtime.submitTask({
    goal: 'Test ordinary sampling in SQLite TaskRuntime',
    conversationId: 'sampling-conv',
    idempotencyKey: 'task-root',
  });
  app.runtime.saveCheckpoint(task.taskId, 'application-deadline', deadline);

  const checkpointKey = 'test-driver-state';
  const operationId = 'decision-op-1';
  const candidates = [
    {id: 'candidate-a', description: 'Candidate A', metadata},
    {id: 'candidate-b', description: 'Candidate B'},
  ];

  const proposal = {
    kind: 'tool_proposal',
    nodeId: 'F20_N01',
    operationId,
    proposalId: operationId,
    inputDigest: createHash('sha256').update('context').digest('hex'),
    originControlRevision: 0,
    toolName: decisionTool.descriptor.name,
    toolVersion: decisionTool.descriptor.version,
    toolSchemaDigest: createHash('sha256').update(JSON.stringify(decisionTool.descriptor.inputSchema)).digest('hex'),
    arguments: {
      context: '{\"nodeId\":\"F20_N01\",\"mode\":\"main\"}',
      candidates,
      requestId: 'req-1',
    },
    resourceKeys: [],
    effect: 'read',
  };

  let advanced = false;
  const image = {
    bindingId: 'image-binding-1',
    advance: async () => {
      if (!advanced) {
        advanced = true;
        return {
          workflowId: 'F20',
          workflowVersion: '1.0.0',
          checkpoint: 'ckpt-1',
          state: 'awaiting_host',
          proposals: [proposal],
          nodes: {F20_N01: {state: 'waiting_receipt'}},
        };
      }
      return {
        workflowId: 'F20',
        workflowVersion: '1.0.0',
        checkpoint: 'ckpt-settled',
        state: 'settled',
        proposals: [],
        nodes: {F20_N01: {state: 'completed'}},
      };
    },
  };

  const state = {
    version: 1,
    sessionId: 'test-session',
    controlRevision: 0,
    bindingId: 'image-binding-1',
    sequence: 0,
    input: {goal: 'test'},
    receipts: [],
    resolvedValues: {},
    confirmedHost: {},
    evidenceRefs: [],
    timings: [],
  };
  app.runtime.saveCheckpoint(task.taskId, checkpointKey, state);

  // Run driver: driver will call submit and then timed host-readback which invokes readReceiptWithShadow
  await app.runtime.runTask(task.taskId, async worker => {
    const driverState = worker.loadCheckpoint(checkpointKey);
    const bridge = app.createOwnedWorkflowHost({
      receiptSecret: secret,
      parentTaskId: task.taskId,
      shadow: shadowPolicy,
      assertIsolation: (tId, iso) => {
        assert.equal(tId, task.taskId);
        assert.deepEqual(iso, isolation);
      },
      assertActive: (id, rev) => {
        assert.equal(id, task.taskId);
        assert.equal(rev, driverState.controlRevision);
      },
    });

    return runRuntimeOwnedWorkflowDriver(app, worker, driverState, {
      workflowId: 'F20',
      checkpointKey,
      mode: 'main',
      image,
      bridge,
      catalog,
      requestId: seq => 'req-' + seq,
      authorizeReceipt: async () => {},
      validateSettled: s => ({resultSummary: 'settled', evidenceRefs: s.evidenceRefs}),
    });
  }, {deadline, sideEffect: 'local_write'});

  // Read all sampling keys in SQLite checkpoints
  const rows = app.runtime.db.prepare(
    "SELECT checkpoint_key, value_json FROM task_checkpoints WHERE task_id = ? AND checkpoint_key LIKE 'owned-workflow:ordinary-sampling:%'"
  ).all(task.taskId);

  assert.equal(rows.length, 1, 'exactly one sampling record must be saved in checkpoint');
  const persistedRecord = JSON.parse(rows[0].value_json);

  assert.equal(persistedRecord.kind, 'ordinary_competition_sampling');
  assert.equal(persistedRecord.taskKey, task.taskId);
  assert.equal(persistedRecord.taskClass, 'fixture-sampling');
  assert.equal(persistedRecord.decisionRef, operationId);
  assert.equal(persistedRecord.action, 'run');
  assert.equal(persistedRecord.comparison.status, 'unknown');
  assert.equal(persistedRecord.benefit, null);
  assert.equal(persistedRecord.executed, false);
  assert.equal(persistedRecord.actualExecutionVerified, false);
  assert.equal(persistedRecord.admissionIsNotExecution, true);
  assert.equal(persistedRecord.provenance, 'experience_statistics_not_training');
  assert.equal(persistedRecord.realEnvironmentAcceptance, 'not_performed');

  // Verify that key equals ordinaryCompetitionSamplingKey
  assert.equal(rows[0].checkpoint_key, ordinaryCompetitionSamplingKey(operationId, persistedRecord));

  // Pure function summary verification
  const summary = summarizeOrdinaryCompetitionSampling([persistedRecord]);
  assert.equal(summary.totalOpportunities, 1);
  assert.equal(summary.rawRecordCount, 1);
  assert.equal(summary.duplicateRecordCount, 0);
  assert.deepEqual(summary.actions, {run: 1, defer: 0, skip: 0, need_teacher: 0});
  assert.equal(summary.sampledCount, 1);
  assert.deepEqual(summary.comparisons, {unknown: 1, comparable: 0});
  assert.equal(summary.unknownRatio, 1);
  assert.equal(summary.totalBenefit, null, 'unknown counterfactual yields null benefit');
  assert.equal(summary.averageBenefit, null);
  assert.equal(summary.comparableCount, 0);
  assert.equal(summary.executedCount, 0);
  assert.equal(summary.executed, false);

  // Restart runtime from SQLite file and check readback idempotency
  app.close();
  app = createRuntimeApplication({
    path: dbPath,
    profile: 'huawei_ict_agentarts',
    hostUserNamespace: 'sampling-user',
    tools,
  });

  const reloaded = app.runtime.loadCheckpoint(task.taskId, rows[0].checkpoint_key);
  assert.deepEqual(reloaded, persistedRecord);

  // Repeated readbacks from restart do not duplicate opportunities
  const restartedSummary = summarizeOrdinaryCompetitionSampling([reloaded, reloaded, structuredClone(reloaded)]);
  assert.equal(restartedSummary.totalOpportunities, 1);
  assert.equal(restartedSummary.rawRecordCount, 3);
  assert.equal(restartedSummary.duplicateRecordCount, 2);
  assert.equal(restartedSummary.actions.run, 1);

  // Collect via helper
  const collected = collectOrdinaryCompetitionSamplingRecords(
    {read: (tId, k) => app.runtime.loadCheckpoint(tId, k)},
    task.taskId,
    [rows[0].checkpoint_key, 'other-key']
  );
  assert.equal(collected.length, 1);
  assert.deepEqual(collected[0], persistedRecord);

  app.close();
});

test('compare mode does not write ordinary competition sampling ledger in SQLite', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pa-compare-mode-'));
  const dbPath = join(directory, 'runtime.sqlite');
  t.after(async () => {
    await rm(directory, {recursive: true, force: true});
  });

  const metadata = {
    shadowPlan: {
      taskClass: 'fixture-sampling',
      mode: 'compare',
      tier: 'isolated',
      shadowRequested: true,
      shadowCandidateId: 'candidate-b',
      uncertain: false,
      provenance: {
        decidedBy: 'deepseek',
        deepseekProposalRef: 'proposal-1',
        layaDecisionRef: 'laya-ref-1',
        layaQualified: false,
        uncertaintyResolved: true,
      },
    },
  };

  const decisionTool = createWorkflowDecisionTool({
    selector: {
      select: async () => ({selectedId: 'candidate-a', metadata}),
    },
  });

  const tools = [decisionTool];
  const catalog = [{
    name: decisionTool.descriptor.name,
    version: decisionTool.descriptor.version,
    inputSchema: decisionTool.descriptor.inputSchema,
  }];

  const isolation = {namespace: 'iso', snapshotDigest: createHash('sha256').update('snapshot').digest('hex')};
  const shadowPolicy = {
    policyConfig: {
      sampling: {base: 1, min: 0, max: 1, adjustmentRate: 0.2, minimumVerifiedSamples: 1},
      comparison: {qualityWeight: 1, wallMsWeight: 0.1, modelCallWeight: 0.1},
    },
    verifyReceipt: verifyBranch,
    readSnapshot: () => ({
      advancedEnabled: true,
      comparisonRequested: true,
      resources: {mainPriorityAvailable: true, shadowAllowed: true, taskValueEligible: true},
      isolation,
      observedBranches: [],
    }),
  };

  const app = createRuntimeApplication({
    path: dbPath,
    profile: 'huawei_ict_agentarts',
    hostUserNamespace: 'sampling-user',
    tools,
    automaticTools: [{toolName: decisionTool.descriptor.name, toolVersion: decisionTool.descriptor.version}],
  });

  const deadline = new Date(Date.now() + 60000).toISOString();
  const task = app.runtime.submitTask({
    goal: 'Test compare mode isolation from ordinary sampling',
    conversationId: 'compare-conv',
    idempotencyKey: 'task-compare',
  });
  app.runtime.saveCheckpoint(task.taskId, 'application-deadline', deadline);

  const checkpointKey = 'compare-driver-state';
  const operationId = 'compare-decision-op';
  const proposal = {
    kind: 'tool_proposal',
    nodeId: 'F20_N01',
    operationId,
    proposalId: operationId,
    inputDigest: createHash('sha256').update('context').digest('hex'),
    originControlRevision: 0,
    toolName: decisionTool.descriptor.name,
    toolVersion: decisionTool.descriptor.version,
    toolSchemaDigest: createHash('sha256').update(JSON.stringify(decisionTool.descriptor.inputSchema)).digest('hex'),
    arguments: {
      context: '{"nodeId":"F20_N01","mode":"compare"}',
      candidates: [
        {id: 'candidate-a', description: 'Candidate A', metadata},
        {id: 'candidate-b', description: 'Candidate B'},
      ],
      requestId: 'req-comp',
    },
    resourceKeys: [],
    effect: 'read',
  };

  let advanced = false;
  const image = {
    bindingId: 'image-compare',
    advance: async () => {
      if (!advanced) {
        advanced = true;
        return {
          workflowId: 'F20',
          workflowVersion: '1.0.0',
          checkpoint: 'ckpt-c1',
          state: 'awaiting_host',
          proposals: [proposal],
          nodes: {F20_N01: {state: 'waiting_receipt'}},
        };
      }
      return {
        workflowId: 'F20',
        workflowVersion: '1.0.0',
        checkpoint: 'ckpt-c2',
        state: 'settled',
        proposals: [],
        nodes: {F20_N01: {state: 'completed'}},
      };
    },
  };

  const state = {
    version: 1,
    sessionId: 'comp-session',
    controlRevision: 0,
    bindingId: 'image-compare',
    sequence: 0,
    input: {goal: 'test-compare'},
    receipts: [],
    resolvedValues: {},
    confirmedHost: {},
    evidenceRefs: [],
    timings: [],
  };
  app.runtime.saveCheckpoint(task.taskId, checkpointKey, state);

  await app.runtime.runTask(task.taskId, async worker => {
    const driverState = worker.loadCheckpoint(checkpointKey);
    const bridge = app.createOwnedWorkflowHost({
      receiptSecret: secret,
      parentTaskId: task.taskId,
      shadow: shadowPolicy,
      assertIsolation: (tId, iso) => {
        assert.equal(tId, task.taskId);
        assert.deepEqual(iso, isolation);
      },
      assertActive: (id, rev) => {
        assert.equal(id, task.taskId);
        assert.equal(rev, driverState.controlRevision);
      },
    });

    return runRuntimeOwnedWorkflowDriver(app, worker, driverState, {
      workflowId: 'F20',
      checkpointKey,
      mode: 'main',
      image,
      bridge,
      catalog,
      requestId: seq => 'comp-req-' + seq,
      authorizeReceipt: async () => {},
      validateSettled: s => ({resultSummary: 'settled', evidenceRefs: s.evidenceRefs}),
    });
  }, {deadline, sideEffect: 'local_write'});

  // Checkpoints must NOT contain ordinary sampling ledger records
  const rows = app.runtime.db.prepare(
    "SELECT checkpoint_key FROM task_checkpoints WHERE task_id = ? AND checkpoint_key LIKE 'owned-workflow:ordinary-sampling:%'"
  ).all(task.taskId);

  assert.equal(rows.length, 0, 'compare mode must not write into ordinary competition sampling ledger');
  app.close();
});
