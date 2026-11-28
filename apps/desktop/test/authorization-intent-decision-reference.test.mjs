import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AuthorizationQuestions,createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createDesktopAuthorizationIntentHost,AUTHORIZATION_INTENT_TOOL} from '../electron/authorization-intent-host.js';

// Actual native intent/question/Policy and persisted Runtime; human clicks are Synthetic.
async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'pa-intent-reference-'));let app,intent,question;
  function open(){
    question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
      namespace:'intent-reference',resolveConversation:()=> 'Synthetic original conversation',available:()=>true,
      profiles:[{ref:'app',label:'Synthetic app policy',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'app'});
    intent=createDesktopAuthorizationIntentHost({getApplication:()=>app,question,openConversation(){}});
    app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'intent-reference',
      tools:[intent.tool],hostOnlyTools:[AUTHORIZATION_INTENT_TOOL],requiresToolAuthorization:()=>true,
      requestToolAuthorization:scope=>{intent.prepareQuestion(scope);return question.requestToolAuthorization(scope);}});
  }
  open();const close=()=>{intent.close();question.close();app.close();};t.after(async()=>{close();await rm(directory,{recursive:true,force:true});});
  const input={action:'reference.source',payload:{factId:'public-fact',sourceRef:'public-source',limit:1},scope:{originalTask:'synthetic-parent',session:'original'},
    summary:'选择此公开 Fact 作为本次 F01 来源；正文出机需另行确认',deadline:new Date(Date.now()+60000).toISOString(),isCurrent:()=>true};
  async function decide(promise,decision='allow_once'){
    let card;const end=Date.now()+5000;
    while(Date.now()<end&&!card){card=question.snapshot().find(item=>item.state==='pending');if(!card)await new Promise(resolve=>setTimeout(resolve,5));}
    assert.ok(card);question.respond({questionId:card.questionId,expectedRevision:card.revision,decision},card.conversationId);
    return {allowed:await promise,card};
  }
  return {get app(){return app;},get intent(){return intent;},get question(){return question;},input,decide,reopen(){close();open();}};
}
test('original confirmed intent supplies an immutable exact reference and repeat readback consumes no grant',async t=>{
  const f=await fixture(t);let reference;
  const result=await f.decide(f.intent.request({...f.input,onConfirmed:value=>{reference=value;}}));assert.equal(result.allowed,true);
  assert.equal(Object.isFrozen(reference),true);assert.equal(reference.taskId,result.card.taskId);assert.equal(reference.runId,'host-tool-'+reference.taskId);
  assert.equal(reference.action,'reference.source');assert.equal(reference.deadline,f.input.deadline);
  assert.deepEqual(f.intent.readConfirmedDecision(reference),reference);assert.deepEqual(f.intent.readConfirmedDecision(reference),reference);
  const count=f.app.runtime.listTasks({limit:10}).items.length;f.reopen();
  assert.deepEqual(f.intent.readConfirmedDecision(reference),reference);assert.equal(f.app.runtime.listTasks({limit:10}).items.length,count);
  assert.equal(f.question.snapshot().filter(item=>item.state==='pending').length,0);
  for(const key of Object.keys(reference))assert.equal(f.intent.readConfirmedDecision({...reference,[key]:'substituted'}),undefined,key);
  f.app.runtime.saveCheckpoint(reference.taskId,'tool-result-'+reference.runId,{result:{decisionRecorded:false},evidenceRefs:[reference.runId]});
  assert.equal(f.intent.readConfirmedDecision(reference),undefined,'a replaced result cannot become an original native selection');
});
test('denied intents provide no confirmed reference and legacy boolean requests are unchanged',async t=>{
  const f=await fixture(t);let calls=0;
  assert.equal((await f.decide(f.intent.request({...f.input,onConfirmed:()=>calls++}),'deny')).allowed,false);assert.equal(calls,0);
  assert.equal((await f.decide(f.intent.request(f.input))).allowed,true);assert.equal(calls,0);
});
test('late callback changes do not revive a permission after the native decision',async t=>{
  const f=await fixture(t);let current=true,reference;
  const result=await f.decide(f.intent.request({...f.input,isCurrent:()=>current,onConfirmed:async value=>{reference=value;await Promise.resolve();current=false;}}));
  assert.equal(result.allowed,false);assert.deepEqual(f.intent.readConfirmedDecision(reference),reference,'historical evidence remains distinct from current authority');
});
test('model.egress with allowTaskReuse asks once with allow_task and reuses across turns for the same owner task',async t=>{
  const f=await fixture(t);
  const deadline=new Date(Date.now()+60000).toISOString();
  const destination='https://example.test/runtimes/fixture/invocations';
  const egressTurn=(ownerTaskId,requestId,payload)=>f.intent.request({
    action:'model.egress',
    payload:{taskId:ownerTaskId,requestId,payloadDigest:requestId},
    scope:{destination},
    summary:`允许本任务向已配置云端地址 ${destination} 发送非敏感对话内容`,
    deadline,
    isCurrent:()=>true,
    egressReview:{conversationId:'Synthetic original conversation',payload,ownerTaskId,destination,allowTaskReuse:true},
  });
  const first=await f.decide(egressTurn('owner-task-1','req-1','{"query":"turn 1"}'),'allow_task');
  assert.equal(first.allowed,true);
  assert.equal(first.card.suggestedDecision,'allow_task');
  assert.equal(first.card.canAlways,true);
  assert.equal(f.question.snapshot().length,1);

  const secondAllowed=await egressTurn('owner-task-1','req-2','{"query":"turn 2"}');
  assert.equal(secondAllowed,true);
  assert.equal(f.question.snapshot().filter(item=>item.state==='pending').length,0);
  assert.equal(f.question.snapshot().length,1);

  const otherTask=await f.decide(egressTurn('owner-task-2','req-3','{"query":"other task"}'),'deny');
  assert.equal(otherTask.allowed,false);
});
test('model.egress.secret with forceAsk forces a card in full-access and supports allow_always whitelist by secret fingerprint',async t=>{
  const f=await fixture(t,{sandboxProfiles:[
    {ref:'full-access',label:'完全访问',mode:'full-access',revision:1,available:true,fullAccessAutoContent:true},
  ],defaultProfileRef:'full-access'});
  const deadline=new Date(Date.now()+60000).toISOString();
  const destination='https://example.test/runtimes/fixture/invocations';
  const sendSecret=(requestId,fingerprints)=>f.intent.request({
    action:'model.egress.secret',
    forceAsk:true,
    payload:{taskId:'owner-secret-task',requestId,payloadDigest:'d-'+requestId},
    scope:{destination,secretFingerprints:fingerprints},
    summary:`检测到疑似真实密钥/凭据，是否允许发送到 ${destination}？`,
    deadline,
    isCurrent:()=>true,
    egressReview:{conversationId:'Synthetic original conversation',payload:'{"token":"[已脱敏凭据]"}',secretWarning:true},
  });

  const deniedRes=await f.decide(sendSecret('req-s1',['fp-secret-1']),'deny');
  assert.equal(deniedRes.allowed,false);
  assert.equal(deniedRes.card.forceAsk,true);
  assert.equal(deniedRes.card.canAlways,true);

  const whitelistedFirst=await f.decide(sendSecret('req-s2',['fp-secret-1']),'allow_always');
  assert.equal(whitelistedFirst.allowed,true);

  const whitelistedSecond=await sendSecret('req-s3',['fp-secret-1']);
  assert.equal(whitelistedSecond,true);
  assert.equal(f.question.snapshot().filter(item=>item.state==='pending').length,0);

  const differentSecret=await f.decide(sendSecret('req-s4',['fp-secret-2']),'deny');
  assert.equal(differentSecret.allowed,false);
  assert.equal(differentSecret.card.forceAsk,true);
});

