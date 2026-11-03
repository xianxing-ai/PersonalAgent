import test from 'node:test';
import assert from 'node:assert/strict';
import {link, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {createIsolatedCodingRepairHost} from '../dist/index.js';

// Existing isolated-repair tests cover command- and publish-kind recovery; the
// interrupted-patch journal path is only reachable where the locked apply
// refuses to run, which the portable POSIX CI exercises without a helper host.
const hash = value => createHash('sha256').update(value).digest('hex');
const ctx = (overrides = {}) => ({taskId: 'parent-fixture', runId: 'run-' + randomUUID(),
  scopes: ['workspace:read', 'workspace:write', 'workspace:apply'],
  authorizationRef: 'explicit-fixture-outer-grant', argumentsDigest: hash('public synthetic outer invocation'),
  deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal, ...overrides});
const mathPatch = before => ({path: 'math.cjs', expectedSha256: hash(before), edits: [{oldText: 'a-b', newText: 'a+b'}]});

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pa-repair-patch-recovery-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const user = path.join(directory, 'user'), sessions = path.join(directory, 'sessions');
  await mkdir(user, {recursive: true});
  await writeFile(path.join(user, 'package.json'), JSON.stringify({name: 'fixture-project'}));
  await writeFile(path.join(user, 'math.cjs'), 'module.exports=(a,b)=>a-b;\n');
  const options = {workspaceRoot: user, sessionRoot: sessions, workspaceId: 'fixture-workspace',
    patch: {powerShellPath: 'C:/Program Files/PowerShell/7/pwsh.exe'},
    recipes: [{recipeId: 'node-test', packageIds: [], required: true}]};
  return {user, sessions, options, host: await createIsolatedCodingRepairHost(options)};
}

test('an interrupted locked patch stays in the journal and reconcile only clears an untouched readback', async t => {
  const f = await fixture(t), input = await f.host.start({mode: 'main', allowedPaths: ['math.cjs', 'created.cjs']}, ctx());
  const sessionId = input.session.sessionId, journalFile = path.join(f.sessions, sessionId, 'journal.json');
  const before = await readFile(path.join(f.user, 'math.cjs'), 'utf8'), runId = 'run-' + randomUUID();
  await assert.rejects(f.host.patch(sessionId, mathPatch(before), ctx({runId})), {code: 'UNSUPPORTED_CAPABILITY'});
  const interrupted = JSON.parse(await readFile(journalFile, 'utf8'));
  assert.equal(interrupted.unknown.kind, 'patch');
  assert.equal(interrupted.unknown.runId, runId);
  assert.equal(interrupted.pendingPatch.path, 'math.cjs');
  assert.equal(interrupted.pendingPatchAfterSha256, hash(before.replace('a-b', 'a+b')),
    'the original preview digest is retained for the stopped-process comparison');
  assert.equal(await readFile(path.join(f.user, 'math.cjs'), 'utf8'), before);
  assert.equal((await f.host.reconcile(sessionId, ctx())).state, 'clear',
    'a helper that exited without writing is cleared, never retried');
  assert.equal(JSON.parse(await readFile(journalFile, 'utf8')).unknown, undefined);
  const created = await f.host.patch(sessionId, {path: 'created.cjs', expectedSha256: null, edits: [],
    createText: 'export const value=1;\n'}, ctx());
  assert.equal(created.path, 'created.cjs', 'a reconciled session accepts new exact patches again');
  await assert.rejects(readFile(path.join(f.user, 'created.cjs')), {code: 'ENOENT'});
});

test('divergent isolated bytes after an interrupted patch stay unknown and block further writes', async t => {
  const f = await fixture(t), input = await f.host.start({mode: 'main'}, ctx());
  const sessionId = input.session.sessionId, journalFile = path.join(f.sessions, sessionId, 'journal.json');
  const before = await readFile(path.join(f.user, 'math.cjs'), 'utf8');
  await assert.rejects(f.host.patch(sessionId, mathPatch(before), ctx()), {code: 'UNSUPPORTED_CAPABILITY'});
  await writeFile(path.join(f.sessions, sessionId, 'workspace', 'math.cjs'), 'module.exports=(a,b)=>a*b;\n');
  assert.equal((await f.host.reconcile(sessionId, ctx())).state, 'unknown',
    'bytes that match neither the preview nor the baseline are unprovable');
  const journal = JSON.parse(await readFile(journalFile, 'utf8'));
  assert.equal(journal.unknown.kind, 'patch', 'an unknown recovery retains its journal for readback');
  await assert.rejects(f.host.patch(sessionId, mathPatch(before), ctx()), {code: 'RESULT_UNKNOWN'});
});

test('original-session recovery settles an interrupted patch without a new ToolContext or run', async t => {
  const f = await fixture(t), input = await f.host.start({mode: 'main'}, ctx());
  const sessionId = input.session.sessionId, journalFile = path.join(f.sessions, sessionId, 'journal.json');
  const before = await readFile(path.join(f.user, 'math.cjs'), 'utf8'), runId = 'run-' + randomUUID();
  await assert.rejects(f.host.patch(sessionId, mathPatch(before), ctx({runId})), {code: 'UNSUPPORTED_CAPABILITY'});
  const recovered = await f.host.reconcileOriginalSession({session: input, trialRunId: runId, expectedRevision: 1,
    deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal, assertCurrent() {}});
  assert.equal(recovered.state, 'clear');
  assert.equal(recovered.sessionId, sessionId);
  assert.equal(recovered.checkReadback.version, 1);
  assert.equal(recovered.checkReadback.snapshot.snapshotId, input.initialSnapshot.snapshotId);
  assert.deepEqual(recovered.checkReadback.verification, []);
  assert.equal(JSON.parse(await readFile(journalFile, 'utf8')).unknown, undefined,
    'a cleared original journal no longer reports an outstanding patch');
});

test('a multi-link repair journal refuses every operation until its binding is restored', async t => {
  const f = await fixture(t), input = await f.host.start({mode: 'main'}, ctx());
  const sessionId = input.session.sessionId, journalFile = path.join(f.sessions, sessionId, 'journal.json');
  const alias = journalFile + '.alias';
  try {
    await link(journalFile, alias);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) throw error;
    return;
  }
  try {
    await assert.rejects(f.host.snapshot(sessionId, ctx()), {code: 'REVISION_CONFLICT'});
    await assert.rejects(f.host.read(sessionId, {path: 'math.cjs'}, ctx()), {code: 'REVISION_CONFLICT'});
  } finally {
    await rm(alias, {force: true});
  }
  assert.equal((await f.host.snapshot(sessionId, ctx())).snapshotId, input.initialSnapshot.snapshotId,
    'restoring the single-link journal restores the session');
});
