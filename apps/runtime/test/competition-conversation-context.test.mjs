import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {test} from 'node:test';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication, createRuntimeApplication} from '../dist/application.js';

const context = () => ({deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal});
function application(t, path = ':memory:') {
  const app = createRuntimeApplication({path, profile: 'huawei_ict_agentarts'});
  t.after(() => app.close());
  return app;
}
function task(app, conversationId = 'conversation-a', state = 'created', goal = 'Synthetic public question') {
  const submitted = app.runtime.submitTask({conversationId, goal, idempotencyKey: crypto.randomUUID()});
  if (state === 'cancelled') {
    app.runtime.requestCancel(submitted.taskId);
    app.runtime.confirmCancellation(submitted.taskId);
  } else if (state !== 'created') {
    app.runtime.transitionTask(submitted.taskId, 'planning');
    app.runtime.transitionTask(submitted.taskId, 'running');
    if (state === 'succeeded') app.runtime.transitionTask(submitted.taskId, 'verifying');
    app.runtime.transitionTask(submitted.taskId, state,
      state === 'succeeded' ? {resultSummary: 'Synthetic public answer'}
        : {error: {code: 'EXTERNAL_FAILURE', message: 'Synthetic failure', retryable: false}});
  }
  return submitted.taskId;
}
const read = (app, taskId, historyMessages = []) => app.readConversationContext({
  taskId, conversationId: 'conversation-a', historyMessages, ...context()});

test('Competition context accepts only earlier successful task overlays from the same conversation', t => {
  const app = application(t);
  const earlier = task(app, 'conversation-a', 'succeeded');
  const other = task(app, 'conversation-b', 'succeeded');
  const failed = task(app, 'conversation-a', 'failed');
  const cancelled = task(app, 'conversation-a', 'cancelled');
  const pending = task(app);
  const current = task(app);
  const later = task(app, 'conversation-a', 'succeeded');
  const overlays = [other, failed, cancelled, pending, current, later, 'unknown-task'].map(taskId => ({
    id: `excluded-${taskId}`, taskId, role: 'assistant', content: `Excluded ${taskId}`}));
  overlays.push({id: `${earlier}:assistant`, taskId: earlier, role: 'assistant', content: 'Public overlay answer'},
    {id: 'live-public', role: 'user', content: 'Synthetic host-scoped Live message'});
  assert.deepEqual(read(app, current, overlays), [
    {id: `${earlier}:user`, taskId: earlier, role: 'user', content: 'Synthetic public question'},
    {id: `${earlier}:assistant`, taskId: earlier, role: 'assistant', content: 'Public overlay answer'},
    {id: 'live-public', role: 'user', content: 'Synthetic host-scoped Live message'},
  ]);
});

test('Competition context cannot restore withheld task history through an overlay', t => {
  const app = application(t);
  const markers = ['private-memory:consumption:v1', 'private-derived-output',
    'private-copy-erasure', 'knowledge-recheck-result'];
  const hidden = markers.map(marker => {
    const id = task(app, 'conversation-a', 'succeeded', `Excluded ${marker}`);
    app.runtime.saveCheckpoint(id, marker, {withheld: true});
    return id;
  });
  const publicTask = task(app, 'conversation-a', 'succeeded');
  const current = task(app);
  const messages = read(app, current, [
    ...hidden.map(taskId => ({id: `${taskId}:assistant`, taskId, role: 'assistant', content: 'Excluded body'})),
    {id: `${publicTask}:assistant`, taskId: publicTask, role: 'assistant', content: 'Excluded overlay', withheld: true},
    {id: 'hidden-live', role: 'user', content: 'Excluded Live body', withheld: true},
  ]);
  assert.deepEqual(messages, [{id: `${publicTask}:user`, taskId: publicTask,
    role: 'user', content: 'Synthetic public question'}]);
});

