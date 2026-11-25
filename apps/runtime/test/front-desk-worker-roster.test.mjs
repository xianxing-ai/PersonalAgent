import test from 'node:test';
import assert from 'node:assert/strict';
import {FRONT_DESK_TOOL_NAMES, ASSISTANT_CHAT_TOOL_NAMES} from '@personal-agent/agentarts';

test('front-desk and assistant chat tool sets are identical', () => {
  assert.equal(ASSISTANT_CHAT_TOOL_NAMES, FRONT_DESK_TOOL_NAMES);
  assert.ok(FRONT_DESK_TOOL_NAMES.has('subagent.dispatch'));
  assert.ok(ASSISTANT_CHAT_TOOL_NAMES.has('assistant.message'));
  assert.ok(ASSISTANT_CHAT_TOOL_NAMES.has('weather.forecast'));
  assert.ok(ASSISTANT_CHAT_TOOL_NAMES.has('worker.list'));
  assert.ok(FRONT_DESK_TOOL_NAMES.has('assistant.list'));
  assert.equal(FRONT_DESK_TOOL_NAMES.has('mail.read'), false);
});
