import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorCards} from '../src/features/workspace/connectors.js';
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
test('unconfigured connectors and empty services show empty states instead of invented personal data',()=>{
 for(const data of [{},{todo:{available:true,items:[]},feeds:{available:true,subscriptions:[]}}]){
  const html=connectorCards(data,escape);assert.match(html,/暂无通知/);assert.match(html,/暂无天气数据/);
  assert.doesNotMatch(html,/北京|18<span>|林晓|陈悦|09:30|14:00|项目进度已更新/);
 }
});
test('actual connector items and notifications still render escaped snapshot data',()=>{
 const html=connectorCards({todo:{items:[{title:'<我的待办>',status:'open'}]},notifications:[{summary:'<真实提醒>',occurredAt:'2026-10-18T12:00:00Z'}]},escape);
 assert.match(html,/&lt;我的待办&gt;/);assert.match(html,/&lt;真实提醒&gt;/);assert.doesNotMatch(html,/<我的待办>|<真实提醒>/);
});
