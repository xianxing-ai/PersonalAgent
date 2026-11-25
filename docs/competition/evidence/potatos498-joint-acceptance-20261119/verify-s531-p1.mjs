import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const WORKTREE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RECEIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 's531-p1-receipt.json');

const importFromWorktree = rel => import(pathToFileURL(path.join(WORKTREE, rel)).href);

const {Client} = await importFromWorktree('packages/client/dist/index.js');
const {FakeMailProvider} = await importFromWorktree('packages/connectors/mail/dist/index.js');
const {createRuntimeApplication} = await importFromWorktree('apps/runtime/dist/application.js');
const {createCalendarConfig} = await importFromWorktree('apps/desktop/electron/calendar-config.js');
const {createMailConfig} = await importFromWorktree('apps/desktop/electron/mail-config.js');
const {createDesktopTodoHost} = await importFromWorktree('apps/desktop/electron/todo-host.js');
const {createDesktopBusinessWorkflowHosts} = await importFromWorktree('apps/desktop/electron/business-workflow-hosts.js');

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value, 'utf8'),
  decryptString: buf => Buffer.from(buf).toString('utf8'),
};

const resources = new Map();
let etagCounter = 1;
const caldavServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8');
  const urlPath = (req.url || '/').split('?')[0];
  if (req.method === 'OPTIONS' || req.method === 'PROPFIND') {
    const itemsXml = [...resources.entries()].map(([href, entry]) =>
      `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>${entry.etag}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
    ).join('');
    res.writeHead(207, {'Content-Type': 'application/xml; charset=utf-8', 'DAV': '1, calendar-access'});
    res.end(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/cal/</d:href><d:propstat><d:prop><d:displayname>Work</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>${itemsXml}</d:multistatus>`);
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
    if (req.headers['if-none-match'] === '*' && existing) { res.writeHead(412); res.end(); return; }
    if (req.headers['if-match'] && existing && req.headers['if-match'] !== existing.etag) { res.writeHead(412); res.end(); return; }
    const etag = `"r-${++etagCounter}"`;
    resources.set(urlPath, {ics: body, etag});
    res.writeHead(existing ? 204 : 201, {'ETag': etag});
    res.end();
    return;
  }
  res.writeHead(405);
  res.end();
});

await new Promise(resolve => caldavServer.listen(0, '127.0.0.1', resolve));
const {port} = caldavServer.address();
const caldavUrl = `http://127.0.0.1:${port}/cal/`;

const root = mkdtempSync(path.join(os.tmpdir(), 'pa-s531p1-'));
const dbPath = path.join(root, 'runtime.sqlite');
const userData = path.join(root, 'userData');
mkdirSync(userData, {recursive: true});

let app;
const todoHost = createDesktopTodoHost({
  userData,
  safeStorage,
  namespace: 's531-user',
  createDeliveryHost: () => ({async tick() {}, async close() {}}),
});
const calendarConfig = createCalendarConfig({userData, safeStorage});
const mailConfig = createMailConfig({userData, safeStorage});
const mailProvider = new FakeMailProvider();
const hosts = createDesktopBusinessWorkflowHosts({
  getApplication: () => app,
  getTodoHost: () => todoHost,
  getCalendarConfig: () => calendarConfig,
  getMailConfig: () => mailConfig,
  createMailProvider: () => mailProvider,
});

