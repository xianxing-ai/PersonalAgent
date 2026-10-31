const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {_electron} = require('playwright');
const {closeDesktop,trackOwnedDesktop,evaluateBounded}=require('../../../tests/manual/agentarts/desktop-pelican-default-live.cjs');

const desktopDir = path.resolve(__dirname, '..');
const repoDir = path.resolve(desktopDir, '../..');
const localElectron = path.resolve(desktopDir, 'node_modules/electron/dist/electron.exe');
const workspaceElectron = path.resolve(repoDir, 'node_modules/electron/dist/electron.exe');
const executablePath = fs.existsSync(localElectron) ? localElectron : workspaceElectron;
const terminalStates = new Set(['succeeded', 'failed', 'cancelled']);

async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,25));}
  throw new Error('Timed out waiting for acceptance state');
}
async function hostSnapshot(page){const response=await evaluateBounded(page,()=>window.desktop.invoke('snapshot'));
  assert.equal(response.ok,true,response.error);return response.value;}

function createModelServer(secret) {
  const requests = [];
  let aborted = 0;
  const server = http.createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      const body = JSON.parse(raw);
      const prompt = body.messages?.at(-1)?.content ?? '';
      requests.push({prompt, authorized: request.headers.authorization === `Bearer ${secret}`});
      let timer;
      response.on('close', () => {
        if (!response.writableEnded) {
          aborted += 1;
          clearTimeout(timer);
        }
      });
      const answer = prompt === 'Reply with exactly OK.' ? 'OK' : `本地盘古回答：${prompt}`;
      const delay = /窗口重开/.test(prompt) ? 500 : /取消测试|退出保护/.test(prompt) ? 30_000 : 0;
      timer = setTimeout(() => {
        if (response.destroyed) return;
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(JSON.stringify({
          choices: [{message: {role: 'assistant', content: answer}, finish_reason: 'stop'}],
          usage: {prompt_tokens: 3, completion_tokens: 4, total_tokens: 7},
        }));
      }, delay);
    });
  });
  return {
    requests,
    get aborted() { return aborted; },
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      return `http://127.0.0.1:${server.address().port}/openai/v1`;
    },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

async function pageFor(app, mode) {
  await waitFor(() => app.windows().some(page => page.url().includes(`mode=${mode}`)));
  return app.windows().find(page => page.url().includes(`mode=${mode}`));
}

async function launchDesktop(userData, diagnostics) {
  const started=Date.now(),attempt={cleanup:undefined};
  const loader=path.join(path.dirname(require.resolve('playwright-core/package.json')),'lib/server/electron/loader.js');
  const app = await _electron.launch({
    executablePath,
    args: ['-r',loader,desktopDir],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      // This existing local-provider regression uses its own HTTP model fixture, never the Competition route.
      PA_RUNTIME_PROFILE: 'local',
      PA_USER_DATA_DIR: undefined,
      PA_DESKTOP_TEST_USER_DATA: userData,
      PA_DESKTOP_EPHEMERAL_MODEL: undefined,
      PA_DESKTOP_MODEL_MODE: undefined,
      PANGU_BASE_URL: undefined,
      PANGU_MODEL: undefined,
      PANGU_DEPLOYMENT: undefined,
      PANGU_API_KEY: undefined,
    },
  });
  try {
  trackOwnedDesktop(app,{executablePath,mainProcessId:await evaluateBounded(app,()=>process.pid)},attempt,started);
  app.context().setDefaultTimeout(15_000);
  if(process.env.PA_DESKTOP_TRACE_WINDOW_LIFECYCLE==='1'){
    let output='';app.process().stderr.on('data',chunk=>{output+=chunk.toString();const lines=output.split(/\r?\n/);output=lines.pop();
      for(const line of lines)if(line.startsWith('PA_SMOKE_NATIVE '))console.log(line);});
    await evaluateBounded(app,({BrowserWindow})=>{for(const method of ['setPosition','setBounds','setShape','show','showInactive','hide','close']){
      const original=BrowserWindow.prototype[method];if(typeof original!=='function')continue;
      BrowserWindow.prototype[method]=function(...args){const detail={method,id:this.id};
        process._rawDebug('PA_SMOKE_NATIVE '+JSON.stringify({...detail,phase:'before'}));
        const result=Reflect.apply(original,this,args);
        process._rawDebug('PA_SMOKE_NATIVE '+JSON.stringify({...detail,phase:'after'}));return result;};
    }});
  }
  app.on('window', page => {
    page.on('pageerror', error => diagnostics.errors.push(error.message));
    page.on('console', message => {
      if (['error', 'warning'].includes(message.type())) diagnostics.logs.push(`${message.type()}: ${message.text()}`);
    });
  });
  await app.firstWindow();
  const orb = await pageFor(app, 'orb');
  await orb.evaluate(() => window.desktop.invoke('orb.open'));
  const panel = await pageFor(app, 'panel');
  await panel.waitForSelector('#send');
  return {app, orb, panel,attempt};
  }catch(error){
    try{await closeDesktop(app);}catch(cleanupError){throw new AggregateError([error,cleanupError],'Owned Desktop startup and cleanup failed');}
    throw error;
  }
}

