import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {createConfiguredSubagentModelGateway} from '../dist/application.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const image = {mediaType: 'image/png', dataBase64: png.toString('base64'), sha256: createHash('sha256').update(png).digest('hex')};
const request = () => ({messages: [{role: 'user', content: 'Synthetic image inspection'}], images: [image], tools: [],
  deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal});

test('public Runtime factory preserves default text and only explicitly configured OpenAI vision sends image parts', async () => {
  let calls = 0, body;
  const config = {profile: 'huawei_ict_agentarts', provider: 'openai-compatible', baseUrl: 'https://synthetic.invalid/v1',
    model: 'synthetic', deployment: 'synthetic-vision', apiKey: () => 'synthetic', fetch: async (_url, init) => {
      calls++; body = JSON.parse(init.body);
      return new Response(JSON.stringify({choices: [{message: {content: 'Synthetic observation'}}]}));
    }};
  const text = createConfiguredSubagentModelGateway(config);
  assert.equal(text.deployment.capabilities.vision, false);
  await assert.rejects(text.complete(request()), {code: 'UNSUPPORTED_CAPABILITY'});
  assert.equal(calls, 0);
  const vision = createConfiguredSubagentModelGateway({...config, vision: true});
  assert.equal(vision.deployment.capabilities.vision, true);
  assert.equal(vision.deployment.capabilities.toolCalling, true); // Existing structured adapter remains intact.
  await vision.complete(request());
  assert.equal(calls, 1);
  assert.equal(body.messages[0].content[1].image_url.url, `data:image/png;base64,${image.dataBase64}`);
});

test('public Runtime factory rejects Pangu vision at composition without credentials or transport', () => {
  let calls = 0;
  const config = {profile: 'huawei_ict_agentarts', provider: 'pangu', baseUrl: 'https://synthetic.invalid/v1',
    model: 'synthetic-text', deployment: 'synthetic', vision: true,
    apiKey: () => {calls++; return 'synthetic';}, fetch: async () => {calls++; assert.fail('must not send');}};
  assert.throws(() => createConfiguredSubagentModelGateway(config), {code: 'UNSUPPORTED_CAPABILITY'});
  assert.equal(calls, 0);
  assert.equal(createConfiguredSubagentModelGateway({...config, vision: false}).deployment.capabilities.vision, false);
});
