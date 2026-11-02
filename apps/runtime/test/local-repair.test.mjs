import {syntheticCoordinationExecution} from '../../../tests/helpers/synthetic-agentarts.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createRuntimeApplication} from '../dist/application.js';

test('repair preview validates the saved epoch before returning its unchanged candidate DTO',()=>{
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',repairCandidateVersion:'1.0'});
  try{
    const runtime=app.runtime,task=runtime.submitTask({goal:'Synthetic repair source',conversationId:'synthetic',idempotencyKey:'repair-epoch'});
    runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
    runtime.transitionTask(task.taskId,'verifying');runtime.transitionTask(task.taskId,'succeeded');
    const candidate={kind:'repair_candidate',candidateVersion:'1.0',verification:'unverified',candidate:{expectedGraphRevision:0,
      changes:[{node:{id:'plan',revision:1},summary:'Synthetic revised plan',reason:'Synthetic source update',dependencies:[]}]}};
    runtime.saveCheckpoint(task.taskId,'competition-repair-candidate',{...candidate,executionEpoch:0});
    assert.deepEqual(app.readRepairCandidate(task.taskId),candidate);
    runtime.advanceExecutionEpoch(task.taskId,{requestId:'replan',reason:'replan'});
    assert.throws(()=>app.readRepairCandidate(task.taskId),{code:'REVISION_CONFLICT'});
    runtime.saveCheckpoint(task.taskId,'competition-repair-candidate',{...candidate,executionEpoch:1,untrusted:true});
    assert.throws(()=>app.readRepairCandidate(task.taskId),{code:'INVALID_ARGUMENT'});
    runtime.saveCheckpoint(task.taskId,'competition-repair-candidate',{...candidate,executionEpoch:1});
    assert.deepEqual(app.readRepairCandidate(task.taskId),candidate);
  }finally{app.close();}
});

const sourceArguments = {id: 'synthetic-meeting'};
const sourceTool = {name: 'fixture.meeting', version: '1.0.0', arguments: sourceArguments};
const sourceDescriptor = {
  name: sourceTool.name, version: sourceTool.version,
  inputSchema: {type: 'object', required: ['id'], additionalProperties: false,
    properties: {id: {type: 'string'}}},
  outputSchema: {type: 'object', required: ['time'], additionalProperties: false,
    properties: {time: {type: 'string'}}},
  sideEffect: 'read', requiredScopes: ['fixture:read'],
  idempotencySupport: true, recoverySupport: true, requiresPresence: false,
};
const sourceProposal = {kind: 'tool_proposal', proposalId: 'meeting-1',
  toolName: sourceTool.name, toolVersion: sourceTool.version,
  arguments: sourceArguments, verification: 'unverified'};
const later = () => new Date(Date.now() + 86_400_000).toISOString();
const earlier = () => new Date(Date.now() - 86_400_000).toISOString();
const node = (id, kind, summary, sourceRef, dependencies = []) => ({
  id, kind, summary, sourceRef, dependencies, sensitivity: 'private',
  state: 'active', reason: 'synthetic fixture', validFrom: earlier(), validUntil: later(),
});

async function settle(app, taskId, wanted) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const task = app.runtime.getTask(taskId);
    if (wanted.includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error(`Task ${taskId} did not enter ${wanted.join(', ')}`);
}

async function approve(client, taskId, decision = 'allow_once') {
  const approval = (await client.call('approval.list', {taskId})).items[0];
  assert.ok(approval);
  await client.call('authorization.respond', {approvalId: approval.approvalId,
    expectedRevision: approval.revision, decision});
  return approval;
}

