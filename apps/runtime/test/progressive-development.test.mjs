import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {Client} from '@personal-agent/client';
import {parseAgentInput} from '@personal-agent/agentarts';
import {MAX_COORDINATION_INITIAL_QUERY_BYTES} from '@personal-agent/contracts';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createDesktopSubagentDispatchTool, createRuntimeApplication} from '../dist/application.js';
import {EXECUTION_CAPACITY_CHECKPOINT} from '../dist/application/execution-capacity.js';

const PRIVATE_BODY = 'LOCAL_PRIVATE_FIXTURE_SECRET_NEVER_SUMMARIZE';
const PUBLIC_BODY = 'ORIGINAL_PROJECTED_FIXTURE_BODY';
const terminal = task => ['succeeded', 'failed', 'cancelled', 'waiting_reconciliation'].includes(task.state);
const pause = () => new Promise(resolve => setTimeout(resolve, 5));

async function waitFor(app, taskId, predicate = terminal) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const current = app.runtime.getTask(taskId);
    if (predicate(current)) return current;
    await pause();
  }
  assert.fail(`Synthetic task did not settle: ${JSON.stringify(app.runtime.getTask(taskId))}`);
}

function actualQuery(request) {
  return JSON.stringify({goal: request.goal,
    ...(request.continuation ? {continuation: request.continuation} : {}),
    ...(request.availableTools === undefined ? request.continuation ? {} : {availableTools: []}
      : {availableTools: request.availableTools}),
    ...(request.priorContinuations?.length ? {priorContinuations: request.priorContinuations} : {}),
    ...(request.executionModel === undefined ? {} : {executionModel: request.executionModel})});
}

