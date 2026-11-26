import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPluginCatalogService} from '@personal-agent/plugin-catalog';
import {openLocalSkillStore, readLocalSkillDirectory} from '@personal-agent/skills';
import {planRuntimeTaskFailure, TASK_FAILURE_REPAIR_CHECKPOINT} from '@personal-agent/agentarts';
import {createPluginCatalogHost} from '../electron/plugin-catalog-host.js';
import {createRiskAutonomyHost} from '../electron/risk-autonomy-host.js';
import {createProactiveSourceHost} from '../electron/proactive-source-host.js';
import {createFailureRepairHost} from '../electron/failure-repair-host.js';
import {openDesktopActivity, projectRepairActivityFromCheckpoint} from '../electron/activity-host.js';
import {activityTimelineHtml, mountActivityTimeline} from '../src/features/admin/activity-timeline.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function skillEntry(bundle) {
  return {
    id: 'skill.fixture.notes',
    name: 'Fixture notes',
    type: 'skill',
    sourceRepositoryUrl: 'https://github.com/example-org/example-skill',
    license: 'MIT',
    licenseNotes: '测试夹具，不是精选目录条目。',
    pin: {state: 'pinned', sha256: bundle.digest, sha256Subject: 'skill-bundle'},
    author: 'fixture',
    description: '用于安装流程的本地夹具。',
    capabilities: [{name: 'instruction', effect: 'instruction', admitted: true, statement: '只有说明。'}],
    permissionDeclarations: [{scope: 'skill:instruction', effect: 'instruction', admitted: true, requiredForEnable: false, statement: '不授予工具。'}],
    permissionManifest: {networkHosts: [], filePaths: [], connectors: [], secrets: []},
    riskLevel: 'low',
    enableRequiresAuthorization: false,
    maintenanceStatus: 'active',
    maintenanceEvidence: '测试夹具。',
    admissionReason: '只验证安装器行为。',
    admissionCriteria: ['摘要匹配才安装'],
    oneClickInstall: true,
    installer: 'local-skill',
    skillName: bundle.name,
    reviewedAt: '2026-11-11',
    reviewSources: ['https://github.com/example-org/example-skill'],
  };
}

