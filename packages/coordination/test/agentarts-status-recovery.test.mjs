import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AgentArtsCloudAgentPort, AgentArtsResultUnknownError, AgentArtsTerminalError,
  AgentArtsWebSocketTransport} from '../dist/index.js';
import {SyntheticWebSocket, identity, events} from './fixtures/websocket.mjs';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const config = {gatewayUrl: 'https://agentarts.example.test', runtimeName: 'synthetic', transport: 'wss',
  websocketUrl: 'wss://agentarts.example.test/runtimes/synthetic/ws', allowHttpsFallback: true};
const flush = () => new Promise(resolve => setImmediate(resolve));
const advance = async (t, milliseconds) => { t.mock.timers.tick(milliseconds); await flush(); };
const mockClock = t => t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: NOW});
const status = (receipt, state = 'completed', changes = {}) => ({...identity(receipt), type: 'status', state,
  ...(state === 'completed' ? {events: events('Recovered answer')} : {}),
  ...(['failed', 'cancelled'].includes(state) ? {code: 'EXTERNAL_FAILURE'} : {}), ...changes});
const readText = async response => JSON.parse(await response.text())[0].data.text;
const observe = promise => {
  const outcome = {settled: false};
  promise.then(() => { outcome.settled = true; }, () => { outcome.settled = true; });
  return outcome;
};

function harness({recover = receipt => status(receipt), enabled = true, supportsStatus = true,
  accept = true, onAccepted, onTerminal} = {}) {
  const sockets = [], calls = [], dispatched = [], accepted = [], terminal = [], states = [];
  let serial = 0;
  const transport = new AgentArtsWebSocketTransport(config.websocketUrl, () => {
    const socket = new SyntheticWebSocket((frame, socket) => {
      if (frame.type === 'invoke' && accept) socket.accepted(frame);
    }, {autoReady: false});
    sockets.push(socket);
    queueMicrotask(() => socket.ready({capabilities: supportsStatus ? ['invoke', 'cancel', 'status'] : ['invoke', 'cancel']}));
    return socket;
  }, state => states.push(state), enabled ? async (receipt, controls) => {
    calls.push({receipt, controls});
    return await recover(receipt, controls, calls.length);
  } : undefined);
  const invoke = ({controller = new AbortController(), deadline = new Date(Date.now() + 180_000).toISOString()} = {}) => {
    const init = {method: 'POST', redirect: 'error', signal: controller.signal,
      body: JSON.stringify({query: 'Public synthetic recovery fixture'}), headers: {
        Authorization: 'Bearer original-outer', 'X-PA-Agent-Token': 'Bearer original-inner',
        'x-hw-agentarts-session-id': 'synthetic-session', 'X-Request-Id': `synthetic-request-${++serial}`,
        'X-PA-Deadline': deadline, 'X-Invoke-Mode': 'sync',
      }};
    const pending = transport.invoke(init, {
      beforeSend: receipt => { dispatched.push(receipt); },
      afterAccepted: receipt => { accepted.push(receipt); onAccepted?.(receipt); },
      afterTerminal: receipt => { terminal.push(receipt); onTerminal?.(receipt); },
    });
    return {pending, outcome: observe(pending), controller, init, deadline};
  };
  const invokes = () => sockets.flatMap(socket => socket.sent).filter(frame => frame.type === 'invoke');
  return {transport, sockets, calls, dispatched, accepted, terminal, states, invoke, invokes};
}

