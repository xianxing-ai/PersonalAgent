import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CrewError,
  CLAUDE_DRIVER_ID,
  ClaudeApiDriver,
  CREW_PARENT_AGENT_ID,
  EnvCrewApiKeyProvider,
  GROK_DRIVER_ID,
  GrokApiDriver,
  openCrewDriverRuntime,
  openCrewKernel,
} from '../dist/index.js';
import {FakeDriver} from '../dist/testing.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));
mkdirSync(root, {recursive: true});

// 测试一律使用假密钥（本沙箱没有任何真实 Claude/Grok 凭据，也不申请真实服务）。
const FAKE_CLAUDE_KEY = 'sk-ant-fake-claude-key-0123456789abcdef';
const FAKE_GROK_KEY = 'xai-fake-grok-key-0123456789abcdef';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const waitFor = async (predicate, message) => {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(message ?? 'waitFor timed out');
};

function openKernel(driverId) {
  let clock = 1700000000000;
  const kernel = openCrewKernel(join(mkdtempSync(join(root, 'http-')), 'crew.sqlite'), {now: () => (clock += 1000)});
  kernel.consent.grant({driverId, loginKind: 'api-key', termsSummary: `使用用户自己的 ${driverId} API key（按量计费）`, grantedBy: 'user'});
  return kernel;
}

function openUnconsentedKernel() {
  let clock = 1700000000000;
  return openCrewKernel(join(mkdtempSync(join(root, 'http-')), 'crew.sqlite'), {now: () => (clock += 1000)});
}

const fixedKeyProvider = key => ({getApiKey: driverId => (driverId === 'claude' ? FAKE_CLAUDE_KEY : driverId === 'grok' ? FAKE_GROK_KEY : undefined)});
const missingKeyProvider = {getApiKey: () => undefined};

// ── 本地假 HTTP 服务器：node:http，监听 127.0.0.1 随机端口，不依赖外网 ──────

function createFakeApi() {
  const requests = [];
  let handler = null;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const record = {
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        socketClosed: false,
        resClosed: false,
        resEnded: false,
      };
      requests.push(record);
      req.on('close', () => { record.socketClosed = true; });
      res.on('close', () => { record.resClosed = true; record.resEnded = res.writableEnded; });
      Promise.resolve(handler ? handler(req, res, record) : undefined).catch(() => {
        if (!res.writableEnded) res.destroy();
      });
    });
  });
  const listening = new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return {
    requests,
    setHandler: fn => { handler = fn; },
    url: async () => `http://127.0.0.1:${await listening}`,
    // fetch 客户端（undici）持有 keep-alive 连接：先断开全部连接再关闭，否则 close 永不回调。
    close: () => new Promise(resolve => {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.close(() => resolve());
    }),
  };
}

/** 挂住响应：永不写响应体，直到客户端打断（连接被销毁）。 */
const hangHandler = async (req, res) => {
  await new Promise(resolve => res.on('close', resolve));
};

const claudeEvent = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const grokData = (res, payload) => res.write(`data: ${payload}\n\n`);

function registerClaudeAgent(runtime) {
  runtime.registerAgent({
    agentId: 'writer-c',
    displayName: '写作子',
    driver: 'claude',
    instructions: '按固定回执格式汇报（Status/Result/Evidence/Unblock）。',
    workspacePath: '/workspace/crew/writer-c',
  });
}

// ── Claude 驱动 ───────────────────────────────────────────────────────────

test('claude driver refuses start without user consent even when a key is present', async () => {
  const kernel = openUnconsentedKernel();
  const api = createFakeApi();
  try {
    const driver = new ClaudeApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api.url()});
    const probe = await driver.probe();
    assert.equal(probe.status, 'available', 'probe only reflects key availability, not consent');
    await assert.rejects(
      () => driver.start({agentId: 'writer-c', instructions: 'x', workspacePath: '/w'}),
      error => error instanceof CrewError && error.code === 'CONSENT_REQUIRED',
    );
    assert.deepEqual(api.requests, [], 'no HTTP request is made before consent');
  } finally { kernel.close(); await api.close(); }
});

