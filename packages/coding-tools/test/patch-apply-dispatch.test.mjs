import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

// Exercise the actual built helper with explicitly fake process/filesystem
// boundaries. No helper execution, real workspace write or cloud call is made.
const source = await readFile(new URL('../dist/patch-apply.js', import.meta.url), 'utf8');
const checkStart = source.indexOf('function check(');
const helperStart = source.indexOf('async function invokeHelper(');
const helperEnd = source.indexOf('export function createWorkspacePatchApplyToolFromPreview(');
assert.ok(checkStart >= 0 && helperStart > checkStart && helperEnd > helperStart);
const inputDigest = source.match(/^const INPUT_DIGEST = .*;$/m)?.[0];
assert.ok(inputDigest);
const helperSource = `${inputDigest}\n${source.slice(checkStart, helperEnd)}\ninvokeHelper;`;

function createHarness({duringMarker, readyOutput} = {}) {
  const controller = new AbortController();
  let clock = 1_000;
  const sent = [];
  const timerDelays = [];
  let markerPresent = false;
  let markerCreates = 0;
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
    child.emit('close', code);
  };
  child.kill = () => { queueMicrotask(() => close(1)); return true; };
  child.stdin.end = value => {
    sent.push(value);
    queueMicrotask(() => {
      if (child.exitCode !== null) return;
      child.stdout.emit('data', Buffer.from('{"state":"applied"}'));
      close(0);
    });
  };
  class ProtocolError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const context = {
    taskId: 'task-dispatch-synthetic', runId: 'run-dispatch-synthetic', argumentsDigest: 'c'.repeat(64),
    scopes: ['workspace:read', 'workspace:write', 'workspace:apply'],
    signal: controller.signal,
    deadline: new Date(11_000).toISOString(),
  };
  const harness = {
    controller,
    setClock(value) { clock = value; },
    sent,
    timerDelays,
    get markerPresent() { return markerPresent; },
    get markerCreates() { return markerCreates; },
  };
  const invokeHelper = runInNewContext(helperSource, {
    spawn: () => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from(readyOutput ?? '{"type":"ready","pid":1234,"startTimeTicks":"6390000000000000000"}\n'));
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
    setTimeout(callback, delay) { timerDelays.push(delay); return setTimeout(callback, delay); },
    clearTimeout,
    openSync() { markerPresent = true; markerCreates++; return 10; },
    writeSync() {},
    fsyncSync() { duringMarker?.(harness); },
    closeSync() {},
    async unlink() { markerPresent = false; },
  });
  harness.start = () => invokeHelper('trusted-pwsh.exe', 'locked-apply.ps1', undefined, {
    rootPath: 'synthetic-root', sourcePath: 'synthetic-root/repair.txt',
    backupPath: 'synthetic-recovery/attempt.bak', beforeSha256: 'a'.repeat(64),
    afterSha256: 'b'.repeat(64), afterBase64: 'YWZ0ZXI=',
  }, 'synthetic-recovery/source.inflight', context, () => clock);
  return harness;
}

for (const change of ['cancel', 'expire']) {
  test(`apply sends no candidate after ${change} during helper READY handshake`, async () => {
    const harness = createHarness();
    const result = harness.start().then(value => ({value}), error => ({error}));
    if (change === 'cancel') harness.controller.abort();
    else harness.setClock(11_000);
    const settled = await result;
    assert.equal(harness.sent.length, 0, 'no candidate bytes may leave stdin');
    assert.equal(harness.markerCreates, 0, 'do not create an apply marker after failed preflight');
    assert.ok(settled.error, 'changed preconditions must reject');
  });

  test(`apply sends no candidate after ${change} while persisting its marker`, async () => {
    const harness = createHarness({duringMarker(current) {
      if (change === 'cancel') current.controller.abort();
      else current.setClock(11_000);
    }});
    const result = harness.start().then(value => ({value}), error => ({error}));
    const settled = await result;
    assert.equal(harness.sent.length, 0, 'no candidate bytes may leave stdin');
    assert.equal(harness.markerPresent, false, 'confirmed helper close clears this attempt marker');
    assert.ok(settled.error, 'changed preconditions must reject');
  });
}

for (const [label, readyOutput] of [
  ['duplicate READY', '{"type":"ready","pid":1234,"startTimeTicks":"6390000000000000000"}\n{"type":"ready","pid":1234,"startTimeTicks":"6390000000000000000"}\n'],
  ['noise after READY', '{"type":"ready","pid":1234,"startTimeTicks":"6390000000000000000"}\nnoise\n'],
]) {
  test('apply rejects ' + label + ' before marker or candidate dispatch', async () => {
    const harness = createHarness({readyOutput});
    const settled = await harness.start().then(value => ({value}), error => ({error}));
    assert.equal(harness.sent.length, 0, 'no candidate bytes may leave stdin');
    assert.equal(harness.markerCreates, 0, 'preflight output must not create an apply marker');
    assert.equal(harness.markerPresent, false);
    assert.equal(settled.error?.code, 'RESULT_UNKNOWN');
  });
}

test('apply dispatch timer uses the remaining budget after helper READY', async () => {
  const harness = createHarness();
  const result = harness.start();
  harness.setClock(10_000);
  assert.equal((await result).state, 'applied');
  assert.equal(harness.timerDelays.at(-1), 1000);
  assert.equal(harness.sent.length, 1);
});

test('valid apply still sends exactly once and clears its marker on close', async () => {
  const harness = createHarness();
  const result = harness.start();
  assert.equal((await result).state, 'applied');
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.markerCreates, 1);
  assert.equal(harness.markerPresent, false);
});


test('failed helper spawn rejects without an unhandled process error', () => {
  // Isolate the real ENOENT event: the unpatched helper terminates its process.
  // No helper executable, workspace write or external service is used.
  const fixture = `
    import {spawn} from 'node:child_process';
    import {randomUUID} from 'node:crypto';
    import {readFileSync} from 'node:fs';
    import {tmpdir} from 'node:os';
    import {join} from 'node:path';
    import {runInNewContext} from 'node:vm';
    class ProtocolError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    const invoke = runInNewContext(readFileSync(0, 'utf8'), {
      spawn, ProtocolError, Buffer, setTimeout, clearTimeout, process: {env: {}},
      WORKSPACE_PATCH_APPLY_SCOPE: 'workspace:apply', MAX_HELPER_OUTPUT_BYTES: 8192,
      STOP_GRACE_MS: 2000,});
    const controller = new AbortController();
    try {
      await invoke(join(tmpdir(), 'pa-missing-helper-' + randomUUID() + '.exe'),
        'unused.ps1', undefined, {rootPath: process.cwd()}, 'unused.inflight', {
          taskId: 'task-dispatch-synthetic', runId: 'run-dispatch-synthetic', argumentsDigest: 'c'.repeat(64),
          scopes: ['workspace:read', 'workspace:write', 'workspace:apply'],
          signal: controller.signal, deadline: new Date(Date.now() + 10000).toISOString(),
        }, Date.now);
      process.exitCode = 3;
    } catch (error) {
      if (error?.code !== 'RESULT_UNKNOWN') process.exitCode = 4;
      else process.stdout.write('RESULT_UNKNOWN');
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', fixture], {
    input: helperSource, encoding: 'utf8', timeout: 10000, detached: true, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'RESULT_UNKNOWN');
});
