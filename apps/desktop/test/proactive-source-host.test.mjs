import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createProactiveSourceHost} from '../electron/proactive-source-host.js';
import {mountProactiveTaskControls} from '../src/app/proactive-task-controls.js';

function item(id, start, end, sequence = 1) {
  return {source: 'calendar', accountRef: 'local', externalId: id, occurredAt: start, fetchedAt: '2026-11-11T00:00:00.000Z',
    contentRef: `[confirmed] 标题｜编号 ${id}`, sensitivity: 'normal', dedupeKey: `calendar:cal:${id}:${sequence}`, validFor: `${start}/${end}`};
}
function mail(id) {
  return {source: 'mail', accountRef: 'local', externalId: `INBOX:${id}`, occurredAt: '2026-11-11T01:00:00.000Z',
    fetchedAt: '2026-11-11T01:01:00.000Z', contentRef: `主题 ${id}`, sensitivity: 'private', dedupeKey: `local:1:INBOX:${id}:<${id}>`};
}
function runtime() {
  const tasks = new Map(), approvals = new Map(), schedules = [];
  let n = 0;
  return {
    tasks, approvals, schedules,
    submitTask(input) { const task = {taskId: `gate-${++n}`, state: 'created', goal: input.goal}; tasks.set(task.taskId, task); return task; },
    saveCheckpoint() {},
    transitionTask(taskId, state) { tasks.get(taskId).state = state; return tasks.get(taskId); },
    requestToolApproval(approvalId, taskId, tool, expiresAt, argumentsDigest) {
      if (tasks.get(taskId).state !== 'running') throw new Error('not running');
      const approval = {approvalId, taskId, revision: 1, state: 'pending', argumentsDigest, toolName: tool.name, expiresAt};
      approvals.set(approvalId, approval);
      tasks.get(taskId).state = 'waiting_approval';
      return approval;
    },
    getApproval(id) { const value = approvals.get(id); if (!value) throw new Error('missing'); return value; },
    allow(id) { const approval = approvals.get(id); approval.state = 'allowed'; approval.revision = 2; },
    requestCancel(taskId) { tasks.get(taskId).state = 'cancelled'; },
    listSchedules(conversationId) { return schedules.filter(item => item.conversationId === conversationId && item.status === 'pending'); },
    reconcileSchedules(conversationId) { for (const item of schedules) if (item.conversationId === conversationId && item.status === 'pending') item.status = 'cancelled'; },
    createSchedule(input) { schedules.push({...input, status: 'pending'}); return input; },
    dispatchDueSchedules() { return []; },
  };
}
function host(extra = {}) {
  const calls = [];
  const submitted = [];
  const current = extra.runtime ?? runtime();
  let clock = extra.now ?? Date.parse('2026-11-11T08:00:00.000Z');
  const pages = extra.pages ?? {calendar: [], mail: []};
  const created = createProactiveSourceHost({
    getApplication: () => ({runtime: current}),
    getTools: () => [
      {descriptor: {name: 'calendar.events', sideEffect: 'read'}, async execute(input) { calls.push(['calendar.events', input]); return {items: pages.calendar, hasMore: false, nextCursor: ''}; }},
      {descriptor: {name: 'mail.inbox', sideEffect: 'read'}, async execute() { calls.push(['mail.inbox']); return {items: pages.mail, hasMore: false, nextCursor: ''}; }},
      {descriptor: {name: 'calendar.create', sideEffect: 'external_write'}, async execute() { calls.push(['calendar.create']); }},
    ],
    submitTask: async input => { submitted.push(input); return {taskId: `work-${submitted.length}`, state: 'created'}; },
    namespace: 'desktop',
    ...(extra.scan ? {scan: extra.scan} : {}),
    ...(extra.risk ? {risk: extra.risk} : {}),
    now: () => clock,
  });
  return {host: created, calls, submitted, runtime: current, setNow(value) { clock = value; }, pages};
}

test('默认关闭时不读取来源，开启后只调用公开只读工具', async () => {
  const fx = host();
  assert.equal(fx.host.snapshot().enabled, false);
  assert.equal(fx.host.snapshot().quiet, true);
  await fx.host.tick();
  assert.deepEqual(fx.calls, []);
  fx.host.update({enabled: true, calendar: true, mail: false});
  await fx.host.tick();
  assert.deepEqual(fx.calls.map(call => call[0]), ['calendar.events']);
  assert.equal(fx.calls.some(call => call[0] === 'calendar.create'), false);
});

test('低风险新邮件直接提交，改期要等审批卡的 revision 和参数摘要', async () => {
  const fx = host();
  fx.host.update({enabled: true, calendar: false, mail: true, quiet: false});
  await fx.host.tick();
  fx.pages.mail = [mail('new')];
  fx.setNow(Date.parse('2026-11-11T08:05:00.000Z'));
  await fx.host.tick();
  assert.equal(fx.submitted.length, 1);
  assert.match(fx.submitted[0].goal, /摘要新邮件/);
  assert.equal(fx.submitted[0].goal.includes('主题'), false);

  const moved = host();
  const start = '2026-11-11T08:20:00.000Z', end = '2026-11-11T09:00:00.000Z';
  moved.pages.calendar = [item('evt', start, end)];
  moved.host.update({enabled: true, calendar: true, mail: false, quiet: false});
  await moved.host.tick();
  moved.pages.calendar = [item('evt', '2026-11-11T11:00:00.000Z', '2026-11-11T12:00:00.000Z', 2)];
  moved.setNow(Date.parse('2026-11-11T08:05:00.000Z'));
  await moved.host.tick();
  assert.equal(moved.submitted.length, 0);
  assert.equal(moved.runtime.approvals.size, 1);
  const approval = [...moved.runtime.approvals.values()][0];
  assert.equal(approval.toolName, '会议改期');
  assert.equal([...moved.runtime.tasks.values()][0].state, 'waiting_approval');
  moved.runtime.allow(approval.approvalId);
  await moved.host.tick();
  assert.equal(moved.submitted.length, 1);
  assert.equal([...moved.runtime.tasks.values()][0].state, 'cancelled');
});

