import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import test from 'node:test';
import {createObsidianBridgeOffer} from '@personal-agent/knowledge/bridge';
import {createObsidianPairingHost} from '@personal-agent/runtime/application';
import {createDesktopObsidianPairing} from '../electron/obsidian-pairing-host.js';
import {createObsidianPairingUI} from '../electron/obsidian-pairing-ui.js';

function fixture() {
  const original = {sourceId: 'original', configRevision: 1, namespace: 'synthetic', available: true,
    writeAvailable: true, dataLevel: 'public', cloudExportAllowed: true, publicQueries: ['needle'], allowedNotePaths: ['note.md'], displayName: '合成 Vault'};
  const source = {snapshot: () => ({...original}), pairingIdentity: () => 'a'.repeat(64),
    acquire(expected, signal) {
      assert.equal(expected.sourceId, original.sourceId);
      return {binding: original, signal, read: {search: async () => ({hits: [], truncated: false})},
        release() {}, assertCurrent() {if (signal.aborted || !original.available) throw Error();}};
    }};
  const controller = new AbortController();
  const peer = {signal: controller.signal, close: () => controller.abort(), assertCurrent() {if (controller.signal.aborted) throw Error();},
    describe: () => ({version: 1, pluginId: 'personal-agent-knowledge', sessionId: randomUUID(), vaultIdentity: 'a'.repeat(64), vaultId: 'b'.repeat(64), folder: 'Allowed'}),
    search: async () => ({hits: [], truncated: false})};
  const descriptor = peer.describe(); peer.describe = () => ({...descriptor});
  return {source, original, peer};
}

test('selected plugin source is private and read-only; disconnect fails closed until explicit filesystem selection', {skip: process.platform !== 'win32'}, async t => {
  const f = fixture(), offer = await createObsidianBridgeOffer(f.peer); t.after(offer.close);
  let confirms = 0;
  const ui = {requestCode: async () => offer.code, confirm: async () => {confirms++; return true;}, close() {}};
  const host = createDesktopObsidianPairing({source: f.source, createPairingHost: createObsidianPairingHost, ui}); t.after(() => host.close());
  const old = host.source.acquire(f.original, new AbortController().signal);
  await host.pair(); assert.equal(confirms, 1); assert.throws(old.assertCurrent);
  const paired = host.source.snapshot();
  assert.notEqual(paired.sourceId, f.original.sourceId); assert.equal(paired.available, true);
  assert.equal(paired.writeAvailable, false); assert.equal(paired.cloudExportAllowed, false); assert.equal(paired.dataLevel, 'private');
  const lease = host.source.acquire(paired, new AbortController().signal);
  assert.equal(lease.write, undefined);
  f.peer.close(); await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(host.snapshot().mode, 'plugin'); assert.equal(host.source.snapshot().available, false);
  assert.throws(lease.assertCurrent); host.useFilesystem();
  assert.equal(host.source.snapshot().sourceId, f.original.sourceId);
});

test('native refusal, source replacement and cancellation never create a usable plugin binding', {skip: process.platform !== 'win32'}, async t => {
  for (const action of ['refuse', 'replace', 'revoke']) {
    const f = fixture(), offer = await createObsidianBridgeOffer(f.peer); t.after(offer.close);
    let host;
    const ui = {requestCode: async () => offer.code, confirm: async () => {
      if (action === 'replace') f.original.configRevision++;
      if (action === 'revoke') host.useFilesystem();
      return action !== 'refuse';
    }, close() {}};
    host = createDesktopObsidianPairing({source: f.source, createPairingHost: createObsidianPairingHost, ui}); t.after(() => host.close());
    await assert.rejects(host.pair());
    assert.equal(host.snapshot().available, false);
    if (action !== 'revoke') assert.equal(host.source.snapshot().available, false);
  }
});

