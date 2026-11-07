import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rename, symlink, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {hasPreparedCodingDependenciesSync} from '../dist/isolated-dependencies-internal.js';

// Only the small manifest probe is exercised here; the full prepare/fingerprint
// lifecycle is covered end-to-end by isolated-dependencies.test.mjs through the
// public worker-backed API. These cases pin the manifest branches it relies on.
async function manifestFixture(t, manifest) {
  const root = await mkdtemp(path.join(tmpdir(), 'pa-deps-manifest-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  if (manifest !== undefined) {
    await writeFile(path.join(root, 'package.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  }
  return root;
}

test('reports false when the manifest is absent or declares no dependencies', async t => {
  assert.equal(hasPreparedCodingDependenciesSync(await manifestFixture(t, undefined)), false);
  assert.equal(hasPreparedCodingDependenciesSync(await manifestFixture(t, {name: 'fixture', version: '1.0.0'})), false);
  assert.equal(hasPreparedCodingDependenciesSync(await manifestFixture(t, {name: 'fixture', dependencies: {}})), false);
  assert.equal(hasPreparedCodingDependenciesSync(await manifestFixture(t, {name: 'fixture', workspaces: []})), false);
});

test('reports true for any dependency group or workspace declaration', async t => {
  const cases = [
    {name: 'fixture', dependencies: {'fixture-lib': '^1.0.0'}},
    {name: 'fixture', devDependencies: {'fixture-lib': '^1.0.0'}},
    {name: 'fixture', optionalDependencies: {'fixture-lib': '^1.0.0'}},
    {name: 'fixture', peerDependencies: {'fixture-lib': '^1.0.0'}},
    {name: 'fixture', workspaces: ['packages/*']},
    {name: 'fixture', workspaces: {packages: ['packages/*']}},
  ];
  for (const manifest of cases) {
    assert.equal(hasPreparedCodingDependenciesSync(await manifestFixture(t, manifest)), true, JSON.stringify(manifest));
  }
});

test('rejects malformed or non-object dependency declarations', async t => {
  const cases = [
    {dependencies: 'fixture-lib'},                     // string instead of an object
    {dependencies: ['fixture-lib']},                   // array instead of an object
    {dependencies: {'fixture-lib': 1}},                // non-string version range
    {devDependencies: {'fixture-lib': null}},          // non-string devDependency
  ];
  for (const manifest of cases) {
    const root = await manifestFixture(t, manifest);
    assert.throws(
      () => hasPreparedCodingDependenciesSync(root),
      error => error.code === 'UNSUPPORTED_CAPABILITY',
      JSON.stringify(manifest),
    );
  }
});

test('rejects unreadable manifests instead of reporting them as prepared', async t => {
  const malformedRoot = await manifestFixture(t, '{not-json');
  assert.throws(
    () => hasPreparedCodingDependenciesSync(malformedRoot),
    error => error.code === 'UNSUPPORTED_CAPABILITY',
  );
  const root = await mkdtemp(path.join(tmpdir(), 'pa-deps-manifest-dir-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'package.json'));
  assert.throws(() => hasPreparedCodingDependenciesSync(root), error => error.code === 'UNSUPPORTED_CAPABILITY');

  const linkedRoot = await manifestFixture(t, {name: 'fixture', dependencies: {'fixture-lib': '^1.0.0'}});
  await rename(path.join(linkedRoot, 'package.json'), path.join(linkedRoot, 'real.json'));
  await symlink('real.json', path.join(linkedRoot, 'package.json'));
  assert.throws(() => hasPreparedCodingDependenciesSync(linkedRoot), error => error.code === 'UNSUPPORTED_CAPABILITY');
});
