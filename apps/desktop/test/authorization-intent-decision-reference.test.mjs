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
