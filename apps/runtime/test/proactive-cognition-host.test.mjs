import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {Client} from '@personal-agent/client';
import {LayaActionChoiceService, analyzeImpact, selectGoalAncestorImpact} from '@personal-agent/cognition';
import {createGoal, reviseGoal} from '@personal-agent/goals/commands';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createRuntimeApplication} from '../dist/application.js';
import {createProactiveCognitionHost} from '../dist/application/proactive-cognition-host.js';

const at = '2026-09-27T03:00:00.000Z';
const graphNamespace = 'synthetic-cognition-graph';
const memoryNamespace = 'synthetic-public-memory';
const source = {vaultId: 'public-demo', path: 'meeting.md', factId: 'meeting/update'};
const ref = (id, revision = 1) => ({id, revision});
const context = (delay = 60_000) => ({deadline: new Date(Date.now() + delay).toISOString(),
  signal: new AbortController().signal});
const node = (id, kind, dependencies, summary = id) => ({
  id, kind, dependencies, summary, sourceRef: 'synthetic/meeting',
  sensitivity: 'public', state: 'active', reason: 'fixture',
  validFrom: '2026-09-25T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z'
});
const cacheRoot = fileURLToPath(new URL('../../../.cache/', import.meta.url));

async function workspace() {
  await mkdir(cacheRoot, {recursive: true});
  const directory = await mkdtemp(join(cacheRoot, 'proactive-cognition-'));
  return {directory, runtimePath: join(directory, 'runtime.sqlite'),
    memoryPath: join(directory, 'memory.sqlite')};
}

function chooser(state) {
  return new LayaActionChoiceService({async infer(payload) {
    state.layaCalls++;
    if (state.onInfer) await state.onInfer(payload);
    const criteria = payload.questions.action.criteria;
    const keys = Object.keys(criteria);
    const selected = keys.find(key =>
      JSON.parse(criteria[key]).description.includes('minimal dependency repair')) ?? keys[0];
    const confidence = state.choiceConfidence ?? 0.9;
    const probabilities = Object.fromEntries(keys.map(key => [key,
      key === selected ? confidence : (1 - confidence) / (keys.length - 1)]));
    return {answers: {action: {choice: selected, probabilities,
      answer_confidence: confidence, confidence: 0.5}}};
  }});
}

function open(paths, state) {
  const handoffGoal = state.handoffGoal ?? 'Review a synthetic public meeting correction and propose a revised plan.';
  const application = createRuntimeApplication({path: paths.runtimePath,
    profile: 'huawei_ict_agentarts', coordination: {async execute(request) {
      state.agentArtsCalls++;
      state.goals.push(request.goal);
      return {kind: 'text', text: 'Synthetic AgentArts orchestration accepted', verification: 'mock'};
    }}});
  const facts = application.createCompetitionFactHost({memoryPath: paths.memoryPath,
    memoryNamespace, graphNamespace, consumerKey: 'synthetic-cognition-consumer'});
  const client = new Client(application, Date.now);
  let connected = false;
  const selectionHandoff = state.handoff === false ? undefined : {
    async prepare(review,request) {
      state.prepares++;
      state.onPrepare?.(request);
      if (state.prepareGate) {
        state.prepareGate.arrive();
        await state.prepareGate.pending;
      }
      if (state.prepareUnavailable === true || (typeof state.prepareUnavailable === 'function'
        && state.prepareUnavailable(review))) return undefined;
      if (state.expectMachineReview) {
        assert.equal(review.selectedOption, undefined);
        assert.equal(review.selection.state, 'review');
        assert.equal(review.selection.reason, 'uncertain');
        assert.deepEqual(review.machineReview, {reason: 'uncertain', action: 'RECHECK',
          option: {id: 'recheck', revision: 1}});
      } else assert.equal(review.selectedOption.id, state.selectedId ?? 'revise');
      return {exportPolicyVersion: 'synthetic-public-v1',
        goal: handoffGoal};
    },
    read(commandId) {
      return application.runtime.findTaskByIdempotencyKey(commandId);
    },
    async dispatch(intent, request) {
      state.dispatchAttempts++;
      if (state.denyDispatch) throw Error('Synthetic export scope was revoked');
      if (state.failDispatchOnce) {
        state.failDispatchOnce = false;
        throw Error('Synthetic interruption before AgentArts task submission');
      }
      if (state.dispatchGate) {
        state.dispatchGate.arrive();
        await state.dispatchGate.pending;
        if (request.signal.aborted) throw Error('Synthetic dispatch cancelled before submission');
      }
      assert.equal(intent.exportPolicyVersion, 'synthetic-public-v1');
      assert.ok(Date.parse(request.deadline) <= Date.parse(intent.deadline));
      state.dispatchDeadlines.push(request.deadline);
      assert.equal(intent.goal, handoffGoal);
      if (!connected) { await client.connect(); connected = true; }
      const submitted = await client.call('task.submit', {
        goal: intent.goal, conversationId: 'synthetic-agentarts-handoff'
      }, {idempotencyKey: intent.commandId, signal: request.signal,
        timeoutMs: Math.max(1, Date.parse(request.deadline) - Date.now())});
      return application.runtime.getTask(submitted.taskId);
    }
  };
  const host = createProactiveCognitionHost({application, facts, graphNamespace,
    bindingVersion: 'test-binding-v1', chooser: chooser(state), now: () => state.now ?? Date.now(),
    ...(state.prepareOptions ? {prepareOptions: state.prepareOptions} : {}),
    ...(selectionHandoff ? {selectionHandoff} : {})});
  return {application, facts, host, close() { host.close(); facts.close(); application.close(); }};
}

function state(overrides = {}) {
  return {layaCalls: 0, agentArtsCalls: 0, prepares: 0,
    dispatchAttempts: 0, dispatchDeadlines: [], goals: [], ...overrides};
}

function gate() {
  let arrive, release;
  const entered = new Promise(resolve => { arrive = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  return {entered, pending, arrive, release};
}

function record(facts, revision, expectedFactRevision) {
  return facts.recordPublicSource({...source, sourceRevision: revision.repeat(64), line: 1,
    summary: revision === 'a' ? 'Meeting at 17:00' : 'Meeting at 18:00',
    observedAt: '2026-09-25T00:00:00.000Z',
    validFrom: '2026-09-25T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z',
    expectedFactRevision}, context());
}

async function factChain(binding, request = context()) {
  const {application, facts, host} = binding;
  record(facts, 'a', null);
  const baseline = await host.consumeAndReview({...context(), at, limit: 10, afterGraphRevision: 0});
  assert.equal(baseline.reviews[0].review.action, 'KEEP');
  assert.equal(baseline.nextGraphRevision, 1);
  const store = application.runtime.bindCoordinationStore(graphNamespace);
  const factId = store.read().history[0].id;
  store.append(1, node('goal', 'goal', [ref(factId)]));
  store.append(2, node('decision', 'decision', [ref('goal')]));
  store.append(3, node('plan', 'plan', [ref('decision')]));
  record(facts, 'b', 1);
  const reviewed = await host.consumeAndReview({...request, at, limit: 10, afterGraphRevision: 1});
  assert.equal(reviewed.reviews.length, 1);
  assert.equal(reviewed.nextGraphRevision, 5);
  return {store, baseline, reviewed, review: reviewed.reviews[0]};
}

async function waitFor(application, taskId, expected) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const task = application.runtime.getTask(taskId);
    if (task.state === expected) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error(`Task did not reach ${expected}`);
}

test('public Fact correction selects revise and hands off once across SQLite restart', async () => {
  const paths = await workspace();
  const calls = state();
  let binding = open(paths, calls);
  try {
    const {store, baseline, review} = await factChain(binding);
    assert.equal(review.task.state, 'succeeded');
    assert.equal(review.review.action, 'REVISE');
    assert.equal(review.review.selection.selected.id, 'revise');
    assert.deepEqual(review.review.options.map(option => option.id), ['recheck', 'defer', 'revise']);
    assert.deepEqual(review.review.affected.map(item => item.node.id), ['goal', 'decision', 'plan']);
    assert.deepEqual(review.review.selectedOption.repair.changes.map(change => change.node.id),
      ['goal', 'decision', 'plan']);
    assert.equal(review.review.semanticReviewRequired, true);
    assert.equal(review.handoff.state, 'submitted');
    await waitFor(binding.application, review.handoff.task.taskId, 'succeeded');
    assert.equal(calls.layaCalls, 1);
    assert.equal(calls.agentArtsCalls, 1);
    assert.deepEqual(calls.goals,
      ['Review a synthetic public meeting correction and propose a revised plan.']);
    assert.equal(store.read().revision, 5, 'handoff does not commit local Goal/Plan versions');
    // Terminal task state persists before the dispatch promise settles; drain before closing.
    for (let i = 0; i < 400 && binding.application.activeTaskCount > 0; i++) await new Promise(r => setTimeout(r, 5));

    binding.close();
    binding = open(paths, calls);
    const replay = await binding.host.consumeAndReview({...context(), at, limit: 10,
      afterGraphRevision: 0});
    assert.deepEqual(replay.reviews.map(item => item.task.taskId),
      [baseline.reviews[0].task.taskId, review.task.taskId]);
    assert.equal(replay.reviews[1].handoff.task.taskId, review.handoff.task.taskId);
    assert.equal(replay.nextGraphRevision, 5);
    assert.equal(calls.layaCalls, 1);
    assert.equal(calls.agentArtsCalls, 1);
    assert.equal(binding.application.runtime.bindCoordinationStore(graphNamespace).read().revision, 5);
  } finally {
    // Terminal task state persists before the dispatch promise settles; drain before closing.
    for (let i = 0; i < 400 && binding.application.activeTaskCount > 0; i++) await new Promise(r => setTimeout(r, 5));

    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }
});

test('missing handoff or declined export projection never submits an AgentArts task', async () => {
  for (const mode of ['missing', 'unavailable']) {
    const paths = await workspace();
    const calls = state({handoff: mode !== 'missing', prepareUnavailable: mode === 'unavailable'});
    const binding = open(paths, calls);
    try {
      const {store, review} = await factChain(binding);
      assert.equal(review.review.selectedOption.id, 'revise');
      assert.deepEqual(review.handoff, {state: 'unavailable'});
      assert.equal(calls.agentArtsCalls, 0);
      assert.equal(calls.dispatchAttempts, 0);
      assert.equal(store.read().revision, 5);
    } finally {
      binding.close();
      await rm(paths.directory, {recursive: true, force: true});
    }
  }
});

test('custom versioned options let Laya choose a legal approach; out-of-scope repair is rejected', async () => {
  const paths = await workspace();
  const calls = state({selectedId: 'route-b', prepareOptions: review => [
    {id: 'route-a', revision: 2, action: 'RECHECK',
      description: 'Ask AgentArts to verify this synthetic public source.'},
    {id: 'route-b', revision: 3, action: 'REVISE',
      description: 'Ask AgentArts to evaluate this minimal dependency repair.',
      repair: review.options.find(option => option.id === 'revise').repair}
  ]});
  let binding = open(paths, calls);
  try {
    const {review, store} = await factChain(binding);
    assert.deepEqual(review.review.options.map(option => [option.id, option.revision]),
      [['route-a', 2], ['route-b', 3]]);
    assert.deepEqual(review.review.selection.selected, {id: 'route-b', revision: 3});
    assert.equal(review.review.selectedOption.action, 'REVISE');
    assert.equal(review.handoff.state, 'submitted');
    await waitFor(binding.application, review.handoff.task.taskId, 'succeeded');
    assert.equal(store.read().revision, 5);
    assert.equal(calls.agentArtsCalls, 1);
  } finally {
    // Terminal task state persists before the dispatch promise settles; drain before closing.
    for (let i = 0; i < 400 && binding.application.activeTaskCount > 0; i++) await new Promise(r => setTimeout(r, 5));

    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }

  const invalidPaths = await workspace();
  const invalidCalls = state({prepareOptions: review => [{
    id: 'route-a', revision: 2, action: 'RECHECK', description: 'Verify synthetic public source.'
  }, {
    id: 'route-b', revision: 3, action: 'REVISE', description: 'Evaluate a changed plan.',
    repair: {...review.options.find(option => option.id === 'revise').repair,
      changes: [{...review.options.find(option => option.id === 'revise').repair.changes[0],
        node: ref('outside-scope')}]}
  }]});
  binding = open(invalidPaths, invalidCalls);
  try {
    const {review, store} = await factChain(binding);
    assert.equal(review.task.state, 'failed');
    assert.equal(review.review, undefined);
    assert.equal(invalidCalls.layaCalls, 0);
    assert.equal(invalidCalls.agentArtsCalls, 0);
    assert.equal(store.read().revision, 5);
  } finally {
    // Terminal task state persists before the dispatch promise settles; drain before closing.
    for (let i = 0; i < 400 && binding.application.activeTaskCount > 0; i++) await new Promise(r => setTimeout(r, 5));

    binding.close();
    await rm(invalidPaths.directory, {recursive: true, force: true});
  }
});

test('abort or close during a pending export preparation cannot dispatch after it resolves', async () => {
  for (const interruption of ['abort', 'close']) {
    const paths = await workspace();
    const calls = state({handoff: false});
    let binding = open(paths, calls);
    try {
      const {review} = await factChain(binding);
      assert.equal(review.handoff.state, 'unavailable');
      binding.close();
      calls.handoff = true;
      calls.prepareGate = gate();
      binding = open(paths, calls);
      const controller = new AbortController();
      const pending = binding.host.handoffReview(review.task.taskId, {
        deadline: context().deadline, signal: controller.signal});
      await calls.prepareGate.entered;
      if (interruption === 'abort') controller.abort();
      else binding.host.close();
      calls.prepareGate.release();
      await assert.rejects(pending, {code: 'CANCELLED'});
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls.dispatchAttempts, 0);
      assert.equal(calls.agentArtsCalls, 0);
      assert.equal(binding.application.runtime.loadCheckpoint(review.task.taskId,
        'proactive-cognition-handoff-v1'), undefined);
      assert.equal(binding.application.runtime.bindCoordinationStore(graphNamespace).read().revision, 5);
    } finally {
      binding.close();
      await rm(paths.directory, {recursive: true, force: true});
    }
  }
});

