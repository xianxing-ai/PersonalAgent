import {syntheticCoordinationExecution} from '../../../tests/helpers/synthetic-agentarts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createProactiveHostProofs, proactiveWorkflowDigest as digest} from '@personal-agent/agentarts';
import {feedItemContentSha256} from '@personal-agent/feeds';
import {createDesktopProactiveWorkflowApplication} from '../electron/proactive-workflow-host.js';
import {createDesktopProactiveConfirmedSourceRouter} from '../electron/proactive-confirmed-source-router.js';

// CW-03: Real source path (ConnectorHost persistent eventId / confirmed receipt router)
// bound to an explicit current responsibility generated from user's original words
// through sourceResponsibilityBinding into Runtime 4-entrance event sink -> signed advance.
// Offline fixture only; no real accounts or cloud.
const until = async predicate => {
  for (let n = 0; n < 300; n++) {
    if (await predicate()) return;
    await new Promise(r => setTimeout(r, 5));
  }
  throw Error('Fixture predicate did not settle');
};

const secret = 'explicit-fixture-source-responsibility-secret-32';
const contract = {
  id: 'fixture-cw03-contract',
  version: '1',
  criteria: 'Proactive source responsibility binding contract',
  batchIndependent: true,
  candidates: [{id: 'retrieve', description: 'Retrieve bound source context', action: 'retrieve'}]
};
const capabilities = [{kind: 'retrieve_context', ref: 'fixture.proactive.retrieve_context', location: 'cloud_persistent', effect: 'read'}];

