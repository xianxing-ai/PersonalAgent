import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication} from '../dist/application.js';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';

const descriptor = {
  name: 'fixture.meeting', version: '1.0.0',
  inputSchema: {type: 'object', required: ['id'], additionalProperties: false,
    properties: {id: {type: 'string'}}},
  outputSchema: {type: 'object', required: ['time', 'localOnly'], additionalProperties: false,
    properties: {time: {type: 'string'}, localOnly: {type: 'string'}}},
  sideEffect: 'read', requiredScopes: ['fixture:read'],
  idempotencySupport: true, recoverySupport: true, requiresPresence: false,
};
const proposal = {kind: 'tool_proposal', proposalId: 'meeting-1', toolName: descriptor.name,
  toolVersion: descriptor.version, arguments: {id: 'synthetic-meeting'}, verification: 'unverified'};
const binding = {
  toolName: descriptor.name, toolVersion: descriptor.version,
  exportPolicyVersion: 'synthetic-v1',
  accepts: input => input.arguments.id === 'synthetic-meeting',
  project: ({result}) => ({time: result.time}),
};

async function state(app, taskId, states) {
  for (let i = 0; i < 400; i++) {
    const task = app.runtime.getTask(taskId);
    if (states.includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw Error('Task did not settle');
}

async function fixture(t, {toolExport = binding, result = proposal, sideEffect = 'read', timeoutMs = 30_000,
  now, project, toolState, respond, prepareCompetitionToolExport, path = ':memory:', cleanup = true} = {}) {
  let executions = 0;
  const port = new FakeCoordinationPort(respond ?? (request => request.continuation
    ? {kind: 'text', text: 'Cloud fixture consumed projection', verification: 'unverified'} : result));
  const app = createRuntimeApplication({path, profile: 'huawei_ict_agentarts', coordination: port,
    ...(now ? {now: () => new Date(now())} : {}),
    ...(prepareCompetitionToolExport ? {prepareCompetitionToolExport} : {}),
    competitionToolExports: [{...toolExport, ...(project ? {project} : {})}],
    tools: [{descriptor: {...descriptor, sideEffect}, execute: async () => {
      executions++;
      if (toolState) return toolState();
      return {time: '17:00', localOnly: 'synthetic-private-marker'};
    }}],
  });
  if (cleanup) t.after(() => app.close());
  const client = new Client(app, now ?? Date.now);
  await client.connect();
  const {taskId} = await client.call('task.submit', {goal: 'Read synthetic meeting', conversationId: 'export-test'},
    {idempotencyKey: 'synthetic', timeoutMs});
  const approve = async decision => {
    const approval = (await client.call('approval.list', {taskId})).items[0];
    await client.call('authorization.respond', {approvalId: approval.approvalId,
      expectedRevision: approval.revision, decision});
    return approval;
  };
  return {app, client, port, taskId, approve, executions: () => executions};
}

test('unverified proposal requires approval and exports only the host projection for the same task', async t => {
  const accepted = [];
  const projected = [];
  const f = await fixture(t, {toolExport: {...binding, accepts: input => {accepted.push(input); return binding.accepts(input);}},
    project: input => {projected.push(input); return {time: input.result.time};}});
  assert.equal((await state(f.app, f.taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
  assert.equal(f.executions(), 0);
  const approval = await f.approve('allow_once');
  const task = await state(f.app, f.taskId, ['succeeded', 'failed']);
  assert.equal(task.state, 'succeeded');
  assert.equal(f.executions(), 1);
  assert.equal(f.port.requests.length, 2);
  assert.equal(f.port.requests[1].taskId, f.taskId);
  assert.deepEqual(f.port.requests[1].continuation, {proposalId: proposal.proposalId, state: 'confirmed', result: {time: '17:00'}});
  assert.equal(projected.length, 1);
  assert.equal(projected[0].taskId, f.taskId);
  assert.ok(accepted.every(input => input.taskId === f.taskId && input.proposalId === proposal.proposalId));
  assert.deepEqual(task.evidenceRefs, [approval.approvalId]);
  assert.equal(f.app.runtime.readToolExecutions(f.taskId)[0].policyDecision, 'allow');
  assert.doesNotMatch(JSON.stringify(f.port.requests), /synthetic-private-marker|authorizationRef|scopeRef|evidenceRefs/);
  // Replaying the same approval cannot launch another cloud or tool run.
  await f.client.call('authorization.respond', {approvalId: approval.approvalId, expectedRevision: approval.revision, decision: 'allow_once'});
  assert.equal(f.executions(), 1);
  assert.equal(f.port.requests.length, 2);
});

test('export selection rejects wrong tool version, input, task and writes before approval', async t => {
  for (const options of [
    {result: {...proposal, toolVersion: '2.0.0'}},
    {result: {...proposal, arguments: {id: 'private-meeting'}}},
    {toolExport: {...binding, accepts: input => input.taskId === 'another-task'}},
    {sideEffect: 'external_write'},
    {toolExport: {...binding, accepts: () => {throw Error('synthetic-private-marker');}}},
  ]) {
    await t.test(JSON.stringify(options), async t => {
      const f = await fixture(t, options);
      const task = await state(f.app, f.taskId, ['failed', 'waiting_approval']);
      assert.equal(task.state, 'failed');
      assert.equal(f.executions(), 0);
      assert.equal(f.port.requests.length, 1);
      assert.deepEqual((await f.client.call('approval.list', {taskId: f.taskId})).items, []);
      assert.doesNotMatch(JSON.stringify(task), /synthetic-private-marker/);
    });
  }
});

test('denied or cancelled approval never executes or exports', async t => {
  for (const action of ['deny', 'cancel']) await t.test(action, async t => {
    const f = await fixture(t, {project: () => {throw Error('must not export');}});
    await state(f.app, f.taskId, ['waiting_approval']);
    if (action === 'deny') await f.approve('deny');
    else await f.client.call('task.cancel', {taskId: f.taskId});
    assert.equal((await state(f.app, f.taskId, ['cancelled'])).state, 'cancelled');
    assert.equal(f.executions(), 0);
    assert.equal(f.port.requests.length, 1);
  });
});

test('original task deadline remains authoritative after export-approved proposal waits', async t => {
  let time = Date.now();
  const f = await fixture(t, {now: () => time});
  await state(f.app, f.taskId, ['waiting_approval']);
  time = Date.parse(f.app.runtime.loadCheckpoint(f.taskId, 'application-deadline')) + 1;
  await assert.rejects(f.approve('allow_once'), {code: 'TIMEOUT'});
  const task = await state(f.app, f.taskId, ['failed']);
  assert.equal(task.error.code, 'TIMEOUT');
  assert.equal(f.executions(), 0);
  assert.equal(f.port.requests.length, 1);
});

test('revoking the trusted export selection while approval waits prevents execution on resume', async t => {
  let permitted = true;
  const f = await fixture(t, {toolExport: {...binding, accepts: () => permitted}});
  await state(f.app, f.taskId, ['waiting_approval']);
  permitted = false;
  await f.approve('allow_once');
  const task = await state(f.app, f.taskId, ['failed']);
  assert.equal(task.error.code, 'UNAUTHORIZED');
  assert.equal(f.executions(), 0);
  assert.equal(f.port.requests.length, 1);
});

test('projection errors, non-JSON and oversized output remain local with execution Evidence', async t => {
  for (const project of [() => {throw Error('synthetic-private-marker');}, () => undefined,
    () => ({text: 'x'.repeat(1_048_577)}),
    () => ({get token() {throw Error('synthetic-private-marker');}})]) {
    await t.test('projection denied', async t => {
      const f = await fixture(t, {project});
      await state(f.app, f.taskId, ['waiting_approval']);
      await f.approve('allow_once');
      const task = await state(f.app, f.taskId, ['waiting_reconciliation']);
      assert.equal(task.error.code, 'UNAUTHORIZED');
      assert.equal(f.executions(), 1);
      assert.equal(f.port.requests.length, 1);
      assert.equal(f.app.runtime.readEvidence(f.taskId).length, 1);
      assert.deepEqual(f.app.runtime.loadCheckpoint(f.taskId, 'competition-export-withheld'), {withheld: true});
      assert.doesNotMatch(JSON.stringify(task), /synthetic-private-marker/);
    });
  }
});

test('cancelling a non-cooperative projection settles promptly without cloud continuation', async t => {
  let started;
  const startedPromise = new Promise(resolve => {started = resolve;});
  const f = await fixture(t, {project: () => {started(); return new Promise(() => {});}});
  await state(f.app, f.taskId, ['waiting_approval']);
  await f.approve('allow_once');
  await startedPromise;
  await f.client.call('task.cancel', {taskId: f.taskId});
  assert.equal((await state(f.app, f.taskId, ['cancelled'])).state, 'cancelled');
  assert.equal(f.executions(), 1);
  assert.equal(f.port.requests.length, 1);
});

test('revoking export scope during projection prevents the actual cloud handoff', async t => {
  let permitted = true;
  let started;
  let release;
  const startedPromise = new Promise(resolve => {started = resolve;});
  const f = await fixture(t, {toolExport: {...binding, accepts: () => permitted},
    project: () => {started(); return new Promise(resolve => {release = resolve;});}});
  await state(f.app, f.taskId, ['waiting_approval']);
  await f.approve('allow_once');
  await startedPromise;
  permitted = false;
  release({time: '17:00'});
  const task = await state(f.app, f.taskId, ['waiting_reconciliation']);
  assert.equal(task.error.code, 'UNAUTHORIZED');
  assert.equal(f.executions(), 1);
  assert.equal(f.port.requests.length, 1);
  assert.equal(f.app.runtime.readEvidence(f.taskId).length, 1);
  assert.deepEqual(f.app.runtime.loadCheckpoint(f.taskId, 'competition-export-withheld'), {withheld: true});
  permitted = true;
  await new Promise(resolve => setImmediate(resolve));
  await f.app.resumeConfirmedTask(f.taskId);
  assert.equal((await state(f.app, f.taskId, ['succeeded', 'failed'])).state, 'succeeded');
  assert.equal(f.executions(), 1);
  assert.equal(f.port.requests.length, 2);
});

test('async native preparation separates unexecuted preflight from confirmed projection and final I/O', async t => {
  const phases = [];
  let f;
  f = await fixture(t, {prepareCompetitionToolExport: async input => {
    phases.push(input.phase);
    assert.deepEqual(input.proposal, proposal);
    assert.equal(input.signal.aborted, false);
    await Promise.resolve();
    if (input.phase === 'projection') {
      const loop = f.app.runtime.loadCheckpoint(input.taskId, 'competition-loop');
      assert.deepEqual(loop.pending, proposal);
      const record = f.app.runtime.readToolExecutions(input.taskId)[0];
      assert.equal(record.state, 'confirmed');
      assert.equal(record.policyDecision, 'allow');
      assert.equal(record.executionStarted, true);
      assert.equal(f.executions(), 1);
    }
  }, toolExport: {...binding, accepts: input => {
    phases.push(input.phase);
    if (input.phase === 'final') assert.deepEqual(input.projection, {time: '17:00'});
    return binding.accepts(input);
  }}});
  await state(f.app, f.taskId, ['waiting_approval']);
  assert.equal(f.executions(), 0);
  await f.approve('allow_once');
  assert.equal((await state(f.app, f.taskId, ['succeeded', 'failed'])).state, 'succeeded');
  assert.ok(phases.indexOf('projection') > phases.lastIndexOf('preflight'));
  assert.ok(phases.indexOf('final') > phases.indexOf('projection'));
  assert.equal(f.executions(), 1);
});

test('native preflight refusal performs no read and creates no execution approval', async t => {
  const f = await fixture(t, {prepareCompetitionToolExport: async () => {throw Error('private-native-detail');}});
  const task = await state(f.app, f.taskId, ['failed']);
  assert.equal(task.error.code, 'UNAUTHORIZED');
  assert.doesNotMatch(JSON.stringify(task), /private-native-detail/);
  assert.equal(f.executions(), 0);
  assert.equal(f.port.requests.length, 1);
  assert.deepEqual((await f.client.call('approval.list', {taskId: f.taskId})).items, []);
  assert.deepEqual(f.app.runtime.readToolExecutions(f.taskId), []);
});

test('repeated cloud proposals reuse confirmed projection and reject changed input', async t => {
  for (const conflict of [false, true]) await t.test(`conflict=${conflict}`, async t => {
    let calls = 0;
    let projections = 0;
    const f = await fixture(t, {project: ({result}) => {projections++; return {time: result.time};},
      respond: () => {
        calls++;
        if (calls === 1) return proposal;
        if (calls === 2) return conflict ? {...proposal, arguments: {id: 'synthetic-meeting', extra: 'conflict'}} : proposal;
        return {kind: 'text', text: 'Replayed result consumed', verification: 'unverified'};
      },
    });
    await state(f.app, f.taskId, ['waiting_approval']);
    await f.approve('allow_once');
    const task = await state(f.app, f.taskId, ['succeeded', 'failed']);
    assert.equal(task.state, conflict ? 'failed' : 'succeeded');
    if (conflict) assert.equal(task.error.code, 'REVISION_CONFLICT');
    else assert.deepEqual(f.port.requests[1].continuation, f.port.requests[2].continuation);
    assert.equal(f.executions(), 1);
    assert.equal(projections, 1);
  });
});

test('restart with a narrower export policy never replays an old projection or reexecutes its proposal', async t => {
  const base = new URL('../../../.cache/export-restart/', import.meta.url);
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(new URL('case-', base));
  const path = directory + '/runtime.sqlite';
  const secondProposal = {...proposal, proposalId: 'meeting-2'};
  let current;
  t.after(async () => {current?.app.close(); await rm(directory, {recursive: true, force: true});});
  const first = await fixture(t, {path, cleanup: false, project: ({result}) => result,
    respond: request => request.continuation ? secondProposal : proposal});
  current = first;
  await state(first.app, first.taskId, ['waiting_approval']);
  await first.approve('allow_once');
  while (first.port.requests.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
  await state(first.app, first.taskId, ['waiting_approval']);
  assert.equal(first.executions(), 1);
  assert.match(JSON.stringify(first.port.requests[1].continuation), /synthetic-private-marker/);
  first.app.close();
  current = undefined;
  const restarted = await fixture(t, {path, cleanup: false,
    toolExport: {...binding, exportPolicyVersion: 'synthetic-v2'}, respond: () => proposal});
  current = restarted;
  await restarted.approve('allow_once');
  const task = await state(restarted.app, restarted.taskId, ['waiting_reconciliation']);
  assert.equal(task.error.code, 'UNAUTHORIZED');
  assert.equal(restarted.port.requests.length, 1);
  assert.doesNotMatch(JSON.stringify(restarted.port.requests), /synthetic-private-marker/);
  assert.equal(restarted.executions(), 1); // Only the newly approved second proposal.
  const records = restarted.app.runtime.readToolExecutions(restarted.taskId);
  assert.equal(records.filter(record => record.evidenceId === `competition-tool-${restarted.taskId}-1`).length, 1);
  assert.equal(records.length, 2);
});

test('last exchange cannot approve or execute a new proposal without continuation budget', async t => {
  let calls = 0;
  const f = await fixture(t, {respond: () => ++calls < 4 ? proposal : {...proposal, proposalId: 'too-late'}});
  await state(f.app, f.taskId, ['waiting_approval']);
  await f.approve('allow_once');
  const task = await state(f.app, f.taskId, ['failed']);
  assert.equal(task.error.code, 'TIMEOUT');
  assert.equal(f.executions(), 1);
  assert.equal(f.port.requests.length, 4);
  assert.equal((await f.client.call('approval.list', {taskId: f.taskId})).items.length, 1);
  const checkpoint = f.app.runtime.loadCheckpoint(f.taskId, 'competition-loop');
  assert.equal(checkpoint.step, 4);
  assert.equal(checkpoint.pending, undefined);
});
