import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPluginCatalogService} from '@personal-agent/plugin-catalog';
import {openLocalSkillStore, readLocalSkillDirectory} from '@personal-agent/skills';
import {createPluginCatalogHost} from '../electron/plugin-catalog-host.js';
import {openDesktopActivity} from '../electron/activity-host.js';
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
  assert.equal(readFileSync(path.join(root, 'activity-ledger.jsonl'), 'utf8').startsWith(saved), true);
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../src/features/admin/view.js', import.meta.url), 'utf8');
  assert.match(main, /openDesktopActivity\(\{userData:app\.getPath\('userData'\),onUpdate:publish\}\)/);
  assert.match(main, /onActivity:notice=>activityProduct\?\.note\(notice\)/);
  assert.match(main, /activityProduct\.handle\(name, payload\)/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:action', action, payload\)/);
  assert.match(admin, /items: \['tasks', 'activity'\]/);
  assert.match(admin, /mountActivityTimeline/);
  rmSync(root, {recursive: true, force: true});
});
