import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createKnowledgeWatchHost} from '../electron/knowledge-watch-host.js';
import {createDesktopProactiveConfirmedSourceRouter} from '../electron/proactive-confirmed-source-router.js';
import * as receipts from '@personal-agent/runtime/application';

const start = Date.parse('2026-09-30T00:00:00Z');
const iso = time => new Date(time).toISOString();
const namespace = 'fixture-user';

// Synthetic Runtime/host ports; they do not prove native grants or public-source execution.
function fixture({feedCollect, readTrackingGrant, workPort, notificationPort, sourceEvidence = false} = {}) {
  let time = start;
  const rows = new Map();
  const schedules = new Map();
  const tasks = new Map();
  const signals = new Map();
  const sourceReceipts = new Map();
  const queries = [];
  const checkpoints = {
    loadCheckpoint(taskId, key) { return structuredClone(rows.get(`${taskId}:${key}`)); },
    saveCheckpoint(taskId, key, value) { rows.set(`${taskId}:${key}`, structuredClone(value)); },
  };
  const runtime = {
    ...checkpoints,
    getTask(taskId) { return structuredClone([...tasks.values()].find(task => task.taskId === taskId)); },
    findTaskByIdempotencyKey(key) { return structuredClone(tasks.get(key)); },
    submitTask(input) {
      if (!tasks.has(input.idempotencyKey)) tasks.set(input.idempotencyKey,
        {...input, taskId: `task-${tasks.size + 1}`, state: 'created', evidenceRefs: []});
      return structuredClone(tasks.get(input.idempotencyKey));
    },
    createSchedule(input) {
      const current = schedules.get(input.scheduleId);
      if (current && current.runAt !== input.runAt) throw Object.assign(new Error('Conflict'), {code: 'REVISION_CONFLICT'});
      if (!current) schedules.set(input.scheduleId, {...structuredClone(input), status: 'pending'});
      return structuredClone(schedules.get(input.scheduleId));
    },
    listSchedules(conversationId) {
      return structuredClone([...schedules.values()].filter(schedule => schedule.conversationId === conversationId));
    },
    reconcileSchedules(conversationId) {
      for (const schedule of schedules.values()) {
        if (schedule.conversationId === conversationId && schedule.status === 'pending') schedule.status = 'cancelled';
      }
      return this.listSchedules(conversationId);
    },
  };
  const readGrant = identity => {
    assert.deepEqual(Object.keys(identity).sort(), ['namespace', 'sourceId', 'taskId']);
    const original = signals.get(identity.taskId);
    if (identity.namespace !== namespace || !runtime.getTask(identity.taskId)
      || original?.source.id !== identity.sourceId) return null;
    return structuredClone(original.scope);
  };
  const options = {profile: 'huawei_ict_agentarts', namespace, checkpointTaskId: 'root-task',
    checkpoints, runtime, now: () => time, workPort, notificationPort,
    readInterestSignal: async identity => identity.namespace === namespace && runtime.getTask(identity.taskId)
      ? structuredClone(signals.get(identity.taskId)) : null,
    readTrackingGrant: async identity => {
      const original = readGrant(identity);
      return original && readTrackingGrant ? readTrackingGrant(identity) : original;
    },
    readTrackingGrantSnapshot: readGrant,
    ...(sourceEvidence ? {knowledgeFeedReceipts: receipts,
      readFeedReceiptEvidence: identity => identity.namespace === namespace && identity.sourceId === 'feed-a'
        && identity.sourceReadTaskId === 'root-task' ? structuredClone(sourceReceipts.get(identity.receiptId)) : null} : {}),
    interestDecider: {choose: async () => ({outcome: 'selected', requiresHostRevalidation: true,
      selected: {id: 'track_public', revision: 1}, receipt: {modelReceiptId: 'fixture-laya'}})},
    feedCollect: async (query, signal, sourceScope) => {
      queries.push({...query, signal});
      const result = feedCollect ? await feedCollect(query, signal, sourceScope) : collected(time);
      if (sourceEvidence && result.collection?.state === 'fetched') {
        const receipt = receipts.createKnowledgeFeedReceiptFromCollectResult({namespace, sourceId: query.subscriptionId, result});
        if (receipt) sourceReceipts.set(receipt.receiptId, receipt);
      }
      return result;
    }};
  const host = createKnowledgeWatchHost(options);
  host.start();
  const interest = (topicId = 'typescript', sourceId = 'feed-a') => ({namespace, topicId, at: iso(time),
    evidenceMaxAgeMs: 120_000, watchDurationMs: 3_600_000,
    evidence: [
      {id: `${topicId}-q1`, topicId, sourceId: 'conversation', sourceRevision: 'r1', occurredAt: iso(time - 1000),
        interactionId: `${topicId}-q1`, kind: 'question', match: 'semantic'},
      {id: `${topicId}-q2`, topicId, sourceId: 'conversation', sourceRevision: 'r1', occurredAt: iso(time),
        interactionId: `${topicId}-q2`, kind: 'followup', match: 'semantic', relatedEvidenceId: `${topicId}-q1`},
    ],
    source: {id: sourceId, revision: 'baseline', visibility: 'public', risk: 'low', transportVerified: true,
      verificationExpiresAt: iso(start + 3_600_000)},
    scope: {id: 'scope-a', revision: 1, state: 'granted', publicLowRiskTracking: true, expiresAt: iso(start + 3_600_000)},
    sourceContent: {contentSha256: 'a'.repeat(64), cacheVersion: 'baseline',
      lastSuccessfulCheck: iso(time - 1000), validUntil: iso(start + 3_600_000)},
  });
  return {host, options, rows, schedules, tasks, signals, queries, runtime, interest, readGrant,
    async track(topicId = 'typescript', sourceId = 'feed-a', request = {}) {
      const task = runtime.submitTask({goal: `Follow up ${topicId}`, conversationId: 'fixture-conversation',
        idempotencyKey: `interest:${topicId}:${sourceId}`});
      signals.set(task.taskId, interest(topicId, sourceId));
      const result = await host.consumeInterestTask(task.taskId,
        {deadline: iso(time + 60_000), signal: new AbortController().signal, ...request});
      assert.equal(result.accepted, true);
      assert.equal(result.watch.state, 'tracked');
      assert.equal(result.watch.consumer.intakeTaskId, task.taskId);
      return result;
    },
    advance() { time += 1000; },
    register(checkId = 'check-a', extra = {}) {
      return host.registerFeedCheck({checkId, runAt: iso(time + 1000), subscriptionId: 'feed-a', ...extra});
    },
    fire(scheduleId) {
      const schedule = schedules.get(scheduleId);
      time = Math.max(time, Date.parse(schedule.runAt));
      const task = runtime.submitTask({goal: schedule.goal, conversationId: schedule.conversationId,
        idempotencyKey: schedule.taskIdempotencyKey});
      schedule.status = 'fired'; schedule.taskId = task.taskId;
      return task.taskId;
    },
  };
}
function collected(time) {
  return {items: [{title: 'TypeScript release', summary: 'New public release.', record: {
    dedupeKey: 'article-a', contentRef: 'https://example.com/article-a', occurredAt: iso(time - 1000),
  }}], nextCursor: 'cursor-a', hasMore: false,
  collection: {state: 'fetched', subscriptionId: 'feed-a', fetchedAt: iso(time),
    validators: {etag: 'v2', lastModified: null}}};
}