function mount(parentInvoke) {
  const created = [];
  const previous = globalThis.document;
  globalThis.document = {createElement() {
    const node = {hidden: false, innerHTML: '', listener: undefined, addEventListener(_type, fn) { this.listener = fn; }};
    created.push(node);
    return node;
  }};
  const error = {textContent: '', before(node) { this.node = node; }};
  const parent = {querySelector(selector) { return selector === '#error' ? error : null; }};
  try {
    const view = mountActivityTimeline(parent, parentInvoke, escape);
    return {view, error, timeline: () => error.node};
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

test('a real plugin install reaches the activity page and survives a restart', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'activity-product-'));
  const source = path.join(root, 'fixture-notes');
  mkdirSync(source, {recursive: true});
  const secret = 'Follow the fixture text only. Do not copy this body into the timeline.';
  writeFileSync(path.join(source, 'SKILL.md'), `---\nname: fixture-notes\ndescription: "Fixture skill for catalog installation"\nmetadata:\n  version: "1.0.0"\n---\n${secret}\n`);
  const bundle = readLocalSkillDirectory(source);
  const entry = skillEntry(bundle);
  const store = openLocalSkillStore(path.join(root, 'skills.json'));
  const installationFile = path.join(root, 'plugin-catalog.json');
  const started = openDesktopActivity({userData: root, onUpdate() {}});
  const installer = createPluginCatalogService({
    skillStore: store, installationFile, catalog: [entry], onActivity: notice => started.note(notice),
  });
  installer.install({id: entry.id, sourceDirectory: source});
  const catalog = createPluginCatalogHost({
    skillStore: store, installationFile, catalog: [entry], confirm: async () => true, onUpdate() {},
    onActivity: notice => started.note(notice),
    onActivityFailure: notice => started.recordFailure(notice),
  });
  started.bindPlugin({
    uninstall: id => catalog.compensate('uninstall', id),
    disable: id => catalog.compensate('disable', id),
  });
  const enabled = await catalog.invoke('plugin.enable', {id: entry.id, enabled: true});
  assert.equal(enabled.enabled, true);

  const live = activityTimelineHtml(started.snapshot(), escape);
  assert.match(live, /安装插件 skill\.fixture\.notes/);
  assert.match(live, /启用插件 skill\.fixture\.notes/);
  assert.equal(live.includes(secret), false);
  assert.equal(live.includes('刷新'), false);
  assert.equal(live.includes('保存'), false);
  assert.equal(live.includes('筛选'), false);
  const saved = readFileSync(path.join(root, 'activity-ledger.jsonl'), 'utf8');
  assert.equal(saved.includes(secret), false);

  const restarted = openDesktopActivity({userData: root, onUpdate() {}});
  const rebound = createPluginCatalogHost({
    skillStore: store, installationFile, catalog: [entry], confirm: async () => true, onUpdate() {},
    onActivity: notice => restarted.note(notice),
    onActivityFailure: notice => restarted.recordFailure(notice),
  });
  assert.equal(restarted.snapshot().items.every(item => item.undoable === false), true);
  restarted.bindPlugin({
    uninstall: id => rebound.compensate('uninstall', id),
    disable: id => rebound.compensate('disable', id),
  });
  const page = restarted.snapshot();
  const enable = page.items.find(item => item.summary.startsWith('启用插件'));
  assert.equal(enable.undoable, true);
  const shown = mount((name, payload) => restarted.handle(name, payload));
  shown.view.show(true);
  shown.view.render(page);
  assert.match(shown.timeline().innerHTML, /它替我做了什么/);
  assert.match(shown.timeline().innerHTML, /启用插件 skill\.fixture\.notes/);
  await shown.timeline().listener({target: {closest(selector) {
    if (selector !== '[data-activity-why]') return null;
    return {dataset: {activityWhy: enable.id}};
  }}});
  assert.match(shown.timeline().innerHTML, /插件目录 · enable/);
  assert.match(shown.timeline().innerHTML, /按目录风险启用/);
  await shown.timeline().listener({target: {closest(selector) {
    if (selector !== '[data-activity-undo]') return null;
    return {dataset: {activityUndo: enable.id}, disabled: false};
  }}});
  assert.equal(installer.installations().find(item => item.catalogId === entry.id).enabled, false);
  assert.match(shown.timeline().innerHTML, /已撤销/);
  assert.equal(shown.timeline().innerHTML.includes(`data-activity-undo="${enable.id}"`), false);
  await assert.rejects(() => restarted.handle('activity.undo', {id: enable.id}), {code: 'REVISION_CONFLICT'});

  const firstInstallItem = restarted.snapshot().items.find(item => item.summary.startsWith('安装插件'));
  assert.equal(firstInstallItem.undoable, true);
  await rebound.invoke('plugin.uninstall', {id: entry.id});
  installer.install({id: entry.id, sourceDirectory: source});
  const afterReinstall = restarted.snapshot().items;
  const oldInstallAfterReinstall = afterReinstall.find(item => item.id === firstInstallItem.id);
  const newInstallAfterReinstall = afterReinstall.find(item => item.summary.startsWith('安装插件') && item.id !== firstInstallItem.id);
  assert.equal(oldInstallAfterReinstall.undoable, false);
  assert.equal(newInstallAfterReinstall.undoable, true);
  await assert.rejects(() => restarted.handle('activity.undo', {id: firstInstallItem.id}), {code: 'REVISION_CONFLICT'});
  assert.throws(() => rebound.compensate('uninstall', `${entry.id}:1`), {code: 'REVISION_CONFLICT'});
  assert.equal(installer.installations().some(item => item.catalogId === entry.id), true);

  assert.equal(readFileSync(path.join(root, 'activity-ledger.jsonl'), 'utf8').startsWith(saved), true);
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../src/features/admin/view.js', import.meta.url), 'utf8');
  assert.match(main, /openDesktopActivity\(\{userData:app\.getPath\('userData'\),onUpdate:publish\}\)/);
  assert.match(main, /onActivity:notice=>activityProduct\?\.note\(notice\)/);
  assert.match(main, /activityProduct\.handle\(name, payload\)/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action', action, payload\)/);
  assert.match(admin, /items: \['dashboard', 'tasks', 'activity'\]/);
  assert.match(admin, /mountActivityTimeline/);
  rmSync(root, {recursive: true, force: true});
});

