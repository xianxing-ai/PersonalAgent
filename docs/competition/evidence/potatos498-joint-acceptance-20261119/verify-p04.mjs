import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const WORKTREE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RECEIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'p04-receipt.json');

const importFromWorktree = rel => import(pathToFileURL(path.join(WORKTREE, rel)).href);

const {Client} = await importFromWorktree('packages/client/dist/index.js');
const {HttpFeedProvider} = await importFromWorktree('packages/connectors/feeds/dist/index.js');
const {createRuntimeApplication} = await importFromWorktree('apps/runtime/dist/application.js');
const {createDesktopFeedsHost} = await importFromWorktree('apps/desktop/electron/feeds-host.js');
const {
  OwnedWorkflowEngine,
  createOwnedWorkflowAdapter,
  createOwnedWorkflowReceiptVerifier,
} = await importFromWorktree('packages/agentarts/dist/index.js');

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value, 'utf8'),
  decryptString: buf => Buffer.from(buf).toString('utf8'),
};

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'pa-p04-verify-'));
const dbPath = path.join(tmpRoot, 'runtime.sqlite');
const userData = path.join(tmpRoot, 'userData');
mkdirSync(userData, {recursive: true});

let feedVersion = 1;
let requestCount = 0;
let conditional304Count = 0;

const buildRss = version => {
  const items = [
    '<item><guid>rss-1</guid><title>F09 Signal Alpha</title><link>http://127.0.0.1/articles/1</link><pubDate>Mon, 16 Nov 2026 08:00:00 GMT</pubDate><description>Alpha description</description></item>',
    '<item><guid>rss-2</guid><title>F09 Signal Beta</title><link>http://127.0.0.1/articles/2</link><pubDate>Mon, 16 Nov 2026 09:00:00 GMT</pubDate><description>Beta description</description></item>',
  ];
  if (version >= 2) {
    items.push('<item><guid>rss-3</guid><title>F09 Signal Gamma</title><link>http://127.0.0.1/articles/3</link><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate><description>Gamma description</description></item>');
  }
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Local P04 Feed</title><link>http://127.0.0.1/</link>${items.join('')}</channel></rss>`;
};

