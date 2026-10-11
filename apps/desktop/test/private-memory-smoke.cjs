const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {_electron} = require('playwright');

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-private-ui-'));
  const vault = path.join(base, 'vault');
  const data = path.join(base, 'user-data');
  fs.mkdirSync(vault);
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(vault, 'note.md'), '合成偏好：周一查看计划。\n');
  const executablePath = path.resolve(__dirname, '../../../node_modules/electron/dist/electron.exe');
  let app;
  async function launch() {
    app = await _electron.launch({executablePath, args: [path.resolve(__dirname, '..')], env: {
      ...process.env, ELECTRON_RUN_AS_NODE: undefined,
      PA_RUNTIME_PROFILE: 'huawei_ict_agentarts',
      PA_AGENTARTS_AUTHORIZATION: '',
      PA_AGENTARTS_GATEWAY_URL: 'https://example.huaweicloud-agentarts.com',
      PA_AGENTARTS_RUNTIME_NAME: 'synthetic-only',
      PA_USER_DATA_DIR: data,
      PA_DESKTOP_TEST_USER_DATA: data,
      PA_DESKTOP_TEST_VAULT: vault,
      PA_DESKTOP_SYNTHETIC_MVP: '0',
    }});
    await app.firstWindow();
    await app.evaluate(() => {
      globalThis.syntheticFetchAttempts = 0;
      globalThis.fetch = async () => {globalThis.syntheticFetchAttempts++; throw Error('Cloud transport is forbidden in this smoke');};
    });
    const orb = app.windows().find(page => page.url().includes('mode=orb'));
    await orb.evaluate(() => window.desktop.invoke('orb.open'));
    const panel = app.windows().find(page => page.url().includes('mode=panel'));
    await panel.waitForSelector('#admin');
    const existingAdmin = app.windows().find(page => page.url().includes('mode=admin'));
    const opening = existingAdmin ? null : app.waitForEvent('window');
    await panel.evaluate(() => window.desktop.invoke('admin.open', {page: 'memory'}));
    const admin = existingAdmin ?? await opening;
    await admin.waitForSelector('#memory-select-vault', {timeout: 5000}).catch(async error => {
      const status = await admin.locator('#connection').innerText();
      const page = await admin.locator('#content').innerText();
      throw Error(`${error.message.split('\n')[0]}: ${status}; ${page.slice(0, 180)}`);
    });
    const snapshot = (await admin.evaluate(() => window.desktop.invoke('snapshot'))).value;
    assert.equal(snapshot.model.configured, false, 'local memory management needs no cloud credential');
    assert.equal(snapshot.privateMemory.available, true);
    return {panel, admin};
  }
  async function close() {
    assert.equal(await app.evaluate(() => globalThis.syntheticFetchAttempts), 0);
    await app.close();
    app = undefined;
  }
  try {
    let {panel, admin} = await launch();
    // Explicit Renderer fixture: pending source erasure is not cancellation or completed copy deletion.
    const pending = await admin.evaluate(async () => {
      const {mountAdmin} = await import('../features/admin/view.js');
      const root = document.createElement('div');
      document.body.append(root);
      let erased = false;
      const calls = [];
      const render = mountAdmin(root, async (name, payload) => {
        calls.push([name, payload]);
        if (name === 'memory.delete') {erased = true; return {state: 'pending', phase: 'private_copy_erasure'};}
        if (name === 'memory.listSaved') return {facts: erased ? [] : [{ref: {id: 'synthetic-pending', revision: 2},
          summary: 'Synthetic pending copy', sourceRef: 'synthetic', state: 'active',
          validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z'}]};
        throw Error(`Unexpected Renderer fixture request: ${name}`);
      }, value => String(value ?? ''));
      render({tasks: [], capabilities: [], health: [], approvals: [], model: {}, connection: 'Synthetic',
        adminNavigation: {page: 'memory', revision: 1}, privateMemory: {available: true, writeEnabled: true}});
      root.querySelector('#memory-list-saved').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      root.querySelector('[data-memory-delete="0"]').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      const result = {status: root.querySelector('#memory-saved-status').textContent,
        deleteButtons: root.querySelectorAll('[data-memory-delete]').length, calls};
      root.remove();
      return result;
    });
    assert.match(pending.status, /关联任务副本仍待核实清除/);
    assert.equal(pending.deleteButtons, 0);
    assert.deepEqual(pending.calls.map(([name]) => name), ['memory.listSaved', 'memory.delete', 'memory.listSaved']);
    assert.deepEqual(pending.calls[1][1], {ref: {id: 'synthetic-pending', revision: 2}});
    await app.evaluate(({dialog}) => {
      dialog.showOpenDialog = async () => ({canceled: false, filePaths: [process.env.PA_DESKTOP_TEST_VAULT]});
      dialog.showMessageBox = async () => ({response: 1});
    });
    await admin.locator('#memory-select-vault').click();
    await admin.locator('#memory-query').fill('合成偏好');
    await admin.locator('#memory-search-form button').click();
    await admin.waitForSelector('[data-memory-save="0"]');
    assert.equal(await admin.locator('[data-memory-save="0"]').isDisabled(), false);
    await admin.locator('[data-memory-summary="0"]').fill('周一查看计划');
    await admin.locator('[data-memory-save="0"]').click();
    await admin.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes('未写入记忆'));
    const {openSqliteMemoryHost} = await import('@personal-agent/memory/sqlite');
    const database = path.join(data, 'private-memory.sqlite');
    const read = async (factId) => {
      const memory = openSqliteMemoryHost(database);
      try {
        const query = memory.bind('desktop-private', {allowedSensitivities: ['private']});
        const scope = {limit: 5, deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal};
        return (await (factId ? query.listHistory({factId, ...scope})
          : query.listCurrent({at: new Date().toISOString(), ...scope}))).facts;
      } finally { memory.close(); }
    };
    assert.equal((await read()).length, 0);
    await app.evaluate(({dialog}) => { dialog.showMessageBox = async () => ({response: 0}); });
    await admin.locator('[data-memory-save="0"]').click();
    await admin.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes('版本 1'));
    assert.equal((await read())[0].summary, '周一查看计划');
    await admin.locator('[data-memory-summary="0"]').fill('周一先查看计划');
    await admin.locator('[data-memory-save="0"]').click();
    await admin.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes('版本 2'));
    assert.equal((await read())[0].ref.revision, 2);
    assert.equal((await panel.evaluate(() => window.desktop.invoke('memory.listSaved'))).ok, false);
    assert.equal((await panel.evaluate(() => window.desktop.invoke('memory.delete',
      {ref: {id: 'forged', revision: 1}}))).ok, false);
    await admin.locator('#memory-list-saved').click();
    await admin.waitForSelector('[data-memory-delete="0"]');
    const ref = (await read())[0].ref;
    await app.evaluate(({dialog}) => { dialog.showMessageBox = async () => ({response: 1}); });
    await admin.locator('[data-ml-withdraw="0"]').click();
    await admin.waitForFunction(() => document.querySelector('.memory-learning-panel [role="status"]')?.textContent.includes('已取消'));
    assert.equal((await read())[0].ref.revision, 2);
    await app.evaluate(({dialog}) => { dialog.showMessageBox = async () => ({response: 0}); });
    await admin.locator('[data-ml-withdraw="0"]').click();
    await admin.waitForFunction(() => document.querySelector('#content')?.textContent.includes('版本 3 · 已撤回'));
    assert.equal(await admin.locator('[data-ml-use]').count(), 0);
    assert.equal((await read()).length, 0);
    assert.equal((await read(ref.id)).at(-1).ref.revision, 3);
    await close();
    ({panel, admin} = await launch());
    await admin.locator('#memory-list-saved').click();
    await admin.waitForFunction(() => document.querySelector('#content')?.textContent.includes('版本 3 · 已撤回'));
    assert.equal(await admin.locator('[data-ml-use]').count(), 0);
    assert.equal(await admin.locator('#memory-query').isDisabled(), false, 'restart reuses the persisted trusted knowledge source');
    await app.evaluate(({dialog}) => { dialog.showMessageBox = async () => ({response: 1}); });
    await admin.locator('[data-memory-delete="0"]').click();
    await admin.waitForFunction(() => document.querySelector('#memory-saved-status')?.textContent.includes('已取消'));
    assert.equal((await read(ref.id)).length, 3);
    await app.evaluate(({dialog}) => { dialog.showMessageBox = async () => ({response: 0}); });
    await admin.locator('[data-memory-delete="0"]').click();
    await admin.waitForFunction(() => document.querySelector('#memory-saved-status')?.textContent.includes('已删除'));
    assert.equal((await read()).length, 0);
    assert.equal((await read(ref.id)).length, 0);
    await close();
    ({admin} = await launch());
    await admin.locator('#memory-list-saved').click();
    await admin.waitForFunction(() => document.querySelector('#memory-saved-status')?.textContent.includes('没有已保存'));
    assert.equal((await read(ref.id)).length, 0);
    assert.equal(fs.readFileSync(path.join(vault, 'note.md'), 'utf8'), '合成偏好：周一查看计划。\n');
    const wikiNote = path.join(vault, 'wiki.md');
    fs.writeFileSync(wikiNote, '合成Wiki：原始版本。\n');
    await app.evaluate(({dialog}) => {dialog.showMessageBox = async () => ({response: 0});});
    await admin.locator('#memory-query').fill('合成Wiki');
    await admin.locator('#memory-search-form button').click();
    await admin.waitForSelector('[data-memory-save="0"]');
    await admin.locator('[data-memory-summary="0"]').fill('合成 Wiki 摘录');
    await admin.locator('[data-memory-save="0"]').click();
    await admin.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes('版本 1'));
    const wikiFact = (await read())[0];
    assert.ok(wikiFact.sourceRef.startsWith('wiki-v1:'));
    fs.writeFileSync(wikiNote, '合成Wiki：修改后的版本。\n');
    await admin.locator('#memory-list-saved').click();
    await admin.waitForFunction(() => document.querySelector('#content')?.textContent.includes('来源已变化，后续任务不可消费'));
    assert.equal((await read()).length, 0);
    const invalidated = (await read(wikiFact.ref.id)).at(-1);
    assert.equal(invalidated.ref.revision, 2);
    assert.equal(invalidated.confirmation, 'external_observation');
    assert.equal(await admin.locator('[data-ml-use]').count(), 0);
    await admin.locator('[data-memory-delete="0"]').click();
    await admin.waitForFunction(() => document.querySelector('#memory-saved-status')?.textContent.includes('已删除'));
    assert.equal((await read(wikiFact.ref.id)).length, 0);
    await close();
    console.log('PASS: isolated Competition Electron save/correction/withdrawal/restart/delete and Wiki source invalidation; synthetic dialogs, zero cloud transport');
  } finally {
    if (app) await app.close();
    const relation = path.relative(os.tmpdir(), base);
    if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) {
      throw Error('Refusing to remove a path outside the test temp directory');
    }
    fs.rmSync(base, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
