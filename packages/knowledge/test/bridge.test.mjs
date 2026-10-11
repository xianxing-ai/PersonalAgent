import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import tls from 'node:tls';
import test from 'node:test';
import {KnowledgeError} from '../dist/index.js';
import {connectObsidianBridge, createObsidianBridgeOffer, parseObsidianBridgeCode} from '../dist/bridge.js';

const scope = milliseconds => ({deadline: new Date(Date.now() + (milliseconds ?? 3000)).toISOString(), signal: new AbortController().signal});
const rewrite = (code, edit) => {const data = JSON.parse(Buffer.from(code.slice(4), 'base64url')); edit(data);
  return code.slice(0, 4) + Buffer.from(JSON.stringify(data)).toString('base64url');};
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
  assert.throws(() => parseObsidianBridgeCode(rewrite(offer.code, data => {data.version = 3;})));
  assert.throws(() => parseObsidianBridgeCode(rewrite(offer.code, data => {data.version = 1;})), 'prefix and version must agree');
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
  for (const payload of [{version: 2, kind: 'write'}, {version: 2, kind: 'search', id: randomUUID(), query: 'needle',
    limit: 5, deadline: scope().deadline, extra: true}, 'x'.repeat(129 * 1024)]) {
    let reads = 0; const offer = await createObsidianBridgeOffer(peer(async () => {reads++; return {hits: [], truncated: false};}));
    t.after(offer.close); const data = parseObsidianBridgeCode(offer.code);
    const socket = tls.connect({host: '127.0.0.1', port: data.port, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3',
      ciphers: 'TLS_AES_128_GCM_SHA256', rejectUnauthorized: false}, () => {
      socket.write(JSON.stringify({version: 2, kind: 'authenticate', sessionId: data.descriptor.sessionId, secret: data.secret}) + '\n');
    });
    socket.on('error', () => {}); t.after(() => socket.destroy());
    await new Promise(resolve => socket.once('data', resolve));
    const ended = new Promise(resolve => socket.once('close', resolve));
    socket.write(typeof payload === 'string' ? payload : JSON.stringify(payload) + '\n');
    await ended; assert.equal(reads, 0);
  }
});

test('version 2 citations validate scope and preserve typed changes without reflecting exceptions', {skip: process.platform !== 'win32'}, async t => {
  const local = peer(); let reads = 0, changed = false;
  local.readCitation = async () => {reads++; if (changed) throw new KnowledgeError('SOURCE_CHANGED'); return 'synthetic excerpt';};
  const offer = await createObsidianBridgeOffer(local); t.after(offer.close);
  assert.equal(parseObsidianBridgeCode(offer.code).version, 2);
  const legacy = JSON.parse(Buffer.from(offer.code.slice(4), 'base64url')); legacy.version = 1;
  assert.equal(parseObsidianBridgeCode('PA1.' + Buffer.from(JSON.stringify(legacy)).toString('base64url')).version, 1);
  const remote = await connectObsidianBridge(offer.code, scope()); t.after(remote.close);
  const source = {vaultId: 'b'.repeat(64), path: 'Allowed/note.md', line: 1, revision: 'c'.repeat(64)};
  for (const patch of [{path: 'private.md'}, {path: 'Allowed/../private.md'}, {extra: true}, {vaultId: 'a'.repeat(64)}]) {
    await assert.rejects(remote.readCitation({source: {...source, ...patch}, ...scope()}));
  }
  assert.equal(reads, 0);
  assert.equal(await remote.readCitation({source, ...scope()}), 'synthetic excerpt');
  changed = true;
  await assert.rejects(remote.readCitation({source, ...scope()}), error => error.code === 'SOURCE_CHANGED');
  assert.equal(remote.signal.aborted, false);
  changed = false;
  assert.equal(await remote.readCitation({source, ...scope()}), 'synthetic excerpt');
});

test('oversized citation responses and cancelled pending citation reads revoke the transport', {skip: process.platform !== 'win32'}, async t => {
  for (const oversized of [true, false]) {
    let begin, finish; const began = new Promise(resolve => {begin = resolve;});
    const local = peer(); local.readCitation = async () => {
      begin(); return oversized ? 'x'.repeat(4001) : new Promise(resolve => {finish = resolve;});
    };
    const offer = await createObsidianBridgeOffer(local); t.after(offer.close);
    const remote = await connectObsidianBridge(offer.code, scope()); t.after(remote.close);
    const controller = new AbortController();
    const reading = remote.readCitation({source: {vaultId: 'b'.repeat(64), path: 'Allowed/note.md', line: 1,
      revision: 'c'.repeat(64)}, deadline: scope().deadline, signal: controller.signal});
    const rejected = assert.rejects(reading); await began;
    if (!oversized) controller.abort(); await rejected;
    assert.equal(remote.signal.aborted, true); finish?.('late synthetic');
  }
});
