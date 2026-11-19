import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {MCP_FILESYSTEM_PACKAGE_VERSION} from '@personal-agent/mcp';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {readLocalSkillDirectory} from '@personal-agent/skills';
import {createPluginCatalogService, CURATED_PLUGINS, pluginEnableArgumentsDigest} from '../dist/index.js';

const require = createRequire(import.meta.url);

function workspace(t) {
  const root = mkdtempSync(path.join(path.resolve('.cache/plugin-catalog-tests'), 'case-'));
  mkdirSync(root, {recursive: true});
  t.after(() => rmSync(root, {recursive: true, force: true}));
  return {
    root,
    skillStoreFile: path.join(root, 'skills.json'),
    installationFile: path.join(root, 'installed.json'),
  };
}

function writeSkill(directory, name, extra = '') {
  const source = path.join(directory, name);
  mkdirSync(source, {recursive: true});
  writeFileSync(path.join(source, 'SKILL.md'), `---\nname: ${name}\ndescription: "Fixture skill for catalog installation"\nmetadata:\n  version: "1.0.0"\n---\nFollow the fixture text only.\n${extra}`);
  return source;
}

function skillEntry(bundle, overrides = {}) {
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
    ...overrides,
  };
}

test('browse and search return curated details without installing them', t => {
  mkdirSync(path.resolve('.cache/plugin-catalog-tests'), {recursive: true});
  const files = workspace(t);
  const service = createPluginCatalogService(files);
  assert.equal(service.search('Context7').length, 1);
  assert.equal(service.search('Context7')[0].pin.version, '4.6.0');
  assert.equal(service.get('mcp.cloudflare-docs').publicEndpoint, 'https://docs.mcp.cloudflare.com/mcp');
  assert.equal(service.list({type: 'skill', oneClickInstall: true}).length, 4);
  assert.equal(service.planInstall('mcp.context7').oneClickInstall, false);
  assert.throws(() => service.install({id: 'mcp.context7'}), {code: 'UNSUPPORTED_CAPABILITY'});
  assert.throws(() => service.install({id: 'mcp.github'}), {code: 'UNSUPPORTED_CAPABILITY'});
  assert.deepEqual(service.installations(), []);
});

test('skill install stays disabled, rejects a tampered directory, and does not run bundled scripts', t => {
  mkdirSync(path.resolve('.cache/plugin-catalog-tests'), {recursive: true});
  const files = workspace(t);
  const source = writeSkill(files.root, 'fixture-notes');
  mkdirSync(path.join(source, 'scripts'));
  writeFileSync(path.join(source, 'scripts', 'run.js'), `import {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(path.join(files.root, 'ran.txt'))}, 'ran');\n`);
  const bundle = readLocalSkillDirectory(source);
  const catalog = [skillEntry(bundle)];
  const service = createPluginCatalogService({...files, catalog});
  const installed = service.install({id: catalog[0].id, sourceDirectory: source});
  assert.equal(installed.enabled, false);
  assert.equal(installed.skill.digest, bundle.digest);
  assert.deepEqual(installed.permissionGrant, {networkHosts: [], filePaths: [], connectors: [], secrets: []});
  assert.equal(service.install({id: catalog[0].id, sourceDirectory: source}).skill.installationId, installed.skill.installationId);
  assert.throws(() => readFileSync(path.join(files.root, 'ran.txt'), 'utf8'), {code: 'ENOENT'});
  writeFileSync(path.join(source, 'SKILL.md'), readFileSync(path.join(source, 'SKILL.md'), 'utf8') + 'Tampered.\n');
  assert.throws(() => service.install({id: catalog[0].id, sourceDirectory: source}), {code: 'INVALID_ARGUMENT'});
  const enabled = service.setEnabled(catalog[0].id, true);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.generation, 2);
  assert.equal(service.checkUpdate(catalog[0].id).status, 'current');
  const changed = structuredClone(catalog[0]);
  changed.pin = {...changed.pin, sha256: 'a'.repeat(64)};
  const updated = createPluginCatalogService({...files, catalog: [changed]});
  assert.equal(updated.checkUpdate(catalog[0].id).status, 'update-available');
  updated.uninstall(catalog[0].id);
  assert.equal(updated.checkUpdate(catalog[0].id).status, 'not-installed');
  assert.throws(() => service.setEnabled(catalog[0].id, false), {code: 'NOT_FOUND'});
});

test('successful install and enable emit an activity notice without skill text', t => {
  mkdirSync(path.resolve('.cache/plugin-catalog-tests'), {recursive: true});
  const files = workspace(t);
  const source = writeSkill(files.root, 'fixture-notes');
  const bundle = readLocalSkillDirectory(source);
  const notices = [];
  const service = createPluginCatalogService({
    ...files,
    catalog: [skillEntry(bundle)],
    onActivity: notice => notices.push(structuredClone(notice)),
  });
  service.install({id: 'skill.fixture.notes', sourceDirectory: source});
  service.install({id: 'skill.fixture.notes', sourceDirectory: source});
  service.setEnabled('skill.fixture.notes', true);
  assert.deepEqual(notices.map(item => item.action), ['install', 'enable']);
  assert.equal(notices[0].generation, 1);
  assert.equal(notices[1].generation, 2);
  assert.equal(JSON.stringify(notices).includes('Follow the fixture'), false);
  assert.equal(Object.hasOwn(notices[0], 'description'), false);
});

