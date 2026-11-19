import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {LayaActionChoiceService} from '../dist/laya-action-choice.js';
import {
  TriggerError,
  assertAuthorizedRoot,
  createNodeReadOnlyDirectoryScan,
  createProactiveSourceTrigger,
  createPublicToolReadPort,
  effectiveTriggerRisk,
  isQuietHours,
  normalizeCalendarChanges,
  normalizeFileChanges,
  normalizeMailChanges,
  scanAuthorizedDirectory,
} from '../dist/proactive-source-trigger.js';

const SECRET_TITLE = 'SECRET_TITLE_DO_NOT_COPY';
const SECRET_SUBJECT = 'SECRET_SUBJECT_DO_NOT_COPY';
const SECRET_BYTES = 'SECRET_FILE_BYTES';

function calendarItem({id, sequence, start, end, status = 'confirmed', title = SECRET_TITLE}) {
  return {
    source: 'calendar', accountRef: 'local', externalId: id, occurredAt: start,
    fetchedAt: '2026-11-11T00:00:00.000Z', contentRef: `[${status}] ${title}｜时间｜编号 ${id}`,
    sensitivity: 'normal', dedupeKey: `calendar:cal-work:${id}:${sequence}`, validFor: `${start}/${end}`,
  };
}
function mailItem(id, subject = SECRET_SUBJECT) {
  return {
    source: 'mail', accountRef: 'local', externalId: `INBOX:${id}`, occurredAt: '2026-11-11T01:00:00.000Z',
    fetchedAt: '2026-11-11T01:01:00.000Z', contentRef: `alice → bob｜未读｜${subject}`,
    sensitivity: 'private', dedupeKey: `local:1:INBOX:${id}:<${id}@example>`,
  };
}
function live() {
  return {signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString(),
    scopes: ['calendar:read', 'mail:read']};
}
function chooser(index) {
  const seen = [];
  const service = new LayaActionChoiceService({async infer() {
    const probabilities = {candidate_0: index === 0 ? 0.9 : 0.1, candidate_1: index === 1 ? 0.9 : 0.1};
    return {answers: {action: {choice: `candidate_${index}`, probabilities, answer_confidence: 0.9, confidence: 0.8}}};
  }});
  return {seen, async choose(request) { seen.push(request); return service.choose(request); }};
}
function ports() {
  const submitted = [];
  const approvals = [];
  return {
    submitted, approvals,
    tasks: {async submit(input) { submitted.push(input); return {taskId: `task-${submitted.length}`, state: 'accepted'}; }},
    approvalsPort: {async request(input) { approvals.push(input); return {approvalId: `apr-${approvals.length}`, state: 'pending', revision: 1}; }},
  };
}
function paging(getPages) {
  const calls = [];
  let index = 0;
  return {calls, async read(input, context) {
    calls.push({input, scopes: [...context.scopes]});
    const pages = getPages();
    const page = pages[index] ?? pages.at(-1);
    index += 1;
    if (index >= pages.length) index = 0;
    return page;
  }};
}
function harness(extra = {}) {
  const choice = extra.chooser ?? chooser(0);
  const side = ports();
  let now = extra.now ?? Date.parse('2026-11-11T08:00:00.000Z');
  const trigger = createProactiveSourceTrigger({
    chooser: choice, tasks: side.tasks, approvals: side.approvalsPort,
    ...(extra.calendar ? {calendar: extra.calendar} : {}),
    ...(extra.mail ? {mail: extra.mail} : {}),
    ...(extra.files ? {files: extra.files} : {}),
    ...(extra.quietHours ? {quietHours: extra.quietHours} : {}),
    ...(extra.rateLimit ? {rateLimit: extra.rateLimit} : {}),
    ...(extra.rules ? {rules: extra.rules} : {}),
    now: () => now,
  });
  return {trigger, choice, side, setNow(value) { now = value; }};
}
const leaked = value => JSON.stringify(value).includes(SECRET_TITLE) || JSON.stringify(value).includes(SECRET_SUBJECT)
  || JSON.stringify(value).includes(SECRET_BYTES);

