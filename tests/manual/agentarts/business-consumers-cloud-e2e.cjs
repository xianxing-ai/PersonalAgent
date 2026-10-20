const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {_electron} = require('playwright');

// Manual, paid business-consumer acceptance (#354 缺口 5). The caller opts in
// explicitly; credentials load from the trusted DPAPI saved config copy, never
// from this file. Synthetic meeting fixtures are NOT used: the real public
// connector host executes the proposed business tool locally.
if (process.env.PA_MANUAL_BUSINESS_CLOUD_E2E !== '1'
  || !['PA_AGENTARTS_AUTHORIZATION', 'PA_AGENTARTS_GATEWAY_URL',
    'PA_AGENTARTS_RUNTIME_NAME'].every(key => process.env[key])) {
  throw Error('Explicit business cloud E2E opt-in and host placeholders are required');
}
const root = path.resolve(__dirname, '../../..');
const desktop = path.join(root, 'apps/desktop');
const electron = path.join(root, 'node_modules/electron/dist/electron.exe');
const evidenceDir = path.join(root, '.cache/business-consumers-evidence-20261019');
fs.mkdirSync(evidenceDir, {recursive: true});
const savedConfig = path.join(root, '.cache/sis-live-user-data');
const userData = path.join(evidenceDir, 'userdata');
fs.rmSync(userData, {recursive: true, force: true});
fs.mkdirSync(userData, {recursive: true});
for (const name of ['agentarts-config.json', 'Local State']) {
  if (!fs.existsSync(path.join(savedConfig, name))) throw Error(`Saved trusted config copy is missing ${name}`);
  fs.copyFileSync(path.join(savedConfig, name), path.join(userData, name));
}

const tool = process.argv[2] ?? 'weather';
const scenarios = {
  weather: {
    goal: '业务工具验收。请提出本地只读工具请求以查询北京市今天的天气（公制单位）。不要在云端执行工具、猜测内容或声称完成。最终只输出单个 JSON 对象，无 Markdown、前后说明或额外字段：'
      + '{"kind":"tool_proposal","proposalId":"business-weather-1","toolName":"weather.forecast","toolVersion":"1.0.0",'
      + '"arguments":{"location":"北京","locationQuery":"Beijing","units":"metric"}}。不得输出 verification、授权或 Evidence。',
    expectTool: 'weather.forecast',
  },
  research: {
    goal: '业务工具验收。请提出本地只读工具请求以检索关于 urban heat island mitigation 的研究资料（一条即可）。不要在云端执行工具、猜测内容或声称完成。最终只输出单个 JSON 对象，无 Markdown、前后说明或额外字段：'
      + '{"kind":"tool_proposal","proposalId":"business-research-1","toolName":"research.search","toolVersion":"1.0.0",'
      + '"arguments":{"query":"urban heat island mitigation"}}。不得输出 verification、授权或 Evidence。',
    expectTool: 'research.search',
  },
};
const scenario = scenarios[tool];
if (!scenario) throw Error(`Unknown scenario ${tool}; use weather|research`);

const report = {profile: 'huawei_ict_agentarts', surface: 'Electron Desktop 业务工具全链路（非合成组合）',
  startedAt: new Date().toISOString(), dataClass: 'public', scenario: tool, expectTool: scenario.expectTool,
  userData, stage: 'launch'};

async function snapshot(page) {
  return (await page.evaluate(() => window.desktop.invoke('snapshot'))).value;
}
async function waitUntil(check, timeoutMs = 190_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const found = await check();
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error('Timed out waiting for Desktop state at stage ' + report.stage);
}
async function pageFor(app, mode) {
  return waitUntil(() => app.windows().find(page => page.url().includes(`mode=${mode}`)), 15_000);
}
async function launch() {
  const app = await _electron.launch({executablePath: electron, args: [desktop], env: {
    ...process.env, ELECTRON_RUN_AS_NODE: undefined,
    PA_RUNTIME_PROFILE: 'huawei_ict_agentarts',
    PA_AGENTARTS_INVOKE_MODE: 'published', PA_AGENTARTS_RESPONSE_MODE: 'tool-proposal-json',
    PA_AGENTARTS_REPAIR_CANDIDATE_VERSION: '1.0', PA_DESKTOP_TEST_USER_DATA: userData,
    PA_DESKTOP_MODEL_MODE: undefined, PA_DESKTOP_SYNTHETIC_MVP: undefined,
  }});
  await app.firstWindow();
  const orb = await pageFor(app, 'orb');
  await orb.evaluate(() => window.desktop.invoke('orb.open'));
  const panel = await pageFor(app, 'panel');
  await panel.waitForSelector('#send');
  return {app, panel};
}

