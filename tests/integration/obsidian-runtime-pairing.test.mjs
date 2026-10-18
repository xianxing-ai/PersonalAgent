import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import {createObsidianPairingHost, createTrustedKnowledgeTools} from '@personal-agent/runtime/application';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {ToolGateway, toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createKnowledgeSourceConfig} from '../../apps/desktop/electron/knowledge-source-config.js';
import {createObsidianBridgeOffer, connectObsidianBridge} from '@personal-agent/knowledge/bridge';

test('actual plugin bundle pairs with native-selected Desktop source and uses original Runtime Policy', async t => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const parent = path.join(root, '.cache', 'pairing-integration'); mkdirSync(parent, {recursive: true});
  const base = mkdtempSync(path.join(parent, '中文-')), vault = path.join(base, 'Vault');
  mkdirSync(path.join(vault, 'Allowed'), {recursive: true});
  writeFileSync(path.join(vault, 'Allowed', 'note.md'), 'synthetic needle');
  writeFileSync(path.join(vault, 'private.md'), 'private needle');
  t.after(() => rmSync(base, {recursive: true, force: true}));
  const nativeRequire = createRequire(import.meta.url), packaged = {exports: {}};
  class Plugin {addCommand() {} registerEvent() {}}
  vm.runInNewContext(readFileSync(path.join(root, 'apps/obsidian-plugin/dist/main.js'), 'utf8'), {
    module: packaged, exports: packaged.exports, AbortController, AbortSignal, Buffer,
    require: id => id === 'obsidian' ? {Plugin, Modal: class {}, Notice: class {}}
      : id.startsWith('./') ? (() => {throw Error('Sidecar require forbidden');})() : nativeRequire(id),
  });
  let privateReads = 0, localReads = 0;
  const files = ['Allowed/note.md', 'private.md'].map(p => {
    const stat = statSync(path.join(vault, p)); return {path: p, stat: {mtime: stat.mtimeMs, size: stat.size}};
  });
  const plugin = new packaged.exports();
  plugin.app = {vault: {getName: () => 'Synthetic Vault', adapter: {getBasePath: () => vault},
    getMarkdownFiles: () => files, getAbstractFileByPath: p => p === 'Allowed' ? {children: [files[0]]} : files.find(f => f.path === p),
    read: async file => {localReads++; if (file.path === 'private.md') privateReads++; return readFileSync(path.join(vault, file.path), 'utf8');},
    on() {}}, workspace: {}};
  await plugin.onload(); t.after(() => plugin.onunload()); plugin.connect('Allowed');
  const desktop = await createKnowledgeSourceConfig({userData: path.join(base, 'user-data'), namespace: 'synthetic',
    hostIdentity: 'synthetic-host', selectDirectory: async () => vault, selectNoteFiles: async () => [],
    safeStorage: {isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString()}});
  t.after(() => desktop.close()); await desktop.select();
  let confirmed = 0;
  const host = createObsidianPairingHost({source: desktop, vaultIdentity: () => desktop.pairingIdentity(),
    confirmPairing: async request => {confirmed++; assert.equal(request.peer.folder, 'Allowed'); return true;}});
  t.after(() => host.close());
  const scope = () => ({signal: new AbortController().signal, deadline: new Date(Date.now() + 5000).toISOString()});
  const offer = process.platform === 'win32' ? await createObsidianBridgeOffer(plugin.createRuntimePairingPeer()) : undefined;
  if (offer) t.after(offer.close);
  const remotePeer = offer ? await connectObsidianBridge(offer.code, scope()) : plugin.createRuntimePairingPeer(); t.after(remotePeer.close);
  const binding = await host.pair(remotePeer, scope());
  assert.equal(confirmed, 1); assert.equal(localReads, 0);
  const factory = createTrustedKnowledgeTools(host.source), checkpoints = new Map();
  factory.bindApplication({runtime: {loadCheckpoint: (id, key) => checkpoints.get(id + key),
    saveCheckpoint: (id, key, value) => checkpoints.set(id + key, value)}});
  const policy = new InMemoryAuthorizationPolicy(), gateway = new ToolGateway({policy}); factory.register(gateway);
  const tool = factory.tools[0], args = {sourceId: binding.sourceId, configRevision: 1, query: 'needle', limit: 5};
  const invocation = {...scope(), taskId: 'synthetic-task', runId: 'unapproved', authorizationRef: 'grant',
    toolName: tool.descriptor.name, toolVersion: tool.descriptor.version, arguments: args};
  await assert.rejects(gateway.invoke(invocation), error => error.code === 'UNAUTHORIZED');
  assert.equal(localReads, 0);
  policy.grant({authorizationRef: 'grant', taskId: invocation.taskId, toolName: tool.descriptor.name,
    scopes: tool.descriptor.requiredScopes, expiresAt: invocation.deadline, maxUses: 1, argumentsDigest: toolArgumentsDigest(args)});
  const result = await gateway.invoke({...invocation, runId: 'approved'});
  assert.equal(result.hits.length, 1); assert.equal(result.hits[0].source.path, 'Allowed/note.md');
  assert.equal(privateReads, 0); assert.equal(factory.competitionToolExports[0].accepts({taskId: invocation.taskId,
    proposalId: 'proposal', arguments: args}), false);
  plugin.disconnect();
  if (!remotePeer.signal.aborted) await new Promise(resolve => remotePeer.signal.addEventListener('abort', resolve, {once:true}));
  assert.equal(host.source.snapshot().available, false);
  assert.deepEqual(readdirSync(vault).sort(), ['Allowed', 'private.md']);
  const restarted = createObsidianPairingHost({source: desktop, vaultIdentity: () => desktop.pairingIdentity(), confirmPairing: async () => true});
  assert.equal(restarted.source.snapshot().available, false); restarted.close();
});