async function openAdmin(app, panel) {
  const opened = await panel.evaluate(() => window.desktop.invoke('admin.open', {page: 'models'}));
  assert.equal(opened.ok, true, opened.error);
  const admin = await pageFor(app, 'admin');
  await admin.waitForSelector('[data-page="models"]');
  await admin.waitForFunction(() => document.querySelector('[data-page="models"]')?.getAttribute('aria-current') === 'page');
  assert.equal(await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()
    .some(window => window.webContents.getURL().includes('mode=admin') && window.isVisible())), true,
  'the current settings window must actually be visible');
  return admin;
}

async function openWorkspace(app, panel) {
  const existing = app.windows().find(page => page.url().includes('mode=workspace'));
  if (existing) return existing;
  const opening = app.waitForEvent('window',{timeout:15_000});
  await panel.locator('#panel-expand').click();
  const workspace = await opening;
  await workspace.waitForSelector('#workspace-stage');
  return workspace;
}

async function submitAndWait(page, inputSelector, buttonSelector, goal, answer) {
  await page.locator(inputSelector).fill(goal);
  await page.locator(buttonSelector).click();
  await page.waitForFunction(expected => document.body.innerText.includes(expected), answer, {timeout: 10_000});
}

function scanFiles(root, needle) {
  const hits = [];
  const visit = target => {
    let stat;
    try { stat = fs.statSync(target); } catch { return; }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target)) visit(path.join(target, name));
      return;
    }
    if (stat.size > 5_000_000) return;
    try { if (fs.readFileSync(target).includes(Buffer.from(needle))) hits.push(target); } catch {}
  };
  visit(root);
  return hits;
}