test('high-risk enable asks Policy and leaves the plugin disabled when authorization is missing', t => {
  mkdirSync(path.resolve('.cache/plugin-catalog-tests'), {recursive: true});
  const files = workspace(t);
  const source = writeSkill(files.root, 'fixture-writer', 'This fixture declares a write capability.\n');
  const bundle = readLocalSkillDirectory(source);
  const entry = skillEntry(bundle, {
    id: 'skill.fixture.writer',
    riskLevel: 'high',
    enableRequiresAuthorization: true,
    capabilities: [{name: 'write_file', effect: 'filesystem.write', admitted: true, statement: '夹具写入能力。'}],
    permissionDeclarations: [{scope: 'plugin-catalog:enable', effect: 'enable', admitted: true, requiredForEnable: true, statement: '启用需要授权。'}],
  });
  const policy = new InMemoryAuthorizationPolicy();
  const service = createPluginCatalogService({...files, catalog: [entry], policy});
  service.install({id: entry.id, sourceDirectory: source});
  assert.throws(() => service.setEnabled(entry.id, true), {code: 'UNAUTHORIZED'});
  assert.equal(service.installations()[0].enabled, false);
  policy.grant({
    authorizationRef: 'auth-writer', taskId: 'task-writer', toolName: 'plugin-catalog.enable',
    scopes: ['plugin-catalog:enable'], expiresAt: new Date(Date.now() + 60_000).toISOString(), maxUses: 1,
    argumentsDigest: pluginEnableArgumentsDigest(entry.id, bundle.digest),
  });
  assert.equal(service.setEnabled(entry.id, true, {authorizationRef: 'auth-writer', taskId: 'task-writer'}).enabled, true);
  assert.equal(service.setEnabled(entry.id, false).enabled, false);
  assert.throws(() => service.setEnabled(entry.id, true, {authorizationRef: 'auth-writer', taskId: 'task-writer'}), {code: 'UNAUTHORIZED'});
});

test('pinned filesystem install verifies the existing package hash and does not accept a mutated entry', t => {
  mkdirSync(path.resolve('.cache/plugin-catalog-tests'), {recursive: true});
  const files = workspace(t);
  const packageJsonPath = require.resolve('@modelcontextprotocol/server-filesystem/package.json');
  const metadata = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const entryPath = path.join(path.dirname(packageJsonPath), metadata.bin['mcp-server-filesystem']);
  const digest = createHash('sha256').update(readFileSync(entryPath)).digest('hex');
  const curated = CURATED_PLUGINS.find(entry => entry.id === 'mcp.pinned.filesystem-readonly');
  assert.equal(metadata.version, MCP_FILESYSTEM_PACKAGE_VERSION);
  assert.equal(digest, curated.pin.sha256);
  const mutated = path.join(files.root, 'mutated');
  mkdirSync(path.join(mutated, 'dist'), {recursive: true});
  writeFileSync(path.join(mutated, 'package.json'), JSON.stringify({version: MCP_FILESYSTEM_PACKAGE_VERSION, bin: {'mcp-server-filesystem': 'dist/index.js'}}));
  writeFileSync(path.join(mutated, 'dist', 'index.js'), 'mutated entry\n');
  const service = createPluginCatalogService({...files, resolveFilesystemPackage: () => path.join(mutated, 'package.json')});
  assert.throws(() => service.install({id: curated.id}), {code: 'INVALID_ARGUMENT'});
  assert.deepEqual(service.installations(), []);
  const installed = createPluginCatalogService({...files, resolveFilesystemPackage: () => packageJsonPath}).install({id: curated.id});
  assert.equal(installed.enabled, false);
  assert.equal(installed.mcp.surface, 'readonly-filesystem');
  assert.equal(installed.mcp.entrySha256, digest);
  const policy = new InMemoryAuthorizationPolicy();
  const gated = createPluginCatalogService({...files, policy, resolveFilesystemPackage: () => packageJsonPath});
  assert.throws(() => gated.setEnabled(curated.id, true), {code: 'UNAUTHORIZED'});
  policy.grant({
    authorizationRef: 'auth-fs', taskId: 'task-fs', toolName: 'plugin-catalog.enable',
    scopes: ['plugin-catalog:enable', 'mcp:workspace:read'], expiresAt: new Date(Date.now() + 60_000).toISOString(),
    argumentsDigest: pluginEnableArgumentsDigest(curated.id, curated.pin.sha256),
  });
  assert.equal(gated.setEnabled(curated.id, true, {authorizationRef: 'auth-fs', taskId: 'task-fs'}).enabled, true);
  assert.throws(() => gated.install({id: curated.id, sourceDirectory: files.root}), {code: 'INVALID_ARGUMENT'});
  gated.uninstall(curated.id);
  assert.equal(gated.checkUpdate(curated.id).status, 'not-installed');
});

test('a production skill pin rejects a directory whose bundle digest differs', t => {
  mkdirSync(path.resolve('.cache/plugin-catalog-tests'), {recursive: true});
  const files = workspace(t);
  const source = writeSkill(files.root, 'frontend-design', 'This is not the admitted Anthropic skill.\n');
  const service = createPluginCatalogService(files);
  assert.throws(() => service.install({id: 'skill.anthropic.frontend-design', sourceDirectory: source}), {code: 'INVALID_ARGUMENT'});
  assert.deepEqual(service.installations(), []);
});