test('abort or close during dispatch reports pending and retries the same command without rerunning Laya', async () => {
  for (const interruption of ['abort', 'close']) {
    const paths = await workspace();
    const calls = state({handoff: false});
    let binding = open(paths, calls);
    try {
      const {review} = await factChain(binding);
      binding.close();
      calls.handoff = true;
      calls.dispatchGate = gate();
      binding = open(paths, calls);
      const controller = new AbortController();
      const pending = binding.host.handoffReview(review.task.taskId, {
        deadline: context().deadline, signal: controller.signal});
      await calls.dispatchGate.entered;
      const intent = binding.application.runtime.loadCheckpoint(review.task.taskId,
        'proactive-cognition-handoff-v1');
      assert.ok(intent?.commandId);
      if (interruption === 'abort') controller.abort();
      else binding.host.close();
      const interrupted = await pending;
      assert.deepEqual(interrupted.handoff, {state: 'pending'});
      calls.dispatchGate.release();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls.agentArtsCalls, 0);
      assert.equal(binding.application.runtime.findTaskByIdempotencyKey(intent.commandId), undefined);
      binding.close();
      delete calls.dispatchGate;
      binding = open(paths, calls);
      const retried = await binding.host.handoffReview(review.task.taskId, context());
      assert.equal(retried.handoff.state, 'submitted');
      await waitFor(binding.application, retried.handoff.task.taskId, 'succeeded');
      assert.equal(binding.application.runtime.loadCheckpoint(review.task.taskId,
        'proactive-cognition-handoff-v1').commandId, intent.commandId);
      assert.equal(calls.layaCalls, 1);
      assert.equal(calls.agentArtsCalls, 1);
      assert.equal(binding.application.runtime.bindCoordinationStore(graphNamespace).read().revision, 5);
    } finally {
      binding.close();
      await rm(paths.directory, {recursive: true, force: true});
    }
  }
});

test('export scope denial before dispatch leaves a durable handoff for same-command retry', async () => {
  const paths = await workspace();
  const calls = state({denyDispatch: true});
  let binding = open(paths, calls);
  try {
    await assert.rejects(factChain(binding), /scope was revoked/);
    const review = binding.application.runtime.listTasks({conversationId:
      `proactive-cognition:${graphNamespace}`}).items.find(task =>
      binding.application.runtime.loadCheckpoint(task.taskId, 'proactive-cognition-handoff-v1'));
    assert.ok(review);
    const saved = binding.application.runtime.loadCheckpoint(review.taskId,
      'proactive-cognition-handoff-v1');
    assert.equal(calls.agentArtsCalls, 0);
    assert.equal(binding.application.runtime.bindCoordinationStore(graphNamespace).read().revision, 5);
    binding.close();
    calls.denyDispatch = false;
    binding = open(paths, calls);
    const shorter = context(5_000);
    const retry = await binding.host.handoffReview(review.taskId, shorter);
    assert.equal(retry.handoff.state, 'submitted');
    await waitFor(binding.application, retry.handoff.task.taskId, 'succeeded');
    assert.deepEqual(binding.application.runtime.loadCheckpoint(review.taskId,
      'proactive-cognition-handoff-v1'), saved);
    assert.equal(calls.dispatchDeadlines.at(-1), shorter.deadline,
      'caller deadline narrows the saved handoff deadline');
    assert.equal(calls.layaCalls, 1);
    assert.equal(calls.agentArtsCalls, 1);
    assert.equal(binding.application.runtime.bindCoordinationStore(graphNamespace).read().revision, 5);
  } finally {
    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }
});

test('expired saved handoff is reported without blocking a review or dispatching', async t => {
  t.mock.timers.enable({apis:['Date'],now:Date.now()});
  const paths = await workspace();
  const calls = state({failDispatchOnce: true});
  const binding = open(paths, calls);
  try {
    await assert.rejects(factChain(binding, context()), /interruption/);
    const review = binding.application.runtime.listTasks({conversationId:
      `proactive-cognition:${graphNamespace}`}).items.find(task =>
      binding.application.runtime.loadCheckpoint(task.taskId, 'proactive-cognition-handoff-v1'));
    assert.ok(review);
    const intent = binding.application.runtime.loadCheckpoint(review.taskId,
      'proactive-cognition-handoff-v1');
    t.mock.timers.setTime(Date.parse(intent.deadline)+5);
    const replay = await binding.host.handoffReview(review.taskId, context());
    assert.equal(replay.review.selectedOption.id, 'revise');
    assert.deepEqual(replay.handoff, {state: 'expired'});
    assert.equal(calls.agentArtsCalls, 0);
    assert.equal(calls.dispatchAttempts, 1);
  } finally {
    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }
});

test('bounded receipt cursor reports review backlog after the source feed reaches watermark', async () => {
  const paths = await workspace();
  const calls = state();
  const binding = open(paths, calls);
  try {
    const {review} = await factChain(binding);
    const first = await binding.host.consumeAndReview({...context(), at, limit: 1,
      afterGraphRevision: 0});
    assert.equal(first.atWatermark, true);
    assert.equal(first.nextGraphRevision, 1);
    assert.equal(first.hasMoreReviews, true);
    const second = await binding.host.consumeAndReview({...context(), at, limit: 1,
      afterGraphRevision: 1});
    assert.equal(second.reviews[0].task.taskId, review.task.taskId);
    assert.equal(second.nextGraphRevision, 5);
    assert.equal(second.hasMoreReviews, false);
    assert.equal(calls.layaCalls, 1);
    assert.equal(calls.agentArtsCalls, 1);
  } finally {
    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }
});

test('cancellation during Laya choice saves no review and does not submit to AgentArts', async () => {
  const paths = await workspace();
  const calls = state();
  const binding = open(paths, calls);
  try {
    record(binding.facts, 'a', null);
    await binding.host.consumeAndReview({...context(), at, limit: 10, afterGraphRevision: 0});
    const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    const factId = store.read().history[0].id;
    store.append(1, node('goal', 'goal', [ref(factId)]));
    record(binding.facts, 'b', 1);
    const controller = new AbortController();
    calls.onInfer = async () => controller.abort();
    await assert.rejects(binding.host.consumeAndReview({deadline: context().deadline,
      signal: controller.signal, at, limit: 10, afterGraphRevision: 1}), {code: 'CANCELLED'});
    const failed = binding.application.runtime.listTasks({conversationId:
      `proactive-cognition:${graphNamespace}`}).items.find(task => task.state === 'failed');
    assert.ok(failed);
    assert.equal(binding.application.runtime.loadCheckpoint(failed.taskId,
      'proactive-cognition-review-v1'), undefined);
    assert.equal(calls.agentArtsCalls, 0);
    assert.equal(store.read().revision, 3);
  } finally {
    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }
});

test('Goal revision also routes Laya selection to AgentArts without graph mutation', async () => {
  const paths = await workspace();
  const calls = state();
  const binding = open(paths, calls);
  try {
    record(binding.facts, 'a', null);
    await binding.host.consumeAndReview({...context(), at, limit: 10, afterGraphRevision: 0});
    const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    const factId = store.read().history[0].id;
    store.append(1, node('goal', 'goal', [ref(factId)], 'old goal'));
    store.append(2, node('decision', 'decision', [ref('goal')]));
    store.append(3, node('plan', 'plan', [ref('decision')]));
    store.append(4, node('goal', 'goal', [ref(factId)], 'revised goal'));
    const input = {expectedGraphRevision: 5, previousGoal: ref('goal'), currentGoal: ref('goal', 2)};
    const first = await binding.host.reviewGoalRevision(input, {...context(), at});
    assert.equal(first.review.selectedOption.id, 'revise');
    assert.deepEqual(first.review.affected.map(item => item.node.id), ['decision', 'plan']);
    assert.deepEqual(first.review.selectedOption.repair.changes.map(change => change.node.id),
      ['decision', 'plan']);
    assert.equal(first.handoff.state, 'submitted');
    await waitFor(binding.application, first.handoff.task.taskId, 'succeeded');
    const second = await binding.host.reviewGoalRevision(input, {...context(), at});
    assert.equal(second.task.taskId, first.task.taskId);
    assert.equal(second.handoff.task.taskId, first.handoff.task.taskId);
    assert.equal(calls.layaCalls, 1);
    assert.equal(calls.agentArtsCalls, 1);
    assert.equal(store.read().revision, 5);
  } finally {
    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }
});

test('public Fact expiry without a new feed event creates one durable AgentArts review', async () => {
  const paths = await workspace();
  const calls = state({selectedId: 'recheck'});
  let binding = open(paths, calls);
  const expiry = '2026-09-27T04:00:00.000Z';
  try {
    binding.facts.recordPublicSource({...source, sourceRevision: 'a'.repeat(64), line: 1,
      summary: 'Public meeting schedule valid until the announced cutoff',
      observedAt: '2026-09-25T00:00:00.000Z', validFrom: '2026-09-25T00:00:00.000Z',
      validUntil: expiry, expectedFactRevision: null}, context());
    const baseline = await binding.host.consumeAndReview({...context(), at, limit: 10, afterGraphRevision: 0});
    const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    const factId = store.read().history[0].id;
    store.append(1, node('goal', 'goal', [ref(factId)]));
    store.append(2, node('decision', 'decision', [ref('goal')]));
    store.append(3, node('plan', 'plan', [ref('decision')]));
    const poll = time => binding.host.consumeAndReview({...context(), at: time, limit: 10,
      afterGraphRevision: baseline.nextGraphRevision});
    assert.deepEqual((await poll(at)).reviews, []);
    assert.equal(calls.layaCalls, 0);
    const expired = await poll(expiry);
    assert.equal(expired.atWatermark, true);
    assert.equal(expired.hasMoreReviews, false);
    assert.equal(expired.nextGraphRevision, baseline.nextGraphRevision, 'expiry does not advance the Fact receipt cursor');
    assert.equal(expired.reviews.length, 1);
    const review = expired.reviews[0];
    assert.equal(review.task.state, 'succeeded');
    assert.equal(review.review.action, 'RECHECK');
    assert.deepEqual(review.review.options.map(option => option.id), ['recheck', 'defer']);
    assert.deepEqual(review.review.affected.map(item => item.node.id), ['goal', 'decision', 'plan']);
    assert.equal(review.handoff.state, 'submitted');
    await waitFor(binding.application, review.handoff.task.taskId, 'succeeded');
    assert.equal(store.read().revision, 4, 'expired knowledge is not locally repaired or renewed');
    const later = await poll('2026-09-27T04:01:00.000Z');
    assert.equal(later.reviews[0].task.taskId, review.task.taskId);
    store.append(4, node('unrelated', 'fact', [], 'Unrelated public observation'));
    binding.close();
    binding = open(paths, calls);
    const recovered = await poll('2026-09-27T04:02:00.000Z');
    assert.equal(recovered.reviews[0].task.taskId, review.task.taskId);
    assert.equal(recovered.reviews[0].handoff.task.taskId, review.handoff.task.taskId);
    assert.equal(calls.layaCalls, 1, 'polling, restart and unrelated graph changes do not rerun Laya');
    assert.equal(calls.agentArtsCalls, 1);
    assert.equal(binding.application.runtime.bindCoordinationStore(graphNamespace).read().revision, 5);
  } finally {
    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }
});

