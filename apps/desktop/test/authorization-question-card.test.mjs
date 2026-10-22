import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizationQuestionMarkup,authorizationQuestionResponse,authorizationQuestionDefaultDecision,mountAuthorizationQuestionCards,approvalsWithoutQuestionCards} from '../src/features/conversation/authorization-question-card.js';
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
test('Synthetic first pending question requests discovery once without taking focus or moving history on progress',t=>{
  const f=authorizationDom(),announced=[];const controls=mountAuthorizationQuestionCards(f.root,{now:()=>instant,onPending:value=>announced.push(value)});
  t.after(()=>controls.dispose());const focus=f.document.activeElement;
  controls.update([question()],{conversationId:'main'});assert.equal(announced.length,1);assert.equal(announced[0].questionId,'synthetic-question');
  assert.equal(f.document.activeElement,focus);controls.update([question()],{conversationId:'main'});assert.equal(announced.length,1);
  controls.update([question({revision:3,state:'allowed'})],{conversationId:'main'});assert.equal(announced.length,1);
  controls.update([question({questionId:'another'})],{conversationId:'main'});assert.equal(announced.length,2);
});
test('Synthetic exact source approval dedupe never hides a different approval on the same task',()=>{
  const approvals=[{approvalId:'run-a',taskId:'task'},{approvalId:'run-b',taskId:'task'}];
  assert.deepEqual(approvalsWithoutQuestionCards(approvals,[question({sourceApprovalId:'run-a'})],'main'),[approvals[1]]);
  assert.deepEqual(approvalsWithoutQuestionCards(approvals,[question({sourceApprovalId:'run-a',conversationId:'other'})],'main'),approvals);
  assert.deepEqual(approvalsWithoutQuestionCards(approvals,[question()],'main'),approvals);
});
test('Synthetic internal tools and external native enforcement are shown as separate facts with escaped reasons',()=>{
  const internal=authorizationQuestionMarkup(question({sandbox:{kind:'application_policy',label:'应用内受限权限',native:{required:false,available:false,backend:'none',enforced:false}}}),{now:instant});
  assert.match(internal,/本次使用应用内工具，不启动外部进程/);assert.doesNotMatch(internal,/本次需要外部进程隔离/);
  const external=authorizationQuestionMarkup(question({sandbox:{kind:'application_policy',native:{required:true,available:false,backend:'unavailable',enforced:false,reason:'<img src=x onerror=alert(1)>'}}}),{now:instant});
  assert.match(external,/本次需要外部进程隔离/);assert.match(external,/执行边界尚未确认/);assert.doesNotMatch(external,/<img/);
  const settings=authorizationSettingsMarkup({nativeExecution:{available:false,enforced:false,backend:'unavailable',reason:'<script>private</script>'}});
  assert.match(settings,/无需先配置 Node/);assert.doesNotMatch(settings,/<script>/);
});

test('Synthetic question shows exact scopes, escapes external text and never emits a profile or grant',()=>{
  const value=question({title:'<script>private</script>',description:'"scope" & value'}),html=authorizationQuestionMarkup(value,{now:instant});
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&quot;scope&quot; &amp;/);
  assert.match(html,/>同意<\/button>/);assert.match(html,/>拒绝<\/button>/);
  assert.equal((html.match(/data-authorization-decision=/g)??[]).length,2);
  assert.doesNotMatch(html,/data-authorization-decision="allow_always"|永久允许|<input|<textarea|<select/);
  assert.match(html,/<details[^>]*data-authorization-details\s*>/);assert.match(html,/<summary[^>]*>查看详情<\/summary>/);
  assert.match(html,/Synthetic 只读沙箱/);assert.match(html,/访问待办/);assert.match(html,/todo:write/);
  for(const decision of ['allow_once','allow_always','deny'])assert.deepEqual(authorizationQuestionResponse(value.questionId,decision,[value],instant),{
    questionId:value.questionId,expectedRevision:2,decision});
  assert.throws(()=>authorizationQuestionResponse(value.questionId,'allow_always',[question({canAlways:false})],instant));
  for(const state of ['allowed','denied','expired','cancelled','stale'])assert.throws(()=>
    authorizationQuestionResponse(value.questionId,'allow_once',[question({state})],instant));
  assert.throws(()=>authorizationQuestionResponse(value.questionId,'allow_once',[value],instant+60_000));
});

for(const decision of ['allow_once','allow_task','deny'])test(`Synthetic ${decision} submits once, waits for authoritative state and preserves keyboard focus`,async t=>{
  const f=authorizationDom(),pending=deferred(),calls=[];let refreshes=0;
  const controls=mountAuthorizationQuestionCards(f.root,{now:()=>instant,invoke:(...args)=>{calls.push(args);return pending.promise;},onChanged:()=>{refreshes++;}});
  t.after(()=>controls.dispose());controls.update([question(decision==='allow_task'?{canReuseTask:true,suggestedDecision:'allow_task'}:{}),question({questionId:'other',conversationId:'different'})],{conversationId:'main'});
  assert.equal(f.root.querySelectorAll('[data-question-id]').length,1);
  f.button(decision).focus();const submitting=f.root.fire('click',f.button(decision));
  assert.equal(f.document.activeElement.className,'authorization-question-title','disabled origin moves focus to its question, never another card');
  assert.equal(f.button(decision).disabled,true);assert.match(f.root.html,/正在提交/);
  await f.root.fire('click',f.button('deny'));assert.equal(calls.length,1);
  assert.deepEqual(calls[0],['authorization.question.respond',{questionId:'synthetic-question',expectedRevision:2,decision}]);
  pending.resolve({accepted:true,questionId:'synthetic-question',revision:3,state:decision==='deny'?'denied':'allowed'});await submitting;
  assert.match(f.root.html,decision==='deny'?/已拒绝/:/已同意/);assert.doesNotMatch(f.root.html,/操作已完成/);assert.equal(refreshes,1);
  controls.update([question({revision:3,state:decision==='deny'?'denied':'allowed'})],{conversationId:'main'});
  assert.equal(f.button('allow_once').disabled,true);assert.match(f.root.html,decision==='deny'?/已拒绝/:/已同意/);
});