async function createFixture() {
  const cache = resolve('.cache/wiring-20261018/cw03');
  mkdirSync(cache, {recursive: true});
  const folder = mkdtempSync(join(cache, 'source-responsibility-'));
  const path = join(folder, 'runtime.sqlite');
  const namespace = 'synthetic-cw03-user';
  const sourceId = 'pelican-feed-source';
  const configurationRef = 'c'.repeat(64);
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const timestamp = new Date().toISOString();

  const proofs = createProactiveHostProofs(secret);
  let app, desktopWorkflow, router, userSourceTask, granted = true, providerCalls = 0;
  const advanceCalls = [];

  const makeResult = targetSourceId => {
    const record = {
      source: 'rss',
      accountRef: targetSourceId,
      externalId: 'pelican-update-001',
      dedupeKey: `synthetic-pelican-${targetSourceId}-001`,
      contentRef: `https://example.org/pelican-${targetSourceId}-001`,
      occurredAt: timestamp,
      fetchedAt: timestamp,
      sensitivity: 'public'
    };
    const item = {
      record,
      title: 'Pelican Pelicanus Occidentalis update',
      summary: 'Public tracking feed item for pelican conservation',
      dedupeKeyKind: 'item_guid',
      occurredAtKind: 'item_published'
    };
    const citation = {
      externalId: record.externalId,
      contentRef: record.contentRef,
      sourceRevision: 'a'.repeat(64),
      contentSha256: feedItemContentSha256(item)
    };
    return {
      items: [item],
      collection: {state: 'fetched', subscriptionId: targetSourceId, fetchedAt: timestamp, validators: {etag: null, lastModified: null}},
      nextCursor: 'cursor-pelican-v1',
      hasMore: false,
      sourceReceipt: {
        version: 1,
        providerId: 'http-feed-provider-v1',
        source: 'rss',
        subscriptionId: targetSourceId,
        configBinding: configurationRef,
        sensitivity: 'public',
        publicFetch: true,
        sourceRevision: citation.sourceRevision,
        contentSha256: createHash('sha256').update(JSON.stringify([citation.contentSha256])).digest('hex'),
        transport: {
          providerId: 'http-feed-provider-v1',
          nativeFetch: true,
          credentialFree: true,
          state: 'fetched',
          transportFetchedAt: timestamp,
          requestBinding: 'b'.repeat(64),
          decodedBodySha256: citation.sourceRevision
        },
        citations: [citation]
      }
    };
  };

  const tool = {
    descriptor: {
      name: 'feeds.collect',
      version: '1.0.0',
      inputSchema: {
        type: 'object',
        properties: {subscriptionId: {type: 'string'}, limit: {type: 'integer'}},
        required: ['subscriptionId'],
        additionalProperties: false
      },
      outputSchema: {type: 'object'},
      sideEffect: 'read',
      requiredScopes: ['synthetic:feed:read'],
      requiresPresence: false,
      idempotencySupport: true,
      recoverySupport: true
    },
    execute: async args => {
      providerCalls++;
      return makeResult(args.subscriptionId);
    }
  };

  const grant = query => ({
    state: granted && query.taskId === userSourceTask?.taskId ? 'granted' : 'revoked',
    id: 'synthetic-native-grant',
    revision: 1,
    namespace,
    sourceId: query.sourceId,
    configurationRef,
    taskId: userSourceTask?.taskId,
    conversationId: 'desktop-panel',
    purposeDigest: createHash('sha256').update(JSON.stringify(userSourceTask?.goal ?? '')).digest('hex'),
    publicLowRiskTracking: true,
    expiresAt: deadline
  });

  const openApp = () => {
    app = createRuntimeApplication({
      path,
      profile: 'huawei_ict_agentarts',
      proactiveWorkflows: true,
      hostUserNamespace: namespace,
      tools: [tool],
      competitionToolExports: [{
        toolName: 'feeds.collect',
        toolVersion: '1.0.0',
        exportPolicyVersion: 'synthetic-public-feed-v1',
        accepts: () => true,
        project: ({result: r}) => r
      }],
      automaticTools: [{toolName: 'feeds.collect', toolVersion: '1.0.0'}],
      coordination: {
        execute: syntheticCoordinationExecution(async input => {
          const goal = input.task?.goal ?? input.goal ?? input.messages?.[0]?.content ?? '';
          const subId = goal.match(/subscriptionId:([^\s]+)/)?.[1] ?? sourceId;
          return input.continuation
            ? {kind: 'text', text: 'Synthetic source read complete', verification: 'unverified'}
            : {
                kind: 'tool_proposal',
                proposalId: 'synthetic-feed-read',
                toolName: 'feeds.collect',
                toolVersion: '1.0.0',
                arguments: {subscriptionId: subId},
                verification: 'unverified'
              };
        })
      }
    });

    userSourceTask ??= app.runtime.submitTask({
      goal: '用户原话：追踪所选公共 Pelican 数据源，持续同步更新',
      conversationId: 'desktop-panel',
      idempotencyKey: 'user-pelican-instruction'
    });

    app.startProactiveTask = () => {};

    desktopWorkflow = createDesktopProactiveWorkflowApplication({
      application: app,
      localDeviceAvailable: () => true,
      responsibilityLifecycleAuthority: () => ({
        verify: () => true,
        assertCurrent: () => {}
      }),
      readConfiguration: () => ({
        contractRef: contract.id,
        adapter: {endpoint: 'http://127.0.0.1:0/mock-adapter'}
      }),
      createAdapter: () => ({
        describe: async () => ({
          contracts: [{id: contract.id, version: contract.version, criteria: contract.criteria}],
          availableCapabilities: capabilities
        }),
        advancePort: async request => {
          advanceCalls.push(structuredClone(request));
          const proposals = request.events?.map(e => ({
            proposalId: 'prop-' + e.eventId,
            stage: 'retrieve',
            capabilityRef: 'fixture.proactive.retrieve_context',
            operationId: 'op-' + e.eventId,
            arguments: {source: {sourceId: e.sourceId, version: e.sourceVersion}},
            argumentsDigest: digest({source: {sourceId: e.sourceId, version: e.sourceVersion}}),
            taskDeadline: request.taskDeadline,
            originControlRevision: request.controlRevision ?? 0,
            responsibilityRefs: [...e.responsibilityRefs],
            goalRefs: [...e.goalRefs]
          })) ?? [];
          return proofs.sign('advance_result', {
            proactiveVersion: 1,
            advanceRevision: (request.controlRevision ?? 0) + 1,
            requestId: request.requestId,
            taskId: request.taskId,
            taskDeadline: request.taskDeadline,
            checkpoint: 'checkpoint-' + request.requestId,
            items: {},
            proposals
          }, request);
        },
        verifyAdvance: (res, req) => res.requestId === req.requestId && proofs.verify('advance_result', res, req),
        sign: proofs.sign
      })
    });

    router = createDesktopProactiveConfirmedSourceRouter({
      getApplication: () => app,
      getWorkflow: () => desktopWorkflow,
      namespace,
      resolveUserConversation: id => app.runtime.getTask(id)?.conversationId ?? 'desktop-panel',
      readSourceBinding: id => ({
        namespace,
        sourceId: id,
        subscriptionId: id,
        configurationRef,
        sensitivity: 'public',
        available: true,
        containsCredentials: false
      }),
      readTrackingGrant: grant
    });
  };

  openApp();

  const readConfirmedFeed = async (id, targetSourceId = sourceId) => {
    const client = new Client(app);
    await client.connect();
    const {taskId} = await client.call(
      'task.submit',
      {goal: `Read confirmed feed for subscriptionId:${targetSourceId}`, conversationId: 'desktop-panel'},
      {idempotencyKey: id}
    );
    await until(() => ['succeeded', 'failed', 'waiting_reconciliation'].includes(app.runtime.getTask(taskId).state));
    assert.equal(app.runtime.getTask(taskId).state, 'succeeded', JSON.stringify(app.runtime.getTask(taskId).error));
    const execution = app.runtime.readToolExecutions(taskId).find(item => item.toolName === 'feeds.collect');
    assert.equal(execution.state, 'confirmed');
    return {
      taskId,
      runId: execution.evidenceId,
      toolVersion: '1.0.0',
      arguments: {subscriptionId: targetSourceId},
      scopeRef: execution.evidenceId
    };
  };

  return {
    get app() { return app; },
    get desktopWorkflow() { return desktopWorkflow; },
    get router() { return router; },
    get userSourceTask() { return userSourceTask; },
    get deadline() { return deadline; },
    get sourceId() { return sourceId; },
    makeResult,
    advanceCalls,
    proofs,
    context: () => ({deadline, signal: new AbortController().signal}),
    readConfirmedFeed,
    providerCalls: () => providerCalls,
    revokeGrant: () => { granted = false; },
    reopen: () => { app.close(); openApp(); },
    close: () => {
      app.close();
      rmSync(folder, {recursive: true, force: true});
    }
  };
}