test('new public Fact expiry is analyzed before an older blocked Goal handoff without starving its recovery at limit one', async () => {
  const paths = await workspace();
  const calls = state({prepareUnavailable: true});
  let binding = open(paths, calls);
  const expiry = '2026-09-27T04:00:00.000Z';
  try {
    binding.facts.recordPublicSource({...source, sourceRevision: 'a'.repeat(64), line: 1,
      summary: 'Public schedule with an explicit validity cutoff', observedAt: at,
      validFrom: at, validUntil: expiry, expectedFactRevision: null}, context());
    const baseline = await binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0});
    const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    const fact = store.read().history[0];
    const {kind: _kind, ...goal} = node('unplanned-goal', 'goal', [], 'Plan a public demonstration');
    const created = createGoal(store, store.read().revision, goal);
    store.append(store.read().revision, node('expiry-plan', 'plan', [ref(fact.id)]));
    const graphRevision = store.read().revision;
    const poll = () => binding.host.consumeAndReview({...context(), at: expiry, limit: 1,
      afterGraphRevision: baseline.nextGraphRevision});

    const first = await poll();
    assert.equal(first.reviews.length, 1);
    const initial = first.reviews[0];
    assert.deepEqual(initial.review.subjectGoal, ref(created.goal.id));
    assert.equal(initial.review.selectedOption.id, 'plan', 'fresh Goal planning remains first');
    assert.equal(initial.handoff.state, 'unavailable');

    const second = await poll();
    assert.equal(second.reviews.length, 1);
    const expired = second.reviews[0];
    assert.equal(expired.review.subjectGoal, undefined);
    assert.deepEqual(expired.review.affected.map(item => item.node.id), ['expiry-plan']);
    assert.equal(expired.review.selectedOption.id, 'recheck');
    assert.equal(expired.handoff.state, 'unavailable');
    assert.equal(calls.layaCalls, 2, 'the new expiry is analyzed locally despite unavailable cloud preparation');
    assert.equal(calls.agentArtsCalls, 0);

    for (let i = 0; i < 2; i++) {
      const blocked = await poll();
      assert.equal(blocked.reviews.length, 1);
      assert.equal(blocked.reviews[0].task.taskId, initial.task.taskId,
        'an existing unavailable expiry must not repeatedly take the Goal recovery slot');
      assert.equal(blocked.nextGraphRevision, baseline.nextGraphRevision);
    }
    binding.close(); binding = open(paths, calls);
    const restarted = await poll();
    assert.equal(restarted.reviews[0].task.taskId, initial.task.taskId);
    assert.equal(calls.layaCalls, 2, 'restart retains both exact local decisions');

    calls.selectedId = 'plan';
    calls.prepareUnavailable = review => !review.subjectGoal;
    const acceptedGoal = await poll();
    assert.equal(acceptedGoal.reviews[0].task.taskId, initial.task.taskId);
    assert.equal(acceptedGoal.reviews[0].handoff.state, 'submitted');
    await waitFor(binding.application, acceptedGoal.reviews[0].handoff.task.taskId, 'succeeded');
    const stillBlockedExpiry = await poll();
    assert.equal(stillBlockedExpiry.reviews[0].task.taskId, expired.task.taskId);
    assert.equal(stillBlockedExpiry.reviews[0].handoff.state, 'unavailable');
    assert.equal(calls.agentArtsCalls, 1, 'Goal recovery does not grant the expiry permission');

    calls.selectedId = 'recheck'; calls.prepareUnavailable = false;
    const acceptedExpiry = await poll();
    assert.equal(acceptedExpiry.reviews[0].task.taskId, expired.task.taskId);
    assert.equal(acceptedExpiry.reviews[0].handoff.state, 'submitted');
    await waitFor(binding.application, acceptedExpiry.reviews[0].handoff.task.taskId, 'succeeded');
    const replay = await poll();
    assert.equal(replay.reviews[0].handoff.task.taskId, acceptedExpiry.reviews[0].handoff.task.taskId);
    assert.equal(replay.reviews.length, 1);
    assert.equal(replay.nextGraphRevision, baseline.nextGraphRevision);
    assert.equal(calls.layaCalls, 2); assert.equal(calls.agentArtsCalls, 2);
    assert.equal(binding.application.runtime.bindCoordinationStore(graphNamespace).read().revision, graphRevision);
  } finally {
    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }
});

test('uncertain Laya choice preserves its receipt and recovers a machine review handoff once', async () => {
  const paths = await workspace();
  const calls = state({choiceConfidence: 0.6, expectMachineReview: true, handoff: false});
  let binding = open(paths, calls);
  try {
    const {review} = await factChain(binding);
    assert.equal(review.review.selectedOption, undefined);
    assert.equal(review.review.action, 'RECHECK');
    assert.equal(review.review.selection.reason, 'uncertain');
    assert.equal(review.review.selection.eligibleForRuntime, false);
    assert.deepEqual(review.review.selection.selected, {id: 'revise', revision: 1});
    assert.equal(review.review.selection.answerConfidence, 0.6);
    assert.equal(calls.agentArtsCalls, 0);
    const original = structuredClone(review.review.selection);
    // Simulate a persisted review produced before machine-review routing existed.
    const legacy = structuredClone(review.review);
    delete legacy.machineReview;
    binding.application.runtime.saveCheckpoint(review.task.taskId, 'proactive-cognition-review-v1', legacy);
    binding.close(); calls.handoff = true;
    binding = open(paths, calls);
    const resumed = await binding.host.handoffReview(review.task.taskId, context());
    assert.equal(resumed.handoff.state, 'submitted');
    assert.equal(resumed.review.selectedOption, undefined);
    assert.deepEqual(resumed.review.selection, original);
    assert.deepEqual(resumed.review.machineReview.option, {id: 'recheck', revision: 1});
    await waitFor(binding.application, resumed.handoff.task.taskId, 'succeeded');
    const persisted = binding.application.runtime.loadCheckpoint(review.task.taskId, 'proactive-cognition-review-v1');
    assert.deepEqual(persisted.machineReview, resumed.review.machineReview);
    binding.close(); binding = open(paths, calls);
    const replay = await binding.host.handoffReview(review.task.taskId, context());
    assert.equal(replay.handoff.task.taskId, resumed.handoff.task.taskId);
    assert.deepEqual(replay.review.selection, original);
    assert.equal(calls.layaCalls, 1);
    assert.equal(calls.agentArtsCalls, 1);
    assert.equal(binding.application.runtime.bindCoordinationStore(graphNamespace).read().revision, 5);
  } finally {
    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }
});

test('unavailable Laya or uncertainty without an offered recheck never invents a handoff route', async () => {
  for (const mode of ['unavailable', 'no_recheck']) {
    const paths = await workspace();
    const calls = state(mode === 'unavailable' ? {onInfer: () => { throw Error('Fake Laya unavailable'); }}
      : {choiceConfidence: 0.6, prepareOptions: review => review.options.filter(option => option.id !== 'recheck')});
    const binding = open(paths, calls);
    try {
      let review;
      if (mode === 'unavailable') {
        await assert.rejects(factChain(binding), {code: 'EXTERNAL_FAILURE'});
        const task = binding.application.runtime.listTasks({conversationId: `proactive-cognition:${graphNamespace}`})
          .items.find(task => binding.host.readReview(task.taskId).review?.selection?.reason === 'unavailable');
        review = binding.host.readReview(task.taskId);
      } else ({review} = await factChain(binding));
      assert.equal(review.review.selection.reason, mode === 'unavailable' ? 'unavailable' : 'uncertain');
      assert.equal(review.review.selectedOption, undefined);
      assert.equal(review.review.machineReview, undefined);
      assert.equal(review.handoff, undefined);
      assert.equal(calls.prepares, 0);
      assert.equal(calls.agentArtsCalls, 0);
    } finally {
      binding.close();
      await rm(paths.directory, {recursive: true, force: true});
    }
  }
});

test('Laya availability recovery keeps cooldown and prior receipts while handing off only the recovered review', async () => {
  const paths = await workspace();
  const calls = state({now: Date.now(), onInfer: () => { throw Error('Fake Laya temporarily unavailable'); }});
  let binding = open(paths, calls);
  let evaluatedAt = at;
  const poll = () => binding.host.consumeAndReview({...context(), at: evaluatedAt, limit: 10, afterGraphRevision: 1});
  const tasks = () => binding.application.runtime.listTasks({conversationId: `proactive-cognition:${graphNamespace}`}).items;
  try {
    await assert.rejects(factChain(binding), {code: 'EXTERNAL_FAILURE'});
    const originalTask = tasks().find(task => binding.host.readReview(task.taskId).review?.selection?.reason === 'unavailable');
    assert.ok(originalTask);
    const original = binding.host.readReview(originalTask.taskId);
    const count = tasks().length;
    assert.equal(calls.layaCalls, 1);
    for (let tick = 0; tick < 2; tick++) {
      calls.now += 1_000;
      await assert.rejects(poll(), {code: 'EXTERNAL_FAILURE'});
    }
    assert.equal(tasks().length, count, 'ticks during cooldown create no successor task');
    assert.equal(calls.layaCalls, 1);
    binding.close(); binding = open(paths, calls);
    await assert.rejects(poll(), {code: 'EXTERNAL_FAILURE'});
    assert.equal(tasks().length, count, 'restart preserves cooldown');
    calls.now += 30_000;
    await assert.rejects(poll(), {code: 'EXTERNAL_FAILURE'});
    assert.equal(tasks().length, count + 1);
    assert.equal(calls.layaCalls, 2);
    const next = tasks().find(task => binding.application.runtime.loadCheckpoint(task.taskId,
      'proactive-cognition-intent-v1')?.retryOf === originalTask.taskId);
    assert.ok(next, 'successor is explicitly bound to its prior completed task');
    calls.now += 1_000;
    await assert.rejects(poll(), {code: 'EXTERNAL_FAILURE'});
    assert.equal(tasks().length, count + 1, 'persistent unavailability gets a fresh cooldown');
    assert.equal(calls.layaCalls, 2);
    assert.deepEqual(binding.host.readReview(originalTask.taskId), original);
    assert.equal(calls.agentArtsCalls, 0);
    delete calls.onInfer;
    calls.now += 30_000;
    evaluatedAt = '2026-09-27T03:02:00.000Z';
    const recovered = (await poll()).reviews[0];
    assert.equal(recovered.review.selectedOption.id, 'revise');
    assert.equal(recovered.review.evaluatedAt, evaluatedAt, 'fresh inference checks validity at the retry time');
    assert.notEqual(recovered.task.taskId, originalTask.taskId);
    assert.equal(binding.application.runtime.loadCheckpoint(recovered.task.taskId,
      'proactive-cognition-intent-v1').retryOf, next.taskId);
    await waitFor(binding.application, recovered.handoff.task.taskId, 'succeeded');
    binding.close(); binding = open(paths, calls);
    const replay = (await poll()).reviews[0];
    assert.equal(replay.task.taskId, recovered.task.taskId);
    assert.equal(replay.handoff.task.taskId, recovered.handoff.task.taskId);
    assert.equal(calls.layaCalls, 3);
    assert.equal(calls.agentArtsCalls, 1);
    assert.deepEqual(binding.host.readReview(originalTask.taskId), original);
    assert.equal(binding.application.runtime.bindCoordinationStore(graphNamespace).read().revision, 5);
  } finally {
    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }
});