test('Synthetic revision, expiration, cancellation and failed submission cannot reuse stale decisions',async t=>{
  const f=authorizationDom(),pending=deferred();let time=instant,refreshes=0,calls=0;
  const controls=mountAuthorizationQuestionCards(f.root,{now:()=>time,invoke:()=>{calls++;return pending.promise;},onChanged:()=>{refreshes++;}});
  t.after(()=>controls.dispose());controls.update([question()]);
  const submitting=f.root.fire('click',f.button('allow_once'));
  controls.update([question({revision:3,state:'stale'})]);pending.resolve({accepted:true,questionId:'synthetic-question'});await submitting;
  assert.equal(refreshes,0);assert.match(f.root.html,/请求已更新/);assert.equal(f.button('allow_once').disabled,true);
  controls.update([question({revision:4,state:'cancelled'})]);assert.match(f.root.html,/任务已取消/);
  time=instant+60_000;controls.update([question({revision:5})]);assert.match(f.root.html,/请求已过期/);
  await f.root.fire('click',f.button('allow_once'));assert.equal(calls,1);
  controls.dispose();controls.update([question()]);assert.equal(f.root.children.length,0);
  const broken=authorizationDom(),retry=mountAuthorizationQuestionCards(broken.root,{now:()=>instant,invoke:async()=>{throw Error('private token');}});
  t.after(()=>retry.dispose());retry.update([question()]);await broken.root.fire('click',broken.button('allow_once'));
  assert.equal(broken.button('allow_once').disabled,false);assert.match(broken.root.querySelector('[role="status"]').textContent,/提交失败/);
  assert.doesNotMatch(broken.root.querySelector('[role="status"]').textContent,/private token/);
});

test('Synthetic default agreement follows only the host task reuse suggestion and never guesses from permanent support',()=>{
  for(const extra of [{},{canAlways:true},{canReuseTask:true},{canReuseTask:false,suggestedDecision:'allow_task'},
    {canReuseTask:true,suggestedDecision:'allow_always'},{canReuseTask:true,suggestedDecision:'unknown'}]) {
    const value=question(extra);assert.equal(authorizationQuestionDefaultDecision(value),'allow_once');
    assert.match(authorizationQuestionMarkup(value,{now:instant}),/data-authorization-decision="allow_once"/);
    assert.throws(()=>authorizationQuestionResponse(value.questionId,'allow_task',[value],instant));
  }
  const value=question({canReuseTask:true,suggestedDecision:'allow_task'}),html=authorizationQuestionMarkup(value,{now:instant});
  assert.equal(authorizationQuestionDefaultDecision(value),'allow_task');assert.match(html,/data-authorization-decision="allow_task"/);
  assert.ok(html.indexOf('本任务相同范围不再询问')>html.indexOf('<details'));
  assert.deepEqual(authorizationQuestionResponse(value.questionId,'allow_task',[value],instant),{
    questionId:value.questionId,expectedRevision:2,decision:'allow_task'});
  assert.deepEqual(authorizationQuestionResponse(value.questionId,'deny',[value],instant),{
    questionId:value.questionId,expectedRevision:2,decision:'deny'});
  assert.doesNotMatch(authorizationQuestionMarkup(question(),{now:instant}),/本任务相同范围不再询问/);
});

test('Synthetic progress preserves expanded details and their keyboard focus',t=>{
  const f=authorizationDom(),controls=mountAuthorizationQuestionCards(f.root,{now:()=>instant});t.after(()=>controls.dispose());
  controls.update([question()]);const details=f.root.querySelector('[data-authorization-details]');details.open=true;
  f.root.querySelector('[data-authorization-details-toggle]').focus();controls.update([question(),question({questionId:'new'})]);
  assert.equal(f.root.querySelector('[data-authorization-details]').open,true);
  assert.equal(f.document.activeElement.hasAttribute('data-authorization-details-toggle'),true);
});

test('Synthetic an accepted decision stays submitted when the following snapshot refresh fails',async t=>{
  const f=authorizationDom(),calls=[];
  const controls=mountAuthorizationQuestionCards(f.root,{now:()=>instant,invoke:async(name,body)=>{
    calls.push({name,body});return {accepted:true,questionId:body.questionId,revision:3,state:'denied'};
  },onChanged:async()=>{throw Error('Synthetic refresh unavailable');}});t.after(()=>controls.dispose());
  controls.update([question()]);await f.root.fire('click',f.button('deny'));
  assert.equal(f.button('deny').disabled,true);assert.match(f.root.html,/已拒绝/);assert.doesNotMatch(f.root.html,/提交失败/);
  await f.root.fire('click',f.button('deny'));assert.equal(calls.length,1);
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