(async () => {
  const secret = `desktop-acceptance-${process.pid}-${Date.now()}`;
  const server = createModelServer(secret);
  const endpoint = await server.listen();
  const cacheRoot = path.resolve(desktopDir, '.cache');
  fs.mkdirSync(cacheRoot, {recursive: true});
  const userData = fs.mkdtempSync(path.join(cacheRoot, 'runtime-acceptance-'));
  const diagnostics = {errors: [], logs: []};
  let session,stage='launch';
  const mark=value=>{stage=value;console.log(JSON.stringify({stage}));};
  const closeNormally=async()=>{await closeDesktop(session.app);assert.equal(session.attempt.cleanup.method,'graceful',
    'Normal product quit must close the original Desktop without forced cleanup');};
  try {
    session = await launchDesktop(userData, diagnostics);
    mark('model-settings');
    let {app, orb, panel} = session;
    let admin = await openAdmin(app, panel);
    await admin.locator('#model-add').click();
    await admin.locator('#model-base-url').fill(endpoint);
    await admin.locator('#model-name').fill('acceptance-model');
    await admin.locator('#model-deployment').fill('acceptance-deployment');
    await admin.locator('#model-api-key').fill(secret);
    await admin.locator('#model-save').click();
    await waitFor(async()=>(await hostSnapshot(admin)).model.configured===true);
    assert.equal(await admin.locator('#model-api-key').inputValue(), '');
    assert.equal((await admin.content()).includes(secret), false);
    assert.equal(JSON.stringify(await admin.evaluate(() => window.desktop.invoke('snapshot'))).includes(secret), false);

    await admin.locator('#model-test').click();
    await waitFor(() => server.requests.some(item => item.prompt === 'Reply with exactly OK.'));
    assert.ok(server.requests.every(item => item.authorized));
    const configuredModel=(await hostSnapshot(panel)).model;
    assert.equal(configuredModel.provider,'pangu');
    await panel.waitForFunction(label=>document.querySelector('[data-picker-model]')?.textContent===label,configuredModel.label);

    const panelGoal = '小窗口 Runtime Application 验收';
    mark('original-panel-task');
    await submitAndWait(panel, 'textarea[aria-label="任务内容"]', '#send', panelGoal, `本地盘古回答：${panelGoal}`);
    const panelSnapshot = await panel.evaluate(() => window.desktop.invoke('snapshot'));
    assert.equal(panelSnapshot.value.tasks.length, 1);
    assert.equal(panelSnapshot.value.tasks[0].state, 'succeeded');

    const reopenGoal = '窗口重开不重复执行';
    mark('workspace-open');
    await panel.locator('textarea[aria-label="任务内容"]').fill(reopenGoal);
    await panel.locator('#send').click();
    await waitFor(() => server.requests.filter(item => item.prompt === reopenGoal).length === 1);
    let workspace = await openWorkspace(app, panel);
    assert.equal(await workspace.locator('.workspace-compose-area').count(), 0);
    assert.equal(await workspace.locator('#workspace-input').count(), 0);
    const workspaceSnapshot = await workspace.evaluate(() => window.desktop.invoke('snapshot'));
    assert.equal(workspaceSnapshot.value.connection, panelSnapshot.value.connection);
    assert.equal(workspaceSnapshot.value.model.deployment, panelSnapshot.value.model.deployment);
    assert.equal(workspaceSnapshot.value.tasks.length, 0);
    mark('workspace-close');
    const closed = workspace.waitForEvent('close');
    await workspace.locator('[data-window="close"]').click();
    await closed;
    mark('workspace-reopen');
    await evaluateBounded(orb,() => window.desktop.invoke('orb.open'));
    mark('panel-restored');
    panel = await pageFor(app, 'panel');
    workspace = await openWorkspace(app, panel);
    mark('workspace-restored');
    await waitFor(async()=>(await hostSnapshot(panel)).tasks.some(task=>task.userMessage===reopenGoal&&task.state==='succeeded'));
    assert.equal(server.requests.filter(item => item.prompt === reopenGoal).length, 1);

    await workspace.locator('[data-window="close"]').click();
    await orb.evaluate(() => window.desktop.invoke('orb.open'));
    panel = await pageFor(app, 'panel');
    await panel.waitForFunction(expected => document.body.innerText.includes(expected), `本地盘古回答：${reopenGoal}`, {timeout: 10_000});
    admin = await openAdmin(app, panel);
    mark('model-disable');
    if (!(await admin.locator('#model-enabled').count())) await admin.locator('[data-page="models"]').click();
    await admin.locator('#model-enabled').uncheck();
    await waitFor(async()=>(await hostSnapshot(admin)).model.enabled===false);
    const callsBeforeDisabledSubmit = server.requests.length;
    const disabledSubmit = await panel.evaluate(() => window.desktop.invoke('task.submit', '停用后不得调用模型'));
    assert.equal(disabledSubmit.ok, false);
    assert.match(disabledSubmit.error, /模型已停用/);
    assert.equal(server.requests.length, callsBeforeDisabledSubmit);
    mark('normal-quit-and-restart');
    await closeNormally();
    session = undefined;

    session = await launchDesktop(userData, diagnostics);
    ({app, orb, panel} = session);
    const restored = await panel.evaluate(() => window.desktop.invoke('snapshot'));
    assert.equal(restored.value.model.configured, true);
    assert.equal(restored.value.model.enabled, false);
    const callsBeforeRestartSubmit = server.requests.length;
    const blockedAfterRestart = await panel.evaluate(() => window.desktop.invoke('task.submit', '重启后仍不得调用模型'));
    assert.equal(blockedAfterRestart.ok, false);
    assert.equal(server.requests.length, callsBeforeRestartSubmit);

    admin = await openAdmin(app, panel);
    await admin.locator('#model-enabled').check();
    await waitFor(async()=>(await hostSnapshot(admin)).model.enabled===true);
    const callsBeforeRetest = server.requests.length;
    await admin.locator('#model-add').click();
    await admin.locator('#model-test').click();
    await waitFor(() => server.requests.length === callsBeforeRetest + 1);
    const enabledGoal = '重新启用后恢复配置';
    await submitAndWait(panel, 'textarea[aria-label="任务内容"]', '#send', enabledGoal, `本地盘古回答：${enabledGoal}`);

    const cancelGoal = '取消测试先确认受理再等待 Runtime 终态';
    mark('cancel-original-task');
    await panel.locator('textarea[aria-label="任务内容"]').fill(cancelGoal);
    await panel.locator('#send').click();
    await waitFor(() => server.requests.some(item => item.prompt === cancelGoal));
    const active = await panel.evaluate(() => window.desktop.invoke('snapshot'));
    const activeTask = active.value.tasks.find(task => task.userMessage===cancelGoal&&!terminalStates.has(task.state));
    assert.ok(activeTask);
    const cancelResult = await panel.evaluate(taskId => window.desktop.invoke('task.cancel', taskId), activeTask.taskId);
    assert.equal(cancelResult.ok, true);
    assert.equal(cancelResult.value.cancelAccepted, true);
    assert.ok(['cancelling', 'cancelled'].includes(cancelResult.value.state));
    await waitFor(() => server.aborted >= 1);
    await waitFor(async()=>(await hostSnapshot(panel)).tasks.find(task=>task.taskId===activeTask.taskId)?.state==='cancelled');

    const quitGoal = '退出保护必须保留活动 Runtime';
    mark('active-task-quit-guard');
    await panel.locator('textarea[aria-label="任务内容"]').fill(quitGoal);
    await panel.locator('#send').click();
    await waitFor(() => server.requests.some(item => item.prompt === quitGoal));
    workspace = await openWorkspace(app, panel);
    const quitResult = await workspace.evaluate(() => window.desktop.invoke('app.quit'));
    assert.equal(quitResult.ok, true);
    await waitFor(async()=>/仍有活动任务/.test((await hostSnapshot(workspace)).connectionError));
    assert.equal(workspace.isClosed(), false);
    const quitSnapshot = await panel.evaluate(() => window.desktop.invoke('snapshot'));
    const quitTask = quitSnapshot.value.tasks.find(task => task.userMessage===quitGoal&&!terminalStates.has(task.state));
    assert.ok(quitTask,'The exact original quit-guard fixture must remain active');
    const quitCancel = await panel.evaluate(taskId => window.desktop.invoke('task.cancel', taskId), quitTask.taskId);
    assert.equal(quitCancel.ok, true);
    assert.equal(quitCancel.value.cancelAccepted, true);
    assert.ok(['cancelling', 'cancelled'].includes(quitCancel.value.state));
    await waitFor(async()=>(await hostSnapshot(panel)).tasks.find(task=>task.taskId===quitTask.taskId)?.state==='cancelled');
    await waitFor(async()=>!/仍有活动任务/.test((await hostSnapshot(workspace)).connectionError??''));

    const qaDir = process.env.PA_DESKTOP_QA_OUTPUT || path.join(os.tmpdir(), 'personal-agent-qa');
    fs.mkdirSync(qaDir, {recursive: true});
    await workspace.screenshot({path: path.join(qaDir, 'runtime-application-workspace.png')});
    const finalSnapshot = await workspace.evaluate(() => window.desktop.invoke('snapshot'));
    assert.equal(await workspace.locator('[data-picker-model]').textContent(),finalSnapshot.value.model.label);
    assert.equal(JSON.stringify(finalSnapshot).includes(secret), false);
    assert.equal((await workspace.content()).includes(secret), false);
    assert.equal(diagnostics.errors.length, 0);
    assert.equal(diagnostics.logs.some(line => line.includes(secret)), false);

    mark('final-normal-quit');
    await closeNormally();
    session = undefined;
    assert.deepEqual(scanFiles(userData, secret), []);
    const gitSearch = spawnSync('git', ['grep', '-l', '--fixed-strings', secret], {cwd: repoDir, encoding: 'utf8'});
    assert.notEqual(gitSearch.status, 0, gitSearch.stdout);
    assert.ok(server.requests.every(item => item.authorized));
    console.log(`PASS: local Runtime Application desktop acceptance (${server.requests.length} model requests, ${server.aborted} cancelled)`);
  } catch(error){console.error('FAIL at '+stage+': '+String(error?.stack??error));throw error;
  } finally {
    if (session) {
      try { await closeDesktop(session.app); } catch(error){console.error('Owned cleanup unconfirmed: '+error.message);}
    }
    await server.close();
    // Retain the isolated original profile and diagnostics for failure analysis.
    console.log(JSON.stringify({stage:'closed',profile:path.basename(userData),cleanup:session?.attempt?.cleanup?.state??'normal-quit'}));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
