import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorCards,connectorDestination} from '../src/features/workspace/connectors.js';
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
test('mail keeps classified counts when unread totals are unavailable and directs users to monitoring',()=>{
 const mail={configured:true,status:'disabled',sessionAllowed:false,account:'<masked>',counts:{total:7363}};
 const card=connectorCards({mail},escape).split('data-connector="mail"')[1].split('</article>')[0];
 assert.match(card,/已分类 7363 封/);assert.match(card,/启动邮件监测/);assert.match(card,/&lt;masked&gt;/);
 assert.doesNotMatch(card,/尚未拉取邮件|7363 封未读/);
 const running=connectorCards({mail:{...mail,monitoring:{enabled:true,state:'monitoring'}}},escape);
 assert.match(running,/新邮件监测中/);
});
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
test('a ready weather tool without a result offers a query instead of claiming a disconnected or verified service',()=>{
 const card=connectorCards({health:[{id:'weather.forecast',state:'ready'}]},escape).split('</article>')[0];
 assert.match(card,/待查询/);assert.match(card,/尚未获取数据/);assert.doesNotMatch(card,/未连接|实时|已连接/);
 const zero=connectorCards({weather:{temp:0,city:'<城市>'}},escape).split('</article>')[0];assert.match(zero,/0<span>/);assert.match(zero,/&lt;城市&gt;/);
});
test('ready empty todo and unconfigured subscriptions explain the missing data without inventing an outage',()=>{
 const html=connectorCards({todo:{available:true,items:[]},feeds:{configured:false,available:false,subscriptions:[]}},escape);
 assert.match(html,/待添加订阅/);assert.match(html,/本地待办已就绪/);assert.doesNotMatch(html,/连接服务后|订阅服务未连接/);
});
test('connector entry points use the existing main composer and the actual source settings page',()=>{
 assert.deepEqual(connectorDestination('weather'),{draft:'查询天气：'});
 assert.deepEqual(connectorDestination('obsidian'),{page:'memory'});
 for(const id of ['mail','feeds','calendar'])assert.deepEqual(connectorDestination(id),{page:'connections'});
});
test('saved knowledge or subscriptions cannot masquerade as an available connection after identity or binding changes',()=>{
 const unavailable=connectorCards({knowledge:{configured:true,available:false,reason:'目录身份已改变'},feeds:{subscriptions:[{title:'真实来源'}],requiresRestart:true,available:false}},escape);
 assert.match(unavailable,/目录身份已改变/);assert.match(unavailable,/知识源尚未就绪/);assert.match(unavailable,/待重启/);assert.doesNotMatch(unavailable,/本地知识库已挂载/);
 const ready=connectorCards({knowledge:{configured:true,available:true,displayName:'long'},feeds:{subscriptions:[{title:'真实来源'}],requiresRestart:false,available:true}},escape);
 assert.match(ready,/本地知识库已挂载/);assert.match(ready,/已接入/);assert.match(ready,/读取时按原流程批准/);
});