/** Real Runtime/Policy/Gateway/SQLite and local file I/O; only coordination is synthetic. */
async function fixture(t, {actions = 72, initialSteps = 4, windowSteps = 4, maxSteps,
  progressive = true, repeated = false, delegate = false, automatic = true, disk = false,
  projectedCharacters = 0, conversationContext, measureFinalGuard = false, dropRequestHistory = false} = {}) {
  const base = path.resolve(fileURLToPath(new URL('../../../.cache/progressive-development-tests/', import.meta.url)));
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(path.join(base, 'case-'));
  const files = path.join(directory, 'workspace');
  await mkdir(files);
  await writeFile(path.join(files, 'repeat.txt'), 'repeat fixture file', 'utf8');
  const storage = disk ? path.join(directory, 'runtime.sqlite') : ':memory:';
  let app, client, enabled = progressive;
  const calls = [], queries = [], guardMeasurements = [], perTaskRequests = new Map();
  const names = ['fixture.development.write', 'fixture.development.read', 'fixture.development.check'];
  const tools = names.map((name, operation) => ({descriptor: {
    name, version: '1.0.0',
    inputSchema: {type: 'object', properties: {path: {type: 'string', minLength: 1, maxLength: 80},
      sequence: {type: 'integer', minimum: 0}}, required: ['path', 'sequence'], additionalProperties: false},
    outputSchema: {type: 'object', properties: {sequence: {type: 'integer'}, value: {type: 'string'},
      localOnly: {type: 'string'}, stamp: {type: 'integer'}},
    required: ['sequence', 'value', 'localOnly', 'stamp'], additionalProperties: false},
    sideEffect: operation === 0 ? 'local_write' : 'read', requiredScopes: ['fixture:development'],
    requiresPresence: false, idempotencySupport: true, recoverySupport: true,
  }, execute: async (input, context) => {
    const file = path.resolve(files, input.path);
    assert.equal(path.dirname(file), files, 'Fixture only touches its own isolated workspace');
    const expected = repeated ? 'repeat fixture file' : `fixture file ${input.path}`;
    if (operation === 0) await writeFile(file, expected, 'utf8');
    const observed = await readFile(file, 'utf8');
    assert.equal(observed, expected, 'Write/read/test fixture checks actual file readback');
    calls.push({taskId: context.taskId, toolName: name, input: structuredClone(input)});
    return {sequence: input.sequence,
      value: `${PUBLIC_BODY}:${input.sequence}:${observed}` + 'x'.repeat(projectedCharacters),
      localOnly: PRIVATE_BODY, stamp: calls.length};
  }}));
  if (delegate) tools.unshift(createDesktopSubagentDispatchTool({competitionOnly: true,
    getRuntime: () => app.runtime, getTools: () => app.tools,
    runDefaultWorker: (definition, worker, selectedTools) => app.runDefaultSubagentWorker(definition, worker, selectedTools),
    onChildSettled: taskId => app.notifySubagentTaskSettled(taskId)}));
  const port = new FakeCoordinationPort(request => {
    const query = actualQuery(request);
    // Exercise the real image-side parser on every exact synthetic handoff.
    const parsed = parseAgentInput(query);
    const task = app.runtime.getTask(request.taskId);
    const ordinal = perTaskRequests.get(task.taskId) ?? 0;
    perTaskRequests.set(task.taskId, ordinal + 1);
    if (dropRequestHistory) port.requests.length = 0;
    queries.push({taskId: task.taskId, ordinal, bytes: Buffer.byteLength(query, 'utf8'),
      kind: parsed.kind, current: request.continuation?.proposalId,
      priorIds: (request.priorContinuations ?? []).map(item => item.proposalId),
      originalGoal: parsed.goal,
      capacity: structuredClone(app.runtime.loadCheckpoint(task.taskId, EXECUTION_CAPACITY_CHECKPOINT))});
    assert.ok(Buffer.byteLength(query, 'utf8') <= MAX_COORDINATION_INITIAL_QUERY_BYTES);
    assert.ok((request.priorContinuations?.length ?? 0) <= 32);
    assert.equal(new Set([...(request.priorContinuations ?? []), ...(request.continuation ? [request.continuation] : [])]
      .map(item => item.proposalId)).size, (request.priorContinuations?.length ?? 0) + (request.continuation ? 1 : 0));
    if (measureFinalGuard && ordinal === actions) {
      const originalParse = JSON.parse, originalClone = globalThis.structuredClone;
      const sample = {originalReceiptCount: actions, jsonParseCount: 0, jsonBytes: 0, cloneCount: 0};
      JSON.parse = function (raw, ...args) {
        if (typeof raw === 'string' && raw.includes('"receipts":[')) {
          sample.jsonParseCount++; sample.jsonBytes += Buffer.byteLength(raw);
        }
        return originalParse.call(this, raw, ...args);
      };
      globalThis.structuredClone = function (value, ...args) {
        if (Array.isArray(value?.receipts)) sample.cloneCount++;
        return originalClone(value, ...args);
      };
      const started = performance.now();
      try { app.assertCompetitionExportAllowed(request); }
      finally {
        sample.wallMs = performance.now() - started;
        JSON.parse = originalParse; globalThis.structuredClone = originalClone;
      }
      guardMeasurements.push(sample);
    }
    if (delegate && !task.conversationId.startsWith('desktop-subtask:')
      && !task.conversationId.startsWith('desktop-subagent-conversation:')) {
      assert.ok(request.continuation, 'The parent only summarizes its original confirmed dispatch');
      return {kind: 'text', text: 'Synthetic coordinator consumed the child completion', verification: 'unverified'};
    }
    const next = repeated ? ordinal : request.continuation ? request.continuation.result.sequence + 1 : 0;
    if (next >= actions) return {kind: 'text', text: 'Synthetic development completed with original local readback', verification: 'unverified'};
    const toolName = repeated ? names[1] : names[next % names.length];
    assert.ok(request.availableTools?.some(tool => tool.name === toolName), 'Every next action uses the current published directory');
    return {kind: 'tool_proposal', proposalId: `development-${task.taskId}-${next}`,
      toolName, toolVersion: '1.0.0',
      arguments: repeated ? {path: 'repeat.txt', sequence: 0}
        : {path: `file-${String(Math.floor(next / names.length)).padStart(3, '0')}.txt`, sequence: next},
      verification: 'unverified'};
  });
  const open = async () => {
    app = createRuntimeApplication({path: storage, profile: 'huawei_ict_agentarts', coordination: port,
      coordinationBinding: 'synthetic-progressive-development-v1', competitionMaxSteps: initialSteps,
      ...(enabled ? {competitionExecution: {mode: 'progressive', windowSteps,
        ...(maxSteps === undefined ? {} : {maxSteps})}} : {}),
      ...(delegate ? {delegateUserTasks: true} : {}),
      ...(conversationContext ? {coordinationInput: {beforeCoordinationSend() {},
        readConversationContext: async () => conversationContext}} : {}),
      readConversationPreference: () => ({depth: 0, fast: true}), retainPriorToolResults: true, tools,
      automaticTools: automatic ? tools.map(tool => ({toolName: tool.descriptor.name, toolVersion: tool.descriptor.version})) : [],
      competitionToolAvailability: tools.map(tool => ({toolName: tool.descriptor.name, toolVersion: tool.descriptor.version,
        publicEnumPaths: ['/subtasks/*/role'], available: () => true})),
      competitionToolExports: tools.map(tool => ({toolName: tool.descriptor.name, toolVersion: tool.descriptor.version,
        exportPolicyVersion: 'synthetic-development-public-v1', accepts: () => true,
        project: ({result}) => tool.descriptor.name === 'subagent.dispatch' ? result
          : {sequence: result.sequence, value: result.value, stamp: result.stamp}})),
    });
    client = new Client(app); await client.connect();
  };
  await open();
  t.after(async () => {app.close(); assert.ok(directory.startsWith(base + path.sep));
    await rm(directory, {recursive: true, force: true});});
  return {get app() {return app;}, get client() {return client;}, calls, queries, guardMeasurements, files,
    submit: (key = 'development') => client.call('task.submit',
      {goal: 'Complete the explicitly synthetic multi-file development project', conversationId: `progressive-${key}`},
      {idempotencyKey: key, timeoutMs: 60_000}),
    reopen: async (enable = enabled) => {assert.equal(disk, true); app.close(); enabled = enable; await open();},
  };
}

