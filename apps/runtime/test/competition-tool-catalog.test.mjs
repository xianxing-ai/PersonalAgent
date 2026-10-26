import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {parseCoordinationAvailableTools, MAX_AVAILABLE_TOOLS} from '@personal-agent/coordination';
import {CLOUD_SKILL_TOOL_NAME, CLOUD_SKILL_TOOL_VERSION} from '@personal-agent/skills';
import {createRuntimeApplication, createAgentArtsRuntimeApplication} from '../dist/application.js';

const descriptor = {
  name: 'fixture.read', version: '1.0.0',
  inputSchema: {type: 'object', required: ['path'], additionalProperties: false,
    description: 'private C:\\Users\\example',
    properties: {path: {type: 'string', minLength: 1, maxLength: 32,
      description: 'Workspace relative path', enum: ['secret-path']},
      units: {enum: ['metric', 'imperial']}}},
  outputSchema: {type: 'object', required: ['value'], additionalProperties: false,
    properties: {value: {type: 'string'}}},
  sideEffect: 'read', requiredScopes: ['fixture:read'],
  idempotencySupport: true, recoverySupport: true, requiresPresence: false,
};
const toolExport = {toolName: descriptor.name, toolVersion: descriptor.version,
  exportPolicyVersion: 'public-v1', accepts: () => true,
  project: ({result}) => ({value: result.value})};

test('trusted step budget supports four tools plus answer and is not reset by approval resume', async () => {
  for (const budget of [undefined,5]) {
    let calls=0,executions=0;
    const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
      ...(budget===undefined?{}:{competitionMaxSteps:budget}),
      tools:[{descriptor,execute:async()=>{executions++;return {value:'synthetic'};}}],
      competitionToolExports:[toolExport],
      competitionToolAvailability:[{toolName:descriptor.name,toolVersion:descriptor.version,available:()=>true}],
      coordination:{execute:async()=>++calls<=4
        ? {kind:'tool_proposal',proposalId:`budget-${calls}`,toolName:descriptor.name,
          toolVersion:descriptor.version,arguments:{path:'secret-path'},verification:'unverified'}
        : {kind:'text',text:'Four synthetic operations completed',verification:'unverified'}},
    });
    try {
      const client=new Client(app,Date.now);await client.connect();
      const {taskId}=await client.call('task.submit',{goal:'Four dependent operations',conversationId:'budget'},
        {idempotencyKey:`budget-${budget??'default'}`,timeoutMs:60_000});
      const approved=new Set();
      let terminal;
      const deadline=Date.now()+60_000;
      while (Date.now()<deadline) {
        const task=app.runtime.getTask(taskId);
        if (['succeeded','failed'].includes(task.state)) {terminal=task;break;}
        for (const approval of (await client.call('approval.list',{taskId})).items) {
          if (approval.state!=='pending'||approved.has(approval.approvalId)) continue;
          approved.add(approval.approvalId);
          await client.call('authorization.respond',{approvalId:approval.approvalId,
            expectedRevision:approval.revision,decision:'allow_once'});
        }
        await new Promise(resolve=>setTimeout(resolve,5));
      }
      assert.ok(terminal);
      assert.equal(app.runtime.loadCheckpoint(taskId,'competition-max-steps'),budget??4);
      assert.equal(terminal.state,budget===undefined?'failed':'succeeded');
      assert.equal(executions,budget===undefined?3:4);
      assert.equal(calls,budget===undefined?4:5);
      if (budget===undefined) assert.equal(terminal.error.code,'TIMEOUT');
    } finally {app.close();}
  }
});

