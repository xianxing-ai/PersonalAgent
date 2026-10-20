import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dispatchSubtasks,
  createSubagentDispatchTool,
  SUBAGENT_DISPATCH_TOOL_NAME,
  SUBAGENT_DISPATCH_TOOL_VERSION,
  DEFAULT_ROLE_LABELS,
} from '../dist/index.js';

function mockContext() {
  const checkpoints = new Map();
  const progressList = [];
  const controller = new AbortController();
  return {
    taskId: 'task-subagent-1',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: controller.signal,
    controller,
    saveCheckpoint(key, value) { checkpoints.set(key, value); },
    loadCheckpoint(key) { return checkpoints.get(key); },
    reportProgress(p) { progressList.push(p); return undefined; },
    progressList,
    checkpoints,
  };
}

test('dispatchSubtasks executes defined subtasks with roles and aggregates summary', async () => {
  const ctx = mockContext();
  const subtasks = [
    {subtaskId: 's1', role: 'researcher', goal: '调查北京天气趋势'},
    {subtaskId: 's2', role: 'coder', goal: '审查代码工作区差异'},
    {subtaskId: 's3', role: 'reviewer', goal: '核对出行与发布建议'},
  ];

  const summary = await dispatchSubtasks(ctx, subtasks, async (sub, signal) => {
    assert.equal(signal.aborted, false);
    if (sub.role === 'researcher') return '北京今天晴，气温 15-26℃，适宜出行';
    if (sub.role === 'coder') return '工作区修改包含 3 个文件，未检测到破坏性变更';
    if (sub.role === 'reviewer') return '出行与发布建议均已核对，风险等级低';
    return 'ok';
  });

  assert.equal(summary.total, 3);
  assert.equal(summary.succeeded, 3);
  assert.equal(summary.failed, 0);
  assert.equal(summary.cancelled, 0);
  assert.equal(summary.subtasks.length, 3);
  assert.equal(summary.subtasks[0].roleLabel, DEFAULT_ROLE_LABELS.researcher);
  assert.match(summary.aggregatedSummary, /次级智能体协作汇总/);
  assert.match(summary.aggregatedSummary, /资料检索与调研/);
  assert.match(summary.aggregatedSummary, /代码与工程实现/);
  assert.match(summary.aggregatedSummary, /质量与安全审查/);

  // Check progress reports
  assert.ok(ctx.progressList.length >= 6);
  assert.ok(ctx.progressList.some(p => p.stepId === 'subtask-s1' && p.label.includes('正在执行')));
  assert.ok(ctx.progressList.some(p => p.stepId === 'subtask-s1' && p.label.includes('执行完成')));
  assert.ok(ctx.progressList.some(p => p.stepId === 'subtask-s2'));
  assert.ok(ctx.progressList.some(p => p.stepId === 'subtask-s3'));

  // Check checkpoint was saved
  const saved = ctx.loadCheckpoint('subtask-progress-records');
  assert.ok(saved);
  assert.equal(saved.s1.state, 'succeeded');
  assert.equal(saved.s2.state, 'succeeded');
  assert.equal(saved.s3.state, 'succeeded');
});

test('dispatchSubtasks propagates cancellation cleanly', async () => {
  const ctx = mockContext();
  const subtasks = [
    {subtaskId: 's1', role: 'researcher', goal: '长期分析'},
    {subtaskId: 's2', role: 'reviewer', goal: '二次审核'},
  ];

  const summary = await dispatchSubtasks(ctx, subtasks, async (sub, signal) => {
    if (sub.subtaskId === 's1') {
      ctx.controller.abort();
      throw new Error('Aborted');
    }
    return 'ok';
  });

  assert.equal(summary.cancelled, 2);
  assert.equal(summary.subtasks[0].state, 'cancelled');
  assert.equal(summary.subtasks[1].state, 'cancelled');
});

test('createSubagentDispatchTool provides valid ToolDescriptor and execute bridge', async () => {
  let invoked = false;
  const tool = createSubagentDispatchTool(async (input, context) => {
    invoked = true;
    assert.equal(input.subtasks.length, 1);
    assert.equal(context.taskId, 'test-task');
    return {total: 1, succeeded: 1, failed: 0, cancelled: 0, summary: 'all good'};
  });

  assert.equal(tool.descriptor.name, SUBAGENT_DISPATCH_TOOL_NAME);
  assert.equal(tool.descriptor.version, SUBAGENT_DISPATCH_TOOL_VERSION);
  assert.equal(tool.descriptor.sideEffect, 'read');
  assert.deepEqual(tool.descriptor.requiredScopes, ['agent:delegate']);

  const result = await tool.execute({
    subtasks: [{subtaskId: '1', role: 'planner', goal: '拆分步骤'}],
  }, {taskId: 'test-task', runId: 'run-1', signal: new AbortController().signal, deadline: '', authorizationRef: '', scopes: ['agent:delegate']});

  assert.equal(invoked, true);
  assert.deepEqual(result, {total: 1, succeeded: 1, failed: 0, cancelled: 0, summary: 'all good'});
});

test('createSubagentDispatchTool rejects missing handler', () => {
  assert.throws(() => createSubagentDispatchTool(), {code: 'INVALID_ARGUMENT'});
});

test('dispatchSubtasks rejects duplicate subtaskId', async () => {
  const ctx = mockContext();
  await assert.rejects(dispatchSubtasks(ctx, [
    {subtaskId: 'dup-1', role: 'planner', goal: 'step 1'},
    {subtaskId: 'dup-1', role: 'coder', goal: 'step 2'},
  ], async () => 'ok'), {code: 'INVALID_ARGUMENT'});
});

test('dispatchSubtasks rejects reusing completed result if subtask input changed', async () => {
  const ctx = mockContext();
  // First run
  await dispatchSubtasks(ctx, [
    {subtaskId: 'task-a', role: 'researcher', goal: '原始目标'},
  ], async () => '原始结果');

  // Second run with changed goal for same subtaskId
  await assert.rejects(dispatchSubtasks(ctx, [
    {subtaskId: 'task-a', role: 'researcher', goal: '改变后的目标'},
  ], async () => '新结果'), {code: 'REVISION_CONFLICT'});
});


test('a single successful subtask passes its answer through without the coordination header', async () => {
  const ctx = mockContext();
  const summary = await dispatchSubtasks(ctx, [{subtaskId: 'only', role: 'researcher', goal: '查询北京下午天气'}],
    async () => '北京今天下午多云，气温 12–18℃，适合跑步。');
  assert.equal(summary.total, 1);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.aggregatedSummary, '北京今天下午多云，气温 12–18℃，适合跑步。');
  assert.doesNotMatch(summary.aggregatedSummary, /次级智能体协作汇总/);
});
