const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {_electron} = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '../../..');
  const out = path.join(root, '.cache/internal-chat-workers-ipc');
  fs.mkdirSync(out, {recursive: true});
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('PA_')));
  const profile = fs.mkdtempSync(path.join(out, 'profile-'));
  const app = await _electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [path.join(root, 'apps/desktop'), '--fake-runtime'],
    env: {...env, ELECTRON_RUN_AS_NODE: undefined, PA_RUNTIME_PROFILE: 'local', PA_DESKTOP_EPHEMERAL_MODEL: '1', PA_USER_DATA_DIR: profile},
  });
  try {
    await app.firstWindow();
    const orb = app.windows().find(page => page.url().includes('mode=orb'));
    await orb.waitForSelector('.orb-button');
    await orb.evaluate(() => window.desktop.invoke('orb.open'));
    const panel = app.windows().find(page => page.url().includes('mode=panel'));
    await panel.waitForSelector('#panel-expand');
    const opening = app.waitForEvent('window');
    await panel.locator('#panel-expand').click();
    const page = await opening;
    await page.waitForSelector('.command-center');
    await page.waitForSelector('.cc-internal-chat');

    const invoke = (name, payload) => page.evaluate(async ({name, payload}) => {
      const result = await window.desktop.invoke(name, payload);
      if (!result.ok) throw Error(result.error || name);
      return result.value;
    }, {name, payload});

    const listed = await invoke('internalChat.list', {limit: 20});
    assert.equal(Array.isArray(listed.messages), true);

    const snap = await invoke('snapshot');
    assert.equal(Array.isArray(snap.internalChat?.messages), true);

    const deniedSend = await page.evaluate(async () => {
      const result = await window.desktop.invoke('internalChat.send', {
        assistantId: 'assistant-1', text: '交付', requestId: 'req-1',
      });
      return result;
    });
    assert.equal(deniedSend.ok, false);

    const workers = await invoke('workers.list', {assistantId: 'assistant-1'});
    assert.equal(Array.isArray(workers.workers), true);

    const deniedInstruct = await page.evaluate(async () => window.desktop.invoke('workers.instruct', {
      assistantTaskId: 'task-1', text: '继续',
    }));
    assert.equal(deniedInstruct.ok, false);

    assert.equal(await page.locator('.cc-internal-chat [data-internal-compose]').count(), 1);
    fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify({
      profile, internalChatList: true, workersList: true, ui: true, fakeRuntime: true,
    }, null, 2));
    console.log('PASS: internalChat.list/workers.list IPC + 内部群聊 UI；send/instruct 在 fake Runtime 明确拒绝');
  } finally {
    await app.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
