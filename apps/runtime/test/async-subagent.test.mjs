import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {ProtocolError} from '@personal-agent/contracts';
import {TaskRuntime} from '../dist/index.js';
import {createAsyncSubagentController, createRuntimeSubagentDispatchTool, SUBAGENT_DISPATCH_TOOL_NAME, SUBAGENT_SPAWN_TOOL_NAME} from '../dist/application.js';

const deadline = () => new Date(Date.now() + 60_000).toISOString();
const context = (taskId, extra = {}) => ({taskId, runId: 'run-'+taskId, signal: new AbortController().signal,
  deadline: deadline(), authorizationRef: 'auth-'+taskId, scopes: ['agent:delegate'], ...extra});
const parentOf = runtime => runtime.submitTask({conversationId: 'desktop-panel', goal: '主对话', idempotencyKey: 'parent-'+Math.random()});
const hold = () => {let release; const promise = new Promise(resolve => {release = resolve;}); return {promise, release};};
const tool = (controller, name) => controller.tools.find(item => item.descriptor.name === name);
const finish = (runtime, summary = 'done') => async (taskId, childDeadline) => runtime.runTask(taskId, async () => ({resultSummary: summary}), {deadline: childDeadline, sideEffect: 'read'});

function controller(runtime, extra = {}) {
  const reports = [];
  const granted = extra.granted ?? ['notes.read'];
  const pool = createAsyncSubagentController({host: {getRuntime: () => runtime, getModelConfigurationRef: extra.modelRef,
    ...(extra.startHost ? {} : {})}, getGrantedTools: () => granted, onReport: report => reports.push(report),
    globalCap: extra.globalCap, perParentCap: extra.perParentCap, startChild: extra.startChild ?? finish(runtime),
    verifyUnknownWrite: extra.verifyUnknownWrite});
  return {pool, reports};
}

test('spawn returns immediately, reuses the dispatch idempotency key, and queues above the cap', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = parentOf(runtime);
  const gate = hold();
  let started = 0;
  const runs = [];
  const {pool} = controller(runtime, {globalCap: 3, perParentCap: 3, startChild: (taskId, childDeadline) => {
    started += 1;
    const run = runtime.runTask(taskId, () => gate.promise.then(() => ({resultSummary: 'ok'})), {deadline: childDeadline, sideEffect: 'read'});
    runs.push(run);
    return run;
  }});
  const spawn = tool(pool, SUBAGENT_SPAWN_TOOL_NAME);
  const parentContext = context(parent.taskId);
  const first = await spawn.execute({subtasks: [1, 2, 3, 4].map(id => ({subtaskId: 's'+id, role: 'researcher', goal: '调查 '+id}))}, parentContext);
  assert.equal(first.accepted, true);
  assert.equal(first.handles.length, 4);
  assert.equal(started, 0, 'spawn does not block on child execution');
  for (const handle of first.handles) {
    assert.equal(handle.idempotencyKey, `subagent-dispatch-${parent.taskId}-${handle.subtaskId}`);
    assert.equal(runtime.findTaskByIdempotencyKey(handle.idempotencyKey).taskId, handle.taskId);
  }
  const again = await spawn.execute({subtasks: [{subtaskId: 's1', role: 'researcher', goal: '调查 1'}]}, parentContext);
  assert.equal(again.handles[0].taskId, first.handles[0].taskId);
  await pool.pump();
  assert.equal(started, 3);
  assert.throws(() => runtime.getSchedule(`async-subagent-admit:${first.handles[3].taskId}`), {code: 'NOT_FOUND'});
  gate.release();
  await Promise.all(runs);
  await pool.pump();
  assert.equal(started, 4);
  await Promise.all(runs);
});

