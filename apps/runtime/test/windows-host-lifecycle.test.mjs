import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createWindowsHostBridgeTransport, createWindowsHostNotepadAdapter}
  from '../dist/application/windows-host-adapter.js';

const deadline = () => new Date(Date.now() + 30_000).toISOString();
const signal = () => new AbortController().signal;
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
function fixture({presence = async () => true, closeFails = false, now} = {}) {
  let opens = 0;
  let closes = 0;
  let transportCloses = 0;
  const sent = [];
  const transport = {
    async openVerifiedConnection() {
      const sessionId = `synthetic-session-${++opens}`;
      return {
        async send(frame) { sent.push(frame); },
        async exchange(frame) {
          sent.push(frame);
          if (frame.kind === 'hello') return {kind: 'hello_ack', protocolVersion: '0.1.0',
            requestId: frame.requestId, clientNonce: frame.clientNonce, hostNonce: 'a'.repeat(32), sessionId};
          if (frame.kind === 'observe') return {kind: 'observed', protocolVersion: '0.1.0',
            requestId: frame.requestId, sessionId, targetRef: 'synthetic-target-123456',
            expiresAt: deadline(), source: 'windows-uia'};
          throw new Error('Unexpected synthetic frame');
        },
        async close() { closes++; if (closeFails) throw new Error('synthetic private close failure'); },
      };
    },
    async close() { transportCloses++; },
  };
  const adapter = createWindowsHostNotepadAdapter({transport, now,
    attempts: {async record() {}, async read() {return undefined;}}, authorizePresence: presence});
  return {adapter, sent, get opens() {return opens;}, get closes() {return closes;},
    get transportCloses() {return transportCloses;}};
}

test('observation reserves one session before awaiting presence', async () => {
  const gate = deferred();
  const f = fixture({presence: () => gate.promise});
  const first = f.adapter.observe('first', deadline(), signal());
  const second = f.adapter.observe('second', deadline(), signal()).then(value => ({value}), error => ({error}));
  try {
    gate.resolve(true);
    await first;
    assert.equal((await second).error?.code, 'REVISION_CONFLICT');
    assert.equal(f.opens, 1);
  } finally { gate.resolve(true); await Promise.allSettled([first, second]); await f.adapter.close(); }
});

test('closing during presence verification cannot create a late Host session', async () => {
  const gate = deferred();
  const f = fixture({presence: () => gate.promise});
  const pending = f.adapter.observe('first', deadline(), signal()).then(value => ({value}), error => ({error}));
  try {
    await f.adapter.close();
    gate.resolve(true);
    assert.equal((await pending).error?.code, 'UNSUPPORTED_CAPABILITY');
    assert.equal(f.opens, 0);
  } finally {gate.resolve(true); await pending; await f.adapter.close();}
});

test('cancelling during presence verification cannot create a late Host session', async () => {
  const gate = deferred();
  const controller = new AbortController();
  const f = fixture({presence: () => gate.promise});
  const pending = f.adapter.observe('first', deadline(), controller.signal)
    .then(value => ({value}), error => ({error}));
  try {
    controller.abort();
    gate.resolve(true);
    assert.equal((await pending).error?.code, 'CANCELLED');
    assert.equal(f.opens, 0);
    assert.deepEqual(f.sent, []);
    await f.adapter.observe('second', deadline(), signal());
    assert.equal(f.opens, 1);
  } finally {gate.resolve(true); await pending; await f.adapter.close();}
});

test('expiry during presence verification cannot create a late Host session', async () => {
  const gate = deferred();
  let current = Date.now();
  const expiresAt = new Date(current + 30_000).toISOString();
  const f = fixture({presence: () => gate.promise, now: () => current});
  const pending = f.adapter.observe('first', expiresAt, signal())
    .then(value => ({value}), error => ({error}));
  try {
    current = Date.parse(expiresAt);
    gate.resolve(true);
    assert.equal((await pending).error?.code, 'TIMEOUT');
    assert.equal(f.opens, 0);
    assert.deepEqual(f.sent, []);
  } finally {gate.resolve(true); await pending; await f.adapter.close();}
});

test('denied presence releases the reservation without opening a Host', async () => {
  let allowed = false;
  const f = fixture({presence: async () => allowed});
  try {
    await assert.rejects(f.adapter.observe('first', deadline(), signal()), {code: 'UNAUTHORIZED'});
    assert.equal(f.opens, 0);
    allowed = true;
    await f.adapter.observe('second', deadline(), signal());
    assert.equal(f.opens, 1);
  } finally {await f.adapter.close();}
});

