import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
const {AuthorizationQuestions}=await import(process.env.PA_TEST_AUTHORIZATION_QUESTION_SOURCE
  ??new URL('../dist/application/authorization-question.js',import.meta.url));
const H='a'.repeat(64),R='b'.repeat(64);
function fixture(saved={}) {
  const state={now:Date.parse('2026-10-21T00:00:00Z'),task:'running',owner:'owner-1',available:true,invalidated:[],changes:0};
  const store={get:key=>saved[key]===undefined?undefined:structuredClone(saved[key]),
    compareAndSet(key,previous,next){if(!isDeepStrictEqual(saved[key],previous))return false;saved[key]=structuredClone(next);return true;}};
  const options={store,profiles:[{ref:'restricted',label:'Fake verified sandbox',mode:'workspace-write',revision:1,available:true},
    {ref:'read',label:'Fake read-only sandbox',mode:'read-only',revision:1,available:true},
    {ref:'unavailable',label:'Unavailable backend',mode:'full-access',revision:1,available:false}],defaultProfileRef:'restricted',
    now:()=>state.now,available:()=>state.available,onChange:()=>state.changes++,
    readBinding:request=>['running','waiting_approval'].includes(state.task)&&/^[a-f0-9]{64}$/.test(request.argumentsDigest)
      ?{conversationId:'conversation-1',digest:state.owner}:undefined,
    canExecute:()=>state.task==='running',onInvalidated:(binding,status)=>state.invalidated.push({...binding,status})};
  const host=new AuthorizationQuestions(options);
  const request=(overrides={})=>({taskId:'task-1',proposalId:'proposal-1',runId:'run-1',toolName:'todo.create',toolVersion:'1',argumentsDigest:H,
    deadline:new Date(state.now+60000).toISOString(),signal:new AbortController().signal,
    requirements:[{requirementId:'tool',kind:'tool',scopes:['todo:write'],bindingDigest:H,ruleBindingDigest:R,summary:'Create one todo'},
      {requirementId:'export',kind:'export',scopes:['model:export'],bindingDigest:H,ruleBindingDigest:R,summary:'Export declared todo fields'}],...overrides});
  const respond=(decision='allow_once',question=host.snapshot().at(-1))=>host.respond({questionId:question.questionId,
    expectedRevision:question.revision,decision},question.conversationId);
  return {host,state,request,respond,options,saved};
}

test('the same waiting proposal accepts an answer; execution still requires running and exact one-shot consumption',async()=>{
  const f=fixture(),request=f.request(),promise=f.host.request(request);
  f.state.task='waiting_approval';const question=f.host.snapshot()[0];
  assert.equal(f.respond().accepted,true);const receipt=await promise;
  f.host.consume(receipt,request,'tool','grant-1');
  assert.throws(()=>f.host.assertRequirement(receipt,request,'tool','grant-1'),/当前不能执行/);
  f.state.task='running';f.host.assertRequirement(receipt,request,'tool','grant-1');
  assert.throws(()=>f.host.consume(receipt,request,'tool','grant-2'),/已消费/);
  assert.throws(()=>f.respond('allow_once',question),/已处理或已变化/);
  assert.throws(()=>f.host.consume(receipt,{...request,argumentsDigest:'c'.repeat(64)},'export','export-1'),/已失效/);
  assert.equal(f.host.snapshot()[0].state,'allowed');f.host.close();
});

test('changed owner, proposal bindings, expiry and cancellation never authorize execution',async()=>{
  for(const change of [f=>f.state.owner='other',f=>f.state.task='cancelled',f=>f.state.now+=60001]){
    const f=fixture(),promise=f.host.request(f.request());const rejected=assert.rejects(promise,/已失效/);
    change(f);assert.equal(f.respond().accepted,false);await rejected;
    assert.equal(f.state.invalidated.length,1);f.host.close();
  }
  const f=fixture(),controller=new AbortController(),promise=f.host.request(f.request({signal:controller.signal}));
  const rejected=assert.rejects(promise,/已失效/);controller.abort();await rejected;
  assert.equal(f.host.snapshot()[0].state,'cancelled');assert.equal(f.state.invalidated[0].status,'cancelled');f.host.close();
});

