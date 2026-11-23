import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnedWorkflowEngine, workflowGuardToolName, workflowHostToolName} from '../dist/owned-workflows.js';
import {OwnedWorkflowHostBridge, createOwnedWorkflowReceiptVerifier} from '../dist/owned-workflow-host-bridge.js';
import {getOwnedWorkflowTemplate} from '../dist/owned-workflow-templates.js';
import {replayRepairTrace, summarizeRepairFailure} from '../dist/repair-policy.js';

const secret = 'fixture-repair-policy-key-at-least-32-chars';
const schema = {type: 'object', additionalProperties: true};
const deadline = () => new Date(Date.now() + 60_000).toISOString();

function fixture(repair) {
  const template = getOwnedWorkflowTemplate('F20');
  const tasks = new Map();
  const checkpoints = new Map();
  const calls = [];
  let count = 0;
  const descriptorNames = [...new Set(template.nodes.flatMap(node => [
    ...node.capabilities.filter(cap => cap.kind === 'tool').map(cap => cap.name),
    ...(node.kind === 'host' ? [workflowHostToolName(node.id)] : []),
    ...(node.condition ? [workflowGuardToolName(node.id)] : []),
  ]))];
  const availableTools = descriptorNames.map(name => ({name, version: '1.0.0', inputSchema: schema}));
  const host = {
    submitHostToolTask: request => {
      calls.push(structuredClone(request));
      const taskId = 'fixture-local-' + (++count);
      const task = {taskId, state: 'succeeded'};
      tasks.set(taskId, {...request, task, confirmed: {runId: 'host-tool-' + taskId, result: {fixture: true}, evidenceRefs: ['host-tool-' + taskId]}});
      return {...request, task};
    },
    readHostToolTask: id => structuredClone(tasks.get(id)),
  };
  const bridge = new OwnedWorkflowHostBridge({
    host, receiptSecret: secret, assertActive() {}, canRetryReadFailure: () => true,
    checkpoints: {
      read: (taskId, key) => checkpoints.get(taskId + ':' + key),
      writeOnce: (taskId, key, value) => {
        const id = taskId + ':' + key;
        if (checkpoints.has(id)) return false;
        checkpoints.set(id, structuredClone(value));
        return true;
      },
    },
  });
  const engine = new OwnedWorkflowEngine({
    checkpointSecret: secret, receiptVerifier: createOwnedWorkflowReceiptVerifier({secret}), externalHost: true, repair,
    selector: {select: async () => 'fixture'},
    prepareCandidates: async context => [
      {id: 'fixture', description: 'Explicit synthetic candidate, not a real service', value: context.node.kind === 'tool'
        ? {toolName: context.node.capabilities[0].name, toolVersion: '1.0.0', arguments: {}}
        : context.node.kind === 'host' ? {arguments: {}} : {fixtureNode: context.node.id}},
      {id: 'review', description: 'Do not execute', value: null, abstain: true},
    ],
  });
  const request = {
    workflowId: template.workflowId, taskId: 'fixture-parent', sessionId: 'fixture-session', requestId: 'fixture-request',
    input: {fixture: true}, controlRevision: 1, deadline: deadline(), signal: new AbortController().signal, availableTools,
  };
  return {engine, bridge, request, calls, tasks};
}

async function failRead(f, last, error) {
  const proposal = last.proposals[0];
  const submitted = f.bridge.submit(f.request, proposal);
  const readback = f.tasks.get(submitted.localTaskId);
  delete readback.confirmed;
  readback.task.state = 'failed';
  readback.task.error = error;
  readback.task.evidenceRefs = ['original-failure-evidence'];
  const receipt = f.bridge.readReceipt(f.request, proposal);
  const next = await f.engine.advance({...f.request, checkpoint: last.checkpoint, receipts: [receipt]});
  return {proposal, next};
}

