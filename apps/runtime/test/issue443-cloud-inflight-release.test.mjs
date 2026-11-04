import {syntheticAgentArtsOptions,syntheticAgentArtsQuery,syntheticAgentArtsResult} from '../../../tests/helpers/synthetic-agentarts.mjs';
const createSyntheticAgentArtsRuntimeApplication=options=>createAgentArtsRuntimeApplication(syntheticAgentArtsOptions(options));
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication,createDesktopSubagentDispatchTool} from '../dist/application.js';
import {projectSubagentResult} from '../../desktop/electron/subagent-result-projection.js';
import {SyntheticWebSocket,identity} from '../../../packages/coordination/test/fixtures/websocket.mjs';

/**
 * Fixture replicating GitHub issue #443:
 * A research subagent dispatches, performs a local search tool (e.g. research.search),
 * retains the confirmed tool receipt, and encounters wss_terminal_error during cloud continuation.
 */
async function issue443Fixture({
  childFailureMode = 'terminal', // 'terminal' | 'unknown' | 'none'
  legacyHold = false,
  parentContinuationSucceeds = false,
  path = ':memory:',
} = {}) {
  let app, clock = Date.now(), calls = 0;
  const dispatch = createDesktopSubagentDispatchTool({
    competitionOnly: true,
    getRuntime: () => app.runtime,
    getTools: () => app.tools,
    runDefaultWorker: (subtask, worker, tools) => app.runDefaultSubagentWorker(subtask, worker, tools),
  });

  const searchTool = {
    name: 'research.search',
    version: '1.0.0',
    sideEffect: 'read',
    requiredScopes: ['read'],
    requiresPresence: false,
    idempotencySupport: true,
    recoverySupport: true,
    inputSchema: {type: 'object', properties: {query: {type: 'string'}}, additionalProperties: false},
    outputSchema: {type: 'object', properties: {hits: {type: 'number'}}, additionalProperties: false},
  };

  const binding = {
    toolName: dispatch.descriptor.name,
    toolVersion: dispatch.descriptor.version,
    exportPolicyVersion: 'original-v1',
    accepts: () => true,
    project: async input => projectSubagentResult(input),
  };

  const response = query => {
    calls++;
    if (query.continuation) {
      if (query.continuation.proposalId === 'child-research-search') {
        // Child continuation
        if (childFailureMode === 'terminal' || childFailureMode === 'unknown') {
          throw Error('Synthetic cloud continuation failure');
        }
        return {kind: 'text', text: 'Cloud continuation answer after research search'};
      }
      // Parent continuation
      if (parentContinuationSucceeds) {
        return {kind: 'text', text: 'Parent completed after observing child result'};
      }
      if (childFailureMode === 'terminal' || childFailureMode === 'unknown') {
        throw Error('Synthetic cloud continuation failure');
      }
      return {kind: 'text', text: 'Cloud continuation answer after research search'};
    }
    if (query.goal?.includes('research literature')) {
      return {
        kind: 'tool_proposal',
        proposalId: 'child-research-search',
        toolName: searchTool.name,
        toolVersion: searchTool.version,
        arguments: {query: 'AgentArts paper'},
      };
    }
    return {
      kind: 'tool_proposal',
      proposalId: 'parent-dispatch-proposal',
      toolName: dispatch.descriptor.name,
      toolVersion: dispatch.descriptor.version,
      arguments: {
        subtasks: [{subtaskId: 'research-child-1', role: 'researcher', goal: 'research literature'}],
      },
    };
  };

  const options = {
    path,
    now: () => new Date(clock),
    gatewayUrl: 'https://agentarts.example.test',
    runtimeName: 'termination',
    transport: 'wss',
    websocketUrl: 'wss://agentarts.example.test/runtimes/termination/ws',
    websocketAuthorizationProvider: {read: async () => 'Bearer synthetic-token'},
    websocketFactory: () => new SyntheticWebSocket((frame, socket) => {
      if (frame.type !== 'invoke') return;
      socket.accepted(frame);
      try {
        const query = JSON.parse(syntheticAgentArtsQuery(frame.payload));
        const res = response(query);
        socket.result(frame, syntheticAgentArtsResult(frame.payload, res));
      } catch (err) {
        if (childFailureMode === 'unknown') {
          socket.disconnect();
        } else {
          socket.receive({...identity(frame), type: 'error', accepted: true, code: 'EXTERNAL_FAILURE'});
        }
      }
    }),
    responseMode: 'tool-proposal-json',
    initialRequestMode: 'goal-with-tools-json',
    authorizationProvider: {read: async () => 'Bearer synthetic'},
    tools: [
      dispatch,
      {descriptor: searchTool, execute: async () => ({hits: 42})},
    ],
    automaticTools: [
      {toolName: dispatch.descriptor.name, toolVersion: dispatch.descriptor.version},
      {toolName: searchTool.name, toolVersion: searchTool.version},
    ],
    competitionToolExports: [
      binding,
      {toolName: searchTool.name, toolVersion: searchTool.version, exportPolicyVersion: 'search-v1', accepts: () => true, project: ({result}) => result},
    ],
    competitionToolAvailability: [
      {toolName: dispatch.descriptor.name, toolVersion: dispatch.descriptor.version, available: ({taskId}) => !app.runtime.getTask(taskId).conversationId.startsWith('desktop-subtask:')},
      {toolName: searchTool.name, toolVersion: searchTool.version, available: () => true},
    ],
    fetchImpl: async () => {
      throw Error('Unexpected HTTP fallback when WSS is configured');
    },
  };

  const create = () => {
    app = createSyntheticAgentArtsRuntimeApplication(options);
    if (legacyHold) {
      // Simulate historical pre-#448 behavior where holdCompetitionExport had no error parameter
      const originalHold = app.holdCompetitionExport.bind(app);
      app.holdCompetitionExport = id => originalHold(id);
    }
    return app;
  };

  create();
  const client = new Client(app, Date.now);
  await client.connect();
  const {taskId} = await client.call(
    'task.submit',
    {goal: 'Research literature on AgentArts', conversationId: 'desktop-panel'},
    {idempotencyKey: 'issue-443-submit', timeoutMs: 60000},
  );

  for (let i = 0; i < 200 && app.activeTaskCount; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  const children = app.readSubagentTasks(taskId);
  const child = children[0];
  const runId = `competition-tool-${taskId}-1`;

  return {
    get app() { return app; },
    taskId,
    child,
    runId,
    calls: () => calls,
    expire: () => { clock += 120000; },
    reopen: () => { app.close(); return create(); },
  };
}

test('issue #443 reproduction: subagent retaining local research receipt releases competition-cloud-inflight upon WSS terminal error without locking reconciliation', async () => {
  const f = await issue443Fixture({childFailureMode: 'terminal', legacyHold: false});
  try {
    const childTask = f.app.runtime.getTask(f.child.taskId);
    // 1. Subtask enters durable failed state rather than remaining trapped in waiting_reconciliation
    assert.equal(childTask.state, 'failed', 'Child task should transition to failed rather than waiting_reconciliation');

    // 2. Local confirmed research.search tool record and cached result are preserved intact
    const executions = f.app.runtime.readToolExecutions(f.child.taskId);
    assert.equal(executions.length, 1);
    assert.equal(executions[0].toolName, 'research.search');
    assert.equal(executions[0].state, 'confirmed');
    const cachedResult = f.app.runtime.loadCheckpoint(f.child.taskId, 'tool-result-' + executions[0].evidenceId);
    assert.deepEqual(cachedResult, {result: {hits: 42}});

    // 3. competition-cloud-inflight and competition-cloud-received are released to null
    assert.equal(
      f.app.runtime.loadCheckpoint(f.child.taskId, 'competition-cloud-inflight'),
      null,
      'competition-cloud-inflight must be released to null',
    );
    assert.equal(
      f.app.runtime.loadCheckpoint(f.child.taskId, 'competition-cloud-received'),
      null,
      'competition-cloud-received must be cleared to null',
    );

    // 4. competition-cloud-received-failure is persisted with transport_terminal_error classification
    const receivedFailure = f.app.runtime.loadCheckpoint(f.child.taskId, 'competition-cloud-received-failure');
    assert.ok(receivedFailure, 'competition-cloud-received-failure checkpoint should exist');
    assert.equal(receivedFailure.classification, 'transport_terminal_error');
    assert.equal(receivedFailure.cloudResent, false);
    assert.equal(receivedFailure.cloudBusinessSuccess, false);

    // 5. Check parent task state
    const parentTask = f.app.runtime.getTask(f.taskId);
    assert.equal(parentTask.state, 'failed', 'Parent task automatically resumes and reaches terminal failure upon cloud error');
    assert.equal(
      f.app.runtime.loadCheckpoint(f.taskId, 'competition-cloud-inflight'),
      null,
      'Parent task competition-cloud-inflight is also released',
    );

    // 6. Verified exact cloud interaction rounds without blind resend/replay:
    // Round 1: Parent task initial request -> proposes subagent dispatch
    // Round 2: Child task initial request -> proposes research.search
    // Round 3: Child task continuation -> encounters WSS terminal error (fails & releases inflight)
    // Round 4: Parent task automatically resumes with child failure summary -> encounters WSS terminal error
    assert.equal(f.calls(), 4);
  } finally {
    f.app.close();
  }
});

test('issue #443 historical snapshot reconciliation: legacy waiting_reconciliation child with held inflight releases inflight during parent reconciliation', async () => {
  // Simulate legacy snapshot where child was held in waiting_reconciliation with both inflight and received present
  const f = await issue443Fixture({childFailureMode: 'terminal', legacyHold: true});
  try {
    assert.equal(f.app.runtime.getTask(f.child.taskId).state, 'waiting_reconciliation');
    assert.ok(f.app.runtime.loadCheckpoint(f.child.taskId, 'competition-cloud-inflight'), 'Historical snapshot holds inflight');
    assert.ok(f.app.runtime.loadCheckpoint(f.child.taskId, 'competition-cloud-received'), 'Historical snapshot holds received');

    // Parent task is cancelled or expired
    f.expire();

    // Reconciling parent recognizes the matched terminal failure, consumes child failure, releases inflight, and finishes
    const parentReconciled = await f.app.reconcileConfirmedSubagentTermination(f.taskId);
    assert.equal(parentReconciled.state, 'failed');

    // Child task is now failed, and inflight is released to null
    assert.equal(f.app.runtime.getTask(f.child.taskId).state, 'failed');
    assert.equal(f.app.runtime.loadCheckpoint(f.child.taskId, 'competition-cloud-inflight'), null);
    assert.equal(f.app.runtime.loadCheckpoint(f.child.taskId, 'competition-cloud-received'), null);

    // Confirmed tool records were not destroyed or replayed
    const executions = f.app.runtime.readToolExecutions(f.child.taskId);
    assert.equal(executions.length, 1);
    assert.equal(executions[0].state, 'confirmed');
    assert.equal(f.calls(), 3);
  } finally {
    f.app.close();
  }
});

test('issue #443 historical snapshot direct child reconciliation: subtask can be reconciled directly and releases inflight', async () => {
  const f = await issue443Fixture({childFailureMode: 'terminal', legacyHold: true});
  try {
    const childId = f.child.taskId;
    assert.equal(f.app.runtime.getTask(childId).state, 'waiting_reconciliation');

    // User cancels or expires child directly
    f.app.runtime.requestCancel(childId);
    const childReconciled = await f.app.reconcileConfirmedSubagentTermination(childId);
    assert.equal(childReconciled.state, 'cancelled');

    // inflight is freed
    assert.equal(f.app.runtime.loadCheckpoint(childId, 'competition-cloud-inflight'), null);
    assert.equal(f.app.runtime.loadCheckpoint(childId, 'competition-cloud-received'), null);
  } finally {
    f.app.close();
  }
});

test('safety invariant: unknown cloud continuation result remains locked and does NOT release inflight', async () => {
  const f = await issue443Fixture({childFailureMode: 'unknown', legacyHold: false});
  try {
    const childId = f.child.taskId;
    const childTask = f.app.runtime.getTask(childId);

    // When cloud result is truly unknown, subagent must stay in waiting_reconciliation
    assert.equal(childTask.state, 'waiting_reconciliation');

    // competition-cloud-unknown is set
    assert.ok(f.app.runtime.loadCheckpoint(childId, 'competition-cloud-unknown'));

    // competition-cloud-inflight remains preserved for safe audit and MUST NOT be blindly released or replayed
    const inflight = f.app.runtime.loadCheckpoint(childId, 'competition-cloud-inflight');
    assert.ok(inflight, 'Unknown cloud invocation must retain inflight checkpoint');

    // Reconciling termination must strictly reject to protect against unknown side effects
    f.expire();
    await assert.rejects(
      f.app.reconcileConfirmedSubagentTermination(f.taskId),
      {code: 'RESULT_UNKNOWN'},
    );
  } finally {
    f.app.close();
  }
});

test('issue #443 SQLite reopen persistence: confirmed tool records and released inflight persist across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pa-issue443-'));
  const dbPath = join(dir, 'runtime.sqlite');
  try {
    const f = await issue443Fixture({childFailureMode: 'terminal', legacyHold: false, path: dbPath});
    assert.equal(f.app.runtime.loadCheckpoint(f.child.taskId, 'competition-cloud-inflight'), null);
    assert.equal(f.app.runtime.getTask(f.child.taskId).state, 'failed');

    // Reopen database from disk
    const reopenedApp = f.reopen();
    assert.equal(reopenedApp.runtime.loadCheckpoint(f.child.taskId, 'competition-cloud-inflight'), null);
    assert.equal(reopenedApp.runtime.getTask(f.child.taskId).state, 'failed');
    const records = reopenedApp.runtime.readToolExecutions(f.child.taskId);
    assert.equal(records.length, 1);
    assert.equal(records[0].state, 'confirmed');
    assert.equal(records[0].toolName, 'research.search');
    reopenedApp.close();
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('issue #443 parent recovery: parent task resumes normally after child terminal failure and completes without being locked', async () => {
  const f = await issue443Fixture({childFailureMode: 'terminal', parentContinuationSucceeds: true});
  try {
    // 1. Child task failed and released inflight
    assert.equal(f.app.runtime.getTask(f.child.taskId).state, 'failed');
    assert.equal(f.app.runtime.loadCheckpoint(f.child.taskId, 'competition-cloud-inflight'), null);

    // 2. Parent task observed child failure, continued loop, and succeeded
    const parentTask = f.app.runtime.getTask(f.taskId);
    assert.equal(parentTask.state, 'succeeded');
    assert.equal(f.app.runtime.loadCheckpoint(f.taskId, 'competition-cloud-inflight'), null);
    assert.match(parentTask.resultSummary, /Parent completed after observing child result/);
  } finally {
    f.app.close();
  }
});

