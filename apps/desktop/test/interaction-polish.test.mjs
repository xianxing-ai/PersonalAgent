import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Actual renderer/CSS in an isolated browser. No credentials, cloud, microphone or writes through IPC.
test('navigation and press feedback survive snapshots, rapid switching and reduced motion', {
  skip: process.env.PA_INTERACTION_UI_TEST !== '1', timeout: 90000,
}, async t => {
  const {chromium} = await import('playwright');
  const source = resolve(fileURLToPath(new URL('../src', import.meta.url)));
  const output = resolve(fileURLToPath(new URL('../.cache/interaction-polish', import.meta.url)));
  await mkdir(output, {recursive: true});
  const fixture = {tasks: [], messages: [], approvals: [], notifications: [], capabilities: [], health: [],
    connection: '隔离界面验证', model: {provider: 'agentarts', configured: false, status: 'unavailable'},
    modelChoices: [], thinking: {depth: 1, fast: false}, adminNavigation: {revision: 1, page: 'settings'}};
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="icon" href="data:,"><link rel="stylesheet" href="/ui/tokens.css"><link rel="stylesheet" href="/app/style.css">
    <link rel="stylesheet" href="/app/surfaces.css"><link rel="stylesheet" href="/app/panel-glass.css"><link rel="stylesheet" href="/app/interaction.css">
    </head><body><main id="root"></main><script>
    window.fixture=${JSON.stringify(fixture)};window.calls=[];
    window.desktop={subscribe(fn){window.refresh=()=>fn(structuredClone(window.fixture));return()=>{}},openSettings:async()=>{},
    invoke:async(name,payload)=>{window.calls.push({name,payload});return{ok:true,value:name==='snapshot'?structuredClone(window.fixture):{}}}};
    </script><script type="module" src="/app/renderer.js"></script></body></html>`;
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/') {res.setHeader('content-type', 'text/html; charset=utf-8');res.end(html);return;}
      const file = resolve(source, '.' + decodeURIComponent(pathname));
      if (!file.startsWith(source + '/') && !file.startsWith(source + '\\')) {res.writeHead(403).end();return;}
      res.setHeader('content-type', extname(file) === '.css' ? 'text/css' : 'text/javascript');
      res.end(await readFile(file));
    } catch {res.writeHead(404).end();}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({headless: true,
    executablePath: process.env.PA_INTERACTION_UI_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport: {width: 1120, height: 760}, reducedMotion: 'no-preference'});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?mode=admin`);
  await page.locator('#desktop-local-settings').waitFor();
  await page.evaluate(() => {localStorage.setItem('pa-theme', 'light');window.dispatchEvent(new StorageEvent('storage', {key:'pa-theme'}));window.refresh();});
  // A live snapshot must not replace the node while Space is held or steal its focus.
  const generalButton = page.locator('[data-jump="models"]').first();
  await generalButton.focus();
  await page.evaluate(() => {window.heldButton = document.activeElement;});
  await page.keyboard.down('Space');
  await page.evaluate(() => window.refresh());
  assert.equal(await page.evaluate(() => window.heldButton === document.activeElement && window.heldButton.isConnected), true);
  await page.keyboard.up('Space');
  await page.waitForFunction(() => document.querySelector('.main').dataset.section === 'models');
  await page.locator('[data-page="appearance"]').click();
  const toggle = page.getByRole('checkbox', {name: '降低动效'});
  await toggle.focus();
  await page.evaluate(() => {window.heldToggle = document.activeElement;});
  await page.keyboard.down('Space');
  await page.evaluate(() => {window.fixture.audioLevel = .6;window.refresh();});
  assert.equal(await page.evaluate(() => window.heldToggle === document.activeElement && window.heldToggle.isConnected), true);
  await page.keyboard.up('Space');
  assert.equal(await toggle.isChecked(), true);
  await page.locator('[data-page="settings"]').click();
  assert.equal(await page.locator('.main').evaluate(el => el.getAnimations().length), 0, 'manual calm suppresses navigation animation');
  await page.locator('[data-page="appearance"]').click();await toggle.uncheck();
  // Old route animations are cancelled. Snapshot refresh and selecting the same page do not restart them.
  await page.evaluate(() => {
    for (const route of ['settings','appearance','tasks','settings']) document.querySelector(`[data-page="${route}"]`).click();
  });
  assert.equal(await page.locator('.main').getAttribute('data-section'), 'settings');
  assert.equal(await page.locator('.side [aria-current="page"]').getAttribute('data-page'), 'settings');
  assert.equal(await page.locator('.main').evaluate(el => el.getAnimations().length), 1);
  await page.evaluate(() => {window.routeAnimation = document.querySelector('.main').getAnimations()[0];window.refresh();document.querySelector('[data-page="settings"]').click();});
  assert.equal(await page.evaluate(() => document.querySelector('.main').getAnimations()[0] === window.routeAnimation), true);
  await page.waitForFunction(() => document.querySelector('.main').getAnimations().length === 0);
  const target = page.locator('#desktop-local-settings');
  await target.hover();await page.mouse.down();
  assert.notEqual(await target.evaluate(el => getComputedStyle(el).transform), 'none', 'held pointer has immediate press feedback');
  await page.mouse.up();
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.locator('[data-page="appearance"]').click();
  assert.equal(await page.locator('.main').evaluate(el => el.getAnimations().length), 0);
  await page.locator('[data-page="settings"]').click();
  await target.hover();await page.mouse.down();
  assert.equal(await target.evaluate(el => getComputedStyle(el).transform), 'none', 'OS calm suppresses press movement');
  await page.mouse.up();
  // Theme changes arrive without replacing a focused control on ordinary snapshots.
  await page.locator('[data-page="appearance"]').click();
  await page.locator('#pref-theme').selectOption('dark');await page.evaluate(() => window.refresh());
  assert.equal(await page.locator('#pref-theme').inputValue(), 'dark');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.locator('.admin').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(16, 16, 16)', 'calm theme changes do not animate the container through gray');
  await page.screenshot({path:join(output,'appearance-dark.png')});
  await page.locator('#pref-theme').selectOption('light');await page.evaluate(() => window.refresh());
  await page.screenshot({path:join(output,'appearance-light.png')});
  for (const viewport of [{width:1120,height:760},{width:600,height:400},{width:462,height:308}]) {
    await page.setViewportSize(viewport);
    for (const route of ['settings','appearance','tasks','models']) {
      await page.locator(`[data-page="${route}"]`).click();
      const issues = await page.evaluate(() => {
        const main = document.querySelector('.main'), nav = document.querySelector('.side nav');
        return [main,nav].filter(el => el.scrollWidth > el.clientWidth + 2).map(el => el.className);
      });
      assert.deepEqual(issues, [], `${route}/${viewport.width}: no horizontal overflow`);
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({snapshots:'stable',keyboard:'one activation',rapidNavigation:'latest route',reducedMotion:'app and OS',layouts:12,pageErrors:errors}));
});
