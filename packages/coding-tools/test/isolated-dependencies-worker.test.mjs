import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {capturePreparedDependencyFingerprint} from '../dist/index.js';

// The prepared-dependency worker entry is spawned by isolated-dependencies.ts
// through an opaque workerData contract. The public tests only reach its happy
// path and ProtocolError replies, so the protocol itself is pinned here.
const workerEntry = new URL('../dist/isolated-dependencies-worker.js', import.meta.url);
const deadline = new Date(Date.now() + 60_000).toISOString();

async function workerReply(workerData) {
  return await new Promise((resolve, reject) => {
    const worker = new Worker(workerEntry, {workerData, env: {}, execArgv: []});
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', code => { if (code !== 0) reject(new Error(`dependency worker exited with ${code}`)); });
  });
}

test('an unknown operation is refused by the worker protocol itself', async t => {
  const reply = await workerReply({operation: 'unknown-operation', data: {}, buffer: new SharedArrayBuffer(4)});
  assert.deepEqual(reply, {error: {code: 'UNSUPPORTED_CAPABILITY', message: 'Unknown dependency operation'}});
});

test('a cancelled or expired flag settles the worker before any filesystem work', async t => {
  const cancelled = new SharedArrayBuffer(4);
  Atomics.store(new Int32Array(cancelled), 0, 1);
  assert.deepEqual(await workerReply({operation: 'fingerprint', data: {}, buffer: cancelled}),
    {error: {code: 'CANCELLED', message: 'Dependency operation cancelled'}});
  const expired = new SharedArrayBuffer(4);
  Atomics.store(new Int32Array(expired), 0, 2);
  assert.deepEqual(await workerReply({operation: 'fingerprint', data: {}, buffer: expired}),
    {error: {code: 'TIMEOUT', message: 'Dependency operation expired'}});
  assert.deepEqual(await workerReply({operation: 'fingerprint', data: {root: 'irrelevant'},
    buffer: new SharedArrayBuffer(4), deadline: new Date(0).toISOString()}),
    {error: {code: 'TIMEOUT', message: 'Dependency operation expired'}});
});

test('the async API turns an invalid deadline into TIMEOUT without spawning work', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'pa-dependency-deadline-'));
  t.after(() => rm(base, {recursive: true, force: true}));
  const source = path.join(base, 'source');
  await mkdir(source);
  await assert.rejects(capturePreparedDependencyFingerprint(source, {
    signal: new AbortController().signal, deadline: 'not-a-timestamp',
  }), {code: 'TIMEOUT'});
});

test('an unreadable dependency tree surfaces as one wrapped unsupported-capability error', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'pa-dependency-denied-'));
  t.after(() => rm(base, {recursive: true, force: true}));
  const source = path.join(base, 'source');
  await mkdir(source);
  await writeFile(path.join(source, 'package.json'), '{"name":"fixture"}');
  try {
    await chmod(source, 0o000);
    // A generic filesystem error never reaches the caller as a raw errno; the
    // worker reduces it to one stable unsupported-capability protocol error.
    await assert.rejects(capturePreparedDependencyFingerprint(source, {
      signal: new AbortController().signal, deadline,
    }), {code: 'UNSUPPORTED_CAPABILITY'});
  } finally {
    await chmod(source, 0o755);
  }
});