(async () => {
  let session;
  try {
    session = await launch();
    report.stage = 'submit';
    const {app, panel} = session;
    await app.evaluate(() => {
      const originalFetch = globalThis.fetch;
      globalThis.__businessFetchInfo = [];
      globalThis.fetch = async (...args) => {
        const item = {attempt: globalThis.__businessFetchInfo.length + 1,
          startedAt: new Date().toISOString(), url: String(args[0]).slice(0, 120)};
        const requestId = args[1]?.headers?.['X-Request-Id'];
        if (typeof requestId === 'string' && /^[0-9a-f-]{36}$/.test(requestId)) item.requestId = requestId;
        globalThis.__businessFetchInfo.push(item);
        const response = await originalFetch(...args);
        item.status = response.status;
        item.responseAt = new Date().toISOString();
        return response;
      };
    });
    const goalInput = panel.locator('textarea:visible').first();
    await goalInput.waitFor({state: 'visible', timeout: 15_000});
    await goalInput.fill(scenario.goal);
    await panel.locator('#send').click();
    const source = await waitUntil(async () => {
      const data = await snapshot(panel);
      return data.tasks.find(task => task.goal === scenario.goal);
    });
    report.sourceTaskId = source.taskId;
    report.stage = 'approval-or-auto-execute';
    const completed = await waitUntil(async () => {
      const data = await snapshot(panel);
      const pending = data.approvals.find(item => item.taskId === source.taskId && item.state === 'pending');
      if (pending && !report.approvalId) {
        report.approvalId = pending.approvalId;
        report.approvalMode = 'manual-allow-once';
        await panel.evaluate(() => window.desktop.invoke('admin.open', {page: 'authorizations'}));
        const admin = await pageFor(app, 'admin');
        await admin.locator(`[data-approval="allow_once"][data-id="${pending.approvalId}"]`).click();
      }
      const task = data.tasks.find(item => item.taskId === source.taskId);
      if (task?.state === 'failed') throw Error('Business task failed: ' + JSON.stringify(task.error));
      return task?.state === 'succeeded' ? task : undefined;
    });
    report.stage = 'capture';
    report.sourceState = completed.state;
    report.resultSummary = completed.resultSummary;
    report.resultMetadata = completed.resultMetadata;
    if (!report.approvalId) report.approvalMode = 'automatic-read-tool';
    report.fetchInfo = await app.evaluate(() => globalThis.__businessFetchInfo ?? []);
    await panel.screenshot({path: path.join(evidenceDir, `business-e2e-${tool}.png`)});
    await app.close();
    session = undefined;
    const {createRuntimeApplication} = await import('@personal-agent/runtime/application');
    const readback = createRuntimeApplication({path: path.join(userData, 'runtime.sqlite'),
      profile: 'huawei_ict_agentarts'});
    try {
      const children = readback.readSubagentTasks(report.sourceTaskId).map(task => task.taskId);
      report.subtaskIds = children;
      const records = [report.sourceTaskId, ...children]
        .flatMap(taskId => readback.runtime.readToolExecutions(taskId));
      report.toolExecutions = records.map(record => ({toolName: record.toolName, toolVersion: record.toolVersion,
        state: record.state, policyDecision: record.policyDecision, evidenceId: record.evidenceId}));
      assert.ok(records.length >= 1, 'at least one real local tool execution is required');
      assert.ok(records.some(record => record.toolName === scenario.expectTool && record.state === 'confirmed'
        && record.policyDecision === 'allow'), `confirmed ${scenario.expectTool} execution is required`);
    } finally { readback.close(); }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(evidenceDir, `business-e2e-${tool}.json`), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({status: 'succeeded', scenario: tool, taskId: report.sourceTaskId,
      approvalMode: report.approvalMode, tools: report.toolExecutions,
      agentartsCalls: report.fetchInfo.length}));
  } catch (error) {
    report.error = String(error?.message ?? error);
    report.failedAt = new Date().toISOString();
    fs.writeFileSync(path.join(evidenceDir, `business-e2e-${tool}-failed.json`), JSON.stringify(report, null, 2) + '\n');
    console.error(report.error);
    if (session) await session.app.close().catch(() => {});
    process.exitCode = 1;
  }
})();