test('dedicated native input accepts only its own main frame, denies navigation and clears IPC on close', async () => {
  let handler, options, denied, removed, window;
  class Window extends EventEmitter {
    constructor(value) {super(); options = value; window = this; this.webContents = new EventEmitter();
      this.webContents.mainFrame = {}; this.webContents.session = {setPermissionRequestHandler() {}, setPermissionCheckHandler() {}};
      this.webContents.setWindowOpenHandler = callback => {denied = callback();};}
    loadFile() {return Promise.resolve();} isDestroyed() {return !!this.dead;}
    destroy() {this.dead = true; this.emit('closed');} show() {}
  }
  const ipcMain = {handle(_name, callback) {handler = callback;}, removeHandler() {removed = true;}};
  const owner = {isDestroyed: () => false};
  const ui = createObsidianPairingUI({BrowserWindow: Window, ipcMain, dialog: {}, owner: () => owner});
  const code = 'PA1.synthetic'; const pending = ui.requestCode(new AbortController().signal);
  assert.equal(options.webPreferences.sandbox, true); assert.equal(options.webPreferences.nodeIntegration, false);
  assert.deepEqual(denied, {action: 'deny'});
  assert.throws(() => handler({sender: {}}, code));
  assert.throws(() => handler({sender: window.webContents, senderFrame: {}}, code));
  assert.equal(handler({sender: window.webContents, senderFrame: window.webContents.mainFrame}, code), true);
  assert.equal(await pending, code); assert.equal(window.isDestroyed(), true);
  const updated = ui.requestCode(new AbortController().signal);
  assert.equal(handler({sender: window.webContents, senderFrame: window.webContents.mainFrame}, 'PA3.synthetic'), false);
  assert.equal(handler({sender: window.webContents, senderFrame: window.webContents.mainFrame}, 'PA2.synthetic'), true);
  assert.equal(await updated, 'PA2.synthetic');
  const controller = new AbortController(), cancelled = ui.requestCode(controller.signal); controller.abort();
  assert.equal(await cancelled, undefined); ui.close(); assert.equal(removed, true);
});

test('pairing uses the original application card and rejects late acceptance after cancellation', async () => {
  let captured;
  const controller = new AbortController();
  const ui = createObsidianPairingUI({BrowserWindow: class {}, ipcMain: {handle() {}, removeHandler() {}},
    owner: () => owner,confirmAuthorization:async request=>{
      captured=request;controller.abort();return true;
    }});
  const owner={isDestroyed:()=>false};
  assert.equal(await ui.confirm({peer: {folder: 'Allowed'}, displayName: '合成 Vault', signal: controller.signal}), false);
  assert.equal(captured.signal, controller.signal);assert.equal(captured.isCurrent(),false);assert.equal(captured.scope.folder,'Allowed');ui.close();
});

test('restart keeps plugin selection unavailable and stores no credentials; explicit revoke restores the file source', {skip: process.platform !== 'win32'}, async t => {
  const parent = fileURLToPath(new URL('../../../.cache/obsidian-pairing-restart/', import.meta.url)); mkdirSync(parent, {recursive: true});
  const userData = mkdtempSync(path.join(parent, 'case-')); t.after(() => rmSync(userData, {recursive: true, force: true}));
  const f = fixture(), offer = await createObsidianBridgeOffer(f.peer); t.after(offer.close);
  const options = {source: f.source, createPairingHost: createObsidianPairingHost, userData,
    ui: {requestCode: async () => offer.code, confirm: async () => true, close() {}}};
  const first = createDesktopObsidianPairing(options); await first.pair(); first.close();
  assert.deepEqual(JSON.parse(readFileSync(path.join(userData, 'obsidian-pairing-selection.json'))), {version: 1, mode: 'plugin'});
  const restarted = createDesktopObsidianPairing(options); t.after(() => restarted.close());
  assert.equal(restarted.snapshot().mode, 'plugin'); assert.equal(restarted.source.snapshot().available, false);
  restarted.useFilesystem(); assert.equal(restarted.source.snapshot().sourceId, f.original.sourceId);
});