test('claude driver is explicitly unavailable without an API key (probe and start)', async () => {
  const kernel = openKernel(CLAUDE_DRIVER_ID);
  try {
    const driver = new ClaudeApiDriver({consent: kernel.consent, apiKeyProvider: missingKeyProvider});
    const probe = await driver.probe();
    assert.equal(probe.status, 'unavailable');
    assert.ok(probe.reason.includes('ANTHROPIC_API_KEY'), 'the reason names the env vars to configure');
    assert.ok(probe.reason.includes('不读取凭据文件'), 'the reason states the product never reads credential files');
    await assert.rejects(
      () => driver.start({agentId: 'writer-c', instructions: 'x', workspacePath: '/w'}),
      error => error instanceof CrewError && error.code === 'DRIVER_UNAVAILABLE' && error.message.includes('ANTHROPIC_API_KEY'),
    );
  } finally { kernel.close(); }
});

test('claude probe and start never issue an HTTP request just to probe availability', async () => {
  const kernel = openKernel(CLAUDE_DRIVER_ID);
  const api = createFakeApi();
  try {
    const driver = new ClaudeApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api.url()});
    assert.equal((await driver.probe()).status, 'available');
    const session = await driver.start({agentId: 'writer-c', instructions: 'x', workspacePath: '/w'});
    assert.equal(session.driver, CLAUDE_DRIVER_ID);
    assert.ok(session.sessionId.startsWith('claude-session-'));
    assert.deepEqual(api.requests, [], 'availability checks are local; the first HTTP call happens on send');
    await session.close();
  } finally { kernel.close(); await api.close(); }
});

test('claude session streams a completion end to end: headers, body, output events, completed', async () => {
  const kernel = openKernel(CLAUDE_DRIVER_ID);
  const api = createFakeApi();
  api.setHandler(async (req, res) => {
    res.writeHead(200, {'content-type': 'text/event-stream'});
    claudeEvent(res, 'message_start', {type: 'message_start', message: {id: 'msg_fake'}});
    await sleep(10);
    claudeEvent(res, 'content_block_delta', {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: '类型'}});
    await sleep(10);
    claudeEvent(res, 'content_block_delta', {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: '错误已修复'}});
    await sleep(10);
    grokData(res, 'not-json'); // 无法解析的负载必须被忽略，不影响结算。
    claudeEvent(res, 'message_stop', {type: 'message_stop'});
    res.end();
  });
  try {
    const driver = new ClaudeApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api.url()});
    const session = await driver.start({agentId: 'writer-c', instructions: '按固定回执格式汇报', workspacePath: '/workspace/crew/writer-c'});
    const events = [];
    session.onEvent(event => events.push(event));
    await session.send('修复 crew 包的类型错误');
    await waitFor(() => events.some(e => e.type === 'completed'));
    assert.deepEqual(events.map(e => e.type), ['started', 'output', 'output', 'completed'], 'deltas surface as output events; garbage SSE payloads are ignored');
    const completed = events.find(e => e.type === 'completed');
    assert.equal(completed.result, '类型错误已修复', 'the completed result is the accumulated stream text');
    assert.equal(completed.agentId, 'writer-c');

    const record = api.requests[0];
    assert.equal(record.method, 'POST');
    assert.equal(record.url, '/v1/messages');
    assert.ok(!record.url.includes(FAKE_CLAUDE_KEY), 'the key never travels in the URL');
    assert.equal(record.headers['x-api-key'], FAKE_CLAUDE_KEY, 'the key travels only in the vendor auth header');
    assert.equal(record.headers['anthropic-version'], '2023-06-01');
    const body = JSON.parse(record.body);
    assert.equal(body.model, 'claude-sonnet-4-5');
    assert.equal(body.stream, true);
    assert.equal(body.system, '按固定回执格式汇报', 'the agent instructions are the system prompt');
    assert.deepEqual(body.messages, [{role: 'user', content: '修复 crew 包的类型错误'}]);
    await session.close();
  } finally { kernel.close(); await api.close(); }
});

test('claude session keeps the multi-turn conversation in memory across sends', async () => {
  const kernel = openKernel(CLAUDE_DRIVER_ID);
  const api = createFakeApi();
  api.setHandler(async (req, res) => {
    res.writeHead(200, {'content-type': 'text/event-stream'});
    claudeEvent(res, 'content_block_delta', {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: `第 ${api.requests.length} 轮回答`}});
    claudeEvent(res, 'message_stop', {type: 'message_stop'});
    res.end();
  });
  try {
    const driver = new ClaudeApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api.url()});
    const session = await driver.start({agentId: 'writer-c', instructions: 'x', workspacePath: '/w'});
    await session.send('第一问');
    await session.send('第二问');
    assert.equal(api.requests.length, 2);
    const secondBody = JSON.parse(api.requests[1].body);
    assert.deepEqual(secondBody.messages, [
      {role: 'user', content: '第一问'},
      {role: 'assistant', content: '第 1 轮回答'},
      {role: 'user', content: '第二问'},
    ], 'the assistant reply joins the in-memory history for the next turn');
    await session.close();
  } finally { kernel.close(); await api.close(); }
});

