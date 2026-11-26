const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {_electron} = require('playwright');
const {closeDesktop} = require('../test-support/close-desktop.cjs');

async function run() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'synstar-workspace-nav-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PA_')));
  const app = await _electron.launch({
    executablePath:require('electron'),
    args:[path.resolve(__dirname, '..'), '--fake-runtime'],
    env:{...env, ELECTRON_RUN_AS_NODE:undefined, PA_RUNTIME_PROFILE:'local', PA_DESKTOP_EPHEMERAL_MODEL:'1', PA_USER_DATA_DIR:profile},
  });
  try {
    await app.firstWindow();
    const orb = app.windows().find(page => page.url().includes('mode=orb'));
    await orb.waitForSelector('.orb-button');
    assert.ok((await orb.evaluate(() => window.desktop.invoke('orb.open'))).ok);
    const panel = app.windows().find(page => page.url().includes('mode=panel'));
    await panel.waitForSelector('#panel-expand');
    const [workspace, opened] = await Promise.all([
      app.waitForEvent('window'), panel.evaluate(() => window.desktop.invoke('workspace.open')),
    ]);
    assert.ok(opened.ok);
    await workspace.waitForSelector('.command-center');
    const nav = workspace.getByRole('navigation', {name:'工作台导航'});
    const drawer = workspace.locator('.cc-sidebar-toggle');
    const openNav = async () => { if (!await nav.isVisible()) await drawer.click(); };
    await openNav();
    await nav.waitFor();
    const controls = [['工作台', '工作台'], ['任务记录', '任务'], ['知识与记忆', '知识'], ['设置与偏好', '设置']];
    const button = name => nav.getByRole('button', {name, exact:true});
    const assertPage = async id => {
      const current = await workspace.locator('.cc-rail nav [aria-current]').evaluateAll(nodes =>
        nodes.map(node => [node.dataset.ccNav, node.getAttribute('aria-current')]));
      assert.deepEqual(current, [[id, 'page']]);
    };
    const input = workspace.getByRole('textbox', {name:'工作区任务内容', exact:true});
    await assertPage('home');
    assert.equal(await nav.getByRole('button').count(), controls.length);
    for (const [name, label] of controls) {
      const control = button(name);
      assert.equal(await control.isVisible(), true, name);
      assert.equal(await control.locator('span').isVisible(), true, label);
      assert.equal(await control.locator('span').innerText(), label);
    }
    await workspace.mouse.move(0, 0);
    const activeColor = await button('工作台').evaluate(node => getComputedStyle(node).backgroundColor);
    const idleColor = await button('任务记录').evaluate(node => getComputedStyle(node).backgroundColor);
    assert.notEqual(activeColor, idleColor);
    await button('任务记录').hover();
    await workspace.waitForFunction(({idleColor, activeColor}) => {
      const hovered = document.querySelector('[data-cc-nav="tasks"]:hover');
      if (!hovered) return false;
      const color = getComputedStyle(hovered).backgroundColor;
      return color !== idleColor && color !== activeColor;
    }, {idleColor, activeColor});
    await button('工作台').focus();
    await workspace.keyboard.press('Tab');
    assert.ok(await button('任务记录').evaluate(node => node.matches(':focus-visible')));
    await assertPage('home');

    const draft = '切换任务、知识和设置后保留这份草稿';
    await input.fill(draft);
    for (const [id, name] of [['tasks','任务记录'], ['memory','知识与记忆']]) {
      await openNav();
      await button(name).click();
      await workspace.getByRole('heading', {name, exact:true}).waitFor();
      await assertPage(id);
    }
    await openNav();
    const [admin] = await Promise.all([app.waitForEvent('window'), button('设置与偏好').click()]);
    await admin.waitForURL(url => url.searchParams.get('mode') === 'admin');
    assert.equal(new URL(workspace.url()).searchParams.get('mode'), 'workspace');
    await admin.close();
    await assertPage('memory');
    if (await drawer.isVisible() && await nav.isVisible()) await drawer.click();
    await workspace.getByRole('button', {name:'返回对话', exact:true}).click();
    await input.waitFor();
    await assertPage('home');
    assert.equal(await input.inputValue(), draft);
    await app.evaluate(({BrowserWindow}) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('mode=workspace'));
      win.unmaximize();
      win.setContentSize(760, 540);
    });
    await drawer.waitFor();
    const cardsToggle = workspace.locator('.cc-connectors-toggle');
    const cards = workspace.locator('.cc-context');
    for (const [id, name] of [['tasks','任务记录'], ['memory','知识与记忆']]) {
      await cardsToggle.click();
      await cards.waitFor();
      await drawer.click();
      assert.equal(await cards.isVisible(), false);
      assert.equal(await cardsToggle.getAttribute('aria-expanded'), 'false');
      assert.ok(await button('工作台').evaluate(node => node === document.activeElement));
      await button(name).focus();
      await workspace.keyboard.press('Enter');
      await assertPage(id);
      assert.equal(await drawer.getAttribute('aria-expanded'), 'false');
      const heading = workspace.getByRole('heading', {name, exact:true});
      assert.ok(await heading.evaluate(node => node === document.activeElement));
      assert.equal(await cardsToggle.isVisible(), false);
      await workspace.keyboard.press('Tab');
      assert.ok(await workspace.getByRole('button', {name:'返回对话'}).evaluate(node => node === document.activeElement));
      await drawer.click();
      await button('工作台').click();
      await assertPage('home');
      assert.equal(await drawer.getAttribute('aria-expanded'), 'false');
      assert.ok(await input.evaluate(node => node === document.activeElement));
      assert.equal(await input.inputValue(), draft);
    }
    console.log('PASS: navigation labels and states, separate settings, compact drawers, keyboard focus and retained draft');
  } finally {
    await closeDesktop(app);
    try {
      fs.rmSync(profile, {recursive:true, force:true, maxRetries:4, retryDelay:200});
    } catch (error) {
      if (!['EBUSY','EPERM','ENOTEMPTY'].includes(error.code)) throw error;
      console.warn('Windows still holds the isolated test profile at', profile);
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
