import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {ProtocolError} from '@personal-agent/contracts';
import {AgentArtsCloudAgentPort} from '../dist/index.js';

const GATEWAY = 'https://agentarts.example.test';
const RUNTIME = 'agent-arts-demo';

function request(overrides = {}) {
  return {
    taskId: 'task-1',
    revision: 3,
    goal: '检查项目状态',
    deadline: new Date(Date.now() + 5_000).toISOString(),
    signal: new AbortController().signal,
    ...overrides,
  };
}

function message(text, index) {
  const data = {text};
  if (index !== undefined) data.index = index;
  return {event: 'message', data};
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {'content-type': 'application/json; charset=utf-8'},
  });
}

function sseResponse(value, status = 200) {
  return new Response(value, {
    status,
    headers: {'content-type': 'text/event-stream'},
  });
}

function provider(value = 'Bearer test-token') {
  let calls = 0;
  return {
    get calls() { return calls; },
    read: async signal => {
      assert.equal(signal.aborted, false);
      calls += 1;
      return value;
    },
  };
}

function port(fetchImpl, authorizationProvider = provider(), config = {}) {
  return new AgentArtsCloudAgentPort({
    gatewayUrl: GATEWAY,
    runtimeName: RUNTIME,
    ...config,
  }, authorizationProvider, fetchImpl);
}

for (const transport of ['iterator', 'reader']) {
  test(`${transport} response preserves chunks when transport reuses its byte buffer`, async () => {
    const chunks = ['A', 'B'].map(text => new TextEncoder().encode(`data: ${JSON.stringify(message(text))}\n\n`));
    assert.equal(chunks[0].byteLength, chunks[1].byteLength);
    const buffer = new Uint8Array(chunks[0].byteLength);
    let offset = 0;
    let released = 0;
    let cancelled = 0;
    const reader = {
      async read() {
        if (offset === chunks.length) return {done: true};
        buffer.set(chunks[offset++]);
        return {done: false, value: buffer};
      },
      releaseLock() { released++; },
      cancel() { cancelled++; },
    };
    const body = transport === 'reader' ? {getReader: () => reader} : {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          buffer.set(chunk);
          yield buffer;
        }
      },
    };
    const cloud = port(async () => ({status: 200,
      headers: {get: () => 'text/event-stream'}, body}));
    assert.deepEqual(await cloud.invoke(request()), {kind: 'text', text: 'AB', verification: 'unverified'});
    assert.equal(released, transport === 'reader' ? 1 : 0);
    assert.equal(cancelled, 0);
  });
}

async function rejectsCode(promise, code, forbidden = []) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, code);
    for (const value of forbidden) assert.equal(error.message.includes(value), false);
    return true;
  });
}