test('日历、邮件和文件变化被规范成固定摘要，不复制私人内容', () => {
  const observedAt = '2026-11-11T08:00:00.000Z';
  const start = '2026-11-11T09:00:00.000Z';
  const end = '2026-11-11T10:00:00.000Z';
  const first = normalizeCalendarChanges({previous: {}, items: [calendarItem({id: 'evt-1', sequence: 1, start, end})],
    baselineReady: false, now: Date.parse(observedAt), leadMs: 30 * 60_000, observedAt});
  assert.deepEqual(first.events, []);
  assert.equal(first.baselineReady, true);
  const created = normalizeCalendarChanges({previous: first.next, items: [
    calendarItem({id: 'evt-1', sequence: 1, start, end}),
    calendarItem({id: 'evt-2', sequence: 1, start, end, status: 'cancelled'}),
    calendarItem({id: 'evt-3', sequence: 1, start, end}),
  ], baselineReady: true, now: Date.parse(observedAt), leadMs: 30 * 60_000, observedAt});
  assert.deepEqual(created.events.map(event => event.kind), ['calendar.created']);
  assert.equal(created.events[0].summary, '新会议');
  assert.equal(created.events[0].subjectRef, 'evt-3');
  assert.equal(JSON.stringify(created.events).includes(SECRET_TITLE), false);

  const movedStart = '2026-11-11T11:00:00.000Z';
  const moved = normalizeCalendarChanges({previous: created.next, items: [
    calendarItem({id: 'evt-1', sequence: 2, start: movedStart, end: '2026-11-11T12:00:00.000Z'}),
    calendarItem({id: 'evt-3', sequence: 2, start, end}),
  ], baselineReady: true, now: Date.parse(observedAt), leadMs: 30 * 60_000, observedAt});
  assert.deepEqual(moved.events.map(event => event.kind), ['calendar.rescheduled']);
  assert.equal(moved.events[0].subjectRef, 'evt-1');

  const soonNow = Date.parse(start) - 10 * 60_000;
  const soon = normalizeCalendarChanges({previous: first.next, items: [calendarItem({id: 'evt-1', sequence: 1, start, end})],
    baselineReady: true, now: soonNow, leadMs: 30 * 60_000, observedAt});
  assert.deepEqual(soon.events.map(event => event.kind), ['calendar.starting_soon']);

  const mailBaseline = normalizeMailChanges({previous: [], items: [mailItem('a'), mailItem('a')], baselineReady: false, observedAt});
  assert.deepEqual(mailBaseline.events, []);
  assert.deepEqual(mailBaseline.next, [mailItem('a').dedupeKey]);
  const arrived = normalizeMailChanges({previous: mailBaseline.next, items: [mailItem('a'), mailItem('b'), mailItem('b')],
    baselineReady: true, observedAt});
  assert.equal(arrived.events.length, 1);
  assert.equal(arrived.events[0].kind, 'mail.arrived');
  assert.equal(arrived.events[0].summary, '新邮件');
  assert.equal(JSON.stringify(arrived.events).includes(SECRET_SUBJECT), false);

  const fileBaseline = normalizeFileChanges({previous: {}, entries: [{relativePath: 'notes.txt', size: 4, mtimeMs: 10}],
    baselineReady: false, observedAt});
  assert.deepEqual(fileBaseline.events, []);
  const changed = normalizeFileChanges({previous: fileBaseline.next, entries: [{relativePath: 'notes.txt', size: 8, mtimeMs: 11}],
    baselineReady: true, observedAt});
  assert.equal(changed.events[0].kind, 'file.changed');
  assert.equal(changed.events[0].subjectRef, 'notes.txt');
  assert.throws(() => normalizeFileChanges({previous: {}, entries: [{relativePath: '../secret', size: 1, mtimeMs: 1}],
    baselineReady: true, observedAt}), error => error instanceof TriggerError && error.code === 'UNAUTHORIZED');
});