test('a transient read retries with a new operation id and the replay performs no side effect', async () => {
  let now = Date.parse('2026-11-11T00:00:00.000Z');
  const f = fixture({now: () => now, baseDelayMs: 0, maxDelayMs: 0, maxAttempts: 1, maxElapsedMs: 60_000, parentCanReplan: false});
  const first = await f.engine.advance(f.request);
  const failed = await failRead(f, first, {code: 'TIMEOUT', message: 'deadline exceeded', retryable: true});
  assert.equal(failed.next.proposals.length, 1);
  assert.notEqual(failed.next.proposals[0].operationId, failed.proposal.operationId);
  assert.equal(failed.next.proposals[0].effect, 'read');
  assert.equal(failed.next.nodes[failed.proposal.nodeId].previousAttempts.length, 1);
  assert.equal(f.calls.length, 1, 'selecting a retry does not submit the tool');
  const again = await failRead(f, failed.next, {code: 'TIMEOUT', message: 'deadline exceeded', retryable: true});
  assert.equal(again.next.state, 'failed');
  assert.deepEqual(again.next.proposals, []);
  assert.match(again.next.nodes[failed.proposal.nodeId].reason, /budget_exhausted/);
  const trace = again.next.nodes[failed.proposal.nodeId].repairTrace;
  const replay = replayRepairTrace(trace, {signal: new AbortController().signal, deadline: deadline()});
  assert.equal(replay.actualToolCalls, 0);
  assert.equal(replay.actualWrites, 0);
  assert.equal(replay.actualModelCalls, 0);
  assert.ok(replay.timeline.every(item => item.executedDuringReplay === false));
  assert.equal(summarizeRepairFailure(trace).budgetExhausted, true);
  assert.equal(f.calls.length, 2, 'the second failure is a readback of the already submitted retry, not a third call');
});

test('backoff holds the original read until the delay elapses', async () => {
  let now = Date.parse('2026-11-11T00:00:00.000Z');
  const f = fixture({now: () => now, baseDelayMs: 1_000, maxDelayMs: 8_000, maxAttempts: 4, maxElapsedMs: 60_000, parentCanReplan: false});
  const first = await f.engine.advance(f.request);
  const failed = await failRead(f, first, {code: 'RATE_LIMITED', message: 'too many requests'});
  assert.equal(failed.next.state, 'failed');
  assert.deepEqual(failed.next.proposals, []);
  assert.equal(failed.next.nodes[failed.proposal.nodeId].proposal.operationId, failed.proposal.operationId);
  const held = await f.engine.advance({...f.request, checkpoint: failed.next.checkpoint});
  assert.equal(held.state, 'failed');
  assert.deepEqual(held.proposals, []);
  now += 1_000;
  const released = await f.engine.advance({...f.request, checkpoint: held.checkpoint});
  assert.equal(released.proposals.length, 1);
  assert.notEqual(released.proposals[0].operationId, failed.proposal.operationId);
  assert.equal(f.calls.length, 1);
  const replay = replayRepairTrace(released.nodes[failed.proposal.nodeId].repairTrace, {signal: new AbortController().signal, deadline: deadline()});
  assert.equal(replay.actualToolCalls, 0);
  assert.equal(replay.timeline[0].strategy, 'backoff_retry');
});

test('a correctable read asks the parent to replan instead of repeating the same call', async () => {
  const f = fixture({now: () => Date.parse('2026-11-11T00:00:00.000Z'), baseDelayMs: 0, maxDelayMs: 0, maxAttempts: 4, parentCanReplan: true});
  const first = await f.engine.advance(f.request);
  const failed = await failRead(f, first, {code: 'INVALID_ARGUMENT', message: 'selector missed', selectorMiss: true});
  assert.equal(failed.next.state, 'failed');
  assert.deepEqual(failed.next.proposals, []);
  assert.match(failed.next.nodes[failed.proposal.nodeId].reason, /request parent replan/);
  assert.equal(f.calls.length, 1);
  const summary = summarizeRepairFailure(failed.next.nodes[failed.proposal.nodeId].repairTrace);
  assert.equal(summary.classification, 'correctable');
  assert.equal(summary.requiresParentReplan, true);
  assert.equal(summary.sideEffectsEmitted, 0);
});

test('a high-risk transient read waits for approval and does not emit another call', async () => {
  const f = fixture({now: () => Date.parse('2026-11-11T00:00:00.000Z'), baseDelayMs: 0, maxDelayMs: 0, maxAttempts: 4, parentCanReplan: false});
  const first = await f.engine.advance(f.request);
  const failed = await failRead(f, first, {code: 'TIMEOUT', risk: 'high'});
  assert.equal(failed.next.state, 'failed');
  assert.deepEqual(failed.next.proposals, []);
  assert.match(failed.next.nodes[failed.proposal.nodeId].reason, /high_risk: retry waits for approval/);
  assert.equal(f.calls.length, 1);
  const summary = summarizeRepairFailure(failed.next.nodes[failed.proposal.nodeId].repairTrace);
  assert.equal(summary.awaitingApproval, true);
  assert.equal(summary.unknownWriteBlindRetry, false);
});
