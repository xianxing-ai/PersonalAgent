import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {CLOUD_RUNTIME_MAX_BYTES, forwardCloudPersistentJob} from './cloud-runtime-transport.mjs';
import {handleRunnerFileJob, loadRunnerState, signJob} from './remote-runner-service.mjs';

// Local fixture only: Windows uses a local named pipe; production uses its fixed Unix socket.
const token = 'explicit-fixture-cloud-runner-token';
const signed = (overrides = {}) => {
  const message = {v: 1, id: 'fixture-job', idempotencyKey: 'original-command', kind: 'cloud-persistent',
    deadline: new Date(Date.now() + 5000).toISOString(), payload: {fixture: true}, ...overrides};
  return {...message, signature: signJob(message, token)};
};
const receipt = (message, extra = {}) => ({v: 1, jobId: message.id, idempotencyKey: message.idempotencyKey,
  kind: message.kind, state: 'succeeded', data: {fixture: true}, redo: false, ...extra});

async function fixture(t, receive, closeOnFirstChunk = false) {
  const root = mkdtempSync(join(tmpdir(), 'pa-cloud-'));
  const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\pa-cloud-${randomUUID()}` : join(root, 'runtime.sock');
  const sockets = new Set();
  const requests = [];
  let receivedBytes = 0;
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    let text = '';
    socket.on('data', chunk => {
      receivedBytes += chunk.length;
      if (closeOnFirstChunk) {socket.destroy(); return;}
      text += chunk;
      if (!text.endsWith('\n')) return;
      const message = JSON.parse(text);
      requests.push(message);
      receive(socket, message);
    });
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(socketPath, resolve);});
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    rmSync(root, {recursive: true, force: true});
  });
  return {root, socketPath, requests, receivedBytes: () => receivedBytes};
}

test('signed runner forwards once to its host socket and journals only the original receipt', async t => {
  const f = await fixture(t, (socket, message) => {
    assert.equal(loadRunnerState(join(f.root, 'state.json')).jobs[message.idempotencyKey].state, 'unknown');
    socket.end(JSON.stringify(receipt(message)));
  });
  // The fixture accepts arbitrary payload data solely to prove it cannot select the socket.
  const message = signed({payload: {socketPath: '/not-the-configured-socket'}});
  const options = {token, cloudRuntimeSocketPath: f.socketPath};
  const file = join(f.root, 'state.json');
  assert.equal((await handleRunnerFileJob(file, {...message, signature: '0'.repeat(64)}, options)).state, 'rejected');
  const result = await handleRunnerFileJob(file, message, options);
  assert.deepEqual(result, receipt(message));
  assert.deepEqual(f.requests, [message]);
  assert.deepEqual(await handleRunnerFileJob(file, message, options), result);
  assert.equal(f.requests.length, 1);
});

test('missing socket, expired deadline and oversized input are accurately not sent', async t => {
  const f = await fixture(t, socket => socket.end());
  const missing = process.platform === 'win32' ? `${f.socketPath}-missing` : join(f.root, 'missing.sock');
  const absent = await forwardCloudPersistentJob(signed(), {socketPath: missing});
  assert.equal(absent.state, 'rejected'); assert.equal(absent.data.transport, 'not_sent'); assert.equal(absent.redo, false);
  for (const message of [signed({deadline: '2000-01-01T00:00:00Z'}), signed({payload: {text: 'x'.repeat(CLOUD_RUNTIME_MAX_BYTES)}})]) {
    const result = await forwardCloudPersistentJob(message, {socketPath: f.socketPath});
    assert.equal(result.state, 'rejected'); assert.equal(result.data.transport, 'not_sent');
  }
  assert.equal(f.requests.length, 0);
});

test('close after dispatch stays unknown across runner restarts and is not sent again', async t => {
  const f = await fixture(t, socket => socket.destroy());
  const message = signed(), file = join(f.root, 'state.json'), options = {token, cloudRuntimeSocketPath: f.socketPath};
  const first = await handleRunnerFileJob(file, message, options);
  assert.equal(first.state, 'unknown'); assert.equal(first.data.transport, 'unknown'); assert.equal(first.redo, false);
  assert.deepEqual(await handleRunnerFileJob(file, message, options), first);
  assert.equal(f.requests.length, 1);
});

test('wrong identity, multiple JSON values and oversized responses never become success', async t => {
  for (const respond of [
    message => JSON.stringify(receipt(message, {jobId: 'other-job'})),
    message => `${JSON.stringify(receipt(message))}\n${JSON.stringify(receipt(message))}`,
    () => 'x'.repeat(CLOUD_RUNTIME_MAX_BYTES + 1),
  ]) {
    const f = await fixture(t, (socket, message) => socket.end(respond(message)));
    const result = await forwardCloudPersistentJob(signed(), {socketPath: f.socketPath});
    assert.equal(result.state, 'unknown'); assert.equal(result.redo, false); assert.equal(f.requests.length, 1);
  }
});

test('a peer closing during a partial request cannot be reported as not sent', async t => {
  const f = await fixture(t, () => {}, true);
  const message = signed({payload: {text: 'x'.repeat(CLOUD_RUNTIME_MAX_BYTES / 2)}});
  const result = await forwardCloudPersistentJob(message, {socketPath: f.socketPath});
  assert.ok(f.receivedBytes() > 0 && f.receivedBytes() < Buffer.byteLength(`${JSON.stringify(message)}\n`));
  assert.equal(result.state, 'unknown'); assert.equal(result.data.transport, 'unknown'); assert.equal(result.redo, false);
});

test('the original deadline bounds a daemon which accepts bytes but never returns a result', async t => {
  const f = await fixture(t, () => {});
  const result = await forwardCloudPersistentJob(signed({deadline: new Date(Date.now() + 1000).toISOString()}), {socketPath: f.socketPath});
  assert.equal(result.state, 'unknown'); assert.equal(result.data.reason, 'deadline'); assert.equal(result.redo, false);
  assert.equal(f.requests.length, 1);
});
