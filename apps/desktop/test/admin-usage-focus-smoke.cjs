const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron} = require('playwright');
const {closeDesktop} = require('../test-support/close-desktop.cjs');

async function run() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'synstar-usage-focus-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PA_')));
  let app;
  try {
    app = await _electron.launch({
      executablePath: require('electron'),
      args: [path.resolve(__dirname, '..'), '--fake-runtime'],
      env: {...env, ELECTRON_RUN_AS_NODE: undefined, PA_USER_DATA_DIR: profile, PA_RUNTIME_PROFILE: 'local'},
    });
    await app.firstWindow();
    const orb = app.windows().find(page => page.url().includes('mode=orb'));
    await orb.waitForSelector('.orb-button');
    await orb.evaluate(() => window.desktop.invoke('orb.open'));
    const panel = app.windows().find(page => page.url().includes('mode=panel'));
    const [admin] = await Promise.all([app.waitForEvent('window'), panel.locator('#admin').click()]);
    await admin.getByRole('button', {name: '专业配置', exact: true}).click();
    for (const page of ['usage', 'profile']) {
      await admin.locator(`.side [data-page="${page}"]`).click();
      const metrics = admin.locator(`#content[data-section="${page}"] [data-ud-metric]`);
      await metrics.first().focus();
      for (const [key, metric] of [['Tab', 'cost'], ['Shift+Tab', 'tokens']]) {
        await admin.keyboard.press(key);
        assert.equal(await admin.evaluate(() => document.activeElement.dataset.udMetric), metric);
        await admin.keyboard.press('Enter');
        await admin.waitForFunction(metric => document.activeElement?.dataset.udMetric === metric
          && document.activeElement.getAttribute('aria-pressed') === 'true', metric);
      }
    }
    console.log('PASS: usage and profile retain keyboard focus when changing the dashboard metric');
  } finally {
    if (app) await closeDesktop(app);
    await fs.rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