test('Competition context merges by message id, returns detached data and keeps at most twenty messages', t => {
  const app = application(t);
  for (let index = 0; index < 14; index++) task(app, 'conversation-a', 'succeeded', `Public turn ${index}`);
  const current = task(app);
  assert.equal(read(app, current).length, 20);
  assert.equal(read(app, current)[0].content, 'Public turn 4');
  const overlays = Array.from({length: 25}, (_, index) => ({id: `live-${index}`, role: 'user', content: `Public Live ${index}`}));
  overlays.push({...overlays.at(-1), content: 'Last public overlay'});
  const messages = read(app, current, overlays);
  assert.deepEqual(messages.map(message => message.id), overlays.slice(5, 25).map(message => message.id));
  assert.equal(messages.at(-1).content, 'Last public overlay');
  messages.at(-1).content = 'Changed result';
  assert.equal(overlays.at(-1).content, 'Last public overlay');
  assert.equal(read(app, current, overlays).at(-1).content, 'Last public overlay');
});

test('Competition context refuses invalid scope, expired or cancelled reads and malformed overlays', async t => {
  const app = application(t);
  const current = task(app);
  const controller = new AbortController(); controller.abort();
  const scope = {taskId: current, conversationId: 'conversation-a', ...context()};
  for (const patch of [{conversationId: 'conversation-b'}, {deadline: 'invalid'},
    {deadline: '2000-01-01T00:00:00.000Z'}, {signal: controller.signal}]) {
    assert.throws(() => app.readConversationContext({...scope, ...patch}), {code: 'UNAUTHORIZED'});
  }
  for (const message of [{id: '', role: 'user', content: 'Invalid'},
    {id: 'bad-role', role: 'system', content: 'Invalid'}, {id: 'bad-body', role: 'user', content: 42}]) {
    assert.throws(() => read(app, current, [message]), {code: 'INVALID_ARGUMENT'});
  }
  app.runtime.requestCancel(current);
  assert.throws(() => read(app, current), {code: 'UNAUTHORIZED'});
});

test('Competition context restores public history after restart without reviving withheld messages', async t => {
  const base = new URL('../../../.cache/competition-context-tests/', import.meta.url);
  await mkdir(base, {recursive: true});
  const directory = await mkdtemp(new URL('restart-', base));
  const path = directory + '/runtime.sqlite';
  let app = createRuntimeApplication({path, profile: 'huawei_ict_agentarts'});
  t.after(async () => {app.close(); await rm(directory, {recursive: true, force: true});});
  const visible = task(app, 'conversation-a', 'succeeded');
  const hidden = task(app, 'conversation-a', 'succeeded', 'Excluded private-derived question');
  app.runtime.saveCheckpoint(hidden, 'private-derived-output', {withheld: true});
  const current = task(app);
  const original = read(app, current);
  app.close();
  app = createRuntimeApplication({path, profile: 'huawei_ict_agentarts'});
  assert.deepEqual(read(app, current, [{id: `${hidden}:assistant`, taskId: hidden,
    role: 'assistant', content: 'Excluded restart overlay'}]), original);
  assert.deepEqual(original.map(message => message.taskId), [visible, visible]);
});

async function terminal(app, taskId) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = app.runtime.getTask(taskId);
    if (['succeeded', 'failed', 'cancelled'].includes(value.state)) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('Synthetic Competition task did not settle');
}

