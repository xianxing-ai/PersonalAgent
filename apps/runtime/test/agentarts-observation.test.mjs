import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {test} from 'node:test';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication, createRuntimeApplication} from '../dist/application.js';
import {recordCompetitionCloudRequestIdentity,
  readCompetitionCloudRequestIdentity} from '../dist/application/coordination.js';
import {SyntheticWebSocket} from '../../../packages/coordination/test/fixtures/websocket.mjs';
import {createHash} from 'node:crypto';

const event = text => ({event: 'message', data: {text, index: 0}});
const fakeDeadline = () => new Date(Date.now() + 10_000).toISOString();
const SYNTHETIC_APPLICATION_ID = 'pa-app-synthetic';

async function staging(prefix) {
  const base = new URL('../../../.cache/agentarts-observation-tests/', import.meta.url);
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(new URL(`${prefix}-`, base));
  return {directory, path: `${directory}/runtime.sqlite`};
}

async function terminal(app, taskId, states = ['succeeded', 'failed']) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const task = app.runtime.getTask(taskId);
    if (states.includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('Task did not settle');
}

/** Observation authorization is a synthetic USB-key shape: the official SDK
 * header pair, never the invocation Bearer the reader must never see again. */
const syntheticSigner = request => ({
  ...request.headers,
  'X-Sdk-Date': '20261017T000000Z',
  Authorization: 'SDK-HMAC-SHA256 Access=fake, SignedHeaders=host, Signature=fake',
});

/** Configures the observation read transport and AK/SK-shaped authorization help. */
function observationExtras({body, onRead, authorize = true, signature = syntheticSigner} = {}) {
  const reads = [];
  return {reads, options: {
    ...(authorize ? {observationAuthorization: {authorize: async request => signature(request)}} : {}),
    observationFetchImpl: async (url, init) => {
      reads.push({url, init});
      if (onRead) return onRead(url, init);
      return new Response(JSON.stringify(typeof body === 'function' ? body() : body), {
        status: 200, headers: {'content-type': 'application/json'},
      });
    },
  }};
}

function httpsComposition(path, extras = {}) {
  const httpsCalls = [];
  const app = createAgentArtsRuntimeApplication({
    path,
    gatewayUrl: 'https://agentarts.example.test',
    runtimeName: 'pa-runtime',
    invokeMode: 'published',
    authorizationProvider: {read: async () => 'Bearer synthetic-token'},
    fetchImpl: async (url, init) => {
      httpsCalls.push({url, init});
      return new Response(JSON.stringify(event('合成观测任务已分析')), {
        status: 200, headers: {'content-type': 'application/json'},
      });
    },
    ...extras,
  });
  return {app, httpsCalls};
}

/**
 * Composition checkpoint ①②③: the production entry point attaches the observation
 * consumer, the outgoing X-Request-Id/session are durably recorded per send, and
 * a trace read binds through the exact identity join into the evidence path.
 */