test('CW-03: real source event -> bound explicit current responsibility -> signed advance closed loop', async () => {
  const f = await createFixture();
  try {
    const responsibilityId = 'instruction:' + f.userSourceTask.taskId;
    const startResult = await f.desktopWorkflow.start({
      sourceTaskId: f.userSourceTask.taskId,
      commandId: 'cmd-start-pelican-workflow',
      taskDeadline: f.deadline,
      sourceResponsibilityBinding: {
        sourceId: f.sourceId,
        responsibilityId
      }
    });
    assert.equal(startResult.accepted, true);
    const workflowTaskId = startResult.taskId;

    // Verify responsibility registered from user original utterance with explicit_instruction authority
    const session = await f.desktopWorkflow.acquireMaintenance(workflowTaskId, f.context());
    const resp = session.host.readResponsibility({responsibilityId, responsibilityRevision: 1}, f.context());
    assert.equal(resp.id, responsibilityId);
    assert.equal(resp.authority, 'explicit_instruction');
    assert.equal(resp.sourceQuotes.length, 1);
    assert.equal(resp.sourceQuotes[0].quoteRef.includes(f.userSourceTask.taskId), true);

    // Before activation: lifecycle is not recorded -> routing must fail-closed
    const unactivatedFeed = await f.readConfirmedFeed('read-before-activation');
    await assert.rejects(
      f.router.routeConfirmedFeed({...unactivatedFeed, workflowTaskId}, f.context()),
      {code: 'UNSUPPORTED_CAPABILITY'}
    );

    // Activate the explicit responsibility -> lifecycle becomes 'current'
    const activation = await f.desktopWorkflow.recordResponsibilityLifecycle(
      {taskId: workflowTaskId, sessionId: session.binding.sessionId},
      {
        commandId: 'activate-pelican-resp',
        responsibilityId,
        responsibilityRevision: 1,
        expectedLifecycleRevision: null,
        action: 'activate',
        sourceTaskId: f.userSourceTask.taskId,
        validUntil: f.deadline
      },
      f.context()
    );
    assert.equal(activation.state, 'recorded');
    const lifecycle = session.host.readResponsibilityLifecycle({responsibilityId, responsibilityRevision: 1}, f.context());
    assert.equal(lifecycle.state, 'current');

    // Held pending batch is now successfully recovered and committed to durable sink
    const recovery = await f.router.recoverPending(workflowTaskId, f.context());
    assert.equal(recovery.state, 'recovered');
    assert.equal(recovery.deliveries.length, 1);
    assert.equal(recovery.deliveries[0].state, 'recovered');

    // Route confirmed feed receipt again -> already persisted
    const routedAgain = await f.router.routeConfirmedFeed({...unactivatedFeed, workflowTaskId}, f.context());
    assert.equal(routedAgain.state, 'already_persisted');

    // Verify connector entry has responsibilityRefs bound to only this current responsibility
    const entries = Object.values(session.host.inspect().application.state.entries);
    const connectorEntry = entries.find(e => e.event.entry === 'connector' && e.event.sourceId === f.sourceId);
    assert.ok(connectorEntry);
    assert.deepEqual(connectorEntry.event.responsibilityRefs, [responsibilityId]);
    assert.equal(connectorEntry.event.priority, 'unknown'); // never silently dropped

    // Signed advance evaluates frontier with bound current responsibility
    const advanceResult = await session.host.advance({
      requestId: 'advance-req-001',
      deadline: f.deadline,
      signal: new AbortController().signal
    });
    assert.ok(advanceResult.proposals.length >= 1);
    assert.deepEqual(advanceResult.proposals[0].responsibilityRefs, [responsibilityId]);

    // Check signed request payload received by advancePort
    assert.equal(f.advanceCalls.length, 1);
    const received = f.advanceCalls[0];
    assert.ok(received.events.some(e => e.sourceId === f.sourceId && e.responsibilityRefs.includes(responsibilityId)));
    assert.ok(received.responsibilities.some(r => r.id === responsibilityId && r.authority === 'explicit_instruction'));
  } finally {
    f.close();
  }
});

