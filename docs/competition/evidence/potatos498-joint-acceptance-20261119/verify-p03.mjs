import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const WORKTREE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RECEIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'p03-receipt.json');

const {TaskRuntime} = await import(pathToFileURL(path.join(WORKTREE, 'apps/runtime/dist/index.js')).href);
const {createCalendarConfig} = await import(pathToFileURL(path.join(WORKTREE, 'apps/desktop/electron/calendar-config.js')).href);
const {createMailConfig} = await import(pathToFileURL(path.join(WORKTREE, 'apps/desktop/electron/mail-config.js')).href);
const {createDesktopBusinessSourceAdapters} = await import(pathToFileURL(path.join(WORKTREE, 'apps/desktop/electron/business-source-adapters.js')).href);
const {createProactiveSourceHost} = await import(pathToFileURL(path.join(WORKTREE, 'apps/desktop/electron/proactive-source-host.js')).href);
const {createDesktopProactiveWorkflowApplication} = await import(pathToFileURL(path.join(WORKTREE, 'apps/desktop/electron/proactive-workflow-host.js')).href);

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: text => Buffer.from(text, 'utf8'),
  decryptString: buf => buf.toString('utf8'),
};

function stubQuestion() {
  const generations = new Map();
  return {
    prepare() {},
    prepareExport() {},
    currentRequirement() { return false; },
    authorizeExport() {},
    readResourceGeneration: resource => generations.get(resource) ?? 0,
    rotateResourceGeneration: (resource, prev) => generations.set(resource, (prev ?? 0) + 1),
  };
}