test('claude HTTP errors become failed events that carry the vendor message but never the key', async () => {
  const kernel = openKernel(CLAUDE_DRIVER_ID);
  const api = createFakeApi();
  api.setHandler(async (req, res) => {
    res.writeHead(401, {'content-type': 'application/json'});
    res.end(JSON.stringify({type: 'error', error: {type: 'authentication_error', message: 'invalid x-api-key'}}));
  });
  try {
    const driver = new ClaudeApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api.url()});
    const session = await driver.start({agentId: 'writer-c', instructions: 'x', workspacePath: '/w'});
    const events = [];
    session.onEvent(event => events.push(event));
    await session.send('修复');
    await waitFor(() => events.some(e => e.type === 'failed'));
    const failed = events.find(e => e.type === 'failed');
    assert.ok(failed.message.includes('HTTP 401'), 'the failure names the HTTP status');
    assert.ok(failed.message.includes('invalid x-api-key'), 'the vendor error message is surfaced');
    assert.ok(!JSON.stringify(events).includes(FAKE_CLAUDE_KEY), 'the key never appears in the event stream');
    // 失败的一轮不留在历史里：下一条消息仍是合法的单条 user 开头。
    await session.send('再试一次');
    await waitFor(() => api.requests.length === 2);
    assert.deepEqual(JSON.parse(api.requests[1].body).messages, [{role: 'user', content: '再试一次'}]);
    await session.close();
  } finally { kernel.close(); await api.close(); }
});

test('claude stream error events become failed events', async () => {
  const kernel = openKernel(CLAUDE_DRIVER_ID);
  const api = createFakeApi();
  api.setHandler(async (req, res) => {
    res.writeHead(200, {'content-type': 'text/event-stream'});
    claudeEvent(res, 'error', {type: 'error', error: {type: 'overloaded_error', message: 'Overloaded'}});
    res.end();
  });
  try {
    const driver = new ClaudeApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api.url()});
    const session = await driver.start({agentId: 'writer-c', instructions: 'x', workspacePath: '/w'});
    const events = [];
    session.onEvent(event => events.push(event));
    await session.send('修复');
    await waitFor(() => events.some(e => e.type === 'failed'));
    assert.ok(events.find(e => e.type === 'failed').message.includes('Overloaded'));
    assert.ok(!events.some(e => e.type === 'completed'), 'an errored stream never completes');
    await session.close();
  } finally { kernel.close(); await api.close(); }
});

test('claude request timeout is a clear failure, not a hang', async () => {
  const kernel = openKernel(CLAUDE_DRIVER_ID);
  const api = createFakeApi();
  api.setHandler(hangHandler);
  try {
    const driver = new ClaudeApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api.url(), requestTimeoutMs: 60});
    const session = await driver.start({agentId: 'writer-c', instructions: 'x', workspacePath: '/w'});
    const events = [];
    session.onEvent(event => events.push(event));
    await session.send('修复');
    await waitFor(() => events.some(e => e.type === 'failed'));
    const failed = events.find(e => e.type === 'failed');
    assert.ok(failed.message.includes('超时'), 'the timeout failure is explicit');
    await session.close();
  } finally { kernel.close(); await api.close(); }
});

test('claude interrupt aborts the in-flight stream and emits interrupted without a failure', async () => {
  const kernel = openKernel(CLAUDE_DRIVER_ID);
  const api = createFakeApi();
  api.setHandler(async (req, res) => {
    res.writeHead(200, {'content-type': 'text/event-stream'});
    claudeEvent(res, 'content_block_delta', {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: '才开始'}});
    await new Promise(resolve => res.on('close', resolve)); // 流保持打开，等待客户端打断。
  });
  try {
    const driver = new ClaudeApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api.url()});
    const session = await driver.start({agentId: 'writer-c', instructions: 'x', workspacePath: '/w'});
    const events = [];
    session.onEvent(event => events.push(event));
    const sendPromise = session.send('长任务');
    await waitFor(() => events.some(e => e.type === 'output'), 'stream started');
    await session.interrupt('父 agent 打断：需求变更');
    await sendPromise; // 打断路径下 send 正常返回，不抛错。
    const interrupted = events.find(e => e.type === 'interrupted');
    assert.equal(interrupted.reason, '父 agent 打断：需求变更');
    assert.ok(!events.some(e => e.type === 'failed'), 'an interrupted turn is not reported as a failure');
    assert.ok(!events.some(e => e.type === 'completed'), 'an interrupted turn never completes');
    await waitFor(() => api.requests[0].resClosed && !api.requests[0].resEnded, 'the server saw the aborted connection');
    await session.close();
    await waitFor(() => events.some(e => e.type === 'exited'));
  } finally { kernel.close(); await api.close(); }
});