function assertOriginalReceipts(app, taskId, count) {
  const loop = app.runtime.loadCheckpoint(taskId, 'competition-loop');
  const records = app.runtime.readToolExecutions(taskId);
  const evidence = app.runtime.readEvidence(taskId);
  assert.equal(loop.receipts.length, count, 'Original projections remain complete in SQLite');
  assert.equal(records.length, count, 'Every action has an original Runtime execution record');
  assert.equal(evidence.length, count, 'Every execution keeps its Evidence');
  assert.equal(new Set(records.map(record => record.evidenceId)).size, count);
  assert.equal(new Set(evidence.map(item => item.evidenceId)).size, count);
  for (const receipt of loop.receipts) {
    const record = records.find(value => value.evidenceId === receipt.runId);
    assert.ok(record, 'A cloud projection cannot stand in for an execution record');
    assert.equal(record.state, 'confirmed');
    assert.equal(record.policyDecision, 'allow');
    assert.equal(record.executionStarted, true);
    assert.equal(record.toolName, receipt.proposal.toolName);
    assert.equal(app.runtime.matchesToolExecutionInput(record,
      {arguments: receipt.proposal.arguments, scopeRef: receipt.runId}), true);
    const cache = app.runtime.loadCheckpoint(taskId, 'tool-result-' + receipt.runId);
    assert.equal(cache.result.localOnly, PRIVATE_BODY, 'Original raw tool result remains local');
    assert.equal(receipt.continuation.result.sequence, receipt.proposal.arguments.sequence);
    assert.equal(Object.hasOwn(receipt.continuation.result, 'localOnly'), false);
    assert.ok(evidence.some(item => item.evidenceId === receipt.runId));
  }
  const summary = app.runtime.loadCheckpoint(taskId, 'competition-continuation-window:v1').omitted;
  const encoded = JSON.stringify(summary);
  assert.doesNotMatch(encoded, /LOCAL_PRIVATE_FIXTURE_SECRET|ORIGINAL_PROJECTED_FIXTURE_BODY|file-\d|arguments|sequence|stamp/);
  assert.ok(summary.tools.length <= 32);
  return {loop, records, evidence};
}