test('selected sustained interest binds an explicit Runtime schedule; forged and duplicate tasks do not reread', async () => {
  const fx = fixture();
  await fx.track('typescript', 'feed-a', {feedCheck: {checkId: 'auto', runAt: iso(start + 1000)}});
  assert.equal(fx.schedules.size, 1);
  assert.equal(fx.register('auto').bound, true);
  assert.equal(fx.register('auto', {subscriptionId: 'feed-b'}).accepted, false);
  const forged = fx.runtime.submitTask({goal: '检查已授权的公开订阅', conversationId: `knowledge-watch:${namespace}`,
    idempotencyKey: 'forged'});
  assert.equal(fx.host.getFeedCheckContext(forged.taskId), null);
  const taskId = fx.fire([...fx.schedules.keys()][0]);
  const controller = new AbortController();
  const observed = await fx.host.consumeFeedCheck(taskId, {signal: controller.signal});
  assert.equal(observed.accepted, true);
  assert.equal(observed.subscriptionId, 'feed-a');
  assert.equal(fx.queries.length, 1);
  assert.equal(fx.host.dialogueProjection().items[0].answer.kind, 'latest_observation');
  assert.equal(fx.host.dialogueProjection().items[0].binding.ready, false);
  fx.tasks.get('knowledge-watch:fixture-user:auto').state = 'succeeded';
  assert.equal((await fx.host.consumeFeedCheck(taskId, {signal: controller.signal})).accepted, false);
  assert.equal(fx.queries.length, 1);
  fx.host.dispose();
});

