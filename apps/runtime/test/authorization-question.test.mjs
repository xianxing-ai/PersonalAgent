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
