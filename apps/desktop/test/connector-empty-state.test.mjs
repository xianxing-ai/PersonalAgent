import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorCards,connectorDestination} from '../src/features/workspace/connectors.js';
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
test('mail keeps classified counts when unread totals are unavailable and directs users to monitoring',()=>{
 // Synthetic trusted-host snapshot; this boolean does not create a real reading grant.
 const mail={configured:true,status:'disabled',sessionAllowed:true,account:'<masked>',counts:{total:7363}};
 const card=connectorCards({mail},escape).split('data-connector="mail"')[1].split('</article>')[0];
 assert.match(card,/已分类 7363 封/);assert.match(card,/启动邮件监测/);assert.match(card,/&lt;masked&gt;/);
 assert.doesNotMatch(card,/尚未拉取邮件|7363 封未读/);
 const running=connectorCards({mail:{...mail,monitoring:{enabled:true,state:'monitoring'}}},escape);
 assert.match(running,/新邮件监测中/);
});
test('mail without current session permission displays historical counts without claiming current reading or monitoring',()=>{
 const mail={configured:true,status:'disabled',sessionAllowed:false,account:'<masked>',counts:{total:7363,unread:9}};
 const card=connectorCards({mail},escape).split('data-connector="mail"')[1].split('</article>')[0];
 assert.match(card,/历史分类 7363 封 · 非实时/);assert.match(card,/需重新授权/);
 assert.match(card,/当前会话尚未允许读取/);assert.match(card,/此卡片不会读取新邮件/);
 assert.match(card,/&lt;masked&gt;/);assert.doesNotMatch(card,/<masked>/);
 assert.doesNotMatch(card,/已分类 7363 封|9 封未读|启动邮件监测|新邮件监测中|新邮件监测已启动|监测未启动|已允许/);
 assert.deepEqual(connectorDestination('mail',{mail}),{page:'connections'});
 assert.equal(mail.sessionAllowed,false);
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
test('weather failure text is displayed as text when no forecast is available',()=>{
 const reason='<img src=x onerror=alert(1)>';
 const card=connectorCards({weather:{reason}},escape).split('</article>')[0];
 assert.match(card,/查询失败/);assert.match(card,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(card,/<img src=x/);
});
test('ready empty todo and unconfigured subscriptions explain the missing data without inventing an outage',()=>{
 const html=connectorCards({todo:{available:true,items:[]},feeds:{configured:false,available:false,subscriptions:[]}},escape);
 assert.match(html,/待添加订阅/);assert.match(html,/本地待办已就绪/);assert.doesNotMatch(html,/连接服务后|订阅服务未连接/);
});
test('connector entry points configure or refresh weather and use the actual source settings page',()=>{
 assert.deepEqual(connectorDestination('weather'),{configure:'weather'});
 assert.deepEqual(connectorDestination('weather',{weather:{configured:false}}),{configure:'weather'});
 assert.deepEqual(connectorDestination('weather',{weather:{configured:true}}),{action:'weather.refresh'});
 assert.deepEqual(connectorDestination('obsidian'),{page:'memory'});
 for(const id of ['mail','feeds','calendar'])assert.deepEqual(connectorDestination(id),{page:'connections'});
});
test('saved knowledge or subscriptions cannot masquerade as an available connection after identity or binding changes',()=>{
 const unavailable=connectorCards({knowledge:{configured:true,available:false,reason:'目录身份已改变'},feeds:{subscriptions:[{title:'真实来源'}],requiresRestart:true,available:false}},escape);
 assert.match(unavailable,/目录身份已改变/);assert.match(unavailable,/知识源尚未就绪/);assert.match(unavailable,/待重启/);assert.doesNotMatch(unavailable,/本地知识库已挂载/);
 const ready=connectorCards({knowledge:{configured:true,available:true,displayName:'long'},feeds:{subscriptions:[{title:'真实来源'}],requiresRestart:false,available:true}},escape);
 assert.match(ready,/本地知识库已挂载/);assert.match(ready,/已接入/);assert.match(ready,/读取时按原流程批准/);
});
test('calendar and todo card surfaces saved CalDAV configuration honestly without inventing synced events',()=>{
 const configured=connectorCards({calendar:{configured:true,readAvailable:true,calendarName:'<工作日程>',reason:'配置已保存，读取需对话确认'}},escape).split('data-connector="calendar"')[1].split('</article>')[0];
 assert.match(configured,/&lt;工作日程&gt;/);
 assert.doesNotMatch(configured,/<工作日程>/);
 assert.match(configured,/已保存配置，读取需对话确认/);
 assert.doesNotMatch(configured,/待办服务未连接|已实时同步/);
 const combined=connectorCards({todo:{available:true,items:[{title:'写周报',status:'open'}]},calendar:{configured:true,readAvailable:false,calendarName:'个人日历'}},escape).split('data-connector="calendar"')[1].split('</article>')[0];
 assert.match(combined,/写周报/);
 assert.match(combined,/个人日历 · 已保存配置，等待读取宿主/);
 const unavailable=connectorCards({calendar:{configured:false,status:'unavailable',calendarName:'CalDAV 日历',reason:'日历读取宿主未就绪'}},escape).split('data-connector="calendar"')[1].split('</article>')[0];
 assert.match(unavailable,/不可用/);
 assert.match(unavailable,/日历读取宿主未就绪/);
});
test('notification connector card exposes keyboard button semantics',()=>{
 const html=connectorCards({},escape);
 assert.match(html,/class="connector-card notification-card" role="button" tabindex="0" aria-label="打开通知设置"/);
});