test('scheduled feed read preserves all original tracking identities through Main preparation and routing', async () => {
  // Actual watch/Main/prepared-binding code; Runtime execution and sink are explicit fixtures.
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const body = main.slice(main.indexOf('      const feedCollect = async '), main.indexOf('      knowledgeWatchHost = createKnowledgeWatchHost('));
  let collect;
  const fx = fixture({feedCollect: (...args) => collect(...args)});
  try {
    await fx.track('typescript');
    await fx.track('javascript');
    const trackingTaskIds = fx.host.listWatches().map(watch => watch.consumer.intakeTaskId);
    const deadline = iso(Date.now() + 60_000), rows = new Map(), routed = [];
    let reads = 0, prepared, granted = true;
    const sessions = trackingTaskIds.map((id, i) => ({taskId:`responsibility-${i}`,
      sourceTaskId:id,taskState:'running',taskDeadline:deadline}));
    const runtime = {...fx.runtime,
      getTask: id => id === prepared?.taskId ? prepared : sessions.find(item=>item.taskId===id) ?? fx.runtime.getTask(id),
      loadCheckpoint: (taskId, key) => rows.get(`${taskId}:${key}`),
      saveCheckpointOnceForCreatedTask(taskId, key, value, revision) {
        assert.equal(revision, prepared.revision); rows.set(`${taskId}:${key}`, structuredClone(value)); return true;
      }};
    const application = {runtime,
      prepareHostToolTask(input) {
        prepared = {taskId:'synthetic-feed-read',revision:1,state:'created',conversationId:`host-tool:${namespace}`};
        rows.set(`${prepared.taskId}:host-tool-preparation`, {...input,namespace}); return prepared;
      },
      finalizeHostToolTask(input) {
        const origin = rows.get(`${input.taskId}:desktop-proactive-feed-origin-v1`);
        assert.deepEqual([...origin.trackingTaskIds].sort(), [...trackingTaskIds].sort()); reads++;
        rows.set(`${input.taskId}:host-tool-intent`, {...rows.get(`${input.taskId}:host-tool-preparation`),
          arguments:input.arguments,argumentsDigest:origin.argumentsDigest});
      },
      readHostToolTask: () => ({task:{state:'succeeded'},confirmed:{runId:`host-tool-${prepared.taskId}`,result:collected(start+1000)}}),
    };
    const workflow = {snapshot: () => ({state:'configured_not_verified',sessions}),
      acquireMaintenance: async id => ({binding:sessions.find(item=>item.taskId===id),host:{}})};
    const router = createDesktopProactiveConfirmedSourceRouter({getApplication:()=>application,getWorkflow:()=>workflow,
      namespace,resolveUserConversation:id=>fx.runtime.getTask(id)?.conversationId,
      readSourceBinding:()=>({namespace,sourceId:'feed-a',available:true,sensitivity:'public',containsCredentials:false,configurationRef:'synthetic-config'}),
      readTrackingGrant:({taskId})=>({namespace,taskId,state:granted?'granted':'revoked',sourceId:'feed-a',configurationRef:'synthetic-config',
        id:'synthetic-grant',revision:1,publicLowRiskTracking:true,expiresAt:deadline,conversationId:fx.runtime.getTask(taskId).conversationId,
        purposeDigest:createHash('sha256').update(JSON.stringify(fx.runtime.getTask(taskId).goal)).digest('hex')})});
    const route = router.routeConfirmedFeed.bind(router);
    router.routeConfirmedFeed = async (input, context) => {
      // The real router must accept both prepared identities, but cannot invent real execution Evidence.
      assert.deepEqual(await route(input,context),{state:'unavailable',reason:'original_complete_confirmed_feed_receipt'});
      routed.push(input); return {state:'persisted'};
    };
    const scope = {namespace,runtimeApplication:application,proactiveSourceRouter:router,proactiveWorkflowApplication:workflow,
      feedsHost:{tools:[{descriptor:{name:'feeds.collect',version:'0.1.0-alpha.1'}}],
        competitionToolAvailability:[{toolName:'feeds.collect',available:async()=>true}]},
      randomUUID:()=> 'synthetic-scheduled-read',knowledgeWatchTask:{taskId:'root-task'},rebuildFeedReceipt:()=>undefined};
    collect = new Function(...Object.keys(scope), `let proactiveSourceRoutingFailure;\n${body}\nreturn feedCollect;`)(...Object.values(scope));
    const due = fx.fire(fx.register().schedule.scheduleId);
    assert.equal((await fx.host.consumeFeedCheck(due,{signal:new AbortController().signal})).accepted,true);
    assert.equal(reads,1,'One source read serves both explicitly tracked consumers');
    assert.deepEqual(routed.map(item=>item.trackingTaskId).sort(),[...trackingTaskIds].sort());
    assert.equal(new Set(routed.map(item=>item.taskId)).size,1);
    assert.equal(new Set(routed.map(item=>item.workflowTaskId)).size,2);
    granted=false;
    await assert.rejects(route(routed[0],{deadline,signal:new AbortController().signal}),{code:'UNSUPPORTED_CAPABILITY'});
    await fx.host.revoke('typescript',{id:'user-revoke'});
    assert.equal((await fx.host.consumeFeedCheck(due,{signal:new AbortController().signal})).accepted,false);
    assert.equal(reads,1,'Revoked schedule does not grant or repeat a read');
  } finally {fx.host.dispose();}
});

