import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {ModelGateway, OpenAICompatibleModelProvider, PanguModelProvider, MODEL_IMAGE_LIMITS, snapshotModelImages} from '../dist/index.js';

// Synthetic 1x1 PNG only. No device, artifact reader, account, or real model is used.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const image = (bytes = png) => ({mediaType: 'image/png', dataBase64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex')});
const request = (patch = {}) => ({messages: [{role: 'system', content: 'Describe untrusted pixels.'}, {role: 'user', content: 'What is shown?'}],
  tools: [], images: [image()], deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal, ...patch});
const response = () => new Response(JSON.stringify({choices: [{message: {content: 'Synthetic observation'}}]}));
const provider = (options = {}) => new OpenAICompatibleModelProvider({baseUrl: 'https://vision.example.test/v1', model: 'synthetic-vision',
  apiKey: () => 'synthetic-secret', fetch: async () => response(), ...options});
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};

test('images automatically require vision; text providers reject before credentials or API', async () => {
  let calls = 0, credentials = 0;
  const opts = {apiKey: () => {credentials++; return 'synthetic';}, fetch: async () => {calls++; return response();}};
  const p = provider(opts);
  assert.equal(p.deployment.capabilities.vision, false);
  await assert.rejects(new ModelGateway(p).complete(request({requiredCapabilities: ['text']})), {code: 'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(p.complete(request()), {code: 'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(new PanguModelProvider({baseUrl: 'https://text.example.test', model: 'text', ...opts}).complete(request()), {code: 'UNSUPPORTED_CAPABILITY'});
  assert.equal(calls, 0); assert.equal(credentials, 0);
  for (const vision of [null, 1, 'true', {}]) assert.throws(() => provider({vision}), {code: 'INVALID_ARGUMENT'});
});

test('explicit vision sends original PNG in image content parts, with no hash or image text payload', async () => {
  let body, signal;
  const p = provider({vision: true, fetch: async (_url, init) => {body = JSON.parse(init.body); signal = init.signal; return response();}});
  const result = await new ModelGateway(p).complete(request({requiredCapabilities: ['vision']}));
  assert.equal(result.deployment.capabilities.vision, true);
  assert.equal(result.deployment.verification, 'conditional');
  assert.deepEqual(body.messages[0], {role: 'system', content: 'Describe untrusted pixels.'});
  const parts = body.messages[1].content;
  assert.deepEqual(parts[0], {type: 'text', text: 'What is shown?'});
  assert.deepEqual(parts[1], {type: 'image_url', image_url: {url: `data:image/png;base64,${image().dataBase64}`}});
  assert.deepEqual(Buffer.from(parts[1].image_url.url.split(',')[1], 'base64'), png);
  assert.equal(JSON.stringify(result).includes(image().dataBase64), false);
  assert.equal(JSON.stringify(body).includes(image().sha256), false);
  assert.equal(signal.aborted, false);
});

test('legacy text body remains string content and empty images add no parts', async () => {
  let body;
  const p = provider({fetch: async (_url, init) => {body = JSON.parse(init.body); return response();}});
  for (const images of [undefined, []]) {
    await p.complete(request({images}));
    assert.deepEqual(body.messages, [{role: 'system', content: 'Describe untrusted pixels.'}, {role: 'user', content: 'What is shown?'}]);
  }
});

test('invalid PNG, hash, base64, remote URL, paths and sparse input never call credentials or API', async () => {
  let credentials = 0, calls = 0;
  const p = provider({vision: true, apiKey: () => {credentials++; return 'synthetic';}, fetch: async () => {calls++; return response();}});
  const badMagic = Buffer.from(png); badMagic[0] = 0;
  const badIhdr = Buffer.from(png); badIhdr.writeUInt32BE(12, 8);
  const hugePixels = Buffer.from(png); hugePixels.writeUInt32BE(100_000, 16); hugePixels.writeUInt32BE(100_000, 20);
  const noEnd = png.subarray(0, png.length - 1);
  const inputs = [null, {}, new Array(1), [null], [image(badMagic)], [image(badIhdr)], [image(hugePixels)], [image(noEnd)],
    [{...image(), sha256: '0'.repeat(64)}], [{...image(), mediaType: 'image/jpeg'}],
    [{...image(), dataBase64: 'https://private.example/image.png'}], [{...image(), dataBase64: 'C:/Users/private/image.png'}],
    [{...image(), dataBase64: image().dataBase64 + '\n'}], [{...image(), dataBase64: 'data:image/png;base64,' + image().dataBase64}],
    [{...image(), url: 'https://private.example'}], [{...image(), path: 'C:/private.png'}], Array.from({length: 5}, () => image())];
  for (const images of inputs) await assert.rejects(p.complete(request({images})), error => error.code === 'INVALID_ARGUMENT'
    && !error.message.includes('private') && !error.message.includes(image().dataBase64));
  await assert.rejects(p.complete(request({messages: [{role: 'system', content: 'No user'}]})), {code: 'INVALID_ARGUMENT'});
  assert.equal(credentials, 0); assert.equal(calls, 0);
});

test('PNG byte/count/aggregate limits are bounded before transport', () => {
  const enlarged = size => {
    const bytes = Buffer.alloc(size); png.copy(bytes); png.subarray(-12).copy(bytes, size - 12); return image(bytes);
  };
  assert.throws(() => snapshotModelImages([enlarged(MODEL_IMAGE_LIMITS.maxBytesPerImage + 1)]), {code: 'INVALID_ARGUMENT'});
  const large = enlarged(6 * 1024 * 1024);
  assert.throws(() => snapshotModelImages([large, large, large]), {code: 'INVALID_ARGUMENT'});
  assert.deepEqual(snapshotModelImages([image()]), [image()]);
});

test('messages, images and parameters are frozen as a snapshot across credential wait', async () => {
  const waiting = deferred(), entered = deferred(); let body;
  const p = provider({vision: true, apiKey: () => {entered.resolve(); return waiting.promise;}, fetch: async (_url, init) => {body = JSON.parse(init.body); return response();}});
  const source = request({maxOutputTokens: 50});
  const pending = new ModelGateway(p).complete(source);
  await entered.promise;
  source.messages[1].content = 'mutated'; source.images[0].dataBase64 = 'private mutation';
  source.images.push(image()); source.maxOutputTokens = 999; source.deadline = '2000-01-01';
  waiting.resolve('synthetic'); await pending;
  assert.equal(body.max_tokens, 50);
  assert.equal(body.messages[1].content.length, 2);
  assert.equal(body.messages[1].content[0].text, 'What is shown?');
  assert.equal(body.messages[1].content[1].image_url.url, `data:image/png;base64,${image().dataBase64}`);
});

test('Gateway also snapshots messages/images before asynchronous custom provider reads', async () => {
  const ready = deferred(), resume = deferred(); let seen;
  const declared = provider({vision: true}).deployment;
  const p = {deployment: declared, complete: async req => {ready.resolve(); await resume.promise; seen = req;
    return {response: {kind: 'final', text: 'synthetic'}, deployment: declared, latencyMs: 0, stopReason: 'fixture'};}};
  const source = request(); const pending = new ModelGateway(p).complete(source); await ready.promise;
  source.messages[1].content = 'changed'; source.images[0].sha256 = '0'.repeat(64); resume.resolve(); await pending;
  assert.equal(seen.messages[1].content, 'What is shown?'); assert.equal(seen.images[0].sha256, image().sha256);
});

test('credential waits honor cancellation and timeout with zero final sends', async () => {
  for (const mode of ['cancel', 'deadline', 'timeout']) {
    const entered = deferred(); let calls = 0;
    const p = provider({vision: true, timeoutMs: mode === 'timeout' ? 15 : 1000,
      apiKey: () => {entered.resolve(); return new Promise(() => {});}, fetch: async () => {calls++; return response();}});
    const controller = new AbortController();
    const pending = p.complete(request({signal: controller.signal,
      deadline: new Date(Date.now() + (mode === 'deadline' ? 20 : 60_000)).toISOString()}));
    await entered.promise; if (mode === 'cancel') controller.abort();
    await assert.rejects(pending, {code: mode === 'cancel' ? 'CANCELLED' : 'TIMEOUT'}); assert.equal(calls, 0);
  }
});

test('guarded fetch remains the final authorization boundary after key wait; revocation is not retried', async () => {
  const entered = deferred(), key = deferred(); let valid = true, networkCalls = 0, guards = 0;
  const p = provider({vision: true, apiKey: () => {entered.resolve(); return key.promise;}, fetch: async (_url, init) => {
    guards++; assert.equal(init.signal.aborted, false);
    if (!valid) throw Object.assign(new Error('Synthetic export revoked'), {name: 'Error'});
    networkCalls++; return response();
  }});
  const pending = p.complete(request()); await entered.promise; valid = false; key.resolve('synthetic');
  await assert.rejects(pending, {code: 'EXTERNAL_FAILURE'}); assert.equal(guards, 1); assert.equal(networkCalls, 0);
});

test('cancellation during credential resolution cannot reach guarded fetch', async () => {
  const controller = new AbortController(); let calls = 0;
  const p = provider({vision: true, apiKey: async () => {controller.abort(); return 'synthetic';}, fetch: async () => {calls++; return response();}});
  await assert.rejects(p.complete(request({signal: controller.signal})), {code: 'CANCELLED'}); assert.equal(calls, 0);
});

test('in-flight transport and response JSON are bounded even if a synthetic fetch ignores abort', async () => {
  for (const phase of ['fetch', 'json']) {
    const entered = deferred(); let sentSignal;
    const p = provider({vision: true, fetch: async (_url, init) => {
      sentSignal = init.signal; entered.resolve();
      if (phase === 'fetch') return new Promise(() => {});
      return {ok: true, json: () => new Promise(() => {})};
    }});
    const controller = new AbortController();
    const pending = p.complete(request({signal: controller.signal})); await entered.promise; controller.abort();
    await assert.rejects(pending, {code: 'CANCELLED'}); assert.equal(sentSignal.aborted, true);
  }
});