function portHarness({respondToStatus = true} = {}) {
  const sockets = [], connects = [], queries = [], dispatched = [], accepted = [], terminal = [];
  const outerReads = [], innerReads = [];
  let token = 'initial', http = 0;
  const port = new AgentArtsCloudAgentPort(config, {read: async () => {
    outerReads.push(token); return `Bearer outer-${token}`;
  }}, async () => { http++; throw Error('No HTTP replay'); }, undefined, undefined, undefined, {
    recoverAcceptedStatus: true,
    authorizationProvider: {read: async () => { innerReads.push(token); return `Bearer inner-${token}`; }},
    factory: (_url, options) => {
      connects.push(options);
      const socket = new SyntheticWebSocket((frame, socket) => {
        if (frame.type === 'invoke') socket.accepted(frame);
        if (frame.type === 'status') {
          queries.push({frame, socket});
          if (respondToStatus) socket.receive(status(frame));
        }
      });
      sockets.push(socket); return socket;
    },
    onDispatch: (_request, receipt) => { dispatched.push(receipt); },
    onAccepted: (_request, receipt) => { accepted.push(receipt); },
    onTerminal: (_request, receipt) => { terminal.push(receipt); },
  });
  const invoke = ({controller = new AbortController(), deadline = new Date(Date.now() + 180_000).toISOString(), revision = 1} = {}) => {
    const pending = port.invoke({taskId: 'synthetic-task', revision, goal: 'Public recovery fixture',
      deadline, signal: controller.signal});
    return {pending, outcome: observe(pending), controller, deadline};
  };
  return {port, sockets, connects, queries, dispatched, accepted, terminal, outerReads, innerReads, invoke,
    rotateCredentials: () => { token = 'refreshed'; }, get http() { return http; }};
}

test('opted-in recovery refreshes credentials and uses the original parser, callbacks and dispatch identity', async t => {
  mockClock(t);
  const h = portHarness();
  try {
    const original = h.invoke(); await flush();
    const frame = h.sockets[0].sent.find(frame => frame.type === 'invoke');
    h.rotateCredentials();
    await advance(t, 29_999); assert.equal(h.queries.length, 0); assert.equal(original.outcome.settled, false);
    await advance(t, 1);
    assert.deepEqual(await original.pending, {kind: 'text', text: 'Recovered answer', verification: 'unverified'});
    assert.deepEqual(identity(h.queries[0].frame), identity(frame));
    assert.deepEqual(h.outerReads, ['initial', 'refreshed']); assert.deepEqual(h.innerReads, ['initial', 'refreshed']);
    assert.equal(h.connects[1].headers.Authorization, 'Bearer outer-refreshed');
    assert.equal(h.connects[1].headers['X-PA-Agent-Token'], 'Bearer inner-refreshed');
    assert.equal(h.dispatched.length, 1); assert.equal(h.accepted.length, 1); assert.equal(h.terminal.length, 1);
    assert.deepEqual(h.terminal[0], {...h.dispatched[0], accepted: true});
    assert.equal(h.sockets.flatMap(socket => socket.sent).filter(frame => frame.type === 'invoke').length, 1);
    assert.equal(h.http, 0);

    h.sockets[0].result(frame, 'Late original result');
    const next = h.invoke({revision: 2}); await flush();
    const currentSocket = h.sockets.at(-1);
    const second = currentSocket.sent.filter(frame => frame.type === 'invoke').at(-1);
    currentSocket.result(second, 'Next answer');
    assert.equal((await next.pending).text, 'Next answer');
    assert.equal(h.sockets.length, 3, 'the next explicit invocation replaces the pooled socket after credentials change');
    assert.equal(h.terminal.length, 2); assert.equal(h.queries.length, 1); assert.equal(h.http, 0);
  } finally { h.port.close(); }
});