test('pause/resume invalidates an old due task and old reevaluation consumer; revoke never reopens it', async () => {
  const fx = fixture();
  await fx.track();
  const old = fx.register();
  const taskId = fx.fire(old.schedule.scheduleId);
  const before = fx.host.listWatches()[0].consumer.revision;
  await fx.host.pause('typescript');
  await fx.host.resume('typescript');
  assert.ok(fx.host.listWatches()[0].consumer.revision > before);
  assert.equal(fx.host.getFeedCheckContext(taskId), null);
  assert.equal(fx.register().reason, 'REVISION_CONFLICT');
  const fresh = fx.register('fresh');
  const freshTask = fx.fire(fresh.schedule.scheduleId);
  assert.ok(fx.host.getFeedCheckContext(freshTask));
  await fx.host.revoke('typescript', {id: 'user-revoke'});
  await fx.host.resume('typescript');
  assert.equal(fx.host.getFeedCheckContext(freshTask), null);
  assert.equal(fx.host.listWatches()[0].state, 'revoked');
  assert.equal(fx.queries.length, 0);
  fx.host.dispose();
});

test('late feed result after pause/resume and caller cancellation cannot persist an observation', async () => {
  let release;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const fx = fixture({feedCollect: async () => { entered(); return new Promise(resolve => { release = resolve; }); }});
  await fx.track();
  const taskId = fx.fire(fx.register().schedule.scheduleId);
  const controller = new AbortController();
  const pending = fx.host.consumeFeedCheck(taskId, {signal: controller.signal});
  await ready;
  assert.equal((await fx.host.consumeFeedCheck(taskId, {signal: controller.signal})).reason, 'feed_check_in_progress');
  await fx.host.pause('typescript');
  await fx.host.resume('typescript');
  release(collected(start + 1000));
  assert.equal((await pending).reason, 'feed_check_invalidated');
  assert.deepEqual(fx.host.snapshot().sources, {});
  const freshTask = fx.fire(fx.register('fresh').schedule.scheduleId);
  controller.abort();
  assert.equal((await fx.host.consumeFeedCheck(freshTask, {signal: controller.signal})).accepted, false);
  assert.equal(fx.queries.length, 1);
  fx.host.dispose();
});

