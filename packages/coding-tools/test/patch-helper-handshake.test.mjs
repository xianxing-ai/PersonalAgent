import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

// This test deliberately uses the same isolated helper harness as
// patch-apply-dispatch.test.mjs. It does not start PowerShell, write a real
// workspace, or call a remote service.
const source = await readFile(new URL('../dist/patch-apply.js', import.meta.url), 'utf8');
const checkStart = source.indexOf('function check(');
const helperStart = source.indexOf('async function invokeHelper(');
const helperEnd = source.indexOf('export function createWorkspacePatchApplyToolFromPreview(');
assert.ok(checkStart >= 0 && helperStart > checkStart && helperEnd > helperStart);
const inputDigest = source.match(/^const INPUT_DIGEST = .*;$/m)?.[0];
assert.ok(inputDigest);
const helperSource = `${inputDigest}\n${source.slice(checkStart, helperEnd)}\ninvokeHelper;`;

function createHarness({finalOutput = '{"state":"applied"}', finalCode = 0, readyTail = ''} = {}) {
  const controller = new AbortController();
  let markerPresent = false;
  let markerCreates = 0;
  let unlinkCalls = 0;
  const sent = [];
  const child = new EventEmitter();
  child.pid = 1234;
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream.destroy = () => {};
  const close = code => {
    if (child.exitCode !== null) return;
    child.exitCode = code;
    child.emit('close', code, null);
  };
  child.kill = () => { queueMicrotask(() => close(1)); return true; };
  child.stdin.end = value => {
    sent.push(value);
    queueMicrotask(() => {
      if (child.exitCode !== null) return;
      child.stdout.emit('data', Buffer.from(finalOutput, 'utf8'));
      close(finalCode);
    });
  };
  class ProtocolError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const context = {
    taskId: 'task-handshake-synthetic',
    runId: 'run-handshake-synthetic',
    argumentsDigest: 'c'.repeat(64),
    scopes: ['workspace:read', 'workspace:write', 'workspace:apply'],
    signal: controller.signal,
    deadline: new Date(Date.now() + 60_000).toISOString(),
  };
  const harness = {
    controller,
    context,
    sent,
    get markerPresent() { return markerPresent; },
    get markerCreates() { return markerCreates; },
    get unlinkCalls() { return unlinkCalls; },
  };
  const invokeHelper = runInNewContext(helperSource, {
    spawn: () => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from(
          `{"type":"ready","pid":1234,"startTimeTicks":"6390000000000000000"}\n${readyTail}`,
          'utf8',
        ));
      });
      return child;
    },
    parseWorkspacePatchProcessReady(value, expectedPid) {
      if (!value || value.type !== 'ready' || value.pid !== expectedPid
        || typeof value.startTimeTicks !== 'string') {
        throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper READY frame is invalid');
      }
      return {pid: expectedPid, startTimeTicks: value.startTimeTicks};
    },
    ProtocolError,
    WORKSPACE_PATCH_APPLY_SCOPE: 'workspace:apply',
    MAX_HELPER_OUTPUT_BYTES: 8192,
    STOP_GRACE_MS: 2000,
    process: {env: {}},
    Buffer,
    setTimeout,
    clearTimeout,
    openSync() { markerPresent = true; markerCreates++; return 10; },
    writeSync() {},
    fsyncSync() {},
    closeSync() {},
    async unlink() { unlinkCalls++; markerPresent = false; },
  });
  harness.start = () => invokeHelper(
    'trusted-pwsh.exe',
    'locked-apply.ps1',
    undefined,
    {
      rootPath: 'synthetic-root',
      sourcePath: 'synthetic-root/repair.txt',
      backupPath: 'synthetic-recovery/attempt.bak',
      beforeSha256: 'a'.repeat(64),
      afterSha256: 'b'.repeat(64),
      afterBase64: 'YWZ0ZXI=',
    },
    'synthetic-recovery/source.inflight',
    context,
    () => Date.now(),
  );
  return harness;
}

test('candidate sent then invalid final keeps the in-flight marker for reconciliation', async () => {
  const harness = createHarness({finalOutput: 'not-json'});
  const settled = harness.start().then(
    value => ({value}),
    error => ({error}),
  );
  const result = await settled;
  assert.equal(harness.sent.length, 1, 'candidate bytes must be sent once');
  assert.equal(harness.markerCreates, 1, 'marker must be durable before candidate bytes');
  assert.equal(harness.markerPresent, true, 'unknown final outcome must retain marker');
  assert.equal(harness.unlinkCalls, 0, 'unknown final outcome must not acknowledge marker');
  assert.equal(result.error?.code, 'RESULT_UNKNOWN');
});

for (const [label, readyTail] of [
  ['duplicate READY', '{"type":"ready","pid":1234,"startTimeTicks":"6390000000000000000"}\n'],
  ['unexpected noise', 'diagnostic noise\n'],
  ['premature final receipt', '{"state":"applied"}\n'],
]) {
  test(`same stdout chunk ${label} cannot send a candidate or create a marker`, async () => {
    const harness = createHarness({readyTail});
    const result = await harness.start().then(
      value => ({value}),
      error => ({error}),
    );
    assert.equal(harness.sent.length, 0, 'invalid post-READY output must not send candidate bytes');
    assert.equal(harness.markerCreates, 0, 'invalid post-READY output must not create a marker');
    assert.equal(harness.markerPresent, false, 'invalid post-READY output must leave no marker');
    assert.equal(result.error?.code, 'RESULT_UNKNOWN');
  });
}

const sha = value => createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');

async function legacyFixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'personal-agent-handshake-'));
  const rootPath = join(base, 'workspace');
  const recoveryRootPath = join(base, 'trusted-recovery');
  const relativePath = 'src/note.txt';
  const sourcePath = join(rootPath, relativePath);
  await mkdir(join(rootPath, 'src'), {recursive: true});
  await mkdir(recoveryRootPath, {recursive: true});
  await writeFile(sourcePath, 'before\n', 'utf8');
  t.after(() => rm(base, {recursive: true, force: true}));
  return {rootPath, recoveryRootPath, relativePath, sourcePath};
}

test('legacy three-field marker remains UNKNOWN and is not removed', async t => {
  const {reconcileWorkspacePatchApply} = await import('../dist/index.js');
  const {workspacePatchInflightPath} = await import('../dist/patch-reconcile.js');
  const fixture = await legacyFixture(t);
  const markerPath = workspacePatchInflightPath(
    fixture.rootPath,
    fixture.recoveryRootPath,
    fixture.relativePath,
  );
  const marker = {
    pid: null,
    beforeSha256: sha('before\n'),
    afterSha256: sha('after\n'),
  };
  const markerText = JSON.stringify(marker);
  await writeFile(markerPath, markerText, 'utf8');
  const sourceBefore = await readFile(fixture.sourcePath);
  await assert.rejects(
    reconcileWorkspacePatchApply(fixture),
    error => error?.code === 'RESULT_UNKNOWN',
  );
  assert.equal(await readFile(markerPath, 'utf8'), markerText);
  assert.deepEqual(await readFile(fixture.sourcePath), sourceBefore);
});