test('72 actual fixture file write/read/check actions cross old depth and 32-prior boundaries without losing originals', async t => {
  const f = await fixture(t, {disk: true, measureFinalGuard: true, dropRequestHistory: true,
    projectedCharacters: process.env.PA_PROGRESSIVE_GUARD_BENCHMARK === '1' ? 24_000 : 0});
  const {taskId} = await f.submit();
  const task = await waitFor(f.app, taskId);
  assert.equal(task.state, 'succeeded', JSON.stringify(task.error));
  assert.equal(f.calls.length, 72);
  assert.equal(new Set(f.calls.map(call => JSON.stringify([call.toolName, call.input]))).size, 72);
  const {loop, records, evidence} = assertOriginalReceipts(f.app, taskId, 72);
  assert.equal(loop.step, 73);
  assert.equal(task.evidenceRefs.length, 72);
  assert.equal(f.app.runtime.loadCheckpoint(taskId, 'competition-max-steps'), 4, 'Capacity growth never overwrites the original budget checkpoint');
  const capacity = f.app.runtime.loadCheckpoint(taskId, EXECUTION_CAPACITY_CHECKPOINT);
  assert.equal(capacity.initialWindowSteps, 4);
  assert.ok(capacity.windowEndStep > 72 && capacity.extensions > 12);
  assert.equal(capacity.maxSteps, undefined);
  assert.equal(capacity.deadline, f.app.runtime.loadCheckpoint(taskId, 'application-deadline'));
  assert.equal(f.queries.length, 73);
  assert.equal(f.guardMeasurements.length, 1);
  if (process.env.PA_PROGRESSIVE_GUARD_BENCHMARK === '1') console.log('progressive-guard-measurement:' + JSON.stringify(f.guardMeasurements[0]));
  assert.equal(f.guardMeasurements[0].jsonParseCount, 1, 'The final guard decodes the immutable original loop once across all sent receipts');
  assert.equal(f.guardMeasurements[0].cloneCount, 0, 'The synchronous guard never clones the full receipt history');
  assert.equal(Math.max(...f.queries.map(query => query.priorIds.length)), 32);
  assert.equal(f.queries.at(-1).current, loop.continuation.proposalId);
  assert.deepEqual(f.queries.at(-1).priorIds, loop.receipts.slice(-33, -1).map(receipt => receipt.proposal.proposalId));
  assert.equal(f.app.runtime.loadCheckpoint(taskId, 'competition-continuation-window:v1').omitted.count, 39);
  assert.equal(await readFile(path.join(f.files, 'file-023.txt'), 'utf8'), 'fixture file file-023.txt');
  const callsBefore = f.calls.length;
  await f.reopen();
  assert.deepEqual(f.app.runtime.getTask(taskId), task);
  assert.deepEqual(f.app.runtime.readToolExecutions(taskId), records);
  assert.deepEqual(f.app.runtime.readEvidence(taskId), evidence);
  assert.deepEqual(f.app.runtime.loadCheckpoint(taskId, 'competition-loop'), loop);
  assert.equal(f.calls.length, callsBefore, 'Reopening SQLite never reexecutes completed actions');
});

test('final conversation compilation rebudgets original recent receipts before the real image parser', async t => {
  const conversationContext = [{id: 'synthetic-large-user-context', role: 'user',
    content: 'SYNTHETIC_CONTEXT_BODY_ONLY_' + 'h'.repeat(80_000)}];
  const f = await fixture(t, {actions: 36, projectedCharacters: 40_000, conversationContext});
  const {taskId} = await f.submit('compiled-budget');
  const task = await waitFor(f.app, taskId);
  assert.equal(task.state, 'succeeded', JSON.stringify(task.error));
  assertOriginalReceipts(f.app, taskId, 36);
  const local = f.app.runtime.loadCheckpoint(taskId, 'competition-continuation-window:v1');
  const sent = f.app.runtime.loadCheckpoint(taskId, 'competition-sent-continuation-window:v1');
  assert.ok(sent.priorCount < local.priorCount, 'Final compiled goal must reserve its own bytes');
  assert.ok(sent.additionallyOmitted.count > 0);
  assert.equal(sent.queryBytes, f.queries.at(-1).bytes);
  assert.ok(sent.queryBytes <= MAX_COORDINATION_INITIAL_QUERY_BYTES);
  assert.match(f.queries.at(-1).originalGoal, /SYNTHETIC_CONTEXT_BODY_ONLY/);
  assert.equal(sent.currentProposalId, f.app.runtime.loadCheckpoint(taskId, 'competition-loop').continuation.proposalId);
  assert.doesNotMatch(JSON.stringify(sent.additionallyOmitted), /SYNTHETIC_CONTEXT_BODY_ONLY|LOCAL_PRIVATE_FIXTURE_SECRET|ORIGINAL_PROJECTED_FIXTURE_BODY|file-\d/);
});