async function runHostAdapter(toolName, args, deadline) {
  const cmdId = `cmd-${toolName}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const prep = app.prepareHostToolTask({
    commandId: cmdId,
    toolName,
    toolVersion: '1.0.0',
    deadline,
  });
  if (toolName === 'workflow.host.f06_n03') {
    todoHost.competitionToolAvailability.find(a => a.toolName === 'todo.create').available({
      taskId: prep.taskId,
      signal: new AbortController().signal,
    });
  }
  app.finalizeHostToolTask({
    commandId: cmdId,
    taskId: prep.taskId,
    expectedTaskRevision: prep.revision,
    arguments: args,
  });
  const client = new Client(app);
  await client.connect();
  try {
    for (let i = 0; i < 40; i++) {
      const status = app.readHostToolTask(prep.taskId);
      if (status.approval?.state === 'pending' || ['succeeded', 'failed', 'cancelled'].includes(status.task.state)) break;
      await new Promise(r => setTimeout(r, 25));
    }
    const status = app.readHostToolTask(prep.taskId);
    if (status.approval?.state === 'pending') {
      await client.call('authorization.respond', {
        approvalId: status.approval.approvalId,
        expectedRevision: status.approval.revision,
        decision: 'allow_once',
      });
    }
    await app.waitForHostToolTask(prep.taskId);
    return app.readHostToolTask(prep.taskId);
  } finally {
    await client.close?.();
  }
}

const receipt = {
  package: 'S531-P1',
  workflows: ['F06', 'F07', 'F08', 'F11'],
  verifiedAt: new Date().toISOString(),
  caldavUrl,
  checks: {},
};

try {
  app = createRuntimeApplication({
    path: dbPath,
    profile: 'huawei_ict_agentarts',
    hostUserNamespace: 's531-user',
    tools: [...hosts.workflowHostTools],
    riskAutonomy: false,
  });
  todoHost.bindApplication(app);
  todoHost.authorize({readAndCloudConsent: true});
  calendarConfig.configure({
    providerKind: 'caldav',
    calendarUrl: caldavUrl,
    calendarName: 'Work',
    username: 's531',
    password: 'loopback-app-password',
  });
  calendarConfig.enableSession({readConsent: true});
  await mailConfig.configure({user: 's531@qq.com', authCode: 'fakeAuthCode5311'});
  mailConfig.markBound(mailConfig.current().revision);
  mailConfig.enableProactiveSession({readConsent: true});

  const deadline = new Date(Date.now() + 60_000).toISOString();

  // F06_N03 through RuntimeApplication + SQLite CAS
  const f06Create = await runHostAdapter('workflow.host.f06_n03', {
    title: 'S531 P1 Joint Check',
    idempotencyKey: 's531-p1-todo-1',
    remindUtc: '2026-11-23T09:00:00.000Z',
  }, deadline);
  assert.equal(f06Create.task.state, 'succeeded', JSON.stringify(f06Create.task.error));
  const todoId = f06Create.confirmed.result.receipt.item.id;
  assert.equal(f06Create.confirmed.result.replayed, false);

  // Reopen SQLite runtime -> replay same idempotencyKey returns replayed:true
  app.close();
  app = createRuntimeApplication({
    path: dbPath,
    profile: 'huawei_ict_agentarts',
    hostUserNamespace: 's531-user',
    tools: [...hosts.workflowHostTools],
    riskAutonomy: false,
  });
  todoHost.bindApplication(app);
  const f06Replay = await runHostAdapter('workflow.host.f06_n03', {
    title: 'S531 P1 Joint Check',
    idempotencyKey: 's531-p1-todo-1',
    remindUtc: '2026-11-23T09:00:00.000Z',
  }, deadline);
  assert.equal(f06Replay.task.state, 'succeeded');
  assert.equal(f06Replay.confirmed.result.replayed, true);
  assert.equal(f06Replay.confirmed.result.receipt.item.id, todoId);

  // F06_N04 reminder clock + revision
  const f06Clock = await runHostAdapter('workflow.host.f06_n04', {
    reminderId: todoId,
    expectedRevision: 1,
  }, deadline);
  assert.equal(f06Clock.task.state, 'succeeded');
  assert.equal(f06Clock.confirmed.result.state, 'active');
  assert.equal(f06Clock.confirmed.result.revisionMatch, true);

  // F07_N05 calendar.registered_write -> loopback CalDAV
  const f07Write = await runHostAdapter('workflow.host.f07_n05', {
    accountRef: 'desktop-calendar',
    externalId: 's531-cal-1',
    summary: 'S531 Design Review',
    startUtc: '2026-11-24T09:00:00.000Z',
    endUtc: '2026-11-24T10:00:00.000Z',
  }, deadline);
  assert.equal(f07Write.task.state, 'succeeded', JSON.stringify(f07Write.task.error));
  assert.equal(f07Write.confirmed.result.externalId, 's531-cal-1');

  // F07_N04 calendar.freshness_check
  const f07Fresh = await runHostAdapter('workflow.host.f07_n04', {
    accountRef: 'desktop-calendar',
    externalId: 's531-cal-1',
    expectedSequence: 0,
    window: {fromUtc: '2026-11-24T00:00:00.000Z', toUtc: '2026-11-25T00:00:00.000Z'},
  }, deadline);
  assert.equal(f07Fresh.task.state, 'succeeded');
  assert.equal(f07Fresh.confirmed.result.fresh, true);
  assert.equal(f07Fresh.confirmed.result.currentSequence, 0);

  // F11_N05 calendar.update_and_invalidate_reminder
  const f11Res = await runHostAdapter('workflow.host.f11_n05', {
    accountRef: 'desktop-calendar',
    externalId: 's531-cal-1',
    summary: 'S531 Design Review (Moved)',
    startUtc: '2026-11-24T14:00:00.000Z',
    endUtc: '2026-11-24T15:00:00.000Z',
    previousSequence: 0,
    reminderId: todoId,
  }, deadline);
  assert.equal(f11Res.task.state, 'succeeded', JSON.stringify(f11Res.task.error));
  assert.equal(f11Res.confirmed.result.invalidationReceipt.state, 'invalidated');

  // F08_N03 mail.registered_archive
  const f08Archive = await runHostAdapter('workflow.host.f08_n03', {
    accountRef: 'desktop-qq-inbox',
    messageId: '<lead-8@example.com>',
    targetFolder: 'Archive',
  }, deadline);
  assert.equal(f08Archive.task.state, 'succeeded', JSON.stringify(f08Archive.task.error));
  assert.equal(f08Archive.confirmed.result.confirmed, true);

  // F08_N07 mail.registered_send + timeout unknown check
  const f08Send = await runHostAdapter('workflow.host.f08_n07', {
    accountRef: 'desktop-qq-inbox',
    to: 'lead@example.com',
    subject: 'S531-P1 Ready',
    text: 'Verification complete.',
    idempotencyKey: 's531-p1-send-1',
  }, deadline);
  assert.equal(f08Send.task.state, 'succeeded', JSON.stringify(f08Send.task.error));
  assert.equal(f08Send.confirmed.result.state, 'confirmed');
  assert.ok(f08Send.confirmed.result.externalId);

  const f08Unknown = await hosts.findPort('mail.registered_send').read({
    input: {
      accountRef: 'desktop-qq-inbox',
      to: 'lead@example.com',
      subject: 'Timeout Probe',
      text: 'Test',
      idempotencyKey: 's531-p1-send-timeout',
      timeoutMs: 0,
    },
    taskId: 's531-timeout-probe',
    signal: new AbortController().signal,
    deadline,
    requestId: 'req-unknown',
    mode: 'main',
    predecessorStates: {},
    predecessorOutputs: {},
  });
  assert.equal(f08Unknown.state, 'unknown');
  assert.equal(f08Unknown.value.reconciliationRequired, true);

  receipt.checks = {
    f06TodoRegisteredWrite: {taskId: f06Create.task.taskId, todoId, sqliteRestartReplayed: f06Replay.confirmed.result.replayed},
    f06ReminderClockRevision: {taskId: f06Clock.task.taskId, state: f06Clock.confirmed.result.state, revisionMatch: true},
    f07CalendarWriteAndFreshness: {writeTaskId: f07Write.task.taskId, freshTaskId: f07Fresh.task.taskId, externalId: 's531-cal-1', sequenceBefore: 0},
    f11UpdateAndInvalidateReminder: {taskId: f11Res.task.taskId, invalidatedReminderId: todoId, state: f11Res.confirmed.result.invalidationReceipt.state},
    f08MailArchiveAndSend: {archiveTaskId: f08Archive.task.taskId, sendTaskId: f08Send.task.taskId, sendExternalId: f08Send.confirmed.result.externalId, unknownTimeoutPreserved: true},
  };
} finally {
  await todoHost.close();
  app?.close();
  await new Promise(resolve => caldavServer.close(resolve));
  try { rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 50}); } catch { /* noop */ }
}

writeFileSync(RECEIPT_PATH, JSON.stringify(receipt, null, 2), 'utf8');
console.log(JSON.stringify(receipt, null, 2));