test('denial returns only a decision receipt and never allows a concrete requirement',async()=>{
  const f=fixture(),request=f.request(),promise=f.host.request(request);f.respond('deny');
  const receipt=await promise;assert.equal(receipt.decision,'deny');
  assert.throws(()=>f.host.consume(receipt,request,'tool','grant'),/已失效/);f.host.close();
});

test('permanent rules persist narrowly; resource changes, sandbox switch and revocation require another card',async()=>{
  const f=fixture(),request=f.request(),promise=f.host.request(request);f.respond('allow_always');await promise;
  const reused=await f.host.request(f.request({taskId:'task-2',runId:'run-2',proposalId:'proposal-2',argumentsDigest:'c'.repeat(64)}));
  assert.equal(reused.decision,'allow_always');assert.equal(f.host.snapshot().at(-1).state,'allowed');
  const changed=f.request({runId:'run-3',requirements:request.requirements.map(item=>({...item,ruleBindingDigest:'c'.repeat(64)}))});
  const changedPromise=f.host.request(changed);assert.equal(f.host.snapshot().at(-1).state,'pending');f.respond('deny');await changedPromise;
  const rule=f.host.sandboxSnapshot().rules[0];f.host.revokeRule({ruleId:rule.ruleId,expectedRevision:rule.revision});
  const nextPromise=f.host.request(f.request({runId:'run-4'}));assert.equal(f.host.snapshot().at(-1).state,'pending');
  f.respond('deny');await nextPromise;
  assert.throws(()=>f.host.selectSandbox({profileRef:'unavailable',expectedRevision:2}),/不可用/);
  f.host.selectSandbox({profileRef:'read',expectedRevision:2});assert.equal(f.host.sandboxSnapshot().selected.mode,'read-only');f.host.close();
});

test('restart retains rules and visibly invalidates former pending questions and original waiters',async()=>{
  const f=fixture(),first=f.host.request(f.request());f.respond('allow_always');await first;
  const controller=new AbortController(),pending=f.host.request(f.request({runId:'pending',signal:controller.signal,
    requirements:f.request().requirements.map(item=>({...item,ruleBindingDigest:'d'.repeat(64)}))}));
  const rejected=assert.rejects(pending,/已失效/);
  const reopened=new AuthorizationQuestions(f.options);
  assert.equal(reopened.snapshot().at(-1).state,'stale');assert.equal(f.state.invalidated.at(-1).status,'stale');
  assert.equal(reopened.sandboxSnapshot().rules[0].active,true);
  const receipt=await reopened.request(f.request({runId:'after-restart'}));assert.equal(receipt.decision,'allow_always');
  controller.abort();await rejected;f.host.close();reopened.close();
});

test('UI unavailable, cross-conversation responses and injected profile fields fail closed',async()=>{
  const f=fixture();f.state.available=false;await assert.rejects(f.host.request(f.request()),/不可用/);
  f.state.available=true;const pending=f.host.request(f.request()),question=f.host.snapshot()[0];
  assert.throws(()=>f.host.respond({questionId:question.questionId,expectedRevision:1,decision:'allow_once'},'other'),/不属于/);
  assert.throws(()=>f.host.respond({questionId:question.questionId,expectedRevision:1,decision:'allow_once',profileRef:'full'},'conversation-1'),/Invalid/);
  f.respond('deny');await pending;f.host.close();
});

test('card decision deadline is bounded independently from the original invocation deadline',async()=>{
  const f=fixture(),request=f.request(),promise=f.host.request(request,()=>true,new Date(f.state.now+1000).toISOString());
  const rejected=assert.rejects(promise,/已失效/);f.state.now+=1001;
  assert.equal(f.respond().state,'expired');await rejected;
  assert.equal(f.state.invalidated.at(-1).status,'expired');f.host.close();
});