function icsUtc(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function makeEventXml(calPath, evt) {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PersonalAgent//Loopback//EN',
    'BEGIN:VEVENT',
    `UID:${evt.uid}`,
    `DTSTART:${icsUtc(evt.startMs)}`,
    `DTEND:${icsUtc(evt.endMs)}`,
    `SUMMARY:${evt.summary}`,
    `SEQUENCE:${evt.sequence}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const escaped = ics.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<D:response><D:href>${calPath}${evt.uid}.ics</D:href><D:propstat><D:prop><D:getetag>"etag-${evt.sequence}"</D:getetag><C:calendar-data>${escaped}</C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}

const work = mkdtempSync(path.join(tmpdir(), 'pa-p03-accept-'));
let server;
let runtime;
try {
  let nowMs = Date.now(); // real clock: Runtime checks approval expiry against wall time
  while (new Date(nowMs).getHours() >= 22 || new Date(nowMs).getHours() < 7) nowMs += 3_600_000;

  let calEvents = [
    {uid: 'evt-p03-live-1', summary: 'CONFIDENTIAL_CALIBRATION', startMs: nowMs + 2 * 3_600_000, endMs: nowMs + 3 * 3_600_000, sequence: 1},
  ];
  let caldavHttpCount = 0;

  server = createServer((req, res) => {
    caldavHttpCount++;
    const auth = req.headers.authorization;
    if (auth !== 'Basic ' + Buffer.from('alice:CalSecretPass').toString('base64')) {
      res.writeHead(401).end();
      return;
    }
    const calPath = '/calendars/alice/work/';
    if (req.method === 'PROPFIND') {
      const xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:" xmlns:CS="http://calendarserver.org/ns/"><D:response><D:href>${calPath}</D:href><D:propstat><D:prop><CS:getctag>ctag-${calEvents.map(e => e.sequence).join('-')}</CS:getctag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
      res.writeHead(207, {'content-type': 'application/xml; charset=utf-8'}).end(xml);
      return;
    }
    if (req.method === 'REPORT') {
      const body = calEvents.map(e => makeEventXml(calPath, e)).join('');
      const xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${body}</D:multistatus>`;
      res.writeHead(207, {'content-type': 'application/xml; charset=utf-8'}).end(xml);
      return;
    }
    res.writeHead(405).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const calUrl = `http://127.0.0.1:${server.address().port}/calendars/alice/work/`;

  runtime = new TaskRuntime(path.join(work, 'runtime.sqlite'));
  const question = stubQuestion();
  const calendarConfig = createCalendarConfig({userData: work, safeStorage, question});
  calendarConfig.configure({
    providerKind: 'caldav',
    calendarUrl: calUrl,
    calendarName: 'Work',
    username: 'alice',
    password: 'CalSecretPass',
  });
  const mailConfig = createMailConfig({userData: work, safeStorage, namespace: 'p03-live', question});
  await mailConfig.configure({user: 'alice@qq.com', authCode: 'MailSecretCode1234'});
  mailConfig.markBound(mailConfig.current().revision);

  const adapters = createDesktopBusinessSourceAdapters({
    getApplication: () => ({runtime}),
    getCalendarConfig: () => calendarConfig,
    getMailConfig: () => mailConfig,
    now: () => nowMs,
  });

  // Verify CW-05 workflow host reports zero missing business_source_adapters when wired
  const workflowHost = createDesktopProactiveWorkflowApplication({
    application: {runtime, createProactiveWorkflowHost() { throw Error('unused'); }},
    readConfiguration: () => ({contractRef: 'cw05-contract', adapter: {endpoint: 'http://127.0.0.1:9/invocations', receiptSecret: 's'.repeat(32)}}),
    bindings: [{kind: 'teacher_decision', toolName: 'proactive.teacher_decision', toolVersion: '1.0.0', location: 'local_device', effect: 'read'}],
    sourceAdapters: adapters,
    localDeviceAvailable: () => true,
  });
  const workflowSnap = workflowHost.snapshot();
  assert.deepEqual(workflowSnap.missing, []);

  // Authorize calendar session only (real CalDAV loopback HTTP readback)
  calendarConfig.enableSession({readConsent: true});

  const submitted = [];
  const sourceHost = createProactiveSourceHost({
    getApplication: () => ({runtime}),
    getTools: () => [],
    sourceAdapters: adapters,
    submitTask: async input => {
      submitted.push(input);
      return {taskId: `root-${submitted.length}`, state: 'created'};
    },
    namespace: 'desktop',
    now: () => nowMs,
  });

  // Baseline scan via real loopback CalDAV HTTP
  sourceHost.update({enabled: true, calendar: true, mail: false, quiet: false});
  await sourceHost.tick();
  assert.equal(submitted.length, 0);
  const requestsAfterBaseline = caldavHttpCount;
  assert.ok(requestsAfterBaseline >= 1);

  // Add a second meeting -> low-risk root task created, no secret leaked
  calEvents = [
    ...calEvents,
    {uid: 'evt-p03-live-2', summary: 'NEW_SECRET_SYNC', startMs: nowMs + 4 * 3_600_000, endMs: nowMs + 5 * 3_600_000, sequence: 1},
  ];
  nowMs += 150_000;
  await sourceHost.tick();
  assert.equal(submitted.length, 1);
  assert.match(submitted[0].goal, /新会议/);
  assert.equal(submitted[0].goal.includes('NEW_SECRET_SYNC'), false);
  assert.equal(submitted[0].goal.includes('CalSecretPass'), false);

  // Reschedule meeting 1 -> must request approval (waiting_approval), never auto-submit
  calEvents = [
    {...calEvents[0], startMs: nowMs + 6 * 3_600_000, endMs: nowMs + 7 * 3_600_000, sequence: 2},
    calEvents[1],
  ];
  nowMs += 150_000;
  await sourceHost.tick();
  assert.equal(submitted.length, 1);
  const approvalTasks = runtime.listTasks({conversationId: 'proactive-source:desktop:approval', limit: 10}).items;
  assert.equal(approvalTasks.length, 1);
  assert.equal(approvalTasks[0].state, 'waiting_approval');

  // Approve reschedule -> next tick submits task and cancels approval carrier
  const approvalId = `proactive-approval-${approvalTasks[0].taskId}`;
  const approval = runtime.getApproval(approvalId);
  runtime.respondApproval(approvalId, 'allow_once', approval.revision);
  nowMs += 150_000;
  await sourceHost.tick();
  assert.equal(submitted.length, 2);
  assert.match(submitted[1].goal, /会议时间已变化/);
  assert.equal(runtime.getTask(approvalTasks[0].taskId).state, 'cancelled');

  // Verify formal TaskRuntime read tasks never reused conversationId
  const readTasks = runtime.listTasks({conversationId: 'proactive-source:desktop:read', limit: 20}).items;
  assert.ok(readTasks.length >= 4);
  assert.ok(readTasks.every(task => task.state === 'succeeded' && task.taskId !== 'proactive-source:desktop'));

  // Disable trigger -> pending schedule cancelled & 0 additional CalDAV calls
  sourceHost.update({enabled: false});
  const countBeforeStop = caldavHttpCount;
  assert.equal(runtime.listSchedules('proactive-source:desktop').filter(s => s.status === 'pending').length, 0);
  nowMs += 150_000;
  await sourceHost.tick();
  assert.equal(caldavHttpCount, countBeforeStop);

  const receipt = {
    package: 'P-03',
    verifiedAt: new Date().toISOString(),
    cw05WorkflowSnapshot: workflowSnap,
    adapterCatalog: adapters.list(),
    loopbackCaldavTrigger: {
      caldavHttpRequests: caldavHttpCount,
      formalReadTasksCount: readTasks.length,
      submittedRootTasks: submitted.map(s => s.goal),
      rescheduleApprovalTaskId: approvalTasks[0].taskId,
      rescheduleCarrierStateAfterApproval: runtime.getTask(approvalTasks[0].taskId).state,
      zeroRequestsAfterDisable: caldavHttpCount === countBeforeStop,
      zeroSecretLeak: !JSON.stringify(submitted).includes('CalSecretPass') && !JSON.stringify(submitted).includes('CONFIDENTIAL_CALIBRATION'),
    },
  };
  writeFileSync(RECEIPT_PATH, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  runtime?.close();
  if (server) {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
  }
  try { rmSync(work, {recursive: true, force: true, maxRetries: 5, retryDelay: 50}); } catch {}
}