test('CW-03 fail-closed: unbound source is rejected and pending cursor is preserved without commit', async () => {
  const f = await createFixture();
  try {
    const responsibilityId = 'instruction:' + f.userSourceTask.taskId;
    const startResult = await f.desktopWorkflow.start({
      sourceTaskId: f.userSourceTask.taskId,
      commandId: 'cmd-start-unbound-workflow',
      taskDeadline: f.deadline,
      sourceResponsibilityBinding: {
        sourceId: f.sourceId,
        responsibilityId
      }
    });
    const workflowTaskId = startResult.taskId;
    const session = await f.desktopWorkflow.acquireMaintenance(workflowTaskId, f.context());

    // Activate the responsibility
    await f.desktopWorkflow.recordResponsibilityLifecycle(
      {taskId: workflowTaskId, sessionId: session.binding.sessionId},
      {
        commandId: 'activate-unbound-test',
        responsibilityId,
        responsibilityRevision: 1,
        expectedLifecycleRevision: null,
        action: 'activate',
        sourceTaskId: f.userSourceTask.taskId,
        validUntil: f.deadline
      },
      f.context()
    );

    // Feed read for a DIFFERENT source
    const otherSourceId = 'other-unbound-source';
    const feedRead = await f.readConfirmedFeed('read-other-source', otherSourceId);
    const input = {...feedRead, workflowTaskId};

    // Routing must throw UNAUTHORIZED because sourceId does not match bound source
    await assert.rejects(
      f.router.routeConfirmedFeed(input, f.context()),
      {code: 'UNAUTHORIZED'}
    );

    // Verify no connector entries were persisted
    const entries = Object.values(session.host.inspect().application.state.entries);
    assert.equal(entries.filter(e => e.event.entry === 'connector').length, 0);

    // recoverPending reports UNAUTHORIZED and does not silently drop or commit
    const recovery = await f.router.recoverPending(workflowTaskId, f.context());
    assert.equal(recovery.state, 'unavailable');
    assert.ok(recovery.deliveries.some(d => d.sourceId === otherSourceId && d.code === 'UNAUTHORIZED'));
  } finally {
    f.close();
  }
});

