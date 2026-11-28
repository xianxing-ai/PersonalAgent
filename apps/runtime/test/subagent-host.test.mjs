import assert from 'node:assert/strict';
import test from 'node:test';
import {TaskRuntime} from '../dist/index.js';
import {createRuntimeSubagentDispatchTool, createDesktopSubagentDispatchTool} from '../dist/application.js';
import {createRuntimeApplication} from '../dist/application/runtime-application.js';
import {ModelGateway, FakeModelProvider} from '@personal-agent/models';

test('createRuntimeSubagentDispatchTool refuses to fabricate success without a model gateway', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({
    conversationId: 'desktop-panel',
    goal: '主任务：协同分析天气与工程差异',
    idempotencyKey: 'parent-task-1',
  });

  const tool = createRuntimeSubagentDispatchTool({
    getRuntime: () => runtime,
  });

  const context = {
    taskId: parent.taskId,
    runId: 'run-tool-1',
    signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    authorizationRef: `auth-${parent.taskId}`,
    scopes: ['agent:delegate'],
  };

  // 未配置模型网关：不再按角色生成固定「完成」文本（假成功），子任务失败并给出准确原因。
  const result = await tool.execute({
    subtasks: [
      {subtaskId: 'sub-1', role: 'researcher', goal: '调查北京天气趋势'},
      {subtaskId: 'sub-2', role: 'coder', goal: '审查工作区差异', model: 'deep-research'},
    ],
  }, context);

  assert.equal(result.total, 2);
  assert.equal(result.succeeded, 0);
  assert.equal(result.failed, 2);
  assert.equal(result.cancelled, 0);
  for (const subtask of result.subtasks) {
    assert.equal(subtask.state, 'failed');
    assert.match(subtask.error, /未配置或不受支持/);
  }

  // Runtime 中真实创建了子任务且终态为 failed（不冒充模型执行成功；错误信息在 error 上）。
  const child1 = runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-sub-1`);
  assert.ok(child1);
  assert.equal(child1.state, 'failed');
  assert.equal(child1.conversationId, `desktop-subtask:${parent.taskId}`);
  assert.match(child1.error?.message ?? '', /默认模型 未配置或不受支持/);
  const child2 = runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-sub-2`);
  assert.match(child2?.error?.message ?? '', /模型 deep-research 未配置或不受支持/);

  // 父子关联检查点仍写入（失败可诊断、可追溯）。
  const parentRef = runtime.loadCheckpoint(child1.taskId, 'subtask-parent');
  assert.equal(parentRef.parentTaskId, parent.taskId);
  assert.equal(parentRef.subtaskId, 'sub-1');
  assert.equal(parentRef.role, 'researcher');
});

test('createRuntimeSubagentDispatchTool rejects recursive delegation from subtask', async () => {
  const runtime = new TaskRuntime(':memory:');
  const child = runtime.submitTask({
    conversationId: 'desktop-subtask:parent-1',
    goal: '已有子任务',
    idempotencyKey: 'child-task-1',
  });

  const tool = createRuntimeSubagentDispatchTool({
    getRuntime: () => runtime,
  });

  const context = {
    taskId: child.taskId,
    runId: 'run-tool-2',
    signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    authorizationRef: `auth-${child.taskId}`,
    scopes: ['agent:delegate'],
  };

  await assert.rejects(tool.execute({
    subtasks: [{subtaskId: 'nested-1', role: 'coder', goal: '嵌套派发'}],
  }, context), {code: 'INVALID_ARGUMENT'});
});

test('runtimeApplication configureThinking independently presents stepBudget and modelReasoning', () => {
  const app = createRuntimeApplication({path: ':memory:'});
  const state = app.configureThinking({depth: 3, fast: true});

  assert.equal(state.depth, 3);
  assert.equal(state.fast, true);
  assert.equal(state.maxSteps, 6);
  assert.equal(state.stepBudget.maxSteps, 6);
  assert.equal(state.stepBudget.fast, true);
  assert.equal(state.modelReasoning.supported, false);
  assert.equal(state.modelReasoning.effort, 'medium');
  assert.match(state.modelReasoning.reason, /主模型当前未开放原生 reasoning 参数/);

  const readback = app.getThinkingState();
  assert.deepEqual(readback.stepBudget, state.stepBudget);
  assert.deepEqual(readback.modelReasoning, state.modelReasoning);
});