test('running is observed again; each read is bounded and a slow cancellation acknowledgement never overlaps reads', async t => {
  mockClock(t);
  let release;
  const h = harness({recover: (receipt, _controls, count) => count === 1 ? status(receipt, 'running')
    : count === 2 ? new Promise(resolve => { release = resolve; }) : status(receipt)});
  try {
    const original = h.invoke(); await flush();
    await advance(t, 30_000); assert.equal(h.calls.length, 1); assert.equal(original.outcome.settled, false);
    assert.equal(h.calls[0].controls.deadline, new Date(NOW + 40_000).toISOString());
    assert.ok(Object.isFrozen(h.calls[0].receipt));
    assert.deepEqual(h.calls[0].receipt, {...h.dispatched[0], accepted: true});
    await advance(t, 30_000); assert.equal(h.calls.length, 2);
    await advance(t, 10_000); assert.equal(h.calls[1].controls.signal.aborted, true);
    await advance(t, 30_000); assert.equal(h.calls.length, 2, 'the host still owns the aborted read until it acknowledges it');
    release(status(h.calls[1].receipt)); await flush();
    assert.equal(original.outcome.settled, false, 'a completed response after its read deadline is discarded');
    await advance(t, 30_000);
    assert.equal(await readText(await original.pending), 'Recovered answer');
    assert.equal(h.calls.length, 3); assert.equal(h.invokes().length, 1);
    assert.equal(h.accepted.length, 1); assert.equal(h.terminal.length, 1);
    await advance(t, 120_000); assert.equal(h.calls.length, 3);
  } finally { h.transport.close(); }
});

test('unknown, changed instance, invalid observations and lookup failures preserve the original invoke', async t => {
  const cases = [
    ['unknown', receipt => status(receipt, 'unknown')],
    ['instance', receipt => status(receipt, 'completed', {serverInstanceId: 'different-instance'})],
    ...['sessionId', 'requestId', 'idempotencyKey', 'payloadDigest'].map(field => [field,
      receipt => status(receipt, 'completed', {[field]: field === 'payloadDigest' ? 'b'.repeat(64) : 'different'})]),
    ['event-order', receipt => status(receipt, 'completed', {events: [{event: 'task_end'}, {event: 'end'}]})],
    ['result-size', receipt => status(receipt, 'completed', {events: events('大'.repeat(30_000))})],
    ['added-field', receipt => status(receipt, 'completed', {verification: 'verified'})],
    ['wrong-frame', receipt => ({...identity(receipt), type: 'result', events: events('Unsolicited')})],
    ['lookup-failed', () => { throw Error('Untrusted lookup error'); }],
  ];
  for (const [name, recover] of cases) await t.test(name, async t => {
    mockClock(t);
    const h = harness({recover});
    try {
      const original = h.invoke(); await flush();
      await advance(t, 30_000);
      assert.equal(h.calls.length, 1); assert.equal(original.outcome.settled, false);
      assert.equal(h.terminal.length, 0); assert.equal(h.invokes().length, 1);
      assert.equal(h.states.some(state => state.state === 'result_unknown'), false);
      h.sockets[0].result(h.invokes()[0], 'Original answer');
      assert.equal(await readText(await original.pending), 'Original answer');
      assert.equal(h.terminal.length, 1); assert.equal(h.dispatched.length, 1);
      await advance(t, 90_000); assert.equal(h.calls.length, 1);
    } finally { h.transport.close(); }
  });
});

test('matching failed and cancelled statuses use the original remote terminal error semantics', async t => {
  for (const [state, code] of [['failed', 'RATE_LIMITED'], ['cancelled', 'CANCELLED']]) await t.test(state, async t => {
    mockClock(t);
    const h = harness({recover: receipt => status(receipt, state, {code})});
    try {
      const original = h.invoke(); await flush(); await advance(t, 30_000);
      await assert.rejects(original.pending, error => {
        assert.ok(error instanceof AgentArtsTerminalError); assert.equal(error instanceof AgentArtsResultUnknownError, false);
        assert.equal(error.remoteCode, code); assert.equal(error.code, 'EXTERNAL_FAILURE');
        assert.equal(error.retryable, false); assert.deepEqual(error.receipt, {...h.dispatched[0], accepted: true});
        return true;
      });
      h.sockets[0].result(h.invokes()[0], 'Late result');
      assert.equal(h.terminal.length, 1); assert.equal(h.invokes().length, 1);
      assert.equal(h.sockets[0].terminations, 0);
    } finally { h.transport.close(); }
  });
});