test('claude send after close is rejected, and close is idempotent', async () => {
  const kernel = openKernel(CLAUDE_DRIVER_ID);
  const api = createFakeApi();
  try {
    const driver = new ClaudeApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api.url()});
    const session = await driver.start({agentId: 'writer-c', instructions: 'x', workspacePath: '/w'});
    const events = [];
    session.onEvent(event => events.push(event));
    await session.close();
    await session.close();
    await waitFor(() => events.some(e => e.type === 'exited'));
    assert.equal(events.filter(e => e.type === 'exited').length, 1, 'close is idempotent');
    await assert.rejects(() => session.send('x'), error => error instanceof CrewError && error.code === 'DRIVER_FAILED');
    assert.deepEqual(api.requests, [], 'a closed session never reaches the network');
  } finally { kernel.close(); await api.close(); }
});

// ── Grok 驱动 ─────────────────────────────────────────────────────────────

test('grok driver refuses start without consent and is unavailable without a key', async () => {
  const unconsented = openUnconsentedKernel();
  try {
    const gated = new GrokApiDriver({consent: unconsented.consent, apiKeyProvider: fixedKeyProvider()});
    await assert.rejects(
      () => gated.start({agentId: 'g', instructions: 'x', workspacePath: '/w'}),
      error => error instanceof CrewError && error.code === 'CONSENT_REQUIRED',
    );
  } finally { unconsented.close(); }
  const kernel = openKernel(GROK_DRIVER_ID);
  try {
    const driver = new GrokApiDriver({consent: kernel.consent, apiKeyProvider: missingKeyProvider});
    const probe = await driver.probe();
    assert.equal(probe.status, 'unavailable');
    assert.ok(probe.reason.includes('XAI_API_KEY'), 'the reason names the env vars to configure');
    await assert.rejects(
      () => driver.start({agentId: 'g', instructions: 'x', workspacePath: '/w'}),
      error => error instanceof CrewError && error.code === 'DRIVER_UNAVAILABLE' && error.message.includes('XAI_API_KEY'),
    );
  } finally { kernel.close(); }
});

test('grok session streams a chat completion end to end with the bearer header and [DONE] handling', async () => {
  const kernel = openKernel(GROK_DRIVER_ID);
  const api = createFakeApi();
  api.setHandler(async (req, res) => {
    res.writeHead(200, {'content-type': 'text/event-stream'});
    grokData(res, JSON.stringify({choices: [{delta: {role: 'assistant', content: '已经'}}]}));
    await sleep(10);
    grokData(res, JSON.stringify({choices: [{delta: {content: '修好了，见 commit:abc'}}]}));
    await sleep(10);
    grokData(res, JSON.stringify({choices: [{delta: {}, finish_reason: 'stop'}]}));
    grokData(res, '[DONE]');
    res.end();
  });
  try {
    const driver = new GrokApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api.url(), model: 'grok-4-fast'});
    const session = await driver.start({agentId: 'writer-g', instructions: '独立评审补丁', workspacePath: '/workspace/crew/writer-g'});
    const events = [];
    session.onEvent(event => events.push(event));
    await session.send('评审这个补丁');
    await waitFor(() => events.some(e => e.type === 'completed'));
    assert.deepEqual(events.map(e => e.type), ['started', 'output', 'output', 'completed']);
    const completed = events.find(e => e.type === 'completed');
    assert.equal(completed.result, '已经修好了，见 commit:abc');

    const record = api.requests[0];
    assert.equal(record.url, '/v1/chat/completions');
    assert.ok(!record.url.includes(FAKE_GROK_KEY), 'the key never travels in the URL');
    assert.equal(record.headers['authorization'], `Bearer ${FAKE_GROK_KEY}`, 'the key travels only in the bearer header');
    const body = JSON.parse(record.body);
    assert.equal(body.model, 'grok-4-fast');
    assert.equal(body.stream, true);
    assert.deepEqual(body.messages[0], {role: 'system', content: '独立评审补丁'});
    assert.deepEqual(body.messages[1], {role: 'user', content: '评审这个补丁'});
    await session.close();
  } finally { kernel.close(); await api.close(); }
});