test('model.egress.pii asks in low-risk mode, reuses allow_task for same ownerTaskId+consentScope, and re-prompts on new PII scope',async t=>{
  const f=await fixture(t);
  const deadline=new Date(Date.now()+60000).toISOString();
  const destination='https://example.test/runtimes/fixture/invocations';
  const sendPii=(taskId,ownerTaskId,requestId,consentScope,fingerprints)=>f.intent.request({
    action:'model.egress.pii',
    payload:{taskId,requestId,payloadDigest:'d-'+requestId},
    scope:{destination,piiFingerprints:fingerprints},
    summary:`检测到个人敏感信息（邮箱地址），是否允许发送到 ${destination}？`,
    deadline,
    isCurrent:()=>true,
    egressReview:{conversationId:'Synthetic original conversation',payload:'{"goal":"re***@qq.com"}',
      ownerTaskId,destination,allowTaskReuse:true,consentScope},
  });

  // Parent task prompts once with suggestedDecision = allow_task
  const parentRes=await f.decide(sendPii('parent-1','parent-1','req-p1','scope-email-1',['fp-email-1']),'allow_task');
  assert.equal(parentRes.allowed,true);
  assert.equal(parentRes.card.suggestedDecision,'allow_task');
  assert.equal(parentRes.card.canAlways,true);

  // Child subagent sharing ownerTaskId + consentScope reuses task consent without another pending card
  const childAllowed=await sendPii('child-1','parent-1','req-p2','scope-email-1',['fp-email-1']);
  assert.equal(childAllowed,true);
  assert.equal(f.question.snapshot().filter(item=>item.state==='pending').length,0);

  // A new unapproved PII fingerprint (new consentScope) must prompt again
  const newScopeDenied=await f.decide(sendPii('child-1','parent-1','req-p3','scope-email-2',['fp-email-1','fp-phone-2']),'deny');
  assert.equal(newScopeDenied.allowed,false);
});
