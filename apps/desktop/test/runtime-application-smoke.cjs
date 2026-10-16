const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {_electron} = require('playwright');

const desktopDir = path.resolve(__dirname, '..');
const repoDir = path.resolve(desktopDir, '../..');
const localElectron = path.resolve(desktopDir, 'node_modules/electron/dist/electron.exe');
const workspaceElectron = path.resolve(repoDir, 'node_modules/electron/dist/electron.exe');
const executablePath = fs.existsSync(localElectron) ? localElectron : workspaceElectron;
const terminalStates = new Set(['succeeded', 'failed', 'cancelled']);

function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() >= deadline) return reject(new Error('Timed out waiting for acceptance state'));
      setTimeout(poll, 25);
    };
    poll();
  });
}

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
  const app = await _electron.launch({
    executablePath,
    args: [desktopDir],
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
  return {app, orb, panel};
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
  const opening = app.waitForEvent('window');
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
  let session;
  try {
    session = await launchDesktop(userData, diagnostics);
    let {app, orb, panel} = session;
    let admin = await openAdmin(app, panel);
    await admin.locator('#model-add').click();
    await admin.locator('#model-base-url').fill(endpoint);
    await admin.locator('#model-name').fill('acceptance-model');
    await admin.locator('#model-deployment').fill('acceptance-deployment');
    await admin.locator('#model-api-key').fill(secret);
    await admin.locator('#model-save').click();
    await admin.waitForFunction(async () => (await window.desktop.invoke('snapshot')).value.model.configured === true);
    assert.equal(await admin.locator('#model-api-key').inputValue(), '');
    assert.equal((await admin.content()).includes(secret), false);
    assert.equal(JSON.stringify(await admin.evaluate(() => window.desktop.invoke('snapshot'))).includes(secret), false);

    await admin.locator('#model-test').click();
    await waitFor(() => server.requests.some(item => item.prompt === 'Reply with exactly OK.'));
    assert.ok(server.requests.every(item => item.authorized));

    const panelGoal = '小窗口 Runtime Application 验收';
    await submitAndWait(panel, 'textarea[aria-label="任务内容"]', '#send', panelGoal, `本地盘古回答：${panelGoal}`);
    const panelSnapshot = await panel.evaluate(() => window.desktop.invoke('snapshot'));
    assert.equal(panelSnapshot.value.tasks.length, 1);
    assert.equal(panelSnapshot.value.tasks[0].state, 'succeeded');

    const reopenGoal = '窗口重开不重复执行';
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
    const closed = workspace.waitForEvent('close');
    await workspace.locator('[data-window="close"]').click();
    await closed;
    await orb.evaluate(() => window.desktop.invoke('orb.open'));
    panel = await pageFor(app, 'panel');
    workspace = await openWorkspace(app, panel);
    await panel.waitForFunction(async expected => (await window.desktop.invoke('snapshot')).value.tasks.some(task => task.userMessage === expected && task.state === 'succeeded'), reopenGoal, {timeout: 10_000});
    assert.equal(server.requests.filter(item => item.prompt === reopenGoal).length, 1);

    await workspace.locator('[data-window="close"]').click();
    await orb.evaluate(() => window.desktop.invoke('orb.open'));
    panel = await pageFor(app, 'panel');
    await panel.waitForFunction(expected => document.body.innerText.includes(expected), `本地盘古回答：${reopenGoal}`, {timeout: 10_000});
    admin = await openAdmin(app, panel);
    if (!(await admin.locator('#model-enabled').count())) await admin.locator('[data-page="models"]').click();
    await admin.locator('#model-enabled').uncheck();
    await admin.waitForFunction(async () => (await window.desktop.invoke('snapshot')).value.model.enabled === false);
    const callsBeforeDisabledSubmit = server.requests.length;
    const disabledSubmit = await panel.evaluate(() => window.desktop.invoke('task.submit', '停用后不得调用模型'));
    assert.equal(disabledSubmit.ok, false);
    assert.match(disabledSubmit.error, /模型已停用/);
    assert.equal(server.requests.length, callsBeforeDisabledSubmit);
    await app.close();
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
    await admin.waitForFunction(async () => (await window.desktop.invoke('snapshot')).value.model.enabled === true);
    const callsBeforeRetest = server.requests.length;
    await admin.locator('#model-add').click();
    await admin.locator('#model-test').click();
    await waitFor(() => server.requests.length === callsBeforeRetest + 1);
    const enabledGoal = '重新启用后恢复配置';
    await submitAndWait(panel, 'textarea[aria-label="任务内容"]', '#send', enabledGoal, `本地盘古回答：${enabledGoal}`);

    const cancelGoal = '取消测试先确认受理再等待 Runtime 终态';
    await panel.locator('textarea[aria-label="任务内容"]').fill(cancelGoal);
    await panel.locator('#send').click();
    await waitFor(() => server.requests.some(item => item.prompt === cancelGoal));
    const active = await panel.evaluate(() => window.desktop.invoke('snapshot'));
    const activeTask = active.value.tasks.find(task => !terminalStates.has(task.state));
    assert.ok(activeTask);
    const cancelResult = await panel.evaluate(taskId => window.desktop.invoke('task.cancel', taskId), activeTask.taskId);
    assert.equal(cancelResult.ok, true);
    assert.equal(cancelResult.value.cancelAccepted, true);
    assert.ok(['cancelling', 'cancelled'].includes(cancelResult.value.state));
    await waitFor(() => server.aborted >= 1);
    await panel.waitForFunction(async taskId => (await window.desktop.invoke('snapshot')).value.tasks.find(task => task.taskId === taskId)?.state === 'cancelled', activeTask.taskId);

    const quitGoal = '退出保护必须保留活动 Runtime';
    await panel.locator('textarea[aria-label="任务内容"]').fill(quitGoal);
    await panel.locator('#send').click();
    await waitFor(() => server.requests.some(item => item.prompt === quitGoal));
    workspace = await openWorkspace(app, panel);
    const quitResult = await workspace.evaluate(() => window.desktop.invoke('app.quit'));
    assert.equal(quitResult.ok, true);
    await workspace.waitForFunction(async () => /仍有活动任务/.test((await window.desktop.invoke('snapshot')).value.connectionError));
    assert.equal(workspace.isClosed(), false);
    const quitSnapshot = await panel.evaluate(() => window.desktop.invoke('snapshot'));
    const quitTask = quitSnapshot.value.tasks.find(task => !terminalStates.has(task.state));
    const quitCancel = await panel.evaluate(taskId => window.desktop.invoke('task.cancel', taskId), quitTask.taskId);
    assert.equal(quitCancel.ok, true);
    assert.equal(quitCancel.value.cancelAccepted, true);
    assert.ok(['cancelling', 'cancelled'].includes(quitCancel.value.state));
    await panel.waitForFunction(async taskId => (await window.desktop.invoke('snapshot')).value.tasks.find(task => task.taskId === taskId)?.state === 'cancelled', quitTask.taskId);
    await workspace.waitForFunction(async () => !/仍有活动任务/.test((await window.desktop.invoke('snapshot')).value.connectionError ?? ''));

    const qaDir = process.env.PA_DESKTOP_QA_OUTPUT || path.join(os.tmpdir(), 'personal-agent-qa');
    fs.mkdirSync(qaDir, {recursive: true});
    await workspace.screenshot({path: path.join(qaDir, 'runtime-application-workspace.png')});
    const finalSnapshot = await workspace.evaluate(() => window.desktop.invoke('snapshot'));
    assert.equal(JSON.stringify(finalSnapshot).includes(secret), false);
    assert.equal((await workspace.content()).includes(secret), false);
    assert.equal(diagnostics.errors.length, 0);
    assert.equal(diagnostics.logs.some(line => line.includes(secret)), false);

    await app.close();
    session = undefined;
    assert.deepEqual(scanFiles(userData, secret), []);
    const gitSearch = spawnSync('git', ['grep', '-l', '--fixed-strings', secret], {cwd: repoDir, encoding: 'utf8'});
    assert.notEqual(gitSearch.status, 0, gitSearch.stdout);
    assert.ok(server.requests.every(item => item.authorized));
    console.log(`PASS: local Runtime Application desktop acceptance (${server.requests.length} model requests, ${server.aborted} cancelled)`);
  } finally {
    if (session) {
      try { await session.app.close(); } catch {}
    }
    await server.close();
    const resolved = path.resolve(userData);
    if (resolved.startsWith(path.resolve(cacheRoot) + path.sep) && path.basename(resolved).startsWith('runtime-acceptance-')) {
      fs.rmSync(resolved, {recursive: true, force: true});
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