test('subagent forwards reasoning only when trusted host explicitly supports it', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({
    conversationId: 'desktop-panel',
    goal: '父级主任务',
    idempotencyKey: 'parent-model-test-1',
  });

  const capturedRequests = [];
  const fakeProvider = new FakeModelProvider([
    req => {
      capturedRequests.push(req);
      return {kind: 'final', text: '调研报告：根据事实检索完成天气分析'};
    },
    req => {
      capturedRequests.push(req);
      return {kind: 'final', text: '代码审查通过：已验证差异'};
    },
  ]);
  const gateway = new ModelGateway(fakeProvider);

  const tool = createRuntimeSubagentDispatchTool({
    getRuntime: () => runtime,
    getModelGateway: () => gateway,
    getModelReasoningEfforts: () => ['low', 'medium'],
  });

  const context = {
    taskId: parent.taskId,
    runId: 'model-dispatch-run',
    signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    authorizationRef: `auth-${parent.taskId}`,
    scopes: ['agent:delegate'],
  };

  const result = await tool.execute({
    subtasks: [
      {
        subtaskId: 'sub-research-model',
        role: 'researcher',
        roleLabel: '资料检索与调研',
        goal: '调研今日天气',
        model: 'deep-research',
        thinkingDepth: 3,
      },
      {
        subtaskId: 'sub-coding-model',
        role: 'coder',
        roleLabel: '代码与工程实现',
        goal: '审查工作区差异',
        model: 'code-fast',
        thinkingDepth: 1,
      },
    ],
  }, context);

  assert.equal(result.total, 2);
  assert.equal(result.succeeded, 2);
  assert.equal(capturedRequests.length, 2);

  // 校验子任务1的原生 reasoningEffort 和角色提示
  const req1 = capturedRequests[0];
  assert.equal(req1.reasoningEffort, 'medium'); // thinkingDepth: 3 -> 'medium'
  assert.equal(req1.messages[0].role, 'system');
  assert.match(req1.messages[0].content, /【资料检索与调研】\(researcher\)/);

  // 校验子任务2的原生 reasoningEffort 和角色提示
  const req2 = capturedRequests[1];
  assert.equal(req2.reasoningEffort, 'low'); // thinkingDepth: 1 -> 'low'
  assert.equal(req2.messages[0].role, 'system');
  assert.match(req2.messages[0].content, /【代码与工程实现】\(coder\)/);

  // 校验 Runtime 中子任务保存了真实模型返回结果与元数据
  const child1 = runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-sub-research-model`);
  assert.ok(child1);
  assert.equal(child1.state, 'succeeded');
  assert.match(child1.resultSummary, /调研报告：根据事实检索完成天气分析/);
  assert.match(child1.resultSummary, /model=fake\/fake-deployment\/fake-model/);

  // 校验汇总输出
  assert.match(result.aggregatedSummary, /调研报告：根据事实检索完成天气分析/);
});

test('subagent execution propagates parent cancellation to cancel inflight runtime child tasks', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({
    conversationId: 'desktop-panel',
    goal: '父级主任务：待取消',
    idempotencyKey: 'parent-cancel-test-1',
  });

  const parentController = new AbortController();

  let childStartedResolve;
  const childStarted = new Promise(resolve => { childStartedResolve = resolve; });

  const fakeProvider = new FakeModelProvider([
    async req => {
      childStartedResolve();
      return new Promise((_, reject) => {
        req.signal.addEventListener('abort', () => reject(new Error('Model request aborted')), {once: true});
      });
    },
  ]);
  const gateway = new ModelGateway(fakeProvider);

  const tool = createRuntimeSubagentDispatchTool({
    getRuntime: () => runtime,
    getModelGateway: () => gateway,
  });

  const context = {
    taskId: parent.taskId,
    runId: 'cancel-inflight-run',
    signal: parentController.signal,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    authorizationRef: `auth-${parent.taskId}`,
    scopes: ['agent:delegate'],
  };

  const dispatchPromise = tool.execute({
    subtasks: [
      {
        subtaskId: 'sub-inflight-cancel',
        role: 'researcher',
        goal: '长时间执行的任务',
        thinkingDepth: 2,
      },
    ],
  }, context);

  // 等待子任务已经进入执行
  await childStarted;

  // 父级中断 signal
  parentController.abort();

  const result = await dispatchPromise;
  assert.equal(result.total, 1);
  assert.equal(result.cancelled, 1);
  assert.equal(result.subtasks[0].state, 'cancelled');

  // 确认 TaskRuntime 中该子任务确实变成了 cancelled
  const childTask = runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-sub-inflight-cancel`);
  assert.ok(childTask);
  assert.equal(childTask.state, 'cancelled');
});