test('grok HTTP errors and in-stream error frames become failed events without the key', async () => {
  const kernel = openKernel(GROK_DRIVER_ID);
  try {
    const api = createFakeApi();
    api.setHandler(async (req, res) => {
      res.writeHead(429, {'content-type': 'application/json'});
      res.end(JSON.stringify({error: {message: 'rate limited', code: '429'}}));
    });
    try {
      const driver = new GrokApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api.url()});
      const session = await driver.start({agentId: 'writer-g', instructions: 'x', workspacePath: '/w'});
      const events = [];
      session.onEvent(event => events.push(event));
      await session.send('评审');
      await waitFor(() => events.some(e => e.type === 'failed'));
      const failed = events.find(e => e.type === 'failed');
      assert.ok(failed.message.includes('HTTP 429'));
      assert.ok(failed.message.includes('rate limited'));
      assert.ok(!JSON.stringify(events).includes(FAKE_GROK_KEY), 'the key never appears in the event stream');
      await session.close();
    } finally { await api.close(); }

    const api2 = createFakeApi();
    api2.setHandler(async (req, res) => {
      res.writeHead(200, {'content-type': 'text/event-stream'});
      grokData(res, JSON.stringify({choices: [{delta: {content: '部分'}}]}));
      grokData(res, JSON.stringify({error: {message: 'stream blew up'}}));
      res.end();
    });
    try {
      const driver = new GrokApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api2.url()});
      const session = await driver.start({agentId: 'writer-g', instructions: 'x', workspacePath: '/w'});
      const events = [];
      session.onEvent(event => events.push(event));
      await session.send('评审');
      await waitFor(() => events.some(e => e.type === 'failed'));
      assert.ok(events.find(e => e.type === 'failed').message.includes('stream blew up'));
      assert.ok(!events.some(e => e.type === 'completed'), 'an errored stream never completes');
      await session.close();
    } finally { await api2.close(); }
  } finally { kernel.close(); }
});

test('grok timeout and missing [DONE] are explicit protocol failures', async () => {
  const kernel = openKernel(GROK_DRIVER_ID);
  try {
    const api = createFakeApi();
    api.setHandler(hangHandler);
    try {
      const driver = new GrokApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api.url(), requestTimeoutMs: 60});
      const session = await driver.start({agentId: 'writer-g', instructions: 'x', workspacePath: '/w'});
      const events = [];
      session.onEvent(event => events.push(event));
      await session.send('评审');
      await waitFor(() => events.some(e => e.type === 'failed'));
      assert.ok(events.find(e => e.type === 'failed').message.includes('超时'));
      await session.close();
    } finally { await api.close(); }

    const api2 = createFakeApi();
    api2.setHandler(async (req, res) => {
      res.writeHead(200, {'content-type': 'text/event-stream'});
      grokData(res, JSON.stringify({choices: [{delta: {content: '未收尾'}}]}));
      res.end(); // 流在 [DONE] 前被服务端关闭。
    });
    try {
      const driver = new GrokApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api2.url()});
      const session = await driver.start({agentId: 'writer-g', instructions: 'x', workspacePath: '/w'});
      const events = [];
      session.onEvent(event => events.push(event));
      await session.send('评审');
      await waitFor(() => events.some(e => e.type === 'failed'));
      assert.ok(events.find(e => e.type === 'failed').message.includes('[DONE]'));
      await session.close();
    } finally { await api2.close(); }
  } finally { kernel.close(); }
});

test('grok interrupt aborts the in-flight stream and emits interrupted without a failure', async () => {
  const kernel = openKernel(GROK_DRIVER_ID);
  const api = createFakeApi();
  api.setHandler(async (req, res) => {
    res.writeHead(200, {'content-type': 'text/event-stream'});
    grokData(res, JSON.stringify({choices: [{delta: {content: '才开始'}}]}));
    await new Promise(resolve => res.on('close', resolve));
  });
  try {
    const driver = new GrokApiDriver({consent: kernel.consent, apiKeyProvider: fixedKeyProvider(), baseUrl: await api.url()});
    const session = await driver.start({agentId: 'writer-g', instructions: 'x', workspacePath: '/w'});
    const events = [];
    session.onEvent(event => events.push(event));
    const sendPromise = session.send('长评审');
    await waitFor(() => events.some(e => e.type === 'output'), 'stream started');
    await session.interrupt('父 agent 打断：换评审人');
    await sendPromise;
    const interrupted = events.find(e => e.type === 'interrupted');
    assert.equal(interrupted.reason, '父 agent 打断：换评审人');
    assert.ok(!events.some(e => e.type === 'failed'), 'an interrupted turn is not reported as a failure');
    await waitFor(() => api.requests[0].resClosed && !api.requests[0].resEnded, 'the server saw the aborted connection');
    await session.close();
  } finally { kernel.close(); await api.close(); }
});

