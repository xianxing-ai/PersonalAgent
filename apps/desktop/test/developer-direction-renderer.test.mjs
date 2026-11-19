import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

test('developer direction panel renders in headless chromium when a browser is installed', async t => {
  let chromium;
  try {({chromium} = await import('playwright'));}
  catch (error) {t.skip(`playwright 不能导入：${error instanceof Error ? error.message : 'import failed'}`); return;}
  let browser;
  try {browser = await chromium.launch({headless: true});}
  catch (error) {t.skip(`无头 Chromium 不可用：${error instanceof Error ? error.message : 'launch failed'}`); return;}
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><body>
        <script type="module">
          import {mountDeveloperDirectionControls} from '/src/features/admin/developer-direction-controls.js';
          window.calls = [];
          mountDeveloperDirectionControls(document.body, async (_channel, payload) => {
            window.calls.push(payload);
            if (payload.action === 'board') return {items: [{id: 'g1', sentence: '修好 CI', status: 'open', step: '诊断', headSha: 'abc'}], timeline: [{id: 'n1', at: '2026-11-03T00:00:00.000Z', summary: '需要确认', delivered: true, evidenceRef: 'desktop:n1'}]};
            return {id: 'g1', pullRequestBody: '## 结论\\nok'};
          });
        </script></body>`);
      return;
    }
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${root}${path.sep}`)) {response.writeHead(404); response.end(); return;}
    response.setHeader('content-type', 'text/javascript; charset=utf-8');
    response.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const page = await browser.newPage();
    const address = server.address();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.getByRole('button', {name: '刷新看板'}).click();
    await page.getByRole('button', {name: '暂停'}).click();
    const calls = await page.evaluate(() => window.calls.map(item => item.action));
    assert.deepEqual(calls, ['board', 'pause', 'board']);
    await page.getByLabel('一句话目标').fill('修好这个 PR 的 CI');
    await page.getByRole('button', {name: '下达目标'}).click();
    await page.waitForFunction(() => window.calls.some(item => item.action === 'goal'));
    const submitted = await page.evaluate(() => window.calls.find(item => item.action === 'goal'));
    assert.equal(submitted.action, 'goal');
    assert.equal(submitted.sentence, '修好这个 PR 的 CI');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
