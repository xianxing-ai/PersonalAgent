import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizationQuestionMarkup,authorizationQuestionResponse,mountAuthorizationQuestionCards} from '../src/features/conversation/authorization-question-card.js';
import {authorizationSettingsMarkup,mountAuthorizationSettings} from '../src/features/conversation/authorization-settings-controls.js';
import {authorizationDom} from '../test-support/authorization-dom.mjs';

const instant=Date.parse('2030-10-21T02:00:00Z');
const question=(extra={})=>({questionId:'synthetic-question',taskId:'task',conversationId:'main',revision:2,state:'pending',
  title:'允许创建这个提醒吗？',description:'Synthetic 本次操作与出机范围',toolName:'todo.create',
  expiresAt:new Date(instant+60_000).toISOString(),canAlways:true,
  requirements:[{requirementId:'connector',kind:'connector_session',summary:'访问待办',scopes:['todo:write']},
    {requirementId:'export',kind:'export',summary:'本次结果发送到 AgentArts',scopes:['cloud:context']}],
  sandbox:{label:'Synthetic 只读沙箱',mode:'read-only',revision:3},...extra});
const deferred=()=>{let resolve,reject;return {promise:new Promise((yes,no)=>{resolve=yes;reject=no;}),resolve,reject};};

test('Synthetic question shows exact scopes, escapes external text and never emits a profile or grant',()=>{
  const value=question({title:'<script>private</script>',description:'"scope" & value'}),html=authorizationQuestionMarkup(value,{now:instant});
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&quot;scope&quot; &amp;/);
  assert.match(html,/仅允许本次/);assert.match(html,/永久允许此规则/);assert.match(html,/拒绝/);
  assert.match(html,/Synthetic 只读沙箱/);assert.match(html,/访问待办/);assert.match(html,/todo:write/);
  for(const decision of ['allow_once','allow_always','deny'])assert.deepEqual(authorizationQuestionResponse(value.questionId,decision,[value],instant),{
    questionId:value.questionId,expectedRevision:2,decision});
  assert.throws(()=>authorizationQuestionResponse(value.questionId,'allow_always',[question({canAlways:false})],instant));
  for(const state of ['allowed','denied','expired','cancelled','stale'])assert.throws(()=>
    authorizationQuestionResponse(value.questionId,'allow_once',[question({state})],instant));
  assert.throws(()=>authorizationQuestionResponse(value.questionId,'allow_once',[value],instant+60_000));
});

for(const decision of ['allow_once','allow_always','deny'])test(`Synthetic ${decision} submits once, waits for authoritative state and preserves keyboard focus`,async t=>{
  const f=authorizationDom(),pending=deferred(),calls=[];let refreshes=0;
  const controls=mountAuthorizationQuestionCards(f.root,{now:()=>instant,invoke:(...args)=>{calls.push(args);return pending.promise;},onChanged:()=>{refreshes++;}});
  t.after(()=>controls.dispose());controls.update([question(),question({questionId:'other',conversationId:'different'})],{conversationId:'main'});
  assert.equal(f.root.querySelectorAll('[data-question-id]').length,1);
  f.button(decision).focus();const submitting=f.root.fire('click',f.button(decision));
  assert.equal(f.document.activeElement.className,'authorization-question-title','disabled origin moves focus to its question, never another card');
  assert.equal(f.button(decision).disabled,true);assert.match(f.root.html,/正在提交选择/);
  await f.root.fire('click',f.button('deny'));assert.equal(calls.length,1);
  assert.deepEqual(calls[0],['authorization.question.respond',{questionId:'synthetic-question',expectedRevision:2,decision}]);
  pending.resolve({accepted:true,questionId:'synthetic-question',revision:3,state:decision==='deny'?'denied':'allowed'});await submitting;
  assert.match(f.root.html,/等待宿主核验/);assert.doesNotMatch(f.root.html,/操作已完成/);assert.equal(refreshes,1);
  controls.update([question({revision:3,state:decision==='deny'?'denied':'allowed'})],{conversationId:'main'});
  assert.equal(f.button('allow_once').disabled,true);assert.match(f.root.html,decision==='deny'?/已拒绝本次请求/:/操作结果仍由原任务确认/);
});

test('Synthetic revision, expiration, cancellation and failed submission cannot reuse stale decisions',async t=>{
  const f=authorizationDom(),pending=deferred();let time=instant,refreshes=0,calls=0;
  const controls=mountAuthorizationQuestionCards(f.root,{now:()=>time,invoke:()=>{calls++;return pending.promise;},onChanged:()=>{refreshes++;}});
  t.after(()=>controls.dispose());controls.update([question()]);
  const submitting=f.root.fire('click',f.button('allow_once'));
  controls.update([question({revision:3,state:'stale'})]);pending.resolve({accepted:true,questionId:'synthetic-question'});await submitting;
  assert.equal(refreshes,0);assert.match(f.root.html,/操作或沙箱已变化/);assert.equal(f.button('allow_once').disabled,true);
  controls.update([question({revision:4,state:'cancelled'})]);assert.match(f.root.html,/原任务已取消/);
  time=instant+60_000;controls.update([question({revision:5})]);assert.match(f.root.html,/期限已失效/);
  await f.root.fire('click',f.button('allow_once'));assert.equal(calls,1);
  controls.dispose();controls.update([question()]);assert.equal(f.root.children.length,0);
  const broken=authorizationDom(),retry=mountAuthorizationQuestionCards(broken.root,{now:()=>instant,invoke:async()=>{throw Error('private token');}});
  t.after(()=>retry.dispose());retry.update([question()]);await broken.root.fire('click',broken.button('allow_once'));
  assert.equal(broken.button('allow_once').disabled,false);assert.match(broken.root.querySelector('[role="status"]').textContent,/没有授予权限/);
  assert.doesNotMatch(broken.root.querySelector('[role="status"]').textContent,/private token/);
});

test('Synthetic safety settings only select available sandbox and revoke exact rule revision',async t=>{
  const f=authorizationDom(),calls=[],value={selected:{label:'只读',mode:'read-only',revision:4},
    profiles:[{ref:'read',label:'只读',mode:'read-only',available:true},{ref:'native',label:'隔离组件',mode:'workspace',available:false,reason:'组件未装配'}],
    rules:[{ruleId:'legacy',revision:2,summary:'历史会话受限授权',sandboxLabel:'只读',active:true}]};
  const controls=mountAuthorizationSettings(f.root,async(name,body)=>{calls.push({name,body});return value;});t.after(()=>controls.dispose());
  controls.show(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls[0].name,'authorization.sandbox.read');
  assert.equal(calls[0].body,undefined);assert.match(f.root.html,/无需先在设置授权一次/);
  assert.doesNotMatch(authorizationSettingsMarkup(value),/type="checkbox"|允许本会话/);
  const select=f.root.querySelector('[data-authorization-profile]');select.value='native';await f.root.fire('change',select);assert.equal(calls.length,1);
  const available=f.root.querySelector('[data-authorization-profile]');available.value='read';await f.root.fire('change',available);
  assert.deepEqual(calls[1],{name:'authorization.sandbox.select',body:{profileRef:'read',expectedRevision:4}});
  await f.root.fire('click',f.root.querySelector('[data-authorization-rule]'));
  assert.deepEqual(calls[3],{name:'authorization.rule.revoke',body:{ruleId:'legacy',expectedRevision:2}});
  assert.ok(calls.every(item=>!item.name.includes('respond')),'settings cannot allow an operation');
  controls.show(false);controls.dispose();const before=calls.length;controls.show(true);assert.equal(calls.length,before);
});
