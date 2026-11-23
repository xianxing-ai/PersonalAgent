import assert from 'node:assert/strict';
import test from 'node:test';
import {describeAgentArtsActivities, takeAgentArtsFrames} from '../dist/index.js';

test('AgentArts frames forward message text, reasoning when present, and node boundaries', () => {
  const payload = [
    'data: {"event":"workflow_start","data":{}}',
    '',
    'data: {"event":"node_start","data":{"node_name":"检索"}}',
    '',
    'data: {"event":"message","data":{"text":null,"node_name":"检索"}}',
    '',
    'data: {"event":"message","data":{"text":"第一段","reasoning_content":"先看资料"}}',
    '',
    'data: {"event":"node_end","data":{"node_name":"检索"}}',
    '',
    'data: {"event":"workflow_end","data":{"answer":"第一段"}}',
    '',
  ].join('\n') + '\n';
  const {events, rest} = takeAgentArtsFrames(payload);
  assert.equal(rest, '');
  assert.deepEqual(events.map(event => event.label), ['工作流已开始', '节点开始：检索', '思考', '回答', '节点完成：检索', '工作流已结束']);
  assert.equal(events.find(event => event.kind === 'reasoning').text, '先看资料');
  assert.equal(events.find(event => event.kind === 'answer_delta').text, '第一段');
});

test('an incomplete SSE block stays buffered', () => {
  const {events, rest} = takeAgentArtsFrames('data: {"event":"message","data":{"text":"半');
  assert.deepEqual(events, []);
  assert.match(rest, /半$/);
});
