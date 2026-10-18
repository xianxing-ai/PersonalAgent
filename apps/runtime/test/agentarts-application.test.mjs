import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {test} from 'node:test';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '../dist/application.js';

const event = text => ({event: 'message', data: {text, index: 0}});

async function terminal(app, taskId, states = ['succeeded', 'failed', 'cancelled']) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const task = app.runtime.getTask(taskId);
    if (states.includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('Task did not settle');
}

for (const workflowGoalInput of [undefined, 'goal']) {
test(`trusted factory runs the competition HTTP adapter without local fallback (${workflowGoalInput ?? 'agent'})`, async () => {
  const base = new URL('../../../.cache/agentarts-application-tests/', import.meta.url);
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(new URL('case-', base));
  const calls = [];
  let authorizationReads = 0;
  const app = createAgentArtsRuntimeApplication({
    path: directory + '/runtime.sqlite',
    gatewayUrl: 'https://agentarts.example.test',
    runtimeName: 'pa-runtime',
    invokeMode: 'published',
    ...(workflowGoalInput === undefined ? {} : {workflowGoalInput}),
    authorizationProvider: {
      read: async () => {
        authorizationReads += 1;
        return 'Bearer synthetic-token';
      },
    },
    fetchImpl: async (url, init) => {
      calls.push({url, init});
      return new Response(JSON.stringify(event('合成任务已分析')), {
        status: 200,
        headers: {'content-type': 'application/json'},
      });
    },
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const submitted = await client.call(
      'task.submit',
      {goal: '只分析合成事实，不执行工具', conversationId: 'competition'},
      {idempotencyKey: 'agentarts-runtime-factory'},
    );
    const task = await terminal(app, submitted.taskId);
    assert.equal(task.state, 'succeeded');
    assert.match(task.resultSummary, /合成任务已分析/);
    assert.match(task.resultSummary, /profile=huawei_ict_agentarts; verification=unverified/);
    assert.deepEqual(task.evidenceRefs, []);
    assert.equal(authorizationReads, 1);
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].init.body), workflowGoalInput === undefined
      ? {query: '只分析合成事实，不执行工具'}
      : {inputs: {goal: '只分析合成事实，不执行工具'}});
    assert.equal(calls[0].url, 'https://agentarts.example.test/runtimes/pa-runtime/invocations');
    assert.throws(() => app.configureText({mode: 'fake'}), /unavailable/);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});
}

