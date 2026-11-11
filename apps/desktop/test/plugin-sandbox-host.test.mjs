import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {CURATED_PLUGINS} from '@personal-agent/plugin-catalog';
import {openLocalSkillStore, readLocalSkillDirectory} from '@personal-agent/skills';
import {createPluginCatalogHost} from '../electron/plugin-catalog-host.js';
import {pluginMarketCardsHtml} from '../src/app/plugin-catalog-controls.js';

function fixture(t) {
  mkdirSync(path.resolve('.cache/plugin-catalog-desktop'), {recursive: true});
  const root = mkdtempSync(path.join(path.resolve('.cache/plugin-catalog-desktop'), 'sandbox-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const source = path.join(root, 'frontend-design');
  mkdirSync(source);
  writeFileSync(path.join(source, 'SKILL.md'), '---\nname: frontend-design\ndescription: "Sandbox fixture"\nmetadata:\n  version: "1.0.0"\n---\nHost fixture text.\n');
  writeFileSync(path.join(source, 'LICENSE.txt'), 'Apache-2.0 fixture\n');
  const entry = structuredClone(CURATED_PLUGINS.find(item => item.id === 'skill.anthropic.frontend-design'));
  entry.pin.sha256 = readLocalSkillDirectory(source).digest;
  entry.permissionManifest = {
    networkHosts: ['docs.example.com'],
    filePaths: ['notes'],
    connectors: ['calendar.read'],
    secrets: ['plugin.notes.token'],
  };
  const bytes = new Map([
    [`https://raw.githubusercontent.com/anthropics/skills/${entry.pin.commit}/skills/frontend-design/SKILL.md`, readFileSync(path.join(source, 'SKILL.md'))],
    [`https://raw.githubusercontent.com/anthropics/skills/${entry.pin.commit}/skills/frontend-design/LICENSE.txt`, readFileSync(path.join(source, 'LICENSE.txt'))],
  ]);
  return {root, entry, bytes, installationFile: path.join(root, 'catalog.json'), dataRoot: path.join(root, 'data'), violationFile: path.join(root, 'violations.json')};
}

test('startup host confirms the permission list once and enforces it', async t => {
  const f = fixture(t);
  const seen = [];
  const fetches = [];
  const secretReads = [];
  const host = createPluginCatalogHost({
    catalog: [f.entry],
    skillStore: openLocalSkillStore(path.join(f.root, 'skills.json')),
    installationFile: f.installationFile,
    dataRoot: f.dataRoot,
    violationFile: f.violationFile,
    confirm: async request => { seen.push(request); return true; },
    readSecret(name) { secretReads.push(name); return name === 'plugin.notes.token' ? 'super-secret-value' : undefined; },
    fetchImpl: async url => { fetches.push(url); return {status: 200}; },
    download: {async get(url) {
      const found = f.bytes.get(url);
      return found ? {status: 200, bytes: found} : {status: 404, bytes: new Uint8Array()};
    }},
  });
  const id = f.entry.id;
  assert.equal((await host.invoke('plugin.guard', {id, kind: 'network', target: 'https://docs.example.com/a'})).reason, 'not-installed');
  const before = seen.length;
  assert.equal((await host.invoke('plugin.install', {id})).enabled, false);
  assert.equal((await host.invoke('plugin.enable', {id, enabled: true})).enabled, true);
  assert.equal(seen.length, before + 1);
  assert.match(seen.at(-1).summary, /安装「Frontend Design」/);
  assert.match(seen.at(-1).summary, /网络只允许docs\.example\.com/);
  assert.match(seen.at(-1).summary, /文件只允许插件数据中的notes/);
  assert.match(seen.at(-1).summary, /连接器只允许calendar\.read/);
  assert.match(seen.at(-1).summary, /密钥只允许plugin\.notes\.token/);
  assert.equal(seen.at(-1).summary.length <= 512, true);

  assert.equal((await host.fetchWithinGrant(id, 'https://docs.example.com/page')).status, 200);
  assert.deepEqual(fetches, ['https://docs.example.com/page']);
  assert.equal((await host.invoke('plugin.guard', {id, kind: 'network', target: 'https://evil.example'})).allowed, false);
  assert.equal(fetches.length, 1);
  assert.equal((await host.invoke('plugin.guard', {id, kind: 'connector', target: 'mail.send'})).allowed, false);
  assert.equal((await host.invoke('plugin.guard', {id, kind: 'connector', target: 'calendar.read'})).allowed, true);

  assert.equal((await host.invoke('plugin.guard', {id, kind: 'file', fileMode: 'write', target: 'notes/a.txt', body: 'kept'})).allowed, true);
  assert.equal(readFileSync(path.join(f.dataRoot, id, 'notes', 'a.txt'), 'utf8'), 'kept');
  assert.equal((await host.invoke('plugin.guard', {id, kind: 'file', fileMode: 'write', target: '../outside.txt', body: 'no'})).allowed, false);
  assert.equal((await host.readPluginFile(id, 'notes/a.txt')).text, 'kept');

  assert.equal(secretReads.length, 0);
  const hidden = await host.invoke('plugin.guard', {id, kind: 'secret', target: 'other.token'});
  assert.equal(hidden.allowed, false);
  assert.equal(secretReads.length, 0);
  const shown = await host.invoke('plugin.guard', {id, kind: 'secret', target: 'plugin.notes.token'});
  assert.equal(shown.allowed, true);
  assert.equal(shown.found, true);
  assert.equal(Object.hasOwn(shown, 'value'), false);
  assert.equal(JSON.stringify(shown).includes('super-secret-value'), false);
  assert.equal(host.readGrantedSecret(id, 'plugin.notes.token').value, 'super-secret-value');
  const log = readFileSync(f.violationFile, 'utf8');
  assert.equal(log.includes('super-secret-value'), false);

  const saved = JSON.parse(readFileSync(f.installationFile, 'utf8'));
  saved.entries[0].permissionGrant.networkHosts.push('evil.example');
  writeFileSync(f.installationFile, JSON.stringify(saved));
  assert.equal((await host.invoke('plugin.guard', {id, kind: 'network', target: 'https://evil.example'})).allowed, false);
  assert.equal((await host.fetchWithinGrant(id, 'https://docs.example.com/still')).allowed, true);

  const card = pluginMarketCardsHtml(host.snapshot().items.filter(item => item.id === id));
  assert.match(card, /已拦截未声明的网络/);
  assert.doesNotMatch(card, /data-plugin="(?!disable|uninstall)/);
  assert.equal(card.includes('super-secret-value'), false);
});

test('preload pluginAccess and startup wiring use the plugin guard', () => {
  let bridge;
  const calls = [];
  const ipcRenderer = {invoke: async (...args) => { calls.push(args); return {allowed: false}; }, on() {}, removeListener() {}};
  vm.runInNewContext(readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({ipcRenderer, contextBridge: {exposeInMainWorld(_name, value) { bridge = value; }}}),
    window: {addEventListener() {}},
  });
  bridge.pluginAccess({id: 'skill.example', kind: 'network', target: 'https://docs.example.com'});
  assert.deepEqual(calls[0], ['desktop:action', 'plugin.guard', {id: 'skill.example', kind: 'network', target: 'https://docs.example.com'}]);
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(main, /dataRoot:path\.join\(app\.getPath\('userData'\),'plugin-data'\)/);
  assert.match(main, /violationFile:path\.join\(app\.getPath\('userData'\),'plugin-sandbox-violations\.json'\)/);
  assert.match(main, /typeof request\.summary==='string'/);
});