test('model registry resolves requested names to real gateways; unknown names refuse without assuming pangu', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '注册表解析验收', idempotencyKey: 'registry-parent-1'});
  const gateways = new Map();
  const tool = createDesktopSubagentDispatchTool({
    getRuntime: () => runtime,
    modelRegistry: {
      'deepseek-chat': name => {
        const gateway = new ModelGateway(new FakeModelProvider([() => ({kind: 'final', text: `由 ${name} 执行完成`})],
          {provider: 'openai-compatible', deployment: name, model: name, verification: 'conditional',
            capabilities: {text: true, streaming: false, toolCalling: true, structuredOutput: true, vision: false}}));
        gateways.set(name, gateway);
        return gateway;
      },
      'default': () => new ModelGateway(new FakeModelProvider([() => ({kind: 'final', text: '默认模型完成'})],
        {provider: 'openai-compatible', deployment: 'fallback', model: 'default', verification: 'conditional',
          capabilities: {text: true, streaming: false, toolCalling: true, structuredOutput: true, vision: false}})),
    },
  });
  const context = {taskId: parent.taskId, runId: 'registry-run-1', signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000).toISOString(), authorizationRef: `auth-${parent.taskId}`,
    scopes: ['agent:delegate']};

  // 注册过的名字 → 解析到对应网关（真实 provider 标识）。
  const named = await tool.execute({subtasks: [{subtaskId: 'sub-named', role: 'researcher', goal: 'x', model: 'deepseek-chat'}]}, context);
  assert.equal(named.succeeded, 1);
  assert.ok(gateways.has('deepseek-chat'), 'the requested model resolved through the registry');
  assert.match(named.subtasks[0].result, /openai-compatible\/deepseek-chat/);

  // 未指名 → default 回退。
  const fallback = await tool.execute({subtasks: [{subtaskId: 'sub-fallback', role: 'researcher', goal: 'x'}]}, context);
  assert.equal(fallback.succeeded, 1);
  assert.match(fallback.subtasks[0].result, /默认模型完成/);

  // 未注册且无匹配 → 子任务 failed，错误明确指向未注册模型（不假定盘古）。
  const unknown = await tool.execute({subtasks: [{subtaskId: 'sub-unknown', role: 'researcher', goal: 'x', model: 'not-registered'}]}, context);
  assert.equal(unknown.failed, 1);
  assert.match(unknown.subtasks[0].error, /not-registered 未配置或不受支持/);
});

test('registry lookup ignores inherited object properties', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '拒绝原型键模型', idempotencyKey: 'registry-prototype-parent'});
  const tool = createDesktopSubagentDispatchTool({getRuntime: () => runtime, modelRegistry: {
    'configured-model': () => new ModelGateway(new FakeModelProvider([() => ({kind: 'final', text: 'ok'})],
      {provider: 'openai-compatible', deployment: 'configured-model', model: 'configured-model', verification: 'conditional',
        capabilities: {text: true, streaming: false, toolCalling: true, structuredOutput: true, vision: false}})),
  }});
  const result = await tool.execute({subtasks: [{subtaskId: 'sub-prototype', role: 'researcher', goal: 'x', model: 'constructor'}]}, {
    taskId: parent.taskId, runId: 'registry-prototype-run', signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000).toISOString(), authorizationRef: 'auth-prototype', scopes: ['agent:delegate'],
  });
  assert.equal(result.failed, 1);
  assert.match(result.subtasks[0].error, /constructor 未配置或不受支持/);
});

