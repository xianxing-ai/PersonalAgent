const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {_electron} = require('playwright');
const {closeDesktop}=require('../test-support/close-desktop.cjs');

(async () => {
  const project = path.resolve(__dirname, '..');
  const output = path.join(project, '.cache/qa-workspace');
  fs.mkdirSync(output, {recursive: true});
  const localElectron = path.join(project, 'node_modules/electron/dist/electron.exe');
  const executablePath = fs.existsSync(localElectron) ? localElectron : path.resolve(project, '../../node_modules/electron/dist/electron.exe');
  const app = await _electron.launch({
    executablePath,
    args: [project, '--fake-runtime'],
    env: {...process.env, ELECTRON_RUN_AS_NODE: undefined, PA_DESKTOP_EPHEMERAL_MODEL: '1',PA_USER_DATA_DIR:fs.mkdtempSync(path.join(output,'profile-'))},
  });
  const errors = [], shellCases = [];
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));

  async function assertFlatShell(page, selector) {
    const shell = await page.locator(selector).evaluate(element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight,
        border:style.borderTopWidth,radius:style.borderRadius,shadow:style.boxShadow,clip:style.clipPath,
        blur:style.backdropFilter,background:style.backgroundColor};
    });
    assert.equal(shell.x,0);assert.equal(shell.y,0);
    assert.ok(Math.abs(shell.width-shell.viewportWidth)<1 && Math.abs(shell.height-shell.viewportHeight)<1,JSON.stringify(shell));
    assert.equal(shell.border,'0px');assert.equal(shell.radius,'0px');
    assert.equal(shell.shadow,'none');assert.equal(shell.clip,'none');assert.equal(shell.blur,'none');
    assert.match(shell.background,/^rgba?\(/,'the workspace has a readable acrylic coat; settings retain their opaque theme');
    shellCases.push({selector,...shell});
  }

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
      // Maximized Windows bounds include the invisible native resize margin.
      // Capture only our actual content, excluding other apps and the taskbar.
      const bounds = win.getContentBounds();
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
    await orb.waitForSelector('.orb-button');
    // This suite tests expansion. Native hover is covered by electron-smoke;
    // a real desktop pointer near the orb must not reopen it during this test.
    const openingSettings=app.waitForEvent('window');
    await orb.evaluate(()=>window.desktop.openSettings());
    const settings=await openingSettings;await settings.waitForSelector('#settings');
    await settings.evaluate(()=>window.localDesktop.call('save',{hover:false}));
    await settings.close();
    await orb.evaluate(() => window.desktop.invoke('orb.open'));
    const panel = app.windows().find(page => page.url().includes('mode=panel'));
    await panel.waitForSelector('#panel-expand');
    await panel.locator('textarea[aria-label="任务内容"]').fill('从小面板继续');
    const opened = app.waitForEvent('window');
    await panel.locator('#panel-expand').click();
    const workspace = await opened;
    await workspace.waitForSelector('#workspace-stage');
    await workspace.waitForFunction(() => document.documentElement.dataset.windowMaximized === 'false');
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('mode=workspace')).isMaximized()),false,'expand opens a resizable normal window so the native corners are visible');

    assert.equal(await workspace.locator('.workspace-compose-area').count(), 0);
    assert.equal(await workspace.locator('#workspace-input').count(), 0);
    assert.equal(await workspace.locator('#workspace-send').count(), 0);
    assert.equal(await workspace.locator('#workspace-runtime').count(), 0);
    assert.equal(await workspace.locator('#workspace-model-name').count(), 0);
    assert.equal(await panel.locator('textarea[aria-label="任务内容"]').inputValue(), '从小面板继续');
    assert.equal(await workspace.locator('.workspace-sidebar').count(), 0);
    assert.equal(await workspace.locator('.workspace-composer').count(), 1);
    assert.equal(await workspace.locator('.cc-context .connector-board').isVisible(), true);
    assert.equal(await workspace.locator('[data-connector]').count(), 5);
    assert.match(await workspace.locator('.connector-card').first().innerText(),/暂无天气数据/);
    assert.doesNotMatch(await workspace.locator('.connector-board').innerText(),/林晓|陈悦|整理今日计划/);

    const bounds = await app.evaluate(({BrowserWindow, screen}) => {
      const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('mode=workspace'));
      return {bounds: win.getBounds(), contentBounds:win.getContentBounds(), maximized:win.isMaximized(), area: screen.getDisplayMatching(win.getBounds()).workArea, panelVisible: BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('mode=panel')).isVisible()};
    });
    assert.equal(bounds.panelVisible, false);
    assert.ok(bounds.contentBounds.width<=bounds.area.width && bounds.contentBounds.height<=bounds.area.height,`workspace fits the work area: ${JSON.stringify(bounds)}`);
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
    await workspace.locator('.cc-settings').click();
    const admin = await adminOpened;
    await admin.waitForSelector('[data-page="appearance"]',{state:'attached'});
    for (const removed of ['import', 'browser', 'account', 'usage']) assert.equal(await admin.locator(`.side [data-page="${removed}"]`).count(), 0);
    assert.equal(await admin.locator('.side [data-page="tasks"]').count(), 1, 'the current task monitoring route remains available');
    await admin.locator('[data-jump="appearance"]').click();
    for (const theme of ['dark', 'light']) {
      await admin.locator('#pref-theme').selectOption(theme);
      await workspace.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
      const expected=theme==='light'?'rgb(233, 235, 238)':'rgb(17, 18, 21)';
      assert.equal(await workspace.locator('.workspace').evaluate(element => getComputedStyle(element).backgroundColor),expected,'workspace follows the selected solid glass theme');
      assert.equal(await admin.locator('.admin').evaluate(element => getComputedStyle(element).backgroundColor),expected,'settings follow the same theme');
      await assertFlatShell(workspace,'.workspace');
      await assertFlatShell(admin,'.admin');
      for (const page of [workspace,admin]) {
        await page.locator('[data-window="maximize"]').click();
        await page.waitForFunction(() => document.documentElement.dataset.windowMaximized === 'true');
        await assertFlatShell(page,page===workspace?'.workspace':'.admin');
        await page.locator('[data-window="maximize"]').click();
        await page.waitForFunction(() => document.documentElement.dataset.windowMaximized === 'false');
        await assertFlatShell(page,page===workspace?'.workspace':'.admin');
      }
      await workspace.screenshot({path: path.join(output, `workspace-${theme}.png`)});
      await captureNative('workspace', `native-workspace-${theme}.png`);
      await captureNative('admin', `native-admin-${theme}.png`);
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
    fs.writeFileSync(path.join(output,'shell-receipt.json'),JSON.stringify({profile:'explicit_fake_runtime',bounds,shellCases,pageErrors:errors},null,2));
    console.log('PASS: light/dark solid glass workspace and settings; maximize/restore; connectors, orb, conversations and native captures verified; screenshots: ' + output);
  } finally {
    await closeDesktop(app);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
