import test from 'node:test';
import assert from 'node:assert/strict';
import {isDirectAnswerGoal, DIRECT_ANSWER_MAX_LENGTH} from '../electron/direct-answer-routing.js';

test('a single read-only weather question is routed to a direct answer', () => {
  for (const goal of ['北京今天下午适合跑步吗', '明天要带伞吗', '上海明天的天气怎么样', '帮我查一下北京天气',
    '今天气温多少度', 'weather in Beijing', '外面下雨了吗']) {
    assert.equal(isDirectAnswerGoal(goal), true, goal);
  }
});

test('anything with an action, a second task or another topic keeps the delegated path', () => {
  for (const goal of ['帮我整理今天的天气并写一份报告', '明天天气如何，顺便订机票', '总结这周的天气',
    '今天天气怎么样，然后安排出行', '帮我发一封邮件', '看一下工作区的天气接口代码', '明天天气怎么样，分别列出北京和上海',
    '帮我预约周末的户外活动']) {
    assert.equal(isDirectAnswerGoal(goal), false, goal);
  }
});

test('empty, non-string and oversized goals are never routed', () => {
  for (const value of [undefined, null, 42, {}, '']) assert.equal(isDirectAnswerGoal(value), false);
  assert.equal(isDirectAnswerGoal('天气' + '很'.repeat(DIRECT_ANSWER_MAX_LENGTH)), false);
});
