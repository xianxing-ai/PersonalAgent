import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {readLocalSkillDirectory} from '@personal-agent/skills';
import {
  createPluginCatalogService,
  createPluginSandbox,
  minimalPermissionHighRiskPlugin,
  minimalPermissionPositivePlugin,
  pluginEnableArgumentsDigest,
} from '../dist/index.js';

function workspace(t) {
  mkdirSync(path.resolve('.cache/plugin-catalog-tests'), {recursive: true});
  const root = mkdtempSync(path.join(path.resolve('.cache/plugin-catalog-tests'), 'minimal-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  return {
    root,
    skillStoreFile: path.join(root, 'skills.json'),
    installationFile: path.join(root, 'installed.json'),
  };
}

function writeSkill(directory, name) {
  const source = path.join(directory, name);
  mkdirSync(source, {recursive: true});
  writeFileSync(path.join(source, 'SKILL.md'), `---\nname: ${name}\ndescription: "Minimal permission positive fixture"\nmetadata:\n  version: "1.0.0"\n---\nNotes stay under notes/.\n`);
  return source;
}

test('minimal-permission positive plugin allows notes/ and rejects out-of-grant paths and symlinks', t => {
  const files = workspace(t);
  const source = writeSkill(files.root, 'fixture-minimal-notes');
  const bundle = readLocalSkillDirectory(source);
  const entry = minimalPermissionPositivePlugin({
    pin: {state: 'pinned', sha256: bundle.digest, sha256Subject: 'skill-bundle'},
    skillName: bundle.name,
  });
  assert.deepEqual(entry.permissionManifest.filePaths, ['notes']);
  assert.equal(entry.permissionManifest.networkHosts.length, 0);
  const service = createPluginCatalogService({...files, catalog: [entry]});
  service.install({id: entry.id, sourceDirectory: source});
  assert.equal(service.setEnabled(entry.id, true).enabled, true);
  const grant = entry.permissionManifest;
  const sandbox = createPluginSandbox({
    dataRoot: path.join(files.root, 'data'),
    violationFile: path.join(files.root, 'violations.json'),
    lookup: () => ({state: 'enabled', grant}),
  });
  assert.equal(sandbox.writeFile(entry.id, 'notes/a.txt', 'hello').allowed, true);
  assert.equal(readFileSync(path.join(files.root, 'data', entry.id, 'notes', 'a.txt'), 'utf8'), 'hello');
  assert.equal(sandbox.writeFile(entry.id, 'other/a.txt', 'no').allowed, false);
  assert.equal(sandbox.writeFile(entry.id, 'notes/../../outside.txt', 'no').allowed, false);
  const link = path.join(files.root, 'data', entry.id, 'notes', 'link.txt');
  const outside = path.join(files.root, 'outside-secret.txt');
  writeFileSync(outside, 'secret');
  try {
    symlinkSync(outside, link);
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EINVAL')) {
      t.skip('symlink creation unavailable on this host');
      return;
    }
    throw error;
  }
  assert.equal(sandbox.readFile(entry.id, 'notes/link.txt').allowed, false);
});

test('minimal-permission high-risk enable requires authorization readback', t => {
  const files = workspace(t);
  const source = writeSkill(files.root, 'fixture-minimal-notes-high');
  const bundle = readLocalSkillDirectory(source);
  const entry = minimalPermissionHighRiskPlugin({
    pin: {state: 'pinned', sha256: bundle.digest, sha256Subject: 'skill-bundle'},
    skillName: bundle.name,
  });
  const policy = new InMemoryAuthorizationPolicy();
  const service = createPluginCatalogService({...files, catalog: [entry], policy});
  service.install({id: entry.id, sourceDirectory: source});
  assert.throws(() => service.setEnabled(entry.id, true), {code: 'UNAUTHORIZED'});
  assert.equal(service.installations()[0].enabled, false);
  policy.grant({
    authorizationRef: 'auth-minimal',
    taskId: 'task-minimal',
    toolName: 'plugin-catalog.enable',
    scopes: ['plugin-catalog:enable'],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    maxUses: 1,
    argumentsDigest: pluginEnableArgumentsDigest(entry.id, bundle.digest),
  });
  assert.equal(service.setEnabled(entry.id, true, {authorizationRef: 'auth-minimal', taskId: 'task-minimal'}).enabled, true);
  assert.ok(createHash('sha256').update(bundle.digest).digest('hex').length === 64);
});
