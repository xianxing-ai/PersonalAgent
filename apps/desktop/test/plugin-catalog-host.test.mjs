import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {openLocalSkillStore, readLocalSkillDirectory} from '@personal-agent/skills';
import {CURATED_PLUGINS} from '@personal-agent/plugin-catalog';
import {createPluginCatalogHost} from '../electron/plugin-catalog-host.js';
import {pluginMarketCardsHtml} from '../src/app/plugin-catalog-controls.js';

function fixture(t) {
  mkdirSync(path.resolve('.cache/plugin-catalog-desktop'), {recursive: true});
  const root = mkdtempSync(path.join(path.resolve('.cache/plugin-catalog-desktop'), 'case-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const source = path.join(root, 'frontend-design');
  mkdirSync(source);
  writeFileSync(path.join(source, 'SKILL.md'), '---\nname: frontend-design\ndescription: "Desktop host fixture"\nmetadata:\n  version: "1.0.0"\n---\nHost fixture text.\n');
  writeFileSync(path.join(source, 'LICENSE.txt'), 'Apache-2.0 fixture\n');
  const entry = structuredClone(CURATED_PLUGINS.find(item => item.id === 'skill.anthropic.frontend-design'));
  entry.pin.sha256 = readLocalSkillDirectory(source).digest;
  entry.riskLevel = 'high';
  entry.enableRequiresAuthorization = true;
  entry.permissionDeclarations = [{scope: 'plugin-catalog:enable', effect: 'enable', admitted: true, requiredForEnable: true, statement: '启用需要授权'}];
  const bytes = new Map([
    [`https://raw.githubusercontent.com/anthropics/skills/${entry.pin.commit}/skills/frontend-design/SKILL.md`, readFileSync(path.join(source, 'SKILL.md'))],
    [`https://raw.githubusercontent.com/anthropics/skills/${entry.pin.commit}/skills/frontend-design/LICENSE.txt`, readFileSync(path.join(source, 'LICENSE.txt'))],
  ]);
  return {entry, source, store: openLocalSkillStore(path.join(root, 'skills.json')), installationFile: path.join(root, 'catalog.json'), bytes};
}

test('market cards keep only the action that matches install state', () => {
  const base = {id: 'skill.example', name: 'Example <skill>', type: 'skill', riskLevel: 'low', description: 'Short', license: 'MIT', sourceRepositoryUrl: 'https://github.com/example/example', permissions: [{statement: '说明'}], permissionSummary: ['不访问网络。', '不读写文件。', '不使用连接器。', '不读取密钥。'], oneClickInstall: true, installed: false, enabled: false, updateStatus: 'not-installed'};
  assert.match(pluginMarketCardsHtml([base]), /data-plugin="install"/);
  assert.match(pluginMarketCardsHtml([base]), /不访问网络。不读写文件。不使用连接器。不读取密钥。/);
  assert.doesNotMatch(pluginMarketCardsHtml([base]), /data-plugin="enable"|data-plugin="uninstall"|星标|权限设置|打开沙箱/);
  assert.match(pluginMarketCardsHtml([base]), /Example &lt;skill&gt;/);
  const installed = {...base, installed: true, enableRequiresAuthorization: true};
  const html = pluginMarketCardsHtml([installed]);
  assert.match(html, /data-plugin="enable"/);
  assert.match(html, /data-plugin="uninstall"/);
  assert.match(html, /启用需要授权/);
  assert.doesNotMatch(html, /data-plugin="install"|data-plugin="disable"/);
  const enabled = pluginMarketCardsHtml([{...installed, enabled: true, updateStatus: 'update-available'}]);
  assert.match(enabled, /data-plugin="disable"/);
  assert.match(enabled, /data-plugin="update"/);
  assert.doesNotMatch(pluginMarketCardsHtml([{...base, oneClickInstall: false, installBlockReason: '不能安装'}]), /data-plugin="install"/);
  assert.match(pluginMarketCardsHtml([{...base, installed: true, enabled: true, lastBlocked: {kind: 'secret'}}]), /已拦截未声明的密钥/);
});

test('host installs a downloaded pin into the shared skill store and gates high-risk enable', async t => {
  const f = fixture(t);
  let allowEnable = false;
  const confirmRequests = [];
  const host = createPluginCatalogHost({
    catalog: [f.entry], skillStore: f.store, installationFile: f.installationFile,
    confirm: async request => { confirmRequests.push(request); return request.action !== 'enable' || allowEnable; },
    download: {async get(url) {
      const found = f.bytes.get(url);
      return found ? {status: 200, bytes: found} : {status: 404, bytes: new Uint8Array()};
    }},
  });
  const installed = await host.invoke('plugin.install', {id: f.entry.id});
  assert.equal(installed.enabled, false);
  assert.equal(f.store.list()[0].enabled, false);
  assert.equal(host.snapshot().items.find(item => item.id === f.entry.id).installed, true);
  assert.equal((await host.invoke('plugin.enable', {id: f.entry.id, enabled: true})).cancelled, true);
  assert.match(confirmRequests.at(-1).detail, /启用需要授权/);
  assert.doesNotMatch(confirmRequests.at(-1).detail, /plugin-catalog:enable/);
  assert.equal(f.store.list()[0].enabled, false);
  allowEnable = true;
  assert.equal((await host.invoke('plugin.enable', {id: f.entry.id, enabled: true})).enabled, true);
  const proposals = await host.invoke('plugin.proposals');
  assert.equal(proposals.acceptance.closedLoop, false);
  assert.equal(proposals.skillReceipts[0].state, 'pending');
  f.bytes.set(f.bytes.keys().next().value, Buffer.from('not a skill'));
  await assert.rejects(() => host.invoke('plugin.update', {id: f.entry.id}), /摘要|下载|Skill/);
  assert.equal(f.store.list().length, 1);
});
