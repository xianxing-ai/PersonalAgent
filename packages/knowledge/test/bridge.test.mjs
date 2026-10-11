import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import tls from 'node:tls';
import test from 'node:test';
import {connectObsidianBridge, createObsidianBridgeOffer, parseObsidianBridgeCode} from '../dist/bridge.js';

const scope = milliseconds => ({deadline: new Date(Date.now() + (milliseconds ?? 3000)).toISOString(), signal: new AbortController().signal});
const rewrite = (code, edit) => {const data = JSON.parse(Buffer.from(code.slice(4), 'base64url')); edit(data);
  return 'PA1.' + Buffer.from(JSON.stringify(data)).toString('base64url');};
function peer(search = async () => ({hits: [], truncated: false})) {
  const controller = new AbortController(), descriptor = {version: 1, pluginId: 'personal-agent-knowledge',
    sessionId: randomUUID(), vaultIdentity: 'a'.repeat(64), vaultId: 'b'.repeat(64), folder: 'Allowed'};
  return {signal: controller.signal, close: () => controller.abort(), assertCurrent() {if (controller.signal.aborted) throw Error();},
    describe: () => ({...descriptor}), search};
}

test('pinned TLS rejects wrong keys, pins the whole descriptor and consumes an offer only once', {skip: process.platform !== 'win32'}, async t => {
  let reads = 0;
  const local = peer(async () => {reads++; return {hits: [], truncated: false};});
  const offer = await createObsidianBridgeOffer(local); t.after(offer.close);
  await assert.rejects(connectObsidianBridge(rewrite(offer.code, data => {data.secret = '0'.repeat(64);}), scope()));
  assert.equal(reads, 0); assert.equal(offer.connected(), false);
  await assert.rejects(connectObsidianBridge(rewrite(offer.code, data => {data.certificateSha256 = '0'.repeat(64);}), scope()));
  assert.equal(offer.connected(), false);
  const remote = await connectObsidianBridge(offer.code, scope()); t.after(remote.close);
  assert.deepEqual(remote.describe(), local.describe());
  await assert.rejects(connectObsidianBridge(offer.code, scope()));
  assert.deepEqual(await remote.search({query: 'needle', limit: 5, ...scope()}), {hits: [], truncated: false});
  assert.equal(reads, 1);
  local.close(); await new Promise(resolve => remote.signal.addEventListener('abort', resolve, {once: true}));
  await assert.rejects(remote.search({query: 'needle', limit: 5, ...scope()}));
});

test('unknown/expired offers and a descriptor replaced in a valid code fail without reading', {skip: process.platform !== 'win32'}, async t => {
  const local = peer(), offer = await createObsidianBridgeOffer(local); t.after(offer.close);
  assert.throws(() => parseObsidianBridgeCode(rewrite(offer.code, data => {data.host = 'elsewhere';})));
  assert.throws(() => parseObsidianBridgeCode(rewrite(offer.code, data => {data.expiresAt = Date.now() - 1;})));
  assert.throws(() => parseObsidianBridgeCode(rewrite(offer.code, data => {data.version = 2;})));
  await assert.rejects(connectObsidianBridge(rewrite(offer.code, data => {data.descriptor.folder = '/';}), scope()));
});

test('cancellation and a deadline close the authenticated session even if the plugin ignores abort', {skip: process.platform !== 'win32'}, async t => {
  for (const cancel of [true, false]) {
    let finish, began;
    const started = new Promise(resolve => {began = resolve;});
    const local = peer(() => {began(); return new Promise(resolve => {finish = resolve;});});
    const offer = await createObsidianBridgeOffer(local); t.after(offer.close);
    const remote = await connectObsidianBridge(offer.code, scope()); t.after(remote.close);
    const controller = new AbortController();
    const result = remote.search({query: 'needle', limit: 5, deadline: scope(cancel ? 2000 : 80).deadline, signal: controller.signal});
    const rejection = assert.rejects(result); await started;
    if (cancel) controller.abort(); await rejection;
    assert.equal(remote.signal.aborted, true);
    finish({hits: [], truncated: false});
    await assert.rejects(remote.search({query: 'needle', limit: 5, ...scope()}));
  }
});

test('authenticated arbitrary RPC, unknown keys and oversized frames cannot call the plugin', {skip: process.platform !== 'win32'}, async t => {
  for (const payload of [{version: 1, kind: 'write'}, {version: 1, kind: 'search', id: randomUUID(), query: 'needle',
    limit: 5, deadline: scope().deadline, extra: true}, 'x'.repeat(129 * 1024)]) {
    let reads = 0; const offer = await createObsidianBridgeOffer(peer(async () => {reads++; return {hits: [], truncated: false};}));
    t.after(offer.close); const data = parseObsidianBridgeCode(offer.code);
    const socket = tls.connect({host: '127.0.0.1', port: data.port, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3',
      ciphers: 'TLS_AES_128_GCM_SHA256', rejectUnauthorized: false}, () => {
      socket.write(JSON.stringify({version: 1, kind: 'authenticate', sessionId: data.descriptor.sessionId, secret: data.secret}) + '\n');
    });
    socket.on('error', () => {}); t.after(() => socket.destroy());
    await new Promise(resolve => socket.once('data', resolve));
    const ended = new Promise(resolve => socket.once('close', resolve));
    socket.write(typeof payload === 'string' ? payload : JSON.stringify(payload) + '\n');
    await ended; assert.equal(reads, 0);
  }
});