test('after two failed subtasks, reusing a failed subtaskId with modified goal returns stopNotice instead of crashing with REVISION_CONFLICT', async () => {
  const runtime = new TaskRuntime(':memory:');
  const parent = runtime.submitTask({conversationId: 'desktop-panel', goal: '取消日程重试上限', idempotencyKey: 'retry-cap-parent'});
  const tool = createRuntimeSubagentDispatchTool({getRuntime: () => runtime});
  const ctx = n => ({
    taskId: parent.taskId, runId: `retry-cap-run-${n}`, signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000).toISOString(), authorizationRef: 'auth-retry-cap', scopes: ['agent:delegate'],
  });
  const r1 = await tool.execute({subtasks: [{subtaskId: 'cancel-1', role: 'coordinator', goal: 'attempt 1'}]}, ctx(1));
  assert.equal(r1.failed, 1);
  // Before reaching 2 failures, mutating an existing subtaskId still throws REVISION_CONFLICT.
  await assert.rejects(
    tool.execute({subtasks: [{subtaskId: 'cancel-1', role: 'coordinator', goal: 'mutated early'}]}, ctx(2)),
    {code: 'REVISION_CONFLICT'},
  );
  const r2 = await tool.execute({subtasks: [{subtaskId: 'cancel-2', role: 'coordinator', goal: 'attempt 2'}]}, ctx(3));
  assert.equal(r2.failed, 1);
  // Once >=2 subtasks have failed, even reusing cancel-1 with modified goal returns stopNotice cleanly.
  const r3 = await tool.execute({subtasks: [{subtaskId: 'cancel-1', role: 'coordinator', goal: 'attempt 3 with modified goal'}]}, ctx(4));
  assert.equal(r3.failed, 1);
  assert.match(r3.summary, /同一轮对话已有多次工人执行失败/);
});

