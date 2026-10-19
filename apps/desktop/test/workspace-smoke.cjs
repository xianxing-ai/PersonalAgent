const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {_electron} = require('playwright');

(async () => {
  const project = path.resolve(__dirname, '..');
  const output = path.join(project, '.cache/qa-workspace');
  fs.mkdirSync(output, {recursive: true});
  const localElectron = path.join(project, 'node_modules/electron/dist/electron.exe');
  const executablePath = fs.existsSync(localElectron) ? localElectron : path.resolve(project, '../../node_modules/electron/dist/electron.exe');
  const app = await _electron.launch({
    executablePath,
    args: [project, '--fake-runtime'],
    env: {...process.env, ELECTRON_RUN_AS_NODE: undefined, PA_DESKTOP_EPHEMERAL_MODEL: '1'},
  });
  const errors = [];
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));

  async function captureNative(mode, file) {
    const wasOnTop = await app.evaluate(({BrowserWindow}, selectedMode) => {
      const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes(`mode=${selectedMode}`));
      const previous = win.isAlwaysOnTop();
      win.setAlwaysOnTop(true); win.show(); win.moveTop(); win.focus();
      return previous;
    }, mode);
    await new Promise(resolve => setTimeout(resolve, 200));
    const png = await app.evaluate(async ({BrowserWindow, desktopCapturer, screen}, selectedMode) => {
      const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes(`mode=${selectedMode}`));
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const sources = await desktopCapturer.getSources({types: ['screen'], thumbnailSize: {width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor)}});
      const source = sources.find(item => item.display_id === String(display.id)) ?? sources[0];
      if (!source) throw Error('Display capture unavailable');
      const factor = source.thumbnail.getSize().width / display.size.width;
      return source.thumbnail.crop({x: Math.round((bounds.x - display.bounds.x) * factor), y: Math.round((bounds.y - display.bounds.y) * factor), width: Math.round(bounds.width * factor), height: Math.round(bounds.height * factor)}).toPNG().toString('base64');
    }, mode);
    fs.writeFileSync(path.join(output, file), Buffer.from(png, 'base64'));
    await app.evaluate(({BrowserWindow}, input) => BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes(`mode=${input.mode}`)).setAlwaysOnTop(input.wasOnTop), {mode, wasOnTop});
  }

  try {
    await app.firstWindow();
    const orb = app.windows().find(page => page.url().includes('mode=orb'));
    await orb.evaluate(() => window.desktop.invoke('orb.open'));
    const panel = app.windows().find(page => page.url().includes('mode=panel'));
    await panel.waitForSelector('#panel-expand');
    await panel.locator('textarea[aria-label="任务内容"]').fill('从小面板继续');
    const opened = app.waitForEvent('window');
    await panel.locator('#panel-expand').click();
    const workspace = await opened;
    await workspace.waitForSelector('#workspace-stage');

    assert.equal(await workspace.locator('.workspace-compose-area').count(), 0);
    assert.equal(await workspace.locator('#workspace-input').count(), 0);
    assert.equal(await workspace.locator('#workspace-send').count(), 0);
    assert.equal(await workspace.locator('#workspace-runtime').count(), 0);
    assert.equal(await workspace.locator('#workspace-model-name').count(), 0);
    assert.equal(await panel.locator('textarea[aria-label="任务内容"]').inputValue(), '从小面板继续');
    assert.equal(await workspace.locator('.workspace-sidebar').count(), 0);
    assert.equal(await workspace.locator('[data-connector]').count(), 5);
    assert.match(await workspace.locator('.connector-card').first().innerText(),/暂无天气数据/);
    assert.doesNotMatch(await workspace.locator('.connector-board').innerText(),/林晓|陈悦|整理今日计划/);

    const bounds = await app.evaluate(({BrowserWindow, screen}) => {
      const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('mode=workspace'));
      return {bounds: win.getBounds(), area: screen.getDisplayMatching(win.getBounds()).workArea, panelVisible: BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('mode=panel')).isVisible()};
    });
    assert.equal(bounds.panelVisible, false);
    assert.ok(
      Math.abs(bounds.bounds.x + bounds.bounds.width / 2 - (bounds.area.x + bounds.area.width / 2)) <= 1.5,
      `workspace is not horizontally centered: ${JSON.stringify(bounds)}`,
    );
    assert.ok(
      Math.abs(bounds.bounds.y + bounds.bounds.height / 2 - (bounds.area.y + bounds.area.height / 2)) <= 1.5,
      `workspace is not vertically centered: ${JSON.stringify(bounds)}`,
    );

    await workspace.locator('#workspace-orb').click();
    assert.equal(await workspace.locator('#workspace-orb').getAttribute('aria-pressed'), 'true');
    await workspace.waitForFunction(() => document.querySelector('#workspace-orb').getAttribute('aria-pressed') === 'false');
    const adminOpened = app.waitForEvent('window');
    await workspace.locator('[data-open-settings="settings"]').click();
    const admin = await adminOpened;
    await admin.waitForSelector('[data-page="appearance"]');
    for (const removed of ['import', 'browser', 'account', 'usage']) assert.equal(await admin.locator(`.side [data-page="${removed}"]`).count(), 0);
    assert.equal(await admin.locator('.side [data-page="tasks"]').count(), 1, 'the current task monitoring route remains available');
    await admin.locator('[data-page="appearance"]').click();
    for (const theme of ['dark', 'light']) {
      await admin.locator('#pref-theme').selectOption(theme);
      await workspace.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
      assert.equal(await workspace.locator('.workspace').evaluate(element => getComputedStyle(element).backgroundColor), theme === 'light' ? 'rgb(250, 250, 250)' : 'rgb(16, 16, 16)');
      assert.equal(await admin.locator('.admin').evaluate(element => getComputedStyle(element).backgroundColor), theme === 'light' ? 'rgb(250, 250, 250)' : 'rgb(16, 16, 16)');
      await workspace.screenshot({path: path.join(output, `workspace-${theme}.png`)});
      if (theme === 'light') await captureNative('workspace', 'native-workspace.png');
    }
    await admin.locator('#pref-theme').selectOption('system');
    await admin.close();

    await workspace.locator('[data-window="close"]').click();
    await orb.evaluate(() => window.desktop.invoke('orb.open'));
    await panel.locator('#send').click();
    await panel.waitForSelector('[data-action="task.cancel"]');
    await panel.evaluate(async () => {
      const snapshot = await window.desktop.invoke('snapshot');
      for (let step = 0; step < 4; step++) await window.desktop.invoke('test.advance', snapshot.value.tasks[0].taskId);
    });
    await panel.locator('textarea[aria-label="任务内容"]').fill('小窗口的第二轮');
    await panel.locator('#send').click();
    await panel.waitForFunction(() => document.querySelectorAll('[data-turn]').length === 2);
    assert.equal(await panel.locator('.conversation-rail button').count(), 2);
    assert.equal(await panel.locator('.thread').evaluate(element => getComputedStyle(element).scrollbarWidth), 'none');
    await panel.screenshot({path: path.join(output, 'panel-light.png')});
    await captureNative('panel', 'native-panel.png');
    assert.deepEqual(errors, []);
    console.log('PASS: large workspace composer removed; opaque themes, connectors, orb burst, panel conversation rail and native clipping verified; screenshots: ' + output);
  } finally {
    await app.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