test('per-parent cap and Laya admission stay serialized beside the global pool', async () => {
  const runtime = new TaskRuntime(':memory:');
  const left = parentOf(runtime);
  const right = parentOf(runtime);
  const gate = hold();
  const {pool} = controller(runtime, {globalCap: 5, perParentCap: 3, startChild: (taskId, childDeadline) => runtime.runTask(taskId,
    () => gate.promise.then(() => ({resultSummary: 'ok'})), {deadline: childDeadline, sideEffect: 'read'})});
  const spawn = tool(pool, 'subagent.spawn');
  await spawn.execute({subtasks: [1, 2, 3, 4].map(id => ({subtaskId: 'a'+id, role: 'coder', goal: '实现 '+id}))}, context(left.taskId));
  await spawn.execute({subtasks: [{subtaskId: 'b1', role: 'coder', goal: '另一父任务', model: 'local-laya'},
    {subtaskId: 'b2', role: 'coder', goal: '第二份 Laya', model: 'local-laya'}]}, context(right.taskId));
  await pool.pump();
  const scheduled = id => {try {return runtime.getSchedule(id).status;} catch {return 'absent';}};
  const leftChildren = [1, 2, 3, 4].map(id => runtime.findTaskByIdempotencyKey(`subagent-dispatch-${left.taskId}-a${id}`));
  assert.deepEqual(leftChildren.map(child => scheduled(`async-subagent-admit:${child.taskId}`)), ['fired', 'fired', 'fired', 'absent']);
  const laya = [1, 2].map(id => runtime.findTaskByIdempotencyKey(`subagent-dispatch-${right.taskId}-b${id}`));
  const layaStates = laya.map(child => scheduled(`async-subagent-admit:${child.taskId}`));
  assert.equal(layaStates.filter(state => state === 'fired').length, 1);
  assert.equal(layaStates.filter(state => state === 'absent').length, 1);
  gate.release();
});

test('terminal results are reported once across a second pump and a reopened runtime', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'async-subagent-'));
  const db = path.join(directory, 'runtime.sqlite');
  const runtime = new TaskRuntime(db);
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '主对话', idempotencyKey: 'parent-restart'});
  const {pool, reports} = controller(runtime, {startChild: (taskId, childDeadline) => runtime.runTask(taskId,
    async () => ({resultSummary: '已确认回执'}), {deadline: childDeadline, sideEffect: 'read'})});
  await tool(pool, 'subagent.spawn').execute({subtasks: [{subtaskId: 'only', role: 'reviewer', goal: '核对'}]}, context(parent.taskId));
  await pool.pump();
  await pool.pump();
  assert.equal(reports.length, 1);
  assert.match(reports[0].summary, /已确认回执/);
  const saved = runtime.loadCheckpoint(parent.taskId, `async-subagent-report:only:${reports[0].revision}`);
  assert.equal(saved.summary, reports[0].summary);
  runtime.close();
  const reopened = new TaskRuntime(db);
  const again = [];
  const next = createAsyncSubagentController({host: {getRuntime: () => reopened}, onReport: report => again.push(report),
    startChild: (taskId, childDeadline) => reopened.runTask(taskId, async () => ({resultSummary: '不应重做'}), {deadline: childDeadline, sideEffect: 'read'})});
  await next.pump();
  assert.deepEqual(again, []);
  reopened.close();
  rmSync(directory, {recursive: true, force: true});
});

