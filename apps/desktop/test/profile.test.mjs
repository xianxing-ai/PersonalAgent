import test from 'node:test';
import assert from 'node:assert/strict';
import {profilePage} from '../src/features/admin/profile.js';

const escape = value => String(value);

test('profile ignores token-like result text while retaining task statistics',t=>{
  globalThis.localStorage = {getItem: () => null};
  t.after(()=>delete globalThis.localStorage);
  const tasks = [
    {taskId:'success',state:'succeeded',resultSummary:'用户或模型可控文本; tokens=987654]'},
    {taskId:'failure',state:'failed',resultSummary:'失败摘要; tokens=123]'},
    {taskId:'running',state:'running'},
  ];

  const html = profilePage({tasks},escape);

  assert.doesNotMatch(html, /987,654|987654|tokens=|<strong>123<\/strong>|Token 总量|邀请好友/);
  assert.match(html, /<span>已完成<\/span><b>1<\/b>/);
  assert.match(html, /<span>失败<\/span><b>1<\/b>/);
});