test('改期保持高风险，写操作不能被规则降成低风险', () => {
  const readLow = {id: 'note', source: 'calendar', kinds: ['calendar.rescheduled'], risk: 'low', sideEffect: 'read', goal: '只记录'};
  const writeLow = {id: 'send', source: 'mail', kinds: ['mail.arrived'], risk: 'low', sideEffect: 'external_write', goal: '回复邮件'};
  assert.equal(effectiveTriggerRisk('calendar.rescheduled', readLow), 'high');
  assert.equal(effectiveTriggerRisk('mail.arrived', writeLow), 'high');
  assert.equal(effectiveTriggerRisk('calendar.starting_soon', {...readLow, kinds: ['calendar.starting_soon'], sideEffect: 'read'}), 'low');
  assert.equal(isQuietHours(Date.parse('2026-11-11T23:30:00.000Z'), {startMinute: 22 * 60, endMinute: 7 * 60, utcOffsetMinutes: 0}), true);
  assert.equal(isQuietHours(Date.parse('2026-11-11T08:00:00.000Z'), {startMinute: 22 * 60, endMinute: 7 * 60, utcOffsetMinutes: 0}), false);
});

test('会前准备可自动提交，改期只请求审批，暂缓不执行', async () => {
  const start = '2026-11-11T08:20:00.000Z';
  const end = '2026-11-11T09:00:00.000Z';
  let items = [calendarItem({id: 'evt-1', sequence: 1, start, end})];
  const calendar = paging(() => [{items, hasMore: false, nextCursor: ''}]);
  const low = harness({calendar, now: Date.parse('2026-11-11T08:00:00.000Z')});
  const baseline = await low.trigger.tick(live());
  assert.deepEqual(baseline.outcomes.map(item => item.status), ['baseline']);
  assert.equal(low.choice.seen.length, 0);
  assert.equal(low.side.submitted.length, 0);

  const prepared = await low.trigger.tick(live());
  assert.equal(prepared.outcomes.at(-1).status, 'submitted');
  assert.equal(prepared.outcomes.at(-1).ruleId, 'prepare-before-meeting');
  assert.match(low.side.submitted[0].goal, /准备材料/);
  assert.equal(low.side.submitted[0].conversationId, 'proactive-source');
  assert.equal(low.side.approvals.length, 0);
  assert.equal(leaked(low.choice.seen), false);
  assert.equal(leaked(low.side.submitted), false);
  const again = await low.trigger.tick(live());
  assert.equal(again.outcomes.some(item => item.status === 'submitted'), false);
  assert.equal(low.side.submitted.length, 1);

  const moved = [calendarItem({id: 'evt-1', sequence: 1, start, end})];
  const movedReader = paging(() => [{items: moved, hasMore: false, nextCursor: ''}]);
  const high = harness({calendar: movedReader, now: Date.parse('2026-11-11T08:00:00.000Z')});
  await high.trigger.tick(live());
  moved[0] = calendarItem({id: 'evt-1', sequence: 2, start: '2026-11-11T11:00:00.000Z', end: '2026-11-11T12:00:00.000Z'});
  const rescheduled = await high.trigger.tick(live());
  assert.equal(rescheduled.outcomes.at(-1).status, 'waiting_approval');
  assert.equal(rescheduled.outcomes.at(-1).ruleId, 'confirm-reschedule');
  assert.equal(high.side.submitted.length, 0);
  assert.equal(high.side.approvals[0].summary, '会议改期');
  assert.equal(leaked(high.choice.seen), false);
  assert.equal(leaked(high.side.approvals), false);
  const resumeInput = {eventId: rescheduled.outcomes.at(-1).eventId, approvalId: 'apr-1', revision: 1, state: 'allowed',
    argumentsDigest: high.side.approvals[0].argumentsDigest, ...live()};
  const allowed = await high.trigger.resumeApproved(resumeInput);
  assert.equal(allowed.status, 'submitted');
  assert.equal(allowed.taskId, 'task-1');
  const repeated = await high.trigger.resumeApproved(resumeInput);
  assert.equal(repeated.taskId, 'task-1');
  assert.equal(high.side.submitted.length, 1);
  await assert.rejects(high.trigger.resumeApproved({...resumeInput, revision: 2}), error => error.code === 'REVISION_CONFLICT');

  const deniedItems = [calendarItem({id: 'evt-9', sequence: 1, start, end})];
  const denied = harness({calendar: paging(() => [{items: deniedItems, hasMore: false, nextCursor: ''}]),
    now: Date.parse('2026-11-11T08:00:00.000Z')});
  await denied.trigger.tick(live());
  deniedItems[0] = calendarItem({id: 'evt-9', sequence: 2, start: '2026-11-11T15:00:00.000Z', end: '2026-11-11T16:00:00.000Z'});
  const waiting = await denied.trigger.tick(live());
  const deniedResult = await denied.trigger.resumeApproved({eventId: waiting.outcomes.at(-1).eventId, approvalId: 'apr-1',
    revision: 1, state: 'denied', argumentsDigest: denied.side.approvals[0].argumentsDigest, ...live()});
  assert.equal(deniedResult.status, 'denied');
  assert.equal(denied.side.submitted.length, 0);

  const deferItems = [calendarItem({id: 'evt-4', sequence: 1, start, end})];
  const defer = harness({calendar: paging(() => [{items: deferItems, hasMore: false, nextCursor: ''}]), chooser: chooser(1),
    now: Date.parse('2026-11-11T08:00:00.000Z')});
  await defer.trigger.tick(live());
  const skipped = await defer.trigger.tick(live());
  assert.equal(skipped.outcomes.at(-1).status, 'deferred');
  assert.equal(defer.side.submitted.length, 0);
  assert.equal(defer.side.approvals.length, 0);
});