test('depth zero and Fast preserve a configured development window', async t => {
  const f = await fixture(t, {actions: 0, initialSteps: 24, windowSteps: 8});
  const applied = f.app.configureThinking({depth: 0, fast: true});
  assert.equal(applied.maxSteps, 24);
  const {taskId} = await f.submit('thinking');
  const task = await waitFor(f.app, taskId);
  assert.equal(task.state, 'succeeded', JSON.stringify(task.error));
  assert.equal(f.app.runtime.loadCheckpoint(taskId, 'competition-max-steps'), 24);
  assert.equal(f.app.runtime.loadCheckpoint(taskId, 'task-thinking').maxSteps, 24);
  assert.equal(f.app.runtime.loadCheckpoint(taskId, EXECUTION_CAPACITY_CHECKPOINT).initialWindowSteps, 24);
});

test('same input with fresh proposal IDs and changed result stamps cannot run forever', async t => {
  const f = await fixture(t, {actions: 72, repeated: true});
  const {taskId} = await f.submit('repeat');
  const task = await waitFor(f.app, taskId);
  assert.equal(task.state, 'failed', JSON.stringify(task.error));
  assert.equal(task.error.code, 'TIMEOUT');
  assert.equal(f.calls.length, 7);
  assert.equal(new Set(f.calls.map(call => JSON.stringify(call.input))).size, 1);
  assert.equal(f.app.runtime.loadCheckpoint(taskId, EXECUTION_CAPACITY_CHECKPOINT).extensions, 1);
  assert.equal(f.app.runtime.loadCheckpoint(taskId, 'competition-capacity-decision:v1').reason, 'no_confirmed_progress');
  assertOriginalReceipts(f.app, taskId, 7);
});

test('explicit user maxSteps stops new effects at its original bound', async t => {
  const f = await fixture(t, {actions: 72, initialSteps: 8, maxSteps: 5});
  const {taskId} = await f.submit('explicit-limit');
  const task = await waitFor(f.app, taskId);
  assert.equal(task.state, 'failed', JSON.stringify(task.error));
  assert.equal(task.error.code, 'TIMEOUT');
  assert.equal(f.calls.length, 4);
  const capacity = f.app.runtime.loadCheckpoint(taskId, EXECUTION_CAPACITY_CHECKPOINT);
  assert.equal(capacity.maxSteps, 5);
  assert.equal(capacity.windowEndStep, 5);
  assert.equal(capacity.extensions, 0);
  assert.equal(f.app.runtime.loadCheckpoint(taskId, 'competition-max-steps'), 5);
  assert.equal(f.app.runtime.loadCheckpoint(taskId, 'competition-capacity-decision:v1').reason, 'explicit_limit');
  assertOriginalReceipts(f.app, taskId, 4);
});

test('a legacy approval resume stays within its saved limit after the host enables progressive tasks', async t => {
  const f = await fixture(t, {actions: 72, progressive: false, automatic: false, disk: true});
  const {taskId} = await f.submit('legacy');
  assert.equal((await waitFor(f.app, taskId, task => task.state === 'waiting_approval' || terminal(task))).state, 'waiting_approval');
  const originalMax = f.app.runtime.loadCheckpoint(taskId, 'competition-max-steps');
  const originalDeadline = f.app.runtime.loadCheckpoint(taskId, 'application-deadline');
  assert.equal(f.app.runtime.loadCheckpoint(taskId, EXECUTION_CAPACITY_CHECKPOINT), undefined);
  await f.reopen(true);
  const approved = new Set();
  const end = Date.now() + 20_000;
  while (Date.now() < end && !terminal(f.app.runtime.getTask(taskId))) {
    for (const approval of (await f.client.call('approval.list', {taskId})).items) {
      if (approval.state !== 'pending' || approved.has(approval.approvalId)) continue;
      approved.add(approval.approvalId);
      await f.client.call('authorization.respond', {approvalId: approval.approvalId,
        expectedRevision: approval.revision, decision: 'allow_once'});
    }
    await pause();
  }
  const task = await waitFor(f.app, taskId);
  assert.equal(task.state, 'failed', JSON.stringify(task.error));
  assert.equal(task.error.code, 'TIMEOUT');
  assert.equal(f.calls.length, originalMax - 1);
  assert.equal(f.app.runtime.loadCheckpoint(taskId, 'competition-max-steps'), originalMax);
  assert.equal(f.app.runtime.loadCheckpoint(taskId, 'application-deadline'), originalDeadline);
  assert.equal(f.app.runtime.loadCheckpoint(taskId, EXECUTION_CAPACITY_CHECKPOINT), undefined, 'The new host policy cannot opt an old task in');
  assert.equal(f.app.runtime.readToolExecutions(taskId).length, originalMax - 1);
});

