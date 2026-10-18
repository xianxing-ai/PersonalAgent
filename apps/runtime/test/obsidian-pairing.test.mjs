import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createObsidianPairingHost, createTrustedKnowledgeTools} from '@personal-agent/runtime/application';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {ToolGateway, toolArgumentsDigest} from '@personal-agent/tool-gateway';

const context = (ms = 1000) => ({deadline: new Date(Date.now() + ms).toISOString(), signal: new AbortController().signal});
function fixture(t, confirm = async () => true) {
  let binding = {sourceId: 'selected-source', namespace: 'synthetic', configRevision: 1,
    available: true, writeAvailable: true, dataLevel: 'public', cloudExportAllowed: true,
    publicQueries: ['synthetic'], allowedNotePaths: ['Allowed/note.md']};
  let calls = 0, confirmations = 0, released = 0;
  const output = {hits: [{source: {vaultId: 'b'.repeat(64), path: 'Allowed/note.md', line: 1,
    revision: 'c'.repeat(64)}, excerpt: 'synthetic'}], truncated: false};
  const source = {snapshot: () => structuredClone(binding), acquire(expected, signal) {
    assert.equal(expected.sourceId, binding.sourceId); const initial = binding.configRevision;
    return {binding, signal, read: {search: async () => {throw Error('Must use paired plugin');}},
      assertCurrent() {if (!binding.available || binding.configRevision !== initial) throw Error('changed');},
      release() {released++;}};
  }};
  const peer = () => {
    const controller = new AbortController();
    const descriptor = {version: 1, pluginId: 'personal-agent-knowledge', sessionId: randomUUID(),
      vaultIdentity: 'a'.repeat(64), vaultId: 'b'.repeat(64), folder: 'Allowed'};
    return {signal: controller.signal, descriptor, describe: () => ({...descriptor}),
      assertCurrent() {if (controller.signal.aborted) throw Error('closed');}, close: () => controller.abort(),
      search: async () => {calls++; return structuredClone(output);}};
  };
  const host = createObsidianPairingHost({source, vaultIdentity: () => 'a'.repeat(64),
    confirmPairing: request => {confirmations++; return confirm(request);}}); t.after(() => host.close());
  return {host, peer, source, output, change(patch) {binding = {...binding, ...patch};},
    counts: () => ({calls, confirmations, released})};
}
test('same Vault confirmation binds a private read source; Policy still gates actual execution', async t => {
  const f = fixture(t), paired = await f.host.pair(f.peer(), context());
  assert.equal(paired.writeAvailable, false); assert.equal(paired.cloudExportAllowed, false);
  assert.equal(paired.dataLevel, 'private'); assert.notEqual(paired.sourceId, 'selected-source');
  const factory = createTrustedKnowledgeTools(f.host.source), checkpoints = new Map();
  factory.bindApplication({runtime: {loadCheckpoint: (task, key) => checkpoints.get(task + key),
    saveCheckpoint: (task, key, value) => checkpoints.set(task + key, value)}});
  const policy = new InMemoryAuthorizationPolicy(), gateway = new ToolGateway({policy}); factory.register(gateway);
  const tool = factory.tools[0], input = {sourceId: paired.sourceId, configRevision: 1, query: 'synthetic', limit: 1};
  const invocation = {...context(), taskId: 'task', runId: 'run', toolName: tool.descriptor.name,
    toolVersion: tool.descriptor.version, arguments: input, authorizationRef: 'grant'};
  await assert.rejects(gateway.invoke(invocation), error => error.code === 'UNAUTHORIZED');
  assert.equal(f.counts().calls, 0);
  policy.grant({authorizationRef: 'grant', taskId: 'task', toolName: tool.descriptor.name,
    scopes: tool.descriptor.requiredScopes, expiresAt: invocation.deadline, maxUses: 1, argumentsDigest: toolArgumentsDigest(input)});
  const result = await gateway.invoke({...invocation, runId: 'allowed'});
  assert.equal(result.hits[0].source.vaultId, paired.sourceId);
  assert.equal(factory.competitionToolExports[0].accepts({taskId: 'task', proposalId: 'p', arguments: input}), false);
  const fresh = await f.host.pair(f.peer(), context());
  assert.notEqual(fresh.sourceId, paired.sourceId);
  assert.throws(() => f.host.source.acquire(input, context().signal));
  await assert.rejects(tool.execute({...input, sourceId: fresh.sourceId},
    {...context(), taskId: 'task', scopes: tool.descriptor.requiredScopes}), error => error.code === 'SCOPE_DENIED');
});
test('identity mismatch and unknown version reject before native confirmation', async t => {
  const f = fixture(t);
  for (const patch of [{vaultIdentity: 'f'.repeat(64)}, {version: 2}, {cloudExportAllowed: true}]) {
    const peer = f.peer(); Object.assign(peer.descriptor, patch);
    await assert.rejects(f.host.pair(peer, context()));
  }
  assert.equal(f.counts().confirmations, 0); assert.equal(f.host.source.snapshot().available, false);
});
test('denial, source changes and revocation during confirmation never activate a session', async t => {
  const denied = fixture(t, async () => false);
  await assert.rejects(denied.host.pair(denied.peer(), context()));
  let finish;
  const f = fixture(t, () => new Promise(resolve => {finish = resolve;}));
  const pending = f.host.pair(f.peer(), context()); await new Promise(setImmediate);
  assert.equal(f.host.source.snapshot().available, false, 'status polling must not cancel a pending confirmation');
  f.change({configRevision: 2}); finish(true); await assert.rejects(pending);
  const revoked = f.host.pair(f.peer(), context()); await new Promise(setImmediate);
  f.host.revoke(); await assert.rejects(revoked, error => error.code === 'CANCELLED'); finish(true);
  assert.equal(f.host.source.snapshot().available, false);
});
test('confirmation timeout aborts its signal; invalid context releases leases and permits retry', async t => {
  let received;
  const f = fixture(t, request => {received = request.signal; return new Promise(() => {});});
  await assert.rejects(f.host.pair(f.peer(), {deadline: 'invalid', signal: context().signal}));
  await assert.rejects(f.host.pair(f.peer(), context(25)), error => error.code === 'TIMEOUT');
  assert.equal(received.aborted, true); assert.equal(f.counts().released, 2);
  assert.equal(f.host.source.snapshot().available, false);
});
test('out-of-scope or malformed plugin results are rejected; source drift disables the session', async t => {
  const f = fixture(t), paired = await f.host.pair(f.peer(), context());
  const lease = f.host.source.acquire(paired, context().signal); t.after(() => lease.release());
  for (const patch of [{path: 'Private/note.md'}, {path: 'Allowed/../private.md'}, {vaultId: 'a'.repeat(64)}, {path: 'Allowed/a.txt'}]) {
    const before = {...f.output.hits[0].source}; Object.assign(f.output.hits[0].source, patch);
    await assert.rejects(lease.read.search({query: 'synthetic', limit: 1, ...context()}));
    f.output.hits[0].source = before;
  }
  f.output.unexpected = true;
  await assert.rejects(lease.read.search({query: 'synthetic', limit: 1, ...context()}));
  f.change({configRevision: 2}); assert.equal(f.host.source.snapshot().available, false);
  assert.equal(lease.signal.aborted, true);
});
test('peer unload cancels a read even when peer ignores cancellation; timeout reaches peer', async t => {
  const f = fixture(t), peer = f.peer(); let finish, signal;
  peer.search = request => {signal = request.signal; return new Promise(resolve => {finish = resolve;});};
  const paired = await f.host.pair(peer, context()), lease = f.host.source.acquire(paired, context().signal);
  const read = lease.read.search({query: 'synthetic', limit: 1, ...context()}); await new Promise(setImmediate);
  peer.close(); await assert.rejects(read, error => error.code === 'CANCELLED');
  finish(f.output); assert.equal(f.host.source.snapshot().available, false);
  const next = f.peer(); next.search = peer.search;
  const second = await f.host.pair(next, context()), nextLease = f.host.source.acquire(second, context().signal);
  await assert.rejects(nextLease.read.search({query: 'synthetic', limit: 1, ...context(25)}), error => error.code === 'TIMEOUT');
  assert.equal(signal.aborted, true); finish(f.output); nextLease.release(); lease.release();
});
test('pairing expires after fifteen minutes and aborts previously acquired leases', async t => {
  const f = fixture(t), peer = f.peer(), paired = await f.host.pair(peer, context());
  const lease = f.host.source.acquire(paired, context().signal), later = Date.now() + 16 * 60_000;
  t.mock.method(Date, 'now', () => later);
  assert.equal(f.host.source.snapshot().available, false);
  assert.equal(lease.signal.aborted, true); assert.equal(peer.signal.aborted, true);
  assert.throws(() => lease.assertCurrent()); lease.release();
});