test('恶意判断不能让高风险改期跳过审批', async () => {
  const start = '2026-11-11T08:20:00.000Z';
  const end = '2026-11-11T09:00:00.000Z';
  let items = [calendarItem({id: 'evt-1', sequence: 1, start, end})];
  const calendar = paging(() => [{items, hasMore: false, nextCursor: ''}]);
  const malicious = {async choose() {
    return {state: 'selected', eligibleForRuntime: true, reason: 'selected', selected: {id: 'act-confirm-reschedule', revision: 1},
      calibrated: false, scores: [], receipt: {id: 'x', promptVersion: 'action-choice-v1', contextDigest: 'y', candidates: []}};
  }};
  const run = harness({calendar, chooser: malicious, now: Date.parse('2026-11-11T08:00:00.000Z')});
  await run.trigger.tick(live());
  items = [calendarItem({id: 'evt-1', sequence: 2, start: '2026-11-12T08:20:00.000Z', end: '2026-11-12T09:00:00.000Z'})];
  const result = await run.trigger.tick(live());
  assert.equal(result.outcomes.at(-1).status, 'waiting_approval');
  assert.equal(run.side.submitted.length, 0);
  assert.equal(run.side.approvals.length, 1);
});

test('新邮件去重、静默暂存，并在静默结束后只提交一次', async () => {
  let items = [mailItem('old')];
  const mail = paging(() => [{items, hasMore: false, nextCursor: ''}]);
  const quiet = {startMinute: 22 * 60, endMinute: 7 * 60, utcOffsetMinutes: 0};
  const run = harness({mail, quietHours: quiet, now: Date.parse('2026-11-11T12:00:00.000Z')});
  assert.equal((await run.trigger.tick(live())).outcomes[0].status, 'baseline');
  items = [mailItem('old'), mailItem('new')];
  run.setNow(Date.parse('2026-11-11T23:10:00.000Z'));
  const held = await run.trigger.tick(live());
  assert.equal(held.outcomes.at(-1).status, 'quiet');
  assert.equal(run.choice.seen.length, 0);
  run.setNow(Date.parse('2026-11-12T08:00:00.000Z'));
  const released = await run.trigger.tick(live());
  assert.equal(released.outcomes.filter(item => item.status === 'submitted').length, 1);
  assert.match(run.side.submitted[0].goal, /摘要新邮件/);
  assert.equal(leaked(run.choice.seen), false);
  assert.equal(leaked(run.side.submitted), false);
  const duplicate = await run.trigger.tick(live());
  assert.equal(duplicate.outcomes.some(item => item.status === 'submitted'), false);
  assert.equal(run.side.submitted.length, 1);

  const saved = run.trigger.exportState();
  items = [mailItem('old'), mailItem('new'), mailItem('later')];
  const restored = harness({mail, now: Date.parse('2026-11-12T09:00:00.000Z')});
  restored.trigger.importState(saved);
  const next = await restored.trigger.tick(live());
  assert.deepEqual(next.outcomes.filter(item => item.status === 'submitted').map(item => item.kind), ['mail.arrived']);
  assert.equal(restored.side.submitted.length, 1);
  assert.match(restored.side.submitted[0].goal, /INBOX:later/);
  assert.equal(restored.side.submitted[0].goal.includes('INBOX:new'), false);
});

