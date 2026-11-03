import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createWorkspaceCreateTextTool, reconcileWorkspaceCreateText} from '../dist/index.js';
import {workspacePatchInflightPathFromCanonical} from '../dist/patch-reconcile.js';

// The existing workspace-create-text tests run behind a Windows PowerShell helper
// and skip everywhere else. reconcileWorkspaceCreateText is a pure filesystem
// readback, so its state machine is pinned here portably, including on POSIX CI.
const sha = value => createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
const digest = 'a'.repeat(64);
const relativePath = 'src/reconcile.txt';
const expectedSha256 = sha('expected\n');

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-create-reconcile-'));
  t.after(() => rm(base, {recursive: true, force: true}));
  const root = join(base, 'workspace');
  const recoveryRootPath = join(base, 'trusted-recovery');
  await mkdir(join(root, 'src'), {recursive: true});
  await mkdir(recoveryRootPath);
  return {base, root, recoveryRootPath};
}

const reconcile = (f, overrides = {}) => reconcileWorkspaceCreateText({
  rootPath: f.root, recoveryRootPath: f.recoveryRootPath, relativePath,
  expectedRunId: 'create-run-1', expectedArgumentsDigest: digest, expectedSha256, ...overrides,
});

async function writeMarker(f, overrides = {}, content) {
  const marker = workspacePatchInflightPathFromCanonical(f.root, f.recoveryRootPath, relativePath);
  await writeFile(marker, content ?? JSON.stringify({
    operation: 'create', runId: 'create-run-1', argumentsDigest: digest,
    pid: 4242, startTimeTicks: '133500000000000000', afterSha256: expectedSha256, ...overrides,
  }));
  return marker;
}

test('a missing or foreign marker never touches the target', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, relativePath), 'expected\n');
  assert.equal(reconcile(f).state, 'clear', 'no marker means nothing to reconcile');
  await writeMarker(f, {runId: 'other-run'});
  assert.throws(() => reconcile(f), {code: 'REVISION_CONFLICT'});
  await writeMarker(f, {argumentsDigest: 'b'.repeat(64)});
  assert.throws(() => reconcile(f), {code: 'REVISION_CONFLICT'});
  await writeMarker(f, {afterSha256: sha('different\n')});
  assert.throws(() => reconcile(f), {code: 'REVISION_CONFLICT'});
  await writeMarker(f, {operation: 'apply'});
  assert.throws(() => reconcile(f), {code: 'REVISION_CONFLICT'});
  await writeMarker(f, {}, 'not-json');
  assert.throws(() => reconcile(f), {code: 'RESULT_UNKNOWN'});
  assert.equal(await readFile(join(f.root, relativePath), 'utf8'), 'expected\n',
    'rejections never modify the target');
});

test('a confirmed create is reconciled once and an unprovable outcome retains its marker', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, relativePath), 'expected\n');
  const marker = await writeMarker(f);
  const created = reconcile(f);
  assert.deepEqual(created, {path: relativePath, state: 'reconciled', runId: 'create-run-1',
    argumentsDigest: digest, outcome: 'created', currentSha256: expectedSha256});
  assert.equal(existsSync(marker), false, 'a created outcome removes its marker');
  await writeMarker(f);
  assert.equal(reconcile(f, {retainMarker: true}).outcome, 'created');
  assert.equal(existsSync(marker), true, 'retainMarker keeps the marker for the outer Runtime');
  assert.throws(() => reconcile(f, {expectedRunId: 'other-run'}), {code: 'REVISION_CONFLICT'});
  assert.equal(existsSync(marker), true, 'a foreign reconcile never deletes the marker it does not own');

  await writeFile(join(f.root, relativePath), 'someone else\n');
  const unknown = reconcile(f);
  assert.equal(unknown.state, 'reconciled');
  assert.equal(unknown.outcome, 'unknown');
  assert.equal(unknown.currentSha256, sha('someone else\n'), 'the divergent bytes are reported, never rolled back');
  assert.equal(existsSync(marker), true, 'an unknown outcome retains its marker');

  await rm(join(f.root, relativePath));
  await mkdir(join(f.root, relativePath));
  const directory = reconcile(f);
  assert.equal(directory.outcome, 'unknown');
  assert.equal(directory.currentSha256, undefined, 'a non-file target has no content digest');
});

test('a missing target distinguishes a live creator process from a confirmed not_created', async t => {
  const f = await fixture(t);
  let marker = await writeMarker(f);
  assert.equal(reconcile(f, {isProcessAlive: () => true}).state, 'in_progress');
  assert.equal(existsSync(marker), true, 'a live creator keeps its marker');
  const notCreated = reconcile(f, {isProcessAlive: () => false});
  assert.equal(notCreated.outcome, 'not_created');
  assert.equal(existsSync(marker), false, 'a dead creator without bytes resolves to not_created');
  await writeMarker(f);
  assert.equal(reconcile(f).state, 'in_progress', 'without a process probe an absent target stays in_progress');
  await writeMarker(f, {pid: 'not-a-number'});
  assert.equal(reconcile(f, {isProcessAlive: () => false}).state, 'in_progress',
    'an unusable process identity never fabricates a not_created outcome');
});

test('locked workspace create stays an explicit Windows capability', {skip: process.platform === 'win32' ? 'the construction gate only rejects on POSIX' : false}, async t => {
  assert.throws(() => createWorkspaceCreateTextTool({
    rootPath: '/tmp/pa-create-root', recoveryRootPath: '/tmp/pa-create-recovery', powerShellPath: '/bin/pwsh',
  }), {code: 'UNSUPPORTED_CAPABILITY'});
});