test('first committed Goal enters planning without invented impacts and reuses its handoff after restart', async () => {
  const paths = await workspace();
  let observedContext;
  const calls = state({selectedId: 'plan', handoffGoal: 'Plan next steps for an already registered synthetic goal.',
    onInfer: payload => { observedContext = payload.state.events[0].observation; }});
  let binding = open(paths, calls);
  try {
    const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    const {kind: _kind, ...input} = node('first-goal', 'goal', [], 'Prepare a public competition demonstration');
    const created = createGoal(store, 0, input);
    assert.equal(created.previous, null);
    const currentGoal = ref(created.goal.id, created.goal.revision);
    const first = await binding.host.reviewGoalCreated({expectedGraphRevision: created.graphRevision, currentGoal},
      {...context(), at});
    assert.equal(first.task.state, 'succeeded');
    assert.deepEqual(first.review.subjectGoal, currentGoal);
    assert.deepEqual(first.review.affected, [], 'creation does not invent a changed dependency');
    assert.deepEqual(first.review.options.map(option => option.id), ['plan', 'recheck', 'defer']);
    assert.ok(first.review.options.every(option => option.action === 'RECHECK' && option.repair === undefined));
    assert.equal(first.review.selectedOption.id, 'plan');
    assert.match(observedContext, /Prepare a public competition demonstration/);
    assert.equal(first.handoff.state, 'submitted');
    await waitFor(binding.application, first.handoff.task.taskId, 'succeeded');
    assert.equal(store.read().revision, 1);
    assert.deepEqual(store.read().history.map(node => node.kind), ['goal'], 'planning handoff does not create a Plan');
    binding.close(); binding = open(paths, calls);
    const restoredStore = binding.application.runtime.bindCoordinationStore(graphNamespace);
    restoredStore.append(1, node('unrelated', 'fact', [], 'Unrelated public observation'));
    const replay = await binding.host.reviewGoalCreated({expectedGraphRevision: 2, currentGoal}, {...context(), at});
    assert.equal(replay.task.taskId, first.task.taskId);
    assert.equal(replay.handoff.task.taskId, first.handoff.task.taskId);
    assert.equal(calls.layaCalls, 1);
    assert.equal(calls.agentArtsCalls, 1);
    assert.deepEqual(calls.goals, [calls.handoffGoal]);
    assert.equal(restoredStore.read().revision, 2);
  } finally {
    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }
});

test('initial planning rejects non-Goal, stale and withdrawn creation refs before inference', async () => {
  const paths = await workspace();
  const calls = state();
  const binding = open(paths, calls);
  try {
    const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    store.append(0, node('fact-only', 'fact', []));
    await assert.rejects(async () => binding.host.reviewGoalCreated({expectedGraphRevision: 1,
      currentGoal: ref('fact-only')}, {...context(), at}), {code: 'INVALID_ARGUMENT'});
    const {kind: _kind, ...input} = node('changed-goal', 'goal', []);
    createGoal(store, 1, input);
    reviseGoal(store, 2, 1, {...input, summary: 'Revised goal'});
    await assert.rejects(async () => binding.host.reviewGoalCreated({expectedGraphRevision: 3,
      currentGoal: ref('changed-goal')}, {...context(), at}), {code: 'REVISION_CONFLICT'});
    createGoal(store, 3, {...input, id: 'withdrawn-goal', state: 'withdrawn'});
    await assert.rejects(async () => binding.host.reviewGoalCreated({expectedGraphRevision: 4,
      currentGoal: ref('withdrawn-goal')}, {...context(), at}), {code: 'INVALID_ARGUMENT'});
    assert.equal(binding.application.runtime.listTasks({conversationId: `proactive-cognition:${graphNamespace}`}).items.length, 0);
    assert.equal(calls.layaCalls, 0);
    assert.equal(calls.agentArtsCalls, 0);
  } finally {
    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }
});

test('graph Goal consumption discovers command writes and shares UI handoffs across restart', async () => {
  const paths = await workspace();
  const calls = state({selectedId: 'plan'});
  let binding = open(paths, calls);
  const poll = () => binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0});
  try {
    let store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    const {kind: _kind, ...input} = node('graph-goal', 'goal', [], 'Prepare the public demonstration');
    createGoal(store, 0, input);
    const created = await poll();
    assert.equal(created.reviews.length, 1);
    const first = created.reviews[0];
    assert.deepEqual(first.review.subjectGoal, ref('graph-goal'));
    assert.deepEqual(first.review.affected, []);
    assert.equal(first.review.selectedOption.id, 'plan');
    assert.equal(created.nextGraphRevision, 0, 'Goal consumption does not advance the Fact cursor');
    await waitFor(binding.application, first.handoff.task.taskId, 'succeeded');
    assert.equal((await poll()).reviews.length, 0);
    store.append(1, node('decision', 'decision', [ref('graph-goal')]));
    store.append(2, node('plan', 'plan', [ref('decision')]));
    reviseGoal(store, 3, 1, {...input, summary: 'Prepare an updated public demonstration'});
    calls.selectedId = 'revise';
    const changed = (await poll()).reviews[0];
    assert.deepEqual(changed.review.affected.map(item => item.node.id), ['decision', 'plan']);
    assert.equal(changed.review.selectedOption.id, 'revise');
    await waitFor(binding.application, changed.handoff.task.taskId, 'succeeded');
    const ui = await binding.host.reviewGoalRevision({expectedGraphRevision: 4,
      previousGoal: ref('graph-goal'), currentGoal: ref('graph-goal', 2)}, {...context(), at});
    assert.equal(ui.task.taskId, changed.task.taskId);
    assert.equal(ui.handoff.task.taskId, changed.handoff.task.taskId);
    store.append(4, node('unrelated', 'fact', []));
    binding.close(); binding = open(paths, calls);
    store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    assert.equal((await poll()).reviews.length, 0);
    const replay = await binding.host.reviewGoalRevision({expectedGraphRevision: 5,
      previousGoal: ref('graph-goal'), currentGoal: ref('graph-goal', 2)}, {...context(), at});
    assert.equal(replay.task.taskId, changed.task.taskId);
    assert.equal(replay.handoff.task.taskId, changed.handoff.task.taskId);
    calls.selectedId = 'plan';
    createGoal(store, 5, {...input, id: 'next-goal'});
    const next = (await poll()).reviews[0];
    assert.deepEqual(next.review.subjectGoal, ref('next-goal'), 'completed heads do not consume the one-item limit');
    await waitFor(binding.application, next.handoff.task.taskId, 'succeeded');
    assert.equal(calls.layaCalls, 3);
    assert.equal(calls.agentArtsCalls, 3);
    calls.prepareUnavailable = true;
    createGoal(store, 6, {...input, id: 'waiting-goal'});
    const waiting = (await poll()).reviews[0];
    assert.deepEqual(waiting.review.subjectGoal, ref('waiting-goal'));
    assert.equal(waiting.handoff.state, 'unavailable');
    createGoal(store, 7, {...input, id: 'fresh-goal'});
    const fresh = (await poll()).reviews[0];
    assert.deepEqual(fresh.review.subjectGoal, ref('fresh-goal'),
      'an old unavailable handoff does not starve new Goal inference at limit one');
    assert.equal(calls.layaCalls, 5);
    assert.equal(calls.agentArtsCalls, 3, 'unavailable export preparation does not submit cloud work');
  } finally {
    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }
});

test('withdrawn Goal revisions review pinned plans while inactive creations and unaffected revisions stay local', async () => {
  for (const withPlan of [false, true]) {
    const paths = await workspace();
    const calls = state({selectedId: 'recheck', prepareUnavailable: true});
    let binding = open(paths, calls);
    const poll = () => binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0});
    try {
      const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
      const {kind: _kind, ...input} = node('withdrawn-revision-goal', 'goal', []);
      createGoal(store, 0, {...input, id: 'inactive-creation', state: 'withdrawn'});
      createGoal(store, 1, {...input, id: 'future-creation', validFrom: '2027-01-01T00:00:00.000Z'});
      createGoal(store, 2, input);
      if (withPlan) store.append(3, node('pinned-plan', 'plan', [ref(input.id)]));
      const revision = store.read().revision;
      reviseGoal(store, revision, 1, {...input, state: 'withdrawn', reason: 'User withdrew this Goal'});
      const before = store.read();
      const batch = await poll(), first = batch.reviews[0];
      assert.equal(batch.reviews.length, 1);assert.equal(batch.nextGraphRevision, 0);
      assert.equal(first.review.subjectGoal, undefined, 'withdrawal is a revision review, never initial planning');
      assert.equal(first.review.action, withPlan ? 'RECHECK' : 'KEEP');
      assert.deepEqual(first.review.affected.map(item => item.node.id), withPlan ? ['pinned-plan'] : []);
      assert.equal(calls.layaCalls, withPlan ? 1 : 0);
      assert.equal(calls.agentArtsCalls, 0);
      binding.close();binding = open(paths, calls);
      const recovered = await poll();
      assert.equal(recovered.reviews.length, withPlan ? 1 : 0);
      if (withPlan) {
        assert.equal(recovered.reviews[0].task.taskId, first.task.taskId);
        assert.equal(recovered.reviews[0].handoff.state, 'unavailable');
        calls.prepareUnavailable = false;
        const submitted = (await poll()).reviews[0];
        assert.equal(submitted.task.taskId, first.task.taskId);
        assert.equal(submitted.handoff.state, 'submitted');
        await waitFor(binding.application, submitted.handoff.task.taskId, 'succeeded');
        assert.equal((await poll()).reviews.length, 0);
      }
      assert.equal(calls.layaCalls, withPlan ? 1 : 0);
      assert.equal(calls.agentArtsCalls, withPlan ? 1 : 0);
      assert.deepEqual(binding.application.runtime.bindCoordinationStore(graphNamespace).read(), before,
        'review and handoff never reactivate the Goal or rewrite its Plan');
    } finally {
      binding.close();await rm(paths.directory, {recursive: true, force: true});
    }
  }
});

test('future or expired Goal revisions review pinned plans without starting first planning or rewriting validity', async () => {
  for (const validity of [{validFrom: '2027-01-01T00:00:00.000Z'}, {validUntil: '2026-09-26T00:00:00.000Z'}]) {
    for (const withPlan of [false, true]) {
      const paths = await workspace(), calls = state({selectedId: 'recheck', prepareUnavailable: true});
      let binding = open(paths, calls);
      const poll = () => binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0});
      try {
        const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
        const {kind: _kind, ...input} = node('validity-revision-goal', 'goal', []);
        createGoal(store, 0, input);
        if (withPlan) store.append(1, node('validity-pinned-plan', 'plan', [ref(input.id)]));
        reviseGoal(store, store.read().revision, 1, {...input, ...validity, reason: 'User revised Goal validity'});
        const before = store.read(), batch = await poll(), first = batch.reviews[0];
        assert.equal(batch.reviews.length, 1);assert.equal(batch.nextGraphRevision, 0);
        assert.equal(first.review.subjectGoal, undefined);
        assert.equal(first.review.action, withPlan ? 'RECHECK' : 'KEEP');
        assert.deepEqual(first.review.affected.map(item => item.node.id), withPlan ? ['validity-pinned-plan'] : []);
        assert.equal(calls.layaCalls, withPlan ? 1 : 0);assert.equal(calls.agentArtsCalls, 0);
        binding.close();binding = open(paths, calls);
        const restored = await poll();
        assert.equal(restored.reviews.length, withPlan ? 1 : 0);
        if (withPlan) {
          assert.equal(restored.reviews[0].task.taskId, first.task.taskId);
          calls.prepareUnavailable = false;
          const submitted = (await poll()).reviews[0];
          assert.equal(submitted.task.taskId, first.task.taskId);
          await waitFor(binding.application, submitted.handoff.task.taskId, 'succeeded');
          assert.equal((await poll()).reviews.length, 0);
        }
        assert.equal(calls.layaCalls, withPlan ? 1 : 0);assert.equal(calls.agentArtsCalls, withPlan ? 1 : 0);
        assert.deepEqual(binding.application.runtime.bindCoordinationStore(graphNamespace).read(), before);
      } finally {
        binding.close();await rm(paths.directory, {recursive: true, force: true});
      }
    }
  }
});

