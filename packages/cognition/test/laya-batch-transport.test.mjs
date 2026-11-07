import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {LocalLayaBatchHttpTransport} from '../dist/laya-batch-transport.js';

const batchPayload = {items: [{requestId: 'item_0', state: {events: [{index: 0, observation: 'synthetic', facts: []}]}}],
  questions: {category_0: {type: 'choice', instructions: 'synthetic only', criteria: {work: 'Work'}}}};
const singlePayload = {model: 'multilingual', state: {events: []}, questions: {}};
const json = body => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});

test('constructor validates the local port through the delegated single-item transport', () => {
  for (const port of [80, 1023, 65536, Number.NaN]) {
    assert.throws(() => new LocalLayaBatchHttpTransport(port, () => 'local-test-token'), /^Error: Invalid Laya port$/);
  }
  for (const port of [1024, 65535]) new LocalLayaBatchHttpTransport(port, () => 'local-test-token');
});

test('inferBatch posts the host payload once to the authenticated loopback batch endpoint', async () => {
  let url, options;
  const transport = new LocalLayaBatchHttpTransport(8123, () => 'local-test-token', async (target, init) => {
    url = target; options = init;
    return json({items: []});
  });
  const controller = new AbortController();
  assert.deepEqual(await transport.inferBatch(batchPayload, controller.signal), {items: []});
  assert.equal(url, 'http://127.0.0.1:8123/v1/systemone/batch');
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.equal(options.signal, controller.signal);
  assert.equal(options.headers.authorization, 'Bearer local-test-token');
  assert.equal(options.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(options.body), batchPayload);
});

test('single-item inference stays on the per-item endpoint and keeps the same host key rules', async () => {
  let url;
  const transport = new LocalLayaBatchHttpTransport(8123, () => 'local-test-token', async target => {
    url = target;
    return json({answers: {}});
  });
  assert.deepEqual(await transport.infer(singlePayload, new AbortController().signal), {answers: {}});
  assert.equal(url, 'http://127.0.0.1:8123/v1/systemone');
});

test('a missing or newline-bearing host key fails before any request leaves the process', async () => {
  let requests = 0;
  const make = key => new LocalLayaBatchHttpTransport(8123, () => key, async () => { requests++; });
  for (const key of ['', 'line\nbroken', 'carriage\rreturn']) {
    const transport = make(key);
    await assert.rejects(() => transport.inferBatch(batchPayload, new AbortController().signal),
      /^Error: Laya key unavailable$/);
    await assert.rejects(() => transport.infer(singlePayload, new AbortController().signal),
      /^Error: Laya key unavailable$/);
  }
  assert.equal(requests, 0);
});

test('a failed batch response stops its body and never surfaces provider error text', async () => {
  let cancellations = 0;
  const failing = new LocalLayaBatchHttpTransport(8123, () => 'local-test-token', async () =>
    new Response(new ReadableStream({start(controller) {
      controller.enqueue(new TextEncoder().encode('secret remote batch error'));
    }, cancel() { cancellations++; }}), {status: 503}));
  await assert.rejects(() => failing.inferBatch(batchPayload, new AbortController().signal), error => {
    assert.equal(error.message, 'Local Laya batch unavailable');
    assert.doesNotMatch(error.message, /secret remote batch error/);
    return true;
  });
  assert.equal(cancellations, 1, 'the rejected response must stop its producer');
  const bodyless = new LocalLayaBatchHttpTransport(8123, () => 'local-test-token', async () => ({ok: false}));
  await assert.rejects(() => bodyless.inferBatch(batchPayload, new AbortController().signal),
    /^Error: Local Laya batch unavailable$/);
});

test('real fetch rejects a batch redirect before the host key reaches another local server', async () => {
  let redirectedHits = 0;
  const redirected = createServer((incoming, response) => {
    redirectedHits++;
    incoming.resume();
    response.writeHead(200, {'content-type': 'application/json'});
    response.end('{}');
  });
  const source = createServer((incoming, response) => {
    incoming.resume();
    response.writeHead(307, {location: `http://127.0.0.1:${redirected.address().port}/receive`});
    response.end();
  });
  try {
    redirected.listen(0, '127.0.0.1');
    await once(redirected, 'listening');
    source.listen(0, '127.0.0.1');
    await once(source, 'listening');
    const transport = new LocalLayaBatchHttpTransport(source.address().port, () => 'local-test-token');
    await assert.rejects(() => transport.inferBatch(batchPayload, new AbortController().signal));
    assert.equal(redirectedHits, 0);
  } finally {
    source.closeAllConnections();
    redirected.closeAllConnections();
    await Promise.all([new Promise(resolve => source.close(resolve)),
      new Promise(resolve => redirected.close(resolve))]);
  }
});
