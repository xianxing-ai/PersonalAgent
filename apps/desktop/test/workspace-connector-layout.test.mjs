import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {connectorCards} from '../src/features/workspace/connectors.js';

test('long task titles stay inside activity cards at narrow and wide sidebar widths', {
  skip: process.env.PA_WORKSPACE_VIEW_UI_TEST !== '1',
}, async t => {
  const {chromium} = await import('playwright');
  const browser = await chromium.launch({headless:true, executablePath:process.env.PA_WORKSPACE_VIEW_UI_BROWSER});
  t.after(() => browser.close());
  const page = await browser.newPage();
  const title = '更新 QuarterlyReportingAndPlanningProductionChecklist';
  const cards = connectorCards({todo:{items:[{title, status:'open'}]}}, String);
  const styles = ['ui/tokens.css', 'app/style.css', 'app/surfaces.css', 'app/command-center.css',
    'app/solid-glass.css', 'features/workspace/context-sidebar.css'];
  await page.route('http://workspace.test/**', async route => {
    const {pathname} = new URL(route.request().url());
    if (pathname.endsWith('.css')) {
      const file = new URL('../src' + pathname, import.meta.url);
      return route.fulfill({contentType:'text/css', path:fileURLToPath(file)});
    }
    await route.fulfill({contentType:'text/html', body:'<!doctype html><html lang="zh-CN"><meta charset="utf-8">' +
      styles.map(path => '<link rel="stylesheet" href="/' + path + '">').join('') +
      '<body><div class="command-center"><aside class="cc-context" data-context-view="activity">' +
      '<div class="connector-board"><div id="connector-cards">' + cards + '</div></div></aside></div></body></html>'});
  });
  await page.goto('http://workspace.test/');
  const card = page.locator('[data-connector="calendar"]');
  for (const width of [246, 320]) {
    await page.locator('.cc-context').evaluate((side, value) => { side.style.width = value + 'px'; }, width);
    const fits = await card.evaluate(element => {
      const title = element.querySelector('.agenda-row > div').firstChild;
      const range = document.createRange();
      range.selectNodeContents(title);
      const bounds = element.getBoundingClientRect();
      const lines = [...range.getClientRects()];
      return lines.length > 0 && lines.every(rect => rect.width > 0
        && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1);
    });
    assert.ok(fits, 'the full task title must wrap within a ' + width + 'px sidebar');
  }
});
