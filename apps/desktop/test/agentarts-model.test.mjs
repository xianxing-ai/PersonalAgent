import test from 'node:test';
import assert from 'node:assert/strict';
import {agentArtsModelPage} from '../src/features/admin/agentarts-model.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

test('AgentArts configuration is a read-only state, not a Local model editor or acceptance claim', () => {
  const html = agentArtsModelPage({configured:true, deployment:'runtime<example>', reason:'<not-verified>', apiKey:'do-not-render'}, escape);
  assert.match(html, /已配置；不代表任务已经完成/);
  assert.doesNotMatch(html, /Competition Profile/);
  assert.match(html, /runtime&lt;example&gt;/);
  assert.match(html, /&lt;not-verified&gt;/);
  assert.doesNotMatch(html, /<input|<form|<button|do-not-render|model-config-form|model-test|model-enabled/);
  const unavailable = agentArtsModelPage({}, escape);
  assert.match(unavailable, /尚未配置/);
  assert.doesNotMatch(unavailable, /<input|<form|<button|model-config-form|model-test|model-enabled/);
});