test('同一来源超出限流的变化留到下一个窗口', async () => {
  const root = path.resolve('/work/notes');
  let entries = [{relativePath: 'a.txt', size: 1, mtimeMs: 1}];
  const scanned = [];
  const run = harness({
    files: {roots: [{root, authorized: true}], scan(dir) { scanned.push(dir); return entries; }},
    rateLimit: {maxPerSource: 1, windowMs: 60_000},
    now: Date.parse('2026-11-11T08:00:00.000Z'),
  });
  assert.equal((await run.trigger.tick(live())).outcomes[0].status, 'baseline');
  entries = [{relativePath: 'a.txt', size: 2, mtimeMs: 2}, {relativePath: 'b.txt', size: 3, mtimeMs: 3}];
  const limited = await run.trigger.tick(live());
  assert.deepEqual(limited.outcomes.map(item => item.status).sort(), ['rate_limited', 'submitted']);
  assert.equal(run.side.submitted.length, 1);
  assert.equal(JSON.stringify(run.side.submitted).includes(root), false);
  run.setNow(Date.parse('2026-11-11T08:02:00.000Z'));
  const later = await run.trigger.tick(live());
  assert.equal(later.outcomes.filter(item => item.status === 'submitted').length, 1);
  assert.equal(run.side.submitted.length, 2);
  assert.deepEqual(scanned, [root, root, root]);
});

test('没有授权的目录被拒绝，扫描不会开始', async () => {
  let calls = 0;
  const scan = () => { calls += 1; return []; };
  const missing = harness({files: {roots: [], scan}, now: Date.parse('2026-11-11T08:00:00.000Z')});
  const empty = await missing.trigger.tick(live());
  assert.equal(empty.outcomes[0].status, 'unauthorized');
  const unmarked = harness({files: {roots: [{root: '/work/notes', authorized: false}], scan},
    now: Date.parse('2026-11-11T08:00:00.000Z')});
  const rejected = await unmarked.trigger.tick(live());
  assert.equal(rejected.outcomes[0].status, 'unauthorized');
  const relative = harness({files: {roots: [{root: 'notes', authorized: true}], scan},
    now: Date.parse('2026-11-11T08:00:00.000Z')});
  const relativeResult = await relative.trigger.tick(live());
  assert.equal(relativeResult.outcomes[0].status, 'unauthorized');
  assert.equal(calls, 0);
  assert.throws(() => assertAuthorizedRoot({root: '/', authorized: true}), error => error.code === 'UNAUTHORIZED');
  await assert.rejects(scanAuthorizedDirectory({
    async readdir() { throw new Error('should not read'); },
    async lstat() { throw new Error('should not stat'); },
    async realpath() { throw new Error('should not resolve'); },
  }, '/'), error => error.code === 'UNAUTHORIZED');
});