test('autonomy, proactive source, and failure repair sources record into activity-ledger.jsonl without body leakage and wire undo (L-05)', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'activity-three-sources-'));
  try {
    const activity = openDesktopActivity({userData: root, onUpdate() {}});

    // 1. #630 Risk autonomy source + revert compensation
    let savedAutonomy;
    const submittedCompensations = [];
    const autonomy = createRiskAutonomyHost({
      store: {load: () => savedAutonomy, save: value => { savedAutonomy = structuredClone(value); }},
      channel: {async sendAdvisoryNotification() { return {delivered: true}; }},
      getApplication: () => ({
        runtime: {respondApproval() {}},
        submitHostToolTask(input) {
          submittedCompensations.push(input);
          return {task: {taskId: 'undo-task-1', state: 'created'}};
        },
      }),
      onActivity: record => activity.recordAutonomy(record),
    });
    activity.bindAutonomy({
      revert: auditId => {
        const result = autonomy.compensateAudit(auditId);
        if (!result?.executed) throw new Error('自动执行补偿已不可用');
      },
    });
    autonomy.setStance('autonomous');
    const runId = 'run-autonomy-l05';
    const invoke = {
      runId,
      toolName: 'todo.update',
      toolVersion: '1.0.0',
      sideEffect: 'local_write',
      requiredScopes: ['todo:write'],
      argumentsDigest: 'a'.repeat(64),
      compensation: {toolName: 'todo.update', available: true},
    };
    const decision = autonomy.gate.review(invoke);
    assert.equal(decision.disposition, 'execute_and_notify');
    autonomy.gate.recordGranted({...invoke, disposition: decision.disposition});
    autonomy.gate.rememberCompensation({
      runId,
      toolName: 'todo.update',
      toolVersion: '1.0.0',
      arguments: {id: 'todo-1', secretBody: 'PRIVATE_COMPENSATION_ARG_NEVER_IN_LEDGER'},
    });
    autonomy.gate.recordExecutionState({runId, state: 'confirmed'});

    // 2. #631 Proactive source trigger (calendar/mail/file) without summary leakage
    const proactiveRuntime = {
      tasks: new Map(),
      approvals: new Map(),
      schedules: [],
      submitTask(input) { const t = {taskId: 'gate-1', state: 'created', goal: input.goal}; this.tasks.set(t.taskId, t); return t; },
      saveCheckpoint() {},
      transitionTask(id, state) { this.tasks.get(id).state = state; },
      requestToolApproval() { throw new Error('unused'); },
      listSchedules() { return []; },
      reconcileSchedules() {},
      createSchedule() {},
      dispatchDueSchedules() { return []; },
    };
    let clock = Date.parse('2026-11-11T08:00:00.000Z');
    let files = [{relativePath: 'secret-note.txt', size: 10, mtimeMs: 1}];
    const proactive = createProactiveSourceHost({
      getApplication: () => ({runtime: proactiveRuntime}),
      getTools: () => [],
      submitTask: async () => ({taskId: 'proactive-task-1', state: 'created'}),
      namespace: 'desktop',
      scan: async () => files,
      now: () => clock,
      onActivity: outcome => activity.recordProactive(outcome),
    });
    proactive.authorize(path.resolve(root));
    proactive.update({enabled: true, calendar: false, mail: false, quiet: false});
    await proactive.tick();
    files = [{relativePath: 'secret-note.txt', size: 25, mtimeMs: 2}];
    clock += 300_000;
    await proactive.tick();

    // 3. #633 Failure repair source + stop_retry compensation without FailureSignal.message leakage
    const repairCheckpoints = new Map();
    const repairTask = {taskId: 'task-repair-l05', state: 'failed', goal: '查询当前天气预报', conversationId: 'desktop-panel'};
    const repairRuntime = {
      getTask(id) { if (id !== repairTask.taskId) throw new Error('missing'); return repairTask; },
      loadCheckpoint(id, key) { return repairCheckpoints.get(`${id}:${key}`); },
      saveCheckpoint(id, key, value) { repairCheckpoints.set(`${id}:${key}`, value); },
      readToolExecutions() { return [{toolName: 'weather.forecast', toolVersion: '1.0.0', inputDigest: 'b'.repeat(64)}]; },
    };
    const repairRecord = planRuntimeTaskFailure({
      taskId: repairTask.taskId,
      errorCode: 'TIMEOUT',
      effect: 'read',
      outcome: 'failed',
      occurredAt: '2026-11-11T08:10:00.000Z',
    });
    repairRuntime.saveCheckpoint(repairTask.taskId, TASK_FAILURE_REPAIR_CHECKPOINT, repairRecord);
    activity.bindRepair({
      stopRetry: taskId => {
        const res = createFailureRepairHost(repairRuntime).act({taskId, action: 'abandon'});
        if (!res.accepted) throw new Error(res.reason);
      },
    });
    const projectedRepair = projectRepairActivityFromCheckpoint(
      repairTask.taskId,
      repairRuntime.loadCheckpoint(repairTask.taskId, TASK_FAILURE_REPAIR_CHECKPOINT),
      'weather.forecast',
    );
    assert.ok(projectedRepair);
    activity.recordRepair(projectedRepair);

    const page = activity.snapshot();
    const autonomyItem = page.items.find(item => item.source === 'autonomy');
    const proactiveItem = page.items.find(item => item.source === 'proactive');
    const repairItem = page.items.find(item => item.source === 'repair');
    assert.ok(autonomyItem, 'autonomy activity should be recorded');
    assert.equal(autonomyItem.undoable, true);
    assert.ok(proactiveItem, 'proactive directory trigger activity should be recorded');
    assert.equal(proactiveItem.summary, '主动触发：目录变化');
    assert.ok(repairItem, 'failure repair activity should be recorded');
    assert.equal(repairItem.undoable, true);

    const rawLedger = readFileSync(path.join(root, 'activity-ledger.jsonl'), 'utf8');
    assert.equal(rawLedger.includes('PRIVATE_COMPENSATION_ARG_NEVER_IN_LEDGER'), false);
    assert.equal(rawLedger.includes('secret-note.txt'), false);

    // Undo autonomy executes stored compensation tool; undo repair transitions repair card to abandoned
    await activity.handle('activity.undo', {id: autonomyItem.id});
    assert.equal(submittedCompensations.length, 1);
    assert.equal(submittedCompensations[0].toolName, 'todo.update');
    await activity.handle('activity.undo', {id: repairItem.id});
    assert.equal(createFailureRepairHost(repairRuntime).view(repairTask.taskId).abandoned, true);

    // Restart preserves all three sources and their undone state
    const restarted = openDesktopActivity({userData: root, onUpdate() {}});
    const restartedSources = new Set(restarted.snapshot().items.map(item => item.source));
    assert.equal(restartedSources.has('autonomy'), true);
    assert.equal(restartedSources.has('proactive'), true);
    assert.equal(restartedSources.has('repair'), true);

    const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
    assert.match(main, /onActivity:\s*record\s*=>\s*activityProduct\?\.recordAutonomy\(record\)/);
    assert.match(main, /activityProduct\?\.bindAutonomy\(/);
    assert.match(main, /onActivity:\s*outcome\s*=>\s*activityProduct\?\.recordProactive\(outcome\)/);
    assert.match(main, /activityProduct\.bindRepair\(/);
    assert.match(main, /recordTaskRepairActivity\(/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