test('unknown or a different instance can still be cancelled through the original request', async t => {
  for (const name of ['unknown', 'different-instance']) await t.test(name, async t => {
    mockClock(t);
    const h = harness({recover: receipt => name === 'unknown' ? status(receipt, 'unknown')
      : status(receipt, 'completed', {serverInstanceId: 'different-instance'})});
    try {
      const original = h.invoke(); await flush(); await advance(t, 30_000);
      assert.equal(original.outcome.settled, false); assert.equal(h.terminal.length, 0);
      original.controller.abort(); await assert.rejects(original.pending, {code: 'CANCELLED'});
      h.sockets[0].result(h.invokes()[0], 'Late answer'); await advance(t, 90_000);
      assert.equal(h.calls.length, 1); assert.equal(h.invokes().length, 1); assert.equal(h.terminal.length, 0);
      assert.equal(h.sockets[0].sent.filter(frame => frame.type === 'cancel').length, 1);
    } finally { h.transport.close(); }
  });
});

test('an observation for another active request cannot settle or redirect the original Pending', async t => {
  mockClock(t);
  const h = harness({recover: receipt => receipt.requestId === h.dispatched[0].requestId
    ? status(h.dispatched[1]) : status(receipt)});
  try {
    const first = h.invoke(), second = h.invoke(); await flush(); await advance(t, 30_000);
    assert.equal(first.outcome.settled, false); assert.equal(await readText(await second.pending), 'Recovered answer');
    assert.equal(h.terminal.length, 1); assert.equal(h.terminal[0].requestId, h.dispatched[1].requestId);
    h.sockets[0].result(h.invokes()[0], 'First original answer');
    assert.equal(await readText(await first.pending), 'First original answer');
    assert.equal(h.terminal.length, 2); assert.equal(h.invokes().length, 2); assert.equal(h.sockets.length, 1);
  } finally { h.transport.close(); }
});

test('an original result wins a pending read and its tombstone suppresses reentrant and late completions', async t => {
  mockClock(t);
  let release;
  const h = harness({recover: (receipt, controls) => new Promise(resolve => {
    release = resolve;
    controls.signal.addEventListener('abort', () => h.sockets[0].result(h.invokes()[0], 'Reentrant late result'), {once: true});
  })});
  try {
    const original = h.invoke(); await flush(); await advance(t, 30_000);
    h.sockets[0].result(h.invokes()[0], 'Original answer');
    assert.equal(await readText(await original.pending), 'Original answer');
    assert.equal(h.calls[0].controls.signal.aborted, true);
    release(status(h.calls[0].receipt)); await flush();
    assert.equal(h.terminal.length, 1); assert.equal(h.sockets[0].terminations, 0);
    const next = h.invoke(); await flush();
    h.sockets[0].result(h.invokes()[1], 'Next answer');
    assert.equal(await readText(await next.pending), 'Next answer');
    assert.equal(h.sockets.length, 1); assert.equal(h.terminal.length, 2);
  } finally { h.transport.close(); }
});

test('cancellation, connection loss and close discard a read that finishes later', async t => {
  for (const mode of ['cancel', 'disconnect', 'close']) await t.test(mode, async t => {
    mockClock(t);
    let release;
    const h = harness({recover: () => new Promise(resolve => { release = resolve; })});
    try {
      const original = h.invoke(); await flush(); await advance(t, 30_000);
      if (mode === 'cancel') original.controller.abort();
      else if (mode === 'disconnect') h.sockets[0].disconnect();
      else h.transport.close();
      await assert.rejects(original.pending, error => mode === 'cancel' ? error.code === 'CANCELLED'
        : error instanceof AgentArtsResultUnknownError && error.receipt.accepted === true);
      assert.equal(h.calls[0].controls.signal.aborted, true);
      release(status(h.calls[0].receipt)); await flush();
      h.sockets[0].result(h.invokes()[0], 'Late original answer');
      await advance(t, 120_000);
      assert.equal(h.terminal.length, 0); assert.equal(h.calls.length, 1); assert.equal(h.invokes().length, 1);
      assert.equal(h.sockets[0].sent.filter(frame => frame.type === 'cancel').length, mode === 'cancel' ? 1 : 0);
    } finally { h.transport.close(); }
  });
});