test('只读扫描拒绝越出授权根的符号链接，且不读取文件内容', async () => {
  const root = path.resolve('/auth/notes');
  const calls = [];
  const stat = ({dir = false, file = false, link = false, size = 0, mtimeMs = 1} = {}) => ({
    isDirectory: () => dir, isFile: () => file, isSymbolicLink: () => link, size, mtimeMs,
  });
  const fs = {
    async readdir(dir) { calls.push(['readdir', dir]); return dir === root ? ['link'] : []; },
    async lstat(file) {
      calls.push(['lstat', file]);
      if (file === root) return stat({dir: true});
      return stat({link: true});
    },
    async realpath(file) { calls.push(['realpath', file]); return file === root ? root : '/etc/passwd'; },
  };
  await assert.rejects(scanAuthorizedDirectory(fs, root), error => error.code === 'UNAUTHORIZED');
  assert.deepEqual([...new Set(calls.map(call => call[0]))].sort(), ['lstat', 'readdir', 'realpath']);

  const directory = await mkdtemp(path.join(tmpdir(), 'pa-trigger-'));
  const outside = path.join(tmpdir(), `pa-trigger-outside-${Date.now()}`);
  try {
    await writeFile(path.join(directory, 'a.txt'), SECRET_BYTES);
    await writeFile(outside, 'outside');
    const scan = createNodeReadOnlyDirectoryScan();
    const escape = path.join(directory, 'escape');
    try {
      await symlink(outside, escape);
      await assert.rejects(scan(directory), error => error instanceof TriggerError && error.code === 'UNAUTHORIZED');
      await rm(escape);
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    }
    const entries = await scan(directory);
    assert.deepEqual(entries.map(entry => entry.relativePath), ['a.txt']);
    assert.equal(JSON.stringify(entries).includes(SECRET_BYTES), false);
    assert.equal('content' in entries[0], false);
  } finally {
    await rm(directory, {recursive: true, force: true});
    await rm(outside, {force: true});
  }
});

test('日历和邮件只经公开只读工具读取，缺 scope 不会调用', async () => {
  const calls = [];
  const invoke = async (name, input) => {
    calls.push(name);
    assert.equal(name, 'calendar.events');
    assert.equal(typeof input.fromUtc, 'string');
    return {items: [], hasMore: false, nextCursor: ''};
  };
  const calendar = createPublicToolReadPort({invoke, toolName: 'calendar.events', scope: 'calendar:read', source: 'calendar'});
  await assert.rejects(calendar.read({}, {...live(), scopes: []}), error => error.code === 'UNAUTHORIZED');
  assert.equal(calls.length, 0);
  const run = harness({calendar, now: Date.parse('2026-11-11T08:00:00.000Z')});
  await run.trigger.tick({...live(), scopes: []});
  assert.equal(calls.length, 0);
  const opened = await run.trigger.tick(live());
  assert.equal(opened.outcomes[0].status, 'baseline');
  assert.deepEqual(calls, ['calendar.events']);

  const mail = createPublicToolReadPort({
    async invoke(name) {
      assert.equal(name, 'mail.inbox');
      return {items: [mailItem('a'), {source: 'weather'}], hasMore: true, nextCursor: 'p2'};
    },
    toolName: 'mail.inbox', scope: 'mail:read', source: 'mail',
  });
  await assert.rejects(mail.read({limit: 50}, live()), error => error.code === 'INVALID_ARGUMENT');
});