test('one task decision reuses the same resource while every new run keeps its exact one-use receipt',async()=>{
  const f=fixture(),first=f.request(),pending=f.host.request(first);
  assert.equal(f.host.snapshot()[0].suggestedDecision,'allow_task');f.respond('allow_task');const original=await pending;
  f.host.consume(original,first,'tool','first');
  const second=f.request({runId:'second',proposalId:'second',argumentsDigest:'b'.repeat(64)});
  const receipt=await f.host.request(second);assert.notEqual(receipt.receiptRef,original.receiptRef);
  assert.equal(f.host.snapshot().length,1,'no duplicate visible card');f.host.consume(receipt,second,'tool','second');
  f.host.assertRequirement(receipt,second,'tool','second');assert.throws(()=>f.host.consume(receipt,second,'tool','again'),/已消费/);
  const other=f.host.request(f.request({taskId:'other',runId:'other'}));f.respond('deny');await other;
  const changed=f.host.request(f.request({runId:'changed',requirements:first.requirements.map(item=>({...item,ruleBindingDigest:'d'.repeat(64)}))}));
  f.respond('deny');await changed;f.host.close();
});

test('external mutation task bindings keep the exact target and change set',async()=>{
  const f=fixture(),first=f.request({requirements:f.request().requirements.map(item=>({...item,taskBindingDigest:H}))});
  const pending=f.host.request(first);f.respond('allow_task');await pending;
  const changed=f.host.request(f.request({runId:'changed',requirements:first.requirements.map(item=>({...item,taskBindingDigest:R}))}));
  assert.equal(f.host.snapshot().at(-1).state,'pending');f.respond('deny');await changed;f.host.close();
});

test('task consent stops at restart, cancellation, sandbox revision and the original deadline',async()=>{
  for(const change of ['restart','abort','sandbox','deadline']){
    const f=fixture(),controller=new AbortController(),first=f.request({signal:controller.signal}),pending=f.host.request(first);
    f.respond('allow_task');await pending;let host=f.host;
    if(change==='restart')host=new AuthorizationQuestions(f.options);
    if(change==='abort')controller.abort();
    if(change==='sandbox')host.selectSandbox({profileRef:'read',expectedRevision:1});
    if(change==='deadline')f.state.now+=60001;
    const next=host.request(f.request({runId:'next'}));const card=host.snapshot().at(-1);assert.equal(card.state,'pending',change);
    host.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'deny'},card.conversationId);await next;
    host.close();if(host!==f.host)f.host.close();
  }
});

test('trusted workflow groups reuse only their declared owner, group, sandbox and native boundary',async()=>{
  const f=fixture(),group={taskId:'owner',bindingDigest:H,summary:'Review this workflow',mode:'workspace-write'},
    first=f.request({taskConsent:group}),pending=f.host.request(first);
  f.respond('allow_task');await pending;
  const second=f.request({taskId:'child',toolName:'other.read',runId:'child',taskConsent:group,
    requirements:[{requirementId:'tool',kind:'tool',scopes:['workspace:read'],bindingDigest:R,summary:'Read original source'}]});
  const receipt=await f.host.request(second);assert.equal(receipt.decision,'allow_task');f.host.consume(receipt,second,'tool','child');
  assert.equal(f.host.snapshot().length,1);
  for(const taskConsent of [{...group,taskId:'another-owner'},{...group,bindingDigest:R},{...group,mode:'read-only'}]){
    const next=f.host.request({...second,runId:Math.random().toString(),taskConsent});f.respond('deny');await next;
  }
  assert.throws(()=>f.respond('allow_task',{...f.host.snapshot()[0],revision:1}),/已处理/);f.host.close();
});

test('a grouped native check must present the same verified backend before task consent can be reused',async()=>{
  const f=fixture();let native={required:true,available:true,backend:'windows-psec',enforced:true,bindingDigest:H};
  f.options.describeExecution=()=>native;
  const group={taskId:'owner',bindingDigest:H,summary:'Edit and check the isolated workspace',mode:'workspace-write',requiresNative:true};
  const first=f.host.request(f.request({taskConsent:group}));f.respond('allow_task');await first;
  native={...native,bindingDigest:R};
  const changed=f.host.request(f.request({taskId:'check-child',runId:'check',taskConsent:group}));
  assert.equal(f.host.snapshot().at(-1).state,'pending');f.respond('deny');await changed;
  native={...native,available:false,enforced:false};
  await assert.rejects(f.host.request(f.request({runId:'unavailable',taskConsent:group})),/后端不可用/);f.host.close();
});