test('graph Goal consumption resumes a legacy created revision task without changing its identity', async () => {
  const paths = await workspace();
  const calls = state();
  let binding = open(paths, calls);
  const poll = () => binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0});
  try {
    const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    const {kind: _kind, ...input} = node('legacy-goal', 'goal', []);
    createGoal(store, 0, input);
    store.append(1, node('decision', 'decision', [ref('legacy-goal')]));
    store.append(2, node('plan', 'plan', [ref('decision')]));
    reviseGoal(store, 3, 1, {...input, summary: 'Updated legacy goal'});
    const trigger = {kind: 'goal', input: {expectedGraphRevision: 4,
      previousGoal: ref('legacy-goal'), currentGoal: ref('legacy-goal', 2)}};
    const bindingVersion = 'test-binding-v1';
    const idempotencyKey = 'proactive-cognition:' + toolArgumentsDigest({graphNamespace, bindingVersion, trigger});
    const legacy = binding.application.runtime.submitTaskWithCheckpoint({goal: 'Legacy Goal change',
      conversationId: `proactive-cognition:${graphNamespace}`, idempotencyKey},
    'proactive-cognition-intent-v1', {version: 1, graphNamespace, bindingVersion, trigger, evaluatedAt: at});
    const reviewed = (await poll()).reviews[0];
    assert.equal(reviewed.task.taskId, legacy.taskId);
    await waitFor(binding.application, reviewed.handoff.task.taskId, 'succeeded');
    store.append(4, node('unrelated', 'fact', []));
    binding.close(); binding = open(paths, calls);
    assert.equal((await poll()).reviews.length, 0);
    const replay = await binding.host.reviewGoalRevision({...trigger.input, expectedGraphRevision: 5}, {...context(), at});
    assert.equal(replay.task.taskId, legacy.taskId);
    assert.equal(replay.handoff.task.taskId, reviewed.handoff.task.taskId);
    assert.equal(binding.application.runtime.listTasks({conversationId: `proactive-cognition:${graphNamespace}`}).items.length, 1);
    assert.equal(calls.layaCalls, 1);
    assert.equal(calls.agentArtsCalls, 1);
  } finally {
    binding.close();
    await rm(paths.directory, {recursive: true, force: true});
  }
});


test('host preparation callbacks cannot replace private lifecycle checks after interruption',async t=>{
  for(const callback of ['prepare','prepareOptions'])for(const lifecycle of ['cancel','deadline']){
    await t.test(`${callback}, ${lifecycle}`,async()=>{
      const paths=await workspace(),blocked=gate(),calls=state({handoff:callback==='prepareOptions'});
      let binding=open(paths,calls);
      const controller=new AbortController();
      const replaceContext=request=>{
        request.signal=new AbortController().signal;
        request.deadline=new Date(Date.now()+60_000).toISOString();
      };
      try{
        let reviewTaskId,pending,initialTaskIds;
        if(callback==='prepare'){
          const {review}=await factChain(binding);
          reviewTaskId=review.task.taskId;
          assert.equal(review.handoff.state,'unavailable');
          binding.close();
          calls.handoff=true;calls.onPrepare=replaceContext;calls.prepareGate=blocked;
          binding=open(paths,calls);
          pending=binding.host.handoffReview(reviewTaskId,{...context(500),signal:controller.signal});
        }else{
          record(binding.facts,'a',null);
          await binding.host.consumeAndReview({...context(),at,limit:10,afterGraphRevision:0});
          const store=binding.application.runtime.bindCoordinationStore(graphNamespace);
          const factId=store.read().history[0].id;
          store.append(1,node('goal','goal',[ref(factId)]));
          record(binding.facts,'b',1);
          binding.close();
          calls.prepareOptions=async(review,request)=>{
            replaceContext(request);blocked.arrive();await blocked.pending;return review.options;
          };
          binding=open(paths,calls);
          initialTaskIds=new Set(binding.application.runtime.listTasks({conversationId:'proactive-cognition:'+graphNamespace,limit:10}).items.map(task=>task.taskId));
          pending=binding.host.consumeAndReview({...context(500),signal:controller.signal,
            at,limit:10,afterGraphRevision:1});
        }
        // Observe early failure as well as entry so setup itself cannot hang.
        const settled=pending.then(()=>undefined,error=>error);
        await Promise.race([blocked.entered,settled.then(error=>{throw error??Error('Preparation did not block');})]);
        if(lifecycle==='cancel')controller.abort('Synthetic caller cancellation');
        if(callback==='prepare'){
          await assert.rejects(pending,{code:lifecycle==='cancel'?'CANCELLED':'TIMEOUT'});
          blocked.release();
        }else{
          if(lifecycle==='deadline')await new Promise(resolve=>setTimeout(resolve,550));
          blocked.release();
          await assert.rejects(pending,{code:lifecycle==='cancel'?'CANCELLED':'TIMEOUT'});
        }
        await new Promise(resolve=>setImmediate(resolve));
        for(let n=0;n<200&&binding.application.activeTaskCount;n++)await new Promise(resolve=>setTimeout(resolve,5));
        assert.equal(calls.dispatchAttempts,0);assert.equal(calls.agentArtsCalls,0);
        assert.deepEqual(binding.application.runtime.listTasks({conversationId:'synthetic-agentarts-handoff',limit:10}).items,[]);
        if(callback==='prepare'){
          assert.equal(binding.application.runtime.loadCheckpoint(reviewTaskId,'proactive-cognition-handoff-v1'),undefined);
          assert.equal(binding.host.readReview(reviewTaskId).task.state,'succeeded');
        }else{
          const tasks=binding.application.runtime.listTasks({conversationId:'proactive-cognition:'+graphNamespace,limit:10}).items;
          const interrupted=tasks.find(task=>!initialTaskIds.has(task.taskId));
          assert.ok(interrupted);
          assert.notEqual(interrupted.state,'succeeded');
          assert.equal(binding.application.runtime.loadCheckpoint(interrupted.taskId,'proactive-cognition-review-v1'),undefined);
          assert.equal(binding.application.runtime.loadCheckpoint(interrupted.taskId,'proactive-cognition-handoff-v1'),undefined);
          assert.equal(calls.layaCalls,0);
        }
      }finally{
        blocked.release();
        for(let n=0;n<200&&binding.application.activeTaskCount;n++)await new Promise(resolve=>setTimeout(resolve,5));
        binding.close();await rm(paths.directory,{recursive:true,force:true});
      }
    });
  }
});

function appendAncestorFixture(binding, {withOlderPlan = true, withLatestPlan = false, withMixedPlan = false} = {}) {
  const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
  const {kind: _kind, ...goal} = node('ancestor-goal', 'goal', []);
  createGoal(store, 0, goal);
  if (withOlderPlan) store.append(store.read().revision, node('older-plan', 'plan', [ref(goal.id)]));
  reviseGoal(store, store.read().revision, 1, {...goal, summary: 'Synthetic Goal2'});
  if (withLatestPlan) store.append(store.read().revision, node('latest-plan', 'plan', [ref(goal.id, 2)]));
  if (withMixedPlan) {
    store.append(store.read().revision, node('older-decision', 'decision', [ref(goal.id)]));
    store.append(store.read().revision, node('latest-decision', 'decision', [ref(goal.id, 2)]));
    store.append(store.read().revision, node('mixed-plan', 'plan', [ref('older-decision'), ref('latest-decision')]));
  }
  reviseGoal(store, store.read().revision, 2, {...goal, summary: 'Synthetic Goal3'});
  return store;
}

test('coalesced Goal ancestor discovery preserves KEEP and recovers one bounded stable handoff after restart', async () => {
  const paths = await workspace(), calls = state();
  let binding = open(paths, calls);
  const poll = () => binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0});
  try {
    let store = appendAncestorFixture(binding);
    const original = (await poll()).reviews[0];
    assert.equal(original.review.action, 'KEEP');
    assert.deepEqual(original.review.affected, []); assert.equal(calls.layaCalls, 0);
    const ancestor = (await poll()).reviews[0];
    assert.deepEqual(ancestor.review.affected.map(item => item.node.id), ['older-plan']);
    assert.equal(ancestor.review.selectedOption.id, 'revise');
    assert.notEqual(ancestor.task.taskId, original.task.taskId);
    await waitFor(binding.application, ancestor.handoff.task.taskId, 'succeeded');
    assert.equal(calls.layaCalls, 1); assert.equal(calls.agentArtsCalls, 1);
    const reversed = await binding.host.reviewGoalAncestorImpact({currentGoal: {revision: 3, id: 'ancestor-goal'},
      expectedGraphRevision: 4}, {...context(), at});
    assert.equal(reversed.task.taskId, ancestor.task.taskId);
    assert.deepEqual(binding.application.runtime.loadCheckpoint(reversed.task.taskId,
      'proactive-cognition-intent-v1').trigger.input.currentGoal, ref('ancestor-goal', 3));
    assert.equal(store.read().revision, 4, 'review never appends a repaired Plan');
    const expectedReview = structuredClone(ancestor.review);
    assert.equal((await poll()).reviews.length, 0);
    store.append(4, node('unrelated-public-fact', 'fact', []));
    binding.close(); binding = open(paths, calls);
    store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    assert.equal((await poll()).reviews.length, 0);
    const replay = await binding.host.reviewGoalAncestorImpact({expectedGraphRevision: 5,
      currentGoal: ref('ancestor-goal', 3)}, {...context(), at});
    assert.equal(replay.task.taskId, ancestor.task.taskId);
    assert.equal(replay.handoff.task.taskId, ancestor.handoff.task.taskId);
    assert.deepEqual(replay.review, expectedReview);
    assert.equal(calls.layaCalls, 1); assert.equal(calls.agentArtsCalls, 1);
    store.append(5, node('new-older-plan', 'plan', [ref('ancestor-goal')]));
    const expanded = (await poll()).reviews[0];
    assert.deepEqual(expanded.review.affected.map(item => item.node.id), ['older-plan', 'new-older-plan']);
    assert.notEqual(expanded.task.taskId, ancestor.task.taskId, 'new exact consumers bind a new scope identity');
    await waitFor(binding.application, expanded.handoff.task.taskId, 'succeeded');
    assert.equal(calls.layaCalls, 2); assert.equal(calls.agentArtsCalls, 2);
    assert.deepEqual(binding.host.readReview(ancestor.task.taskId).review, expectedReview);
    assert.equal((await poll()).reviews.length, 0);
    assert.equal(store.read().revision, 6);
  } finally {binding.close(); await rm(paths.directory, {recursive: true, force: true});}
});

test('Goal ancestor difference excludes latest pins and mixed items without repeating the original choice', async () => {
  const paths = await workspace(), calls = state({handoff: false});
  const binding = open(paths, calls);
  try {
    const store = appendAncestorFixture(binding, {withOlderPlan: false, withLatestPlan: true, withMixedPlan: true});
    const first = await binding.host.consumeAndReview({...context(), at, limit: 10, afterGraphRevision: 0});
    assert.equal(first.reviews.length, 2);
    const [consecutive, ancestor] = first.reviews;
    assert.deepEqual(consecutive.review.affected.map(item => item.node.id), ['latest-plan', 'latest-decision', 'mixed-plan']);
    assert.deepEqual(ancestor.review.affected.map(item => item.node.id), ['older-decision']);
    assert.equal(calls.layaCalls, 2);
    const replay = await binding.host.reviewGoalRevision({expectedGraphRevision: store.read().revision,
      previousGoal: ref('ancestor-goal', 2), currentGoal: ref('ancestor-goal', 3)}, {...context(), at});
    assert.equal(replay.task.taskId, consecutive.task.taskId); assert.equal(calls.layaCalls, 2);
    assert.equal((await binding.host.consumeAndReview({...context(), at, limit: 10, afterGraphRevision: 0})).reviews.length, 0);
  } finally {binding.close(); await rm(paths.directory, {recursive: true, force: true});}
});

