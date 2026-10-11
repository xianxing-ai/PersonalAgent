import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import path from 'node:path';

/** Actual Desktop composition; only synthetic source selection/native decisions are automated. */
export async function verifyDesktopPairing({workspace, base, vault, evaluatePlugin, sensitiveCode}) {
  const require = createRequire(path.join(workspace, 'apps/desktop/package.json'));
  const {_electron} = require('playwright');
  const choices = ['apps/desktop/node_modules/electron/dist/electron.exe', 'node_modules/electron/dist/electron.exe'];
  const executablePath = choices.map(value => path.join(workspace, value)).find(existsSync);
  assert.ok(executablePath, 'Build/install the Desktop workspace first');
  // No inherited provider destinations, credentials or local profile; no cloud request is necessary.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PA_|PANGU_|HUAWEI_|OPENAI_|ELECTRON_RUN_AS_NODE)/.test(key)));
  Object.assign(env, {PA_RUNTIME_PROFILE: 'huawei_ict_agentarts', PA_DESKTOP_TEST_USER_DATA: path.join(base, 'desktop'),
    PA_AGENTARTS_GATEWAY_URL: 'https://synthetic-pairing.huaweicloud-agentarts.com', PA_AGENTARTS_RUNTIME_NAME: 'synthetic-pairing'});
  let electron, admin;
  const invoke = (name, payload) => admin.evaluate(async ({name, payload}) => {
    const result = await window.desktop.invoke(name, payload);
    if (!result.ok) throw Error(result.error); return result.value;
  }, {name, payload});
  const wait = async predicate => {
    for (let i = 0; i < 160; i++) {const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50));}
    throw Error('Synthetic Desktop pairing state did not become ready');
  };
  try {
    electron = await _electron.launch({executablePath, args: [path.join(workspace, 'apps/desktop')], env});
    const orb = await wait(() => electron.windows().find(page => page.url().includes('mode=orb')));
    await orb.evaluate(() => window.desktop.invoke('orb.open'));
    const panel = await wait(() => electron.windows().find(page => page.url().includes('mode=panel')));
    await panel.evaluate(() => window.desktop.invoke('admin.open', {page: 'memory'}));
    admin = await wait(() => electron.windows().find(page => page.url().includes('mode=admin')));
    await electron.evaluate(({dialog}, vault) => {
      globalThis.__pairingCloudAttempts = 0;
      globalThis.__pairingConfirmationDetails = [];
      globalThis.fetch = async () => {globalThis.__pairingCloudAttempts++; throw Error('Synthetic acceptance forbids cloud calls');};
      dialog.showOpenDialog = async () => ({canceled: false, filePaths: [vault]});
      // Explicit Fake decision; the dedicated BrowserWindow and form below are real.
      dialog.showMessageBox = async (_owner, options) => {
        if (options.title === '确认 Obsidian 配对') globalThis.__pairingConfirmationDetails.push({
          defaultId: options.defaultId, cancelId: options.cancelId, bounded: !!options.signal,
          mentionsPrivate: options.detail.includes('私人'), mentionsReadonly: options.detail.includes('只读')});
        return {response: 0};
      };
    }, vault);
    await wait(async () => {const result = await invoke('snapshot'); return result.privateMemory?.available;});
    const original = await invoke('knowledge.source.select'); assert.equal(original.available, true);
    await admin.waitForSelector('[data-knowledge-source="pair"]');
    const offered = evaluatePlugin("const tls=require('node:tls'),create=tls.createServer;window.__syntheticTlsErrors=[];tls.createServer=(...args)=>{const server=create(...args);server.on('tlsClientError',e=>window.__syntheticTlsErrors.push(e.code));return server;};const p=app.plugins.getPlugin('personal-agent-knowledge');await p.pairRuntime();return JSON.stringify({offered:!!p.bridge,passwordModal:[...p.modals].some(m=>!!m.contentEl.querySelector('input[type=password]')),notices:[...document.querySelectorAll('.notice')].map(n=>n.textContent)});");
    assert.equal(offered.offered, true, JSON.stringify(offered)); assert.equal(offered.passwordModal, true, JSON.stringify(offered));
    const code = sensitiveCode();
    await admin.locator('[data-knowledge-source="pair"]').click();
    const pairing = await wait(() => electron.windows().find(page => page.url().endsWith('/pairing/index.html')));
    assert.equal(await pairing.locator('#code').getAttribute('type'), 'password');
    assert.equal(await pairing.evaluate(() => typeof window.desktop), 'undefined');
    const isolation = await electron.evaluate(({BrowserWindow}) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/pairing/index.html'));
      const prefs = window.webContents.getLastWebPreferences();
      return {sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration};
    });
    assert.deepEqual(isolation, {sandbox: true, contextIsolation: true, nodeIntegration: false});
    try {
      await pairing.locator('#code').fill(code);
      await pairing.screenshot({path: path.join(base, 'desktop-pairing-input.png')}); // password remains masked
      await pairing.locator('button[type=submit]').click();
    } catch {throw Error('Synthetic private pairing form could not be submitted');}
    let paired;
    try {paired = await wait(async () => {const result = await invoke('snapshot'); return result.knowledgeSource?.pairing?.available && result;});}
    catch {
      const state = await invoke('snapshot');
      const uiStatus = await admin.locator('[data-knowledge-source="status"]').textContent();
      const confirmCount = await electron.evaluate(() => globalThis.__pairingConfirmationDetails.length);
      const plugin = evaluatePlugin("const p=app.plugins.getPlugin('personal-agent-knowledge');return JSON.stringify({aborted:p.bridge?.signal.aborted,tls:window.__syntheticTlsErrors,node:process.versions.node,openssl:process.versions.openssl});");
      const host = await electron.evaluate(() => ({node: process.versions.node, openssl: process.versions.openssl}));
      throw Error('Synthetic pairing failed: ' + JSON.stringify({pairing: state.knowledgeSource?.pairing, uiStatus, confirmCount, plugin,host}));
    }
    assert.equal(paired.knowledge.dataLevel, 'private'); assert.equal(paired.knowledge.writeAvailable, false);
    assert.equal(paired.knowledge.cloudExportAllowed, false); assert.notEqual(paired.knowledge.sourceId, original.sourceId);
    assert.equal(await admin.locator('[data-knowledge-source="submit"]').isDisabled(), true);
    const hits = await invoke('knowledge.search', {query: 'needle', limit: 5});
    assert.equal(hits.hits.length, 1); assert.equal(hits.hits[0].source.path, 'Allowed/note.md');
    assert.equal(hits.hits[0].source.vaultId, paired.knowledge.sourceId);
    const tasks = await invoke('snapshot');
    await admin.locator('[data-knowledge-source="pair-status"]').scrollIntoViewIfNeeded();
    await admin.screenshot({path: path.join(base, 'desktop-paired.png')});
    evaluatePlugin("app.plugins.getPlugin('personal-agent-knowledge').revokeRuntimePairing();return JSON.stringify({revoked:true});");
    const disconnected = await wait(async () => {const result = await invoke('snapshot'); return !result.knowledge?.available && result;});
    assert.equal(disconnected.knowledgeSource.pairing.mode, 'plugin');
    await assert.rejects(invoke('knowledge.search', {query: 'needle', limit: 5}));
    await invoke('knowledge.pair.revoke');
    assert.equal((await invoke('snapshot')).knowledge.sourceId, original.sourceId);
    // Pair once more, then restart the actual Desktop process while this lease is active.
    evaluatePlugin("await app.plugins.getPlugin('personal-agent-knowledge').pairRuntime();return JSON.stringify({offered:true});");
    const nextCode = sensitiveCode();
    const reconnect = invoke('knowledge.pair');
    const nextWindow = await wait(() => electron.windows().find(page => page.url().endsWith('/pairing/index.html')));
    try {await nextWindow.locator('#code').fill(nextCode); await nextWindow.locator('button[type=submit]').click();}
    catch {throw Error('Synthetic private re-pairing form could not be submitted');}
    await reconnect;
    assert.equal((await invoke('snapshot')).knowledgeSource.pairing.available, true);
    const confirmation = await electron.evaluate(() => ({details: globalThis.__pairingConfirmationDetails, cloudAttempts: globalThis.__pairingCloudAttempts}));
    assert.equal(confirmation.cloudAttempts, 0); assert.equal(confirmation.details.length, 2);
    assert.deepEqual(confirmation.details[0], {defaultId: 1, cancelId: 1, bounded: true, mentionsPrivate: true, mentionsReadonly: true});
    await electron.close(); electron = undefined;
    electron = await _electron.launch({executablePath, args: [path.join(workspace, 'apps/desktop')], env});
    const restartedOrb = await wait(() => electron.windows().find(page => page.url().includes('mode=orb')));
    await restartedOrb.evaluate(() => window.desktop.invoke('orb.open'));
    const restartedPanel = await wait(() => electron.windows().find(page => page.url().includes('mode=panel')));
    await restartedPanel.evaluate(() => window.desktop.invoke('admin.open', {page: 'memory'}));
    admin = await wait(() => electron.windows().find(page => page.url().includes('mode=admin')));
    await wait(async () => (await invoke('snapshot')).privateMemory?.available);
    const restarted = await invoke('snapshot');
    assert.equal(restarted.knowledgeSource.pairing.mode, 'plugin'); assert.equal(restarted.knowledge.available, false);
    await assert.rejects(invoke('knowledge.search', {query: 'needle', limit: 5}));
    const pluginClosed = evaluatePlugin("return JSON.stringify({aborted:app.plugins.getPlugin('personal-agent-knowledge').bridge?.signal.aborted});");
    assert.equal(pluginClosed.aborted, true);
    await invoke('knowledge.pair.revoke'); assert.equal((await invoke('snapshot')).knowledge.sourceId, original.sourceId);
    return {realDesktopHost: true, crossProcessRuntimePairing: true, source: 'synthetic', nativeDecision: 'explicit_fake',
      passwordInput: true, isolation, confirmedSearch: {hits: hits.hits.length, path: hits.hits[0].source.path},
      revocationFailsClosed: true, realDesktopRestartFailsClosed: true, explicitFilesystemRestore: true, cloudAttempts: confirmation.cloudAttempts,
      taskCount: tasks.tasks?.length ?? tasks.tasks?.items?.length};
  } finally {if (electron) await electron.close();}
}
