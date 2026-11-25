import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {TaskRuntime} from '@personal-agent/runtime';
import {createCalendarConfig} from '../electron/calendar-config.js';
import {createMailConfig} from '../electron/mail-config.js';
import {createDesktopBusinessSourceAdapters} from '../electron/business-source-adapters.js';
import {createProactiveSourceHost} from '../electron/proactive-source-host.js';

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

test('business source adapters enforce task/policy/session binding and drive proactive calendar/mail triggers', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pa-p03-adapters-'));
  const runtime = new TaskRuntime(':memory:');
  t.after(() => {
    runtime.close();
    try { rmSync(dir, {recursive: true, force: true}); } catch {}
  });

  const question = stubQuestion();
  const calendarConfig = createCalendarConfig({userData: dir, safeStorage, question});
  calendarConfig.configure({
    providerKind: 'caldav',
    calendarUrl: 'https://caldav.example.test/calendars/alice/work/',
    calendarName: 'Work',
    username: 'alice',
    password: 'CalSecretPassword!',
  });

  const mailConfig = createMailConfig({userData: dir, safeStorage, namespace: 'p03-test', question});
  await mailConfig.configure({user: 'alice@qq.com', authCode: 'MailSecretCode1234'});
  mailConfig.markBound(mailConfig.current().revision);

  let nowMs = Date.now(); // real clock: Runtime checks approval expiry against wall time
  // Pick a timestamp whose local hour is midday regardless of host TZ: evaluate getHours.
  while (new Date(nowMs).getHours() >= 22 || new Date(nowMs).getHours() < 7) nowMs += 3_600_000;

  let events = [
    {
      uid: 'evt-p03',
      calendarId: 'Work',
      title: 'SECRET_MEETING_TITLE',
      startUtc: new Date(nowMs + 2 * 3_600_000).toISOString(),
      endUtc: new Date(nowMs + 3 * 3_600_000).toISOString(),
      sequence: 1,
    },
  ];
  let messages = [
    {
      uid: 101,
      messageId: '<m-101@qq.com>',
      subject: 'SECRET_MAIL_SUBJECT',
      from: 'boss@example.com',
      date: new Date(nowMs - 60_000).toISOString(),
      seen: false,
    },
  ];

  const adapters = createDesktopBusinessSourceAdapters({
    getApplication: () => ({runtime}),
    getCalendarConfig: () => calendarConfig,
    getMailConfig: () => mailConfig,
    createCalendarProvider: () => ({
      source: 'caldav',
      verification: 'conditional',
      async fetchWindow() {
        return {
          events: events.map(e => ({
            externalId: e.uid,
            calendarId: e.calendarId,
            title: e.title,
            startUtc: e.startUtc,
            endUtc: e.endUtc,
            status: 'confirmed',
            sequence: e.sequence,
          })),
          hasMore: false,
        };
      },
      async fetchEvent(_accountRef, externalId) {
        const found = events.find(e => e.uid === externalId);
        return found ? {
          externalId: found.uid, calendarId: found.calendarId, title: found.title,
          startUtc: found.startUtc, endUtc: found.endUtc, status: 'confirmed', sequence: found.sequence,
        } : undefined;
      },
      respond() { throw new Error('read-only'); },
    }),
    createMailProvider: () => ({
      source: 'qq-mail',
      verification: 'conditional',
      async fetchPage() {
        return {
          messages: messages.map(m => ({
            uid: m.uid,
            uidValidity: 1,
            messageId: m.messageId,
            folder: 'INBOX',
            subject: m.subject,
            from: m.from,
            to: 'alice@qq.com',
            sentAt: m.date,
            seen: m.seen,
          })),
          hasMore: false,
          nextCursor: {uidValidity: 1, lastUid: messages.at(-1)?.uid ?? 0},
          uidValidity: 1,
        };
      },
      async dispose() {},
    }),
    now: () => nowMs,
  });

  // 1. Reusing conversationId as taskId/runId/authorizationRef must be rejected.
  await assert.rejects(
    adapters.readCalendarEvents({}, {
      taskId: 'conv-1', runId: 'conv-1', authorizationRef: 'conv-1', conversationId: 'conv-1',
      scopes: ['calendar:read'], signal: new AbortController().signal, deadline: new Date(nowMs + 60_000).toISOString(),
    }),
    {code: 'UNAUTHORIZED'},
  );

  // 2. Without session consent, reading calendar or mail fails closed.
  assert.deepEqual(adapters.list().map(item => [item.kind, item.available]), [
    ['calendar', false], ['mail', false], ['feeds', false],
  ]);

  const submitted = [];
  const host = createProactiveSourceHost({
    getApplication: () => ({runtime}),
    getTools: () => [],
    sourceAdapters: adapters,
    submitTask: async input => {
      submitted.push(input);
      return {taskId: `submitted-${submitted.length}`, state: 'created'};
    },
    namespace: 'desktop',
    now: () => nowMs,
  });

  // Authorize session reads
  calendarConfig.enableSession({readConsent: true});
  mailConfig.enableProactiveSession({readConsent: true});
  assert.deepEqual(adapters.list().map(item => [item.kind, item.available]), [
    ['calendar', true], ['mail', true], ['feeds', false],
  ]);

  // First tick establishes baseline without submitting tasks
  host.update({enabled: true, calendar: true, mail: true, quiet: false});
  await host.tick();
  assert.equal(submitted.length, 0);

  // Verify formal task binding was used for the reads (not conversationId)
  const readTasks = runtime.listTasks({conversationId: 'proactive-source:desktop:read', limit: 20}).items;
  assert.equal(readTasks.length, 2);
  assert.ok(readTasks.every(task => task.state === 'succeeded'));

  // 3. New mail arrival triggers low-risk summary task without leaking subject/secrets
  messages = [
    ...messages,
    {uid: 102, messageId: '<m-102@qq.com>', subject: 'CONFIDENTIAL_NEW_EMAIL', from: 'hr@example.com', date: new Date(nowMs + 10_000).toISOString(), seen: false},
  ];
  nowMs += 150_000;
  await host.tick();
  assert.equal(submitted.length, 1);
  assert.match(submitted[0].goal, /摘要新邮件/);
  assert.equal(submitted[0].goal.includes('CONFIDENTIAL_NEW_EMAIL'), false);
  assert.equal(submitted[0].goal.includes('CalSecretPassword'), false);
  assert.equal(submitted[0].goal.includes('MailSecretCode'), false);

  // 4. Rescheduled calendar event asks via approval gate rather than auto-submitting
  events = [{
    ...events[0],
    startUtc: new Date(nowMs + 4 * 3_600_000).toISOString(),
    endUtc: new Date(nowMs + 5 * 3_600_000).toISOString(),
    sequence: 2,
  }];
  nowMs += 150_000;
  await host.tick();
  assert.equal(submitted.length, 1);
  const approvalTasks = runtime.listTasks({conversationId: 'proactive-source:desktop:approval', limit: 10}).items;
  assert.equal(approvalTasks.length, 1);
  assert.equal(approvalTasks[0].state, 'waiting_approval');

  // 5. Turning off cancels pending schedule and stops reading on next tick
  const beforeOff = runtime.listTasks({conversationId: 'proactive-source:desktop:read', limit: 50}).items.length;
  host.update({enabled: false});
  assert.equal(runtime.listSchedules('proactive-source:desktop').filter(item => item.status === 'pending').length, 0);
  nowMs += 150_000;
  await host.tick();
  const afterOff = runtime.listTasks({conversationId: 'proactive-source:desktop:read', limit: 50}).items.length;
  assert.equal(afterOff, beforeOff);
});