test('empty and stale ancestor requests create no task and old nonconsecutive requests remain rejected', async () => {
  const paths = await workspace(), calls = state({handoff: false});
  const binding = open(paths, calls);
  try {
    const store = appendAncestorFixture(binding, {withOlderPlan: false, withLatestPlan: true});
    const input = {expectedGraphRevision: store.read().revision, currentGoal: ref('ancestor-goal', 3)};
    assert.equal(await binding.host.reviewGoalAncestorImpact(input, {...context(), at}), undefined);
    for (const bad of [{...input, expectedGraphRevision: input.expectedGraphRevision - 1},
      {...input, currentGoal: ref('ancestor-goal', 2)}]) {
      await assert.rejects(async () => binding.host.reviewGoalAncestorImpact(bad, {...context(), at}), {code: 'REVISION_CONFLICT'});
    }
    await assert.rejects(async () => binding.host.reviewGoalRevision({...input, previousGoal: ref('ancestor-goal')},
      {...context(), at}), {code: 'INVALID_ARGUMENT'});
    assert.equal(binding.application.runtime.listTasks({conversationId: 'proactive-cognition:' + graphNamespace}).items.length, 0);
    assert.equal(calls.layaCalls, 0); assert.equal(calls.dispatchAttempts, 0);
  } finally {binding.close(); await rm(paths.directory, {recursive: true, force: true});}
});

test('new ancestor scope is not starved by a recorded latest-pin handoff at limit one', async () => {
  const paths = await workspace(), calls = state({prepareUnavailable: true});
  const binding = open(paths, calls);
  try {
    const store = appendAncestorFixture(binding, {withOlderPlan: true, withLatestPlan: true});
    const poll = () => binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0});
    const original = (await poll()).reviews[0];
    assert.deepEqual(original.review.affected.map(item => item.node.id), ['latest-plan']);
    const ancestor = (await poll()).reviews[0];
    assert.deepEqual(ancestor.review.affected.map(item => item.node.id), ['older-plan']);
    assert.notEqual(ancestor.task.taskId, original.task.taskId); assert.equal(calls.layaCalls, 2);
    assert.equal(store.read().revision, 5); assert.equal(calls.dispatchAttempts, 0);
  } finally {binding.close(); await rm(paths.directory, {recursive: true, force: true});}
});

test('public ancestor request with reversed ref fields is found by later idle discovery', async () => {
  const paths = await workspace(), calls = state({handoff: false});
  const binding = open(paths, calls);
  try {
    const store = appendAncestorFixture(binding);
    const direct = await binding.host.reviewGoalAncestorImpact({currentGoal: {revision: 3, id: 'ancestor-goal'},
      expectedGraphRevision: store.read().revision}, {...context(), at});
    assert.equal(calls.layaCalls, 1);
    const intent = binding.application.runtime.loadCheckpoint(direct.task.taskId, 'proactive-cognition-intent-v1');
    assert.deepEqual(Object.keys(intent.trigger.input.currentGoal), ['id', 'revision']);
    const first = await binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0});
    assert.equal(first.reviews.length, 1); assert.equal(first.reviews[0].review.action, 'KEEP');
    const second = await binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0});
    assert.equal(second.reviews.length, 0, 'completed ancestor must not reoccupy the bounded review slot');
    assert.equal(calls.layaCalls, 1);
    assert.equal(binding.application.runtime.listTasks({conversationId: 'proactive-cognition:' + graphNamespace}).items.length, 2);
  } finally {binding.close(); await rm(paths.directory, {recursive: true, force: true});}
});


test('clarified never-reviewed Goal enters first planning with stable reversed refs and once-only restart handoff', async () => {
  const paths = await workspace(), calls = state({selectedId: 'plan'});
  let binding = open(paths, calls);
  const poll = () => binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0});
  try {
    let store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    const {kind: _kind, ...input} = node('clarified-unplanned', 'goal', []);
    createGoal(store, 0, input);
    reviseGoal(store, 1, 1, {...input, summary: 'Clarified before first planning'});
    const first = await binding.host.reviewUnplannedGoal({currentGoal: {revision: 2, id: input.id}, expectedGraphRevision: 2}, {...context(), at});
    assert.deepEqual(first.review.subjectGoal, ref(input.id, 2));
    assert.deepEqual(first.review.affected, []);
    assert.deepEqual(first.review.options.map(option => option.id), ['plan', 'recheck', 'defer']);
    assert.ok(first.review.options.every(option => option.action === 'RECHECK' && !option.repair));
    await waitFor(binding.application, first.handoff.task.taskId, 'succeeded');
    assert.equal((await poll()).reviews.length, 0, 'public ref order must not occupy an idle slot');
    store.append(2, node('unrelated-after', 'fact', []));
    binding.close(); binding = open(paths, calls);
    store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    const replay = await binding.host.reviewUnplannedGoal({expectedGraphRevision: 3, currentGoal: ref(input.id, 2)}, {...context(), at});
    assert.equal(replay.task.taskId, first.task.taskId);
    assert.equal(replay.handoff.task.taskId, first.handoff.task.taskId);
    assert.equal((await poll()).reviews.length, 0);
    assert.equal(calls.layaCalls, 1); assert.equal(calls.agentArtsCalls, 1);
    assert.equal(store.read().revision, 3);
    assert.ok(store.read().history.every(version => !['decision', 'plan'].includes(version.kind)));
  } finally { binding.close(); await rm(paths.directory, {recursive: true, force: true}); }
});

test('unplanned idle distinguishes prior selected, unavailable, failed and KEEP reviews from never reviewed Goals', async () => {
  for (const previous of ['none', 'selected', 'unavailable', 'failed', 'keep']) {
    const paths = await workspace(), calls = state({selectedId: 'plan', handoff: false,
      ...(previous === 'failed' ? {prepareOptions: async () => { throw Error('Synthetic option preparation failure'); }} : {})});
    const binding = open(paths, calls);
    try {
      const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
      const {kind: _kind, ...input} = node('unplanned-matrix', 'goal', []);
      createGoal(store, 0, input);
      if (['selected', 'unavailable', 'failed'].includes(previous)) {
        if (previous === 'unavailable') calls.onInfer = () => { throw Error('Temporary synthetic Laya failure'); };
        if (previous === 'selected') await binding.host.reviewGoalCreated({expectedGraphRevision: 1, currentGoal: ref(input.id)}, {...context(), at});
        else if (previous === 'failed') {
          const failed = await binding.host.reviewGoalCreated({expectedGraphRevision: 1, currentGoal: ref(input.id)}, {...context(), at});
          assert.equal(failed.task.state, 'failed');
          assert.equal(failed.review, undefined);
        } else await assert.rejects(binding.host.reviewGoalCreated({expectedGraphRevision: 1, currentGoal: ref(input.id)}, {...context(), at}), {code: 'EXTERNAL_FAILURE'});
        delete calls.onInfer;
      }
      reviseGoal(store, 1, 1, {...input, summary: 'Clarified Goal'});
      if (previous === 'keep') await binding.host.reviewGoalRevision({expectedGraphRevision: 2,
        previousGoal: ref(input.id), currentGoal: ref(input.id, 2)}, {...context(), at});
      const before = calls.layaCalls;
      const first = await binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0});
      assert.equal(calls.layaCalls - before, previous === 'none' ? 1 : 0);
      assert.equal(first.reviews.length, previous === 'keep' ? 0 : 1);
      if (first.reviews.length) assert.equal(first.reviews[0].review.action, previous === 'none' ? 'RECHECK' : 'KEEP');
      assert.equal(await binding.host.reviewUnplannedGoal({expectedGraphRevision: 2, currentGoal: ref(input.id, 2)}, {...context(), at}) === undefined, previous !== 'none');
      assert.equal((await binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0})).reviews.length, 0);
      assert.equal(store.read().revision, 2);
    } finally { binding.close(); await rm(paths.directory, {recursive: true, force: true}); }
  }
});

test('unplanned scope follows historical planning paths and excludes inactive heads without blocking unrelated work', async () => {
  for (const mode of ['historical', 'unrelated', 'withdrawn', 'future', 'expired']) {
    const paths = await workspace(), calls = state({selectedId: 'plan', handoff: false});
    const binding = open(paths, calls);
    try {
      const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
      const {kind: _kind, ...input} = node('unplanned-history', 'goal', []);
      createGoal(store, 0, input);
      if (mode === 'historical') {
        store.append(1, node('past-decision', 'decision', [ref(input.id)]));
        store.append(2, node('past-plan', 'plan', [ref('past-decision')]));
      } else if (mode === 'unrelated') store.append(1, node('unrelated-plan', 'plan', []));
      const validity = mode === 'withdrawn' ? {state: 'withdrawn'} : mode === 'future'
        ? {validFrom: '2027-01-01T00:00:00.000Z'} : mode === 'expired'
        ? {validUntil: '2026-09-26T00:00:00.000Z'} : {};
      reviseGoal(store, store.read().revision, 1, {...input, ...validity});
      if (mode === 'historical') {
        store.append(store.read().revision, node('past-decision', 'decision', []));
        store.append(store.read().revision, node('past-plan', 'plan', []));
      }
      const before = store.read();
      const result = await binding.host.reviewUnplannedGoal({expectedGraphRevision: before.revision, currentGoal: ref(input.id, 2)}, {...context(), at});
      assert.equal(Boolean(result), mode === 'unrelated');
      const idle = await binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0});
      assert.equal(calls.layaCalls, mode === 'unrelated' ? 1 : 0);
      assert.equal(idle.reviews.length, mode === 'unrelated' ? 0 : 1);
      assert.deepEqual(store.read(), before);
    } finally { binding.close(); await rm(paths.directory, {recursive: true, force: true}); }
  }
});

test('unplanned public scope rejects malformed, stale graph and stale head receipts before recording work', async () => {
  const paths = await workspace(), calls = state({handoff: false}), binding = open(paths, calls);
  try {
    const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    const {kind: _kind, ...input} = node('strict-unplanned', 'goal', []);
    createGoal(store, 0, input); reviseGoal(store, 1, 1, input);
    for (const request of [{expectedGraphRevision: 2, currentGoal: ref(input.id)},
      {expectedGraphRevision: 2, currentGoal: {...ref(input.id, 2), extra: true}}]) {
      await assert.rejects(async () => binding.host.reviewUnplannedGoal(request, {...context(), at}), {code: 'INVALID_ARGUMENT'});
    }
    await assert.rejects(async () => binding.host.reviewUnplannedGoal({expectedGraphRevision: 1, currentGoal: ref(input.id, 2)}, {...context(), at}), {code: 'REVISION_CONFLICT'});
    reviseGoal(store, 2, 2, input);
    await assert.rejects(async () => binding.host.reviewUnplannedGoal({expectedGraphRevision: 3, currentGoal: ref(input.id, 2)}, {...context(), at}), {code: 'REVISION_CONFLICT'});
    assert.equal(calls.layaCalls, 0);
    assert.equal(binding.application.runtime.listTasks({conversationId: `proactive-cognition:${graphNamespace}`}).items.length, 0);
  } finally { binding.close(); await rm(paths.directory, {recursive: true, force: true}); }
});


test('saved unplanned choice cannot hide newly pinned consumers at the same current Goal head', async () => {
  for (const pending of [false, true]) for (const currentRevision of [2, 3]) {
    const paths = await workspace(), calls = state({selectedId: 'plan', handoff: pending, prepareUnavailable: true});
    const binding = open(paths, calls);
    try {
      const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
      const {kind: _kind, ...input} = node('unplanned-new-consumer', 'goal', []);
      createGoal(store, 0, input); reviseGoal(store, 1, 1, input);
      if (currentRevision === 3) reviseGoal(store, 2, 2, input);
      const initial = (await binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0})).reviews[0];
      assert.deepEqual(initial.review.subjectGoal, ref(input.id, currentRevision));
      store.append(currentRevision, node('new-ancestor-plan', 'plan', [ref(input.id)]));
      calls.selectedId = 'revise';
      const review = (await binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0})).reviews[0];
      if (currentRevision === 3) assert.equal(review.review.action, 'KEEP', 'original consecutive path remains unchanged');
      const ancestor = currentRevision === 2 ? review : (await binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0})).reviews[0];
      assert.deepEqual(ancestor.review.affected.map(item => item.node.id), ['new-ancestor-plan']);
      assert.equal(ancestor.review.subjectGoal, undefined);
      assert.equal(calls.layaCalls, 2, 'only the new scope infers; the saved initial choice stays immutable');
      assert.deepEqual(binding.host.readReview(initial.task.taskId).review, initial.review);
      assert.equal(store.read().revision, currentRevision + 1);
    } finally { binding.close(); await rm(paths.directory, {recursive: true, force: true}); }
  }
});