async function waitFor(app, taskId, states) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const task = app.runtime.getTask(taskId);
    if (states.includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Task did not settle: ${states.join(',')}`);
}

test('initial AgentArts tool directory preserves signed numeric bounds and local validation', async t => {
  const signedDescriptor = {...descriptor, name: 'fixture.signed-bounds', inputSchema: {
    type: 'object', required: ['signed', 'negative', 'samples'], additionalProperties: false,
    properties: {signed: {type: 'number', minimum: -90, maximum: 90},
      negative: {type: 'integer', minimum: -10, maximum: -1},
      samples: {type: 'array', minItems: 1, maxItems: 2,
        items: {type: 'number', minimum: -2.5, maximum: -0.25}}},
  }, outputSchema: {type: 'object'}};
  for (const [label, argumentsValue, valid] of [
    ['legal negative values', {signed: -45, negative: -5, samples: [-1.25]}, true],
    ['below signed minimum', {signed: -91, negative: -5, samples: [-1.25]}, false],
    ['above negative maximum', {signed: -45, negative: 0, samples: [-1.25]}, false],
  ]) await t.test(label, async () => {
    let executions = 0;
    const requests = [];
    const app = createAgentArtsRuntimeApplication({path: ':memory:',
      gatewayUrl: 'https://agentarts.example.test', runtimeName: 'signed-bounds',
      responseMode: 'tool-proposal-json', initialRequestMode: 'goal-with-tools-json',
      authorizationProvider: {read: async () => 'Bearer synthetic'},
      tools: [{descriptor: signedDescriptor, execute: async input => {executions++; return input;}}],
      competitionToolAvailability: [{toolName: signedDescriptor.name, toolVersion: signedDescriptor.version, available: () => true}],
      competitionToolExports: [{toolName: signedDescriptor.name, toolVersion: signedDescriptor.version,
        exportPolicyVersion: 'signed-v1', accepts: () => true, project: ({result}) => result}],
      fetchImpl: async (_url, init) => {
        const query = JSON.parse(JSON.parse(init.body).query);
        requests.push(query);
        const result = query.continuation ? {kind: 'text', text: 'Signed fixture completed'}
          : {kind: 'tool_proposal', proposalId: 'signed-1', toolName: signedDescriptor.name,
            toolVersion: signedDescriptor.version, arguments: argumentsValue};
        return new Response(JSON.stringify({event: 'message', data: {text: JSON.stringify(result), index: 0}}),
          {headers: {'content-type': 'application/json'}});
      },
    });
    try {
      const client = new Client(app); await client.connect();
      const {taskId} = await client.call('task.submit', {goal: 'Use explicit signed numeric ranges', conversationId: 'signed'},
        {idempotencyKey: 'signed'});
      const initial = await waitFor(app, taskId, ['waiting_approval', 'failed']);
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0].availableTools[0].inputSchema, signedDescriptor.inputSchema);
      if (!valid) {
        assert.equal(initial.state, 'failed'); assert.equal(initial.error.code, 'INVALID_ARGUMENT');
        assert.deepEqual((await client.call('approval.list', {taskId})).items, []);
        assert.equal(executions, 0); assert.deepEqual(app.runtime.readToolExecutions(taskId), []);
      } else {
        assert.equal(initial.state, 'waiting_approval'); assert.equal(executions, 0);
        const approval = (await client.call('approval.list', {taskId})).items[0];
        await client.call('authorization.respond', {approvalId: approval.approvalId,
          expectedRevision: approval.revision, decision: 'allow_once'});
        const completed = await waitFor(app, taskId, ['succeeded', 'failed']);
        assert.equal(completed.state, 'succeeded'); assert.equal(executions, 1);
        assert.equal(requests.length, 2); assert.equal(requests[1].availableTools, undefined);
        assert.deepEqual(requests[1].continuation.result, argumentsValue);
        assert.equal(app.runtime.readToolExecutions(taskId)[0].state, 'confirmed');
      }
    } finally {app.close();}
  });
});

test('provider lifecycle errors exclude only that tool and never enter task snapshots', async t => {
  for (const [code, mutateInput] of [['CANCELLED', false], ['TIMEOUT', false],
    ['CANCELLED', true], ['TIMEOUT', true]]) await t.test(`${code}, mutation=${mutateInput}`, async () => {
    const healthy = {...descriptor, name: 'fixture.healthy'};
    const bodies = [];
    let unhealthyExecutions = 0;
    let healthyExecutions = 0;
    const app = createAgentArtsRuntimeApplication({path: ':memory:',
      gatewayUrl: 'https://agentarts.example.test', runtimeName: 'synthetic',
      responseMode: 'tool-proposal-json', initialRequestMode: 'goal-with-tools-json',
      authorizationProvider: {read: async () => 'Bearer synthetic'},
      tools: [
        {descriptor, execute: async () => { unhealthyExecutions++; return {value: 'unexpected'}; }},
        {descriptor: healthy, execute: async () => { healthyExecutions++; return {value: 'synthetic'}; }},
      ],
      competitionToolExports: [toolExport, {...toolExport, toolName: healthy.name}],
      competitionToolAvailability: [
        {toolName: descriptor.name, toolVersion: descriptor.version,
          available: input => {
            if (mutateInput && code === 'CANCELLED') input.signal = AbortSignal.abort();
            if (mutateInput && code === 'TIMEOUT') input.deadline = new Date(0).toISOString();
            throw new ProtocolError(code, 'private-provider-canary');
          }},
        {toolName: healthy.name, toolVersion: healthy.version, available: () => true},
      ],
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        const result = bodies.length === 1
          ? {kind: 'tool_proposal', proposalId: 'healthy-proposal', toolName: healthy.name,
            toolVersion: healthy.version, arguments: {path: 'secret-path'}}
          : {kind: 'text', text: 'Synthetic healthy read confirmed'};
        return new Response(JSON.stringify({event: 'message', data: {text: JSON.stringify(result)}}),
          {headers: {'content-type': 'application/json'}});
      },
    });
    try {
      const client = new Client(app); await client.connect();
      const {taskId} = await client.call('task.submit', {goal: 'Synthetic healthy read',
        conversationId: 'catalog-provider-error'}, {idempotencyKey: code});
      const waiting = await waitFor(app, taskId, ['waiting_approval', 'failed', 'cancelled']);
      assert.equal(waiting.state, 'waiting_approval');
      assert.doesNotMatch(JSON.stringify(waiting), /private-provider-canary/);
      assert.equal(Date.parse(app.runtime.loadCheckpoint(taskId, 'application-deadline')) > Date.now(), true);
      const initial = JSON.parse(bodies[0].query);
      assert.deepEqual(initial.availableTools.map(item => item.name), [healthy.name]);
      const approval = (await client.call('approval.list', {taskId})).items[0];
      await client.call('authorization.respond', {approvalId: approval.approvalId,
        expectedRevision: approval.revision, decision: 'allow_once'});
      const task = await waitFor(app, taskId, ['succeeded', 'failed', 'cancelled']);
      assert.equal(task.state, 'succeeded');
      assert.doesNotMatch(JSON.stringify(task), /private-provider-canary/);
      assert.equal(healthyExecutions, 1);
      assert.equal(unhealthyExecutions, 0);
      assert.equal(bodies.length, 2);
      assert.deepEqual(JSON.parse(bodies[1].query).continuation.result, {value: 'synthetic'});
    } finally { app.close(); }
  });
});

test('catalog availability still obeys actual caller cancellation and task deadline', async t => {
  for (const lifecycle of ['cancel', 'deadline']) await t.test(lifecycle, async () => {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    let release;
    let exchanges = 0;
    const app = createRuntimeApplication({path: ':memory:', profile: 'huawei_ict_agentarts',
      tools: [{descriptor, execute: async () => ({value: 'unexpected'})}],
      competitionToolExports: [toolExport],
      competitionToolAvailability: [{toolName: descriptor.name, toolVersion: descriptor.version,
        available: () => { started(); return new Promise(resolve => { release = resolve; }); }}],
      coordination: {execute: async () => { exchanges++; return {kind: 'text', text: 'unexpected', verification: 'mock'}; }},
    });
    try {
      const client = new Client(app); await client.connect();
      const {taskId} = await client.call('task.submit', {goal: 'Synthetic catalog lifecycle',
        conversationId: 'catalog-lifecycle'}, {idempotencyKey: lifecycle,
        timeoutMs: lifecycle === 'deadline' ? 250 : 10_000});
      // The original deadline may expire before the provider is called.
      // Observe that real terminal state instead of waiting forever for startup.
      await Promise.race([ready, waitFor(app, taskId, ['failed', 'cancelled'])]);
      if (lifecycle === 'cancel') {
        assert.equal(typeof release, 'function', 'Cancellation covers an already-running provider');
        await client.call('task.cancel', {taskId});
      }
      const task = await waitFor(app, taskId, ['failed', 'cancelled']);
      assert.equal(task.state, lifecycle === 'cancel' ? 'cancelled' : 'failed');
      if (lifecycle === 'deadline') assert.equal(task.error.code, 'TIMEOUT');
      release?.(true);
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(app.runtime.getTask(taskId).state, task.state);
      assert.equal(exchanges, 0);
      assert.equal(app.runtime.loadCheckpoint(taskId, 'competition-tool-catalog'), undefined);
      assert.deepEqual(app.runtime.readToolExecutions(taskId), []);
    } finally { app.close(); }
  });
});

const workerDescriptor = {name: CLOUD_SKILL_TOOL_NAME, version: CLOUD_SKILL_TOOL_VERSION,
  inputSchema: {type: 'object', properties: {sourceRef: {type: 'string', enum: ['public-fixture']}},
    required: ['sourceRef'], additionalProperties: false}};
async function workerFixture(t, describe, respond = query => query.continuation
  ? {kind: 'text', text: 'Healthy fixture completed'}
  : {kind: 'tool_proposal', proposalId: 'healthy-1', toolName: descriptor.name,
    toolVersion: descriptor.version, arguments: {path: 'secret-path'}}) {
  const requests = [];
  const diagnostics = [];
  let executions = 0, dispatches = 0;
  const app = createAgentArtsRuntimeApplication({path: ':memory:',
    gatewayUrl: 'https://agentarts.example.test', runtimeName: 'worker-catalog',
    responseMode: 'tool-proposal-json', initialRequestMode: 'goal-with-tools-json',
    authorizationProvider: {read: async () => 'Bearer synthetic'},
    onDiagnostic: receipt => {diagnostics.push(receipt);},
    tools: [{descriptor, execute: async () => {executions++; return {value: 'synthetic'};}},
      {descriptor: {...descriptor, name: 'mcp.workspace.read_text'}, execute: async () => {executions++; return {value: 'unexpected'};}}],
    competitionToolExports: [toolExport],
    competitionToolAvailability: [{toolName: descriptor.name, toolVersion: descriptor.version, available: () => true}],
    cloudSkill: {cloudSkillCatalog: describe,
      dispatchCloudSkillProposal: async () => {dispatches++; throw Error('unexpected worker dispatch');},
      assertReceiptAllowed: () => {}},
    fetchImpl: async (_url, init) => {
      const query = JSON.parse(JSON.parse(init.body).query); requests.push(query);
      return new Response(JSON.stringify({event: 'message', data: {text: JSON.stringify(respond(query)), index: 0}}),
        {headers: {'content-type': 'application/json'}});
    },
  });
  t.after(() => app.close());
  const client = new Client(app); await client.connect();
  return {app, client, requests, diagnostics, executions: () => executions, dispatches: () => dispatches};
}

test('native worker provider errors omit only that directory entry while healthy tools still execute', async t => {
  for (const code of ['CANCELLED', 'TIMEOUT']) await t.test(code, async t => {
    const f = await workerFixture(t, async input => {
      input.signal = AbortSignal.abort(); input.deadline = new Date(0).toISOString();
      throw new ProtocolError(code, 'private-worker-provider-canary');
    });
    const {taskId} = await f.client.call('task.submit', {goal: 'Discover healthy tool', conversationId: 'worker-error'},
      {idempotencyKey: code});
    const initial = await waitFor(f.app, taskId, ['waiting_approval', 'failed', 'cancelled']);
    assert.equal(initial.state, 'waiting_approval');
    assert.deepEqual(f.requests[0].availableTools.map(tool => tool.name), [descriptor.name]);
    const approval = (await f.client.call('approval.list', {taskId})).items[0];
    await f.client.call('authorization.respond', {approvalId: approval.approvalId, expectedRevision: approval.revision, decision: 'allow_once'});
    const task = await waitFor(f.app, taskId, ['succeeded', 'failed', 'cancelled']);
    assert.equal(task.state, 'succeeded'); assert.equal(f.executions(), 1); assert.equal(f.dispatches(), 0);
    assert.equal(f.requests.length, 2); assert.deepEqual(f.requests[1].continuation.result, {value: 'synthetic'});
    assert.doesNotMatch(JSON.stringify([initial, task]), /private-worker-provider-canary/);
  });
});

test('worker directory revalidation failures are fixed denials before send or dispatch', async t => {
  for (const phase of ['send', 'proposal']) await t.test(phase, async t => {
    let reads = 0;
    const f = await workerFixture(t, async () => {
      if (++reads === (phase === 'send' ? 2 : 3)) throw new ProtocolError('TIMEOUT', 'private-worker-recheck-canary');
      return workerDescriptor;
    }, () => ({kind: 'tool_proposal', proposalId: 'worker-1', toolName: CLOUD_SKILL_TOOL_NAME,
      toolVersion: CLOUD_SKILL_TOOL_VERSION, arguments: {sourceRef: 'public-fixture'}}));
    const {taskId} = await f.client.call('task.submit', {goal: 'Verify published worker selection', conversationId: 'worker-check'},
      {idempotencyKey: phase});
    const task = await waitFor(f.app, taskId, ['failed', 'waiting_approval']);
    assert.equal(task.state, 'failed');
    assert.equal(task.error.code, phase === 'send' ? 'EXTERNAL_FAILURE' : 'UNAUTHORIZED');
    if (phase === 'send') {
      assert.equal(f.diagnostics[0].stage, 'catalog_guard'); assert.equal(f.diagnostics[0].code, 'UNAUTHORIZED');
    }
    assert.doesNotMatch(JSON.stringify(task), /private-worker-recheck-canary/);
    assert.equal(f.requests.length, phase === 'send' ? 0 : 1);
    assert.equal(f.executions(), 0); assert.equal(f.dispatches(), 0);
    assert.deepEqual((await f.client.call('approval.list', {taskId})).items, []);
    assert.deepEqual(f.app.runtime.readToolExecutions(taskId), []);
  });
});

test('fresh worker identity stays bound through final send and proposal revalidation', async t => {
  for (const phase of ['send', 'proposal']) for (const field of ['name', 'version']) await t.test(`${phase}: ${field}`, async t => {
    let reads = 0;
    const f = await workerFixture(t, async () => {
      const changed = ++reads >= (phase === 'send' ? 2 : 3);
      return {...workerDescriptor, ...(changed ? {[field]: field === 'name' ? 'fixture.changed-worker' : '2.0.0'} : {})};
    }, () => phase === 'send' ? {kind: 'text', text: 'Unexpected stale worker catalog accepted'}
      : {kind: 'tool_proposal', proposalId: 'worker-identity', toolName: CLOUD_SKILL_TOOL_NAME,
        toolVersion: CLOUD_SKILL_TOOL_VERSION, arguments: {sourceRef: 'public-fixture'}});
    const {taskId} = await f.client.call('task.submit', {goal: 'Revalidate exact public worker identity', conversationId: 'worker-identity'},
      {idempotencyKey: `${phase}-${field}`});
    const task = await waitFor(f.app, taskId, ['failed', 'succeeded', 'waiting_approval', 'waiting_reconciliation']);
    assert.equal(task.state, 'failed');
    assert.equal(task.error.code, phase === 'send' ? 'EXTERNAL_FAILURE' : 'UNAUTHORIZED');
    if (phase === 'send') {
      assert.equal(f.diagnostics[0].stage, 'catalog_guard'); assert.equal(f.diagnostics[0].code, 'UNAUTHORIZED');
    }
    assert.equal(f.requests.length, phase === 'send' ? 0 : 1);
    assert.equal(f.executions(), 0); assert.equal(f.dispatches(), 0);
    assert.deepEqual((await f.client.call('approval.list', {taskId})).items, []);
    assert.deepEqual(f.app.runtime.readToolExecutions(taskId), []);
    const selected = f.app.runtime.loadCheckpoint(taskId, 'competition-tool-catalog').entries
      .find(tool => tool.name === CLOUD_SKILL_TOOL_NAME);
    assert.equal(selected.version, CLOUD_SKILL_TOOL_VERSION);
  });
});

test('worker providers receive a private lease view at discovery and final catalog revalidation', async t => {
  let reads = 0;
  const f = await workerFixture(t, async input => {
    reads++;
    assert.deepEqual(Object.keys(input).sort(), ['deadline', 'revision', 'signal', 'taskId']);
    input.taskId = 'replacement-worker-private-canary'; input.revision = 0;
    input.signal = AbortSignal.abort(); input.deadline = new Date(0).toISOString();
    return workerDescriptor;
  }, () => ({kind: 'text', text: 'Public worker directory observed'}));
  const {taskId} = await f.client.call('task.submit', {goal: 'Discover public worker', conversationId: 'worker-view'},
    {idempotencyKey: 'private-view'});
  const task = await waitFor(f.app, taskId, ['succeeded', 'failed']);
  assert.equal(task.state, 'succeeded'); assert.equal(reads, 2); assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].availableTools.map(tool => tool.name), [descriptor.name, CLOUD_SKILL_TOOL_NAME]);
  assert.doesNotMatch(JSON.stringify(task), /replacement-worker-private-canary/);
  assert.equal(f.executions(), 0); assert.equal(f.dispatches(), 0);
});

test('worker discovery retains actual task cancellation and deadline after lease-view mutation', async t => {
  for (const lifecycle of ['cancel', 'deadline']) await t.test(lifecycle, async t => {
    let arrive, release;
    const ready = new Promise(resolve => {arrive = resolve;});
    const f = await workerFixture(t, input => {
      input.signal = new AbortController().signal; input.deadline = new Date(Date.now() + 60_000).toISOString();
      arrive(); return new Promise(resolve => {release = resolve;});
    });
    const {taskId} = await f.client.call('task.submit', {goal: 'Wait for public worker directory', conversationId: 'worker-life'},
      {idempotencyKey: lifecycle, timeoutMs: lifecycle === 'deadline' ? 400 : 10_000});
    await Promise.race([ready, waitFor(f.app, taskId, ['failed', 'cancelled'])]);
    if (lifecycle === 'cancel') {
      assert.equal(typeof release, 'function'); await f.client.call('task.cancel', {taskId});
    }
    const task = await waitFor(f.app, taskId, ['failed', 'cancelled']);
    assert.equal(task.state, lifecycle === 'cancel' ? 'cancelled' : 'failed');
    if (lifecycle === 'deadline') assert.equal(task.error.code, 'TIMEOUT');
    release?.(workerDescriptor); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.app.runtime.getTask(taskId).state, task.state);
    assert.equal(f.requests.length, 0); assert.equal(f.executions(), 0); assert.equal(f.dispatches(), 0);
    assert.equal(f.app.runtime.loadCheckpoint(taskId, 'competition-tool-catalog'), undefined);
  });
});

test('task catalog projects only public Schema fields and rechecks before export', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'personal-agent-catalog-'));
  let app;
  let observed;
  let availabilityCalls = 0;
  const port = {execute: async request => {
    observed = await app.prepareCompetitionToolCatalog(request);
    assert.equal(observed.length, 1);
    assert.deepEqual(request.availableTools, observed);
    await app.assertCompetitionToolCatalogAllowed({...request, availableTools: observed});
    await assert.rejects(app.assertCompetitionToolCatalogAllowed({...request,
      revision: request.revision - 1, availableTools: observed}), {code: 'UNAUTHORIZED'});
    return {kind: 'text', text: 'Catalog observed', verification: 'mock'};
  }};
  app = createRuntimeApplication({path: path.join(directory, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts', coordination: port,
    tools: [{descriptor, execute: async () => ({value: 'local-only'})}],
    competitionToolExports: [toolExport],
    competitionToolAvailability: [{toolName: descriptor.name, toolVersion: descriptor.version,
      available: async input => { availabilityCalls++; return input.taskId.length > 0 && input.revision > 0; }}],
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Read public item', conversationId: 'catalog'},
      {idempotencyKey: 'catalog-1'});
    assert.equal((await waitFor(app, taskId, ['succeeded', 'failed'])).state, 'succeeded');
    assert.ok(availabilityCalls >= 2);
    assert.deepEqual(observed, [{name: 'fixture.read', version: '1.0.0', inputSchema: {
      type: 'object', required: ['path'], additionalProperties: false,
      properties: {path: {type: 'string', minLength: 1, maxLength: 32, description:'Workspace relative path'}, units:{type:'string'}},
    }}]);
    assert.doesNotMatch(JSON.stringify(observed), /private|secret-path|Users/);
  } finally {
    for (let i = 0; i < 200 && app.activeTaskCount; i++) await new Promise(resolve => setTimeout(resolve, 5));
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('only host-approved enum paths are published and narrowing is rechecked before export', async () => {
  const binding={toolName:descriptor.name,toolVersion:descriptor.version,publicEnumPaths:['/units'],available:()=>true};
  let observed;
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
    tools:[{descriptor,execute:async()=>({value:'fixture'})}],competitionToolExports:[toolExport],
    competitionToolAvailability:[binding],coordination:{execute:async request=>{
      observed=request.availableTools;
      assert.deepEqual(observed[0].inputSchema.properties.units,{type:'string',enum:['metric','imperial']});
      assert.doesNotMatch(JSON.stringify(observed),/secret-path|private|Users/);
      await app.assertCompetitionToolCatalogAllowed({...request,availableTools:observed});
      binding.publicEnumPaths=[];
      await assert.rejects(app.assertCompetitionToolCatalogAllowed({...request,availableTools:observed}),{code:'UNAUTHORIZED'});
      return {kind:'text',text:'Public enum checked',verification:'mock'};
    }}});
  try {
    const client=new Client(app,Date.now);await client.connect();
    const {taskId}=await client.call('task.submit',{goal:'Use public unit options',conversationId:'enum'}, {idempotencyKey:'enum'});
    assert.equal((await waitFor(app,taskId,['succeeded','failed'])).state,'succeeded');
    assert.ok(observed);
  } finally {app.close();}
});

test('empty trusted catalog stops an opt-in first cloud request', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'personal-agent-catalog-'));
  let cloudCalls = 0;
  const app = createRuntimeApplication({path: path.join(directory, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts',
    coordination: {execute: async () => { cloudCalls++; return {kind: 'text', text: 'unexpected', verification: 'mock'}; }},
    tools: [{descriptor, execute: async () => ({value: 'local-only'})}],
    competitionToolExports: [toolExport],
    competitionToolAvailability: [{toolName: descriptor.name, toolVersion: descriptor.version,
      available: () => false}],
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Read public item', conversationId: 'catalog'},
      {idempotencyKey: 'catalog-empty'});
    const task = await waitFor(app, taskId, ['failed', 'succeeded']);
    assert.equal(task.state, 'failed');
    assert.equal(task.error.code, 'UNSUPPORTED_CAPABILITY');
    assert.equal(cloudCalls, 0);
  } finally {
    for (let i = 0; i < 200 && app.activeTaskCount; i++) await new Promise(resolve => setTimeout(resolve, 5));
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('stale host availability rejects an unverified cloud proposal before approval', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'personal-agent-catalog-'));
  let healthy = true;
  let executions = 0;
  const port = {execute: async () => {
    healthy = false;
    return {kind: 'tool_proposal', proposalId: 'proposal-1', toolName: descriptor.name,
      toolVersion: descriptor.version, arguments: {path: 'secret-path'}, verification: 'unverified'};
  }};
  const app = createRuntimeApplication({path: path.join(directory, 'runtime.sqlite'),
    profile: 'huawei_ict_agentarts', coordination: port,
    tools: [{descriptor, execute: async () => { executions++; return {value: 'local-only'}; }}],
    competitionToolExports: [toolExport],
    competitionToolAvailability: [{toolName: descriptor.name, toolVersion: descriptor.version,
      available: () => healthy}],
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Read public item', conversationId: 'catalog'},
      {idempotencyKey: 'catalog-2'});
    const task = await waitFor(app, taskId, ['failed', 'waiting_approval']);
    assert.equal(task.state, 'failed');
    assert.equal(executions, 0);
    assert.deepEqual((await client.call('approval.list', {taskId})).items, []);
  } finally {
    for (let i = 0; i < 200 && app.activeTaskCount; i++) await new Promise(resolve => setTimeout(resolve, 5));
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('cloud proposal rejects a catalog from an earlier running task revision', async () => {
  let app;
  let executions = 0;
  const port = {execute: async request => {
    app.runtime.recordProgress(request.taskId,
      {stepId: 'catalog-proposal-race', label: 'task changed while cloud was running'});
    return {kind: 'tool_proposal', proposalId: 'proposal-stale', toolName: descriptor.name,
      toolVersion: descriptor.version, arguments: {path: 'secret-path'}, verification: 'unverified'};
  }};
  app = createRuntimeApplication({path: ':memory:', profile: 'huawei_ict_agentarts',
    coordination: port,
    tools: [{descriptor, execute: async () => { executions++; return {value: 'local-only'}; }}],
    competitionToolExports: [toolExport],
    competitionToolAvailability: [{toolName: descriptor.name, toolVersion: descriptor.version,
      available: () => true}],
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Reject stale catalog proposal',
      conversationId: 'catalog'}, {idempotencyKey: 'catalog-proposal-revision-race'});
    const task = await waitFor(app, taskId, ['failed', 'waiting_approval']);
    assert.equal(task.state, 'failed');
    assert.equal(executions, 0);
    assert.deepEqual((await client.call('approval.list', {taskId})).items, []);
  } finally {
    for (let i = 0; i < 200 && app.activeTaskCount; i++) await new Promise(resolve => setTimeout(resolve, 5));
    app.close();
  }
});
test('async availability cannot export a catalog after the running task revision changes', async () => {
  let app;
  let availabilityCalls = 0;
  let cloudFetches = 0;
  const port = {execute: async request => {
    const selected = await app.prepareCompetitionToolCatalog(request);
    await app.assertCompetitionToolCatalogAllowed({...request, availableTools: selected});
    cloudFetches++;
    return {kind: 'text', text: 'unexpected cloud result', verification: 'mock'};
  }};
  app = createRuntimeApplication({path: ':memory:', profile: 'huawei_ict_agentarts', coordination: port,
    tools: [{descriptor, execute: async () => ({value: 'local-only'})}],
    competitionToolExports: [toolExport],
    competitionToolAvailability: [{toolName: descriptor.name, toolVersion: descriptor.version,
      available: async input => {
        availabilityCalls++;
        if (availabilityCalls === 2) app.runtime.recordProgress(input.taskId,
          {stepId: 'catalog-race', label: 'new task revision'});
        return true;
      }}],
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Check current task revision', conversationId: 'catalog'},
      {idempotencyKey: 'catalog-revision-race'});
    assert.equal((await waitFor(app, taskId, ['failed', 'succeeded'])).state, 'failed');
    assert.equal(availabilityCalls, 2);
    assert.equal(cloudFetches, 0);
  } finally {
    for (let i = 0; i < 200 && app.activeTaskCount; i++) await new Promise(resolve => setTimeout(resolve, 5));
    app.close();
  }
});

test('selected read and local write proposals each require local approval before continuation', async () => {
  const read = {...descriptor, name: 'fixture.read', requiredScopes: ['fixture:read']};
  const write = {...descriptor, name: 'fixture.write', sideEffect: 'local_write',
    requiredScopes: ['fixture:write']};
  const executions = [];
  const requests = [];
  const app = createRuntimeApplication({path: ':memory:', profile: 'huawei_ict_agentarts',
    tools: [read, write].map(item => ({descriptor: item, execute: async () => {
      executions.push(item.name);
      return {value: item.name};
    }})),
    competitionToolExports: [read, write].map(item => ({
      toolName: item.name, toolVersion: item.version, exportPolicyVersion: 'fixture-v1',
      accepts: () => true, project: ({result}) => ({value: result.value}),
    })),
    competitionToolAvailability: [read, write].map(item => ({
      toolName: item.name, toolVersion: item.version, available: () => true,
    })),
    coordination: {execute: async request => {
      requests.push(request);
      if (requests.length === 1) {
        assert.deepEqual(request.availableTools.map(item => item.name), ['fixture.read', 'fixture.write']);
        return {kind: 'tool_proposal', proposalId: 'read-1', toolName: read.name,
          toolVersion: read.version, arguments: {path: 'secret-path'}, verification: 'unverified'};
      }
      assert.equal(request.availableTools, undefined);
      if (requests.length === 2) {
        assert.deepEqual(request.continuation, {proposalId: 'read-1', state: 'confirmed',
          result: {value: read.name}});
        return {kind: 'tool_proposal', proposalId: 'write-1', toolName: write.name,
          toolVersion: write.version, arguments: {path: 'secret-path'}, verification: 'unverified'};
      }
      assert.deepEqual(request.continuation, {proposalId: 'write-1', state: 'confirmed',
        result: {value: write.name}});
      return {kind: 'text', text: 'Synthetic read and write confirmed', verification: 'unverified'};
    }},
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Synthetic read then write',
      conversationId: 'catalog'}, {idempotencyKey: 'catalog-read-write'});
    assert.equal((await waitFor(app, taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
    assert.deepEqual(executions, []);
    const first = (await client.call('approval.list', {taskId})).items[0];
    assert.equal(first.action, read.name);
    await client.call('authorization.respond', {approvalId: first.approvalId,
      expectedRevision: first.revision, decision: 'allow_once'});
    let second;
    for (let attempt = 0; attempt < 200; attempt++) {
      second = (await client.call('approval.list', {taskId})).items.find(item => item.action === write.name);
      if (second) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.ok(second);
    assert.deepEqual(executions, [read.name]);
    await client.call('authorization.respond', {approvalId: second.approvalId,
      expectedRevision: second.revision, decision: 'allow_once'});
    const task = await waitFor(app, taskId, ['succeeded', 'failed']);
    assert.equal(task.state, 'succeeded');
    assert.deepEqual(executions, [read.name, write.name]);
    assert.equal(requests.length, 3);
  } finally {app.close();}
});

test('a write missing from the task selection cannot reach approval or execution', async () => {
  const write = {...descriptor, name: 'fixture.write', sideEffect: 'local_write',
    requiredScopes: ['fixture:write']};
  let writes = 0;
  const app = createRuntimeApplication({path: ':memory:', profile: 'huawei_ict_agentarts',
    tools: [{descriptor, execute: async () => ({value: 'read'})},
      {descriptor: write, execute: async () => {writes++; return {value: 'write'};}}],
    competitionToolExports: [descriptor, write].map(item => ({
      toolName: item.name, toolVersion: item.version, exportPolicyVersion: 'fixture-v1',
      accepts: () => true, project: ({result}) => ({value: result.value}),
    })),
    competitionToolAvailability: [{toolName: descriptor.name, toolVersion: descriptor.version,
      available: () => true}],
    coordination: {execute: async request => {
      assert.deepEqual(request.availableTools.map(item => item.name), [descriptor.name]);
      return {kind: 'tool_proposal', proposalId: 'unselected-write', toolName: write.name,
        toolVersion: write.version, arguments: {path: 'secret-path'}, verification: 'unverified'};
    }},
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Synthetic unselected write',
      conversationId: 'catalog'}, {idempotencyKey: 'catalog-unselected-write'});
    assert.equal((await waitFor(app, taskId, ['failed', 'waiting_approval'])).state, 'failed');
    assert.equal(writes, 0);
    assert.deepEqual((await client.call('approval.list', {taskId})).items, []);
  } finally {app.close();}
});

test('catalog binding rejects versions beyond the cloud adapter limit', () => {
  assert.throws(() => createRuntimeApplication({path: ':memory:', profile: 'huawei_ict_agentarts',
    coordination: {execute: async () => { throw Error('unexpected'); }},
    tools: [{descriptor, execute: async () => ({value: 'unused'})}],
    competitionToolAvailability: [{toolName: descriptor.name, toolVersion: '1'.repeat(65),
      available: () => true}],
  }), {code: 'INVALID_ARGUMENT'});
});

test('routine queries and scoped local work execute without prompting while other tools still wait', async () => {
  for (const [automatic,sideEffect] of [[true,'read'],[true,'local_write'],[false,'read']]) {
    let executions=0;
    const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
      tools:[{descriptor:{...descriptor,sideEffect},execute:async()=>{executions++;return {value:'public forecast'};}}],
      automaticTools:automatic?[{toolName:descriptor.name,toolVersion:descriptor.version}]:[],
      competitionToolExports:[toolExport],
      competitionToolAvailability:[{toolName:descriptor.name,toolVersion:descriptor.version,available:()=>true}],
      coordination:{execute:async request=>request.continuation
        ? {kind:'text',text:'Public query completed',verification:'unverified'}
        : {kind:'tool_proposal',proposalId:'public-query',toolName:descriptor.name,
          toolVersion:descriptor.version,arguments:{path:'secret-path'},verification:'unverified'}}});
    try {
      const client=new Client(app,Date.now);await client.connect();
      const {taskId}=await client.call('task.submit',{goal:'Read public forecast',conversationId:'public'},
        {idempotencyKey:'public-query'});
      const task=await waitFor(app,taskId,['succeeded','failed','waiting_approval']);
      assert.equal(task.state,automatic?'succeeded':'waiting_approval');
      assert.equal(executions,automatic?1:0);
      const approvals=(await client.call('approval.list',{taskId})).items;
      assert.equal(approvals.length,automatic?0:1);
      if(automatic) assert.ok(app.runtime.loadCheckpoint(taskId,`routine-tool-policy:competition-tool-${taskId}-1`));
    }finally{app.close();}
  }
  assert.throws(()=>createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
    tools:[{descriptor:{...descriptor,sideEffect:'external_write'},execute:async()=>({value:'unused'})}],
    automaticTools:[{toolName:descriptor.name,toolVersion:descriptor.version}]}),{code:'INVALID_ARGUMENT'});
});

test('combined module catalog survives Runtime projection and cloud parsing without truncation', async () => {
  const names = Array.from({length: 24}, (_, i) => `module${i}.read`);
  const tools = names.map(name => ({descriptor:{...descriptor,name},execute:async()=>({value:'unused'})}));
  let observed;
  const app = createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools,
    competitionToolExports:names.map(toolName=>({...toolExport,toolName})),
    competitionToolAvailability:names.map(toolName=>({toolName,toolVersion:descriptor.version,available:()=>true})),
    coordination:{execute:async request=>{
      observed=parseCoordinationAvailableTools(request.availableTools);
      await app.assertCompetitionToolCatalogAllowed({...request,availableTools:observed});
      return {kind:'text',text:'Catalog accepted',verification:'mock'};
    }}});
  try {
    const client=new Client(app,Date.now);await client.connect();
    const {taskId}=await client.call('task.submit',{goal:'Synthetic combined modules',conversationId:'catalog'},
      {idempotencyKey:'combined-modules'});
    assert.equal((await waitFor(app,taskId,['failed','succeeded'])).state,'succeeded');
    assert.deepEqual(observed.map(tool=>tool.name),names);
    assert.throws(()=>parseCoordinationAvailableTools(Array.from({length:MAX_AVAILABLE_TOOLS+1},(_,i)=>
      ({name:`tool${i}`,version:'1',inputSchema:{type:'object',properties:{}}}))));
  } finally {app.close();}
});

test('catalog exceeding the cloud adapter byte limit fails before export', async () => {
  const largeDescriptor = {...descriptor, inputSchema: {type: 'object', required: [],
    additionalProperties: false,
    properties: Object.fromEntries(Array.from({length: 200}, (_, index) => [
      `a${'x'.repeat(115)}${index}`, {type: 'string'},
    ]))}};
  let cloudCalls = 0;
  const app = createRuntimeApplication({path: ':memory:', profile: 'huawei_ict_agentarts',
    coordination: {execute: async () => {cloudCalls++; throw Error('unexpected');}},
    tools: [{descriptor: largeDescriptor, execute: async () => ({value: 'unused'})}],
    competitionToolExports: [toolExport],
    competitionToolAvailability: [{toolName: descriptor.name, toolVersion: descriptor.version,
      available: () => true}],
  });
  try {
    const client = new Client(app, Date.now);
    await client.connect();
    const {taskId} = await client.call('task.submit', {goal: 'Synthetic oversized catalog',
      conversationId: 'catalog'}, {idempotencyKey: 'catalog-oversized'});
    const task = await waitFor(app, taskId, ['failed', 'succeeded']);
    assert.equal(task.state, 'failed');
    assert.equal(task.error.code, 'INVALID_ARGUMENT');
    assert.equal(cloudCalls, 0);
  } finally {app.close();}
});
