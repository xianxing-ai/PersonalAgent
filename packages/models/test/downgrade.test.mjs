import assert from 'node:assert/strict';
import test from 'node:test';
import {FakeModelProvider, ModelGateway, selectDeveloperModelGateway} from '../dist/index.js';

const request = () => ({messages: [{role: 'user', content: '估算超支后的模型'}], tools: [], deadline: new Date(Date.now() + 10_000).toISOString(), signal: new AbortController().signal});

test('downgrade uses the fallback gateway only when one is configured', async () => {
  const primary = new ModelGateway(new FakeModelProvider([{kind: 'final', text: 'primary'}, {kind: 'final', text: 'primary'}], {model: 'primary-model'}));
  const fallback = new ModelGateway(new FakeModelProvider([{kind: 'final', text: 'fallback'}], {model: 'fallback-model'}));
  const kept = await selectDeveloperModelGateway({primary, fallback, downgrade: false}).complete(request());
  assert.equal(kept.response.text, 'primary');
  assert.equal(kept.deployment.model, 'primary-model');
  const switched = await selectDeveloperModelGateway({primary, fallback, downgrade: true}).complete(request());
  assert.equal(switched.response.text, 'fallback');
  assert.equal(switched.deployment.model, 'fallback-model');
  const unchanged = await selectDeveloperModelGateway({primary, downgrade: true}).complete(request());
  assert.equal(unchanged.response.text, 'primary');
});