test('风险适配只能收紧，不能让改期跳过审批', async () => {
  const fx = host({risk: {decide: () => 'ask'}});
  fx.host.update({enabled: true, calendar: false, mail: true, quiet: false});
  await fx.host.tick();
  fx.pages.mail = [mail('ask')];
  fx.setNow(Date.parse('2026-11-11T08:05:00.000Z'));
  await fx.host.tick();
  assert.equal(fx.submitted.length, 0);
  assert.equal(fx.runtime.approvals.size, 1);
});

test('未授权目录被拒绝，授权后才扫描，撤销后不再扫描', async () => {
  const seen = [];
  const fx = host({scan: async root => { seen.push(root); return [{relativePath: 'a.txt', size: 1, mtimeMs: 1}]; }});
  assert.throws(() => fx.host.authorize('notes'), /具体目录/);
  assert.throws(() => fx.host.authorize('/'), /具体目录/);
  const root = path.resolve('/work/notes');
  fx.host.authorize(root);
  fx.host.update({enabled: true, calendar: false, mail: false});
  await fx.host.tick();
  assert.deepEqual(seen, [root]);
  fx.host.revoke(root);
  fx.setNow(Date.parse('2026-11-11T08:30:00.000Z'));
  await fx.host.tick();
  assert.deepEqual(seen, ['/work/notes']);
});

test('设置界面只有开关、来源、静默、目录授权和只读记录', async () => {
  const calls = [];
  const fields = new Map();
  const make = () => {
    const node = {hidden: false, value: '', checked: false, dataset: {}, children: [], listeners: {}, text: '',
      setAttribute() {}, append(child) { node.children.push(child); },
      addEventListener(type, handler) { node.listeners[type] = handler; },
      querySelector(selector) { return node.queryAll(selector)[0]; },
      queryAll(selector) {
        const all = [node, ...node.children.flatMap(child => [child, ...(child.queryAll?.(selector) ?? [])])];
        if (selector.startsWith('[data-field=')) return all.filter(item => item.field === selector.slice(13, -2));
        if (selector === '[data-status]') return all.filter(item => item.role === 'status');
        if (selector === '[data-directories]') return all.filter(item => item.kind === 'directories');
        if (selector === '[data-rules]') return all.filter(item => item.kind === 'rules');
        if (selector === '[data-recent]') return all.filter(item => item.kind === 'recent');
        if (selector === 'form') return all.filter(item => item.kind === 'form');
        return [];
      }};
    let html = '';
    Object.defineProperty(node, 'innerHTML', {get: () => html, set(value) {
      html = value;
      node.children = [];
      for (const name of ['enabled', 'calendar', 'mail', 'quiet', 'directory']) {
        if (!value.includes(`data-field="${name}"`)) continue;
        const field = make(); field.field = name; fields.set(name, field); node.children.push(field);
      }
      if (value.includes('<form')) { const form = make(); form.kind = 'form'; form.children = [fields.get('directory')]; node.children.push(form); }
      for (const kind of ['directories', 'rules', 'recent']) {
        if (!value.includes(`data-${kind}`)) continue;
        const list = make(); list.kind = kind; node.children.push(list);
      }
      if (value.includes('data-status')) { const status = make(); status.role = 'status'; node.children.push(status); }
    }});
    return node;
  };
  const root = make();
  const documentBefore = globalThis.document;
  globalThis.document = {createElement: make};
  try {
    const controls = mountProactiveTaskControls(root, async (name, payload) => {
      calls.push([name, payload]);
      return {enabled: true, calendar: true, mail: false, quiet: true, directories: ['/work/notes'], rules: ['会前准备材料'], recent: []};
    });
    const section = root.children[0];
    assert.deepEqual([...fields.keys()], ['enabled', 'calendar', 'mail', 'quiet', 'directory']);
    assert.equal((section.innerHTML.match(/<button/g) ?? []).length, 1);
    assert.match(section.innerHTML, /授权/);
    assert.doesNotMatch(section.innerHTML, /统计|刷新|编辑|保存|高级/);
    fields.get('enabled').checked = true;
    await fields.get('enabled').listeners.change();
    assert.deepEqual(calls[0], ['proactiveTasks.update', {enabled: true}]);
    fields.get('directory').value = '/work/notes';
    await section.querySelector('form').listeners.submit({preventDefault() {}});
    assert.deepEqual(calls[1], ['proactiveTasks.authorize', {root: '/work/notes'}]);
    controls.render({enabled: true, calendar: true, mail: true, quiet: true, directories: ['/work/notes'], rules: ['会议改期先询问'], recent: [{status: 'waiting_approval'}]});
    assert.match(section.querySelector('[data-directories]').innerHTML, /撤销/);
    assert.match(section.querySelector('[data-recent]').innerHTML, /等待确认/);
  } finally { globalThis.document = documentBefore; }
});