test('namespace-wide prior Goal intents survive binding changes and fixed pagination without blocking another Goal', async () => {
  const paths = await workspace(), calls = state({handoff: false}), binding = open(paths, calls);
  let earlier;
  try {
    const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    const {kind: _kind, ...input} = node('old-binding-reviewed', 'goal', []);
    createGoal(store, 0, input);
    earlier = createProactiveCognitionHost({application: binding.application, facts: binding.facts,
      graphNamespace, bindingVersion: 'earlier-trusted-binding', chooser: chooser(calls)});
    await earlier.reviewGoalCreated({expectedGraphRevision: 1, currentGoal: ref(input.id)}, {...context(), at});
    earlier.close(); earlier = undefined;
    reviseGoal(store, 1, 1, input);
    for (let n = 0; n < 105; n++) binding.application.runtime.submitTask({goal: 'Unrelated task without cognition intent',
      conversationId: `proactive-cognition:${graphNamespace}`, idempotencyKey: 'pagination-no-intent-' + n});
    assert.equal(await binding.host.reviewUnplannedGoal({expectedGraphRevision: 2, currentGoal: ref(input.id, 2)}, {...context(), at}), undefined);
    createGoal(store, 2, {...input, id: 'another-unreviewed'});
    reviseGoal(store, 3, 1, {...input, id: 'another-unreviewed'});
    const fresh = await binding.host.reviewUnplannedGoal({expectedGraphRevision: 4, currentGoal: ref('another-unreviewed', 2)}, {...context(), at});
    assert.deepEqual(fresh.review.subjectGoal, ref('another-unreviewed', 2));
    assert.equal(calls.layaCalls, 2);
  } finally { earlier?.close(); binding.close(); await rm(paths.directory, {recursive: true, force: true}); }
});


test('trusted prior Fact-scope review counts as Goal review evidence without a Decision or Plan', async () => {
  const paths = await workspace(), calls = state({handoff: false}), binding = open(paths, calls);
  try {
    record(binding.facts, 'a', null);
    const baseline = await binding.host.consumeAndReview({...context(), at, limit: 10, afterGraphRevision: 0});
    const store = binding.application.runtime.bindCoordinationStore(graphNamespace), factId = store.read().history[0].id;
    const {kind: _kind, ...input} = node('fact-reviewed-goal', 'goal', [ref(factId)]);
    createGoal(store, 1, input);
    record(binding.facts, 'b', 1);
    const factReview = (await binding.host.consumeAndReview({...context(), at, limit: 10, afterGraphRevision: baseline.nextGraphRevision})).reviews[0];
    assert.deepEqual(factReview.review.affected.map(item => item.node.id), [input.id]);
    assert.equal(binding.application.runtime.loadCheckpoint(factReview.task.taskId, 'proactive-cognition-intent-v1').trigger.kind, 'fact');
    reviseGoal(store, 3, 1, {...input, dependencies: [ref(factId, 2)]});
    assert.equal(await binding.host.reviewUnplannedGoal({expectedGraphRevision: 4, currentGoal: ref(input.id, 2)}, {...context(), at}), undefined);
    const inferred = calls.layaCalls;
    const idle = await binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: factReview.review.graphRevision});
    assert.equal(idle.reviews[0].review.action, 'KEEP');
    assert.equal(calls.layaCalls, inferred);
    assert.ok(store.read().history.every(version => !['decision', 'plan'].includes(version.kind)));
  } finally { binding.close(); await rm(paths.directory, {recursive: true, force: true}); }
});

