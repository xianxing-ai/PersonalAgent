import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, realpath, writeFile, symlink, link, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os'; // realpath(tmpdir()) keeps destination === canonical path on macOS-style tmp mounts
import path from 'node:path';
import {
  codingRepairFilePath,
  codingRepairPackageGraphDigest,
  codingRepairRelativePath,
  codingRepairVerificationState,
  repairSha256,
} from '../dist/repair-verification.js';

test('repairSha256 produces the SHA-256 hex digest of text or bytes', () => {
  assert.equal(repairSha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(repairSha256(new TextEncoder().encode('abc')), repairSha256('abc'));
});

test('codingRepairRelativePath accepts plain canonical source paths', () => {
  assert.equal(codingRepairRelativePath('src/index.ts'), 'src/index.ts');
  assert.equal(codingRepairRelativePath('docs/readme.md'), 'docs/readme.md');
  assert.equal(codingRepairRelativePath('a/b/c.ts'), 'a/b/c.ts');
});

test('codingRepairRelativePath refuses paths outside the supported source scope', () => {
  const invalid = [
    '',                       // empty
    '/etc/passwd',            // absolute
    'C:\\tmp\\x.ts',          // drive-qualified
    'src\\index.ts',          // backslash separator
    'src:stream',             // alternate data stream separator
    'a\0b',                   // NUL byte
    'a//b',                   // empty segment
    './src',                  // current-directory segment
    'src/../..',              // parent segment
    'src/',                   // trailing empty segment
    'src/./main.ts',          // current-directory segment mid-path
    'name./x.ts',             // trailing dot segment
    'name /x.ts',             // trailing space segment
    'CON',                    // reserved device name
    'com1.txt',               // reserved device name before an extension
    'node_modules/lib/index.js', // dependency output
    '.git/config',            // VCS metadata
    '.env',                   // DotEnv material
    '.env.local',             // DotEnv material with a suffix
    'id_rsa',                 // private key material
    'keys/server.pem',        // private key extension
  ];
  for (const value of invalid) {
    assert.throws(() => codingRepairRelativePath(value), error => error.code === 'SCOPE_DENIED', `expected rejection for ${JSON.stringify(value)}`);
  }
});

test('codingRepairFilePath resolves existing single-link regular files inside the root', async t => {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'pa-repair-verify-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'sub', 'deep'), {recursive: true});
  await writeFile(path.join(root, 'src', 'index.ts'), 'export {};\n');
  await writeFile(path.join(root, 'sub', 'deep', 'file.txt'), 'text\n');

  assert.equal(await codingRepairFilePath(root, 'src/index.ts'), path.join(root, 'src', 'index.ts'));
  assert.equal(await codingRepairFilePath(root, 'sub/deep/file.txt'), path.join(root, 'sub', 'deep', 'file.txt'));
});

test('codingRepairFilePath handles missing paths according to allowMissing', async t => {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'pa-repair-verify-'));
  t.after(() => rm(root, {recursive: true, force: true}));

  await assert.rejects(codingRepairFilePath(root, 'ghost.txt'), error => error.code === 'ENOENT');
  assert.equal(await codingRepairFilePath(root, 'ghost.txt', true), path.join(root, 'ghost.txt'));
  assert.equal(await codingRepairFilePath(root, 'no/such/file.txt', true), path.join(root, 'no', 'such', 'file.txt'));
});

test('codingRepairFilePath refuses escapes, links, multi-link files and directories', async t => {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'pa-repair-verify-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'index.ts'), 'export {};\n');
  await writeFile(path.join(root, 'plain.txt'), 'text\n');
  await symlink('src', path.join(root, 'link-dir'));
  await symlink('src/index.ts', path.join(root, 'src', 'link.ts'));
  await link(path.join(root, 'plain.txt'), path.join(root, 'plain-hard.txt'));

  await assert.rejects(codingRepairFilePath(root, '../outside.txt'), error => error.code === 'SCOPE_DENIED');
  await assert.rejects(codingRepairFilePath(root, '/etc/passwd'), error => error.code === 'SCOPE_DENIED');
  await assert.rejects(codingRepairFilePath(root, 'src/link.ts'), error => error.code === 'SCOPE_DENIED');
  await assert.rejects(codingRepairFilePath(root, 'link-dir/index.ts'), error => error.code === 'SCOPE_DENIED');
  await assert.rejects(codingRepairFilePath(root, 'plain-hard.txt'), error => error.code === 'SCOPE_DENIED');
  await assert.rejects(codingRepairFilePath(root, 'src'), error => error.code === 'SCOPE_DENIED');
});

