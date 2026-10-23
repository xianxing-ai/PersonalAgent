import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {AuthorizationQuestions,createQQMailTriageHost,createRuntimeApplication} from '@personal-agent/runtime/application';
import {FakeMailProvider,QQMailProvider} from '@personal-agent/mail';
import {LayaTriageService} from '@personal-agent/cognition';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createEncryptedModuleStorage} from '../electron/encrypted-module-storage.js';
import {createMailConfig} from '../electron/mail-config.js';

const cache=new URL('../../../.cache/mail-batch-authorization-integration/',import.meta.url);
mkdirSync(cache,{recursive:true});
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
  decryptString:value=>Buffer.from(value).reverse().toString()};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const wait=async check=>{for(let index=0;index<200;index++){
  const result=check();if(result)return result;await new Promise(resolve=>setTimeout(resolve,5));
}assert.fail('Synthetic mailbox integration did not settle');};

/** Only the mailbox and classifier are Synthetic; authorization, storage and execution are production code. */
async function composition(t,{highImpact=false}={}){
  const directory=mkdtempSync(new URL('run-',cache)),prepared=[],resources=new Set(),fetches=[];
  let application,clock=Date.now();
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),
    getApplication:()=>application,namespace:'synthetic-mailbox-user',resolveConversation:()=> 'Synthetic mail conversation',
    now:()=>clock,available:()=>true,
    profiles:[{ref:'application',label:'Application tools; no external process',mode:'workspace-write',revision:1,available:true}],
    defaultProfileRef:'application'});
  const readGeneration=question.readResourceGeneration;
  t.mock.method(question,'readResourceGeneration',resource=>{resources.add(resource);return readGeneration(resource);});
  const config=createMailConfig({userData:directory,safeStorage,namespace:'synthetic-mailbox-user',question,now:()=>clock});
  await config.configure({user:'synthetic@qq.com',authCode:'SyntheticOnlyAuthCode'});
  config.markBound(config.current().revision);
  const mailbox=new FakeMailProvider({inbox:Array.from({length:101},(_,index)=>({uid:index+1,folder:'INBOX',from:'synthetic@example.invalid',
    to:'synthetic@qq.com',subject:'Synthetic meeting '+index,sentAt:'2026-10-21T00:00:00Z',seen:false})),sent:[]},{pageSize:100});
  t.mock.method(QQMailProvider.prototype,'fetchPage',async(account,input)=>{
    fetches.push({account,folder:input.folder,limit:input.limit,cursor:structuredClone(input.cursor)});
    return mailbox.fetchPage(account,input);
  });
  const classifier=new LayaTriageService({async infer(payload){return {answers:Object.fromEntries(payload.state.events.flatMap((_,index)=>[
    ['category_'+index,{choice:'meeting',probabilities:{meeting:.9,other:.1},answer_confidence:.9,confidence:.9}],
    ['impact_'+index,{choice:highImpact?'high_impact':'routine',probabilities:highImpact?{routine:.1,high_impact:.9}:{routine:.9,high_impact:.1},answer_confidence:.9,confidence:.9}],
  ]))};}});
  const port=config.batchAuthorization;
  const host=createQQMailTriageHost({user:'synthetic@qq.com',authCode:'SyntheticOnlyAuthCode',accountRef:'desktop-qq-inbox',
    namespace:'synthetic-mailbox-user',storage:createEncryptedModuleStorage({userData:directory,safeStorage,filename:'classification.json'}),
    triage:classifier,labels:{meeting:'Synthetic meeting',other:'Other'},isSessionAllowed:()=>false,
    batchAuthorization:{...port,preparePage(scope,batch,parent){
      prepared.push({scope,batch:structuredClone(batch),parent});return port.preparePage(scope,batch,parent);
    }}});
  application=createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    hostUserNamespace:'synthetic-mailbox-user',now:()=>new Date(clock),tools:host.tools,
    requiresToolAuthorization:scope=>question.requiresAuthorization(scope),requestToolAuthorization:scope=>{
      host.prepareAuthorization(scope);return question.requestToolAuthorization(scope);
    }});
  host.bindApplication(application);
  const fixture={application,question,config,host,port,prepared,resources,fetches,
    deadline:new Date(clock+60_000).toISOString(),advanceTo:time=>{clock=Date.parse(time);},
    async start(){
      host.startBatch({expiresAt:fixture.deadline});
      const card=await wait(()=>question.snapshot().find(item=>item.state==='pending'));
      assert.equal(fetches.length,0,'configuration readiness must not read the mailbox');
      assert.equal(config.snapshot().sessionAllowed,false);
      assert.equal(application.runtime.policy.get(card.sourceApprovalId),undefined);
      assert.deepEqual(card.requirements.map(item=>item.kind),['tool','connector_session']);
      assert.match(card.requirements[1].summary,/每页最多 100 条，总量未知/);
      assert.match(card.requirements[1].summary,/不含正文、写信或云端分析/);
      assert.equal((await host.refresh()).status,'waiting_approval');
      question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'},card.conversationId);
      await wait(()=>['succeeded','failed','cancelled','waiting_reconciliation'].includes(application.runtime.getTask(card.taskId).state));
      assert.equal(application.runtime.getTask(card.taskId).state,'succeeded',JSON.stringify(application.runtime.getTask(card.taskId).error));
      return card;
    }};
  t.after(async()=>{await host.close();question.close();await wait(()=>application.activeTaskCount===0);application.close();});
  return fixture;
}

