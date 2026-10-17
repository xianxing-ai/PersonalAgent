import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, renameSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createObsidianPairingPeer, localVaultPairingIdentity, parseObsidianPairingDescriptor} from '../dist/pairing.js';

const options = () => ({vaultIdentity: 'a'.repeat(64), vaultId: 'b'.repeat(64), folder: '合成资料',
  bindingCurrent: () => true, port: {search: async () => ({hits: [], truncated: false}), clearIndex() {}}});
test('pairing descriptor rejects unknown fields, versions and unsafe folder scopes', () => {
  const peer = createObsidianPairingPeer(options()), descriptor = peer.describe();
  for (const patch of [{version: 2}, {grant: true}, {folder: '../private'}, {folder: 'A\\B'},
    {folder: '/A'}, {folder: 'A\nB'}, {vaultId: 'unknown'}, {sessionId: 'unknown'}, {pluginId: 'unknown'}]) {
    assert.throws(() => parseObsidianPairingDescriptor({...descriptor, ...patch}));
  }
  descriptor.folder = '/'; assert.equal(peer.describe().folder, '合成资料'); peer.close();
});
test('Vault identity is physical and changes after same-path replacement', t => {
  const base = mkdtempSync(path.join(tmpdir(), 'pairing-中文-'));
  t.after(() => rmSync(base, {recursive: true, force: true}));
  const vault = path.join(base, 'Vault'); mkdirSync(vault);
  const first = localVaultPairingIdentity(vault);
  assert.equal(first, localVaultPairingIdentity(path.join(vault, '.')));
  renameSync(vault, vault + '-old'); mkdirSync(vault);
  assert.notEqual(first, localVaultPairingIdentity(vault));
  assert.throws(() => localVaultPairingIdentity(path.parse(base).root));
});
test('peer revocation clears its index and rejects an outstanding read', async () => {
  let resolve, clears = 0;
  const peer = createObsidianPairingPeer({...options(), port: {
    search: () => new Promise(done => {resolve = done;}), clearIndex() {clears++;},
  }});
  const reading = peer.search({query: '合成', limit: 1,
    deadline: new Date(Date.now() + 1000).toISOString(), signal: new AbortController().signal});
  peer.close(); resolve({hits: [], truncated: false});
  await assert.rejects(reading); assert.equal(clears, 1); assert.equal(peer.signal.aborted, true);
});