test('ancestor consumer identity survives locale changes across actual Runtime SQLite reopen', async () => {
  // Separate workers keep the real Intl collation change out of other tests.
  // Explicit Collator injection is portable on Windows; the public producer
  // probe separately verifies Linux process-default en-US -> sv-SE changes.
  const worker = `
    import {createRuntimeApplication,createProactiveCognitionHost} from ${JSON.stringify(new URL('../dist/application.js', import.meta.url).href)};
    import {LayaActionChoiceService} from '@personal-agent/cognition';
    import {join} from 'node:path';
    const [directory,mode,locale]=process.argv.slice(1);
    const collator=new Intl.Collator(locale);
    String.prototype.localeCompare=function(other){return collator.compare(String(this),other);};
    const namespace='synthetic-locale-reopen',at='2026-09-27T03:00:00.000Z';
    const ctx=()=>({at,deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal});
    const application=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',
      coordination:{execute:async()=>({kind:'text',text:'Synthetic unused',verification:'mock'})}});
    const facts=application.createCompetitionFactHost({memoryPath:join(directory,'memory.sqlite'),
      memoryNamespace:'synthetic-locale-empty',graphNamespace:namespace,consumerKey:'synthetic-locale-reopen'});
    const store=application.runtime.bindCoordinationStore(namespace);
    const node=(id,kind,dependencies)=>({id,kind,dependencies,summary:id,sourceRef:'synthetic/locale',
      sensitivity:'public',state:'active',reason:'Synthetic fixture',validFrom:'2026-01-01T00:00:00.000Z',
      validUntil:'2099-01-01T00:00:00.000Z'});
    if(mode==='create') {
      store.append(0,node('goal','goal',[]));
      store.append(1,node('ä-plan','plan',[{id:'goal',revision:1}]));
      store.append(2,node('z-plan','plan',[{id:'goal',revision:1}]));
      store.append(3,node('goal','goal',[]));store.append(4,node('goal','goal',[]));
    }
    let inferences=0;
    const chooser=new LayaActionChoiceService({infer:async payload=>{
      inferences++;const ids=Object.keys(payload.questions.action.criteria),chosen=ids.at(-1);
      return {answers:{action:{choice:chosen,probabilities:Object.fromEntries(ids.map(id=>
        [id,id===chosen?0.98:0.02/(ids.length-1)])),answer_confidence:0.98,confidence:0.5}}};
    }});
    const host=createProactiveCognitionHost({application,facts,graphNamespace:namespace,bindingVersion:'test-locale-v1',chooser});
    const rows=()=>application.runtime.listTasks({conversationId:'proactive-cognition:'+namespace,limit:100}).items
      .filter(task=>application.runtime.loadCheckpoint(task.taskId,'proactive-cognition-intent-v1').trigger.kind==='goal_ancestor');
    try {
      let direct;
      if(mode==='reopen') direct=await host.reviewGoalAncestorImpact({expectedGraphRevision:5,currentGoal:{id:'goal',revision:3}},ctx());
      const batch=await host.consumeAndReview({...ctx(),limit:10,afterGraphRevision:0});
      const ancestors=rows(),review=host.readReview(ancestors[0].taskId).review;
      console.log(JSON.stringify({inferences,ancestorCount:ancestors.length,taskId:ancestors[0].taskId,
        directTaskId:direct?.task.taskId,review,returned:batch.reviews.map(row=>row.task.taskId),graphRevision:store.read().revision}));
    } finally {host.close();facts.close();application.close();}
  `;
  for (const [first, second] of [['en-US', 'sv-SE'], ['sv-SE', 'en-US']]) {
    const paths = await workspace();
    try {
      const run = (mode, locale) => JSON.parse(execFileSync(process.execPath,
        ['--input-type=module', '-e', worker, paths.directory, mode, locale],
        {cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']}).trim());
      const initial = run('create', first), replay = run('reopen', second);
      assert.equal(initial.inferences, 1); assert.equal(initial.ancestorCount, 1);
      assert.equal(replay.inferences, 0, 'the same exact consumer set must reuse its original choice');
      assert.equal(replay.ancestorCount, 1); assert.equal(replay.directTaskId, initial.taskId);
      assert.equal(replay.taskId, initial.taskId); assert.deepEqual(replay.review, initial.review);
      assert.deepEqual(replay.returned, []); assert.equal(replay.graphRevision, 5);
    } finally {await rm(paths.directory, {recursive: true, force: true});}
  }
});

test('an unchosen legacy ancestor intent retains its original task and exact scope after canonical ordering', async () => {
  const paths = await workspace(), calls = state({handoff: false}), binding = open(paths, calls);
  try {
    const store = binding.application.runtime.bindCoordinationStore(graphNamespace);
    const {kind: _kind, ...input} = node('locale-goal', 'goal', []);
    createGoal(store, 0, input);
    for (const id of ['ä-plan', 'z-plan']) store.append(store.read().revision,
      node(id, 'plan', [ref(input.id)]));
    reviseGoal(store, 3, 1, input); reviseGoal(store, 4, 2, input);
    const scope = selectGoalAncestorImpact(store.read(), at,
      {expectedGraphRevision: 5, currentGoal: ref(input.id, 3)});
    // Trusted interrupted-host fixture: exact refs come from the public selector,
    // using the older en-US ordering, before any chooser result exists.
    const collator = new Intl.Collator('en-US');
    const consumers = scope.items.map(item => ({id: item.node.id, revision: item.node.revision}))
      .sort((left, right) => collator.compare(left.id, right.id));
    const trigger = {kind: 'goal_ancestor', input: {expectedGraphRevision: 5,
      currentGoal: scope.currentGoal, consumers}};
    const intent = {version: 1, graphNamespace, bindingVersion: 'test-binding-v1', trigger, evaluatedAt: at};
    const task = binding.application.runtime.submitTaskWithCheckpoint({goal: 'Synthetic interrupted ancestor choice',
      conversationId: `proactive-cognition:${graphNamespace}`, idempotencyKey: 'proactive-cognition:' + toolArgumentsDigest({
        graphNamespace, bindingVersion: intent.bindingVersion,
        trigger: {kind: trigger.kind, currentGoal: scope.currentGoal, consumers}})}, 'proactive-cognition-intent-v1', intent);
    assert.equal(task.state, 'created');
    const chosen = await binding.host.reviewGoalAncestorImpact({expectedGraphRevision: 5, currentGoal: scope.currentGoal}, {...context(), at});
    assert.equal(chosen.task.taskId, task.taskId); assert.equal(calls.layaCalls, 1);
    assert.deepEqual(binding.application.runtime.loadCheckpoint(task.taskId, 'proactive-cognition-intent-v1'), intent);
    const replay = await binding.host.reviewGoalAncestorImpact({expectedGraphRevision: 5, currentGoal: scope.currentGoal}, {...context(), at});
    assert.equal(replay.task.taskId, task.taskId); assert.deepEqual(replay.review, chosen.review);
    assert.equal(calls.layaCalls, 1); assert.equal(store.read().revision, 5);
  } finally {binding.close(); await rm(paths.directory, {recursive: true, force: true});}
});

test('a full Goal impact beyond the optional repair bound retains recheck while the 100-target boundary still repairs', async () => {
  for (const count of [100, 101]) {
    const paths = await workspace(), calls = state({handoff: false});
    let binding = open(paths, calls);
    try {
      let store = binding.application.runtime.bindCoordinationStore(graphNamespace);
      const {kind: _kind, ...input} = node('large-impact-goal', 'goal', []);
      createGoal(store, 0, input);
      const ids = Array.from({length: count}, (_, index) => `large-plan-${index}`);
      for (const id of ids) store.append(store.read().revision, node(id, 'plan', [ref(input.id)]));
      reviseGoal(store, count + 1, 1, {...input, summary: 'Clarified Goal with existing consumers'});
      const original = store.read();
      const request = {expectedGraphRevision: count + 2,
        previousGoal: ref(input.id), currentGoal: ref(input.id, 2)};
      const first = (await binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0})).reviews[0];
      assert.equal(first.task.state, 'succeeded', 'a bounded optional candidate must not block the full review');
      assert.deepEqual(first.review.affected.map(item => item.node.id), ids);
      assert.equal(first.review.affected.length, count);
      assert.ok(first.review.affected.every(item => item.action === 'RECHECK'));
      assert.equal(calls.layaCalls, 1);
      if (count === 100) {
        assert.equal(first.review.action, 'REVISE');
        assert.deepEqual(first.review.options.map(option => option.id), ['recheck', 'defer', 'revise']);
        assert.equal(first.review.selectedOption.repair.changes.length, 100);
      } else {
        assert.equal(first.review.action, 'RECHECK');
        assert.deepEqual(first.review.options.map(option => option.id), ['recheck', 'defer']);
        assert.ok(first.review.options.every(option => option.action === 'RECHECK' && !option.repair));
      }
      assert.deepEqual(store.read(), original);
      assert.equal(calls.dispatchAttempts, 0);
      binding.close(); binding = open(paths, calls);
      store = binding.application.runtime.bindCoordinationStore(graphNamespace);
      const replay = await binding.host.reviewGoalRevision(request, {...context(), at});
      assert.equal(replay.task.taskId, first.task.taskId);
      assert.deepEqual(replay.review, first.review);
      assert.equal((await binding.host.consumeAndReview({...context(), at, limit: 1, afterGraphRevision: 0})).reviews.length, 0);
      assert.equal(calls.layaCalls, 1); assert.equal(calls.dispatchAttempts, 0);
      assert.deepEqual(store.read(), original);
    } finally {binding.close(); await rm(paths.directory, {recursive: true, force: true});}
  }
});


test('public Fact expiry identity survives portable locale changes and new exact consumers remain new work', async () => {
  // Explicit Collators in isolated workers are portable; no assertion that
  // Windows adopts LC_ALL. A separate Linux producer tests actual defaults.
  const worker = `
    import {createRuntimeApplication,createProactiveCognitionHost} from ${JSON.stringify(new URL('../dist/application.js', import.meta.url).href)};
    import {LayaActionChoiceService} from '@personal-agent/cognition';
    import {join} from 'node:path';
    const [directory,mode,locale]=process.argv.slice(1),collator=new Intl.Collator(locale);
    String.prototype.localeCompare=function(other){return collator.compare(String(this),other);};
    const namespace='synthetic-public-expiry-locale-reopen',baselineAt='2026-09-27T03:00:00.000Z',expiryAt='2026-09-27T04:00:00.000Z';
    const ctx=time=>({at:time,deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal});
    const application=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts'});
    const facts=application.createCompetitionFactHost({memoryPath:join(directory,'memory.sqlite'),memoryNamespace:namespace+'-memory',graphNamespace:namespace,consumerKey:'public-expiry-locale'});
    let inferences=0;
    const chooser=new LayaActionChoiceService({infer:async payload=>{
      inferences++;const ids=Object.keys(payload.questions.action.criteria),chosen=ids[0];
      return {answers:{action:{choice:chosen,probabilities:Object.fromEntries(ids.map(id=>[id,id===chosen?0.98:0.02/(ids.length-1)])),answer_confidence:0.98,confidence:0.5}}};
    }});
    const host=createProactiveCognitionHost({application,facts,graphNamespace:namespace,bindingVersion:'public-expiry-locale-v1',chooser});
    const store=application.runtime.bindCoordinationStore(namespace);
    const append=id=>store.append(store.read().revision,{id,kind:'plan',summary:'Retain Plan content',reason:'Synthetic public consumer',sourceRef:'synthetic/public-Plan',
      sensitivity:'public',state:'active',dependencies:[{id:store.read().history[0].id,revision:1}],validFrom:baselineAt,validUntil:'2099-01-01T00:00:00.000Z'});
    try {
      if(mode==='create'){
        facts.recordPublicSource({vaultId:'public-demo',path:'meeting.md',factId:'meeting/update',sourceRevision:'a'.repeat(64),line:1,
          summary:'Public schedule with announced expiry',observedAt:'2026-09-25T00:00:00.000Z',validFrom:'2026-09-25T00:00:00.000Z',validUntil:expiryAt,expectedFactRevision:null},ctx(baselineAt));
        await host.consumeAndReview({...ctx(baselineAt),limit:10,afterGraphRevision:0});append('ä-plan');append('z-plan');
      }
      if(mode==='expand')append('new-plan');
      const batch=await host.consumeAndReview({...ctx(expiryAt),limit:10,afterGraphRevision:1});
      const rows=application.runtime.listTasks({conversationId:'proactive-cognition:'+namespace,limit:100}).items
        .map(task=>({task,intent:application.runtime.loadCheckpoint(task.taskId,'proactive-cognition-intent-v1'),review:host.readReview(task.taskId).review}))
        .filter(row=>row.intent.trigger.kind==='expiry');
      console.log(JSON.stringify({inferences,rows,returned:batch.reviews.map(row=>row.task.taskId),graphRevision:store.read().revision,nextGraphRevision:batch.nextGraphRevision}));
    }finally{host.close();facts.close();application.close();}
  `;
  for (const [first, second] of [['en-US', 'sv-SE'], ['sv-SE', 'en-US']]) {
    const paths = await workspace();
    try {
      const run = (mode, locale) => JSON.parse(execFileSync(process.execPath,
        ['--input-type=module', '-e', worker, paths.directory, mode, locale],
        {cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim());
      const initial = run('create', first), replay = run('reopen', second);
      assert.equal(initial.inferences, 1); assert.equal(initial.rows.length, 1);
      assert.equal(replay.inferences, 0, 'Exact expired Fact/consumer refs reuse the original choice after reopen');
      assert.deepEqual(replay.rows, initial.rows); assert.deepEqual(replay.returned, [initial.rows[0].task.taskId]);
      assert.equal(replay.graphRevision, 3); assert.equal(replay.nextGraphRevision, 1);
      const expanded = run('expand', second);
      assert.equal(expanded.inferences, 1); assert.equal(expanded.rows.length, 2);
      assert.notEqual(expanded.rows[0].task.taskId, initial.rows[0].task.taskId);
      assert.equal(expanded.rows[0].review.affected.length, 3);
      assert.deepEqual(expanded.rows[1], initial.rows[0], 'New consumers never replace the prior exact scope or choice');
      assert.equal(expanded.graphRevision, 4); assert.equal(expanded.nextGraphRevision, 1);
    } finally {await rm(paths.directory, {recursive: true, force: true});}
  }
});


test('trusted legacy expiry refs retain their task and do not take new-work priority at limit one', async () => {
  const paths = await workspace(), calls = state({prepareUnavailable: true});
  const binding = open(paths, calls), expiryAt = '2026-09-27T04:00:00.000Z';
  try {
    binding.facts.recordPublicSource({...source, sourceRevision: 'a'.repeat(64), line: 1,
      summary: 'Public schedule with announced expiry', observedAt: '2026-09-25T00:00:00.000Z',
      validFrom: '2026-09-25T00:00:00.000Z', validUntil: expiryAt, expectedFactRevision: null}, context());
    await binding.host.consumeAndReview({...context(), at, limit: 10, afterGraphRevision: 0});
    const store = binding.application.runtime.bindCoordinationStore(graphNamespace), fact = store.read().history[0];
    for (const id of ['ä-plan', 'z-plan']) store.append(store.read().revision, node(id, 'plan', [ref(fact.id)]));
    // Trusted interrupted-host INTENT uses the exact public expiry scope and
    // older en-US ref ordering, including legal reversed reference fields.
    const consumers = [{revision: 1, id: 'ä-plan'}, {revision: 1, id: 'z-plan'}];
    const facts = [{revision: fact.revision, id: fact.id}];
    assert.deepEqual(analyzeImpact(store.read(), expiryAt).items.map(item => item.node), consumers.map(({id, revision}) => ({id, revision})));
    const trigger = {kind: 'expiry', input: {graphRevision: 3, facts, consumers}};
    const intent = {version: 1, graphNamespace, bindingVersion: 'test-binding-v1', trigger, evaluatedAt: expiryAt};
    const original = binding.application.runtime.submitTaskWithCheckpoint({goal: 'Synthetic interrupted public expiry review',
      conversationId: 'proactive-cognition:' + graphNamespace,
      idempotencyKey: 'proactive-cognition:' + toolArgumentsDigest({graphNamespace, bindingVersion: intent.bindingVersion,
        trigger: {kind: 'expiry', facts, consumers}})}, 'proactive-cognition-intent-v1', intent);
    const poll = limit => binding.host.consumeAndReview({...context(), at: expiryAt, limit, afterGraphRevision: 1});
    const chosen = (await poll(1)).reviews[0];
    assert.equal(chosen.task.taskId, original.taskId); assert.equal(calls.layaCalls, 1);
    assert.equal(chosen.review.affected.length, 2); assert.equal(chosen.review.action, 'RECHECK');
    assert.deepEqual(binding.application.runtime.loadCheckpoint(original.taskId, 'proactive-cognition-intent-v1'), intent);
    const oldReview = structuredClone(chosen.review);
    const {kind: _kind, ...goal} = node('pending-goal', 'goal', []);
    createGoal(store, 3, goal);
    const pendingGoal = await binding.host.reviewGoalCreated({expectedGraphRevision: 4, currentGoal: ref(goal.id)}, {...context(), at: expiryAt});
    assert.equal(calls.layaCalls, 2);
    const same = (await poll(1)).reviews;
    assert.deepEqual(same.map(row => row.task.taskId), [pendingGoal.task.taskId], 'A historical expiry match is recorded work, so it cannot steal the older Goal recovery slot');
    assert.equal(calls.layaCalls, 2); assert.deepEqual(binding.host.readReview(original.taskId).review, oldReview);
    store.append(4, node('new-plan', 'plan', [ref(fact.id)]));
    const expanded = (await poll(1)).reviews[0];
    assert.notEqual(expanded.task.taskId, original.taskId);
    assert.equal(expanded.review.affected.length, 3); assert.equal(calls.layaCalls, 3);
    assert.deepEqual(binding.host.readReview(original.taskId).review, oldReview);
    assert.deepEqual(binding.application.runtime.loadCheckpoint(original.taskId, 'proactive-cognition-intent-v1'), intent);
    assert.equal(store.read().revision, 5);
  } finally {binding.close(); await rm(paths.directory, {recursive: true, force: true});}
});


test('a failed trusted legacy expiry task stays terminal after canonical identity lookup', async () => {
  const paths = await workspace(), calls = state({handoff: false,
    prepareOptions: async () => {throw Error('Synthetic optional preparation failure');}});
  const binding = open(paths, calls), expiryAt = '2026-09-27T04:00:00.000Z';
  try {
    binding.facts.recordPublicSource({...source, sourceRevision: 'a'.repeat(64), line: 1,
      summary: 'Public schedule with announced expiry', observedAt: '2026-09-25T00:00:00.000Z',
      validFrom: '2026-09-25T00:00:00.000Z', validUntil: expiryAt, expectedFactRevision: null}, context());
    await binding.host.consumeAndReview({...context(), at, limit: 10, afterGraphRevision: 0});
    const store = binding.application.runtime.bindCoordinationStore(graphNamespace), fact = store.read().history[0];
    for (const id of ['ä-plan', 'z-plan']) store.append(store.read().revision, node(id, 'plan', [ref(fact.id)]));
    const consumers = analyzeImpact(store.read(), expiryAt).items.map(item => item.node), facts = [ref(fact.id)];
    const trigger = {kind: 'expiry', input: {graphRevision: 3, facts, consumers}};
    const intent = {version: 1, graphNamespace, bindingVersion: 'test-binding-v1', trigger, evaluatedAt: expiryAt};
    const original = binding.application.runtime.submitTaskWithCheckpoint({goal: 'Synthetic interrupted legacy expiry failure',
      conversationId: 'proactive-cognition:' + graphNamespace,
      idempotencyKey: 'proactive-cognition:' + toolArgumentsDigest({graphNamespace, bindingVersion: intent.bindingVersion,
        trigger: {kind: 'expiry', facts, consumers}})}, 'proactive-cognition-intent-v1', intent);
    const poll = () => binding.host.consumeAndReview({...context(), at: expiryAt, limit: 1, afterGraphRevision: 1});
    const failed = (await poll()).reviews[0];
    assert.equal(failed.task.taskId, original.taskId); assert.equal(failed.task.state, 'failed');
    assert.equal(failed.review, undefined); assert.equal(calls.layaCalls, 0);
    const replay = (await poll()).reviews[0];
    assert.deepEqual(replay, failed); assert.equal(calls.layaCalls, 0);
    const expiryRows = binding.application.runtime.listTasks({conversationId: 'proactive-cognition:' + graphNamespace, limit: 100}).items
      .filter(task => binding.application.runtime.loadCheckpoint(task.taskId, 'proactive-cognition-intent-v1').trigger.kind === 'expiry');
    assert.equal(expiryRows.length, 1);
    assert.deepEqual(binding.application.runtime.loadCheckpoint(original.taskId, 'proactive-cognition-intent-v1'), intent);
    assert.equal(store.read().revision, 3);
  } finally {binding.close(); await rm(paths.directory, {recursive: true, force: true});}
});