// ── 密钥来源与环境变量提供器 ───────────────────────────────────────────────

test('EnvCrewApiKeyProvider reads only the documented env vars, trimmed, with precedence', () => {
  const both = new EnvCrewApiKeyProvider({ANTHROPIC_API_KEY: ' k1 ', CLAUDE_API_KEY: 'k2'});
  assert.equal(both.getApiKey('claude'), 'k1', 'the first configured candidate wins and is trimmed');
  assert.equal(new EnvCrewApiKeyProvider({CLAUDE_API_KEY: 'k2'}).getApiKey('claude'), 'k2');
  assert.equal(new EnvCrewApiKeyProvider({XAI_API_KEY: 'g1'}).getApiKey('grok'), 'g1');
  assert.equal(new EnvCrewApiKeyProvider({GROK_API_KEY: 'g2'}).getApiKey('grok'), 'g2');
  assert.equal(new EnvCrewApiKeyProvider({ANTHROPIC_API_KEY: '   '}).getApiKey('claude'), undefined, 'blank values count as missing');
  assert.equal(new EnvCrewApiKeyProvider({}).getApiKey('claude'), undefined);
  assert.equal(new EnvCrewApiKeyProvider({}).getApiKey('grok'), undefined);
  assert.equal(new EnvCrewApiKeyProvider({ANTHROPIC_API_KEY: 'k'}).getApiKey('codex'), undefined, 'CLI drivers never read API keys');
});

// ── 运行时联动：同意门 + 领取 + 回执 + 打断 + 密钥不泄露 ─────────────────────

function openRuntime(baseUrl, overrides = {}) {
  const {claudeOptions = {}, grokOptions = {}, ...runtimeOptions} = overrides;
  let clock = 1700000000000;
  const path = join(mkdtempSync(join(root, 'http-runtime-')), 'crew.sqlite');
  const runtime = openCrewDriverRuntime(path, {
    ...runtimeOptions,
    now: () => (clock += 1000),
    apiKeyProvider: missingKeyProvider,
    claudeOptions: {baseUrl, requestTimeoutMs: 5000, apiKeyProvider: fixedKeyProvider(), ...claudeOptions},
    grokOptions: {baseUrl, requestTimeoutMs: 5000, apiKeyProvider: fixedKeyProvider(), ...grokOptions},
  });
  const kernel = openCrewKernel(path, {now: () => 1700000000000});
  return {runtime, kernel, path};
}

test('runNextTask refuses before claiming for claude without consent, then runs end to end after grant', async () => {
  const api = createFakeApi();
  api.setHandler(async (req, res) => {
    res.writeHead(200, {'content-type': 'text/event-stream'});
    claudeEvent(res, 'content_block_delta', {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: '补丁已写好，测试通过'}});
    claudeEvent(res, 'message_stop', {type: 'message_stop'});
    res.end();
  });
  const {runtime, kernel} = openRuntime(await api.url());
  try {
    registerClaudeAgent(runtime);
    runtime.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'writer-c', goal: '写一个工具函数'});
    await assert.rejects(
      () => runtime.runNextTask('writer-c'),
      error => error instanceof CrewError && error.code === 'CONSENT_REQUIRED',
    );
    assert.equal(runtime.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'}).status, 'queued', 'the refusal must not claim the task');

    runtime.grantConsent({driverId: 'claude', loginKind: 'api-key', termsSummary: '使用用户自己的 Claude API key（按量计费）'});
    const seen = [];
    runtime.onEvent(event => seen.push(event));
    const task = await runtime.runNextTask('writer-c');
    assert.equal(task.status, 'succeeded');
    assert.equal(task.receipt.status, 'succeeded');
    assert.equal(task.receipt.result, '补丁已写好，测试通过');
    assert.deepEqual([...task.receipt.evidenceRefs], [], 'driver receipts carry no evidence refs (model self-report only)');
    assert.deepEqual(seen.map(e => `${e.type}:${e.taskId}`), ['started:t1', 'output:t1', 'completed:t1'], 'runtime events are tagged with the task id');
    assert.deepEqual(kernel.receiveMessages('writer-c'), [], 'the mailbox task message was consumed after claim');
    // 撤销同意后再次拒绝。
    runtime.revokeConsent('claude', '合规检查');
    runtime.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't2', rootRequestId: 'root-2', assignedAgentId: 'writer-c', goal: '第二件事'});
    await assert.rejects(
      () => runtime.runNextTask('writer-c'),
      error => error instanceof CrewError && error.code === 'CONSENT_REQUIRED' && error.message.includes('撤销'),
    );
    assert.equal(runtime.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't2'}).status, 'queued');
  } finally { runtime.close(); await api.close(); }
});