test('follow-up uses controlRevision and stop cancels a queued child without starting it', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = parentOf(runtime);
  let started = 0;
  const seen = [];
  const {pool} = controller(runtime, {startChild: async (taskId, childDeadline) => {
    started += 1;
    seen.push(runtime.loadCheckpoint(taskId, 'async-subagent-control:v1'));
    return runtime.runTask(taskId, async () => ({resultSummary: 'continued'}), {deadline: childDeadline, sideEffect: 'read'});
  }});
  const spawn = tool(pool, 'subagent.spawn');
  await spawn.execute({subtasks: [{subtaskId: 'live', role: 'planner', goal: '拆解'}, {subtaskId: 'halt', role: 'planner', goal: '停掉'}]}, context(parent.taskId));
  assert.deepEqual(pool.instruct(parent.taskId, 'live', '补充边界', 0), {revision: 1});
  assert.throws(() => pool.instruct(parent.taskId, 'live', '再补', 0), {code: 'REVISION_CONFLICT'});
  const stopped = pool.stop(parent.taskId, 'halt');
  assert.equal(stopped.cancelAccepted, true);
  assert.equal(stopped.state, 'cancelled');
  await pool.pump();
  assert.equal(started, 1);
  assert.equal(seen[0].revision, 1);
  assert.equal(seen[0].instructions[0], '补充边界');
  assert.equal(runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-halt`).state, 'cancelled');
});

test('restart re-enqueues created children and an unknown write is read back instead of redone', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'async-subagent-recover-'));
  const db = path.join(directory, 'runtime.sqlite');
  const runtime = new TaskRuntime(db);
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '主对话', idempotencyKey: 'parent-recover'});
  const {pool} = controller(runtime, {startChild: async () => {throw new Error('should not start before restart');}});
  await tool(pool, 'subagent.spawn').execute({subtasks: [{subtaskId: 'queued', role: 'coordinator', goal: '等待恢复'}]}, context(parent.taskId));
  runtime.close();
  const reopened = new TaskRuntime(db);
  let started = 0;
  let restored;
  const recovered = createAsyncSubagentController({host: {getRuntime: () => reopened}, startChild: (taskId, childDeadline) => {
    started += 1;
    restored = reopened.runTask(taskId, async () => ({resultSummary: 'restored'}), {deadline: childDeadline, sideEffect: 'read'});
    return restored;
  }});
  await recovered.recover();
  assert.equal(started, 1);
  assert.equal((await restored).state, 'succeeded');
  await new Promise(resolve => setImmediate(resolve));
  reopened.close();
  const unknownRuntime = new TaskRuntime(':memory:');
  const unknownParent = parentOf(unknownRuntime);
  let attempts = 0;
  let reads = 0;
  const unknown = createAsyncSubagentController({host: {getRuntime: () => unknownRuntime}, verifyUnknownWrite: async () => {reads += 1; return 'unknown';},
    startChild: (taskId, childDeadline) => {
      attempts += 1;
      return unknownRuntime.runTask(taskId, () => {
        unknownRuntime.transitionTask(taskId, 'waiting_reconciliation', {error: {code: 'RESULT_UNKNOWN', message: 'write outcome unknown', retryable: false}});
        throw new ProtocolError('RESULT_UNKNOWN', 'unknown');
      }, {deadline: childDeadline, sideEffect: 'external_write'});
    }});
  await tool(unknown, 'subagent.spawn').execute({subtasks: [{subtaskId: 'write', role: 'coder', goal: '外部写入'}]}, context(unknownParent.taskId));
  await unknown.pump();
  const child = unknownRuntime.findTaskByIdempotencyKey(`subagent-dispatch-${unknownParent.taskId}-write`);
  await unknownRuntime.getTask(child.taskId);
  for (let index = 0; index < 20 && unknownRuntime.getTask(child.taskId).state === 'running'; index += 1) await new Promise(resolve => setImmediate(resolve));
  await unknown.pump();
  await unknown.pump();
  assert.equal(attempts, 1);
  assert.equal(reads, 1);
  assert.equal(unknownRuntime.getTask(child.taskId).state, 'waiting_reconciliation');
  rmSync(directory, {recursive: true, force: true});
});

test('pause keeps a queued child out and redirect waits for an unknown write to be read back', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = parentOf(runtime);
  let started = 0;
  const {pool} = controller(runtime, {startChild: (taskId, childDeadline) => {
    started += 1;
    return runtime.runTask(taskId, async () => ({resultSummary: 'ran'}), {deadline: childDeadline, sideEffect: 'read'});
  }});
  await tool(pool, 'subagent.spawn').execute({subtasks: [{subtaskId: 'hold', role: 'coder', goal: '先别跑'}]}, context(parent.taskId));
  assert.equal(pool.pause(parent.taskId, 'hold').phase, 'paused');
  await pool.pump();
  assert.equal(started, 0);
  assert.equal(pool.resume(parent.taskId, 'hold').phase, 'running');
  await pool.pump();
  assert.equal(started, 1);

  const unknownRuntime = new TaskRuntime(':memory:');
  const unknownParent = parentOf(unknownRuntime);
  const gate = hold();
  const unknown = createAsyncSubagentController({host: {getRuntime: () => unknownRuntime}, verifyUnknownWrite: async () => 'unknown',
    startChild: (taskId, childDeadline) => unknownRuntime.runTask(taskId, () => gate.promise.then(() => ({resultSummary: 'ok'})), {deadline: childDeadline, sideEffect: 'external_write'})});
  await tool(unknown, 'subagent.spawn').execute({subtasks: [{subtaskId: 'live', role: 'coder', goal: '在跑'}]}, context(unknownParent.taskId));
  await unknown.pump();
  await assert.rejects(unknown.redirect(unknownParent.taskId, 'live', '换个做法', 0), {code: 'RESULT_UNKNOWN'});
  gate.release();
  for (let index = 0; index < 20 && unknownRuntime.getTask(unknownRuntime.findTaskByIdempotencyKey(`subagent-dispatch-${unknownParent.taskId}-live`).taskId).state === 'running'; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
});

test('custom types require confirmation, reject built-in names and ungranted tools, and invalidate old proposals', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = parentOf(runtime);
  let starts = 0;
  const refs = ['config-v1'];
  const {pool} = controller(runtime, {granted: ['notes.read'], modelRef: () => refs[0], startChild: (taskId, childDeadline) => {
    starts += 1;
    return runtime.runTask(taskId, async worker => ({resultSummary: String(worker.loadCheckpoint('async-subagent-type:v1').version)}), {deadline: childDeadline, sideEffect: 'read'});
  }});
  const call = (name, input) => tool(pool, name).execute(input, context(parent.taskId));
  await assert.rejects(call('subagent.type.create', {definition: {name: 'coder', description: '撞名', instructions: '不要覆盖内置', allowedTools: [], baseRole: 'coder', enabled: true}}), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(call('subagent.type.create', {definition: {name: 'release-notes', description: '写说明', instructions: '只根据已读笔记起草', allowedTools: ['secret.write'], baseRole: 'researcher', enabled: true}}), {code: 'SCOPE_DENIED'});
  const drafted = await call('subagent.type.create', {definition: {name: 'release-notes', description: '写说明', instructions: '只根据已读笔记起草', allowedTools: ['notes.read'], baseRole: 'researcher', enabled: true, maxSteps: 4}});
  assert.equal(drafted.state, 'pending_confirmation');
  assert.equal(drafted.effect, 'none');
  await assert.rejects(call('subagent.spawn', {subtasks: [{subtaskId: 'early', typeName: 'release-notes', goal: '草稿'}]}), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(call('subagent.type.confirm', {proposalId: drafted.proposalId, digest: drafted.digest, summary: '用户没看到的另一份摘要'}), {code: 'REVISION_CONFLICT'});
  const confirmed = await call('subagent.type.confirm', {proposalId: drafted.proposalId, digest: drafted.digest, summary: drafted.summary});
  assert.equal(confirmed.record.version, 1);
  assert.equal(confirmed.record.definition.enabled, true);
  const listed = await call('subagent.type.list', {});
  assert.equal(listed.types.length, 1);
  await call('subagent.spawn', {subtasks: [{subtaskId: 'notes', typeName: 'release-notes', goal: '写说明'}]});
  const child = runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-notes`);
  assert.equal(runtime.loadCheckpoint(child.taskId, 'subtask-parent').role, 'researcher');
  assert.equal(runtime.loadCheckpoint(child.taskId, 'async-subagent-type:v1').version, 1);
  const revised = await call('subagent.type.update', {definition: {name: 'release-notes', description: '写说明', instructions: '补充风险', allowedTools: ['notes.read'], baseRole: 'researcher', enabled: true, maxSteps: 4}});
  await call('subagent.type.confirm', {proposalId: revised.proposalId, digest: revised.digest, summary: revised.summary});
  await pool.pump();
  assert.equal(starts, 0);
  assert.equal(runtime.getTask(child.taskId).state, 'failed');
  assert.match(runtime.getTask(child.taskId).error.message, /类型已变更|no longer valid|Custom subagent type changed/);
  refs[0] = 'config-v2';
  const disabled = await call('subagent.type.disable', {name: 'release-notes'});
  await call('subagent.type.confirm', {proposalId: disabled.proposalId, digest: disabled.digest, summary: disabled.summary});
  await assert.rejects(call('subagent.spawn', {subtasks: [{subtaskId: 'later', typeName: 'release-notes', goal: '停用后'}]}), {code: 'INVALID_ARGUMENT'});
  const builtin = createRuntimeSubagentDispatchTool({getRuntime: () => runtime});
  assert.equal(builtin.descriptor.name, SUBAGENT_DISPATCH_TOOL_NAME);
  assert.deepEqual(builtin.descriptor.inputSchema.properties.subtasks.items.properties.role.enum, ['researcher', 'coder', 'reviewer', 'planner', 'coordinator']);
  assert.equal(builtin.descriptor.inputSchema.properties.subtasks.items.properties.typeName, undefined);
});

test('a nested child cannot spawn or define types', async () => {
  const runtime = new TaskRuntime(':memory:');
  const child = runtime.submitTask({conversationId: 'desktop-subtask:parent', goal: '子任务', idempotencyKey: 'child'});
  const {pool} = controller(runtime);
  await assert.rejects(tool(pool, 'subagent.spawn').execute({subtasks: [{subtaskId: 'more', role: 'coder', goal: '递归'}]}, context(child.taskId)), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(tool(pool, 'subagent.type.list').execute({}, context(child.taskId)), {code: 'INVALID_ARGUMENT'});
});
