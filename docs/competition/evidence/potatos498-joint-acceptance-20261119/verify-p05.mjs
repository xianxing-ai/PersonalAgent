import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const WORKTREE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RECEIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'p05-receipt.json');

const {Client} = await import(pathToFileURL(path.join(WORKTREE, 'packages/client/dist/index.js')).href);
const contracts = await import(pathToFileURL(path.join(WORKTREE, 'packages/contracts/dist/index.js')).href);
const weather = await import(pathToFileURL(path.join(WORKTREE, 'packages/connectors/weather/dist/index.js')).href);
const codingTools = await import(pathToFileURL(path.join(WORKTREE, 'packages/coding-tools/dist/index.js')).href);
const runtimeMod = await import(pathToFileURL(path.join(WORKTREE, 'apps/runtime/dist/application.js')).href);
const {createDesktopDeveloperToolsHost} = await import(pathToFileURL(path.join(WORKTREE, 'apps/desktop/electron/developer-tools-host.js')).href);
const {createPublicConnectorHost} = await import(pathToFileURL(path.join(WORKTREE, 'apps/desktop/electron/public-connector-host.js')).href);
const {createFailureRepairHost} = await import(pathToFileURL(path.join(WORKTREE, 'apps/desktop/electron/failure-repair-host.js')).href);
const {createWeatherCardHost} = await import(pathToFileURL(path.join(WORKTREE, 'apps/desktop/electron/weather-card-host.js')).href);
const {TASK_FAILURE_REPAIR_CHECKPOINT, TASK_FAILURE_READONLY_RETRY_CHECKPOINT} = await import(
  pathToFileURL(path.join(WORKTREE, 'packages/agentarts/dist/index.js')).href
);

const work = mkdtempSync(path.join(tmpdir(), 'pa-p05-accept-'));
const receipt = {
  package: 'P-05',
  verifiedAt: new Date().toISOString(),
  items: {},
};