function confirmedPage(f,index){
  const {scope,batch}=f.prepared[index],read=f.application.readHostToolTask(scope.taskId);
  assert.equal(read.task.state,'succeeded',JSON.stringify(read.task.error));
  assert.equal(read.confirmed.runId,scope.runId);
  assert.equal(read.confirmed.result.account,batch.accountRef);
  assert.equal(read.confirmed.result.folder,'INBOX');
  assert.equal(read.confirmed.result.items.length,index===0?100:1);
  const record=f.application.runtime.readToolExecutions(scope.taskId).find(item=>item.evidenceId===scope.runId);
  assert.equal(record.state,'confirmed');assert.equal(record.policyDecision,'allow');assert.equal(record.executionStarted,true);
  const intent=f.application.runtime.loadCheckpoint(scope.taskId,'host-tool-intent');
  const grant=f.application.runtime.policy.get(scope.runId);
  assert.equal(grant.taskId,scope.taskId);assert.equal(grant.toolName,'mail.inbox');
  assert.equal(grant.argumentsDigest,intent.argumentsDigest);assert.equal(grant.expiresAt,batch.deadline);
  assert.deepEqual(grant.scopes,['mail:read']);assert.equal(grant.usesRemaining,0);
  assert.equal(f.application.runtime.loadCheckpoint(scope.taskId,'mail-read-session'),batch.batchId);
  assert.equal(f.application.runtime.listCheckpointKeys(scope.taskId).some(key=>key.startsWith('authorization-question-export:')),false,
    'local classification must not manufacture a cloud export lease');
  return {scope,batch,read,intent,grant};
}

test('actual MailReadSessions/Question/Policy/Gateway read two pages after one card without session consent or cloud authority',async t=>{
  const f=await composition(t),card=await f.start(),first=confirmedPage(f,0);
  for(const changes of [{accountRef:'another-account'},{folder:'Sent'},{queryDigest:hash('another query')},
    {generation:'replacement-generation'},{deadline:new Date(Date.parse(f.deadline)+1).toISOString()}]){
    assert.throws(()=>f.port.preparePage(first.scope,{...first.batch,...changes},first.scope));
  }
  assert.equal(f.fetches.length,1,'changed batch scope never reaches the provider');
  await f.host.refresh();
  await wait(()=>f.prepared.length===2&&f.application.runtime.getTask(f.prepared[1].scope.taskId).state==='succeeded');
  const second=confirmedPage(f,1);
  assert.notEqual(second.scope.taskId,first.scope.taskId);assert.notEqual(second.scope.runId,first.scope.runId);
  assert.notEqual(second.intent.argumentsDigest,first.intent.argumentsDigest,'the second cursor has its own exact grant');
  assert.deepEqual(second.batch,first.batch);assert.equal(f.prepared[1].parent.runId,first.scope.runId);
  assert.equal(second.intent.arguments.cursor,first.read.confirmed.result.nextCursor);
  const derived=f.application.runtime.loadCheckpoint(second.scope.taskId,'authorization-question-derived:'+second.scope.runId);
  assert.equal(derived.parentQuestionId,card.questionId);assert.equal(derived.batchId,first.batch.batchId);
  assert.equal(derived.argumentsDigest,second.intent.argumentsDigest);assert.equal(derived.deadline,f.deadline);
  assert.deepEqual(f.question.snapshot().map(item=>[item.questionId,item.state]),[[card.questionId,'allowed']]);
  const completed=await f.host.refresh();assert.equal(completed.status,'complete');assert.equal(completed.counts.total,101);
  assert.equal(f.fetches.length,2);assert.ok(f.fetches.every(item=>item.limit===100&&item.folder==='INBOX'));
  assert.equal(f.config.snapshot().sessionAllowed,false);assert.equal(f.config.snapshot().cloudAnalysisAllowed,false);
  assert.equal(f.config.cloudLease(),undefined);assert.equal(f.application.isDefaultSubagentAvailable(),false);
  f.port.assertConsumed(first.scope,first.batch);
  assert.throws(()=>f.port.assertPage(first.scope,first.batch),/分页已结束/);
  assert.throws(()=>f.question.assertConsumedResult({...first.scope,runId:'replaced-run'},'mail-local-batch'));
  await f.host.refresh();assert.equal(f.fetches.length,2,'completed batches do not continue polling');
});

