import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {currentNodes} from '@personal-agent/goals';
import {openSqliteMemoryHost} from '@personal-agent/memory/sqlite';
import {createMemoryProjectionApplication} from '@personal-agent/runtime/application';
import {createSyntheticMeetingToolset} from '../../../apps/desktop/electron/competition-synthetic-workspace.js';
import {createSyntheticRepairHost} from '../../../apps/desktop/electron/competition-repair-host.js';
import {projectSyntheticRepairContext} from '../../../apps/desktop/electron/competition-repair-context.js';
import {restoreSyntheticRepairSubmission} from '../../../apps/desktop/electron/competition-repair-submission.js';
import {parseAgentInput, repairInput} from '../../../packages/agentarts/dist/input.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/mvp-meeting/', import.meta.url));
const namespace = 'mvp-synthetic-meeting';
async function state(app, taskId, wanted) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const task = app.runtime.getTask(taskId);
    if (wanted.includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('Synthetic task did not settle');
}
async function approve(client, taskId) {
  const approval = (await client.call('approval.list', {taskId})).items[0];
  assert.ok(approval);
  await client.call('authorization.respond', {approvalId: approval.approvalId,
    expectedRevision: approval.revision, decision: 'allow_once'});
}

test('confirmed synthetic read produces exact graph-bound candidate, separate approved CAS, and restart readback', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pa-mvp-repair-host-'));
  const runtimePath = join(directory, 'runtime.sqlite');
  const memoryPath = join(directory, 'memory.sqlite');
  let host;
  let app;
  let decisionCalls = 0;
  let expectedSuggestions;
  t.after(() => {
    try { app?.close(); } finally { host?.close(); rmSync(directory, {recursive: true, force: true}); }
  });
  const cloud = new FakeCoordinationPort(request => {
    if (!request.continuation) return {kind: 'tool_proposal', proposalId: 'mvp-meeting-read-1',
      toolName: 'workspace.read_text', toolVersion: '1.0.0',
      arguments: {path: 'meeting-update.json'}, verification: 'unverified'};
    const context = request.continuation.result.repairContext;
    assert.equal(context.targets.length, 3);
    const parsed = repairInput(parseAgentInput(JSON.stringify({continuation: request.continuation})));
    assert.equal(parsed.sources.length, 5, 'Actual host continuation carries the approved source versions');
    assert.equal(parsed.prospectiveDependencies.length, 3);
    return {kind: 'repair_candidate', candidateVersion: '1.0', verification: 'unverified',
      candidate: {expectedGraphRevision: context.expectedGraphRevision, changes: [
        {node: context.targets[0].node, summary: 'Attend meeting at 17:00',
          reason: 'Confirmed synthetic meeting correction', dependencies: context.targets[0].requestedDependencies},
        {node: context.targets[1].node, summary: 'Prepare one hour before 17:00 meeting',
          reason: 'Dependent attendance time changed',
          dependencies: [{id: 'attend', revision: context.targets[0].node.revision + 1}]},
        {node: context.targets[2].node, summary: 'Prepare at 16:00',
          reason: 'One hour before confirmed meeting',
          dependencies: [{id: 'prepare', revision: context.targets[1].node.revision + 1}]},
      ]}};
  });
  async function open() {
    host = createSyntheticRepairHost(memoryPath, {decision: {async decide(request) {
      decisionCalls += 1;
      assert.equal(request.events.length, 1);
      assert.equal(request.events[0].source, 'memory-projection:mvp-synthetic-meeting');
      assert.deepEqual(request.events[0].facts, [{id: 'meeting/time', revision: 2}]);
      assert.deepEqual(request.events[0].authorization, {state: 'none', revision: 0});
      // Explicit advisory fixture: every submitted event has one bound answer,
      // with no execution authority or automatic graph repair.
      expectedSuggestions = request.events.map(event => ({eventId: event.eventId, source: event.source,
        intervention: 'DEFER', confidence: null, reason: 'low_confidence',
        facts: event.facts.map(fact => ({...fact})), authorizationRevision: event.authorization.revision}));
      return structuredClone(expectedSuggestions);
    }}});
    app = createRuntimeApplication({path: runtimePath, profile: 'huawei_ict_agentarts',
      coordination: cloud, repairCandidateVersion: '1.0', localRepair: host.localRepair,
      ...createSyntheticMeetingToolset(fixtureRoot, input => host.projectConfirmed(input))});
    await host.initialize(app.runtime);
  }
  await open();
  const client = new Client(app);
  await client.connect();
  const {taskId} = await client.call('task.submit', {goal: 'Read synthetic meeting change', conversationId: 'mvp'},
    {idempotencyKey: 'mvp-repair-source', timeoutMs: 60_000});
  assert.equal((await state(app, taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
  assert.equal(app.runtime.bindCoordinationStore('mvp-synthetic-meeting').read().revision, 5);
  await approve(client, taskId);
  const source = await state(app, taskId, ['succeeded', 'failed']);
  assert.equal(source.state, 'succeeded');
  assert.equal(cloud.requests.length, 2);
  for (let attempt = 0; attempt < 100
    && app.runtime.loadCheckpoint(taskId, 'mvp-local-impact-advice')?.status !== 'ready'; attempt++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(decisionCalls, 1);
  assert.equal(expectedSuggestions.length, 1);
  assert.deepEqual(app.runtime.loadCheckpoint(taskId, 'mvp-local-impact-advice'),
    {graphRevision: 6, status: 'ready', suggestions: expectedSuggestions});
  if (process.env.PA_MVP_CONTEXT_OUTPUT) {
    const original = host.readBinding(taskId).binding;
    const context = projectSyntheticRepairContext(host.readGraph(), {graphRevision: original.graphRevision,
      links: [{fact: original.fact, node: original.node}]});
    writeFileSync(process.env.PA_MVP_CONTEXT_OUTPUT, JSON.stringify(context, null, 2));
  }
  const candidate = app.readRepairCandidate(taskId);
  assert.equal(candidate.candidate.expectedGraphRevision, 6);
  app.runtime.saveCheckpoint(taskId, 'competition-repair-candidate', {...candidate,
    candidate: {...candidate.candidate, changes: candidate.candidate.changes.map((change, index) =>
      index === 2 ? {...change, dependencies: []} : change)}});
  assert.throws(() => host.readBinding(taskId), /Synthetic repair source unavailable/,
    'The cloud may not erase the preparation dependency');
  app.runtime.saveCheckpoint(taskId, 'competition-repair-candidate', candidate);
  const binding = host.readBinding(taskId);
  assert.equal(binding.binding.graphRevision, 6);
  assert.deepEqual(binding.binding.fact, {id: 'meeting/time', revision: 2});
  const before = host.readGraph();
  const unrelated = currentNodes(before).find(item => item.id === 'unrelated');
  const repairKey = createHash('sha256').update(taskId + ':' + binding.evidenceId).digest('hex');
  const local = app.submitLocalRepair({sourceTaskId: taskId, evidenceId: binding.evidenceId,
    idempotencyKey: repairKey, deadline: new Date(Date.now() + 60_000).toISOString()});
  assert.equal((await state(app, local.taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
  assert.deepEqual(host.readGraph(), before, 'A candidate and pending approval cannot write the graph');
  await approve(client, local.taskId);
  assert.equal((await state(app, local.taskId, ['succeeded', 'failed'])).state, 'succeeded');
  const after = host.readGraph();
  assert.equal(after.revision, before.revision + 3);
  assert.equal(currentNodes(after).find(item => item.id === 'preparation').summary, 'Prepare at 16:00');
  assert.deepEqual(currentNodes(after).find(item => item.id === 'unrelated'), unrelated);
  app.close(); host.close(); app = undefined; host = undefined;
  await open();
  assert.equal(app.runtime.getTask(taskId).state, 'succeeded');
  assert.equal(app.runtime.getTask(local.taskId).state, 'succeeded');
  assert.deepEqual(host.readGraph(), after);
  assert.equal(app.runtime.loadCheckpoint(taskId, 'mvp-repair-submitted'), undefined);
  const recovered = restoreSyntheticRepairSubmission(app, host, taskId,
    host.readBinding(taskId), app.readRepairCandidate(taskId), repairKey);
  assert.equal(recovered.taskId, local.taskId);
  assert.equal(recovered.state, 'succeeded');
  assert.deepEqual(app.runtime.loadCheckpoint(taskId, 'mvp-repair-submitted'), {taskId: local.taskId});
  assert.deepEqual(host.readGraph(), after, 'Marker recovery never repeats the graph CAS');
  assert.equal(cloud.requests.length, 2, 'Readback never replays paid cloud calls');
});

test('synthetic host resumes baseline seeding after a committed fact-only projection', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pa-mvp-baseline-recovery-'));
  const runtimePath = join(directory, 'runtime.sqlite');
  const memoryPath = join(directory, 'memory.sqlite');
  let runtimeApp = createRuntimeApplication({path: runtimePath, profile: 'huawei_ict_agentarts'});
  let memoryHost = openSqliteMemoryHost(memoryPath);
  let host;
  t.after(() => {
    host?.close(); memoryHost?.close(); runtimeApp?.close();
    rmSync(directory, {recursive: true, force: true});
  });
  memoryHost.provision(namespace);
  const memory = memoryHost.bind(namespace, {allowedSensitivities: ['private']});
  const feed = memoryHost.bindFeed(namespace,
    {consumerId: 'mvp-cognition', allowedSensitivities: ['private']});
  const now = Date.now();
  memoryHost.append(namespace, {ref: {id: 'meeting/time', revision: 1},
    summary: 'Synthetic meeting starts at 15:00', sourceRef: 'synthetic/mvp/baseline',
    observedAt: new Date(now).toISOString(), validFrom: new Date(now - 60_000).toISOString(),
    validUntil: new Date(now + 24 * 60 * 60_000).toISOString(),
    sensitivity: 'private', state: 'active', confirmation: 'external_observation'});
  const projection = runtimeApp.runtime.provisionFactProjectionStore(namespace);
  const memoryApp = createMemoryProjectionApplication({consumerKey: 'mvp-cognition',
    memoryNamespace: namespace, feed, memory, projection,
    confirmation: {confirm: request => memoryHost.confirmFeedBatch(namespace, 'mvp-cognition', request)}});
  const signal = new AbortController().signal;
  await memoryApp.consume({limit: 10, deadline: new Date(now + 60_000).toISOString(), signal});
  assert.equal(runtimeApp.runtime.bindCoordinationStore(namespace).read().revision, 1);
  memoryHost.close(); memoryHost = undefined;
  runtimeApp.close(); runtimeApp = undefined;
  runtimeApp = createRuntimeApplication({path: runtimePath, profile: 'huawei_ict_agentarts'});
  host = createSyntheticRepairHost(memoryPath);
  await host.initialize(runtimeApp.runtime);
  const graph = host.readGraph();
  assert.equal(graph.revision, 5);
  assert.deepEqual(currentNodes(graph).filter(item => item.kind !== 'fact').map(item => item.id),
    ['attend', 'prepare', 'preparation', 'unrelated']);
});