test('a claude driver without a key refuses before claiming, with the probe reason naming the env vars', async () => {
  const api = createFakeApi();
  const {runtime} = openRuntime(await api.url(), {claudeOptions: {apiKeyProvider: missingKeyProvider}});
  try {
    registerClaudeAgent(runtime);
    runtime.grantConsent({driverId: 'claude', loginKind: 'api-key', termsSummary: 'x'});
    runtime.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'writer-c', goal: '写一个工具函数'});
    await assert.rejects(
      () => runtime.runNextTask('writer-c'),
      error => error instanceof CrewError && error.code === 'DRIVER_UNAVAILABLE' && error.message.includes('ANTHROPIC_API_KEY'),
    );
    assert.equal(runtime.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'}).status, 'queued', 'the refusal must not claim the task');
    assert.deepEqual(api.requests, [], 'no request is made without a key');
  } finally { runtime.close(); await api.close(); }
});

test('a claude start failure after a passing probe maps to a blocked receipt with API-key unblock guidance', async () => {
  const api = createFakeApi();
  const startFailure = new CrewError('DRIVER_UNAVAILABLE', '未配置 Claude API key（密钥通道在启动时突然不可用）');
  const {runtime} = openRuntime(await api.url(), {drivers: {claude: new FakeDriver({driverId: 'claude', startFailure})}});
  try {
    registerClaudeAgent(runtime);
    runtime.grantConsent({driverId: 'claude', loginKind: 'api-key', termsSummary: 'x'});
    runtime.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'writer-c', goal: '写一个工具函数'});
    const task = await runtime.runNextTask('writer-c');
    assert.equal(task.status, 'blocked');
    assert.equal(task.receipt.status, 'blocked');
    assert.ok(task.receipt.result.includes('未配置 Claude API key'));
    assert.ok(task.receipt.unblock.includes('ANTHROPIC_API_KEY'), 'the unblock guidance names the env vars');
    assert.ok(!task.receipt.unblock.includes('安装并登录'), 'an API-key driver is not told to install a CLI');
  } finally { runtime.close(); await api.close(); }
});

test('parent interruptTask cancels an in-flight claude stream and the server sees the abort', async () => {
  const api = createFakeApi();
  api.setHandler(async (req, res) => {
    res.writeHead(200, {'content-type': 'text/event-stream'});
    claudeEvent(res, 'content_block_delta', {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: '才写到一半'}});
    await new Promise(resolve => res.on('close', resolve));
  });
  const {runtime} = openRuntime(await api.url());
  try {
    registerClaudeAgent(runtime);
    runtime.grantConsent({driverId: 'claude', loginKind: 'api-key', termsSummary: 'x'});
    runtime.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'writer-c', goal: '长任务'});
    const runPromise = runtime.runNextTask('writer-c');
    await waitFor(() => api.requests.length === 1);
    const interrupted = await runtime.interruptTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', reason: '父 agent 打断：需求变更'});
    assert.equal(interrupted.status, 'cancelled');
    const task = await runPromise;
    assert.equal(task.status, 'cancelled');
    assert.equal(task.receipt, undefined, 'an interrupted task has no driver receipt');
    await waitFor(() => api.requests[0].resClosed && !api.requests[0].resEnded, 'the abort reached the server');
  } finally { runtime.close(); await api.close(); }
});

