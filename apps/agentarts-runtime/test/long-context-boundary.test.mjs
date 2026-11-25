import assert from 'node:assert/strict';
import test from 'node:test';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {MAX_COORDINATION_GOAL_CHARACTERS, MAX_COORDINATION_INITIAL_QUERY_BYTES} from '@personal-agent/contracts';
import {MAX_AGENTARTS_TRANSPORT_BYTES} from '@personal-agent/contracts/agentarts-transport';
import {createAgentServer} from '../src/server.mjs';

const token = 'synthetic-long-context-offline-secret';

async function host(t) {
  const calls = [];
  const server = createAgentServer({mode:'standalone-validation', wssAuthToken:token,
    orchestrator:{invoke:async value => {calls.push(value); return {kind:'text', text:'合成答复'};}}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const port = server.address().port;
  return {calls, url:`http://127.0.0.1:${port}`, wsUrl:`ws://127.0.0.1:${port}/ws`};
}

test('HTTP keeps one million ASCII and UTF-8 characters and rejects a body over the transport cap', async t => {
  assert.ok(MAX_AGENTARTS_TRANSPORT_BYTES > MAX_COORDINATION_INITIAL_QUERY_BYTES);
  assert.ok(MAX_COORDINATION_INITIAL_QUERY_BYTES >= MAX_COORDINATION_GOAL_CHARACTERS * 3);
  const {url, calls} = await host(t);
  for (const query of ['a'.repeat(1_000_000), '中'.repeat(1_000_000)]) {
    const response = await fetch(url + '/invocations', {method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({query})});
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1).query, query);
  }
  const over = await fetch(url + '/invocations', {method:'POST', headers:{'content-type':'application/json'},
    body:'x'.repeat(MAX_AGENTARTS_TRANSPORT_BYTES + 1)});
  assert.notEqual(over.status, 200);
  assert.equal(calls.length, 2);
});

test('WSS closes a frame over the transport cap before the model runs', async t => {
  const {wsUrl, calls} = await host(t);
  const socket = new WebSocket(wsUrl, {headers:{'x-pa-agent-token':`Bearer ${token}`, 'x-hw-agentarts-session-id':'long-context'}});
  socket.on('error', () => {});
  t.after(() => socket.terminate());
  await once(socket, 'open');
  const closed = once(socket, 'close');
  socket.send('x'.repeat(MAX_AGENTARTS_TRANSPORT_BYTES + 1));
  await closed;
  assert.equal(calls.length, 0);
});