test('failed subtask with prior confirmed external_write preserves write receipt in error and blocks duplicate coder retry while allowing researcher', async () => {
  const {createRuntimeApplication} = await import('../dist/application.js');
  const {FakeCoordinationPort} = await import('@personal-agent/coordination/testing');
  const {toolArgumentsDigest} = await import('@personal-agent/tool-gateway');
  let commentExecutions = 0;
  const commentDescriptor = {
    name: 'github.pr.comment', version: '0.1.0-alpha.1', sideEffect: 'external_write',
    requiredScopes: ['github:write'], idempotencySupport: false, recoverySupport: false, requiresPresence: false,
    inputSchema: {type: 'object', required: ['repo', 'number', 'body'], additionalProperties: false, properties: {repo: {type: 'string'}, number: {type: 'integer'}, body: {type: 'string'}}},
    outputSchema: {type: 'object', required: ['state', 'evidenceRefs'], additionalProperties: false, properties: {state: {type: 'string'}, externalId: {type: 'string'}, url: {type: 'string'}, evidenceRefs: {type: 'array', items: {type: 'string'}}}},
  };
  const issueGetDescriptor = {
    name: 'github.issue.get', version: '0.1.0-alpha.1', sideEffect: 'read',
    requiredScopes: ['github:read'], idempotencySupport: true, recoverySupport: true, requiresPresence: false,
    inputSchema: {type: 'object', required: ['repo', 'number'], additionalProperties: false, properties: {repo: {type: 'string'}, number: {type: 'integer'}}},
    outputSchema: {type: 'object'},
  };
  const app = createRuntimeApplication({
    path: ':memory:',
    profile: 'huawei_ict_agentarts',
    tools: [
      {
        descriptor: commentDescriptor,
        execute: async () => {
          commentExecutions++;
          return {state: 'confirmed', externalId: '7238391922', url: 'https://github.com/acme/app/pull/736#issuecomment-7238391922', evidenceRefs: []};
        },
      },
      {
        descriptor: issueGetDescriptor,
        execute: async () => {
          throw new ProtocolError('INVALID_ARGUMENT', 'Requested issue is a pull request');
        },
      },
    ],
    automaticTools: [
      {toolName: 'github.issue.get', toolVersion: '0.1.0-alpha.1'},
    ],
    coordination: new FakeCoordinationPort(() => ({kind: 'text', text: 'unused', verification: 'mock'})),
  });
  try {
    const parent = app.runtime.submitTask({conversationId: 'desktop-panel', goal: '给 PR #736 评论', idempotencyKey: 'dup-write-parent'});
    const tool = createRuntimeSubagentDispatchTool({
      competitionOnly: true,
      getRuntime: () => app.runtime,
      getTools: () => app.tools,
      runDefaultWorker: async (subtask, childWorker, childTools) => {
        if (subtask.role === 'researcher') {
          return {resultSummary: 'PR #736 只读复核完成', evidenceRefs: []};
        }
        const runId = `competition-tool-${childWorker.taskId}-1`;
        const commentArgs = {repo: 'acme/app', number: 736, body: '实机验收通过'};
        app.runtime.policy.grant({
          authorizationRef: runId,
          taskId: childWorker.taskId,
          toolName: 'github.pr.comment',
          scopes: ['github:write'],
          expiresAt: childWorker.deadline,
          maxUses: 1,
          argumentsDigest: toolArgumentsDigest(commentArgs),
        });
        const confirmedRes = await childTools.invoke({
          toolName: 'github.pr.comment', toolVersion: '0.1.0-alpha.1',
          arguments: commentArgs,
          taskId: childWorker.taskId, runId, authorizationRef: runId, deadline: childWorker.deadline, signal: childWorker.signal,
        });
        assert.equal(confirmedRes.state, 'confirmed');
        childWorker.saveCheckpoint('competition-loop', {
          executionEpoch: 0, step: 2, evidenceRefs: [runId],
          receipts: [{runId, proposal: {toolName: 'github.pr.comment', arguments: {repo: 'acme/app', number: 736, body: '实机验收通过'}}, continuation: {state: 'confirmed'}}],
        });
        const runId2 = `competition-tool-${childWorker.taskId}-2`;
        await childTools.invoke({
          toolName: 'github.issue.get', toolVersion: '0.1.0-alpha.1',
          arguments: {repo: 'acme/app', number: 736},
          taskId: childWorker.taskId, runId: runId2, authorizationRef: runId2, deadline: childWorker.deadline, signal: childWorker.signal,
        });
        return {resultSummary: 'unreachable', evidenceRefs: []};
      },
    });
    const ctx = n => ({
      taskId: parent.taskId, runId: `dup-write-run-${n}`, signal: new AbortController().signal,
      deadline: new Date(Date.now() + 60_000).toISOString(), authorizationRef: 'auth-dup', scopes: ['agent:delegate'],
    });

    const first = await tool.execute({subtasks: [{subtaskId: 'pr-comment-1', role: 'coder', goal: '发评论并读回'}]}, ctx(1));
    assert.equal(first.failed, 1);
    assert.equal(commentExecutions, 1);
    assert.match(first.subtasks[0].error, /已完成真实写入：github\.pr\.comment\(repo=acme\/app, number=736\)/);
    assert.match(first.summary, /请勿重派写操作以免重复写入/);

    // Attempting to retry with another coder worker is blocked immediately without running comment a 2nd time!
    const retryWrite = await tool.execute({subtasks: [{subtaskId: 'pr-comment-retry', role: 'coder', goal: '重发评论'}]}, ctx(2));
    assert.equal(retryWrite.failed, 1);
    assert.equal(commentExecutions, 1);
    assert.match(retryWrite.summary, /为防止重复外部写入已拦截本次写工人重派/);

    // Dispatching a read-only researcher is still permitted!
    const readBack = await tool.execute({subtasks: [{subtaskId: 'pr-readonly-check', role: 'researcher', goal: '只读检查 PR'}]}, ctx(3));
    assert.equal(readBack.succeeded, 1, JSON.stringify(readBack));
    assert.match(readBack.summary, /只读复核完成/);
  } finally {
    app.close();
  }
});