test('published JSON sends the exact bounded request and reads authorization per call', async () => {
  const calls = [];
  const auth = provider();
  const cloud = port(async (url, init) => {
    calls.push({url, init});
    return jsonResponse(message('已完成', 0));
  }, auth);
  const input = request({taskId: 'task/with-private-id', revision: 7, deadline: new Date(Date.now() + 5_000).toISOString()});

  assert.deepEqual(await cloud.invoke(input), {kind: 'text', text: '已完成', verification: 'unverified'});
  assert.deepEqual(await cloud.invoke(input), {kind: 'text', text: '已完成', verification: 'unverified'});
  assert.equal(auth.calls, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${GATEWAY}/runtimes/${RUNTIME}/invocations`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(calls[0].init.headers, {
    'Content-Type': 'application/json',
    Accept: 'application/json,text/event-stream',
    Authorization: 'Bearer test-token',
    'x-hw-agentarts-session-id': calls[0].init.headers['x-hw-agentarts-session-id'],
    'X-Invoke-Mode': 'published',
    'X-Request-Id': `${calls[0].init.headers['x-hw-agentarts-session-id']}-7`,
    'X-PA-Deadline': input.deadline,
  });
  assert.match(calls[0].init.headers['x-hw-agentarts-session-id'], /^pa-[0-9a-f]{32}$/);
  assert.equal(calls[0].init.headers['x-hw-agentarts-session-id'].includes('task'), false);
  assert.deepEqual(JSON.parse(calls[0].init.body), {query: input.goal});
  assert.equal(calls[0].init.body.includes(input.taskId), false);
  assert.equal(calls[0].init.body.includes(String(input.revision)), false);
  assert.equal(calls[0].init.body.includes(input.deadline), false);
});

test('JSON failure events reject instead of returning a partial message', async () => {
  const secret = 'provider failure details must stay private';
  const cloud = port(async () => jsonResponse([
    message('partial answer', 0),
    {event: 'status', type: 'failed', data: {message: secret}},
  ]));
  await rejectsCode(cloud.invoke(request()), 'EXTERNAL_FAILURE', [secret, 'partial answer']);
});

test('SSE error events reject instead of returning a partial message', async () => {
  const secret = 'sse failure details must stay private';
  const body = [
    `data: ${JSON.stringify(message('partial answer', 0))}`,
    '',
    `data: ${JSON.stringify({event: 'error', data: {message: secret}})}`,
    '',
  ].join('\n');
  const cloud = port(async () => sseResponse(body));
  await rejectsCode(cloud.invoke(request()), 'EXTERNAL_FAILURE', [secret, 'partial answer']);
});

test('redirect responses never become successful adapter results', async () => {
  let redirect;
  const cloud = port(async (_url, init) => {
    redirect = init.redirect;
    return new Response('redirect response body', {
      status: 307,
      headers: {
        location: 'https://outside.example.test/target',
        'content-type': 'application/json',
      },
    });
  });
  await rejectsCode(cloud.invoke(request()), 'EXTERNAL_FAILURE', [
    'redirect response body',
    'outside.example.test',
  ]);
  assert.equal(redirect, 'error');
});

test('SSE sorts indexed fragments, de-duplicates equal indexes, and stops at DONE', async () => {
  const body = [
    ': provider comment',
    '',
    `data: ${JSON.stringify(message('B', 1))}`,
    '',
    `data: ${JSON.stringify(message('A', 0))}`,
    '',
    `data: ${JSON.stringify(message('B', 1))}`,
    '',
    'data: [DONE]',
    '',
    `data: ${JSON.stringify(message('ignored', 2))}`,
  ].join('\n');
  const cloud = port(async () => sseResponse(body));
  assert.deepEqual(await cloud.invoke(request()), {kind: 'text', text: 'AB', verification: 'unverified'});
});

test('SSE data lines without indexes retain receive order', async () => {
  const body = [
    `data: ${JSON.stringify(message('first'))}`,
    `data: ${JSON.stringify(message(' second'))}`,
    'data: [DONE]',
  ].join('\n');
  const cloud = port(async () => sseResponse(body));
  assert.equal((await cloud.invoke(request())).text, 'first second');
});

test('message events with null text are metadata-only and do not invalidate later text', async () => {
  const cloud = port(async () => jsonResponse([
    {event: 'message', data: {text: null, index: 0, node_id: 'node-start'}},
    message('final', 1),
  ]));
  assert.deepEqual(await cloud.invoke(request()), {
    kind: 'text', text: 'final', verification: 'unverified',
  });
});

test('message text rejects non-string number, object, and boolean values', async () => {
  for (const text of [42, {value: 'not text'}, true]) {
    const cloud = port(async () => jsonResponse(message(text)));
    await rejectsCode(cloud.invoke(request()), 'EXTERNAL_FAILURE');
  }
});

test('multi-agent SSE returns only the last workflow answer after task_end and end', async () => {
  const body = readFileSync(
    new URL('./fixtures/agentarts-multi-agent-success.sse', import.meta.url),
    'utf8',
  );
  const cloud = port(async () => sseResponse(body));
  assert.deepEqual(await cloud.invoke(request()), {
    kind: 'text',
    text: '{"stage":"evidence","decision":"REJECT","verification":"not_verified"}',
    verification: 'unverified',
  });
});

test('multi-agent terminal selection also applies to JSON and separator-less SSE', async () => {
  const events = [
    {event: 'workflow_start', data: {workflow_name: 'PA-intermediate'}},
    {event: 'workflow_end', data: {workflow_name: 'PA-intermediate', answer: 'draft'}},
    {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
    {event: 'workflow_end', data: {workflow_name: 'PA-final', answer: 'final'}},
    {event: 'task_end', data: {}},
    {event: 'end', data: {}},
  ];
  const json = port(async () => jsonResponse(events));
  assert.equal((await json.invoke(request())).text, 'final');

  const withoutSeparators = events.map(event => `data: ${JSON.stringify(event)}`).join('\n');
  const sse = port(async () => sseResponse(withoutSeparators));
  assert.equal((await sse.invoke(request())).text, 'final');
});

test('multi-agent mode ignores intermediate message text and requires its final workflow answer', async () => {
  const success = [
    {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
    message('intermediate controller text'),
    {event: 'workflow_end', data: {workflow_name: 'PA-final', answer: 'final workflow answer'}},
    {event: 'task_end', data: {}},
    {event: 'end', data: {}},
  ];
  assert.equal((await port(async () => jsonResponse(success)).invoke(request())).text, 'final workflow answer');

  const incomplete = [
    {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
    message('intermediate controller text'),
  ];
  await rejectsCode(port(async () => jsonResponse(incomplete)).invoke(request()), 'EXTERNAL_FAILURE');

  const finalWorkflowNeverCompleted = [
    {event: 'workflow_start', data: {workflow_name: 'PA-intermediate'}},
    {event: 'workflow_end', data: {workflow_name: 'PA-intermediate', answer: 'intermediate answer'}},
    {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
    {event: 'task_end', data: {}},
    {event: 'end', data: {}},
  ];
  await rejectsCode(
    port(async () => jsonResponse(finalWorkflowNeverCompleted)).invoke(request()),
    'EXTERNAL_FAILURE',
  );
});

test('explicit workflow boundaries scope indexes while preserving local conflict rejection', async () => {
  const events = [
    {event: 'workflow_start', data: {workflow_name: 'first'}},
    message('A', 0),
    {event: 'workflow_end', data: {answer: 'first answer'}},
    {event: 'workflow_start', data: {workflow_name: 'second'}},
    message('B', 0),
    {event: 'workflow_end', data: {answer: 'second answer'}},
    {event: 'task_end', data: {}},
    {event: 'end', data: {}},
  ];
  const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  assert.equal((await port(async () => sseResponse(body)).invoke(request())).text, 'second answer');
  const conflicting = [...events.slice(0, 2), message('conflict', 0), ...events.slice(2)];
  await rejectsCode(port(async () => jsonResponse(conflicting)).invoke(request()), 'EXTERNAL_FAILURE');
});

test('serial workflow parsing rejects overlapping starts and unpaired completion', async () => {
  for (const events of [
    [
      {event: 'workflow_start', data: {workflow_name: 'A'}},
      {event: 'workflow_start', data: {workflow_name: 'B'}},
      {event: 'workflow_end', data: {workflow_name: 'A', answer: 'wrong candidate'}},
      {event: 'task_end'}, {event: 'end'},
    ],
    [{event: 'workflow_end', data: {answer: 'unpaired'}}, {event: 'task_end'}, {event: 'end'}],
    [
      {event: 'workflow_start', data: {workflow_id: 'A'}},
      {event: 'workflow_end', data: {workflow_id: 'B', answer: 'mismatched'}},
      {event: 'task_end'}, {event: 'end'},
    ],
  ]) {
    await rejectsCode(port(async () => jsonResponse(events)).invoke(request()), 'EXTERNAL_FAILURE');
  }
});

test('explicit workflow index resets retain the response-wide text budget', async () => {
  for (const secondLength of [8_000, 8_001]) {
    const events = [
      {event: 'workflow_start', data: {workflow_name: 'first'}},
      message('a'.repeat(8_000), 0),
      {event: 'workflow_end', data: {answer: 'first answer'}},
      {event: 'workflow_start', data: {workflow_name: 'second'}},
      message('b'.repeat(secondLength), 0),
      {event: 'workflow_end', data: {answer: 'second answer'}},
      {event: 'task_end', data: {}},
      {event: 'end', data: {}},
    ];
    const result = port(async () => jsonResponse(events)).invoke(request());
    if (secondLength === 8_000) assert.equal((await result).text, 'second answer');
    else await rejectsCode(result, 'EXTERNAL_FAILURE');
  }
});

test('workflow answer accepts exactly 16000 characters', async () => {
  const answer = 'a'.repeat(16_000);
  const events = [
    {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
    {event: 'workflow_end', data: {workflow_name: 'PA-final', answer}},
    {event: 'task_end', data: {}},
    {event: 'end', data: {}},
  ];
  const result = await port(async () => jsonResponse(events)).invoke(request());
  assert.equal(result.text, answer);
});

test('workflow intermediate messages use a cumulative 16000-character limit', async () => {
  const accepted = [
    {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
    message('a'.repeat(8_000)),
    message('b'.repeat(8_000)),
    {event: 'workflow_end', data: {workflow_name: 'PA-final', answer: 'final'}},
    {event: 'task_end', data: {}},
    {event: 'end', data: {}},
  ];
  assert.equal((await port(async () => jsonResponse(accepted)).invoke(request())).text, 'final');

  const rejected = [
    {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
    message('a'.repeat(8_000)),
    message('b'.repeat(8_001)),
    {event: 'workflow_end', data: {workflow_name: 'PA-final', answer: 'final'}},
    {event: 'task_end', data: {}},
    {event: 'end', data: {}},
  ];
  await rejectsCode(port(async () => jsonResponse(rejected)).invoke(request()), 'EXTERNAL_FAILURE');
});

test('multi-agent workflow answers remain partial until both terminal events arrive', async () => {
  const answer = {event: 'workflow_end', data: {workflow_name: 'PA-final', answer: 'candidate'}};
  const start = {event: 'workflow_start', data: {workflow_name: 'PA-final'}};
  for (const events of [
    [start, answer],
    [start, answer, {event: 'task_end', data: {}}],
    [start, answer, {event: 'end', data: {}}],
    [start, answer, {event: 'end', data: {}}, {event: 'task_end', data: {}}],
  ]) {
    const body = events.map(event => `data: ${JSON.stringify(event)}\n`).join('\n');
    await rejectsCode(port(async () => sseResponse(body)).invoke(request()), 'EXTERNAL_FAILURE');
  }
});

test('workflow task_end and end terminal events cannot be repeated', async () => {
  for (const events of [
    [
      {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
      {event: 'workflow_end', data: {workflow_name: 'PA-final', answer: 'candidate'}},
      {event: 'task_end', data: {}},
      {event: 'task_end', data: {}},
      {event: 'end', data: {}},
    ],
    [
      {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
      {event: 'workflow_end', data: {workflow_name: 'PA-final', answer: 'candidate'}},
      {event: 'task_end', data: {}},
      {event: 'end', data: {}},
      {event: 'end', data: {}},
    ],
  ]) {
    await rejectsCode(port(async () => jsonResponse(events)).invoke(request()), 'EXTERNAL_FAILURE');
  }
});

test('workflow events after task_end or end cannot replace the final candidate', async () => {
  for (const events of [
    [
      {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
      {event: 'workflow_end', data: {workflow_name: 'PA-final', answer: 'accepted candidate'}},
      {event: 'task_end', data: {}},
      {event: 'workflow_end', data: {workflow_name: 'PA-late', answer: 'late replacement'}},
      {event: 'end', data: {}},
    ],
    [
      {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
      {event: 'workflow_end', data: {workflow_name: 'PA-final', answer: 'accepted candidate'}},
      {event: 'task_end', data: {}},
      {event: 'end', data: {}},
      {event: 'workflow_end', data: {workflow_name: 'PA-late', answer: 'late replacement'}},
    ],
    [
      {event: 'task_end', data: {}},
      {event: 'end', data: {}},
      {event: 'workflow_end', data: {workflow_name: 'PA-late', answer: 'late replacement'}},
    ],
  ]) {
    await rejectsCode(port(async () => jsonResponse(events)).invoke(request()), 'EXTERNAL_FAILURE');
  }
});

test('a failure after workflow_end overrides the partial answer', async () => {
  const secret = 'workflow failure details must stay private';
  for (const failure of [
    {event: 'error', data: {message: secret}},
    {event: 'status', type: 'failed', data: {message: secret}},
  ]) {
    const events = [
      {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
      {event: 'workflow_end', data: {workflow_name: 'PA-final', answer: 'partial answer'}},
      failure,
      {event: 'task_end', data: {}},
      {event: 'end', data: {}},
    ];
    const body = events.map(event => `data: ${JSON.stringify(event)}\n`).join('\n');
    await rejectsCode(port(async () => sseResponse(body)).invoke(request()), 'EXTERNAL_FAILURE', [
      secret,
      'partial answer',
    ]);
  }
});

test('a failure after task_end and end still overrides the completed answer', async () => {
  const secret = 'post-terminal workflow failure must stay private';
  const events = [
    {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
    {event: 'workflow_end', data: {workflow_name: 'PA-final', answer: 'completed answer'}},
    {event: 'task_end', data: {}},
    {event: 'end', data: {}},
    {event: 'error', data: {message: secret}},
  ];
  await rejectsCode(
    port(async () => jsonResponse(events)).invoke(request()),
    'EXTERNAL_FAILURE',
    [secret, 'completed answer'],
  );
});

test('workflow_end validates answer type and size', async () => {
  for (const answer of [undefined, null, 42, {text: 'not accepted'}, 'a'.repeat(16_001)]) {
    const events = [
      {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
      {event: 'workflow_end', data: answer === undefined
        ? {workflow_name: 'PA-final'}
        : {workflow_name: 'PA-final', answer}},
      {event: 'task_end', data: {}},
      {event: 'end', data: {}},
    ];
    const body = events.map(event => `data: ${JSON.stringify(event)}\n`).join('\n');
    await rejectsCode(port(async () => sseResponse(body)).invoke(request()), 'EXTERNAL_FAILURE');
  }
});

test('provider text cannot forge verified status or trusted evidence fields', async () => {
  const answer = JSON.stringify({verification: 'verified', evidenceRefs: ['provider-claimed']});
  const events = [
    {event: 'workflow_start', data: {workflow_name: 'PA-final'}},
    {event: 'workflow_end', data: {workflow_name: 'PA-final', answer}},
    {event: 'task_end', data: {}},
    {event: 'end', data: {}},
  ];
  const body = events.map(event => `data: ${JSON.stringify(event)}\n`).join('\n');
  const result = await port(async () => sseResponse(body)).invoke(request());
  assert.deepEqual(result, {kind: 'text', text: answer, verification: 'unverified'});
  assert.deepEqual(Object.keys(result).sort(), ['kind', 'text', 'verification']);
});

test('SSE multiline data uses the standard newline join before compatibility fallback', async () => {
  const serialized = JSON.stringify(message('multiline', 0));
  // Standard SSE joins multiple data lines with a newline, so split only at
  // a JSON whitespace boundary rather than in the middle of a string token.
  const splitAt = serialized.indexOf(',"data"') + 1;
  const body = [
    `data: ${serialized.slice(0, splitAt)}`,
    `data: ${serialized.slice(splitAt)}`,
    '',
  ].join('\n');
  const cloud = port(async () => sseResponse(body));
  assert.deepEqual(await cloud.invoke(request()), {kind: 'text', text: 'multiline', verification: 'unverified'});
});

test('debug mode is sent in the explicit invoke header', async () => {
  let seen;
  const cloud = port(async (_url, init) => {
    seen = init.headers;
    return jsonResponse(message('debug'));
  }, provider(), {invokeMode: 'debug'});
  await cloud.invoke(request());
  assert.equal(seen['X-Invoke-Mode'], 'debug');
});

test('constructor rejects non-origin gateway URLs, runtime names, and modes', () => {
  const validAuth = provider();
  const validFetch = async () => jsonResponse(message('ok'));
  for (const gatewayUrl of [
    'http://agentarts.example.test',
    'https://user:pass@agentarts.example.test',
    'https://agentarts.example.test/path',
    'https://agentarts.example.test/.',
    'https://agentarts.example.test//',
    'https://agentarts.example.test\\path',
    'https://agentarts.example.test/?query=1',
    'https://agentarts.example.test/#hash',
    ' https://agentarts.example.test',
  ]) {
    assert.throws(
      () => new AgentArtsCloudAgentPort({gatewayUrl, runtimeName: RUNTIME}, validAuth, validFetch),
      error => error instanceof ProtocolError && error.code === 'INVALID_ARGUMENT',
    );
  }
  for (const runtimeName of ['', 'bad/name', 'bad name', 'x'.repeat(65)]) {
    assert.throws(
      () => new AgentArtsCloudAgentPort({gatewayUrl: GATEWAY, runtimeName}, validAuth, validFetch),
      error => error instanceof ProtocolError && error.code === 'INVALID_ARGUMENT',
    );
  }
  assert.throws(
    () => new AgentArtsCloudAgentPort({gatewayUrl: GATEWAY, runtimeName: RUNTIME, invokeMode: 'release'}, validAuth, validFetch),
    error => error instanceof ProtocolError && error.code === 'INVALID_ARGUMENT',
  );
  assert.throws(
    () => new AgentArtsCloudAgentPort({gatewayUrl: GATEWAY, runtimeName: RUNTIME, invokeMode: null}, validAuth, validFetch),
    error => error instanceof ProtocolError && error.code === 'INVALID_ARGUMENT',
  );
});

test('already cancelled and expired requests stop before authorization or fetch', async () => {
  let authCalls = 0;
  let fetchCalls = 0;
  const auth = {read: async () => { authCalls += 1; return 'Bearer secret'; }};
  const cloud = port(async () => { fetchCalls += 1; return jsonResponse(message('never')); }, auth);
  const cancelled = new AbortController();
  cancelled.abort();
  await rejectsCode(cloud.invoke(request({signal: cancelled.signal})), 'CANCELLED');
  await rejectsCode(cloud.invoke(request({deadline: new Date(Date.now() - 1).toISOString()})), 'TIMEOUT');
  assert.equal(authCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('invalid normalized deadlines stop the direct cloud port before credentials or transport', async () => {
  const auth = provider();
  let sends = 0;
  const cloud = port(async () => { sends++; return jsonResponse(message('never')); }, auth);
  const year = new Date().getUTCFullYear() + 2;
  for (const deadline of [`${year}-04-31T00:00:00.000Z`, `${year}-01-01T24:00:00.000Z`,
    `${year}-01-01`, `${year}-01-01T00:00:00+00:00`]) {
    await rejectsCode(cloud.invoke(request({deadline})), 'INVALID_ARGUMENT');
  }
  assert.equal(auth.calls, 0);
  assert.equal(sends, 0);
});

test('direct cloud port keeps canonical deadlines with and without zero milliseconds', async () => {
  const cloud = port(async () => jsonResponse(message('synthetic')));
  const year = new Date().getUTCFullYear() + 2;
  for (const deadline of [`${year}-01-01T00:00:00Z`, `${year}-01-01T00:00:00.000Z`, `${year}-01-01T00:00:00.123Z`]) {
    assert.equal((await cloud.invoke(request({deadline}))).text, 'synthetic');
  }
});

function failingCleanupSignal(controller, secret) {
  let removals = 0;
  return {
    get removals() { return removals; },
    get aborted() { return controller.signal.aborted; },
    addEventListener(...args) { controller.signal.addEventListener(...args); },
    removeEventListener(...args) {
      removals++;
      controller.signal.removeEventListener(...args);
      throw new Error(secret);
    },
  };
}

test('signal cleanup errors preserve successful cloud results and original failures', async () => {
  const secret = 'private-cleanup-canary';
  const signal = failingCleanupSignal(new AbortController(), secret);
  const success = port(async () => jsonResponse(message('synthetic')));
  assert.equal((await success.invoke(request({signal}))).text, 'synthetic');
  assert.equal(signal.removals, 1);
  const failedSignal = failingCleanupSignal(new AbortController(), secret);
  const failure = port(async () => { throw new Error('private-transport-canary'); });
  await rejectsCode(failure.invoke(request({signal: failedSignal})), 'EXTERNAL_FAILURE', [secret]);
  assert.equal(failedSignal.removals, 1);
});

test('signal cleanup errors preserve caller cancellation and deadline errors', async () => {
  const secret = 'private-cleanup-canary';
  for (const code of ['CANCELLED', 'TIMEOUT']) {
    const controller = new AbortController();
    const signal = failingCleanupSignal(controller, secret);
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const cloud = port(() => { started(); return new Promise(() => {}); });
    const pending = cloud.invoke(request({signal,
      deadline: new Date(Date.now() + (code === 'TIMEOUT' ? 100 : 5_000)).toISOString()}));
    await ready;
    if (code === 'CANCELLED') controller.abort();
    await rejectsCode(pending, code, [secret]);
    assert.equal(signal.removals, 1);
  }
});

test('signal listener setup errors are sanitized and release partially registered listeners', async () => {
  const secret = 'private-setup-canary';
  const controller = new AbortController();
  let removals = 0;
  const signal = {
    aborted: false,
    addEventListener(...args) {
      controller.signal.addEventListener(...args);
      throw new Error(secret);
    },
    removeEventListener(...args) {
      removals++;
      controller.signal.removeEventListener(...args);
      throw new Error('private-cleanup-canary');
    },
  };
  const auth = provider();
  let sends = 0;
  const cloud = port(async () => { sends++; return jsonResponse(message('never')); }, auth);
  await rejectsCode(cloud.invoke(request({signal})), 'INVALID_ARGUMENT', [secret, 'private-cleanup-canary']);
  assert.equal(removals, 1);
  assert.equal(auth.calls, 0);
  assert.equal(sends, 0);
});

test('request and signal accessor errors are sanitized before invocation setup', async () => {
  const secret = 'private-request-canary';
  const auth = provider();
  const cloud = port(async () => jsonResponse(message('never')), auth);
  const input = Object.defineProperty(request(), 'signal', {get() { throw new Error(secret); }});
  await rejectsCode(cloud.invoke(input), 'INVALID_ARGUMENT', [secret]);
  const signal = {aborted: false, removeEventListener() {},
    get addEventListener() { throw new Error(secret); }};
  await rejectsCode(cloud.invoke(request({signal})), 'INVALID_ARGUMENT', [secret]);
  assert.equal(auth.calls, 0);
});

test('signal state failures after listener registration are invalid input and clean up', async () => {
  for (const invalidState of ['throw', 'non-boolean']) {
    let reads = 0;
    const listeners = new Set();
    const signal = {
      get aborted() {
        if (reads++ === 0) return false;
        if (invalidState === 'throw') throw new Error('private-state-canary');
        return 'cancelled';
      },
      addEventListener(_type, listener) { listeners.add(listener); },
      removeEventListener(_type, listener) { listeners.delete(listener); },
    };
    const auth = provider();
    const cloud = port(async () => jsonResponse(message('never')), auth);
    await rejectsCode(cloud.invoke(request({signal})), 'INVALID_ARGUMENT', ['private-state-canary']);
    assert.equal(listeners.size, 0);
    assert.equal(auth.calls, 0);
  }
});

test('abort during an in-flight fetch maps to CANCELLED and passes the combined signal', async () => {
  const controller = new AbortController();
  let combinedSignal;
  const cloud = port((_url, init) => {
    combinedSignal = init.signal;
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('transport aborted')), {once: true});
    });
  });
  const pending = cloud.invoke(request({signal: controller.signal}));
  await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();
  await rejectsCode(pending, 'CANCELLED');
  assert.ok(combinedSignal instanceof AbortSignal);
  assert.notEqual(combinedSignal, controller.signal);
  assert.equal(combinedSignal.aborted, true);
});

test('deadline wins when the transport rejects as its combined signal aborts', async () => {
  const secret = 'transport-deadline-secret';
  const cloud = port((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      queueMicrotask(() => reject(new Error(secret)));
    }, {once: true});
  }));
  await rejectsCode(cloud.invoke(request({
    deadline: new Date(Date.now() + 15).toISOString(),
  })), 'TIMEOUT', [secret]);
});

test('authorization and network failures are external failures without sensitive details', async () => {
  const token = 'Bearer very-secret-token';
  const goal = 'private goal must never be echoed';
  const authFailure = port(async () => { throw new Error(token); }, {read: async () => { throw new Error(token); }});
  await rejectsCode(authFailure.invoke(request({goal})), 'EXTERNAL_FAILURE', [token, goal]);

  const networkFailure = port(async () => { throw new Error(`${token} ${goal}`); });
  await rejectsCode(networkFailure.invoke(request({goal})), 'EXTERNAL_FAILURE', [token, goal]);
});

test('authorization rejects header control characters before fetch', async () => {
  let fetchCalls = 0;
  const cloud = port(async () => {
    fetchCalls += 1;
    return jsonResponse(message('never'));
  }, {read: async () => 'Bearer safe\r\nX-Leak: yes'});
  await rejectsCode(cloud.invoke(request()), 'EXTERNAL_FAILURE', ['X-Leak', 'yes']);
  assert.equal(fetchCalls, 0);
});

test('underlying ProtocolError values are not trusted or leaked', async () => {
  const secret = 'provider-error-secret';
  const authFailure = port(async () => jsonResponse(message('never')), {
    read: async () => { throw new ProtocolError('CANCELLED', secret); },
  });
  await rejectsCode(authFailure.invoke(request()), 'EXTERNAL_FAILURE', [secret]);

  const fetchFailure = port(async () => {
    throw new ProtocolError('INVALID_ARGUMENT', secret);
  });
  await rejectsCode(fetchFailure.invoke(request()), 'EXTERNAL_FAILURE', [secret]);
});

test('non-success HTTP diagnostics expose only bounded canonical provider codes', {timeout: 4_000}, async () => {
  const token = 'Bearer hidden-token';
  const goal = 'hidden goal';
  const secret = `provider secret ${token} ${goal}`;
  const check = async (response, expectedCode, overrides = {}) => {
    const receipts = [];
    let fetchCalls = 0;
    const cloud = new AgentArtsCloudAgentPort({gatewayUrl: GATEWAY, runtimeName: RUNTIME},
      provider(token), async () => { fetchCalls += 1; return response; },
      undefined, undefined, receipt => receipts.push(receipt));
    await rejectsCode(cloud.invoke(request({goal, ...overrides})), 'EXTERNAL_FAILURE', [token, goal, secret]);
    assert.equal(fetchCalls, 1);
    assert.equal(receipts.length, 1);
    const receipt = receipts[0];
    assert.match(receipt.requestId, /^pa-[0-9a-f]{32}-3$/);
    assert.equal(Object.isFrozen(receipt), true);
    assert.deepEqual(receipt, {
      stage: 'http_response', code: 'EXTERNAL_FAILURE', requestId: receipt.requestId,
      httpStatus: response.status, contentType: response.headers ? 'json' : 'missing',
      ...(expectedCode === undefined ? {} : {providerErrorCode: expectedCode}),
    });
    for (const value of [token, goal, secret, 'private-header']) {
      assert.equal(JSON.stringify(receipt).includes(value), false);
    }
  };
  await check(jsonResponse({error_code: 'Service.1234', error_msg: secret}, 403), 'SERVICE.1234');
  await check(jsonResponse({data: {error_code: 'service.4321', message: secret}}, 401), 'SERVICE.4321');
  for (const error_code of [secret, 'SERVICE.1234\nprivate-header', 1234]) {
    await check(jsonResponse({error_code, error_msg: secret}, 500));
  }
  await check(new Response(secret, {status: 403,
    headers: {'content-type': 'application/json', 'x-private': 'private-header'}}));
  let chunkReads = 0;
  await check({status: 403, body: {
    async *[Symbol.asyncIterator]() {
      chunkReads += 1;
      yield new Uint8Array(1024 * 1024 + 1);
      chunkReads += 1;
      yield new TextEncoder().encode(JSON.stringify({error_code: 'SERVICE.1234'}));
    },
  }});
  assert.equal(chunkReads, 1);
  const controller = new AbortController();
  await check({status: 403, text: () => {
    queueMicrotask(() => controller.abort());
    return new Promise(() => {});
  }}, undefined, {signal: controller.signal});
  await check({status: 403, text: () => new Promise(() => {})}, undefined, {
    deadline: new Date(Date.now() + 50).toISOString(),
  });
  const diagnosticStarted = Date.now();
  await check({status: 403, text: () => new Promise(() => {})}, undefined, {
    deadline: new Date(Date.now() + 10_000).toISOString(),
  });
  assert.ok(Date.now() - diagnosticStarted < 3_000);
  let bodyReads = 0;
  const withoutObserver = port(async () => ({status: 403, text: () => {
    bodyReads += 1;
    return new Promise(() => {});
  }}));
  await rejectsCode(withoutObserver.invoke(request()), 'EXTERNAL_FAILURE');
  assert.equal(bodyReads, 0);
});

test('response byte and text limits are enforced at their exact boundaries', async () => {
  const atLimit = 'a'.repeat(16_000);
  const good = port(async () => jsonResponse(message(atLimit)));
  const result = await good.invoke(request());
  assert.equal(result.text, atLimit);

  const tooMuchText = port(async () => jsonResponse(message('a'.repeat(16_001))));
  await rejectsCode(tooMuchText.invoke(request()), 'EXTERNAL_FAILURE');

  const tooManyBytes = port(async () => new Response(new Uint8Array(1024 * 1024 + 1), {
    status: 200,
    headers: {'content-type': 'application/json'},
  }));
  await rejectsCode(tooManyBytes.invoke(request()), 'EXTERNAL_FAILURE');
});

test('a valid response at exactly one MiB is accepted', async () => {
  const json = JSON.stringify(message('ok'));
  const body = json + ' '.repeat(1024 * 1024 - Buffer.byteLength(json));
  assert.equal(Buffer.byteLength(body), 1024 * 1024);
  const cloud = port(async () => new Response(body, {
    headers: {'content-type': 'application/json'},
  }));
  assert.equal((await cloud.invoke(request())).text, 'ok');
});

test('UTF-8 characters split across byte chunks retain their text', async () => {
  const text = '中文🙂';
  const bytes = new TextEncoder().encode(JSON.stringify(message(text)));
  const cloud = port(async () => ({
    status: 200,
    headers: {get: () => 'application/json'},
    body: {
      async *[Symbol.asyncIterator]() {
        for (const byte of bytes) yield new Uint8Array([byte]);
      },
    },
  }));
  assert.equal((await cloud.invoke(request())).text, text);
});

test('streaming body byte limit rejects before requesting another chunk', async () => {
  let reads = 0;
  const body = {
    async *[Symbol.asyncIterator]() {
      reads += 1;
      yield new Uint8Array(1024 * 1024 + 1);
      reads += 1;
      yield new Uint8Array();
    },
  };
  const cloud = port(async () => ({
    status: 200,
    headers: {get: () => 'application/json'},
    body,
  }));
  await rejectsCode(cloud.invoke(request()), 'EXTERNAL_FAILURE');
  assert.equal(reads, 1);
});

test('over-limit native response stream is cancelled before its lock is released', async () => {
  let cancellations = 0;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
    cancel(reason) { assert.equal(reason, undefined); cancellations += 1; },
  });
  const cloud = port(async () => new Response(body, {
    headers: {'content-type': 'application/json'},
  }));
  await rejectsCode(cloud.invoke(request()), 'EXTERNAL_FAILURE');
  assert.equal(cancellations, 1);
  assert.equal(body.locked, false);
});

test('non-success native response closes without consuming private body or waiting for cleanup', async () => {
  let reads = 0;
  let cancellations = 0;
  const body = new ReadableStream({
    pull() { reads += 1; },
    cancel() { cancellations += 1; return new Promise(() => {}); },
  }, {highWaterMark: 0});
  const cloud = port(async () => new Response(body, {status: 503}));
  await assert.rejects(cloud.invoke(request()), error => {
    assert.equal(error.code, 'EXTERNAL_FAILURE');
    assert.equal(error.retryable, true);
    assert.equal(error.message, 'AgentArts request returned a non-success HTTP status');
    return true;
  });
  assert.equal(cancellations, 1);
  assert.equal(reads, 0);
  assert.equal(body.locked, false);
});

test('cancellation closes an uncooperative reader without replacing the original error', async () => {
  const controller = new AbortController();
  let entered;
  const reading = new Promise(resolve => { entered = resolve; });
  let cancellations = 0;
  let releases = 0;
  const cloud = port(async () => ({
    status: 200,
    headers: {get: () => 'application/json'},
    body: {getReader: () => ({
      read() { entered(); return new Promise(() => {}); },
      cancel() { cancellations += 1; throw new Error('private cleanup detail'); },
      releaseLock() { releases += 1; throw new Error('private release detail'); },
    })},
  }));
  const result = cloud.invoke(request({signal: controller.signal}));
  await reading;
  controller.abort();
  await rejectsCode(result, 'CANCELLED', ['private cleanup detail', 'private release detail']);
  assert.equal(cancellations, 1);
  assert.equal(releases, 1);
});

test('a transport response arriving after cancellation is discarded without resuming or retrying', async () => {
  const controller = new AbortController();
  let deliver;
  let entered;
  const fetching = new Promise(resolve => { entered = resolve; });
  let requests = 0;
  let cancellations = 0;
  const body = new ReadableStream({
    cancel() { cancellations += 1; },
  }, {highWaterMark: 0});
  const cloud = port(() => {
    requests += 1;
    entered();
    return new Promise(resolve => { deliver = resolve; });
  });
  const result = cloud.invoke(request({signal: controller.signal}));
  await fetching;
  controller.abort();
  await rejectsCode(result, 'CANCELLED');
  assert.equal(cancellations, 0);
  deliver(new Response(body, {headers: {'content-type': 'application/json'}}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancellations, 1);
  assert.equal(body.locked, false);
  assert.equal(requests, 1);
});

test('a fully consumed native response is released without cancelling successful transport', async () => {
  let cancellations = 0;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(message('ok'))));
      controller.close();
    },
    cancel() { cancellations += 1; },
  });
  const cloud = port(async () => new Response(body, {
    headers: {'content-type': 'application/json'},
  }));
  assert.equal((await cloud.invoke(request())).text, 'ok');
  assert.equal(body.locked, false);
  assert.equal(cancellations, 0);
});

test('cancellation during fetch result handoff still closes the unread response once', async () => {
  const controller = new AbortController();
  let deliver;
  let entered;
  const fetching = new Promise(resolve => { entered = resolve; });
  let requests = 0;
  let reads = 0;
  let cancellations = 0;
  const body = new ReadableStream({
    pull() { reads += 1; },
    cancel() { cancellations += 1; },
  }, {highWaterMark: 0});
  const cloud = port(() => {
    requests += 1;
    entered();
    return new Promise(resolve => { deliver = resolve; });
  });
  const result = cloud.invoke(request({signal: controller.signal}));
  await fetching;
  deliver(new Response(body, {headers: {'content-type': 'application/json'}}));
  queueMicrotask(() => controller.abort());
  await rejectsCode(result, 'CANCELLED');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancellations, 1);
  assert.equal(body.locked, false);
  assert.equal(reads, 0);
  assert.equal(requests, 1);
});

test('invalid UTF-8 is rejected for raw body and text seams', async () => {
  const invalidBytes = port(async () => new Response(new Uint8Array([0xc3, 0x28]), {
    status: 200,
    headers: {'content-type': 'application/json'},
  }));
  await rejectsCode(invalidBytes.invoke(request()), 'EXTERNAL_FAILURE');

  const replacementText = port(async () => ({
    status: 200,
    headers: {get: () => 'application/json'},
    body: null,
    text: async () => '\uFFFD',
  }));
  await rejectsCode(replacementText.invoke(request()), 'EXTERNAL_FAILURE');
});

test('missing content type is rejected instead of guessed from the payload', async () => {
  const cloud = port(async () => new Response(JSON.stringify(message('ok')), {status: 200}));
  await rejectsCode(cloud.invoke(request()), 'EXTERNAL_FAILURE');
});

test('unsupported content types are rejected instead of guessed from the payload', async () => {
  for (const contentType of ['text/plain', 'application/xml', 'application/jsonx']) {
    const cloud = port(async () => new Response(JSON.stringify(message('ok')), {
      status: 200,
      headers: {'content-type': contentType},
    }));
    await rejectsCode(cloud.invoke(request()), 'EXTERNAL_FAILURE');
  }
});

test('malformed JSON, conflicting indexes, and empty text are rejected', async () => {
  const malformed = port(async () => new Response('{not-json', {
    status: 200,
    headers: {'content-type': 'application/json'},
  }));
  await rejectsCode(malformed.invoke(request()), 'EXTERNAL_FAILURE');

  const conflicting = port(async () => jsonResponse([message('A', 0), message('B', 0)]));
  await rejectsCode(conflicting.invoke(request()), 'EXTERNAL_FAILURE');

  const empty = port(async () => jsonResponse({event: 'status', data: {text: 'ignored'}}));
  await rejectsCode(empty.invoke(request()), 'EXTERNAL_FAILURE');
});

test('all task ids use a stable hashed, header-safe session id', async () => {
  const calls = [];
  const cloud = port(async (_url, init) => {
    calls.push(init.headers);
    return jsonResponse(message('ok'));
  });
  const taskId = 'private/task?id=with spaces/'.repeat(4);
  await cloud.invoke(request({taskId}));
  await cloud.invoke(request({taskId}));
  const first = calls[0]['x-hw-agentarts-session-id'];
  assert.match(first, /^[A-Za-z0-9_-]{1,64}$/);
  assert.match(first, /^pa-[0-9a-f]{32}$/);
  assert.equal(first, calls[1]['x-hw-agentarts-session-id']);
  assert.equal(first.includes('private'), false);
  assert.equal(calls[0]['X-Request-Id'], `${first}-3`);
});

test('short task ids are also hashed instead of exported in a header', async () => {
  let headers;
  const cloud = port(async (_url, init) => {
    headers = init.headers;
    return jsonResponse(message('ok'));
  });
  await cloud.invoke(request({taskId: 'task-1'}));
  assert.match(headers['x-hw-agentarts-session-id'], /^pa-[0-9a-f]{32}$/);
  assert.equal(headers['x-hw-agentarts-session-id'].includes('task-1'), false);
});

test('request id remains bounded for the largest accepted revision', async () => {
  let headers;
  const cloud = port(async (_url, init) => {
    headers = init.headers;
    return jsonResponse(message('ok'));
  });
  await cloud.invoke(request({taskId: 'a'.repeat(48), revision: Number.MAX_SAFE_INTEGER}));
  assert.match(headers['x-hw-agentarts-session-id'], /^[A-Za-z0-9_-]{1,64}$/);
  assert.match(headers['X-Request-Id'], /^[A-Za-z0-9_-]{1,64}$/);
  assert.ok(headers['X-Request-Id'].length <= 64);
});

test('parent cancellation interrupts an authorization read', async () => {
  const controller = new AbortController();
  let authSignal;
  let fetchCalls = 0;
  const auth = {
    read: signal => {
      authSignal = signal;
      return new Promise(() => {});
    },
  };
  const cloud = port(async () => {
    fetchCalls += 1;
    return jsonResponse(message('never'));
  }, auth);
  const pending = cloud.invoke(request({signal: controller.signal}));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(authSignal instanceof AbortSignal);
  controller.abort();
  await rejectsCode(pending, 'CANCELLED');
  assert.equal(fetchCalls, 0);
});

test('an empty sanitized task id also uses the deterministic hash fallback', async () => {
  let headers;
  const cloud = port(async (_url, init) => {
    headers = init.headers;
    return jsonResponse(message('ok'));
  });
  await cloud.invoke(request({taskId: ''}));
  assert.match(headers['x-hw-agentarts-session-id'], /^pa-[0-9a-f]{32}$/);
});