test('source consumer and grant are revalidated after await, and restored pending schedules remain cancellable', async () => {
  let release;
  let entered;
  let gate = false;
  const ready = new Promise(resolve => {entered = resolve;});
  const fx = fixture({readTrackingGrant: async identity => {
    const grant = fx.readGrant(identity);
    if (gate) {gate = false; entered(); await new Promise(resolve => {release = resolve;});}
    return grant;
  }});
  await fx.track();
  const intakeTaskId = fx.host.listWatches()[0].consumer.intakeTaskId;
  const saved = fx.host.registerFeedCheck({checkId: 'restore', runAt: iso(start + 1000), subscriptionId: 'feed-a'});
  assert.equal(saved.bound, true);
  // Same Runtime retains the original intake task, signal and intake receipt.
  const next = createKnowledgeWatchHost(fx.options); next.start();
  assert.equal(next.listWatches()[0].consumer.intakeTaskId, intakeTaskId);
  assert.ok(fx.runtime.getTask(intakeTaskId));
  assert.equal(next.restoreFeedChecks().schedules.length, 1);
  const taskId = fx.fire(saved.schedule.scheduleId);
  gate = true;
  const pending = next.consumeFeedCheck(taskId, {signal: new AbortController().signal});
  await ready;
  await next.revoke('typescript', {id: 'revoke-grant-wait'});
  release();
  assert.equal((await pending).reason, 'authorization_required');
  assert.equal(fx.queries.length, 0);
  // A separate still-pending row restored from Runtime is cancelled on stop.
  const other = fixture(); await other.track(); const registered = other.register();
  const reboot = createKnowledgeWatchHost(other.options); reboot.start(); reboot.restoreFeedChecks(); reboot.stop();
  assert.equal(other.schedules.get(registered.schedule.scheduleId).status, 'cancelled');
  fx.host.dispose(); next.dispose(); other.host.dispose(); reboot.dispose();
});

test('user read is idempotent and durable, independent of system delivery and bound revision', async () => {
  const fx = fixture(); await fx.track(); fx.advance();
  await fx.host.refreshSubscribedFeed({subscriptionId: 'feed-a'});
  const notice = fx.host.snapshot().notices[0];
  const before = fx.host.listWatches()[0].boundSource;
  assert.equal(notice.delivered, false);
  const read = await fx.host.markNoticeRead(notice.id);
  assert.equal(read.reason, 'read');
  assert.equal((await fx.host.markNoticeRead(notice.id)).reason, 'already_read');
  assert.equal(fx.host.snapshot().notices[0].delivered, false);
  assert.deepEqual(fx.host.listWatches()[0].boundSource, before);
  const restored = createKnowledgeWatchHost(fx.options); restored.start();
  assert.equal(restored.snapshot().notices[0].readAt, read.readAt);
  assert.equal((await restored.markNoticeRead('f'.repeat(64))).accepted, false);
  fx.host.dispose(); restored.dispose();
});