test('the original application deadline clips the status read and cannot be revived by either late terminal channel', async t => {
  mockClock(t);
  const h = portHarness({respondToStatus: false});
  try {
    const original = h.invoke({deadline: new Date(NOW + 35_000).toISOString()}); await flush();
    await advance(t, 30_000); assert.equal(h.queries.length, 1);
    await advance(t, 5_000);
    await assert.rejects(original.pending, {code: 'TIMEOUT'});
    assert.equal(h.sockets[1].terminations, 1);
    h.queries[0].socket.receive(status(h.queries[0].frame));
    const frame = h.sockets[0].sent.find(frame => frame.type === 'invoke');
    h.sockets[0].result(frame, 'Expired answer'); await flush();
    assert.equal(h.terminal.length, 0); assert.equal(h.dispatched.length, 1); assert.equal(h.http, 0);
    await advance(t, 120_000); assert.equal(h.queries.length, 1);
  } finally { h.port.close(); }
});

test('a read finishing after the original deadline never settles an otherwise un-aborted Pending', async t => {
  mockClock(t);
  let release;
  const h = harness({recover: () => new Promise(resolve => { release = resolve; })});
  try {
    const original = h.invoke({deadline: new Date(NOW + 35_000).toISOString()}); await flush();
    await advance(t, 30_000);
    assert.equal(h.calls[0].controls.deadline, original.deadline);
    await advance(t, 5_000); assert.equal(h.calls[0].controls.signal.aborted, true);
    release(status(h.calls[0].receipt)); await flush();
    assert.equal(original.outcome.settled, false); assert.equal(h.terminal.length, 0); assert.equal(h.invokes().length, 1);
    original.controller.abort(); await assert.rejects(original.pending, {code: 'CANCELLED'});
  } finally { h.transport.close(); }
});

test('terminal persistence failure stays unknown on both result channels and stops recovery without replay', async t => {
  for (const channel of ['original', 'status']) await t.test(channel, async t => {
    mockClock(t);
    const h = harness({onTerminal: () => { throw Error('Durable receipt unavailable'); }});
    try {
      const original = h.invoke(); await flush();
      if (channel === 'original') h.sockets[0].result(h.invokes()[0]);
      else await advance(t, 30_000);
      await assert.rejects(original.pending, error => error instanceof AgentArtsResultUnknownError
        && error.receipt.accepted === true && error.retryable === false);
      assert.equal(h.terminal.length, 1); assert.equal(h.sockets[0].terminations, 1);
      await advance(t, 120_000);
      assert.equal(h.calls.length, channel === 'original' ? 0 : 1);
      assert.equal(h.invokes().length, 1); assert.equal(h.dispatched.length, 1);
    } finally { h.transport.close(); }
  });
});

test('recovery requires explicit host opt-in, negotiated status and a persisted accepted receipt', async t => {
  for (const [name, options] of [['disabled', {enabled: false}], ['unsupported', {supportsStatus: false}],
    ['not-accepted', {accept: false}], ['acceptance-not-persisted', {onAccepted: () => { throw Error('No durable admission'); }}]]) {
    await t.test(name, async t => {
      mockClock(t);
      const h = harness(options);
      try {
        const original = h.invoke(); await flush(); await advance(t, 90_000);
        assert.equal(h.calls.length, 0); assert.equal(h.invokes().length, 1); assert.equal(h.terminal.length, 0);
        if (name === 'acceptance-not-persisted') await assert.rejects(original.pending, AgentArtsResultUnknownError);
        else if (name === 'not-accepted') {
          original.controller.abort(); await assert.rejects(original.pending, {code: 'CANCELLED'});
        } else {
          assert.equal(original.outcome.settled, false);
          h.sockets[0].result(h.invokes()[0], 'Original answer');
          assert.equal(await readText(await original.pending), 'Original answer');
        }
      } finally { h.transport.close(); }
    });
  }
});