const server = http.createServer((req, res) => {
  requestCount++;
  const etag = `"v${feedVersion}"`;
  if (req.headers['if-none-match'] === etag) {
    conditional304Count++;
    res.writeHead(304, {'ETag': etag});
    res.end();
    return;
  }
  const body = buildRss(feedVersion);
  res.writeHead(200, {
    'Content-Type': 'application/rss+xml; charset=utf-8',
    'ETag': etag,
  });
  res.end(body);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const {port} = server.address();
const feedUrl = `http://127.0.0.1:${port}/feed.xml`;

const receipts = {
  package: 'P-04',
  issues: ['#14', 'F09'],
  verifiedAt: new Date().toISOString(),
  feedUrl,
  checks: {},
};

const secret = 'p04-f09-verification-receipt-secret-32chars';

async function approveAndRead(runtimeApp, hostTaskResult) {
  const client = new Client(runtimeApp);
  await client.connect();
  try {
    for (let i = 0; i < 40; i++) {
      const s = runtimeApp.readHostToolTask(hostTaskResult.localTaskId);
      if (s.approval?.state === 'pending' || ['succeeded', 'failed', 'cancelled'].includes(s.task.state)) break;
      await new Promise(r => setTimeout(r, 25));
    }
    const status = runtimeApp.readHostToolTask(hostTaskResult.localTaskId);
    if (status.approval?.state === 'pending') {
      await client.call('authorization.respond', {
        approvalId: status.approval.approvalId,
        expectedRevision: status.approval.revision,
        decision: 'allow_once',
      });
    }
    await runtimeApp.waitForHostToolTask(hostTaskResult.localTaskId);
    const finished = runtimeApp.readHostToolTask(hostTaskResult.localTaskId);
    assert.equal(finished.task.state, 'succeeded', JSON.stringify(finished.task.error));
    return finished;
  } finally {
    await client.close?.();
  }
}

try {
  // Phase 1: Initial SQLite + Desktop Feeds Host + F09 4-node graph
  const provider1 = new HttpFeedProvider();
  const feedsHost1 = createDesktopFeedsHost({userData, safeStorage, provider: provider1});
  feedsHost1.add({title: 'Local P04 Feed', url: feedUrl});
  feedsHost1.prepare();

  const subscriptionId = feedsHost1.snapshot().subscriptions[0].id;
  const enqueueAdapter1 = createOwnedWorkflowAdapter({
    nodeId: 'F09_N04',
    kind: 'host',
    sideEffect: 'local_write',
    requiredScopes: ['research:enqueue'],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['signalPayload'],
      properties: {signalPayload: {type: 'object'}},
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['researchTaskSpawned', 'researchTaskId'],
      properties: {
        researchTaskSpawned: {type: 'boolean'},
        researchTaskId: {type: 'string', minLength: 1},
      },
    },
    execute: async input => {
      const enqueued = runtimeApp1.runtime.submitTask({
        goal: `F10 深度研究: ${input.signalPayload.title ?? 'feed signal'}`,
        conversationId: 'desktop-research-queue',
        idempotencyKey: `f10-enqueue:${input.signalPayload.guid ?? 'item'}`,
      });
      return {researchTaskSpawned: true, researchTaskId: enqueued.taskId};
    },
  });

  const allTools1 = [...feedsHost1.tools, ...feedsHost1.workflowHostTools, enqueueAdapter1];
  const runtimeApp1 = createRuntimeApplication({
    path: dbPath,
    profile: 'huawei_ict_agentarts',
    hostUserNamespace: 'p04-user',
    tools: allTools1,
    riskAutonomy: false,
  });
  feedsHost1.bindApplication(runtimeApp1, 'p04-user');

  const deadline = new Date(Date.now() + 60_000).toISOString();
  const parentTask1 = runtimeApp1.runtime.submitTask({
    goal: 'F09 订阅采集与去重闭环验收',
    conversationId: 'desktop-panel',
    idempotencyKey: 'p04-f09-parent-1',
  });
  runtimeApp1.runtime.saveCheckpoint(parentTask1.taskId, 'application-deadline', deadline);

  // Check fail-closed before native feed-source-grant
  await assert.rejects(
    feedsHost1.validateAndDeduplicate({
      subscriptionId,
      taskId: parentTask1.taskId,
      items: [{guid: 'rss-1', url: 'http://127.0.0.1/articles/1'}],
    }),
    /feed_source_grant_unavailable|feed_session_not_authorized/,
  );
  receipts.checks.failClosedBeforeGrant = true;

  // Grant feed-source-grant & authorize session
  const choice1 = feedsHost1.prepareNativeSourceChoice({subscriptionId, taskId: parentTask1.taskId});
  feedsHost1.applyNativeSourceChoice(choice1, 'public');
  feedsHost1.authorize({readAndCloudConsent: true});
  const grant1 = feedsHost1.readTrackingGrant({namespace: 'p04-user', sourceId: subscriptionId, taskId: parentTask1.taskId});
  assert.equal(grant1.state, 'granted');
  receipts.checks.feedSourceGrant1 = {
    id: grant1.id,
    state: grant1.state,
    grantedScopes: grant1.grantedScopes,
    configurationRef: grant1.configurationRef,
  };

  // Drive F09 (F09_N01 -> F09_N02 -> F09_N03 -> F09_N04) via OwnedWorkflowEngine + Bridge
  const catalog1 = allTools1.map(({descriptor: d}) => ({name: d.name, version: d.version, inputSchema: d.inputSchema}));
  let n01Items = [];
  let n01Cursor = '';
  let n02ValidItems = [];
  const engine = new OwnedWorkflowEngine({
    externalHost: true,
    checkpointSecret: secret,
    receiptVerifier: createOwnedWorkflowReceiptVerifier({secret}),
    selector: {select: async () => 'run'},
    prepareCandidates: async context => {
      if (context.node.id === 'F09_N01') {
        return [
          {
            id: 'run',
            description: 'Collect public feed items',
            value: {toolName: 'feeds.collect', toolVersion: feedsHost1.tools.find(t => t.descriptor.name === 'feeds.collect').descriptor.version, arguments: {subscriptionId, limit: 10}},
          },
          {id: 'skip', description: 'Abstain', value: {}, abstain: true},
        ];
      }
      if (context.node.id === 'F09_N02') {
        return [
          {
            id: 'run',
            description: 'Validate and deduplicate items',
            value: {
              arguments: {
                subscriptionId,
                taskId: parentTask1.taskId,
                events: n01Items,
                nextCursor: n01Cursor,
              },
            },
          },
          {id: 'skip', description: 'Abstain', value: {}, abstain: true},
        ];
      }
      if (context.node.id === 'F09_N03') {
        const first = n02ValidItems[0];
        return [
          {
            id: 'run',
            description: 'Forward high-value signal to F10',
            value: {highValueSignal: true, discardedJunk: 0, forwardToFeature: 'F10', selectedGuid: first?.guid ?? first?.record?.externalId},
          },
          {id: 'skip', description: 'Abstain', value: {}, abstain: true},
        ];
      }
      if (context.node.id === 'F09_N04') {
        const first = n02ValidItems[0];
        return [
          {
            id: 'run',
            description: 'Enqueue research task',
            value: {arguments: {signalPayload: {guid: first?.record?.externalId ?? 'rss-1', title: first?.title ?? 'Alpha'}}},
          },
          {id: 'skip', description: 'Abstain', value: {}, abstain: true},
        ];
      }
      return [];
    },
  });

  const advanceRequest = {
    workflowId: 'F09',
    workflowVersion: 'owned-workflow-v1',
    mode: 'main',
    taskId: parentTask1.taskId,
    sessionId: 'p04-session-1',
    controlRevision: 0,
    requestId: 'req-0',
    deadline,
    signal: new AbortController().signal,
    availableTools: catalog1,
    input: {subscriptionId},
  };

  let stepRes = await engine.advance(advanceRequest);
  const visitedNodes = [];
  let seq = 0;
  while ((stepRes.state === 'awaiting_host' || stepRes.state === 'progress') && seq < 16) {
    if (stepRes.state === 'progress') {
      seq++;
      stepRes = await engine.advance({
        ...advanceRequest,
        requestId: `req-${seq}`,
        checkpoint: stepRes.checkpoint,
        receipts: [],
      });
      continue;
    }
    assert.equal(stepRes.proposals.length, 1);
    const proposal = stepRes.proposals[0];
    visitedNodes.push(proposal.nodeId);
    if (proposal.toolName === 'feeds.collect') {
      assert.equal(
        feedsHost1.competitionToolAvailability.find(a => a.toolName === 'feeds.collect').available({
          taskId: parentTask1.taskId,
          signal: advanceRequest.signal,
        }),
        true,
      );
    }
    const bridge = runtimeApp1.createOwnedWorkflowHost({
      receiptSecret: secret,
      assertActive: () => {},
    });
    const hostResult = bridge.submit(
      {taskId: parentTask1.taskId, sessionId: 'p04-session-1', workflowId: 'F09', controlRevision: 0, deadline},
      proposal,
    );
    // Availability must be claimed on the host child task too when tool is feeds.collect
    if (proposal.toolName === 'feeds.collect') {
      assert.equal(
        feedsHost1.competitionToolAvailability.find(a => a.toolName === 'feeds.collect').available({
          taskId: hostResult.localTaskId,
          signal: advanceRequest.signal,
        }),
        true,
      );
    }
    const finished = await approveAndRead(runtimeApp1, hostResult);
    if (proposal.nodeId === 'F09_N01') {
      n01Items = finished.confirmed.result.items;
      n01Cursor = finished.confirmed.result.nextCursor;
    } else if (proposal.nodeId === 'F09_N02') {
      n02ValidItems = finished.confirmed.result.validItems;
    }
    const receipt = bridge.readReceipt(
      {taskId: parentTask1.taskId, sessionId: 'p04-session-1', workflowId: 'F09', controlRevision: 0, deadline},
      proposal,
    );
    assert.equal(receipt.state, 'confirmed');
    seq++;
    stepRes = await engine.advance({
      ...advanceRequest,
      requestId: `req-${seq}`,
      checkpoint: stepRes.checkpoint,
      receipts: [receipt],
    });
  }

  assert.equal(stepRes.state, 'settled');
  assert.deepEqual(visitedNodes, ['F09_N01', 'F09_N02', 'F09_N04']);
  assert.equal(stepRes.nodes.F09_N01.state, 'completed');
  assert.equal(stepRes.nodes.F09_N02.state, 'completed');
  assert.equal(stepRes.nodes.F09_N03.state, 'completed');
  assert.equal(stepRes.nodes.F09_N04.state, 'completed');
  const f10TaskId = stepRes.nodes.F09_N04.value.researchTaskId;
  const persistedF10Task = runtimeApp1.runtime.getTask(f10TaskId);
  assert.equal(persistedF10Task.conversationId, 'desktop-research-queue');

  receipts.checks.f09FourNodeFlow = {
    state: stepRes.state,
    nodes: Object.fromEntries(Object.entries(stepRes.nodes).map(([k, v]) => [k, v.state])),
    n01CollectedCount: n01Items.length,
    n02Validation: {
      uniqueCount: stepRes.nodes.F09_N02.value.uniqueCount,
      duplicateDiscarded: stepRes.nodes.F09_N02.value.duplicateDiscarded,
      authorizationRef: stepRes.nodes.F09_N02.value.authorizationRef,
    },
    n03Decision: stepRes.nodes.F09_N03.value,
    n04ResearchTaskId: f10TaskId,
  };

  feedsHost1.close();
  runtimeApp1.close();

  // Phase 2: Reopen SQLite + Desktop Feeds Host -> verify persistent cursor + 304 + delta 1 + revoke
  const provider2 = new HttpFeedProvider();
  const feedsHost2 = createDesktopFeedsHost({userData, safeStorage, provider: provider2});
  feedsHost2.prepare();
  const allTools2 = [...feedsHost2.tools, ...feedsHost2.workflowHostTools];
  const runtimeApp2 = createRuntimeApplication({
    path: dbPath,
    profile: 'huawei_ict_agentarts',
    hostUserNamespace: 'p04-user',
    tools: allTools2,
    riskAutonomy: false,
  });
  feedsHost2.bindApplication(runtimeApp2, 'p04-user');

  const parentTask2 = runtimeApp2.runtime.submitTask({
    goal: 'F09 重启后游标持久化与增量去重验收',
    conversationId: 'desktop-panel',
    idempotencyKey: 'p04-f09-parent-2',
  });
  runtimeApp2.runtime.saveCheckpoint(parentTask2.taskId, 'application-deadline', deadline);

  const persistedCursor = feedsHost2.readPersistedCursor(subscriptionId);
  assert.equal(persistedCursor, n01Cursor);
  assert.equal(feedsHost2.readKnownFingerprints(subscriptionId).length, 2);

  const choice2 = feedsHost2.prepareNativeSourceChoice({subscriptionId, taskId: parentTask2.taskId});
  feedsHost2.applyNativeSourceChoice(choice2, 'public');
  feedsHost2.authorize({readAndCloudConsent: true});
  const ctx2 = {
    taskId: parentTask2.taskId,
    signal: new AbortController().signal,
    deadline,
    scopes: ['feeds:read'],
  };
  assert.equal(feedsHost2.competitionToolAvailability.find(a => a.toolName === 'feeds.collect').available(ctx2), true);
  const collectTool2 = feedsHost2.tools.find(t => t.descriptor.name === 'feeds.collect');

  // Unchanged -> HTTP 304, 0 items delivered
  const pollUnchanged = await collectTool2.execute({subscriptionId, cursor: persistedCursor}, ctx2);
  assert.equal(pollUnchanged.collection.state, 'unchanged');
  assert.equal(pollUnchanged.items.length, 0);
  assert.ok(conditional304Count >= 1);

  // Add item 3 -> HTTP 200, only 1 new item delivered, F09_N02 rejects duplicate rss-1 and keeps rss-3
  feedVersion = 2;
  const pollNew = await collectTool2.execute({subscriptionId, cursor: persistedCursor}, ctx2);
  assert.equal(pollNew.collection.state, 'fetched');
  assert.equal(pollNew.items.length, 1);
  assert.equal(pollNew.items[0].title, 'F09 Signal Gamma');

  const dedupeNew = await feedsHost2.validateAndDeduplicate({
    subscriptionId,
    taskId: parentTask2.taskId,
    items: [...n01Items.slice(0, 1), ...pollNew.items],
    nextCursor: pollNew.nextCursor,
  });
  assert.equal(dedupeNew.uniqueCount, 1);
  assert.equal(dedupeNew.duplicateDiscarded, 1);
  assert.equal(feedsHost2.readPersistedCursor(subscriptionId), pollNew.nextCursor);
  assert.equal(feedsHost2.readKnownFingerprints(subscriptionId).length, 3);

  feedsHost2.revoke();
  const revokedGrant = feedsHost2.readTrackingGrant({namespace: 'p04-user', sourceId: subscriptionId, taskId: parentTask2.taskId});
  assert.equal(revokedGrant.state, 'none');
  await assert.rejects(
    feedsHost2.validateAndDeduplicate({
      subscriptionId,
      taskId: parentTask2.taskId,
      items: [{guid: 'rss-4', url: 'http://127.0.0.1/articles/4'}],
    }),
    /feed_session_not_authorized|feed_source_grant_unavailable/,
  );

  receipts.checks.crossRestartAndDelta = {
    persistedCursorMatchesAfterRestart: true,
    httpRequestsTotal: requestCount,
    httpConditional304Count: conditional304Count,
    unchangedDeliveredCount: pollUnchanged.items.length,
    deltaDeliveredCount: pollNew.items.length,
    deltaUniqueCount: dedupeNew.uniqueCount,
    deltaDuplicateDiscarded: dedupeNew.duplicateDiscarded,
    persistedFingerprintCountAfterDelta: feedsHost2.readKnownFingerprints(subscriptionId).length,
    revokedSessionRejected: true,
  };

  feedsHost2.close();
  runtimeApp2.close();
} finally {
  await new Promise(resolve => server.close(resolve));
  try {
    rmSync(tmpRoot, {recursive: true, force: true, maxRetries: 5, retryDelay: 50});
  } catch { /* Windows sqlite handle release lag on temp dir */ }
}

writeFileSync(RECEIPT_PATH, JSON.stringify(receipts, null, 2), 'utf8');
console.log(JSON.stringify(receipts, null, 2));