test('unchanged sources do not invent updates; separate articles never borrow the first citation', async () => {
  let response = collected(start + 1000);
  const fx = fixture({feedCollect: async () => response}); await fx.track(); fx.advance();
  await fx.host.refreshSubscribedFeed({subscriptionId: 'feed-a'});
  const head = fx.host.snapshot().sources['feed-a'];
  const before = fx.host.snapshot().submissions;
  fx.advance();
  response = {...response, items: [], collection: {...response.collection, state: 'unchanged', fetchedAt: iso(start + 2000)}};
  assert.equal((await fx.host.refreshSubscribedFeed({subscriptionId: 'feed-a'})).notified, false);
  assert.deepEqual(fx.host.snapshot().sources['feed-a'], head);
  response = collected(start + 2000);
  response.items.push({...response.items[0], title: 'Unrelated article', record: {...response.items[0].record,
    dedupeKey: 'article-b', contentRef: 'https://example.com/article-b'}});
  assert.equal((await fx.host.refreshSubscribedFeed({subscriptionId: 'feed-a'})).reason, 'feed_citation_ambiguous');
  assert.deepEqual(fx.host.snapshot().sources['feed-a'], head);
  assert.deepEqual(fx.host.snapshot().submissions, before);
  fx.host.dispose();
});

test('a changed live grant after feed read blocks late source persistence without approving another read', async () => {
  let grant = {id: 'scope-a', revision: 1, state: 'granted', publicLowRiskTracking: true,
    expiresAt: iso(start + 3_600_000)};
  const fx = fixture({readTrackingGrant: async () => grant, feedCollect: async () => {
    grant = {...grant, revision: 2};
    return collected(start + 1000);
  }});
  await fx.track();
  const taskId = fx.fire(fx.register().schedule.scheduleId);
  const result = await fx.host.consumeFeedCheck(taskId, {signal: new AbortController().signal});
  assert.equal(result.reason, 'feed_check_invalidated');
  assert.equal(fx.queries.length, 1);
  assert.deepEqual(fx.host.snapshot().sources, {});
  fx.host.dispose();
});

test('binding control becomes ready only after exact checkpoint v2 and judgment Evidence readback', async () => {
  const fx = fixture({sourceEvidence: true}); await fx.track(); fx.advance();
  await fx.host.refreshSubscribedFeed({subscriptionId: 'feed-a'});
  const [workKey, submission] = Object.entries(fx.host.snapshot().submissions)[0];
  const context = fx.host.getRecheckContext(workKey);
  const task = fx.tasks.get(workKey);
  task.state = 'succeeded';
  assert.equal(fx.host.dialogueProjection().items[0].binding.ready, false);
  const refs = [`knowledge-watch-source-read:${context.sourceReadReceiptId}`, `knowledge-recheck-judgment:${task.taskId}`];
  const judgment = {version: 1, taskId: task.taskId, evidenceRef: refs[1], provider: 'local_laya',
    outcome: 'relevant_update', sourceReadReceiptId: context.sourceReadReceiptId,
    modelReceiptId: 'b'.repeat(64), contextDigest: 'c'.repeat(64),
    observedSummarySha256: createHash('sha256').update(context.summary).digest('hex'), evaluatedAt: iso(start + 1000)};
  const result = {...context, version: 2, status: 'completed', taskId: submission.taskId,
    evaluatedContentSha256: context.observedContentSha256, evaluatedAt: iso(start + 1000), evidenceRefs: refs,
    evaluation: {outcome: 'relevant_update', freshnessAction: 'refresh_required', freshnessReason: 'content_changed',
      topicId: context.topicId, consumerRevision: context.consumerRevision, sourceId: context.sourceId,
      observedRevision: context.observedRevision, modelReceiptId: judgment.modelReceiptId,
      contextDigest: judgment.contextDigest, observedSummarySha256: judgment.observedSummarySha256}};
  fx.runtime.saveCheckpoint(task.taskId, 'knowledge-recheck-result', result);
  fx.runtime.saveCheckpoint(task.taskId, 'knowledge-recheck-judgment', judgment);
  task.evidenceRefs = [context.citation];
  assert.equal(fx.host.dialogueProjection().items[0].binding.ready, false);
  task.evidenceRefs = refs;
  assert.equal(fx.host.dialogueProjection().items[0].binding.ready, true);
  assert.equal((await fx.host.bindObservedRevision('typescript')).accepted, true);
  assert.equal(fx.host.dialogueProjection().items[0].answer.kind, 'current_fact');
  fx.host.dispose();
});