for(const invalidation of ['cancel','revoke','expiry']){
  test('completed question-mode batch retains consumed analysis receipts until '+invalidation,async t=>{
    const f=await composition(t,{highImpact:true});await f.start();
    await f.host.refresh();
    await wait(()=>f.prepared.length===2&&f.application.runtime.getTask(f.prepared[1].scope.taskId).state==='succeeded');
    assert.equal((await f.host.refresh()).status,'complete');
    const {scope,batch}=f.prepared[0],context=()=>({deadline:f.deadline,signal:new AbortController().signal});
    const [pending]=f.host.pendingAnalyses(context());assert.ok(pending);
    assert.equal(f.host.readAnalysis(pending.workKey,context()).sessionId,pending.sessionId);
    const acceptance={sessionId:pending.sessionId,workKey:pending.workKey,sourceRevision:pending.sourceRevision,
      receiptId:pending.receipt.id,projectionDigest:pending.projectionDigest,taskId:'Synthetic accepted analysis'};
    assert.equal(f.host.confirmAnalysisAccepted(acceptance,context()).state,'accepted');
    assert.equal(f.host.readAnalysis(pending.workKey,context()).taskId,acceptance.taskId);
    assert.ok(!f.host.pendingAnalyses(context()).some(item=>item.workKey===pending.workKey));
    f.port.assertConsumed(scope,batch);
    assert.throws(()=>f.port.assertPage(scope,batch),/分页已结束/);
    assert.throws(()=>f.port.preparePage({...scope,taskId:'new-page',runId:'new-run'},batch,scope),/分页已结束/);
    assert.throws(()=>f.port.assertConsumed({...scope,runId:'foreign-run'},batch));
    assert.equal(f.fetches.length,2,'reading consumed analysis never re-executes an inbox page');
    if(invalidation==='cancel')await f.host.cancel();
    else if(invalidation==='revoke')await f.config.revoke();
    else f.advanceTo(new Date(Date.parse(f.deadline)+1).toISOString());
    assert.throws(()=>f.host.pendingAnalyses(context()),{code:'UNAUTHORIZED'});
    assert.throws(()=>f.host.readAnalysis(pending.workKey,context()),{code:'UNAUTHORIZED'});
    assert.throws(()=>f.host.confirmAnalysisAccepted(acceptance,context()),{code:'UNAUTHORIZED'});
    assert.throws(()=>f.port.assertConsumed(scope,batch));
    assert.equal(f.fetches.length,2);
  });
}

for(const invalidation of ['revoke','configuration','resource generation','cancel','expiry']){
  test('actual mailbox '+invalidation+' invalidates the original batch before another page',async t=>{
    const f=await composition(t);await f.start();const first=confirmedPage(f,0);
    if(invalidation==='revoke')await f.config.revoke();
    else if(invalidation==='configuration')await f.config.configure({user:'replacement@qq.com',authCode:'SyntheticReplacementCode'});
    else if(invalidation==='resource generation'){
      assert.equal(f.resources.size,1);const [resource]=f.resources;
      const generation=f.question.readResourceGeneration(resource);f.question.rotateResourceGeneration(resource,generation);
    }else if(invalidation==='cancel')await f.host.cancel();
    else f.advanceTo(new Date(Date.parse(f.deadline)+1).toISOString());
    assert.equal((await f.host.refresh()).status,'disabled');
    assert.equal(f.fetches.length,1);assert.equal(f.prepared.length,1);
    assert.throws(()=>f.port.assertConsumed(first.scope,first.batch));
    assert.throws(()=>f.port.preparePage(first.scope,first.batch,first.scope));
    assert.throws(()=>f.application.nextMailReadSession(first.batch.batchId));
    assert.equal(f.config.snapshot().sessionAllowed,false);assert.equal(f.config.cloudLease(),undefined);
    assert.equal(f.question.snapshot().filter(item=>item.state==='pending').length,0);
  });
}