test('Competition HTTP goal carries bounded untrusted context without checkpointing the overlay', async t => {
  const requests = [], guards = [];
  const app = createAgentArtsRuntimeApplication({path: ':memory:', gatewayUrl: 'https://agentarts.example.test',
    runtimeName: 'context-fixture', authorizationProvider: {read: async () => 'Bearer synthetic-only'},
    fetchImpl: async (_url, input) => {
      requests.push(JSON.parse(input.body));
      return new Response(JSON.stringify({event: 'message', data: {text: 'Public context answer', index: 0}}),
        {status: 200, headers: {'content-type': 'application/json'}});
    },
    coordinationInput: {
      readConversationContext: async scope => app.readConversationContext({...scope,
        historyMessages: [{id: 'public-live', role: 'user', content: 'Synthetic Live overlay'}]}),
      beforeCoordinationSend: (request, scope) => {guards.push({goal: request.goal, ...scope});},
    }});
  t.after(() => app.close());
  const earlier = task(app, 'conversation-a', 'succeeded');
  task(app, 'conversation-b', 'succeeded', 'Excluded other conversation');
  const client = new Client(app); await client.connect();
  const {taskId} = await client.call('task.submit', {goal: 'Synthetic current goal', conversationId: 'conversation-a'},
    {idempotencyKey: 'context-send'});
  assert.equal((await terminal(app, taskId)).state, 'succeeded');
  const goal = JSON.parse(requests[0].query);
  assert.deepEqual(goal, {publicGoal: 'Synthetic current goal', ephemeralGoal: 'Synthetic current goal',
    conversationContext: {treatment: 'untrusted_data', messages: [
      {id: `${earlier}:user`, taskId: earlier, role: 'user', content: 'Synthetic public question'},
      {id: `${earlier}:assistant`, taskId: earlier, role: 'assistant', content: 'Synthetic public answer'},
      {id: 'public-live', role: 'user', content: 'Synthetic Live overlay'},
    ]}});
  assert.equal(requests.length, 1);
  assert.ok(guards.length > 0);
  assert.ok(guards.every(guard => guard.goal === requests[0].query && guard.preparedGoal === goal.publicGoal));
  assert.equal(app.runtime.loadCheckpoint(taskId, 'application-goal'), 'Synthetic current goal');
  assert.equal(app.runtime.loadCheckpoint(taskId, 'application-context'), undefined);
  assert.equal(JSON.stringify(app.runtime.getTask(taskId)).includes('Synthetic Live overlay'), false);
});

test('Competition cancellation while reading context blocks credentials and HTTP', async t => {
  let app, resolveContext, enteredContext;
  let credentials = 0, sends = 0;
  const entered = new Promise(resolve => {enteredContext = resolve;});
  const reading = new Promise(resolve => {resolveContext = resolve;});
  app = createAgentArtsRuntimeApplication({path: ':memory:', gatewayUrl: 'https://agentarts.example.test',
    runtimeName: 'context-fixture', authorizationProvider: {read: async () => {credentials++; return 'Bearer synthetic-only';}},
    fetchImpl: async () => {sends++; throw Error('Cancelled context must not reach HTTP');},
    coordinationInput: {readConversationContext: async () => {enteredContext(); return reading;}, beforeCoordinationSend() {}}});
  t.after(() => app.close());
  const client = new Client(app); await client.connect();
  const {taskId} = await client.call('task.submit', {goal: 'Synthetic cancelled read', conversationId: 'conversation-a'},
    {idempotencyKey: 'context-cancel'});
  await entered;
  await client.call('task.cancel', {taskId});
  resolveContext([{id: 'must-not-send', role: 'user', content: 'Excluded cancelled overlay'}]);
  assert.equal((await terminal(app, taskId)).state, 'cancelled');
  assert.equal(credentials, 0); assert.equal(sends, 0);
});

test('Competition deadline expiry while reading context blocks credentials and HTTP', async t => {
  let now = Date.now(), credentials = 0, sends = 0;
  const app = createAgentArtsRuntimeApplication({path: ':memory:', now: () => new Date(now),
    gatewayUrl: 'https://agentarts.example.test', runtimeName: 'context-fixture',
    authorizationProvider: {read: async () => {credentials++; return 'Bearer synthetic-only';}},
    fetchImpl: async () => {sends++; throw Error('Expired context must not reach HTTP');},
    coordinationInput: {readConversationContext: async () => {
      await Promise.resolve(); now += 60_001;
      return [{id: 'expired', role: 'user', content: 'Excluded expired overlay'}];
    }, beforeCoordinationSend() {}}});
  t.after(() => app.close());
  const client = new Client(app, () => now); await client.connect();
  const {taskId} = await client.call('task.submit', {goal: 'Synthetic expired read', conversationId: 'conversation-a'},
    {idempotencyKey: 'context-expiry', deadline: new Date(now + 60_000).toISOString()});
  assert.equal((await terminal(app, taskId)).state, 'failed');
  assert.equal(credentials, 0); assert.equal(sends, 0);
});