test('CW-03 fail-closed: revoked, expired or revision-changed responsibility rejects feed persist', async () => {
  const f = await createFixture();
  try {
    const responsibilityId = 'instruction:' + f.userSourceTask.taskId;
    const startResult = await f.desktopWorkflow.start({
      sourceTaskId: f.userSourceTask.taskId,
      commandId: 'cmd-start-lifecycle-workflow',
      taskDeadline: f.deadline,
      sourceResponsibilityBinding: {
        sourceId: f.sourceId,
        responsibilityId
      }
    });
    const workflowTaskId = startResult.taskId;
    const session = await f.desktopWorkflow.acquireMaintenance(workflowTaskId, f.context());

    // Case A: Activate then revoke
    await f.desktopWorkflow.recordResponsibilityLifecycle(
      {taskId: workflowTaskId, sessionId: session.binding.sessionId},
      {
        commandId: 'activate-to-revoke',
        responsibilityId,
        responsibilityRevision: 1,
        expectedLifecycleRevision: null,
        action: 'activate',
        sourceTaskId: f.userSourceTask.taskId,
        validUntil: f.deadline
      },
      f.context()
    );
    await f.desktopWorkflow.recordResponsibilityLifecycle(
      {taskId: workflowTaskId, sessionId: session.binding.sessionId},
      {
        commandId: 'revoke-pelican-resp',
        responsibilityId,
        responsibilityRevision: 1,
        expectedLifecycleRevision: 1,
        action: 'revoke',
        sourceTaskId: f.userSourceTask.taskId
      },
      f.context()
    );
    assert.equal(
      session.host.readResponsibilityLifecycle({responsibilityId, responsibilityRevision: 1}, f.context()).state,
      'unavailable'
    );

    const feedReadA = await f.readConfirmedFeed('read-revoked');
    await assert.rejects(
      f.router.routeConfirmedFeed({...feedReadA, workflowTaskId}, f.context()),
      {code: 'UNSUPPORTED_CAPABILITY'}
    );

    // Case B: Expired responsibility (activate with future date, then simulate elapsed time)
    const expiryTimestamp = new Date(Date.now() + 50).toISOString();
    const expiredRespId = 'instruction-expired';
    session.host.registerResponsibility(
      {id: expiredRespId, revision: 1, sourceTaskIds: [f.userSourceTask.taskId], goalRefs: [], authority: 'explicit_instruction', scopeRefs: []},
      f.context()
    );
    await session.host.recordResponsibilityLifecycle(
      {
        commandId: 'activate-expired',
        responsibilityId: expiredRespId,
        responsibilityRevision: 1,
        expectedLifecycleRevision: null,
        action: 'activate',
        sourceTaskId: f.userSourceTask.taskId,
        validUntil: expiryTimestamp
      },
      f.context()
    );
    await new Promise(r => setTimeout(r, 60));
    assert.equal(
      session.host.readResponsibilityLifecycle({responsibilityId: expiredRespId, responsibilityRevision: 1}, f.context()).reason,
      'responsibility_expired'
    );

    // Case C: Responsibility revision changed (revision 2 registered without matching lifecycle)
    session.host.registerResponsibility(
      {id: responsibilityId, revision: 2, sourceTaskIds: [f.userSourceTask.taskId], goalRefs: [], authority: 'explicit_instruction', scopeRefs: []},
      f.context()
    );
    assert.equal(
      session.host.readResponsibilityLifecycle({responsibilityId, responsibilityRevision: 2}, f.context()).reason,
      'responsibility_revision_changed'
    );
  } finally {
    f.close();
  }
});

test('CW-03 fail-closed: foreign conversation / scope denied cannot persist source', async () => {
  const f = await createFixture();
  try {
    const responsibilityId = 'instruction:' + f.userSourceTask.taskId;
    const startResult = await f.desktopWorkflow.start({
      sourceTaskId: f.userSourceTask.taskId,
      commandId: 'cmd-scope-test',
      taskDeadline: f.deadline,
      sourceResponsibilityBinding: {sourceId: f.sourceId, responsibilityId}
    });
    const workflowTaskId = startResult.taskId;
    const session = await f.desktopWorkflow.acquireMaintenance(workflowTaskId, f.context());
    await f.desktopWorkflow.recordResponsibilityLifecycle(
      {taskId: workflowTaskId, sessionId: session.binding.sessionId},
      {
        commandId: 'activate-scope-test',
        responsibilityId,
        responsibilityRevision: 1,
        expectedLifecycleRevision: null,
        action: 'activate',
        sourceTaskId: f.userSourceTask.taskId,
        validUntil: f.deadline
      },
      f.context()
    );

    const feedRead = await f.readConfirmedFeed('read-scope-test');
    // Read task submitted under a foreign conversation
    const foreignTask = f.app.runtime.submitTask({
      goal: 'Foreign conversation task',
      conversationId: 'foreign-panel',
      idempotencyKey: 'foreign-task'
    });
    await assert.rejects(
      f.router.routeConfirmedFeed({...feedRead, workflowTaskId, taskId: foreignTask.taskId}, f.context()),
      {code: 'SCOPE_DENIED'}
    );

    // Tracking grant revoked
    f.revokeGrant();
    await assert.rejects(
      f.router.routeConfirmedFeed({...feedRead, workflowTaskId}, f.context()),
      {code: 'UNSUPPORTED_CAPABILITY'}
    );
  } finally {
    f.close();
  }
});