test('the fake API key never leaks into events, receipts, the sqlite file, errors or console output', async () => {
  const api = createFakeApi();
  const responses = ['第一轮回答'];
  let grokSeen = false;
  api.setHandler(async (req, res, record) => {
    if (record.url === '/v1/messages') {
      res.writeHead(200, {'content-type': 'text/event-stream'});
      claudeEvent(res, 'content_block_delta', {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: responses[0]}});
      claudeEvent(res, 'message_stop', {type: 'message_stop'});
      res.end();
      return;
    }
    // grok 请求故意返回 401，验证失败路径的回执也不携带密钥。
    grokSeen = true;
    res.writeHead(401, {'content-type': 'application/json'});
    res.end(JSON.stringify({error: {message: 'invalid bearer token'}}));
  });
  const {runtime, kernel, path} = openRuntime(await api.url());
  const consoleCalls = [];
  const originals = {};
  for (const method of ['log', 'error', 'warn', 'info']) {
    originals[method] = console[method];
    console[method] = (...args) => consoleCalls.push(args.map(String).join(' '));
  }
  try {
    registerClaudeAgent(runtime);
    runtime.registerAgent({
      agentId: 'reviewer-g',
      displayName: '评审子',
      driver: 'grok',
      instructions: '独立评审。',
      workspacePath: '/workspace/crew/reviewer-g',
    });
    runtime.grantConsent({driverId: 'claude', loginKind: 'api-key', termsSummary: 'x'});
    runtime.grantConsent({driverId: 'grok', loginKind: 'api-key', termsSummary: 'x'});
    const seen = [];
    runtime.onEvent(event => seen.push(event));

    runtime.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'writer-c', goal: '写一个工具函数'});
    const ok = await runtime.runNextTask('writer-c');
    assert.equal(ok.status, 'succeeded');

    runtime.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't2', rootRequestId: 'root-2', assignedAgentId: 'reviewer-g', goal: '评审补丁'});
    const bad = await runtime.runNextTask('reviewer-g');
    assert.equal(bad.status, 'failed', 'the grok 401 maps to a failed receipt');
    assert.ok(bad.receipt.result.includes('invalid bearer'), 'the vendor message is surfaced (token value redacted)');
    assert.ok(!bad.receipt.result.includes('invalid bearer token'), 'the trailing token word is redacted per F6');
    assert.ok(bad.receipt.result.includes('[已脱敏]') || bad.receipt.result.includes('401'), 'redaction or status remains');
    assert.ok(grokSeen, 'the grok request actually reached the fake server');

    // 1. 事件流里没有密钥。
    assert.ok(!JSON.stringify(seen).includes(FAKE_CLAUDE_KEY), 'claude key absent from events');
    assert.ok(!JSON.stringify(seen).includes(FAKE_GROK_KEY), 'grok key absent from events');
    // 2. 回执里没有密钥（读回 SQLite 的 receipt_json）。
    const audit = openCrewKernel(path, {now: () => 1700000000000});
    try {
      for (const taskId of ['t1', 't2']) {
        const task = audit.getTask({actorId: CREW_PARENT_AGENT_ID, taskId});
        const receiptJson = JSON.stringify(task.receipt ?? {noReceipt: task.status});
        assert.ok(!receiptJson.includes(FAKE_CLAUDE_KEY) && !receiptJson.includes(FAKE_GROK_KEY), `receipt of ${taskId} carries no key`);
      }
    } finally { audit.close(); }
    // 3. SQLite 文件（含 WAL/SHM）里没有密钥。
    const dir = join(path, '..');
    const dbBytes = readdirSync(dir).filter(name => name.startsWith('crew.sqlite')).map(name => readFileSync(join(dir, name)));
    assert.ok(dbBytes.length >= 1);
    for (const bytes of dbBytes) {
      assert.ok(!bytes.includes(FAKE_CLAUDE_KEY), 'claude key absent from the sqlite file');
      assert.ok(!bytes.includes(FAKE_GROK_KEY), 'grok key absent from the sqlite file');
    }
    // 4. 控制台（日志）里没有密钥。
    assert.ok(!consoleCalls.some(line => line.includes(FAKE_CLAUDE_KEY) || line.includes(FAKE_GROK_KEY)), 'no log line carries the key');
    // 5. 密钥只以请求头形式发给配置的端点，不进 URL。
    for (const record of api.requests) {
      assert.ok(!record.url.includes(FAKE_CLAUDE_KEY) && !record.url.includes(FAKE_GROK_KEY));
    }
    assert.equal(api.requests[0].headers['x-api-key'], FAKE_CLAUDE_KEY);
    assert.equal(api.requests[1].headers['authorization'], `Bearer ${FAKE_GROK_KEY}`);
  } finally {
    for (const method of Object.keys(originals)) console[method] = originals[method];
    runtime.close();
    await api.close();
  }
});