test('HTTP 200 stream error after a partial message fails the task without persisting the partial answer', async () => {
  const base = new URL('../../../.cache/agentarts-application-tests/', import.meta.url);
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(new URL('stream-error-', base));
  const app = createAgentArtsRuntimeApplication({
    path: directory + '/runtime.sqlite',
    gatewayUrl: 'https://agentarts.example.test',
    runtimeName: 'pa-runtime',
    invokeMode: 'published',
    authorizationProvider: {read: async () => 'Bearer synthetic-token'},
    fetchImpl: async () => new Response([
      `data: ${JSON.stringify(event('部分回答'))}`,
      '',
      `data: ${JSON.stringify({event: 'error', data: {message: 'synthetic provider failure'}})}`,
      '',
    ].join('\n'), {
      status: 200,
      headers: {'content-type': 'text/event-stream'},
    }),
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const submitted = await client.call(
      'task.submit',
      {goal: '验证流式失败传播', conversationId: 'competition'},
      {idempotencyKey: 'agentarts-stream-error'},
    );
    const task = await terminal(app, submitted.taskId);
    assert.equal(task.state, 'failed');
    assert.equal(task.error.code, 'EXTERNAL_FAILURE');
    assert.equal(task.error.message, 'Coordination adapter failed');
    assert.equal(task.resultSummary, undefined);
    assert.equal(app.readEvents().some(item => item.type === 'task.completed'), false);
    assert.equal(app.readEvents().some(item => item.type === 'task.failed'), true);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('invalid AgentArts deployment configuration fails before creating Runtime storage', async () => {
  const base = new URL('../../../.cache/agentarts-application-tests/', import.meta.url);
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(new URL('invalid-', base));
  const path = directory + '/must-not-exist.sqlite';
  try {
    assert.throws(() => createAgentArtsRuntimeApplication({
      path,
      gatewayUrl: 'http://insecure.example.test',
      runtimeName: 'pa-runtime',
      authorizationProvider: {read: async () => 'unused'},
    }), /HTTPS/);
    await assert.rejects(import('node:fs/promises').then(({access}) => access(path)));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('trusted factory forwards the configured workflow start input', async () => {
  const bodies = [];
  const app = createAgentArtsRuntimeApplication({
    path: ':memory:', gatewayUrl: 'https://agentarts.example.test', runtimeName: 'workflow',
    workflowGoalInput: 'goal', authorizationProvider: {read: async () => 'Bearer synthetic-token'},
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify(event('Synthetic workflow result')), {
        status: 200, headers: {'content-type': 'application/json'},
      });
    },
  });
  try {
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Synthetic meeting', conversationId: 'workflow'}, {idempotencyKey: 'workflow'});
    assert.equal((await terminal(app, taskId)).state, 'succeeded');
    assert.deepEqual(bodies, [{inputs: {goal: 'Synthetic meeting'}}]);
  } finally { app.close(); }
});

test('explicit JSON mode binds real adapter sends to current Runtime export permission', async t => {
  for (const revokeDuringCredentials of [false, true]) await t.test(`credential-time revocation=${revokeDuringCredentials}`, async () => {
  const requests = [];
  let executions = 0;
  let permitted = true;
  let credentialReads = 0;
  const proposal = {kind: 'tool_proposal', proposalId: 'synthetic-meeting-1',
    toolName: 'fixture.meeting', toolVersion: '1.0.0', arguments: {id: 'synthetic-meeting'}};
  const app = createAgentArtsRuntimeApplication({
    path: ':memory:', gatewayUrl: 'https://agentarts.example.test', runtimeName: 'workflow',
    responseMode: 'tool-proposal-json', authorizationProvider: {read: async () => {
      credentialReads++;
      if (credentialReads === 2 && revokeDuringCredentials) {
        await new Promise(resolve => setImmediate(resolve));
        permitted = false;
      }
      return 'Bearer synthetic-token';
    }},
    competitionToolExports: [{toolName: proposal.toolName, toolVersion: proposal.toolVersion,
      exportPolicyVersion: 'synthetic-v1',
      accepts: ({arguments: args}) => permitted && args.id === 'synthetic-meeting', project: ({result}) => ({time: result.time})}],
    tools: [{descriptor: {name: proposal.toolName, version: proposal.toolVersion,
      inputSchema: {type: 'object', required: ['id'], additionalProperties: false, properties: {id: {type: 'string'}}},
      outputSchema: {type: 'object', required: ['time', 'localOnly'], additionalProperties: false,
        properties: {time: {type: 'string'}, localOnly: {type: 'string'}}},
      sideEffect: 'read', requiredScopes: ['fixture:read'], idempotencySupport: true,
      recoverySupport: true, requiresPresence: false},
    execute: async () => {executions++; return {time: '17:00', localOnly: 'synthetic-private-marker'};}}],
    fetchImpl: async (_url, init) => {
      requests.push({headers: new Headers(init.headers), body: JSON.parse(init.body)});
      const result = requests.length === 1 ? proposal : {kind: 'text', text: 'Synthetic meeting confirmed at 17:00'};
      return new Response(JSON.stringify(event(JSON.stringify(result))), {
        status: 200, headers: {'content-type': 'application/json'},
      });
    },
  });
  try {
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Synthetic meeting', conversationId: 'json-mode'},
      {idempotencyKey: 'json-mode'});
    for (let i = 0; i < 200 && app.runtime.getTask(taskId).state !== 'waiting_approval'; i++) {
      if (['succeeded', 'failed'].includes(app.runtime.getTask(taskId).state)) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(app.runtime.getTask(taskId).state, 'waiting_approval');
    assert.equal(requests.length, 1);
    assert.equal(executions, 0);
    const approval = (await client.call('approval.list', {taskId})).items[0];
    await client.call('authorization.respond', {approvalId: approval.approvalId,
      expectedRevision: approval.revision, decision: 'allow_once'});
    const task = await terminal(app, taskId,revokeDuringCredentials ? ['waiting_reconciliation'] : undefined);
    assert.equal(executions, 1);
    assert.equal(app.runtime.readToolExecutions(taskId).length, 1);
    if (revokeDuringCredentials) {
      assert.equal(task.state, 'waiting_reconciliation');
      assert.equal(task.error.code,'UNAUTHORIZED');
      assert.deepEqual(app.runtime.loadCheckpoint(taskId,'competition-export-withheld'),{withheld:true});
      assert.equal(app.runtime.readToolExecutions(taskId)[0].state,'confirmed');
      assert.equal(requests.length, 1);
      assert.equal(app.runtime.readEvidence(taskId).length, 1);
      return;
    }
    assert.equal(task.state, 'succeeded');
    assert.match(task.resultSummary, /17:00/);
    assert.match(task.resultSummary, /verification=unverified/);
    assert.equal(executions, 1);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].body, {query: 'Synthetic meeting'});
    assert.deepEqual(JSON.parse(requests[1].body.query), {continuation: {
      proposalId: proposal.proposalId, state: 'confirmed', result: {time: '17:00'},
    }});
    const firstRequestId = requests[0].headers.get('X-Request-Id');
    assert.ok(firstRequestId);
    assert.notEqual(requests[1].headers.get('X-Request-Id'), firstRequestId);
    assert.doesNotMatch(JSON.stringify(requests.map(request => request.body)), /synthetic-private-marker|authorizationRef|evidenceRefs/);
    assert.deepEqual(task.evidenceRefs, [approval.approvalId]);
    assert.equal(app.runtime.readToolExecutions(taskId).length, 1);
  } finally { app.close(); }
  });
});

test('JSON SSE terminal errors never reach factory approval or tool execution', async t => {
  const proposal = {kind: 'tool_proposal', proposalId: 'synthetic-read',
    toolName: 'fixture.meeting', toolVersion: '1.0.0', arguments: {id: 'synthetic'}};
  const message = {event: 'message', data: {text: JSON.stringify(proposal)}};
  for (const [name, sequence] of [
    ['missing terminal', [message]],
    ['reversed terminal', [message, {event: 'end'}, {event: 'task_end'}]],
    ['error after DONE', [message, {event: 'task_end'}, {event: 'end'}, '[DONE]',
      {event: 'error', data: {message: 'private error'}}]],
  ]) await t.test(name, async () => {
    let executions = 0;
    let fetches = 0;
    const app = createAgentArtsRuntimeApplication({path: ':memory:',
      gatewayUrl: 'https://agentarts.example.test', runtimeName: 'workflow',
      responseMode: 'tool-proposal-json', authorizationProvider: {read: async () => 'Bearer synthetic'},
      competitionToolExports: [{toolName: proposal.toolName, toolVersion: proposal.toolVersion,
        exportPolicyVersion: 'fixture-v1', accepts: () => true, project: ({result}) => ({time: result.time})}],
      tools: [{descriptor: {name: proposal.toolName, version: proposal.toolVersion,
        inputSchema: {type: 'object', required: ['id'], properties: {id: {type: 'string'}}},
        outputSchema: {type: 'object', required: ['time'], properties: {time: {type: 'string'}}},
        sideEffect: 'read', requiredScopes: ['fixture:read'],
        idempotencySupport: true, recoverySupport: true, requiresPresence: false},
      execute: async () => {executions++; return {time: '17:00'};}}],
      fetchImpl: async () => {fetches++;
        return new Response(sequence.map(item => `data: ${typeof item === 'string' ? item : JSON.stringify(item)}\n\n`).join(''),
          {headers: {'content-type': 'text/event-stream'}});
      },
    });
    try {
      const client = new Client(app);
      await client.connect();
      const {taskId} = await client.call('task.submit', {goal: 'Synthetic SSE rejection',
        conversationId: 'json-mode'}, {idempotencyKey: name});
      assert.equal((await terminal(app, taskId)).state, 'failed');
      assert.equal(fetches, 1);
      assert.equal(executions, 0);
      assert.deepEqual((await client.call('approval.list', {taskId})).items, []);
      assert.deepEqual(app.runtime.readToolExecutions(taskId), []);
    } finally {app.close();}
  });
});

test('opt-in factory sends only the selected public tool catalog and rechecks host health after credentials', async t => {
  for (const revokeDuringCredentials of [false, true]) await t.test(`revoked=${revokeDuringCredentials}`, async () => {
    let healthy = true;
    const bodies = [];
    const toolName = 'fixture.read';
    const app = createAgentArtsRuntimeApplication({path: ':memory:',
      gatewayUrl: 'https://agentarts.example.test', runtimeName: 'workflow',
      responseMode: 'tool-proposal-json', initialRequestMode: 'goal-with-tools-json',
      authorizationProvider: {read: async () => {
        if (revokeDuringCredentials) healthy = false;
        return 'Bearer synthetic-token';
      }},
      tools: [{descriptor: {name: toolName, version: '1.0.0',
        inputSchema: {type: 'object', required: ['id'], additionalProperties: false,
          description: 'private fixture marker', properties: {id: {type: 'string',
            enum: ['private fixture marker']}}},
        outputSchema: {type: 'object', required: ['value'], properties: {value: {type: 'string'}}},
        sideEffect: 'read', requiredScopes: ['fixture:read'],
        idempotencySupport: true, recoverySupport: true, requiresPresence: false},
      execute: async () => ({value: 'local-only'})}],
      competitionToolExports: [{toolName, toolVersion: '1.0.0', exportPolicyVersion: 'fixture-v1',
        accepts: () => true, project: ({result}) => ({value: result.value})}],
      competitionToolAvailability: [{toolName, toolVersion: '1.0.0', available: () => healthy}],
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify(event(JSON.stringify({kind: 'text', text: 'Synthetic catalog accepted'}))),
          {status: 200, headers: {'content-type': 'application/json'}});
      },
    });
    try {
      const client = new Client(app);
      await client.connect();
      const {taskId} = await client.call('task.submit', {goal: 'Synthetic public read',
        conversationId: 'catalog'}, {idempotencyKey: `catalog-${revokeDuringCredentials}`});
      const task = await terminal(app, taskId);
      if (revokeDuringCredentials) {
        assert.equal(task.state, 'failed');
        assert.deepEqual(bodies, []);
      } else {
        assert.equal(task.state, 'succeeded');
        assert.deepEqual(JSON.parse(bodies[0].query), {goal: 'Synthetic public read', availableTools: [{
          name: toolName, version: '1.0.0', inputSchema: {type: 'object', required: ['id'],
            additionalProperties: false, properties: {id: {type: 'string'}}},
        }]});
        assert.doesNotMatch(JSON.stringify(bodies), /private fixture marker|local-only/);
      }
    } finally {app.close();}
  });
});

test('factory rejects a catalog without explicit initial request mode', () => {
  assert.throws(() => createAgentArtsRuntimeApplication({path: ':memory:',
    gatewayUrl: 'https://agentarts.example.test', runtimeName: 'workflow',
    responseMode: 'tool-proposal-json', authorizationProvider: {read: async () => 'Bearer synthetic'},
    competitionToolAvailability: [],
  }), /explicit initial request mode/);
});

test('factory retains raw adapter synchronous validation of the host send guard', async t => {
  for (const mode of ['pending', 'resolved', 'rejected', 'sync', 'throw']) await t.test(mode, async () => {
    let fetches = 0;
    let guardCalls = 0;
    let release;
    const diagnostics = [];
    const app = createAgentArtsRuntimeApplication({path: ':memory:',
      gatewayUrl: 'https://agentarts.example.test', runtimeName: 'send-guard',
      authorizationProvider: {read: async () => 'Bearer synthetic'},
      onDiagnostic: receipt => diagnostics.push(receipt),
      beforeCompetitionSend: request => {
        guardCalls++;
        assert.equal(Object.isFrozen(request), true);
        if (mode === 'pending') return new Promise(resolve => {release = resolve;});
        if (mode === 'resolved') return Promise.resolve();
        if (mode === 'rejected') {
          const rejected = Promise.reject(Error('private-guard-canary'));
          // Keep the original factory reproduction from producing an unrelated
          // process rejection; the guard result itself must still be rejected.
          void rejected.catch(() => undefined);
          return rejected;
        }
        if (mode === 'throw') throw Error('private-guard-canary');
      },
      fetchImpl: async () => {
        fetches++;
        return new Response(JSON.stringify(event('Synthetic guard result')), {
          headers: {'content-type': 'application/json'},
        });
      },
    });
    try {
      const client = new Client(app); await client.connect();
      const {taskId} = await client.call('task.submit', {goal: 'Synthetic send guard', conversationId: 'send-guard'},
        {idempotencyKey: mode});
      const task = await terminal(app, taskId);
      assert.equal(guardCalls, 1);
      assert.equal(fetches, mode === 'sync' ? 1 : 0);
      assert.equal(task.state, mode === 'sync' ? 'succeeded' : 'failed');
      assert.deepEqual(app.runtime.readToolExecutions(taskId), []);
      assert.doesNotMatch(JSON.stringify({task, diagnostics}), /private-guard-canary/);
      if (mode === 'sync') assert.deepEqual(diagnostics, []);
      else {
        assert.equal(task.error.code, 'EXTERNAL_FAILURE');
        assert.equal(task.error.message, 'Coordination adapter failed');
        assert.equal(diagnostics.length, 1);
        assert.equal(diagnostics[0].stage, 'export_guard');
        assert.equal(diagnostics[0].code, 'UNAUTHORIZED');
      }
    } finally {release?.(); app.close();}
  });
});

test('coordination input guards enforce synchronous void before preparation export and after credentials', async t => {
  for (const phase of [1, 2]) for (const mode of ['pending', 'resolved', 'late-rejection', 'number', 'throw', 'sync', 'microtask']) {
    await t.test(`phase=${phase} ${mode}`, async () => {
      let guards = 0;
      let reads = 0;
      let fetches = 0;
      let replies = 0;
      let sendAllowed = true;
      let release;
      let reject;
      const diagnostics = [];
      const app = createAgentArtsRuntimeApplication({path: ':memory:',
        gatewayUrl: 'https://agentarts.example.test', runtimeName: 'input-guard',
        authorizationProvider: {read: async () => {reads++; return 'Bearer synthetic';}},
        onDiagnostic: receipt => diagnostics.push(receipt),
        coordinationInput: {
          prepareCoordinationGoal: async () => 'Synthetic prepared input',
          beforeCoordinationSend: (request, scope) => {
            guards++;
            assert.equal(request.goal, 'Synthetic prepared input');
            assert.deepEqual(scope, {publicGoal: 'Synthetic public input', preparedGoal: 'Synthetic prepared input'});
            if (guards !== phase) return;
            if (mode === 'pending') return new Promise(resolve => {release = resolve;});
            if (mode === 'resolved') return Promise.resolve();
            if (mode === 'late-rejection') return new Promise((_resolve, fail) => {reject = fail;});
            if (mode === 'number') return 1;
            if (mode === 'throw') throw Error('private-input-guard-canary');
            if (mode === 'microtask' && phase === 2) queueMicrotask(() => {sendAllowed = false;});
          },
          onEphemeralReply: () => {replies++;},
        },
        fetchImpl: async (_url, init) => {
          fetches++;
          assert.equal(sendAllowed, true);
          assert.equal(JSON.parse(init.body).query, 'Synthetic prepared input');
          return new Response(JSON.stringify(event('Synthetic input reply')), {
            headers: {'content-type': 'application/json'},
          });
        },
      });
      try {
        const client = new Client(app); await client.connect();
        const {taskId} = await client.call('task.submit', {goal: 'Synthetic public input', conversationId: 'input-guard'},
          {idempotencyKey: `${phase}-${mode}`});
        const task = await terminal(app, taskId);
        const allowed = mode === 'sync' || mode === 'microtask';
        assert.equal(task.state, allowed ? 'succeeded' : 'failed');
        assert.equal(guards, allowed ? 2 : phase);
        assert.equal(reads, allowed || phase === 2 ? 1 : 0);
        assert.equal(fetches, allowed ? 1 : 0);
        assert.equal(replies, allowed ? 1 : 0);
        if (mode === 'late-rejection') {
          reject(Error('private-input-guard-canary'));
          await new Promise(resolve => setImmediate(resolve));
        }
        assert.deepEqual(app.runtime.readToolExecutions(taskId), []);
        assert.doesNotMatch(JSON.stringify({task, diagnostics}), /private-input-guard-canary/);
        if (!allowed && phase === 2) {
          assert.equal(diagnostics.length, 1);
          assert.equal(diagnostics[0].stage, 'export_guard');
          assert.equal(diagnostics[0].code, 'UNAUTHORIZED');
        }
        if (mode === 'microtask' && phase === 2) assert.equal(sendAllowed, false);
      } finally {release?.(); app.close();}
    });
  }
});