test('default user-work and fresh followup tasks inherit policy while retaining their own deadlines and origin', async t => {
  const f = await fixture(t, {actions: 20, delegate: true, windowSteps: 3});
  const {taskId: parentTaskId} = await f.submit('delegated');
  const parent = await waitFor(f.app, parentTaskId);
  assert.equal(parent.state, 'succeeded', JSON.stringify(parent.error));
  const [child] = f.app.readSubagentTasks(parentTaskId);
  assert.ok(child);
  assert.equal(child.state, 'succeeded', JSON.stringify(child.error));
  const sourceTask = f.app.runtime.getTask(child.taskId);
  const sourceCapacity = f.app.runtime.loadCheckpoint(child.taskId, EXECUTION_CAPACITY_CHECKPOINT);
  const parentCapacity = f.app.runtime.loadCheckpoint(parentTaskId, EXECUTION_CAPACITY_CHECKPOINT);
  assert.equal(sourceCapacity.windowSteps, parentCapacity.windowSteps);
  assert.equal(sourceCapacity.initialWindowSteps, f.app.runtime.loadCheckpoint(parentTaskId, 'competition-max-steps'));
  assert.equal(sourceCapacity.deadline, parentCapacity.deadline);
  assert.ok(sourceCapacity.extensions > 0);
  assertOriginalReceipts(f.app, child.taskId, 20);
  assert.equal(f.app.runtime.readToolExecutions(parentTaskId).length, 1);
  const scope = {parentTaskId, taskId: child.taskId};
  const freshDeadline = new Date(Date.now() + 120_000).toISOString();
  const {acceptedTaskId} = f.app.submitSubagentConversationMessage({...scope,
    requestId: 'development-followup', text: 'Continue the same synthetic project with fresh authorization', deadline: freshDeadline});
  assert.notEqual(acceptedTaskId, child.taskId);
  const followup = await waitFor(f.app, acceptedTaskId);
  assert.equal(followup.state, 'succeeded', JSON.stringify(followup.error));
  assert.deepEqual(f.app.readSubagentConversationOrigin(acceptedTaskId), scope);
  assert.equal(f.app.runtime.loadCheckpoint(acceptedTaskId, 'subtask-parent'), undefined);
  const followupCapacity = f.app.runtime.loadCheckpoint(acceptedTaskId, EXECUTION_CAPACITY_CHECKPOINT);
  assert.equal(followupCapacity.deadline, freshDeadline);
  assert.notEqual(followupCapacity.deadline, sourceCapacity.deadline);
  assert.equal(followupCapacity.windowSteps, sourceCapacity.windowSteps);
  assert.equal(followupCapacity.initialWindowSteps, sourceCapacity.initialWindowSteps);
  assert.equal(f.queries.find(query => query.taskId === acceptedTaskId).capacity.extensions, 0,
    'A fresh task inherits policy, never the old task progress counters');
  assertOriginalReceipts(f.app, acceptedTaskId, 20);
  assert.deepEqual(f.app.runtime.getTask(child.taskId), sourceTask, 'The original terminal child stays closed');
  assert.deepEqual(f.app.runtime.loadCheckpoint(child.taskId, EXECUTION_CAPACITY_CHECKPOINT), sourceCapacity);
  assert.equal(f.calls.length, 40);
});
