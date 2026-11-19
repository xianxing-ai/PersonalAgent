import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {createPluginCatalogService, CURATED_PLUGINS, pluginEnableArgumentsDigest, projectEnabledPlugins, readBackPluginMcpReceipt} from '../dist/index.js';

function workspace(t) {
  mkdirSync(path.resolve('.cache/plugin-catalog-tests'), {recursive: true});
  const root = mkdtempSync(path.join(path.resolve('.cache/plugin-catalog-tests'), 'download-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  return {root, skillStoreFile: path.join(root, 'skills.json'), installationFile: path.join(root, 'installed.json')};
}

function ustar(files) {
  const blocks = [];
  for (const [name, content] of files) {
    const header = Buffer.alloc(512);
    header.write(name);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(content.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.fill(0x20, 148, 156);
    header[156] = 48;
    header.write('ustar\0', 257);
    header.write('00', 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
    blocks.push(header, content, padding);
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

test('pinned skill download installs only when every file matches the catalog digest', async t => {
  const files = workspace(t);
  const entry = structuredClone(CURATED_PLUGINS.find(item => item.id === 'skill.anthropic.frontend-design'));
  const body = Buffer.from('---\nname: frontend-design\ndescription: "Fixture download"\nmetadata:\n  version: "1.0.0"\n---\nDownloaded text only.\n');
  const license = Buffer.from('Apache-2.0 fixture\n');
  const {readLocalSkillDirectory} = await import('@personal-agent/skills');
  const {mkdirSync, writeFileSync} = await import('node:fs');
  const source = path.join(files.root, 'frontend-design');
  mkdirSync(source);
  writeFileSync(path.join(source, 'SKILL.md'), body);
  writeFileSync(path.join(source, 'LICENSE.txt'), license);
  entry.pin.sha256 = readLocalSkillDirectory(source).digest;
  const bytes = new Map([
    [`https://raw.githubusercontent.com/anthropics/skills/${entry.pin.commit}/skills/frontend-design/SKILL.md`, body],
    [`https://raw.githubusercontent.com/anthropics/skills/${entry.pin.commit}/skills/frontend-design/LICENSE.txt`, license],
  ]);
  const service = createPluginCatalogService({...files, catalog: [entry], download: {async get(url) {
    const found = bytes.get(url);
    if (!found) return {status: 404, bytes: new Uint8Array()};
    return {status: 200, bytes: found};
  }}});
  const installed = await service.installPinned(entry.id);
  assert.equal(installed.enabled, false);
  assert.equal(installed.skill.digest, entry.pin.sha256);
  bytes.set(bytes.keys().next().value, Buffer.from(body.toString() + 'changed\n'));
  await assert.rejects(() => service.installPinned(entry.id, true), {code: 'INVALID_ARGUMENT'});
  const broken = createPluginCatalogService({...files, catalog: [entry], download: {async get() { throw Error('offline'); }}});
  await assert.rejects(() => broken.installPinned('missing'), {code: 'NOT_FOUND'});
  await assert.rejects(() => broken.installPinned(entry.id, true), {code: 'EXTERNAL_FAILURE'});
});

test('filesystem download rejects a tarball whose hash differs and does not enable without Policy', async t => {
  const files = workspace(t);
  const entry = structuredClone(CURATED_PLUGINS.find(item => item.id === 'mcp.pinned.filesystem-readonly'));
  const entryFile = Buffer.from('pinned entry\n');
  const packageJson = Buffer.from(JSON.stringify({version: '2026.8.31', bin: {'mcp-server-filesystem': 'dist/index.js'}}));
  const packed = ustar([['package/package.json', packageJson], ['package/dist/index.js', entryFile]]);
  entry.pin.sha256 = createHash('sha256').update(entryFile).digest('hex');
  entry.pin.distributionSha256 = createHash('sha256').update(packed).digest('hex');
  const packageRoot = path.join(files.root, 'pkg');
  const {mkdirSync, writeFileSync} = await import('node:fs');
  mkdirSync(path.join(packageRoot, 'dist'), {recursive: true});
  writeFileSync(path.join(packageRoot, 'package.json'), packageJson);
  writeFileSync(path.join(packageRoot, 'dist', 'index.js'), entryFile);
  const service = createPluginCatalogService({
    ...files, catalog: [entry], resolveFilesystemPackage: () => path.join(packageRoot, 'package.json'),
    download: {async get() { return {status: 200, bytes: packed}; }},
  });
  const installed = await service.installPinned(entry.id);
  assert.equal(installed.enabled, false);
  const mutated = ustar([['package/package.json', packageJson], ['package/dist/index.js', randomBytes(16)]]);
  const rejected = createPluginCatalogService({
    ...files, catalog: [entry], resolveFilesystemPackage: () => path.join(packageRoot, 'package.json'),
    download: {async get() { return {status: 200, bytes: mutated}; }},
  });
  await assert.rejects(() => rejected.installPinned(entry.id), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => service.setEnabled(entry.id, true), {code: 'UNAUTHORIZED'});
  const policy = new InMemoryAuthorizationPolicy();
  const gated = createPluginCatalogService({
    ...files, catalog: [entry], policy, resolveFilesystemPackage: () => path.join(packageRoot, 'package.json'),
    download: {async get() { return {status: 200, bytes: packed}; }},
  });
  policy.grant({
    authorizationRef: 'auth-download', taskId: 'task-download', toolName: 'plugin-catalog.enable',
    scopes: ['plugin-catalog:enable', 'mcp:workspace:read'], expiresAt: new Date(Date.now() + 60_000).toISOString(),
    argumentsDigest: pluginEnableArgumentsDigest(entry.id, entry.pin.sha256),
  });
  assert.equal(gated.setEnabled(entry.id, true, {authorizationRef: 'auth-download', taskId: 'task-download'}).enabled, true);
  const projection = projectEnabledPlugins(gated.installations(), [entry]);
  assert.equal(projection.acceptance.closedLoop, false);
  assert.equal(projection.proposals[0].state, 'pending');
  assert.throws(() => readBackPluginMcpReceipt({path: 'note.md', text: 'x', contentDigest: 'a'.repeat(64), source: 'mcp', serverVersion: '2026.8.31', mock: true}), {code: 'INVALID_ARGUMENT'});
});