try {
  // 1. #649 Node syntax check column localization through DesktopDeveloperToolsHost
  const syntaxFile = path.join(work, 'sample-caret.mjs');
  writeFileSync(syntaxFile, '// PRIVATE SECRET\nconst ok = 1;\n  const bad = ;;\n');
  const caretExec = spawnSync(process.execPath, ['--check', syntaxFile], {encoding: 'utf8'});
  assert.equal(caretExec.status, 1);

  const eofFile = path.join(work, 'sample-eof.mjs');
  writeFileSync(eofFile, 'function broken( {\n');
  const eofExec = spawnSync(process.execPath, ['--check', eofFile], {encoding: 'utf8'});
  assert.equal(eofExec.status, 1);

  const devHost = createDesktopDeveloperToolsHost({testLocate: {cacheRootPath: work, available: () => true}});
  const locateTool = devHost.tools.find(t => t.descriptor.name === 'workspace.locate_test_failures');
  const ctx = {
    taskId: 'p05-649', runId: 'r-649', authorizationRef: 'r-649',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signal: new AbortController().signal, scopes: ['workspace:read'],
  };
  const caretReport = await locateTool.execute({output: caretExec.stderr}, ctx);
  const eofReport = await locateTool.execute({output: eofExec.stderr}, ctx);
  assert.equal(caretReport.totalFailures, 1);
  assert.equal(caretReport.failures[0].reporter, 'node-check');
  assert.equal(caretReport.failures[0].frames[0].line, 3);
  assert.equal(caretReport.failures[0].frames[0].column, 15);
  assert.equal('snippet' in caretReport.failures[0].frames[0], false);
  assert.equal(JSON.stringify(caretReport).includes('PRIVATE SECRET'), false);
  assert.equal(eofReport.failures[0].frames[0].column, undefined);
  devHost.close();
  receipt.items.issue649 = {
    caretFrame: caretReport.failures[0].frames[0],
    eofColumnOmitted: !('column' in eofReport.failures[0].frames[0]),
    snippetStripped: !('snippet' in caretReport.failures[0].frames[0]),
  };

  // 2. #19 & #666 Transient vs Non-retryable weather failure + FailureRepairHost read retry loop
  let attempt = 0;
  const scriptedFetch = async url => {
    const parsed = new URL(url);
    if (parsed.hostname === 'geocoding-api.open-meteo.com') {
      return {
        ok: true, status: 200,
        async json() {
          return {results: [{id: 1797929, name: '青岛市', latitude: 36.0671, longitude: 120.3826, timezone: 'Asia/Shanghai', country: '中国', admin1: '山东省', population: 3718835, feature_code: 'PPLA2'}]};
        },
      };
    }
    attempt++;
    if (attempt === 1) {
      return {ok: false, status: 503, async json() { return {error: true, reason: 'Service overloaded'}; }};
    }
    if (attempt === 2) {
      return {
        ok: true, status: 200,
        async json() {
          return {
            daily: {time: ['2026-11-19'], temperature_2m_min: [7], temperature_2m_max: [14], precipitation_probability_max: [10], weather_code: [1]},
            current: {time: '2026-11-19T15:00', temperature_2m: 12, apparent_temperature: 10, relative_humidity_2m: 55, wind_speed_10m: 12, wind_direction_10m: 180, weather_code: 1},
            hourly: {time: ['2026-11-19T15:00'], temperature_2m: [12], precipitation_probability: [10], weather_code: [1]},
          };
        },
      };
    }
    throw new TypeError('fetch failed', {cause: Object.assign(new Error('cert expired'), {code: 'CERT_HAS_EXPIRED'})});
  };

  const provider = new weather.OpenMeteoProvider({fetchImpl: scriptedFetch, locationResolution: 'strict'});
  const connectorHost = createPublicConnectorHost({weatherProvider: provider});
  const dbPath = path.join(work, 'runtime.sqlite');
  const app = runtimeMod.createRuntimeApplication({
    path: dbPath,
    profile: 'huawei_ict_agentarts',
    tools: connectorHost.tools,
    competitionToolAvailability: connectorHost.competitionToolAvailability,
    competitionToolExports: connectorHost.competitionToolExports,
  });

  const weatherTool = connectorHost.tools.find(t => t.descriptor.name === 'weather.forecast');
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const client = new Client(app.runtime);
  await client.connect();

  // Attempt 1: 503 EXTERNAL_FAILURE (retryable: true)
  const task1 = app.runtime.submitTask({goal: '查询青岛今天天气', conversationId: 'conv-p05', idempotencyKey: 'p05-t1'});
  app.runtime.transitionTask(task1.taskId, 'planning');
  app.runtime.transitionTask(task1.taskId, 'running');
  app.runtime.policy.grant({authorizationRef: 'auth-t1', taskId: task1.taskId, toolName: 'weather.forecast', scopes: ['weather:read'], expiresAt: deadline});
  let err1;
  try {
    await client.call('tool.invoke', {toolName: 'weather.forecast', toolVersion: weatherTool.descriptor.version, arguments: {location: '青岛', date: '2026-11-19', units: 'metric'}, scopeRef: 'auth-t1'}, {taskId: task1.taskId});
  } catch (err) { err1 = err; }
  assert.equal(err1?.code, 'EXTERNAL_FAILURE');
  assert.equal(err1?.retryable, true);
  app.runtime.transitionTask(task1.taskId, 'failed', {error: {code: err1.code, message: err1.message, retryable: err1.retryable}});
  await new Promise(r => setTimeout(r, 20));

  const repairHost = createFailureRepairHost(app.runtime);
  const card1 = repairHost.view(task1.taskId);
  assert.equal(card1.classification, 'transient');
  assert.equal(card1.canRetryRead, true);
  assert.equal(card1.abandoned, false);

  const retryAction = repairHost.act({taskId: task1.taskId, action: 'retry'});
  assert.equal(retryAction.accepted, true);
  assert.ok(retryAction.followUpTaskId);
  assert.equal(app.runtime.loadCheckpoint(retryAction.followUpTaskId, TASK_FAILURE_READONLY_RETRY_CHECKPOINT)?.readOnly, true);

  app.runtime.transitionTask(retryAction.followUpTaskId, 'planning');
  app.runtime.transitionTask(retryAction.followUpTaskId, 'running');
  app.runtime.policy.grant({authorizationRef: 'auth-t2', taskId: retryAction.followUpTaskId, toolName: 'weather.forecast', scopes: ['weather:read'], expiresAt: deadline});
  const retryInvoked = await client.call('tool.invoke', {
    toolName: 'weather.forecast', toolVersion: weatherTool.descriptor.version,
    arguments: {location: '青岛', date: '2026-11-19', units: 'metric'}, scopeRef: 'auth-t2',
  }, {taskId: retryAction.followUpTaskId});
  const retryResult = retryInvoked.result;
  app.runtime.transitionTask(retryAction.followUpTaskId, 'verifying');
  app.runtime.transitionTask(retryAction.followUpTaskId, 'succeeded', {resultSummary: retryResult.forecast.summary});
  assert.equal(retryResult.forecast.summary, '大致晴朗');

  // Attempt 3: non-retryable TLS cert error -> unrecoverable / stop
  const task3 = app.runtime.submitTask({goal: '查询青岛今天天气', conversationId: 'conv-p05', idempotencyKey: 'p05-t3'});
  app.runtime.transitionTask(task3.taskId, 'planning');
  app.runtime.transitionTask(task3.taskId, 'running');
  app.runtime.policy.grant({authorizationRef: 'auth-t3', taskId: task3.taskId, toolName: 'weather.forecast', scopes: ['weather:read'], expiresAt: deadline});
  let caughtCert;
  try {
    await client.call('tool.invoke', {
      toolName: 'weather.forecast', toolVersion: weatherTool.descriptor.version,
      arguments: {location: '青岛', date: '2026-11-20', units: 'metric'}, scopeRef: 'auth-t3',
    }, {taskId: task3.taskId});
  } catch (err) { caughtCert = err; }
  assert.equal(caughtCert?.code, 'EXTERNAL_FAILURE');
  assert.equal(caughtCert?.retryable, false);
  app.runtime.transitionTask(task3.taskId, 'failed', {error: {code: caughtCert.code, message: caughtCert.message, retryable: caughtCert.retryable}});
  await new Promise(r => setTimeout(r, 20));
  const card3 = repairHost.view(task3.taskId);
  assert.equal(card3.classification, 'unrecoverable');
  assert.equal(card3.canRetryRead, false);

  // 3. Weather card host failure mapping without raw error leakage
  const cardDir = path.join(work, 'weather-card');
  const fakeCardApp = {
    prepareHostToolTask: () => ({taskId: 'wc-1', revision: 1, state: 'created'}),
    finalizeHostToolTask: () => ({task: {taskId: 'wc-1', revision: 2, state: 'failed', error: {code: 'TIMEOUT', message: '<script>alert(1)</script> https://secret.invalid/?key=123'}}}),
    readHostToolTask: () => ({task: {taskId: 'wc-1', revision: 2, state: 'failed', error: {code: 'TIMEOUT', message: '<script>alert(1)</script> https://secret.invalid/?key=123'}}}),
    cancelPreparedHostToolTask: () => {},
  };
  const cardHost = createWeatherCardHost({
    userData: cardDir,
    getApplication: () => fakeCardApp,
    readToolVersion: () => weatherTool.descriptor.version,
  });
  cardHost.configure({location: '青岛'});
  const wcSnap = cardHost.snapshot();
  assert.match(wcSnap.reason, /超时/);
  assert.equal(wcSnap.reason.includes('script'), false);
  assert.equal(wcSnap.reason.includes('secret'), false);
  cardHost.dispose();

  await app.close();
  connectorHost.close();

  receipt.items.issue19And666 = {
    transientTaskClassification: card1.classification,
    transientCanRetryRead: card1.canRetryRead,
    retryFollowUpTaskId: retryAction.followUpTaskId,
    retrySucceededSummary: retryResult.forecast.summary,
    nonRetryableCertClassification: card3.classification,
    nonRetryableCertCanRetryRead: card3.canRetryRead,
    weatherCardSafeTimeoutReason: wcSnap.reason,
  };

  // 4. Optional live Open-Meteo smoke check
  try {
    const liveProvider = new weather.OpenMeteoProvider({locationResolution: 'strict'});
    const liveSvc = new weather.WeatherService({provider: liveProvider, now: Date.now});
    const liveRes = await liveSvc.getForecast({location: '青岛', units: 'metric'}, AbortSignal.timeout(25_000));
    receipt.items.liveOpenMeteoQingdao = {
      reachable: true,
      location: liveRes.forecast.location,
      date: liveRes.forecast.date,
      summary: liveRes.forecast.summary,
      temperatureMin: liveRes.forecast.temperatureMin,
      temperatureMax: liveRes.forecast.temperatureMax,
    };
  } catch (err) {
    receipt.items.liveOpenMeteoQingdao = {
      reachable: false,
      code: err?.code ?? 'UNKNOWN',
      retryable: Boolean(err?.retryable),
    };
  }

  writeFileSync(RECEIPT_PATH, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  try { rmSync(work, {recursive: true, force: true, maxRetries: 5, retryDelay: 50}); } catch {}
}
