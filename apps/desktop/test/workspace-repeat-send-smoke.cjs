const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {_electron} = require('playwright');
const {closeDesktop} = require('../test-support/close-desktop.cjs');

async function run() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'synstar-repeat-send-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('PA_')));
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [path.resolve(__dirname, '..'), '--fake-runtime'],
    env: {...env, ELECTRON_RUN_AS_NODE: undefined, PA_RUNTIME_PROFILE: 'local', PA_USER_DATA_DIR: profile},
  });
  try {
    await app.firstWindow();
    const orb = app.windows().find(page => page.url().includes('mode=orb'));
    await orb.waitForSelector('.orb-button');
    await orb.evaluate(() => window.desktop.invoke('orb.open'));
    const panel = app.windows().find(page => page.url().includes('mode=panel'));
    const [workspace] = await Promise.all([app.waitForEvent('window'), panel.locator('#panel-expand').click()]);
    const input = workspace.getByRole('textbox', {name: '工作区任务内容'});
    const send = workspace.getByRole('button', {name: '发送任务', exact: true});
    const live = workspace.getByRole('button', {name: '实时语音', exact: true});
    const cdp = await app.context().newCDPSession(workspace);
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 2});
    const tasks = () => workspace.evaluate(async () => (await window.desktop.invoke('snapshot')).value.tasks);

    for (const width of [1140, 760]) {
      const win = await app.browserWindow(workspace);
      await win.evaluate((w, value) => w.setContentSize(value, 620), width);
      await workspace.waitForFunction(value => Math.abs(innerWidth - value) < 2, width);
      for (const method of ['mouse', 'touch', 'keyboard']) {
        const before = new Set((await tasks()).map(item => item.taskId));
        const text = `发送回归 ${width} ${method}`;
        await input.fill(text);
        const rect = await send.boundingBox();
        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        async function activate() {
          if (method === 'keyboard') return workspace.keyboard.press('Enter');
          if (method === 'mouse') return workspace.mouse.click(x, y);
          await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
          await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        }
        await activate();
        await workspace.waitForFunction(() => document.querySelector('.workspace-composer textarea').value === '');
        // Test the original screen coordinate once the first action has changed the toolbar.
        assert.ok(await send.evaluate((button, point) => button.disabled && button.contains(
          document.elementFromPoint(point.x, point.y)), {x, y}), text);
        await activate();
        const draft = `下一条草稿 ${method}`;
        await input.fill(draft);
        const added = (await tasks()).filter(item => !before.has(item.taskId));
        assert.equal(added.length, 1, text);
        assert.equal(Boolean(added[0].cancelRequested), false, text);
        assert.equal(await input.inputValue(), draft);
      }
    }
    await input.fill('');
    assert.equal(await workspace.locator('#workspace-error').textContent(), '');
    await live.click();
    // The local profile declines the deliberate Live request without starting a call.
    await workspace.waitForFunction(() => document.querySelector('#workspace-error').textContent.trim());
    console.log('PASS: repeated mouse, touch and Enter sends keep a single task and preserve the next draft at both widths');
  } finally {
    await closeDesktop(app);
    fs.rmSync(profile, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
