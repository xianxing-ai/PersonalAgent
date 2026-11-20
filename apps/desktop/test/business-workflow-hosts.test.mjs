import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {Client} from '@personal-agent/client';
import {FakeMailProvider} from '@personal-agent/mail';
import {createCalendarConfig} from '../electron/calendar-config.js';
import {createMailConfig} from '../electron/mail-config.js';
import {createDesktopTodoHost} from '../electron/todo-host.js';
import {createDesktopNotificationPort} from '../electron/desktop-notification-port.js';
import {createDesktopNotificationApplicationHost} from '../electron/notification-application-host.js';
import {createDesktopBusinessWorkflowHosts} from '../electron/business-workflow-hosts.js';
import {GhCliProvider, GitHubService} from '@personal-agent/github';

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value, 'utf8'),
  decryptString: buf => Buffer.from(buf).toString('utf8'),
};

function startLoopbackCaldavServer() {
  const resources = new Map();
  let seqVersion = 1;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');
    const urlPath = (req.url || '/').split('?')[0];
    if (req.method === 'OPTIONS' || req.method === 'PROPFIND') {
      if (urlPath === '/cal/') {
        const itemsXml = [...resources.entries()].map(([href, entry]) =>
          `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>${entry.etag}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
        ).join('');
        res.writeHead(207, {'Content-Type': 'application/xml; charset=utf-8', 'DAV': '1, calendar-access'});
        res.end(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/cal/</d:href><d:propstat><d:prop><d:displayname>Work</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>${itemsXml}</d:multistatus>`);
        return;
      }
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.method === 'REPORT') {
      const itemsXml = [...resources.entries()].map(([href, entry]) =>
        `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>${entry.etag}</d:getetag><c:calendar-data>${entry.ics}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
      ).join('');
      res.writeHead(207, {'Content-Type': 'application/xml; charset=utf-8'});
      res.end(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${itemsXml}</d:multistatus>`);
      return;
    }
    if (req.method === 'GET') {
      const entry = resources.get(urlPath);
      if (!entry) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {'Content-Type': 'text/calendar; charset=utf-8', 'ETag': entry.etag});
      res.end(entry.ics);
      return;
    }
    if (req.method === 'PUT') {
      const existing = resources.get(urlPath);
      if (req.headers['if-none-match'] === '*' && existing) {
        res.writeHead(412);
        res.end();
        return;
      }
      if (req.headers['if-match'] && existing && req.headers['if-match'] !== existing.etag) {
        res.writeHead(412);
        res.end();
        return;
      }
      const etag = `"etag-${++seqVersion}"`;
      resources.set(urlPath, {ics: body, etag});
      res.writeHead(existing ? 204 : 201, {'ETag': etag});
      res.end();
      return;
    }
    res.writeHead(405);
    res.end();
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}/cal/`,
        close: () => new Promise(done => server.close(done)),
      });
    });
  });
}

test('desktop business workflow hosts wire F06/F07/F08/F11 end-to-end with SQLite CAS, CalDAV and mail sessions', async () => {
  const caldav = await startLoopbackCaldavServer();
  const root = mkdtempSync(path.join(os.tmpdir(), 'pa-bwh-'));
  const userData = path.join(root, 'userData');
  const dbPath = path.join(root, 'runtime.sqlite');
  mkdirSync(userData, {recursive: true});

  const mailProvider = new FakeMailProvider();
  let app = createRuntimeApplication({
    path: dbPath,
    profile: 'huawei_ict_agentarts',
    hostUserNamespace: 'bwh-user',
    tools: [],
    riskAutonomy: false,
  });

  const todoHost = createDesktopTodoHost({
    userData,
    safeStorage,
    namespace: 'bwh-user',
    createDeliveryHost: () => ({async tick() {}, async close() {}}),
  });
  todoHost.bindApplication(app);

  const calendarConfig = createCalendarConfig({userData, safeStorage});
  const mailConfig = createMailConfig({userData, safeStorage});

  const hosts = createDesktopBusinessWorkflowHosts({
    getApplication: () => app,
    getTodoHost: () => todoHost,
    getCalendarConfig: () => calendarConfig,
    getMailConfig: () => mailConfig,
    createMailProvider: () => mailProvider,
  });

  const submittedTask = app.runtime.submitTask({
    goal: 'Desktop business workflow acceptance',
    conversationId: 'desktop-panel',
    idempotencyKey: 'bwh-task-1-key',
  });
  const taskId = submittedTask.taskId;
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const makeCtx = input => ({
    input,
    taskId,
    signal: new AbortController().signal,
    deadline,
    requestId: 'req-bwh-1',
    mode: 'main',
    predecessorStates: {},
    predecessorOutputs: {},
  });

  try {
    // 1. Fail-closed before calendar/mail/todo session authorization
    const calWritePort = hosts.findPort('calendar.registered_write');
    const preAuthCal = await calWritePort.read(makeCtx({
      accountRef: 'desktop-calendar',
      summary: 'Should not write',
      startUtc: '2026-11-21T09:00:00.000Z',
      endUtc: '2026-11-21T10:00:00.000Z',
    }));
    assert.equal(preAuthCal.state, 'unavailable');

    const mailSendPort = hosts.findPort('mail.registered_send');
    const preAuthMail = await mailSendPort.read(makeCtx({
      accountRef: 'desktop-qq-inbox',
      to: 'team@example.com',
      subject: 'Hello',
      text: 'Body',
      idempotencyKey: 'mail-pre-1',
    }));
    assert.equal(preAuthMail.state, 'unavailable');

    // 2. Authorize Todo + test F06_N03 SQLite CAS idempotency & F06_N04 clock/revision
    todoHost.authorize({readAndCloudConsent: true});
    todoHost.competitionToolAvailability.find(a => a.toolName === 'todo.create').available({
      taskId,
      signal: new AbortController().signal,
    });
    const todoPort = hosts.findPort('todo.registered_write');
    const t1 = await todoPort.read(makeCtx({
      title: 'Prepare F06 release',
      idempotencyKey: 'f06-cas-key-1',
      remindUtc: '2026-11-21T08:00:00.000Z',
    }));
    assert.equal(t1.state, 'completed');
    assert.equal(t1.value.replayed, false);
    const createdTodoId = t1.value.receipt.item.id;

    // Close Runtime SQLite & reopen -> same idempotencyKey replays without creating a duplicate todo
    app.close();
    app = createRuntimeApplication({
      path: dbPath,
      profile: 'huawei_ict_agentarts',
      hostUserNamespace: 'bwh-user',
      tools: [],
      riskAutonomy: false,
    });
    todoHost.bindApplication(app);
    todoHost.competitionToolAvailability.find(a => a.toolName === 'todo.create').available({
      taskId,
      signal: new AbortController().signal,
    });
    const tReplay = await todoPort.read(makeCtx({
      title: 'Prepare F06 release',
      idempotencyKey: 'f06-cas-key-1',
      remindUtc: '2026-11-21T08:00:00.000Z',
    }));
    assert.equal(tReplay.state, 'completed');
    assert.equal(tReplay.value.replayed, true);
    assert.equal(tReplay.value.receipt.item.id, createdTodoId);

    const reminderPort = hosts.findPort('reminder.current_clock_and_revision');
    const remRead = await reminderPort.read(makeCtx({reminderId: createdTodoId, expectedRevision: 1}));
    assert.equal(remRead.state, 'completed');
    assert.equal(remRead.value.revisionMatch, true);
    assert.equal(remRead.value.state, 'active');

    // 3. Configure CalDAV & enable session -> F07_N05 write, F07_N04 freshness, F11_N05 update+invalidate
    calendarConfig.configure({
      providerKind: 'caldav',
      calendarUrl: caldav.baseUrl,
      calendarName: 'Work',
      username: 'alice',
      password: 'app-password',
    });
    calendarConfig.enableSession({readConsent: true});
    const calCreated = await calWritePort.read(makeCtx({
      accountRef: 'desktop-calendar',
      externalId: 'cal-s531-1',
      summary: 'Architecture Sync',
      startUtc: '2026-11-22T09:00:00.000Z',
      endUtc: '2026-11-22T10:00:00.000Z',
    }));
    assert.equal(calCreated.state, 'completed');
    assert.equal(calCreated.value.externalId, 'cal-s531-1');

    const freshPort = hosts.findPort('calendar.freshness_check');
    const freshCheck = await freshPort.read(makeCtx({
      accountRef: 'desktop-calendar',
      externalId: 'cal-s531-1',
      expectedSequence: 0,
      window: {fromUtc: '2026-11-22T00:00:00.000Z', toUtc: '2026-11-23T00:00:00.000Z'},
    }));
    assert.equal(freshCheck.state, 'completed');
    assert.equal(freshCheck.value.fresh, true);
    assert.equal(freshCheck.value.currentSequence, 0);

    const updateInvalidatePort = hosts.findPort('calendar.update_and_invalidate_reminder');
    const f11Res = await updateInvalidatePort.read(makeCtx({
      accountRef: 'desktop-calendar',
      externalId: 'cal-s531-1',
      summary: 'Architecture Sync (Rescheduled)',
      startUtc: '2026-11-22T11:00:00.000Z',
      endUtc: '2026-11-22T12:00:00.000Z',
      previousSequence: 0,
      reminderId: createdTodoId,
    }));
    assert.equal(f11Res.state, 'completed', JSON.stringify(f11Res));
    assert.equal(f11Res.value.invalidationReceipt.state, 'invalidated');
    assert.equal(f11Res.value.invalidationReceipt.reminderId, createdTodoId);
    const remAfter = await reminderPort.read(makeCtx({reminderId: createdTodoId}));
    assert.equal(remAfter.state, 'completed');
    assert.equal(remAfter.value.state, 'cancelled');

    // 4. Configure Mail & enable proactive session -> F08_N03 archive & F08_N07 send/unknown
    await mailConfig.configure({user: 'me@qq.com', authCode: 'fakeAuthCode1234'});
    mailConfig.markBound(mailConfig.current().revision);
    mailConfig.enableProactiveSession({readConsent: true});
    const mailArchivePort = hosts.findPort('mail.registered_archive');
    const archived = await mailArchivePort.read(makeCtx({
      accountRef: 'desktop-qq-inbox',
      messageId: '<pr8@github.local>',
      targetFolder: 'Archive',
    }));
    assert.equal(archived.state, 'completed');
    assert.equal(archived.value.confirmed, true);

    const sent = await mailSendPort.read(makeCtx({
      accountRef: 'desktop-qq-inbox',
      to: 'lead@example.com',
      subject: 'Daily Digest',
      text: 'All checks green.',
      idempotencyKey: 'f08-send-1',
    }));
    assert.equal(sent.state, 'completed');
    assert.equal(sent.value.state, 'confirmed');
    assert.ok(sent.value.externalId);

    // Timeout / unknown delivery returns state:'unknown' with reconciliationRequired:true
    const sentUnknown = await mailSendPort.read(makeCtx({
      accountRef: 'desktop-qq-inbox',
      to: 'lead@example.com',
      subject: 'Timeout Check',
      text: 'Body',
      idempotencyKey: 'f08-send-timeout-1',
      timeoutMs: 0,
    }));
    assert.equal(sentUnknown.state, 'unknown');
    assert.equal(sentUnknown.value.reconciliationRequired, true);
    assert.equal(sentUnknown.value.idempotencyKey, 'f08-send-timeout-1');
  } finally {
    await todoHost.close();
    app.close();
    await caldav.close();
    try { rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 50}); } catch { /* noop */ }
  }
});

test('S531-P2 wires F12 quiet hours, real OS show/click receipts, and notification withdrawal ledger', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pa-s531-p2-'));
  const dbPath = path.join(root, 'runtime.sqlite');
  const storageDir = path.join(root, 'notif-store');
  mkdirSync(storageDir, {recursive: true});

  const handles = new Map();
  let autoShow = false;
  const notifier = {
    async isSupported() { return true; },
    async show(input, callbacks) {
      handles.set(input.id, {input, callbacks, closed: false});
      if (autoShow) callbacks.onShow();
      return {close: () => { handles.get(input.id).closed = true; }};
    },
  };

  let notifAppHost;
  const channel = createDesktopNotificationPort({
    storageDir,
    notifier,
    onOutcome: outcome => notifAppHost?.receipt(outcome),
  });
  notifAppHost = createDesktopNotificationApplicationHost({namespace: 'f12-user', channel});
  const app = createRuntimeApplication({
    path: dbPath,
    profile: 'huawei_ict_agentarts',
    hostUserNamespace: 'f12-user',
    tools: [...notifAppHost.tools],
    riskAutonomy: false,
  });
  const client = new Client(app);
  await client.connect();
  notifAppHost.bindApplication(app, client);
  const configured = await notifAppHost.configureSettings({
    operationId: 'f12-init-policy',
    expectedRevision: 0,
    scope: {kind: 'global'},
    patch: {
      mode: 'normal',
      maxInterruptions: null,
      windowMinutes: 15,
      silentUntilUtc: null,
      preferredChannel: 'banner',
      allowUrgentBreakthrough: false,
      digestMode: 'on_return',
      quietHours: null,
    },
  });
  assert.equal(configured.state, 'confirmed');

  const hosts = createDesktopBusinessWorkflowHosts({
    getApplication: () => app,
    getNotificationHost: () => notifAppHost,
  });
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const makeCtx = input => ({
    input,
    taskId: 'f12-task-1',
    signal: new AbortController().signal,
    deadline,
    requestId: 'req-f12-1',
    mode: 'main',
    predecessorStates: {},
    predecessorOutputs: {},
  });

  try {
    // 1. F12_N02 reads effective policy cleanly
    const policyPort = hosts.findPort('policy.quiet_hours');
    const policyRes = await policyPort.read(makeCtx({scope: {kind: 'global'}}));
    assert.equal(policyRes.state, 'completed');
    assert.equal(policyRes.value.source, 'notification_policy_readback');

    // 2. F12_N04 ingest -> drain -> deliver without OS show stays unknown (never fakes delivered)
    const nowIso = new Date().toISOString();
    notifAppHost.ingest([
      {
        source: 'mail', accountRef: 'desktop-qq-inbox', externalId: 'pending-1',
        occurredAt: nowIso, fetchedAt: nowIso, contentRef: 'Urgent build alert',
        sensitivity: 'private', dedupeKey: 'f12-pending-1',
      },
    ], {scope: {kind: 'global'}});
    const drained1 = notifAppHost.drain();
    const batchId1 = drained1.batches[0].id;
    const deliverPort = hosts.findPort('notification.deliver');
    const pendingRes = await deliverPort.read(makeCtx({
      batchId: batchId1,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      title: 'Pending Alert',
      body: 'Waiting for OS show receipt',
    }));
    assert.equal(pendingRes.state, 'unknown');
    assert.equal(pendingRes.value.reconciliationRequired, true);

    // 3. F12_N05 withdraw closes OS handle & prevents resend
    const whenDuePort = hosts.findPort('notification.deliver_when_due');
    const pendingEntry = channel.list().find(r => r.title === 'Pending Alert');
    assert.ok(pendingEntry);
    const withdrawnRes = await whenDuePort.read(makeCtx({
      action: 'withdraw',
      id: pendingEntry.id,
      reason: 'superseded_by_update',
    }));
    assert.equal(withdrawnRes.state, 'completed');
    assert.equal(withdrawnRes.value.withdrawn, true);
    assert.equal(handles.get(pendingEntry.id).closed, true);
    assert.equal(channel.readDeliveryOutcome(pendingEntry.id).deliveryState, 'withdrawn');

    // 4. Real OS show -> completed; click -> acknowledged & cannot be withdrawn afterward
    notifAppHost.ingest([
      {
        source: 'mail', accountRef: 'desktop-qq-inbox', externalId: 'live-2',
        occurredAt: nowIso, fetchedAt: nowIso, contentRef: 'Release notification',
        sensitivity: 'private', dedupeKey: 'f12-live-2',
      },
    ], {scope: {kind: 'global'}});
    const drained2 = notifAppHost.drain();
    const batchId2 = drained2.batches.at(-1).id;
    autoShow = true;
    const deliveredRes = await deliverPort.read(makeCtx({
      batchId: batchId2,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      title: 'Confirmed Alert',
      body: 'Delivered via OS show',
    }));
    assert.equal(deliveredRes.state, 'completed');
    assert.equal(deliveredRes.value.deliveryState, 'delivered');
    const liveEntry = channel.list().find(r => r.title === 'Confirmed Alert');
    handles.get(liveEntry.id).callbacks.onClick();
    assert.equal(channel.readDeliveryOutcome(liveEntry.id).userRead, true);

    const withdrawAfterAck = await whenDuePort.read(makeCtx({
      action: 'withdraw',
      id: liveEntry.id,
    }));
    assert.equal(withdrawAfterAck.state, 'failed');
    assert.equal(withdrawAfterAck.value.reason, 'already_acknowledged');

    // 5. Digest action returns valid digestRef
    const digestRes = await whenDuePort.read(makeCtx({action: 'digest', scope: {kind: 'global'}}));
    assert.equal(digestRes.state, 'completed');
    assert.ok(digestRes.value.digestRef);
  } finally {
    notifAppHost.dispose();
    await client.close?.();
    app.close();
    try { rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 50}); } catch { /* noop */ }
  }
});

test('P-06 wires F16/F19 CI failure log binding, test intent guard, issue repair queue and verified issue close', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pa-p06-'));
  const dbPath = path.join(root, 'runtime.sqlite');
  let prMerged = false;
  let issueState = 'open';
  const runner = {
    async run({args}) {
      const joined = args.join(' ');
      if (joined.includes('repos/octo/app/actions/runs?')) {
        return {
          exitCode: 0, stderr: '',
          stdout: JSON.stringify({
            workflow_runs: [{
              id: 701, name: 'CI', status: 'completed', conclusion: 'failure',
              head_sha: 'a'.repeat(40), html_url: 'https://github.com/octo/app/actions/runs/701',
              created_at: '2026-11-20T01:00:00Z',
            }],
          }),
        };
      }
      if (joined.includes('repos/octo/app/actions/runs/701/jobs')) {
        return {
          exitCode: 0, stderr: '',
          stdout: JSON.stringify({
            jobs: [{
              id: 801, run_id: 701, name: 'test', status: 'completed',
              conclusion: 'failure', html_url: 'https://github.com/octo/app/actions/runs/701/job/801',
            }],
          }),
        };
      }
      if (joined.includes('repos/octo/app/actions/jobs/801')) {
        return {
          exitCode: 0, stderr: '',
          stdout: JSON.stringify({id: 801, run_id: 701, conclusion: 'failure'}),
        };
      }
      if (args[0] === 'run' && args[1] === 'view') {
        return {exitCode: 0, stderr: '', stdout: 'Error at src/calc.ts:12: expected 4, got 5'};
      }
      if (joined.includes('repos/octo/app/pulls/55')) {
        return {
          exitCode: 0, stderr: '',
          stdout: JSON.stringify({
            number: 55, title: 'Fix calc bug', body: 'Fixes #42', state: prMerged ? 'closed' : 'open',
            base: {ref: 'main', sha: 'b'.repeat(40)}, head: {ref: 'fix/42', sha: 'c'.repeat(40)},
            html_url: 'https://github.com/octo/app/pull/55', draft: false,
            merged: prMerged, merged_at: prMerged ? '2026-11-20T04:00:00Z' : null,
          }),
        };
      }
      if (joined.includes('repos/octo/app/issues/42/comments')) {
        return {exitCode: 0, stderr: '', stdout: JSON.stringify({id: 901, html_url: 'https://github.com/octo/app/issues/42#comment-901'})};
      }
      if (joined.includes('repos/octo/app/issues/42') && args.includes('PATCH')) {
        issueState = 'closed';
        return {exitCode: 0, stderr: '', stdout: JSON.stringify({number: 42, state: 'closed', html_url: 'https://github.com/octo/app/issues/42'})};
      }
      if (joined.includes('repos/octo/app/issues/42')) {
        return {
          exitCode: 0, stderr: '',
          stdout: JSON.stringify({
            number: 42, title: 'calc returns 5 instead of 4', body: 'Repro step', state: issueState,
            labels: [{name: 'bug'}], html_url: 'https://github.com/octo/app/issues/42',
            updated_at: '2026-11-20T02:00:00Z',
          }),
        };
      }
      return {exitCode: 1, stdout: '', stderr: 'HTTP 404 Not Found'};
    },
  };

  const ghProvider = new GhCliProvider({
    runner,
    repositories: ['octo/app'],
    readToken: async () => 'ghs_syntheticTestToken12345',
  });
  const ghService = new GitHubService(ghProvider);
  const app = createRuntimeApplication({
    path: dbPath,
    profile: 'huawei_ict_agentarts',
    hostUserNamespace: 'p06-user',
    tools: [],
    riskAutonomy: false,
  });
  const hosts = createDesktopBusinessWorkflowHosts({
    getApplication: () => app,
    getGithubPort: () => ghService,
  });

  const deadline = new Date(Date.now() + 60_000).toISOString();
  const makeCtx = input => ({
    input,
    taskId: 'p06-task-1',
    signal: new AbortController().signal,
    deadline,
    requestId: 'req-p06-1',
    mode: 'main',
    predecessorStates: {},
    predecessorOutputs: {},
  });

  try {
    // 1. F16_N01 bound CI failure readback + F16_N04 test intent guard
    const ciPort = hosts.findPort('github.bound_ci_failure');
    const ciRes = await ciPort.read(makeCtx({owner: 'octo', repo: 'app', commitSha: 'a'.repeat(40)}));
    assert.equal(ciRes.state, 'completed');
    assert.equal(ciRes.value.runId, 701);
    assert.match(ciRes.value.logExcerpt, /src\/calc\.ts:12/);

    const intentPort = hosts.findPort('workspace.test_intent_check');
    const badPatch = await intentPort.read(makeCtx({
      patch: 'diff --git a/test/calc.test.mjs b/test/calc.test.mjs\n+test.skip("broken", () => {});',
    }));
    assert.equal(badPatch.state, 'failed');
    const goodPatch = await intentPort.read(makeCtx({
      patch: 'diff --git a/src/calc.ts b/src/calc.ts\n- return 5;\n+ return 4;',
    }));
    assert.equal(goodPatch.state, 'completed');

    // 2. F19_N01 issue snapshot + F19_N03 idempotent repair enqueue
    const issuePort = hosts.findPort('github.issue_snapshot');
    const issueRes = await issuePort.read(makeCtx({owner: 'octo', repo: 'app', number: 42}));
    assert.equal(issueRes.state, 'completed');
    assert.equal(issueRes.value.state, 'open');

    const enqueuePort = hosts.findPort('runtime.enqueue_issue_repair');
    const enqueued1 = await enqueuePort.read(makeCtx({owner: 'octo', repo: 'app', number: 42, linkedPrNumber: 55}));
    const enqueued2 = await enqueuePort.read(makeCtx({owner: 'octo', repo: 'app', number: 42, linkedPrNumber: 55}));
    assert.equal(enqueued1.state, 'completed');
    assert.equal(enqueued1.value.fixSubtaskSpawned, true);
    assert.equal(enqueued1.value.taskId, enqueued2.value.taskId);

    // 3. F19_N04 unmerged -> reports merged:false; F19_N05 refuses close when unmerged or unverified
    const mergedReadbackPort = hosts.findPort('github.merged_repair_readback');
    const unmerged = await mergedReadbackPort.read(makeCtx({owner: 'octo', repo: 'app', number: 42, repairPr: 55}));
    assert.equal(unmerged.state, 'completed');
    assert.equal(unmerged.value.merged, false);

    const closePort = hosts.findPort('github.registered_close_issue');
    const refusedUnmerged = await closePort.read(makeCtx({
      owner: 'octo', repo: 'app', number: 42, repairPr: 55, verifiedPassed: true,
    }));
    assert.equal(refusedUnmerged.state, 'failed');
    assert.equal(refusedUnmerged.value.reason, 'repair_pr_not_merged');

    // Merge PR 55 -> verify F19_N04 reads merged:true, stale updatedAt conflicts, matching closes cleanly
    prMerged = true;
    const merged = await mergedReadbackPort.read(makeCtx({owner: 'octo', repo: 'app', number: 42, repairPr: 55}));
    assert.equal(merged.value.merged, true);

    const conflictClose = await closePort.read(makeCtx({
      owner: 'octo', repo: 'app', number: 42, repairPr: 55, verifiedPassed: true,
      expectedUpdatedAt: '2026-11-20T00:00:00Z',
    }));
    assert.equal(conflictClose.state, 'failed');
    assert.equal(conflictClose.value.reason, 'issue_revision_conflict');

    const closed = await closePort.read(makeCtx({
      owner: 'octo', repo: 'app', number: 42, repairPr: 55, verifiedPassed: true,
      expectedUpdatedAt: '2026-11-20T02:00:00Z',
      comment: 'Verified fix in PR #55',
    }));
    assert.equal(closed.state, 'completed');
    assert.equal(closed.value.closedSuccess, true);
    assert.equal(issueState, 'closed');
  } finally {
    ghService.dispose();
    app.close();
    try { rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 50}); } catch { /* noop */ }
  }
});
