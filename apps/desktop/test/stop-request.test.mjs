import test from 'node:test';
import assert from 'node:assert/strict';
import {isStopRequest} from '../src/features/conversation/stop-request.js';

test('a bare stop utterance is recognised in both Chinese and English', () => {
  for (const text of ['停止', ' 停止 ', '停止！', '停下。', '别做了', '取消', '取消任务', '结束',
    'stop', 'Stop!', 'cancel', 'abort', '停止，']) {
    assert.equal(isStopRequest(text), true, text);
  }
});

test('questions and longer instructions that merely contain a stop word are not stop requests', () => {
  for (const text of ['停止条件是什么', '取消订单后怎么办', '别做了会怎样', '停止后请总结', '',
    '帮我停止所有任务', 'how do I cancel an order']) {
    assert.equal(isStopRequest(text), false, text);
  }
});

test('non-string input is never treated as a stop request', () => {
  for (const value of [undefined, null, 42, {}, []]) assert.equal(isStopRequest(value), false);
});
