const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {_electron} = require('playwright');
const {closeDesktop} = require('../test-support/close-desktop.cjs');

async function inWorkspace(fake, check) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'synstar-repeat-send-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^(PA_|HUAWEI_|AGENTARTS_|OPENAI_|ANTHROPIC_|DASHSCOPE_|ELECTRON_RUN_AS_NODE)/i.test(name)));
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [path.resolve(__dirname, '..'), ...(fake ? ['--fake-runtime'] : [])],
    env: {...env, PA_RUNTIME_PROFILE: fake ? 'local' : 'huawei_ict_agentarts', PA_USER_DATA_DIR: profile},
  });
  try {
    await app.firstWindow();
    const orb = app.windows().find(page => page.url().includes('mode=orb'));
    await orb.waitForSelector('.orb-button');
    await orb.evaluate(() => window.desktop.invoke('orb.open'));
    const panel = app.windows().find(page => page.url().includes('mode=panel'));
    const [workspace] = await Promise.all([app.waitForEvent('window'), panel.locator('#panel-expand').click()]);
    await workspace.locator('#workspace-stage').waitFor();
    await check(app, workspace);
  } finally {
    await closeDesktop(app);
    fs.rmSync(profile, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
  }
}

async function run() {
  await inWorkspace(true, async (app, workspace) => {
    const input = workspace.getByRole('textbox', {name: '工作区任务内容'});
    const send = workspace.getByRole('button', {name: '发送任务', exact: true});
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
  });
  await inWorkspace(false, async (app, workspace) => {
    // An empty Competition profile routes Live to settings without opening an audio session.
    const live = await workspace.evaluate(async () => (await window.desktop.invoke('snapshot')).value.live);
    assert.equal(live.configured, false);
    const admin = app.windows().find(page => page.url().includes('mode=admin'));
    await admin.getByRole('heading', {name: '云端模型', exact: true}).waitFor();
    await workspace.getByRole('button', {name: '实时语音', exact: true}).click();
    await admin.getByRole('heading', {name: '语音', exact: true}).waitFor();
  });
  console.log('PASS: repeated sends preserve one task and the next draft at both widths; deliberate Live opens voice settings');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