function fixture(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'pa-local-repair-'));
  const path = join(directory, 'runtime.sqlite');
  let app;
  let executions = 0;
  let binding;
  let fact;
  let sourceQueue = Promise.resolve();
  const host = {
    graphNamespace: 'synthetic-meeting', bindingVersion: 'fixture-v1', sourceTool,
    memory: {async listCurrent() { return {snapshot: 'synthetic', facts: fact ? [structuredClone(fact)] : []}; }},
    async withSourceLock(work) {
      const before = sourceQueue;
      let release;
      sourceQueue = new Promise(resolve => {release = resolve;});
      await before;
      try {return await work();} finally {release();}
    },
    resolveBinding: () => structuredClone(binding),
    matchesSource: ({result, fact}) => result.time === '17:00' && fact.summary === 'Meeting at 17:00',
  };
  const proposalResult = {kind: 'repair_candidate', candidateVersion: '1.0',
    candidate: {expectedGraphRevision: 4, changes: [{
      node: {id: 'plan', revision: 1}, summary: 'Remind for 17:00',
      reason: 'Meeting time corrected by a read observation',
      dependencies: [{id: 'meeting', revision: 2}],
    }]}, verification: 'unverified'};
  const port = new FakeCoordinationPort(syntheticCoordinationExecution(request => request.continuation ? proposalResult : sourceProposal));
  const create = () => createRuntimeApplication({path, profile: 'huawei_ict_agentarts',
    coordination: port, repairCandidateVersion: '1.0', localRepair: host,
    competitionToolExports: [{toolName: sourceTool.name, toolVersion: sourceTool.version,
      exportPolicyVersion: 'fixture-v1', accepts: ({arguments: args}) => args.id === sourceArguments.id,
      project: ({taskId, result}) => {
        const evidenceId = app.runtime.readToolExecutions(taskId).find(record => record.state === 'confirmed')?.evidenceId;
        assert.ok(evidenceId, 'real confirmed read evidence is required');
        const store = app.runtime.provisionCoordinationStore(host.graphNamespace);
        const sourceRef = `tool-evidence:${evidenceId}`;
        const oldFact = store.append(0, node('meeting', 'fact', 'Meeting at 16:00', 'synthetic-old'));
        const plan = store.append(oldFact.revision, node('plan', 'plan', 'Remind for 16:00',
          'synthetic-plan', [{id: 'meeting', revision: 1}]));
        store.append(plan.revision, node('unrelated', 'plan', 'Unrelated plan', 'synthetic-unrelated'));
        const validFrom = earlier();
        const validUntil = later();
        const newest = store.append(3, {...node('meeting', 'fact', 'Meeting at 17:00', sourceRef),
          validFrom, validUntil});
        fact = {ref: {id: 'meeting', revision: 2}, summary: 'Meeting at 17:00', sourceRef,
          observedAt: new Date().toISOString(), validFrom, validUntil,
          sensitivity: 'private', state: 'active', confirmation: 'external_observation',
          corrects: {id: 'meeting', revision: 1}};
        binding = {fact: fact.ref, node: {id: 'meeting', revision: 2},
          graphRevision: newest.revision, allowedTargets: [{id: 'plan', revision: 1}],
          allowedDependencies: [{id: 'meeting', revision: 2}]};
        return {time: result.time};
      }}],
    tools: [{descriptor: sourceDescriptor, execute: async () => {executions++; return {time: '17:00'};}}],
  });
  app = create();
  t.after(() => {app.close(); rmSync(directory, {recursive: true, force: true});});
  return {
    get app() {return app;}, host, port, path, create,
    replaceApp(next) {app = next;},
    fact: () => fact, setFact(next) {fact = next;},
    binding: () => binding,
    executions: () => executions,
    async source() {
      const client = new Client(app);
      await client.connect();
      // The submit deadline covers approval and the second coordination exchange,
      // not only Client.call; use the same explicit budget as the repair task.
      const {taskId} = await client.call('task.submit', {goal: 'Read meeting and request repair',
        conversationId: 'synthetic-repair'}, {idempotencyKey: 'source', timeoutMs: 30_000});
      const waiting = await settle(app, taskId, ['waiting_approval', 'failed']);
      assert.equal(waiting.state, 'waiting_approval', JSON.stringify(waiting.error));
      const originalApproval = await approve(client, taskId);
      const finished = await settle(app, taskId, ['succeeded', 'failed']);
      assert.equal(finished.state, 'succeeded', JSON.stringify(finished.error));
      assert.ok(app.readRepairCandidate(taskId));
      assert.equal(app.runtime.bindCoordinationStore(host.graphNamespace).read().revision, 4);
      return {client, taskId, evidenceId: originalApproval.approvalId};
    },
    async repair(sourceTaskId, evidenceId, key = 'repair-once') {
      const repair = app.submitLocalRepair({sourceTaskId, evidenceId,
        idempotencyKey: key, deadline: new Date(Date.now() + 30_000).toISOString()});
      assert.equal((await settle(app, repair.taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
      return repair;
    },
  };
}

test('approved separate local task commits the selected plan by CAS and reads back persisted graph', async t => {
  const f = fixture(t);
  const {client, taskId, evidenceId} = await f.source();
  const before = f.app.runtime.bindCoordinationStore(f.host.graphNamespace).read();
  const request = {sourceTaskId: taskId, evidenceId, idempotencyKey: 'approved-once',
    deadline: new Date(Date.now() + 30_000).toISOString()};
  const repair = f.app.submitLocalRepair(request);
  assert.equal((await settle(f.app, repair.taskId, ['waiting_approval'])).state, 'waiting_approval');
  assert.equal(f.executions(), 1);
  assert.deepEqual(f.app.runtime.bindCoordinationStore(f.host.graphNamespace).read(), before);
  assert.equal((await client.call('approval.list', {taskId: repair.taskId})).items.length, 1);
  await approve(client, repair.taskId);
  const complete = await settle(f.app, repair.taskId, ['succeeded', 'failed', 'waiting_reconciliation']);
  assert.equal(complete.state, 'succeeded', JSON.stringify(complete.error));
  const after = f.app.runtime.bindCoordinationStore(f.host.graphNamespace).read();
  assert.equal(after.revision, 5);
  assert.equal(after.history.findLast(item => item.id === 'plan').summary, 'Remind for 17:00');
  assert.deepEqual(after.history.find(item => item.id === 'unrelated'), before.history.find(item => item.id === 'unrelated'));
  assert.equal(f.app.runtime.readToolExecutions(repair.taskId)[0].state, 'confirmed');
  assert.equal(f.app.runtime.readToolExecutions(repair.taskId)[0].toolName, 'cognition.commit_repair');
  f.app.close();
  const reopened = f.create();
  f.replaceApp(reopened);
  assert.equal(reopened.runtime.getTask(repair.taskId).state, 'succeeded');
  assert.deepEqual(reopened.runtime.bindCoordinationStore(f.host.graphNamespace).read(), after);
  const repeat = reopened.submitLocalRepair(request);
  assert.equal(repeat.taskId, repair.taskId);
  assert.equal(repeat.state, 'succeeded');
  assert.equal(reopened.runtime.bindCoordinationStore(f.host.graphNamespace).read().revision, 5);
});

test('denied local approval leaves the graph and source task unchanged', async t => {
  const f = fixture(t);
  const {client, taskId, evidenceId} = await f.source();
  const repair = await f.repair(taskId, evidenceId);
  await approve(client, repair.taskId, 'deny');
  assert.equal((await settle(f.app, repair.taskId, ['cancelled'])).state, 'cancelled');
  assert.equal(f.app.runtime.bindCoordinationStore(f.host.graphNamespace).read().revision, 4);
  assert.equal(f.app.runtime.getTask(taskId).state, 'succeeded');
});

test('changed current FactRef is rejected after approval without a graph write', async t => {
  const f = fixture(t);
  const {client, taskId, evidenceId} = await f.source();
  const repair = await f.repair(taskId, evidenceId);
  f.setFact({...f.fact(), ref: {id: 'meeting', revision: 3}});
  await approve(client, repair.taskId);
  const stopped = await settle(f.app, repair.taskId, ['failed', 'waiting_reconciliation']);
  assert.equal(stopped.state, 'failed');
  assert.equal(f.app.runtime.bindCoordinationStore(f.host.graphNamespace).read().revision, 4);
});

test('stale graph and denied selection both fail before a write', async t => {
  const f = fixture(t);
  const {client, taskId, evidenceId} = await f.source();
  const repair = await f.repair(taskId, evidenceId);
  const store = f.app.runtime.bindCoordinationStore(f.host.graphNamespace);
  store.append(4, node('new-unrelated', 'plan', 'Someone else changed the graph', 'synthetic-other'));
  await approve(client, repair.taskId);
  assert.equal((await settle(f.app, repair.taskId, ['failed'])).state, 'failed');
  assert.equal(store.read().revision, 5);

  const f2 = fixture(t);
  const source2 = await f2.source();
  f2.binding().allowedTargets.length = 0;
  assert.throws(() => f2.app.submitLocalRepair({sourceTaskId: source2.taskId,
    evidenceId: source2.evidenceId, idempotencyKey: 'out-of-scope', deadline: later()}),
  {code: 'UNAUTHORIZED'});
  assert.equal(f2.app.runtime.bindCoordinationStore(f2.host.graphNamespace).read().revision, 4);
});

test('candidate cannot silently remove a baseline plan dependency', async t => {
  const f = fixture(t);
  const {taskId, evidenceId} = await f.source();
  const candidate = f.app.readRepairCandidate(taskId);
  candidate.candidate.changes[0].dependencies = [];
  f.app.runtime.saveCheckpoint(taskId, 'competition-repair-candidate', candidate);
  assert.throws(() => f.app.submitLocalRepair({sourceTaskId: taskId, evidenceId,
    idempotencyKey: 'sever-fact-link', deadline: later()}), {code: 'UNAUTHORIZED'});
  assert.equal(f.app.runtime.bindCoordinationStore(f.host.graphNamespace).read().revision, 4);
});

test('source Evidence must bind the exact invocation arguments and authorization reference', async t => {
  const f = fixture(t);
  const {taskId, evidenceId} = await f.source();
  const runtime = f.app.runtime;
  const record = runtime.readToolExecutions(taskId)[0];
  assert.equal(runtime.matchesToolExecutionInput(record, {arguments: sourceArguments,
    scopeRef: evidenceId}), true);
  assert.equal(runtime.matchesToolExecutionInput(record, {arguments: sourceArguments,
    scopeRef: 'different-authorization'}), false);
  const saved = runtime.loadCheckpoint(taskId, `tool-result-${evidenceId}`);
  runtime.saveToolExecution({...record, inputDigest: '0'.repeat(64)}, saved.result);
  assert.throws(() => f.app.submitLocalRepair({sourceTaskId: taskId, evidenceId,
    idempotencyKey: 'mismatched-source-invocation', deadline: later()}), {code: 'UNAUTHORIZED'});
  assert.equal(runtime.bindCoordinationStore(f.host.graphNamespace).read().revision, 4);
});

test('two real approvals cannot lend one Evidence ID to the other invocation', async t => {
  const f = fixture(t);
  const seed = await f.source();
  const runtime = f.app.runtime;
  const source = runtime.submitTask({goal: 'Separate approved reads', conversationId: 'synthetic-repair',
    idempotencyKey: 'two-real-approvals'});
  runtime.transitionTask(source.taskId, 'planning');
  runtime.transitionTask(source.taskId, 'running');
  const otherArguments = {id: 'synthetic-other'};
  const evidenceA = 'source-read-a';
  const evidenceB = 'source-read-b';
  for (const [evidenceId, args] of [[evidenceA, sourceArguments], [evidenceB, otherArguments]]) {
    const approval = runtime.requestToolApproval(evidenceId, source.taskId, sourceDescriptor,
      later(), toolArgumentsDigest(args));
    runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
    runtime.transitionTask(source.taskId, 'running');
  }
  const response = await runtime.send({kind: 'request', protocolVersion: '1.0.0',
    requestId: 'borrowed-invocation', taskId: source.taskId, idempotencyKey: evidenceA,
    deadline: later(), operation: 'tool.invoke', payload: {toolName: sourceTool.name,
      toolVersion: sourceTool.version, arguments: otherArguments, scopeRef: evidenceB}},
  new AbortController().signal);
  assert.equal(response.outcome, 'ok');
  assert.equal(response.data.state, 'confirmed');
  const record = runtime.readToolExecutions(source.taskId)[0];
  assert.equal(record.evidenceId, evidenceA);
  assert.equal(record.policyDecision, 'allow');
  assert.equal(runtime.getApproval(evidenceA).state, 'allowed');
  assert.equal(runtime.getApproval(evidenceB).state, 'allowed');
  runtime.saveCheckpoint(source.taskId, 'competition-repair-candidate',
    f.app.readRepairCandidate(seed.taskId));
  runtime.transitionTask(source.taskId, 'verifying');
  runtime.transitionTask(source.taskId, 'succeeded', {resultSummary: 'Synthetic reads completed',
    evidenceRefs: [evidenceA]});
  assert.throws(() => f.app.submitLocalRepair({sourceTaskId: source.taskId,
    evidenceId: evidenceA, idempotencyKey: 'borrowed-source', deadline: later()}), {code: 'UNAUTHORIZED'});
  assert.equal(runtime.bindCoordinationStore(f.host.graphNamespace).read().revision, 4);
});

test('shared source lock serializes Fact ingestion before the repair reads current Fact', async t => {
  const f = fixture(t);
  const {client, taskId, evidenceId} = await f.source();
  const repair = await f.repair(taskId, evidenceId);
  let entered;
  const lockEntered = new Promise(resolve => {entered = resolve;});
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  const ingest = f.host.withSourceLock(async () => {
    entered();
    await gate;
    f.setFact({...f.fact(), ref: {id: 'meeting', revision: 3}});
  });
  await lockEntered;
  await approve(client, repair.taskId);
  release();
  await ingest;
  assert.equal((await settle(f.app, repair.taskId, ['failed'])).state, 'failed');
  assert.equal(f.app.runtime.bindCoordinationStore(f.host.graphNamespace).read().revision, 4);
});

test('a temporary host namespace switch cannot redirect the approved CAS to another graph', async t => {
  const f = fixture(t);
  const {client, taskId, evidenceId} = await f.source();
  const repair = await f.repair(taskId, evidenceId);
  const originalNamespace = f.host.graphNamespace;
  const originalGraph = f.app.runtime.bindCoordinationStore(originalNamespace).read();
  const otherNamespace = 'unapproved-other-graph';
  f.app.runtime.provisionCoordinationStore(otherNamespace).appendBatch(0,
    originalGraph.history.map(({revision, graphRevision, ...input}) => input));
  let entered;
  const duringRead = new Promise(resolve => {entered = resolve;});
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  const originalRead = f.host.memory.listCurrent;
  f.host.memory.listCurrent = async input => {
    entered();
    await gate;
    f.host.graphNamespace = originalNamespace;
    return originalRead(input);
  };
  f.host.graphNamespace = otherNamespace;
  await approve(client, repair.taskId);
  await duringRead;
  release();
  const task = await settle(f.app, repair.taskId, ['succeeded', 'failed', 'waiting_reconciliation']);
  assert.equal(task.state, 'succeeded', JSON.stringify(task.error));
  assert.equal(f.app.runtime.bindCoordinationStore(originalNamespace).read().revision, 5);
  assert.equal(f.app.runtime.bindCoordinationStore(otherNamespace).read().revision, 4);
});

test('unknown result after durable CAS survives restart and never replays the local write', async t => {
  const f = fixture(t);
  const {client, taskId, evidenceId} = await f.source();
  const request = {sourceTaskId: taskId, evidenceId, idempotencyKey: 'crash-after-cas',
    deadline: new Date(Date.now() + 30_000).toISOString()};
  const repair = f.app.submitLocalRepair(request);
  assert.equal((await settle(f.app, repair.taskId, ['waiting_approval'])).state, 'waiting_approval');
  const originalBind = f.app.runtime.bindCoordinationStore.bind(f.app.runtime);
  f.app.runtime.bindCoordinationStore = namespace => {
    const store = originalBind(namespace);
    return {...store, read: store.read.bind(store), append: store.append.bind(store),
      appendBatch: (revision, nodes) => {
        const committed = store.appendBatch(revision, nodes);
        assert.equal(committed.revision, 5);
        throw new ProtocolError('RESULT_UNKNOWN', 'Simulated process loss after durable CAS');
      }};
  };
  await approve(client, repair.taskId);
  assert.equal((await settle(f.app, repair.taskId, ['waiting_reconciliation', 'failed'])).state,
    'waiting_reconciliation');
  assert.equal(originalBind(f.host.graphNamespace).read().revision, 5);
  f.app.close();
  const reopened = f.create();
  f.replaceApp(reopened);
  const replay = reopened.submitLocalRepair(request);
  assert.equal(replay.taskId, repair.taskId);
  assert.equal(replay.state, 'waiting_reconciliation');
  assert.equal(reopened.runtime.bindCoordinationStore(f.host.graphNamespace).read().revision, 5);
  assert.equal(reopened.runtime.readToolExecutions(repair.taskId).length, 1);
});

test('one idempotency key is bound to the original candidate and deadline', async t => {
  const f = fixture(t);
  const {taskId, evidenceId} = await f.source();
  const request = {sourceTaskId: taskId, evidenceId, idempotencyKey: 'one-intent', deadline: later()};
  const first = f.app.submitLocalRepair(request);
  assert.equal((await settle(f.app, first.taskId, ['waiting_approval'])).state, 'waiting_approval');
  assert.equal(f.app.submitLocalRepair(request).taskId, first.taskId);
  assert.throws(() => f.app.submitLocalRepair({...request, deadline: new Date(Date.now() + 100_000).toISOString()}),
    {code: 'REVISION_CONFLICT'});
  assert.equal(f.app.runtime.bindCoordinationStore(f.host.graphNamespace).read().revision, 4);
});

test('task and intent checkpoint roll back together when the checkpoint write fails', async t => {
  const f = fixture(t);
  const {taskId, evidenceId} = await f.source();
  const request = {sourceTaskId: taskId, evidenceId, idempotencyKey: 'atomic-intent',
    deadline: new Date(Date.now() + 30_000).toISOString()};
  const runtime = f.app.runtime;
  const saveCheckpoint = runtime.saveCheckpoint.bind(runtime);
  runtime.saveCheckpoint = (id, key, value) => {
    if (key === 'local-repair-intent') throw Error('Simulated crash before intent persistence');
    return saveCheckpoint(id, key, value);
  };
  assert.throws(() => f.app.submitLocalRepair(request), /Simulated crash/);
  assert.equal(runtime.findTaskByIdempotencyKey('local-repair:atomic-intent'), undefined);
  runtime.saveCheckpoint = saveCheckpoint;
  f.app.close();
  const reopened = f.create();
  f.replaceApp(reopened);
  const repair = reopened.submitLocalRepair(request);
  assert.equal((await settle(reopened, repair.taskId, ['waiting_approval'])).state, 'waiting_approval');
  assert.ok(reopened.runtime.loadCheckpoint(repair.taskId, 'local-repair-intent'));
  assert.equal(reopened.runtime.bindCoordinationStore(f.host.graphNamespace).read().revision, 4);
});

test('legacy created task with matching digest and no intent recovers once after restart', async t => {
  const f = fixture(t);
  const {taskId, evidenceId} = await f.source();
  const request = {sourceTaskId: taskId, evidenceId, idempotencyKey: 'legacy-created-gap',
    deadline: new Date(Date.now() + 30_000).toISOString()};
  const runtime = f.app.runtime;
  runtime.submitTaskWithCheckpoint = input => {
    runtime.submitTask(input);
    throw Error('Simulated old process loss after task commit');
  };
  assert.throws(() => f.app.submitLocalRepair(request), /Simulated old process loss/);
  const orphan = runtime.findTaskByIdempotencyKey('local-repair:legacy-created-gap');
  assert.equal(orphan.state, 'created');
  assert.equal(runtime.loadCheckpoint(orphan.taskId, 'local-repair-intent'), undefined);
  assert.throws(() => f.app.submitLocalRepair({...request, deadline: later()}),
    {code: 'REVISION_CONFLICT'});
  f.app.close();
  const reopened = f.create();
  f.replaceApp(reopened);
  const repair = reopened.submitLocalRepair(request);
  assert.equal(repair.taskId, orphan.taskId);
  assert.equal((await settle(reopened, repair.taskId, ['waiting_approval'])).state, 'waiting_approval');
  assert.ok(reopened.runtime.loadCheckpoint(repair.taskId, 'local-repair-intent'));
  assert.equal(reopened.runtime.bindCoordinationStore(f.host.graphNamespace).read().revision, 4);
  assert.throws(() => reopened.submitLocalRepair({...request, deadline: later()}),
    {code: 'REVISION_CONFLICT'});
});