const pkg = (id, pkgPath, dependencies) => ({id, path: pkgPath, dependencies});
const file = (pkgPath, name, sha256) => ({path: `${pkgPath}/${name}`, sha256, packageId: `pkg:${pkgPath}`, kind: 'source'});

test('codingRepairPackageGraphDigest is order-independent for packages and dependencies', () => {
  const snapshot = packages => ({snapshotId: 'snap-1', files: [], packages});
  const digest = codingRepairPackageGraphDigest(snapshot([
    pkg('pkg:b', 'b', ['pkg:a']),
    pkg('pkg:a', 'a', []),
  ]));
  assert.equal(digest, codingRepairPackageGraphDigest(snapshot([
    pkg('pkg:a', 'a', []),
    pkg('pkg:b', 'b', ['pkg:a']),
  ])));
  assert.notEqual(digest, codingRepairPackageGraphDigest(snapshot([
    pkg('pkg:a', 'a', []),
    pkg('pkg:b', 'b', []),
  ])));
});

const basePackages = () => [pkg('root', '', []), pkg('pkg:a', 'a', []), pkg('pkg:b', 'b', [])];
const originalSnapshot = () => ({snapshotId: 'snap-orig',
  files: [file('a', 'index.ts', 'a'.repeat(64)), file('b', 'index.ts', 'b'.repeat(64))], packages: basePackages()});
const changedCurrent = () => ({snapshotId: 'snap-current',
  files: [file('a', 'index.ts', 'c'.repeat(64)), file('b', 'index.ts', 'b'.repeat(64))], packages: basePackages()});
const receipt = (status, packageIds, inputSnapshotId, exitCode = status === 'FAILED' ? 1 : 0) =>
  ({version: 1, sessionId: 'session', runId: 'run', recipeId: 'recipe', packageIds, inputSnapshotId, files: [],
    exitCode, status, evidenceRefs: [], diagnostics: []});

test('codingRepairVerificationState keeps terminal FAILED and UNKNOWN receipts', () => {
  const current = {snapshot: changedCurrent(), graphKnown: true};
  assert.equal(codingRepairVerificationState(receipt('FAILED', ['pkg:a'], 'snap-orig', 1), current), 'FAILED');
  assert.equal(codingRepairVerificationState(receipt('UNKNOWN', ['pkg:a'], 'snap-orig', null), current), 'UNKNOWN');
});

test('codingRepairVerificationState marks receipts captured against a foreign snapshot as STALE', () => {
  const current = {snapshot: changedCurrent(), graphKnown: true};
  assert.equal(codingRepairVerificationState(receipt('VALID', [], 'snap-orig'), current), 'STALE');
});

test('codingRepairVerificationState trusts receipts captured against the current snapshot', () => {
  const current = {snapshot: changedCurrent(), graphKnown: true};
  assert.equal(codingRepairVerificationState(receipt('VALID', [], 'snap-current'), current), 'VALID');
});

test('codingRepairVerificationState compares receipts against the provided original snapshot', () => {
  const current = {snapshot: changedCurrent(), graphKnown: true};
  const original = originalSnapshot();
  assert.equal(codingRepairVerificationState(receipt('VALID', ['pkg:a'], 'snap-current'), current, original), 'STALE');
  assert.equal(codingRepairVerificationState(receipt('VALID', ['pkg:b'], 'snap-current'), current, original), 'VALID');
  // Even a foreign inputSnapshotId is forgiven when the original snapshot is supplied explicitly.
  assert.equal(codingRepairVerificationState(receipt('VALID', ['pkg:b'], 'snap-orig'), current, original), 'VALID');
});

test('codingRepairVerificationState invalidates every covered package on an unknown graph', () => {
  const current = {snapshot: changedCurrent(), graphKnown: false};
  assert.equal(codingRepairVerificationState(receipt('VALID', ['pkg:b'], 'snap-current'), current, originalSnapshot()), 'STALE');
});

test('codingRepairVerificationState propagates changes through reverse production dependencies', () => {
  const packages = [pkg('root', '', []), pkg('pkg:a', 'a', []), pkg('pkg:b', 'b', ['pkg:a'])];
  const original = {snapshotId: 'snap-orig',
    files: [file('a', 'index.ts', 'a'.repeat(64)), file('b', 'index.ts', 'b'.repeat(64))], packages};
  const current = {snapshotId: 'snap-current',
    files: [file('a', 'index.ts', 'c'.repeat(64)), file('b', 'index.ts', 'b'.repeat(64))], packages};
  assert.equal(codingRepairVerificationState(receipt('VALID', ['pkg:b'], 'snap-current'), {snapshot: current, graphKnown: true}, original), 'STALE');
});