test('CW-03 duplicate receipt deduplication and SQLite restart preserves binding without repeat advance', async () => {
  const f = await createFixture();
  try {
    const responsibilityId = 'instruction:' + f.userSourceTask.taskId;
    const startResult = await f.desktopWorkflow.start({
      sourceTaskId: f.userSourceTask.taskId,
      commandId: 'cmd-restart-test',
      taskDeadline: f.deadline,
      sourceResponsibilityBinding: {
        sourceId: f.sourceId,
        responsibilityId
      }
    });
    const workflowTaskId = startResult.taskId;
    let session = await f.desktopWorkflow.acquireMaintenance(workflowTaskId, f.context());

    // Activate responsibility
    await f.desktopWorkflow.recordResponsibilityLifecycle(
      {taskId: workflowTaskId, sessionId: session.binding.sessionId},
      {
        commandId: 'activate-restart-test',
        responsibilityId,
        responsibilityRevision: 1,
        expectedLifecycleRevision: null,
        action: 'activate',
        sourceTaskId: f.userSourceTask.taskId,
        validUntil: f.deadline
      },
      f.context()
    );

    const feedRead = await f.readConfirmedFeed('read-restart-test');
    const input = {...feedRead, workflowTaskId};

    // First persistence
    const firstPersist = await f.router.routeConfirmedFeed(input, f.context());
    assert.equal(firstPersist.state, 'persisted');
    assert.equal(firstPersist.eventCount, 1);

    // Duplicate receipt routing returns already_persisted without second event
    const repeatPersist = await f.router.routeConfirmedFeed(input, f.context());
    assert.equal(repeatPersist.state, 'already_persisted');
    assert.equal(repeatPersist.batchId, firstPersist.batchId);

    // First advance
    const firstAdvance = await session.host.advance({
      requestId: 'restart-advance-1',
      deadline: f.deadline,
      signal: new AbortController().signal
    });
    assert.equal(f.advanceCalls.length, 1);
    assert.ok(firstAdvance.proposals.length >= 1);

    // Restart SQLite and reload application
    f.reopen();
    session = await f.desktopWorkflow.acquireMaintenance(workflowTaskId, f.context());

    // Binding is restored from desktop-proactive-workflow-v1 checkpoint
    assert.deepEqual(session.binding.sourceResponsibilityBinding, {
      sourceId: f.sourceId,
      responsibilityId
    });

    // Replay of same advance requestId does not invoke advancePort again
    const advanceCountBefore = f.advanceCalls.length;
    const replayAdvance = await session.host.advance({
      requestId: 'restart-advance-1',
      deadline: f.deadline,
      signal: new AbortController().signal
    });
    assert.equal(f.advanceCalls.length, advanceCountBefore);
    assert.deepEqual(replayAdvance, firstAdvance);

    // New advance with no new events produces no new proposals
    const secondAdvance = await session.host.advance({
      requestId: 'restart-advance-2',
      deadline: f.deadline,
      signal: new AbortController().signal
    });
    assert.equal(secondAdvance.proposals.length, 0);

    // Repeated receipt after restart still recognized as already_persisted
    const postRestartRepeat = await f.router.routeConfirmedFeed(input, f.context());
    assert.equal(postRestartRepeat.state, 'already_persisted');
    assert.equal(f.providerCalls(), 1);
  } finally {
    f.close();
  }
});
