import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

// Browser plugin not available. Actual workspace view in installed Chromium;
// task data and the IPC bridge are explicit offline fixtures, with no Runtime or account access.
test('workspace overview mounts no task composer while session actions retain existing drafts', {
  skip: process.env.PA_WORKSPACE_VIEW_UI_TEST !== '1', timeout: 30_000,
}, async t => {
  const {chromium} = await import('playwright');
  const source = resolve(fileURLToPath(new URL('../src', import.meta.url)));
  const html = `<!doctype html><html lang="zh-CN" data-calm="true"><head><meta charset="utf-8">
    <title>PersonalAgent 工作区总览夹具</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/ui/tokens.css">
    <link rel="stylesheet" href="/app/style.css"><link rel="stylesheet" href="/app/surfaces.css"></head>
    <body><main id="root"></main><script type="module">
    import {mountWorkspace} from '/features/workspace/view.js';
    window.calls=[];window.drafts={a:'旧会话尚未发送的草稿',b:'另一会话草稿'};
    window.state={tasks:[],subagentTasks:[{parentTaskId:'parent',taskId:'child',role:'研究',state:'running'}],
      modelChoices:[],capabilities:[],health:[],notifications:[],thinking:{depth:1,fast:false},
      conversationState:{activeId:'a',draft:window.drafts.a,sessions:[{id:'a',title:'主对话一'},{id:'b',title:'主对话二'}]}};
    const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    window.update=mountWorkspace(document.querySelector('#root'),async(name,payload)=>{
      window.calls.push({name,payload});
      if(name==='conversation.draft')window.drafts[payload.conversationId]=payload.text;
      if(name==='conversation.switch'){
        window.state.conversationState={...window.state.conversationState,activeId:payload.conversationId,draft:window.drafts[payload.conversationId]};
        window.update(structuredClone(window.state));
      }
      return {};
    },escape);window.update(structuredClone(window.state));window.ready=true;
    </script></body></html>`;
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/') {response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return;}
    const path = resolve(source, '.' + pathname);
    if (!path.startsWith(source + sep)) {response.writeHead(403); response.end(); return;}
    try {
      response.setHeader('Content-Type', ({'.js':'text/javascript', '.css':'text/css'})[extname(path)] ?? 'application/octet-stream');
      response.end(await readFile(path));
    } catch {response.writeHead(404); response.end();}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({headless: true,
    ...(process.env.PA_WORKSPACE_VIEW_UI_BROWSER ? {executablePath: process.env.PA_WORKSPACE_VIEW_UI_BROWSER} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}), errors=[];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (['warning','error'].includes(message.type())) errors.push(message.text());});
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url); await page.waitForFunction(() => window.ready);
  assert.equal(await page.title(), 'PersonalAgent 工作区总览夹具'); assert.equal(page.url(), url);
  await page.locator('#workspace-stage').waitFor();
  assert.equal(await page.locator('textarea, .workspace-composer, [data-send], [data-stop]').count(), 0);
  assert.equal(await page.getByRole('button', {name:'发送',exact:true}).count(), 0);
  assert.equal(await page.getByRole('button', {name:'停止当前任务',exact:true}).count(), 0);
  assert.equal(await page.locator('.subagent-conversations-entry').count(), 1);
  await page.locator('[data-session-list]').selectOption('b');
  await page.waitForFunction(() => window.state.conversationState.activeId === 'b');
  await page.locator('[data-session-list]').selectOption('a');
  await page.waitForFunction(() => window.state.conversationState.activeId === 'a');
  assert.deepEqual(await page.evaluate(() => window.calls.filter(item => item.name === 'conversation.draft').map(item => item.payload)),
    [{conversationId:'a',text:'旧会话尚未发送的草稿'},{conversationId:'b',text:'另一会话草稿'}]);
  assert.equal((await page.evaluate(() => window.calls)).some(item => /^(task.submit|task.cancel)$/.test(item.name)), false);
  assert.equal(await page.locator('nextjs-portal, #vite-error-overlay').count(), 0);
  if (process.env.PA_WORKSPACE_VIEW_UI_SCREENSHOT) await page.screenshot({path:process.env.PA_WORKSPACE_VIEW_UI_SCREENSHOT});
  assert.deepEqual(errors, []);
});