test('due cancellation after feed read stops the delayed read/submit path and retains started work as unknown', async () => {
  for (const gateAt of ['read', 'submit']) {
    let release;
    let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    let submits = 0;
    let notifications = 0;
    const fx = fixture({workPort: {
      async read({signal}) {
        if (gateAt === 'read') { entered(); await new Promise(resolve => { release = resolve; }); }
        assert.equal(signal instanceof AbortSignal, true);
        return {state: 'absent'};
      },
      async submit({signal}) {
        submits += 1;
        if (gateAt === 'submit') { entered(); await new Promise(resolve => { release = resolve; }); }
        assert.equal(signal instanceof AbortSignal, true);
        return {accepted: true, taskId: 'started-runtime-work'};
      },
    }, notificationPort: {send: async () => { notifications += 1; return {delivered: false}; }}});
    await fx.track();
    const taskId = fx.fire(fx.register().schedule.scheduleId);
    const controller = new AbortController();
    const pending = fx.host.consumeFeedCheck(taskId, {signal: controller.signal});
    await ready;
    controller.abort();
    release();
    const result = await pending;
    assert.equal(result.accepted, false, gateAt);
    assert.equal(result.reason, 'source_operation_invalidated', gateAt);
    assert.equal(submits, gateAt === 'read' ? 0 : 1);
    assert.equal(notifications, 0);
    assert.deepEqual(fx.host.snapshot().sources, {});
    assert.deepEqual(fx.host.snapshot().notices, []);
    assert.equal(Object.values(fx.host.snapshot().submissions)[0].state, 'unknown');
    assert.equal((await fx.host.consumeFeedCheck(taskId, {signal: controller.signal})).accepted, false);
    assert.equal(submits, gateAt === 'read' ? 0 : 1, 'no blind resubmit after cancellation');
    fx.host.dispose();
  }
});

test('concurrent source consumers atomically claim one notification send', async () => {
  let releaseReads;
  const readsReady = new Promise(resolve => { releaseReads = resolve; });
  let reads = 0;
  let releaseDelivery;
  const deliveryReady = new Promise(resolve => { releaseDelivery = resolve; });
  let deliveryWaiters = 0;
  let sends = 0;
  const fx = fixture({workPort: {
    async read() { reads += 1; if (reads === 2) releaseReads(); await readsReady;
      return {state: 'accepted', taskId: 'same-runtime-recheck'}; },
    async submit() { assert.fail('the existing exact task should be read back'); },
  }, notificationPort: {async send() { sends += 1; return {delivered: true, receiptId: 'system-receipt'}; }}});
  await fx.track(); fx.advance();
  const event = {namespace, sourceId:'feed-a', availability:'available', revision:'observed-v2',
    contentSha256:'b'.repeat(64), fetchedAt:iso(start+1000), citation:{locator:'https://example.com/article-a'},
    summary:'Public source update.'};
  const request = {revalidate: async () => {
    if (fx.host.snapshot().notices.some(notice => !notice.deliveryAttempted)) {
      deliveryWaiters += 1;
      if (deliveryWaiters === 2) releaseDelivery();
      await deliveryReady;
    }
    return true;
  }};
  const [first, second] = await Promise.all([fx.host.consumeSourceUpdate(event, request), fx.host.consumeSourceUpdate(event, request)]);
  assert.equal(first.accepted, true); assert.equal(second.accepted, true);
  assert.equal(reads, 2); assert.equal(sends, 1);
  assert.equal(fx.host.snapshot().notices.length, 1);
  assert.equal(fx.host.snapshot().notices[0].delivered, true);
  fx.host.dispose();
});