test('an unconfirmed connection release blocks reuse and remains visible on repeated close', async () => {
  const f = fixture({closeFails: true});
  try {
    await f.adapter.observe('first', deadline(), signal());
    await assert.rejects(f.adapter.releaseObservation('first'));
    await assert.rejects(f.adapter.observe('second', deadline(), signal()), {code: 'EXTERNAL_FAILURE'});
    await assert.rejects(f.adapter.close(), {code: 'EXTERNAL_FAILURE'});
    await assert.rejects(f.adapter.close(), {code: 'EXTERNAL_FAILURE'});
    assert.equal(f.opens, 1);
    assert.equal(f.closes, 1);
    assert.equal(f.transportCloses, 1);
  } finally {await f.adapter.close().catch(() => {});}
});

test('returned target data cannot mutate the privately bound observation', async () => {
  const f = fixture();
  try {
    const target = await f.adapter.observe('first', deadline(), signal());
    target.targetRef = 'synthetic-forged-target';
    await assert.rejects(f.adapter.tool.execute({...target, expectedText: 'old', replacementText: 'new'},
      {taskId: 'first', runId: 'synthetic-run', authorizationRef: 'synthetic-grant',
        deadline: deadline(), signal: signal(), scopes: ['computer:notepad:write']}), {code: 'UNAUTHORIZED'});
    assert.equal(f.sent.some(frame => frame.kind === 'execute'), false);
  } finally {await f.adapter.close();}
});

// These tests mock the child process and platform, not a real Windows Pipe peer.
function fakeNative(t, {confirmsClose = true, writeFails = false, acceptsBundle = true} = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {...descriptor, value: 'win32'});
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({write(_bytes, _encoding, callback) {
    callback(writeFails ? new Error('synthetic write failure') : undefined);
  }});
  let kills = 0;
  let spawns = 0;
  child.kill = () => {
    kills++;
    if (confirmsClose) queueMicrotask(() => {child.exitCode = 0; child.emit('close', 0);});
    return true;
  };
  const spawn = t.mock.method(childProcess, 'spawn', () => {
    spawns++;
    queueMicrotask(() => child.stderr.write('VERIFIED\n'));
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    child.exitCode = 0;
    child.emit('close', 0);
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    spawn.mock.restore(); syncBuiltinESMExports();
    Object.defineProperty(process, 'platform', descriptor);
  });
  const identity = {bridgePath: '/synthetic/WindowsHost.PipeBridge.exe',
    hostPath: '/synthetic/WindowsHost.Host.exe'};
  // The process is Fake, so its identity provider is explicitly Fake too. The
  // production transport still checks this exact identity before any spawn/frame.
  const transport = createWindowsHostBridgeTransport({...identity, timeoutMs: 100,
    assertCurrentBundle(value) {assert.deepEqual(value, identity); return acceptsBundle;}});
  return {transport, get kills() {return kills;}, get spawns() {return spawns;}};
}

test('rejected native bundle identity cannot spawn even a Fake process', async t => {
  const f = fakeNative(t, {acceptsBundle: false});
  await assert.rejects(f.transport.openVerifiedConnection(), {code: 'UNAUTHORIZED'});
  assert.equal(f.spawns, 0);
  assert.equal(f.kills, 0);
  await f.transport.close();
});

test('native close timeout rejects rather than falsely confirming process release', async t => {
  const f = fakeNative(t, {confirmsClose: false});
  const connection = await f.transport.openVerifiedConnection();
  try {
    await assert.rejects(connection.close(), {code: 'EXTERNAL_FAILURE'});
    await assert.rejects(connection.close(), {code: 'EXTERNAL_FAILURE'});
    await assert.rejects(f.transport.openVerifiedConnection(), {code: 'EXTERNAL_FAILURE'});
    await assert.rejects(f.transport.close(), {code: 'EXTERNAL_FAILURE'});
    assert.equal(f.kills, 1);
    assert.equal(f.spawns, 1);
  } finally {await f.transport.close().catch(() => {});}
});

test('native confirmed close remains idempotent', async t => {
  const f = fakeNative(t);
  const connection = await f.transport.openVerifiedConnection();
  await Promise.all([connection.close(), connection.close()]);
  await f.transport.close();
  assert.equal(f.kills, 1);
});

test('failed native send rejects its caller without an orphan response rejection', async t => {
  const f = fakeNative(t, {writeFails: true});
  const connection = await f.transport.openVerifiedConnection();
  try {
    await assert.rejects(connection.exchange({kind: 'hello', protocolVersion: '0.1.0',
      requestId: 'synthetic-request', clientNonce: 'a'.repeat(32)}));
    await new Promise(resolve => setImmediate(resolve));
  } finally {await connection.close(); await f.transport.close();}
});