test('production HTTPS composition records the real request identity and binds an exact platform trace', async () => {
  const {directory, path} = await staging('https-identity');
  let traceBody = {total: 0, span_list: []};
  const observation = observationExtras({body: () => traceBody});
  const {app, httpsCalls} = httpsComposition(path, {
    observationApplicationId: SYNTHETIC_APPLICATION_ID,
    ...observation.options,
  });
  try {
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call('task.submit',
      {goal: '只分析合成事实，不执行工具', conversationId: 'competition'},
      {idempotencyKey: 'observation-https-identity'});
    const task = await terminal(app, taskId);
    assert.equal(task.state, 'succeeded');

    const selection = readCompetitionCloudRequestIdentity(app.runtime, taskId);
    assert.equal(selection.availability, 'bound');
    const sent = selection.bound;
    assert.equal(sent.requestId, httpsCalls[0].init.headers['X-Request-Id']);
    assert.equal(sent.sessionId, httpsCalls[0].init.headers['x-hw-agentarts-session-id']);
    assert.match(sent.payloadDigest, /^[a-f0-9]{64}$/);
    assert.equal(sent.attempts, 1);
    assert.ok(Number.isSafeInteger(sent.revision) && sent.revision >= 0);

    traceBody = {total: 1, span_list: [{trace_id: sent.requestId, span_id: 'span-1',
      session_id: sent.sessionId, resource_id: SYNTHETIC_APPLICATION_ID, input: 'PRIVATE'}]};
    const record = await app.readTaskPlatformObservation(
      {taskId, surface: 'trace', deadline: fakeDeadline(), signal: new AbortController().signal});
    assert.equal(record.availability, 'observed');
    assert.equal(record.deploymentVersion, 'unavailable');
    assert.equal(record.runtimeName, 'pa-runtime');
    assert.equal(record.binding.requestId, sent.requestId);
    assert.equal(record.binding.revision, sent.revision);
    assert.equal(record.binding.identityConflict, false);
    assert.equal(record.observation.requestCorrelation.status, 'exact_id_match');
    assert.equal(record.observation.coverage, 'complete');
    assert.match(record.evidenceRef, /^agentarts-observation-trace-[0-9a-f]{32}$/);
    assert.match(observation.reads[0].url, /\/v1\/ops\/observation\/traces\/[A-Za-z0-9_-]+$/);
    assert.match(observation.reads[0].init.headers.Authorization, /^SDK-HMAC-SHA256 /);

    const evidence = app.runtime.readEvidence(taskId).find(item => item.evidenceId === record.evidenceRef);
    assert.equal(evidence.kind, 'observation');
    assert.equal(evidence.verification, 'conditional');
    assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE|Bearer|secret|payloadDigest/);
    const snapshot = app.runtime.loadCheckpoint(taskId, 'agentarts-observation-readback:trace');
    assert.match(snapshot.querySha256, /^[a-f0-9]{64}$/);
    assert.equal(snapshot.binding.requestId, sent.requestId);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('a trace read without the platform application id proceeds with an honest not_checked correlation', async () => {
  const {directory, path} = await staging('https-not-checked');
  let spanTraceId = 'placeholder';
  const observation = observationExtras({body: () => ({total: 1,
    span_list: [{trace_id: spanTraceId, span_id: 'span-1'}]})});
  const {app} = httpsComposition(path, {...observation.options});
  try {
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call('task.submit',
      {goal: '只分析合成事实，不执行工具', conversationId: 'competition'},
      {idempotencyKey: 'observation-not-checked'});
    await terminal(app, taskId);
    spanTraceId = readCompetitionCloudRequestIdentity(app.runtime, taskId).bound.requestId;
    const record = await app.readTaskPlatformObservation(
      {taskId, surface: 'trace', deadline: fakeDeadline(), signal: new AbortController().signal});
    assert.equal(record.availability, 'observed');
    assert.equal(record.observation.requestCorrelation.status, 'not_checked');
    assert.equal(record.observation.deploymentVersion, 'unavailable');
    assert.ok(record.evidenceRef);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

/** Checkpoint ⑤: a composition without the trusted observation authorization says
 * exactly that — it never reads through the invocation Bearer and never fabricates. */
test('missing observation authorization stays explicitly unavailable without any read', async () => {
  const {directory, path} = await staging('https-unavailable');
  const observation = observationExtras({authorize: false, body: {total: 0, span_list: []}});
  const {app} = httpsComposition(path, {...observation.options});
  try {
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call('task.submit',
      {goal: '只分析合成事实，不执行工具', conversationId: 'competition'},
      {idempotencyKey: 'observation-unavailable'});
    await terminal(app, taskId);
    const read = () => app.readTaskPlatformObservation({taskId, surface: 'trace',
      deadline: fakeDeadline(), signal: new AbortController().signal});
    const record = await read();
    assert.equal(record.availability, 'unavailable');
    assert.equal(record.reason, 'observation_authorization_unavailable');
    assert.equal(record.evidenceRef, undefined);
    assert.equal(record.observation, undefined);
    assert.equal(observation.reads.length, 0);
    assert.equal(app.runtime.readEvidence(taskId).filter(item => item.kind === 'observation').length, 0);
    assert.equal(app.runtime.loadCheckpoint(taskId, 'agentarts-observation-readback:trace'), undefined);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('a task without a recorded send identity reads as unknown_request', async () => {
  const {directory, path} = await staging('https-unknown');
  const observation = observationExtras({body: {total: 0, span_list: []}});
  const {app} = httpsComposition(path, {observationApplicationId: SYNTHETIC_APPLICATION_ID, ...observation.options});
  try {
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call('task.submit',
      {goal: '只分析合成事实，不执行工具', conversationId: 'competition'},
      {idempotencyKey: 'observation-unknown'});
    await terminal(app, taskId);
    app.runtime.saveCheckpoint(taskId, 'competition-cloud-request-identity', null);
    const record = await app.readTaskPlatformObservation({taskId, surface: 'trace',
      deadline: fakeDeadline(), signal: new AbortController().signal});
    assert.equal(record.availability, 'unknown_request');
    assert.equal(record.reason, 'missing_request_identity');
    assert.equal(observation.reads.length, 0);
    assert.equal(record.evidenceRef, undefined);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

/** Observation bookkeeping must never change the task result it observes. */
test('identity recording failures never change the task outcome', async () => {
  const {directory, path} = await staging('https-observer-failure');
  const observation = observationExtras({body: {total: 0, span_list: []}});
  const {app} = httpsComposition(path, {observationApplicationId: SYNTHETIC_APPLICATION_ID, ...observation.options});
  try {
    const recorded = app.runtime.saveCheckpoint.bind(app.runtime);
    app.runtime.saveCheckpoint = (taskId, key, value) => {
      if (key === 'competition-cloud-request-identity') throw Error('synthetic storage failure');
      return recorded(taskId, key, value);
    };
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call('task.submit',
      {goal: '只分析合成事实，不执行工具', conversationId: 'competition'},
      {idempotencyKey: 'observation-observer-failure'});
    const task = await terminal(app, taskId);
    assert.equal(task.state, 'succeeded');
    const record = await app.readTaskPlatformObservation({taskId, surface: 'trace',
      deadline: fakeDeadline(), signal: new AbortController().signal});
    assert.equal(record.availability, 'unknown_request');
    assert.equal(record.reason, 'missing_request_identity');
    assert.equal(record.evidenceRef, undefined);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('revision-scoped reads bind the matching recorded attempt and stay unknown otherwise', async () => {
  const {directory, path} = await staging('https-revision');
  let traceBody = {total: 0, span_list: []};
  const observation = observationExtras({body: () => traceBody});
  const {app} = httpsComposition(path, {observationApplicationId: SYNTHETIC_APPLICATION_ID, ...observation.options});
  try {
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call('task.submit',
      {goal: '只分析合成事实，不执行工具', conversationId: 'competition'},
      {idempotencyKey: 'observation-revision'});
    await terminal(app, taskId);
    const sent = readCompetitionCloudRequestIdentity(app.runtime, taskId).bound;
    recordCompetitionCloudRequestIdentity(app.runtime, taskId, 2,
      {sessionId: sent.sessionId, requestId: 'synthetic-revision-2', payloadDigest: 'b'.repeat(64)});

    traceBody = {total: 1, span_list: [{trace_id: 'synthetic-revision-2', span_id: 'span-2',
      session_id: sent.sessionId, resource_id: SYNTHETIC_APPLICATION_ID}]};
    const revision2 = await app.readTaskPlatformObservation({taskId, surface: 'trace',
      revision: 2, deadline: fakeDeadline(), signal: new AbortController().signal});
    assert.equal(revision2.availability, 'observed');
    assert.equal(revision2.binding.revision, 2);
    assert.equal(revision2.binding.requestId, 'synthetic-revision-2');
    assert.equal(revision2.observation.requestCorrelation.status, 'exact_id_match');

    const defaultRead = await app.readTaskPlatformObservation({taskId, surface: 'trace',
      deadline: fakeDeadline(), signal: new AbortController().signal});
    assert.equal(defaultRead.binding.requestId, 'synthetic-revision-2');

    const missing = await app.readTaskPlatformObservation({taskId, surface: 'trace',
      revision: 999, deadline: fakeDeadline(), signal: new AbortController().signal});
    assert.equal(missing.availability, 'unknown_request');
    assert.equal(missing.reason, 'missing_revision_identity');
    assert.equal(observation.reads.length, 2);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

/** One request id bound to two payloads is a conflict signal: correlation is refused. */
test('an identity conflict refuses the trace read without fabricating success', async () => {
  const {directory, path} = await staging('https-conflict');
  const observation = observationExtras({body: {total: 0, span_list: []}});
  const {app} = httpsComposition(path, {observationApplicationId: SYNTHETIC_APPLICATION_ID, ...observation.options});
  try {
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call('task.submit',
      {goal: '只分析合成事实，不执行工具', conversationId: 'competition'},
      {idempotencyKey: 'observation-conflict'});
    await terminal(app, taskId);
    const sent = readCompetitionCloudRequestIdentity(app.runtime, taskId).bound;
    recordCompetitionCloudRequestIdentity(app.runtime, taskId, sent.revision,
      {sessionId: sent.sessionId, requestId: sent.requestId, payloadDigest: 'c'.repeat(64)});
    const record = await app.readTaskPlatformObservation({taskId, surface: 'trace',
      deadline: fakeDeadline(), signal: new AbortController().signal});
    assert.equal(record.availability, 'unknown_request');
    assert.equal(record.reason, 'identity_conflict');
    assert.equal(record.binding.identityConflict, true);
    assert.equal(observation.reads.length, 0);
    assert.equal(record.evidenceRef, undefined);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('observation reads reject erased or changed bindings across asynchronous stages', async t => {
  for (const surface of ['trace', 'trace_without_application', 'agent_run_log']) {
    for (const stage of ['before', 'signer', 'readback']) {
      const mutations = stage === 'before' || surface === 'agent_run_log'
        ? ['erase'] : ['erase', 'conflict', 'forget'];
      for (const mutation of mutations) {
        await t.test(`${surface}: ${mutation} during ${stage}`, async () => {
          const {directory, path} = await staging('observation-race');
          const hash = value => createHash('sha256').update(value).digest('hex');
          let reached, release, app, sent, signatures = 0;
          const started = new Promise(resolve => { reached = resolve; });
          const blocked = new Promise(resolve => { release = resolve; });
          const trace = surface !== 'agent_run_log';
          const observation = observationExtras({
            signature: async request => {
              signatures += 1;
              if (stage === 'signer') { reached(); await blocked; }
              return syntheticSigner(request);
            },
            onRead: async () => {
              if (stage === 'readback') { reached(); await blocked; }
              const body = trace ? {total: 1, span_list: [{trace_id: sent.requestId,
                span_id: 'race-span', session_id: sent.sessionId, resource_id: SYNTHETIC_APPLICATION_ID}]}
                : {count: 1, is_query_complete: true, logs: [{content: 'synthetic', line_num: '1', labels: {}}]};
              return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}});
            },
          });
          ({app} = httpsComposition(path, {
            ...(surface === 'trace' ? {observationApplicationId: SYNTHETIC_APPLICATION_ID} : {}),
            ...observation.options,
            coordinationInput: {beforeCoordinationSend() {}, prepareCoordinationGoal: async scope => {
              app.writePrivateTaskBinding(scope.taskId, {taskId: scope.taskId,
                conversationId: scope.conversationId, destination: 'agentarts',
                configurationRef: app.coordinationConfigurationRef, deadline: scope.deadline,
                userGoalDigest: hash(scope.publicGoal), fact: {ref: {id: 'race-fact', revision: 1},
                  summaryDigest: hash('synthetic summary'), sourceDigest: hash('synthetic source'),
                  configurationRef: 'race-v1'}});
              return scope.publicGoal;
            }},
          }));
          try {
            const client = new Client(app);
            await client.connect();
            const {taskId} = await client.call('task.submit',
              {goal: 'synthetic private observation', conversationId: 'competition'},
              {idempotencyKey: 'observation-race'});
            assert.equal((await terminal(app, taskId)).state, 'succeeded');
            sent = readCompetitionCloudRequestIdentity(app.runtime, taskId).bound;
            const change = async () => {
              if (mutation === 'erase') {
                const {binding} = app.listBindings().items.find(item => item.taskId === taskId);
                assert.equal((await app.eraseTaskCopies({taskId, factId: 'race-fact',
                  bindingDigest: hash(JSON.stringify(binding)), deadline: fakeDeadline(),
                  signal: new AbortController().signal})).state, 'purged');
              } else if (mutation === 'conflict') {
                recordCompetitionCloudRequestIdentity(app.runtime, taskId, sent.revision,
                  {...sent, payloadDigest: 'f'.repeat(64)});
              } else {
                app.runtime.saveCheckpoint(taskId, 'competition-cloud-request-identity', null);
              }
            };
            if (stage === 'before') await change();
            const reading = app.readTaskPlatformObservation({taskId,
              surface: trace ? 'trace' : 'agent_run_log',
              ...(trace ? {} : {agentRunId: 'synthetic-platform-run',
                window: {startMs: 1792000000000, endMs: 1792000060000, limit: 1}}),
              deadline: fakeDeadline(), signal: new AbortController().signal});
            if (stage !== 'before') { await started; await change(); release(); }
            await assert.rejects(reading, {code: mutation === 'erase' ? 'UNAUTHORIZED' : 'REVISION_CONFLICT'});
            assert.equal(signatures, stage === 'before' ? 0 : 1);
            assert.equal(observation.reads.length, stage === 'readback' ? 1 : 0);
            assert.equal(app.runtime.readEvidence(taskId).filter(item => item.kind === 'observation').length, 0);
            assert.equal(app.runtime.loadCheckpoint(taskId,
              `agentarts-observation-readback:${trace ? 'trace' : 'agent_run_log'}`), undefined);
          } finally {
            release();
            app.close();
            await rm(directory, {recursive: true, force: true});
          }
        });
      }
    }
  }
});

test('agent-run log reads are scoped by an explicit platform run identity and window', async () => {
  const {directory, path} = await staging('https-log');
  const observation = observationExtras({body: {count: 2, is_query_complete: true,
    logs: [{content: 'PRIVATE FIRST', line_num: '1', labels: {}},
      {content: 'PRIVATE SECOND', line_num: '2', labels: {level: 'info'}}]}});
  const {app} = httpsComposition(path, {observationApplicationId: SYNTHETIC_APPLICATION_ID, ...observation.options});
  try {
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call('task.submit',
      {goal: '只分析合成事实，不执行工具', conversationId: 'competition'},
      {idempotencyKey: 'observation-log'});
    await terminal(app, taskId);
    const base = {taskId, surface: 'agent_run_log', deadline: fakeDeadline(),
      signal: new AbortController().signal};

    const noRun = await app.readTaskPlatformObservation({...base});
    assert.equal(noRun.availability, 'unknown_request');
    assert.equal(noRun.reason, 'missing_agent_run_identity');

    const noWindow = await app.readTaskPlatformObservation({...base, agentRunId: 'synthetic-platform-run'});
    assert.equal(noWindow.availability, 'unknown_request');
    assert.equal(noWindow.reason, 'missing_observation_window');

    const observed = await app.readTaskPlatformObservation({...base, agentRunId: 'synthetic-platform-run',
      window: {startMs: 1792000000000, endMs: 1792000060000, limit: 7}});
    assert.equal(observed.availability, 'observed');
    assert.equal(observed.binding, undefined);
    assert.equal(observed.observation.returnedLogCount, 2);
    assert.equal(observed.observation.count, 2);
    assert.equal(observed.observation.queryComplete, true);
    assert.equal(observed.observation.hasContinuation, false);
    assert.match(observed.evidenceRef, /^agentarts-observation-log-[0-9a-f]{32}$/);
    assert.match(observation.reads[0].url,
      /\/v1\/ops\/observation\/agent-run\/synthetic-platform-run\/log\?end_time=1792000060000&limit=7&log_type=agent&start_time=1792000000000$/);
    const evidence = app.runtime.readEvidence(taskId).find(item => item.evidenceId === observed.evidenceRef);
    assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE|synthetic-platform-run/);
    assert.match(evidence.summary, /agent-run log observation; correlation=not_checked; logs=2\/2/);
    const snapshot = app.runtime.loadCheckpoint(taskId, 'agentarts-observation-readback:agent_run_log');
    assert.match(snapshot.agentRunRef, /^[a-f0-9]{64}$/);
    assert.equal(snapshot.windowMs.limit, 7);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('an observation keeps its original task, window, deadline and cancellation signal', async t => {
  for (const stage of ['signer', 'readback']) {
    for (const mutation of ['scope', 'replacement_controls', 'original_cancel']) {
      await t.test(`${stage}: ${mutation}`, async () => {
        const {directory, path} = await staging('observation-input-snapshot');
        let reached, release;
        const started = new Promise(resolve => { reached = resolve; });
        const blocked = new Promise(resolve => { release = resolve; });
        const observation = observationExtras({
          signature: async request => {
            if (stage === 'signer') { reached(); await blocked; }
            return syntheticSigner(request);
          },
          onRead: async () => {
            if (stage === 'readback') { reached(); await blocked; }
            return new Response(JSON.stringify({count: 0, is_query_complete: true, logs: []}),
              {headers: {'content-type': 'application/json'}});
          },
        });
        const {app} = httpsComposition(path, observation.options);
        try {
          const client = new Client(app);
          await client.connect();
          const taskIds = [];
          for (const idempotencyKey of ['original', 'unrelated']) {
            const {taskId} = await client.call('task.submit',
              {goal: 'synthetic observation snapshot', conversationId: 'competition'}, {idempotencyKey});
            await terminal(app, taskId);
            taskIds.push(taskId);
          }
          const [taskId, unrelatedTaskId] = taskIds;
          const controller = new AbortController();
          const replacement = new AbortController();
          const window = {startMs: 1792000000000, endMs: 1792000060000, limit: 7};
          const input = {taskId, surface: 'agent_run_log', agentRunId: 'original-platform-run',
            window, deadline: fakeDeadline(), signal: controller.signal};
          const reading = app.readTaskPlatformObservation(input);
          await started;
          input.taskId = unrelatedTaskId;
          input.agentRunId = 'unrelated-platform-run';
          window.limit = 999;
          input.window = {startMs: 1792000100000, endMs: 1792000160000, limit: 10};
          if (mutation !== 'scope') {
            input.deadline = '2000-01-01T00:00:00Z';
            input.signal = replacement.signal;
            if (mutation === 'original_cancel') controller.abort();
            else replacement.abort();
          }
          release();
          if (mutation === 'original_cancel') {
            await assert.rejects(reading, {code: 'CANCELLED'});
            assert.equal(app.runtime.readEvidence(taskId).length, 0);
          } else {
            const result = await reading;
            assert.equal(result.taskId, taskId);
            assert.equal(result.availability, 'observed');
            const snapshot = app.runtime.loadCheckpoint(taskId, 'agentarts-observation-readback:agent_run_log');
            assert.deepEqual(snapshot.windowMs, {start: 1792000000000, end: 1792000060000, limit: 7});
            assert.equal(snapshot.agentRunRef,
              createHash('sha256').update('original-platform-run').digest('hex'));
            assert.match(observation.reads[0].url,
              /original-platform-run\/log\?end_time=1792000060000&limit=7&log_type=agent&start_time=1792000000000$/);
          }
          assert.equal(app.runtime.readEvidence(unrelatedTaskId).length, 0);
          assert.equal(app.runtime.loadCheckpoint(unrelatedTaskId, 'agentarts-observation-readback:agent_run_log'), undefined);
        } finally {
          release();
          app.close();
          await rm(directory, {recursive: true, force: true});
        }
      });
    }
  }
});

test('platform failures propagate without evidence or retries', async () => {
  const {directory, path} = await staging('https-unauthorized');
  const observation = observationExtras({onRead: async () =>
    new Response('{"message":"PRIVATE"}', {status: 401, headers: {'content-type': 'application/json'}})});
  const {app} = httpsComposition(path, {observationApplicationId: SYNTHETIC_APPLICATION_ID, ...observation.options});
  try {
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call('task.submit',
      {goal: '只分析合成事实，不执行工具', conversationId: 'competition'},
      {idempotencyKey: 'observation-unauthorized'});
    await terminal(app, taskId);
    await assert.rejects(app.readTaskPlatformObservation({taskId, surface: 'trace',
      deadline: fakeDeadline(), signal: new AbortController().signal}), {code: 'UNAUTHORIZED', httpStatus: 401});
    assert.equal(observation.reads.length, 1);
    assert.equal(app.runtime.loadCheckpoint(taskId, 'agentarts-observation-readback:trace'), undefined);
    assert.equal(app.runtime.readEvidence(taskId).filter(item => item.kind === 'observation').length, 0);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('observation input validation enforces deadline and cancellation bounds', async () => {
  const {directory, path} = await staging('https-bounds');
  const observation = observationExtras({body: {total: 0, span_list: []}});
  const {app} = httpsComposition(path, {observationApplicationId: SYNTHETIC_APPLICATION_ID, ...observation.options});
  try {
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call('task.submit',
      {goal: '只分析合成事实，不执行工具', conversationId: 'competition'},
      {idempotencyKey: 'observation-bounds'});
    await terminal(app, taskId);
    const read = (input, signal = new AbortController().signal) =>
      app.readTaskPlatformObservation({taskId, surface: 'trace', deadline: fakeDeadline(), signal, ...input});
    await assert.rejects(read({deadline: 'not-a-timestamp'}), {code: 'INVALID_ARGUMENT'});
    await assert.rejects(read({deadline: '2000-01-01T00:00:00Z'}), {code: 'INVALID_ARGUMENT'});
    await assert.rejects(read({deadline: new Date(Date.now() + 2_200_000_000).toISOString()}), {code: 'INVALID_ARGUMENT'});
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(read({}, controller.signal), {code: 'CANCELLED'});
    assert.equal(observation.reads.length, 0);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('the default local composition exposes no observation surface at all', () => {
  const app = createRuntimeApplication({path: ':memory:'});
  try {
    assert.equal(app.readTaskPlatformObservation, undefined);
  } finally {
    app.close();
  }
});

/** Bounded record bookkeeping unit behavior: dedup, attempts, conflicts, newest-first binding. */
test('competition request identity records stay bounded and binding-consistent', async () => {
  const {directory, path} = await staging('identity-units');
  const app = createAgentArtsRuntimeApplication({
    path,
    gatewayUrl: 'https://agentarts.example.test',
    runtimeName: 'pa-runtime',
    invokeMode: 'published',
    authorizationProvider: {read: async () => 'Bearer synthetic-token'},
    fetchImpl: async () => new Response(JSON.stringify(event('合成观测任务已分析')), {
      status: 200, headers: {'content-type': 'application/json'}}),
  });
  try {
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call('task.submit',
      {goal: '只分析合成事实，不执行工具', conversationId: 'competition'},
      {idempotencyKey: 'identity-units'});
    await terminal(app, taskId);
    assert.deepEqual(readCompetitionCloudRequestIdentity(app.runtime, taskId,
      {revision: 99}).availability, 'unknown_request');

    const session = 'synthetic-session';
    recordCompetitionCloudRequestIdentity(app.runtime, taskId, 3,
      {sessionId: session, requestId: 'unit-request-1', payloadDigest: 'd'.repeat(64)});
    const first = readCompetitionCloudRequestIdentity(app.runtime, taskId, {revision: 3});
    assert.equal(first.availability, 'bound');
    recordCompetitionCloudRequestIdentity(app.runtime, taskId, 3,
      {sessionId: session, requestId: 'unit-request-1', payloadDigest: 'd'.repeat(64)});
    assert.equal(readCompetitionCloudRequestIdentity(app.runtime, taskId, {revision: 3}).bound.attempts, 2);

    // Same request id, different payload: a conflict, never a replace.
    recordCompetitionCloudRequestIdentity(app.runtime, taskId, 4,
      {sessionId: session, requestId: 'unit-request-1', payloadDigest: 'e'.repeat(64)});
    assert.deepEqual(readCompetitionCloudRequestIdentity(app.runtime, taskId)
      .identities.conflicts, ['unit-request-1']);
    assert.equal(readCompetitionCloudRequestIdentity(app.runtime, taskId, {revision: 4})
      .availability, 'bound');

    for (let index = 0; index < 40; index += 1) {
      recordCompetitionCloudRequestIdentity(app.runtime, taskId, index + 5,
        {sessionId: session, requestId: `unit-request-${index + 2}`, payloadDigest: 'd'.repeat(64)});
    }
    const identities = readCompetitionCloudRequestIdentity(app.runtime, taskId).identities;
    assert.ok(identities.requests.length <= 32, 'identity history stays bounded');
    assert.equal(identities.requests.at(-1).requestId, 'unit-request-41');
    assert.deepEqual(identities.conflicts, ['unit-request-1']);
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});

const syntheticProposal = {kind: 'tool_proposal', proposalId: 'observation-read', toolName: 'fixture.read',
  toolVersion: '1.0.0', arguments: {id: 'synthetic'}};
const syntheticDescriptor = {name: syntheticProposal.toolName, version: syntheticProposal.toolVersion,
  inputSchema: {type: 'object', required: ['id'], properties: {id: {type: 'string'}}},
  outputSchema: {type: 'object', required: ['value'], properties: {value: {type: 'string'}}},
  sideEffect: 'read', requiredScopes: ['fixture:read'], idempotencySupport: true,
  recoverySupport: true, requiresPresence: false};
function syntheticToolOptions(execute) {
  return {responseMode: 'tool-proposal-json',
    competitionToolExports: [{toolName: syntheticProposal.toolName, toolVersion: syntheticProposal.toolVersion,
      exportPolicyVersion: 'observation-v1', accepts: () => true, project: ({result}) => ({value: result.value})}],
    tools: [{descriptor: syntheticDescriptor, execute}]};
}

/** Checkpoint ①②④over WSS: the composition records the WSS frame identities per actual
 * send and the read-back evidence lands after the executed run in the evidence page. */
test('WSS composition records frame identities and appends observation evidence after executions', async () => {
  const {directory, path} = await staging('wss-identity');
  let invocations = 0;
  let traceBody = {total: 0, span_list: []};
  const observation = observationExtras({body: () => traceBody});
  const socketIds = [];
  const app = createAgentArtsRuntimeApplication({
    path,
    gatewayUrl: 'https://agentarts.example.test',
    runtimeName: 'synthetic',
    transport: 'wss',
    websocketUrl: 'wss://agentarts.example.test/runtimes/synthetic/ws',
    allowHttpsFallback: true,
    observationApplicationId: SYNTHETIC_APPLICATION_ID,
    ...observation.options,
    authorizationProvider: {read: async () => 'Bearer synthetic-outer'},
    websocketAuthorizationProvider: {read: async () => 'Bearer synthetic-app'},
    websocketFactory: () => new SyntheticWebSocket((frame, socket) => {
      if (frame.type !== 'invoke') return;
      socketIds.push(frame.requestId);
      invocations += 1;
      socket.accepted(frame);
      socket.result(frame, JSON.stringify(invocations === 1 ? syntheticProposal
        : {kind: 'text', text: 'Synthetic WSS analysis done'}));
    }),
    ...syntheticToolOptions(async () => ({value: 'synthetic local value'})),
    fetchImpl: async () => { throw Error('Unexpected HTTPS fallback'); },
  });
  try {
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call('task.submit',
      {goal: '合成 WSS 观测分析', conversationId: 'wss-competition'},
      {idempotencyKey: 'observation-wss'});
    assert.equal((await terminal(app, taskId, ['waiting_approval', 'failed'])).state, 'waiting_approval');
    const approval = (await client.call('approval.list', {taskId})).items[0];
    await client.call('authorization.respond', {approvalId: approval.approvalId,
      expectedRevision: approval.revision, decision: 'allow_once'});
    const task = await terminal(app, taskId, ['succeeded', 'failed', 'waiting_reconciliation']);
    assert.equal(task.state, 'succeeded');
    assert.equal(invocations, 2);

    const identities = readCompetitionCloudRequestIdentity(app.runtime, taskId).identities;
    assert.deepEqual(identities.requests.map(item => item.requestId), socketIds);
    assert.deepEqual(identities.requests.map(item => item.attempts), [1, 1]);

    const newest = identities.requests.at(-1);
    traceBody = {total: 1, span_list: [{trace_id: newest.requestId, span_id: 'wss-span-1',
      session_id: newest.sessionId, resource_id: SYNTHETIC_APPLICATION_ID, input: 'PRIVATE'}]};
    const record = await app.readTaskPlatformObservation({taskId, surface: 'trace',
      deadline: fakeDeadline(), signal: new AbortController().signal});
    assert.equal(record.availability, 'observed');
    assert.equal(record.binding.requestId, newest.requestId);
    assert.equal(record.observation.requestCorrelation.status, 'exact_id_match');

    const reader = app.createEvidenceReader({subjectRef: 'user-a', conversationId: 'wss-competition',
      taskId, authorize: () => true});
    const page = (await reader.list({limit: 50})).items;
    assert.deepEqual(page.map(item => item.kind), ['execution', 'observation']);
    assert.equal(page.at(-1).evidenceId, record.evidenceRef);
    assert.deepEqual(await reader.get(record.evidenceRef), page.at(-1));
  } finally {
    app.close();
    await rm(directory, {recursive: true, force: true});
  }
});
